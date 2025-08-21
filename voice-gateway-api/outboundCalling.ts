import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Initialize AWS clients
const chimeVoice = new ChimeSDKVoiceClient({ region: process.env.AWS_REGION });
const chimeMeetings = new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const SIP_MEDIA_APPLICATION_ID = process.env.SIP_MEDIA_APPLICATION_ID!;
const AGENT_SESSIONS_TABLE = process.env.AGENT_SESSIONS_TABLE!;
const CALL_HISTORY_TABLE = process.env.CALL_HISTORY_TABLE!;

// Clinic phone number mapping for caller ID - loaded from environment variable
const CLINIC_PHONE_NUMBERS: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.CLINIC_CALLER_ID_MAP || '{}');
  } catch (error) {
    console.error('Failed to parse CLINIC_CALLER_ID_MAP:', error);
    return {};
  }
})();

interface OutboundCallRequest {
  phoneNumber: string;
  clinicId: string;
  agentId: string;
}

interface CallSession {
  callId: string;
  clinicId: string;
  agentId: string;
  callType: 'OUTBOUND';
  phoneNumber: string;
  state: 'INITIATED' | 'RINGING' | 'CONNECTED' | 'ENDED';
  startTime: number;
  connectTime?: number;
  endTime?: number;
  duration?: number;
  date: string;
  chimeCallId?: string;
  meetingId?: string;
  attendeeId?: string;
}

export async function initiateOutboundCall(request: OutboundCallRequest): Promise<{
  success: boolean;
  callId: string;
  meeting?: any;
  attendee?: any;
  error?: string;
}> {
  try {
    console.log('[OutboundCalling] Initiating call:', request);

    // Validate phone number format
    const cleanNumber = formatPhoneNumber(request.phoneNumber);
    if (!cleanNumber) {
      throw new Error('Invalid phone number format');
    }

    // Get caller ID for clinic
    const fromNumber = CLINIC_PHONE_NUMBERS[request.clinicId];
    if (!fromNumber) {
      throw new Error(`No phone number configured for clinic: ${request.clinicId}`);
    }

    // Generate call ID
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create Chime meeting for the agent
    const { meeting, attendee } = await createMeetingForOutboundCall(request.agentId, callId);

    // Create call session record
    const now = Date.now();
    const callSession: CallSession = {
      callId,
      clinicId: request.clinicId,
      agentId: request.agentId,
      callType: 'OUTBOUND',
      phoneNumber: cleanNumber,
      state: 'INITIATED',
      startTime: now,
      date: new Date(now).toISOString().split('T')[0],
      meetingId: meeting.MeetingId,
      attendeeId: attendee.AttendeeId,
    };

    await dynamodb.send(new PutCommand({
      TableName: CALL_HISTORY_TABLE,
      Item: callSession,
    }));

    // Update agent status to busy with meeting info
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId: request.agentId },
      UpdateExpression: 'SET #state = :state, #activeCallId = :callId, #meetingId = :meetingId, #attendeeId = :attendeeId',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#activeCallId': 'activeCallId',
        '#meetingId': 'meetingId',
        '#attendeeId': 'attendeeId',
      },
      ExpressionAttributeValues: {
        ':state': 'BUSY',
        ':callId': callId,
        ':meetingId': meeting.MeetingId,
        ':attendeeId': attendee.AttendeeId,
      },
    }));

    // Initiate actual phone call via Chime SDK Voice
    const chimeCallResponse = await chimeVoice.send(new CreateSipMediaApplicationCallCommand({
      FromPhoneNumber: fromNumber,
      ToPhoneNumber: cleanNumber,
      SipMediaApplicationId: SIP_MEDIA_APPLICATION_ID,
      SipHeaders: {
        'X-Call-ID': callId,
        'X-Agent-ID': request.agentId,
        'X-Clinic-ID': request.clinicId,
        'X-Call-Type': 'OUTBOUND',
      },
    }));

    // Update call session with Chime call ID
    if (chimeCallResponse.SipMediaApplicationCall?.TransactionId) {
      await dynamodb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #chimeCallId = :chimeCallId, #state = :state',
        ExpressionAttributeNames: {
          '#chimeCallId': 'chimeCallId',
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':chimeCallId': chimeCallResponse.SipMediaApplicationCall.TransactionId,
          ':state': 'RINGING',
        },
      }));
    }

    console.log('[OutboundCalling] Call initiated successfully:', {
      callId,
      chimeCallId: chimeCallResponse.SipMediaApplicationCall?.TransactionId,
    });

    return {
      success: true,
      callId,
      meeting,
      attendee,
    };

  } catch (error) {
    console.error('[OutboundCalling] Failed to initiate call:', error);
    return {
      success: false,
      callId: '',
      error: error instanceof Error ? error.message : 'Failed to initiate outbound call',
    };
  }
}

async function createMeetingForOutboundCall(agentId: string, callId: string): Promise<{
  meeting: any;
  attendee: any;
}> {
  // Create Chime meeting
  const meetingResponse = await chimeMeetings.send(new CreateMeetingCommand({
    ClientRequestToken: `${agentId}-${callId}`,
    ExternalMeetingId: `outbound-${callId}`,
    MediaRegion: 'us-east-1',
  }));

  // Create attendee for agent
  const attendeeResponse = await chimeMeetings.send(new CreateAttendeeCommand({
    MeetingId: meetingResponse.Meeting!.MeetingId!,
    ExternalUserId: agentId,
  }));

  return {
    meeting: meetingResponse.Meeting,
    attendee: attendeeResponse.Attendee,
  };
}

