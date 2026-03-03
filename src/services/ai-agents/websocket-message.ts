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
  PutCommand,
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
import { ConversationMessage } from './conversation-history';
import { getDateContext, getClinicName, getClinicTimezone } from '../../shared/prompts/ai-prompts';

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
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || 'AiAgentConversations';

// ========================================================================
// PERFORMANCE: AGENT CACHING
// ========================================================================

// Cache agent config to avoid repeated DynamoDB lookups (agents rarely change)
const agentCache = new Map<string, { agent: AiAgent; timestamp: number }>();
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedAgent(agentId: string): Promise<AiAgent | null> {
  const cached = agentCache.get(agentId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }

  const response = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));

  const agent = response.Item as AiAgent | undefined;
  if (agent) {
    agentCache.set(agentId, { agent, timestamp: Date.now() });
  }
  return agent || null;
}

// ========================================================================
// CONVERSATION LOGGING
// ========================================================================

/**
 * Log a conversation message to DynamoDB for history and analytics.
 * This function does not throw - logging failures should not break the main flow.
 */
async function logMessage(
  message: Omit<ConversationMessage, 'ttl'>
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days

  try {
    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        ...message,
        ttl,
      },
    }));
  } catch (error) {
    console.error('[LogMessage] Failed to log conversation message:', error);
    // Don't throw - logging should not break the main flow
  }
}

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
// RATE LIMITING CONFIGURATION (DynamoDB-backed for distributed consistency)
// ========================================================================

const RATE_LIMIT = {
  MAX_MESSAGES_PER_MINUTE: 20,      // Max messages per connection per minute
  MESSAGE_WINDOW_MS: 60 * 1000,      // 1 minute window
  MAX_MESSAGE_LENGTH: 4000,          // Max characters per message
  MAX_SESSION_MESSAGES: 100,         // Max messages per session (aligned with REST API)
};

// Rate limit table - using connections table with rate limit fields
const RATE_LIMIT_TTL_SECONDS = 300; // 5 minutes TTL for rate limit records

/**
 * Check rate limit using DynamoDB for distributed consistency.
 * 
 * FIX: Previously used in-memory Map which allowed bypass across Lambda instances.
 * Now uses DynamoDB atomic counters for reliable distributed rate limiting.
 */
