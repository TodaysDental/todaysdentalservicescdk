import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
// Import the DynamoDB module
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export class CoreStack extends Stack {
  public readonly authApi: apigw.RestApi;
  public readonly staffClinicInfoTable: dynamodb.Table;
  public readonly staffUserTable: dynamodb.Table;
  public readonly tokenBlacklistTable: dynamodb.Table;
  public readonly authorizerFunction: lambdaNode.NodejsFunction; // Export the Lambda function
  public readonly jwtSecretValue: string;
  public readonly customDomain: apigw.DomainName; // Export the custom domain

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Core',
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
    // DYNAMODB TABLES
    // ========================================

    // Staff User Table - Main authentication and user management table
    this.staffUserTable = new dynamodb.Table(this, 'StaffUserTable', {
      tableName: `${this.stackName}-StaffUser`,
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // Enable point-in-time recovery for security
    });
    applyTags(this.staffUserTable, { Table: 'staff-user' });

    // Note: GSIs removed because with per-clinic role structure (clinicRoles array),
    // DynamoDB can't efficiently index nested array items. If needed, we can implement
    // a separate index table or denormalize by maintaining top-level arrays.

    // Staff Clinic Info Table
    this.staffClinicInfoTable = new dynamodb.Table(this, 'StaffClinicInfoTable', {
      tableName: `${this.stackName}-StaffClinicInfo`,
      // The user's email is the partition key
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      // The clinic's ID is the sort key
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Use RETAIN for production to prevent accidental data loss
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.staffClinicInfoTable, { Table: 'staff-clinic-info' });

    // Token Blacklist Table - For logout functionality
    // Stores hashed tokens that have been logged out to prevent reuse
    this.tokenBlacklistTable = new dynamodb.Table(this, 'TokenBlacklistTable', {
      tableName: `${this.stackName}-TokenBlacklist`,
      partitionKey: { name: 'tokenHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Can be destroyed, tokens expire anyway
      timeToLiveAttribute: 'ttl', // Enable TTL for automatic cleanup of expired tokens
    });
    applyTags(this.tokenBlacklistTable, { Table: 'token-blacklist' });

    // ========================================
    // JWT SECRET (from environment variable)
    // ========================================

    // Get JWT secret from environment variable
    // You should set this in your deployment environment:
    // export JWT_SECRET="your-secret-key-here"
    this.jwtSecretValue = process.env.JWT_SECRET || (() => {
      throw new Error('JWT_SECRET environment variable is required for deployment');
    })();

    // ========================================
    // CUSTOM LAMBDA AUTHORIZER
    // ========================================

    this.authorizerFunction = new lambdaNode.NodejsFunction(this, 'CustomAuthorizerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'authorizer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        JWT_SECRET: this.jwtSecretValue,
        TOKEN_BLACKLIST_TABLE: this.tokenBlacklistTable.tableName,
        STAFF_USER_TABLE: this.staffUserTable.tableName,
      },
    });
    applyTags(this.authorizerFunction, { Function: 'authorizer' });

    // Grant authorizer read access to token blacklist table
    this.tokenBlacklistTable.grantReadData(this.authorizerFunction);

    // Grant authorizer read access to StaffUser table (to fetch clinicRoles)
    this.staffUserTable.grantReadData(this.authorizerFunction);

    // ========================================
    // AUTH API (MINIMAL)
    // ========================================

    // Create minimal API for authentication endpoints only
    this.authApi = new apigw.RestApi(this, 'AuthApi', {
      restApiName: 'AuthApi',
      description: 'Authentication API endpoints',
      defaultCorsPreflightOptions: getCdkCorsConfig({
        allowMethods: ['OPTIONS', 'POST']
      }),
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Note: No authorizer needed for CoreStack's auth API
    // All auth endpoints (login, OTP) are public endpoints
    // Other stacks create their own authorizers from authorizerFunction

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.authApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.authApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.authApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.authApi,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // ========================================
    // AUTH LAMBDA FUNCTIONS
    // ========================================

    // OTP Initiate endpoint - Sends OTP code to email
    const initiateOtpFn = new lambdaNode.NodejsFunction(this, 'AuthInitiateOtpFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'initiate-otp.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: this.staffUserTable.tableName,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        FROM_EMAIL: 'no-reply@todaysdentalservices.com',
        SES_REGION: 'us-east-1',
        APP_NAME: 'TodaysDentalInsights',
      },
    });
    applyTags(initiateOtpFn, { Function: 'auth-initiate-otp' });

    this.staffUserTable.grantReadWriteData(initiateOtpFn);

    // Grant SES permissions
    initiateOtpFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // OTP Verify endpoint - Validates OTP and returns JWT tokens
    const verifyOtpFn = new lambdaNode.NodejsFunction(this, 'AuthVerifyOtpFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'verify-otp.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: this.staffUserTable.tableName,
        JWT_SECRET: this.jwtSecretValue,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    applyTags(verifyOtpFn, { Function: 'auth-verify-otp' });

    this.staffUserTable.grantReadWriteData(verifyOtpFn);

    // Refresh token endpoint
    const refreshFn = new lambdaNode.NodejsFunction(this, 'AuthRefreshFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'refresh.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: this.staffUserTable.tableName,
        JWT_SECRET: this.jwtSecretValue,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    applyTags(refreshFn, { Function: 'auth-refresh' });

    this.staffUserTable.grantReadData(refreshFn);

    // Logout endpoint - Revokes tokens and adds them to blacklist
    const logoutFn = new lambdaNode.NodejsFunction(this, 'AuthLogoutFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'logout.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: this.staffUserTable.tableName,
        TOKEN_BLACKLIST_TABLE: this.tokenBlacklistTable.tableName,
        JWT_SECRET: this.jwtSecretValue,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    applyTags(logoutFn, { Function: 'auth-logout' });

    this.staffUserTable.grantReadWriteData(logoutFn);
    this.tokenBlacklistTable.grantWriteData(logoutFn);

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.authorizerFunction, name: 'authorizer', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: initiateOtpFn, name: 'auth-initiate-otp', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: verifyOtpFn, name: 'auth-verify-otp', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: refreshFn, name: 'auth-refresh', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: logoutFn, name: 'auth-logout', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.staffUserTable.tableName, 'StaffUserTable');
    createDynamoThrottleAlarm(this.staffClinicInfoTable.tableName, 'StaffClinicInfoTable');
    createDynamoThrottleAlarm(this.tokenBlacklistTable.tableName, 'TokenBlacklistTable');

    // ========================================
    // AUTH API ROUTES
    // ========================================

    // OTP-based authentication flow
    const initiateRes = this.authApi.root.addResource('initiate');
    initiateRes.addMethod('POST', new apigw.LambdaIntegration(initiateOtpFn), {
      methodResponses: [{ statusCode: '200' }]
    });

    const verifyRes = this.authApi.root.addResource('verify');
    verifyRes.addMethod('POST', new apigw.LambdaIntegration(verifyOtpFn), {
      methodResponses: [{ statusCode: '200' }]
    });

    const refreshRes = this.authApi.root.addResource('refresh');
    refreshRes.addMethod('POST', new apigw.LambdaIntegration(refreshFn), {
      methodResponses: [{ statusCode: '200' }]
    });

    const logoutRes = this.authApi.root.addResource('logout');
    logoutRes.addMethod('POST', new apigw.LambdaIntegration(logoutFn), {
      methodResponses: [{ statusCode: '200' }]
    });

    // ========================================
    // CUSTOM DOMAIN SETUP
    // ========================================

    // Import the Route53 hosted zone for api.todaysdentalservices.com
    // (zone IS the full domain — apex, not a subdomain of a parent zone)
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z01706382YE2HSU5ZCHQ2',
      zoneName: 'api.todaysdentalservices.com',
    });

    // CDK auto-creates a FREE ACM certificate and validates it via Route53 DNS.
    // During `cdk deploy` CloudFormation will:
    //   1. Request the cert from ACM
    //   2. Add the CNAME validation record to the hosted zone above
    //   3. Wait for ACM to confirm validation (1-3 min)
    //   4. Continue deploying the rest of the stack
    const certificate = new certificatemanager.Certificate(this, 'ApiCertificate', {
      domainName: 'api.todaysdentalservices.com',
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    // Create the custom domain for API Gateway REST APIs
    const customDomain = new apigw.DomainName(this, 'ApiGatewayDomain', {
      domainName: 'api.todaysdentalservices.com',
      certificate: certificate,
      endpointType: apigw.EndpointType.REGIONAL,
      securityPolicy: apigw.SecurityPolicy.TLS_1_2,
    });

    // Store the custom domain as a class property
    this.customDomain = customDomain;

    // Route53 apex A record pointing api.todaysdentalservices.com → API Gateway
    new route53.ARecord(this, 'ApiGatewayAliasRecord', {
      zone: hostedZone,
      // No recordName — apex A record at zone root
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGatewayDomain(customDomain)
      ),
    });

    // ========================================
    // OUTPUTS
    // ========================================

    // Map Auth API to custom domain under /auth path.
    // IMPORTANT: Use customDomain.domainName (the CDK object reference) NOT a hardcoded
    // string. The object reference creates an implicit CloudFormation dependency, ensuring
    // the ApiGateway::DomainName resource is fully created before this BasePathMapping
    // attempts to attach to it. A hardcoded string has no dependency and causes a 404.
    new apigw.CfnBasePathMapping(this, 'AuthApiBasePathMapping', {
      domainName: customDomain.domainName,
      basePath: 'auth',
      restApiId: this.authApi.restApiId,
      stage: this.authApi.deploymentStage.stageName,
    });

    // Output the Auth API URL with custom domain
    new CfnOutput(this, 'AuthApiUrl', {
      value: 'https://api.todaysdentalservices.com/auth/',
      description: 'Auth API endpoint URL'
    });
    new CfnOutput(this, 'StaffUserTableName', {
      value: this.staffUserTable.tableName,
      exportName: 'CoreStack-StaffUserTableName',
      description: 'StaffUser DynamoDB Table Name'
    });
    new CfnOutput(this, 'StaffClinicInfoTableName', { value: this.staffClinicInfoTable.tableName });
    // Export the authorizer function ARN for cross-stack reference
    new CfnOutput(this, 'AuthorizerFunctionArn', {
      value: this.authorizerFunction.functionArn,
      exportName: 'AuthorizerFunctionArnN1',
      description: 'Custom Lambda Authorizer Function ARN'
    });

    // Export the authorizer function name for cross-stack reference
    new CfnOutput(this, 'AuthorizerFunctionName', {
      value: this.authorizerFunction.functionName,
      exportName: 'AuthorizerFunctionNameN1',
      description: 'Custom Lambda Authorizer Function Name'
    });
    // Custom domain outputs
    new CfnOutput(this, 'ApiDomainName', {
      value: 'api.todaysdentalservices.com',
      exportName: `${Stack.of(this).stackName}-ApiDomainName`,
      description: 'Custom domain name for API Gateway'
    });
    new CfnOutput(this, 'ApiDomainRegionalDomainName', {
      value: customDomain.domainNameAliasDomainName,
      description: 'Regional domain name for the custom domain (for verification)'
    });
    new CfnOutput(this, 'CertificateArn', {
      value: 'arn:aws:acm:us-east-1:851620242036:certificate/8df14189-a210-4222-bd3f-0ff2cfc0e157',
      exportName: `${Stack.of(this).stackName}-CertificateArn`,
      description: 'Certificate ARN for API custom domain'
    });

  }
}
