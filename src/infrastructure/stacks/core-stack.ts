import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// Import the DynamoDB module
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export class CoreStack extends Stack {
  public readonly authApi: apigw.RestApi;
  public readonly staffClinicInfoTable: dynamodb.Table;
  public readonly staffUserTable: dynamodb.Table;
  public readonly authorizer: apigw.RequestAuthorizer;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Staff User Table - Main authentication and user management table
    this.staffUserTable = new dynamodb.Table(this, 'StaffUserTable', {
      tableName: 'StaffUser',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true, // Enable point-in-time recovery for security
    });

    // Note: GSIs removed because with per-clinic role structure (clinicRoles array),
    // DynamoDB can't efficiently index nested array items. If needed, we can implement
    // a separate index table or denormalize by maintaining top-level arrays.

    // Staff Clinic Info Table
    this.staffClinicInfoTable = new dynamodb.Table(this, 'StaffClinicInfoTable', {
      tableName: 'StaffClinicInfo',
      // The user's email is the partition key
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      // The clinic's ID is the sort key
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Use RETAIN for production to prevent accidental data loss
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ========================================
    // JWT SECRET
    // ========================================

    // Create a secret for JWT signing
    const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
      secretName: 'todaysdentalinsights-jwt-secret',
      description: 'JWT secret for custom authentication',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ secretKey: '' }),
        generateStringKey: 'secretKey',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // ========================================
    // CUSTOM LAMBDA AUTHORIZER
    // ========================================

    const authorizerFn = new lambdaNode.NodejsFunction(this, 'CustomAuthorizerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'authorizer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        JWT_SECRET: jwtSecret.secretValue.unsafeUnwrap(),
      },
    });

    // Grant the authorizer access to the JWT secret
    jwtSecret.grantRead(authorizerFn);

    this.authorizer = new apigw.RequestAuthorizer(this, 'CustomAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

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
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
        SES_REGION: 'us-east-1',
        APP_NAME: 'TodaysDentalInsights',
      },
    });

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
        JWT_SECRET: jwtSecret.secretValue.unsafeUnwrap(),
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });

    this.staffUserTable.grantReadWriteData(verifyOtpFn);
    jwtSecret.grantRead(verifyOtpFn);

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
        JWT_SECRET: jwtSecret.secretValue.unsafeUnwrap(),
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });

    this.staffUserTable.grantReadData(refreshFn);
    jwtSecret.grantRead(refreshFn);

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

    // ========================================
    // CUSTOM DOMAIN SETUP
    // ========================================

    // Note: The domain 'api.todaysdentalinsights.com' already exists from previous deployments
    // We don't need to create or import it here since BasePathMapping can reference it directly

    // ========================================
    // OUTPUTS
    // ========================================

    // Map Auth API to custom domain under /auth path
    new apigw.CfnBasePathMapping(this, 'AuthApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'auth',
      restApiId: this.authApi.restApiId,
      stage: this.authApi.deploymentStage.stageName,
    });

    new CfnOutput(this, 'AuthApiUrl', { value: 'https://api.todaysdentalinsights.com/auth/' });
    new CfnOutput(this, 'StaffUserTableName', { value: this.staffUserTable.tableName });
    new CfnOutput(this, 'StaffClinicInfoTableName', { value: this.staffClinicInfoTable.tableName });
    new CfnOutput(this, 'AuthorizerArn', { 
      value: authorizerFn.functionArn,
      exportName: `${Stack.of(this).stackName}-AuthorizerArn`,
      description: 'Custom Lambda Authorizer ARN'
    });
    new CfnOutput(this, 'ApiDomainName', {
      value: 'api.todaysdentalinsights.com',
      exportName: `${Stack.of(this).stackName}-ApiDomainName`,
      description: 'Custom domain name for API Gateway'
    });
    new CfnOutput(this, 'CertificateArn', {
      value: 'arn:aws:acm:us-east-1:851620242036:certificate/7af77cc9-8c2e-4d1b-bd99-ac0087643686',
      exportName: `${Stack.of(this).stackName}-CertificateArn`,
      description: 'Certificate ARN for API custom domain'
    });
  }
}