import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, Tags, Fn } from 'aws-cdk-lib';
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
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

export interface CommStackProps extends StackProps {
  // Authorizer imported via CloudFormation export
  jwtSecret: string;

  /**
   * ARN of the shared Lambda authorizer function for REST API authentication
   */
  authorizerFunctionArn: string;

  // ========================================
  // PUSH NOTIFICATIONS INTEGRATION (from PushNotificationsStack)
  // ========================================
  /**
   * Device tokens table name for looking up registered mobile devices
   */
  deviceTokensTableName?: string;

  /**
   * Device tokens table ARN for IAM permissions
   */
  deviceTokensTableArn?: string;

  /**
   * Send push Lambda function ARN for invoking push notifications
   */
  sendPushFunctionArn?: string;
}

export class CommStack extends Stack {
  public readonly websocketApi: apigw2.WebSocketApi;
  public readonly messagesTable: dynamodb.Table;
  public readonly favorsTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly teamsTable: dynamodb.Table;
  public readonly meetingsTable: dynamodb.Table;
  public readonly callsTable: dynamodb.Table;
  public readonly auditLogsTable: dynamodb.Table;
  public readonly userPreferencesTable: dynamodb.Table;
  public readonly userTeamsTable: dynamodb.Table;
  public readonly channelsTable: dynamodb.Table;
  public readonly userStarredMessagesTable: dynamodb.Table;
  public readonly fileBucket: s3.Bucket;
  public readonly filesCdn: cloudfront.Distribution;
  public readonly notificationsTopic: sns.Topic;
  public readonly getFileFn: lambdaNode.NodejsFunction;
  public readonly restApi: apigw.RestApi;

