import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
// Import the DynamoDB module
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import clinicsData from '../configs/clinics.json';
import { Clinic } from '../configs/clinics';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export class CoreStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authApi: apigw.RestApi;
  public readonly staffClinicInfoTable: dynamodb.Table;
  // Connect-native architecture - voice agents table no longer needed

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Connect-native architecture - voice agents table no longer needed
    // Voice agents are created directly in Amazon Connect, not stored in DynamoDB

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
    // COGNITO USER POOL
    // ========================================

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      mfa: cognito.Mfa.OFF,
      removalPolicy: RemovalPolicy.RETAIN, // change to DESTROY for dev
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        // compact flags for tokens
        x_is_super_admin: new cognito.StringAttribute({ mutable: true }),
        x_clinics: new cognito.StringAttribute({ mutable: true }),
        x_rbc: new cognito.StringAttribute({ mutable: true }),
        // Dental staff custom attributes (kept as potential defaults)
        hourly_pay: new cognito.StringAttribute({ mutable: true }),
        opendental_usernum: new cognito.StringAttribute({ mutable: true }),
        opendental_username: new cognito.StringAttribute({ mutable: true }),
        // ** NOTE: This attribute is now replaced by the StaffClinicInfo DynamoDB table. **
        // It is commented out to prevent its creation and encourage use of the new table.
        // open_dental_per_clinic: new cognito.StringAttribute({ mutable: true }),
      },
    });

    // Custom auth requires a trigger Lambda; use multi-trigger handler
    const triggersFn = new lambdaNode.NodejsFunction(this, 'CognitoTriggersFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        APP_NAME: 'TodaysDentalInsights',
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
        SES_REGION: 'us-east-1',
      },
    });

    // Allow SES + Cognito IDP actions from lambda
    triggersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListGroupsForUser',
        'cognito-idp:AdminListGroupsForUser',
      ],
      resources: ['*'],
    }));

    this.userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, triggersFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, triggersFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, triggersFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, triggersFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, triggersFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, triggersFn);

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      authFlows: {
        custom: true,
        userSrp: true,
        adminUserPassword: true,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    // ========================================
    // COGNITO GROUPS
    // ========================================

    // Global super admin
    new cognito.CfnUserPoolGroup(this, 'GlobalSuperAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'GLOBAL__SUPER_ADMIN',
      description: 'Global super administrators',
    });

    // Create groups using IDs from clinic-config so names stay in sync (no clinic-level SUPER_ADMIN)
    const roles = ['ADMIN', 'PROVIDER', 'MARKETING', 'USER'];
    (clinicsData as Clinic[]).forEach((c) => {
      const idFromConfig = String(c.clinicId);
      const nameFromConfig = String(c.clinicName || c.clinicId);
      roles.forEach((role) => {
        new cognito.CfnUserPoolGroup(this, `Group_${idFromConfig}_${role}`, {
          userPoolId: this.userPool.userPoolId,
          groupName: `clinic_${idFromConfig}__${role}`,
          description: `${nameFromConfig} - ${role}`,
        });
      });
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

    // Auth endpoints (initiate and verify) - no authorizer
    const initiateFn = new lambdaNode.NodejsFunction(this, 'AuthInitiateFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'initiate.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    initiateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:InitiateAuth'],
      resources: ['*'],
    }));

    const verifyFn = new lambdaNode.NodejsFunction(this, 'AuthVerifyFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'verify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    verifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:RespondToAuthChallenge'],
      resources: ['*'],
    }));

    // Auth API routes (base path mapping already set to "auth")
    const initiateRes = this.authApi.root.addResource('initiate');
    initiateRes.addMethod('POST', new apigw.LambdaIntegration(initiateFn), {
      methodResponses: [{ statusCode: '200' }]
    });
    const verifyRes = this.authApi.root.addResource('verify');
    verifyRes.addMethod('POST', new apigw.LambdaIntegration(verifyFn), {
      methodResponses: [{ statusCode: '200' }]
    });

    /*
    // ========================================
    // GRANT PERMISSIONS TO ADMIN API LAMBDA
    // ========================================
    //
    // ** IMPORTANT: **
    // You must grant the Admin API Lambda (which runs 'register.ts' and 'users.ts')
    // permissions to the new DynamoDB table.
    //
    // Assuming you have a Lambda construct named 'adminApiFunction':
    //
    // 1. Grant Read/Write Permissions:
    //    staffClinicInfoTable.grantReadWriteData(adminApiFunction);
    //
    // 2. Pass Table Name as Environment Variable:
    //    adminApiFunction.addEnvironment(
    //      'STAFF_CLINIC_INFO_TABLE',
    //      staffClinicInfoTable.tableName
    //    );
    */

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

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolArn', { value: this.userPool.userPoolArn });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'AuthApiUrl', { value: 'https://api.todaysdentalinsights.com/auth/' });
  new CfnOutput(this, 'StaffClinicInfoTableName', { value: this.staffClinicInfoTable.tableName });
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