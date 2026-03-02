import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput, Tags, Fn, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// ========================================
// SECRETS MANAGEMENT
// ========================================
// All sensitive credentials (Gmail OAuth, Domain SMTP, cPanel) are now stored in 
// the GlobalSecrets DynamoDB table and retrieved dynamically at runtime using
// the secrets-helper utility. This eliminates hardcoded secrets in the codebase.
//
// GlobalSecrets table entries:
// - gmail/client_id, gmail/client_secret: Gmail OAuth2 credentials
// - domain_email/smtp_password: Domain SMTP password
// - cpanel/password, cpanel/config: cPanel credentials
//
// ClinicSecrets table entries (per-clinic):
// - gmailSmtpPassword, domainSmtpPassword: Per-clinic email passwords

/**
 * Email Stack - Handles clinic-specific email operations
 * 
 * Supports two email methods:
 * 1. Gmail REST API (OAuth2) - For clinics with Gmail OAuth configured
 * 2. IMAP/SMTP - For traditional email access
 * 
 * Domain-level secrets are defined as constants above:
 * - GMAIL_CLIENT_ID: Google OAuth2 Client ID
 * - GMAIL_CLIENT_SECRET: Google OAuth2 Client Secret
 * - DOMAIN_SMTP_USER: Domain-level SMTP username
 * - DOMAIN_SMTP_PASSWORD: Domain-level SMTP password (App Password)
 * - DOMAIN_IMAP_HOST: Domain-level IMAP host
 * - DOMAIN_IMAP_PORT: Domain-level IMAP port
 * 
 * Clinic-specific credentials are stored in clinics.json:
 * - email.gmailUserId
 * - email.gmailRefreshToken
 * - email.smtpUser
 * - email.smtpPassword
 * - email.imapHost
 * - email.imapPort
 */
export interface EmailStackProps extends StackProps {
  // StaffUser table name for user email lookups
  staffUserTableName?: string;
  /** GlobalSecrets DynamoDB table name for retrieving Gmail/cPanel credentials */
  globalSecretsTableName: string;
  /** ClinicSecrets DynamoDB table name for per-clinic email credentials */
  clinicSecretsTableName: string;
  /** ClinicConfig DynamoDB table name for clinic email configuration */
  clinicConfigTableName: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn: string;

  // ========================================
  // EMAIL ROUTER INTEGRATION (cross-stack)
  // ========================================
  /** Comm FavorRequests table name for creating tasks */
  commFavorsTableName?: string;
  /** Comm FavorRequests table ARN for IAM permissions */
  commFavorsTableArn?: string;
  /** Comm S3 files bucket name for uploading email attachments */
  commFilesBucketName?: string;
  /** Comm S3 files bucket ARN for IAM permissions */
  commFilesBucketArn?: string;
  /** Callback table prefix (e.g., 'todaysdentalinsights-callback-') */
  callbackTablePrefix?: string;
  /** Default callback table name for fallback */
  defaultCallbackTableName?: string;
  /** Default callback table ARN for IAM permissions */
  defaultCallbackTableArn?: string;
}

export class EmailStack extends Stack {
  public readonly gmailHandlerFn: lambdaNode.NodejsFunction;
  public readonly imapSmtpHandlerFn: lambdaNode.NodejsFunction;
  public readonly userEmailHandlerFn: lambdaNode.NodejsFunction;
  public readonly emailRouterFn: lambdaNode.NodejsFunction;
  public readonly emailApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Email',
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

    // ========================================
    // AUTHORIZER (from CoreStack)
    // ========================================
    
    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // ========================================
    // GMAIL REST API HANDLER
    // ========================================
    
