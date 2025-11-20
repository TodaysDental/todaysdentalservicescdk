import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface AnalyticsStackProps extends StackProps {
  userPoolId: string;
  region: string;
}

export class AnalyticsStack extends Stack {
  public readonly analyticsTable: dynamodb.Table;
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
      runtime: lambda.Runtime.NODEJS_18_X,
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

    // Add Kinesis event source to Lambda
    this.analyticsProcessor.addEventSource(
      new KinesisEventSource(this.analyticsStream, {
        batchSize: 100,
        startingPosition: lambda.StartingPosition.LATEST,
        parallelizationFactor: 10,
      })
    );

    // ========================================
    // 4. CloudWatch Outputs
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
  }
}
