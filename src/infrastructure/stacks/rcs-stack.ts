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
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
// NOTE: clinicConfigData is used at CDK synthesis time for webhook URL generation
// Lambda functions should use DynamoDB secrets tables at runtime for Twilio credentials
import clinicConfigData from '../configs/clinic-config.json';

// Alias for backward compatibility
const clinicsData = clinicConfigData;
type Clinic = typeof clinicsData[number];
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface RcsStackProps extends StackProps {
  /** GlobalSecrets DynamoDB table name for retrieving Twilio credentials */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;

  /**
   * AI Agents stack integration (Bedrock Agents) for RCS auto-replies.
   * If provided, inbound RCS messages can be replied to by a Bedrock Agent.
   */
  aiAgentsTableName?: string;
  aiAgentsTableArn?: string;
  aiAgentConversationsTableName?: string;
  aiAgentConversationsTableArn?: string;
}

export class RcsStack extends Stack {
  public readonly rcsTemplatesTable: dynamodb.Table;
  public readonly rcsAnalyticsTable: dynamodb.Table;
  public readonly rcsApi: apigw.RestApi;
  public readonly incomingMessageFn: lambdaNode.NodejsFunction;
  public readonly fallbackMessageFn: lambdaNode.NodejsFunction;
  public readonly statusCallbackFn: lambdaNode.NodejsFunction;
  public readonly sendMessageFn: lambdaNode.NodejsFunction;
  public readonly rcsAutoReplyFn: lambdaNode.NodejsFunction;
  public readonly rcsAutoReplyConfigFn: lambdaNode.NodejsFunction;
  public readonly getMessagesFn: lambdaNode.NodejsFunction;
  public readonly templatesFn: lambdaNode.NodejsFunction;
  public readonly analyticsFn: lambdaNode.NodejsFunction;
  public readonly analyticsAggregatorFn: lambdaNode.NodejsFunction;
  public readonly rcsAiFn: lambdaNode.NodejsFunction;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly rcsFallbackTopic: sns.Topic;
  public readonly rcsAnalyticsTopic: sns.Topic;

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

    // Twilio credentials are now fetched from DynamoDB GlobalSecrets table at runtime
    // No more hardcoded credentials - Lambda functions use secrets-helper.ts

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    // RCS Templates Table - ALSO stores all RCS message history per clinic
    // We intentionally keep everything in ONE DynamoDB table and separate item types by `sk` prefix:
    // - TEMPLATE#<templateId> (RCS templates)
    // - MSG#<timestamp>#<messageSid> (inbound)
    // - OUTBOUND#<timestamp>#<messageSid> (outbound)
    // - STATUS#<messageSid>#<timestamp> (delivery status audit records)
    // - SMS_FALLBACK#<timestamp>#<originalMessageSid> (SMS fallback audit records)
    this.rcsTemplatesTable = new dynamodb.Table(this, 'RcsTemplatesTable', {
      tableName: `${this.stackName}-RcsTemplates`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // CLINIC#<clinicId>
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // TEMPLATE#<templateId>
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
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

    // RCS Analytics Table - Pre-aggregated analytics metrics
    this.rcsAnalyticsTable = new dynamodb.Table(this, 'RcsAnalyticsTable', {
      tableName: `${this.stackName}-RcsAnalytics`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, // CLINIC#<clinicId>
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // DAILY#<date> or HOURLY#<date>#<hour> or TEMPLATE_PERF#<templateId>#<date>
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    applyTags(this.rcsAnalyticsTable, { Table: 'rcs-analytics' });

    // GSI for querying analytics by date across all clinics
    this.rcsAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'DateIndex',
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by granularity (daily/hourly aggregates)
    this.rcsAnalyticsTable.addGlobalSecondaryIndex({
      indexName: 'GranularityIndex',
      partitionKey: { name: 'granularity', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'aggregatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // SNS TOPICS
    // ========================================

    // Topic for RCS analytics events (delivery confirmations, read receipts)
    this.rcsAnalyticsTopic = new sns.Topic(this, 'RcsAnalyticsTopic', {
      topicName: `${this.stackName}-RcsAnalytics`,
      displayName: 'RCS Analytics Events - Delivery and engagement tracking',
    });
    applyTags(this.rcsAnalyticsTopic, { Resource: 'rcs-analytics-topic' });

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
      // Messages are stored in the unified RCS templates table
      RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
      RCS_TEMPLATES_TABLE: this.rcsTemplatesTable.tableName,
      SKIP_TWILIO_VALIDATION: process.env.SKIP_TWILIO_VALIDATION || 'false',
      // Secrets tables for dynamic credential retrieval (Twilio credentials fetched from GlobalSecrets at runtime)
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
    this.rcsTemplatesTable.grantWriteData(this.incomingMessageFn);

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
    this.rcsTemplatesTable.grantWriteData(this.fallbackMessageFn);
    // Grant permission to publish to SNS fallback topic
    this.rcsFallbackTopic.grantPublish(this.fallbackMessageFn);

    // Status Callback Handler - Webhook for delivery status updates
    // Includes analytics event publishing and CloudWatch metrics
    this.statusCallbackFn = new lambdaNode.NodejsFunction(this, 'RcsStatusCallbackFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'status-callback.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        ...defaultLambdaEnv,
        RCS_ANALYTICS_TOPIC_ARN: this.rcsAnalyticsTopic.topicArn,
      },
    });
    applyTags(this.statusCallbackFn, { Function: 'rcs-status' });
    this.rcsTemplatesTable.grantReadWriteData(this.statusCallbackFn);
    
    // Grant permissions for analytics publishing
    this.rcsAnalyticsTopic.grantPublish(this.statusCallbackFn);
    
    // Grant CloudWatch metrics publishing for status callback
    this.statusCallbackFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'TodaysDental/RCS',
        },
      },
    }));

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
    this.rcsTemplatesTable.grantWriteData(this.sendMessageFn);

