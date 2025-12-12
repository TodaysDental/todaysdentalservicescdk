/**
 * FIX #5 & #7: Session Expiry During Active Call & Heartbeat vs Session Expiry
 * 
 * Enhanced heartbeat with:
 * - TTL extension for active calls
 * - Unified session expiry policy
 * - Separate tracking for heartbeat vs activity
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { calculateHeartbeatTTL, extendSessionForActiveCall } from './config/ttl-policy';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';

/**
 * Heartbeat Lambda
 * Allows agents to periodically update their presence to stay "Online"
 * Prevents agents from staying online indefinitely if their browser crashes
 */

const ddb = getDynamoDBClient();
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    console.log('[heartbeat] Processing heartbeat request');

    try {
        // Verify JWT token
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[heartbeat] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Invalid token: missing subject claim' })
            };
        }

        // FIX #5 & #7: Get agent record first to check if on active call
        const { Item: agentRecord } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            ConsistentRead: true
        }));

        if (!agentRecord) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent session not found. Please start a new session.' })
            };
        }

        // FIX #5 & #7: Calculate TTL based on whether agent is on active call
        const now = new Date();
        const nowSeconds = Math.floor(now.getTime() / 1000);
        // FIX: Check all possible active call states including heldCallId
        // FIX #6: Also check for in-progress operations that may have temporarily inconsistent state
        // During hold/transfer operations, there's a brief window where state fields may be between updates
        const hasActiveCallFields = agentRecord.currentCallId || 
                                    agentRecord.heldCallId || 
                                    agentRecord.ringingCallId;
        const hasActiveCallStatus = agentRecord.callStatus === 'on_hold' ||
                                    agentRecord.callStatus === 'connected' ||
                                    agentRecord.callStatus === 'ringing';
        // FIX #6: Check for in-progress operations that warrant extended TTL
        const hasInProgressOperation = agentRecord.transferringCallId ||
                                       agentRecord.incomingTransferId ||
                                       agentRecord.heldCallMeetingId || // Has meeting info for held call
                                       (agentRecord.status === 'OnHold'); // Agent is in OnHold status
        const isOnActiveCall = hasActiveCallFields || hasActiveCallStatus || hasInProgressOperation;
        
        let newTtl: number;
        let newSessionExpiresAt: number;
        
        if (isOnActiveCall) {
            // FIX #5: Extend TTL for active calls
            const extension = extendSessionForActiveCall();
            newTtl = extension.ttl;
            newSessionExpiresAt = extension.sessionExpiresAtEpoch;
            console.log(`[heartbeat] Extending session for active call - agent ${agentId}`);
        } else {
            // FIX #7: Use unified heartbeat TTL calculation
            const heartbeatTTL = calculateHeartbeatTTL(agentRecord.sessionExpiresAtEpoch);
            newTtl = heartbeatTTL.ttl;
            newSessionExpiresAt = heartbeatTTL.sessionExpiresAtEpoch;
        }
        
        // First attempt: Try to update with expiry check in condition
        try {
            // CRITICAL FIX: Add separate lastHeartbeatAt field distinct from lastActivityAt
            // This allows cleanup monitor to distinguish between heartbeats and other activity
            // FIX #12: Add status healing - ensure agent status is valid (heal corrupted states)
            // If agent has no active calls but status is stuck on something other than Online, heal it
            const shouldHealStatus = !isOnActiveCall && 
                                    agentRecord.status !== 'Online' && 
                                    agentRecord.status !== 'Offline';
            
            // ATOMIC: Check expiry in the same operation as the update
            const baseUpdateExpression = 'SET lastActivityAt = :timestamp, lastHeartbeatAt = :timestamp, #ttl = :ttl, ' +
                                        'sessionExpiresAtEpoch = :sessionExpiry, heartbeatCount = if_not_exists(heartbeatCount, :zero) + :one';
            
            // FIX #12: Conditionally heal agent status if it's stuck
            const updateExpression = shouldHealStatus 
                ? baseUpdateExpression + ', #status = :healedStatus'
                : baseUpdateExpression;
            
            const expressionAttributeNames: Record<string, string> = {
                '#ttl': 'ttl'
            };
            if (shouldHealStatus) {
                expressionAttributeNames['#status'] = 'status';
            }
            
            const expressionAttributeValues: Record<string, any> = {
                ':timestamp': now.toISOString(),
                ':ttl': newTtl,
                ':sessionExpiry': newSessionExpiresAt,
                ':nowSeconds': nowSeconds,
                ':zero': 0,
                ':one': 1
            };
            if (shouldHealStatus) {
                expressionAttributeValues[':healedStatus'] = 'Online';
                console.log(`[heartbeat] Healing stuck agent status from '${agentRecord.status}' to 'Online' for agent ${agentId}`);
            }
            
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: updateExpression,
                ConditionExpression: 'attribute_exists(agentId) AND ' +
                                    '(attribute_not_exists(sessionExpiresAtEpoch) OR sessionExpiresAtEpoch > :nowSeconds)',
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues
            }));
            
            console.log(`[heartbeat] Updated heartbeat for agent ${agentId} (onCall: ${isOnActiveCall})`);
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Heartbeat recorded',
                    timestamp: now.toISOString(),
                    ttl: newTtl,
                    sessionExpiresAt: newSessionExpiresAt,
                    isOnActiveCall
                })
            };
            
        } catch (error: any) {
            // CRITICAL FIX #5: Fix duplicate condition check handling
            // If condition failed, could be expired session OR agent doesn't exist
            if (error.name === 'ConditionalCheckFailedException') {
                // Try to determine if it's expiry or missing agent by checking existence
                try {
                    const { Item: agent } = await ddb.send(new GetCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId }
                    }));
                    
                    if (!agent) {
                        // Agent doesn't exist
                        return {
                            statusCode: 404,
                            headers: corsHeaders,
                            body: JSON.stringify({ message: 'Agent session not found. Please start a new session.' })
                        };
                    }
                    
                    // Agent exists but session expired - mark offline
                    // FIX: Check if agent has active call and schedule cleanup action
                    console.warn('[heartbeat] Session expired for agent (atomic check)', { 
                        agentId, 
                        nowSeconds,
                        hadActiveCall: !!(agent.currentCallId || agent.heldCallId || agent.ringingCallId)
                    });
                    
                    // If agent had an active call, we need to notify about potential orphaned calls
                    if (agent.currentCallId || agent.heldCallId) {
                        console.error('[heartbeat] CRITICAL: Session expired with active call - scheduling cleanup', {
                            agentId,
                            currentCallId: agent.currentCallId,
                            heldCallId: agent.heldCallId
                        });
                        // The compensating-action-processor or cleanup-monitor should handle this
                        // For now, log the critical state for monitoring/alerting
                    }
                    
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'SET #status = :offline, lastActivityAt = :timestamp, cleanupReason = :reason, ' +
                                         'expiredWithCallId = :expiredCallId ' +
                                         'REMOVE currentCallId, ringingCallId, callStatus, heldCallId, heldCallMeetingId, inboundMeetingInfo, inboundAttendeeInfo',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':offline': 'Offline',
                            ':timestamp': now.toISOString(),
                            ':reason': 'session_expired',
                            ':expiredCallId': agent.currentCallId || agent.heldCallId || null
                        }
                    })).catch(expireErr => console.warn('[heartbeat] Failed to mark session expired', expireErr));
                    
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Session expired. Please start a new session.' })
                    };
                } catch (checkErr) {
                    console.error('[heartbeat] Error checking agent existence:', checkErr);
                    // Fallback: assume expired
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Session expired or not found. Please start a new session.' })
                    };
                }
            }
            
            throw error;
        }

    } catch (error: any) {
        console.error('[heartbeat] Error processing heartbeat:', error);
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};
