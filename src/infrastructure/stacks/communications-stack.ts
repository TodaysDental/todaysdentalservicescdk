import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export interface CommunicationsStackProps extends StackProps {
    userPool: any; // Cognito UserPool construct
    userPoolId: string;
    userPoolArn: string;
}

export class CommunicationsStack extends Stack {

  constructor(scope: Construct, id: string, props: CommunicationsStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. DYNAMODB TABLES & S3 BUCKET
    // ========================================

    // 1.1 Favors Requests (Metadata)
    const favorsRequestsTable = new dynamodb.Table(this, 'FavorsRequestsTable', {
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      tableName: `${this.stackName}-FavorsRequests`,
    });

    // 1.2 Favor Messages (History)
    const favorMessagesTable = new dynamodb.Table(this, 'FavorMessagesTable', {
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      tableName: `${this.stackName}-FavorMessages`,
    });

    // 1.3 Favors Connections (Real-time mapping)
    const favorsConnectionsTable = new dynamodb.Table(this, 'FavorsConnectionsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      tableName: `${this.stackName}-FavorsConnections`,
    });
    
    // 1.4 S3 Bucket for File Storage
    const fileBucket = new s3.Bucket(this, 'FavorFilesBucket', {
        versioned: false,
        publicReadAccess: false,
        removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN in production
        cors: [
          {
            allowedMethods: [s3.HttpMethods.PUT], // Allow client to PUT files
            allowedOrigins: ['*'], // Restrict this in production to your frontend domain
            allowedHeaders: ['*'],
            exposedHeaders: ['ETag'], // ETag is often required for clients
          },
        ],
    });


    // ========================================
    // 2. WEBSOCKET API & AUTHORIZER
    // ========================================

    const webSocketApi = new apigwv2.WebSocketApi(this, 'FavorsWebSocketApi', {
      apiName: `${this.stackName}-FavorsWS`,
      routeSelectionExpression: '$request.body.action', 
    });

