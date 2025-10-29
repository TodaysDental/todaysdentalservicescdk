import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({});
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;

/**
 * Lambda handler for call rejection notification
 * This is triggered when an agent rejects an incoming call
 * Updates the database and attempts to find another available agent
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Call rejected event:', JSON.stringify(event, null, 2));
    
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

        if (!callId || !agentId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // 1. Get the current call details
        const { Item: callRecord } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { callId }
        }));

        if (!callRecord) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        // 2. Remove the rejecting agent from the list of available agents
        const remainingAgents = callRecord.agentIds?.filter((id: string) => id !== agentId) || [];
        
        // 3. Update the agent's status to remove the ringing call
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'REMOVE ringingCallId SET lastActivityAt = :timestamp, lastRejectedCallId = :callId',
            ExpressionAttributeValues: {
                ':timestamp': new Date().toISOString(),
                ':callId': callId
            }
        }));

        // 4. If there are remaining agents, update the call record
        if (remainingAgents.length > 0) {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { callId },
                UpdateExpression: 'SET agentIds = :agents, rejectedAgents = list_append(if_not_exists(rejectedAgents, :empty), :rejected)',
                ExpressionAttributeValues: {
                    ':agents': remainingAgents,
                    ':empty': [],
                    ':rejected': [{
                        agentId,
                        reason: reason || 'manual_rejection',
                        timestamp: new Date().toISOString()
                    }]
                }
            }));

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
            // 5. No more agents available - need to find new agents or queue the call
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
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { callId },
                    UpdateExpression: 'SET agentIds = :agents, retriedAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':agents': newAgentIds,
                        ':timestamp': new Date().toISOString()
                    }
                }));

                // Notify the SMA to ring the new agents
                if (SMA_ID) {
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
                }

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Found new agents',
                        callId,
                        newAgentCount: newAgentIds.length,
                        action: 'ringing_new_agents'
                    })
                };
            } else {
                // No agents available - update call status
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { callId },
                    UpdateExpression: 'SET callStatus = :status, noAgentsAvailableAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':status': 'no_agents_available',
                        ':timestamp': new Date().toISOString()
                    }
                }));

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
