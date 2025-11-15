import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2'; // <-- UPDATED IMPORT
import * as apigw2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'; // <-- UPDATED IMPORT
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

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
  public readonly fileBucket: s3.Bucket;
  public readonly notificationsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: CommStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // 1. Connection Mapping Table (For WebSocket connections)
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `${this.stackName}-WsConnections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      // Optional: Add TTL for connection cleanup
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    // ** FIX: Add GSI for efficient user lookup by userID (required by ws-default.ts) **
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIDIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // 2. Favor Requests Table (Stores request metadata)
    this.favorsTable = new dynamodb.Table(this, 'FavorRequestsTable', {
      tableName: `${this.stackName}-FavorRequests`,
      // Partition Key: favorRequestID (UUID)
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      // Secondary Index: Query by user (sender or receiver)
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
      // Partition Key: favorRequestID (to group messages by favor)
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      // Sort Key: timestamp (to order messages chronologically)
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    // Global Secondary Index: To query all messages sent by a user
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'SenderIndex',
      partitionKey: { name: 'senderID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // S3 BUCKET (for File Sharing)
    // ========================================
    this.fileBucket = new s3.Bucket(this, 'CommunicationFilesBucket', {
      bucketName: `comm-files-${this.account}-${this.region}`,
      // Enable CORS for web uploads
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'], // Restrict this to your frontend domain in production!
          exposedHeaders: ['ETag'],
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN in production
      autoDeleteObjects: true,
    });

    // ========================================
    // PUSH NOTIFICATIONS (SNS Topic)
    // ========================================
    // This topic will be published to by the 'Default' Lambda when a new message arrives.
    // An external service (e.g., SES for emails, or a mobile platform) will subscribe to it.
    this.notificationsTopic = new sns.Topic(this, 'NewMessageNotificationsTopic', {
        topicName: `${this.stackName}-NewMessageNotifications`
    });

    // ========================================
    // LAMBDA FUNCTIONS (WebSocket Handlers)
    // ========================================

    const defaultLambdaEnv = {
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      MESSAGES_TABLE: this.messagesTable.tableName,
      FAVORS_TABLE: this.favorsTable.tableName,
      FILE_BUCKET_NAME: this.fileBucket.bucketName,
      NOTIFICATIONS_TOPIC_ARN: this.notificationsTopic.topicArn,
    };

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
      environment: defaultLambdaEnv,
    });

    // Grant permissions to the Default Lambda
    this.connectionsTable.grantReadWriteData(defaultFn); // Read to find receiver's connectionId, Write to update
    this.messagesTable.grantReadWriteData(defaultFn);
    this.favorsTable.grantReadWriteData(defaultFn);
    this.fileBucket.grantReadWrite(defaultFn); // For generating signed URLs
    this.notificationsTopic.grantPublish(defaultFn); // For push notifications

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
      // Note: No $default route is explicitly needed here if using the DefaultRoute
    });

    new apigw2.WebSocketStage(this, this.stackName + 'ProdStage', { // Ensure unique stage ID
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
      exportName: `${this.stackName}-FileBucketName`,
    });
    new CfnOutput(this, 'NotificationsTopicArn', {
        value: this.notificationsTopic.topicArn,
        exportName: `${this.stackName}-NotificationsTopicArn`,
    });
  }
}