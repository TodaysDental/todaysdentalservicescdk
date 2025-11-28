import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import clinicsJson from '../configs/clinics.json';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface CallbackStackProps extends StackProps {
  // Reference to custom authorizer
  authorizer: apigw.RequestAuthorizer;
}

export class CallbackStack extends Stack {
  public readonly callbackTablePrefix: string;
  public readonly callbackLambdaArn: string;

  constructor(scope: Construct, id: string, props: CallbackStackProps) {
    super(scope, id, props);

    // ===========================================
    // CALLBACK DYNAMODB TABLES
    // ===========================================
    
    // We'll create individual tables for each clinic using the existing pattern
    // Each clinic gets its own todaysdentalinsights-callback-{clinicId} table
    const tablePrefix = 'todaysdentalinsights-callback-';
    this.callbackTablePrefix = tablePrefix;

    // Create a sample/default table for clinics that don't have specific tables yet
    const defaultCallbackTable = new dynamodb.Table(this, 'DefaultCallbackTable', {
      tableName: 'todaysdentalinsights-callback-DefaultRequests-V3', // Updated to follow naming convention
      partitionKey: { name: 'RequestID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Note: Legacy RequestCallBacks_* tables may exist from previous deployments
    // Lambda will use the wildcard permissions to access both old and new naming patterns

    // Add GSI for efficient querying by creation date
    defaultCallbackTable.addGlobalSecondaryIndex({
      indexName: 'CreatedAtIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for status-based queries
    defaultCallbackTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex', 
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'calledBack', type: dynamodb.AttributeType.STRING },
    });

    // ===========================================
    // ENHANCED CALLBACK LAMBDA
    // ===========================================

    const callbackLambda = new lambdaNode.NodejsFunction(this, 'CallbackLambda', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'callBack.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        REGION: Stack.of(this).region,
        TABLE_PREFIX: tablePrefix,
        DEFAULT_TABLE: defaultCallbackTable.tableName,
        ALLOWED_ORIGINS: [
          'https://todaysdentalinsights.com',
          ...((clinicsJson as any[])
            .map(c => String((c as any).websiteLink))
            .filter(Boolean))
        ].join(','),
      },
    });

    this.callbackLambdaArn = callbackLambda.functionArn;

    // Grant permissions for all RequestCallBacks_* tables
    callbackLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem', 
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:Query'
      ],
      resources: [
        // New naming pattern
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-callback-*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-callback-*/index/*`,
        // Legacy naming pattern (backward compatibility)
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/RequestCallBacks_*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/RequestCallBacks_*/index/*`,
        // Default table
        defaultCallbackTable.tableArn,
        `${defaultCallbackTable.tableArn}/index/*`,
      ],
    }));

    // ===========================================
    // INDEPENDENT API GATEWAY FOR CALLBACKS
    // ===========================================

    // Create independent API Gateway for callbacks
    const callbackApi = new apigw.RestApi(this, 'CallbackApi', {
      restApiName: 'CallbackApi',
      description: 'Dedicated API for callback management',
      defaultCorsPreflightOptions: getCdkCorsConfig({
        allowHeaders: ['Content-Type', 'Origin', 'Accept', 'X-Requested-With']
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
      restApi: callbackApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: callbackApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: callbackApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    // Use the custom Lambda authorizer
    const authorizer = props.authorizer;

    // Create callback endpoints: /{clinicId}
    const callbackResource = callbackApi.root.addResource('{clinicId}');

    // Add specific methods
    callbackResource.addMethod('GET', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '404' }
      ],
    });

    callbackResource.addMethod('POST', new apigw.LambdaIntegration(callbackLambda), {
      // No auth required for POST (public callback creation)
      authorizationType: apigw.AuthorizationType.NONE,
      apiKeyRequired: false,
      methodResponses: [
        { statusCode: '201' },
        { statusCode: '400' },
        { statusCode: '500' }
      ],
    });

    callbackResource.addMethod('PUT', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '404' }
      ],
    });

    // ===========================================
    // CALLBACK MANAGEMENT API
    // ===========================================

    // Add admin endpoints for callback management
    const adminCallbackResource = callbackApi.root
      .addResource('admin')
      .addResource('callbacks');

    // List all callbacks across all clinics (admin only)
    adminCallbackResource.addMethod('GET', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // Bulk operations endpoint
    const bulkCallbackResource = adminCallbackResource.addResource('bulk');
    bulkCallbackResource.addMethod('POST', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ===========================================
    // OUTPUTS
    // ===========================================

    new CfnOutput(this, 'CallbackTablePrefix', {
      value: this.callbackTablePrefix,
      description: 'Prefix for callback DynamoDB tables',
      exportName: `${Stack.of(this).stackName}-CallbackTablePrefix`,
    });

    new CfnOutput(this, 'CallbackLambdaArn', {
      value: this.callbackLambdaArn,
      description: 'ARN of the callback Lambda function',
      exportName: `${Stack.of(this).stackName}-CallbackLambdaArn`,
    });

    new CfnOutput(this, 'DefaultCallbackTableName', {
      value: defaultCallbackTable.tableName,
      description: 'Name of the default callback table',
      exportName: `${Stack.of(this).stackName}-DefaultCallbackTableName`,
    });

    new CfnOutput(this, 'CallbackApiUrl', {
      value: callbackApi.url,
      description: 'URL of the dedicated callback API',
      exportName: `${Stack.of(this).stackName}-CallbackApiUrl`,
    });

    new CfnOutput(this, 'CallbackApiEndpoint', {
      value: `${callbackApi.url}callback/{clinicId}`,
      description: 'Callback API endpoint pattern',
      exportName: `${Stack.of(this).stackName}-CallbackApiEndpoint`,
    });

    // Map this API under the existing custom domain as /callback
    new apigw.CfnBasePathMapping(this, 'CallbackBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'callback',
      restApiId: callbackApi.restApiId,
      stage: callbackApi.deploymentStage.stageName,
    });
  }
}
