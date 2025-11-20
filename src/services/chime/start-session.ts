import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { TTL_POLICY, calculateSessionExpiry } from './config/ttl-policy';

const ddb = getDynamoDBClient();

// Chime SDK Meetings only supports specific regions
// Use us-east-1 as the default Chime media region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

// CRITICAL FIX: Add validation for required environment variables
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
if (!AGENT_PRESENCE_TABLE_NAME) {
    throw new Error('AGENT_PRESENCE_TABLE_NAME environment variable is required');
}

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
if (!CALL_QUEUE_TABLE_NAME) {
    throw new Error('CALL_QUEUE_TABLE_NAME environment variable is required');
}
// CRITICAL FIX #5: Use centralized TTL policy
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

      // Verify the meeting was created with proper media capabilities
      if (!meetingResponse.Meeting.MediaPlacement?.AudioHostUrl) {
          console.error('[start-session] Meeting created without AudioHostUrl', {
              meetingId: meetingResponse.Meeting.MeetingId,
              hasMediaPlacement: !!meetingResponse.Meeting.MediaPlacement
          });
          return {
              statusCode: 500,
              headers: corsHeaders,
              body: JSON.stringify({ 
                  message: 'Failed to create meeting with audio capabilities' 
              })
          };
      }

      console.log('[start-session] Meeting audio configuration validated', {
          audioHostUrl: meetingResponse.Meeting.MediaPlacement.AudioHostUrl,
          mediaRegion: meetingResponse.Meeting.MediaRegion
      });

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
    // CRITICAL FIX #5: Use centralized TTL policy for consistency
    const sessionExpiry = calculateSessionExpiry();
    const presenceItem = {
        agentId: agentId,
        status: 'Online',
        activeClinicIds: body.activeClinicIds,
        meetingInfo: meetingResponse.Meeting,
        attendeeInfo: attendeeResponse.Attendee,
        updatedAt: new Date().toISOString(),
        ttl: sessionExpiry.ttl,
        sessionExpiresAt: sessionExpiry.sessionExpiresAt,
        sessionExpiresAtEpoch: sessionExpiry.sessionExpiresAtEpoch,
        lastHeartbeatAt: new Date().toISOString()
    };

  await ddb.send(new PutCommand({
    TableName: AGENT_PRESENCE_TABLE_NAME,
    Item: presenceItem,
  }));

    // CRITICAL FIX: Use sessionExpiry properties instead of undefined variables
    console.log('[start-session] Agent presence saved successfully', { 
      agentId, 
      table: AGENT_PRESENCE_TABLE_NAME, 
      ttl: sessionExpiry.ttl,
      sessionExpiresAtEpoch: sessionExpiry.sessionExpiresAtEpoch,
      activeClinicIds: body.activeClinicIds,
      meetingId: meetingResponse.Meeting.MeetingId
    });
    
    // Check for queued calls that could be assigned to this agent
    try {
      // Get the clinics this agent is authorized for
      const activeClinicIds = body.activeClinicIds;
      if (!activeClinicIds || activeClinicIds.length === 0) {
        console.log('[start-session] No active clinics to check for queued calls');
        // Skip queue processing if no active clinics
      } else {
        console.log('[start-session] Checking for queued calls in clinics:', activeClinicIds);
        
        // For each clinic, look for the oldest queued call
        for (const clinicId of activeClinicIds) {
          const { Items: queuedCalls } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':clinicId': clinicId,
              ':status': 'queued'
            },
            // Sort by queuePosition (which is timestamp-based) to get oldest first
            ScanIndexForward: true,
            Limit: 1 // Just get the oldest call
          }));
          
          if (queuedCalls && queuedCalls.length > 0) {
            const oldestCall = queuedCalls[0];
            console.log(`[start-session] Found queued call for clinic ${clinicId}:`, {
              callId: oldestCall.callId,
              queuedSince: oldestCall.queueEntryTime,
              hasMeeting: !!oldestCall.meetingInfo?.MeetingId
            });
            
            // Make sure the call has a valid meeting
            if (oldestCall.meetingInfo?.MeetingId) {
              // Create an attendee for this agent in the call's meeting
              const attendeeResponse = await chimeClient.send(new CreateAttendeeCommand({
                MeetingId: oldestCall.meetingInfo.MeetingId,
                ExternalUserId: agentId
              }));
              
              if (!attendeeResponse.Attendee) {
                console.error('[start-session] Failed to create attendee for queued call');
                continue;
              }
              
              // CRITICAL FIX: Atomic claim operation - only assign if still queued and not already assigned
              try {
                await ddb.send(new UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { 
                    clinicId: oldestCall.clinicId, 
                    queuePosition: oldestCall.queuePosition 
                  },
                  UpdateExpression: 'SET #status = :status, agentIds = :agentIds, claimedAt = :timestamp',
                  ConditionExpression: '#status = :queuedStatus AND (attribute_not_exists(agentIds) OR size(agentIds) = :emptyArray)',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: {
                    ':status': 'ringing',
                    ':agentIds': [agentId],
                    ':queuedStatus': 'queued',
                    ':timestamp': new Date().toISOString(),
                    ':emptyArray': 0
                  }
                }));
              } catch (claimErr: any) {
                if (claimErr.name === 'ConditionalCheckFailedException') {
                  console.warn(`[start-session] Race condition - queued call ${oldestCall.callId} already claimed by another agent`);
                  continue; // Try next queued call
                }
                throw claimErr;
              }
              
              // Update agent's presence to show the ringing call
              await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET ringingCallId = :callId, callStatus = :status, ' + 
                                 'inboundMeetingInfo = :meeting, inboundAttendeeInfo = :attendee, ' +
                                 'ringingCallTime = :time',
                ExpressionAttributeValues: {
                  ':callId': oldestCall.callId,
                  ':status': 'ringing',
                  ':meeting': oldestCall.meetingInfo,
                  ':attendee': attendeeResponse.Attendee,
                  ':time': new Date().toISOString()
                }
              }));
              
              console.log(`[start-session] Assigned queued call ${oldestCall.callId} to agent ${agentId}`);
              
              // Only assign one call, even if there are multiple queued calls
              break;
            } else {
              console.error('[start-session] Queued call has no valid meeting info:', oldestCall);
            }
          } else {
            console.log(`[start-session] No queued calls found for clinic ${clinicId}`);
          }
        }
      }
    } catch (queueError) {
      // Non-fatal error - log but continue
      console.error('[start-session] Error processing call queue:', queueError);
    }

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
