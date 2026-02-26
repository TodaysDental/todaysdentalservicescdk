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
import clinicConfigData from '../configs/clinic-config.json';

export interface NotificationsStackProps extends StackProps {
  templatesTableName: string;
  /** GlobalSecrets DynamoDB table name for retrieving secrets */
  globalSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
  /** SSM parameter name that stores the per-clinic SMA ID map JSON */
  smaIdMapParameterName?: string;
  /** Chime SDK media region to use for Meetings/Voice (default: us-east-1) */
  chimeMediaRegion?: string;
}

export class NotificationsStack extends Stack {
  public readonly notifyFn: lambdaNode.NodejsFunction;
  public readonly notificationsApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly notificationsTable: dynamodb.Table;
  public readonly emailAnalyticsTable: dynamodb.Table;
  public readonly emailStatsTable: dynamodb.Table;
  public readonly voiceCallAnalyticsTable: dynamodb.Table;
  public readonly unsubscribeTable: dynamodb.Table;
  public readonly smsMessagesTable: dynamodb.Table;
  public readonly smsTwoWayInboundTopic: sns.Topic;
  public readonly smsIncomingMessageFn: lambdaNode.NodejsFunction;
  public readonly smsAutoReplyFn: lambdaNode.NodejsFunction;
  public readonly smsAutoReplyConfigFn: lambdaNode.NodejsFunction;
  public readonly emailAnalyticsFn: lambdaNode.NodejsFunction;
  public readonly emailEventProcessorFn: lambdaNode.NodejsFunction;
  public readonly unsubscribeFn: lambdaNode.NodejsFunction;
  public readonly emailAiFn: lambdaNode.NodejsFunction;
  public readonly voiceCallAnalyticsFn: lambdaNode.NodejsFunction;
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

