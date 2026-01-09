import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, Tags, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
// NOTE: clinicConfigData is used at CDK synthesis time for webhook URL generation
// Lambda functions should use DynamoDB secrets tables at runtime for Twilio credentials
import clinicConfigData from '../configs/clinic-config.json';

// Alias for backward compatibility
const clinicsData = clinicConfigData;
type Clinic = typeof clinicsData[number];
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface RcsStackProps extends StackProps {
  /**
   * Twilio Account SID
   */
  twilioAccountSid?: string;
  /**
   * Twilio Auth Token (for webhook signature validation)
   */
  twilioAuthToken?: string;
  /** GlobalSecrets DynamoDB table name for retrieving Twilio credentials */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
}

export class RcsStack extends Stack {
  public readonly rcsMessagesTable: dynamodb.Table;
  public readonly rcsTemplatesTable: dynamodb.Table;
  public readonly rcsApi: apigw.RestApi;
  public readonly incomingMessageFn: lambdaNode.NodejsFunction;
  public readonly fallbackMessageFn: lambdaNode.NodejsFunction;
  public readonly statusCallbackFn: lambdaNode.NodejsFunction;
  public readonly sendMessageFn: lambdaNode.NodejsFunction;
  public readonly getMessagesFn: lambdaNode.NodejsFunction;
  public readonly templatesFn: lambdaNode.NodejsFunction;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly rcsFallbackTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: RcsStackProps = {}) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'RCS',
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

    // Twilio credentials - hardcoded for deployment
    // TODO: Move to AWS Secrets Manager for production security
    const twilioAccountSid = props.twilioAccountSid || 'ACbc899dd5f06f5a5bf2bba9c556a67ea1';
    const twilioAuthToken = props.twilioAuthToken || 'bef3aee1ffb1cbdd11b654fc33dfdd56';

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    // RCS Messages Table - Stores all RCS message history per clinic
    this.rcsMessagesTable = new dynamodb.Table(this, 'RcsMessagesTable', {
      tableName: `${this.stackName}-RcsMessages`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // CLINIC#<clinicId>
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // MSG#<timestamp>#<messageSid> or OUTBOUND#<timestamp>#<messageSid>
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    applyTags(this.rcsMessagesTable, { Table: 'rcs-messages' });

    // GSI for querying by phone number across all clinics
    this.rcsMessagesTable.addGlobalSecondaryIndex({
      indexName: 'PhoneIndex',
      partitionKey: { name: 'from', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by message SID (for status updates)
    this.rcsMessagesTable.addGlobalSecondaryIndex({
      indexName: 'MessageSidIndex',
      partitionKey: { name: 'messageSid', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // RCS Templates Table - Stores rich message templates per clinic
    this.rcsTemplatesTable = new dynamodb.Table(this, 'RcsTemplatesTable', {
      tableName: `${this.stackName}-RcsTemplates`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // CLINIC#<clinicId>
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // TEMPLATE#<templateId>
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    applyTags(this.rcsTemplatesTable, { Table: 'rcs-templates' });

    // GSI for querying templates by category
    this.rcsTemplatesTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // SNS TOPIC FOR RCS FALLBACK MESSAGES
    // ========================================
    // This topic receives messages when the primary incoming webhook fails.
    // Subscribe processors to handle fallback messages (e.g., SMS fallback, alerting).
    
    this.rcsFallbackTopic = new sns.Topic(this, 'RcsFallbackTopic', {
      topicName: `${this.stackName}-RcsFallback`,
      displayName: 'RCS Fallback Messages - Triggered when primary webhook fails',
    });
    applyTags(this.rcsFallbackTopic, { Resource: 'rcs-fallback-topic' });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.rcsApi = new apigw.RestApi(this, 'RcsApi', {
      restApiName: 'RcsApi',
      description: 'RCS Messaging API for Twilio webhooks',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowHeaders: corsConfig.allowHeaders,
        allowMethods: corsConfig.allowMethods,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.rcsApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.rcsApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for protected endpoints
    this.authorizer = new apigw.RequestAuthorizer(this, 'RcsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.rcsApi.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA ENVIRONMENT VARIABLES
    // ========================================

    // Import the unsubscribe table name from NotificationsStack (if deployed)
    // The notifications stack is deployed as TodaysDentalInsightsNotificationsN1
    let unsubscribeTableName = '';
    try {
      unsubscribeTableName = Fn.importValue('TodaysDentalInsightsNotificationsN1-UnsubscribeTableName').toString();
    } catch {
      // NotificationsStack not deployed yet - unsubscribe checking will be disabled
      console.log('TodaysDentalInsightsNotificationsN1-UnsubscribeTableName not available - unsubscribe checking disabled');
    }

    const defaultLambdaEnv = {
      RCS_MESSAGES_TABLE: this.rcsMessagesTable.tableName,
      RCS_TEMPLATES_TABLE: this.rcsTemplatesTable.tableName,
      TWILIO_ACCOUNT_SID: twilioAccountSid,
      TWILIO_AUTH_TOKEN: twilioAuthToken,
      SKIP_TWILIO_VALIDATION: process.env.SKIP_TWILIO_VALIDATION || 'false',
      // Secrets tables for dynamic credential retrieval (Twilio credentials can be fetched from GlobalSecrets)
      GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
      CLINIC_SECRETS_TABLE: props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets',
      CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
    };

    // Extended environment for send message function (includes unsubscribe table)
    const sendMessageEnv = {
      ...defaultLambdaEnv,
      UNSUBSCRIBE_TABLE: unsubscribeTableName,
    };

    // Environment for templates function
    const templatesEnv = {
      RCS_TEMPLATES_TABLE: this.rcsTemplatesTable.tableName,
    };

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Incoming Message Handler - Webhook for Twilio incoming RCS messages
    this.incomingMessageFn = new lambdaNode.NodejsFunction(this, 'RcsIncomingMessageFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'incoming-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: defaultLambdaEnv,
    });
    applyTags(this.incomingMessageFn, { Function: 'rcs-incoming' });
    this.rcsMessagesTable.grantWriteData(this.incomingMessageFn);

    // Fallback Message Handler - Backup webhook for when primary fails
    // Also publishes to SNS topic for async processing (SMS fallback, alerts, etc.)
    this.fallbackMessageFn = new lambdaNode.NodejsFunction(this, 'RcsFallbackMessageFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'fallback-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        ...defaultLambdaEnv,
        RCS_FALLBACK_TOPIC_ARN: this.rcsFallbackTopic.topicArn,
      },
    });
    applyTags(this.fallbackMessageFn, { Function: 'rcs-fallback' });
    this.rcsMessagesTable.grantWriteData(this.fallbackMessageFn);
    // Grant permission to publish to SNS fallback topic
    this.rcsFallbackTopic.grantPublish(this.fallbackMessageFn);

    // Status Callback Handler - Webhook for delivery status updates
    this.statusCallbackFn = new lambdaNode.NodejsFunction(this, 'RcsStatusCallbackFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'status-callback.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: defaultLambdaEnv,
    });
    applyTags(this.statusCallbackFn, { Function: 'rcs-status' });
    this.rcsMessagesTable.grantReadWriteData(this.statusCallbackFn);

    // Send Message Handler - Internal API for sending RCS messages
    this.sendMessageFn = new lambdaNode.NodejsFunction(this, 'RcsSendMessageFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'send-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: sendMessageEnv,
    });
    applyTags(this.sendMessageFn, { Function: 'rcs-send' });
    this.rcsMessagesTable.grantWriteData(this.sendMessageFn);

    // Grant read access to unsubscribe table for checking preferences
    if (unsubscribeTableName) {
      this.sendMessageFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/*-UnsubscribePreferences`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/*-UnsubscribePreferences/index/*`,
        ],
      }));
    }

    // Get Messages Handler - Internal API for retrieving message history
    this.getMessagesFn = new lambdaNode.NodejsFunction(this, 'RcsGetMessagesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'get-messages.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: defaultLambdaEnv,
    });
    applyTags(this.getMessagesFn, { Function: 'rcs-get' });
    this.rcsMessagesTable.grantReadData(this.getMessagesFn);

    // Templates Handler - CRUD for RCS rich message templates
    this.templatesFn = new lambdaNode.NodejsFunction(this, 'RcsTemplatesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'templates.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { 
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node22',
        externalModules: ['uuid'],
      },
      environment: templatesEnv,
    });
    applyTags(this.templatesFn, { Function: 'rcs-templates' });
    this.rcsTemplatesTable.grantReadWriteData(this.templatesFn);

    // ========================================
    // SMS FALLBACK PROCESSOR
    // ========================================
    // Subscribes to the RCS Fallback SNS topic and sends SMS when RCS fails
    const smsFallbackProcessorFn = new lambdaNode.NodejsFunction(this, 'SmsFallbackProcessorFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'sms-fallback-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_MESSAGES_TABLE: this.rcsMessagesTable.tableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
      },
    });
    applyTags(smsFallbackProcessorFn, { Function: 'sms-fallback-processor' });
    
    // Grant DynamoDB permissions for storing fallback records
    this.rcsMessagesTable.grantWriteData(smsFallbackProcessorFn);
    
    // Grant SMS sending permissions via Pinpoint SMS Voice V2
    smsFallbackProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sms-voice:SendTextMessage'],
      resources: ['*'],
    }));
    
    // Grant read access to clinic config for getting SMS origination ARN
    smsFallbackProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets'}`,
      ],
    }));
    
    // Grant KMS decryption if encryption key is provided
    if (props.secretsEncryptionKeyArn) {
      smsFallbackProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }
    
    // Subscribe the SMS fallback processor to the RCS fallback SNS topic
    this.rcsFallbackTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(smsFallbackProcessorFn)
    );
    
    // Create alarms for SMS fallback processor
    createLambdaErrorAlarm(smsFallbackProcessorFn, 'sms-fallback-processor');
    createLambdaThrottleAlarm(smsFallbackProcessorFn, 'sms-fallback-processor');
    createLambdaDurationAlarm(smsFallbackProcessorFn, 'sms-fallback-processor', Math.floor(Duration.seconds(30).toMilliseconds() * 0.8));

    // ========================================
    // SECRETS TABLES PERMISSIONS
    // ========================================
    // Grant read access to secrets tables for dynamic Twilio credential retrieval
    if (props.globalSecretsTableName) {
      const secretsReadPolicy = new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets'}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      });

      this.incomingMessageFn.addToRolePolicy(secretsReadPolicy);
      this.fallbackMessageFn.addToRolePolicy(secretsReadPolicy);
      this.statusCallbackFn.addToRolePolicy(secretsReadPolicy);
      this.sendMessageFn.addToRolePolicy(secretsReadPolicy);
      this.getMessagesFn.addToRolePolicy(secretsReadPolicy);
      this.templatesFn.addToRolePolicy(secretsReadPolicy);
    }

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      const kmsDecryptPolicy = new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      });

      this.incomingMessageFn.addToRolePolicy(kmsDecryptPolicy);
      this.fallbackMessageFn.addToRolePolicy(kmsDecryptPolicy);
      this.statusCallbackFn.addToRolePolicy(kmsDecryptPolicy);
      this.sendMessageFn.addToRolePolicy(kmsDecryptPolicy);
      this.getMessagesFn.addToRolePolicy(kmsDecryptPolicy);
      this.templatesFn.addToRolePolicy(kmsDecryptPolicy);
    }

    // ========================================
    // API ROUTES
    // ========================================

    // Base resource for clinic-specific webhooks
    // Pattern: /rcs/{clinicId}/incoming, /rcs/{clinicId}/fallback, /rcs/{clinicId}/status
    const clinicResource = this.rcsApi.root.addResource('{clinicId}');

    // Twilio Webhook Endpoints (PUBLIC - no auth, validated by Twilio signature)
    // POST /{clinicId}/incoming - Incoming RCS messages
    const incomingResource = clinicResource.addResource('incoming');
    incomingResource.addMethod('POST', new apigw.LambdaIntegration(this.incomingMessageFn), {
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /{clinicId}/fallback - Fallback for incoming messages
    const fallbackResource = clinicResource.addResource('fallback');
    fallbackResource.addMethod('POST', new apigw.LambdaIntegration(this.fallbackMessageFn), {
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /{clinicId}/status - Status callback for outbound messages
    const statusResource = clinicResource.addResource('status');
    statusResource.addMethod('POST', new apigw.LambdaIntegration(this.statusCallbackFn), {
      methodResponses: [{ statusCode: '200' }],
    });

    // Protected Internal API Endpoints (require authentication)
    // POST /{clinicId}/send - Send an RCS message
    const sendResource = clinicResource.addResource('send');
    sendResource.addMethod('POST', new apigw.LambdaIntegration(this.sendMessageFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/messages - Get message history
    const messagesResource = clinicResource.addResource('messages');
    messagesResource.addMethod('GET', new apigw.LambdaIntegration(this.getMessagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // RCS Templates Routes (Protected)
    // GET /{clinicId}/templates - List all templates
    // POST /{clinicId}/templates - Create a new template
    const templatesResource = clinicResource.addResource('templates');
    templatesResource.addMethod('GET', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    templatesResource.addMethod('POST', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }],
    });

    // GET /{clinicId}/templates/{templateId} - Get single template
    // PUT /{clinicId}/templates/{templateId} - Update template
    // DELETE /{clinicId}/templates/{templateId} - Delete template
    const templateByIdResource = templatesResource.addResource('{templateId}');
    templateByIdResource.addMethod('GET', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    templateByIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    templateByIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.incomingMessageFn, name: 'rcs-incoming', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.fallbackMessageFn, name: 'rcs-fallback', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.statusCallbackFn, name: 'rcs-status', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.sendMessageFn, name: 'rcs-send', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.getMessagesFn, name: 'rcs-get', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.templatesFn, name: 'rcs-templates', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.rcsMessagesTable.tableName, 'RcsMessagesTable');
    createDynamoThrottleAlarm(this.rcsTemplatesTable.tableName, 'RcsTemplatesTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'RcsApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'rcs',
      restApiId: this.rcsApi.restApiId,
      stage: this.rcsApi.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'RcsApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/rcs/',
      description: 'RCS API Gateway URL',
      exportName: `${Stack.of(this).stackName}-RcsApiUrl`,
    });

    new CfnOutput(this, 'RcsApiId', {
      value: this.rcsApi.restApiId,
      description: 'RCS API Gateway ID',
      exportName: `${Stack.of(this).stackName}-RcsApiId`,
    });

    new CfnOutput(this, 'RcsMessagesTableName', {
      value: this.rcsMessagesTable.tableName,
      description: 'RCS Messages DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-RcsMessagesTableName`,
    });

    new CfnOutput(this, 'RcsTemplatesTableName', {
      value: this.rcsTemplatesTable.tableName,
      description: 'RCS Templates DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-RcsTemplatesTableName`,
    });

    // Output webhook URLs for each clinic (for Twilio configuration)
    const clinics = clinicsData as Clinic[];
    
    // Generate a summary output with example webhook URLs
    new CfnOutput(this, 'RcsWebhookUrlFormat', {
      value: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/incoming',
      description: 'Format for RCS incoming message webhook URL (replace {clinicId} with actual clinic ID)',
    });

    new CfnOutput(this, 'RcsFallbackUrlFormat', {
      value: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/fallback',
      description: 'Format for RCS fallback webhook URL (replace {clinicId} with actual clinic ID)',
    });

    new CfnOutput(this, 'RcsStatusCallbackUrlFormat', {
      value: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/status',
      description: 'Format for RCS status callback URL (replace {clinicId} with actual clinic ID)',
    });

    new CfnOutput(this, 'RcsFallbackTopicArn', {
      value: this.rcsFallbackTopic.topicArn,
      description: 'SNS Topic ARN for RCS fallback messages - subscribe to receive alerts when primary webhook fails',
      exportName: `${Stack.of(this).stackName}-RcsFallbackTopicArn`,
    });

    // Output first 5 clinic webhook URLs as examples
    clinics.slice(0, 5).forEach((clinic, index) => {
      new CfnOutput(this, `ExampleClinic${index + 1}Webhooks`, {
        value: JSON.stringify({
          clinicId: clinic.clinicId,
          clinicName: clinic.clinicName,
          incomingUrl: `https://apig.todaysdentalinsights.com/rcs/${clinic.clinicId}/incoming`,
          fallbackUrl: `https://apig.todaysdentalinsights.com/rcs/${clinic.clinicId}/fallback`,
          statusCallbackUrl: `https://apig.todaysdentalinsights.com/rcs/${clinic.clinicId}/status`,
        }),
        description: `RCS Webhook URLs for ${clinic.clinicName}`,
      });
    });
  }
}

