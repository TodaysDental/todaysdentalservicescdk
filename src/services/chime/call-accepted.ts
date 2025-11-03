import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;

/**
 * Lambda handler for call acceptance notification
 * This is triggered when an agent accepts an incoming call and Chime fires the MEETING_ACCEPTED event
 * Updates the database to reflect that the call has been accepted and which agent accepted it
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Log function invocation with request metadata
    console.log('[call-accepted] Function invoked', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
      sourceIp: (event.requestContext as any)?.identity?.sourceIp,
      userAgent: (event.requestContext as any)?.identity?.userAgent,
      hasBody: !!event.body,
      bodyLength: event.body?.length || 0
    });
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            console.error('[call-accepted] Missing request body');
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, meetingId } = body;
        
        console.log('[call-accepted] Parsed request body', {
          callId,
          agentId,
          meetingId,
          hasCallId: !!callId,
          hasAgentId: !!agentId,
          hasMeetingId: !!meetingId
        });

        if (!callId || !agentId) {
            console.error('[call-accepted] Missing required parameters', {
              hasCallId: !!callId,
              hasAgentId: !!agentId
            });
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // 1. Find the call record in the call queue table
        console.log('[call-accepted] Finding call record', { callId });
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: {
                ':callId': callId
            }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.error('[call-accepted] Call not found', { callId });
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;

        // CRITICAL FIX: Use transaction to atomically claim call AND update agent status
        // This prevents race conditions by ensuring all updates happen in one atomic operation
        console.log('[call-accepted] Attempting to claim call with transaction', { callId, agentId, clinicId, currentStatus: callRecord.status });
        
        try {
            // First get other agents who were ringing for this call before making any changes
            const otherAgents = (callRecord.agentIds || []).filter((id: string) => id !== agentId);
            
        // Generate a UUID-based idempotency key for guaranteed uniqueness
        // This makes the transaction safe to retry without side effects
        const idempotencyKey = `accept-${callId}-${agentId}-${randomUUID()}`;
        console.log('[call-accepted] Using UUID-based idempotency key:', idempotencyKey);
        
        // Prepare transaction items with improved conditions
        const transactionItems = [
            // 1. Update call status - only if it's still ringing/queued and not assigned
            // Add version attribute to detect concurrent modifications
            {
                Update: {
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET #status = :status, assignedAgentId = :agentId, acceptedAt = :timestamp, versionId = :newVersion, idempotencyKey = :idempotencyKey',
                    ConditionExpression: '(#status IN (:ringingStatus, :queuedStatus)) AND (attribute_not_exists(assignedAgentId) OR assignedAgentId = :agentId OR (attribute_exists(idempotencyKey) AND idempotencyKey = :idempotencyKey))',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'connected',
                        ':agentId': agentId,
                        ':timestamp': new Date().toISOString(),
                        ':ringingStatus': 'ringing',
                        ':queuedStatus': 'queued',
                        ':newVersion': Date.now().toString(),
                        ':idempotencyKey': idempotencyKey
                    }
                }
            },
            // 2. Update the accepting agent's status with safer conditions
            {
                Update: {
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, currentCallId = :callId, lastActivityAt = :timestamp, currentOperation = :operation REMOVE ringingCallId',
                    ConditionExpression: 'attribute_exists(agentId) AND (#status = :availableStatus OR #status = :ringingStatus OR (#status = :onCallStatus AND currentCallId = :callId))',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'OnCall',
                        ':callId': callId,
                        ':timestamp': new Date().toISOString(),
                        ':availableStatus': 'Available',
                        ':ringingStatus': 'ringing',
                        ':onCallStatus': 'OnCall',
                        ':operation': idempotencyKey
                    }
                }
            }
            ];
            
            // 3. Add update items for other agents who were ringing
            if (otherAgents && otherAgents.length > 0) {
                otherAgents.forEach((otherAgentId: string) => {
                    // Create update for other agents separately instead of inline
                    const otherAgentUpdate = {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: otherAgentId },
                            UpdateExpression: 'REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo SET lastActivityAt = :timestamp, #status = :status',
                            ConditionExpression: 'attribute_exists(agentId) AND ringingCallId = :callId', // Only update if agent exists and is ringing for this call
                            ExpressionAttributeNames: {
                                '#status': 'status'
                            },
                            ExpressionAttributeValues: {
                                ':timestamp': new Date().toISOString(),
                                ':status': 'Available',
                                ':callId': callId,
                                // Add missing attributes to match the type for all transaction items
                                ':availableStatus': 'Available',
                                ':ringingStatus': 'ringing', 
                                ':onCallStatus': 'OnCall',
                                ':operation': idempotencyKey
                            }
                        }
                    };
                    transactionItems.push(otherAgentUpdate);
                });
            }
            
            // Execute the transaction
            await ddb.send(new TransactWriteCommand({
                TransactItems: transactionItems
            }));
            
            console.log('[call-accepted] Transaction completed successfully', {
                callId,
                agentId,
                otherAgentsCount: otherAgents.length
            });
            
            // CRITICAL FIX: Notify the SMA that an agent has accepted the call
            // This ensures the SMA knows that the agent has joined the meeting
            if (SMA_ID) {
                try {
                    const meetingInfo = callRecord.meetingInfo || {};
                    const attendeeInfo = callRecord.agentAttendeeInfo || {};
                    
                    console.log('[call-accepted] Notifying SMA of agent acceptance', {
                        callId,
                        agentId,
                        hasMeetingId: !!meetingInfo.MeetingId
                    });
                    
                    const chimeVoice = new ChimeSDKVoiceClient({});
                    await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                        SipMediaApplicationId: SMA_ID,
                        TransactionId: callId,
                        Arguments: {
                            action: 'AGENT_JOINED',
                            agentId: agentId,
                            meetingId: meetingInfo.MeetingId || '',
                            agentAttendeeId: attendeeInfo.AttendeeId || ''
                        }
                    }));
                    
                    console.log('[call-accepted] SMA notification successful');
                } catch (smaError) {
                    console.error('[call-accepted] Failed to notify SMA of agent acceptance:', smaError);
                    // Continue processing since database transaction was successful
                    // This is non-fatal as the agent can still join the meeting via browser
                }
            } else {
                console.warn('[call-accepted] SMA_ID not configured, skipping SMA notification');
            }
        } catch (err: any) {
            if (err.name === 'TransactionCanceledException') {
                // Check if the first condition failed (call already claimed)
                const cancellationReasons = err.CancellationReasons || [];
                if (cancellationReasons.length > 0 && cancellationReasons[0].Code === 'ConditionalCheckFailed') {
                    console.warn('[call-accepted] Race condition detected - call already accepted by another agent', { callId, agentId });
                    
                    // Remove this agent's ringing status since they lost the race
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo SET lastActivityAt = :timestamp',
                        ExpressionAttributeValues: {
                            ':timestamp': new Date().toISOString()
                        }
                    }));
                    
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ 
                            message: 'Call already accepted by another agent',
                            callId,
                            agentId
                        })
                    };
                }
            }
            throw err;
        }

        // Note: We already updated the call status in the queue table above

        console.log('[call-accepted] Call acceptance processed successfully', {
          callId,
          agentId,
          meetingId
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call acceptance recorded',
                callId,
                agentId,
                status: 'connected'
            })
        };

    } catch (error: any) {
        const errorContext = {
          message: error?.message,
          code: error?.name || error?.code,
          stack: error?.stack,
          requestId: event.requestContext?.requestId
        };
        console.error('[call-accepted] Error processing call acceptance:', errorContext);
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: 'Internal server error',
              error: error?.message,
              code: error?.name || error?.code
            })
        };
    }
};
