import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
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

export interface AnalyticsStackProps extends StackProps {
  userPoolId: string;
  region: string;
  callQueueTableStreamArn?: string; // Optional: will be passed from ChimeStack
  callQueueTableName?: string; // Optional: for reconciliation job
  supervisorEmails?: string[]; // Optional: emails for critical alert notifications
  agentPresenceTableName?: string; // Optional: for real-time coaching
  agentPerformanceTableName?: string; // Optional: for enhanced metrics
}

export class AnalyticsStack extends Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly analyticsDedupTable: dynamodb.Table;
  public readonly analyticsStream: kinesis.Stream;
  public readonly analyticsProcessor: lambda.Function;
  public readonly callAlertsTopic: sns.Topic;
  public readonly medicalVocabularyName: string;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. Analytics DynamoDB Table
    // ========================================

    this.analyticsTable = new dynamodb.Table(this, 'CallAnalyticsTable', {
      tableName: `${this.stackName}-CallAnalyticsV2`,
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for real-time coaching
    });

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
    // NOTE: DynamoDB only allows adding one GSI at a time. Deploy this first,
    // then uncomment the second GSI (clinicId-callCategory-index) and deploy again.
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'callCategory-timestamp-index',
      partitionKey: { name: 'callCategory', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // SECOND GSI - Uncomment after first GSI is deployed successfully
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

    // Permanent failures table for DLQ triage visibility
    const analyticsFailuresTable = new dynamodb.Table(this, 'AnalyticsFailuresTable', {
      tableName: `${this.stackName}-AnalyticsFailuresV2`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Deduplication table for preventing duplicate analytics processing
    this.analyticsDedupTable = new dynamodb.Table(this, 'AnalyticsDedupTable', {
      tableName: `${this.stackName}-CallAnalytics-dedupV2`,
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup after 7 days
    });

    // **NEW: Transcript Buffer table for persistent transcript storage**
    const transcriptBufferTable = new dynamodb.Table(this, 'TranscriptBufferTable', {
      tableName: `${this.stackName}-TranscriptBuffersV2`,
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup after call ends
    });

    // **NEW: Agent Performance Failures table for permanent failure storage**
    const agentPerformanceFailuresTable = new dynamodb.Table(this, 'AgentPerformanceFailuresTable', {
      tableName: `${this.stackName}-AgentPerformanceFailuresV2`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Keep failures for 90 days
    });

    // ========================================
    // 2. Kinesis Stream for Analytics Events
    // ========================================

    this.analyticsStream = new kinesis.Stream(this, 'AnalyticsStream', {
      streamName: `${this.stackName}-analytics-stream`,
      shardCount: 1,
      retentionPeriod: Duration.hours(24),
      removalPolicy: RemovalPolicy.DESTROY,
    });

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
    // 3. Analytics Processor Lambda
    // ========================================

    this.analyticsProcessor = new lambdaNode.NodejsFunction(this, 'AnalyticsProcessor', {
      functionName: `${this.stackName}-AnalyticsProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-call-analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 1024, // Increased for Comprehend processing
      environment: {
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        ANALYTICS_RETENTION_DAYS: '90',
        COGNITO_REGION: props.region,
        USER_POOL_ID: props.userPoolId,
        CALL_ALERTS_TOPIC_ARN: this.callAlertsTopic.topicArn,
        ENABLE_REAL_TIME_SENTIMENT: 'true', // Use Comprehend for sentiment
        ENABLE_REAL_TIME_ALERTS: 'true',
        MEDICAL_VOCABULARY_NAME: this.medicalVocabularyName,
        DEFAULT_LANGUAGE: 'en', // Can be overridden per call
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to analytics processor
    this.analyticsTable.grantReadWriteData(this.analyticsProcessor);
    this.analyticsStream.grantRead(this.analyticsProcessor);
    this.callAlertsTopic.grantPublish(this.analyticsProcessor);

    // Grant AWS Comprehend permissions for real-time sentiment analysis
    this.analyticsProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'comprehend:DetectSentiment',
        'comprehend:DetectKeyPhrases',
        'comprehend:DetectEntities',
        'comprehend:BatchDetectSentiment',
      ],
      resources: ['*'],
    }));

    // Grant Transcribe permissions to read vocabulary
    this.analyticsProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:GetVocabulary',
      ],
      resources: [
        `arn:aws:transcribe:${this.region}:${this.account}:vocabulary/${this.medicalVocabularyName}`,
      ],
    }));

    // Dead Letter Queue for failed analytics events
    const analyticsDLQ = new sqs.Queue(this, 'AnalyticsDLQ', {
      queueName: `${this.stackName}-analytics-dlq`,
      retentionPeriod: Duration.days(14), // Keep failed events for 2 weeks
      visibilityTimeout: Duration.seconds(300), // Match DLQ processor timeout
    });

    // Add Kinesis event source to Lambda with DLQ configuration
    this.analyticsProcessor.addEventSource(
      new KinesisEventSource(this.analyticsStream, {
        batchSize: 100,
        startingPosition: lambda.StartingPosition.LATEST,
        parallelizationFactor: 10,
        onFailure: new SqsDlq(analyticsDLQ),
        retryAttempts: 3,
        maxRecordAge: Duration.hours(24),
        bisectBatchOnError: true, // Split batch on error to isolate bad records
      })
    );

    // ========================================
    // 4. Analytics DLQ Processor
    // ========================================

    const analyticsDlqProcessor = new lambdaNode.NodejsFunction(this, 'AnalyticsDlqProcessor', {
      functionName: `${this.stackName}-AnalyticsDlqProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'analytics-dlq-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        PERMANENT_FAILURES_TABLE: analyticsFailuresTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.analyticsTable.grantReadWriteData(analyticsDlqProcessor);
    analyticsFailuresTable.grantWriteData(analyticsDlqProcessor);
    analyticsDLQ.grantConsumeMessages(analyticsDlqProcessor);

    analyticsDlqProcessor.addEventSource(new SqsEventSource(analyticsDLQ, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(30),
      reportBatchItemFailures: true,
    }));

    // ========================================
    // 5. CloudWatch Outputs
    // ========================================

    new CfnOutput(this, 'AnalyticsTableName', {
      value: this.analyticsTable.tableName,
      description: 'DynamoDB Analytics Table Name',
    });

    new CfnOutput(this, 'AnalyticsStreamName', {
      value: this.analyticsStream.streamName,
      description: 'Kinesis Analytics Stream Name',
    });

    new CfnOutput(this, 'AnalyticsStreamArn', {
      value: this.analyticsStream.streamArn,
      description: 'Kinesis Analytics Stream ARN',
    });

    new CfnOutput(this, 'AnalyticsProcessorFunctionArn', {
      value: this.analyticsProcessor.functionArn,
      description: 'Analytics Processor Lambda ARN',
    });

    new CfnOutput(this, 'AnalyticsDLQUrl', {
      value: analyticsDLQ.queueUrl,
      description: 'Analytics DLQ URL',
    });

    new CfnOutput(this, 'AnalyticsFailuresTableName', {
      value: analyticsFailuresTable.tableName,
      description: 'Table storing permanently failed analytics events',
    });

    new CfnOutput(this, 'AnalyticsDlqProcessorArn', {
      value: analyticsDlqProcessor.functionArn,
      description: 'Lambda that reprocesses analytics DLQ events',
    });

    // ========================================
    // 5.5. CallQueue Stream Processor (DynamoDB Streams)
    // ========================================

    // Only create if callQueueTableStreamArn is provided
    if (props.callQueueTableStreamArn) {
      const callQueueStreamProcessor = new lambdaNode.NodejsFunction(this, 'CallQueueStreamProcessor', {
        functionName: `${this.stackName}-CallQueueStreamProcessor`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-call-analytics-stream.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(60),
        memorySize: 512,
        environment: {
          CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
          ANALYTICS_DEDUP_TABLE: this.analyticsDedupTable.tableName,
        },
        bundling: {
          format: lambdaNode.OutputFormat.CJS,
          target: 'node20',
          externalModules: ['@aws-sdk/*'],
          nodeModules: [],
          // Ensure clinic configuration JSON is included
          loader: {
            '.json': 'copy',
          },
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Grant permissions
      this.analyticsTable.grantReadWriteData(callQueueStreamProcessor);
      this.analyticsDedupTable.grantReadWriteData(callQueueStreamProcessor);

      // Add DynamoDB Stream event source
      callQueueStreamProcessor.addEventSource(
        new lambdaEventSources.DynamoEventSource(
          // Import the stream from ARN
          dynamodb.Table.fromTableAttributes(this, 'ImportedCallQueueTable', {
            tableStreamArn: props.callQueueTableStreamArn,
          }) as any,
          {
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 100,
            bisectBatchOnError: true,
            retryAttempts: 3,
            maxRecordAge: Duration.hours(24),
            parallelizationFactor: 1,
          }
        )
      );

      new CfnOutput(this, 'CallQueueStreamProcessorArn', {
        value: callQueueStreamProcessor.functionArn,
        description: 'Lambda processing CallQueue DynamoDB Stream events',
      });

      new CfnOutput(this, 'AnalyticsDedupTableName', {
        value: this.analyticsDedupTable.tableName,
        description: 'Deduplication table for analytics events',
      });
    }

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
        AGENT_PERFORMANCE_TABLE_NAME: props.agentPerformanceTableName || '',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions
    this.analyticsTable.grantReadWriteData(finalizeAnalyticsFn);

    // Grant permission to update agent performance table if provided
    if (props.agentPerformanceTableName) {
      finalizeAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPerformanceTableName}`,
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
        AGENT_PERFORMANCE_TABLE_NAME: props.agentPerformanceTableName || '',
        RECONCILIATION_TABLE_NAME: reconciliationTable.tableName,
        RECONCILIATION_ALERT_TOPIC_ARN: reconciliationAlertTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant permissions
    this.analyticsTable.grantReadData(reconciliationJobFn);
    reconciliationTable.grantReadWriteData(reconciliationJobFn);
    reconciliationAlertTopic.grantPublish(reconciliationJobFn);

    if (props.agentPerformanceTableName) {
      reconciliationJobFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPerformanceTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPerformanceTableName}/index/*`,
        ],
      }));
    }

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

    // Use imported call queue table name from ChimeStack
    // ChimeStack exports this value as "${ChimeStackName}-CallQueueTableName"
    const callQueueTableName = props.callQueueTableName || 'TodaysDentalInsightsChimeV23-CallQueueV2';
    
    const reconcileAnalyticsFn = new lambdaNode.NodejsFunction(this, 'ReconcileAnalyticsFunction', {
      functionName: `${this.stackName}-ReconcileAnalytics`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'reconcile-analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15), // Long-running job
      memorySize: 512,
      environment: {
        CALL_QUEUE_TABLE_NAME: callQueueTableName,
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions
    this.analyticsTable.grantReadData(reconcileAnalyticsFn);
    this.analyticsDedupTable.grantReadWriteData(reconcileAnalyticsFn);

    // Grant permission to read CallQueue and trigger reprocessing
    reconcileAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:Scan',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${callQueueTableName}`,
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

    // ========================================
    // 8. Real-Time Coaching Lambda
    // ========================================
    // 
    // Provides real-time coaching suggestions to agents during live calls
    // based on call analytics and transcript analysis.
    //
    // LIVE COACHING SUGGESTIONS (8 Rules):
    //
    // 1. TALK_TIME - Agent Talk Ratio Analysis
    //    - WARNING: Agent talking > 70% of time
    //      Message: "You are talking more than 70% of the time. Try to listen more and ask open-ended questions."
    //      Priority: 4
    //    - INFO: Agent talking < 30% of time
    //      Message: "Customer is doing most of the talking. Ensure you are providing helpful information."
    //      Priority: 2
    //
    // 2. CUSTOMER_SENTIMENT - Frustration Detection
    //    - WARNING: Customer frustration detected in transcript
    //      Message: "Customer frustration detected. Use empathetic language and acknowledge their concerns."
    //      Priority: 5 (HIGHEST)
    //
    // 3. INTERRUPTIONS - Active Listening
    //    - WARNING: Interruption count > 3
    //      Message: "Multiple interruptions detected. Allow the customer to finish speaking."
    //      Priority: 4
    //
    // 4. ENGAGEMENT - Silence Period Monitoring
    //    - INFO: Silence periods > 3
    //      Message: "Multiple silence periods detected. Keep the conversation flowing with engaging questions."
    //      Priority: 3
    //
    // 5. SENTIMENT_TREND - Declining Sentiment Detection
    //    - WARNING: 2+ negative sentiments in last 3 segments
    //      Message: "Recent sentiment is declining. Consider offering solutions or escalating if needed."
    //      Priority: 4
    //
    // 6. PERFORMANCE - Positive Reinforcement
    //    - POSITIVE: Overall sentiment positive with 5+ segments
    //      Message: "Great job! Customer sentiment is positive. Keep up the good work!"
    //      Priority: 2
    //
    // 7. DURATION - Long Call Management
    //    - INFO: Call duration > 15 minutes
    //      Message: "Call duration is over 15 minutes. Consider summarizing and wrapping up."
    //      Priority: 3
    //
    // 8. ESCALATION - Critical Issue Handling
    //    - WARNING: Customer requested escalation
    //      Message: "Customer requested escalation. Transfer to supervisor if unable to resolve."
    //      Priority: 5 (HIGHEST)
    //
    // Suggestions are sent via IoT Core WebSocket to agent dashboard
    // Top 2 highest priority suggestions are displayed in real-time
    // Agent presence table is updated with latest coaching tips
    //
    // ========================================

    if (props.agentPresenceTableName) {
      const realTimeCoachingFn = new lambdaNode.NodejsFunction(this, 'RealTimeCoachingFunction', {
        functionName: `${this.stackName}-RealTimeCoaching`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'real-time-coaching.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName,
          // Live Coaching Suggestions Configuration
          // RULE 1: Agent Talk Time Thresholds
          AGENT_TALK_HIGH_THRESHOLD: '70', // Warning if agent talks more than 70%
          AGENT_TALK_LOW_THRESHOLD: '30', // Info if agent talks less than 30%
          // RULE 2: Customer Frustration Detection
          ENABLE_FRUSTRATION_DETECTION: 'true',
          // RULE 3: Interruption Thresholds
          INTERRUPTION_WARNING_THRESHOLD: '3', // Warning after 3 interruptions
          // RULE 4: Silence Detection
          SILENCE_PERIODS_THRESHOLD: '3', // Info after 3 silence periods
          // RULE 5: Sentiment Trend Analysis
          SENTIMENT_TREND_WINDOW: '3', // Analyze last 3 sentiment readings
          NEGATIVE_SENTIMENT_THRESHOLD: '2', // Warning if 2+ negative in window
          // RULE 6: Positive Reinforcement
          ENABLE_POSITIVE_REINFORCEMENT: 'true',
          POSITIVE_REINFORCEMENT_MIN_SEGMENTS: '5', // Min segments before positive feedback
          // RULE 7: Call Duration Monitoring
          LONG_CALL_DURATION_MINUTES: '15', // Info after 15 minutes
          // RULE 8: Escalation Detection
          ENABLE_ESCALATION_DETECTION: 'true',
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Grant permissions to read analytics and update agent presence
      this.analyticsTable.grantStreamRead(realTimeCoachingFn);

      // Add DynamoDB Stream event source
      realTimeCoachingFn.addEventSource(
        new lambdaEventSources.DynamoEventSource(this.analyticsTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          bisectBatchOnError: true,
          retryAttempts: 2,
          maxRecordAge: Duration.minutes(5),
          filters: [
            // Only process records with transcript updates
            lambda.FilterCriteria.filter({
              eventName: lambda.FilterRule.isEqual('MODIFY'),
            }),
          ],
        })
      );

      // Grant IoT permissions for real-time agent notifications
      realTimeCoachingFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'iot:Publish',
          'iot:Connect',
        ],
        resources: ['*'], // Fine-grained in production
      }));

      // Grant permission to update agent presence
      realTimeCoachingFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}`,
        ],
      }));

      new CfnOutput(this, 'RealTimeCoachingFunctionArn', {
        value: realTimeCoachingFn.functionArn,
        description: 'Real-time coaching Lambda ARN',
      });
    }
  }
}