    this.gmailHandlerFn = new lambdaNode.NodejsFunction(this, 'GmailHandlerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'gmail-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { 
        // Use CJS format - google-auth-library uses dynamic require() for Node.js built-ins
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node20',
      },
      environment: {
        // Secrets tables for dynamic credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
      },
    });
    applyTags(this.gmailHandlerFn, { Function: 'gmail-handler' });
    createLambdaErrorAlarm(this.gmailHandlerFn, 'gmail-handler');
    createLambdaThrottleAlarm(this.gmailHandlerFn, 'gmail-handler');

    // ========================================
    // IMAP/SMTP HANDLER
    // ========================================
    
    this.imapSmtpHandlerFn = new lambdaNode.NodejsFunction(this, 'ImapSmtpHandlerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'imap-smtp-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60), // IMAP can be slow
      bundling: { 
        // Use CJS format - imap-simple uses dynamic require() patterns
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node20',
      },
      environment: {
        // Secrets tables for dynamic credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
      },
    });
    applyTags(this.imapSmtpHandlerFn, { Function: 'imap-smtp-handler' });
    createLambdaErrorAlarm(this.imapSmtpHandlerFn, 'imap-smtp-handler');
    createLambdaThrottleAlarm(this.imapSmtpHandlerFn, 'imap-smtp-handler');

    // ========================================
    // USER EMAIL HANDLER (todaysdentalpartners.com)
    // ========================================
    // Allows users to GET/POST their own emails from their todaysdentalpartners.com account
    
    // Import StaffUser table name from CoreStack
    const staffUserTableName = props.staffUserTableName || Fn.importValue('CoreStack-StaffUserTableName');
    
    this.userEmailHandlerFn = new lambdaNode.NodejsFunction(this, 'UserEmailHandlerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'user-email-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60), // IMAP can be slow
      bundling: { 
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node20',
      },
      environment: {
        STAFF_USER_TABLE: staffUserTableName.toString(),
        // Secrets tables for dynamic credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
      },
    });
    applyTags(this.userEmailHandlerFn, { Function: 'user-email-handler' });
    createLambdaErrorAlarm(this.userEmailHandlerFn, 'user-email-handler');
    createLambdaThrottleAlarm(this.userEmailHandlerFn, 'user-email-handler');

    // Grant DynamoDB read access to StaffUser table for user email lookup
    // Use wildcard pattern to match any stack's StaffUser table
    this.userEmailHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/StaffUser`,
      ],
    }));

    // ========================================
    // SECRETS TABLES PERMISSIONS
    // ========================================
    // Grant all Lambda functions read access to secrets tables for dynamic credential retrieval
    const allLambdas = [this.gmailHandlerFn, this.imapSmtpHandlerFn, this.userEmailHandlerFn];

    // IAM policy for reading from secrets tables
    const secretsReadPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
      ],
    });

    // IAM policy for KMS decryption
    const kmsDecryptPolicy = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: [props.secretsEncryptionKeyArn],
    });

    allLambdas.forEach(fn => {
      fn.addToRolePolicy(secretsReadPolicy);
      fn.addToRolePolicy(kmsDecryptPolicy);
    });

    // ========================================
    // API GATEWAY
    // ========================================
    
    // Get CORS configuration
    const corsConfig = getCdkCorsConfig();
    const corsErrorHeaders = getCorsErrorHeaders();

    this.emailApi = new apigw.RestApi(this, 'EmailApi', {
      restApiName: `${this.stackName}-EmailApi`,
      description: 'Email API for clinic-specific email operations (authorized, clinic-level access)',
      defaultCorsPreflightOptions: corsConfig,
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });
    applyTags(this.emailApi, { Api: 'email' });

    // Add gateway responses for 4xx/5xx errors with CORS headers
    this.emailApi.addGatewayResponse('Default4XX', {
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    this.emailApi.addGatewayResponse('Default5XX', {
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'EmailAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.emailApi.restApiId}/authorizers/*`,
    });

    // Gmail API routes: /gmail/{clinicId}
    const gmailResource = this.emailApi.root.addResource('gmail');
    const gmailClinicResource = gmailResource.addResource('{clinicId}');
    const gmailIntegration = new apigw.LambdaIntegration(this.gmailHandlerFn);
    
    // GET /gmail/{clinicId} - Fetch emails by folder (authorized)
    // Query params: ?folder=inbox|sent|spam|trash|starred|drafts&limit=50&days=7
    gmailClinicResource.addMethod('GET', gmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
        'method.request.querystring.limit': false,
        'method.request.querystring.days': false,
        'method.request.querystring.folder': false,
      },
    });
    
    // POST /gmail/{clinicId} - Send email, email actions, or draft operations (authorized)
    // Body for send: { to, subject, body }
    // Body for action: { action: 'archive'|'delete'|'star'|'unstar'|'spam'|'unspam'|'trash'|'untrash', messageId }
    // Body for draft: { to, subject, body, isDraft: true, draftId?: string }
    // Body for send draft: { sendDraftId: string }
    gmailClinicResource.addMethod('POST', gmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
      },
    });
    
    // DELETE /gmail/{clinicId} - Delete email or draft (authorized)
    // Body: { messageId } for emails or { draftId } for drafts
    gmailClinicResource.addMethod('DELETE', gmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
      },
    });

    // IMAP/SMTP API routes: /imap/{clinicId}
    const imapResource = this.emailApi.root.addResource('imap');
    const imapClinicResource = imapResource.addResource('{clinicId}');
    const imapIntegration = new apigw.LambdaIntegration(this.imapSmtpHandlerFn);
    
    // GET /imap/{clinicId} - Fetch emails by folder via IMAP (authorized)
    // Query params: ?folder=inbox|sent|spam|trash|starred|drafts&limit=50&days=7
    imapClinicResource.addMethod('GET', imapIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
        'method.request.querystring.limit': false,
        'method.request.querystring.days': false,
        'method.request.querystring.folder': false,
      },
    });
    
    // POST /imap/{clinicId} - Send email or perform actions via IMAP (authorized)
    // Body for send: { to, subject, body }
    // Body for action: { action: 'delete'|'star'|'unstar'|'spam'|'unspam'|'archive', uid }
    imapClinicResource.addMethod('POST', imapIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
      },
    });
    
    // DELETE /imap/{clinicId} - Delete email via IMAP (authorized)
    // Body: { uid }
    imapClinicResource.addMethod('DELETE', imapIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
      },
    });

    // ========================================
    // USER EMAIL API ROUTES (/user)
    // ========================================
    // Users can only access their own todaysdentalservices.com email
    
    const userEmailResource = this.emailApi.root.addResource('user');
    const userEmailIntegration = new apigw.LambdaIntegration(this.userEmailHandlerFn);
    
    // GET /user - Fetch authenticated user's emails by folder (authorized)
    // Query params: ?folder=inbox|sent|spam|trash|starred|drafts&limit=50&days=7
    userEmailResource.addMethod('GET', userEmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.limit': false,
        'method.request.querystring.days': false,
        'method.request.querystring.folder': false,
      },
    });
    
    // POST /user - Send email or perform actions (authorized)
    // Body for send: { to, subject, body, cc?, bcc? }
    // Body for action: { action: 'delete'|'star'|'unstar'|'spam'|'unspam'|'archive', uid }
    userEmailResource.addMethod('POST', userEmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    
    // DELETE /user - Delete email (authorized)
    // Body: { uid }
    userEmailResource.addMethod('DELETE', userEmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // ========================================
    // EMAIL ROUTER (Scheduled Inbox Poller + AI Classification)
    // ========================================

    const processedEmailsTable = new dynamodb.Table(this, 'ProcessedEmailsTable', {
      tableName: `${this.stackName}-ProcessedEmails`,
      partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(processedEmailsTable, { Table: 'processed-emails' });

    // ========================================
    // SYSTEM TASKS TABLE
    // ========================================

    const systemTasksTable = new dynamodb.Table(this, 'SystemTasksTable', {
      tableName: `${this.stackName}-SystemTasks`,
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    applyTags(systemTasksTable, { Table: 'system-tasks' });

    systemTasksTable.addGlobalSecondaryIndex({
      indexName: 'ModuleIndex',
      partitionKey: { name: 'module', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    systemTasksTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    systemTasksTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    systemTasksTable.addGlobalSecondaryIndex({
      indexName: 'AssignedToIndex',
      partitionKey: { name: 'assignedTo', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // SYSTEM TASKS API HANDLER
    // ========================================

    const systemTasksHandler = new lambdaNode.NodejsFunction(this, 'SystemTasksHandlerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'system-tasks-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        REGION: Stack.of(this).region,
        SYSTEM_TASKS_TABLE: systemTasksTable.tableName,
        FAVORS_TABLE: props.commFavorsTableName || '',
      },
    });
    applyTags(systemTasksHandler, { Function: 'system-tasks-handler' });
    systemTasksTable.grantReadWriteData(systemTasksHandler);

    if (props.commFavorsTableArn) {
      systemTasksHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.commFavorsTableArn],
      }));
    }

    // System Tasks API routes: /system-tasks
    const systemTasksIntegration = new apigw.LambdaIntegration(systemTasksHandler);
    const systemTasksResource = this.emailApi.root.addResource('system-tasks');
    systemTasksResource.addMethod('GET', systemTasksIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    systemTasksResource.addMethod('PUT', systemTasksIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    systemTasksResource.addMethod('POST', systemTasksIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    this.emailRouterFn = new lambdaNode.NodejsFunction(this, 'EmailRouterFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'email', 'email-router.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1536,
      timeout: Duration.seconds(300),
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
      },
      environment: {
        PROCESSED_EMAILS_TABLE: processedEmailsTable.tableName,
        CALLBACK_TABLE_PREFIX: props.callbackTablePrefix || 'todaysdentalinsights-callback-',
        DEFAULT_CALLBACK_TABLE: props.defaultCallbackTableName || '',
        FILES_BUCKET: props.commFilesBucketName || '',
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
        SYSTEM_TASKS_TABLE: systemTasksTable.tableName,
      },
    });
    applyTags(this.emailRouterFn, { Function: 'email-router' });
    createLambdaErrorAlarm(this.emailRouterFn, 'email-router');
    createLambdaThrottleAlarm(this.emailRouterFn, 'email-router');

    // ProcessedEmails table read/write
    processedEmailsTable.grantReadWriteData(this.emailRouterFn);
    systemTasksTable.grantReadWriteData(this.emailRouterFn);

    // Secrets tables read + KMS decrypt (same as other email lambdas)
    this.emailRouterFn.addToRolePolicy(secretsReadPolicy);
    this.emailRouterFn.addToRolePolicy(kmsDecryptPolicy);

    // ClinicConfig Scan permission (for getAllClinicConfigs)
    this.emailRouterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
      ],
    }));

    // Callback tables write permission (wildcard for all clinic tables)
    this.emailRouterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/todaysdentalinsights-callback-*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/RequestCallBacks_*`,
        ...(props.defaultCallbackTableArn ? [props.defaultCallbackTableArn] : []),
      ],
    }));

    // Comm FavorRequests table write permission
    if (props.commFavorsTableArn) {
      this.emailRouterFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [props.commFavorsTableArn],
      }));
    }

    // S3 attachment upload permission
    if (props.commFilesBucketArn) {
      this.emailRouterFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`${props.commFilesBucketArn}/email-router/*`],
      }));
    }

    // Bedrock InvokeModel permission
    this.emailRouterFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      ],
    }));

    // EventBridge cron: every 15 minutes
    new events.Rule(this, 'EmailRouterSchedule', {
      ruleName: `${this.stackName}-EmailRouterEvery15Min`,
      description: 'Triggers the Email Router Lambda every 15 minutes to poll clinic inboxes',
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.emailRouterFn, { retryAttempts: 1 })],
    });

    // ========================================
    // OUTPUTS
    // ========================================
    
    new CfnOutput(this, 'EmailApiUrl', {
      value: this.emailApi.url,
      description: 'Email API Endpoint URL',
      exportName: `${this.stackName}-EmailApiUrl`,
    });

    new CfnOutput(this, 'GmailHandlerFnArn', {
      value: this.gmailHandlerFn.functionArn,
      description: 'Gmail Handler Lambda ARN',
      exportName: `${this.stackName}-GmailHandlerFnArn`,
    });

    new CfnOutput(this, 'ImapSmtpHandlerFnArn', {
      value: this.imapSmtpHandlerFn.functionArn,
      description: 'IMAP/SMTP Handler Lambda ARN',
      exportName: `${this.stackName}-ImapSmtpHandlerFnArn`,
    });

    new CfnOutput(this, 'UserEmailHandlerFnArn', {
      value: this.userEmailHandlerFn.functionArn,
      description: 'User Email Handler Lambda ARN',
      exportName: `${this.stackName}-UserEmailHandlerFnArn`,
    });

    new CfnOutput(this, 'UserEmailApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/email/user',
      description: 'User Email API URL (GET/POST for authenticated users)',
      exportName: `${this.stackName}-UserEmailApiUrl`,
    });

    // ========================================
    // CUSTOM DOMAIN MAPPING
    // ========================================
    // Map this API under the existing custom domain as /email
    new apigw.CfnBasePathMapping(this, 'EmailBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'email',
      restApiId: this.emailApi.restApiId,
      stage: this.emailApi.deploymentStage.stageName,
    });

    new CfnOutput(this, 'EmailCustomDomainUrl', {
      value: 'https://apig.todaysdentalinsights.com/email',
      description: 'Email API Custom Domain URL',
      exportName: `${this.stackName}-EmailCustomDomainUrl`,
    });

    new CfnOutput(this, 'EmailRouterFnArn', {
      value: this.emailRouterFn.functionArn,
      description: 'Email Router Lambda ARN (scheduled inbox poller)',
      exportName: `${this.stackName}-EmailRouterFnArn`,
    });

    new CfnOutput(this, 'ProcessedEmailsTableName', {
      value: processedEmailsTable.tableName,
      description: 'ProcessedEmails DynamoDB table for deduplication',
      exportName: `${this.stackName}-ProcessedEmailsTableName`,
    });

    new CfnOutput(this, 'SystemTasksTableName', {
      value: systemTasksTable.tableName,
    });
  }
}
