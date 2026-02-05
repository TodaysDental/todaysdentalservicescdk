import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, Tags, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
// Use clinic-config.json for CDK synthesis (non-sensitive data only)
import clinicConfigData from '../configs/clinic-config.json';

// Map clinic config to the format expected by the stack
const clinicsData = clinicConfigData.map((c: any) => ({
  clinicId: c.clinicId,
  clinicName: c.clinicName,
  phoneNumber: c.phoneNumber,
  aiPhoneNumber: c.aiPhoneNumber || '', // AI phone number (Connect/Lex) used for after-hours forwarding
  timezone: c.timezone,
  clinicAddress: c.clinicAddress,
  clinicCity: c.clinicCity,
  clinicState: c.clinicState,
  clinicZipCode: c.clinicZipCode,
  clinicPhone: c.clinicPhone,
  clinicEmail: c.clinicEmail,
  websiteLink: c.websiteLink,
  logoUrl: c.logoUrl,
  mapsUrl: c.mapsUrl,
  scheduleUrl: c.scheduleUrl,
}));

// Type alias for backward compatibility
type Clinic = typeof clinicsData[number];

export interface ChimeStackProps extends StackProps {
  jwtSecret: string;
  api?: apigw.RestApi;
  /**
   * Optional list of CIDR blocks that are allowed to send SIP traffic to the
   * Amazon Chime Voice Connector termination endpoint. Each CIDR must have a
   * prefix of /27 or smaller as required by the service.
   *
   * Termination settings control outbound calling permissions only. Inbound
   * routing continues to flow through the origination routes and SIP rule
   * resources defined later in this stack, so leaving this undefined will not
   * block phone numbers from reaching the contact center.
   */
  voiceConnectorTerminationCidrs?: string[];
  /**
   * Optional list of origination routes that allow the contact center to
   * receive inbound calls from an external SIP provider. When undefined we
   * skip provisioning the origination custom resource entirely which avoids
   * submitting placeholder hosts that Amazon Chime Voice Connector rejects.
   */
  voiceConnectorOriginationRoutes?: VoiceConnectorOriginationRouteConfig[];
  /**
   * Analytics table name for storing call analytics (post-call via DynamoDB Stream)
   */
  analyticsTableName?: string;
  /**
   * Analytics deduplication table name (used by CallQueue stream processor)
   */
  analyticsDedupTableName?: string;
  /**
   * Enable call recording (default: true)
   */
  enableCallRecording?: boolean;
  /**
   * Optional external recordings bucket name for Chime call recordings.
   * When provided (with sharedRecordingsBucketArn), ChimeStack will use this bucket
   * instead of creating a dedicated recordings bucket.
   */
  sharedRecordingsBucketName?: string;
  /**
   * ARN for the external recordings bucket.
   * Required when sharedRecordingsBucketName is provided.
   */
  sharedRecordingsBucketArn?: string;
  /**
   * Optional Amazon Connect call recordings bucket (Connect/Lex AI calls).
   * When set, the /admin/recordings/call/{callId} endpoint can also serve Connect recordings
   * for callIds in the form `connect-{ContactId}`.
   */
  connectCallRecordingsBucketName?: string;
  /**
   * Optional prefix inside the Connect call recordings bucket.
   * Example: "connect/todaysdentalcommunications/CallRecordings"
   */
  connectCallRecordingsPrefix?: string;
  /**
   * Optional KMS key ARN used to encrypt Connect call recordings in S3.
   * If provided, GetRecording will be granted kms:Decrypt on this key.
   */
  connectCallRecordingsKmsKeyArn?: string;
  /**
   * Recording retention period in days (default: 2555 days / ~7 years)
   */
  recordingRetentionDays?: number;
  /**
   * Custom vocabulary name for medical/dental transcription
   */
  medicalVocabularyName?: string;

  /**
   * AWS region for Chime SDK Media operations (meetings, voice).
   * Chime SDK Meetings only supports specific regions. Common options:
   * - 'us-east-1' (N. Virginia) - Default
   * - 'us-west-2' (Oregon)
   * - 'eu-west-2' (London)
   * - 'ap-southeast-1' (Singapore)
   * 
   * See: https://docs.aws.amazon.com/chime-sdk/latest/dg/sdk-available-regions.html
   * @default 'us-east-1'
   */
  chimeMediaRegion?: string;

  // ========================================
  // AFTER-HOURS FORWARDING (Connect/Lex AI)
  // ========================================

  /**
   * Clinic Hours table name for checking business hours.
   * Used by the SMA handler to determine open/closed.
   */
  clinicHoursTableName?: string;

  /**
   * Voice Config table name (per-clinic inbound AI toggle).
   * Used to decide whether after-hours calls should be forwarded.
   */
  voiceConfigTableName?: string;

  /**
   * Enable after-hours forwarding to `clinic.aiPhoneNumber` (Connect/Lex AI).
   * When false, Chime will not attempt after-hours forwarding.
   */
  enableAfterHoursAi?: boolean;

  // ========================================
  // PUSH NOTIFICATIONS INTEGRATION (from PushNotificationsStack)
  // ========================================

  /**
   * Device tokens table name for looking up registered mobile devices
   */
  deviceTokensTableName?: string;

  /**
   * Device tokens table ARN for IAM permissions
   */
  deviceTokensTableArn?: string;

  /**
   * Send push Lambda function ARN for invoking push notifications
   */
  sendPushFunctionArn?: string;

  // ========================================
  // PERFORMANCE OPTIMIZATION
  // ========================================

  /**
   * Enable provisioned concurrency for critical Lambdas (e.g., SMA handler).
   * Reduces cold start latency but incurs additional cost.
   * @default false
   */
  enableProvisionedConcurrency?: boolean;

  /**
   * Number of provisioned concurrent instances for Inbound Router (SMA Handler) Lambda.
   * Only used when enableProvisionedConcurrency is true.
   * @default 5
   */
  inboundRouterProvisionedConcurrency?: number;
}

export type VoiceConnectorOriginationProtocol = 'UDP' | 'TCP' | 'TLS';

export interface VoiceConnectorOriginationRouteConfig {
  host: string;
  port?: number;
  protocol?: VoiceConnectorOriginationProtocol;
  priority?: number;
  weight?: number;
}

export class ChimeStack extends Stack {
  public readonly clinicsTable: dynamodb.Table;
  public readonly agentPresenceTable: dynamodb.Table;
  public readonly agentActiveTable: dynamodb.Table;
  public readonly callQueueTable: dynamodb.Table;
  public readonly locksTable: dynamodb.Table;
  public readonly agentPerformanceTable: dynamodb.Table;
  public readonly recordingMetadataTable?: dynamodb.Table;
  public readonly recordingsBucket?: s3.IBucket;
  public readonly holdMusicBucket?: s3.IBucket;

