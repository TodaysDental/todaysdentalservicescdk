import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface QueriesStackProps extends StackProps {
  userPool: any;
}

export class QueriesStack extends Stack {
  public readonly queriesTable: dynamodb.Table;
  public readonly queriesFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: QueriesStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================

    this.queriesTable = new dynamodb.Table(this, 'SqlQueriesTable', {
      partitionKey: { name: 'QueryName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'todaysdentalinsights-SQLQueries-V4',
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'QueriesApi', {
      restApiName: 'QueriesApi',
      description: 'Queries service API',
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

    this.queriesFn = new lambdaNode.NodejsFunction(this, 'QueriesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'queries.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: this.queriesTable.tableName,
      },
    });

    this.queriesTable.grantReadWriteData(this.queriesFn);

    // ========================================
    // API ROUTES
    // ========================================

    const queriesRes = this.api.root.addResource('queries');
    queriesRes.addMethod('GET', new apigw.LambdaIntegration(this.queriesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    queriesRes.addMethod('POST', new apigw.LambdaIntegration(this.queriesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const queryNameRes = queriesRes.addResource('{queryName}');
    queryNameRes.addMethod('GET', new apigw.LambdaIntegration(this.queriesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });
    queryNameRes.addMethod('PUT', new apigw.LambdaIntegration(this.queriesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    queryNameRes.addMethod('DELETE', new apigw.LambdaIntegration(this.queriesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'QueriesApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'queries',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'QueriesTableName', {
      value: this.queriesTable.tableName,
      description: 'Name of the Queries DynamoDB table',
      exportName: `${Stack.of(this).stackName}-QueriesTableName`,
    });

    new CfnOutput(this, 'QueriesApiUrl', {
      value: 'https://api.todaysdentalinsights.com/queries/',
      description: 'Queries API Gateway URL',
      exportName: `${Stack.of(this).stackName}-QueriesApiUrl`,
    });

    new CfnOutput(this, 'QueriesApiId', {
      value: this.api.restApiId,
      description: 'Queries API Gateway ID',
      exportName: `${Stack.of(this).stackName}-QueriesApiId`,
    });
  }
}
