import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;
if (!SMA_ID) {
    throw new Error('SMA_ID environment variable is required');
}
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// --- Auth Helpers ---
async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, code: 401, message: "Missing Bearer token" };
  }
  if (!ISSUER) {
    return { ok: false, code: 500, message: "Issuer not configured" };
  }
  const token = authorizationHeader.slice(7).trim();
  try {
    JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    if ((payload as any).token_use !== "id") {
      return { ok: false, code: 401, message: "ID token required" };
    }
    return { ok: true, payload };
  } catch (err: any) {
    return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
  }
}

function getClinicsFromClaims(payload: JWTPayload): string[] {
    const xClinics = String((payload as any)["x_clinics"] || "").trim();
    if (xClinics === "ALL") return ["ALL"];
    if (xClinics) {
      return xClinics.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const xRbc = String((payload as any)["x_rbc"] || "").trim();
     if (xRbc) {
      return xRbc.split(',').map((pair) => pair.split(':')[0]).filter(Boolean);
    }
    
    // Fallback: Extract clinic IDs from cognito:groups (e.g., clinic_dentistinperrysburg__ADMIN)
    const groups = Array.isArray((payload as any)["cognito:groups"]) ? ((payload as any)["cognito:groups"] as string[]) : [];
    if (groups.length > 0) {
      const clinicIds = groups
        .map((name) => {
          const match = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(name));
          return match ? match[1] : '';
        })
        .filter(Boolean);
      if (clinicIds.length > 0) {
        return clinicIds;
      }
    }
    
    return [];
}
// --- End Auth Helpers ---

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Log function invocation with request metadata
  console.log('[outbound-call] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId,
    sourceIp: (event.requestContext as any)?.identity?.sourceIp,
    userAgent: (event.requestContext as any)?.identity?.userAgent,
    hasBody: !!event.body,
    bodyLength: event.body?.length || 0
  });

  const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });
  if (event.httpMethod === 'OPTIONS') {
    console.log('[outbound-call] Handling OPTIONS preflight request');
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    console.log('[outbound-call] Verifying auth token', { hasToken: !!authz });
    
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn('[outbound-call] Auth verification failed', { 
        code: verifyResult.code, 
        message: verifyResult.message 
      });
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    
    console.log('[outbound-call] Auth verification successful');

    const agentId = verifyResult.payload.sub;
    if (!agentId) {
      console.error('[outbound-call] Missing subject claim in token');
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
    }
    
    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    console.log('[outbound-call] Agent authorized for clinics', { 
      agentId, 
      authorizedClinicsCount: authorizedClinics.length,
      isAdmin: authorizedClinics.includes('ALL')
    });
    
    const body = JSON.parse(event.body || '{}') as { toPhoneNumber: string, fromClinicId: string };
    console.log('[outbound-call] Parsed request body', { 
      toPhoneNumber: body.toPhoneNumber,
      fromClinicId: body.fromClinicId
    });

    if (!body.toPhoneNumber || !body.fromClinicId) {
        console.error('[outbound-call] Missing required parameters', { 
          hasToPhone: !!body.toPhoneNumber,
          hasFromClinic: !!body.fromClinicId
        });
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'toPhoneNumber and fromClinicId are required' }) };
    }
    if (!SMA_ID) {
        console.error('[outbound-call] SMA_ID environment variable not configured');
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'SMA_ID environment variable is not set' }) };
    }

    // 1. Security Check: Validate clinicId against JWT claims
    if (authorizedClinics[0] !== "ALL" && !authorizedClinics.includes(body.fromClinicId)) {
        console.warn('[outbound-call] Authorization failed for clinic', {
          agentId,
          requestedClinic: body.fromClinicId,
          authorizedClinics
        });
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: `Forbidden: not authorized for clinic ${body.fromClinicId}` }) };
    }
    console.log('[outbound-call] Clinic authorization successful');
    
    // 2. Get Clinic's public phone number
    console.log('[outbound-call] Looking up clinic phone number', { clinicId: body.fromClinicId });
    const { Item: clinic } = await ddb.send(new GetCommand({
        TableName: CLINICS_TABLE_NAME,
        Key: { clinicId: body.fromClinicId },
    }));

    if (!clinic || !clinic.phoneNumber) {
        console.error('[outbound-call] Clinic phone number not found', {
          clinicId: body.fromClinicId,
          clinicExists: !!clinic,
          hasPhoneNumber: !!(clinic?.phoneNumber)
        });
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Clinic phone number not found. Populate ClinicsTable.' }) };
    }
    const fromPhoneNumber = clinic.phoneNumber;
    console.log('[outbound-call] Found clinic phone number:', fromPhoneNumber);

    // 3. Get Agent's current presence state (to get meeting info)
    console.log('[outbound-call] Checking agent presence state', { agentId });
    const { Item: agent } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agent || agent.status !== 'Online' || !agent.meetingInfo?.MeetingId || !agent.attendeeInfo?.AttendeeId) {
        console.error('[outbound-call] Agent not ready for outbound call', {
          agentExists: !!agent,
          status: agent?.status,
          hasMeetingInfo: !!(agent?.meetingInfo?.MeetingId),
          hasAttendeeInfo: !!(agent?.attendeeInfo?.AttendeeId)
        });
         return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not online. Call /chime/start-session first.' }) };
    }
    console.log('[outbound-call] Agent ready for outbound call', {
      status: agent.status,
      meetingId: agent.meetingInfo.MeetingId
    });

    // 4. Initiate the outbound call leg to the customer
    console.log('[outbound-call] Initiating SIP media application call', {
      fromPhoneNumber,
      toPhoneNumber: body.toPhoneNumber,
      smaId: SMA_ID,
      meetingId: agent.meetingInfo.MeetingId
    });
    
    const callResponse = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand({
        FromPhoneNumber: fromPhoneNumber,
        ToPhoneNumber: body.toPhoneNumber,
        SipMediaApplicationId: SMA_ID,
        ArgumentsMap: {
            // Pass agent/meeting info to the SMA handler (inbound-router.ts)
            // This is how it knows which meeting to join this call to.
            "callType": "Outbound",
            "agentId": agentId,
            "meetingId": agent.meetingInfo.MeetingId,
            "attendeeId": agent.attendeeInfo.AttendeeId,
            "callStatus": "ringing", // Add this to track initial state
        }
    }));
    
    const callId = callResponse.SipMediaApplicationCall?.TransactionId;
    console.log('[outbound-call] SIP call initiated successfully', {
      transactionId: callId,
    });

    // Store outbound call in queue table for tracking
    if (callId) {
        try {
            await ddb.send(new PutCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Item: {
                    clinicId: body.fromClinicId,
                    callId: callId,
                    queuePosition: Date.now(), // Use timestamp as unique position for outbound calls
                    queueEntryTime: Math.floor(Date.now() / 1000),
                    phoneNumber: body.toPhoneNumber,
                    status: 'ringing',
                    direction: 'outbound',
                    assignedAgentId: agentId,
                    ttl: Math.floor(Date.now() / 1000) + (10 * 60) // 10 minute TTL
                }
            }));
            console.log(`[outbound-call] Call ${callId} added to queue table`);
        } catch (queueErr) {
            console.warn(`[outbound-call] Failed to add call to queue:`, queueErr);
            // Non-fatal
        }
    }

    const responseBody = {
      success: true,
      message: 'Outbound call initiated',
      callId: callId
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
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to make outbound call', 
        error: err?.message,
        code: err?.name || err?.code
      }),
    };
  }
};