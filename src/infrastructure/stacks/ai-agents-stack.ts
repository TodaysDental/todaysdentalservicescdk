import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

/**
 * AI Agents Stack - AWS Bedrock Agents with Action Groups
 * 
 * Uses the managed Bedrock Agents service with:
 * - Action Groups for OpenDental API tools
 * - Knowledge Bases (optional)
 * - Built-in conversation memory
 * - Agent lifecycle: CREATE → PREPARE → READY
 * 
 * 3-Level Prompt System:
 * 1. System Prompt (constant) - Agent instruction in Bedrock
 * 2. Negative Prompt (constant) - Guardrails and restrictions
 * 3. User Prompt (customizable) - Additional frontend instructions
 */
export interface AiAgentsStackProps extends StackProps {
  // ========================================
  // CLINIC HOURS INTEGRATION (from ClinicHoursStack)
  // ========================================
  /**
   * Clinic hours table name from ClinicHoursStack.
   * REQUIRED for Voice AI to determine after-hours routing.
   */
  clinicHoursTableName: string;

  /**
   * Clinic hours table ARN from ClinicHoursStack for IAM permissions.
   * REQUIRED for Voice AI Lambda to read clinic hours.
   */
  clinicHoursTableArn: string;

  clinicPricingTableName?: string;
  clinicInsuranceTableName?: string;

  // ========================================
  // PATIENT PORTAL APPT TYPES INTEGRATION (from PatientPortalApptTypesStack)
  // ========================================
  /**
   * Appointment types table name from PatientPortalApptTypesStack.
   * Used by Action Group Lambda to look up appointment types when booking.
   * Table schema: clinicId (PK), label (SK)
   */
  apptTypesTableName?: string;

  /**
   * Appointment types table ARN for IAM permissions.
   */
  apptTypesTableArn?: string;

  // ========================================
  // CHIME STACK INTEGRATION (REQUIRED)
  // ========================================
  // These props MUST be passed from ChimeStack to avoid hardcoded imports
  // and circular dependencies. Do not rely on default stack names.

  /**
   * Clinics table name from ChimeStack.
   * REQUIRED for outbound calls to look up clinic SIP configuration.
   */
  clinicsTableName: string;

  /**
   * Clinics table ARN from ChimeStack for IAM permissions.
   * REQUIRED for outbound call Lambda to read clinic data.
   */
  clinicsTableArn?: string;

  /**
   * SSM Parameter name containing the SMA ID Map JSON.
   * The Lambda will read the value from SSM at runtime.
   * Maps clinicId -> SIP Media Application ID.
   * REQUIRED for initiating outbound calls via the correct SMA.
   */
  smaIdMapParameterName: string;

  /**
   * ChimeStack name for additional dynamic imports if needed.
   * Optional - prefer explicit props over dynamic imports.
   */
  chimeStackName?: string;

  /**
   * Call queue table name from ChimeStack.
   * REQUIRED for meeting join handler to manage call queue.
   */
  callQueueTableName?: string;

  /**
   * Agent presence table name from ChimeStack.
   * REQUIRED for meeting join handler to check agent status.
   */
  agentPresenceTableName?: string;

  /**
   * Agent performance table name from ChimeStack.
   * Optional - for tracking agent metrics.
   */
  agentPerformanceTableName?: string;

  /**
   * SSM Parameter name containing the Media Insights Pipeline Configuration ARN.
   * REQUIRED for real-time transcription of calls using Chime SDK Meetings.
   * Example: '/{StackName}/MediaInsightsPipelineConfigArn'
   */
  mediaInsightsPipelineParameter?: string;

  /**
   * Medical/dental vocabulary name for Transcribe.
   * Improves transcription accuracy for dental terminology.
   */
  medicalVocabularyName?: string;

  /**
   * Bedrock Agent ID for AI conversation.
   * Used by transcription handler to invoke the AI.
   */
  bedrockAgentId?: string;

  /**
   * Bedrock Agent Alias ID.
   * Defaults to 'TSTALIASID' if not specified.
   */
  bedrockAgentAliasId?: string;

  // ========================================
  // AMAZON CONNECT AI CALL INTEGRATION
  // ========================================
  /** Amazon Connect instance ID for AI outbound calls */
  connectInstanceId?: string;
  /** Outbound contact flow ID for AI calls (from ConnectLexAiStack) */
  outboundContactFlowId?: string;

  /**
   * Kinesis stream name for AI transcript analytics.
   */
  aiTranscriptStreamName?: string;

  /**
   * Kinesis stream ARN for AI transcript analytics.
   */
  aiTranscriptStreamArn?: string;

  // ========================================
  // SECRETS STACK INTEGRATION (from SecretsStack)
  // ========================================
  /**
   * KMS Key ARN used to encrypt secrets tables (ClinicSecrets/GlobalSecrets/ClinicConfig).
   *
   * Required if this stack reads from KMS-encrypted secrets tables (e.g. ActionGroupFn reads ClinicSecrets).
   */
  secretsEncryptionKeyArn?: string;

  // ========================================
  // UNIFIED ANALYTICS INTEGRATION (REQUIRED)
  // ========================================
  // CRITICAL: Use the shared CallAnalytics table from AnalyticsStack to avoid
  // data fragmentation. The AnalyticsStack table (CallAnalyticsN1) uses callId/timestamp
  // schema which aligns with Chime stream processor and reconciliation jobs.

  /**
   * Name of the shared CallAnalytics table from AnalyticsStack.
   * Schema: PK=callId (String), SK=timestamp (Number)
   * REQUIRED for unified call analytics. If not provided, Voice AI analytics will be disabled.
   */
  callAnalyticsTableName?: string;

  /**
   * ARN of the shared CallAnalytics table for IAM permissions.
   * MUST be provided if callAnalyticsTableName is provided.
   */
  callAnalyticsTableArn?: string;

  /**
   * AnalyticsStack name for deriving import names.
   * Optional - prefer explicit props (callAnalyticsTableName/Arn) over dynamic imports.
   */
  analyticsStackName?: string;

  // ========================================
  // SHARED RECORDINGS BUCKET (from ChimeStack)
  // ========================================
  // CRITICAL: Use the shared recordings bucket from ChimeStack to avoid
  // data fragmentation between AI calls and human calls.

  /**
   * Shared recordings bucket name from ChimeStack.
   * If provided, AiAgentsStack will NOT create its own recordings bucket.
   * RECOMMENDED: Always pass this to have unified call recordings.
   */
  sharedRecordingsBucketName?: string;

  /**
   * Shared recordings bucket ARN for IAM permissions.
   * MUST be provided together with sharedRecordingsBucketName.
   */
  sharedRecordingsBucketArn?: string;

  // ========================================
  // HOLD MUSIC / TTS AUDIO BUCKET (from ChimeStack)
  // ========================================
  /**
   * Hold music bucket name from ChimeStack.
   * Used for streaming TTS audio files that are played via PlayAudio actions.
   * REQUIRED for streaming TTS to work properly.
   */
  holdMusicBucketName?: string;

  /**
   * Hold music bucket ARN for IAM permissions.
   * MUST be provided together with holdMusicBucketName for S3 write access.
   */
  holdMusicBucketArn?: string;

  // ========================================
  // WEBSOCKET DOMAIN (from ChatbotStack)
  // ========================================
  /**
   * WebSocket domain name from ChatbotStack (ws.todaysdentalinsights.com).
   * REQUIRED for adding the /ai-agents API mapping to the shared domain.
   */
  webSocketDomainName: string;

  /**
   * Regional domain name for the WebSocket domain (d-xxx.execute-api.region.amazonaws.com).
   * REQUIRED for importing the domain as an L2 construct.
   */
  webSocketRegionalDomainName: string;

  /**
   * Regional hosted zone ID for the WebSocket domain.
   * REQUIRED for importing the domain as an L2 construct.
   */
  webSocketRegionalHostedZoneId: string;
}

export class AiAgentsStack extends Stack {
  public readonly agentsTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly voiceSessionsTable: dynamodb.Table;
  /**
   * Imported clinic hours table from ClinicHoursStack.
   * NOT created here - uses the shared table to avoid data duplication.
   */
  public readonly clinicHoursTable: dynamodb.ITable;
  public readonly voiceConfigTable: dynamodb.Table;
  public readonly scheduledCallsTable: dynamodb.Table;
  /**
   * Bulk outbound jobs table - tracks progress of large-scale call scheduling jobs.
   * Supports scheduling 30,000+ calls with progress tracking and status updates.
   */
  public readonly bulkOutboundJobsTable: dynamodb.Table;
  /**
   * SQS queue for async processing of bulk outbound call batches.
   * Enables high-volume scheduling without Lambda timeout issues.
   */
  public readonly outboundCallQueue: sqs.Queue;
  public readonly circuitBreakerTable: dynamodb.Table;
  /**
   * AI Agents Metrics table - aggregated daily metrics for AI agent performance.
   * Tracks: appointmentsBooked, appointmentsUsed, appointmentsCancelled, appointmentsRescheduled, billsPaid.
   * Schema: PK=clinicId, SK=metricDate (YYYY-MM-DD format, UTC).
   * Used for ROI analysis of AI agent scheduling efficiency and billing conversion.
   */
  public readonly aiAgentsMetricsTable: dynamodb.Table;
  /**
   * Reference to the shared CallAnalytics table from AnalyticsStack.
   * This avoids data fragmentation between AI-written records and Chime stream records.
   * Will be undefined if callAnalyticsTableName was not provided.
   */
  public readonly callAnalyticsTableName?: string;
  /**
   * Call recordings bucket. Either the shared bucket from ChimeStack
   * or a dedicated bucket if no shared bucket was provided.
   */
  public readonly callRecordingsBucket: s3.IBucket;
  /**
   * S3 bucket for temporary storage of insurance card images during Textract processing.
   * Images are automatically deleted after processing via lifecycle rules.
   */
  public readonly insuranceImageBucket: s3.Bucket;
  public readonly insuranceTextractFn: lambdaNode.NodejsFunction;
  public readonly agentsFn: lambdaNode.NodejsFunction;
  public readonly invokeAgentFn: lambdaNode.NodejsFunction;
  public readonly actionGroupFn: lambdaNode.NodejsFunction;
  public readonly wsConnectFn: lambdaNode.NodejsFunction;
  public readonly wsDisconnectFn: lambdaNode.NodejsFunction;
  public readonly wsMessageFn: lambdaNode.NodejsFunction;
  public readonly voiceAiFn: lambdaNode.NodejsFunction;
  public readonly voiceConfigFn: lambdaNode.NodejsFunction;
  public readonly conversationHistoryFn: lambdaNode.NodejsFunction;
  public readonly outboundSchedulerFn: lambdaNode.NodejsFunction;
  public readonly outboundExecutorFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly websocketApi: apigwv2.WebSocketApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly bedrockAgentRole: iam.Role;
  public readonly schedulerRole: iam.Role;

