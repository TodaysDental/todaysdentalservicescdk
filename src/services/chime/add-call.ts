/**
 * Add Call Lambda Handler
 * 
 * Allows an agent to initiate a second call while on an existing call.
 * This enables warm transfers, consultations, and conference calls.
 * 
 * The agent's primary call is placed on hold while the second call is dialed.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { sanitizePhoneNumber } from '../shared/utils/input-sanitization';
import { getSmaIdForClinic } from './utils/sma-map';
import { TTL_POLICY } from './config/ttl-policy';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[add-call] Function invoked', {
        httpMethod: event.httpMethod,
        path: event.path,
        requestId: event.requestContext?.requestId,
    });

    const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        // 1. Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[add-call] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        // 2. Parse request body
        const body = JSON.parse(event.body || '{}') as {
            primaryCallId: string;
            toPhoneNumber: string;
            fromClinicId: string;
            holdPrimaryCall?: boolean;
        };

        console.log('[add-call] Parsed request body', { 
            primaryCallId: body.primaryCallId, 
            toPhoneNumber: body.toPhoneNumber, 
            fromClinicId: body.fromClinicId 
        });

        if (!body.primaryCallId || !body.toPhoneNumber || !body.fromClinicId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'primaryCallId, toPhoneNumber, and fromClinicId are required' }) 
            };
        }

        // 3. Validate phone number
        const phoneValidation = sanitizePhoneNumber(body.toPhoneNumber);
        if (!phoneValidation.sanitized) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: phoneValidation.error }) 
            };
        }
        const toPhoneNumber = phoneValidation.sanitized;

        // 4. Validate clinic authorization
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, body.fromClinicId);
        if (!authzCheck.authorized) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
        }

        // FIX: Validate LOCKS_TABLE_NAME is configured
        if (!LOCKS_TABLE_NAME) {
            console.error('[add-call] LOCKS_TABLE_NAME not configured');
            return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'System configuration error' }) };
        }

        // FIX: Acquire distributed lock BEFORE any state checks to prevent double-dial race condition
        // Similar to outbound-call.ts pattern
        const addCallLock = new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `add-call-${agentId}`,
            ttlSeconds: 20,
            maxRetries: 1,  // Don't retry - if locked, user already has an add-call in progress
            retryDelayMs: 0
        });

        const lockAcquired = await addCallLock.acquire();
        if (!lockAcquired) {
            console.warn('[add-call] Failed to acquire lock - possible double-click', { agentId });
            return { 
                statusCode: 429, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Add call operation already in progress. Please wait.' }) 
            };
        }

        try {
            // 5. Verify agent is currently on the primary call
            const { Item: agentPresence } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
            }));

            if (!agentPresence) {
                return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
            }

            if (agentPresence.currentCallId !== body.primaryCallId) {
                return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not on the specified primary call' }) };
            }

            if (agentPresence.status !== 'OnCall' && agentPresence.callStatus !== 'connected') {
                return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent must be connected to a call to add another call' }) };
            }

            // 6. Check if agent already has a secondary call
            if (agentPresence.secondaryCallId) {
                return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent already has a secondary call active' }) };
            }

            // 7. Get clinic phone number
            const { Item: clinic } = await ddb.send(new GetCommand({
                TableName: CLINICS_TABLE_NAME,
                Key: { clinicId: body.fromClinicId },
            }));

            if (!clinic || !clinic.phoneNumber) {
                return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Clinic phone number not found' }) };
            }
            const fromPhoneNumber = clinic.phoneNumber;

            // 8. Get SMA ID for clinic
            const smaId = getSmaIdForClinic(body.fromClinicId);
            if (!smaId) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Add call is not configured for this clinic' }) };
            }

            // 9. Find the primary call record for later atomic update
            const { Items: primaryCallRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': body.primaryCallId }
            }));

            if (!primaryCallRecords || primaryCallRecords.length === 0) {
                return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Primary call not found' }) };
            }
            const primaryCall = primaryCallRecords[0];

            // FIX: Validate primary call is in a valid state for adding a secondary call
            if (primaryCall.status !== 'connected') {
                return { 
                    statusCode: 409, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        message: `Primary call must be connected to add a secondary call. Current status: ${primaryCall.status}` 
                    }) 
                };
            }

            // 10. Initiate the secondary call FIRST (most critical external operation)
            const secondaryCallReference = `add-call-${Date.now()}-${agentId}`;
            const idempotencyKey = randomUUID();
            
            const callCommandInput = {
                FromPhoneNumber: fromPhoneNumber,
                ToPhoneNumber: toPhoneNumber,
                SipMediaApplicationId: smaId,
                ClientRequestToken: idempotencyKey,
                ArgumentsMap: {
                    "callType": "AddCall",
                    "agentId": agentId,
                    "primaryCallId": body.primaryCallId,
                    "meetingId": agentPresence.meetingInfo?.MeetingId || '',
                    "callReference": secondaryCallReference,
                    "idempotencyKey": idempotencyKey,
                    "toPhoneNumber": toPhoneNumber,
                    "fromPhoneNumber": fromPhoneNumber,
                    "fromClinicId": body.fromClinicId,
                    "holdPrimaryCall": body.holdPrimaryCall !== false ? 'true' : 'false'
                }
            };

            let callResponse;
            try {
                callResponse = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand(callCommandInput));
            } catch (err: any) {
                console.error('[add-call] Failed to initiate secondary call:', err);
                return { 
                    statusCode: 500, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ message: 'Failed to initiate secondary call', error: err.message }) 
                };
            }

            const secondaryCallId = callResponse.SipMediaApplicationCall?.TransactionId;
            if (!secondaryCallId) {
                throw new Error('CreateSipMediaApplicationCall did not return a TransactionId');
            }

            console.log('[add-call] Secondary call initiated', { secondaryCallId });

            // 11. Store secondary call in queue table
            const now = new Date();
            const nowTs = Math.floor(now.getTime() / 1000);
            const callTTL = nowTs + TTL_POLICY.ACTIVE_CALL_SECONDS;
            const { generateUniqueQueuePosition } = require('../shared/utils/unique-id');
            const queuePosition = generateUniqueQueuePosition();

            await ddb.send(new PutCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Item: {
                    clinicId: body.fromClinicId,
                    callId: secondaryCallId,
                    queuePosition,
                    queueEntryTime: nowTs,
                    queueEntryTimeIso: now.toISOString(),
                    phoneNumber: toPhoneNumber,
                    status: 'dialing',
                    direction: 'outbound',
                    callType: 'add-call',
                    assignedAgentId: agentId,
                    primaryCallId: body.primaryCallId,
                    callReference: secondaryCallReference,
                    meetingInfo: agentPresence.meetingInfo,
                    ttl: callTTL
                }
            }));

            console.log(`[add-call] Secondary call ${secondaryCallId} added to queue table`);

            // 12. FIX: Use TransactWriteCommand to atomically update agent presence AND primary call
            // This ensures consistency - either both updates succeed or neither does
            try {
                const transactItems: any[] = [
                    // Update agent presence with secondary call info
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            UpdateExpression: 'SET secondaryCallId = :callId, secondaryCallStatus = :status, secondaryCallReference = :ref, lastActivityAt = :now',
                            ConditionExpression: 'attribute_not_exists(secondaryCallId) AND currentCallId = :primaryCallId',
                            ExpressionAttributeValues: {
                                ':callId': secondaryCallId,
                                ':status': 'dialing',
                                ':ref': secondaryCallReference,
                                ':now': now.toISOString(),
                                ':primaryCallId': body.primaryCallId
                            }
                        }
                    }
                ];

                // If holdPrimaryCall is true, also update primary call atomically
                if (body.holdPrimaryCall !== false) {
                    transactItems.push({
                        Update: {
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId: primaryCall.clinicId, queuePosition: primaryCall.queuePosition },
                            UpdateExpression: 'SET #status = :holdStatus, holdStartTime = :now, heldByAgentId = :agentId, heldForSecondaryCall = :secondaryCallId',
                            // FIX: Add ConditionExpression to verify call is still connected
                            ConditionExpression: '#status = :connectedStatus AND assignedAgentId = :agentId',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':holdStatus': 'on_hold',
                                ':connectedStatus': 'connected',
                                ':now': now.toISOString(),
                                ':agentId': agentId,
                                ':secondaryCallId': secondaryCallId
                            }
                        }
                    });
                }

                await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
                console.log('[add-call] Agent presence and primary call updated atomically');

            } catch (txnErr: any) {
                // FIX: Rollback the queue table entry if transaction fails
                console.error('[add-call] Transaction failed, rolling back queue entry:', txnErr);
                
                try {
                    await ddb.send(new DeleteCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: body.fromClinicId, queuePosition }
                    }));
                    console.log('[add-call] Rolled back queue table entry');
                } catch (rollbackErr) {
                    console.error('[add-call] Failed to rollback queue entry:', rollbackErr);
                }

                if (txnErr.name === 'TransactionCanceledException') {
                    const reasons = txnErr.CancellationReasons || [];
                    console.warn('[add-call] Transaction cancelled', { reasons });
                    
                    if (reasons[0]?.Code === 'ConditionalCheckFailed') {
                        return { 
                            statusCode: 409, 
                            headers: corsHeaders, 
                            body: JSON.stringify({ message: 'Agent state changed during operation. You may already have a secondary call.' }) 
                        };
                    }
                    if (reasons[1]?.Code === 'ConditionalCheckFailed') {
                        return { 
                            statusCode: 409, 
                            headers: corsHeaders, 
                            body: JSON.stringify({ message: 'Primary call state changed. It may no longer be connected.' }) 
                        };
                    }
                }

                return { 
                    statusCode: 500, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ message: 'Failed to update call state', error: txnErr.message }) 
                };
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: 'Secondary call initiated',
                    secondaryCallId: secondaryCallId,
                    primaryCallId: body.primaryCallId,
                    primaryCallOnHold: body.holdPrimaryCall !== false
                }),
            };

        } finally {
            // FIX: Always release lock in finally block
            await addCallLock.release();
        }

    } catch (err: any) {
        console.error('[add-call] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to add call', error: err?.message }),
        };
    }
};
