import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { getCdkCorsConfig } from '../../shared/utils/cors';

export interface InsuranceAutomationStackProps extends StackProps {
  /** SFTP server ID for OpenDental queries */
  consolidatedTransferServerId: string;
  /** GlobalSecrets DynamoDB table name for retrieving SFTP credentials */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** StaffClinicInfo DynamoDB table name for mapping authenticated email -> OpenDental UserNum */
  staffClinicInfoTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
  /** S3 bucket for temporary document processing */
  documentProcessingBucketName?: string;
}

export class InsuranceAutomationStack extends Stack {
  // DynamoDB Tables
  public readonly commissionsTable: dynamodb.Table;
  public readonly configTable: dynamodb.Table;
  public readonly auditLogsTable: dynamodb.Table;

  // Lambda Functions
  public readonly auditSyncFn: lambdaNode.NodejsFunction;
  public readonly docProcessorFn: lambdaNode.NodejsFunction;
  public readonly noteCopierFn: lambdaNode.NodejsFunction;
  public readonly commissionApiFn: lambdaNode.NodejsFunction;

  // API Gateway
  public readonly api: apigw.RestApi;

  // S3 Bucket for document processing
  public readonly docProcessingBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: InsuranceAutomationStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'InsuranceAutomation',
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
    // S3 BUCKET FOR DOCUMENT PROCESSING
    // ========================================
    // Use short prefix to stay within S3's 63 character bucket name limit
    this.docProcessingBucket = new s3.Bucket(this, 'DocProcessingBucket', {
      bucketName: `tdi-ins-auto-docs-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Auto-delete temporary files after 1 day
          expiration: Duration.days(1),
          prefix: 'temp/',
        },
      ],
    });
    applyTags(this.docProcessingBucket, { Bucket: 'insurance-doc-processing' });

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // InsuranceCommissions Table
    // PK: clinicId#userId, SK: date#transactionId
    // Stores user earnings/deductions for each insurance service
    this.commissionsTable = new dynamodb.Table(this, 'InsuranceCommissionsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-InsuranceCommissions`,
      pointInTimeRecovery: true,
    });
    applyTags(this.commissionsTable, { Table: 'insurance-commissions' });

