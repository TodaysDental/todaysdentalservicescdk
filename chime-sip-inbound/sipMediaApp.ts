import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ringMultipleAgents } from './multiAgentRing';

// Initialize AWS clients
const chimeVoice = new ChimeSDKVoiceClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const AGENT_SESSIONS_TABLE = process.env.AGENT_SESSIONS_TABLE!;
const VOICE_GATEWAY_API_URL = process.env.VOICE_GATEWAY_API_URL!;
const SIP_MEDIA_APPLICATION_ID = process.env.SIP_MEDIA_APPLICATION_ID!;
const PENDING_CALLS_TABLE = process.env.PENDING_CALLS_TABLE!;

interface ChimeSIPEvent {
  SchemaVersion: string;
  Sequence: number;
  InvocationEventType: 'NEW_INBOUND_CALL' | 'CALL_ANSWERED' | 'HANGUP' | 'RINGING';
  CallDetails: {
    TransactionId: string;
    AwsAccountId: string;
    AwsRegion: string;
    SipMediaApplicationId: string;
    Participants: Array<{
      CallId: string;
      ParticipantTag: string;
      To?: string;
      From?: string;
      Direction: 'Inbound' | 'Outbound';
      StartTimeInMilliseconds?: string;
      Status: 'Connected' | 'Disconnected';
    }>;
  };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[ChimeSIPHandler] Received event:', JSON.stringify(event, null, 2));

  try {
    const sipEvent: ChimeSIPEvent = JSON.parse(event.body || '{}');
    
    if (sipEvent.InvocationEventType === 'NEW_INBOUND_CALL') {
      return await handleNewInboundCall(sipEvent);
    } else if (sipEvent.InvocationEventType === 'CALL_ANSWERED') {
      return await handleCallAnswered(sipEvent);
    } else if (sipEvent.InvocationEventType === 'HANGUP') {
      return await handleCallHangup(sipEvent);
    }

    // Return empty actions for other event types
    return {
      statusCode: 200,
      body: JSON.stringify({
        SchemaVersion: sipEvent.SchemaVersion,
        Actions: []
      }),
    };

  } catch (error) {
    console.error('[ChimeSIPHandler] Error processing SIP event:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process SIP event' }),
    };
  }
};

async function handleNewInboundCall(sipEvent: ChimeSIPEvent): Promise<APIGatewayProxyResult> {
  const participant = sipEvent.CallDetails.Participants[0];
  const fromNumber = participant.From || 'Unknown';
  const toNumber = participant.To || 'Unknown';
  
  console.log(`[ChimeSIPHandler] New inbound call from ${fromNumber} to ${toNumber}`);
  
  // Determine clinic from the called number
  const clinicId = determineClinicFromNumber(toNumber);
  
  // Start multi-agent ring
  const ringResult = await ringMultipleAgents(fromNumber, clinicId, participant.CallId);
  
  if (!ringResult.success || ringResult.ringingAgents.length === 0) {
    // No agents available - play message and route to voicemail
    console.log('[ChimeSIPHandler] No agents available for ringing');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        SchemaVersion: sipEvent.SchemaVersion,
        Actions: [
          {
            Type: 'PlayAudio',
            Parameters: {
              AudioSource: {
                Type: 'S3',
                BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
                Key: 'messages/all-agents-busy.wav'
              }
            }
          },
          {
            Type: 'PlayAudio',
            Parameters: {
              AudioSource: {
                Type: 'S3',
                BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
                Key: 'messages/please-leave-message.wav'
              }
            }
          },
          {
            Type: 'RecordAudio',
            Parameters: {
              DurationInSeconds: 60,
              RecordingTerminators: ['#'],
              RecordingDestination: {
                Type: 'S3',
                BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
                Prefix: `voicemails/${clinicId}/`
              }
            }
          },
          {
            Type: 'PlayAudio',
            Parameters: {
              AudioSource: {
                Type: 'S3',
                BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
                Key: 'messages/thank-you-goodbye.wav'
              }
            }
          },
          {
            Type: 'Hangup',
            Parameters: {}
          }
        ]
      }),
    };
  }

  console.log(`[ChimeSIPHandler] Ringing ${ringResult.ringingAgents.length} agents:`, ringResult.ringingAgents);
  
  // Play connecting message while agents are being notified
  return {
    statusCode: 200,
    body: JSON.stringify({
      SchemaVersion: sipEvent.SchemaVersion,
      Actions: [
        {
          Type: 'PlayAudio',
          Parameters: {
            AudioSource: {
              Type: 'S3',
              BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
              Key: 'messages/connecting-please-wait.wav'
            }
          }
        },
        {
          Type: 'PlayAudio',
          Parameters: {
            AudioSource: {
              Type: 'S3',
              BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
              Key: 'music/gentle-hold-music.wav'
            },
            PlaybackTerminators: ['#', '*']
          }
        }
      ]
    }),
  };
}

