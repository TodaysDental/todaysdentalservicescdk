import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';

export interface MarketingStackProps extends StackProps {
  authorizerFunctionArn: string; 
}

export class MarketingStack extends Stack {
  public readonly marketingConfigTable: dynamodb.Table;
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: MarketingStackProps) {
    super(scope, id, props);

    // 1. Table
    this.marketingConfigTable = new dynamodb.Table(this, 'MarketingConfigTable', {
      tableName: 'MarketingConfig',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // 2. Authorizer
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthFn', props.authorizerFunctionArn);
    const authorizer = new apigw.RequestAuthorizer(this, 'MarketingAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
    });

    // 3. Lambdas
    const envVars = {
        MARKETING_CONFIG_TABLE: this.marketingConfigTable.tableName,
        AYRSHARE_API_KEY: 'A7DD2620-39C046C1-ABAAA24C-64B16202',
    };

    const managerFn = new lambdaNode.NodejsFunction(this, 'MarketingManagerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'manager.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    const publisherFn = new lambdaNode.NodejsFunction(this, 'MarketingPublisherFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'publisher.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // 4. Permissions
    this.marketingConfigTable.grantReadWriteData(managerFn);
    this.marketingConfigTable.grantReadData(publisherFn);

    // 5. API Gateway
    this.api = new apigw.RestApi(this, 'MarketingApi', {
      restApiName: 'MarketingApi',
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://todaysdentalinsights.com'], // 'null' for local html testing
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Domain Mapping
    new apigw.CfnBasePathMapping(this, 'MarketingBasePathMapping', {
        domainName: 'apig.todaysdentalinsights.com',
        basePath: 'marketing',
        restApiId: this.api.restApiId,
        stage: this.api.deploymentStage.stageName,
    });

    const root = this.api.root; // Maps to /marketing via BasePath

    // /marketing/setup
    const setupRes = root.addResource('setup');
    setupRes.addMethod('POST', new apigw.LambdaIntegration(managerFn), { authorizer });
    setupRes.addMethod('DELETE', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/jwt
    const jwtRes = root.addResource('jwt');
    jwtRes.addMethod('GET', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/post
    const postRes = root.addResource('post');
    postRes.addMethod('POST', new apigw.LambdaIntegration(publisherFn), { authorizer });
  }
}