import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ClinicPricingStackProps extends StackProps {
  // Authorizer imported via CloudFormation export
}

export class ClinicPricingStack extends Stack {
  public readonly clinicPricingTable: dynamodb.Table;
  public readonly pricingCrudFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: ClinicPricingStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.clinicPricingTable = new dynamodb.Table(this, 'ClinicPricingTable', {
      tableName: `${this.stackName}-ClinicPricing`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ClinicPricingApi', {
      restApiName: 'ClinicPricingApi',
      description: 'Clinic Pricing service API',
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
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'ClinicPricingAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.pricingCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicPricingCrudFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'pricingCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: { CLINIC_PRICING_TABLE: this.clinicPricingTable.tableName },
    });

    this.clinicPricingTable.grantReadWriteData(this.pricingCrudFn);

    // ========================================
    // API ROUTES
    // ========================================

    // Pricing routes under /clinics/{clinicId}/pricing
    const clinicsRes = this.api.root.addResource('clinics');
    const clinicIdRes = clinicsRes.addResource('{clinicId}');
    const pricingRes = clinicIdRes.addResource('pricing');
    
    pricingRes.addMethod('GET', new apigw.LambdaIntegration(this.pricingCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
    });
    pricingRes.addMethod('POST', new apigw.LambdaIntegration(this.pricingCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }]
    });
    pricingRes.addMethod('PUT', new apigw.LambdaIntegration(this.pricingCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '404' }]
    });
    pricingRes.addMethod('DELETE', new apigw.LambdaIntegration(this.pricingCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'ClinicPricingApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'clinic-pricing',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ClinicPricingTableName', {
      value: this.clinicPricingTable.tableName,
      description: 'Name of the Clinic Pricing DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ClinicPricingTableName`,
    });

    new CfnOutput(this, 'ClinicPricingApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/clinic-pricing/',
      description: 'Clinic Pricing API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ClinicPricingApiUrl`,
    });

    new CfnOutput(this, 'ClinicPricingApiId', {
      value: this.api.restApiId,
      description: 'Clinic Pricing API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ClinicPricingApiId`,
    });
  }
}
