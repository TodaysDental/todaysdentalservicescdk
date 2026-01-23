import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export interface FeeScheduleSyncStackProps extends StackProps {
  consolidatedTransferServerId: string;
  /** GlobalSecrets DynamoDB table name for retrieving SFTP credentials */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
}

export class FeeScheduleSyncStack extends Stack {
  public readonly feeSchedulesTable: dynamodb.Table;
  public readonly syncFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: FeeScheduleSyncStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'FeeScheduleSync',
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
    // Table to store fee schedule data from all clinics
    // Primary Key Design:
    //   PK: clinicId#FeeSchedNum - Partition key (clinic + fee schedule)
    //   SK: ProcCode - Sort key (procedure code)
    // This allows efficient queries for:
    //   - All procedures in a specific fee schedule for a clinic (Query by PK)
    //   - Specific fee for a procedure in a fee schedule (Query by PK + SK)
    this.feeSchedulesTable = new dynamodb.Table(this, 'FeeSchedulesTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-FeeSchedules`,
      // Enable point-in-time recovery for data protection
      pointInTimeRecovery: true,
    });
    applyTags(this.feeSchedulesTable, { Table: 'fee-schedules' });

    // ========================================
    // GLOBAL SECONDARY INDEXES
    // ========================================

    // GSI 1: clinicId-index
    // Purpose: Query ALL fee schedules and their fees for a specific clinic
    // Access Pattern: "Get all fee entries for clinic X"
    // PK: clinicId
    // SK: feeSchedNum (to group by fee schedule within a clinic)
    this.feeSchedulesTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'feeSchedNum', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI 2: feeSchedule-index
    // Purpose: Find the same fee schedule name across all clinics
    // Access Pattern: "Find all clinics that have fee schedule named 'Standard Fees'"
    // PK: feeSchedule (Description)
    // SK: clinicId (to list all clinics with this fee schedule)
    this.feeSchedulesTable.addGlobalSecondaryIndex({
      indexName: 'feeSchedule-index',
      partitionKey: { name: 'feeSchedule', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI 3: procCode-index
    // Purpose: Find fees for a specific procedure code across all schedules and clinics
    // Access Pattern: "What are the fees for procedure D0120 across all clinics and schedules?"
    // PK: procCode
    // SK: pk (clinicId#FeeSchedNum) to get unique fee schedule entries per clinic
    this.feeSchedulesTable.addGlobalSecondaryIndex({
      indexName: 'procCode-index',
      partitionKey: { name: 'procCode', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI 4: feeSchedNum-clinicId-index
    // Purpose: Query by FeeSchedNum across clinics (useful for finding same schedule ID in different clinics)
    // Access Pattern: "Find all entries for FeeSchedNum 1 across all clinics"
    // PK: feeSchedNum
    // SK: clinicId
    this.feeSchedulesTable.addGlobalSecondaryIndex({
      indexName: 'feeSchedNum-clinicId-index',
      partitionKey: { name: 'feeSchedNum', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================
    // Sync Lambda - runs every 15 minutes to fetch fee schedule data
    this.syncFn = new lambdaNode.NodejsFunction(this, 'FeeScheduleSyncFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'fee-schedule-sync', 'sync-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 2048, // Higher memory for processing large fee schedule data
      timeout: Duration.minutes(14), // Long timeout for processing all clinics sequentially (fee schedules can be large)
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],  // Native .node binaries can't be bundled
        nodeModules: ['ssh2'],  // Include ssh2 in node_modules for Lambda
        minify: true,
        sourceMap: true,
      },
      environment: {
        FEE_SCHEDULES_TABLE: this.feeSchedulesTable.tableName,
        CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        // Secrets tables for dynamic SFTP credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
      retryAttempts: 0, // Don't retry on failure - next scheduled run will pick up
    });
    applyTags(this.syncFn, { Function: 'fee-schedule-sync' });

    // Grant permissions to DynamoDB table
    this.feeSchedulesTable.grantReadWriteData(this.syncFn);

    // Grant read access to secrets tables for credential retrieval (includes Scan for getAllClinicSecrets/getAllClinicConfigs)
    const globalSecretsTableName = props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets';
    const clinicSecretsTableName = props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets';
    const clinicConfigTableName = props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig';

    this.syncFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${globalSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${globalSecretsTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicSecretsTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTableName}/index/*`,
      ],
    }));

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      this.syncFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // ========================================
    // EVENTBRIDGE SCHEDULE
    // ========================================
    // Run the sync Lambda every 15 minutes (same as insurance plans)
    new events.Rule(this, 'FeeScheduleSyncScheduleRule', {
      description: 'Runs fee schedule sync every 15 minutes to fetch latest data from OpenDental',
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.syncFn)],
    });

    // ========================================
    // CLOUDWATCH MONITORING
    // ========================================
    // Lambda alarms
    createLambdaErrorAlarm(this.syncFn, 'fee-schedule-sync');
    createLambdaThrottleAlarm(this.syncFn, 'fee-schedule-sync');
    createLambdaDurationAlarm(this.syncFn, 'fee-schedule-sync', Math.floor(Duration.minutes(14).toMilliseconds() * 0.8));

    // DynamoDB throttle alarm
    createDynamoThrottleAlarm(this.feeSchedulesTable.tableName, 'FeeSchedulesTable');

    // Custom metric for sync success rate
    new cloudwatch.Alarm(this, 'FeeScheduleSyncSuccessAlarm', {
      alarmName: `${this.stackName}-SyncSuccessRate`,
      alarmDescription: 'Alert when fee schedule sync has too many errors',
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
    new CfnOutput(this, 'FeeSchedulesTableName', {
      value: this.feeSchedulesTable.tableName,
      description: 'Name of the Fee Schedules DynamoDB table',
      exportName: `${Stack.of(this).stackName}-FeeSchedulesTableName`,
    });

    new CfnOutput(this, 'FeeSchedulesTableArn', {
      value: this.feeSchedulesTable.tableArn,
      description: 'ARN of the Fee Schedules DynamoDB table',
      exportName: `${Stack.of(this).stackName}-FeeSchedulesTableArn`,
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

