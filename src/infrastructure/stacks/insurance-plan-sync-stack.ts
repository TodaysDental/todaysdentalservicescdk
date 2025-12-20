import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export interface InsurancePlanSyncStackProps extends StackProps {
  consolidatedTransferServerId: string;
}

export class InsurancePlanSyncStack extends Stack {
  public readonly insurancePlansTable: dynamodb.Table;
  public readonly syncFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: InsurancePlanSyncStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'InsurancePlanSync',
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
    // Table to store insurance plan data from all clinics
    // PK: clinicId#groupNumber, SK: insuranceName#groupName
    this.insurancePlansTable = new dynamodb.Table(this, 'InsurancePlansTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-InsurancePlans`,
      // Enable point-in-time recovery for data protection
      pointInTimeRecovery: true,
    });
    applyTags(this.insurancePlansTable, { Table: 'insurance-plans' });

    // Add GSI for querying by clinicId only
    this.insurancePlansTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for querying by insuranceName across all clinics
    this.insurancePlansTable.addGlobalSecondaryIndex({
      indexName: 'insuranceName-index',
      partitionKey: { name: 'insuranceName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================
    // Sync Lambda - runs every 15 minutes to fetch insurance plan data
    this.syncFn = new lambdaNode.NodejsFunction(this, 'InsurancePlanSyncFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'insurance-plan-sync', 'sync-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024, // Higher memory for processing multiple clinics
      timeout: Duration.minutes(10), // Long timeout for processing all clinics sequentially
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],  // Native .node binaries can't be bundled
        nodeModules: ['ssh2'],  // Include ssh2 in node_modules for Lambda
        minify: true,
        sourceMap: true,
      },
      environment: {
        INSURANCE_PLANS_TABLE: this.insurancePlansTable.tableName,
        CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        CONSOLIDATED_SFTP_PASSWORD: 'Clinic@2020!',
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      retryAttempts: 0, // Don't retry on failure - next scheduled run will pick up
    });
    applyTags(this.syncFn, { Function: 'insurance-plan-sync' });

    // Grant permissions to DynamoDB table
    this.insurancePlansTable.grantReadWriteData(this.syncFn);

    // ========================================
    // EVENTBRIDGE SCHEDULE
    // ========================================
    // Run the sync Lambda every 15 minutes
    new events.Rule(this, 'InsurancePlanSyncScheduleRule', {
      description: 'Runs insurance plan sync every 15 minutes to fetch latest data from OpenDental',
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.syncFn)],
    });

    // ========================================
    // CLOUDWATCH MONITORING
    // ========================================
    // Lambda alarms
    createLambdaErrorAlarm(this.syncFn, 'insurance-plan-sync');
    createLambdaThrottleAlarm(this.syncFn, 'insurance-plan-sync');
    createLambdaDurationAlarm(this.syncFn, 'insurance-plan-sync', Math.floor(Duration.minutes(10).toMilliseconds() * 0.8));

    // DynamoDB throttle alarm
    createDynamoThrottleAlarm(this.insurancePlansTable.tableName, 'InsurancePlansTable');

    // Custom metric for sync success rate
    new cloudwatch.Alarm(this, 'InsurancePlanSyncSuccessAlarm', {
      alarmName: `${this.stackName}-SyncSuccessRate`,
      alarmDescription: 'Alert when insurance plan sync has too many errors',
      metric: this.syncFn.metricErrors({
        period: Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 3, // Alert if 3+ errors in an hour
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'InsurancePlansTableName', {
      value: this.insurancePlansTable.tableName,
      description: 'Name of the Insurance Plans DynamoDB table',
      exportName: `${Stack.of(this).stackName}-InsurancePlansTableName`,
    });

    new CfnOutput(this, 'InsurancePlansTableArn', {
      value: this.insurancePlansTable.tableArn,
      description: 'ARN of the Insurance Plans DynamoDB table',
      exportName: `${Stack.of(this).stackName}-InsurancePlansTableArn`,
    });

    new CfnOutput(this, 'SyncFunctionName', {
      value: this.syncFn.functionName,
      description: 'Name of the sync Lambda function',
      exportName: `${Stack.of(this).stackName}-SyncFunctionName`,
    });

    new CfnOutput(this, 'SyncFunctionArn', {
      value: this.syncFn.functionArn,
      description: 'ARN of the sync Lambda function',
      exportName: `${Stack.of(this).stackName}-SyncFunctionArn`,
    });
  }
}