    // GSI for querying by userId across all clinics
    this.commissionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by clinicId
    this.commissionsTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // InsuranceAutomationConfig Table
    // PK: clinicId - stores per-clinic feature toggles
    this.configTable = new dynamodb.Table(this, 'InsuranceAutomationConfigTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-InsuranceAutomationConfig`,
      pointInTimeRecovery: true,
    });
    applyTags(this.configTable, { Table: 'insurance-automation-config' });

    // InsuranceAuditLogs Table
    // PK: clinicId#date, SK: timestamp#actionId
    // Audit trail of all insurance actions for debugging and compliance
    this.auditLogsTable = new dynamodb.Table(this, 'InsuranceAuditLogsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-InsuranceAuditLogs`,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Auto-expire old logs after 90 days
    });
    applyTags(this.auditLogsTable, { Table: 'insurance-audit-logs' });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    const commonLambdaEnv = {
      COMMISSIONS_TABLE: this.commissionsTable.tableName,
      CONFIG_TABLE: this.configTable.tableName,
      AUDIT_LOGS_TABLE: this.auditLogsTable.tableName,
      DOC_PROCESSING_BUCKET: this.docProcessingBucket.bucketName,
      CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
      NODE_OPTIONS: '--enable-source-maps',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
      CLINIC_SECRETS_TABLE: props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets',
      CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName || '',
    };

    const commonBundlingOptions = {
      format: lambdaNode.OutputFormat.CJS,
      target: 'node22',
      externalModules: ['ssh2', 'cpu-features'],
      nodeModules: ['ssh2'],
      minify: true,
      sourceMap: true,
    };

    // 1. Audit Sync Lambda - Runs hourly to sync insurance changes and calculate commissions
    this.auditSyncFn = new lambdaNode.NodejsFunction(this, 'InsuranceAuditSyncFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'insurance-automation', 'audit-sync-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.minutes(10),
      bundling: commonBundlingOptions,
      environment: commonLambdaEnv,
      retryAttempts: 0,
    });
    applyTags(this.auditSyncFn, { Function: 'insurance-audit-sync' });

    // 2. Document Processor Lambda - Real-time Textract processing
    this.docProcessorFn = new lambdaNode.NodejsFunction(this, 'InsuranceDocProcessorFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'insurance-automation', 'doc-processor-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.minutes(5),
      bundling: commonBundlingOptions,
      environment: commonLambdaEnv,
      retryAttempts: 0,
    });
    applyTags(this.docProcessorFn, { Function: 'insurance-doc-processor' });

    // 3. Note Copier Lambda - Runs hourly to copy plan notes between matching patients
    this.noteCopierFn = new lambdaNode.NodejsFunction(this, 'InsuranceNoteCopierFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'insurance-automation', 'note-copier-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.minutes(10),
      bundling: commonBundlingOptions,
      environment: commonLambdaEnv,
      retryAttempts: 0,
    });
    applyTags(this.noteCopierFn, { Function: 'insurance-note-copier' });

    // 4. Commission API Lambda - REST API for frontend
    this.commissionApiFn = new lambdaNode.NodejsFunction(this, 'InsuranceCommissionApiFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'insurance-automation', 'commission-api-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        minify: true,
        sourceMap: true,
      },
      environment: commonLambdaEnv,
      retryAttempts: 0,
    });
    applyTags(this.commissionApiFn, { Function: 'insurance-commission-api' });

    // ========================================
    // IAM PERMISSIONS
    // ========================================

    // Grant DynamoDB permissions to all Lambdas
    this.commissionsTable.grantReadWriteData(this.auditSyncFn);
    this.commissionsTable.grantReadWriteData(this.docProcessorFn);
    this.commissionsTable.grantReadData(this.commissionApiFn);
    this.commissionsTable.grantWriteData(this.commissionApiFn);

    this.configTable.grantReadWriteData(this.auditSyncFn);
    this.configTable.grantReadWriteData(this.noteCopierFn);
    this.configTable.grantReadWriteData(this.commissionApiFn);

    this.auditLogsTable.grantReadWriteData(this.auditSyncFn);
    this.auditLogsTable.grantReadWriteData(this.docProcessorFn);
    this.auditLogsTable.grantReadData(this.commissionApiFn);

    // StaffClinicInfo lookup (email -> clinic mappings) for commissions API
    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTable = dynamodb.Table.fromTableName(
        this,
        'StaffClinicInfoTableImport',
        props.staffClinicInfoTableName
      );
      staffClinicInfoTable.grantReadData(this.commissionApiFn);
    }

    // Grant S3 permissions for document processing
    this.docProcessingBucket.grantReadWrite(this.docProcessorFn);
    this.docProcessingBucket.grantRead(this.auditSyncFn);

    // Grant Textract permissions to document processor
    this.docProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
        'textract:StartDocumentTextDetection',
        'textract:GetDocumentTextDetection',
        'textract:StartDocumentAnalysis',
        'textract:GetDocumentAnalysis',
      ],
      resources: ['*'],
    }));

    // Grant Bedrock permissions for complex data interpretation
    this.docProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'],
    }));

    // Grant access to secrets tables for all Lambdas
    const secretsPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets'}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets'}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
      ],
    });

    this.auditSyncFn.addToRolePolicy(secretsPolicy);
    this.docProcessorFn.addToRolePolicy(secretsPolicy);
    this.noteCopierFn.addToRolePolicy(secretsPolicy);
    this.commissionApiFn.addToRolePolicy(secretsPolicy);

    // Grant KMS decryption for secrets
    if (props.secretsEncryptionKeyArn) {
      const kmsPolicy = new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      });

      this.auditSyncFn.addToRolePolicy(kmsPolicy);
      this.docProcessorFn.addToRolePolicy(kmsPolicy);
      this.noteCopierFn.addToRolePolicy(kmsPolicy);
      this.commissionApiFn.addToRolePolicy(kmsPolicy);
    }

    // ========================================
    // EVENTBRIDGE SCHEDULES
    // ========================================

    // Hourly audit sync schedule
    new events.Rule(this, 'InsuranceAuditSyncScheduleRule', {
      description: 'Runs insurance audit sync every hour to calculate commissions',
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(this.auditSyncFn)],
    });

    // Hourly note copier schedule
    new events.Rule(this, 'InsuranceNoteCopierScheduleRule', {
      description: 'Runs insurance note copier every hour to sync plan notes',
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(this.noteCopierFn)],
    });

    // ========================================
    // API GATEWAY
    // ========================================

    this.api = new apigw.RestApi(this, 'InsuranceAutomationApi', {
      restApiName: `${this.stackName}-Api`,
      description: 'Insurance Automation REST API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: getCdkCorsConfig(),
    });
    applyTags(this.api, { Api: 'insurance-automation' });

    // Import the shared authorizer from CoreStack (exported as AuthorizerFunctionArnN1)
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    const authorizer = new apigw.RequestAuthorizer(this, 'JwtAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda.
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    const lambdaIntegration = new apigw.LambdaIntegration(this.commissionApiFn);

    // /commissions endpoints
    const commissionsResource = this.api.root.addResource('commissions');
    
    // GET /commissions - Get all commissions for current user
    commissionsResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /commissions/{userId}
    const userCommissionsResource = commissionsResource.addResource('{userId}');
    userCommissionsResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /commissions/clinic/{clinicId}
    const clinicResource = commissionsResource.addResource('clinic');
    const clinicIdResource = clinicResource.addResource('{clinicId}');
    clinicIdResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /config endpoints
    const configResource = this.api.root.addResource('config');
    
    // /config/{clinicId}
    const configClinicResource = configResource.addResource('{clinicId}');
    configClinicResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    configClinicResource.addMethod('PUT', lambdaIntegration, {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // /documents endpoint for triggering document processing
    const documentsResource = this.api.root.addResource('documents');
    const processResource = documentsResource.addResource('process');
    processResource.addMethod('POST', new apigw.LambdaIntegration(this.docProcessorFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // ========================================
    // CUSTOM DOMAIN MAPPING
    // ========================================
    // Map REST API to the shared custom domain: apig.todaysdentalinsights.com/insurance-automation
    new apigw.CfnBasePathMapping(this, 'InsuranceAutomationApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'insurance-automation',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // CLOUDWATCH ALARMS
    // ========================================

    createLambdaErrorAlarm(this.auditSyncFn, 'insurance-audit-sync');
    createLambdaThrottleAlarm(this.auditSyncFn, 'insurance-audit-sync');
    createLambdaErrorAlarm(this.docProcessorFn, 'insurance-doc-processor');
    createLambdaThrottleAlarm(this.docProcessorFn, 'insurance-doc-processor');
    createLambdaErrorAlarm(this.noteCopierFn, 'insurance-note-copier');
    createLambdaThrottleAlarm(this.noteCopierFn, 'insurance-note-copier');
    createLambdaErrorAlarm(this.commissionApiFn, 'insurance-commission-api');
    createLambdaThrottleAlarm(this.commissionApiFn, 'insurance-commission-api');

    createDynamoThrottleAlarm(this.commissionsTable.tableName, 'CommissionsTable');
    createDynamoThrottleAlarm(this.configTable.tableName, 'ConfigTable');
    createDynamoThrottleAlarm(this.auditLogsTable.tableName, 'AuditLogsTable');

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'CommissionsTableName', {
      value: this.commissionsTable.tableName,
      description: 'Name of the Insurance Commissions DynamoDB table',
      exportName: `${this.stackName}-CommissionsTableName`,
    });

    new CfnOutput(this, 'ConfigTableName', {
      value: this.configTable.tableName,
      description: 'Name of the Insurance Automation Config DynamoDB table',
      exportName: `${this.stackName}-ConfigTableName`,
    });

    new CfnOutput(this, 'AuditLogsTableName', {
      value: this.auditLogsTable.tableName,
      description: 'Name of the Insurance Audit Logs DynamoDB table',
      exportName: `${this.stackName}-AuditLogsTableName`,
    });

    new CfnOutput(this, 'ApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/insurance-automation/',
      description: 'Insurance Automation API URL',
      exportName: `${this.stackName}-ApiUrl`,
    });

    new CfnOutput(this, 'DocProcessingBucketName', {
      value: this.docProcessingBucket.bucketName,
      description: 'S3 bucket for document processing',
      exportName: `${this.stackName}-DocProcessingBucketName`,
    });
  }
}