function formatPhoneNumber(phoneNumber: string): string | null {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Handle US numbers
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  } else if (cleaned.startsWith('+1') && cleaned.length === 12) {
    return cleaned;
  }
  
  // Handle international numbers (basic validation)
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }
  
  return null;
}

// SIP Media Application handler for outbound calls
export async function handleOutboundSipEvent(event: any): Promise<any> {
  try {
    console.log('[OutboundSIP] Received event:', JSON.stringify(event, null, 2));

    const { InvocationEventType, CallDetails } = event;
    const callId = CallDetails?.SipHeaders?.['X-Call-ID'];
    const agentId = CallDetails?.SipHeaders?.['X-Agent-ID'];
    const clinicId = CallDetails?.SipHeaders?.['X-Clinic-ID'];

    switch (InvocationEventType) {
      case 'NEW_OUTBOUND_CALL':
        return handleOutboundCallInitiated(callId, agentId, clinicId);
      
      case 'RINGING':
        return handleOutboundCallRinging(callId);
      
      case 'CALL_ANSWERED':
        return handleOutboundCallAnswered(callId, CallDetails);
      
      case 'HANGUP':
        return handleOutboundCallEnded(callId);
      
      default:
        console.log('[OutboundSIP] Unhandled event type:', InvocationEventType);
        return { SchemaVersion: event.SchemaVersion, Actions: [] };
    }

  } catch (error) {
    console.error('[OutboundSIP] Error handling event:', error);
    return {
      SchemaVersion: event.SchemaVersion,
      Actions: [{
        Type: 'Hangup',
        Parameters: {}
      }]
    };
  }
}

async function handleOutboundCallInitiated(callId: string, agentId: string, clinicId: string): Promise<any> {
  console.log('[OutboundSIP] Call initiated:', { callId, agentId, clinicId });
  
  // Play ringback tone to agent while call connects
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'PlayAudio',
        Parameters: {
          AudioSource: {
            Type: 'S3',
            BucketName: process.env.AUDIO_BUCKET || 'your-audio-bucket',
            Key: 'music/ringback-tone.wav'
          },
          PlaybackTerminators: ['#']
        }
      }
    ]
  };
}

async function handleOutboundCallRinging(callId: string): Promise<any> {
  console.log('[OutboundSIP] Call ringing:', callId);
  
  // Update call state to ringing
  if (callId) {
    try {
      await dynamodb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #state = :state',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':state': 'RINGING' },
      }));
    } catch (error) {
      console.error('[OutboundSIP] Failed to update call state to ringing:', error);
    }
  }
  
  return { SchemaVersion: '1.0', Actions: [] };
}

async function handleOutboundCallAnswered(callId: string, callDetails: any): Promise<any> {
  console.log('[OutboundSIP] Call answered:', callId);
  
  const connectTime = Date.now();
  
  // Update call state to connected
  if (callId) {
    try {
      await dynamodb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #state = :state, #connectTime = :connectTime',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#connectTime': 'connectTime',
        },
        ExpressionAttributeValues: {
          ':state': 'CONNECTED',
          ':connectTime': connectTime,
        },
      }));
    } catch (error) {
      console.error('[OutboundSIP] Failed to update call state to connected:', error);
    }
  }
  
  // Stop any audio playback and bridge the call
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'StopAudioPlayback',
        Parameters: {}
      }
    ]
  };
}

async function handleOutboundCallEnded(callId: string): Promise<any> {
  console.log('[OutboundSIP] Call ended:', callId);
  
  const endTime = Date.now();
  
  // Update call state and calculate duration
  if (callId) {
    try {
      const callResponse = await dynamodb.send(new GetCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId },
      }));
      
      if (callResponse.Item) {
        const call = callResponse.Item as CallSession;
        const duration = endTime - (call.connectTime || call.startTime);
        
        await dynamodb.send(new UpdateCommand({
          TableName: CALL_HISTORY_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #state = :state, #endTime = :endTime, #duration = :duration',
          ExpressionAttributeNames: {
            '#state': 'state',
            '#endTime': 'endTime',
            '#duration': 'duration',
          },
          ExpressionAttributeValues: {
            ':state': 'ENDED',
            ':endTime': endTime,
            ':duration': duration,
          },
        }));
        
        // Update agent status back to available
        if (call.agentId) {
          await dynamodb.send(new UpdateCommand({
            TableName: AGENT_SESSIONS_TABLE,
            Key: { agentId: call.agentId },
            UpdateExpression: 'SET #state = :state REMOVE #activeCallId, #meetingId, #attendeeId',
            ExpressionAttributeNames: {
              '#state': 'state',
              '#activeCallId': 'activeCallId',
              '#meetingId': 'meetingId',
              '#attendeeId': 'attendeeId',
            },
            ExpressionAttributeValues: {
              ':state': 'AVAILABLE',
            },
          }));
        }
      }
    } catch (error) {
      console.error('[OutboundSIP] Failed to update call end state:', error);
    }
  }
  
  return { SchemaVersion: '1.0', Actions: [] };
}
