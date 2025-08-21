import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface OutboundCallingStackProps extends cdk.StackProps {
  sipMediaApplicationId: string;
  agentSessionsTable: dynamodb.Table;
  callHistoryTable: dynamodb.Table;
  audioAssetsBucket: s3.Bucket;
}

export class OutboundCallingStack extends Construct {
  public readonly outboundSipHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: OutboundCallingStackProps) {
    super(scope, id);

    // Create Lambda function for handling outbound SIP events
    this.outboundSipHandler = new lambda.Function(this, 'OutboundSipHandler', {
      functionName: 'ChimeOutboundSipHandler',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'outboundCalling.handleOutboundSipEvent',
      code: lambda.Code.fromAsset('voice-gateway-api'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SIP_MEDIA_APPLICATION_ID: props.sipMediaApplicationId,
        AGENT_SESSIONS_TABLE: props.agentSessionsTable.tableName,
        CALL_HISTORY_TABLE: props.callHistoryTable.tableName,
        AUDIO_BUCKET: props.audioAssetsBucket.bucketName,
        AWS_REGION: cdk.Aws.REGION,
      },
    });

    // Grant DynamoDB permissions
    props.agentSessionsTable.grantReadWriteData(this.outboundSipHandler);
    props.callHistoryTable.grantReadWriteData(this.outboundSipHandler);

    // Grant S3 permissions for audio files
    props.audioAssetsBucket.grantRead(this.outboundSipHandler);

    // Grant Chime SDK Voice permissions
    this.outboundSipHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateSipMediaApplicationCall',
        'chime:GetSipMediaApplication',
        'chime:UpdateSipMediaApplicationCall',
        'chime:DeleteSipMediaApplicationCall',
      ],
      resources: ['*'],
    }));

    // Grant Chime SDK Meetings permissions
    this.outboundSipHandler.addToRolePolicy(new iam.PolicyStatement({
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

    // Output the function ARN for SIP Media Application configuration
    new cdk.CfnOutput(this, 'OutboundSipHandlerArn', {
      value: this.outboundSipHandler.functionArn,
      description: 'Lambda function ARN for outbound SIP handling',
      exportName: 'OutboundSipHandlerArn',
    });
  }
}

// Helper function to extend Voice Gateway with outbound calling
export function extendVoiceGatewayWithOutbound(
  voiceGatewayFunction: lambda.Function,
  outboundStack: OutboundCallingStack
): void {
  // Add environment variables for outbound calling
  voiceGatewayFunction.addEnvironment('OUTBOUND_SIP_HANDLER_ARN', outboundStack.outboundSipHandler.functionArn);
  
  // Grant permission to invoke outbound SIP handler
  outboundStack.outboundSipHandler.grantInvoke(voiceGatewayFunction);
}
