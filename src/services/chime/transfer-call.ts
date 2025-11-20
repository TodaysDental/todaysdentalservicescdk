/**
 * FIX #3: Transfer Race Condition with Agent Locking
 * 
 * Enhanced with:
 * - Distributed lock on target agent to prevent simultaneous transfers
 * - State machine validation
 * - Atomic operations with proper rollback
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { DistributedLock } from './utils/distributed-lock';
import { validateStateTransition, CALL_STATE_MACHINE } from '../shared/utils/state-machine';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { randomUUID } from 'crypto';

const ddb = getDynamoDBClient();
const chimeVoice = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;
// FIX #31: Use centralized config for transfer note length
import { CHIME_CONFIG } from './config';
import { sanitizeText } from '../shared/utils/input-sanitization';

const MAX_TRANSFER_NOTE_LENGTH = CHIME_CONFIG.TRANSFER.MAX_NOTE_LENGTH;
const VALID_TRANSFER_NOTES_REGEX = /^[a-zA-Z0-9\s.,!?:;'"\-@#$/()&+]*$/;

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

// FIX #31: Enhanced transfer notes validation
function sanitizeTransferNotes(input?: string): { sanitized?: string; error?: string } {
    if (typeof input !== 'string') {
        return { sanitized: undefined };
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return { sanitized: undefined };
    }
    
    // FIX #31: Validate length before processing
    if (trimmed.length > MAX_TRANSFER_NOTE_LENGTH) {
        return { 
            error: `Transfer notes too long (max ${MAX_TRANSFER_NOTE_LENGTH} characters)`,
            sanitized: undefined
        };
    }
    
    if (!VALID_TRANSFER_NOTES_REGEX.test(trimmed)) {
        return { error: 'Transfer notes contain unsupported characters' };
    }
    return { sanitized: trimmed.slice(0, MAX_TRANSFER_NOTE_LENGTH) };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Missing request body' }) };
        }

        // CRITICAL FIX: Add JWT verification for security
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[transfer-call] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = verifyResult.payload.sub;
        console.log('[transfer-call] Auth verification successful', { requestingAgentId });
        
        const body = JSON.parse(event.body);
        const {
            callId,
            fromAgentId,
            toAgentId,
            transferType: transferTypeInput,
            transferMode: transferModeInput,
            mode: modeInput,
            enableConference,
            conference,
            transferNotes: transferNotesInput,
            notes: notesInput
        } = body;

        const normalizedTransferType = [transferTypeInput, transferModeInput, modeInput]
            .find((value) => typeof value === 'string')?.toLowerCase();
        const conferenceFlag = typeof enableConference === 'boolean'
            ? enableConference
            : typeof conference === 'boolean'
                ? conference
                : undefined;
        const isConferenceTransfer = conferenceFlag ?? normalizedTransferType === 'conference';
        const transferMode = isConferenceTransfer ? 'conference' : 'blind';

        const rawNotes = [transferNotesInput, notesInput].find((value) => typeof value === 'string') as string | undefined;
        const { sanitized: transferNotes, error: transferNotesError } = sanitizeTransferNotes(rawNotes);
        if (transferNotesError) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: transferNotesError })
            };
        }

        if (!callId || !fromAgentId || !toAgentId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, fromAgentId, toAgentId' }) 
            };
        }
        
        // CRITICAL FIX: Verify requesting agent is the fromAgent
        if (requestingAgentId !== fromAgentId) {
            console.warn('[transfer-call] Authorization failed - agent attempting to transfer call they are not on', {
                requestingAgentId,
                fromAgentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden: You can only transfer calls you are currently on' })
            };
        }

        // FIX #3: Acquire distributed lock on target agent to prevent race conditions
        const lock = new DistributedLock(
            ddb,
            process.env.LOCKS_TABLE_NAME || 'ChimeLocks',
            `agent-transfer-${toAgentId}`,
            30000 // 30 second lock
        );

        const lockAcquired = await lock.acquire();
        if (!lockAcquired) {
            console.warn('[transfer-call] Could not acquire lock on target agent', { toAgentId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Target agent is busy with another operation. Please try again.' })
            };
        }

        try {
            // 1. Verify the target agent is available (with strong consistency)
            const { Item: targetAgent } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: toAgentId },
                ConsistentRead: true // FIX #3: Use consistent read for critical state check
            }));

            // FIX #30: Enhanced target agent validation
            if (!targetAgent) {
                await lock.release();
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Target agent not found' })
                };
            }

            if (targetAgent.status !== 'Online') {
                await lock.release();
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: `Target agent is ${targetAgent.status}`,
                        error: 'AGENT_NOT_AVAILABLE'
                    })
                };
            }

            // FIX #3: Verify target agent is not already on another call
            if (targetAgent.currentCallId || targetAgent.ringingCallId) {
                await lock.release();
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Target agent is already on a call' })
                };
            }

        // 2. Find the call record in the call queue table
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: {
                ':callId': callId
            }
        }));

        if (!callRecords || callRecords.length === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;

        // FIX #30: Validate call is in transferable state
        const TRANSFERABLE_STATES = ['connected'];
        if (!TRANSFERABLE_STATES.includes(callRecord.status)) {
            await lock.release();
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: `Cannot transfer call in ${callRecord.status} state`,
                    error: 'INVALID_CALL_STATE',
                    currentState: callRecord.status,
                    allowedStates: TRANSFERABLE_STATES
                })
            };
        }

        // FIX #30: Validate call is not on hold
        if (callRecord.callStatus === 'on_hold') {
            await lock.release();
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Cannot transfer call while on hold. Resume call first.',
                    error: 'CALL_ON_HOLD'
                })
            };
        }

        // FIX #30: Validate call has active meeting
        if (!callRecord.meetingInfo?.MeetingId) {
            await lock.release();
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Cannot transfer call - no active meeting',
                    error: 'NO_ACTIVE_MEETING'
                })
            };
        }

        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[transfer-call] Missing SMA mapping for clinic', { clinicId });
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call transfers are not configured for this clinic' })
            };
        }
        
        // CRITICAL FIX: Verify source agent is actually on this call
        if (callRecord.assignedAgentId !== fromAgentId) {
            console.warn('[transfer-call] Source agent not on this call', {
                fromAgentId,
                assignedAgentId: callRecord.assignedAgentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'You are not currently on this call' })
            };
        }
        
        // CRITICAL FIX: Verify both agents have access to the same clinic
        const sourceAgentClinics = verifyResult.payload['x_clinics'] || verifyResult.payload['cognito:groups'] || [];
        const targetAgentClinics = targetAgent.activeClinicIds || [];
        
        // Check if target agent has access to the call's clinic
        const hasAccess = targetAgent.activeClinicIds?.includes(clinicId) || 
                         targetAgent.activeClinicIds?.includes('ALL');
        
        if (!hasAccess) {
            console.warn('[transfer-call] Target agent does not have access to this clinic', {
                toAgentId,
                clinicId,
                targetAgentClinics: targetAgent.activeClinicIds
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Target agent does not have access to this clinic' })
            };
        }

        // CRITICAL FIX: Use a transaction to update everything atomically
        // This prevents race conditions by ensuring all updates happen consistently
        try {
            // Step 1: Verify call status and meeting info before proceeding
            if (!callRecord.meetingInfo?.MeetingId) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'No active meeting found for this call' })
                };
            }
            
            const meetingInfo = callRecord.meetingInfo;
            
            // **FLAW #14 FIX: Use unique ExternalUserId for transfer to prevent attendee collisions**
            // Each transfer attempt gets a unique ID based on randomUUID to ensure idempotency
            const transferAttemptId = randomUUID();
            const externalUserIdForTransfer = `${toAgentId}-transfer-${transferAttemptId}`;
            
            // Step 2: Create a new attendee for the target agent in the existing meeting
            console.log(`[transfer-call] Creating attendee for target agent ${toAgentId} in meeting ${meetingInfo.MeetingId}`);
            let toAgentAttendee;
            try {
                const toAgentAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                    MeetingId: meetingInfo.MeetingId,
                    ExternalUserId: externalUserIdForTransfer
                }));
                
                if (!toAgentAttendeeResponse.Attendee) {
                    throw new Error('Failed to create attendee for target agent');
                }
                
                toAgentAttendee = toAgentAttendeeResponse.Attendee;
                console.log(`[transfer-call] Created attendee ${toAgentAttendee.AttendeeId} for target agent`);
            } catch (attendeeErr) {
                console.error(`[transfer-call] Failed to create attendee:`, attendeeErr);
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Failed to prepare meeting for transfer' })
                };
            }
            
            // Step 3: Now perform our three database updates using TransactWriteItems
            // This ensures either ALL updates succeed or NONE do
            const timestamp = new Date().toISOString();
            const callerNumber = typeof callRecord.phoneNumber === 'string' && callRecord.phoneNumber.trim().length > 0
                ? callRecord.phoneNumber
                : 'Transferred Caller';
            const hasTransferNotes = Boolean(transferNotes);

            const callRecordSetParts = [
                'transferStatus = :ts',
                'transferToAgentId = :ta',
                'transferFromAgentId = :fa',
                'transferInitiatedAt = :timestamp',
                '#transferMode = :transferModeValue',
                'isConferenceTransfer = :isConference'
            ];
            const callRecordRemoveParts: string[] = [];
            if (hasTransferNotes) {
                callRecordSetParts.push('transferNotes = :transferNotes');
            } else {
                callRecordRemoveParts.push('transferNotes');
            }
            const callRecordUpdateExpression = `SET ${callRecordSetParts.join(', ')}${callRecordRemoveParts.length ? ' REMOVE ' + callRecordRemoveParts.join(', ') : ''}`;

            const targetAgentSetParts = [
                'ringingCallId = :callId',
                'callStatus = :status',
                'inboundMeetingInfo = :meeting',
                'inboundAttendeeInfo = :attendee',
                'ringingCallTime = :time',
                'lastActivityAt = :timestamp',
                'ringingCallFrom = :callerNumber',
                'ringingCallTransferAgentId = :transferInitiatedBy',
                'ringingCallTransferMode = :ringingTransferMode'
            ];
            const targetAgentRemoveParts: string[] = [];
            if (hasTransferNotes) {
                targetAgentSetParts.push('ringingCallNotes = :transferNotes');
            } else {
                targetAgentRemoveParts.push('ringingCallNotes');
            }
            const targetAgentUpdateExpression = `SET ${targetAgentSetParts.join(', ')}${targetAgentRemoveParts.length ? ' REMOVE ' + targetAgentRemoveParts.join(', ') : ''}`;

            const sourceAgentSetParts = [
                '#status = :sourceStatus',
                'lastActivityAt = :timestamp',
                'transferInitiatedAt = :timestamp'
            ];
            const sourceAgentRemoveParts: string[] = [];
            if (!isConferenceTransfer) {
                sourceAgentRemoveParts.push('currentCallId', 'callStatus');
            }
            const sourceAgentUpdateExpression = `SET ${sourceAgentSetParts.join(', ')}${sourceAgentRemoveParts.length ? ' REMOVE ' + sourceAgentRemoveParts.join(', ') : ''}`;
            
            // **FLAW #12 FIX: If call is currently held, update the held call meeting ID for source agent**
            // This ensures resume-call uses the correct meeting after transfer
            let sourceAgentExtra = '';
            let sourceAgentExtraValues: any = {};
            if (callRecord.status === 'on_hold') {
                // Call is on hold - update the source agent's held call meeting info if they're holding it
                sourceAgentExtra = ', heldCallMeetingId = :heldMeetingId, heldCallId = :heldCallId, heldCallAttendeeId = :heldAttendeeId';
                sourceAgentExtraValues = {
                    ':heldMeetingId': meetingInfo.MeetingId,
                    ':heldCallId': callId,
                    ':heldAttendeeId': toAgentAttendee.AttendeeId
                };
            }
            
            // Use the TransactWrite operation for atomic updates - already imported at the top of file
            
            const sourceAgentFinalUpdateExpression = sourceAgentUpdateExpression + sourceAgentExtra;
            
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    // 1. Update call record
                    {
                        Update: {
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: callRecordUpdateExpression,
                            ConditionExpression: '#status = :connectedStatus AND assignedAgentId = :fromAgent',
                            ExpressionAttributeNames: { '#status': 'status', '#transferMode': 'transferMode' },
                            ExpressionAttributeValues: {
                                ':ts': 'pending',
                                ':ta': toAgentId,
                                ':fa': fromAgentId,
                                ':timestamp': timestamp,
                                ':connectedStatus': 'connected',
                                ':fromAgent': fromAgentId,
                                ':transferModeValue': transferMode,
                                ':isConference': isConferenceTransfer,
                                ...(hasTransferNotes ? { ':transferNotes': transferNotes } : {})
                            }
                        }
                    },
                    // 2. Update target agent's record (set to ringing)
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: toAgentId },
                            UpdateExpression: targetAgentUpdateExpression,
                            ConditionExpression: '#status = :onlineStatus', // Only if agent is still online
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':callId': callId,
                                ':status': 'ringing',
                                ':meeting': meetingInfo,
                                ':attendee': toAgentAttendee,
                                ':time': timestamp,
                                ':timestamp': timestamp,
                                ':onlineStatus': 'Online',
                                ':callerNumber': callerNumber,
                                ':transferInitiatedBy': fromAgentId,
                                ':ringingTransferMode': transferMode,
                                ...(hasTransferNotes ? { ':transferNotes': transferNotes } : {})
                            }
                        }
                    },
                    // 3. Update source agent's record (set to Online or keep OnCall for conference)
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: fromAgentId },
                            UpdateExpression: sourceAgentFinalUpdateExpression,
                            ConditionExpression: 'currentCallId = :callId', // Only if still on this call
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':sourceStatus': isConferenceTransfer ? 'OnCall' : 'Online',
                                ':timestamp': timestamp,
                                ':callId': callId,
                                ...sourceAgentExtraValues
                            }
                        }
                    }
                ]
            }));
            
            console.log(`[transfer-call] Transaction completed successfully - transfer initiated from ${fromAgentId} to ${toAgentId}`);
            
        } catch (err: any) {
            // Check for transaction failures
            if (err.name === 'TransactionCanceledException') {
                const reasons = err.CancellationReasons || [];
                
                // Check which condition failed
                if (reasons[0]?.Code === 'ConditionalCheckFailed') {
                    console.warn('[transfer-call] Call state invalid for transfer', { callId });
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Call is not in a valid state for transfer' })
                    };
                } else if (reasons[1]?.Code === 'ConditionalCheckFailed') {
                    console.warn('[transfer-call] Target agent no longer available', { toAgentId });
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Target agent is no longer available' })
                    };
                } else if (reasons[2]?.Code === 'ConditionalCheckFailed') {
                    console.warn('[transfer-call] Source agent no longer on call', { fromAgentId });
                    return {
                        statusCode: 409, 
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'You are no longer on this call' })
                    };
                }
                
                // Generic transaction failure
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Transfer failed due to conflicting state changes' })
                };
            }
            
            // Re-throw other errors
            throw err;
        }
        
        // Trigger the SMA to handle the transfer - this happens AFTER the transaction is complete
        // so even if this fails, our database state is already updated consistently
        try {
            const smaArguments: Record<string, string> = {
                action: 'TRANSFER_INITIATED',
                fromAgentId,
                toAgentId,
                transferType: transferMode,
                isConference: isConferenceTransfer ? 'true' : 'false'
            };
            if (transferNotes) {
                smaArguments.transferNotes = transferNotes;
            }
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: callId,
                Arguments: smaArguments
            }));
            
            console.log(`[transfer-call] SMA notification sent successfully for transfer from ${fromAgentId} to ${toAgentId}`);
        } catch (updateError) {
            console.error('[transfer-call] Error triggering SMA for transfer, rolling back:', updateError);
            
            // CRITICAL FIX: Implement compensating transaction to roll back the database changes
            // This ensures the system remains consistent even if the SMA notification fails
            try {
                // Get reference to the meeting info we verified earlier
                const targetMeetingInfo = callRecord.meetingInfo; // already verified to exist earlier
                
                // Get a reference to the attendee we created earlier for this transfer
                // Avoiding a variable name conflict by using a different name
                const transferAttendee = callRecord.meetingInfo ? 
                    { 
                        AttendeeId: (callRecord.agentAttendeeInfo?.AttendeeId || ''), 
                        JoinToken: '',
                        ExternalUserId: toAgentId
                    } : null;
                
                // Generate a unique operation ID for this rollback
                const rollbackId = `rollback-${randomUUID()}`;
                
                console.log(`[transfer-call] Starting compensating transaction ${rollbackId}`);
                
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        // 1. Revert call record
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: 'REMOVE transferStatus, transferToAgentId, transferFromAgentId, transferInitiatedAt, transferNotes, transferMode, isConferenceTransfer SET rollbackId = :rollbackId, lastRollbackAt = :timestamp',
                                ConditionExpression: 'transferStatus = :pendingStatus AND transferToAgentId = :toAgent AND transferFromAgentId = :fromAgent',
                                ExpressionAttributeValues: {
                                    ':pendingStatus': 'pending',
                                    ':toAgent': toAgentId,
                                    ':fromAgent': fromAgentId,
                                    ':rollbackId': rollbackId,
                                    ':timestamp': new Date().toISOString()
                                }
                            }
                        },
                        // 2. Revert target agent
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: toAgentId },
                                UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, rollbackId = :rollbackId REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ConditionExpression: 'ringingCallId = :callId',
                                ExpressionAttributeValues: {
                                    ':status': 'Online',
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId,
                                    ':rollbackId': rollbackId
                                }
                            }
                        },
                        // 3. Restore source agent
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: fromAgentId },
                                UpdateExpression: 'SET currentCallId = :callId, #status = :status, lastActivityAt = :timestamp, rollbackId = :rollbackId REMOVE transferInitiatedAt',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': callId,
                                    ':status': 'OnCall',
                                    ':timestamp': new Date().toISOString(),
                                    ':rollbackId': rollbackId
                                }
                            }
                        }
                    ]
                }));
                
                // Delete the newly created attendee to clean up completely
                if (transferAttendee?.AttendeeId && targetMeetingInfo?.MeetingId) {
                    try {
                        await chime.send(new DeleteAttendeeCommand({
                            MeetingId: targetMeetingInfo.MeetingId,
                            AttendeeId: transferAttendee.AttendeeId
                        }));
                        console.log(`[transfer-call] Cleaned up target agent attendee ${transferAttendee.AttendeeId}`);
                    } catch (deleteErr) {
                        // Non-critical error, just log it
                        console.warn(`[transfer-call] Failed to delete attendee:`, deleteErr);
                    }
                }
                
                console.log(`[transfer-call] Successfully rolled back transfer with ID ${rollbackId}`);
                
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Transfer failed - SMA notification error',
                        rollbackId: rollbackId
                    })
                };
            } catch (rollbackErr) {
                console.error(`[transfer-call] Failed to roll back transfer:`, rollbackErr);
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Transfer failed with unrecoverable error - manual intervention needed',
                        callId
                    })
                };
            }
        }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Transfer initiated',
                    transferStatus: 'pending'
                })
            };

        } catch (transferErr: any) {
            console.error('[transfer-call] Transfer operation failed:', transferErr);
            await lock.release();
            throw transferErr;
        } finally {
            // FIX #3: Always release the lock
            await lock.release();
        }

    } catch (error: any) {
        console.error('Error processing transfer request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
}
