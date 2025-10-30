import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface ChimeStackProps extends StackProps {
  userPool: any;
  api?: apigw.RestApi;
  authorizer?: apigw.CognitoUserPoolsAuthorizer;
}

export class ChimeStack extends Stack {
  public readonly clinicsTable: dynamodb.Table;
  public readonly agentPresenceTable: dynamodb.Table;
  public readonly callQueueTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ChimeStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. DynamoDB Tables
    // ========================================

    // Clinics table (holds Chime meeting info per clinic)
    this.clinicsTable = new dynamodb.Table(this, 'ClinicsTable', {
      tableName: `${this.stackName}-Clinics`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });


    // Agent Presence table
    this.agentPresenceTable = new dynamodb.Table(this, 'AgentPresenceTable', {
      tableName: `${this.stackName}-AgentPresence`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // GSI for querying by clinic

    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });


    // Call Queue table
    this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
      tableName: `${this.stackName}-CallQueue`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queuePosition', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying by callId
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'callId-index',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // 2. Chime SIP Media Application
    // ========================================

    // Lambda for SIP Media Application
    const smaHandler = new lambdaNode.NodejsFunction(this, 'SmaHandler', {
      functionName: `${this.stackName}-SmaHandler`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'inbound-router.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        HOLD_MUSIC_BUCKET: '', // Will be updated after bucket creation
      },
    });

    // Grant DynamoDB permissions
    this.clinicsTable.grantReadData(smaHandler);
    this.agentPresenceTable.grantReadWriteData(smaHandler);
    this.callQueueTable.grantReadWriteData(smaHandler);

    // Grant Chime SDK permissions
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // SIP Media Application actions
        'chime:CreateSipMediaApplicationCall',
        'chime:UpdateSipMediaApplicationCall',
        // Include both old namespace and new namespace for meetings
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        // SDK meetings namespace
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
      ],
      resources: ['*'],
    }));

    // Create S3 bucket for hold music
    const holdMusicBucket = new s3.Bucket(this, 'HoldMusicBucket', {
      bucketName: `${this.stackName.toLowerCase()}-hold-music-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Grant read access to the SMA handler
    holdMusicBucket.grantRead(smaHandler);

    // Update the environment variable
    smaHandler.addEnvironment('HOLD_MUSIC_BUCKET', holdMusicBucket.bucketName);

    // Create the SIP Media Application
    const sipMediaApp = new customResources.AwsCustomResource(this, 'SipMediaApp', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createSipMediaApplication',
        parameters: {
          Name: `${this.stackName}-SMA`,
          AwsRegion: this.region,
          Endpoints: [{
            LambdaArn: smaHandler.functionArn,
          }],
        },
        physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipMediaApplication.SipMediaApplicationId'),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteSipMediaApplication',
        parameters: {
          SipMediaApplicationId: customResources.PhysicalResourceId.fromResponse('SipMediaApplication.SipMediaApplicationId'),
        },
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateSipMediaApplication',
            'chime:DeleteSipMediaApplication',
          ],
          resources: ['*'],
        }),
        // Allow the custom resource to read/add the Lambda resource policy for the SMA handler
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:GetPolicy',
            'lambda:AddPermission',
          ],
          resources: [smaHandler.functionArn],
        }),
      ]),
    });

    // Grant Lambda permission for SMA to invoke
    smaHandler.addPermission('AllowSMAInvoke', {
      principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      sourceAccount: this.account,
    });

    // Create Voice Connector
    const voiceConnector = new customResources.AwsCustomResource(this, 'VoiceConnector', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createVoiceConnector',
        parameters: {
          Name: `${this.stackName}-VC`,
          RequireEncryption: true,
          AwsRegion: this.region,
        },
        physicalResourceId: customResources.PhysicalResourceId.fromResponse('VoiceConnector.VoiceConnectorId'),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteVoiceConnector',
        parameters: {
          VoiceConnectorId: customResources.PhysicalResourceId.fromResponse('VoiceConnector.VoiceConnectorId'),
        },
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateVoiceConnector',
            'chime:DeleteVoiceConnector',
          ],
          resources: ['*'],
        }),
      ]),
    });

    // Create SIP Rule to connect Voice Connector to SMA
    const sipRule = new customResources.AwsCustomResource(this, 'SipRule', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createSipRule',
        parameters: {
          Name: `${this.stackName}-SipRule`,
          TriggerType: 'RequestUriHostname',
          TriggerValue: voiceConnector.getResponseField('VoiceConnector.OutboundHostName'),
          TargetApplications: [{
            SipMediaApplicationId: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
            Priority: 1,
            AwsRegion: this.region,
          }],
        },
        physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteSipRule',
        parameters: {
          SipRuleId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
        },
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateSipRule',
            'chime:DeleteSipRule',
          ],
          resources: ['*'],
        }),
      ]),
    });

    // Make sure SIP Rule is created after both Voice Connector and SMA
    sipRule.node.addDependency(voiceConnector);
    sipRule.node.addDependency(sipMediaApp);

    // ========================================
    // 3. Lambda Functions
    // ========================================

    // Shared Chime SDK policy for meeting operations
    const chimeSdkPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Include both old namespace and new namespace for compatibility
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteAttendee',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
        // SDK meetings namespace
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
        'chime-sdk-meetings:GetMeeting',
        'chime-sdk-meetings:ListAttendees',
        'chime-sdk-meetings:DeleteAttendee',
        'chime-sdk-meetings:StartMeetingTranscription',
        'chime-sdk-meetings:StopMeetingTranscription',
      ],
      resources: ['*'],
    });

    // Cognito policy for user lookup
    const cognitoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
      ],
      resources: [props.userPool.userPoolArn],
    });

    // Lambda for POST /chime/start-session
    const startSessionFn = new lambdaNode.NodejsFunction(this, 'StartSessionFn', {
      functionName: `${this.stackName}-StartSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'start-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    // Ensure a LogGroup exists for the Lambda so we can attach metric filters and retention
    const startSessionLogGroup = new logs.LogGroup(this, 'StartSessionLogGroup', {
      logGroupName: `/aws/lambda/${startSessionFn.functionName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Metric filter to count error lines in the Lambda logs
    new logs.MetricFilter(this, 'StartSessionErrorMetricFilter', {
      logGroup: startSessionLogGroup,
      metricNamespace: 'Chime',
      metricName: 'StartSessionErrors',
      filterPattern: logs.FilterPattern.anyTerm('ERROR', 'Error', 'Exception'),
      metricValue: '1',
    });

    // Alarm when there is at least 1 error in a 5-minute window
    new cloudwatch.Alarm(this, 'StartSessionErrorAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Chime',
        metricName: 'StartSessionErrors',
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarm when StartSession Lambda emits errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    startSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(startSessionFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    startSessionFn.addPermission('AdminApiInvokeStartSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/stop-session
    const stopSessionFn = new lambdaNode.NodejsFunction(this, 'StopSessionFn', {
      functionName: `${this.stackName}-StopSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'stop-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
      },
    });
    stopSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(stopSessionFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    stopSessionFn.addPermission('AdminApiInvokeStopSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/outbound-call
    const outboundCallFn = new lambdaNode.NodejsFunction(this, 'OutboundCallFn', {
      functionName: `${this.stackName}-OutboundCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'outbound-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        VOICE_CONNECTOR_ID: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    outboundCallFn.addToRolePolicy(cognitoPolicy);
    this.agentPresenceTable.grantReadWriteData(outboundCallFn);
    this.clinicsTable.grantReadData(outboundCallFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    outboundCallFn.addPermission('AdminApiInvokeOutboundCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    // Grant permission to make outbound calls
    outboundCallFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:CreateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`],
    }));

    // Lambda for POST /chime/transfer-call
    const transferCallFn = new lambdaNode.NodejsFunction(this, 'TransferCallFn', {
      functionName: `${this.stackName}-TransferCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'transfer-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
      },
    });
    this.agentPresenceTable.grantReadWriteData(transferCallFn);
    this.callQueueTable.grantReadWriteData(transferCallFn);
    
    // Grant permission to update SIP Media Application calls
    transferCallFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['chime:UpdateSipMediaApplicationCall'],
        resources: ['*'],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    transferCallFn.addPermission('AdminApiInvokeTransferCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-accepted
    const callAcceptedFn = new lambdaNode.NodejsFunction(this, 'CallAcceptedFn', {
      functionName: `${this.stackName}-CallAccepted`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-accepted.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
      },
    });
    this.agentPresenceTable.grantReadWriteData(callAcceptedFn);
    this.callQueueTable.grantReadWriteData(callAcceptedFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    callAcceptedFn.addPermission('AdminApiInvokeCallAccepted', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-rejected
    const callRejectedFn = new lambdaNode.NodejsFunction(this, 'CallRejectedFn', {
      functionName: `${this.stackName}-CallRejected`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-rejected.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
      },
    });
    this.agentPresenceTable.grantReadWriteData(callRejectedFn);
    this.callQueueTable.grantReadWriteData(callRejectedFn);
    callRejectedFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    callRejectedFn.addPermission('AdminApiInvokeCallRejected', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-hungup
    const callHungupFn = new lambdaNode.NodejsFunction(this, 'CallHungupFn', {
      functionName: `${this.stackName}-CallHungup`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-hungup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
      },
    });
    this.agentPresenceTable.grantReadWriteData(callHungupFn);
    this.callQueueTable.grantReadWriteData(callHungupFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    callHungupFn.addPermission('AdminApiInvokeCallHungup', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // ========================================
    // 4. API Gateway Routes (deprecated - now handled by AdminStack)
    // ========================================
    
    // NOTE: API routes are now created in AdminStack to avoid circular dependencies.
    // The Lambda functions are exported via CfnOutput and imported by AdminStack.

    // ========================================
    // 5. Outputs
    // ========================================
    new CfnOutput(this, 'ClinicsTableName', {
      value: this.clinicsTable.tableName,
    });
    new CfnOutput(this, 'AgentPresenceTableName', {
      value: this.agentPresenceTable.tableName,
    });
     new CfnOutput(this, 'SipMediaApplicationId', {
      value: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
    });
    
    // Export Chime Lambda ARNs so other stacks (Admin) can import them and
    // create API integrations without creating a two-way construct reference.
    new CfnOutput(this, 'StartSessionFnArn', {
      value: startSessionFn.functionArn,
      exportName: `${this.stackName}-StartSessionArn`,
    });
    new CfnOutput(this, 'StopSessionFnArn', {
      value: stopSessionFn.functionArn,
      exportName: `${this.stackName}-StopSessionArn`,
    });
    new CfnOutput(this, 'OutboundCallFnArn', {
      value: outboundCallFn.functionArn,
      exportName: `${this.stackName}-OutboundCallArn`,
    });
    new CfnOutput(this, 'TransferCallFnArn', {
      value: transferCallFn.functionArn,
      exportName: `${this.stackName}-TransferCallArn`,
    });
    new CfnOutput(this, 'CallAcceptedFnArn', {
      value: callAcceptedFn.functionArn,
      exportName: `${this.stackName}-CallAcceptedArn`,
    });
    new CfnOutput(this, 'CallRejectedFnArn', {
      value: callRejectedFn.functionArn,
      exportName: `${this.stackName}-CallRejectedArn`,
    });
    new CfnOutput(this, 'CallHungupFnArn', {
      value: callHungupFn.functionArn,
      exportName: `${this.stackName}-CallHungupArn`,
    });
    new CfnOutput(this, 'AgentPresenceTableNameExport', {
      value: this.agentPresenceTable.tableName,
      exportName: `${this.stackName}-AgentPresenceTableName`,
    });
    new CfnOutput(this, 'HoldMusicBucketName', {
      value: holdMusicBucket.bucketName,
      description: 'S3 bucket for hold music. Upload a file named "hold-music.wav" to this bucket.',
    });

    }
  }