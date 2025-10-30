import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

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

        // Update the call status to 'connected' and assign the agent
        console.log('[call-accepted] Updating call status to connected', { callId, agentId, clinicId });
        await ddb.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId, queuePosition },
            UpdateExpression: 'SET #status = :status, assignedAgentId = :agentId, acceptedAt = :timestamp',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'connected',
                ':agentId': agentId,
                ':timestamp': new Date().toISOString()
            }
        }));
        console.log('[call-accepted] Call status updated successfully');

        // 2. Update the agent's status to indicate they're on a call
        console.log('[call-accepted] Updating agent status to OnCall', { agentId });
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET #status = :status, currentCallId = :callId, lastActivityAt = :timestamp',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'OnCall',
                ':callId': callId,
                ':timestamp': new Date().toISOString()
            }
        }));
        console.log('[call-accepted] Agent status updated to OnCall');

        // 3. Update all other agents who were ringing for this call to stop ringing
        // Get the list of agents from the call record
        if (callRecord.agentIds && callRecord.agentIds.length > 0) {
            const otherAgents = callRecord.agentIds.filter((id: string) => id !== agentId);
            
            // Update each other agent's ringing status
            await Promise.all(otherAgents.map((otherAgentId: string) => 
                ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: otherAgentId },
                    UpdateExpression: 'REMOVE ringingCallId SET lastActivityAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':timestamp': new Date().toISOString()
                    }
                }))
            ));
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