    const webSocketStage = new apigwv2.WebSocketStage(this, 'ProdStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });
    
    // FINAL FIX: Using JWT configuration to bypass the 'userPoolArns' type error.
    const userPoolIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}`;

    const cfnAuthorizer = new apigwv2.CfnAuthorizer(this, 'CognitoAuthorizerCfn', {
        name: 'CognitoAuthorizer',
        identitySource: ['route.request.querystring.idtoken'],
        authorizerType: 'JWT', // Use 'JWT' type
        apiId: webSocketApi.apiId,
        
        // Pass Cognito details via the JWT configuration structure:
        jwtConfiguration: {
            audience: [props.userPool.userPoolClientId], // Required Audience (App Client ID)
            issuer: userPoolIssuer,
        },
    });


    // ========================================
    // 3. LAMBDA DEFINITIONS
    // ========================================

    const sharedEnvironment = {
      FAVORS_REQUESTS_TABLE: favorsRequestsTable.tableName,
      FAVOR_MESSAGES_TABLE: favorMessagesTable.tableName,
      FAVORS_CONNECTIONS_TABLE: favorsConnectionsTable.tableName,
      WEBSOCKET_ENDPOINT: webSocketStage.url.replace('wss://', 'https://'), 
      USER_POOL_ID: props.userPoolId,
      FILE_BUCKET_NAME: fileBucket.bucketName, // New S3 env var
    };

    const fnProps = {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        memorySize: 128,
        timeout: Duration.seconds(15),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: sharedEnvironment,
    };

    // System & Custom Handlers
    const connectFn = new lambdaNode.NodejsFunction(this, 'ConnectFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'connect.ts') });
    const disconnectFn = new lambdaNode.NodejsFunction(this, 'DisconnectFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'disconnect.ts') });
    const defaultFn = new lambdaNode.NodejsFunction(this, 'DefaultFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'default.ts') });
    const messageFn = new lambdaNode.NodejsFunction(this, 'MessageFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'message.ts') });
    const createRequestFn = new lambdaNode.NodejsFunction(this, 'CreateRequestFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'create-request.ts') });
    const resolveRequestFn = new lambdaNode.NodejsFunction(this, 'ResolveRequestFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'resolve-request.ts') });
    
    // File/History Handlers
    const uploadFileFn = new lambdaNode.NodejsFunction(this, 'UploadFileFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'upload-file.ts') });
    const historyFn = new lambdaNode.NodejsFunction(this, 'HistoryFn', { ...fnProps, entry: path.join(__dirname, '..', 'services', 'communications', 'history.ts') });


    // ========================================
    // 4. IAM PERMISSIONS & GRANTS
    // ========================================

    const allLambdas = [connectFn, disconnectFn, defaultFn, messageFn, createRequestFn, historyFn, resolveRequestFn, uploadFileFn];

    // DynamoDB Grants
    allLambdas.forEach(fn => {
        favorsConnectionsTable.grantReadWriteData(fn);
        favorsRequestsTable.grantReadWriteData(fn);
        favorMessagesTable.grantReadWriteData(fn);
    });

    // API Gateway Management API (PostToConnection) Grant - required for all Lambdas that push data
    const apiGwArn = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/*/*`;
    [messageFn, createRequestFn, historyFn, resolveRequestFn, uploadFileFn].forEach(fn => {
        fn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['execute-api:ManageConnections'],
            resources: [apiGwArn],
        }));
    });
    
    // Cognito Grants for user lookup
    [createRequestFn].forEach(fn => {
        fn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:AdminGetUser', 'cognito-idp:ListUsers'],
            resources: [props.userPoolArn],
        }));
    });

    // S3 Grants for Presigning and File Access
    // UploadFn generates the PUT presigned URL
    uploadFileFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'], 
        resources: [fileBucket.arnForObjects('*')],
    }));

    // HistoryFn generates the GET presigned URL
    historyFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [fileBucket.arnForObjects('*')],
    }));


    // ========================================
    // 5. ROUTE MAPPING
    // ========================================
    
    // --- L1 Integration and Route for $connect (Bypasses L2 Authorizer Type Errors) ---
    // 1. Define L1 Integration
    const connectIntegration = new apigwv2.CfnIntegration(this, 'ConnectIntegrationCfn', {
        apiId: webSocketApi.apiId,
        integrationType: 'AWS_PROXY',
        integrationUri: connectFn.functionArn,
        integrationMethod: 'POST',
        credentialsArn: connectFn.role?.roleArn,
        timeoutInMillis: 10000,
    });
    
    // 2. Define L1 Route, referencing the L1 Authorizer
    new apigwv2.CfnRoute(this, 'ConnectRouteCfn', {
        apiId: webSocketApi.apiId,
        routeKey: '$connect',
        operationName: 'ConnectRoute',
        target: `integrations/${connectIntegration.ref}`,
        authorizationType: 'CUSTOM',
        authorizerId: cfnAuthorizer.ref,
    });
    // --- END L1 ROUTE FIX ---


    // System Routes (L2 addRoute works fine without custom authorizer)
    webSocketApi.addRoute('$disconnect', { integration: new apigwv2integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn) });
    webSocketApi.addRoute('$default', { integration: new apigwv2integrations.WebSocketLambdaIntegration('DefaultIntegration', defaultFn) });

    // Custom Routes (Business Logic)
    webSocketApi.addRoute('sendMessage', { integration: new apigwv2integrations.WebSocketLambdaIntegration('MessageIntegration', messageFn) });
    webSocketApi.addRoute('createRequest', { integration: new apigwv2integrations.WebSocketLambdaIntegration('CreateReqIntegration', createRequestFn) });
    webSocketApi.addRoute('getHistory', { integration: new apigwv2integrations.WebSocketLambdaIntegration('HistoryIntegration', historyFn) });
    webSocketApi.addRoute('resolveRequest', { integration: new apigwv2integrations.WebSocketLambdaIntegration('ResolveReqIntegration', resolveRequestFn) });
    webSocketApi.addRoute('getUploadUrl', { integration: new apigwv2integrations.WebSocketLambdaIntegration('GetUploadUrlIntegration', uploadFileFn) });


    // ========================================
    // 6. OUTPUTS
    // ========================================

    new CfnOutput(this, 'WebSocketApiUrl', {
        value: webSocketStage.url,
        description: 'WebSocket API Endpoint URL',
    });
    
    new CfnOutput(this, 'FileBucketName', {
        value: fileBucket.bucketName,
        description: 'S3 Bucket for file storage',
    });
  }
}