import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, Fn } from 'aws-cdk-lib';
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
  callQueueTableStreamArn?: string; // Optional: will be passed from ChimeStack
  callQueueTableName?: string; // Optional: for reconciliation job
  supervisorEmails?: string[]; // Optional: emails for critical alert notifications
  agentPresenceTableName?: string; // Optional: for real-time coaching
  agentPerformanceTableName?: string; // Optional: for enhanced metrics
}

export class AnalyticsStack extends Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly analyticsDedupTable: dynamodb.Table;
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
    // 5. CloudWatch Outputs
    // ========================================

    new CfnOutput(this, 'AnalyticsTableName', {
      value: this.analyticsTable.tableName,
      description: 'DynamoDB Analytics Table Name',
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

  }
}
