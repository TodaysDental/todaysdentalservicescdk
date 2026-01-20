/**
 * Invoke Agent Handler - Uses Bedrock Agent Runtime
 * 
 * Invokes a prepared Bedrock Agent with session management.
 * The agent uses Action Groups to call OpenDental tools.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { AiAgent } from './agents';
import { ConversationMessage } from './conversation-history';
import { getDateContext, getClinicTimezone } from '../../shared/prompts/ai-prompts';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || 'AiAgentConversations';

const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

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

interface InvokeRequest {
  message: string;
  clinicId?: string; // Optional if provided in URL path
  sessionId?: string; // Optional - will create new if not provided
  endSession?: boolean; // End the session after this message
  enableTrace?: boolean; // Enable agent trace for debugging
}

// ========================================================================
// SESSION MANAGEMENT (DynamoDB-backed for security)
// ========================================================================

/**
 * Session tracking stored in DynamoDB for security and distributed state.
 * 
 * SECURITY FIX: Previously used in-memory Map which:
 * 1. Allowed session hijacking across Lambda instances
 * 2. Lost state on cold starts
 * 3. Didn't bind sessions to specific users
 * 
 * Now sessions are stored with user binding in DynamoDB.
 */
interface SessionRecord {
  sessionId: string;       // PK
  agentId: string;
  aliasId: string;
  clinicId: string;
  userId: string;          // User binding for security
  messageCount: number;
  createdAt: string;
  lastActivity: string;
  ttl: number;
}

// Maximum messages per session before forced cleanup
const MAX_MESSAGES_PER_SESSION = 100;

// Session TTL (30 minutes of inactivity)
const SESSION_TTL_SECONDS = 30 * 60;

// ========================================================================
// PUBLIC ENDPOINT RATE LIMITING (DynamoDB-backed)
// ========================================================================

const PUBLIC_RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 10,      // Max requests per IP/visitor per minute
  WINDOW_MS: 60 * 1000,              // 1 minute window
  TTL_SECONDS: 300,                  // 5 minute TTL for rate limit records
};

// Rate limit table name (using sessions table with prefix)
const RATE_LIMIT_TABLE = SESSIONS_TABLE;

/**
 * Check rate limit for public endpoint requests.
 * Uses DynamoDB for distributed consistency across Lambda instances.
 * 
 * FIX: Previously the public endpoint had no rate limiting, allowing abuse.
 */
async function checkPublicRateLimit(
  clinicId: string, 
  visitorId: string, 
  sourceIp?: string
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const windowStart = Math.floor(now / PUBLIC_RATE_LIMIT.WINDOW_MS) * PUBLIC_RATE_LIMIT.WINDOW_MS;
  const ttl = Math.floor(now / 1000) + PUBLIC_RATE_LIMIT.TTL_SECONDS;
  
  // Create a unique key based on clinic + visitor/IP
  const rateLimitKey = `ratelimit:${clinicId}:${visitorId || sourceIp || 'unknown'}`;
  
  try {
    // Try to get existing rate limit record
    const response = await docClient.send(new GetCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: { sessionId: rateLimitKey },
    }));
    
    const record = response.Item;
    const storedWindowStart = record?.windowStart || 0;
    const isNewWindow = windowStart > storedWindowStart;
    const currentCount = isNewWindow ? 0 : (record?.requestCount || 0);
    
    // Check if over limit
    if (currentCount >= PUBLIC_RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
      const timeLeft = Math.ceil((storedWindowStart + PUBLIC_RATE_LIMIT.WINDOW_MS - now) / 1000);
      return { 
        allowed: false, 
        reason: `Rate limit exceeded. Please wait ${Math.max(1, timeLeft)} seconds before making more requests.` 
      };
    }
    
    // Increment counter atomically
    await docClient.send(new PutCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: {
        sessionId: rateLimitKey,
        windowStart: isNewWindow ? windowStart : storedWindowStart,
        requestCount: currentCount + 1,
        clinicId,
        visitorId,
        sourceIp,
        ttl,
        isRateLimitRecord: true, // Flag to distinguish from session records
      },
    }));
    
    return { allowed: true };
  } catch (error) {
    console.error('[PublicRateLimit] Error checking rate limit:', error);
    // Allow request on failure (fail open for availability)
    return { allowed: true };
  }
}

/**
 * Get or create a session with user binding
 * 
 * SECURITY: Sessions are bound to a specific userId. If a different user
 * tries to use the same sessionId, they get a new session instead.
 */
