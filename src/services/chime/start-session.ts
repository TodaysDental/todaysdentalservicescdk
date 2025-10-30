import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Chime SDK Meetings only supports specific regions
// Use us-east-1 as the default Chime media region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

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
  // Prefer the incoming Origin header so the Lambda echoes back the exact
  // requesting origin (if it's in the allowed list). This avoids mismatches
  // when API Gateway preflight is handled separately but runtime responses
  // still need the correct Access-Control-Allow-Origin header.
  const requestOrigin = (event.headers && (event.headers.origin || event.headers.Origin)) || undefined;
  const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] }, requestOrigin);
  if (event.httpMethod === 'OPTIONS') {
    console.log('[start-session] Handling OPTIONS preflight request');
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Basic runtime validation to fail fast with clearer logs when environment
  // variables required for operation are missing.
  if (!AGENT_PRESENCE_TABLE_NAME) {
    console.error('[start-session] Missing required environment variable: AGENT_PRESENCE_TABLE_NAME');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Server misconfiguration: AGENT_PRESENCE_TABLE_NAME not set' }) };
  }

  // Log function invocation and low-risk request metadata for debugging
  console.log('[start-session] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId,
    sourceIp: (event.requestContext as any)?.identity?.sourceIp,
    userAgent: (event.requestContext as any)?.identity?.userAgent,
    hasBody: !!event.body,
    bodyLength: event.body?.length || 0,
    origin: requestOrigin,
    timestamp: new Date().toISOString()
  });

  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    console.log('[start-session] Verifying auth token', { hasToken: !!authz });
    
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn('[start-session] Auth verification failed', { 
        code: verifyResult.code,
        message: verifyResult.message 
      });
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    
    console.log('[start-session] Auth verification successful');

    const agentId = verifyResult.payload.sub; // Cognito User 'sub'
    if (!agentId) {
      console.error('[start-session] Missing subject claim in token');
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing sub' }) };
    }
    
    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    const body = JSON.parse(event.body || '{}') as { activeClinicIds: string[] };

    // Log agent and clinic authorization info (non-sensitive)
    console.log('[start-session] Agent authorized for clinics', {
      agentId,
      authorizedClinicsCount: authorizedClinics.length,
      isAdmin: authorizedClinics.includes('ALL'),
      requestedActiveClinicCount: Array.isArray(body.activeClinicIds) ? body.activeClinicIds.length : 0,
      requestedClinics: body.activeClinicIds
    });

    if (!body.activeClinicIds || body.activeClinicIds.length === 0) {
        console.error('[start-session] Missing required parameter activeClinicIds');
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'activeClinicIds array is required' }) };
    }

    // Security Check: Ensure agent is only activating clinics they are allowed to
    if (authorizedClinics[0] !== "ALL") {
        for (const reqClinicId of body.activeClinicIds) {
            if (!authorizedClinics.includes(reqClinicId)) {
                console.warn('[start-session] Authorization failed for clinic', {
                  agentId,
                  requestedClinic: reqClinicId,
                  authorizedClinics
                });
                 return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: `Forbidden: not authorized for clinic ${reqClinicId}` }) };
            }
        }
    }
    console.log('[start-session] Clinic authorization successful');

    console.log('[start-session] Creating Chime meeting', {
      region: CHIME_MEDIA_REGION,
      agentId,
      clinicsCount: body.activeClinicIds.length
    });

    // 1. Create Chime Meeting for the agent's session
    const meetingId = randomUUID();
    const meetingResponse = await chimeClient.send(new CreateMeetingCommand({
        ClientRequestToken: randomUUID(),
        MediaRegion: CHIME_MEDIA_REGION, // Use supported Chime region
        ExternalMeetingId: meetingId,
    }));

    if (!meetingResponse.Meeting?.MeetingId) {
      console.error('[start-session] Meeting created but no MeetingId returned', { 
        meetingResponse: !!meetingResponse.Meeting,
        hasMediaRegion: !!(meetingResponse.Meeting as any)?.MediaRegion
      });
          return { 
              statusCode: 500, 
              headers: corsHeaders, 
              body: JSON.stringify({ message: 'Failed to create meeting: no MeetingId' }) 
          };
      }

      console.log('[start-session] Chime meeting created successfully', {
        meetingId: meetingResponse.Meeting.MeetingId,
        mediaRegion: (meetingResponse.Meeting as any)?.MediaRegion
      });

    // 2. Create Attendee for the agent
    const attendeeResponse = await chimeClient.send(new CreateAttendeeCommand({
        MeetingId: meetingResponse.Meeting.MeetingId,
        ExternalUserId: agentId,
    }));

    if (!attendeeResponse.Attendee?.AttendeeId) {
      console.error('[start-session] Attendee created but no AttendeeId returned', { 
        hasAttendee: !!attendeeResponse.Attendee,
        hasJoinToken: !!(attendeeResponse.Attendee as any)?.JoinToken
      });
          return { 
              statusCode: 500, 
              headers: corsHeaders, 
              body: JSON.stringify({ message: 'Failed to create attendee: no AttendeeId' }) 
          };
      }

      console.log('[start-session] Chime attendee created successfully', {
        attendeeId: attendeeResponse.Attendee.AttendeeId,
        hasJoinToken: !!(attendeeResponse.Attendee as any)?.JoinToken
      });
    
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

    console.log('[start-session] Agent presence saved successfully', { 
      agentId, 
      table: AGENT_PRESENCE_TABLE_NAME, 
      ttl,
      activeClinicIds: body.activeClinicIds,
      meetingId: meetingResponse.Meeting.MeetingId
    });

    // Return meeting details to the frontend softphone
    const responseBody = {
      meeting: meetingResponse.Meeting,
      attendee: attendeeResponse.Attendee,
    };
    
    console.log('[start-session] Request completed successfully', {
      agentId,
      meetingId: meetingResponse.Meeting.MeetingId,
      attendeeId: attendeeResponse.Attendee.AttendeeId,
      responseSize: JSON.stringify(responseBody).length
    });
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (err: any) {
    // Log full error with stack to CloudWatch for debugging. Avoid returning
    // stack traces to clients (keep response brief) but include an error id
    // or request id if you want to correlate client/reports with logs.
    const errorContext = {
        message: err?.message,
        code: err?.name || err?.code,
        stack: err?.stack,
    };
    console.error('[start-session] Error starting session', errorContext);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
          message: 'Failed to start session',
          error: err?.message,
          code: err?.name || err?.code
      }),
    };
  }
};