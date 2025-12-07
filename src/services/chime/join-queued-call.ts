import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;

/**
 * JOIN QUEUED CALL
 * 
 * Allows an agent or supervisor to manually pick up a call waiting in queue.
 * 
 * Features:
 * - Manual call assignment to specific agent
 * - Priority override for supervisors
 * - Automatic meeting creation and bridging
 * 
 * POST /call-center/join-queued-call
 * Body: { callId: string, clinicId: string }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const corsHeaders = buildCorsHeaders({}, requestOrigin);

  try {
    const authContext = JSON.parse(event.requestContext.authorizer?.context || '{}');
    const agentId = authContext.email;
    const roles = authContext.roles || [];
    const payload = authContext;

    if (!agentId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized: No agent ID' })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { callId, clinicId } = body;

    if (!callId || !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'callId and clinicId are required' })
      };
    }

    console.log(`[join-queued-call] Agent ${agentId} attempting to join queued call ${callId} for clinic ${clinicId}`);

    // 1. Verify agent has access to this clinic
    const agentClinicIds = payload.activeClinicIds || [];
    const isSupervisor = roles.includes('supervisor') || roles.includes('admin');
    
    if (!isSupervisor && !agentClinicIds.includes(clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'You do not have access to this clinic' })
      };
    }

    // 2. Get the queued call
    const { Item: callRecord } = await ddb.send(new GetCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, callId }
    }));

    if (!callRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call not found' })
      };
    }

    if (callRecord.status !== 'queued') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Call is not in queue. Current status: ${callRecord.status}` 
        })
      };
    }

    // 3. Check agent availability
    const { Item: agentPresence } = await ddb.send(new GetCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      Key: { agentId }
    }));

    if (!agentPresence) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Agent session not found. Please start your session first.' })
      };
    }

    if (agentPresence.status !== 'idle') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `You must be idle to pick up a call. Current status: ${agentPresence.status}`,
          currentStatus: agentPresence.status
        })
      };
    }

    // 4. Get clinic info for SIP Media Application
    const { Item: clinic } = await ddb.send(new GetCommand({
      TableName: CLINICS_TABLE_NAME,
      Key: { clinicId }
    }));

    if (!clinic?.sipMediaApplicationId) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Clinic SIP configuration not found' })
      };
    }

    // 5. Create or reuse meeting for this call
    let meetingId = callRecord.meetingId;
    let meetingInfo = callRecord.meetingInfo;

    if (!meetingId) {
      console.log('[join-queued-call] Creating new meeting for queued call');
      const meetingResponse = await chime.send(new CreateMeetingCommand({
        ExternalMeetingId: `queue-${clinicId}-${callId}`,
        MediaRegion: CHIME_MEDIA_REGION
      }));
      meetingId = meetingResponse.Meeting!.MeetingId!;
      meetingInfo = meetingResponse.Meeting;
    }

    // 6. Create attendee for agent
    const agentAttendeeResponse = await chime.send(new CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: `agent-${agentId}-${Date.now()}`
    }));

    const agentAttendeeInfo = agentAttendeeResponse.Attendee;

    // 7. Update call record - mark as ringing to this agent
    const now = Date.now();
    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, callId },
      UpdateExpression: `
        SET #status = :ringing,
            assignedAgentId = :agentId,
            agentAttendeeInfo = :agentAttendee,
            meetingId = :meetingId,
            meetingInfo = :meetingInfo,
            ringStartTime = :now,
            manualPickup = :true,
            updatedAt = :now
      `,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':ringing': 'ringing',
        ':agentId': agentId,
        ':agentAttendee': agentAttendeeInfo,
        ':meetingId': meetingId,
        ':meetingInfo': meetingInfo,
        ':now': now,
        ':true': true
      }
    }));

    // 8. Update agent presence - mark as ringing
    await ddb.send(new UpdateCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      Key: { agentId },
      UpdateExpression: `
        SET #status = :ringing,
            currentCallId = :callId,
            currentClinicId = :clinicId,
            ringStartTime = :now,
            lastHeartbeat = :now,
            updatedAt = :now
      `,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':ringing': 'ringing',
        ':callId': callId,
        ':clinicId': clinicId,
        ':now': now
      }
    }));

    // 9. Bridge the customer into the meeting (trigger SIP Media Application)
    console.log('[join-queued-call] Bridging customer to meeting', {
      transactionId: callRecord.transactionId,
      meetingId
    });

    try {
      await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: clinic.sipMediaApplicationId,
        TransactionId: callRecord.transactionId,
        Arguments: {
          action: 'BRIDGE_CUSTOMER_INBOUND',
          callId,
          clinicId,
          meetingId,
          agentId,
          fromQueue: 'true'
        }
      }));
    } catch (bridgeError) {
      console.error('[join-queued-call] Failed to bridge customer:', bridgeError);
      // Roll back the status updates
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, callId },
        UpdateExpression: 'SET #status = :queued REMOVE assignedAgentId, ringStartTime, manualPickup',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':queued': 'queued' }
      }));
      
      await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET #status = :idle REMOVE currentCallId, currentClinicId, ringStartTime',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':idle': 'idle' }
      }));

      throw bridgeError;
    }

    console.log('[join-queued-call] Successfully initiated call pickup', {
      callId,
      agentId,
      meetingId
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Call pickup initiated',
        callId,
        meetingId,
        agentAttendee: agentAttendeeInfo,
        meetingInfo,
        status: 'ringing'
      })
    };

  } catch (error) {
    console.error('[join-queued-call] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to join queued call',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

