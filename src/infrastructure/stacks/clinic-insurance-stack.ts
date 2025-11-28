import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ClinicInsuranceStackProps extends StackProps {
  authorizer: apigw.RequestAuthorizer;
}

export class ClinicInsuranceStack extends Stack {
  public readonly clinicInsuranceTable: dynamodb.Table;
  public readonly insuranceCrudFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: ClinicInsuranceStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.clinicInsuranceTable = new dynamodb.Table(this, 'ClinicInsuranceTable', {
      tableName: 'todaysdentalinsights-ClinicInsurance-V3',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'insuranceProvider_planName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ClinicInsuranceApi', {
      restApiName: 'ClinicInsuranceApi',
      description: 'Clinic Insurance service API',
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

    this.authorizer = props.authorizer;

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.insuranceCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicInsuranceCrudFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'insuranceCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: { CLINIC_INSURANCE_TABLE: this.clinicInsuranceTable.tableName },
    });

    this.clinicInsuranceTable.grantReadWriteData(this.insuranceCrudFn);

    // ========================================
    // API ROUTES
    // ========================================

    // Insurance routes under /clinics/{clinicId}/insurance
    const clinicsRes = this.api.root.addResource('clinics');
    const clinicIdRes = clinicsRes.addResource('{clinicId}');
    const insuranceRes = clinicIdRes.addResource('insurance');
    
    insuranceRes.addMethod('GET', new apigw.LambdaIntegration(this.insuranceCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] 
    });
    insuranceRes.addMethod('POST', new apigw.LambdaIntegration(this.insuranceCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }] 
    });
    insuranceRes.addMethod('PUT', new apigw.LambdaIntegration(this.insuranceCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '404' }] 
    });
    insuranceRes.addMethod('DELETE', new apigw.LambdaIntegration(this.insuranceCrudFn), { 
      authorizer: this.authorizer, 
      authorizationType: apigw.AuthorizationType.COGNITO, 
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] 
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'ClinicInsuranceApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'clinic-insurance',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ClinicInsuranceTableName', {
      value: this.clinicInsuranceTable.tableName,
      description: 'Name of the Clinic Insurance DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ClinicInsuranceTableName`,
    });

    new CfnOutput(this, 'ClinicInsuranceApiUrl', {
      value: 'https://api.todaysdentalinsights.com/clinic-insurance/',
      description: 'Clinic Insurance API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ClinicInsuranceApiUrl`,
    });

    new CfnOutput(this, 'ClinicInsuranceApiId', {
      value: this.api.restApiId,
      description: 'Clinic Insurance API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ClinicInsuranceApiId`,
    });
  }
}
