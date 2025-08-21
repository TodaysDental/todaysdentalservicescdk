import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface MultiAgentRingStackProps extends cdk.StackProps {
  agentSessionsTable: dynamodb.Table;
  callHistoryTable: dynamodb.Table;
  websocketConnectionsTable: dynamodb.Table;
  voiceGatewayApiUrl: string;
}

export class MultiAgentRingStack extends Construct {
  public readonly pendingCallsTable: dynamodb.Table;
  public readonly sipMediaApplicationHandler: lambda.Function;
  public readonly audioAssetsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: MultiAgentRingStackProps) {
    super(scope, id);

    // 1. Pending Calls Table for tracking multi-agent ring state
    this.pendingCallsTable = new dynamodb.Table(this, 'PendingCallsTable', {
      tableName: 'PendingCalls',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', // Auto-cleanup old calls
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add GSI for clinic-based queries
    this.pendingCallsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicStatusIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // 2. S3 Bucket for audio assets (ringtones, messages, hold music)
    this.audioAssetsBucket = new s3.Bucket(this, 'AudioAssetsBucket', {
      bucketName: `dental-voice-audio-assets-${cdk.Aws.ACCOUNT_ID}`,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // 3. SIP Media Application Handler Lambda
    this.sipMediaApplicationHandler = new lambda.Function(this, 'SipMediaAppHandler', {
      functionName: 'ChimeSipInboundHandler',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'sipMediaApp.handler',
      code: lambda.Code.fromAsset('chime-sip-inbound'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        AGENT_SESSIONS_TABLE: props.agentSessionsTable.tableName,
        CALL_HISTORY_TABLE: props.callHistoryTable.tableName,
        PENDING_CALLS_TABLE: this.pendingCallsTable.tableName,
        WEBSOCKET_CONNECTIONS_TABLE: props.websocketConnectionsTable.tableName,
        VOICE_GATEWAY_API_URL: props.voiceGatewayApiUrl,
        AUDIO_BUCKET: this.audioAssetsBucket.bucketName,
        AWS_REGION: cdk.Aws.REGION,
      },
    });

    // 4. Grant permissions to SIP handler
    
    // DynamoDB permissions
    props.agentSessionsTable.grantReadData(this.sipMediaApplicationHandler);
    props.callHistoryTable.grantReadWriteData(this.sipMediaApplicationHandler);
    this.pendingCallsTable.grantReadWriteData(this.sipMediaApplicationHandler);
    props.websocketConnectionsTable.grantReadData(this.sipMediaApplicationHandler);

    // S3 permissions for audio assets
    this.audioAssetsBucket.grantRead(this.sipMediaApplicationHandler);
    this.audioAssetsBucket.grantWrite(this.sipMediaApplicationHandler); // For voicemail recordings

    // Chime SDK Voice permissions
    this.sipMediaApplicationHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateSipMediaApplication',
        'chime:UpdateSipMediaApplication',
        'chime:DeleteSipMediaApplication',
        'chime:GetSipMediaApplication',
        'chime:ListSipMediaApplications',
        'chime:CreateSipRule',
        'chime:UpdateSipRule',
        'chime:DeleteSipRule',
        'chime:GetSipRule',
        'chime:ListSipRules',
      ],
      resources: ['*'],
    }));

    // Chime SDK Meetings permissions (for creating meetings when calls are answered)
    this.sipMediaApplicationHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:GetAttendee',
      ],
      resources: ['*'],
    }));

    // 5. Audio assets bucket is ready for use (upload audio files as needed)

    // 6. Output important values
    new cdk.CfnOutput(this, 'PendingCallsTableName', {
      value: this.pendingCallsTable.tableName,
      description: 'DynamoDB table for tracking pending multi-agent calls',
      exportName: 'PendingCallsTableName',
    });

    new cdk.CfnOutput(this, 'AudioAssetsBucketName', {
      value: this.audioAssetsBucket.bucketName,
      description: 'S3 bucket for voice system audio assets',
      exportName: 'AudioAssetsBucketName',
    });

    new cdk.CfnOutput(this, 'SipMediaAppHandlerArn', {
      value: this.sipMediaApplicationHandler.functionArn,
      description: 'Lambda function ARN for Chime SIP Media Application handler',
      exportName: 'SipMediaAppHandlerArn',
    });
  }

  // Helper method to create SIP Media Application (call this after deployment)
  public createSipMediaApplication(): void {
    // This would typically be done via AWS CLI or SDK after deployment
    // Example command:
    // aws chime-sdk-voice create-sip-media-application \
    //   --name "dental-inbound-calls" \
    //   --endpoints LambdaArn=${SipMediaAppHandlerArn}
  }
}

// Extension to add to existing API stack
export interface VoiceGatewayExtensionProps {
  pendingCallsTable: dynamodb.Table;
  audioAssetsBucket: s3.Bucket;
}

export function extendVoiceGatewayWithMultiRing(
  voiceGatewayFunction: lambda.Function,
  props: VoiceGatewayExtensionProps
): void {
  // Add pending calls table access to voice gateway
  props.pendingCallsTable.grantReadWriteData(voiceGatewayFunction);
  
  // Add audio bucket access for potential notification sounds
  props.audioAssetsBucket.grantRead(voiceGatewayFunction);

  // Update environment variables
  voiceGatewayFunction.addEnvironment('PENDING_CALLS_TABLE', props.pendingCallsTable.tableName);
  voiceGatewayFunction.addEnvironment('AUDIO_BUCKET', props.audioAssetsBucket.bucketName);
}
