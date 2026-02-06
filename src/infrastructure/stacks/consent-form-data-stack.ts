import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ConsentFormDataStackProps extends StackProps {
  // No longer passing authorizerFunction - will import via CloudFormation export
  /** GlobalSecrets DynamoDB table name for retrieving secrets */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets tables */
  secretsEncryptionKeyArn?: string;
}

export class ConsentFormDataStack extends Stack {
  public readonly consentFormDataTable: dynamodb.Table;
  public readonly consentFormInstancesTable: dynamodb.Table;
  public readonly consentFormDataFn: lambdaNode.NodejsFunction;
  public readonly consentFormInstancesFn: lambdaNode.NodejsFunction;
  public readonly consentFormPublicFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: ConsentFormDataStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'ConsentFormData',
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

    this.consentFormDataTable = new dynamodb.Table(this, 'ConsentFormDataTable', {
      // Use 'consent_form_id' as the partition key
      partitionKey: { name: 'consent_form_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Change to DESTROY for dev
      tableName: `${this.stackName}-ConsentFormData`,
    });
    applyTags(this.consentFormDataTable, { Table: 'consent-form-data' });

    // Instances table: one row per sent consent form (token-based public link)
    this.consentFormInstancesTable = new dynamodb.Table(this, 'ConsentFormInstancesTable', {
      partitionKey: { name: 'instance_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires_at',
      tableName: `${this.stackName}-ConsentFormInstances`,
    });
    applyTags(this.consentFormInstancesTable, { Table: 'consent-form-instances' });

    this.consentFormInstancesTable.addGlobalSecondaryIndex({
      indexName: 'TokenIndex',
      partitionKey: { name: 'token', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.consentFormInstancesTable.addGlobalSecondaryIndex({
      indexName: 'ClinicCreatedAtIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ConsentFormDataApi', {
      restApiName: 'ConsentFormDataApi',
      description: 'Consent Form Data service API',
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

    const corsErrorHeaders = getCorsErrorHeaders();
    
    // Add Gateway Responses for 4XX, 5XX, and UNAUTHORIZED
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'ConsentFormDataAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.consentFormDataFn = new lambdaNode.NodejsFunction(this, 'ConsentFormDataFn', {
      // Point to the new handler file
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'consent-form-data.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: this.consentFormDataTable.tableName,
      },
    });
    applyTags(this.consentFormDataFn, { Function: 'consent-form-data' });

    // Grant Lambda permissions to R/W from the new table
    this.consentFormDataTable.grantReadWriteData(this.consentFormDataFn);

    const globalSecretsTableName = props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets';
    const clinicSecretsTableName = props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets';
    const clinicConfigTableName = props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig';

    // Protected staff endpoints: create instances + list history
    this.consentFormInstancesFn = new lambdaNode.NodejsFunction(this, 'ConsentFormInstancesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'consent-form-instances.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TEMPLATES_TABLE_NAME: this.consentFormDataTable.tableName,
        INSTANCES_TABLE_NAME: this.consentFormInstancesTable.tableName,
        INSTANCES_BY_CLINIC_INDEX: 'ClinicCreatedAtIndex',
        DEFAULT_TOKEN_TTL_DAYS: '7',
        GLOBAL_SECRETS_TABLE: globalSecretsTableName,
        CLINIC_SECRETS_TABLE: clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: clinicConfigTableName,
      },
    });
    applyTags(this.consentFormInstancesFn, { Function: 'consent-form-instances' });

    // Import consolidated Transfer Family endpoint + bucket (from OpenDentalStack outputs)
    // Used for secure Documents/UploadSftp flow when patients submit signed PDFs.
    const OPENDENTAL_STACK_NAME = 'TodaysDentalInsightsOpenDentalN1';
    const consolidatedSftpEndpoint = Fn.importValue(`${OPENDENTAL_STACK_NAME}-ConsolidatedTransferServerEndpoint`).toString();
    const consolidatedSftpBucketName = Fn.importValue(`${OPENDENTAL_STACK_NAME}-ConsolidatedTransferServerBucket`).toString();

    // Public endpoints: token fetch + submit signed PDF
    this.consentFormPublicFn = new lambdaNode.NodejsFunction(this, 'ConsentFormPublicFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'public', 'consent-form-public.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      // UploadSftp requires OpenDental to pull from our SFTP endpoint; allow extra time.
      timeout: Duration.seconds(60),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        INSTANCES_TABLE_NAME: this.consentFormInstancesTable.tableName,
        TOKEN_INDEX_NAME: 'TokenIndex',
        MAX_PDF_SIZE_MB: '10',
        GLOBAL_SECRETS_TABLE: globalSecretsTableName,
        CLINIC_SECRETS_TABLE: clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: clinicConfigTableName,
        // Transfer Family SFTP (OpenDental pulls PDFs from this endpoint)
        CONSOLIDATED_SFTP_HOST: consolidatedSftpEndpoint,
        CONSOLIDATED_SFTP_BUCKET: consolidatedSftpBucketName,
        CONSOLIDATED_SFTP_USERNAME: 'sftpuser',
        CONSENT_FORMS_SFTP_DIR: 'ConsentForms',
      },
    });
    applyTags(this.consentFormPublicFn, { Function: 'consent-form-public' });

    // DynamoDB grants
    this.consentFormDataTable.grantReadData(this.consentFormInstancesFn);
    this.consentFormInstancesTable.grantReadWriteData(this.consentFormInstancesFn);
    this.consentFormInstancesTable.grantReadWriteData(this.consentFormPublicFn);

    // Secrets table read permissions (for clinic website + OpenDental credentials)
    const globalSecretsArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${globalSecretsTableName}`;
    const clinicConfigArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicConfigTableName}`;
    const clinicSecretsArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${clinicSecretsTableName}`;
    this.consentFormInstancesFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        clinicConfigArn,
        `${clinicConfigArn}/index/*`,
        clinicSecretsArn,
        `${clinicSecretsArn}/index/*`,
      ],
    }));
    this.consentFormPublicFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        globalSecretsArn,
        clinicConfigArn,
        `${clinicConfigArn}/index/*`,
        clinicSecretsArn,
        `${clinicSecretsArn}/index/*`,
      ],
    }));

    // Allow public consent form lambda to upload temporary PDFs into the consolidated Transfer bucket
    // under the dedicated sftpuser prefix. OpenDental then pulls the file via Documents/UploadSftp.
    const consolidatedSftpBucket = s3.Bucket.fromBucketName(this, 'ImportedConsolidatedTransferBucket', consolidatedSftpBucketName);
    this.consentFormPublicFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      resources: [
        consolidatedSftpBucket.arnForObjects('sftp-home/sftpuser/ConsentForms/*'),
      ],
    }));

    // KMS decrypt for customer-managed encrypted secrets tables
    if (props.secretsEncryptionKeyArn) {
      [this.consentFormInstancesFn, this.consentFormPublicFn].forEach((fn) => {
        fn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['kms:Decrypt', 'kms:DescribeKey'],
          resources: [props.secretsEncryptionKeyArn!],
        }));
      });
    }

    // ========================================
    // API ROUTES
    // ========================================

    // Change resource path to 'consent-forms'
    const consentFormsRes = this.api.root.addResource('consent-forms');
    consentFormsRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    consentFormsRes.addMethod('POST', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const consentFormIdRes = consentFormsRes.addResource('{consentFormId}');

    // ADDED: GET method for a single item
    consentFormIdRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }], // Added 404
    });

    consentFormIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    consentFormIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    // ========================================
    // INSTANCE ROUTES (send/sign workflow)
    // ========================================

    // POST /consent-forms/{consentFormId}/instances  (protected)
    const consentFormInstancesRes = consentFormIdRes.addResource('instances');
    consentFormInstancesRes.addMethod('POST', new apigw.LambdaIntegration(this.consentFormInstancesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }, { statusCode: '404' }],
    });

    // GET /consent-forms/instances?clinicId=...  (protected)
    const instancesRes = consentFormsRes.addResource('instances');
    instancesRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormInstancesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // GET /consent-forms/instances/{token}  (public)
    const instanceTokenRes = instancesRes.addResource('{token}');
    instanceTokenRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormPublicFn), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '404' }, { statusCode: '410' }],
    });

    // POST /consent-forms/instances/{token}/submit  (public)
    const instanceSubmitRes = instanceTokenRes.addResource('submit');
    instanceSubmitRes.addMethod('POST', new apigw.LambdaIntegration(this.consentFormPublicFn), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '404' }, { statusCode: '409' }, { statusCode: '410' }],
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.consentFormDataFn, name: 'consent-form-data', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.consentFormInstancesFn, name: 'consent-form-instances', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.consentFormPublicFn, name: 'consent-form-public', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.consentFormDataTable.tableName, 'ConsentFormDataTable');
    createDynamoThrottleAlarm(this.consentFormInstancesTable.tableName, 'ConsentFormInstancesTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with 'consent-forms' base path
    new apigw.CfnBasePathMapping(this, 'ConsentFormDataApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'consent-forms',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ConsentFormDataTableName', {
      value: this.consentFormDataTable.tableName,
      description: 'Name of the Consent Form Data DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataTableName`,
    });

    new CfnOutput(this, 'ConsentFormInstancesTableName', {
      value: this.consentFormInstancesTable.tableName,
      description: 'Name of the Consent Form Instances DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ConsentFormInstancesTableName`,
    });

    new CfnOutput(this, 'ConsentFormDataApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/consent-forms/',
      description: 'Consent Form Data API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataApiUrl`,
    });

    new CfnOutput(this, 'ConsentFormDataApiId', {
      value: this.api.restApiId,
      description: 'Consent Form Data API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataApiId`,
    });
  }
}

