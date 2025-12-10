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
  public readonly marketingPostsTable: dynamodb.Table;
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: MarketingStackProps) {
    super(scope, id, props);

    // 1. DynamoDB Tables
    this.marketingConfigTable = new dynamodb.Table(this, 'MarketingConfigTable', {
      tableName: 'MarketingConfig',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // NEW: Table for post history
    this.marketingPostsTable = new dynamodb.Table(this, 'MarketingPostsTable', {
      tableName: 'MarketingPosts',
      partitionKey: { name: 'postId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Add GSI for querying by clinicId
    this.marketingPostsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIdIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // 2. API Gateway
    this.api = new apigw.RestApi(this, 'MarketingApi', {
      restApiName: 'MarketingApi',
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'https://todaysdentalinsights.com',
        ],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
    });

    // 3. Authorizer Setup (FIXED)
    const authorizerFn = lambda.Function.fromFunctionArn(
      this, 
      'ImportedAuthFn', 
      props.authorizerFunctionArn
    );
    
    const authorizer = new apigw.RequestAuthorizer(this, 'MarketingAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.seconds(0),
    });

    // CRITICAL FIX: Grant API Gateway permission to invoke the Authorizer
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: props.authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: this.api.arnForExecuteApi('*'),
    });

    // 4. Environment Variables
    const envVars = {
      MARKETING_CONFIG_TABLE: this.marketingConfigTable.tableName,
      MARKETING_POSTS_TABLE: this.marketingPostsTable.tableName,
      AYRSHARE_API_KEY: process.env.AYRSHARE_API_KEY || 'YOUR_API_KEY_HERE',
    };

    // 5. Lambda Functions
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

    // 6. Grant Permissions
    this.marketingConfigTable.grantReadWriteData(managerFn);
    this.marketingConfigTable.grantReadData(publisherFn);
    this.marketingPostsTable.grantReadWriteData(publisherFn);

    // 7. API Routes
    const root = this.api.root;

    // /marketing/setup
    const setupRes = root.addResource('setup');
    setupRes.addMethod('POST', new apigw.LambdaIntegration(managerFn), { authorizer });
    setupRes.addMethod('DELETE', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/jwt
    const jwtRes = root.addResource('jwt');
    jwtRes.addMethod('GET', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/status
    const statusRes = root.addResource('status');
    statusRes.addMethod('GET', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/clinics
    const clinicsRes = root.addResource('clinics');
    clinicsRes.addMethod('GET', new apigw.LambdaIntegration(managerFn), { authorizer });

    // /marketing/post
    const postRes = root.addResource('post');
    postRes.addMethod('POST', new apigw.LambdaIntegration(publisherFn), { authorizer });
    postRes.addMethod('DELETE', new apigw.LambdaIntegration(publisherFn), { authorizer });

    // /marketing/history
    const historyRes = root.addResource('history');
    historyRes.addMethod('GET', new apigw.LambdaIntegration(publisherFn), { authorizer });

    // /marketing/analytics
    const analyticsRes = root.addResource('analytics');
    analyticsRes.addMethod('GET', new apigw.LambdaIntegration(publisherFn), { authorizer });

    // /marketing/stats
    const statsRes = root.addResource('stats');
    statsRes.addMethod('GET', new apigw.LambdaIntegration(publisherFn), { authorizer });

    // /marketing/comments
    const commentsRes = root.addResource('comments');
    commentsRes.addMethod('GET', new apigw.LambdaIntegration(publisherFn), { authorizer });
    
    const commentsReplyRes = commentsRes.addResource('reply');
    commentsReplyRes.addMethod('POST', new apigw.LambdaIntegration(publisherFn), { authorizer });

    // 8. Outputs
    new CfnOutput(this, 'MarketingApiUrl', {
      value: this.api.url,
      exportName: `${this.stackName}-ApiUrl`,
    });

    new CfnOutput(this, 'MarketingConfigTableName', {
      value: this.marketingConfigTable.tableName,
      exportName: `${this.stackName}-ConfigTableName`,
    });
  }
}