async function handleCallAnswered(sipEvent: ChimeSIPEvent): Promise<APIGatewayProxyResult> {
  console.log('[ChimeSIPHandler] Call answered by agent');
  
  // Stop any ongoing audio playback and connect the call
  return {
    statusCode: 200,
    body: JSON.stringify({
      SchemaVersion: sipEvent.SchemaVersion,
      Actions: [
        {
          Type: 'StopAudioPlayback',
          Parameters: {}
        }
      ]
    }),
  };
}

async function handleCallHangup(sipEvent: ChimeSIPEvent): Promise<APIGatewayProxyResult> {
  const participant = sipEvent.CallDetails.Participants[0];
  
  // Notify voice gateway to end the call and cleanup meeting
  try {
    await fetch(`${VOICE_GATEWAY_API_URL}/voice-gateway/call/end-by-chime-id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <system-token>', // TODO: Implement system auth
      },
      body: JSON.stringify({
        chimeCallId: participant.CallId,
      }),
    });
  } catch (error) {
    console.error('[ChimeSIPHandler] Failed to notify voice gateway of hangup:', error);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      SchemaVersion: sipEvent.SchemaVersion,
      Actions: []
    }),
  };
}

function determineClinicFromNumber(toNumber: string): string {
  // Map your phone numbers to clinic IDs
  const phoneToClinicMap: Record<string, string> = {
    '+18334265894': 'dentistingreenville',
    '+18333975863': 'dentistinnewbritain',
    // Add more numbers as needed
  };

  return phoneToClinicMap[toNumber] || 'dentistingreenville'; // Default fallback
}

async function findAvailableAgent(clinicId: string): Promise<{ agentId: string } | null> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: AGENT_SESSIONS_TABLE,
      FilterExpression: '#clinicId = :clinicId AND #state = :state',
      ExpressionAttributeNames: {
        '#clinicId': 'clinicId',
        '#state': 'state',
      },
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':state': 'AVAILABLE',
      },
    }));

    const availableAgents = response.Items || [];
    
    if (availableAgents.length === 0) {
      return null;
    }

    // Return first available agent (implement round-robin, priority, etc. as needed)
    return { agentId: availableAgents[0].agentId };

  } catch (error) {
    console.error('[ChimeSIPHandler] Error finding available agent:', error);
    return null;
  }
}

async function assignCallToAgent(
  phoneNumber: string,
  clinicId: string,
  agentId: string,
  chimeCallId: string
): Promise<void> {
  try {
    const response = await fetch(`${VOICE_GATEWAY_API_URL}/voice-gateway/call/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <system-token>', // TODO: Implement system auth
      },
      body: JSON.stringify({
        phoneNumber,
        clinicId,
        assignedAgentId: agentId,
        chimeCallId, // Link to Chime call
      }),
    });

    if (!response.ok) {
      throw new Error(`Voice Gateway API error: ${response.status}`);
    }

    console.log('[ChimeSIPHandler] Successfully assigned call to agent:', agentId);

  } catch (error) {
    console.error('[ChimeSIPHandler] Error calling Voice Gateway:', error);
    throw error;
  }
}
