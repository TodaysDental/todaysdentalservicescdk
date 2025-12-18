// stacks/credentialing-stack.ts
// Provider Credentialing and Payer Enrollment Management for DSO

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

export interface CredentialingStackProps extends StackProps {
  staffClinicInfoTableName: string; // from coreStack - for clinic data
}

export class CredentialingStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly credentialingFn: lambdaNode.NodejsFunction;
  
  // DynamoDB Tables
  public readonly providersTable: dynamodb.Table;
  public readonly providerCredentialsTable: dynamodb.Table;
  public readonly payerEnrollmentsTable: dynamodb.Table;
  public readonly credentialingTasksTable: dynamodb.Table;
  public readonly credentialingDocumentsTable: dynamodb.Table;
  
  // S3 Bucket for documents
  public readonly documentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CredentialingStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Credentialing',
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
    // S3 BUCKET FOR DOCUMENTS
    // ========================================
    
    this.documentsBucket = new s3.Bucket(this, 'CredentialingDocumentsBucket', {
      bucketName: `${this.stackName.toLowerCase()}-documents`,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'move-to-ia-after-90-days',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(90),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['https://todaysdentalinsights.com', 'https://*.todaysdentalinsights.com', 'http://localhost:*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });
    applyTags(this.documentsBucket, { Resource: 'documents-bucket' });

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Providers Table - Core provider information
    // Stores: providerId, name, npi, specialty, status, credentialingProgress, enrollmentProgress, clinicIds, email, createdAt
    this.providersTable = new dynamodb.Table(this, 'ProvidersTable', {
      tableName: `${this.stackName}-Providers`,
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.providersTable, { Table: 'credentialing-providers' });
    
    // GSI for querying providers by NPI
    this.providersTable.addGlobalSecondaryIndex({
      indexName: 'byNpi',
      partitionKey: { name: 'npi', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying providers by status
    this.providersTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying providers by clinic
    this.providersTable.addGlobalSecondaryIndex({
      indexName: 'byClinic',
      partitionKey: { name: 'primaryClinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'name', type: dynamodb.AttributeType.STRING },
    });

    // Provider Credentials Table - Detailed credentialing data
    // Stores: identity, education, licenses, work history, insurance, sanctions check results
    this.providerCredentialsTable = new dynamodb.Table(this, 'ProviderCredentialsTable', {
      tableName: `${this.stackName}-ProviderCredentials`,
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'credentialType', type: dynamodb.AttributeType.STRING }, // identity, education, license, workHistory, insurance, sanctions
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.providerCredentialsTable, { Table: 'credentialing-credentials' });
    
    // GSI for querying by credential type and expiration
    this.providerCredentialsTable.addGlobalSecondaryIndex({
      indexName: 'byExpirationDate',
      partitionKey: { name: 'credentialType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'expirationDate', type: dynamodb.AttributeType.STRING },
    });

    // Payer Enrollments Table - Provider-Payer enrollment tracking
    // Stores: enrollmentId, providerId, payerId, payerName, status, applicationDate, approvalDate, notes
    this.payerEnrollmentsTable = new dynamodb.Table(this, 'PayerEnrollmentsTable', {
      tableName: `${this.stackName}-PayerEnrollments`,
      partitionKey: { name: 'enrollmentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.payerEnrollmentsTable, { Table: 'credentialing-enrollments' });
    
    // GSI for querying enrollments by provider
    this.payerEnrollmentsTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'payerName', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying enrollments by status
    this.payerEnrollmentsTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'applicationDate', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying enrollments by payer
    this.payerEnrollmentsTable.addGlobalSecondaryIndex({
      indexName: 'byPayer',
      partitionKey: { name: 'payerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // Credentialing Tasks Table - Task management for credentialing workflow
    // Stores: taskId, title, description, providerId, priority, status, dueDate, assignee, category
    this.credentialingTasksTable = new dynamodb.Table(this, 'CredentialingTasksTable', {
      tableName: `${this.stackName}-Tasks`,
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.credentialingTasksTable, { Table: 'credentialing-tasks' });
    
    // GSI for querying tasks by provider
    this.credentialingTasksTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying tasks by status and due date
    this.credentialingTasksTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying tasks by assignee
    this.credentialingTasksTable.addGlobalSecondaryIndex({
      indexName: 'byAssignee',
      partitionKey: { name: 'assigneeId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying tasks by clinic
    this.credentialingTasksTable.addGlobalSecondaryIndex({
      indexName: 'byClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
    });

    // Credentialing Documents Table - Metadata for uploaded documents
    // Stores: documentId, providerId, documentType, s3Key, fileName, uploadedAt, uploadedBy, status
    this.credentialingDocumentsTable = new dynamodb.Table(this, 'CredentialingDocumentsTable', {
      tableName: `${this.stackName}-Documents`,
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.credentialingDocumentsTable, { Table: 'credentialing-documents' });
    
    // GSI for querying documents by provider
    this.credentialingDocumentsTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
    });
    
    // GSI for querying documents by type
    this.credentialingDocumentsTable.addGlobalSecondaryIndex({
      indexName: 'byDocumentType',
      partitionKey: { name: 'documentType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.api = new apigw.RestApi(this, 'CredentialingApi', {
      restApiName: 'CredentialingApi',
      description: 'Provider Credentialing and Payer Enrollment API',
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
    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'CredentialingAuthorizer', {
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

    this.credentialingFn = new lambdaNode.NodejsFunction(this, 'CredentialingFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'credentialing', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        PAYER_ENROLLMENTS_TABLE: this.payerEnrollmentsTable.tableName,
        TASKS_TABLE: this.credentialingTasksTable.tableName,
        DOCUMENTS_TABLE: this.credentialingDocumentsTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
        STAFF_USER_TABLE: staffUserTableName,
        // SES for notifications
        APP_NAME: 'TodaysDentalInsights',
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
        SES_REGION: 'us-east-1',
      },
    });
    applyTags(this.credentialingFn, { Function: 'credentialing' });

    // Grant Lambda permissions to DynamoDB tables
    this.providersTable.grantReadWriteData(this.credentialingFn);
    this.providerCredentialsTable.grantReadWriteData(this.credentialingFn);
    this.payerEnrollmentsTable.grantReadWriteData(this.credentialingFn);
    this.credentialingTasksTable.grantReadWriteData(this.credentialingFn);
    this.credentialingDocumentsTable.grantReadWriteData(this.credentialingFn);
    
    // Grant Lambda permissions to S3 bucket
    this.documentsBucket.grantReadWrite(this.credentialingFn);

    // Grant READ-ONLY permission to the existing StaffClinicInfo table
    this.credentialingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`,
      ],
    }));

    // Grant READ permission to StaffUser table (for user lookups)
    this.credentialingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`,
      ],
    }));

    // SES permissions for email notifications
    this.credentialingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    const lambdaIntegration = new apigw.LambdaIntegration(this.credentialingFn);
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

    // /dashboard - Get credentialing dashboard summary
    const dashboardRes = this.api.root.addResource('dashboard');
    dashboardRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /providers - Provider CRUD
    const providersRes = this.api.root.addResource('providers');
    providersRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List providers
    providersRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create provider

    // /providers/{providerId}
    const providerIdRes = providersRes.addResource('{providerId}');
    providerIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get provider
    providerIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update provider
    providerIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete provider

    // /providers/{providerId}/credentials - Provider credentials (identity, education, licenses, etc.)
    const credentialsRes = providerIdRes.addResource('credentials');
    credentialsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // Get all credentials
    credentialsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Add/Update credential

    // /providers/{providerId}/credentials/{credentialType}
    const credentialTypeRes = credentialsRes.addResource('{credentialType}');
    credentialTypeRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get specific credential
    credentialTypeRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update credential
    credentialTypeRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete credential

    // /providers/{providerId}/enrollments - Payer enrollments for a provider
    const providerEnrollmentsRes = providerIdRes.addResource('enrollments');
    providerEnrollmentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List enrollments
    providerEnrollmentsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Start enrollment

    // /providers/{providerId}/documents - Documents for a provider
    const providerDocumentsRes = providerIdRes.addResource('documents');
    providerDocumentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List documents
    providerDocumentsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Get upload URL

    // /enrollments - Enrollment management
    const enrollmentsRes = this.api.root.addResource('enrollments');
    enrollmentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List all enrollments

    // /enrollments/{enrollmentId}
    const enrollmentIdRes = enrollmentsRes.addResource('{enrollmentId}');
    enrollmentIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get enrollment
    enrollmentIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update enrollment
    enrollmentIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete enrollment

    // /enrollments/{enrollmentId}/status - Update enrollment status
    const enrollmentStatusRes = enrollmentIdRes.addResource('status');
    enrollmentStatusRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /tasks - Task management
    const tasksRes = this.api.root.addResource('tasks');
    tasksRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List tasks
    tasksRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create task

    // /tasks/{taskId}
    const taskIdRes = tasksRes.addResource('{taskId}');
    taskIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get task
    taskIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update task
    taskIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete task

    // /tasks/{taskId}/complete - Mark task as complete
    const taskCompleteRes = taskIdRes.addResource('complete');
    taskCompleteRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /documents - Document management
    const documentsRes = this.api.root.addResource('documents');
    documentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List all documents

    // /documents/{documentId}
    const documentIdRes = documentsRes.addResource('{documentId}');
    documentIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get document (download URL)
    documentIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete document

    // /payers - Available payers list
    const payersRes = this.api.root.addResource('payers');
    payersRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List available payers

    // /verifications - External verification checks (OIG, NPDB, State Board)
    const verificationsRes = this.api.root.addResource('verifications');
    
    // /verifications/oig - OIG Exclusions check
    const oigRes = verificationsRes.addResource('oig');
    oigRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    
    // /verifications/npdb - National Practitioner Data Bank check
    const npdbRes = verificationsRes.addResource('npdb');
    npdbRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    
    // /verifications/state-board - State Dental Board check
    const stateBoardRes = verificationsRes.addResource('state-board');
    stateBoardRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /analytics - Credentialing analytics
    const analyticsRes = this.api.root.addResource('analytics');
    analyticsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.credentialingFn, name: 'credentialing', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.providersTable.tableName, 'ProvidersTable');
    createDynamoThrottleAlarm(this.providerCredentialsTable.tableName, 'ProviderCredentialsTable');
    createDynamoThrottleAlarm(this.payerEnrollmentsTable.tableName, 'PayerEnrollmentsTable');
    createDynamoThrottleAlarm(this.credentialingTasksTable.tableName, 'TasksTable');
    createDynamoThrottleAlarm(this.credentialingDocumentsTable.tableName, 'DocumentsTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'CredentialingApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'credentialing',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'CredentialingApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/credentialing/',
      description: 'Credentialing API Gateway URL',
      exportName: `${Stack.of(this).stackName}-CredentialingApiUrl`,
    });

    new CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'S3 Bucket for Credentialing Documents',
      exportName: `${Stack.of(this).stackName}-DocumentsBucketName`,
    });

    new CfnOutput(this, 'ProvidersTableName', {
      value: this.providersTable.tableName,
      description: 'DynamoDB Providers Table Name',
      exportName: `${Stack.of(this).stackName}-ProvidersTableName`,
    });

    new CfnOutput(this, 'PayerEnrollmentsTableName', {
      value: this.payerEnrollmentsTable.tableName,
      description: 'DynamoDB Payer Enrollments Table Name',
      exportName: `${Stack.of(this).stackName}-PayerEnrollmentsTableName`,
    });

    new CfnOutput(this, 'TasksTableName', {
      value: this.credentialingTasksTable.tableName,
      description: 'DynamoDB Tasks Table Name',
      exportName: `${Stack.of(this).stackName}-TasksTableName`,
    });
  }
}