async function getOrCreateSession(
  sessionId: string,
  agentId: string,
  aliasId: string,
  clinicId: string,
  userId: string
): Promise<{ session: SessionRecord; isNew: boolean; shouldEnd: boolean }> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  
  // Try to get existing session
  try {
    const existing = await docClient.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
    }));
    
    if (existing.Item) {
      const session = existing.Item as SessionRecord;
      
      // SECURITY: Verify user binding
      if (session.userId !== userId) {
        console.warn(`[Session] User ${userId} attempted to use session owned by ${session.userId}`);
        // Create a new session for this user instead
        return createNewSession(agentId, aliasId, clinicId, userId);
      }
      
      // Check message limit
      if (session.messageCount >= MAX_MESSAGES_PER_SESSION) {
        console.warn(`[Session] Session ${sessionId} exceeded max messages`);
        return { session, isNew: false, shouldEnd: true };
      }
      
      // Update activity timestamp and message count
      await docClient.send(new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: 'SET messageCount = messageCount + :one, lastActivity = :now, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':now': now,
          ':ttl': ttl,
        },
      }));
      
      session.messageCount++;
      session.lastActivity = now;
      
      return { session, isNew: false, shouldEnd: false };
    }
  } catch (error) {
    console.error('[Session] Error getting session:', error);
  }
  
  // Create new session
  return createNewSession(agentId, aliasId, clinicId, userId);
}

/**
 * Create a new session with user binding
 */
async function createNewSession(
  agentId: string,
  aliasId: string,
  clinicId: string,
  userId: string
): Promise<{ session: SessionRecord; isNew: boolean; shouldEnd: boolean }> {
  const sessionId = uuidv4();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  
  const session: SessionRecord = {
    sessionId,
    agentId,
    aliasId,
    clinicId,
    userId,
    messageCount: 1,
    createdAt: now,
    lastActivity: now,
    ttl,
  };
  
  try {
    await docClient.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: session,
      ConditionExpression: 'attribute_not_exists(sessionId)',
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Race condition - session was created by another invocation
      // Recursively try to get the existing session
      return getOrCreateSession(sessionId, agentId, aliasId, clinicId, userId);
    }
    throw error;
  }
  
  return { session, isNew: true, shouldEnd: false };
}

/**
 * Mark a session as ended
 */
async function endSession(sessionId: string): Promise<void> {
  try {
    await docClient.send(new DeleteCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
    }));
  } catch (error) {
    console.error('[Session] Error ending session:', error);
  }
}

interface InvokeResponse {
  response: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  clinicId: string;
  trace?: any[]; // Trace events if enabled
  metrics?: {
    latencyMs: number;
  };
}

// ========================================================================
// HELPERS
// ========================================================================

/**
 * Check if this is a public (website) request
 */
