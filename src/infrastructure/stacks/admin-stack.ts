import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface AdminStackProps extends StackProps {
  userPool: any;
  userPoolArn: string;
  userPoolId: string;
  clinicHoursTableName: string;
  staffClinicInfoTableName?: string;
}

export class AdminStack extends Stack {
  public readonly registerFn: lambdaNode.NodejsFunction;
  public readonly meFn: lambdaNode.NodejsFunction;
  public readonly usersFn: lambdaNode.NodejsFunction;
  // ...existing code...
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'AdminApi', {
      restApiName: 'AdminApi',
      description: 'Admin service API',
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

    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });


    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Admin API Lambda (register)
    this.registerFn = new lambdaNode.NodejsFunction(this, 'AdminRegisterFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'register.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node22' },
      environment: {
        USER_POOL_ID: props.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
      },
    });

    // Register Lambda permissions
    this.registerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListGroups',
      ],
      resources: [props.userPoolArn],
    }));



    // Admin Users API Lambda
    this.usersFn = new lambdaNode.NodejsFunction(this, 'AdminUsersFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'users.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node22' },
      environment: {
        USER_POOL_ID: props.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
      },
    });

    // ...existing code...

    // If StaffClinicInfo table is provided, grant the register lambda read/write permissions
    if (props.staffClinicInfoTableName) {
      this.registerFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan'
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }


    // ...existing code...




    // Me API Lambda
    const frontendDomain = this.node.tryGetContext('frontendDomain') ?? process.env.FRONTEND_DOMAIN ?? 'https://todaysdentalinsights.com';

    this.meFn = new lambdaNode.NodejsFunction(this, 'MeFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'me.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node22' },
      environment: {
        FRONTEND_DOMAIN: String(frontendDomain),
        USER_POOL_ID: props.userPoolId,
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
      },
    });

    // Allow MeFn to look up user groups if claims are missing
    this.meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminListGroupsForUser'],
      resources: ['*'],
    }));

    // Grant read access to tables for me API
    this.meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicHoursTableName}`,
      ],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'AdminApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'admin',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // API ROUTES
    // ========================================

    // User management routes
    const registerRes = this.api.root.addResource('register');
    registerRes.addMethod('POST', new apigw.LambdaIntegration(this.registerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Users management routes
    const usersRes = this.api.root.addResource('users');
    const usernameRes = usersRes.addResource('{username}');
    usernameRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usernameRes.addMethod('PUT', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usernameRes.addMethod('DELETE', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usersRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // ...existing code...

    // Me API routes
    const meRes = this.api.root.addResource('me');
    const meClinicsRes = meRes.addResource('clinics');
    meClinicsRes.addMethod('GET', new apigw.LambdaIntegration(this.meFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });


    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AdminApiUrl', {
      value: 'https://api.todaysdentalinsights.com/admin/',
      description: 'Admin API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AdminApiUrl`,
    });

    new CfnOutput(this, 'AdminApiId', {
      value: this.api.restApiId,
      description: 'Admin API Gateway ID',
      exportName: `${Stack.of(this).stackName}-AdminApiId`,
    });

  }
}
