import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2'; 
import * as apigw2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'; 
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface CommStackProps extends StackProps {
  // Required to authorize users against the existing Cognito User Pool
  userPoolArn: string;
  userPoolId: string;
}

export class CommStack extends Stack {
  public readonly websocketApi: apigw2.WebSocketApi;
  public readonly messagesTable: dynamodb.Table;
  public readonly favorsTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly teamsTable: dynamodb.Table; // <--- NEW TABLE PROPERTY
  public readonly fileBucket: s3.Bucket;
  public readonly notificationsTopic: sns.Topic;
  public readonly getFileFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: CommStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // 1. Connection Mapping Table (For WebSocket connections)
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `${this.stackName}-WsConnections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    // FIX: Add GSI for efficient user lookup by userID (required by ws-default.ts)
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIDIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // 2. Favor Requests Table (Stores request metadata)
    this.favorsTable = new dynamodb.Table(this, 'FavorRequestsTable', {
      tableName: `${this.stackName}-FavorRequests`,
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.favorsTable.addGlobalSecondaryIndex({
        indexName: 'SenderIndex',
        partitionKey: { name: 'senderID', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
    });
    this.favorsTable.addGlobalSecondaryIndex({
        indexName: 'ReceiverIndex',
        partitionKey: { name: 'receiverID', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
    });

    // 3. Messages Table (Stores each message in a separate row)
    this.messagesTable = new dynamodb.Table(this, 'MessagesTable', {
      tableName: `${this.stackName}-Messages`,
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'SenderIndex',
      partitionKey: { name: 'senderID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 4. Teams Table (Stores Group/Team Metadata) <--- NEW TABLE
    this.teamsTable = new dynamodb.Table(this, 'TeamsTable', {
        tableName: `${this.stackName}-Teams`,
        partitionKey: { name: 'teamID', type: dynamodb.AttributeType.STRING },
        // GSI: To look up teams by owner (e.g., "teams I manage")
        sortKey: { name: 'ownerID', type: dynamodb.AttributeType.STRING }, 
        removalPolicy: RemovalPolicy.RETAIN,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    // GSI: To look up teams a user is a member of (requires DynamoDB sets or a dedicated table/GSI for complex membership)
    // For simplicity, we will query/filter in the Lambda if we need 'teams a user is in' rather than adding a complex GSI here.


    // ========================================
    // S3 BUCKET (for File Sharing)
    // ========================================
    this.fileBucket = new s3.Bucket(this, 'CommunicationFilesBucket', {
      bucketName: `comm-files-${this.account}-${this.region}`,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'], // Restrict this to your frontend domain in production!
          exposedHeaders: ['ETag'],
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, 
      autoDeleteObjects: true,
    });

    // ========================================
    // PUSH NOTIFICATIONS (SNS Topic)
    // ========================================
    this.notificationsTopic = new sns.Topic(this, 'NewMessageNotificationsTopic', {
        topicName: `${this.stackName}-NewMessageNotifications`
    });

    // ========================================
    // LAMBDA FUNCTIONS (WebSocket Handlers & REST utility)
    // ========================================

    const defaultLambdaEnv = {
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      MESSAGES_TABLE: this.messagesTable.tableName,
      FAVORS_TABLE: this.favorsTable.tableName,
      TEAMS_TABLE: this.teamsTable.tableName, // <--- NEW ENVIRONMENT VARIABLE
      FILE_BUCKET_NAME: this.fileBucket.bucketName,
      NOTIFICATIONS_TOPIC_ARN: this.notificationsTopic.topicArn,
    };
    
    // ** S3 File Download Lambda Deployment (MOVED TO COMM/get-file.ts) **
    this.getFileFn = new lambdaNode.NodejsFunction(this, 'GetFileFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'comm', 'get-file.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
            FILE_BUCKET_NAME: this.fileBucket.bucketName, 
        },
    });

    // Grant S3 read permission (GetObject) to the Lambda to generate a Presigned GET URL
    this.fileBucket.grantRead(this.getFileFn);


    // $connect handler (for initial connection and authentication)
    const connectFn = new lambdaNode.NodejsFunction(this, 'WsConnectFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'ws-connect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(5),
      environment: {
        USER_POOL_ID: props.userPoolId,
        ...defaultLambdaEnv,
      },
    });
    this.connectionsTable.grantWriteData(connectFn);

    // $disconnect handler
    const disconnectFn = new lambdaNode.NodejsFunction(this, 'WsDisconnectFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'ws-disconnect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      environment: defaultLambdaEnv,
    });
    this.connectionsTable.grantWriteData(disconnectFn);

    // $default handler (main logic: send/receive messages, resolve)
    const defaultFn = new lambdaNode.NodejsFunction(this, 'WsDefaultFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'ws-default.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' }, 
      environment: {
          ...defaultLambdaEnv,
          SES_SOURCE_EMAIL: 'no-reply@todaysdentalinsights.com', 
          USER_POOL_ID: props.userPoolId, 
      },
    });

    // Grant permissions to the Default Lambda
    this.connectionsTable.grantReadWriteData(defaultFn);
    this.messagesTable.grantReadWriteData(defaultFn);
    this.favorsTable.grantReadWriteData(defaultFn);
    this.teamsTable.grantReadWriteData(defaultFn); // <--- GRANT PERMISSIONS TO NEW TABLE
    this.fileBucket.grantReadWrite(defaultFn);
    this.notificationsTopic.grantPublish(defaultFn);
    
    // CRITICAL NEW FEATURE: Grant SES SendEmail permissions
    defaultFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'], 
    }));
    
    // CRITICAL NEW FEATURE: Grant Cognito Read access to allow Lambda to look up recipient/sender email for SES
    defaultFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser'],
        resources: [props.userPoolArn],
    }));


    // Grant Lambda permission to use the AWS API Gateway Management API (for sending messages back to client)
    const apiGatewayManagementPolicy = new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
            `arn:aws:execute-api:${this.region}:${this.account}:*/@connections/*`,
        ],
    });
    defaultFn.addToRolePolicy(apiGatewayManagementPolicy);


    // ========================================
    // WEBSOCKET API GATEWAY
    // ========================================

    this.websocketApi = new apigw2.WebSocketApi(this, 'CommunicationApi', {
      apiName: `${this.stackName}-CommApi`,
      connectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('ConnectIntegration', connectFn),
      },
      disconnectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('DefaultIntegration', defaultFn),
      },
    });

    new apigw2.WebSocketStage(this, this.stackName + 'ProdStage', { 
      webSocketApi: this.websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant API Gateway permission to invoke Lambda handlers
    connectFn.addPermission('ApiGwInvokeConnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.websocketApi.arnForExecuteApi(),
    });
    disconnectFn.addPermission('ApiGwInvokeDisconnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.websocketApi.arnForExecuteApi(),
    });
    defaultFn.addPermission('ApiGwInvokeDefault', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.websocketApi.arnForExecuteApi(),
    });

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'TeamsTableName', { // <--- NEW TABLE NAME OUTPUT
        value: this.teamsTable.tableName,
        exportName: `${this.stackName}-TeamsTableName`,
    });
    new CfnOutput(this, 'WebSocketApiUrl', {
      value: this.websocketApi.apiEndpoint,
      description: 'The WebSocket API Endpoint',
      exportName: `${this.stackName}-WebSocketApiUrl`,
    });
    new CfnOutput(this, 'MessagesTableName', {
      value: this.messagesTable.tableName,
      exportName: `${this.stackName}-MessagesTableName`,
    });
    new CfnOutput(this, 'FavorsTableName', {
      value: this.favorsTable.tableName,
      exportName: `${this.stackName}-FavorsTableName`,
    });
    new CfnOutput(this, 'FileBucketName', {
      value: this.fileBucket.bucketName,
      exportName: `${this.stackName}-FileBucketName`
    });
    new CfnOutput(this, 'NotificationsTopicArn', {
        value: this.notificationsTopic.topicArn,
        exportName: `${this.stackName}-NotificationsTopicArn`,
    });
    new CfnOutput(this, 'FileDownloadFnArn', { 
        value: this.getFileFn.functionArn,
        description: 'ARN of the S3 Get File Download Lambda',
        exportName: `${this.stackName}-FileDownloadFnArn`,
    });
  }
}