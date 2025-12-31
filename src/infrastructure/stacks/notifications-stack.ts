import { Duration, Stack, StackProps, CfnOutput, Fn, Tags, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface NotificationsStackProps extends StackProps {
  templatesTableName: string;
}

export class NotificationsStack extends Stack {
  public readonly notifyFn: lambdaNode.NodejsFunction;
  public readonly notificationsApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly notificationsTable: dynamodb.Table;
  public readonly emailAnalyticsTable: dynamodb.Table;
  public readonly emailStatsTable: dynamodb.Table;
  public readonly unsubscribeTable: dynamodb.Table;
  public readonly emailAnalyticsFn: lambdaNode.NodejsFunction;
  public readonly emailEventProcessorFn: lambdaNode.NodejsFunction;
  public readonly unsubscribeFn: lambdaNode.NodejsFunction;
  public readonly sesConfigurationSet: ses.ConfigurationSet;
  public readonly sesEventsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationsStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Notifications',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    const createLambdaErrorAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: fn.metricErrors({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: fn.metricThrottles({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaDurationAlarm = (fn: lambda.IFunction, name: string, thresholdMs: number) =>
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${name} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) =>
      new cloudwatch.Alarm(this, `${idSuffix}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: tableName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    // ========================================
    // DYNAMODB TABLE SETUP
    // ========================================

    this.notificationsTable = new dynamodb.Table(this, 'NotificationsTable', {
      partitionKey: { name: 'PatNum', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'notificationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-Notifications`,
    });
    applyTags(this.notificationsTable, { Table: 'notifications' });

    // ========================================
    // EMAIL ANALYTICS TABLES
    // ========================================

    // Email Analytics Table - Tracks individual email events
    // Partition Key: messageId (SES Message ID)
    this.emailAnalyticsTable = new dynamodb.Table(this, 'EmailAnalyticsTable', {
      partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-EmailAnalytics`,
      timeToLiveAttribute: 'ttl', // Auto-cleanup old records after 1 year
    });
    
    // GSI for querying by clinic and date
    this.emailAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-sentAt-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sentAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // GSI for querying by status
    this.emailAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-status-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // GSI for querying by recipient email
    this.emailAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'recipientEmail-sentAt-index',
      partitionKey: { name: 'recipientEmail', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sentAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    applyTags(this.emailAnalyticsTable, { Table: 'email-analytics' });

    // Email Stats Table - Aggregated statistics per clinic/period
    // Partition Key: clinicId, Sort Key: period (YYYY-MM)
    this.emailStatsTable = new dynamodb.Table(this, 'EmailStatsTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'period', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-EmailStats`,
    });
    applyTags(this.emailStatsTable, { Table: 'email-stats' });

    // ========================================
    // UNSUBSCRIBE PREFERENCES TABLE
    // ========================================
    // Tracks unsubscribe preferences for email, SMS, and RCS
    // pk: PREF#<patientId> or EMAIL#<email> or PHONE#<phone>
    // sk: CLINIC#<clinicId> or GLOBAL
    this.unsubscribeTable = new dynamodb.Table(this, 'UnsubscribeTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-UnsubscribePreferences`,
    });
    
    // GSI for querying by email
    this.unsubscribeTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // GSI for querying by phone
    this.unsubscribeTable.addGlobalSecondaryIndex({
      indexName: 'phone-index',
      partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // GSI for querying by patient ID
    this.unsubscribeTable.addGlobalSecondaryIndex({
      indexName: 'patientId-index',
      partitionKey: { name: 'patientId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    applyTags(this.unsubscribeTable, { Table: 'unsubscribe-preferences' });

    // ========================================
    // SES CONFIGURATION SET FOR EVENT TRACKING
    // ========================================

    // SNS Topic for SES events
    this.sesEventsTopic = new sns.Topic(this, 'SESEventsTopic', {
      topicName: `${id}-SESEvents`,
      displayName: 'SES Email Events for Analytics',
    });
    applyTags(this.sesEventsTopic, { Resource: 'ses-events-topic' });

    // SES Configuration Set with event destinations
    this.sesConfigurationSet = new ses.ConfigurationSet(this, 'EmailAnalyticsConfigSet', {
      configurationSetName: `${id}-EmailAnalytics`,
      // Enable reputation metrics (bounce/complaint rates)
      reputationMetrics: true,
      // Enable engagement tracking (opens/clicks)
      sendingEnabled: true,
    });
    applyTags(this.sesConfigurationSet, { Resource: 'ses-config-set' });

    // Add SNS event destination for all email events
    new ses.ConfigurationSetEventDestination(this, 'SESEventDestination', {
      configurationSet: this.sesConfigurationSet,
      configurationSetEventDestinationName: 'SNSEventDestination',
      destination: ses.EventDestination.snsTopic(this.sesEventsTopic),
      events: [
        ses.EmailSendingEvent.SEND,
        ses.EmailSendingEvent.DELIVERY,
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.OPEN,
        ses.EmailSendingEvent.CLICK,
        ses.EmailSendingEvent.REJECT,
        ses.EmailSendingEvent.RENDERING_FAILURE,
        ses.EmailSendingEvent.DELIVERY_DELAY,
      ],
    });

    // ========================================
    // EMAIL EVENT PROCESSOR LAMBDA
    // ========================================

    this.emailEventProcessorFn = new lambdaNode.NodejsFunction(this, 'EmailEventProcessorFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'email-analytics-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        EMAIL_ANALYTICS_TABLE: this.emailAnalyticsTable.tableName,
        EMAIL_STATS_TABLE: this.emailStatsTable.tableName,
      },
    });
    applyTags(this.emailEventProcessorFn, { Function: 'email-event-processor' });

    // Grant DynamoDB permissions to event processor
    this.emailAnalyticsTable.grantReadWriteData(this.emailEventProcessorFn);
    this.emailStatsTable.grantReadWriteData(this.emailEventProcessorFn);

    // Subscribe Lambda to SNS topic
    this.sesEventsTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.emailEventProcessorFn)
    );

    // ========================================
    // EMAIL ANALYTICS API LAMBDA
    // ========================================

    this.emailAnalyticsFn = new lambdaNode.NodejsFunction(this, 'EmailAnalyticsFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'email-analytics-api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        EMAIL_ANALYTICS_TABLE: this.emailAnalyticsTable.tableName,
        EMAIL_STATS_TABLE: this.emailStatsTable.tableName,
      },
    });
    applyTags(this.emailAnalyticsFn, { Function: 'email-analytics-api' });

    // Grant DynamoDB read permissions to analytics API
    this.emailAnalyticsTable.grantReadData(this.emailAnalyticsFn);
    this.emailStatsTable.grantReadData(this.emailAnalyticsFn);

    // ========================================
    // UNSUBSCRIBE HANDLER LAMBDA
    // ========================================

    this.unsubscribeFn = new lambdaNode.NodejsFunction(this, 'UnsubscribeFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'unsubscribe-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        UNSUBSCRIBE_TABLE: this.unsubscribeTable.tableName,
        UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET || 'todays-dental-unsubscribe-secret-key-2024',
      },
    });
    applyTags(this.unsubscribeFn, { Function: 'unsubscribe-handler' });

    // Grant DynamoDB permissions to unsubscribe handler
    this.unsubscribeTable.grantReadWriteData(this.unsubscribeFn);

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'NotificationsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();    this.notificationsApi = new apigw.RestApi(this, 'NotificationsApi', {
      restApiName: 'Notifications API',
      description: 'API for managing notifications',
      defaultCorsPreflightOptions: corsConfig,
      defaultMethodOptions: {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.authorizer
      }
    });

    const corsErrorHeaders = getCorsErrorHeaders();
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.notificationsApi.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.notifyFn = new lambdaNode.NodejsFunction(this, 'ClinicNotifyFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'notify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TEMPLATES_TABLE: props.templatesTableName,
        NOTIFICATIONS_TABLE: this.notificationsTable.tableName,
        EMAIL_ANALYTICS_TABLE: this.emailAnalyticsTable.tableName,
        UNSUBSCRIBE_TABLE: this.unsubscribeTable.tableName,
        SES_CONFIGURATION_SET_NAME: this.sesConfigurationSet.configurationSetName,
        UNSUBSCRIBE_BASE_URL: 'https://apig.todaysdentalinsights.com/notifications',
      },
    });
    applyTags(this.notifyFn, { Function: 'notifications' });

    // Grant read access to unsubscribe table for checking preferences
    this.unsubscribeTable.grantReadData(this.notifyFn);

    // Grant SES and SMS permissions
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['ses:SendEmail', 'ses:SendRawEmail'], 
      resources: ['*'] 
    }));
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['sms-voice:SendTextMessage'], 
      resources: ['*'] 
    }));

    // Grant read access to templates table
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.templatesTableName}`],
    }));

    // Grant read/write access to notifications table
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [this.notificationsTable.tableArn],
    }));

    // Grant write access to email analytics table for tracking
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [this.emailAnalyticsTable.tableArn],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // Notifications API: GET /notifications
    const notificationsResource = this.notificationsApi.root.addResource('notifications');

    notificationsResource.addMethod('GET', new apigw.LambdaIntegration(this.notifyFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.PatNum': true,
        'method.request.querystring.email': false
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // Notifications API: POST /clinic/{clinicId}/notification
    const clinicBase = this.notificationsApi.root.addResource('clinic');
    const clinicRes = clinicBase.addResource('{clinicId}');
    const clinicNotify = clinicRes.addResource('notification');

    clinicNotify.addMethod('POST', new apigw.LambdaIntegration(this.notifyFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestValidatorOptions: {
        validateRequestBody: true,
        validateRequestParameters: true
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
      requestModels: {
        'application/json': new apigw.Model(this, 'NotificationRequestModel', {
          restApi: this.notificationsApi,
          contentType: 'application/json',
          modelName: 'NotificationRequest',
          schema: {
            type: apigw.JsonSchemaType.OBJECT,
            required: ['PatNum', 'notificationTypes', 'templateMessage'],
            properties: {
              PatNum: { type: apigw.JsonSchemaType.STRING },
              FName: { type: apigw.JsonSchemaType.STRING },
              LName: { type: apigw.JsonSchemaType.STRING },
              Email: { 
                type: apigw.JsonSchemaType.STRING,
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
              },
              phone: { 
                type: apigw.JsonSchemaType.STRING,
                pattern: '^\\+?[1-9]\\d{9,14}$'
              },
              notificationTypes: { 
                type: apigw.JsonSchemaType.ARRAY,
                items: { 
                  type: apigw.JsonSchemaType.STRING,
                  enum: ['EMAIL', 'SMS']
                },
                minItems: 1
              },
              templateMessage: { type: apigw.JsonSchemaType.STRING },
              toEmail: { type: apigw.JsonSchemaType.STRING }
            }
          }
        })
      }
    });

    // ========================================
    // EMAIL ANALYTICS API ROUTES
    // ========================================

    const analyticsIntegration = new apigw.LambdaIntegration(this.emailAnalyticsFn);

    // GET /email-analytics/stats - Get aggregated statistics
    const emailAnalyticsResource = this.notificationsApi.root.addResource('email-analytics');
    const statsResource = emailAnalyticsResource.addResource('stats');
    statsResource.addMethod('GET', analyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': false,
        'method.request.querystring.period': false,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // GET /email-analytics/dashboard - Get dashboard summary
    const dashboardResource = emailAnalyticsResource.addResource('dashboard');
    dashboardResource.addMethod('GET', analyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': false,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // GET /email-analytics/emails - List emails with filtering
    const emailsResource = emailAnalyticsResource.addResource('emails');
    emailsResource.addMethod('GET', analyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': false,
        'method.request.querystring.status': false,
        'method.request.querystring.startDate': false,
        'method.request.querystring.endDate': false,
        'method.request.querystring.limit': false,
        'method.request.querystring.nextToken': false,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // GET /email-analytics/emails/{messageId} - Get specific email details
    const emailDetailResource = emailsResource.addResource('{messageId}');
    emailDetailResource.addMethod('GET', analyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '404' }
      ],
    });

    // ========================================
    // UNSUBSCRIBE API ROUTES
    // ========================================

    const unsubscribeIntegration = new apigw.LambdaIntegration(this.unsubscribeFn);

    // Public unsubscribe endpoints (no auth required)
    // GET /unsubscribe/{token} - Render unsubscribe page
    const unsubscribeResource = this.notificationsApi.root.addResource('unsubscribe');
    const unsubscribeTokenResource = unsubscribeResource.addResource('{token}');
    
    unsubscribeTokenResource.addMethod('GET', unsubscribeIntegration, {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Access-Control-Allow-Origin': true,
          }
        },
        { statusCode: '400' },
        { statusCode: '500' }
      ],
    });

    // POST /unsubscribe/{token} - Process unsubscribe request
    unsubscribeTokenResource.addMethod('POST', unsubscribeIntegration, {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Access-Control-Allow-Origin': true,
          }
        },
        { statusCode: '400' },
        { statusCode: '500' }
      ],
    });

    // Protected preferences endpoints (auth required)
    // GET /preferences - Get preferences for authenticated user
    const preferencesResource = this.notificationsApi.root.addResource('preferences');
    
    preferencesResource.addMethod('GET', unsubscribeIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.email': false,
        'method.request.querystring.phone': false,
        'method.request.querystring.patientId': false,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // PUT /preferences - Update preferences for authenticated user
    preferencesResource.addMethod('PUT', unsubscribeIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' }
      ],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'NotificationsApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'notifications',
      restApiId: this.notificationsApi.restApiId,
      stage: this.notificationsApi.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'NotificationsApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/notifications/',
      description: 'Notifications API Gateway URL',
      exportName: `${Stack.of(this).stackName}-NotificationsApiUrl`,
    });

    new CfnOutput(this, 'NotificationsApiId', {
      value: this.notificationsApi.restApiId,
      description: 'Notifications API Gateway ID',
      exportName: `${Stack.of(this).stackName}-NotificationsApiId`,
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.notifyFn, name: 'notifications', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
      { fn: this.emailAnalyticsFn, name: 'email-analytics-api', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
      { fn: this.emailEventProcessorFn, name: 'email-event-processor', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.unsubscribeFn, name: 'unsubscribe-handler', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.notificationsTable.tableName, 'NotificationsTable');
    createDynamoThrottleAlarm(this.emailAnalyticsTable.tableName, 'EmailAnalyticsTable');
    createDynamoThrottleAlarm(this.emailStatsTable.tableName, 'EmailStatsTable');
    createDynamoThrottleAlarm(this.unsubscribeTable.tableName, 'UnsubscribeTable');

    // ========================================
    // ADDITIONAL OUTPUTS
    // ========================================

    new CfnOutput(this, 'EmailAnalyticsTableName', {
      value: this.emailAnalyticsTable.tableName,
      description: 'Email Analytics DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-EmailAnalyticsTableName`,
    });

    new CfnOutput(this, 'EmailStatsTableName', {
      value: this.emailStatsTable.tableName,
      description: 'Email Stats DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-EmailStatsTableName`,
    });

    new CfnOutput(this, 'SESConfigurationSetName', {
      value: this.sesConfigurationSet.configurationSetName,
      description: 'SES Configuration Set Name for Email Tracking',
      exportName: `${Stack.of(this).stackName}-SESConfigurationSetName`,
    });

    new CfnOutput(this, 'EmailAnalyticsApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/email-analytics/',
      description: 'Email Analytics API Endpoint',
      exportName: `${Stack.of(this).stackName}-EmailAnalyticsApiEndpoint`,
    });

    new CfnOutput(this, 'UnsubscribeTableName', {
      value: this.unsubscribeTable.tableName,
      description: 'Unsubscribe Preferences DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-UnsubscribeTableName`,
    });

    new CfnOutput(this, 'UnsubscribeApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/unsubscribe/',
      description: 'Unsubscribe API Endpoint (public)',
      exportName: `${Stack.of(this).stackName}-UnsubscribeApiEndpoint`,
    });

    new CfnOutput(this, 'PreferencesApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/preferences',
      description: 'Communication Preferences API Endpoint (authenticated)',
      exportName: `${Stack.of(this).stackName}-PreferencesApiEndpoint`,
    });
  }
}
