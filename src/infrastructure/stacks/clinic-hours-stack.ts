import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ClinicHoursStackProps extends StackProps {
  userPool: any;
}

export class ClinicHoursStack extends Stack {
  public readonly clinicHoursTable: dynamodb.Table;
  public readonly hoursCrudFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ClinicHoursStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.clinicHoursTable = new dynamodb.Table(this, 'ClinicHoursTable', {
      tableName: 'todaysdentalinsights-ClinicHoursV3',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ClinicHoursApi', {
      restApiName: 'ClinicHoursApi',
      description: 'Clinic Hours service API',
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
    // LAMBDA FUNCTION
    // ========================================

    this.hoursCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicHoursCrudFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'hoursCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node22',
        minify: false,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          'jose',
        ],
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        CLINIC_HOURS_TABLE: this.clinicHoursTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
    });

    // DynamoDB permissions
    this.hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan',
        'dynamodb:Query'
      ],
      resources: [this.clinicHoursTable.tableArn, `${this.clinicHoursTable.tableArn}/*`],
    }));


    // Cognito permissions for token verification
    this.hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:GetUser',
        'cognito-idp:ListUsers',
      ],
      resources: [props.userPool.userPoolArn],
    }));

    // CloudWatch permissions for logging
    this.hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // Legacy hours routes
    const hoursRes = this.api.root.addResource('hours');
    hoursRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }] 
    });
    hoursRes.addMethod('POST', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }] 
    });
    
    const hoursIdRes = hoursRes.addResource('{clinicId}');
    hoursIdRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] 
    });
    hoursIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }] 
    });
    hoursIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }] 
    });

    // New format clinic hours routes
    const clinicsRes = this.api.root.addResource('clinics');
    const clinicIdRes = clinicsRes.addResource('{clinicId}');
    const clinicHoursRes = clinicIdRes.addResource('hours');
    
    clinicHoursRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] 
    });
    clinicHoursRes.addMethod('PUT', new apigw.LambdaIntegration(this.hoursCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }] 
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'ClinicHoursApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'clinic-hours',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ClinicHoursTableName', {
      value: this.clinicHoursTable.tableName,
      description: 'Name of the Clinic Hours DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ClinicHoursTableName`,
    });

    new CfnOutput(this, 'ClinicHoursApiUrl', {
      value: 'https://api.todaysdentalinsights.com/clinic-hours/',
      description: 'Clinic Hours API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ClinicHoursApiUrl`,
    });

    new CfnOutput(this, 'ClinicHoursApiId', {
      value: this.api.restApiId,
      description: 'Clinic Hours API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ClinicHoursApiId`,
    });
  }
}
