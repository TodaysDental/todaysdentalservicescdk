import { Duration, Stack, StackProps, CfnOutput, Tags, Fn, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// ========================================
// GMAIL OAUTH2 CREDENTIALS (Domain-level)
// ========================================
// These are shared across all clinics for OAuth2 authentication
// Each clinic has its own refresh token stored in clinics.json
const GMAIL_CLIENT_ID = 'REPLACE_WITH_YOUR_GMAIL_CLIENT_ID.apps.googleusercontent.com';
const GMAIL_CLIENT_SECRET = 'REPLACE_WITH_YOUR_GMAIL_CLIENT_SECRET';

// ========================================
// DOMAIN EMAIL CREDENTIALS (todaysdentalinsights.com)
// ========================================
// Used when clinicId='domain' for domain-level email access
const DOMAIN_SMTP_USER = 'no-reply@todaysdentalinsights.com';
const DOMAIN_SMTP_PASSWORD = 'REPLACE_WITH_DOMAIN_APP_PASSWORD';
const DOMAIN_IMAP_HOST = 'imap.gmail.com';
const DOMAIN_IMAP_PORT = 993;

// ========================================
// CPANEL CREDENTIALS (todaysdentalpartners.com)
// ========================================
// Used for creating user email accounts during registration
const CPANEL_HOST = 'box2383.bluehost.com';
const CPANEL_PORT = '2083';
const CPANEL_USER = 'todayse4';
const CPANEL_PASSWORD = 'James!007';
const CPANEL_DOMAIN = 'todaysdentalpartners.com';

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
  // All domain-level credentials are defined as constants at the top of this file.
  // No additional props required for basic email functionality.
  // Add custom props here if needed for future extensions.
  
  // StaffUser table name for user email lookups
  staffUserTableName?: string;
}

export class EmailStack extends Stack {
  public readonly gmailHandlerFn: lambdaNode.NodejsFunction;
  public readonly imapSmtpHandlerFn: lambdaNode.NodejsFunction;
  public readonly userEmailHandlerFn: lambdaNode.NodejsFunction;
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
        GMAIL_CLIENT_ID: GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET: GMAIL_CLIENT_SECRET,
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
        DOMAIN_SMTP_USER: DOMAIN_SMTP_USER,
        DOMAIN_SMTP_PASSWORD: DOMAIN_SMTP_PASSWORD,
        DOMAIN_IMAP_HOST: DOMAIN_IMAP_HOST,
        DOMAIN_IMAP_PORT: String(DOMAIN_IMAP_PORT),
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
    
    // GET /gmail/{clinicId} - Fetch inbox emails (authorized)
    gmailClinicResource.addMethod('GET', gmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
        'method.request.querystring.limit': false,
      },
    });
    
    // POST /gmail/{clinicId} - Send email (authorized)
    gmailClinicResource.addMethod('POST', gmailIntegration, {
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
    
    // GET /imap/{clinicId} - Fetch emails via IMAP (authorized)
    imapClinicResource.addMethod('GET', imapIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.clinicId': true,
      },
    });
    
    // POST /imap/{clinicId} - Send email via SMTP (authorized)
    imapClinicResource.addMethod('POST', imapIntegration, {
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
    
    // GET /user - Fetch authenticated user's emails (authorized)
    userEmailResource.addMethod('GET', userEmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.limit': false,
        'method.request.querystring.days': false,
      },
    });
    
    // POST /user - Send email from authenticated user's account (authorized)
    userEmailResource.addMethod('POST', userEmailIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
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
  }
}
