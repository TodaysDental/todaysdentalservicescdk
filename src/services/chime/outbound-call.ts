import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand, CreateSipMediaApplicationCallCommandOutput } from '@aws-sdk/client-chime-sdk-voice';
// REMOVED: ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand, DeleteMeetingCommand
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { sanitizePhoneNumber } from '../shared/utils/input-sanitization';
import { checkClinicAuthorization } from '../shared/utils/authorization';
import { getSmaIdForClinic } from './utils/sma-map';

const ddb = getDynamoDBClient();
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parseNumberOr = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const OUTBOUND_CALL_MAX_ATTEMPTS = Math.max(1, Math.floor(parseNumberOr(process.env.OUTBOUND_CALL_RETRY_ATTEMPTS, 3)));
const OUTBOUND_CALL_RETRY_BASE_DELAY_MS = Math.max(250, Math.floor(parseNumberOr(process.env.OUTBOUND_CALL_RETRY_DELAY_MS, 1000)));
const isConcurrentCallLimitError = (error: any): boolean => {
  const message = (error?.message || '').toString();
  return error?.name === 'BadRequestException' && message.includes('Concurrent call limits');
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[outbound-call] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId,
  });

  const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });
  if (event.httpMethod === 'OPTIONS') {
    console.log('[outbound-call] Handling OPTIONS preflight request');
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  let agentId: string | undefined; // Declared here for use in rollback logic, initialized as undefined

  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    console.log('[outbound-call] Verifying auth token');
    
    const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID!);
    if (!verifyResult.ok) {
      console.warn('[outbound-call] Auth verification failed', { code: verifyResult.code, message: verifyResult.message });
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    
    console.log('[outbound-call] Auth verification successful');

    agentId = verifyResult.payload.sub!; // Assign agentId for outer scope
    if (!agentId) {
      console.error('[outbound-call] Missing subject claim in token');
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
    }
    
    const body = JSON.parse(event.body || '{}') as { toPhoneNumber: string, fromClinicId: string };
    console.log('[outbound-call] Parsed request body', { toPhoneNumber: body.toPhoneNumber, fromClinicId: body.fromClinicId });

    if (!body.toPhoneNumber || !body.fromClinicId) {
        console.error('[outbound-call] Missing required parameters');
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'toPhoneNumber and fromClinicId are required' }) };
    }
    
    // Sanitize phone number
    const phoneValidation = sanitizePhoneNumber(body.toPhoneNumber);
    if (!phoneValidation.sanitized) {
        console.error('[outbound-call] Invalid phone number', { error: phoneValidation.error });
        return { 
            statusCode: 400, 
            headers: corsHeaders, 
            body: JSON.stringify({ message: phoneValidation.error }) 
        };
    }
    const toPhoneNumber = phoneValidation.sanitized;

    // 1. Security Check: Validate clinicId against JWT claims
    const authzCheck = checkClinicAuthorization(verifyResult.payload, body.fromClinicId);
    if (!authzCheck.authorized) {
        console.warn('[outbound-call] Authorization failed', {
            agentId,
            clinic: body.fromClinicId,
            reason: authzCheck.reason
        });
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }
    console.log('[outbound-call] Clinic authorization successful');
    
    // 2. Get Clinic's public phone number
    console.log('[outbound-call] Looking up clinic phone number', { clinicId: body.fromClinicId });
    const { Item: clinic } = await ddb.send(new GetCommand({
        TableName: CLINICS_TABLE_NAME,
        Key: { clinicId: body.fromClinicId },
    }));

    if (!clinic || !clinic.phoneNumber) {
        console.error('[outbound-call] Clinic phone number not found', { clinicId: body.fromClinicId });
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Clinic phone number not found. Populate ClinicsTable.' }) };
    }
    const fromPhoneNumber = clinic.phoneNumber;
    console.log('[outbound-call] Found clinic phone number:', fromPhoneNumber);

    // 3. Check Agent's current presence AND get their meeting info
    console.log('[outbound-call] Checking agent presence state', { agentId });
    const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agentPresence?.meetingInfo?.MeetingId) {
         console.error('[outbound-call] Agent is online but has no valid meeting info.', { agentId, presence: agentPresence });
         return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session is invalid. Please log out and back in.' }) };
    }

    if (agentPresence.status !== 'Online') {
        console.error('[outbound-call] Agent not ready for outbound call', { agentId, status: agentPresence.status });
        if (agentPresence.status === 'ringing' || agentPresence.status === 'OnCall' || agentPresence.status === 'dialing') {
             return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is already on another call.' }) };
        }
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: `Agent is not Online (status: ${agentPresence.status}).` }) };
    }

    const agentMeeting = agentPresence.meetingInfo; // This is the agent's existing session
    console.log('[outbound-call] Agent ready, using existing meeting', { status: agentPresence.status, meetingId: agentMeeting.MeetingId });
    
    // 4. Set agent status to "dialing" atomically
    // This "locks" the agent to prevent them from receiving an inbound call
    const callReference = `outbound-${Date.now()}-${agentId}`;
    try {
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET #status = :dialingStatus, currentCallId = :callRef, lastActivityAt = :now',
            ConditionExpression: '#status = :onlineStatus AND attribute_not_exists(currentCallId) AND attribute_not_exists(ringingCallId)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':dialingStatus': 'dialing',
                ':onlineStatus': 'Online',
                ':callRef': callReference,
                ':now': new Date().toISOString()
            }
        }));
    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.warn('[outbound-call] Agent status changed, aborting dial', { agentId });
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent status changed. Please try again.' }) };
        }
        console.error('[outbound-call] Failed to update agent status', { error: err.message });
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Failed to update agent status' }) };
    }
    
    const smaId = getSmaIdForClinic(body.fromClinicId);
    if (!smaId) {
        console.error('[outbound-call] Missing SMA mapping for clinic', { clinicId: body.fromClinicId });
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Outbound calling is not configured for this clinic' }) };
    }

    // 5. Initiate the outbound call leg to the customer
    console.log('[outbound-call] Initiating SIP media application call', {
      fromPhoneNumber,
      toPhoneNumber: body.toPhoneNumber,
      smaId,
      meetingId: agentMeeting.MeetingId
    });

    const callCommandInput = {
        FromPhoneNumber: fromPhoneNumber,
        ToPhoneNumber: body.toPhoneNumber,
        SipMediaApplicationId: smaId,
        ArgumentsMap: {
            // Pass all info the inbound-router.ts will need
            "callType": "Outbound",
            "agentId": agentId,
            "meetingId": agentMeeting.MeetingId, // <-- CRITICAL CHANGE
            "callReference": callReference, 
            "toPhoneNumber": body.toPhoneNumber,
            "fromPhoneNumber": fromPhoneNumber,
            "fromClinicId": body.fromClinicId,
        }
    };

    let callResponse: CreateSipMediaApplicationCallCommandOutput | null = null;
    let lastDialError: any = null;

    for (let attempt = 1; attempt <= OUTBOUND_CALL_MAX_ATTEMPTS; attempt++) {
        try {
            callResponse = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand(callCommandInput));
            break;
        } catch (err: any) {
            lastDialError = err;
            if (isConcurrentCallLimitError(err) && attempt < OUTBOUND_CALL_MAX_ATTEMPTS) {
                const waitTime = OUTBOUND_CALL_RETRY_BASE_DELAY_MS * attempt;
                console.warn(`[outbound-call] Concurrent call limit reached (attempt ${attempt}/${OUTBOUND_CALL_MAX_ATTEMPTS}). Retrying in ${waitTime}ms.`);
                await sleep(waitTime);
                continue;
            }
            throw err;
        }
    }

    if (!callResponse) {
        throw lastDialError || new Error('Failed to initiate outbound call');
    }
    
    const callId = callResponse.SipMediaApplicationCall?.TransactionId;
    if (!callId) {
        throw new Error('CreateSipMediaApplicationCall did not return a TransactionId');
    }
    console.log('[outbound-call] SIP call initiated successfully', { transactionId: callId });

    // 6. Store outbound call in queue table for tracking
    const now = new Date();
    const nowTs = Math.floor(now.getTime() / 1000);
    await ddb.send(new PutCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Item: {
            clinicId: body.fromClinicId,
            callId: callId,
            queuePosition: now.getTime(), // Use timestamp as unique position
            queueEntryTime: nowTs,
            queueEntryTimeIso: now.toISOString(),
            phoneNumber: body.toPhoneNumber,
            status: 'dialing',
            direction: 'outbound',
            assignedAgentId: agentId,
            callReference: callReference,
            meetingInfo: agentMeeting, // Store the agent's meeting info
            // NOTE: We do NOT store agent attendee info, as the agent is already in the meeting.
            // The customer's attendee info will be added by inbound-router on CALL_ANSWERED.
            ttl: nowTs + (1 * 60 * 60) // 1 hour TTL for an active call
        }
    }));
    console.log(`[outbound-call] Call ${callId} added to queue table`);

    // 7. Update agent presence with the REAL callId (TransactionId)
    // This overwrites the temporary callReference
     await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET currentCallId = :realCallId',
        ConditionExpression: 'currentCallId = :callRef', // Ensure we are updating the correct call
        ExpressionAttributeValues: {
            ':realCallId': callId,
            ':callRef': callReference
        }
    }));
     console.log(`[outbound-call] Agent presence updated with real callId ${callId}`);

    // 8. Return simple success response
    // The frontend is already in the meeting and just needs confirmation.
    const responseBody = {
      success: true,
      message: 'Outbound call initiated.',
      callId: callId,
      callReference: callReference,
    };
    
    console.log('[outbound-call] Request completed successfully', responseBody);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };

  } catch (err: any) {
    const errorContext = {
      message: err?.message,
      code: err?.name || err?.code,
      stack: err?.stack,
      requestId: event.requestContext?.requestId
    };
    console.error('[outbound-call] Error making outbound call:', errorContext);
    const concurrentLimitHit = isConcurrentCallLimitError(err);
    
    // --- ROLLBACK LOGIC ---
    // If we failed and have an agentId, try to set the agent's status back to Online
    if (typeof agentId !== 'undefined') {
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :onlineStatus, lastActivityAt = :now REMOVE currentCallId',
                ConditionExpression: '#status = :dialingStatus', // Only rollback if they are still "dialing"
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':onlineStatus': 'Online',
                    ':dialingStatus': 'dialing',
                    ':now': new Date().toISOString()
                }
            }));
            console.log('[outbound-call] ROLLBACK successful: Agent status set back to Online.', { agentId });
        } catch (rollbackErr: any) {
            console.error('[outbound-call] ROLLBACK FAILED: Could not reset agent status.', { agentId, error: rollbackErr.message });
            // This agent may be stuck in "dialing" state until cleanup-monitor runs
        }
    }
    
    return {
      statusCode: concurrentLimitHit ? 429 : 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: concurrentLimitHit 
            ? 'All outbound lines are currently in use. Please wait a moment and try again.' 
            : 'Failed to make outbound call', 
        error: err?.message,
        code: err?.name || err?.code
      }),
    };
  }
};