    // GSI for querying notifications by clinicId and sentAt (for SMS analytics & inbox)
    this.notificationsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-sentAt-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sentAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

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
    // VOICE CALL ANALYTICS TABLE (Marketing CALL)
    // ========================================
    // Tracks individual outbound voice call attempts (via Chime SMA + Polly Speak).
    // Partition Key: callId (SMA TransactionId UUID)
    // GSIs allow querying by clinic and time for Sent/Analytics tabs.
    this.voiceCallAnalyticsTable = new dynamodb.Table(this, 'VoiceCallAnalyticsTable', {
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-VoiceCallAnalytics`,
      timeToLiveAttribute: 'ttl', // Auto-cleanup old records after 1 year
    });

    this.voiceCallAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-startedAt-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.voiceCallAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'recipientPhone-startedAt-index',
      partitionKey: { name: 'recipientPhone', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    applyTags(this.voiceCallAnalyticsTable, { Table: 'voice-call-analytics' });

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
    // SMS MESSAGING (TWO-WAY + AI AUTO-REPLY)
    // ========================================
    // Stores inbound/outbound SMS messages and per-clinic AI auto-reply config.
    // Inbound SMS is delivered via AWS End User Messaging SMS two-way SNS payload.
    this.smsMessagesTable = new dynamodb.Table(this, 'SmsMessagesTable', {
      tableName: `${id}-SmsMessages`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // CLINIC#<clinicId>
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // MSG#... / OUTBOUND#... / CONFIG#...
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    applyTags(this.smsMessagesTable, { Table: 'sms-messages' });

    // SNS topic that receives inbound SMS (two-way messaging) payloads.
    // Must be referenced when enabling two-way SMS on each phone number.
    this.smsTwoWayInboundTopic = new sns.Topic(this, 'SmsTwoWayInboundTopic', {
      topicName: `${id}-SmsTwoWayInbound`,
      displayName: 'Inbound SMS (Two-way) - triggers AI auto-reply',
    });
    applyTags(this.smsTwoWayInboundTopic, { Resource: 'sms-two-way-inbound-topic' });

    // Allow the SMS service to publish inbound messages to this SNS topic.
    // Ref: https://docs.aws.amazon.com/sms-voice/latest/userguide/two-way-sms-iam-policy-auto.html
    this.smsTwoWayInboundTopic.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('sms-voice.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [this.smsTwoWayInboundTopic.topicArn],
      conditions: {
        StringEquals: {
          'aws:SourceAccount': this.account,
        },
        ArnLike: {
          'aws:SourceArn': `arn:aws:sms-voice:${this.region}:${this.account}:*`,
        },
      },
    }));

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

    // ========================================
    // SES CONTACT LIST FOR SUBSCRIPTION MANAGEMENT
    // ========================================
    // This enables automatic unsubscribe handling via SES
    // Emails using ListManagementOptions will have unsubscribe links automatically managed
    // The {{amazonSESUnsubscribeUrl}} placeholder in emails will be replaced with the actual URL

    // Create SES Contact List for patient email subscriptions
    const patientEmailsContactList = new ses.CfnContactList(this, 'PatientEmailsContactList', {
      contactListName: 'PatientEmails',
      description: 'Patient email subscriptions for clinic communications',
      topics: [
        {
          topicName: 'ClinicCommunications',
          displayName: 'Clinic Communications',
          description: 'Appointment reminders, treatment follow-ups, and clinic notifications',
          defaultSubscriptionStatus: 'OPT_IN',
        },
        {
          topicName: 'MarketingPromotions',
          displayName: 'Marketing & Promotions',
          description: 'Special offers, seasonal promotions, and newsletters',
          defaultSubscriptionStatus: 'OPT_IN',
        },
      ],
    });
    Tags.of(patientEmailsContactList).add('Stack', Stack.of(this).stackName);
    Tags.of(patientEmailsContactList).add('Resource', 'ses-contact-list');

    // Add SNS event destination for all email events including subscription changes
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
        ses.EmailSendingEvent.SUBSCRIPTION, // Track unsubscribe events
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
    // VOICE CALL ANALYTICS API LAMBDA
    // ========================================
    this.voiceCallAnalyticsFn = new lambdaNode.NodejsFunction(this, 'VoiceCallAnalyticsFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'voice-call-analytics-api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        VOICE_CALL_ANALYTICS_TABLE: this.voiceCallAnalyticsTable.tableName,
      },
    });
    applyTags(this.voiceCallAnalyticsFn, { Function: 'voice-call-analytics-api' });

    // Grant DynamoDB read permissions to voice analytics API
    this.voiceCallAnalyticsTable.grantReadData(this.voiceCallAnalyticsFn);

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
        // Secrets tables for dynamic credential retrieval (unsubscribe secret now from GlobalSecrets)
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
    });
    applyTags(this.unsubscribeFn, { Function: 'unsubscribe-handler' });

    // Grant DynamoDB permissions to unsubscribe handler
    this.unsubscribeTable.grantReadWriteData(this.unsubscribeFn);

    // Grant read access to secrets tables for dynamic credential retrieval
    if (props.globalSecretsTableName) {
      this.unsubscribeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      }));
    }

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      this.unsubscribeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // ========================================
    // EMAIL AI HANDLER LAMBDA (Bedrock)
    // ========================================

    this.emailAiFn = new lambdaNode.NodejsFunction(this, 'EmailAiFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'email-ai-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(60), // AI calls can take time
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      // Note: AWS_REGION is automatically set by Lambda runtime
    });
    applyTags(this.emailAiFn, { Function: 'email-ai-handler' });

    // Grant Bedrock model invocation permissions
    this.emailAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      ],
    }));

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

    const corsConfig = getCdkCorsConfig();
    this.notificationsApi = new apigw.RestApi(this, 'NotificationsApi', {
      restApiName: 'Notifications API',
      description: 'API for managing notifications',
      // IMPORTANT: Do not set defaultMethodOptions with a custom authorizer here.
      // CORS preflight (OPTIONS) requests do not send Authorization headers, and
      // API Gateway's auto-generated OPTIONS methods must remain unauthenticated.
      // All protected routes explicitly set the authorizer at the method level.
      defaultCorsPreflightOptions: corsConfig,
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
        VOICE_CALL_ANALYTICS_TABLE: this.voiceCallAnalyticsTable.tableName,
        UNSUBSCRIBE_TABLE: this.unsubscribeTable.tableName,
        SES_CONFIGURATION_SET_NAME: this.sesConfigurationSet.configurationSetName,
        UNSUBSCRIBE_BASE_URL: 'https://apig.todaysdentalinsights.com/notifications',
        // Secrets tables for dynamic clinic configuration retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        // Chime outbound calling (SMA + Meetings)
        CHIME_MEDIA_REGION: props.chimeMediaRegion || 'us-east-1',
        SMA_ID_MAP_PARAMETER_NAME: props.smaIdMapParameterName || '',
      },
    });
    applyTags(this.notifyFn, { Function: 'notifications' });

    // Grant read access to unsubscribe table for checking preferences
    this.unsubscribeTable.grantReadData(this.notifyFn);

    // Grant read access to secrets tables for clinic configuration
    if (props.globalSecretsTableName) {
      this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      }));
    }

    // Grant KMS decryption for secrets encryption key (notifyFn)
    if (props.secretsEncryptionKeyArn) {
      this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

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

    // Grant read/write access to notifications table (including GSI for SMS analytics)
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        this.notificationsTable.tableArn,
        `${this.notificationsTable.tableArn}/index/*`,
      ],
    }));

    // Grant write access to email analytics table for tracking
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [this.emailAnalyticsTable.tableArn],
    }));

    // Grant write access to voice call analytics table for tracking
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
      ],
      resources: [this.voiceCallAnalyticsTable.tableArn],
    }));

    // Chime outbound calling permissions (Marketing CALL)
    // - Reads SMA ID map from SSM
    // - Creates ephemeral meeting per call
    // - Initiates SIP Media Application call
    if (props.smaIdMapParameterName) {
      this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${props.smaIdMapParameterName}`],
      }));
    }

    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateSipMediaApplicationCall',
        'chime-sdk-voice:CreateSipMediaApplicationCall',
        'chime:CreateMeeting',
        'chime:DeleteMeeting',
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:DeleteMeeting',
      ],
      resources: ['*'],
    }));

    // ========================================
    // SMS TWO-WAY INBOUND + AI AUTO-REPLY (Bedrock Agents)
    // ========================================

    // Import AI Agents stack outputs for agent resolution + conversation logging.
    // NOTE: Infra adds an explicit dependency on AiAgentsStack for deployment order.
    const AI_AGENTS_STACK_NAME = 'TodaysDentalInsightsAiAgentsN1';
    const aiAgentsTableName = Fn.importValue(`${AI_AGENTS_STACK_NAME}-AiAgentsTableName`);
    const aiAgentsTableArn = Fn.importValue(`${AI_AGENTS_STACK_NAME}-AiAgentsTableArn`);
    const conversationsTableName = Fn.importValue(`${AI_AGENTS_STACK_NAME}-ConversationsTableName`);
    const conversationsTableArn = Fn.importValue(`${AI_AGENTS_STACK_NAME}-ConversationsTableArn`);

    const clinicConfigTableName = props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig';

    // Async Bedrock-agent auto-reply processor (invoked by inbound SNS handler)
    this.smsAutoReplyFn = new lambdaNode.NodejsFunction(this, 'SmsAutoReplyFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'sms', 'sms-auto-reply.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(90),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SMS_MESSAGES_TABLE: this.smsMessagesTable.tableName,
        UNSUBSCRIBE_TABLE: this.unsubscribeTable.tableName,
        CLINIC_CONFIG_TABLE: clinicConfigTableName,
        AI_AGENTS_TABLE: aiAgentsTableName.toString(),
        AI_AGENT_CONVERSATIONS_TABLE: conversationsTableName.toString(),
        // Optional routing/config (set at deploy time)
        SMS_REPLY_ENABLED: process.env.SMS_REPLY_ENABLED || 'true',
        SMS_REPLY_AGENT_ID: process.env.SMS_REPLY_AGENT_ID || '',
        SMS_REPLY_AGENT_TAG: process.env.SMS_REPLY_AGENT_TAG || 'sms',
        SMS_REPLY_AGENT_ID_MAP_JSON: process.env.SMS_REPLY_AGENT_ID_MAP_JSON || '',
        // Optional fallback when clinic resolution fails
        SMS_DEFAULT_ORIGINATION_ARN: process.env.SMS_DEFAULT_ORIGINATION_ARN || '',
      },
    });
    applyTags(this.smsAutoReplyFn, { Function: 'sms-auto-reply' });

    // Two-way inbound SNS handler: stores inbound SMS and triggers async auto-reply
    this.smsIncomingMessageFn = new lambdaNode.NodejsFunction(this, 'SmsIncomingMessageFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'sms', 'incoming-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SMS_MESSAGES_TABLE: this.smsMessagesTable.tableName,
        SMS_AUTO_REPLY_FUNCTION_ARN: this.smsAutoReplyFn.functionArn,
        ENABLE_SMS_AUTO_REPLY: process.env.ENABLE_SMS_AUTO_REPLY || 'true',
        CLINIC_CONFIG_TABLE: clinicConfigTableName,
        UNSUBSCRIBE_TABLE: this.unsubscribeTable.tableName,
        // Optional fallback when clinic resolution fails (STOP/START confirmations, etc.)
        SMS_DEFAULT_ORIGINATION_ARN: process.env.SMS_DEFAULT_ORIGINATION_ARN || '',
      },
    });
    applyTags(this.smsIncomingMessageFn, { Function: 'sms-incoming' });

    // Subscribe inbound handler to the two-way SMS topic
    this.smsTwoWayInboundTopic.addSubscription(new snsSubscriptions.LambdaSubscription(this.smsIncomingMessageFn));

    // Also subscribe inbound handler to any existing per-clinic two-way SMS topics listed in clinic-config.json.
    // This matches setups where each SMS phone number publishes inbound messages to its own SNS topic.
    const clinicSmsInboundTopicArns = Array.from(new Set(
      (clinicConfigData as any[])
        .map((c) => String(c?.smsIncomingSnsTopicArn || '').trim())
        .filter((arn) => arn.length > 0)
    )).sort();

    clinicSmsInboundTopicArns.forEach((topicArn, idx) => {
      // Avoid double-subscribe if someone points a clinic at the shared topic.
      if (topicArn === this.smsTwoWayInboundTopic.topicArn) return;

      const importedTopic = sns.Topic.fromTopicArn(this, `ImportedSmsTwoWayInboundTopic${idx + 1}`, topicArn);
      importedTopic.addSubscription(new snsSubscriptions.LambdaSubscription(this.smsIncomingMessageFn));
    });

    // Permissions: store messages + idempotency in the SMS messages table
    this.smsMessagesTable.grantReadWriteData(this.smsIncomingMessageFn);
    this.smsMessagesTable.grantReadWriteData(this.smsAutoReplyFn);

    // Inbound handler needs to manage unsubscribe preferences (STOP/START)
    this.unsubscribeTable.grantReadWriteData(this.smsIncomingMessageFn);

    // Auto-reply reads unsubscribe status
    this.unsubscribeTable.grantReadData(this.smsAutoReplyFn);

    // Inbound handler must invoke the auto-reply processor
    this.smsAutoReplyFn.grantInvoke(this.smsIncomingMessageFn);

    // Inbound handler may send SMS confirmations (STOP/START)
    this.smsIncomingMessageFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sms-voice:SendTextMessage'],
      resources: ['*'],
    }));

    // Auto-reply must send SMS via End User Messaging SMS
    this.smsAutoReplyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sms-voice:SendTextMessage'],
      resources: ['*'],
    }));

    // Auto-reply Bedrock Agent invocation permissions
    this.smsAutoReplyFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // Read clinic config table for SMS origination identity (smsOriginationArn) + clinic metadata
    const clinicConfigReadPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTableName}/index/*`,
      ],
    });
    this.smsIncomingMessageFn.addToRolePolicy(clinicConfigReadPolicy);
    this.smsAutoReplyFn.addToRolePolicy(clinicConfigReadPolicy);

    // AI Agents tables permissions (resolve agent config + write conversation logs)
    const importedAiAgentsTable = dynamodb.Table.fromTableArn(this, 'ImportedAiAgentsTableForSms', aiAgentsTableArn);
    importedAiAgentsTable.grantReadData(this.smsAutoReplyFn);

    const importedConversationsTable = dynamodb.Table.fromTableArn(this, 'ImportedAiConversationsTableForSms', conversationsTableArn);
    importedConversationsTable.grantWriteData(this.smsAutoReplyFn);

    // Protected API: configure per-clinic SMS AI auto-reply settings
    this.smsAutoReplyConfigFn = new lambdaNode.NodejsFunction(this, 'SmsAutoReplyConfigFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'sms', 'sms-auto-reply-config.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SMS_MESSAGES_TABLE: this.smsMessagesTable.tableName,
        AI_AGENTS_TABLE: aiAgentsTableName.toString(),
      },
    });
    applyTags(this.smsAutoReplyConfigFn, { Function: 'sms-auto-reply-config' });
    this.smsMessagesTable.grantReadWriteData(this.smsAutoReplyConfigFn);
    importedAiAgentsTable.grantReadData(this.smsAutoReplyConfigFn);

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
            // Only PatNum and notificationTypes are required - content can come from template OR custom fields
            required: ['PatNum', 'notificationTypes'],
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
                  enum: ['EMAIL', 'SMS', 'CALL']
                },
                minItems: 1
              },
              // Template-based content (optional - use either template OR custom fields)
              templateMessage: { type: apigw.JsonSchemaType.STRING },
              // Custom email content (used when templateMessage is not provided)
              customEmailSubject: { type: apigw.JsonSchemaType.STRING },
              customEmailHtml: { type: apigw.JsonSchemaType.STRING },
              customEmailBody: { type: apigw.JsonSchemaType.STRING }, // Alias for customEmailHtml
              // Custom SMS content (used when templateMessage is not provided)
              customSmsText: { type: apigw.JsonSchemaType.STRING },
              textMessage: { type: apigw.JsonSchemaType.STRING }, // Alias for customSmsText
              toEmail: { type: apigw.JsonSchemaType.STRING },
              // Custom Voice Call content (used when templateMessage is not provided)
              customVoiceText: { type: apigw.JsonSchemaType.STRING },
              voiceId: { type: apigw.JsonSchemaType.STRING },
              voiceEngine: { type: apigw.JsonSchemaType.STRING, enum: ['standard', 'neural'] },
              voiceLanguageCode: { type: apigw.JsonSchemaType.STRING },
            }
          }
        })
      }
    });

    // ========================================
    // SMS ANALYTICS API ROUTES (handled by notifyFn)
    // ========================================

    const smsAnalyticsIntegration = new apigw.LambdaIntegration(this.notifyFn);
    const smsAnalyticsResource = this.notificationsApi.root.addResource('sms-analytics');

    // GET /sms-analytics/dashboard
    const smsDashboardResource = smsAnalyticsResource.addResource('dashboard');
    smsDashboardResource.addMethod('GET', smsAnalyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': true,
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

    // GET /sms-analytics/messages
    const smsMessagesResource = smsAnalyticsResource.addResource('messages');
    smsMessagesResource.addMethod('GET', smsAnalyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': true,
        'method.request.querystring.status': false,
        'method.request.querystring.limit': false,
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

    // ========================================
    // SMS AI AUTO-REPLY CONFIG API ROUTES
    // ========================================

    // GET/PUT /sms/{clinicId}/ai/auto-reply (authenticated)
    const smsRoot = this.notificationsApi.root.addResource('sms');
    const smsClinic = smsRoot.addResource('{clinicId}');
    const smsAi = smsClinic.addResource('ai');
    const smsAutoReply = smsAi.addResource('auto-reply');
    const smsAutoReplyIntegration = new apigw.LambdaIntegration(this.smsAutoReplyConfigFn);

    smsAutoReply.addMethod('GET', smsAutoReplyIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '401' }, { statusCode: '403' }],
    });

    smsAutoReply.addMethod('PUT', smsAutoReplyIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '401' }, { statusCode: '403' }],
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
    // VOICE CALL ANALYTICS API ROUTES
    // ========================================
    const voiceAnalyticsIntegration = new apigw.LambdaIntegration(this.voiceCallAnalyticsFn);
    const callAnalyticsResource = this.notificationsApi.root.addResource('call-analytics');

    // GET /call-analytics/dashboard
    const callDashboardResource = callAnalyticsResource.addResource('dashboard');
    callDashboardResource.addMethod('GET', voiceAnalyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': true,
        'method.request.querystring.periodDays': false,
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

    // GET /call-analytics/calls
    const callsResource = callAnalyticsResource.addResource('calls');
    callsResource.addMethod('GET', voiceAnalyticsIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.clinicId': true,
        'method.request.querystring.status': false,
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

    // GET /call-analytics/calls/{callId}
    const callDetailResource = callsResource.addResource('{callId}');
    callDetailResource.addMethod('GET', voiceAnalyticsIntegration, {
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
    // EMAIL AI API ROUTES (Bedrock)
    // ========================================

    const emailAiIntegration = new apigw.LambdaIntegration(this.emailAiFn, {
      timeout: Duration.seconds(29), // Maximum API Gateway integration timeout for AI calls
      proxy: true,
    });

    // /email/ai resource
    const emailResource = this.notificationsApi.root.addResource('email');
    const emailAiResource = emailResource.addResource('ai');

    // POST /email/ai/subject-lines - Generate AI subject lines
    // Note: CORS preflight is handled by defaultCorsPreflightOptions on the API
    const subjectLinesResource = emailAiResource.addResource('subject-lines');
    subjectLinesResource.addMethod('POST', emailAiIntegration, {
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
        { statusCode: '500' }
      ],
    });

    // POST /email/ai/body-content - Generate AI email body content
    const bodyContentResource = emailAiResource.addResource('body-content');
    bodyContentResource.addMethod('POST', emailAiIntegration, {
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
        { statusCode: '500' }
      ],
    });

    // POST /email/ai/full-template - Generate AI full template design (Unlayer JSON)
    const fullTemplateResource = emailAiResource.addResource('full-template');
    fullTemplateResource.addMethod('POST', emailAiIntegration, {
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
        { statusCode: '500' }
      ],
    });

    // POST /email/ai/html-template - Generate complete HTML email template
    const htmlTemplateResource = emailAiResource.addResource('html-template');
    htmlTemplateResource.addMethod('POST', emailAiIntegration, {
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
        { statusCode: '500' }
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
      { fn: this.smsIncomingMessageFn, name: 'sms-incoming', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.smsAutoReplyFn, name: 'sms-auto-reply', durationMs: Math.floor(Duration.seconds(90).toMilliseconds() * 0.8) },
      { fn: this.smsAutoReplyConfigFn, name: 'sms-auto-reply-config', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.emailAnalyticsFn, name: 'email-analytics-api', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
      { fn: this.voiceCallAnalyticsFn, name: 'voice-call-analytics-api', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
      { fn: this.emailEventProcessorFn, name: 'email-event-processor', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.unsubscribeFn, name: 'unsubscribe-handler', durationMs: Math.floor(Duration.seconds(20).toMilliseconds() * 0.8) },
      { fn: this.emailAiFn, name: 'email-ai-handler', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.notificationsTable.tableName, 'NotificationsTable');
    createDynamoThrottleAlarm(this.smsMessagesTable.tableName, 'SmsMessagesTable');
    createDynamoThrottleAlarm(this.emailAnalyticsTable.tableName, 'EmailAnalyticsTable');
    createDynamoThrottleAlarm(this.emailStatsTable.tableName, 'EmailStatsTable');
    createDynamoThrottleAlarm(this.voiceCallAnalyticsTable.tableName, 'VoiceCallAnalyticsTable');
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

    new CfnOutput(this, 'EmailAiApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/email/ai/',
      description: 'Email AI Content Generation API Endpoint (authenticated)',
      exportName: `${Stack.of(this).stackName}-EmailAiApiEndpoint`,
    });

    new CfnOutput(this, 'VoiceCallAnalyticsTableName', {
      value: this.voiceCallAnalyticsTable.tableName,
      description: 'Voice Call Analytics DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-VoiceCallAnalyticsTableName`,
    });

    new CfnOutput(this, 'CallAnalyticsApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/call-analytics/',
      description: 'Voice Call Analytics API Endpoint (authenticated)',
      exportName: `${Stack.of(this).stackName}-CallAnalyticsApiEndpoint`,
    });

    new CfnOutput(this, 'SmsAnalyticsApiEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/sms-analytics/',
      description: 'SMS Analytics API Endpoint (authenticated)',
      exportName: `${Stack.of(this).stackName}-SmsAnalyticsApiEndpoint`,
    });

    new CfnOutput(this, 'SmsTwoWayInboundTopicArn', {
      value: this.smsTwoWayInboundTopic.topicArn,
      description: 'Shared SNS Topic ARN for inbound two-way SMS payloads (optional; per-clinic topics can also be used via clinic-config.json)',
      exportName: `${Stack.of(this).stackName}-SmsTwoWayInboundTopicArn`,
    });

    new CfnOutput(this, 'SmsAiAutoReplyConfigEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/notifications/sms/{clinicId}/ai/auto-reply',
      description: 'SMS AI Auto-Reply Config API Endpoint (authenticated)',
      exportName: `${Stack.of(this).stackName}-SmsAiAutoReplyConfigEndpoint`,
    });
  }
}