    // ========================================
    // RCS AUTO-REPLY (AI AGENTS)
    // ========================================
    // Asynchronously replies to inbound customer RCS messages using a Bedrock Agent
    // from the AiAgents stack (3-level prompt system with userPrompt customization).
    this.rcsAutoReplyFn = new lambdaNode.NodejsFunction(this, 'RcsAutoReplyFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'rcs-auto-reply.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(90),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
        RCS_SEND_MESSAGE_FUNCTION_ARN: this.sendMessageFn.functionArn,
        // AI Agents tables (passed from infra.ts)
        AI_AGENTS_TABLE: props.aiAgentsTableName || '',
        AI_AGENT_CONVERSATIONS_TABLE: props.aiAgentConversationsTableName || '',
        // Optional routing/config (set at deploy time)
        RCS_REPLY_ENABLED: process.env.RCS_REPLY_ENABLED || 'true',
        RCS_REPLY_AGENT_ID: process.env.RCS_REPLY_AGENT_ID || '',
        RCS_REPLY_AGENT_TAG: process.env.RCS_REPLY_AGENT_TAG || 'rcs',
        RCS_REPLY_AGENT_ID_MAP_JSON: process.env.RCS_REPLY_AGENT_ID_MAP_JSON || '',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.rcsAutoReplyFn, { Function: 'rcs-auto-reply' });

    // Allow the incoming webhook to invoke the auto-reply processor
    this.rcsAutoReplyFn.grantInvoke(this.incomingMessageFn);

    // Allow the auto-reply processor to send messages through the standard sender
    this.sendMessageFn.grantInvoke(this.rcsAutoReplyFn);

    // Auto-reply needs idempotency records in the unified table
    this.rcsTemplatesTable.grantReadWriteData(this.rcsAutoReplyFn);

