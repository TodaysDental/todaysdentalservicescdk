import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface TemplatesStackProps extends StackProps {
  // No longer passing the function - will import via CloudFormation export
}

export class TemplatesStack extends Stack {
  public readonly templatesTable: dynamodb.Table;
  public readonly templatesFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: TemplatesStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.templatesTable = new dynamodb.Table(this, 'TemplatesTable', {
      partitionKey: { name: 'template_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-Templates`,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'TemplatesApi', {
      restApiName: 'TemplatesApi',
      description: 'Templates service API',
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

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    
    // Create a reference to the authorizer function
    const authorizerFn = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthorizerFn',
      authorizerFunctionArn
    );
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'TemplatesAuthorizer', {
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

    this.templatesFn = new lambdaNode.NodejsFunction(this, 'TemplatesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'templates.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: this.templatesTable.tableName,
      },
    });

    this.templatesTable.grantReadWriteData(this.templatesFn);

    // ========================================
    // API ROUTES
    // ========================================

    const templatesRes = this.api.root.addResource('templates');
    templatesRes.addMethod('GET', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    templatesRes.addMethod('POST', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const templateIdRes = templatesRes.addResource('{templateId}');
    templateIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    templateIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.templatesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'TemplatesApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'templates',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
      // NOTE: With basePath 'templates', API Gateway will route /templates/* to the Lambda.
      // The Lambda handler in templates.ts now normalizes the path for compatibility.
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'TemplatesTableName', {
      value: this.templatesTable.tableName,
      description: 'Name of the Templates DynamoDB table',
      exportName: `${Stack.of(this).stackName}-TemplatesTableName`,
    });

    new CfnOutput(this, 'TemplatesApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/templates/',
      description: 'Templates API Gateway URL',
      exportName: `${Stack.of(this).stackName}-TemplatesApiUrl`,
    });

    new CfnOutput(this, 'TemplatesApiId', {
      value: this.api.restApiId,
      description: 'Templates API Gateway ID',
      exportName: `${Stack.of(this).stackName}-TemplatesApiId`,
    });
  }
}