  constructor(scope: Construct, id: string, props: ChimeStackProps) {
    super(scope, id, props);

    // ========================================
    // AFTER-HOURS FORWARDING CONFIG (Connect/Lex AI)
    // ========================================
    // Chime does NOT host AI conversations anymore. When enabled, the SIP Media Application
    // will forward closed-clinic calls to the clinic's `aiPhoneNumber` (handled by Connect/Lex).
    const resolvedClinicHoursTableName = props.clinicHoursTableName;
    const resolvedVoiceConfigTableName = props.voiceConfigTableName;

    if (props.enableAfterHoursAi) {
      const missingProps: string[] = [];
      if (!resolvedClinicHoursTableName) missingProps.push('clinicHoursTableName');
      if (!resolvedVoiceConfigTableName) missingProps.push('voiceConfigTableName');

      if (missingProps.length > 0) {
        throw new Error(
          `[ChimeStack] CONFIGURATION ERROR: enableAfterHoursAi is true but required props are missing: ` +
          `${missingProps.join(', ')}. ` +
          `Required props: clinicHoursTableName, voiceConfigTableName.`
        );
      }

      console.log('[ChimeStack] After-hours forwarding enabled (Connect/Lex handles AI calls).');
    }

    // ========================================
    // CHIME MEDIA REGION CONFIGURATION
    // ========================================
    // Chime SDK Meetings only supports specific regions for media processing.
    // Default to us-east-1 which has the best coverage for Chime SDK features.
    const chimeMediaRegion = props.chimeMediaRegion || 'us-east-1';
    console.log(`[ChimeStack] Using Chime Media Region: ${chimeMediaRegion}`);

    // Stack-wide tagging helper
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Chime',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    // ========================================
    // 1. DynamoDB Tables
    // ========================================

    // Clinics table (holds Chime meeting info per clinic)

    this.clinicsTable = new dynamodb.Table(this, 'ClinicsTable', {
      tableName: `${this.stackName}-Clinics`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });
    applyTags(this.clinicsTable, { Table: 'clinics' });

    // Add GSI for phoneNumber lookups
    this.clinicsTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Seed Clinics Table with data from clinics.json
    // Uses a single AwsCustomResource with batched SDK calls to avoid
    // IAM policy size limits (previously used 27+ individual AwsCustomResource
    // calls which exceeded the 10KB inline policy limit on the shared Lambda role)
    // ========================================

    // Prepare clinic data for seeding - filter to only those with phone numbers
    // Include ALL clinic fields to ensure complete information is available
    const clinicsToSeed = (clinicsData as Clinic[])
      .filter(c => c.phoneNumber)
      .map(c => ({
        PutRequest: {
          Item: {
            clinicId: { S: c.clinicId },
            phoneNumber: { S: c.phoneNumber },
            clinicName: { S: c.clinicName || c.clinicId },
            aiPhoneNumber: { S: c.aiPhoneNumber || '' },
            timezone: { S: c.timezone || 'America/New_York' },
            clinicAddress: { S: c.clinicAddress || '' },
            clinicCity: { S: c.clinicCity || '' },
            clinicState: { S: c.clinicState || '' },
            clinicZipCode: { S: c.clinicZipCode || '' },
            clinicPhone: { S: c.clinicPhone || '' },
            clinicEmail: { S: c.clinicEmail || '' },
            websiteLink: { S: c.websiteLink || '' },
            logoUrl: { S: c.logoUrl || '' },
            mapsUrl: { S: c.mapsUrl || '' },
            scheduleUrl: { S: c.scheduleUrl || '' },
          },
        },
      }));

    // DynamoDB BatchWriteItem supports max 25 items per request, so we need to chunk
    // For initial seeding, we'll use multiple AwsCustomResource calls but with a
    // dedicated role to avoid the policy size limit
    const seedClinicsRole = new iam.Role(this, 'SeedClinicsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant write access to the clinics table
    this.clinicsTable.grantWriteData(seedClinicsRole);

    // Chunk the clinics into batches of 25 (DynamoDB BatchWriteItem limit)
    const chunkSize = 25;
    const clinicChunks: typeof clinicsToSeed[] = [];
    for (let i = 0; i < clinicsToSeed.length; i += chunkSize) {
      clinicChunks.push(clinicsToSeed.slice(i, i + chunkSize));
    }

    // Create one AwsCustomResource per chunk, all sharing the same role
    clinicChunks.forEach((chunk, index) => {
      new customResources.AwsCustomResource(this, `SeedClinicsBatch${index}`, {
        onCreate: {
          service: 'DynamoDB',
          action: 'batchWriteItem',
          parameters: {
            RequestItems: {
              [this.clinicsTable.tableName]: chunk,
            },
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`SeedClinicsBatch${index}-v3`),
        },
        // On update, we use transactWrite to update existing items
        onUpdate: {
          service: 'DynamoDB',
          action: 'batchWriteItem',
          parameters: {
            RequestItems: {
              [this.clinicsTable.tableName]: chunk,
            },
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`SeedClinicsBatch${index}-v3`),
        },
        role: seedClinicsRole,
        policy: customResources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: customResources.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      });
    });

    // Agent Presence table
    this.agentPresenceTable = new dynamodb.Table(this, 'AgentPresenceTable', {
      tableName: `${this.stackName}-AgentPresence`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.agentPresenceTable, { Table: 'agent-presence' });

    // GSI for querying by clinic
    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status - CRITICAL for finding online agents
    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Agent Active table (push-first inbound routing source of truth)
    // PK: clinicId, SK: agentId
    // Tracks which agents are actively receiving call offers for a clinic.
    this.agentActiveTable = new dynamodb.Table(this, 'AgentActiveTable', {
      tableName: `${this.stackName}-AgentActive`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      // Optional: TTL can be used later to auto-expire stale active rows
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.agentActiveTable, { Table: 'agent-active' });

    // GSI to quickly look up all clinics for a given agentId (for global inactivation / diagnostics)
    this.agentActiveTable.addGlobalSecondaryIndex({
      indexName: 'agentId-index',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });


    // Call Queue table - V2 with corrected GSI types
    this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
      tableName: `${this.stackName}-CallQueueV2`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queuePosition', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streaming for call analytics
    });
    applyTags(this.callQueueTable, { Table: 'call-queue' });

    // GSI for querying by callId
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'callId-index',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by phoneNumber + clinicId (for history / callbacks)
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-clinicId-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by phoneNumber + queueEntryTime (for call history by time)
    // Using NUMBER type for efficient timestamp queries
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-queueEntryTime-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queueEntryTime', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by pstnCallId (for recording metadata lookups)
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'pstnCallId-index',
      partitionKey: { name: 'pstnCallId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Locks table for distributed locking on call assignments
    this.locksTable = new dynamodb.Table(this, 'LocksTable', {
      tableName: `${this.stackName}-Locks`,
      partitionKey: { name: 'lockKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.locksTable, { Table: 'locks' });

    // Agent Performance table - tracks agent metrics and performance
    this.agentPerformanceTable = new dynamodb.Table(this, 'AgentPerformanceTable', {
      tableName: `${this.stackName}-AgentPerformance`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'periodDate', type: dynamodb.AttributeType.STRING }, // Format: YYYY-MM-DD for daily aggregates
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Keep performance data for historical records
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streaming for real-time analytics
    });
    applyTags(this.agentPerformanceTable, { Table: 'agent-performance' });

    // GSI for querying by clinic and date
    this.agentPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-periodDate-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'periodDate', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by performance score
    this.agentPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-performanceScore-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'performanceScore', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // 2. Chime SIP Media Application
    // ========================================

    // Lambda for SIP Media Application
    const smaHandler = new lambdaNode.NodejsFunction(this, 'SmaHandler', {
      functionName: `${this.stackName}-SmaHandler`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'inbound-router.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        HOLD_MUSIC_BUCKET: '', // Will be updated after bucket creation
        CHIME_MEDIA_REGION: chimeMediaRegion,
        // Marketing voice call analytics (NotificationsStack export)
        VOICE_CALL_ANALYTICS_TABLE: Fn.importValue('TodaysDentalInsightsNotificationsN1-VoiceCallAnalyticsTableName'),
        // After-hours forwarding (Connect/Lex AI)
        ENABLE_AFTER_HOURS_AI: props.enableAfterHoursAi ? 'true' : 'false',
        CLINIC_HOURS_TABLE: resolvedClinicHoursTableName || '',
        VOICE_CONFIG_TABLE: resolvedVoiceConfigTableName || '',
        // Push Notifications Integration
        DEVICE_TOKENS_TABLE: props.deviceTokensTableName || '',
        SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn || '',
      },
    });

    // Grant DynamoDB permissions
    this.clinicsTable.grantReadData(smaHandler);
    this.agentPresenceTable.grantReadWriteData(smaHandler);
    this.agentActiveTable.grantReadWriteData(smaHandler);
    this.callQueueTable.grantReadWriteData(smaHandler);
    this.locksTable.grantReadWriteData(smaHandler);

    // Marketing voice call analytics table (in NotificationsStack)
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${Fn.importValue('TodaysDentalInsightsNotificationsN1-VoiceCallAnalyticsTableName')}`,
      ],
    }));

    // After-hours forwarding requires reading clinic hours + per-clinic AI inbound toggle.
    if (resolvedClinicHoursTableName) {
      smaHandler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${resolvedClinicHoursTableName}`],
      }));
    }

    if (resolvedVoiceConfigTableName) {
      smaHandler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${resolvedVoiceConfigTableName}`],
      }));
    }

    // ========================================
    // PUSH NOTIFICATIONS PERMISSIONS
    // ========================================
    if (props.deviceTokensTableArn) {
      smaHandler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [
          props.deviceTokensTableArn,
          `${props.deviceTokensTableArn}/index/*`,
        ],
      }));
    }

    if (props.sendPushFunctionArn) {
      smaHandler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }

    // Grant Chime SDK permissions
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // SIP Media Application actions
        'chime:CreateSipMediaApplicationCall',
        'chime:UpdateSipMediaApplicationCall',
        // Include both old namespace and new namespace for meetings
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        // SDK meetings namespace
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
        // CRITICAL: Real-time meeting transcription for natural language AI
        // Required for StartMeetingTranscription API called after JoinChimeMeeting
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
        'chime-sdk-meetings:StartMeetingTranscription',
        'chime-sdk-meetings:StopMeetingTranscription',
        // Media Insights Pipeline for real-time transcription (fallback)
        'chime:CreateMediaInsightsPipeline',
        'chimesdkmediapipelines:CreateMediaInsightsPipeline',
      ],
      resources: ['*'],
    }));

    // Grant Transcribe permissions for real-time transcription
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartStreamTranscription',
        'transcribe:StartStreamTranscriptionWebSocket',
      ],
      resources: ['*'],
    }));

    // Allow SMA handler to synthesize TTS for PlayAudio fallback
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // Grant KVS permissions for Media Insights Pipeline
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kinesisvideo:DescribeStream',
        'kinesisvideo:GetDataEndpoint',
      ],
      resources: [`arn:aws:kinesisvideo:${this.region}:${this.account}:stream/*`],
    }));

    // Grant Kinesis permissions for analytics (if stream is provided)

    // Create S3 bucket for hold music and streaming TTS audio
    const holdMusicBucket = new s3.Bucket(this, 'HoldMusicBucket', {
      bucketName: `${this.stackName.toLowerCase()}-hold-music-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // FIX: Add lifecycle rules to auto-delete streaming TTS audio files
      // S3 "Expires" header is metadata only - it does NOT delete objects.
      // Lifecycle rules are required for actual deletion.
      // NOTE: S3 lifecycle rules require expiration in whole days (minimum 1 day)
      lifecycleRules: [
        {
          id: 'DeleteStreamingTTSAudio',
          prefix: 'tts/', // Streaming TTS files are stored under tts/{callId}/
          expiration: Duration.days(1), // Delete after 1 day (minimum for S3 lifecycle)
          enabled: true,
        },
      ],
    });

    // Assign to class property for access from other stacks
    this.holdMusicBucket = holdMusicBucket;

    // Grant read/write access to the SMA handler (read for PlayAudio, write for streaming TTS)
    holdMusicBucket.grantReadWrite(smaHandler);

    // Allow the Amazon Chime Voice Connector service to stream audio prompts
    // directly from the bucket when executing PlayAudio actions.
    holdMusicBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowChimeVoiceConnectorAccess',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [holdMusicBucket.arnForObjects('*')],
    }));

    // Update the environment variable
    smaHandler.addEnvironment('HOLD_MUSIC_BUCKET', holdMusicBucket.bucketName);

    // Upload audio files from local assets directory
    new s3deploy.BucketDeployment(this, 'DeployHoldMusic', {
      sources: [
        // Hold music bucket is used for Chime SMA PlayAudio (WAV prompts)
        // Keep MP3 files out of this bucket to avoid incorrect content-type metadata.
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'assets', 'audio'), {
          exclude: ['*.mp3'],
        })
      ],
      destinationBucket: holdMusicBucket,
      prune: false,
      // CRITICAL: Set correct content type for Chime SMA compatibility
      // Chime SMA requires 'audio/wav' not 'audio/x-wav'
      contentType: 'audio/wav',
    });

    // ========================================
    // PROVISIONED CONCURRENCY FOR SMA HANDLER
    // ========================================
    // Add provisioned concurrency for the inbound router (SMA handler)
    // to reduce cold start latency for incoming calls
    if (props.enableProvisionedConcurrency) {
      console.log('[ChimeStack] Configuring provisioned concurrency for SMA Handler (inbound-router)');

      const smaHandlerAlias = new lambda.Alias(this, 'SmaHandlerAlias', {
        aliasName: 'live',
        version: smaHandler.currentVersion,
        provisionedConcurrentExecutions: props.inboundRouterProvisionedConcurrency ?? 5,
      });

      console.log(`[ChimeStack] SMA Handler: ${props.inboundRouterProvisionedConcurrency ?? 5} provisioned instances`);

      new CfnOutput(this, 'SmaHandlerAliasArn', {
        value: smaHandlerAlias.functionArn,
        description: 'SMA Handler Lambda alias with provisioned concurrency',
        exportName: `${this.stackName}-SmaHandlerAliasArn`,
      });
    }

    const chimeCustomResourceRole = new iam.Role(this, 'ChimeVoiceCustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Shared role for Chime Voice custom resources',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // LEGACY Chime namespace (needed temporarily to clean up existing failed resources)
        // TODO: Remove these after successful deployment of new resources
        'chime:AssociatePhoneNumbersWithVoiceConnector',
        'chime:CreateSipMediaApplication',
        'chime:CreateSipRule',
        'chime:CreateVoiceConnector',
        'chime:DeleteSipMediaApplication',
        'chime:DeleteSipRule',
        'chime:DeleteVoiceConnector',
        'chime:DeleteVoiceConnectorOrigination',
        'chime:DeleteVoiceConnectorStreamingConfiguration',
        'chime:DeleteVoiceConnectorTermination',
        'chime:DisassociatePhoneNumbersFromVoiceConnector',
        'chime:GetSipMediaApplication',
        'chime:GetSipRule',
        'chime:GetVoiceConnector',
        'chime:GetVoiceConnectorOrigination',
        'chime:GetVoiceConnectorStreamingConfiguration',
        'chime:GetVoiceConnectorTermination',
        'chime:ListPhoneNumbers',
        'chime:ListSipMediaApplications',
        'chime:ListSipRules',
        'chime:ListVoiceConnectors',
        'chime:PutSipMediaApplicationLoggingConfiguration',
        'chime:PutVoiceConnectorOrigination',
        'chime:PutVoiceConnectorStreamingConfiguration',
        'chime:PutVoiceConnectorTermination',
        'chime:UpdateSipRule',
        'chime:StartVoiceToneAnalysisTask',
        'chime:StartSpeakerSearchTask',
        // NEW Chime SDK Voice namespace (for new resources)
        'chime-sdk-voice:AssociatePhoneNumbersWithVoiceConnector',
        'chime-sdk-voice:CreateSipMediaApplication',
        'chime-sdk-voice:CreateSipRule',
        'chime-sdk-voice:CreateVoiceConnector',
        'chime-sdk-voice:DeleteSipMediaApplication',
        'chime-sdk-voice:DeleteSipRule',
        'chime-sdk-voice:DeleteVoiceConnector',
        'chime-sdk-voice:DeleteVoiceConnectorOrigination',
        'chime-sdk-voice:DeleteVoiceConnectorStreamingConfiguration',
        'chime-sdk-voice:DeleteVoiceConnectorTermination',
        'chime-sdk-voice:DisassociatePhoneNumbersFromVoiceConnector',
        'chime-sdk-voice:GetSipMediaApplication',
        'chime-sdk-voice:GetSipRule',
        'chime-sdk-voice:GetVoiceConnector',
        'chime-sdk-voice:GetVoiceConnectorOrigination',
        'chime-sdk-voice:GetVoiceConnectorStreamingConfiguration',
        'chime-sdk-voice:GetVoiceConnectorTermination',
        'chime-sdk-voice:ListPhoneNumbers',
        'chime-sdk-voice:ListSipMediaApplications',
        'chime-sdk-voice:ListSipRules',
        'chime-sdk-voice:ListVoiceConnectors',
        'chime-sdk-voice:PutSipMediaApplicationLoggingConfiguration',
        'chime-sdk-voice:PutVoiceConnectorOrigination',
        'chime-sdk-voice:PutVoiceConnectorStreamingConfiguration',
        'chime-sdk-voice:PutVoiceConnectorTermination',
        'chime-sdk-voice:UpdateSipRule',
        'chime-sdk-voice:StartVoiceToneAnalysisTask',
        'chime-sdk-voice:StartSpeakerSearchTask',
      ],
      resources: ['*'],
    }));

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogDelivery',
        'logs:DeleteLogDelivery',
        'logs:DescribeLogGroups',
        'logs:DescribeResourcePolicies',
        'logs:GetLogDelivery',
        'logs:ListLogDeliveries',
        'logs:PutResourcePolicy',
        'logs:UpdateLogDelivery',
      ],
      resources: ['*'],
    }));

    // CRITICAL FIX: Add Media Pipelines permissions for Voice Connector streaming with Media Insights
    // When VCStreamingConfig references a MediaInsightsPipelineConfiguration, the role needs access
    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Legacy chime namespace
        'chime:CreateMediaInsightsPipelineConfiguration',
        'chime:DeleteMediaInsightsPipelineConfiguration',
        'chime:GetMediaInsightsPipelineConfiguration',
        'chime:ListMediaInsightsPipelineConfigurations',
        'chime:UpdateMediaInsightsPipelineConfiguration',
        'chime:TagResource',
        'chime:UntagResource',
        // New ChimeSDKMediaPipelines namespace
        'chimesdkmediapipelines:CreateMediaInsightsPipelineConfiguration',
        'chimesdkmediapipelines:DeleteMediaInsightsPipelineConfiguration',
        'chimesdkmediapipelines:GetMediaInsightsPipelineConfiguration',
        'chimesdkmediapipelines:ListMediaInsightsPipelineConfigurations',
        'chimesdkmediapipelines:UpdateMediaInsightsPipelineConfiguration',
        'chimesdkmediapipelines:TagResource',
        'chimesdkmediapipelines:UntagResource',
      ],
      resources: ['*'],
    }));

    // CRITICAL FIX: Add Kinesis permissions for Media Insights Pipeline validation
    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kinesis:DescribeStream',
        'kinesis:DescribeStreamSummary',
      ],
      resources: [`arn:aws:kinesis:${this.region}:${this.account}:stream/${this.stackName}-*`],
    }));

    // CRITICAL FIX: Add IAM PassRole for media pipeline roles
    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [`arn:aws:iam::${this.account}:role/${this.stackName}-*`],
    }));

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:AddPermission', 'lambda:GetPolicy'],
      resources: [smaHandler.functionArn],
    }));

    // Create Voice Connector - FIX: Capture the ID correctly
    const voiceConnector = new customResources.AwsCustomResource(this, 'VoiceConnector', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createVoiceConnector',
        parameters: {
          Name: `${this.stackName}-VC`,
          RequireEncryption: true,
          AwsRegion: this.region,
        },
        physicalResourceId: customResources.PhysicalResourceId.fromResponse('VoiceConnector.VoiceConnectorId'),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteVoiceConnector',
        parameters: {
          VoiceConnectorId: new customResources.PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
      },
      role: chimeCustomResourceRole,
    });

    // Store Voice Connector details with correct nested paths
    const voiceConnectorId = voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId');
    const voiceConnectorOutboundHost = voiceConnector.getResponseField('VoiceConnector.OutboundHostName');

    const terminationCidrs = props.voiceConnectorTerminationCidrs
      ?.map((cidr) => cidr.trim())
      .filter((cidr) => cidr.length > 0);

    const hasTerminationCidrs = Boolean(terminationCidrs && terminationCidrs.length > 0);

    if (hasTerminationCidrs) {
      const invalidCidrs = terminationCidrs!.filter((cidr) => {
        const [network, prefix] = cidr.split('/');
        const prefixNumber = Number(prefix);

        // Require valid IPv4 CIDR format and mask of /27 or smaller network blocks.
        // "Smaller" means fewer hosts = larger prefix numbers (e.g., /27, /28, /29, /30, /31, /32)
        // AWS Chime Voice Connector requires prefix >= 27 (i.e., /27 or smaller blocks)
        return (
          !network ||
          Number.isNaN(prefixNumber) ||
          prefixNumber < 27 ||  // Reject /1 through /26 (too large)
          prefixNumber > 32     // Reject invalid prefix (> /32)
        );
      });

      if (invalidCidrs.length > 0) {
        throw new Error(
          `voiceConnectorTerminationCidrs must contain CIDR blocks with prefix /27 or smaller (e.g., /27, /28, /29, /30, /31, /32). Invalid entries: ${invalidCidrs.join(
            ', '
          )}`
        );
      }
    }

    // ========================================
    // Voice Connector Termination - For OUTBOUND calls
    // ========================================
    // Allow deployments to optionally configure termination CIDR blocks. When
    // no CIDRs are provided we skip provisioning the termination custom
    // resource entirely so CloudFormation does not submit empty values that
    // Chime rejects (e.g., null CIDR lists or 0.0.0.0/0 defaults).
    let vcTermination: customResources.AwsCustomResource | undefined;

    if (hasTerminationCidrs) {
      const terminationConfig = {
        CpsLimit: 1,
        CallingRegions: ['US'],
        CidrAllowedList: terminationCidrs!,
        Disabled: false,
      };

      vcTermination = new customResources.AwsCustomResource(this, 'VCTermination', {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Termination: {
              ...terminationConfig,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Termination: {
              ...terminationConfig,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
        },
        role: chimeCustomResourceRole,
      });

      vcTermination.node.addDependency(voiceConnector);
    }

    // ========================================
    // Voice Connector Origination - For INBOUND calls
    // ========================================
    const originationRoutes = props.voiceConnectorOriginationRoutes?.map((route, index) => {
      const host = route.host?.trim();

      if (!host) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] must include a non-empty host value.`);
      }

      if (/\.voiceconnector\.chime\.aws$/i.test(host)) {
        throw new Error(
          `voiceConnectorOriginationRoutes[${index}] host "${host}" uses an Amazon-managed domain that cannot be set ` +
          'as an origination route. Provide the SIP host from your carrier or SBC instead.'
        );
      }

      const port = route.port ?? 5060;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] port must be an integer between 1 and 65535.`);
      }

      const protocol = (route.protocol ?? 'UDP').toUpperCase();
      if (!['UDP', 'TCP', 'TLS'].includes(protocol)) {
        throw new Error(
          `voiceConnectorOriginationRoutes[${index}] protocol must be one of UDP, TCP, or TLS. Received: ${protocol}`
        );
      }

      const priority = route.priority ?? index + 1;
      if (!Number.isInteger(priority) || priority < 1 || priority > 20) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] priority must be an integer between 1 and 20.`);
      }

      const weight = route.weight ?? 1;
      if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] weight must be an integer between 1 and 10.`);
      }

      return {
        Host: host,
        Port: port,
        Protocol: protocol as VoiceConnectorOriginationProtocol,
        Priority: priority,
        Weight: weight,
      };
    });

    if (originationRoutes && originationRoutes.length > 0) {
      const vcOrigination = new customResources.AwsCustomResource(this, 'VCOrigination', {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Origination: {
              Routes: originationRoutes,
              Disabled: false,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-origination`),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Origination: {
              Routes: originationRoutes,
              Disabled: false,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-origination`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
        },
        role: chimeCustomResourceRole,
      });

      // CRITICAL: Add dependencies - Origination must wait for Termination
      vcOrigination.node.addDependency(voiceConnector);
      if (vcTermination) {
        vcOrigination.node.addDependency(vcTermination);
      }
    }


    // ========================================
    // Load clinic phone numbers from clinics.json
    // ========================================
    // Using the imported clinicsData from the top of the file

    const clinicsWithPhones = (clinicsData as Clinic[])
      .filter(clinic => clinic.phoneNumber && clinic.phoneNumber.startsWith('+'))
      .map(clinic => ({
        clinicId: clinic.clinicId,
        phoneNumber: clinic.phoneNumber!,
        clinicName: clinic.clinicName || clinic.clinicId
      }));

    console.log(`Found ${clinicsWithPhones.length} clinics with phone numbers`);

    // ========================================
    // Create per-clinic SIP Media Applications and SIP Rules
    // ========================================

    const clinicSipRules: Record<string, customResources.AwsCustomResource> = {};
    const smaIdMap: Record<string, string> = {};
    const phoneNumberToClinicId = new Map<string, string>();

    let previousClinicResource: Construct | undefined;

    clinicsWithPhones.forEach((clinic) => {
      const sanitizedId = clinic.clinicId.replace(/[^A-Za-z0-9]/g, '-');

      const smaResource = new customResources.AwsCustomResource(this, `SipMediaApp-${sanitizedId}`, {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'createSipMediaApplication',
          parameters: {
            Name: `${this.stackName}-${sanitizedId}-SMA`,
            AwsRegion: this.region,
            Endpoints: [{
              LambdaArn: smaHandler.functionArn,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipMediaApplication.SipMediaApplicationId'),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteSipMediaApplication',
          parameters: {
            SipMediaApplicationId: new customResources.PhysicalResourceIdReference(),
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
        },
        role: chimeCustomResourceRole,
      });

      if (previousClinicResource) {
        smaResource.node.addDependency(previousClinicResource);
      }

      const smaIdToken = smaResource.getResponseField('SipMediaApplication.SipMediaApplicationId');
      smaIdMap[clinic.clinicId] = smaIdToken;
      phoneNumberToClinicId.set(clinic.phoneNumber, clinic.clinicId);

      const sipRule = new customResources.AwsCustomResource(this, `SipRule-${sanitizedId}`, {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'createSipRule',
          parameters: {
            Name: `${this.stackName}-${sanitizedId}-Rule`,
            TriggerType: 'ToPhoneNumber',
            TriggerValue: clinic.phoneNumber,
            TargetApplications: [{
              SipMediaApplicationId: smaIdToken,
              Priority: 1,
              AwsRegion: this.region,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'updateSipRule',
          parameters: {
            SipRuleId: new customResources.PhysicalResourceIdReference(),
            Name: `${this.stackName}-${sanitizedId}-Rule`,
            TriggerType: 'ToPhoneNumber',
            TriggerValue: clinic.phoneNumber,
            TargetApplications: [{
              SipMediaApplicationId: smaIdToken,
              Priority: 1,
              AwsRegion: this.region,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-${sanitizedId}-SipRule`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteSipRule',
          parameters: {
            SipRuleId: new customResources.PhysicalResourceIdReference(),
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
        },
        role: chimeCustomResourceRole,
      });

      sipRule.node.addDependency(voiceConnector);
      sipRule.node.addDependency(smaResource);
      if (vcTermination) {
        sipRule.node.addDependency(vcTermination);
      }

      clinicSipRules[clinic.clinicId] = sipRule;

      // NOTE: SMA logging configuration removed to avoid CloudWatch Logs resource policy 
      // size limit (51,200 bytes). When many SMAs are created, each one adds to the shared
      // CloudWatch Logs resource policy, eventually exceeding the limit.
      // If SMA logging is needed, consider using a centralized approach or limiting
      // the number of clinics with logging enabled.

      previousClinicResource = sipRule;
    });

    // CRITICAL FIX: Always add Chime Voice invoke permission regardless of clinic count.
    // This ensures the SMA handler can receive calls even if clinics are added later
    // via DynamoDB or if phone numbers are configured after initial deployment.
    const chimeVoiceInvokePermission = new lambda.CfnPermission(smaHandler, 'ChimeVoiceInvoke', {
      action: 'lambda:InvokeFunction',
      functionName: smaHandler.functionArn,
      principal: 'voiceconnector.chime.amazonaws.com',
      sourceArn: `arn:aws:chime:${this.region}:${this.account}:vc/*`,
    });

    const smaIdMapJson = Stack.of(this).toJsonString(smaIdMap);

    // Associate phone numbers with Voice Connector
    console.log(`Associating ${clinicsWithPhones.length} phone numbers with Voice Connector`);

    let associatePhones: customResources.AwsCustomResource[] = [];

    if (clinicsWithPhones.length > 0) {
      const BATCH_SIZE = 5;
      const phoneNumberBatches: string[][] = [];

      for (let i = 0; i < clinicsWithPhones.length; i += BATCH_SIZE) {
        const batch = clinicsWithPhones.slice(i, i + BATCH_SIZE).map(c => c.phoneNumber);
        phoneNumberBatches.push(batch);
      }

      console.log(`Processing ${clinicsWithPhones.length} phone numbers in ${phoneNumberBatches.length} batches`);

      phoneNumberBatches.forEach((phoneBatch, index) => {
        const resource = new customResources.AwsCustomResource(this, `AssociatePhoneNumbers-${index}`, {
          onCreate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true
            },
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onUpdate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true
            },
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onDelete: {
            service: 'ChimeSDKVoice',
            action: 'disassociatePhoneNumbersFromVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
            },
            ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
          },
          role: chimeCustomResourceRole,
        });

        resource.node.addDependency(voiceConnector);
        phoneBatch.forEach(phoneNumber => {
          const clinicId = phoneNumberToClinicId.get(phoneNumber);
          if (clinicId) {
            const sipRule = clinicSipRules[clinicId];
            if (sipRule) {
              resource.node.addDependency(sipRule);
            }
          }
        });
        associatePhones.push(resource);
      });
    }

    // ========================================
    // AI PHONE NUMBERS
    // ========================================
    // AI phone numbers are now handled by Amazon Connect + Lex (ConnectLexAiStack).
    // ChimeStack no longer provisions Voice Connector ingress SIP rules for `aiPhoneNumber`.

    // ========================================
    // 3. Lambda Functions
    // ========================================

    // Shared Chime SDK policy for meeting operations
    const chimeSdkPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteAttendee',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
        'chime-sdk-meetings:GetMeeting',
        'chime-sdk-meetings:ListAttendees',
        'chime-sdk-meetings:DeleteAttendee',
        'chime-sdk-meetings:StartMeetingTranscription',
        'chime-sdk-meetings:StopMeetingTranscription',
      ],
      resources: ['*'],
    });

    // JWT Secret environment variable (for custom auth)
    const jwtSecretValue = props.jwtSecret;

    // Lambda for POST /chime/start-session
    const startSessionFn = new lambdaNode.NodejsFunction(this, 'StartSessionFn', {
      functionName: `${this.stackName}-StartSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'start-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName, // FIX: Added for distributed locking during queue assignment
        JWT_SECRET: jwtSecretValue,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    const startSessionLogGroup = new logs.LogGroup(this, 'StartSessionLogGroup', {
      logGroupName: `/aws/lambda/${startSessionFn.functionName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    new logs.MetricFilter(this, 'StartSessionErrorMetricFilter', {
      logGroup: startSessionLogGroup,
      metricNamespace: 'Chime',
      metricName: 'StartSessionErrors',
      filterPattern: logs.FilterPattern.anyTerm('ERROR', 'Error', 'Exception'),
      metricValue: '1',
    });
    new cloudwatch.Alarm(this, 'StartSessionErrorAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Chime',
        metricName: 'StartSessionErrors',
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarm when StartSession Lambda emits errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    startSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(startSessionFn);
    this.callQueueTable.grantReadWriteData(startSessionFn); // FIX: Changed to ReadWrite for queue assignment
    this.locksTable.grantReadWriteData(startSessionFn); // FIX: Added for distributed locking
    startSessionFn.addPermission('AdminApiInvokeStartSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/stop-session
    const stopSessionFn = new lambdaNode.NodejsFunction(this, 'StopSessionFn', {
      functionName: `${this.stackName}-StopSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'stop-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15), // FIX: Increased timeout for call cleanup
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName, // FIX: Added for active call cleanup
        SMA_ID_MAP: smaIdMapJson, // FIX: Added for SMA hangup during cleanup
        JWT_SECRET: jwtSecretValue,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    stopSessionFn.addToRolePolicy(chimeSdkPolicy);
    // FIX: Add SMA call update permission for hangup during session stop
    stopSessionFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
    this.agentPresenceTable.grantReadWriteData(stopSessionFn);
    this.callQueueTable.grantReadWriteData(stopSessionFn); // FIX: Added for call cleanup
    stopSessionFn.addPermission('AdminApiInvokeStopSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/agent/active
    // Push-first availability toggle (writes AgentActive table; may also ring queued calls).
    const agentActiveFn = new lambdaNode.NodejsFunction(this, 'AgentActiveFn', {
      functionName: `${this.stackName}-AgentActive`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'agent-active.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        JWT_SECRET: jwtSecretValue,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        // Push Notifications Integration (best-effort dispatch of queued calls)
        SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn || '',
      },
    });
    applyTags(agentActiveFn, { Function: 'agent-active' });
    this.agentActiveTable.grantReadWriteData(agentActiveFn);
    this.callQueueTable.grantReadWriteData(agentActiveFn);
    this.locksTable.grantReadWriteData(agentActiveFn);
    if (props.sendPushFunctionArn) {
      agentActiveFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }
    agentActiveFn.addPermission('AdminApiInvokeAgentActive', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/agent/inactive
    const agentInactiveFn = new lambdaNode.NodejsFunction(this, 'AgentInactiveFn', {
      functionName: `${this.stackName}-AgentInactive`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'agent-inactive.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        JWT_SECRET: jwtSecretValue,
      },
    });
    applyTags(agentInactiveFn, { Function: 'agent-inactive' });
    this.agentActiveTable.grantReadWriteData(agentInactiveFn);
    agentInactiveFn.addPermission('AdminApiInvokeAgentInactive', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/outbound-call
    const outboundCallFn = new lambdaNode.NodejsFunction(this, 'OutboundCallFn', {
      functionName: `${this.stackName}-OutboundCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'outbound-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        VOICE_CONNECTOR_ID: voiceConnectorId,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(outboundCallFn);
    this.agentActiveTable.grantReadWriteData(outboundCallFn);
    this.clinicsTable.grantReadData(outboundCallFn);
    this.callQueueTable.grantReadWriteData(outboundCallFn);
    this.locksTable.grantReadWriteData(outboundCallFn);
    outboundCallFn.addPermission('AdminApiInvokeOutboundCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    outboundCallFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateSipMediaApplicationCall',
        'chime-sdk-voice:CreateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));

    // Lambda for POST /chime/transfer-call
    const transferCallFn = new lambdaNode.NodejsFunction(this, 'TransferCallFn', {
      functionName: `${this.stackName}-TransferCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'transfer-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(transferCallFn);
    this.callQueueTable.grantReadWriteData(transferCallFn);
    this.locksTable.grantReadWriteData(transferCallFn);
    transferCallFn.addToRolePolicy(chimeSdkPolicy);
    transferCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    transferCallFn.addPermission('AdminApiInvokeTransferCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-accepted
    const callAcceptedFn = new lambdaNode.NodejsFunction(this, 'CallAcceptedFn', {
      functionName: `${this.stackName}-CallAccepted`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-accepted.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(callAcceptedFn);
    this.callQueueTable.grantReadWriteData(callAcceptedFn);
    this.locksTable.grantReadWriteData(callAcceptedFn);
    callAcceptedFn.addToRolePolicy(chimeSdkPolicy);
    callAcceptedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    callAcceptedFn.addPermission('AdminApiInvokeCallAccepted', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-accepted-v2
    // Push-first meeting-per-call acceptance: returns meeting credentials and bridges PSTN leg.
    const callAcceptedV2Fn = new lambdaNode.NodejsFunction(this, 'CallAcceptedV2Fn', {
      functionName: `${this.stackName}-CallAcceptedV2`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-accepted-v2.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    applyTags(callAcceptedV2Fn, { Function: 'call-accepted-v2' });
    this.agentActiveTable.grantReadWriteData(callAcceptedV2Fn);
    this.callQueueTable.grantReadWriteData(callAcceptedV2Fn);
    this.locksTable.grantReadWriteData(callAcceptedV2Fn);
    callAcceptedV2Fn.addToRolePolicy(chimeSdkPolicy);
    callAcceptedV2Fn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    callAcceptedV2Fn.addPermission('AdminApiInvokeCallAcceptedV2', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-rejected-v2
    // Push-first meeting-per-call rejection: remove agent from ring list and re-offer to other active agents.
    const callRejectedV2Fn = new lambdaNode.NodejsFunction(this, 'CallRejectedV2Fn', {
      functionName: `${this.stackName}-CallRejectedV2`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-rejected-v2.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        JWT_SECRET: jwtSecretValue,
        SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn || '',
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    applyTags(callRejectedV2Fn, { Function: 'call-rejected-v2' });
    this.agentActiveTable.grantReadWriteData(callRejectedV2Fn);
    this.callQueueTable.grantReadWriteData(callRejectedV2Fn);
    this.locksTable.grantReadWriteData(callRejectedV2Fn);
    if (props.sendPushFunctionArn) {
      callRejectedV2Fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }
    callRejectedV2Fn.addPermission('AdminApiInvokeCallRejectedV2', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-hungup-v2
    // Push-first meeting-per-call hangup: request SMA hangup and reset AgentActive busy -> active (best-effort).
    const callHungupV2Fn = new lambdaNode.NodejsFunction(this, 'CallHungupV2Fn', {
      functionName: `${this.stackName}-CallHungupV2`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-hungup-v2.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_ACTIVE_TABLE_NAME: this.agentActiveTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    applyTags(callHungupV2Fn, { Function: 'call-hungup-v2' });
    this.agentActiveTable.grantReadWriteData(callHungupV2Fn);
    this.callQueueTable.grantReadWriteData(callHungupV2Fn);
    this.locksTable.grantReadWriteData(callHungupV2Fn);
    callHungupV2Fn.addToRolePolicy(chimeSdkPolicy);
    callHungupV2Fn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    callHungupV2Fn.addPermission('AdminApiInvokeCallHungupV2', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-rejected
    const callRejectedFn = new lambdaNode.NodejsFunction(this, 'CallRejectedFn', {
      functionName: `${this.stackName}-CallRejected`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-rejected.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(callRejectedFn);
    this.callQueueTable.grantReadWriteData(callRejectedFn);
    this.locksTable.grantReadWriteData(callRejectedFn);
    callRejectedFn.addToRolePolicy(chimeSdkPolicy);
    callRejectedFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
    callRejectedFn.addPermission('AdminApiInvokeCallRejected', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-hungup
    const callHungupFn = new lambdaNode.NodejsFunction(this, 'CallHungupFn', {
      functionName: `${this.stackName}-CallHungup`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-hungup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName, // CRITICAL FIX: Added for distributed locking
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
        // Push Notifications Integration (for missed call notifications)
        DEVICE_TOKENS_TABLE: props.deviceTokensTableName || '',
        SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn || '',
      },
    });
    this.agentPresenceTable.grantReadWriteData(callHungupFn);
    this.callQueueTable.grantReadWriteData(callHungupFn);
    this.locksTable.grantReadWriteData(callHungupFn); // CRITICAL FIX: Grant locks table access
    callHungupFn.addToRolePolicy(chimeSdkPolicy);

    // Push notifications permissions for call-hungup (missed call notifications)
    if (props.deviceTokensTableArn) {
      callHungupFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [props.deviceTokensTableArn, `${props.deviceTokensTableArn}/index/*`],
      }));
    }
    if (props.sendPushFunctionArn) {
      callHungupFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }
    callHungupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
    callHungupFn.addPermission('AdminApiInvokeCallHungup', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/leave-call
    const leaveCallFn = new lambdaNode.NodejsFunction(this, 'LeaveCallFn', {
      functionName: `${this.stackName}-LeaveCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'leave-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        // FIX: Added LOCKS_TABLE_NAME for distributed lock during queue check
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(leaveCallFn);
    this.callQueueTable.grantReadWriteData(leaveCallFn);
    // FIX: Grant access to locks table for distributed locking during queue check
    this.locksTable.grantReadWriteData(leaveCallFn);
    leaveCallFn.addToRolePolicy(chimeSdkPolicy);
    leaveCallFn.addPermission('AdminApiInvokeLeaveCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/hold-call
    // NOTE: COMPENSATING_ACTIONS_QUEUE_URL is added after the queue is created (see below)
    const holdCallFn = new lambdaNode.NodejsFunction(this, 'HoldCallFn', {
      functionName: `${this.stackName}-HoldCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'hold-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
        // COMPENSATING_ACTIONS_QUEUE_URL added after queue creation below
      },
    });
    this.agentPresenceTable.grantReadWriteData(holdCallFn);
    this.callQueueTable.grantReadWriteData(holdCallFn);
    this.locksTable.grantReadWriteData(holdCallFn);
    holdCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    holdCallFn.addPermission('AdminApiInvokeHoldCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/resume-call
    const resumeCallFn = new lambdaNode.NodejsFunction(this, 'ResumeCallFn', {
      functionName: `${this.stackName}-ResumeCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'resume-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(resumeCallFn);
    this.callQueueTable.grantReadWriteData(resumeCallFn);
    this.locksTable.grantReadWriteData(resumeCallFn);
    resumeCallFn.addToRolePolicy(chimeSdkPolicy);
    resumeCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    resumeCallFn.addPermission('AdminApiInvokeResumeCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/add-call
    const addCallFn = new lambdaNode.NodejsFunction(this, 'AddCallFn', {
      functionName: `${this.stackName}-AddCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'add-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion, // FIX: Use variable instead of hardcoded value
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    addCallFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(addCallFn);
    this.clinicsTable.grantReadData(addCallFn);
    this.callQueueTable.grantReadWriteData(addCallFn);
    addCallFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateSipMediaApplicationCall',
        'chime-sdk-voice:CreateSipMediaApplicationCall',
      ],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
    addCallFn.addPermission('AdminApiInvokeAddCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/send-dtmf
    const sendDtmfFn = new lambdaNode.NodejsFunction(this, 'SendDtmfFn', {
      functionName: `${this.stackName}-SendDtmf`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'send-dtmf.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1', // CRITICAL FIX: Added for ChimeSDKVoiceClient region
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadData(sendDtmfFn);
    this.callQueueTable.grantReadWriteData(sendDtmfFn);
    sendDtmfFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    sendDtmfFn.addPermission('AdminApiInvokeSendDtmf', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for /chime/call-notes (GET, POST, PUT, DELETE)
    const callNotesFn = new lambdaNode.NodejsFunction(this, 'CallNotesFn', {
      functionName: `${this.stackName}-CallNotes`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-notes.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadData(callNotesFn);
    this.callQueueTable.grantReadWriteData(callNotesFn);
    callNotesFn.addPermission('AdminApiInvokeCallNotes', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/conference-call
    const conferenceCallFn = new lambdaNode.NodejsFunction(this, 'ConferenceCallFn', {
      functionName: `${this.stackName}-ConferenceCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'conference-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    conferenceCallFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(conferenceCallFn);
    this.callQueueTable.grantReadWriteData(conferenceCallFn);
    conferenceCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    conferenceCallFn.addPermission('AdminApiInvokeConferenceCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /call-center/join-queued-call
    const joinQueuedCallFn = new lambdaNode.NodejsFunction(this, 'JoinQueuedCallFn', {
      functionName: `${this.stackName}-JoinQueuedCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'join-queued-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    joinQueuedCallFn.addToRolePolicy(chimeSdkPolicy);
    this.callQueueTable.grantReadWriteData(joinQueuedCallFn);
    this.agentPresenceTable.grantReadWriteData(joinQueuedCallFn);
    this.clinicsTable.grantReadData(joinQueuedCallFn);
    joinQueuedCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));
    joinQueuedCallFn.addPermission('AdminApiInvokeJoinQueuedCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /call-center/join-active-call
    const joinActiveCallFn = new lambdaNode.NodejsFunction(this, 'JoinActiveCallFn', {
      functionName: `${this.stackName}-JoinActiveCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'join-active-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        // CRITICAL FIX: Add LOCKS_TABLE_NAME for distributed locking to prevent race conditions
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    // CRITICAL FIX: Grant access to locks table for distributed locking
    this.locksTable.grantReadWriteData(joinActiveCallFn);
    joinActiveCallFn.addToRolePolicy(chimeSdkPolicy);
    this.callQueueTable.grantReadWriteData(joinActiveCallFn);
    this.agentPresenceTable.grantReadWriteData(joinActiveCallFn);
    joinActiveCallFn.addPermission('AdminApiInvokeJoinActiveCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for GET /call-center/get-joinable-calls
    const getJoinableCallsFn = new lambdaNode.NodejsFunction(this, 'GetJoinableCallsFn', {
      functionName: `${this.stackName}-GetJoinableCalls`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-joinable-calls.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.callQueueTable.grantReadData(getJoinableCallsFn);
    this.agentPresenceTable.grantReadData(getJoinableCallsFn);
    getJoinableCallsFn.addPermission('AdminApiInvokeGetJoinableCalls', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // ========================================
    // 4. API Gateway Routes
    // ========================================

    // Routes are now handled by AdminStack to avoid circular dependencies.

    // ========================================
    // 5. Outputs
    // ========================================
    // CRITICAL FIX: Use consistent this.stackName for all exports
    // This ensures AiAgentsStack can reliably import these values
    new CfnOutput(this, 'ClinicsTableName', {
      value: this.clinicsTable.tableName,
      description: 'Clinics table name for cross-stack references',
      exportName: `${this.stackName}-ClinicsTableName`,
    });

    // Export Clinics table ARN for IAM permissions
    new CfnOutput(this, 'ClinicsTableArn', {
      value: this.clinicsTable.tableArn,
      description: 'Clinics table ARN for cross-stack IAM policies',
      exportName: `${this.stackName}-ClinicsTableArn`,
    });

    new CfnOutput(this, 'AgentPresenceTableName', {
      value: this.agentPresenceTable.tableName,
      exportName: `${this.stackName}-AgentPresenceTableName`,
    });

    new CfnOutput(this, 'AgentActiveTableName', {
      value: this.agentActiveTable.tableName,
      description: 'AgentActive table name for push-first call routing',
      exportName: `${this.stackName}-AgentActiveTableName`,
    });

    new CfnOutput(this, 'AgentActiveTableArn', {
      value: this.agentActiveTable.tableArn,
      description: 'AgentActive table ARN for cross-stack IAM policies',
      exportName: `${this.stackName}-AgentActiveTableArn`,
    });

    // Export CallQueue table name for AnalyticsStack derived references
    new CfnOutput(this, 'CallQueueTableName', {
      value: this.callQueueTable.tableName,
      description: 'CallQueue table name - use this instead of deriving from stack name',
      exportName: `${this.stackName}-CallQueueTableName`,
    });

    // Export AgentPerformance table name for AnalyticsStack
    new CfnOutput(this, 'AgentPerformanceTableNameExport', {
      value: this.agentPerformanceTable.tableName,
      description: 'AgentPerformance table name for cross-stack references',
      exportName: `${this.stackName}-AgentPerformanceTableName`,
    });

    // Store SMA ID Map in SSM Parameter Store instead of CfnOutput
    // CloudFormation exports have a 1024 char limit which the SMA map exceeds
    // CRITICAL FIX: Use ADVANCED tier to support larger clinic lists (up to 8KB vs 4KB for STANDARD)
    const smaIdMapParameter = new ssm.StringParameter(this, 'SmaIdMapParameter', {
      parameterName: `/${this.stackName}/SmaIdMap`,
      stringValue: smaIdMapJson,
      description: 'JSON map of clinicId to SIP Media Application ID',
      tier: ssm.ParameterTier.ADVANCED, // ADVANCED supports up to 8KB, STANDARD only 4KB
    });

    // Export the parameter name for cross-stack references
    new CfnOutput(this, 'SmaIdMapParameterName', {
      value: smaIdMapParameter.parameterName,
      description: 'SSM Parameter name containing SMA ID Map',
      exportName: `${this.stackName}-SmaIdMapParameterName`,
    });

    new CfnOutput(this, 'StartSessionFnArn', {
      value: startSessionFn.functionArn,
      exportName: `${this.stackName}-StartSessionArn`,
    });
    new CfnOutput(this, 'StopSessionFnArn', {
      value: stopSessionFn.functionArn,
      exportName: `${this.stackName}-StopSessionArn`,
    });
    new CfnOutput(this, 'AgentActiveFnArn', {
      value: agentActiveFn.functionArn,
      exportName: `${this.stackName}-AgentActiveArn`,
    });
    new CfnOutput(this, 'AgentInactiveFnArn', {
      value: agentInactiveFn.functionArn,
      exportName: `${this.stackName}-AgentInactiveArn`,
    });
    new CfnOutput(this, 'OutboundCallFnArn', {
      value: outboundCallFn.functionArn,
      exportName: `${this.stackName}-OutboundCallArn`,
    });
    new CfnOutput(this, 'TransferCallFnArn', {
      value: transferCallFn.functionArn,
      exportName: `${this.stackName}-TransferCallArn`,
    });
    new CfnOutput(this, 'CallAcceptedFnArn', {
      value: callAcceptedFn.functionArn,
      exportName: `${this.stackName}-CallAcceptedArn`,
    });
    new CfnOutput(this, 'CallAcceptedV2FnArn', {
      value: callAcceptedV2Fn.functionArn,
      exportName: `${this.stackName}-CallAcceptedV2Arn`,
    });
    new CfnOutput(this, 'CallRejectedV2FnArn', {
      value: callRejectedV2Fn.functionArn,
      exportName: `${this.stackName}-CallRejectedV2Arn`,
    });
    new CfnOutput(this, 'CallHungupV2FnArn', {
      value: callHungupV2Fn.functionArn,
      exportName: `${this.stackName}-CallHungupV2Arn`,
    });
    new CfnOutput(this, 'CallRejectedFnArn', {
      value: callRejectedFn.functionArn,
      exportName: `${this.stackName}-CallRejectedArn`,
    });
    new CfnOutput(this, 'CallHungupFnArn', {
      value: callHungupFn.functionArn,
      exportName: `${this.stackName}-CallHungupArn`,
    });
    new CfnOutput(this, 'LeaveCallFnArn', {
      value: leaveCallFn.functionArn,
      exportName: `${this.stackName}-LeaveCallArn`,
    });
    new CfnOutput(this, 'HoldCallFnArn', {
      value: holdCallFn.functionArn,
      exportName: `${this.stackName}-HoldCallArn`,
    });
    new CfnOutput(this, 'ResumeCallFnArn', {
      value: resumeCallFn.functionArn,
      exportName: `${this.stackName}-ResumeCallArn`,
    });
    new CfnOutput(this, 'AddCallFnArn', {
      value: addCallFn.functionArn,
      exportName: `${this.stackName}-AddCallArn`,
    });
    new CfnOutput(this, 'SendDtmfFnArn', {
      value: sendDtmfFn.functionArn,
      exportName: `${this.stackName}-SendDtmfArn`,
    });
    new CfnOutput(this, 'CallNotesFnArn', {
      value: callNotesFn.functionArn,
      exportName: `${this.stackName}-CallNotesArn`,
    });
    new CfnOutput(this, 'ConferenceCallFnArn', {
      value: conferenceCallFn.functionArn,
      exportName: `${this.stackName}-ConferenceCallArn`,
    });
    new CfnOutput(this, 'JoinQueuedCallFnArn', {
      value: joinQueuedCallFn.functionArn,
      exportName: `${this.stackName}-JoinQueuedCallArn`,
    });
    new CfnOutput(this, 'JoinActiveCallFnArn', {
      value: joinActiveCallFn.functionArn,
      exportName: `${this.stackName}-JoinActiveCallArn`,
    });
    new CfnOutput(this, 'GetJoinableCallsFnArn', {
      value: getJoinableCallsFn.functionArn,
      exportName: `${this.stackName}-GetJoinableCallsArn`,
    });
    // NOTE: AgentPresenceTableName export is already defined above (see AgentPresenceTableName CfnOutput)
    new CfnOutput(this, 'HoldMusicBucketName', {
      value: holdMusicBucket.bucketName,
      description: 'S3 bucket for hold music and streaming TTS audio.',
      exportName: `${this.stackName}-HoldMusicBucketName`,
    });

    // FIX: Export bucket ARN for cross-stack permissions (used by AiAgentsStack for streaming TTS)
    new CfnOutput(this, 'HoldMusicBucketArn', {
      value: holdMusicBucket.bucketArn,
      description: 'S3 bucket ARN for hold music and streaming TTS audio.',
      exportName: `${this.stackName}-HoldMusicBucketArn`,
    });



    // ========================================
    // 6. Heartbeat and Cleanup Monitor
    // ========================================

    const heartbeatFn = new lambdaNode.NodejsFunction(this, 'HeartbeatFn', {
      functionName: `${this.stackName}-Heartbeat`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'heartbeat.ts'),
      handler: 'handler',
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        JWT_SECRET: jwtSecretValue,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });

    this.agentPresenceTable.grantReadWriteData(heartbeatFn);

    heartbeatFn.addPermission('AdminApiInvokeHeartbeat', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    new CfnOutput(this, 'HeartbeatFnArn', {
      value: heartbeatFn.functionArn,
      exportName: `${this.stackName}-HeartbeatArn`,
    });

    const cleanupMonitorFn = new lambdaNode.NodejsFunction(this, 'CleanupMonitorFn', {
      functionName: `${this.stackName}-CleanupMonitor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'cleanup-monitor.ts'),
      handler: 'handler',
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        SMA_ID_MAP: smaIdMapJson,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });

    this.agentPresenceTable.grantReadWriteData(cleanupMonitorFn);
    this.callQueueTable.grantReadWriteData(cleanupMonitorFn);

    cleanupMonitorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:DeleteMeeting',
        'chime:ListMeetings',
        'chime:DeleteAttendee',      // CRITICAL FIX: Added to cleanup orphaned attendees
        'chime:ListAttendees',       // CRITICAL FIX: Added to find attendees to cleanup
        'chime-sdk-meetings:DeleteMeeting',
        'chime-sdk-meetings:ListMeetings',
        'chime-sdk-meetings:DeleteAttendee',
        'chime-sdk-meetings:ListAttendees',
      ],
      resources: ['*'],
    }));

    // Add Voice Connector outputs for reference
    new CfnOutput(this, 'VoiceConnectorId', {
      value: voiceConnectorId,
      description: 'Voice Connector ID - use this to associate phone numbers',
      exportName: `${this.stackName}-VoiceConnectorId`,
    });

    new CfnOutput(this, 'VoiceConnectorOutboundHostName', {
      value: voiceConnectorOutboundHost,
      description: 'Voice Connector Outbound Host - use this for SIP routing',
      exportName: `${this.stackName}-VoiceConnectorHost`,
    });

    const rule = new events.Rule(this, 'CleanupMonitorRule', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      description: 'Trigger cleanup monitor to handle orphaned resources and stale agent presence',
    });

    rule.addTarget(new targets.LambdaFunction(cleanupMonitorFn));

    new CfnOutput(this, 'CleanupMonitorFnArn', {
      value: cleanupMonitorFn.functionArn,
      exportName: `${this.stackName}-CleanupMonitorArn`,
    });

    // ========================================
    // COMPENSATING ACTIONS QUEUE (for handling partial failures)
    // ========================================
    // DLQ for failed compensating actions that need manual review
    const compensatingActionsDlq = new sqs.Queue(this, 'CompensatingActionsDlq', {
      queueName: `${this.stackName}-CompensatingActions-DLQ`,
      retentionPeriod: Duration.days(14), // Keep failed messages for 2 weeks for investigation
    });

    // Main queue for compensating actions
    const compensatingActionsQueue = new sqs.Queue(this, 'CompensatingActionsQueue', {
      queueName: `${this.stackName}-CompensatingActions`,
      visibilityTimeout: Duration.minutes(5), // Match Lambda timeout
      deadLetterQueue: {
        queue: compensatingActionsDlq,
        maxReceiveCount: 3, // Move to DLQ after 3 failed attempts
      },
    });

    // Lambda for processing compensating actions
    const compensatingActionProcessorFn = new lambdaNode.NodejsFunction(this, 'CompensatingActionProcessorFn', {
      functionName: `${this.stackName}-CompensatingActionProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'compensating-action-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: chimeMediaRegion,
        // CRITICAL FIX #9: Add STACK_NAME env var for SSM parameter lookup
        STACK_NAME: this.stackName,
      },
    });

    // Grant permissions
    this.agentPresenceTable.grantReadWriteData(compensatingActionProcessorFn);
    this.callQueueTable.grantReadWriteData(compensatingActionProcessorFn);
    compensatingActionProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:UpdateSipMediaApplicationCall',
        'chime-sdk-voice:UpdateSipMediaApplicationCall',
        'chime-sdk-meetings:DeleteAttendee',
      ],
      resources: ['*'],
    }));

    // Add SQS event source
    compensatingActionProcessorFn.addEventSource(
      new lambdaEventSources.SqsEventSource(compensatingActionsQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
      })
    );

    // Store queue URL in SSM for other Lambdas to use
    new ssm.StringParameter(this, 'CompensatingActionsQueueUrlParam', {
      parameterName: `/${this.stackName}/CompensatingActionsQueueUrl`,
      stringValue: compensatingActionsQueue.queueUrl,
      description: 'SQS Queue URL for compensating actions',
    });

    new CfnOutput(this, 'CompensatingActionsQueueUrl', {
      value: compensatingActionsQueue.queueUrl,
      description: 'SQS Queue URL for compensating actions',
      exportName: `${this.stackName}-CompensatingActionsQueueUrl`,
    });

    new CfnOutput(this, 'CompensatingActionsQueueArn', {
      value: compensatingActionsQueue.queueArn,
      description: 'SQS Queue ARN for compensating actions',
      exportName: `${this.stackName}-CompensatingActionsQueueArn`,
    });

    // CRITICAL FIX: Grant holdCallFn access to send compensating actions
    // The hold-call handler uses COMPENSATING_ACTIONS_QUEUE_URL to send compensating actions on failure
    holdCallFn.addEnvironment('COMPENSATING_ACTIONS_QUEUE_URL', compensatingActionsQueue.queueUrl);
    compensatingActionsQueue.grantSendMessages(holdCallFn);

    // ========================================
    // 7. CALL RECORDING INFRASTRUCTURE
    // ========================================

    let recordingsBucket: s3.IBucket | undefined;
    let recordingsKey: kms.Key | undefined;
    // Track whether we own the bucket (for event notifications, which can only be added to owned buckets)
    let isOwnedBucket = false;

    // CRITICAL FIX: Always create getRecordingFn to ensure export exists
    // This prevents CloudFormation failures when AdminStack imports the ARN
    const recordingEnabled = props.enableCallRecording !== false;

    // Check if using shared recordings bucket from AiAgentsStack to avoid data fragmentation
    // Validate that both bucket name AND ARN are provided together
    const hasSharedBucketName = Boolean(props.sharedRecordingsBucketName);
    const hasSharedBucketArn = Boolean(props.sharedRecordingsBucketArn);

    if (hasSharedBucketName !== hasSharedBucketArn) {
      console.warn(
        `[ChimeStack] PARTIAL CONFIGURATION: Shared recordings bucket is partially configured. ` +
        `sharedRecordingsBucketName: ${props.sharedRecordingsBucketName || 'NOT SET'}, ` +
        `sharedRecordingsBucketArn: ${props.sharedRecordingsBucketArn || 'NOT SET'}. ` +
        `Both must be provided to use a shared bucket. Falling back to creating a dedicated bucket.`
      );
    }

    const useSharedBucket = hasSharedBucketName && hasSharedBucketArn;
    if (useSharedBucket) {
      console.log(`[ChimeStack] Using shared recordings bucket: ${props.sharedRecordingsBucketName}`);
    }

    // Create getRecordingFn outside conditional to ensure export always exists
    const getRecordingFn = new lambdaNode.NodejsFunction(this, 'GetRecordingFn', {
      functionName: `${this.stackName}-GetRecording`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-recording.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        RECORDINGS_BUCKET: '', // Will be updated if recording enabled
        RECORDING_METADATA_TABLE: '', // Will be updated if recording enabled
        JWT_SECRET: jwtSecretValue,
        RECORDING_ENABLED: recordingEnabled ? 'true' : 'false',
      },
    });

    // CRITICAL: Allow API Gateway to invoke GetRecording.
    // Without this, /admin/recordings/* returns 500 "Invalid permissions on Lambda function".
    // Use the same broad pattern as other Admin-invoked Chime lambdas (auth is enforced by the Authorizer).
    getRecordingFn.addPermission('AdminApiInvokeGetRecording', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`,
    });

    // Always export the ARN to prevent CloudFormation import failures
    new CfnOutput(this, 'GetRecordingFnArn', {
      value: getRecordingFn.functionArn,
      exportName: `${this.stackName}-GetRecordingFnArn`,
    });

    // ========================================
    // Optional: CONNECT CALL RECORDINGS (Connect/Lex AI)
    // ========================================
    // Allows the same /admin/recordings/call/{callId} endpoint to serve Connect recordings
    // for callIds like `connect-{ContactId}` by letting GetRecording:
    // - Query the unified CallAnalytics table for clinicId/timestamp
    // - List/presign the recording object in the Connect recordings bucket
    if (props.analyticsTableName) {
      getRecordingFn.addEnvironment('CALL_ANALYTICS_TABLE_NAME', props.analyticsTableName);
      getRecordingFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}/index/*`,
        ],
      }));
    }

    if (props.connectCallRecordingsBucketName) {
      getRecordingFn.addEnvironment('CONNECT_RECORDINGS_BUCKET', props.connectCallRecordingsBucketName);
      getRecordingFn.addEnvironment('CONNECT_RECORDINGS_PREFIX', props.connectCallRecordingsPrefix || '');

      // S3 read/list for Connect recordings bucket
      getRecordingFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${props.connectCallRecordingsBucketName}`],
      }));
      getRecordingFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${props.connectCallRecordingsBucketName}/*`],
      }));

      // KMS decrypt if Connect recordings are encrypted with a customer-managed key
      if (props.connectCallRecordingsKmsKeyArn) {
        getRecordingFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['kms:Decrypt', 'kms:DescribeKey'],
          resources: [props.connectCallRecordingsKmsKeyArn],
        }));
      }
    }

    if (recordingEnabled) { // Default to enabled
      console.log('[ChimeStack] Setting up call recording infrastructure');

      // CRITICAL FIX: Use shared bucket from AiAgentsStack if provided to avoid data fragmentation
      // This ensures both AI-handled and human-handled call recordings go to the same bucket
      if (useSharedBucket) {
        // Import the shared recordings bucket from AiAgentsStack
        // Note: Imported buckets are IBucket, not Bucket - we can't add event notifications to them
        const sharedBucket = s3.Bucket.fromBucketAttributes(this, 'SharedRecordingsBucket', {
          bucketName: props.sharedRecordingsBucketName!,
          bucketArn: props.sharedRecordingsBucketArn!,
        });
        recordingsBucket = sharedBucket;
        this.recordingsBucket = sharedBucket;
        isOwnedBucket = false; // Cannot add event notifications to imported buckets

        console.log(`[ChimeStack] Using shared recordings bucket: ${props.sharedRecordingsBucketName}`);
        // Note: Bucket policies and event notifications must be configured in AiAgentsStack
      } else {
        // Create ChimeStack's own recordings bucket (legacy behavior)
        console.log('[ChimeStack] Creating dedicated recordings bucket');

        // 1. KMS Key for encryption at rest (HIPAA compliance)
        recordingsKey = new kms.Key(this, 'RecordingsEncryptionKey', {
          description: 'Encryption key for call recordings',
          enableKeyRotation: true,
          removalPolicy: RemovalPolicy.RETAIN, // Keep keys even if stack is deleted
        });

        // Allow Chime to use the key
        recordingsKey.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowChimeToUseKey',
          principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
          actions: [
            'kms:Decrypt',
            'kms:GenerateDataKey'
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account
            }
          }
        }));

        // FIXED: Allow Transcribe to decrypt recordings AND encrypt transcription output
        recordingsKey.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowTranscribeToUseKey',
          principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
          actions: [
            'kms:Decrypt',           // Read encrypted audio files
            'kms:GenerateDataKey',   // Encrypt transcription output  
            'kms:DescribeKey',       // Get key metadata
            'kms:CreateGrant'        // Allow Transcribe to create grants for encryption
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'kms:ViaService': [
                `s3.${this.region}.amazonaws.com`,
                `transcribe.${this.region}.amazonaws.com`
              ],
              'kms:CallerAccount': this.account
            }
          }
        }));

        // 2. S3 Bucket for storing recordings
        const retentionDays = props.recordingRetentionDays || 2555; // ~7 years (common compliance requirement)

        const newRecordingsBucket = new s3.Bucket(this, 'CallRecordingsBucket', {
          bucketName: `${this.stackName.toLowerCase()}-recordings-${this.account}-${this.region}`,
          encryption: s3.BucketEncryption.KMS,
          encryptionKey: recordingsKey,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          versioned: true, // Protect against accidental deletion
          lifecycleRules: [
            {
              id: 'DeleteOldRecordings',
              enabled: true,
              expiration: Duration.days(retentionDays),
              noncurrentVersionExpiration: Duration.days(7), // Clean up old versions
            },
            {
              id: 'TransitionToGlacier',
              enabled: true,
              transitions: [
                {
                  storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                  transitionAfter: Duration.days(90),
                }
              ]
            }
          ],
          serverAccessLogsPrefix: 'access-logs/',
          objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
          removalPolicy: RemovalPolicy.RETAIN, // Never delete recordings accidentally
          autoDeleteObjects: false, // Extra safety - don't auto-delete
        });

        recordingsBucket = newRecordingsBucket;
        isOwnedBucket = true; // We own this bucket, can add event notifications

        // Bucket policy to allow Chime to write recordings
        // Includes security conditions to prevent confused deputy problem
        recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowChimeVoiceConnectorToWriteRecordings',
          principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
          actions: [
            's3:PutObject',
            's3:PutObjectAcl'
          ],
          resources: [recordingsBucket.arnForObjects('*')],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account
            },
            ArnLike: {
              'aws:SourceArn': `arn:aws:chime:*:${this.account}:sma/*`
            }
          }
        }));

        // FIXED: Allow AWS Transcribe to access bucket for transcription
        // Transcribe needs these permissions to read input files and write transcription results
        recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowTranscribeToAccessBucket',
          principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
          actions: [
            's3:GetBucketLocation',
            's3:ListBucket'
          ],
          resources: [recordingsBucket.bucketArn],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account
            }
          }
        }));

        recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowTranscribeToReadInputFiles',
          principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
          actions: [
            's3:GetObject'
          ],
          resources: [recordingsBucket.arnForObjects('recordings/*')],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account
            }
          }
        }));

        recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
          sid: 'AllowTranscribeToWriteTranscriptions',
          principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
          actions: [
            's3:PutObject'
          ],
          resources: [recordingsBucket.arnForObjects('transcriptions/*')],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account
            }
          }
        }));

        // Store recordingsBucket to public property
        this.recordingsBucket = recordingsBucket;
      }

      // 3. DynamoDB table for recording metadata
      this.recordingMetadataTable = new dynamodb.Table(this, 'RecordingMetadataTable', {
        tableName: `${this.stackName}-RecordingMetadata`,
        partitionKey: { name: 'recordingId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN, // Keep metadata
        pointInTimeRecovery: true,
        timeToLiveAttribute: 'ttl', // Auto-cleanup old metadata
      });
      applyTags(this.recordingMetadataTable, { Table: 'recording-metadata' });
      const recordingMetadataTable = this.recordingMetadataTable; // Keep local reference for backward compatibility

      // GSI: Query by callId
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'callId-index',
        partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // GSI: Query by transactionId/segmentId (allows lookups when CallAnalytics uses transactionId
      // but RecordingMetadata `callId` is the PSTN leg call ID).
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'segmentId-index',
        partitionKey: { name: 'segmentId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // GSI: Query by clinic and date
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'clinicId-timestamp-index',
        partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // GSI: Query by transcription job name (for processing transcription completion)
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'transcriptionJobName-index',
        partitionKey: { name: 'transcriptionJobName', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // 4. Lambda to process new recordings
      const recordingProcessorFn = new lambdaNode.NodejsFunction(this, 'RecordingProcessorFn', {
        functionName: `${this.stackName}-RecordingProcessor`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-recording.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.minutes(5), // Allow time for transcription
        memorySize: 1024,
        environment: {
          RECORDING_METADATA_TABLE_NAME: recordingMetadataTable.tableName, // FIXED: Added _NAME suffix
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          RECORDINGS_BUCKET_NAME: recordingsBucket.bucketName, // FIXED: Added missing bucket name
          AUTO_TRANSCRIBE_RECORDINGS: 'true', // FIXED: Renamed from ENABLE_TRANSCRIPTION
          ENABLE_SENTIMENT_ANALYSIS: 'true',
          MEDICAL_VOCABULARY_NAME: props.medicalVocabularyName || '',
          ENABLE_LANGUAGE_IDENTIFICATION: 'false', // Set to true to auto-detect language
          DEFAULT_LANGUAGE_CODE: 'en-US',
        },
        logRetention: logs.RetentionDays.ONE_MONTH,
      });

      // Grant permissions
      // Grant read/write access - Lambda needs to read recordings and write transcription metadata
      recordingsBucket.grantReadWrite(recordingProcessorFn);
      recordingMetadataTable.grantWriteData(recordingProcessorFn);
      this.callQueueTable.grantReadWriteData(recordingProcessorFn);
      this.agentPerformanceTable.grantReadWriteData(recordingProcessorFn);
      // Grant encrypt/decrypt for KMS - needed for both reading recordings and writing transcriptions
      // Only grant if using own bucket (shared bucket handles its own encryption)
      if (recordingsKey) {
        recordingsKey.grantEncryptDecrypt(recordingProcessorFn);
      }

      // Grant Transcribe permissions
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'transcribe:TagResource' // FIXED: Required for tagging transcription jobs
        ],
        resources: ['*']
      }));

      // CRITICAL: Explicit S3 permissions for Transcribe output
      // Ensures Lambda can specify the S3 output location for Transcribe
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
          's3:GetObject',
          's3:GetBucketLocation',
          's3:ListBucket'
        ],
        resources: [
          recordingsBucket.bucketArn,
          recordingsBucket.arnForObjects('*')
        ]
      }));

      // Grant Comprehend permissions
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'comprehend:DetectSentiment',
          'comprehend:BatchDetectSentiment'
        ],
        resources: ['*']
      }));

      // Trigger Lambda on new recordings
      // CRITICAL FIX: Only add event notifications to owned buckets
      // Imported buckets cannot have notifications added via CDK - must be configured in the owning stack
      if (isOwnedBucket && recordingsBucket instanceof s3.Bucket) {
        recordingsBucket.addEventNotification(
          s3.EventType.OBJECT_CREATED,
          new s3n.LambdaDestination(recordingProcessorFn),
          { prefix: 'recordings/', suffix: '.wav' }
        );
      } else {
        // IMPORTANT: When using a shared bucket from AiAgentsStack:
        // 1. S3 event notifications cannot be added via CDK to imported buckets
        // 2. AiAgentsStack MUST configure S3 event notifications for the recordings/ prefix
        // 3. The recordingProcessorFn ARN must be exported and used in AiAgentsStack
        console.warn(
          `[ChimeStack] SHARED BUCKET: Using shared recordings bucket '${recordingsBucket.bucketName}'. ` +
          `S3 event notifications for 'recordings/*.wav' files MUST be configured in AiAgentsStack ` +
          `to trigger the RecordingProcessor Lambda (${recordingProcessorFn.functionArn}). ` +
          `Without this configuration, recordings will not be automatically processed.`
        );

        // Export the RecordingProcessor ARN so AiAgentsStack can configure notifications
        new CfnOutput(this, 'RecordingProcessorFnArn', {
          value: recordingProcessorFn.functionArn,
          description: 'RecordingProcessor Lambda ARN - configure S3 event notification in AiAgentsStack',
          exportName: `${this.stackName}-RecordingProcessorFnArn`,
        });
      }

      // 5. Update SMA Handler environment variables
      smaHandler.addEnvironment('RECORDINGS_BUCKET', recordingsBucket.bucketName);
      smaHandler.addEnvironment('ENABLE_CALL_RECORDING', 'true');
      recordingsBucket.grantWrite(smaHandler);
      // Only grant KMS permissions if using own bucket
      if (recordingsKey) {
        recordingsKey.grantEncrypt(smaHandler);
      }

      // 6. Update getRecordingFn with actual bucket/table names (created outside conditional)
      getRecordingFn.addEnvironment('RECORDINGS_BUCKET', recordingsBucket.bucketName);
      getRecordingFn.addEnvironment('RECORDING_METADATA_TABLE', recordingMetadataTable.tableName);
      // Optional: allow GetRecording to map analytics callId -> pstnCallId via CallQueue (backward compatibility)
      getRecordingFn.addEnvironment('CALL_QUEUE_TABLE_NAME', this.callQueueTable.tableName);

      // Grant permissions to getRecordingFn
      recordingsBucket.grantRead(getRecordingFn);
      recordingMetadataTable.grantReadData(getRecordingFn);
      this.callQueueTable.grantReadData(getRecordingFn);
      // Only grant KMS permissions if using own bucket
      if (recordingsKey) {
        recordingsKey.grantDecrypt(getRecordingFn);
      }

      // 7. Lambda for getting agent performance reports
      const getAgentPerformanceFn = new lambdaNode.NodejsFunction(this, 'GetAgentPerformanceFn', {
        functionName: `${this.stackName}-GetAgentPerformance`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-agent-performance.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment: {
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          JWT_SECRET: jwtSecretValue,
        },
      });

      this.agentPerformanceTable.grantReadData(getAgentPerformanceFn);
      this.callQueueTable.grantReadData(getAgentPerformanceFn);

      getAgentPerformanceFn.addPermission('AdminApiInvokeGetAgentPerformance', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
      });

      // 8. Lambda for processing transcription completion and sentiment analysis
      const transcriptionCompleteFn = new lambdaNode.NodejsFunction(this, 'TranscriptionCompleteFn', {
        functionName: `${this.stackName}-TranscriptionComplete`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-transcription.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.minutes(2),
        memorySize: 1024,
        environment: {
          RECORDING_METADATA_TABLE_NAME: recordingMetadataTable.tableName,
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          RECORDINGS_BUCKET_NAME: recordingsBucket.bucketName,
        },
      });

      recordingsBucket.grantRead(transcriptionCompleteFn);
      recordingMetadataTable.grantReadWriteData(transcriptionCompleteFn);
      this.callQueueTable.grantReadWriteData(transcriptionCompleteFn);
      this.agentPerformanceTable.grantReadWriteData(transcriptionCompleteFn);
      // Only grant KMS permissions if using own bucket
      if (recordingsKey) {
        recordingsKey.grantDecrypt(transcriptionCompleteFn);
      }

      // Grant Comprehend permissions for sentiment analysis
      transcriptionCompleteFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'comprehend:DetectSentiment',
          'comprehend:BatchDetectSentiment'
        ],
        resources: ['*']
      }));

      // Grant Transcribe permissions to fetch job details
      transcriptionCompleteFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'transcribe:GetTranscriptionJob'
        ],
        resources: ['*']
      }));

      // Trigger on transcription completion via EventBridge
      const transcriptionRule = new events.Rule(this, 'TranscriptionCompleteRule', {
        eventPattern: {
          source: ['aws.transcribe'],
          detailType: ['Transcribe Job State Change'],
          detail: {
            TranscriptionJobStatus: ['COMPLETED', 'FAILED']
          }
        },
      });

      transcriptionRule.addTarget(new targets.LambdaFunction(transcriptionCompleteFn));

      // Outputs
      new CfnOutput(this, 'RecordingsBucketName', {
        value: recordingsBucket.bucketName,
        description: 'S3 bucket for call recordings (shared with AiAgentsStack)',
        exportName: `${this.stackName}-RecordingsBucketName`,
      });

      // CRITICAL FIX: Export bucket ARN for AiAgentsStack to use as shared bucket
      new CfnOutput(this, 'RecordingsBucketArn', {
        value: recordingsBucket.bucketArn,
        description: 'S3 bucket ARN for cross-stack IAM permissions',
        exportName: `${this.stackName}-RecordingsBucketArn`,
      });

      new CfnOutput(this, 'RecordingMetadataTableName', {
        value: recordingMetadataTable.tableName,
        description: 'DynamoDB table for recording metadata',
        exportName: `${this.stackName}-RecordingMetadataTable`,
      });

      // NOTE: GetRecordingFnArn export moved outside conditional block to prevent import failures

      new CfnOutput(this, 'GetAgentPerformanceFnArn', {
        value: getAgentPerformanceFn.functionArn,
        exportName: `${this.stackName}-GetAgentPerformanceFnArn`,
      });

      new CfnOutput(this, 'TranscriptionCompleteFnArn', {
        value: transcriptionCompleteFn.functionArn,
        exportName: `${this.stackName}-TranscriptionCompleteFnArn`,
      });

      // NOTE: AgentPerformanceTableName export removed - duplicate of AgentPerformanceTableNameExport
      // Use `${this.stackName}-AgentPerformanceTableName` export instead
    }

    // ========================================
    // CallQueue Stream Processor for Analytics
    // ========================================

    // Validate analytics configuration - warn if partially configured
    const hasAnalyticsTable = Boolean(props.analyticsTableName);
    const hasDedupTable = Boolean(props.analyticsDedupTableName);

    if (hasAnalyticsTable !== hasDedupTable) {
      console.warn(
        `[ChimeStack] PARTIAL CONFIGURATION: Analytics tables are partially configured. ` +
        `analyticsTableName: ${props.analyticsTableName || 'NOT SET'}, ` +
        `analyticsDedupTableName: ${props.analyticsDedupTableName || 'NOT SET'}. ` +
        `Both must be provided for call analytics to work. CallQueue stream processor will NOT be created.`
      );
    }

    // Only create if BOTH analytics table names are provided
    if (hasAnalyticsTable && hasDedupTable) {
      const callQueueStreamProcessor = new lambdaNode.NodejsFunction(this, 'CallQueueStreamProcessor', {
        functionName: `${this.stackName}-CallQueueStreamProcessor`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-call-analytics-stream.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(60),
        memorySize: 512,
        environment: {
          // Safe to use ! assertion - we checked hasAnalyticsTable && hasDedupTable above
          CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName!,
          ANALYTICS_DEDUP_TABLE: props.analyticsDedupTableName!,
          // CRITICAL FIX: Pass agent performance table name for metrics tracking
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Grant read access to CallQueue table's stream
      this.callQueueTable.grantStreamRead(callQueueStreamProcessor);

      // CRITICAL FIX: Grant write access to agent performance table for metrics tracking
      this.agentPerformanceTable.grantReadWriteData(callQueueStreamProcessor);

      // Grant write access to analytics tables (cross-stack permissions)
      callQueueStreamProcessor.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query'
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsDedupTableName}`
        ]
      }));

      // Grant read access to ClinicConfig and ClinicSecrets for patient data enrichment
      // This allows the analytics processor to fetch OpenDental credentials and clinic configuration
      // to enrich call analytics with patient information (name, patient number, etc.)
      callQueueStreamProcessor.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsights-ClinicConfig`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/TodaysDentalInsights-ClinicSecrets`
        ]
      }));

      // Grant KMS decrypt permissions for encrypted tables
      // ClinicConfig and ClinicSecrets tables are encrypted with KMS for security
      // The Lambda needs decrypt permissions to read the encrypted data
      callQueueStreamProcessor.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${this.region}:${this.account}:key/96008830-3929-4799-bd86-86fe635f4d85`]
      }));

      // Add DynamoDB Stream event source
      callQueueStreamProcessor.addEventSource(
        new lambdaEventSources.DynamoEventSource(this.callQueueTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 100,
          bisectBatchOnError: true,
          retryAttempts: 3,
          maxRecordAge: Duration.hours(24),
          parallelizationFactor: 1,
        })
      );

      new CfnOutput(this, 'CallQueueStreamProcessorArn', {
        value: callQueueStreamProcessor.functionArn,
        description: 'Lambda processing CallQueue DynamoDB Stream events for analytics',
        exportName: `${this.stackName}-CallQueueStreamProcessorArn`,
      });
    }

    // ========================================
    // AI CALLING (REMOVED FROM CHIME)
    // ========================================
    // ChimeStack no longer hosts AI voice conversations, AI-number ingress, or real-time transcription pipelines.
    // AI calling is provided by Amazon Connect + Lex (see connect-lex-ai-stack.ts).

    // ========================================
    // 13. CloudWatch Alarms for Monitoring
    // ========================================

    // Helper function to create Lambda error alarms
    const createLambdaErrorAlarm = (fn: lambda.IFunction, fnNameDisplay: string) => {
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
        alarmDescription: `Alert when ${fnNameDisplay} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create Lambda throttle alarms
    const createLambdaThrottleAlarm = (fn: lambda.IFunction, fnNameDisplay: string) => {
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
        alarmDescription: `Alert when ${fnNameDisplay} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create Lambda duration alarms (p99)
    const createLambdaDurationAlarm = (fn: lambda.IFunction, fnNameDisplay: string, thresholdMs: number) => {
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
        alarmDescription: `Alert when ${fnNameDisplay} Lambda duration exceeds ${thresholdMs}ms (p99)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create DynamoDB throttle alarms
    const createDynamoDBThrottleAlarm = (table: dynamodb.Table, tableName: string, operation: string) => {
      new cloudwatch.Alarm(this, `${table.node.id}${operation}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'UserErrors',
          dimensionsMap: { TableName: table.tableName, Operation: operation },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${tableName} ${operation} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Create alarms for all Lambda functions
    createLambdaErrorAlarm(startSessionFn, 'StartSession');
    createLambdaThrottleAlarm(startSessionFn, 'StartSession');
    createLambdaDurationAlarm(startSessionFn, 'StartSession', 8000); // 10s timeout, 80% = 8s

    createLambdaErrorAlarm(stopSessionFn, 'StopSession');
    createLambdaThrottleAlarm(stopSessionFn, 'StopSession');
    createLambdaDurationAlarm(stopSessionFn, 'StopSession', 8000);

    createLambdaErrorAlarm(outboundCallFn, 'OutboundCall');
    createLambdaThrottleAlarm(outboundCallFn, 'OutboundCall');
    createLambdaDurationAlarm(outboundCallFn, 'OutboundCall', 9000); // Complex operation

    createLambdaErrorAlarm(transferCallFn, 'TransferCall');
    createLambdaThrottleAlarm(transferCallFn, 'TransferCall');
    createLambdaDurationAlarm(transferCallFn, 'TransferCall', 9000);

    createLambdaErrorAlarm(callAcceptedFn, 'CallAccepted');
    createLambdaThrottleAlarm(callAcceptedFn, 'CallAccepted');
    createLambdaDurationAlarm(callAcceptedFn, 'CallAccepted', 8000);

    createLambdaErrorAlarm(callRejectedFn, 'CallRejected');
    createLambdaThrottleAlarm(callRejectedFn, 'CallRejected');
    createLambdaDurationAlarm(callRejectedFn, 'CallRejected', 8000);

    createLambdaErrorAlarm(callHungupFn, 'CallHungup');
    createLambdaThrottleAlarm(callHungupFn, 'CallHungup');
    createLambdaDurationAlarm(callHungupFn, 'CallHungup', 8000);

    createLambdaErrorAlarm(leaveCallFn, 'LeaveCall');
    createLambdaThrottleAlarm(leaveCallFn, 'LeaveCall');
    createLambdaDurationAlarm(leaveCallFn, 'LeaveCall', 8000);

    createLambdaErrorAlarm(holdCallFn, 'HoldCall');
    createLambdaThrottleAlarm(holdCallFn, 'HoldCall');
    createLambdaDurationAlarm(holdCallFn, 'HoldCall', 8000);

    createLambdaErrorAlarm(resumeCallFn, 'ResumeCall');
    createLambdaThrottleAlarm(resumeCallFn, 'ResumeCall');
    createLambdaDurationAlarm(resumeCallFn, 'ResumeCall', 8000);

    createLambdaErrorAlarm(heartbeatFn, 'Heartbeat');
    createLambdaThrottleAlarm(heartbeatFn, 'Heartbeat');
    createLambdaDurationAlarm(heartbeatFn, 'Heartbeat', 8000);

    createLambdaErrorAlarm(cleanupMonitorFn, 'CleanupMonitor');
    createLambdaThrottleAlarm(cleanupMonitorFn, 'CleanupMonitor');
    createLambdaDurationAlarm(cleanupMonitorFn, 'CleanupMonitor', 25000); // 30s timeout, 25s threshold

    // Create alarms for DynamoDB tables - monitor for throttling
    createDynamoDBThrottleAlarm(this.clinicsTable, 'ClinicsTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.clinicsTable, 'ClinicsTable', 'Query');

    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'Query');
    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'UpdateItem');

    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'Query');
    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'UpdateItem');

    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'PutItem');
    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'UpdateItem');

    // Create composite alarm for critical operations
    const criticalFunctionErrorMetrics = [
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: outboundCallFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: transferCallFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: callAcceptedFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
    ];

    new cloudwatch.Alarm(this, 'CriticalCallOperationsErrorAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'm1 + m2 + m3',
        usingMetrics: {
          m1: criticalFunctionErrorMetrics[0],
          m2: criticalFunctionErrorMetrics[1],
          m3: criticalFunctionErrorMetrics[2],
        },
      }),
      threshold: 2,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when critical call operations (OutboundCall, TransferCall, CallAccepted) have combined errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