    // Bedrock Agent invocation permissions
    this.rcsAutoReplyFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // AI Agents DynamoDB permissions (read agent config + write conversation logs)
    // Prefer ARNs if provided to include index ARNs.
    if (props.aiAgentsTableName || props.aiAgentsTableArn) {
      const agentsTableArn =
        props.aiAgentsTableArn ||
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.aiAgentsTableName}`;
      const agentsTable = dynamodb.Table.fromTableArn(this, 'ImportedAiAgentsTableForRcs', agentsTableArn);
      agentsTable.grantReadData(this.rcsAutoReplyFn);
    }

    if (props.aiAgentConversationsTableName || props.aiAgentConversationsTableArn) {
      const convTableArn =
        props.aiAgentConversationsTableArn ||
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.aiAgentConversationsTableName}`;
      const convTable = dynamodb.Table.fromTableArn(this, 'ImportedAiAgentConversationsForRcs', convTableArn);
      convTable.grantWriteData(this.rcsAutoReplyFn);
    }

    // Wire the auto-reply Lambda ARN into the incoming webhook env
    this.incomingMessageFn.addEnvironment('RCS_AUTO_REPLY_FUNCTION_ARN', this.rcsAutoReplyFn.functionArn);
    this.incomingMessageFn.addEnvironment('ENABLE_RCS_AUTO_REPLY', process.env.ENABLE_RCS_AUTO_REPLY || 'true');

    // ========================================
    // RCS AUTO-REPLY CONFIG API (Protected)
    // ========================================
    this.rcsAutoReplyConfigFn = new lambdaNode.NodejsFunction(this, 'RcsAutoReplyConfigFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'rcs-auto-reply-config.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
        AI_AGENTS_TABLE: props.aiAgentsTableName || '',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.rcsAutoReplyConfigFn, { Function: 'rcs-auto-reply-config' });
    this.rcsTemplatesTable.grantReadWriteData(this.rcsAutoReplyConfigFn);
    if (props.aiAgentsTableArn || props.aiAgentsTableName) {
      const agentsTableArn =
        props.aiAgentsTableArn ||
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.aiAgentsTableName}`;
      const agentsTable = dynamodb.Table.fromTableArn(this, 'ImportedAiAgentsTableForRcsConfig', agentsTableArn);
      agentsTable.grantReadData(this.rcsAutoReplyConfigFn);
    }

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
    this.rcsTemplatesTable.grantReadData(this.getMessagesFn);

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
        RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
      },
    });
    applyTags(smsFallbackProcessorFn, { Function: 'sms-fallback-processor' });
    
    // Grant DynamoDB permissions for storing fallback records
    this.rcsTemplatesTable.grantWriteData(smsFallbackProcessorFn);
    
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
    // RCS ANALYTICS FUNCTIONS
    // ========================================

    // Analytics API Handler - Provides real-time and historical analytics
    this.analyticsFn = new lambdaNode.NodejsFunction(this, 'RcsAnalyticsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
        RCS_TEMPLATES_TABLE: this.rcsTemplatesTable.tableName,
        RCS_ANALYTICS_TABLE: this.rcsAnalyticsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.analyticsFn, { Function: 'rcs-analytics' });
    
    // Grant read access to all tables for analytics queries
    this.rcsTemplatesTable.grantReadData(this.analyticsFn);
    this.rcsAnalyticsTable.grantReadWriteData(this.analyticsFn);
    
    // Grant CloudWatch metrics publishing
    this.analyticsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'TodaysDental/RCS',
        },
      },
    }));

    // Analytics Aggregator - Scheduled job for pre-computing metrics
    this.analyticsAggregatorFn = new lambdaNode.NodejsFunction(this, 'RcsAnalyticsAggregatorFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'analytics-aggregator.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024, // Higher memory for batch processing
      timeout: Duration.minutes(5),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_MESSAGES_TABLE: this.rcsTemplatesTable.tableName,
        RCS_ANALYTICS_TABLE: this.rcsAnalyticsTable.tableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.analyticsAggregatorFn, { Function: 'rcs-analytics-aggregator' });
    
    // Grant permissions to aggregator
    this.rcsTemplatesTable.grantReadData(this.analyticsAggregatorFn);
    this.rcsAnalyticsTable.grantReadWriteData(this.analyticsAggregatorFn);
    
    // Grant read access to clinic config table
    this.analyticsAggregatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}/index/*`,
      ],
    }));
    
    // Grant CloudWatch metrics publishing
    this.analyticsAggregatorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'TodaysDental/RCS',
        },
      },
    }));

    // Schedule aggregator to run every hour
    const analyticsAggregatorRule = new events.Rule(this, 'RcsAnalyticsAggregatorRule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      description: 'Hourly RCS analytics aggregation job',
    });
    analyticsAggregatorRule.addTarget(new targets.LambdaFunction(this.analyticsAggregatorFn));

    // Create alarms for analytics functions
    createLambdaErrorAlarm(this.analyticsFn, 'rcs-analytics');
    createLambdaThrottleAlarm(this.analyticsFn, 'rcs-analytics');
    createLambdaDurationAlarm(this.analyticsFn, 'rcs-analytics', Math.floor(Duration.seconds(30).toMilliseconds() * 0.8));
    
    createLambdaErrorAlarm(this.analyticsAggregatorFn, 'rcs-analytics-aggregator');
    createLambdaThrottleAlarm(this.analyticsAggregatorFn, 'rcs-analytics-aggregator');
    createLambdaDurationAlarm(this.analyticsAggregatorFn, 'rcs-analytics-aggregator', Math.floor(Duration.minutes(5).toMilliseconds() * 0.8));

    // Add DynamoDB throttle alarm for analytics table
    createDynamoThrottleAlarm(this.rcsAnalyticsTable.tableName, 'RcsAnalyticsTable');

    // ========================================
    // RCS AI HANDLER
    // ========================================
    // AI-powered RCS template generation using AWS Bedrock (Claude)
    this.rcsAiFn = new lambdaNode.NodejsFunction(this, 'RcsAiFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'rcs', 'rcs-ai-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(60), // AI generation can take longer
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        RCS_TEMPLATES_TABLE: this.rcsTemplatesTable.tableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.rcsAiFn, { Function: 'rcs-ai' });

    // Grant Bedrock invoke permissions for Claude model
    this.rcsAiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
      ],
    }));

    // Grant read access to secrets and config tables for RCS sender lookup
    this.rcsAiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets'}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
      ],
    }));

    // Grant read/write to templates table for saving AI-generated templates
    this.rcsTemplatesTable.grantReadWriteData(this.rcsAiFn);

    // ========================================
    // SECRETS TABLES PERMISSIONS
    // ========================================
    // Grant read access to secrets tables for dynamic Twilio credential retrieval
    const globalSecretsTable = props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets';
    const clinicSecretsTable = props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets';
    const clinicConfigTable = props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig';

    const secretsReadPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${globalSecretsTable}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicSecretsTable}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTable}`,
      ],
    });

    this.incomingMessageFn.addToRolePolicy(secretsReadPolicy);
    this.fallbackMessageFn.addToRolePolicy(secretsReadPolicy);
    this.statusCallbackFn.addToRolePolicy(secretsReadPolicy);
    this.sendMessageFn.addToRolePolicy(secretsReadPolicy);
    this.getMessagesFn.addToRolePolicy(secretsReadPolicy);
    this.templatesFn.addToRolePolicy(secretsReadPolicy);
    this.rcsAiFn.addToRolePolicy(secretsReadPolicy);

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
      this.rcsAiFn.addToRolePolicy(kmsDecryptPolicy);
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
    // RCS AI API Routes (Protected)
    // ========================================
    
    // AI template generation endpoints
    const aiResource = clinicResource.addResource('ai');
    
    // POST /{clinicId}/ai/template - Generate AI-powered RCS template
    const aiTemplateResource = aiResource.addResource('template');
    aiTemplateResource.addMethod('POST', new apigw.LambdaIntegration(this.rcsAiFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /{clinicId}/ai/message-body - Generate AI-powered message body
    const aiMessageBodyResource = aiResource.addResource('message-body');
    aiMessageBodyResource.addMethod('POST', new apigw.LambdaIntegration(this.rcsAiFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET/PUT /{clinicId}/ai/auto-reply - Configure AI auto-replies for inbound RCS
    const aiAutoReplyResource = aiResource.addResource('auto-reply');
    aiAutoReplyResource.addMethod('GET', new apigw.LambdaIntegration(this.rcsAutoReplyConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    aiAutoReplyResource.addMethod('PUT', new apigw.LambdaIntegration(this.rcsAutoReplyConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/config - Check RCS sender configuration status
    const configResource = clinicResource.addResource('config');
    configResource.addMethod('GET', new apigw.LambdaIntegration(this.rcsAiFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ========================================
    // RCS Analytics API Routes (Protected)
    // ========================================

    // Base analytics resource
    const analyticsResource = clinicResource.addResource('analytics');

    // GET /{clinicId}/analytics/summary - Get analytics summary
    const analyticsSummaryResource = analyticsResource.addResource('summary');
    analyticsSummaryResource.addMethod('GET', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/analytics/timeseries - Get time series data
    const analyticsTimeseriesResource = analyticsResource.addResource('timeseries');
    analyticsTimeseriesResource.addMethod('GET', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/analytics/templates - Template performance metrics
    const analyticsTemplatesResource = analyticsResource.addResource('templates');
    analyticsTemplatesResource.addMethod('GET', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/analytics/delivery-rates - Delivery rate breakdown
    const analyticsDeliveryResource = analyticsResource.addResource('delivery-rates');
    analyticsDeliveryResource.addMethod('GET', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /{clinicId}/analytics/engagement - Engagement metrics
    const analyticsEngagementResource = analyticsResource.addResource('engagement');
    analyticsEngagementResource.addMethod('GET', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /{clinicId}/analytics/export - Export analytics data
    const analyticsExportResource = analyticsResource.addResource('export');
    analyticsExportResource.addMethod('POST', new apigw.LambdaIntegration(this.analyticsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ========================================
    // CloudWatch Alarms (Core Functions)
    // ========================================
    [
      { fn: this.incomingMessageFn, name: 'rcs-incoming', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.fallbackMessageFn, name: 'rcs-fallback', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.statusCallbackFn, name: 'rcs-status', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.sendMessageFn, name: 'rcs-send', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.rcsAutoReplyFn, name: 'rcs-auto-reply', durationMs: Math.floor(Duration.seconds(90).toMilliseconds() * 0.8) },
      { fn: this.rcsAutoReplyConfigFn, name: 'rcs-auto-reply-config', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.getMessagesFn, name: 'rcs-get', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.templatesFn, name: 'rcs-templates', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.rcsAiFn, name: 'rcs-ai', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.rcsTemplatesTable.tableName, 'RcsTemplatesTable');

    // ========================================
    // Custom CloudWatch Metrics Dashboard
    // ========================================

    // Create CloudWatch Dashboard for RCS Messaging
    const rcsDashboard = new cloudwatch.Dashboard(this, 'RcsDashboard', {
      dashboardName: `${this.stackName}-RCS-Analytics`,
    });

    // Add delivery metrics widget
    rcsDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RCS Message Delivery',
        left: [
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'MessagesSent',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'MessagesDelivered',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'MessagesFailed',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'RCS Engagement Rates',
        left: [
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'DeliveryRate',
            statistic: 'Average',
            period: Duration.hours(1),
          }),
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'ReadRate',
            statistic: 'Average',
            period: Duration.hours(1),
          }),
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'EngagementRate',
            statistic: 'Average',
            period: Duration.hours(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
    );

    // Add read receipts and response time widgets
    rcsDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Message Read Receipts',
        left: [
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'MessagesRead',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Avg Response Time',
        left: [
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'AvgResponseTime',
            statistic: 'Average',
            period: Duration.hours(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'SMS Fallback Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'TodaysDental/RCS',
            metricName: 'SmsFallbackCount',
            statistic: 'Sum',
            period: Duration.hours(1),
          }),
        ],
        width: 8,
        height: 6,
      }),
    );

    // Add Lambda performance widgets
    rcsDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          this.sendMessageFn.metricInvocations({ period: Duration.minutes(5) }),
          this.incomingMessageFn.metricInvocations({ period: Duration.minutes(5) }),
          this.statusCallbackFn.metricInvocations({ period: Duration.minutes(5) }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          this.sendMessageFn.metricErrors({ period: Duration.minutes(5) }),
          this.incomingMessageFn.metricErrors({ period: Duration.minutes(5) }),
          this.statusCallbackFn.metricErrors({ period: Duration.minutes(5) }),
        ],
        width: 12,
        height: 6,
      }),
    );

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

    // Allow other stacks (e.g. Schedules) to invoke the RCS send message Lambda directly (no API Gateway/auth required)
    new CfnOutput(this, 'RcsSendMessageFnArn', {
      value: this.sendMessageFn.functionArn,
      description: 'ARN of the RCS Send Message Lambda (internal invocation)',
      exportName: `${Stack.of(this).stackName}-RcsSendMessageFnArn`,
    });

    new CfnOutput(this, 'RcsMessagesTableName', {
      value: this.rcsTemplatesTable.tableName,
      description: 'RCS Messages DynamoDB Table Name (stored in the unified RCS templates table)',
      exportName: `${Stack.of(this).stackName}-RcsMessagesTableName`,
    });

    new CfnOutput(this, 'RcsTemplatesTableName', {
      value: this.rcsTemplatesTable.tableName,
      description: 'RCS Templates DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-RcsTemplatesTableName`,
    });

    new CfnOutput(this, 'RcsAnalyticsTableName', {
      value: this.rcsAnalyticsTable.tableName,
      description: 'RCS Analytics DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-RcsAnalyticsTableName`,
    });

    new CfnOutput(this, 'RcsAnalyticsTopicArn', {
      value: this.rcsAnalyticsTopic.topicArn,
      description: 'SNS Topic ARN for RCS Analytics events',
      exportName: `${Stack.of(this).stackName}-RcsAnalyticsTopicArn`,
    });

    new CfnOutput(this, 'RcsDashboardName', {
      value: `${this.stackName}-RCS-Analytics`,
      description: 'CloudWatch Dashboard name for RCS metrics',
    });

    new CfnOutput(this, 'RcsAnalyticsApiEndpoints', {
      value: JSON.stringify({
        summary: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/summary',
        timeseries: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/timeseries',
        templates: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/templates',
        deliveryRates: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/delivery-rates',
        engagement: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/engagement',
        export: 'https://apig.todaysdentalinsights.com/rcs/{clinicId}/analytics/export',
      }),
      description: 'RCS Analytics API endpoint URLs',
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