async function checkRateLimit(connectionId: string): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT.MESSAGE_WINDOW_MS) * RATE_LIMIT.MESSAGE_WINDOW_MS;
  const ttl = Math.floor(now / 1000) + RATE_LIMIT_TTL_SECONDS;

  try {
    // Get current connection with rate limit info
    const response = await docClient.send(new GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
    }));

    const connection = response.Item;
    if (!connection) {
      return { allowed: false, reason: 'Connection not found. Please reconnect.' };
    }

    // Check if we're in a new window
    const storedWindowStart = connection.rateLimitWindowStart || 0;
    const isNewWindow = windowStart > storedWindowStart;

    // Get current count (reset if new window)
    const currentCount = isNewWindow ? 0 : (connection.rateLimitCount || 0);

    // Check limit
    if (currentCount >= RATE_LIMIT.MAX_MESSAGES_PER_MINUTE) {
      const timeLeft = Math.ceil((storedWindowStart + RATE_LIMIT.MESSAGE_WINDOW_MS - now) / 1000);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Please wait ${Math.max(1, timeLeft)} seconds before sending more messages.`
      };
    }

    // Check session message limit
    const sessionMessageCount = connection.sessionMessageCount || 0;
    if (sessionMessageCount >= RATE_LIMIT.MAX_SESSION_MESSAGES) {
      return {
        allowed: false,
        reason: 'Session message limit reached. Please start a new session by reconnecting.',
      };
    }

    // Increment counter atomically
    // FIX: Only include :windowStart in ExpressionAttributeValues when isNewWindow is true
    // DynamoDB throws ValidationException for unused expression attribute values
    const expressionAttributeValues: Record<string, any> = {
      ':one': 1,
      ':zero': 0,
      ':ttl': ttl,
    };

    if (isNewWindow) {
      expressionAttributeValues[':windowStart'] = windowStart;
    }

    await docClient.send(new UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: isNewWindow
        ? 'SET rateLimitCount = :one, rateLimitWindowStart = :windowStart, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl'
        : 'SET rateLimitCount = rateLimitCount + :one, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    return { allowed: true };
  } catch (error) {
    console.error('[RateLimit] Error checking rate limit:', error);
    // Allow request on rate limit check failure (fail open for availability)
    // Log for monitoring but don't block legitimate requests
    return { allowed: true };
  }
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function createApiGatewayClient(event: WebSocketMessageEvent): ApiGatewayManagementApiClient {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiId = event.requestContext.apiId;
  const region = process.env.AWS_REGION || 'us-east-1';

  // FIX: When using custom domains with path mapping, the @connections endpoint
  // must use the execute-api URL format, not the custom domain.
  // Custom domain: ws.todaysdentalservices.com/ai-agents -> doesn't work for @connections
  // Execute-api: {api-id}.execute-api.{region}.amazonaws.com/{stage} -> works
  let endpoint: string;

  if (domain.includes('execute-api.amazonaws.com')) {
    // Direct execute-api URL (no custom domain)
    endpoint = `https://${domain}/${stage}`;
  } else {
    // Custom domain - use execute-api format instead
    endpoint = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;
    console.log(`[WsMessage] Using execute-api endpoint for @connections: ${endpoint}`);
  }

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

    // Validate message length
    if (body.message.length > RATE_LIMIT.MAX_MESSAGE_LENGTH) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: `Message too long. Maximum ${RATE_LIMIT.MAX_MESSAGE_LENGTH} characters allowed.`,
      });
      return { statusCode: 400 };
    }

    // Check rate limit (now uses DynamoDB for distributed consistency)
    const rateLimitCheck = await checkRateLimit(connectionId);
    if (!rateLimitCheck.allowed) {
      await sendToClient(apiClient, connectionId, {
        type: 'error',
        content: rateLimitCheck.reason || 'Rate limit exceeded.',
      });
      return { statusCode: 429 };
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

    // Get agent configuration (with caching for performance)
    const agent = await getCachedAgent(agentId);
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

    // SECURITY FIX: Generate session ID bound to this connection
    // NEVER accept client-provided sessionIds - always use server-generated ones
    // This prevents session hijacking where attacker guesses another user's sessionId
    let sessionId: string;

    if (connectionInfo.sessionId) {
      // Reuse existing session for this connection
      sessionId = connectionInfo.sessionId;

      // SECURITY: If client provided a different sessionId, log and ignore it
      if (body.sessionId && body.sessionId !== connectionInfo.sessionId) {
        console.warn(`[WebSocket] Client ${connectionId} attempted to use sessionId ${body.sessionId} but is bound to ${connectionInfo.sessionId}`);
        // Continue with the bound session, don't fail - just ignore the invalid sessionId
      }
    } else {
      // Create new session bound to this connection
      // Include connectionId prefix to ensure uniqueness per connection
      sessionId = `ws-${connectionId.slice(0, 8)}-${uuidv4()}`;

      // Store session binding in connection record atomically
      try {
        await docClient.send(new UpdateCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: 'SET sessionId = :sid',
          ExpressionAttributeValues: { ':sid': sessionId },
          // Only set if not already set (prevents race condition)
          ConditionExpression: 'attribute_not_exists(sessionId)',
        }));
      } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
          // Race condition: another message set the sessionId
          // Re-fetch the connection to get the real sessionId
          const refreshedConn = await docClient.send(new GetCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId },
          }));
          sessionId = refreshedConn.Item?.sessionId || sessionId;
        } else {
          throw error;
        }
      }
    }

    // Get timezone-aware date context + clinic display name for accurate scheduling & natural greetings
    const [clinicTimezone, clinicName] = await Promise.all([
      getClinicTimezone(clinicId),
      getClinicName(clinicId),
    ]);
    const dateContext = getDateContext(clinicTimezone);
    const [year, month, day] = dateContext.today.split('-');
    const todayFormatted = `${month}/${day}/${year}`;

    // Build session attributes
    const sessionAttributes: Record<string, string> = {
      clinicId,
      clinicName,
      userId: body.visitorId || `visitor-${uuidv4().slice(0, 8)}`,
      userName: body.visitorName || 'Website Visitor',
      isPublicRequest: 'true',
      connectionId, // Track which connection owns this session
      // Current date information for accurate scheduling (timezone-aware)
      todayDate: dateContext.today,
      todayFormatted: todayFormatted,
      dayName: dateContext.dayName,
      tomorrowDate: dateContext.tomorrowDate,
      currentTime: dateContext.currentTime,
      nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
      timezone: dateContext.timezone,
    };

    // Prompt session attributes are visible to the agent as context (useful for greetings + date logic)
    const promptSessionAttributes: Record<string, string> = {
      clinicName,
      currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
      dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`,
    };

    // Log user message to conversation history
    const userMessageTimestamp = Date.now();
    const visitorId = sessionAttributes.userId;
    const visitorName = sessionAttributes.userName;

    // Fire and forget - don't await to not slow down the response
    logMessage({
      sessionId,
      timestamp: userMessageTimestamp,
      messageType: 'user',
      content: body.message,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: 'websocket',
      isPublicChat: true,
    });

    // Send thinking start
    await sendToClient(apiClient, connectionId, {
      type: 'thinking',
      content: 'Processing your request...',
      sessionId,
      timestamp: new Date().toISOString(),
    });

    const invokeStartTime = Date.now();

    // PERFORMANCE: Disable trace for faster responses (trace adds overhead)
    // Only enable for debugging when needed
    const enableTrace = (body as any).enableTrace === true;

    // Invoke Bedrock Agent
    console.log('[WsMessage] Invoking Bedrock Agent:', {
      bedrockAgentId: agent.bedrockAgentId,
      bedrockAgentAliasId: agent.bedrockAgentAliasId,
      modelId: agent.modelId,
      agentName: agent.name,
      sessionId,
      enableTrace,
    });

    const invokeCommand = new InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId,
      inputText: body.message,
      enableTrace, // Only enable trace when explicitly requested
      sessionState: {
        sessionAttributes,
        promptSessionAttributes,
      },
    });

    const bedrockResponse = await bedrockAgentClient.send(invokeCommand);

    // Stream response and trace events
    let fullResponse = '';

    // PERFORMANCE: Batch trace events to avoid serializing WebSocket sends
    const pendingTraceEvents: StreamEvent[] = [];
    let lastTraceSendTime = Date.now();
    const TRACE_BATCH_INTERVAL_MS = 200; // Send trace batches every 200ms max

    if (bedrockResponse.completion) {
      for await (const event of bedrockResponse.completion) {
        const now = Date.now();

        // Handle trace events (thinking) - only if trace enabled
        if (enableTrace && event.trace?.trace) {
          const trace = event.trace.trace;

          // Pre-processing trace (understanding the request)
          if (trace.preProcessingTrace) {
            const preProc = trace.preProcessingTrace;
            if (preProc.modelInvocationOutput?.parsedResponse?.rationale) {
              pendingTraceEvents.push({
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
                  pendingTraceEvents.push({
                    type: 'thinking',
                    content: thinkingMatch[1].trim(),
                    timestamp: new Date().toISOString(),
                  });
                }
              }
            }

            // Tool invocation - send immediately for user feedback
            if (orch.invocationInput?.actionGroupInvocationInput) {
              const action = orch.invocationInput.actionGroupInvocationInput;
              // Tool events are important - send immediately
              sendToClient(apiClient, connectionId, {
                type: 'tool_use',
                toolName: action.apiPath?.replace('/', '') || 'unknown',
                toolInput: action.parameters || action.requestBody,
                content: `Calling: ${action.apiPath}`,
                timestamp: new Date().toISOString(),
              }); // Fire and forget for speed
            }

            // Tool result - send immediately
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

              sendToClient(apiClient, connectionId, {
                type: 'tool_result',
                content: resultContent,
                toolResult: result.text,
                timestamp: new Date().toISOString(),
              }); // Fire and forget for speed
            }

            // Rationale/thinking - batch
            if (orch.rationale?.text) {
              pendingTraceEvents.push({
                type: 'thinking',
                content: orch.rationale.text,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Post-processing trace - batch
          if (trace.postProcessingTrace?.modelInvocationOutput?.parsedResponse) {
            const postProc = trace.postProcessingTrace.modelInvocationOutput.parsedResponse;
            if (postProc.text) {
              pendingTraceEvents.push({
                type: 'thinking',
                content: `Finalizing: ${postProc.text}`,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Periodically flush trace events
          if (pendingTraceEvents.length > 0 && now - lastTraceSendTime > TRACE_BATCH_INTERVAL_MS) {
            for (const traceEvent of pendingTraceEvents) {
              sendToClient(apiClient, connectionId, traceEvent); // Fire and forget
            }
            pendingTraceEvents.length = 0;
            lastTraceSendTime = now;
          }
        }

        // Handle response chunks - send immediately for real-time feel
        if (event.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event.chunk.bytes);
          fullResponse += chunk;

          // Filter out internal Bedrock tool invocation XML that users should never see
          // e.g. <invoke><tool_name>POST::requestAppointment</tool_name><parameters>...</parameters></invoke>
          let cleanChunk = chunk
            .replace(/<invoke>[\s\S]*?<\/invoke>/g, '')
            .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
            .replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '')
            .replace(/<invoke>[\s\S]*$/g, '')  // partial opening tag at end of chunk
            .trim();

          // Only send non-empty chunks after filtering
          if (cleanChunk) {
            sendToClient(apiClient, connectionId, {
              type: 'chunk',
              content: cleanChunk,
              timestamp: new Date().toISOString(),
            }); // Fire and forget for speed
          }
        }
      }
    }

    // Flush any remaining trace events
    for (const traceEvent of pendingTraceEvents) {
      sendToClient(apiClient, connectionId, traceEvent);
    }

    // Clean tool invocation XML from full response before completion
    const cleanResponse = fullResponse
      .replace(/<invoke>[\s\S]*?<\/invoke>/g, '')
      .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
      .replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '')
      .replace(/<invoke>[\s\S]*$/g, '')
      .trim();

    // Send completion event
    await sendToClient(apiClient, connectionId, {
      type: 'complete',
      content: cleanResponse || 'No response from agent',
      sessionId,
      timestamp: new Date().toISOString(),
    });

    const responseTimeMs = Date.now() - invokeStartTime;

    // Log assistant response to conversation history
    logMessage({
      sessionId,
      timestamp: Date.now(),
      messageType: 'assistant',
      content: fullResponse || 'No response from agent',
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: 'websocket',
      isPublicChat: true,
      responseTimeMs,
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

    // Provide user-friendly error messages for known error types
    let userMessage = 'An error occurred processing your request. Please try again.';

    if (error.name === 'DependencyFailedException') {
      // This error occurs when the Bedrock Agent's action group Lambda fails
      // Common causes: timeout, API issues, or configuration problems
      console.error('[WebSocket] DependencyFailedException - Action group Lambda may have failed');
      userMessage = 'I had trouble looking that up. Could you please try again? If the problem persists, please contact the office directly.';
    } else if (error.name === 'ThrottlingException') {
      userMessage = 'The system is busy right now. Please wait a moment and try again.';
    } else if (error.name === 'ResourceNotFoundException') {
      userMessage = 'The AI assistant is currently unavailable. Please try again later or contact the office.';
    } else if (error.name === 'ValidationException') {
      userMessage = 'There was an issue with your request. Please try rephrasing your question.';
    } else if (error.name === 'AccessDeniedException') {
      // DIAGNOSTIC: Log detailed info to help identify which IAM permission is missing
      console.error('[WebSocket] AccessDeniedException details:', {
        errorMessage: error.message,
        errorCode: error.$metadata?.httpStatusCode,
        region: process.env.AWS_REGION,
        // These are useful for checking if the correct agent is being invoked
        hint: 'Check: (1) Lambda role has bedrock-agent-runtime:InvokeAgent, ' +
          '(2) Bedrock model access is enabled in console, ' +
          '(3) Agent bedrockAgentRole has bedrock:InvokeModel on the foundation model ARN, ' +
          '(4) Cross-region inference profile exists if using us.* model IDs',
      });
      userMessage = 'Access denied. Please contact the office for assistance.';
    }

    await sendToClient(apiClient, connectionId, {
      type: 'error',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    return { statusCode: 500 };
  }
};

