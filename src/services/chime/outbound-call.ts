import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
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
    return [];
}
// --- End Auth Helpers ---

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }

    const agentId = verifyResult.payload.sub;
    if (!agentId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
    }
    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    const body = JSON.parse(event.body || '{}') as { toPhoneNumber: string, fromClinicId: string };

    if (!body.toPhoneNumber || !body.fromClinicId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'toPhoneNumber and fromClinicId are required' }) };
    }
    if (!SMA_ID) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'SMA_ID environment variable is not set' }) };
    }

    // 1. Security Check: Validate clinicId against JWT claims
    if (authorizedClinics[0] !== "ALL" && !authorizedClinics.includes(body.fromClinicId)) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: `Forbidden: not authorized for clinic ${body.fromClinicId}` }) };
    }
    
    // 2. Get Clinic's public phone number
    const { Item: clinic } = await ddb.send(new GetCommand({
        TableName: CLINICS_TABLE_NAME,
        Key: { clinicId: body.fromClinicId },
    }));

    if (!clinic || !clinic.phoneNumber) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Clinic phone number not found. Populate ClinicsTable.' }) };
    }
    const fromPhoneNumber = clinic.phoneNumber;

    // 3. Get Agent's current presence state (to get meeting info)
    const { Item: agent } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agent || agent.status !== 'Online' || !agent.meetingInfo?.MeetingId || !agent.attendeeInfo?.AttendeeId) {
         return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not online. Call /chime/start-session first.' }) };
    }

    // 4. Initiate the outbound call leg to the customer
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
        }
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Outbound call initiated',
        callId: callResponse.SipMediaApplicationCall?.TransactionId
      }),
    };
  } catch (err: any) {
    console.error("Error making outbound call:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Failed to make outbound call', error: err.message }),
    };
  }
};