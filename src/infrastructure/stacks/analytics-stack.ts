import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { KinesisEventSource, SqsEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface AnalyticsStackProps extends StackProps {
  userPoolId: string;
  region: string;
  callQueueTableStreamArn?: string; // Optional: will be passed from ChimeStack
}

export class AnalyticsStack extends Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly analyticsDedupTable: dynamodb.Table;
  public readonly analyticsStream: kinesis.Stream;
  public readonly analyticsProcessor: lambda.Function;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. Analytics DynamoDB Table
    // ========================================

    this.analyticsTable = new dynamodb.Table(this, 'CallAnalyticsTable', {
      tableName: `${this.stackName}-CallAnalytics`,
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
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

    // Permanent failures table for DLQ triage visibility
    const analyticsFailuresTable = new dynamodb.Table(this, 'AnalyticsFailuresTable', {
      tableName: `${this.stackName}-AnalyticsFailures`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Deduplication table for preventing duplicate analytics processing
    this.analyticsDedupTable = new dynamodb.Table(this, 'AnalyticsDedupTable', {
      tableName: `${this.stackName}-CallAnalytics-dedup`,
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup after 7 days
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
    // 3. Analytics Processor Lambda
    // ========================================

    this.analyticsProcessor = new lambdaNode.NodejsFunction(this, 'AnalyticsProcessor', {
      functionName: `${this.stackName}-AnalyticsProcessor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-call-analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        ANALYTICS_RETENTION_DAYS: '90',
        COGNITO_REGION: props.region,
        USER_POOL_ID: props.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to analytics processor
    this.analyticsTable.grantReadWriteData(this.analyticsProcessor);
    this.analyticsStream.grantRead(this.analyticsProcessor);

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
      exportName: `${this.stackName}-AnalyticsTableName`,
    });

    new CfnOutput(this, 'AnalyticsStreamName', {
      value: this.analyticsStream.streamName,
      description: 'Kinesis Analytics Stream Name',
      exportName: `${this.stackName}-AnalyticsStreamName`,
    });

    new CfnOutput(this, 'AnalyticsStreamArn', {
      value: this.analyticsStream.streamArn,
      description: 'Kinesis Analytics Stream ARN',
      exportName: `${this.stackName}-AnalyticsStreamArn`,
    });

    new CfnOutput(this, 'AnalyticsProcessorFunctionArn', {
      value: this.analyticsProcessor.functionArn,
      description: 'Analytics Processor Lambda ARN',
      exportName: `${this.stackName}-AnalyticsProcessorArn`,
    });

    new CfnOutput(this, 'AnalyticsDLQUrl', {
      value: analyticsDLQ.queueUrl,
      description: 'Analytics DLQ URL',
      exportName: `${this.stackName}-AnalyticsDLQUrl`,
    });

    new CfnOutput(this, 'AnalyticsFailuresTableName', {
      value: analyticsFailuresTable.tableName,
      description: 'Table storing permanently failed analytics events',
      exportName: `${this.stackName}-AnalyticsFailuresTable`,
    });

    new CfnOutput(this, 'AnalyticsDlqProcessorArn', {
      value: analyticsDlqProcessor.functionArn,
      description: 'Lambda that reprocesses analytics DLQ events',
      exportName: `${this.stackName}-AnalyticsDlqProcessorArn`,
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
        exportName: `${this.stackName}-CallQueueStreamProcessorArn`,
      });

      new CfnOutput(this, 'AnalyticsDedupTableName', {
        value: this.analyticsDedupTable.tableName,
        description: 'Deduplication table for analytics events',
        exportName: `${this.stackName}-AnalyticsDedupTable`,
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
      memorySize: 256,
      environment: {
        CALL_ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions
    this.analyticsTable.grantReadWriteData(finalizeAnalyticsFn);

    // Schedule to run every minute
    const finalizationRule = new events.Rule(this, 'AnalyticsFinalizationRule', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      description: 'Finalize analytics records after buffer window',
    });

    finalizationRule.addTarget(new targets.LambdaFunction(finalizeAnalyticsFn));

    new CfnOutput(this, 'FinalizeAnalyticsFunctionArn', {
      value: finalizeAnalyticsFn.functionArn,
      description: 'Analytics Finalization Lambda ARN',
      exportName: `${this.stackName}-FinalizeAnalyticsArn`,
    });
  }
}
