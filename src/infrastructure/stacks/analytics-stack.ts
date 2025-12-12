import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { KinesisEventSource, SqsEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as quicksight from 'aws-cdk-lib/aws-quicksight';
import * as apigw from 'aws-cdk-lib/aws-apigateway';

export interface AnalyticsStackProps extends StackProps {
  jwtSecret: string;
  region: string;
  /**
   * Name of the ChimeStack for deriving table names.
   * Table names will be constructed as: ${chimeStackName}-TableSuffix
   * Required for cross-stack references when AnalyticsStack is created before ChimeStack.
   * 
   * IMPORTANT: This must match the exact stack name used for ChimeStack instantiation.
   * If ChimeStack naming convention changes, update this or provide explicit table names.
   */
  chimeStackName: string;
  /**
   * @deprecated Use ChimeStack's stream processor instead.
   * The CallQueue stream processor is now created in ChimeStack, not AnalyticsStack.
   * This prop is kept for backward compatibility but is ignored.
   */
  callQueueTableStreamArn?: string;
  /**
   * Explicit CallQueue table name. If not provided, derived as: ${chimeStackName}-CallQueueV2
   * RECOMMENDED: Pass explicit table name from ChimeStack to avoid derivation fragility.
   */
  callQueueTableName?: string;
  /**
   * Email addresses to receive critical alert notifications
   */
  supervisorEmails?: string[];
  /**
   * Explicit AgentPresence table name. If not provided, derived as: ${chimeStackName}-AgentPresence
   * RECOMMENDED: Pass explicit table name from ChimeStack to avoid derivation fragility.
   */
  agentPresenceTableName?: string;
  /**
   * Explicit AgentPerformance table name. If not provided, derived as: ${chimeStackName}-AgentPerformance
   * RECOMMENDED: Pass explicit table name from ChimeStack to avoid derivation fragility.
   */
  agentPerformanceTableName?: string;
  /**
   * Name of the transcript buffer table.
   * Defaults to ${stackName}-TranscriptBuffersV2
   */
  transcriptBufferTableName?: string;
  
  // ========================================
  // VOICE AI INTEGRATION (from AiAgentsStack)
  // ========================================
  // CRITICAL: Name and ARN must be provided together for proper integration.
  // If only name is provided without ARN, IAM permissions will fail silently.
  
  /**
   * Voice Sessions table name from AiAgentsStack for AI call session tracking.
   * Required for correlating AI voice call sessions with analytics.
   * MUST be provided together with voiceSessionsTableArn.
   */
  voiceSessionsTableName?: string;
  
  /**
   * Voice Sessions table ARN for IAM permissions.
   * MUST be provided together with voiceSessionsTableName.
   */
  voiceSessionsTableArn?: string;
  
  /**
   * AI Agents table name from AiAgentsStack.
   * Used to validate and enrich AI agent information in analytics.
   * MUST be provided together with aiAgentsTableArn.
   */
  aiAgentsTableName?: string;
  
  /**
   * AI Agents table ARN for IAM permissions.
   * MUST be provided together with aiAgentsTableName.
   */
  aiAgentsTableArn?: string;
}

export class AnalyticsStack extends Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly analyticsDedupTable: dynamodb.Table;
  public readonly transcriptBufferTable: dynamodb.Table;
  public readonly callAlertsTopic: sns.Topic;
  public readonly medicalVocabularyName: string;
  
  // Derived table names from ChimeStack for cross-stack references
  public readonly derivedCallQueueTableName: string;
  public readonly derivedAgentPresenceTableName: string;
  public readonly derivedAgentPerformanceTableName: string;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    // ========================================
    // Stack-wide tagging helpers
    // ========================================
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Analytics',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    // ========================================
    // Alarm helpers
    // ========================================
    const createLambdaErrorAlarm = (fn: lambda.IFunction, displayName: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${displayName} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, displayName: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${displayName} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaDurationAlarm = (fn: lambda.IFunction, displayName: string, thresholdMs: number) => {
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: Duration.minutes(5),
        }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${displayName} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) => {
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
    };
    
    // ========================================
    // CRITICAL FIX: Derive and Validate ChimeStack Table Names
    // ========================================
    // This allows AnalyticsStack to reference ChimeStack tables even when created before ChimeStack.
    // WARNING: These names must match the naming convention in ChimeStack exactly.
    // If ChimeStack changes its table naming, these derivations must be updated.
    // RECOMMENDED: Pass explicit table names via props instead of relying on derivation.
    
    if (!props.chimeStackName) {
      throw new Error('chimeStackName is required for AnalyticsStack to derive ChimeStack table names');
    }
    
    // Validate chimeStackName format (should match CDK stack naming conventions)
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(props.chimeStackName)) {
      throw new Error(`Invalid chimeStackName format: ${props.chimeStackName}. Must start with letter and contain only alphanumeric characters and hyphens.`);
    }
    
    // ========================================
    // VOICE AI INTEGRATION VALIDATION
    // ========================================
    // CRITICAL FIX: Validate that name and ARN are provided together
    // This prevents silent failures where Lambda has env var but no IAM permissions
    
    if (props.voiceSessionsTableName && !props.voiceSessionsTableArn) {
      throw new Error(
        '[AnalyticsStack] CONFIGURATION ERROR: voiceSessionsTableName is provided but voiceSessionsTableArn is missing. ' +
        'Both must be provided together for proper IAM permissions.'
      );
    }
    if (props.voiceSessionsTableArn && !props.voiceSessionsTableName) {
      throw new Error(
        '[AnalyticsStack] CONFIGURATION ERROR: voiceSessionsTableArn is provided but voiceSessionsTableName is missing. ' +
        'Both must be provided together for environment variable configuration.'
      );
    }
    
    if (props.aiAgentsTableName && !props.aiAgentsTableArn) {
      throw new Error(
        '[AnalyticsStack] CONFIGURATION ERROR: aiAgentsTableName is provided but aiAgentsTableArn is missing. ' +
        'Both must be provided together for proper IAM permissions.'
      );
    }
    if (props.aiAgentsTableArn && !props.aiAgentsTableName) {
      throw new Error(
        '[AnalyticsStack] CONFIGURATION ERROR: aiAgentsTableArn is provided but aiAgentsTableName is missing. ' +
        'Both must be provided together for environment variable configuration.'
      );
    }
    
    // Log Voice AI integration status
    const voiceAiEnabled = !!(props.voiceSessionsTableName && props.voiceSessionsTableArn);
    console.log(`[AnalyticsStack] Voice AI integration: ${voiceAiEnabled ? 'ENABLED' : 'DISABLED'}`);
    
    // Use explicit table names if provided, otherwise derive from chimeStackName
    // CRITICAL FIX #1: Validate derived table names and provide clear error messages
    // CRITICAL FIX #1.1: Enforce explicit table names in production to prevent silent failures
    // NOTE: CDK_DEFAULT_ACCOUNT is always set by CDK CLI, so don't use it for production detection
    // Use explicit NODE_ENV=production or ENFORCE_EXPLICIT_TABLE_NAMES=true instead
    const isProduction = process.env.NODE_ENV === 'production' || 
                         process.env.ENFORCE_EXPLICIT_TABLE_NAMES === 'true';
    
    if (!props.callQueueTableName || !props.agentPresenceTableName || !props.agentPerformanceTableName) {
      const missingTables = [
        !props.callQueueTableName && 'callQueueTableName',
        !props.agentPresenceTableName && 'agentPresenceTableName', 
        !props.agentPerformanceTableName && 'agentPerformanceTableName'
      ].filter(Boolean);
      
      const warningMsg = `[AnalyticsStack] WARNING: Using derived table names for: ${missingTables.join(', ')}. ` +
        'This is fragile - pass explicit table names from infra.ts constants.';
      
      console.warn(warningMsg);
      
      // In production, require explicit table names to prevent silent failures
      if (isProduction && process.env.ALLOW_DERIVED_TABLE_NAMES !== 'true') {
        throw new Error(
          `[AnalyticsStack] CRITICAL: Production deployments must provide explicit table names. ` +
          `Missing: ${missingTables.join(', ')}. ` +
          `Set ALLOW_DERIVED_TABLE_NAMES=true to override (not recommended).`
        );
      }
    }
    
    this.derivedCallQueueTableName = props.callQueueTableName || `${props.chimeStackName}-CallQueueV2`;
    this.derivedAgentPresenceTableName = props.agentPresenceTableName || `${props.chimeStackName}-AgentPresence`;
    this.derivedAgentPerformanceTableName = props.agentPerformanceTableName || `${props.chimeStackName}-AgentPerformance`;
    
    // CRITICAL FIX #1.1: Log derived table names at INFO level for debugging
    console.info('[AnalyticsStack] Table configuration:', {
      callQueueTable: this.derivedCallQueueTableName,
      agentPresenceTable: this.derivedAgentPresenceTableName,
      agentPerformanceTable: this.derivedAgentPerformanceTableName,
      source: props.callQueueTableName ? 'EXPLICIT' : 'DERIVED',
      isProduction
    });
    
    // CRITICAL FIX #1: Store expected table name patterns for runtime validation
    // Lambdas can use these to detect misconfiguration early
    const tableNameValidationHints = {
      expectedCallQueuePattern: `${props.chimeStackName}-CallQueue*`,
      expectedAgentPresencePattern: `${props.chimeStackName}-AgentPresence*`,
      expectedAgentPerformancePattern: `${props.chimeStackName}-AgentPerformance*`,
      chimeStackName: props.chimeStackName,
    };
    console.log('[AnalyticsStack] Table name validation hints:', tableNameValidationHints);
    
    // Log derived table names for debugging during synth
    console.log('[AnalyticsStack] ChimeStack table names:', {
      callQueueTable: this.derivedCallQueueTableName,
      agentPresenceTable: this.derivedAgentPresenceTableName,
      agentPerformanceTable: this.derivedAgentPerformanceTableName,
      source: props.callQueueTableName ? 'explicit props' : 'derived from chimeStackName',
    });

    // ========================================
    // 1. Analytics DynamoDB Table
    // ========================================

    this.analyticsTable = new dynamodb.Table(this, 'CallAnalyticsTable', {
      tableName: `${this.stackName}-CallAnalyticsN1`,
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for real-time coaching
    });
    applyTags(this.analyticsTable, { Table: 'analytics' });

    // GSI: Query by clinic and date range
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-timestamp-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by agent performance
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'agentId-timestamp-index',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by sentiment
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'overallSentiment-timestamp-index',
      partitionKey: { name: 'overallSentiment', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // CRITICAL FIX: GSI for querying active/completed calls (live vs post-call analytics)
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'callStatus-timestamp-index',
      partitionKey: { name: 'callStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by call category
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'callCategory-timestamp-index',
      partitionKey: { name: 'callCategory', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by clinic and call category for filtered analytics
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-callCategory-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'callCategory', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query for finalization jobs (FIX #1: Efficient finalization scanning)
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'analyticsState-finalizationScheduledAt-index',
      partitionKey: { name: 'analyticsState', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'finalizationScheduledAt', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY, // Only need callId and timestamp
    });

    // ========================================
    // AI VOICE CALL ANALYTICS GSIs
    // ========================================
    // These GSIs support Voice AI call tracking from AiAgentsStack
    
    // GSI: Query by AI call type (inbound_after_hours, outbound_scheduled, ai_transfer)
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'aiCallType-timestamp-index',
      partitionKey: { name: 'aiCallType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by AI agent ID for performance tracking
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'aiAgentId-timestamp-index',
      partitionKey: { name: 'aiAgentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query by AI resolution outcome (resolved, transferred_to_human, voicemail, callback_scheduled)
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'aiResolutionOutcome-timestamp-index',
      partitionKey: { name: 'aiResolutionOutcome', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Query AI calls by clinic for AI-specific reporting
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-aiCallType-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'aiCallType', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Permanent failures table for DLQ triage visibility
    const analyticsFailuresTable = new dynamodb.Table(this, 'AnalyticsFailuresTable', {
      tableName: `${this.stackName}-AnalyticsFailuresV2`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(analyticsFailuresTable, { Table: 'analytics-failures' });

    // Deduplication table for preventing duplicate analytics processing
    this.analyticsDedupTable = new dynamodb.Table(this, 'AnalyticsDedupTable', {
      tableName: `${this.stackName}-CallAnalytics-dedupV2`,
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup after 7 days
    });
    applyTags(this.analyticsDedupTable, { Table: 'analytics-dedup' });

    // **NEW: Transcript Buffer table for persistent transcript storage**
    // CRITICAL FIX: Expose as public property so it can be referenced by other stacks/lambdas
    this.transcriptBufferTable = new dynamodb.Table(this, 'TranscriptBufferTable', {
      tableName: props.transcriptBufferTableName || `${this.stackName}-TranscriptBuffersV2`,
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup after call ends
    });
    applyTags(this.transcriptBufferTable, { Table: 'transcript-buffer' });

    // **NEW: Agent Performance Failures table for permanent failure storage**
    const agentPerformanceFailuresTable = new dynamodb.Table(this, 'AgentPerformanceFailuresTable', {
      tableName: `${this.stackName}-AgentPerformanceFailuresV2`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Keep failures for 90 days
    });
    applyTags(agentPerformanceFailuresTable, { Table: 'agent-performance-failures' });


    // ========================================
    // 2.5. SNS Topics for Real-Time Alerts
    // ========================================

    // Topic for call quality issues, customer frustration, escalations
    this.callAlertsTopic = new sns.Topic(this, 'CallAlertsTopic', {
      topicName: `${this.stackName}-call-alerts`,
      displayName: 'Call Analytics Real-Time Alerts',
    });

    // Subscribe supervisor emails if provided
    if (props.supervisorEmails && props.supervisorEmails.length > 0) {
      props.supervisorEmails.forEach((email, index) => {
        this.callAlertsTopic.addSubscription(
          new snsSubscriptions.EmailSubscription(email)
        );
      });
    }

    // Topic for agent performance insights (daily digests)
    const performanceInsightsTopic = new sns.Topic(this, 'PerformanceInsightsTopic', {
      topicName: `${this.stackName}-performance-insights`,
      displayName: 'Agent Performance Insights',
    });

    // **NEW: Topic for agent performance tracking failures**
    const agentPerformanceAlertTopic = new sns.Topic(this, 'AgentPerformanceAlertTopic', {
      topicName: `${this.stackName}-agent-performance-alerts`,
      displayName: 'Agent Performance Tracking Failures',
    });

    // Subscribe supervisor emails to performance alerts
    if (props.supervisorEmails && props.supervisorEmails.length > 0) {
      props.supervisorEmails.forEach((email) => {
        agentPerformanceAlertTopic.addSubscription(
          new snsSubscriptions.EmailSubscription(email)
        );
      });
    }

    // **NEW: DLQ for agent performance tracking failures**
    const agentPerformanceDLQ = new sqs.Queue(this, 'AgentPerformanceDLQ', {
      queueName: `${this.stackName}-agent-performance-dlq`,
      retentionPeriod: Duration.days(14), // Keep failures for 14 days
      visibilityTimeout: Duration.minutes(5),
    });
    applyTags(agentPerformanceDLQ, { Queue: 'agent-performance-dlq' });

    // Create CloudWatch alarm for DLQ depth
    const dlqAlarm = new cloudwatch.Alarm(this, 'AgentPerformanceDLQAlarm', {
      metric: agentPerformanceDLQ.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      alarmName: `${this.stackName}-agent-performance-dlq-depth`,
      alarmDescription: 'Alert when agent performance DLQ has >10 messages',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Send alarm to SNS topic
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(agentPerformanceAlertTopic));

    // CRITICAL FIX: Add DLQ processor Lambda to handle failed agent performance tracking
    const dlqProcessorFn = new lambdaNode.NodejsFunction(this, 'AgentPerformanceDLQProcessor', {
      functionName: `${this.stackName}-AgentPerformanceDLQProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-agent-performance-dlq.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        AGENT_PERFORMANCE_TABLE_NAME: this.derivedAgentPerformanceTableName,
        AGENT_PERFORMANCE_FAILURES_TABLE_NAME: agentPerformanceFailuresTable.tableName,
        ALERT_TOPIC_ARN: agentPerformanceAlertTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(dlqProcessorFn, { Function: 'agent-performance-dlq-processor' });

    // Grant permissions to DLQ processor
    agentPerformanceFailuresTable.grantReadWriteData(dlqProcessorFn);
    agentPerformanceAlertTopic.grantPublish(dlqProcessorFn);
    
    // Grant permission to ChimeStack agent performance table
    dlqProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}`,
      ],
    }));

    // Add SQS event source to process DLQ messages
    dlqProcessorFn.addEventSource(new SqsEventSource(agentPerformanceDLQ, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(30),
    }));

    // ========================================
    // 2.6. Custom Vocabulary for Medical/Dental Terms
    // ========================================

    this.medicalVocabularyName = `${this.stackName}-dental-vocab`.substring(0, 200).replace(/[^a-zA-Z0-9-_]/g, '-');

    const medicalVocabularyRole = new iam.Role(this, 'MedicalVocabularyRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    medicalVocabularyRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:CreateVocabulary',
        'transcribe:DeleteVocabulary',
        'transcribe:GetVocabulary',
      ],
      resources: ['*'],
    }));

    // Create custom vocabulary using Custom Resource
    const medicalVocabulary = new customResources.AwsCustomResource(this, 'MedicalVocabulary', {
      onCreate: {
        service: 'Transcribe',
        action: 'createVocabulary',
        parameters: {
          LanguageCode: 'en-US',
          VocabularyName: this.medicalVocabularyName,
          Phrases: [
            // Common dental procedures
            'gingivectomy', 'apicoectomy', 'pulpotomy', 'pulpectomy',
            'crown lengthening', 'bone grafting', 'sinus lift',
            'ridge augmentation', 'socket preservation',
            // Dental materials
            'composite resin', 'porcelain fused to metal', 'zirconia',
            'lithium disilicate', 'CEREC', 'Invisalign',
            // Dental conditions
            'periodontitis', 'gingivitis', 'malocclusion', 'bruxism',
            'xerostomia', 'halitosis', 'TMJ disorder', 'TMD',
            'temporomandibular joint', 'occlusal disease',
            // Tooth notation
            'maxillary', 'mandibular', 'bicuspid', 'cuspid', 'molar',
            'premolar', 'incisor', 'canine',
            // Insurance terms
            'PPO', 'HMO', 'dental HMO', 'DMO', 'DHMO',
            'UCR', 'usual customary and reasonable',
            'coordination of benefits', 'COB', 'EOB',
            'explanation of benefits', 'pre-authorization', 'pre-auth',
            // Common brand names
            'Novocaine', 'Carbocaine', 'Septocaine', 'Lidocaine',
            'OralB', 'Sonicare', 'Waterpik',
            // Abbreviations
            'RCT', 'root canal therapy', 'SRP', 'scaling and root planing',
            'FMX', 'full mouth x-ray', 'BWX', 'bitewing x-ray',
            'PA', 'periapical', 'pano', 'panoramic x-ray',
          ],
        },
        physicalResourceId: customResources.PhysicalResourceId.of(this.medicalVocabularyName),
      },
      onDelete: {
        service: 'Transcribe',
        action: 'deleteVocabulary',
        parameters: {
          VocabularyName: this.medicalVocabularyName,
        },
        ignoreErrorCodesMatching: 'NotFoundException',
      },
      role: medicalVocabularyRole,
      timeout: Duration.minutes(5), // Vocabulary creation can take a few minutes
    });


    // ========================================
    // 5. CloudWatch Outputs
    // ========================================

    new CfnOutput(this, 'AnalyticsTableName', {
      value: this.analyticsTable.tableName,
      description: 'DynamoDB Analytics Table Name',
      exportName: `${this.stackName}-CallAnalyticsTableName`,
    });

    // CRITICAL FIX: Export table ARN for cross-stack IAM permissions
    new CfnOutput(this, 'AnalyticsTableArn', {
      value: this.analyticsTable.tableArn,
      description: 'DynamoDB Analytics Table ARN for cross-stack IAM policies',
      exportName: `${this.stackName}-CallAnalyticsTableArn`,
    });


    // ========================================
    // 5.5. CallQueue Stream Processor - REMOVED (DEAD CODE)
    // ========================================
    // NOTE: The CallQueue stream processor is now ONLY created in ChimeStack.
    // This prevents duplicate stream processors and confusion about which is authoritative.
    // 
    // The ChimeStack creates the stream processor when analyticsTableName/analyticsDedupTableName
    // are passed from infra.ts (see ChimeStack lines 1938-1992).
    //
    // DO NOT ADD a stream processor here - it will create duplicate processing.
    // If you need to modify stream processing, update ChimeStack.
    
    // Always export dedup table name for cross-stack references
    new CfnOutput(this, 'AnalyticsDedupTableName', {
      value: this.analyticsDedupTable.tableName,
      description: 'Deduplication table for analytics events',
      exportName: `${this.stackName}-AnalyticsDedupTableName`,
    });

    // ========================================
    // 6. Analytics Finalization Lambda
    // ========================================

    const finalizeAnalyticsFn = new lambdaNode.NodejsFunction(this, 'FinalizeAnalyticsFunction', {
      functionName: `${this.stackName}-FinalizeAnalytics`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'finalize-analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 512, // Increased for enhanced metrics processing
      environment: {
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        // CRITICAL FIX: Pass all required table names derived from ChimeStack
        AGENT_PERFORMANCE_TABLE_NAME: this.derivedAgentPerformanceTableName,
        AGENT_PRESENCE_TABLE_NAME: this.derivedAgentPresenceTableName,
        TRANSCRIPT_BUFFER_TABLE_NAME: this.transcriptBufferTable.tableName,
        // Voice AI integration tables from AiAgentsStack
        VOICE_SESSIONS_TABLE_NAME: props.voiceSessionsTableName || '',
        AI_AGENTS_TABLE_NAME: props.aiAgentsTableName || '',
        VOICE_AI_ENABLED: props.voiceSessionsTableName ? 'true' : 'false',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(finalizeAnalyticsFn, { Function: 'finalize-analytics' });

    // Grant permissions
    this.analyticsTable.grantReadWriteData(finalizeAnalyticsFn);
    this.transcriptBufferTable.grantReadWriteData(finalizeAnalyticsFn);

    // CRITICAL FIX: Grant permission to ChimeStack tables using derived names
    // These permissions are required for agent validation and metrics tracking
    finalizeAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
        'dynamodb:Query',
      ],
      resources: [
        // Agent Performance table
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}/index/*`,
        // Agent Presence table (for agent validation)
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPresenceTableName}`,
      ],
    }));

    // Grant permissions to Voice AI tables from AiAgentsStack (if provided)
    if (props.voiceSessionsTableArn) {
      finalizeAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
        ],
        resources: [
          props.voiceSessionsTableArn,
          `${props.voiceSessionsTableArn}/index/*`,
        ],
      }));
    }

    if (props.aiAgentsTableArn) {
      finalizeAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
        ],
        resources: [
          props.aiAgentsTableArn,
          `${props.aiAgentsTableArn}/index/*`,
        ],
      }));
    }

    // Schedule to run every minute
    const finalizationRule = new events.Rule(this, 'AnalyticsFinalizationRule', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      description: 'Finalize analytics records after buffer window',
    });

    finalizationRule.addTarget(new targets.LambdaFunction(finalizeAnalyticsFn));

    new CfnOutput(this, 'FinalizeAnalyticsFunctionArn', {
      value: finalizeAnalyticsFn.functionArn,
      description: 'Analytics Finalization Lambda ARN',
    });

    // ========================================
    // 6A. Reconciliation Job Lambda
    // ========================================
    // Runs daily to reconcile call analytics with agent performance metrics
    // Identifies discrepancies and sends alerts for critical issues

    // Create reconciliation table for storing daily reports
    const reconciliationTable = new dynamodb.Table(this, 'ReconciliationTable', {
      tableName: `${this.stackName}-ReconciliationV2`,
      partitionKey: { name: 'reportDate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'reportType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(reconciliationTable, { Table: 'reconciliation' });

    // Create SNS topic for reconciliation alerts
    const reconciliationAlertTopic = new sns.Topic(this, 'ReconciliationAlertTopic', {
      topicName: `${this.stackName}-ReconciliationAlerts`,
      displayName: 'Call Analytics Reconciliation Alerts',
    });

    // Subscribe supervisor emails to alerts if provided
    if (props.supervisorEmails && props.supervisorEmails.length > 0) {
      props.supervisorEmails.forEach((email, index) => {
        reconciliationAlertTopic.addSubscription(
          new snsSubscriptions.EmailSubscription(email)
        );
      });
    }

    const reconciliationJobFn = new lambdaNode.NodejsFunction(this, 'ReconciliationJobFunction', {
      functionName: `${this.stackName}-ReconciliationJob`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'reconciliation-job.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15), // Long-running job
      memorySize: 1024, // Need memory for large scans
      environment: {
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        // CRITICAL FIX: Use derived table names instead of optional props
        AGENT_PERFORMANCE_TABLE_NAME: this.derivedAgentPerformanceTableName,
        RECONCILIATION_TABLE_NAME: reconciliationTable.tableName,
        RECONCILIATION_ALERT_TOPIC_ARN: reconciliationAlertTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });
    applyTags(reconciliationJobFn, { Function: 'reconciliation-job' });

    // Grant permissions
    this.analyticsTable.grantReadData(reconciliationJobFn);
    reconciliationTable.grantReadWriteData(reconciliationJobFn);
    reconciliationAlertTopic.grantPublish(reconciliationJobFn);

    // CRITICAL FIX: Always grant permissions to derived ChimeStack tables
    reconciliationJobFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}/index/*`,
      ],
    }));

    // Schedule daily reconciliation at 2 AM UTC
    const reconciliationRule = new events.Rule(this, 'ReconciliationScheduleRule', {
      schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
      description: 'Daily reconciliation job for call analytics and agent performance',
    });

    reconciliationRule.addTarget(new targets.LambdaFunction(reconciliationJobFn));

    new CfnOutput(this, 'ReconciliationJobFunctionArn', {
      value: reconciliationJobFn.functionArn,
      description: 'Reconciliation job Lambda ARN',
    });

    new CfnOutput(this, 'ReconciliationAlertTopicArn', {
      value: reconciliationAlertTopic.topicArn,
      description: 'SNS topic for reconciliation alerts',
    });

    new CfnOutput(this, 'CallAlertsTopicArn', {
      value: this.callAlertsTopic.topicArn,
      description: 'SNS Topic for real-time call alerts',
    });

    new CfnOutput(this, 'PerformanceInsightsTopicArn', {
      value: performanceInsightsTopic.topicArn,
      description: 'SNS Topic for agent performance insights',
    });

    new CfnOutput(this, 'MedicalVocabularyName', {
      value: this.medicalVocabularyName,
      description: 'Custom vocabulary for medical/dental transcription',
    });

    // CRITICAL FIX: Export transcript buffer table name for cross-stack references
    new CfnOutput(this, 'TranscriptBufferTableName', {
      value: this.transcriptBufferTable.tableName,
      description: 'DynamoDB table for transcript buffers',
      exportName: `${this.stackName}-TranscriptBufferTableName`,
    });

    // Export derived table names for validation
    new CfnOutput(this, 'DerivedCallQueueTableName', {
      value: this.derivedCallQueueTableName,
      description: 'Derived CallQueue table name from ChimeStack',
    });

    new CfnOutput(this, 'DerivedAgentPresenceTableName', {
      value: this.derivedAgentPresenceTableName,
      description: 'Derived AgentPresence table name from ChimeStack',
    });

    new CfnOutput(this, 'DerivedAgentPerformanceTableName', {
      value: this.derivedAgentPerformanceTableName,
      description: 'Derived AgentPerformance table name from ChimeStack',
    });

    // ========================================
    // 7. QuickSight Data Source for Analytics
    // ========================================

    // Note: QuickSight requires AWS account to have QuickSight enabled
    // This creates the data source configuration for QuickSight dashboards
    
    // Create IAM role for QuickSight to access DynamoDB
    const quicksightRole = new iam.Role(this, 'QuickSightDataSourceRole', {
      assumedBy: new iam.ServicePrincipal('quicksight.amazonaws.com'),
      description: 'Allow QuickSight to read call analytics data',
    });

    this.analyticsTable.grantReadData(quicksightRole);

    // Output instructions for manual QuickSight setup
    new CfnOutput(this, 'QuickSightSetupInstructions', {
      value: `To create QuickSight dashboard:
1. Enable QuickSight in AWS Console
2. Create Data Source: DynamoDB table ${this.analyticsTable.tableName}
3. Use IAM Role: ${quicksightRole.roleArn}
4. Create Analysis with metrics: sentiment, callCategory, duration, audioQuality
5. Publish Dashboard`,
      description: 'Steps to create QuickSight analytics dashboard',
    });

    new CfnOutput(this, 'QuickSightRoleArn', {
      value: quicksightRole.roleArn,
      description: 'IAM Role ARN for QuickSight data source',
    });

    // ========================================
    // 7A. Analytics Reconciliation Job
    // ========================================
    // Runs periodically to fix orphaned calls (dedup records without analytics)
    // Fixes the race condition when errors occur during analytics processing

    // CRITICAL FIX: Use derived call queue table name from ChimeStack instead of hardcoded fallback
    const reconcileAnalyticsFn = new lambdaNode.NodejsFunction(this, 'ReconcileAnalyticsFunction', {
      functionName: `${this.stackName}-ReconcileAnalytics`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'reconcile-analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15), // Long-running job
      memorySize: 512,
      environment: {
        CALL_QUEUE_TABLE_NAME: this.derivedCallQueueTableName,
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        ANALYTICS_DEDUP_TABLE_NAME: this.analyticsDedupTable.tableName,
        // CRITICAL FIX #1.2: Pass all required table names for reconciliation
        AGENT_PERFORMANCE_TABLE_NAME: this.derivedAgentPerformanceTableName,
        TRANSCRIPT_BUFFER_TABLE_NAME: this.transcriptBufferTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.derivedAgentPresenceTableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(reconcileAnalyticsFn, { Function: 'reconcile-analytics' });

    // ========================================
    // CloudWatch Alarms (Lambda + DynamoDB)
    // ========================================
    const lambdaAlarmTargets: Array<{ fn: lambda.IFunction; name: string; durationMs: number }> = [
      { fn: dlqProcessorFn, name: 'agent-performance-dlq-processor', durationMs: Math.floor(Duration.minutes(5).toMilliseconds() * 0.8) },
      { fn: finalizeAnalyticsFn, name: 'finalize-analytics', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
      { fn: reconciliationJobFn, name: 'reconciliation-job', durationMs: Math.floor(Duration.minutes(15).toMilliseconds() * 0.8) },
      { fn: reconcileAnalyticsFn, name: 'reconcile-analytics', durationMs: Math.floor(Duration.minutes(15).toMilliseconds() * 0.8) },
    ];

    lambdaAlarmTargets.forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.analyticsTable.tableName, 'AnalyticsTable');
    createDynamoThrottleAlarm(this.analyticsDedupTable.tableName, 'AnalyticsDedupTable');
    createDynamoThrottleAlarm(this.transcriptBufferTable.tableName, 'TranscriptBufferTable');
    createDynamoThrottleAlarm(analyticsFailuresTable.tableName, 'AnalyticsFailuresTable');
    createDynamoThrottleAlarm(agentPerformanceFailuresTable.tableName, 'AgentPerformanceFailuresTable');
    createDynamoThrottleAlarm(reconciliationTable.tableName, 'ReconciliationTable');

    // Grant permissions
    // CRITICAL FIX #3: reconcileAnalyticsFn needs ReadWrite on analytics table
    // because it creates analytics records using PutCommand for orphaned calls
    this.analyticsTable.grantReadWriteData(reconcileAnalyticsFn);
    this.analyticsDedupTable.grantReadWriteData(reconcileAnalyticsFn);
    
    // CRITICAL FIX #1.2: Grant permission to transcript buffer table for orphan cleanup
    this.transcriptBufferTable.grantReadWriteData(reconcileAnalyticsFn);

    // Grant permission to read CallQueue and trigger reprocessing
    reconcileAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:Scan',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedCallQueueTableName}`,
      ],
    }));
    
    // CRITICAL FIX #1.2: Grant permission to AgentPerformance table for metrics tracking
    reconcileAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${this.derivedAgentPerformanceTableName}/index/*`,
      ],
    }));

    // Schedule to run every hour
    const analyticsReconciliationRule = new events.Rule(this, 'AnalyticsReconciliationRule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      description: 'Fix orphaned analytics records (dedup exists but analytics missing)',
    });

    analyticsReconciliationRule.addTarget(new targets.LambdaFunction(reconcileAnalyticsFn));

    new CfnOutput(this, 'ReconcileAnalyticsFunctionArn', {
      value: reconcileAnalyticsFn.functionArn,
      description: 'Analytics Reconciliation Lambda ARN',
    });

  }
}
