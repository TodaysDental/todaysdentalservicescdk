/**
 * WebSocket Message Handler for AI Agents
 * 
 * Handles chat messages and streams AI thinking + response back to the client.
 * Uses Bedrock Agent Runtime with trace enabled to show agent reasoning.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

interface WebSocketMessageEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent['requestContext'] & {
    connectionId: string;
    domainName: string;
    stage: string;
  };
}
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { v4 as uuidv4 } from 'uuid';
import { AiAgent } from './agents';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'AiAgentConnections';

// ========================================================================
// TYPES
// ========================================================================

interface WebSocketMessage {
  action?: string;
  message: string;
  sessionId?: string;
  visitorName?: string;
  visitorId?: string;
}

interface StreamEvent {
  type: 'thinking' | 'chunk' | 'tool_use' | 'tool_result' | 'complete' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
  sessionId?: string;
  timestamp?: string;
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function createApiGatewayClient(event: WebSocketMessageEvent): ApiGatewayManagementApiClient {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `https://${domain}/${stage}`;
  
  return new ApiGatewayManagementApiClient({ endpoint });
}

async function sendToClient(
  apiClient: ApiGatewayManagementApiClient,
  connectionId: string,
  data: StreamEvent
): Promise<boolean> {
  try {
    await apiClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data)),
    }));
    return true;
  } catch (error: any) {
    if (error.statusCode === 410) {
      // Connection is stale, remove it
      console.log('Stale connection, removing:', connectionId);
      return false;
    }
    console.error('Error sending to client:', error);
    return false;
  }
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: WebSocketMessageEvent) => {
  console.log('WebSocket Message:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const apiClient = createApiGatewayClient(event);

  try {
    // Parse message
    const body: WebSocketMessage = JSON.parse(event.body || '{}');
    
    if (!body.message) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'message is required',
      });
      return { statusCode: 400 };
    }

    // Get connection info (clinicId, agentId)
    const connectionResponse = await docClient.send(new GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
    }));

    const connectionInfo = connectionResponse.Item;
    if (!connectionInfo) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'Connection not found. Please reconnect.',
      });
      return { statusCode: 400 };
    }

    const { clinicId, agentId } = connectionInfo;

    // Get agent configuration
    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
    }));

    const agent = agentResponse.Item as AiAgent | undefined;
    if (!agent) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'Agent not found',
      });
      return { statusCode: 404 };
    }

    // Validate agent
    if (!agent.isActive || !agent.isWebsiteEnabled) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'Agent is not available for website chat',
      });
      return { statusCode: 403 };
    }

    if (agent.clinicId !== clinicId && !agent.isPublic) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'Agent does not belong to this clinic',
      });
      return { statusCode: 403 };
    }

    if (!agent.bedrockAgentId || !agent.bedrockAgentAliasId || agent.bedrockAgentStatus !== 'PREPARED') {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: 'Agent is not ready. Please try again later.',
      });
      return { statusCode: 400 };
    }

    // Generate or use session ID
    const sessionId = body.sessionId || uuidv4();

    // Build session attributes
    const sessionAttributes: Record<string, string> = {
      clinicId,
      userId: body.visitorId || `visitor-${uuidv4().slice(0, 8)}`,
      userName: body.visitorName || 'Website Visitor',
      isPublicRequest: 'true',
    };

    // Send thinking start
    await sendToClient(apiClient, connectionId, {
      type: 'thinking',
      content: 'Processing your request...',
      sessionId,
      timestamp: new Date().toISOString(),
    });

    // Invoke Bedrock Agent with trace enabled
    const invokeCommand = new InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId,
      inputText: body.message,
      enableTrace: true,  // Enable thinking/trace
      sessionState: {
        sessionAttributes,
      },
    });

    const bedrockResponse = await bedrockAgentClient.send(invokeCommand);

    // Stream response and trace events
    let fullResponse = '';

    if (bedrockResponse.completion) {
      for await (const event of bedrockResponse.completion) {
        // Handle trace events (thinking)
        if (event.trace?.trace) {
          const trace = event.trace.trace;

          // Pre-processing trace (understanding the request)
          if (trace.preProcessingTrace) {
            const preProc = trace.preProcessingTrace;
            if (preProc.modelInvocationOutput?.parsedResponse?.rationale) {
              await sendToClient(apiClient, connectionId, {
                type: 'thinking',
                content: `Understanding: ${preProc.modelInvocationOutput.parsedResponse.rationale}`,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Orchestration trace (tool usage)
          if (trace.orchestrationTrace) {
            const orch = trace.orchestrationTrace;

            // Model thinking/rationale
            if (orch.modelInvocationOutput?.rawResponse?.content) {
              const content = orch.modelInvocationOutput.rawResponse.content;
              if (typeof content === 'string') {
                // Try to extract thinking from the content
                const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
                if (thinkingMatch) {
                  await sendToClient(apiClient, connectionId, {
                    type: 'thinking',
                    content: thinkingMatch[1].trim(),
                    timestamp: new Date().toISOString(),
                  });
                }
              }
            }

            // Tool invocation
            if (orch.invocationInput?.actionGroupInvocationInput) {
              const action = orch.invocationInput.actionGroupInvocationInput;
              await sendToClient(apiClient, connectionId, {
                type: 'tool_use',
                toolName: action.apiPath?.replace('/', '') || 'unknown',
                toolInput: action.parameters || action.requestBody,
                content: `Calling: ${action.apiPath}`,
                timestamp: new Date().toISOString(),
              });
            }

            // Tool result
            if (orch.observation?.actionGroupInvocationOutput) {
              const result = orch.observation.actionGroupInvocationOutput;
              let resultContent = 'Tool completed';
              
              try {
                const parsed = JSON.parse(result.text || '{}');
                if (parsed.status === 'SUCCESS') {
                  resultContent = parsed.message || 'Operation successful';
                } else if (parsed.status === 'FAILURE') {
                  resultContent = parsed.message || 'Operation failed';
                }
              } catch {
                // Ignore parse errors
              }

              await sendToClient(apiClient, connectionId, {
                type: 'tool_result',
                content: resultContent,
                toolResult: result.text,
                timestamp: new Date().toISOString(),
              });
            }

            // Rationale/thinking
            if (orch.rationale?.text) {
              await sendToClient(apiClient, connectionId, {
                type: 'thinking',
                content: orch.rationale.text,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Post-processing trace
          if (trace.postProcessingTrace?.modelInvocationOutput?.parsedResponse) {
            const postProc = trace.postProcessingTrace.modelInvocationOutput.parsedResponse;
            if (postProc.text) {
              await sendToClient(apiClient, connectionId, {
                type: 'thinking',
                content: `Finalizing: ${postProc.text}`,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }

        // Handle response chunks
        if (event.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event.chunk.bytes);
          fullResponse += chunk;

          await sendToClient(apiClient, connectionId, {
            type: 'chunk',
            content: chunk,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Send completion event
    await sendToClient(apiClient, connectionId, {
      type: 'complete',
      content: fullResponse || 'No response from agent',
      sessionId,
      timestamp: new Date().toISOString(),
    });

    // Update agent usage count
    await docClient.send(new UpdateCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }));

    return { statusCode: 200 };
  } catch (error: any) {
    console.error('WebSocket message error:', error);

    await sendToClient(apiClient, connectionId, {
      type: 'error',
      content: error.message || 'An error occurred processing your request',
      timestamp: new Date().toISOString(),
    });

    return { statusCode: 500 };
  }
};

