import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
// CORRECTED IMPORT: Use UpdateSipMediaApplicationCallCommand to manipulate an active call
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getSmaIdForClinic } from './utils/sma-map';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { createCheckQueueForWork } from './utils/check-queue-for-work';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const chimeVoiceClient = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });
const checkQueueForWork = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient
});
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// Auth Helpers
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


/**
 * Lambda handler for call hangup notification
 * This is triggered by the frontend when an agent hangs up.
 * It is updated to explicitly terminate the entire call session using Chime SDK Voice API.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Call hungup event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }
        
        // CRITICAL FIX: Add JWT verification for security
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-hungup] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        console.log('[call-hungup] Auth verification successful');
        const requestingAgentId = verifyResult.payload.sub;
        if (!requestingAgentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, reason } = body;
        // CRITICAL FIX: Don't trust client-provided duration, we'll calculate it server-side
        // Initialize variable for server-calculated duration
        let calculatedDuration = 0;

        if (!callId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameter: callId' }) 
            };
        }
        
        // CRITICAL FIX: Verify the requesting agent is the one hanging up the call
        if (agentId && requestingAgentId !== agentId) {
            console.warn('[call-hungup] Authorization failed - agent attempting to hang up call they are not on', {
                requestingAgentId,
                agentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden: You can only hang up calls you are on' })
            };
        }

        const { Items: callLookupRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        const callMetadata = callLookupRecords && callLookupRecords.length > 0 ? callLookupRecords[0] : undefined;
        if (!callMetadata) {
            console.error('[call-hungup] Call record not found for hangup', { callId });
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        const currentCallStatus = callMetadata.status || callMetadata.callStatus;
        if (currentCallStatus === 'on_hold' && callMetadata.heldByAgentId && agentId && callMetadata.heldByAgentId !== agentId) {
            console.warn('[call-hungup] Blocking hangup because call is on hold by another agent', {
                callId,
                heldByAgentId: callMetadata.heldByAgentId,
                requestingAgentId: agentId
            });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call is currently on hold by another agent. Please wait for them to resume or complete the hold.' })
            };
        }

        const clinicId = typeof callMetadata.clinicId === 'string' ? callMetadata.clinicId : undefined;
        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[call-hungup] Missing SMA mapping for clinic', { clinicId, callId });
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call hangup is not configured for this clinic' })
            };
        }

        // 1. CRITICAL FIX: First try to hangup via SMA, only mark agent available if successful
        let smaHangupSuccess = false;
        if (agentId) {
            try {
                await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId,
                    Arguments: {
                        Action: "Hangup"
                    }
                }));
                smaHangupSuccess = true;
                console.log(`[call-hungup] SMA hangup successful for call ${callId}`);
            } catch (smaError: any) {
                console.error(`[call-hungup] SMA hangup failed for call ${callId}:`, smaError);
                // Continue but don't mark agent as available immediately
            }
        }
        
        // 2. Update the agent's status and metrics
        if (agentId) {
            const callHasQueueKey = typeof callMetadata.queuePosition !== 'undefined' && typeof callMetadata.clinicId === 'string';
            if (smaHangupSuccess) {
                // Only mark agent as available if SMA hangup succeeded
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'Online', // Back to available
                        ':timestamp': new Date().toISOString()
                    }
                }));
                console.log(`[call-hungup] Agent ${agentId} marked as Online after successful hangup`);
                
                if (callHasQueueKey) {
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: callMetadata.clinicId, queuePosition: callMetadata.queuePosition },
                        UpdateExpression: 'SET #status = :completed, endedAt = :now',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':completed': 'completed',
                            ':now': new Date().toISOString()
                        }
                    }));
                    console.log(`[call-hungup] Call ${callId} marked completed after successful SMA hangup`);
                } else {
                    console.warn(`[call-hungup] Unable to update call record ${callId} - missing queue key`);
                }
            } else {
                // Mark agent as in an error state - requires manual intervention
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, errorReason = :error REMOVE currentCallId',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'Error',
                        ':timestamp': new Date().toISOString(),
                        ':error': 'sma_hangup_failed'
                    }
                }));
                console.warn(`[call-hungup] Agent ${agentId} marked as Error due to SMA hangup failure`);
                
                if (callHasQueueKey) {
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: callMetadata.clinicId, queuePosition: callMetadata.queuePosition },
                        UpdateExpression: 'SET errorReason = :error, requiresManualCleanup = :true',
                        ExpressionAttributeValues: {
                            ':error': 'sma_hangup_failed',
                            ':true': true
                        }
                    }));
                    console.warn(`[call-hungup] Call ${callId} flagged for manual cleanup due to SMA hangup failure`);
                } else {
                    console.warn(`[call-hungup] Unable to flag call ${callId} for manual cleanup - missing queue key`);
                }
            }

            // CRITICAL FIX: Calculate duration server-side from cached metadata
            try {
                const callRecord = callMetadata;
                const candidates: Array<{ label: string; value?: number }> = [
                    { label: 'acceptedAt', value: callRecord.acceptedAt ? Date.parse(callRecord.acceptedAt) : undefined },
                    { label: 'connectedAt', value: callRecord.connectedAt ? Date.parse(callRecord.connectedAt) : undefined },
                    { label: 'queueEntryTimeIso', value: callRecord.queueEntryTimeIso ? Date.parse(callRecord.queueEntryTimeIso) : undefined },
                    { label: 'queueEntryTime', value: typeof callRecord.queueEntryTime === 'number' ? callRecord.queueEntryTime * 1000 : undefined }
                ];
                const startCandidate = candidates.find(candidate => typeof candidate.value === 'number' && !Number.isNaN(candidate.value));
                if (startCandidate?.value !== undefined) {
                    const endTime = Date.now();
                    calculatedDuration = Math.max(0, Math.floor((endTime - startCandidate.value) / 1000));
                    console.log(`[call-hungup] Call ${callId} duration calculated using ${startCandidate.label}: ${calculatedDuration}s`);
                } else {
                    console.warn(`[call-hungup] No valid timestamp available to calculate duration for ${callId}`);
                }

                // Log call statistics for the agent regardless of hangup success
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'ADD completedCalls :one, totalCallDuration :duration',
                    ExpressionAttributeValues: {
                        ':one': 1,
                        ':duration': calculatedDuration // Use server-calculated duration
                    }
                }));
            } catch (durationErr) {
                console.error(`[call-hungup] Error calculating call duration:`, durationErr);
                // Still increment completed calls counter even if duration calculation fails
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'ADD completedCalls :one',
                    ExpressionAttributeValues: {
                        ':one': 1
                    }
                }));
            }
        }

        // Note: SMA hangup is handled above in the agent status section to ensure proper error handling
        
        console.log(`Agent ${agentId} marked as available after hanging up call ${callId}`);
        
        // Check for queued calls that could be assigned to this agent
        if (agentId) {
            try {
                const { Item: agentInfo } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId }
                }));

                if (agentInfo) {
                    await checkQueueForWork(agentId, agentInfo);
                } else {
                    console.log(`[call-hungup] Agent presence not found for ${agentId} when checking queue.`);
                }
            } catch (queueError) {
                // Non-fatal error - log but continue
                console.error('[call-hungup] Error processing call queue:', queueError);
            }
        }

        // Use calculatedDuration declared at higher scope
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call termination initiated and agent status updated',
                callId,
                agentId,
                duration: calculatedDuration || 0
            })
        };

    } catch (error) {
        console.error('Error processing call hangup:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};
