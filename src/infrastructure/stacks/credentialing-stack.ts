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
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';

export interface CredentialingStackProps extends StackProps {
  staffClinicInfoTableName: string; // from coreStack - for clinic data
  staffUserTableName?: string; // Optional override; defaults to CoreStack export
}

export class CredentialingStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly credentialingFn: lambdaNode.NodejsFunction;
  public readonly autofillFn: lambdaNode.NodejsFunction;

  // DynamoDB Tables
  public readonly providersTable: dynamodb.Table;
  public readonly providerCredentialsTable: dynamodb.Table;
  public readonly payerEnrollmentsTable: dynamodb.Table;
  public readonly credentialingTasksTable: dynamodb.Table;
  public readonly credentialingDocumentsTable: dynamodb.Table;

  // Autofill Extension Tables
  public readonly portalAdaptersTable: dynamodb.Table;
  public readonly payerRequirementsTable: dynamodb.Table;
  public readonly autofillAuditTable: dynamodb.Table;
  public readonly extractedDataTable: dynamodb.Table;

  // S3 Bucket for documents
  public readonly documentsBucket: s3.Bucket;

  // Document Intelligence
  public readonly docProcessorFn: lambdaNode.NodejsFunction;

  // Verification APIs
  public readonly verificationLogsTable: dynamodb.Table;
  public readonly verificationFn: lambdaNode.NodejsFunction;

  // Workflow Orchestration
  public readonly workflowExecutionsTable: dynamodb.Table;
  public readonly workflowFn: lambdaNode.NodejsFunction;
  public readonly workflowStepFn: lambdaNode.NodejsFunction;
  public readonly documentIntakeStateMachine: sfn.StateMachine;
  public readonly verificationStateMachine: sfn.StateMachine;

  // Expiration Monitoring
  public readonly expirationAlertsTable: dynamodb.Table;
  public readonly expirationMonitorFn: lambdaNode.NodejsFunction;
  public readonly expirationApiHandler: lambdaNode.NodejsFunction;

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
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'p99' }),
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

    // Import StaffUser table name from CoreStack (used for SMTP credentials + user lookups)
    const staffUserTableName = props.staffUserTableName ?? Fn.importValue('CoreStack-StaffUserTableName');
    const staffUserTable = dynamodb.Table.fromTableName(this, 'StaffUserTableImport', staffUserTableName);
    applyTags(staffUserTable, { Table: 'staff-user' });

    // ========================================
    // S3 BUCKET FOR DOCUMENTS
    // ========================================

    this.documentsBucket = new s3.Bucket(this, 'CredentialingDocumentsBucket', {
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
          // Access is via presigned URLs (including from the Chrome extension), so allow any origin.
          // Authorization is enforced by the presigned signature, not by CORS.
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
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
    // AUTOFILL EXTENSION TABLES
    // ========================================

    // Portal Adapters Table - Configuration for portal-specific adapters
    // Stores: portalId, portalName, tier, match patterns, fieldMap, navigation, uploads, quirks
    this.portalAdaptersTable = new dynamodb.Table(this, 'PortalAdaptersTable', {
      tableName: `${this.stackName}-PortalAdapters`,
      partitionKey: { name: 'portalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.portalAdaptersTable, { Table: 'credentialing-portal-adapters' });

    // GSI for querying adapters by tier
    this.portalAdaptersTable.addGlobalSecondaryIndex({
      indexName: 'byTier',
      partitionKey: { name: 'tier', type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: 'portalName', type: dynamodb.AttributeType.STRING },
    });

    // Payer Requirements Table - Required fields and docs per payer/portal
    // Stores: payerId, payerName, requiredFields, requiredDocs, malpractice limits, state rules
    this.payerRequirementsTable = new dynamodb.Table(this, 'PayerRequirementsTable', {
      tableName: `${this.stackName}-PayerRequirements`,
      partitionKey: { name: 'payerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.payerRequirementsTable, { Table: 'credentialing-payer-requirements' });

    // Autofill Audit Logs Table - Audit trail for all autofill actions
    // Stores: auditId, userId, providerId, portal, action, timestamp, fieldsChanged, confidence
    this.autofillAuditTable = new dynamodb.Table(this, 'AutofillAuditTable', {
      tableName: `${this.stackName}-AutofillAuditLogs`,
      partitionKey: { name: 'auditId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.autofillAuditTable, { Table: 'credentialing-autofill-audit' });

    // GSI for querying audit logs by provider
    this.autofillAuditTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying audit logs by user
    this.autofillAuditTable.addGlobalSecondaryIndex({
      indexName: 'byUser',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying audit logs by portal
    this.autofillAuditTable.addGlobalSecondaryIndex({
      indexName: 'byPortal',
      partitionKey: { name: 'portal', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // DOCUMENT INTELLIGENCE TABLES
    // ========================================

    // Extracted Data Table - Stores Textract + Bedrock extracted fields from documents
    this.extractedDataTable = new dynamodb.Table(this, 'ExtractedDataTable', {
      tableName: `${this.stackName}-ExtractedData`,
      partitionKey: { name: 'extractionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.extractedDataTable, { Table: 'credentialing-extracted-data' });

    // GSI for querying extractions by provider
    this.extractedDataTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying extractions by document
    this.extractedDataTable.addGlobalSecondaryIndex({
      indexName: 'byDocument',
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // VERIFICATION LOGS TABLE
    // ========================================

    // Verification Logs Table - Stores NPI, OIG, state license verification results
    this.verificationLogsTable = new dynamodb.Table(this, 'VerificationLogsTable', {
      tableName: `${this.stackName}-VerificationLogs`,
      partitionKey: { name: 'verificationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.verificationLogsTable, { Table: 'credentialing-verification-logs' });

    // GSI for querying verifications by provider
    this.verificationLogsTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'verifiedAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying verifications by type
    this.verificationLogsTable.addGlobalSecondaryIndex({
      indexName: 'byType',
      partitionKey: { name: 'verificationType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'verifiedAt', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // WORKFLOW ORCHESTRATION
    // ========================================

    // Workflow Executions Table - Tracks Step Functions workflow state
    this.workflowExecutionsTable = new dynamodb.Table(this, 'WorkflowExecutionsTable', {
      tableName: `${this.stackName}-WorkflowExecutions`,
      partitionKey: { name: 'executionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(this.workflowExecutionsTable, { Table: 'credentialing-workflow-executions' });

    // GSI for querying workflows by provider
    this.workflowExecutionsTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying workflows by status
    this.workflowExecutionsTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI to CredentialingTasks for workflow queries
    this.credentialingTasksTable.addGlobalSecondaryIndex({
      indexName: 'byWorkflow',
      partitionKey: { name: 'workflowExecutionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // ----------------------------------------
    // Workflow Step Lambda (Step Functions tasks)
    // ----------------------------------------
    this.workflowStepFn = new lambdaNode.NodejsFunction(this, 'WorkflowStepFn', {
      functionName: `${this.stackName}-WorkflowStep`,
      entry: path.join(__dirname, '../../services/credentialing/workflow-handler.ts'),
      handler: 'stepHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        WORKFLOW_EXECUTIONS_TABLE: this.workflowExecutionsTable.tableName,
        CREDENTIALING_TASKS_TABLE: this.credentialingTasksTable.tableName,
        VERIFICATION_LOGS_TABLE: this.verificationLogsTable.tableName,
      },
    });
    applyTags(this.workflowStepFn, { Function: 'workflow-step' });

    // Grant DynamoDB permissions
    this.providersTable.grantReadWriteData(this.workflowStepFn);
    this.providerCredentialsTable.grantReadData(this.workflowStepFn);
    this.workflowExecutionsTable.grantReadWriteData(this.workflowStepFn);
    this.credentialingTasksTable.grantReadWriteData(this.workflowStepFn);
    this.verificationLogsTable.grantReadWriteData(this.workflowStepFn);

    // ----------------------------------------
    // Document Intake State Machine
    // ----------------------------------------
    const classifyDocTask = new sfnTasks.LambdaInvoke(this, 'ClassifyDocumentTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'CLASSIFY_DOCUMENT',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.classifyResult',
    });

    const extractTextTask = new sfnTasks.LambdaInvoke(this, 'ExtractTextTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'EXTRACT_TEXT',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.extractResult',
    });

    const validateRulesTask = new sfnTasks.LambdaInvoke(this, 'ValidateRulesTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'VALIDATE_RULES',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.validateResult',
    });

    const updateProfileTask = new sfnTasks.LambdaInvoke(this, 'UpdateProfileTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'UPDATE_PROFILE',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.updateResult',
    });

    const notifySuccessTask = new sfnTasks.LambdaInvoke(this, 'NotifySuccessTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'NOTIFY_TEAM',
        payload: {
          'executionId.$': '$.executionId',
          'providerId.$': '$.providerId',
          notificationType: 'SUCCESS',
          message: 'Document intake completed successfully',
        },
      }),
      resultPath: '$.notifyResult',
    });

    const completeDocumentIntakeWorkflowTask = new sfnTasks.LambdaInvoke(this, 'CompleteDocumentIntakeWorkflowTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'COMPLETE_WORKFLOW',
        payload: {
          'executionId.$': '$.executionId',
          status: 'SUCCEEDED',
          output: { workflowType: 'DOCUMENT_INTAKE' },
        },
      }),
      resultPath: '$.completeResult',
    });

    const createReviewTask = new sfnTasks.LambdaInvoke(this, 'CreateReviewTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'CREATE_REVIEW_TASK',
        taskToken: sfn.JsonPath.taskToken,
        payload: {
          'executionId.$': '$.executionId',
          'providerId.$': '$.providerId',
          reviewReason: 'Validation issues require human review',
        },
      }),
      resultPath: '$.reviewResult',
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      taskTimeout: sfn.Timeout.duration(Duration.days(7)),
    });

    // Choice: auto-approve or needs review
    const reviewChoice = new sfn.Choice(this, 'NeedsReviewChoice')
      .when(
        sfn.Condition.booleanEquals('$.validateResult.Payload.requiresReview', true),
        createReviewTask.next(updateProfileTask)
      )
      .otherwise(updateProfileTask);

    // Define document intake workflow
    const documentIntakeDefinition = classifyDocTask
      .next(extractTextTask)
      .next(validateRulesTask)
      .next(reviewChoice);

    updateProfileTask.next(notifySuccessTask);
    notifySuccessTask.next(completeDocumentIntakeWorkflowTask);

    this.documentIntakeStateMachine = new sfn.StateMachine(this, 'DocumentIntakeStateMachine', {
      stateMachineName: `${this.stackName}-DocumentIntake`,
      definition: documentIntakeDefinition,
      timeout: Duration.days(7),
    });
    applyTags(this.documentIntakeStateMachine, { StateMachine: 'document-intake' });

    // ----------------------------------------
    // Credential Verification State Machine
    // ----------------------------------------
    const verifyNpiTask = new sfnTasks.LambdaInvoke(this, 'VerifyNpiTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'VERIFY_NPI',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.npiResult',
    });

    const verifyOigTask = new sfnTasks.LambdaInvoke(this, 'VerifyOigTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'VERIFY_OIG',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.oigResult',
    });

    const updateVerificationTask = new sfnTasks.LambdaInvoke(this, 'UpdateVerificationTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'UPDATE_PROFILE',
        payload: sfn.JsonPath.entirePayload,
      }),
      resultPath: '$.updateResult',
    });

    const completeVerificationWorkflowTask = new sfnTasks.LambdaInvoke(this, 'CompleteVerificationWorkflowTask', {
      lambdaFunction: this.workflowStepFn,
      payload: sfn.TaskInput.fromObject({
        step: 'COMPLETE_WORKFLOW',
        payload: {
          'executionId.$': '$.executionId',
          status: 'SUCCEEDED',
          output: { workflowType: 'CREDENTIAL_VERIFICATION' },
        },
      }),
      resultPath: '$.completeResult',
    });

    // Parallel verification
    const parallelVerification = new sfn.Parallel(this, 'ParallelVerification')
      .branch(verifyNpiTask)
      .branch(verifyOigTask);

    const verificationDefinition = parallelVerification.next(updateVerificationTask).next(completeVerificationWorkflowTask);

    this.verificationStateMachine = new sfn.StateMachine(this, 'VerificationStateMachine', {
      stateMachineName: `${this.stackName}-Verification`,
      definition: verificationDefinition,
      timeout: Duration.minutes(30),
    });
    applyTags(this.verificationStateMachine, { StateMachine: 'verification' });

    // ----------------------------------------
    // Workflow API Lambda
    // ----------------------------------------
    this.workflowFn = new lambdaNode.NodejsFunction(this, 'WorkflowFn', {
      functionName: `${this.stackName}-Workflow`,
      entry: path.join(__dirname, '../../services/credentialing/workflow-handler.ts'),
      handler: 'apiHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        WORKFLOW_EXECUTIONS_TABLE: this.workflowExecutionsTable.tableName,
        CREDENTIALING_TASKS_TABLE: this.credentialingTasksTable.tableName,
        DOCUMENT_INTAKE_STATE_MACHINE_ARN: this.documentIntakeStateMachine.stateMachineArn,
        VERIFICATION_STATE_MACHINE_ARN: this.verificationStateMachine.stateMachineArn,
      },
    });
    applyTags(this.workflowFn, { Function: 'workflow' });

    // Grant permissions
    this.providersTable.grantReadData(this.workflowFn);
    this.workflowExecutionsTable.grantReadWriteData(this.workflowFn);
    this.credentialingTasksTable.grantReadWriteData(this.workflowFn);
    this.documentIntakeStateMachine.grantStartExecution(this.workflowFn);
    this.verificationStateMachine.grantStartExecution(this.workflowFn);

    // Grant Step Functions task token permissions
    this.workflowFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
      resources: ['*'],
    }));

    // ========================================
    // EXPIRATION MONITORING
    // ========================================

    // Expiration Alerts Table - Tracks sent alerts
    this.expirationAlertsTable = new dynamodb.Table(this, 'ExpirationAlertsTable', {
      tableName: `${this.stackName}-ExpirationAlerts`,
      partitionKey: { name: 'alertId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(this.expirationAlertsTable, { Table: 'credentialing-expiration-alerts' });

    // GSI for querying alerts by provider
    this.expirationAlertsTable.addGlobalSecondaryIndex({
      indexName: 'byProvider',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sentAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying alerts by provider+credential
    this.expirationAlertsTable.addGlobalSecondaryIndex({
      indexName: 'byProviderCredential',
      partitionKey: { name: 'providerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'credentialType', type: dynamodb.AttributeType.STRING },
    });

    // Scheduled Lambda - Daily expiration scan
    this.expirationMonitorFn = new lambdaNode.NodejsFunction(this, 'ExpirationMonitorFn', {
      functionName: `${this.stackName}-ExpirationMonitor`,
      entry: path.join(__dirname, '../../services/credentialing/expiration-monitor-handler.ts'),
      handler: 'scheduledHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        CREDENTIALING_TASKS_TABLE: this.credentialingTasksTable.tableName,
        EXPIRATION_ALERTS_TABLE: this.expirationAlertsTable.tableName,
        STAFF_USER_TABLE: staffUserTableName,
        SYSTEM_SENDER_EMAIL: 'credentialing@todaysdentalservices.com',
        CREDENTIALING_TEAM_EMAIL: 'credentialing@todaysdentalservices.com',
      },
    });
    applyTags(this.expirationMonitorFn, { Function: 'expiration-monitor' });

    // Grant DynamoDB permissions
    this.providersTable.grantReadData(this.expirationMonitorFn);
    this.providerCredentialsTable.grantReadData(this.expirationMonitorFn);
    this.credentialingTasksTable.grantReadWriteData(this.expirationMonitorFn);
    this.expirationAlertsTable.grantReadWriteData(this.expirationMonitorFn);
    staffUserTable.grantReadData(this.expirationMonitorFn);

    // EventBridge daily schedule (7AM UTC)
    new events.Rule(this, 'ExpirationDailyScan', {
      ruleName: `${this.stackName}-ExpirationDailyScan`,
      schedule: events.Schedule.cron({ hour: '7', minute: '0' }),
      targets: [new eventsTargets.LambdaFunction(this.expirationMonitorFn)],
    });

    // API Lambda - Expiration dashboard endpoints
    this.expirationApiHandler = new lambdaNode.NodejsFunction(this, 'ExpirationApiHandler', {
      functionName: `${this.stackName}-ExpirationApi`,
      entry: path.join(__dirname, '../../services/credentialing/expiration-monitor-handler.ts'),
      handler: 'apiHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        CREDENTIALING_TASKS_TABLE: this.credentialingTasksTable.tableName,
        EXPIRATION_ALERTS_TABLE: this.expirationAlertsTable.tableName,
        STAFF_USER_TABLE: staffUserTableName,
        SYSTEM_SENDER_EMAIL: 'credentialing@todaysdentalservices.com',
        CREDENTIALING_TEAM_EMAIL: 'credentialing@todaysdentalservices.com',
      },
    });
    applyTags(this.expirationApiHandler, { Function: 'expiration-api' });

    // Grant DynamoDB permissions
    this.providersTable.grantReadData(this.expirationApiHandler);
    this.expirationAlertsTable.grantReadWriteData(this.expirationApiHandler);
    staffUserTable.grantReadData(this.expirationApiHandler);

    // ========================================
    // API GATEWAY
    // ========================================

    this.api = new apigw.RestApi(this, 'CredentialingApi', {
      restApiName: 'CredentialingApi',
      description: 'Provider Credentialing and Payer Enrollment API',
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Add Gateway responses for errors
    // For API Gateway-generated errors (e.g. authorizer 401/403), return permissive CORS so the
    // Chrome extension can read error responses instead of seeing opaque CORS failures.
    // (Successful responses still return validated origins from Lambda via `buildCorsHeaders`.)
    const corsErrorHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'*'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
    };
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
        EXTRACTED_DATA_TABLE: this.extractedDataTable.tableName,  // For document processing
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
    this.extractedDataTable.grantReadWriteData(this.credentialingFn);  // For document processing

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
    staffUserTable.grantReadData(this.credentialingFn);

    // SES permissions for email notifications
    this.credentialingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    // ========================================
    // AUTOFILL LAMBDA FUNCTION
    // ========================================

    this.autofillFn = new lambdaNode.NodejsFunction(this, 'AutofillFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'credentialing', 'autofill-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        DOCUMENTS_TABLE: this.credentialingDocumentsTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
        PORTAL_ADAPTERS_TABLE: this.portalAdaptersTable.tableName,
        PAYER_REQUIREMENTS_TABLE: this.payerRequirementsTable.tableName,
        AUTOFILL_AUDIT_TABLE: this.autofillAuditTable.tableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
      },
    });
    applyTags(this.autofillFn, { Function: 'autofill' });

    // Grant Autofill Lambda read access to provider/credentials/documents tables
    this.providersTable.grantReadData(this.autofillFn);
    this.providerCredentialsTable.grantReadData(this.autofillFn);
    this.credentialingDocumentsTable.grantReadData(this.autofillFn);

    // Grant Autofill Lambda read/write access to autofill-specific tables
    this.portalAdaptersTable.grantReadWriteData(this.autofillFn);
    this.payerRequirementsTable.grantReadWriteData(this.autofillFn);
    this.autofillAuditTable.grantReadWriteData(this.autofillFn);

    // Grant S3 read access for generating presigned URLs
    this.documentsBucket.grantRead(this.autofillFn);

    // Grant READ-ONLY permission to StaffClinicInfo table
    this.autofillFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`,
      ],
    }));

    // ========================================
    // DOCUMENT PROCESSOR LAMBDA (Textract + Bedrock)
    // ========================================

    this.docProcessorFn = new lambdaNode.NodejsFunction(this, 'DocProcessorFn', {
      functionName: `${this.stackName}-DocProcessor`,
      entry: path.join(__dirname, '../../services/credentialing/credentialing-doc-processor.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024, // Higher memory for document processing
      timeout: Duration.minutes(5), // Async Textract can take time
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        DOCUMENTS_TABLE: this.credentialingDocumentsTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
        EXTRACTED_DATA_TABLE: this.extractedDataTable.tableName,
      },
    });
    applyTags(this.docProcessorFn, { Function: 'doc-processor' });

    // Grant DynamoDB permissions
    this.providersTable.grantReadData(this.docProcessorFn);
    this.providerCredentialsTable.grantReadWriteData(this.docProcessorFn);
    this.credentialingDocumentsTable.grantReadWriteData(this.docProcessorFn);
    this.extractedDataTable.grantReadWriteData(this.docProcessorFn);

    // Grant S3 read access for processing documents
    this.documentsBucket.grantRead(this.docProcessorFn);

    // Grant Textract permissions
    this.docProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
        'textract:StartDocumentAnalysis',
        'textract:GetDocumentAnalysis',
      ],
      resources: ['*'],
    }));

    // Grant Bedrock permissions
    this.docProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0'],
    }));

    // S3 Event Trigger - Process documents when uploaded to providers/ prefix
    this.documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.docProcessorFn),
      { prefix: 'providers/', suffix: '.pdf' }
    );
    this.documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.docProcessorFn),
      { prefix: 'providers/', suffix: '.png' }
    );
    this.documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.docProcessorFn),
      { prefix: 'providers/', suffix: '.jpg' }
    );

    // ========================================
    // VERIFICATION LAMBDA (NPI, OIG, License APIs)
    // ========================================

    this.verificationFn = new lambdaNode.NodejsFunction(this, 'VerificationFn', {
      functionName: `${this.stackName}-Verification`,
      entry: path.join(__dirname, '../../services/credentialing/verification-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(30), // External API calls
      environment: {
        PROVIDERS_TABLE: this.providersTable.tableName,
        PROVIDER_CREDENTIALS_TABLE: this.providerCredentialsTable.tableName,
        VERIFICATION_LOGS_TABLE: this.verificationLogsTable.tableName,
      },
    });
    applyTags(this.verificationFn, { Function: 'verification' });

    // Grant DynamoDB permissions
    this.providersTable.grantReadWriteData(this.verificationFn);
    this.providerCredentialsTable.grantReadData(this.verificationFn);
    this.verificationLogsTable.grantReadWriteData(this.verificationFn);

    // ========================================
    // API ROUTES
    // ========================================

    // Avoid Lambda resource policy size limit (20KB):
    // - CDK's `LambdaIntegration` auto-adds one `AWS::Lambda::Permission` *per method* (and per OPTIONS),
    //   which quickly exceeds Lambda's 20KB resource policy limit for large APIs.
    // - We instead add ONE wildcard permission per Lambda and use a raw AWS_PROXY integration so CDK
    //   does not auto-create per-method permissions.
    const apiInvokeSourceArn = `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/*`;

    const allowInvokeFromApi = (id: string, fn: lambda.IFunction) => {
      fn.addPermission(id, {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: apiInvokeSourceArn,
      });
    };

    allowInvokeFromApi('CredentialingFnInvokePermission', this.credentialingFn);
    allowInvokeFromApi('AutofillFnInvokePermission', this.autofillFn);
    allowInvokeFromApi('VerificationFnInvokePermission', this.verificationFn);
    allowInvokeFromApi('WorkflowFnInvokePermission', this.workflowFn);
    allowInvokeFromApi('ExpirationApiHandlerInvokePermission', this.expirationApiHandler);

    const lambdaProxyIntegration = (fn: lambda.IFunction) =>
      new apigw.Integration({
        type: apigw.IntegrationType.AWS_PROXY,
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${fn.functionArn}/invocations`,
      });

    const lambdaIntegration = lambdaProxyIntegration(this.credentialingFn);
    const authOptions = {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    };
    const addCorsOptions = (res: apigw.IResource) => {
      res.addMethod('OPTIONS', lambdaIntegration, { authorizationType: apigw.AuthorizationType.NONE });
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
    addCorsOptions(dashboardRes);
    dashboardRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /providers - Provider CRUD
    const providersRes = this.api.root.addResource('providers');
    addCorsOptions(providersRes);
    providersRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List providers
    providersRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create provider

    // /providers/{providerId}
    const providerIdRes = providersRes.addResource('{providerId}');
    addCorsOptions(providerIdRes);
    providerIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get provider
    providerIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update provider
    providerIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete provider

    // /providers/{providerId}/credentials - Provider credentials (identity, education, licenses, etc.)
    const credentialsRes = providerIdRes.addResource('credentials');
    addCorsOptions(credentialsRes);
    credentialsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // Get all credentials
    credentialsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Add/Update credential

    // /providers/{providerId}/credentials/{credentialType}
    const credentialTypeRes = credentialsRes.addResource('{credentialType}');
    addCorsOptions(credentialTypeRes);
    credentialTypeRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get specific credential
    credentialTypeRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update credential
    credentialTypeRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete credential

    // /providers/{providerId}/enrollments - Payer enrollments for a provider
    const providerEnrollmentsRes = providerIdRes.addResource('enrollments');
    addCorsOptions(providerEnrollmentsRes);
    providerEnrollmentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List enrollments
    providerEnrollmentsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Start enrollment

    // /providers/{providerId}/documents - Documents for a provider
    const providerDocumentsRes = providerIdRes.addResource('documents');
    addCorsOptions(providerDocumentsRes);
    providerDocumentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List documents
    providerDocumentsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Get upload URL

    // /enrollments - Enrollment management
    const enrollmentsRes = this.api.root.addResource('enrollments');
    addCorsOptions(enrollmentsRes);
    enrollmentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List all enrollments

    // /enrollments/{enrollmentId}
    const enrollmentIdRes = enrollmentsRes.addResource('{enrollmentId}');
    addCorsOptions(enrollmentIdRes);
    enrollmentIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get enrollment
    enrollmentIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update enrollment
    enrollmentIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete enrollment

    // /enrollments/{enrollmentId}/status - Update enrollment status
    const enrollmentStatusRes = enrollmentIdRes.addResource('status');
    addCorsOptions(enrollmentStatusRes);
    enrollmentStatusRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /tasks - Task management
    const tasksRes = this.api.root.addResource('tasks');
    addCorsOptions(tasksRes);
    tasksRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // List tasks
    tasksRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create task

    // /tasks/{taskId}
    const taskIdRes = tasksRes.addResource('{taskId}');
    addCorsOptions(taskIdRes);
    taskIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get task
    taskIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update task
    taskIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete task

    // /tasks/{taskId}/complete - Mark task as complete
    const taskCompleteRes = taskIdRes.addResource('complete');
    addCorsOptions(taskCompleteRes);
    taskCompleteRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /documents - Document management
    const documentsRes = this.api.root.addResource('documents');
    addCorsOptions(documentsRes);
    documentsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List all documents

    // /documents/process - Document extraction/processing
    const documentsProcessRes = documentsRes.addResource('process');
    addCorsOptions(documentsProcessRes);
    documentsProcessRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Process document with AI

    // /documents/{documentId}
    const documentIdRes = documentsRes.addResource('{documentId}');
    addCorsOptions(documentIdRes);
    documentIdRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Get document (download URL)
    documentIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete document

    // /documents/{documentId}/extracted - Get extracted data from document
    const documentExtractedRes = documentIdRes.addResource('extracted');
    addCorsOptions(documentExtractedRes);
    documentExtractedRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Get extracted fields

    // /payers - Available payers list
    const payersRes = this.api.root.addResource('payers');
    addCorsOptions(payersRes);
    payersRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // List available payers

    // /verifications - External verification checks (OIG, NPDB, State Board)
    const verificationsRes = this.api.root.addResource('verifications');
    addCorsOptions(verificationsRes);

    // /verifications/oig - OIG Exclusions check
    const oigRes = verificationsRes.addResource('oig');
    addCorsOptions(oigRes);
    oigRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verifications/npdb - National Practitioner Data Bank check
    const npdbRes = verificationsRes.addResource('npdb');
    addCorsOptions(npdbRes);
    npdbRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verifications/state-board - State Dental Board check
    const stateBoardRes = verificationsRes.addResource('state-board');
    addCorsOptions(stateBoardRes);
    stateBoardRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /analytics - Credentialing analytics
    const analyticsRes = this.api.root.addResource('analytics');
    addCorsOptions(analyticsRes);
    analyticsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // AUTOFILL API ROUTES (for Chrome Extension)
    // ========================================

    const autofillIntegration = lambdaProxyIntegration(this.autofillFn);

    // /autofill - Root resource for autofill APIs
    const autofillRes = this.api.root.addResource('autofill');
    addCorsOptions(autofillRes);

    // /autofill/payload - Get autofill payload for a provider
    const payloadRes = autofillRes.addResource('payload');
    addCorsOptions(payloadRes);
    payloadRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/documents - Get document download URLs for a provider
    const autofillDocsRes = autofillRes.addResource('documents');
    addCorsOptions(autofillDocsRes);
    autofillDocsRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/audit - Log autofill events
    const auditRes = autofillRes.addResource('audit');
    addCorsOptions(auditRes);
    auditRes.addMethod('POST', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/schema - Get canonical field schema
    const schemaRes = autofillRes.addResource('schema');
    addCorsOptions(schemaRes);
    schemaRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/portals - Portal adapters CRUD
    const portalsRes = autofillRes.addResource('portals');
    addCorsOptions(portalsRes);
    portalsRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    portalsRes.addMethod('POST', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/portals/{portalId}
    const portalIdRes = portalsRes.addResource('{portalId}');
    addCorsOptions(portalIdRes);
    portalIdRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    portalIdRes.addMethod('PUT', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    portalIdRes.addMethod('DELETE', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/requirements - Payer requirements CRUD
    const requirementsRes = autofillRes.addResource('requirements');
    addCorsOptions(requirementsRes);
    requirementsRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    requirementsRes.addMethod('POST', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/requirements/{payerId}
    const requirementIdRes = requirementsRes.addResource('{payerId}');
    addCorsOptions(requirementIdRes);
    requirementIdRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    requirementIdRes.addMethod('PUT', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });
    requirementIdRes.addMethod('DELETE', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /autofill/email-packet - Generate submission-ready email packet
    const emailPacketRes = autofillRes.addResource('email-packet');
    addCorsOptions(emailPacketRes);
    emailPacketRes.addMethod('GET', autofillIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // VERIFICATION API ROUTES
    // ========================================

    const verifyIntegration = lambdaProxyIntegration(this.verificationFn);
    const verifyRes = this.api.root.addResource('verify');
    addCorsOptions(verifyRes);

    // /verify/npi - NPI verification via NPPES
    const verifyNpiRes = verifyRes.addResource('npi');
    addCorsOptions(verifyNpiRes);
    verifyNpiRes.addMethod('GET', verifyIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verify/oig - OIG/LEIE exclusion check
    const verifyOigRes = verifyRes.addResource('oig');
    addCorsOptions(verifyOigRes);
    verifyOigRes.addMethod('GET', verifyIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verify/license - State license verification
    const verifyLicenseRes = verifyRes.addResource('license');
    addCorsOptions(verifyLicenseRes);
    verifyLicenseRes.addMethod('GET', verifyIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verify/comprehensive - Run all verifications for a provider
    const verifyComprehensiveRes = verifyRes.addResource('comprehensive');
    addCorsOptions(verifyComprehensiveRes);
    verifyComprehensiveRes.addMethod('POST', verifyIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /verify/logs - Get verification history for a provider
    const verifyLogsRes = verifyRes.addResource('logs');
    addCorsOptions(verifyLogsRes);
    verifyLogsRes.addMethod('GET', verifyIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // WORKFLOW API ROUTES
    // ========================================

    const workflowIntegration = lambdaProxyIntegration(this.workflowFn);

    // /workflows - List workflows for provider
    const workflowsRes = this.api.root.addResource('workflows');
    addCorsOptions(workflowsRes);
    workflowsRes.addMethod('GET', workflowIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /workflow/start - Start a new workflow
    const workflowRes = this.api.root.addResource('workflow');
    addCorsOptions(workflowRes);
    const workflowStartRes = workflowRes.addResource('start');
    addCorsOptions(workflowStartRes);
    workflowStartRes.addMethod('POST', workflowIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /workflow/{executionId} - Get workflow status
    const workflowIdRes = workflowRes.addResource('{executionId}');
    addCorsOptions(workflowIdRes);
    workflowIdRes.addMethod('GET', workflowIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /workflow/{executionId}/approve - Approve pending review
    const workflowApproveRes = workflowIdRes.addResource('approve');
    addCorsOptions(workflowApproveRes);
    workflowApproveRes.addMethod('POST', workflowIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /workflow/{executionId}/reject - Reject pending review
    const workflowRejectRes = workflowIdRes.addResource('reject');
    addCorsOptions(workflowRejectRes);
    workflowRejectRes.addMethod('POST', workflowIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // EXPIRATION API ROUTES
    // ========================================

    const expirationIntegration = lambdaProxyIntegration(this.expirationApiHandler);
    const expirationsRes = this.api.root.addResource('expirations');
    addCorsOptions(expirationsRes);

    // /expirations/summary - Get expiration summary
    const expSummaryRes = expirationsRes.addResource('summary');
    addCorsOptions(expSummaryRes);
    expSummaryRes.addMethod('GET', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /expirations/critical - Get critical expirations only
    const expCriticalRes = expirationsRes.addResource('critical');
    addCorsOptions(expCriticalRes);
    expCriticalRes.addMethod('GET', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /expirations/alerts - Get alert history
    const expAlertsRes = expirationsRes.addResource('alerts');
    addCorsOptions(expAlertsRes);
    expAlertsRes.addMethod('GET', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /expirations/provider/{providerId} - Get expirations for provider
    const expProviderRes = expirationsRes.addResource('provider').addResource('{providerId}');
    addCorsOptions(expProviderRes);
    expProviderRes.addMethod('GET', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /expirations/scan - Trigger manual scan
    const expScanRes = expirationsRes.addResource('scan');
    addCorsOptions(expScanRes);
    expScanRes.addMethod('POST', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /expirations/notify - Send notifications
    const expNotifyRes = expirationsRes.addResource('notify');
    addCorsOptions(expNotifyRes);
    expNotifyRes.addMethod('POST', expirationIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.credentialingFn, name: 'credentialing', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.autofillFn, name: 'autofill', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.docProcessorFn, name: 'doc-processor', durationMs: Math.floor(Duration.minutes(5).toMilliseconds() * 0.8) },
      { fn: this.verificationFn, name: 'verification', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.workflowFn, name: 'workflow-api', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.workflowStepFn, name: 'workflow-step', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
      { fn: this.expirationMonitorFn, name: 'expiration-monitor', durationMs: Math.floor(Duration.minutes(5).toMilliseconds() * 0.8) },
      { fn: this.expirationApiHandler, name: 'expiration-api', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
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
    createDynamoThrottleAlarm(this.portalAdaptersTable.tableName, 'PortalAdaptersTable');
    createDynamoThrottleAlarm(this.payerRequirementsTable.tableName, 'PayerRequirementsTable');
    createDynamoThrottleAlarm(this.autofillAuditTable.tableName, 'AutofillAuditTable');
    createDynamoThrottleAlarm(this.extractedDataTable.tableName, 'ExtractedDataTable');
    createDynamoThrottleAlarm(this.verificationLogsTable.tableName, 'VerificationLogsTable');
    createDynamoThrottleAlarm(this.workflowExecutionsTable.tableName, 'WorkflowExecutionsTable');
    createDynamoThrottleAlarm(this.expirationAlertsTable.tableName, 'ExpirationAlertsTable');

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

    // Autofill Extension Table Outputs
    new CfnOutput(this, 'PortalAdaptersTableName', {
      value: this.portalAdaptersTable.tableName,
      description: 'DynamoDB Portal Adapters Table Name',
      exportName: `${Stack.of(this).stackName}-PortalAdaptersTableName`,
    });

    new CfnOutput(this, 'PayerRequirementsTableName', {
      value: this.payerRequirementsTable.tableName,
      description: 'DynamoDB Payer Requirements Table Name',
      exportName: `${Stack.of(this).stackName}-PayerRequirementsTableName`,
    });

    new CfnOutput(this, 'AutofillAuditTableName', {
      value: this.autofillAuditTable.tableName,
      description: 'DynamoDB Autofill Audit Logs Table Name',
      exportName: `${Stack.of(this).stackName}-AutofillAuditTableName`,
    });
  }
}