  constructor(scope: Construct, id: string, props: AiAgentsStackProps) {
    super(scope, id, props);

    // ========================================
    // REQUIRED PROPS VALIDATION
    // ========================================
    // Validate all required props upfront to fail fast with clear error messages

    if (!props.clinicsTableName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: clinicsTableName is REQUIRED. ' +
        'This must be passed from ChimeStack for outbound calls to look up clinic SIP configuration.'
      );
    }

    if (!props.smaIdMapParameterName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: smaIdMapParameterName is REQUIRED. ' +
        'This SSM Parameter contains the SIP Media Application ID mapping for initiating outbound calls.'
      );
    }

    // Validate SSM parameter name format (must start with /)
    if (!props.smaIdMapParameterName.startsWith('/')) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: smaIdMapParameterName must start with "/" ' +
        `(e.g., "/ai-agents/sma-id-map"). Received: "${props.smaIdMapParameterName}"`
      );
    }

    if (!props.webSocketDomainName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: webSocketDomainName is REQUIRED. ' +
        'This must be passed from ChatbotStack for the /ai-agents API mapping on the shared WebSocket domain.'
      );
    }

    if (!props.webSocketRegionalDomainName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: webSocketRegionalDomainName is REQUIRED. ' +
        'This is the regional domain name (d-xxx.execute-api.region.amazonaws.com) for importing the WebSocket domain.'
      );
    }

    if (!props.webSocketRegionalHostedZoneId) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: webSocketRegionalHostedZoneId is REQUIRED. ' +
        'This is the regional hosted zone ID for importing the WebSocket domain.'
      );
    }

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'AIAgents',
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
    // DYNAMODB TABLE
    // ========================================

    // AI Agents Table - stores agent metadata & Bedrock agent IDs
    // NOTE: Using new construct ID and table name suffix to force recreation after table was deleted outside CloudFormation
    this.agentsTable = new dynamodb.Table(this, 'AiAgentTable', {
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-AiAgent`,
      pointInTimeRecovery: true,
    });
    applyTags(this.agentsTable, { Table: 'ai-agents' });

    // Add GSI for clinic-based queries
    this.agentsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // AI Agent Sessions Table - stores chat sessions with user binding
    // SECURITY FIX: Sessions are now stored in DynamoDB (not in-memory) with user binding
    // to prevent session hijacking across Lambda instances
    this.sessionsTable = new dynamodb.Table(this, 'AiAgentSessionsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Sessions are ephemeral
      tableName: `${this.stackName}-AiAgentSessions`,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.sessionsTable, { Table: 'ai-agent-sessions' });

    // Add GSI for user-based session lookup
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // CONVERSATIONS TABLE - Stores all AI Agent chat messages
    // ========================================
    // This table stores complete conversation history for:
    // - Audit/compliance: See who chatted with which agent
    // - Analytics: Track usage patterns, response times, etc.
    // - Debugging: Review what the agent said
    // - Training: Analyze conversation quality
    this.conversationsTable = new dynamodb.Table(this, 'AiAgentConversationsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Keep conversation history
      tableName: `${this.stackName}-AiAgentConversations`,
      timeToLiveAttribute: 'ttl', // Auto-delete after 90 days (configurable)
      pointInTimeRecovery: true,
    });
    applyTags(this.conversationsTable, { Table: 'ai-agent-conversations' });

    // GSI for clinic-based queries: "Show all conversations for this clinic"
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicTimestampIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for agent-based queries: "Show all conversations with this agent"
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'AgentTimestampIndex',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for user-based queries: "Show all conversations by this user"
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'UserTimestampIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Circuit Breaker Table - distributed circuit breaker state
    // ARCHITECTURE FIX: Circuit breaker state is now in DynamoDB (not in-memory)
    // for consistent rate limiting and circuit breaking across Lambda instances
    this.circuitBreakerTable = new dynamodb.Table(this, 'CircuitBreakerTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // State is ephemeral
      tableName: `${this.stackName}-CircuitBreaker`,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.circuitBreakerTable, { Table: 'circuit-breaker' });

    // WebSocket Connections Table - stores active connections
    this.connectionsTable = new dynamodb.Table(this, 'AiAgentConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Connections are ephemeral
      tableName: `${this.stackName}-AiAgentConnections`,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.connectionsTable, { Table: 'ai-agent-connections' });

    // Voice AI Sessions Table - stores active voice call sessions
    this.voiceSessionsTable = new dynamodb.Table(this, 'VoiceAiSessionsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-VoiceAiSessions`,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });
    applyTags(this.voiceSessionsTable, { Table: 'voice-sessions' });

    // Add GSI for callId lookups
    this.voiceSessionsTable.addGlobalSecondaryIndex({
      indexName: 'CallIdIndex',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // CLINIC HOURS TABLE (Imported from ClinicHoursStack)
    // ========================================
    // CRITICAL FIX: Import the existing table from ClinicHoursStack instead of creating a duplicate.
    // This ensures all clinic hours data is in one place and synced from OpenDental.
    // NOTE: Only use tableArn (not both tableArn and tableName) to avoid ValidationError
    this.clinicHoursTable = dynamodb.Table.fromTableArn(this, 'ImportedClinicHoursTable', props.clinicHoursTableArn);
    console.log(`[AiAgentsStack] Using shared ClinicHours table: ${props.clinicHoursTableName}`);

    // Voice Agent Config Table - stores which agent handles voice calls per clinic
    this.voiceConfigTable = new dynamodb.Table(this, 'VoiceAgentConfigTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-VoiceAgentConfig`,
      pointInTimeRecovery: true,
    });
    applyTags(this.voiceConfigTable, { Table: 'voice-config' });

    // Scheduled Calls Table - stores outbound call schedules
    this.scheduledCallsTable = new dynamodb.Table(this, 'ScheduledCallsTable', {
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-ScheduledCalls`,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });
    applyTags(this.scheduledCallsTable, { Table: 'scheduled-calls' });

    // Active Meetings Table - stores Chime meetings for AI calling
    // Tracks meeting lifecycle for inbound/outbound AI calls with meeting-based architecture
    const activeMeetingsTable = new dynamodb.Table(this, 'ActiveMeetingsTable', {
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-ActiveMeetings`,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });
    applyTags(activeMeetingsTable, { Table: 'active-meetings' });

    // Add GSI for call-based queries
    activeMeetingsTable.addGlobalSecondaryIndex({
      indexName: 'CallIdIndex',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for clinic-based queries (to see all active meetings per clinic)
    activeMeetingsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.NUMBER },
    });

    // Add GSI for clinic-based queries
    this.scheduledCallsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledTime', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // BULK OUTBOUND JOBS TABLE (30,000+ call scheduling)
    // ========================================
    // Tracks progress of large-scale call scheduling jobs with:
    // - Job status (pending, processing, completed, failed)
    // - Progress tracking (processedCalls, successfulCalls, failedCalls)
    // - CSV upload support for bulk scheduling
    this.bulkOutboundJobsTable = new dynamodb.Table(this, 'BulkOutboundJobsTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-BulkOutboundJobs`,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });
    applyTags(this.bulkOutboundJobsTable, { Table: 'bulk-outbound-jobs' });

    // Add GSI for clinic-based job queries
    this.bulkOutboundJobsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicStatusIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // AI AGENTS METRICS TABLE (Performance Tracking)
    // ========================================
    // Aggregated daily metrics for AI agent performance tracking.
    // Enables ROI analysis for AI agent scheduling efficiency and billing conversion.
    // Metrics are updated via atomic ADD operations in DynamoDB.
    // Attributes:
    //   - appointmentsBooked: Appointments successfully scheduled by the agent
    //   - appointmentsUsed: Appointments that were kept/attended (confirmed via sync)
    //   - appointmentsCancelled: Appointments cancelled by the user or agent
    //   - appointmentsRescheduled: Appointments moved to a different slot
    //   - billsPaid: Count of bill payments successfully processed (Patient Portal integration)
    this.aiAgentsMetricsTable = new dynamodb.Table(this, 'AiAgentsMetricsTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'metricDate', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Keep metrics data for analytics
      tableName: `${this.stackName}-AiAgentsMetrics`,
      pointInTimeRecovery: true,
    });
    applyTags(this.aiAgentsMetricsTable, { Table: 'ai-agents-metrics' });

    // ========================================
    // OUTBOUND CALL QUEUE (async batch processing)
    // ========================================
    // SQS queue for processing large batches of scheduled calls asynchronously.
    // Enables scheduling 30,000+ calls without Lambda timeout issues.
    this.outboundCallQueue = new sqs.Queue(this, 'OutboundCallQueue', {
      queueName: `${this.stackName}-OutboundCallQueue`,
      visibilityTimeout: Duration.minutes(6), // Must be >= Lambda timeout + buffer
      retentionPeriod: Duration.days(7),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'OutboundCallDLQ', {
          queueName: `${this.stackName}-OutboundCallDLQ`,
          retentionPeriod: Duration.days(14),
        }),
        maxReceiveCount: 3, // Move to DLQ after 3 failures
      },
    });
    applyTags(this.outboundCallQueue, { Queue: 'outbound-call-queue' });

    // ========================================
    // SHARED CALL ANALYTICS TABLE (from AnalyticsStack)
    // ========================================
    // CRITICAL FIX: Use the shared CallAnalytics table from AnalyticsStack instead of
    // creating a duplicate. This ensures all call analytics data (from Chime stream
    // processor, reconciliation jobs, and Voice AI) goes to the same table.
    //
    // The AnalyticsStack table schema:
    //   PK: callId (String) - unique call identifier
    //   SK: timestamp (Number) - call start timestamp
    //   GSIs: clinicId-timestamp, agentId-timestamp, callStatus-timestamp, etc.
    //
    // If callAnalyticsTableName is not provided, Voice AI analytics will be disabled
    // with a warning at synth time.

    // ========================================
    // ANALYTICS INTEGRATION VALIDATION
    // ========================================
    // CRITICAL FIX: Validate that name and ARN are provided together
    if (props.callAnalyticsTableName && !props.callAnalyticsTableArn) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: callAnalyticsTableName is provided but callAnalyticsTableArn is missing. ' +
        'Both must be provided together for proper IAM permissions.'
      );
    }
    if (props.callAnalyticsTableArn && !props.callAnalyticsTableName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: callAnalyticsTableArn is provided but callAnalyticsTableName is missing. ' +
        'Both must be provided together for environment variable configuration.'
      );
    }

    // Use explicit props for analytics table (preferred over dynamic imports)
    if (props.callAnalyticsTableName) {
      this.callAnalyticsTableName = props.callAnalyticsTableName;
      console.log(`[AiAgentsStack] CallAnalytics table configured: ${props.callAnalyticsTableName}`);
    } else if (props.analyticsStackName) {
      // Fallback: Import dynamically from AnalyticsStack
      this.callAnalyticsTableName = Fn.importValue(`${props.analyticsStackName}-CallAnalyticsTableName`).toString();
      console.log(`[AiAgentsStack] Importing CallAnalytics table from ${props.analyticsStackName}`);
    } else {
      // No analytics integration configured
      this.callAnalyticsTableName = undefined;
      console.warn(
        '[AiAgentsStack] WARNING: callAnalyticsTableName and analyticsStackName not provided. ' +
        'Voice AI call analytics will be DISABLED. To enable unified analytics, ' +
        'pass the AnalyticsStack CallAnalyticsN1 table name via props or provide analyticsStackName.'
      );
    }

    // ========================================
    // S3 BUCKET FOR CALL RECORDINGS
    // ========================================
    // CRITICAL FIX: Use shared recordings bucket from ChimeStack if provided
    // This avoids data fragmentation between AI calls and human calls.

    // Validate shared bucket name+ARN pair
    if (props.sharedRecordingsBucketName && !props.sharedRecordingsBucketArn) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: sharedRecordingsBucketName is provided but sharedRecordingsBucketArn is missing. ' +
        'Both must be provided together for proper IAM permissions.'
      );
    }
    if (props.sharedRecordingsBucketArn && !props.sharedRecordingsBucketName) {
      throw new Error(
        '[AiAgentsStack] CONFIGURATION ERROR: sharedRecordingsBucketArn is provided but sharedRecordingsBucketName is missing. ' +
        'Both must be provided together for bucket reference.'
      );
    }

    // Declare bucket variable for use throughout constructor
    let recordingsBucket: s3.IBucket;

    if (props.sharedRecordingsBucketName && props.sharedRecordingsBucketArn) {
      // Use shared recordings bucket from ChimeStack (RECOMMENDED)
      console.log(`[AiAgentsStack] Using shared recordings bucket from ChimeStack: ${props.sharedRecordingsBucketName}`);

      recordingsBucket = s3.Bucket.fromBucketAttributes(this, 'SharedRecordingsBucket', {
        bucketName: props.sharedRecordingsBucketName,
        bucketArn: props.sharedRecordingsBucketArn,
      });

      // Note: Bucket policies are configured in ChimeStack
      // AiAgentsStack just needs write permissions (granted via IAM role policy below)
    } else {
      // Create AiAgentsStack's own recordings bucket (legacy behavior)
      // WARNING: This creates data fragmentation between AI and human call recordings
      console.warn(
        '[AiAgentsStack] WARNING: Creating separate recordings bucket. ' +
        'This causes data fragmentation between AI and human call recordings. ' +
        'Pass sharedRecordingsBucketName/Arn from ChimeStack for unified storage.'
      );

      const ownBucket = new s3.Bucket(this, 'CallRecordingsBucket', {
        bucketName: `${this.stackName.toLowerCase()}-call-recordings-${this.account}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [{
          id: 'expire-old-recordings',
          expiration: Duration.days(365), // Keep recordings for 1 year
          enabled: true,
        }],
        versioned: false,
      });
      applyTags(ownBucket, { Bucket: 'call-recordings' });

      // Allow Chime Voice Connector to write recordings to this bucket
      // CRITICAL FIX: Use voiceconnector.chime.amazonaws.com principal, not chime.amazonaws.com
      // The chime.amazonaws.com principal is for Chime SDK Meetings, not Voice Connector/SMA.
      // Voice Connector and SIP Media Application recordings require the voiceconnector principal.
      ownBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowChimeVoiceConnectorToWriteRecordings',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [`${ownBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:chime:*:${this.account}:sma/*`,
          },
        },
      }));

      recordingsBucket = ownBucket;
    }

    // Store reference for other parts of the stack
    this.callRecordingsBucket = recordingsBucket;

    // ========================================
    // S3 BUCKET FOR INSURANCE CARD IMAGES (Textract Processing)
    // ========================================
    // Temporary storage for insurance card images during Textract OCR processing.
    // Images are automatically deleted after 1 day to minimize storage costs and
    // comply with data retention best practices.

    this.insuranceImageBucket = new s3.Bucket(this, 'InsuranceImageBucket', {
      bucketName: `${this.stackName.toLowerCase()}-insurance-images-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY, // Images are temporary
      autoDeleteObjects: true, // Clean up on stack deletion
      lifecycleRules: [{
        id: 'delete-after-processing',
        expiration: Duration.days(1), // Delete images after 1 day
        enabled: true,
      }],
      versioned: false,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: ['*'], // Will be secured via API Gateway
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
    });
    applyTags(this.insuranceImageBucket, { Bucket: 'insurance-images' });

    // ========================================
    // IAM ROLE FOR BEDROCK AGENTS
    // ========================================

    // This role is assumed by Bedrock Agents to invoke Lambda action groups
    this.bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role assumed by Bedrock Agents to invoke action group Lambda functions',
      roleName: `${this.stackName}-BedrockAgentRole`,
    });

    // Allow Bedrock Agent to invoke foundation models
    // ========================================
    // SUPPORTED MODEL FAMILIES:
    // ========================================
    // 🧠 Anthropic Claude Family (top-tier reasoning, chat, summarization)
    //    - Claude Sonnet 4.5 (anthropic.claude-sonnet-4-5-*)
    //    - Claude Sonnet 4 (anthropic.claude-sonnet-4-*)
    //    - Claude Opus 4.5 (anthropic.claude-opus-4-5-*)
    //    - Claude Opus 4 (anthropic.claude-opus-4-*)
    //    - Claude 3.7 Sonnet (anthropic.claude-3-7-sonnet-*)
    //    - Claude 3.5 Sonnet v2 (anthropic.claude-3-5-sonnet-20241022-v2:0)
    //    - Claude 3.5 Haiku (anthropic.claude-3-5-haiku-*)
    //    - Claude 3 Sonnet (anthropic.claude-3-sonnet-*)
    //    - Claude 3 Haiku (anthropic.claude-3-haiku-*)
    // 🐘 Amazon Nova Series (AWS-native, cost-efficient, multimodal)
    //    - Nova Micro (amazon.nova-micro-*) - ultra low-latency text
    //    - Nova Lite (amazon.nova-lite-*) - multimodal text/image/video
    //    - Nova Pro (amazon.nova-pro-*) - balanced high-capability
    //    - Nova Premier (amazon.nova-premier-*) - advanced capabilities
    //    - Nova Sonic (amazon.nova-sonic-*) - voice model
    //    - Nova Canvas (amazon.nova-canvas-*) - image generation
    //    - Nova Reel (amazon.nova-reel-*) - video generation
    // 🦙 Meta Llama Family (open-source, instruction-following)
    //    - Llama 4 (meta.llama4-*) - latest generation with MoE
    //    - Llama 3.3 (meta.llama3-3-*) - performance-tuned
    //    - Llama 3.2 (meta.llama3-2-*) - multimodal variants
    //    - Llama 3.1 (meta.llama3-1-*) - 8B/70B/405B params
    //    - Llama 3 (meta.llama3-*) - 8B/70B instruct
    // 🤖 Cohere Command Models (enterprise text tasks, RAG)
    //    - Command R (cohere.command-r-*)
    //    - Command R+ (cohere.command-r-plus-*)
    // 🔍 DeepSeek Models (reasoning, open-source)
    //    - DeepSeek-R1 (deepseek.deepseek-r1-*)
    //    - DeepSeek-V3 (deepseek.deepseek-v3-*)
    // 🌟 Mistral AI Models (efficient, multilingual)
    //    - Mistral Large (mistral.mistral-large-*)
    //    - Mistral Small (mistral.mistral-small-*)
    //    - Mixtral 8x7B (mistral.mixtral-8x7b-*)
    // 💎 AI21 Labs Jamba (enterprise text generation)
    //    - Jamba Instruct (ai21.jamba-instruct-*)
    //    - Jamba 1.5 (ai21.jamba-1-5-*)
    // ========================================
    this.bedrockAgentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream', // Streaming support
      ],
      resources: [
        // Wildcard for all foundation models (covers current and future models)
        'arn:aws:bedrock:*::foundation-model/*',
        // Cross-region inference profiles (us.anthropic.*, us.meta.*, etc.)
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
      ],
    }));

    // ========================================
    // IAM ROLE FOR EVENTBRIDGE SCHEDULER
    // ========================================

    // This role is assumed by EventBridge Scheduler to invoke Lambda functions
    this.schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role assumed by EventBridge Scheduler to invoke outbound call Lambda',
      roleName: `${this.stackName}-SchedulerRole`,
    });

    // ========================================
    // ACTION GROUP LAMBDA
    // ========================================

    // This Lambda handles all OpenDental tool calls from the Bedrock Agent
    this.actionGroupFn = new lambdaNode.NodejsFunction(this, 'ActionGroupFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'action-group-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(2), // Tool calls may take time
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        // SECURITY FIX: Clinic credentials loaded from SSM at runtime, not bundled
        CLINICS_TABLE: props.clinicsTableName,
        // Clinic secrets table for fallback credential lookup (from SecretsStack)
        CLINIC_SECRETS_TABLE: 'TodaysDentalInsights-ClinicSecrets',
        // ARCHITECTURE FIX: Distributed circuit breaker table
        CIRCUIT_BREAKER_TABLE: this.circuitBreakerTable.tableName,
        // Insurance plans table for coverage lookup (synced from OpenDental every 15 mins)
        INSURANCE_PLANS_TABLE: 'TodaysDentalInsightsInsurancePlanSyncN1-InsurancePlans',
        // Fee schedules table for fee lookup (synced from OpenDental every 15 mins)
        FEE_SCHEDULES_TABLE: 'TodaysDentalInsightsFeeScheduleSyncN1-FeeSchedules',
        // Appointment types table for booking appointments (from PatientPortalApptTypesStack)
        APPT_TYPES_TABLE: props.apptTypesTableName || 'TodaysDentalInsightsPatientPortalApptTypesN1-ApptTypes',
        // AI Agents Metrics table for tracking scheduling outcomes (booked, used, cancelled, rescheduled)
        AI_AGENTS_METRICS_TABLE: this.aiAgentsMetricsTable.tableName,
        // Callback table configuration for failed appointment bookings and patient searches
        CALLBACK_TABLE_PREFIX: 'todaysdentalinsights-callback-',
        DEFAULT_CALLBACK_TABLE: 'TodaysDentalInsightsCallbackN1-CallbackRequests',
      },
    });
    applyTags(this.actionGroupFn, { Function: 'action-group' });

    this.agentsTable.grantReadData(this.actionGroupFn);
    this.circuitBreakerTable.grantReadWriteData(this.actionGroupFn);
    // Grant write access to metrics table for tracking scheduling outcomes
    this.aiAgentsMetricsTable.grantReadWriteData(this.actionGroupFn);

    // Grant read access to Clinics table for clinic metadata
    // Use explicit ARN from props if available, otherwise construct from table name
    const clinicsTableArnForActionGroup = props.clinicsTableArn ||
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicsTableName}`;

    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [clinicsTableArnForActionGroup],
    }));

    // Grant read access to ClinicSecrets table for fallback credential lookup
    // This table is managed by SecretsStack and stores per-clinic OpenDental API credentials
    const clinicSecretsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsights-ClinicSecrets`;
    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [clinicSecretsTableArn],
    }));

    // Grant KMS decryption for the SecretsStack encryption key (required for KMS-encrypted DynamoDB tables)
    if (props.secretsEncryptionKeyArn) {
      this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // Grant read access to Insurance Plans table for coverage lookup
    // This table is synced every 15 mins from OpenDental by InsurancePlanSyncStack
    const insurancePlansTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsightsInsurancePlanSyncN1-InsurancePlans`;
    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        insurancePlansTableArn,
        `${insurancePlansTableArn}/index/*`, // Include GSIs for efficient lookups
      ],
    }));

    // Grant read access to Fee Schedules table for fee lookup
    // This table is synced every 15 mins from OpenDental by FeeScheduleSyncStack
    const feeSchedulesTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsightsFeeScheduleSyncN1-FeeSchedules`;
    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        feeSchedulesTableArn,
        `${feeSchedulesTableArn}/index/*`, // Include GSIs for efficient lookups
      ],
    }));

    // Grant read access to Appointment Types table for booking appointments
    // This table is managed by PatientPortalApptTypesStack with schema: clinicId (PK), label (SK)
    const apptTypesTableArn = props.apptTypesTableArn ||
      `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsightsPatientPortalApptTypesN1-ApptTypes`;
    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [apptTypesTableArn],
    }));

    // Grant write access to Callback tables for saving failed appointment bookings as callbacks
    // This enables clinic staff to follow up with patients when AI scheduling fails
    this.actionGroupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [
        // Clinic-specific callback tables
        `arn:aws:dynamodb:${this.region}:${this.account}:table/todaysdentalinsights-callback-*`,
        // Default callback table as fallback
        `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsightsCallbackN1-CallbackRequests`,
      ],
    }));

    // Allow Bedrock Agent role to invoke the action group Lambda
    this.actionGroupFn.grantInvoke(this.bedrockAgentRole);

    // Also allow bedrock.amazonaws.com to invoke directly
    this.actionGroupFn.addPermission('BedrockInvoke', {
      principal: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:bedrock:${this.region}:${this.account}:agent/*`,
    });

    // ========================================
    // INSURANCE TEXTRACT HANDLER
    // ========================================
    // Processes uploaded insurance card images using AWS Textract to extract:
    // - Insurance Company Name, Group Name/Number, Member ID
    // - Coverage details, deductibles, maximums
    // - Can optionally upload to OpenDental as patient document

    this.insuranceTextractFn = new lambdaNode.NodejsFunction(this, 'InsuranceTextractFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'insurance-textract-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(60), // Textract can take time for complex images
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        IMAGE_BUCKET: this.insuranceImageBucket.bucketName,
        AGENTS_TABLE: this.agentsTable.tableName,
      },
    });
    applyTags(this.insuranceTextractFn, { Function: 'insurance-textract' });

    // Grant S3 permissions for image storage
    this.insuranceImageBucket.grantReadWrite(this.insuranceTextractFn);

    // Grant Textract permissions
    this.insuranceTextractFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
      ],
      resources: ['*'], // Textract doesn't support resource-level permissions
    }));

    // Grant read access to agents table for clinic config lookup
    this.agentsTable.grantReadData(this.insuranceTextractFn);

    // Grant read access to ClinicSecrets table for OpenDental credentials
    // (insurance-textract-handler uses shared `secrets-helper` which calls DynamoDB GetItem)
    this.insuranceTextractFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [clinicSecretsTableArn],
    }));

    // Optional: allow decrypt if Secrets stack uses a CMK and downstream code needs it
    if (props.secretsEncryptionKeyArn) {
      this.insuranceTextractFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'AiAgentsApi', {
      restApiName: 'AiAgentsApi',
      description: 'AI Agents service API - Bedrock Agents with Action Groups',
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
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    // Import authorizer
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    this.authorizer = new apigw.RequestAuthorizer(this, 'AiAgentsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // AI Agents CRUD + Bedrock Agent Management
    this.agentsFn = new lambdaNode.NodejsFunction(this, 'AiAgentsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'agents.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096, // Increased for uniform memory allocation across AI Agents stack
      timeout: Duration.seconds(60), // Agent creation/prepare can take time
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        BEDROCK_AGENT_ROLE_ARN: this.bedrockAgentRole.roleArn,
        ACTION_GROUP_LAMBDA_ARN: this.actionGroupFn.functionArn,
        AWS_REGION_OVERRIDE: this.region,
      },
    });
    applyTags(this.agentsFn, { Function: 'ai-agents-crud' });

    this.agentsTable.grantReadWriteData(this.agentsFn);

    // Bedrock Agent management permissions
    this.agentsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Agent lifecycle
        'bedrock:CreateAgent',
        'bedrock:UpdateAgent',
        'bedrock:DeleteAgent',
        'bedrock:GetAgent',
        'bedrock:PrepareAgent',
        'bedrock:ListAgents',
        // Agent versions
        'bedrock:ListAgentVersions',
        'bedrock:GetAgentVersion',
        // Agent aliases
        'bedrock:CreateAgentAlias',
        'bedrock:UpdateAgentAlias',
        'bedrock:DeleteAgentAlias',
        'bedrock:GetAgentAlias',
        'bedrock:ListAgentAliases',
        // Action groups
        'bedrock:CreateAgentActionGroup',
        'bedrock:UpdateAgentActionGroup',
        'bedrock:DeleteAgentActionGroup',
        'bedrock:GetAgentActionGroup',
        'bedrock:ListAgentActionGroups',
      ],
      resources: ['*'],
    }));

    // Allow passing the Bedrock Agent role
    this.agentsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [this.bedrockAgentRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'bedrock.amazonaws.com',
        },
      },
    }));

    // Invoke Agent Handler
    this.invokeAgentFn = new lambdaNode.NodejsFunction(this, 'InvokeAgentFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'invoke-agent.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(5),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        // SECURITY FIX: Sessions table for user-bound session management
        SESSIONS_TABLE: this.sessionsTable.tableName,
        // Conversation history logging
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
      },
    });
    applyTags(this.invokeAgentFn, { Function: 'invoke-agent' });

    this.agentsTable.grantReadWriteData(this.invokeAgentFn);
    this.sessionsTable.grantReadWriteData(this.invokeAgentFn);
    this.conversationsTable.grantWriteData(this.invokeAgentFn);

    // Bedrock Agent invocation permissions
    this.invokeAgentFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // ========================================
    // VOICE AI HANDLER
    // ========================================

    // Handles after-hours inbound voice calls
    this.voiceAiFn = new lambdaNode.NodejsFunction(this, 'VoiceAiFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'voice-ai-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(5), // Voice calls can be long
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        VOICE_SESSIONS_TABLE: this.voiceSessionsTable.tableName,
        CLINIC_HOURS_TABLE: this.clinicHoursTable.tableName,
        VOICE_CONFIG_TABLE: this.voiceConfigTable.tableName,
        // Use shared CallAnalytics table from AnalyticsStack (or empty if not provided)
        CALL_ANALYTICS_TABLE: props.callAnalyticsTableName || '',
        CALL_ANALYTICS_ENABLED: props.callAnalyticsTableName ? 'true' : 'false',
        CALL_RECORDINGS_BUCKET: this.callRecordingsBucket.bucketName,
        // Streaming response settings - sends AI chunks via UpdateSipMediaApplicationCall
        ENABLE_STREAMING_RESPONSES: 'true',
        CHIME_MEDIA_REGION: 'us-east-1',
        SMA_ID_MAP_PARAMETER: props.smaIdMapParameterName,
        // FIX: Add TTS_AUDIO_BUCKET for streaming TTS to work properly
        // Uses the hold music bucket from ChimeStack for PlayAudio actions
        TTS_AUDIO_BUCKET: props.holdMusicBucketName || '',
        HOLD_MUSIC_BUCKET: props.holdMusicBucketName || '',
      },
    });
    applyTags(this.voiceAiFn, { Function: 'voice-ai' });

    this.agentsTable.grantReadData(this.voiceAiFn);
    this.voiceSessionsTable.grantReadWriteData(this.voiceAiFn);
    this.clinicHoursTable.grantReadData(this.voiceAiFn);
    this.voiceConfigTable.grantReadData(this.voiceAiFn);
    this.callRecordingsBucket.grantWrite(this.voiceAiFn);

    // FIX: Grant S3 write access to hold music bucket for streaming TTS audio
    // VoiceAiFn generates TTS audio via Polly and uploads to S3 for PlayAudio actions
    if (props.holdMusicBucketArn) {
      this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:DeleteObject',
        ],
        resources: [
          `${props.holdMusicBucketArn}/*`,
        ],
      }));
      console.log(`[AiAgentsStack] VoiceAiFn granted S3 access to hold music bucket for streaming TTS`);
    } else {
      console.warn('[AiAgentsStack] holdMusicBucketArn not provided - streaming TTS will be disabled');
    }

    // Grant write access to shared CallAnalytics table (cross-stack permission)
    // The table schema is: PK=callId, SK=timestamp (Number)
    // Use explicit ARN from props (validated above to be present if name is present)
    const callAnalyticsTableArn = props.callAnalyticsTableArn;

    if (callAnalyticsTableArn) {
      this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
        ],
        resources: [
          callAnalyticsTableArn,
          `${callAnalyticsTableArn}/index/*`,
        ],
      }));
    }

    // Bedrock Agent invocation for Voice AI
    this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // Amazon Polly for text-to-speech
    this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'polly:SynthesizeSpeech',
        'polly:DescribeVoices',
      ],
      resources: ['*'],
    }));

    // Amazon Transcribe for speech-to-text
    this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartStreamTranscription',
        'transcribe:StartStreamTranscriptionWebSocket',
      ],
      resources: ['*'],
    }));

    // Chime SDK Voice for streaming responses via UpdateSipMediaApplicationCall
    this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:us-east-1:${this.account}:sma/*`],
    }));

    // SSM for reading SMA ID map (required for streaming responses)
    this.voiceAiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/*SmaIdMap*`],
    }));

    // ========================================
    // VOICE AGENT CONFIG HANDLER
    // ========================================

    // Manages which AI agent handles voice calls per clinic
    this.voiceConfigFn = new lambdaNode.NodejsFunction(this, 'VoiceConfigFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'voice-agent-config.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        VOICE_CONFIG_TABLE: this.voiceConfigTable.tableName,
        CLINIC_HOURS_TABLE: this.clinicHoursTable.tableName,
      },
    });
    applyTags(this.voiceConfigFn, { Function: 'voice-config' });

    this.agentsTable.grantReadData(this.voiceConfigFn);
    this.voiceConfigTable.grantReadWriteData(this.voiceConfigFn);
    this.clinicHoursTable.grantReadWriteData(this.voiceConfigFn);

    // Polly - dynamically list valid voices per engine (DescribeVoices)
    this.voiceConfigFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:DescribeVoices'],
      resources: ['*'],
    }));

    // ========================================
    // CONVERSATION HISTORY HANDLER
    // ========================================
    // Provides endpoints for viewing and analyzing AI agent conversations:
    // - GET /conversations - List all conversations with filters
    // - GET /conversations/{sessionId} - Get conversation details with messages
    // - GET /conversations/stats - Get conversation analytics
    // - DELETE /conversations/{sessionId} - Delete conversation (admin only)
    this.conversationHistoryFn = new lambdaNode.NodejsFunction(this, 'ConversationHistoryFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'conversation-history.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(60), // Stats queries may take time
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        SESSIONS_TABLE: this.sessionsTable.tableName,
        AGENTS_TABLE: this.agentsTable.tableName,
      },
    });
    applyTags(this.conversationHistoryFn, { Function: 'conversation-history' });

    this.conversationsTable.grantReadWriteData(this.conversationHistoryFn);
    this.sessionsTable.grantReadData(this.conversationHistoryFn);
    this.agentsTable.grantReadData(this.conversationHistoryFn);

    // ========================================
    // OUTBOUND CALL EXECUTOR (Invoked by Scheduler)
    // ========================================

    // ========================================
    // CHIME STACK INTEGRATION (using required props)
    // ========================================
    // CRITICAL FIX: Use explicit props instead of hardcoded defaults
    // This avoids fragile dependencies on stack naming conventions
    const clinicsTableName = props.clinicsTableName;
    const smaIdMapParameterName = props.smaIdMapParameterName;

    console.log('[AiAgentsStack] Chime integration configured:', {
      clinicsTable: clinicsTableName,
      smaIdMapParameterName,
    });

    // ========================================
    // MEETING MANAGER LAMBDA - Chime SDK Meetings for AI Calling
    // ========================================
    // Manages Chime meetings for AI calling (inbound and outbound)
    // Replaces direct SMA actions with meeting-based architecture
    const meetingManagerFn = new lambdaNode.NodejsFunction(this, 'MeetingManagerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'meeting-manager.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        ACTIVE_MEETINGS_TABLE: activeMeetingsTable.tableName,
        CHIME_MEDIA_REGION: 'us-east-1',
        // Media Insights Pipeline parameter for real-time transcription
        // This is passed from ChimeStack via props
        MEDIA_INSIGHTS_PIPELINE_PARAMETER: props.mediaInsightsPipelineParameter || '',
      },
    });
    applyTags(meetingManagerFn, { Function: 'meeting-manager' });

    // Grant permissions
    activeMeetingsTable.grantReadWriteData(meetingManagerFn);

    // Chime SDK Meetings permissions
    meetingManagerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Meeting management
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListAttendees',
        // Real-time transcription (StartMeetingTranscription API)
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
      ],
      resources: ['*'],
    }));

    // Transcribe permissions for real-time meeting transcription
    meetingManagerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartStreamTranscription',
        'transcribe:StartStreamTranscriptionWebSocket',
      ],
      resources: ['*'],
    }));

    // Media Insights Pipeline permissions (kept for future use)
    meetingManagerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMediaInsightsPipeline',
        'chime:DeleteMediaPipeline',
        'chime:GetMediaInsightsPipeline',
        'chimesdkmediapipelines:CreateMediaInsightsPipeline',
        'chimesdkmediapipelines:DeleteMediaPipeline',
        'chimesdkmediapipelines:GetMediaInsightsPipeline',
      ],
      resources: ['*'],
    }));

    // SSM Parameter read for Media Insights Pipeline Config ARN
    if (props.mediaInsightsPipelineParameter) {
      meetingManagerFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${props.mediaInsightsPipelineParameter}`],
      }));
    }

    // Add environment variables for transcription
    meetingManagerFn.addEnvironment('ENABLE_MEETING_TRANSCRIPTION', 'true');
    meetingManagerFn.addEnvironment('TRANSCRIPTION_LANGUAGE', 'en-US');
    if (props.medicalVocabularyName) {
      meetingManagerFn.addEnvironment('MEDICAL_VOCABULARY_NAME', props.medicalVocabularyName);
    }

    // ========================================
    // MEETING TRANSCRIPTION HANDLER - Processes real-time transcription events
    // ========================================
    // This Lambda receives transcription events via EventBridge and sends them to the AI
    const transcriptionHandlerFn = new lambdaNode.NodejsFunction(this, 'TranscriptionHandlerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'meeting-transcription-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(60), // Longer timeout for AI processing
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        ACTIVE_MEETINGS_TABLE: activeMeetingsTable.tableName,
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        VOICE_SESSIONS_TABLE: this.voiceSessionsTable.tableName,
        BEDROCK_AGENT_ID: props.bedrockAgentId || '',
        BEDROCK_AGENT_ALIAS_ID: props.bedrockAgentAliasId || 'TSTALIASID',
        TTS_BUCKET: props.holdMusicBucketName || '',
        CHIME_MEDIA_REGION: 'us-east-1',
        POLLY_VOICE_ID: 'Joanna',
        AI_TRANSCRIPT_STREAM: props.aiTranscriptStreamName || '',
      },
    });
    applyTags(transcriptionHandlerFn, { Function: 'transcription-handler' });

    // Grant DynamoDB access
    activeMeetingsTable.grantReadWriteData(transcriptionHandlerFn);
    this.conversationsTable.grantReadWriteData(transcriptionHandlerFn);
    this.voiceSessionsTable.grantReadWriteData(transcriptionHandlerFn);

    // Bedrock Agent invocation permissions
    transcriptionHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
      ],
      resources: ['*'],
    }));

    // Polly TTS permissions
    transcriptionHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // S3 write for TTS audio files
    if (props.holdMusicBucketArn) {
      transcriptionHandlerFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [`${props.holdMusicBucketArn}/*`],
      }));
    }

    // Chime SDK Voice permissions for UpdateSipMediaApplicationCall
    transcriptionHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));

    // Kinesis write for transcript analytics
    if (props.aiTranscriptStreamArn) {
      transcriptionHandlerFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kinesis:PutRecord', 'kinesis:PutRecords'],
        resources: [props.aiTranscriptStreamArn],
      }));
    }

    // EventBridge rule to invoke transcription handler on Chime meeting events
    const transcriptionRule = new events.Rule(this, 'TranscriptionEventRule', {
      ruleName: `${this.stackName}-TranscriptionEvents`,
      description: 'Routes Chime SDK Meeting transcription events to the handler Lambda',
      eventPattern: {
        source: ['aws.chime'],
        detailType: [
          'Chime Meeting State Change',
          'Chime Meeting Transcription',
        ],
      },
    });
    transcriptionRule.addTarget(new targets.LambdaFunction(transcriptionHandlerFn));

    new CfnOutput(this, 'TranscriptionHandlerFnArn', {
      value: transcriptionHandlerFn.functionArn,
      description: 'ARN of the Transcription Handler Lambda',
      exportName: `${this.stackName}-TranscriptionHandlerFnArn`,
    });

    // ========================================
    // MEETING JOIN HANDLER - API for Human Agent Transfers
    // ========================================
    // Enables agents to join meetings for seamless call handoff
    const meetingJoinFn = new lambdaNode.NodejsFunction(this, 'MeetingJoinFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'meeting-join-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        ACTIVE_MEETINGS_TABLE: activeMeetingsTable.tableName,
        CALL_QUEUE_TABLE_NAME: props.callQueueTableName || '',
        AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName || '',
        CHIME_MEDIA_REGION: 'us-east-1',
      },
    });
    applyTags(meetingJoinFn, { Function: 'meeting-join' });

    // Grant permissions
    activeMeetingsTable.grantReadWriteData(meetingJoinFn);

    // Grant read/write to call queue and agent presence
    // Use explicit ARN construction since these tables are from ChimeStack
    const callQueueTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName || ''}`;
    const agentPresenceTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName || ''}`;

    meetingJoinFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [callQueueTableArn, agentPresenceTableArn],
    }));

    // Chime SDK Meetings permissions
    meetingJoinFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateAttendee',
        'chime:GetMeeting',
        'chime:ListAttendees',
      ],
      resources: ['*'],
    }));

    // Executes scheduled outbound calls - invoked by EventBridge Scheduler
    // Uses EXISTING Chime infrastructure from ChimeStack
    this.outboundExecutorFn = new lambdaNode.NodejsFunction(this, 'OutboundExecutorFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'outbound-call-scheduler.ts'),
      handler: 'executeOutboundCall',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(5),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        SCHEDULED_CALLS_TABLE: this.scheduledCallsTable.tableName,
        VOICE_SESSIONS_TABLE: this.voiceSessionsTable.tableName,
        // Chime integration - uses existing infrastructure
        CLINICS_TABLE: clinicsTableName,
        // SMA ID Map stored in SSM due to CloudFormation 1024 char limit
        SMA_ID_MAP_PARAMETER_NAME: smaIdMapParameterName,
        // Amazon Connect for AI outbound calls (primary path)
        CONNECT_INSTANCE_ID: props.connectInstanceId || '',
        OUTBOUND_CONTACT_FLOW_ID: props.outboundContactFlowId || '',
      },
    });
    applyTags(this.outboundExecutorFn, { Function: 'outbound-executor' });

    this.agentsTable.grantReadData(this.outboundExecutorFn);
    this.scheduledCallsTable.grantReadWriteData(this.outboundExecutorFn);
    this.voiceSessionsTable.grantReadWriteData(this.outboundExecutorFn);

    // Grant read access to SMA ID Map SSM Parameter
    this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${smaIdMapParameterName}`],
    }));

    // Grant read access to Clinics table (from ChimeStack)
    // Use explicit ARN from props if available, otherwise construct from table name
    const clinicsTableArn = props.clinicsTableArn ||
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicsTableName}`;

    this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [clinicsTableArn],
    }));

    // Chime SDK permissions - use EXISTING SIP Media Application
    this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:CreateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));

    // Amazon Connect for AI outbound calls
    if (props.connectInstanceId) {
      this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['connect:StartOutboundVoiceContact'],
        resources: [
          `arn:aws:connect:${this.region}:${this.account}:instance/${props.connectInstanceId}`,
          `arn:aws:connect:${this.region}:${this.account}:instance/${props.connectInstanceId}/*`,
        ],
      }));
    }

    // Bedrock Agent invocation for outbound calls
    this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // Amazon Polly for text-to-speech
    this.outboundExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'polly:SynthesizeSpeech',
        'polly:DescribeVoices',
      ],
      resources: ['*'],
    }));

    // Allow Scheduler to invoke the outbound executor
    this.outboundExecutorFn.grantInvoke(this.schedulerRole);

    // ========================================
    // OUTBOUND CALL SCHEDULER HANDLER
    // ========================================

    // API handler for scheduling outbound calls
    // Increased timeout and memory for bulk scheduling (up to 500 calls)
    this.outboundSchedulerFn = new lambdaNode.NodejsFunction(this, 'OutboundSchedulerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'outbound-call-scheduler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096, // Increased for uniform memory allocation across AI Agents stack
      timeout: Duration.minutes(3), // Increased for processing up to 500 calls
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        SCHEDULED_CALLS_TABLE: this.scheduledCallsTable.tableName,
        OUTBOUND_CALL_LAMBDA_ARN: this.outboundExecutorFn.functionArn,
        SCHEDULER_ROLE_ARN: this.schedulerRole.roleArn,
        // Bulk scheduling configuration
        BULK_SCHEDULE_MAX_CALLS: '500',
        BULK_SCHEDULE_BATCH_SIZE: '25',
        // Chime integration (fallback)
        CLINICS_TABLE: clinicsTableName,
        SMA_ID_MAP_PARAMETER_NAME: smaIdMapParameterName,
        // Amazon Connect for AI outbound calls (primary path)
        CONNECT_INSTANCE_ID: props.connectInstanceId || '',
        OUTBOUND_CONTACT_FLOW_ID: props.outboundContactFlowId || '',
      },
    });
    applyTags(this.outboundSchedulerFn, { Function: 'outbound-scheduler' });

    this.agentsTable.grantReadData(this.outboundSchedulerFn);
    this.scheduledCallsTable.grantReadWriteData(this.outboundSchedulerFn);

    // EventBridge Scheduler permissions
    this.outboundSchedulerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
        'scheduler:UpdateSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/outbound-call-*`],
    }));

    // Allow passing the scheduler role
    this.outboundSchedulerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [this.schedulerRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        },
      },
    }));

    // Grant SQS permissions for async bulk scheduling
    this.outboundCallQueue.grantSendMessages(this.outboundSchedulerFn);
    this.outboundSchedulerFn.addEnvironment('OUTBOUND_CALL_QUEUE_URL', this.outboundCallQueue.queueUrl);
    this.bulkOutboundJobsTable.grantReadWriteData(this.outboundSchedulerFn);
    this.outboundSchedulerFn.addEnvironment('BULK_OUTBOUND_JOBS_TABLE', this.bulkOutboundJobsTable.tableName);

    // ========================================
    // OUTBOUND QUEUE PROCESSOR (async batch handler)
    // ========================================
    // Processes batches of scheduled calls from SQS queue.
    // Enables scheduling 30,000+ calls without Lambda timeout issues.
    const outboundQueueProcessorFn = new lambdaNode.NodejsFunction(this, 'OutboundQueueProcessorFn', {
      functionName: `${this.stackName}-OutboundQueueProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'outbound-queue-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(5), // Matches SQS visibility timeout
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        SCHEDULED_CALLS_TABLE: this.scheduledCallsTable.tableName,
        BULK_OUTBOUND_JOBS_TABLE: this.bulkOutboundJobsTable.tableName,
        OUTBOUND_CALL_LAMBDA_ARN: this.outboundExecutorFn.functionArn,
        SCHEDULER_ROLE_ARN: this.schedulerRole.roleArn,
      },
    });
    applyTags(outboundQueueProcessorFn, { Function: 'outbound-queue-processor' });

    // Grant permissions
    this.agentsTable.grantReadData(outboundQueueProcessorFn);
    this.scheduledCallsTable.grantReadWriteData(outboundQueueProcessorFn);
    this.bulkOutboundJobsTable.grantReadWriteData(outboundQueueProcessorFn);

    // EventBridge Scheduler permissions for queue processor
    outboundQueueProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/outbound-call-*`],
    }));

    outboundQueueProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [this.schedulerRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        },
      },
    }));

    // Add SQS trigger for queue processor
    outboundQueueProcessorFn.addEventSource(new lambdaEventSources.SqsEventSource(this.outboundCallQueue, {
      batchSize: 10, // Process up to 10 batches at a time
      maxBatchingWindow: Duration.seconds(5), // Wait up to 5 seconds for a full batch
      reportBatchItemFailures: true, // Enable partial batch failure reporting
    }));

    // ========================================
    // WEBSOCKET HANDLERS
    // ========================================

    // WebSocket Connect Handler
    // FIX: Added AGENTS_TABLE env var and read permission for agent validation
    this.wsConnectFn = new lambdaNode.NodejsFunction(this, 'WsConnectFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'websocket-connect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        AGENTS_TABLE: this.agentsTable.tableName,
      },
    });
    applyTags(this.wsConnectFn, { Function: 'ws-connect' });
    this.connectionsTable.grantWriteData(this.wsConnectFn);
    // FIX: Grant read access to agents table for agent validation during connect
    this.agentsTable.grantReadData(this.wsConnectFn);

    // WebSocket Disconnect Handler
    this.wsDisconnectFn = new lambdaNode.NodejsFunction(this, 'WsDisconnectFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'websocket-disconnect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
    });
    applyTags(this.wsDisconnectFn, { Function: 'ws-disconnect' });
    this.connectionsTable.grantWriteData(this.wsDisconnectFn);

    // WebSocket Message Handler (with thinking/trace streaming)
    this.wsMessageFn = new lambdaNode.NodejsFunction(this, 'WsMessageFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'websocket-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 4096,
      timeout: Duration.minutes(5),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        // Conversation history logging
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
      },
    });
    applyTags(this.wsMessageFn, { Function: 'ws-message' });

    this.agentsTable.grantReadWriteData(this.wsMessageFn);
    this.connectionsTable.grantReadWriteData(this.wsMessageFn);
    this.conversationsTable.grantWriteData(this.wsMessageFn);

    // Bedrock Agent invocation for WebSocket
    this.wsMessageFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:GetAgentAlias',
      ],
      resources: ['*'],
    }));

    // API Gateway management for WebSocket (to send messages back to clients)
    this.wsMessageFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: ['*'],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // /agents
    const agentsRes = this.api.root.addResource('agents');
    agentsRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    agentsRes.addMethod('POST', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /agents/{agentId}
    const agentIdRes = agentsRes.addResource('{agentId}');
    agentIdRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    agentIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    agentIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /agents/{agentId}/prepare - Prepare the agent
    const prepareRes = agentIdRes.addResource('prepare');
    prepareRes.addMethod('POST', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /clinic/{clinicId}/agents/{agentId}/chat - Main endpoint (clinic + agent specific, authenticated)
    const clinicRes = this.api.root.addResource('clinic');
    const clinicIdRes = clinicRes.addResource('{clinicId}');
    const clinicAgentsRes = clinicIdRes.addResource('agents');
    const clinicAgentIdRes = clinicAgentsRes.addResource('{agentId}');
    const chatRes = clinicAgentIdRes.addResource('chat');
    chatRes.addMethod('POST', new apigw.LambdaIntegration(this.invokeAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /public/clinic/{clinicId}/agents/{agentId}/chat - Public endpoint for website chatbot (API key auth)
    const publicRes = this.api.root.addResource('public');
    const publicClinicRes = publicRes.addResource('clinic');
    const publicClinicIdRes = publicClinicRes.addResource('{clinicId}');
    const publicAgentsRes = publicClinicIdRes.addResource('agents');
    const publicAgentIdRes = publicAgentsRes.addResource('{agentId}');
    const publicChatRes = publicAgentIdRes.addResource('chat');
    publicChatRes.addMethod('POST', new apigw.LambdaIntegration(this.invokeAgentFn), {
      // No authorizer - uses API key in header instead
      authorizationType: apigw.AuthorizationType.NONE,
    });

    // ========================================
    // INSURANCE CARD TEXTRACT ENDPOINTS
    // ========================================
    // Processes uploaded insurance card images using AWS Textract to extract:
    // - Insurance Company, Group Name/Number, Member ID
    // - Coverage details, deductibles, annual maximums
    // Returns structured data that can be used by the chatbot for context

    // /insurance/extract - Authenticated endpoint (for admin portal)
    const insuranceRes = this.api.root.addResource('insurance');
    const extractRes = insuranceRes.addResource('extract');
    extractRes.addMethod('POST', new apigw.LambdaIntegration(this.insuranceTextractFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /public/clinic/{clinicId}/insurance/extract - Public endpoint for website chatbot
    // Used when patients upload insurance cards via the chat widget
    const publicInsuranceRes = publicClinicIdRes.addResource('insurance');
    const publicExtractRes = publicInsuranceRes.addResource('extract');
    publicExtractRes.addMethod('POST', new apigw.LambdaIntegration(this.insuranceTextractFn), {
      // No authorizer - public access for website visitors
      authorizationType: apigw.AuthorizationType.NONE,
    });

    // /models - List available models
    const modelsRes = this.api.root.addResource('models');
    modelsRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /voice-config/{clinicId} - Voice agent configuration per clinic
    const voiceConfigRes = this.api.root.addResource('voice-config');
    const voiceConfigClinicRes = voiceConfigRes.addResource('{clinicId}');
    voiceConfigClinicRes.addMethod('GET', new apigw.LambdaIntegration(this.voiceConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    voiceConfigClinicRes.addMethod('PUT', new apigw.LambdaIntegration(this.voiceConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /voices - List valid Amazon Polly voices for an engine (dynamic)
    // Query params:
    // - engine=standard|neural|generative|long-form
    // - languageCode=en-US (optional)
    const voicesRes = this.api.root.addResource('voices');
    voicesRes.addMethod('GET', new apigw.LambdaIntegration(this.voiceConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /scheduled-calls - Outbound call scheduling
    const scheduledCallsRes = this.api.root.addResource('scheduled-calls');
    scheduledCallsRes.addMethod('GET', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    scheduledCallsRes.addMethod('POST', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /meetings/{meetingId}/join - Agent join meeting for call transfer
    const meetingsRes = this.api.root.addResource('meetings');
    const meetingIdRes = meetingsRes.addResource('{meetingId}');
    const joinRes = meetingIdRes.addResource('join');
    joinRes.addMethod('POST', new apigw.LambdaIntegration(meetingJoinFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /scheduled-calls/bulk - Bulk create scheduled calls (sync, up to 500)
    const scheduledCallsBulkRes = scheduledCallsRes.addResource('bulk');
    scheduledCallsBulkRes.addMethod('POST', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /scheduled-calls/async-bulk - Async bulk scheduling for 30K+ calls
    const scheduledCallsAsyncBulkRes = scheduledCallsRes.addResource('async-bulk');
    scheduledCallsAsyncBulkRes.addMethod('POST', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /bulk-jobs - List and query bulk scheduling jobs
    const bulkJobsRes = this.api.root.addResource('bulk-jobs');
    bulkJobsRes.addMethod('GET', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /bulk-jobs/{jobId} - Get individual bulk job status
    const bulkJobIdRes = bulkJobsRes.addResource('{jobId}');
    bulkJobIdRes.addMethod('GET', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /scheduled-calls/{callId} - Individual scheduled call
    const scheduledCallIdRes = scheduledCallsRes.addResource('{callId}');
    scheduledCallIdRes.addMethod('GET', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    scheduledCallIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.outboundSchedulerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /clinic-hours/{clinicId} - Clinic business hours (for Voice AI)
    const clinicHoursRes = this.api.root.addResource('clinic-hours');
    const clinicHoursClinicRes = clinicHoursRes.addResource('{clinicId}');
    clinicHoursClinicRes.addMethod('GET', new apigw.LambdaIntegration(this.voiceConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    clinicHoursClinicRes.addMethod('PUT', new apigw.LambdaIntegration(this.voiceConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // ========================================
    // CONVERSATION HISTORY ENDPOINTS
    // ========================================
    // Provides visibility into AI agent conversations for audit and analytics

    // /conversations - List conversations with filters
    const conversationsRes = this.api.root.addResource('conversations');
    conversationsRes.addMethod('GET', new apigw.LambdaIntegration(this.conversationHistoryFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /conversations/stats - Get conversation analytics/statistics
    const conversationsStatsRes = conversationsRes.addResource('stats');
    conversationsStatsRes.addMethod('GET', new apigw.LambdaIntegration(this.conversationHistoryFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /conversations/{sessionId} - Get or delete specific conversation
    const conversationIdRes = conversationsRes.addResource('{sessionId}');
    conversationIdRes.addMethod('GET', new apigw.LambdaIntegration(this.conversationHistoryFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    conversationIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.conversationHistoryFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // ========================================
    // WEBSOCKET API (Public - for website chatbot)
    // ========================================

    this.websocketApi = new apigwv2.WebSocketApi(this, 'AiAgentsWebSocketApi', {
      apiName: 'ai-agents-websocket-api',
      description: 'WebSocket API for AI Agents public chat with thinking/trace streaming',
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('WsConnectIntegration', this.wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('WsDisconnectIntegration', this.wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('WsMessageIntegration', this.wsMessageFn),
      },
    });

    const websocketStage = new apigwv2.WebSocketStage(this, 'AiAgentsWebSocketStage', {
      webSocketApi: this.websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Map AI Agents WebSocket to /ai-agents path on existing ws.todaysdentalinsights.com domain
    // CRITICAL FIX: Import the domain from ChatbotStack and use L2 ApiMapping construct
    // This ensures proper stage reference handling (CfnApiMapping has stage reference issues)
    const importedWsDomain = apigwv2.DomainName.fromDomainNameAttributes(this, 'ImportedWebSocketDomain', {
      name: props.webSocketDomainName,
      regionalDomainName: props.webSocketRegionalDomainName,
      regionalHostedZoneId: props.webSocketRegionalHostedZoneId,
    });

    // CRITICAL FIX: Use CfnApiMapping (L1) with explicit stage ID to avoid "Invalid stage identifier" errors
    // The L2 ApiMapping sometimes has timing issues where CloudFormation validates the stage before it exists
    const wsApiMapping = new apigwv2.CfnApiMapping(this, 'AiAgentsWebSocketMapping', {
      apiId: this.websocketApi.apiId,
      domainName: importedWsDomain.name,
      stage: websocketStage.stageName,
      apiMappingKey: 'ai-agents',
    });

    // Explicit dependency ensures the stage is fully created before the mapping
    wsApiMapping.addDependency(websocketStage.node.defaultChild as apigwv2.CfnStage);

    // ========================================
    // DOMAIN MAPPING (REST API)
    // ========================================

    new apigw.CfnBasePathMapping(this, 'AiAgentsApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'ai-agents',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AiAgentsTableName', {
      value: this.agentsTable.tableName,
      exportName: `${Stack.of(this).stackName}-AiAgentsTableName`,
    });

    // CRITICAL FIX: Export ARN for cross-stack IAM permissions (used by AnalyticsStack)
    new CfnOutput(this, 'AiAgentsTableArn', {
      value: this.agentsTable.tableArn,
      description: 'AI Agents table ARN for cross-stack IAM policies',
      exportName: `${Stack.of(this).stackName}-AiAgentsTableArn`,
    });

    new CfnOutput(this, 'BedrockAgentRoleArn', {
      value: this.bedrockAgentRole.roleArn,
      exportName: `${Stack.of(this).stackName}-BedrockAgentRoleArn`,
    });

    new CfnOutput(this, 'ActionGroupLambdaArn', {
      value: this.actionGroupFn.functionArn,
      exportName: `${Stack.of(this).stackName}-ActionGroupLambdaArn`,
    });

    new CfnOutput(this, 'AiAgentsApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/ai-agents/',
      exportName: `${Stack.of(this).stackName}-AiAgentsApiUrl`,
    });

    new CfnOutput(this, 'AiAgentsWebSocketUrl', {
      value: 'wss://ws.todaysdentalinsights.com/ai-agents',
      description: 'WebSocket URL for public AI Agent chat with thinking stream',
      exportName: `${Stack.of(this).stackName}-AiAgentsWebSocketUrl`,
    });

    new CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      exportName: `${Stack.of(this).stackName}-ConnectionsTableName`,
    });

    new CfnOutput(this, 'ConversationsTableName', {
      value: this.conversationsTable.tableName,
      description: 'AI Agent Conversations table for chat history and analytics',
      exportName: `${Stack.of(this).stackName}-ConversationsTableName`,
    });

    new CfnOutput(this, 'ConversationsTableArn', {
      value: this.conversationsTable.tableArn,
      description: 'Conversations table ARN for cross-stack IAM policies',
      exportName: `${Stack.of(this).stackName}-ConversationsTableArn`,
    });

    new CfnOutput(this, 'VoiceSessionsTableName', {
      value: this.voiceSessionsTable.tableName,
      exportName: `${Stack.of(this).stackName}-VoiceSessionsTableName`,
    });

    // CRITICAL FIX: Export ARN for cross-stack IAM permissions (used by AnalyticsStack)
    new CfnOutput(this, 'VoiceSessionsTableArn', {
      value: this.voiceSessionsTable.tableArn,
      description: 'Voice Sessions table ARN for cross-stack IAM policies',
      exportName: `${Stack.of(this).stackName}-VoiceSessionsTableArn`,
    });

    new CfnOutput(this, 'ClinicHoursTableName', {
      value: this.clinicHoursTable.tableName,
      description: 'Shared Clinic Hours table (imported from ClinicHoursStack)',
      exportName: `${Stack.of(this).stackName}-ClinicHoursTableName`,
    });

    new CfnOutput(this, 'VoiceConfigTableName', {
      value: this.voiceConfigTable.tableName,
      exportName: `${Stack.of(this).stackName}-VoiceConfigTableName`,
    });

    new CfnOutput(this, 'ScheduledCallsTableName', {
      value: this.scheduledCallsTable.tableName,
      exportName: `${Stack.of(this).stackName}-ScheduledCallsTableName`,
    });

    new CfnOutput(this, 'BulkOutboundJobsTableName', {
      value: this.bulkOutboundJobsTable.tableName,
      description: 'Bulk outbound jobs table for tracking 30K+ call scheduling',
      exportName: `${Stack.of(this).stackName}-BulkOutboundJobsTableName`,
    });

    new CfnOutput(this, 'AiAgentsMetricsTableName', {
      value: this.aiAgentsMetricsTable.tableName,
      description: 'AI Agents metrics table for tracking appointments booked/used/cancelled/rescheduled and bills paid',
      exportName: `${Stack.of(this).stackName}-AiAgentsMetricsTableName`,
    });

    new CfnOutput(this, 'AiAgentsMetricsTableArn', {
      value: this.aiAgentsMetricsTable.tableArn,
      description: 'AI Agents metrics table ARN for cross-stack IAM policies',
      exportName: `${Stack.of(this).stackName}-AiAgentsMetricsTableArn`,
    });

    new CfnOutput(this, 'OutboundCallQueueUrl', {
      value: this.outboundCallQueue.queueUrl,
      description: 'SQS queue URL for async bulk call processing',
      exportName: `${Stack.of(this).stackName}-OutboundCallQueueUrl`,
    });

    new CfnOutput(this, 'VoiceAiFunctionArn', {
      value: this.voiceAiFn.functionArn,
      description: 'Voice AI handler Lambda ARN - for Chime SIP integration',
      exportName: `${Stack.of(this).stackName}-VoiceAiFunctionArn`,
    });

    new CfnOutput(this, 'SchedulerRoleArn', {
      value: this.schedulerRole.roleArn,
      exportName: `${Stack.of(this).stackName}-SchedulerRoleArn`,
    });

    // NOTE: CallAnalyticsTable is now imported from AnalyticsStack, not created here.
    // This prevents data fragmentation between AI-written and Chime stream records.
    if (props.callAnalyticsTableName) {
      new CfnOutput(this, 'SharedCallAnalyticsTableName', {
        value: props.callAnalyticsTableName,
        description: 'Shared Call Analytics table (from AnalyticsStack) for unified tracking',
      });
    }

    new CfnOutput(this, 'CallRecordingsBucketName', {
      value: this.callRecordingsBucket.bucketName,
      description: props.sharedRecordingsBucketName
        ? 'Shared recordings bucket (from ChimeStack)'
        : 'Dedicated AI recordings bucket (consider using shared bucket from ChimeStack)',
      exportName: `${Stack.of(this).stackName}-CallRecordingsBucketName`,
    });

    new CfnOutput(this, 'InsuranceImageBucketName', {
      value: this.insuranceImageBucket.bucketName,
      description: 'Temporary storage for insurance card images during Textract processing',
      exportName: `${Stack.of(this).stackName}-InsuranceImageBucketName`,
    });

    new CfnOutput(this, 'InsuranceTextractFunctionArn', {
      value: this.insuranceTextractFn.functionArn,
      description: 'Insurance card Textract handler Lambda ARN',
      exportName: `${Stack.of(this).stackName}-InsuranceTextractFunctionArn`,
    });

    // NOTE: Table name exports for ChimeStack Voice AI integration are already
    // defined above (AiAgentsTableName, ClinicHoursTableName, VoiceConfigTableName,
    // ScheduledCallsTableName). Do not add duplicate exports here.

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.agentsFn, name: 'ai-agents-crud', durationMs: 48000 },
      { fn: this.invokeAgentFn, name: 'invoke-agent', durationMs: 240000 },
      { fn: this.actionGroupFn, name: 'action-group', durationMs: 96000 },
      { fn: this.wsConnectFn, name: 'ws-connect', durationMs: 24000 },
      { fn: this.wsDisconnectFn, name: 'ws-disconnect', durationMs: 24000 },
      { fn: this.wsMessageFn, name: 'ws-message', durationMs: 240000 },
      { fn: this.voiceAiFn, name: 'voice-ai', durationMs: 240000 },
      { fn: this.voiceConfigFn, name: 'voice-config', durationMs: 24000 },
      { fn: this.conversationHistoryFn, name: 'conversation-history', durationMs: 48000 },
      { fn: this.outboundSchedulerFn, name: 'outbound-scheduler', durationMs: 144000 }, // 3 min timeout for bulk
      { fn: this.outboundExecutorFn, name: 'outbound-executor', durationMs: 240000 },
      { fn: this.insuranceTextractFn, name: 'insurance-textract', durationMs: 48000 },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.agentsTable.tableName, 'AiAgentTable');
    createDynamoThrottleAlarm(this.sessionsTable.tableName, 'AiAgentSessionsTable');
    createDynamoThrottleAlarm(this.conversationsTable.tableName, 'AiAgentConversationsTable');
    createDynamoThrottleAlarm(this.circuitBreakerTable.tableName, 'CircuitBreakerTable');
    createDynamoThrottleAlarm(this.voiceSessionsTable.tableName, 'VoiceSessionsTable');
    createDynamoThrottleAlarm(this.clinicHoursTable.tableName, 'ClinicHoursTable');
    createDynamoThrottleAlarm(this.voiceConfigTable.tableName, 'VoiceConfigTable');
    createDynamoThrottleAlarm(this.scheduledCallsTable.tableName, 'ScheduledCallsTable');
    createDynamoThrottleAlarm(this.aiAgentsMetricsTable.tableName, 'AiAgentsMetricsTable');
    // NOTE: CallAnalytics table throttle alarm is in AnalyticsStack (shared table)
  }
}
