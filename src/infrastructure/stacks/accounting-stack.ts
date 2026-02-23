// stacks/accounting-stack.ts

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface AccountingStackProps extends StackProps {
  staffClinicInfoTableName: string;
  /** GlobalSecrets DynamoDB table name for retrieving Odoo credentials */
  globalSecretsTableName: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName: string;
  /** ClinicSecrets DynamoDB table name for per-clinic API credentials (e.g., OpenDental keys) */
  clinicSecretsTableName: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn: string;
}

export class AccountingStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly accountingFn: lambdaNode.NodejsFunction;
  public readonly invoicesTable: dynamodb.Table;
  public readonly bankStatementsTable: dynamodb.Table;
  public readonly openDentalReportsTable: dynamodb.Table;
  public readonly reconciliationTable: dynamodb.Table;
  public readonly columnConfigTable: dynamodb.Table;
  public readonly documentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: AccountingStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Accounting',
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
    // S3 BUCKET
    // ========================================

    this.documentsBucket = new s3.Bucket(this, 'AccountingDocumentsBucket', {
      bucketName: `todaysdentalinsights-accounting-documents-${this.account}`,
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });
    applyTags(this.documentsBucket, { Resource: 'accounting-documents' });

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Invoices Table - stores vendor invoices for accounts payable
    this.invoicesTable = new dynamodb.Table(this, 'InvoicesTable', {
      tableName: `${this.stackName}-Invoices`,
      partitionKey: { name: 'invoiceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.invoicesTable, { Table: 'accounting-invoices' });
    // GSI for fetching invoices by clinic
    this.invoicesTable.addGlobalSecondaryIndex({
      indexName: 'byClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Bank Statements Table - stores uploaded bank statement files
    this.bankStatementsTable = new dynamodb.Table(this, 'BankStatementsTable', {
      tableName: `${this.stackName}-BankStatements`,
      partitionKey: { name: 'bankStatementId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.bankStatementsTable, { Table: 'accounting-bank-statements' });
    // GSI for fetching statements by clinic
    this.bankStatementsTable.addGlobalSecondaryIndex({
      indexName: 'byClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadDate', type: dynamodb.AttributeType.STRING },
    });

    // OpenDental Reports Table - cached OpenDental payment data
    this.openDentalReportsTable = new dynamodb.Table(this, 'OpenDentalReportsTable', {
      tableName: `${this.stackName}-OpenDentalReports`,
      partitionKey: { name: 'reportId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.openDentalReportsTable, { Table: 'accounting-opendental-reports' });
    // GSI for fetching reports by clinic and payment mode
    this.openDentalReportsTable.addGlobalSecondaryIndex({
      indexName: 'byClinicMode',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'paymentMode', type: dynamodb.AttributeType.STRING },
    });

    // Reconciliation Table - stores reconciliation results
    this.reconciliationTable = new dynamodb.Table(this, 'ReconciliationTable', {
      tableName: `${this.stackName}-Reconciliation`,
      partitionKey: { name: 'reconciliationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.reconciliationTable, { Table: 'accounting-reconciliation' });
    // GSI for fetching reconciliations by clinic and payment mode
    this.reconciliationTable.addGlobalSecondaryIndex({
      indexName: 'byClinicMode',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'paymentMode', type: dynamodb.AttributeType.STRING },
    });

    // Column Config Table - stores per-clinic column visibility preferences
    this.columnConfigTable = new dynamodb.Table(this, 'ColumnConfigTable', {
      tableName: `${this.stackName}-ColumnConfig`,
      partitionKey: { name: 'configKey', type: dynamodb.AttributeType.STRING }, // clinicId#paymentMode
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.columnConfigTable, { Table: 'accounting-column-config' });

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.api = new apigw.RestApi(this, 'AccountingApi', {
      restApiName: 'AccountingApi',
      description: 'Accounting Module API (Invoices, Bank Reconciliation)',
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

    // Add Gateway responses for errors
    const corsErrorHeaders = getCorsErrorHeaders();
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.api, type: apigw.ResponseType.DEFAULT_4XX, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api, type: apigw.ResponseType.DEFAULT_5XX, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api, type: apigw.ResponseType.UNAUTHORIZED, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api, type: apigw.ResponseType.ACCESS_DENIED, responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'AccountingAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTION (Unified Handler)
    // ========================================

    // Import StaffUser table name from CoreStack
    const staffUserTableName = Fn.importValue('CoreStack-StaffUserTableName');

    this.accountingFn = new lambdaNode.NodejsFunction(this, 'AccountingFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'accounting', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(120),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        INVOICES_TABLE: this.invoicesTable.tableName,
        BANK_STATEMENTS_TABLE: this.bankStatementsTable.tableName,
        OPENDENTAL_REPORTS_TABLE: this.openDentalReportsTable.tableName,
        RECONCILIATION_TABLE: this.reconciliationTable.tableName,
        COLUMN_CONFIG_TABLE: this.columnConfigTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
        STAFF_USER_TABLE: staffUserTableName,
        // Secrets tables for dynamic credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
        // ClinicSecrets table for OpenDental API credentials
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
      },
    });
    applyTags(this.accountingFn, { Function: 'accounting' });

    // Grant Lambda permissions to DynamoDB tables
    this.invoicesTable.grantReadWriteData(this.accountingFn);
    this.bankStatementsTable.grantReadWriteData(this.accountingFn);
    this.openDentalReportsTable.grantReadWriteData(this.accountingFn);
    this.reconciliationTable.grantReadWriteData(this.accountingFn);
    this.columnConfigTable.grantReadWriteData(this.accountingFn);

    // Grant Lambda permissions to S3 bucket
    this.documentsBucket.grantReadWrite(this.accountingFn);

    // Grant READ-ONLY permission to the existing StaffClinicInfo table
    this.accountingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`
      ],
    }));

    // Grant READ permission to StaffUser table
    this.accountingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`
      ],
    }));

    // Grant Textract permissions for invoice OCR
    this.accountingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
        'textract:AnalyzeExpense',
      ],
      resources: ['*'],
    }));

    // Grant read access to secrets tables for Odoo + OpenDental credential retrieval
    this.accountingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
      ],
    }));

    // Grant KMS decryption for secrets encryption key
    this.accountingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: [props.secretsEncryptionKeyArn],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    const lambdaIntegration = new apigw.LambdaIntegration(this.accountingFn, {
      timeout: Duration.seconds(29),
    });
    const authOptions = {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    };
    const defaultMethodResponses = [
      { statusCode: '200' },
      { statusCode: '201' },
      { statusCode: '204' },
      { statusCode: '400' },
      { statusCode: '401' },
      { statusCode: '403' },
      { statusCode: '404' },
      { statusCode: '500' },
    ];

    // ---- INVOICES ROUTES ----
    const invoicesRes = this.api.root.addResource('invoices');
    invoicesRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    const invoicesUploadRes = invoicesRes.addResource('upload');
    invoicesUploadRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    const invoicesSyncOdooRes = invoicesRes.addResource('sync-odoo');
    invoicesSyncOdooRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    const invoiceIdRes = invoicesRes.addResource('{invoiceId}');
    invoiceIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    invoiceIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    invoiceIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ---- BRS (Bank Reconciliation Statement) ROUTES ----
    const brsRes = this.api.root.addResource('brs');

    // Payment modes list endpoint
    const paymentModesRes = brsRes.addResource('payment-modes');
    paymentModesRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // OpenDental data endpoint
    const openDentalRes = brsRes.addResource('open-dental');
    openDentalRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Odoo bank data endpoint
    const odooRes = brsRes.addResource('odoo');
    odooRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Bank file upload
    const bankFileRes = brsRes.addResource('bank-file');
    bankFileRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    const bankFileUploadRes = bankFileRes.addResource('upload');
    bankFileUploadRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Cherry transactions endpoint
    const cherryRes = brsRes.addResource('cherry');
    cherryRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Reconciliation
    const reconcileRes = brsRes.addResource('reconcile');
    reconcileRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    const reconciliationRes = brsRes.addResource('reconciliation');
    const reconciliationIdRes = reconciliationRes.addResource('{reconciliationId}');
    reconciliationIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Approve reconciliation
    const approveRes = brsRes.addResource('approve');
    approveRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // Column configuration
    const columnConfigRes = brsRes.addResource('column-config');
    columnConfigRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    columnConfigRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.accountingFn, name: 'accounting', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.invoicesTable.tableName, 'InvoicesTable');
    createDynamoThrottleAlarm(this.bankStatementsTable.tableName, 'BankStatementsTable');
    createDynamoThrottleAlarm(this.reconciliationTable.tableName, 'ReconciliationTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'AccountingApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'accounting',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AccountingApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/accounting/',
      description: 'Accounting Module API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AccountingApiUrl`,
    });

    new CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'S3 Bucket for accounting documents',
      exportName: `${Stack.of(this).stackName}-DocumentsBucketName`,
    });
  }
}