  constructor(scope: Construct, id: string, props: CommStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Comm',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    const createLambdaErrorAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: fn.metricErrors({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: fn.metricThrottles({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaDurationAlarm = (fn: lambda.IFunction, name: string, thresholdMs: number) =>
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${name} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) =>
      new cloudwatch.Alarm(this, `${idSuffix}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: tableName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // 1. Connection Mapping Table (For WebSocket connections)
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTableV4', {
      tableName: `${this.stackName}-WsConnectionsV4`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    applyTags(this.connectionsTable, { Table: 'ws-connections' });

    // Original KEYS_ONLY GSI — kept so CloudFormation doesn't try to delete it in the same update.
    // TODO: Remove this GSI in a follow-up deploy after UserIDIndexV2 is active.
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIDIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // V2: ALL projection avoids double-read for presence/broadcast
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIDIndexV2',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 2. Favor Requests Table (Stores request metadata)
    // V5: Added CategoryIndex, CurrentAssigneeIndex, MainGroupChatIndex GSIs
    this.favorsTable = new dynamodb.Table(this, 'FavorRequestsTableN1', {
      tableName: `${this.stackName}-FavorRequestsN1`,
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    applyTags(this.favorsTable, { Table: 'favor-requests' });

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
    // GSI for team-based favor requests lookup
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'TeamIndex',
      partitionKey: { name: 'teamID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI for status-based queries (e.g., get all pending/completed tasks)
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI for category-based queries (uses SYSTEM_MODULES: HR, Accounting, Operations, Finance, Marketing, Legal, IT)
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI for current assignee lookup (for forwarded tasks)
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'CurrentAssigneeIndex',
      partitionKey: { name: 'currentAssigneeID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI for efficient main group chat lookup by teamID (fixes ScanCommand performance issue)
    this.favorsTable.addGlobalSecondaryIndex({
      indexName: 'MainGroupChatIndex',
      partitionKey: { name: 'teamID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'isMainGroupChat', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 3. Messages Table (Stores each message in a separate row)
    this.messagesTable = new dynamodb.Table(this, 'MessagesTableV4', {
      tableName: `${this.stackName}-MessagesV4`,
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    applyTags(this.messagesTable, { Table: 'messages' });
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'SenderIndex',
      partitionKey: { name: 'senderID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI for looking up messages by messageID (used by task status updates)
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'MessageIDIndex',
      partitionKey: { name: 'messageID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 4. Teams Table (Stores Group/Team Metadata)
    // NOTE: The table has a composite key (teamID + ownerID). Handler code uses
    // QueryCommand (not GetCommand) to look up teams by teamID alone, and includes
    // ownerID in UpdateCommand/DeleteCommand keys after fetching the team first.
    this.teamsTable = new dynamodb.Table(this, 'TeamsTableV4', {
      tableName: `${this.stackName}-TeamsV4`,
      partitionKey: { name: 'teamID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ownerID', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    applyTags(this.teamsTable, { Table: 'teams' });

    // 5. Meetings Table (Stores scheduled meetings for tasks/conversations)
    this.meetingsTable = new dynamodb.Table(this, 'MeetingsTableV4', {
      tableName: `${this.stackName}-MeetingsV4`,
      partitionKey: { name: 'meetingID', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    applyTags(this.meetingsTable, { Table: 'meetings' });
    // GSI: Lookup meetings by conversation/favor request
    this.meetingsTable.addGlobalSecondaryIndex({
      indexName: 'ConversationIndex',
      partitionKey: { name: 'conversationID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI: Lookup meetings by organizer
    this.meetingsTable.addGlobalSecondaryIndex({
      indexName: 'OrganizerIndex',
      partitionKey: { name: 'organizerID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI: Lookup meetings by status (scheduled, completed, cancelled)
    this.meetingsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 5b. Calls Table (Stores active/recent voice/video calls for in-app calling)
    // NOTE: Required by services/comm/enhanced-messaging-handlers.ts (CALLS_TABLE env var)
    this.callsTable = new dynamodb.Table(this, 'CallsTableV1', {
      tableName: `${this.stackName}-CallsV1`,
      partitionKey: { name: 'callID', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl', // auto-expire call sessions
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    applyTags(this.callsTable, { Table: 'calls' });

    // GSI for efficient caller-based lookups (replaces full-table ScanCommand)
    this.callsTable.addGlobalSecondaryIndex({
      indexName: 'CallerIndex',
      partitionKey: { name: 'callerID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for conversation-scoped call lookups
    this.callsTable.addGlobalSecondaryIndex({
      indexName: 'FavorRequestIndex',
      partitionKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 6. Audit Logs Table (for tracking all user actions)
    this.auditLogsTable = new dynamodb.Table(this, 'AuditLogsTableV1', {
      tableName: `${this.stackName}-AuditLogsV1`,
      partitionKey: { name: 'auditID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiryDate', // Auto-delete after 90 days
    });
    applyTags(this.auditLogsTable, { Table: 'audit-logs' });

    // GSI: Lookup audit logs by user
    this.auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'UserIDIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Lookup audit logs by resource
    this.auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'ResourceIndex',
      partitionKey: { name: 'resourceID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Lookup audit logs by action type
    this.auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'ActionIndex',
      partitionKey: { name: 'action', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 7. User Preferences Table (Stores user-specific settings: profile images, wallpaper, etc.)
    this.userPreferencesTable = new dynamodb.Table(this, 'UserPreferencesTableV1', {
      tableName: `${this.stackName}-UserPreferencesV1`,
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.userPreferencesTable, { Table: 'user-preferences' });

    // 8. User Teams Table (Denormalized lookup: userID → teamIDs to eliminate TEAMS_TABLE scans)
    // Written to whenever team membership changes; queried by fetchRequests, getConversations, listTeams.
    this.userTeamsTable = new dynamodb.Table(this, 'UserTeamsTableV1', {
      tableName: `${this.stackName}-UserTeamsV1`,
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'teamID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.userTeamsTable, { Table: 'user-teams' });

    // 9. Channels Table (Public/Private channels for messaging)
    // GSIs eliminate the full table scan in handleListChannels.
    this.channelsTable = new dynamodb.Table(this, 'ChannelsTableV1', {
      tableName: `${this.stackName}-ChannelsV1`,
      partitionKey: { name: 'channelID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.channelsTable, { Table: 'channels' });

    // GSI: Lookup channels by creator
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'CreatedByIndex',
      partitionKey: { name: 'createdBy', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: Lookup channels by archived status + type (avoids scan for listing)
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'IsArchivedTypeIndex',
      partitionKey: { name: 'isArchivedStr', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 10. User Starred Messages Table (denormalized lookup, eliminates Messages table scan)
    this.userStarredMessagesTable = new dynamodb.Table(this, 'UserStarredMessagesV1', {
      tableName: `${this.stackName}-UserStarredMessagesV1`,
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'starredAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.userStarredMessagesTable, { Table: 'user-starred-messages' });

    // GSI: Lookup starred messages by conversation
    this.userStarredMessagesTable.addGlobalSecondaryIndex({
      indexName: 'ConversationIndex',
      partitionKey: { name: 'userID', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'favorRequestID', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // S3 BUCKET (for File Sharing)
    // ========================================
    this.fileBucket = new s3.Bucket(this, 'CommunicationFilesBucket', {
      bucketName: `${this.stackName.toLowerCase()}-comm-files-${this.account}-${this.region}`,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'], // Restrict this to your frontend domain in production!
          exposedHeaders: ['ETag', 'Content-Length', 'Content-Type'],
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Enable public read access - objects can be accessed without authentication
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true, // Automatically adds a bucket policy for public read
    });
    applyTags(this.fileBucket, { Bucket: 'comm-files' });

    // ========================================
    // CLOUDFRONT CDN (for profile images and shared files)
    // ========================================
    this.filesCdn = new cloudfront.Distribution(this, 'FilesCdnDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.fileBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: new cloudfront.CachePolicy(this, 'FilesCachePolicy', {
          cachePolicyName: `${this.stackName}-FilesCachePolicy`,
          defaultTtl: Duration.hours(24),
          maxTtl: Duration.days(30),
          minTtl: Duration.minutes(1),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }),
      },
      comment: `${this.stackName} - CDN for profile images and shared files`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    applyTags(this.filesCdn, { CDN: 'comm-files' });

    // ========================================
    // PUSH NOTIFICATIONS (SNS Topic)
    // ========================================
    this.notificationsTopic = new sns.Topic(this, 'NewMessageNotificationsTopic', {
      topicName: `${this.stackName}-NewMessageNotifications`
    });
    applyTags(this.notificationsTopic, { Topic: 'comm-notifications' });

    // ========================================
    // LAMBDA FUNCTIONS (WebSocket Handlers & REST utility)
    // ========================================

    const defaultLambdaEnv = {
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      MESSAGES_TABLE: this.messagesTable.tableName,
      FAVORS_TABLE: this.favorsTable.tableName,
      TEAMS_TABLE: this.teamsTable.tableName,
      MEETINGS_TABLE: this.meetingsTable.tableName,
      CALLS_TABLE: this.callsTable.tableName,
      AUDIT_LOGS_TABLE: this.auditLogsTable.tableName,
      USER_PREFERENCES_TABLE: this.userPreferencesTable.tableName,
      USER_TEAMS_TABLE: this.userTeamsTable.tableName,
      CHANNELS_TABLE: this.channelsTable.tableName,
      USER_STARRED_MESSAGES_TABLE: this.userStarredMessagesTable.tableName,
      FILE_BUCKET_NAME: this.fileBucket.bucketName,
      FILES_CDN_DOMAIN: this.filesCdn.distributionDomainName,
      NOTIFICATIONS_TOPIC_ARN: this.notificationsTopic.topicArn,
      ...(props.deviceTokensTableName && { DEVICE_TOKENS_TABLE: props.deviceTokensTableName }),
      ...(props.sendPushFunctionArn && { SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn }),
    };

    // ** S3 File Download Lambda Deployment (MOVED TO COMM/get-file.ts) **
    this.getFileFn = new lambdaNode.NodejsFunction(this, 'GetFileFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'get-file.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: {
        FILE_BUCKET_NAME: this.fileBucket.bucketName,
        FILES_CDN_DOMAIN: this.filesCdn.distributionDomainName,
      },
    });
    applyTags(this.getFileFn, { Function: 'get-file' });

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
        JWT_SECRET: props.jwtSecret,
        ...defaultLambdaEnv,
      },
    });
    applyTags(connectFn, { Function: 'ws-connect' });
    this.connectionsTable.grantWriteData(connectFn);

    // $disconnect handler (also cleans up active calls for disconnected users)
    const disconnectFn = new lambdaNode.NodejsFunction(this, 'WsDisconnectFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'ws-disconnect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: defaultLambdaEnv,
    });
    applyTags(disconnectFn, { Function: 'ws-disconnect' });
    this.connectionsTable.grantReadWriteData(disconnectFn);
    this.callsTable.grantReadWriteData(disconnectFn);
    // Chime SDK permission to delete meetings on abrupt disconnect
    disconnectFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:DeleteMeeting'],
      resources: ['*'],
    }));

    // $default handler (main logic: send/receive messages, resolve)
    const defaultFn = new lambdaNode.NodejsFunction(this, 'WsDefaultFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'ws-default.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: {
        ...defaultLambdaEnv,
        SES_SOURCE_EMAIL: 'no-reply@todaysdentalinsights.com',
        STAFF_USER_TABLE: 'StaffUser',
      },
    });
    applyTags(defaultFn, { Function: 'ws-default' });

    // Provisioned concurrency to eliminate cold starts on the latency-critical WebSocket handler
    const defaultFnAlias = new lambda.Alias(this, 'WsDefaultFnLiveAlias', {
      aliasName: 'live',
      version: defaultFn.currentVersion,
      provisionedConcurrentExecutions: 2,
    });

    // Grant permissions to the Default Lambda
    this.connectionsTable.grantReadWriteData(defaultFn);
    this.messagesTable.grantReadWriteData(defaultFn);
    this.favorsTable.grantReadWriteData(defaultFn);
    this.teamsTable.grantReadWriteData(defaultFn);
    this.meetingsTable.grantReadWriteData(defaultFn);
    this.callsTable.grantReadWriteData(defaultFn);
    this.userPreferencesTable.grantReadWriteData(defaultFn);
    this.userTeamsTable.grantReadWriteData(defaultFn);
    this.channelsTable.grantReadWriteData(defaultFn);
    this.userStarredMessagesTable.grantReadWriteData(defaultFn);
    this.fileBucket.grantReadWrite(defaultFn);
    this.notificationsTopic.grantPublish(defaultFn);

    // CRITICAL: Grant SES SendEmail permissions (v1 + v2 API actions)
    defaultFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail', 'ses:SendBulkEmail', 'ses:SendTemplatedEmail'],
      resources: ['*'],
    }));

    // CRITICAL NEW FEATURE: Grant DynamoDB Read access to StaffUser table for email lookups
    defaultFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: ['arn:aws:dynamodb:*:*:table/StaffUser'],
    }));

    // ========================================
    // PUSH NOTIFICATIONS PERMISSIONS
    // ========================================
    // Grant permissions to read device tokens and invoke send-push Lambda
    if (props.deviceTokensTableArn) {
      defaultFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [
          props.deviceTokensTableArn,
          `${props.deviceTokensTableArn}/index/*`, // Include GSIs
        ],
      }));
    }

    if (props.sendPushFunctionArn) {
      defaultFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }


    // Grant Lambda permission to use the AWS API Gateway Management API (for sending messages back to client)
    const apiGatewayManagementPolicy = new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:*/@connections/*`,
      ],
    });
    defaultFn.addToRolePolicy(apiGatewayManagementPolicy);

    // ========================================
    // CHIME SDK MEETINGS PERMISSIONS (COMM CALLING)
    // ========================================
    // Required for services/comm/chime-meeting-manager.ts used by in-app voice/video calling
    defaultFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteMeeting',
      ],
      resources: ['*'],
    }));

    // ========================================
    // REST API HANDLER LAMBDA
    // ========================================
    const restApiHandler = new lambdaNode.NodejsFunction(this, 'RestApiHandler', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'rest-api-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: defaultLambdaEnv,
    });
    applyTags(restApiHandler, { Function: 'rest-api-handler' });

    // Provisioned concurrency to eliminate cold starts on the REST API handler
    const restApiAlias = new lambda.Alias(this, 'RestApiHandlerLiveAlias', {
      aliasName: 'live',
      version: restApiHandler.currentVersion,
      provisionedConcurrentExecutions: 2,
    });

    // Grant permissions to REST API handler
    this.connectionsTable.grantReadData(restApiHandler);
    this.messagesTable.grantReadWriteData(restApiHandler);
    this.favorsTable.grantReadWriteData(restApiHandler);
    this.teamsTable.grantReadWriteData(restApiHandler);
    this.meetingsTable.grantReadWriteData(restApiHandler);
    this.auditLogsTable.grantReadWriteData(restApiHandler);
    this.userPreferencesTable.grantReadWriteData(restApiHandler);
    this.userTeamsTable.grantReadWriteData(restApiHandler);
    this.channelsTable.grantReadData(restApiHandler);
    this.userStarredMessagesTable.grantReadWriteData(restApiHandler);

    // ========================================
    // CHIME SDK MEETINGS PERMISSIONS (MEETINGS JOIN)
    // ========================================
    // Required for scheduled meeting joins via REST (services/comm/chime-meeting-manager.ts)
    restApiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteMeeting',
      ],
      resources: ['*'],
    }));

    // Grant push notification permissions to REST API handler
    if (props.deviceTokensTableArn) {
      restApiHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:GetItem'],
        resources: [
          props.deviceTokensTableArn,
          `${props.deviceTokensTableArn}/index/*`,
        ],
      }));
    }
    if (props.sendPushFunctionArn) {
      restApiHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [props.sendPushFunctionArn],
      }));
    }

    // ========================================
    // DEADLINE REMINDER LAMBDA (Scheduled — Daily at 8 AM EST)
    // ========================================
    // Scans the FavorRequests (tasks) table for upcoming and overdue deadlines
    // and sends email reminders to the assigned users via SES.
    const deadlineReminderFn = new lambdaNode.NodejsFunction(this, 'DeadlineReminderFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'comm', 'deadline-reminder.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(120), // May need to scan many tasks and send emails
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: {
        FAVORS_TABLE: this.favorsTable.tableName,
        SES_SOURCE_EMAIL: 'no-reply@todaysdentalinsights.com',
        FRONTEND_URL: 'https://todaysdentalinsights.com',
      },
    });
    applyTags(deadlineReminderFn, { Function: 'deadline-reminder' });

    // Grant permissions: Read/Write favors table (scan + update reminder flags)
    this.favorsTable.grantReadWriteData(deadlineReminderFn);

    // Grant SES SendEmail permissions
    deadlineReminderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // Grant Cognito AdminGetUser permission for email lookups
    deadlineReminderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: ['*'], // User Pool ARN is dynamic / externally managed
    }));

    // CloudWatch alarms for Deadline Reminder Lambda
    createLambdaErrorAlarm(deadlineReminderFn, 'deadline-reminder');
    createLambdaThrottleAlarm(deadlineReminderFn, 'deadline-reminder');
    createLambdaDurationAlarm(deadlineReminderFn, 'deadline-reminder',
      Math.floor(Duration.seconds(120).toMilliseconds() * 0.8));

    // EventBridge cron rule: Runs EVERY HOUR for granular deadline reminders (1h, 12h, 18h, 24h)
    new events.Rule(this, 'DeadlineReminderSchedule', {
      ruleName: `${this.stackName}-DeadlineReminderHourly`,
      description: 'Triggers the Deadline Reminder Lambda hourly to check for upcoming/overdue tasks (1h, 12h, 18h, 24h intervals)',
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(deadlineReminderFn, {
        retryAttempts: 2,
      })],
    });

    // ========================================
    // REST API GATEWAY
    // ========================================
    this.restApi = new apigw.RestApi(this, 'CommRestApi', {
      restApiName: `${this.stackName}-CommRestApi`,
      description: 'REST API for Communication module - Tasks, Meetings, Groups',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        cachingEnabled: true,
        cacheClusterEnabled: true,
        cacheClusterSize: '0.5',
        cacheDataEncrypted: true,
      },
    });

    // ========================================
    // REST API AUTHORIZER
    // ========================================
    const authorizerFn = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthFn',
      props.authorizerFunctionArn
    );

    const authorizer = new apigw.RequestAuthorizer(this, 'CommAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.seconds(300),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: props.authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.restApi.restApiId}/authorizers/*`,
    });

    // Create Lambda integration for REST API — point at the provisioned-concurrency alias
    // to eliminate cold starts. Use allowTestInvoke: false to avoid 20KB policy limit.
    const restIntegration = new apigw.LambdaIntegration(restApiAlias, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      allowTestInvoke: false,
    });

    // Add a single catch-all permission for API Gateway to invoke the alias (avoids 20KB policy limit)
    restApiAlias.addPermission('ApiGatewayInvokePermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.restApi.arnForExecuteApi('*', '/*', '*'),
    });

    // API Resources
    const api = this.restApi.root.addResource('api');

    // Per-method cache settings for high-traffic read endpoints
    const cachedMethodOptions: apigw.MethodOptions = {
      authorizer,
      methodResponses: [{ statusCode: '200' }],
      requestParameters: {
        'method.request.header.Authorization': true,
      },
    };

    // /api/conversations endpoints
    const conversations = api.addResource('conversations');
    conversations.addMethod('GET', restIntegration, cachedMethodOptions);
    const conversationsFindOrCreate = conversations.addResource('find-or-create');
    conversationsFindOrCreate.addMethod('POST', restIntegration, { authorizer });
    const conversationsSearch = conversations.addResource('search');
    conversationsSearch.addMethod('GET', restIntegration, cachedMethodOptions);
    const conversationsProfiles = conversations.addResource('profiles');
    conversationsProfiles.addMethod('GET', restIntegration, cachedMethodOptions);
    const conversationById = conversations.addResource('{favorRequestID}');
    conversationById.addMethod('DELETE', restIntegration, { authorizer });
    const conversationComplete = conversationById.addResource('complete');
    conversationComplete.addMethod('GET', restIntegration, cachedMethodOptions);
    const conversationUserDetails = conversationById.addResource('user-details');
    conversationUserDetails.addMethod('GET', restIntegration, cachedMethodOptions);
    const conversationDeadline = conversationById.addResource('deadline');
    conversationDeadline.addMethod('PUT', restIntegration, { authorizer });

    // /api/tasks endpoints
    const tasks = api.addResource('tasks');
    tasks.addMethod('POST', restIntegration, { authorizer });
    const tasksByStatus = tasks.addResource('by-status');
    tasksByStatus.addMethod('GET', restIntegration, cachedMethodOptions);
    const tasksForwardHistory = tasks.addResource('forward-history');
    tasksForwardHistory.addMethod('GET', restIntegration, cachedMethodOptions);
    const tasksForwardedToMe = tasks.addResource('forwarded-to-me');
    tasksForwardedToMe.addMethod('GET', restIntegration, cachedMethodOptions);
    const tasksGroup = tasks.addResource('group');
    tasksGroup.addMethod('POST', restIntegration, { authorizer });
    const taskById = tasks.addResource('{taskID}');
    taskById.addMethod('PUT', restIntegration, { authorizer });  // General task update (title, desc, priority, etc.)
    const taskForward = taskById.addResource('forward');
    taskForward.addMethod('POST', restIntegration, { authorizer });
    const taskDeadline = taskById.addResource('deadline');
    taskDeadline.addMethod('PUT', restIntegration, { authorizer });
    const taskForwardById = taskForward.addResource('{forwardID}');
    const taskForwardRespond = taskForwardById.addResource('respond');
    taskForwardRespond.addMethod('POST', restIntegration, { authorizer });

    // /api/meetings endpoints
    const meetings = api.addResource('meetings');
    meetings.addMethod('GET', restIntegration, cachedMethodOptions);
    meetings.addMethod('POST', restIntegration, { authorizer });
    const meetingById = meetings.addResource('{meetingID}');
    meetingById.addMethod('PUT', restIntegration, { authorizer });
    meetingById.addMethod('DELETE', restIntegration, { authorizer });
    const meetingJoin = meetingById.addResource('join');
    meetingJoin.addMethod('POST', restIntegration, { authorizer });

    // /api/public/meetings/{meetingID}/join (guest join, no authorizer)
    const publicApi = api.addResource('public');
    const publicMeetings = publicApi.addResource('meetings');
    const publicMeetingById = publicMeetings.addResource('{meetingID}');
    const publicMeetingJoin = publicMeetingById.addResource('join');
    publicMeetingJoin.addMethod('POST', restIntegration);

    // /api/groups endpoints
    const groups = api.addResource('groups');
    groups.addMethod('GET', restIntegration, cachedMethodOptions);
    groups.addMethod('POST', restIntegration, { authorizer });
    const groupById = groups.addResource('{teamID}');
    groupById.addMethod('GET', restIntegration, cachedMethodOptions);
    groupById.addMethod('PUT', restIntegration, { authorizer });
    const groupMembers = groupById.addResource('members');
    groupMembers.addMethod('POST', restIntegration, { authorizer });
    const groupMemberById = groupMembers.addResource('{memberUserID}');
    groupMemberById.addMethod('DELETE', restIntegration, { authorizer });

    // /api/preferences endpoints (User Preferences — profile image, wallpaper, etc.)
    const preferences = api.addResource('preferences');
    preferences.addMethod('GET', restIntegration, cachedMethodOptions);   // Get own preferences
    preferences.addMethod('PUT', restIntegration, { authorizer });   // Save a preference
    const preferencesBatch = preferences.addResource('batch');
    preferencesBatch.addMethod('POST', restIntegration, { authorizer }); // Batch fetch (up to 100 users)
    const preferencesByUser = preferences.addResource('{userID}');
    preferencesByUser.addMethod('GET', restIntegration, cachedMethodOptions);

    // /api/audit-logs endpoints (Audit Trail)
    const auditLogs = api.addResource('audit-logs');
    auditLogs.addMethod('GET', restIntegration, cachedMethodOptions);
    const auditLogsByUser = auditLogs.addResource('user');
    auditLogsByUser.addMethod('GET', restIntegration, cachedMethodOptions);
    const auditLogsByResource = auditLogs.addResource('resource');
    const auditLogsByResourceId = auditLogsByResource.addResource('{resourceID}');
    auditLogsByResourceId.addMethod('GET', restIntegration, cachedMethodOptions);
    const auditLogsByAction = auditLogs.addResource('action');
    const auditLogsByActionName = auditLogsByAction.addResource('{action}');
    auditLogsByActionName.addMethod('GET', restIntegration, cachedMethodOptions);

    // CloudWatch alarms for REST API handler
    createLambdaErrorAlarm(restApiHandler, 'rest-api-handler');
    createLambdaThrottleAlarm(restApiHandler, 'rest-api-handler');
    createLambdaDurationAlarm(restApiHandler, 'rest-api-handler', Math.floor(Duration.seconds(30).toMilliseconds() * 0.8));


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
        integration: new apigw2Integrations.WebSocketLambdaIntegration('DefaultIntegration', defaultFnAlias),
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
    defaultFnAlias.addPermission('ApiGwInvokeDefault', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.websocketApi.arnForExecuteApi(),
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.getFileFn, name: 'get-file', durationMs: Math.floor(Duration.seconds(10).toMilliseconds() * 0.8) },
      { fn: connectFn, name: 'ws-connect', durationMs: Math.floor(Duration.seconds(5).toMilliseconds() * 0.8) },
      { fn: disconnectFn, name: 'ws-disconnect', durationMs: Math.floor(Duration.seconds(5).toMilliseconds() * 0.8) },
      { fn: defaultFn, name: 'ws-default', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.connectionsTable.tableName, 'ConnectionsTable');
    createDynamoThrottleAlarm(this.favorsTable.tableName, 'FavorsTable');
    createDynamoThrottleAlarm(this.messagesTable.tableName, 'MessagesTable');
    createDynamoThrottleAlarm(this.teamsTable.tableName, 'TeamsTable');
    createDynamoThrottleAlarm(this.meetingsTable.tableName, 'MeetingsTable');
    createDynamoThrottleAlarm(this.callsTable.tableName, 'CallsTable');
    createDynamoThrottleAlarm(this.auditLogsTable.tableName, 'AuditLogsTable');
    createDynamoThrottleAlarm(this.channelsTable.tableName, 'ChannelsTable');
    createDynamoThrottleAlarm(this.userStarredMessagesTable.tableName, 'UserStarredMessagesTable');

    // ========================================
    // CUSTOM DOMAIN MAPPING
    // ========================================
    // Map REST API to the shared custom domain: apig.todaysdentalinsights.com/comm
    new apigw.CfnBasePathMapping(this, 'CommRestApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'comm',
      restApiId: this.restApi.restApiId,
      stage: this.restApi.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'TeamsTableName', {
      value: this.teamsTable.tableName,
      exportName: `${this.stackName}-TeamsTableName`,
    });
    new CfnOutput(this, 'MeetingsTableName', {
      value: this.meetingsTable.tableName,
      exportName: `${this.stackName}-MeetingsTableName`,
    });
    new CfnOutput(this, 'AuditLogsTableName', {
      value: this.auditLogsTable.tableName,
      exportName: `${this.stackName}-AuditLogsTableName`,
    });
    new CfnOutput(this, 'WebSocketApiUrl', {
      value: this.websocketApi.apiEndpoint,
      description: 'The WebSocket API Endpoint',
      exportName: `${this.stackName}-WebSocketApiUrl`,
    });
    new CfnOutput(this, 'RestApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/comm/',
      description: 'The REST API Endpoint for Tasks, Meetings, Groups (Custom Domain)',
      exportName: `${this.stackName}-RestApiUrl`,
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
    new CfnOutput(this, 'FileBucketPublicUrl', {
      value: `https://${this.fileBucket.bucketName}.s3.${this.region}.amazonaws.com`,
      description: 'Public URL for the S3 bucket (files can be accessed directly)',
      exportName: `${this.stackName}-FileBucketPublicUrl`
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
    new CfnOutput(this, 'UserPreferencesTableName', {
      value: this.userPreferencesTable.tableName,
      exportName: `${this.stackName}-UserPreferencesTableName`,
    });
    new CfnOutput(this, 'UserTeamsTableName', {
      value: this.userTeamsTable.tableName,
      exportName: `${this.stackName}-UserTeamsTableName`,
    });
    new CfnOutput(this, 'FilesCdnDomain', {
      value: this.filesCdn.distributionDomainName,
      description: 'CloudFront CDN domain for profile images and shared files',
      exportName: `${this.stackName}-FilesCdnDomain`,
    });
    new CfnOutput(this, 'ChannelsTableName', {
      value: this.channelsTable.tableName,
      exportName: `${this.stackName}-ChannelsTableName`,
    });
    new CfnOutput(this, 'UserStarredMessagesTableName', {
      value: this.userStarredMessagesTable.tableName,
      exportName: `${this.stackName}-UserStarredMessagesTableName`,
    });
  }
}