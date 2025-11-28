import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ConsentFormDataStackProps extends StackProps {
  authorizer: apigw.RequestAuthorizer;
}

export class ConsentFormDataStack extends Stack {
  public readonly consentFormDataTable: dynamodb.Table;
  public readonly consentFormDataFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: ConsentFormDataStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.consentFormDataTable = new dynamodb.Table(this, 'ConsentFormDataTable', {
      // Use 'consent_form_id' as the partition key
      partitionKey: { name: 'consent_form_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Change to DESTROY for dev
      tableName: 'todaysdentalinsights-ConsentFormData-V1',
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ConsentFormDataApi', {
      restApiName: 'ConsentFormDataApi',
      description: 'Consent Form Data service API',
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
    
    // Add Gateway Responses for 4XX, 5XX, and UNAUTHORIZED
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

    // Setup Custom Authorizer
    this.authorizer = props.authorizer;

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.consentFormDataFn = new lambdaNode.NodejsFunction(this, 'ConsentFormDataFn', {
      // Point to the new handler file
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'consent-form-data.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: this.consentFormDataTable.tableName,
      },
    });

    // Grant Lambda permissions to R/W from the new table
    this.consentFormDataTable.grantReadWriteData(this.consentFormDataFn);

    // ========================================
    // API ROUTES
    // ========================================

    // Change resource path to 'consent-forms'
    const consentFormsRes = this.api.root.addResource('consent-forms');
    consentFormsRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    consentFormsRes.addMethod('POST', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const consentFormIdRes = consentFormsRes.addResource('{consentFormId}');
    
    // ADDED: GET method for a single item
    consentFormIdRes.addMethod('GET', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }], // Added 404
    });

    consentFormIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    consentFormIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.consentFormDataFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with 'consent-forms' base path
    new apigw.CfnBasePathMapping(this, 'ConsentFormDataApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'consent-forms',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ConsentFormDataTableName', {
      value: this.consentFormDataTable.tableName,
      description: 'Name of the Consent Form Data DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataTableName`,
    });

    new CfnOutput(this, 'ConsentFormDataApiUrl', {
      value: 'https://api.todaysdentalinsights.com/consent-forms/',
      description: 'Consent Form Data API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataApiUrl`,
    });

    new CfnOutput(this, 'ConsentFormDataApiId', {
      value: this.api.restApiId,
      description: 'Consent Form Data API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ConsentFormDataApiId`,
    });
  }
}

