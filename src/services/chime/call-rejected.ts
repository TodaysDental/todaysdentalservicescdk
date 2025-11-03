import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({});
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;

/**
 * Lambda handler for call rejection notification
 * This is triggered when an agent rejects an incoming call
 * Updates the database and attempts to find another available agent
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Log function invocation with request metadata
    console.log('[call-rejected] Function invoked', {
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
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, reason } = body;
        
        console.log('[call-rejected] Parsed request body', {
          callId,
          agentId,
          reason,
          hasCallId: !!callId,
          hasAgentId: !!agentId
        });

        if (!callId || !agentId) {
            console.error('[call-rejected] Missing required parameters', {
              hasCallId: !!callId,
              hasAgentId: !!agentId
            });
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // 1. Get the current call details from the call queue table
        console.log('[call-rejected] Retrieving call details', { callId });
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: {
                ':callId': callId
            }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.error('[call-rejected] Call not found', { callId });
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;
        
        console.log('[call-rejected] Current call state', {
          callId,
          clinicId: callRecord.clinicId,
          currentAgents: callRecord.agentIds?.length || 0,
          callStatus: callRecord.callStatus
        });

        // 2. CRITICAL FIX: Verify the call hasn't already been accepted before processing rejection
        // This prevents race conditions where one agent accepts while another rejects
        if (callRecord.status === 'connected' || callRecord.assignedAgentId) {
            console.warn('[call-rejected] Call already accepted by another agent', {
                callId,
                status: callRecord.status,
                assignedAgent: callRecord.assignedAgentId
            });
            
            // Clean up this agent's ringing status
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo SET lastActivityAt = :timestamp',
                ExpressionAttributeValues: {
                    ':timestamp': new Date().toISOString()
                }
            }));
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call already accepted by another agent',
                    callId,
                    agentId,
                    action: 'already_connected'
                })
            };
        }
        
        // 3. Remove the rejecting agent from the list of available agents
        const remainingAgents = callRecord.agentIds?.filter((id: string) => id !== agentId) || [];
        
        // 4. Update the agent's status to remove the ringing call
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo SET lastActivityAt = :timestamp, lastRejectedCallId = :callId',
            ExpressionAttributeValues: {
                ':timestamp': new Date().toISOString(),
                ':callId': callId
            }
        }));

        // 5. If there are remaining agents, update the call record with conditional check
        if (remainingAgents.length > 0) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET agentIds = :agents, rejectedAgents = list_append(if_not_exists(rejectedAgents, :empty), :rejected)',
                    ConditionExpression: '#status = :ringingStatus AND attribute_not_exists(assignedAgentId)',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':agents': remainingAgents,
                        ':empty': [],
                        ':rejected': [{
                            agentId,
                            reason: reason || 'manual_rejection',
                            timestamp: new Date().toISOString()
                        }],
                        ':ringingStatus': 'ringing'
                    }
                }));
            } catch (err: any) {
                if (err.name === 'ConditionalCheckFailedException') {
                    console.warn('[call-rejected] Call state changed during rejection processing', { callId });
                    return {
                        statusCode: 200,
                        headers: corsHeaders,
                        body: JSON.stringify({ 
                            message: 'Call already handled by another agent',
                            callId,
                            agentId,
                            action: 'already_handled'
                        })
                    };
                }
                throw err;
            }

            console.log(`Call ${callId} rejected by agent ${agentId}. ${remainingAgents.length} agents remaining.`);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call rejection recorded',
                    callId,
                    agentId,
                    remainingAgents: remainingAgents.length,
                    action: 'continue_ringing'
                })
            };
        } else {
            // 6. No more agents available - need to find new agents or queue the call
            console.log(`Call ${callId} rejected by last agent ${agentId}. Finding new agents...`);

            // Try to find new online agents for the clinic
            const { Items: newAgents } = await ddb.send(new QueryCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                IndexName: 'status-index',
                KeyConditionExpression: '#status = :status',
                FilterExpression: 'contains(activeClinicIds, :clinicId) AND NOT contains(:rejected, agentId)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'Online',
                    ':clinicId': callRecord.clinicId,
                    ':rejected': callRecord.rejectedAgents?.map((r: any) => r.agentId) || []
                }
            }));

            if (newAgents && newAgents.length > 0) {
                // Found new agents - update the call record
                const newAgentIds = newAgents.map(a => a.agentId);
                
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET agentIds = :agents, retriedAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':agents': newAgentIds,
                        ':timestamp': new Date().toISOString()
                    }
                }));

                // Notify the SMA to ring the new agents
                if (!SMA_ID) {
                    console.error('[call-rejected] SMA_ID environment variable is missing');
                    return {
                        statusCode: 500,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Server configuration error: Missing SMA_ID' })
                    };
                }
                
                try {
                    await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                        SipMediaApplicationId: SMA_ID,
                        TransactionId: callId,
                        Arguments: {
                            action: 'RING_NEW_AGENTS',
                            agentIds: newAgentIds.join(',')
                        }
                    }));
                } catch (updateError) {
                    console.error('Error updating SMA call:', updateError);
                }

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Found new agents',
                        callId,
                        newAgentCount: newAgents.length,
                        action: 'ringing_new_agents'
                    })
                };
            } else {
                // No agents available - update call status
                // CRITICAL FIX: Clean up meeting if it exists
                if (callRecord.meetingInfo?.MeetingId) {
                    try {
                        // Clean up the meeting since no agent will be joining
                        await chime.send(new DeleteMeetingCommand({
                            MeetingId: callRecord.meetingInfo.MeetingId
                        }));
                        console.log(`[call-rejected] Cleaned up meeting ${callRecord.meetingInfo.MeetingId} with no available agents`);
                        
                        // Update call record and remove meeting info
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, noAgentsAvailableAt = :timestamp, cleanupReason = :reason REMOVE meetingInfo, customerAttendeeInfo',
                            ExpressionAttributeNames: {
                                '#status': 'status'
                            },
                            ExpressionAttributeValues: {
                                ':status': 'no_agents_available',
                                ':timestamp': new Date().toISOString(),
                                ':reason': 'no_agents_available'
                            }
                        }));
                    } catch (meetingErr) {
                        console.error(`[call-rejected] Error cleaning up meeting:`, meetingErr);
                        
                        // Still update the call record even if meeting cleanup fails
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, noAgentsAvailableAt = :timestamp',
                            ExpressionAttributeNames: {
                                '#status': 'status'
                            },
                            ExpressionAttributeValues: {
                                ':status': 'no_agents_available',
                                ':timestamp': new Date().toISOString()
                            }
                        }));
                    }
                } else {
                    // No meeting to clean up, just update status
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition },
                        UpdateExpression: 'SET #status = :status, noAgentsAvailableAt = :timestamp',
                        ExpressionAttributeNames: {
                            '#status': 'status'
                        },
                        ExpressionAttributeValues: {
                            ':status': 'no_agents_available',
                            ':timestamp': new Date().toISOString()
                        }
                    }));
                }

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'No agents available',
                        callId,
                        action: 'queue_or_voicemail'
                    })
                };
            }
        }

    } catch (error) {
        console.error('Error processing call rejection:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};
