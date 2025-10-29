import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeClient = new ChimeSDKMeetingsClient({});

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// --- Auth Helpers (Adapted from your user.ts) ---
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
    if (xClinics === "ALL") return ["ALL"]; // Super admin case
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

    const agentId = verifyResult.payload.sub; // Cognito User 'sub'
    if (!agentId) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing sub' }) };
    }
    
    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    const body = JSON.parse(event.body || '{}') as { activeClinicIds: string[] };
    
    if (!body.activeClinicIds || body.activeClinicIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'activeClinicIds array is required' }) };
    }

    // Security Check: Ensure agent is only activating clinics they are allowed to
    if (authorizedClinics[0] !== "ALL") {
        for (const reqClinicId of body.activeClinicIds) {
            if (!authorizedClinics.includes(reqClinicId)) {
                 return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: `Forbidden: not authorized for clinic ${reqClinicId}` }) };
            }
        }
    }

    // 1. Create Chime Meeting for the agent's session
    const meetingId = randomUUID();
    const meetingResponse = await chimeClient.send(new CreateMeetingCommand({
        ClientRequestToken: randomUUID(),
        MediaRegion: REGION, // Use the stack's region
        ExternalMeetingId: meetingId,
    }));

    // 2. Create Attendee for the agent
    const attendeeResponse = await chimeClient.send(new CreateAttendeeCommand({
        MeetingId: meetingResponse.Meeting?.MeetingId,
        ExternalUserId: agentId,
    }));
    
    // 3. Save presence to DynamoDB
    const ttl = Math.floor(Date.now() / 1000) + 8 * 60 * 60; // 8-hour TTL
    const presenceItem = {
        agentId: agentId,
        status: 'Online',
        activeClinicIds: body.activeClinicIds, // The clinics they are actively covering
        meetingInfo: meetingResponse.Meeting,
        attendeeInfo: attendeeResponse.Attendee,
        updatedAt: new Date().toISOString(),
        ttl: ttl,
    };

    await ddb.send(new PutCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Item: presenceItem,
    }));

    // Return meeting details to the frontend softphone
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        meeting: meetingResponse.Meeting,
        attendee: attendeeResponse.Attendee,
      }),
    };
  } catch (err: any) {
    console.error("Error starting session:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Failed to start session', error: err.message }),
    };
  }
};

