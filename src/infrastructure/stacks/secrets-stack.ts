/**
 * SecretsStack - Centralized secrets management with KMS-encrypted DynamoDB tables
 * 
 * This stack creates three DynamoDB tables for storing:
 * 1. ClinicSecrets - Per-clinic sensitive credentials (API keys, passwords)
 * 2. GlobalSecrets - System-wide API keys and credentials
 * 3. ClinicConfig - Non-sensitive clinic configuration data
 * 
 * All tables are encrypted with a Customer Managed KMS key.
 */

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, CustomResource, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export interface SecretsStackProps extends StackProps {
  /**
   * Whether to seed initial data from JSON config files during deployment.
   * Default: true
   */
  seedInitialData?: boolean;
}

export class SecretsStack extends Stack {
  // KMS Key for encryption
  public readonly secretsEncryptionKey: kms.Key;

  // DynamoDB Tables
  public readonly clinicSecretsTable: dynamodb.Table;
  public readonly globalSecretsTable: dynamodb.Table;
  public readonly clinicConfigTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: SecretsStackProps) {
    super(scope, id, props);

    const seedInitialData = props?.seedInitialData ?? true;

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Secrets',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

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
    // KMS CUSTOMER MANAGED KEY
    // ========================================

    this.secretsEncryptionKey = new kms.Key(this, 'SecretsEncryptionKey', {
      alias: 'alias/todaysdentalinsights-secrets',
      description: 'KMS key for encrypting secrets in DynamoDB tables',
      enableKeyRotation: true,
      rotationPeriod: Duration.days(365),
      removalPolicy: RemovalPolicy.RETAIN,
      // Allow key administrators to manage the key
      policy: new iam.PolicyDocument({
        statements: [
          // Allow account root full access
          new iam.PolicyStatement({
            sid: 'AllowRootAccess',
            principals: [new iam.AccountRootPrincipal()],
            actions: ['kms:*'],
            resources: ['*'],
          }),
          // Allow CloudWatch Logs to use the key for log encryption
          new iam.PolicyStatement({
            sid: 'AllowCloudWatchLogs',
            principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
            actions: [
              'kms:Encrypt*',
              'kms:Decrypt*',
              'kms:ReEncrypt*',
              'kms:GenerateDataKey*',
              'kms:Describe*',
            ],
            resources: ['*'],
            conditions: {
              ArnLike: {
                'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${this.account}:*`,
              },
            },
          }),
        ],
      }),
    });
    applyTags(this.secretsEncryptionKey, { Resource: 'kms-key' });

    // ========================================
    // CLINIC SECRETS TABLE
    // ========================================
    // Stores per-clinic sensitive credentials

    this.clinicSecretsTable = new dynamodb.Table(this, 'ClinicSecretsTable', {
      tableName: 'TodaysDentalInsights-ClinicSecrets',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.secretsEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.clinicSecretsTable, { Table: 'clinic-secrets' });
    createDynamoThrottleAlarm(this.clinicSecretsTable.tableName, 'ClinicSecrets');

    // ========================================
    // GLOBAL SECRETS TABLE
    // ========================================
    // Stores system-wide API keys and credentials

    this.globalSecretsTable = new dynamodb.Table(this, 'GlobalSecretsTable', {
      tableName: 'TodaysDentalInsights-GlobalSecrets',
      partitionKey: { name: 'secretId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'secretType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.secretsEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.globalSecretsTable, { Table: 'global-secrets' });
    createDynamoThrottleAlarm(this.globalSecretsTable.tableName, 'GlobalSecrets');

    // ========================================
    // CLINIC CONFIG TABLE
    // ========================================
    // Stores non-sensitive clinic configuration data

    this.clinicConfigTable = new dynamodb.Table(this, 'ClinicConfigTable', {
      tableName: 'TodaysDentalInsights-ClinicConfig',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.secretsEncryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.clinicConfigTable, { Table: 'clinic-config' });
    createDynamoThrottleAlarm(this.clinicConfigTable.tableName, 'ClinicConfig');

    // GSI for querying clinics by state (useful for regional operations)
    this.clinicConfigTable.addGlobalSecondaryIndex({
      indexName: 'byState',
      partitionKey: { name: 'clinicState', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // SEEDER CUSTOM RESOURCE
    // ========================================

    if (seedInitialData) {
      // Create Lambda function for seeding data
      const seederFn = new lambdaNode.NodejsFunction(this, 'SecretsSeederFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'secrets', 'seeder.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: Duration.minutes(5),
        bundling: {
          format: lambdaNode.OutputFormat.ESM,
          target: 'node20',
        },
        environment: {
          CLINIC_SECRETS_TABLE: this.clinicSecretsTable.tableName,
          GLOBAL_SECRETS_TABLE: this.globalSecretsTable.tableName,
          CLINIC_CONFIG_TABLE: this.clinicConfigTable.tableName,
        },
      });
      applyTags(seederFn, { Function: 'secrets-seeder' });

      // Grant seeder write access to all tables
      this.clinicSecretsTable.grantWriteData(seederFn);
      this.globalSecretsTable.grantWriteData(seederFn);
      this.clinicConfigTable.grantWriteData(seederFn);

      // Grant seeder access to KMS key
      this.secretsEncryptionKey.grantEncryptDecrypt(seederFn);

      // Create Custom Resource Provider
      const seederProvider = new cr.Provider(this, 'SecretsSeederProvider', {
        onEventHandler: seederFn,
        logRetention: 14, // 14 days log retention
      });

      // Create Custom Resource to trigger seeding
      new CustomResource(this, 'SecretsSeederResource', {
        serviceToken: seederProvider.serviceToken,
        properties: {
          // Include a version/timestamp to force re-seeding when configs change
          version: Date.now().toString(),
          clinicSecretsTable: this.clinicSecretsTable.tableName,
          globalSecretsTable: this.globalSecretsTable.tableName,
          clinicConfigTable: this.clinicConfigTable.tableName,
        },
      });
    }

    // ========================================
    // OUTPUTS
    // ========================================

    // KMS Key ARN
    new CfnOutput(this, 'SecretsEncryptionKeyArn', {
      value: this.secretsEncryptionKey.keyArn,
      description: 'KMS Key ARN for secrets encryption',
      exportName: `${this.stackName}-SecretsEncryptionKeyArn`,
    });

    new CfnOutput(this, 'SecretsEncryptionKeyId', {
      value: this.secretsEncryptionKey.keyId,
      description: 'KMS Key ID for secrets encryption',
      exportName: `${this.stackName}-SecretsEncryptionKeyId`,
    });

    // Clinic Secrets Table
    new CfnOutput(this, 'ClinicSecretsTableName', {
      value: this.clinicSecretsTable.tableName,
      description: 'DynamoDB table name for clinic secrets',
      exportName: `${this.stackName}-ClinicSecretsTableName`,
    });

    new CfnOutput(this, 'ClinicSecretsTableArn', {
      value: this.clinicSecretsTable.tableArn,
      description: 'DynamoDB table ARN for clinic secrets',
      exportName: `${this.stackName}-ClinicSecretsTableArn`,
    });

    // Global Secrets Table
    new CfnOutput(this, 'GlobalSecretsTableName', {
      value: this.globalSecretsTable.tableName,
      description: 'DynamoDB table name for global secrets',
      exportName: `${this.stackName}-GlobalSecretsTableName`,
    });

    new CfnOutput(this, 'GlobalSecretsTableArn', {
      value: this.globalSecretsTable.tableArn,
      description: 'DynamoDB table ARN for global secrets',
      exportName: `${this.stackName}-GlobalSecretsTableArn`,
    });

    // Clinic Config Table
    new CfnOutput(this, 'ClinicConfigTableName', {
      value: this.clinicConfigTable.tableName,
      description: 'DynamoDB table name for clinic config',
      exportName: `${this.stackName}-ClinicConfigTableName`,
    });

    new CfnOutput(this, 'ClinicConfigTableArn', {
      value: this.clinicConfigTable.tableArn,
      description: 'DynamoDB table ARN for clinic config',
      exportName: `${this.stackName}-ClinicConfigTableArn`,
    });
  }
}