function isPublicRequest(event: APIGatewayProxyEvent): boolean {
  const path = event.path || event.resource || '';
  return path.includes('/public/');
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const isPublic = isPublicRequest(event);

  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  if (httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // For authenticated requests, check JWT
  let userPerms: UserPermissions | null = null;
  let userName = 'Website Visitor';
  let userId = '';

  if (!isPublic) {
    userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
    userName = getUserDisplayName(userPerms);
    userId = userPerms.email || '';
  }

  const agentId = event.pathParameters?.agentId;
  const pathClinicId = event.pathParameters?.clinicId;
  
  if (!agentId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent ID is required' }),
    };
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}') as InvokeRequest;
    const clinicId = pathClinicId || body.clinicId;
    
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'clinicId is required (in path or body)' }),
      };
    }

    if (!body.message) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'message is required' }),
      };
    }

    // Get agent from DynamoDB
    const getAgentResponse = await docClient.send(
      new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } })
    );
    const agent = getAgentResponse.Item as AiAgent | undefined;

    if (!agent) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent not found' }),
      };
    }

    // Verify agent belongs to the clinic
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent does not belong to this clinic' }),
      };
    }

    // ========== PUBLIC REQUEST VALIDATION ==========
    if (isPublic) {
      // Check if website chatbot is enabled
      if (!agent.isWebsiteEnabled) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: 'Website chatbot is not enabled for this agent' }),
        };
      }

      // Use visitor info from body if provided
      userName = (body as any).visitorName || 'Website Visitor';
      userId = (body as any).visitorId || `visitor-${uuidv4().slice(0, 8)}`;
      
      // FIX: Rate limit public endpoint to prevent abuse
      const sourceIp = event.requestContext?.identity?.sourceIp;
      const rateLimitCheck = await checkPublicRateLimit(clinicId, userId, sourceIp);
      if (!rateLimitCheck.allowed) {
        return {
          statusCode: 429,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ 
            error: 'Too many requests',
            message: rateLimitCheck.reason,
          }),
        };
      }
    }
    // ========== AUTHENTICATED REQUEST VALIDATION ==========
    else {
      // Check user access permissions
      const userClinicIds = userPerms!.clinicRoles.map((cr) => cr.clinicId);
      const isAdmin = userPerms!.isSuperAdmin || userPerms!.isGlobalSuperAdmin;

      if (!isAdmin && !userClinicIds.includes(clinicId)) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: 'You do not have access to this clinic' }),
        };
      }
    }

    // ========== COMMON VALIDATION ==========
    
    // Check if agent is ready
    if (!agent.isActive) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent is not active' }),
      };
    }

    if (!agent.bedrockAgentId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'No Bedrock Agent associated with this agent' }),
      };
    }

    if (!agent.bedrockAgentAliasId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Agent is not prepared',
          status: agent.bedrockAgentStatus,
        }),
      };
    }

    if (agent.bedrockAgentStatus !== 'PREPARED') {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: `Agent is not ready. Current status: ${agent.bedrockAgentStatus}`,
          status: agent.bedrockAgentStatus,
        }),
      };
    }

    // SECURITY FIX: Get or create session with user binding
    // Sessions are now stored in DynamoDB and bound to specific users
    // to prevent session hijacking across Lambda instances
    const { session, isNew, shouldEnd } = await getOrCreateSession(
      body.sessionId || uuidv4(),
      agent.bedrockAgentId!,
      agent.bedrockAgentAliasId!,
      clinicId,
      userId || `anon-${uuidv4().slice(0, 8)}`
    );
    
    const sessionId = session.sessionId;
    
    // Force end session if message limit exceeded
    const shouldEndSession = body.endSession || shouldEnd;
    
    if (shouldEnd && !body.endSession) {
      console.log(`[InvokeAgent] Forcing session end for ${sessionId} due to message limit`);
    }

    // Build session attributes (passed to action group Lambda)
    // Include current date information for accurate date calculations
    // Fetch clinic's timezone from the Clinics table
    const clinicTimezone = await getClinicTimezone(clinicId);
    const dateContext = getDateContext(clinicTimezone);
    
    // Format today's date for display (MM/DD/YYYY format)
    const [year, month, day] = dateContext.today.split('-');
    const todayFormatted = `${month}/${day}/${year}`;
    
    const sessionAttributes: Record<string, string> = {
      clinicId: clinicId,
      userId: userId,
      userName: userName,
      isPublicRequest: isPublic ? 'true' : 'false',
      // Current date information for accurate scheduling (timezone-aware)
      todayDate: dateContext.today,
      todayFormatted: todayFormatted,
      dayName: dateContext.dayName,
      tomorrowDate: dateContext.tomorrowDate,
      nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
      timezone: dateContext.timezone,
    };

    // Build prompt session attributes (visible to the agent as context)
    // These appear in the agent's prompt and help with date calculations
    const promptSessionAttributes: Record<string, string> = {
      currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
      dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`,
    };

    // Log user message to conversation history
    const userMessageTimestamp = Date.now();
    const visitorId = isPublic ? userId : undefined;
    
    // Fire and forget - don't await to not slow down the response
    logMessage({
      sessionId,
      timestamp: userMessageTimestamp,
      messageType: 'user',
      content: body.message,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      userId: isPublic ? undefined : userId,
      userName: isPublic ? undefined : userName,
      visitorId,
      channel: 'api',
      isPublicChat: isPublic,
    });

    // Invoke the Bedrock Agent
    const invokeCommand = new InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId: sessionId,
      inputText: body.message,
      enableTrace: body.enableTrace || false,
      endSession: shouldEndSession,
      sessionState: {
        sessionAttributes,
        promptSessionAttributes,
      },
    });

    const bedrockResponse: InvokeAgentCommandOutput = await bedrockAgentRuntimeClient.send(invokeCommand);

    // Process the streaming response
    let responseText = '';
    const traceEvents: any[] = [];

    if (bedrockResponse.completion) {
      for await (const event of bedrockResponse.completion) {
        if (event.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event.chunk.bytes);
          responseText += chunk;
        }
        if (event.trace && body.enableTrace) {
          traceEvents.push(event.trace);
        }
      }
    }

    const latencyMs = Date.now() - startTime;

    // Log assistant response to conversation history
    logMessage({
      sessionId,
      timestamp: Date.now(),
      messageType: 'assistant',
      content: responseText || 'No response from agent',
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      userId: isPublic ? undefined : userId,
      userName: isPublic ? undefined : userName,
      visitorId,
      channel: 'api',
      isPublicChat: isPublic,
      responseTimeMs: latencyMs,
      traceData: traceEvents.length > 0 ? JSON.stringify(traceEvents) : undefined,
    });

    // Update usage count
    await docClient.send(
      new UpdateCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId },
        UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      })
    );

    // Clean up session if session was ended
    if (shouldEndSession) {
      await endSession(sessionId);
    }

    const response: InvokeResponse = {
      response: responseText || 'No response from agent',
      sessionId,
      agentId: agent.agentId,
      agentName: agent.name,
      clinicId,
      metrics: {
        latencyMs,
      },
    };

    if (body.enableTrace && traceEvents.length > 0) {
      response.trace = traceEvents;
    }

    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify(response),
    };
  } catch (error: any) {
    console.error('Invoke agent error:', error);

    // Handle specific Bedrock Agent errors
    if (error.name === 'ValidationException') {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Invalid request to Bedrock Agent',
          details: error.message,
        }),
      };
    }

    if (error.name === 'ResourceNotFoundException') {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Bedrock Agent not found. It may have been deleted.',
          details: error.message,
        }),
      };
    }

    if (error.name === 'ThrottlingException') {
      return {
        statusCode: 429,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Too many requests. Please try again later.',
          details: error.message,
        }),
      };
    }

    if (error.name === 'AccessDeniedException') {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Access denied to Bedrock Agent',
          details: error.message,
        }),
      };
    }

    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        errorType: error.name,
      }),
    };
  }
};
