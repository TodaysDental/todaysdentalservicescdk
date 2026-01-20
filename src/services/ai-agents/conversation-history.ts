/**
 * Conversation History Handler for AI Agents
 * 
 * Provides endpoints to view and analyze AI agent conversations:
 * - GET /conversations - List conversations with filters
 * - GET /conversations/{sessionId} - Get specific conversation with all messages
 * - GET /conversations/stats - Get conversation statistics
 * - DELETE /conversations/{sessionId} - Delete a conversation (admin only)
 * 
 * Data is stored in a dedicated ConversationsTable with:
 * - PK: sessionId
 * - SK: timestamp (for message ordering)
 * - GSIs: clinicId-timestamp, userId-timestamp, agentId-timestamp
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  isAdminUser,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// ========================================================================
// CLIENTS & CONFIG
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || 'AiAgentConversations';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';

const AI_AGENTS_MODULE = 'IT'; // Module permission for AI Agents

const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// ========================================================================
// TYPES
// ========================================================================

export interface ConversationMessage {
  sessionId: string;           // PK
  timestamp: number;           // SK - message timestamp in ms
  messageType: 'user' | 'assistant' | 'system' | 'error' | 'trace';
  content: string;
  // Context
  clinicId: string;
  agentId: string;
  agentName?: string;
  userId?: string;             // For authenticated sessions
  userName?: string;           // Display name
  visitorId?: string;          // For public/anonymous sessions
  // Metadata
  channel: 'api' | 'websocket' | 'voice';
  isPublicChat: boolean;
  traceData?: string;          // JSON stringified trace/thinking data
  toolCalls?: string;          // JSON stringified tool calls made
  responseTimeMs?: number;     // Time to generate response
  tokenCount?: number;         // Approximate token usage
  // TTL for auto-cleanup (optional, 90 days default)
  ttl?: number;
}

export interface SessionSummary {
  sessionId: string;
  clinicId: string;
  agentId: string;
  agentName?: string;
  userId?: string;
  userName?: string;
  visitorId?: string;
  channel: 'api' | 'websocket' | 'voice';
  isPublicChat: boolean;
  startTime: string;
  lastActivity: string;
  duration: number;            // in ms
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  firstMessage?: string;
  lastMessage?: string;
  avgResponseTimeMs?: number;
  totalTokens?: number;
}

export interface ConversationDetail extends SessionSummary {
  messages: ConversationMessage[];
}

export interface ConversationStats {
  totalSessions: number;
  totalMessages: number;
  totalUserMessages: number;
  totalAssistantMessages: number;
  uniqueUsers: number;
  uniqueVisitors: number;
  avgMessagesPerSession: number;
  avgSessionDuration: number;
  avgResponseTime: number;
  sessionsByChannel: Record<string, number>;
  sessionsByAgent: Record<string, { count: number; name: string }>;
  messagesByDay: Record<string, number>;
  topAgents: Array<{ agentId: string; name: string; sessions: number; messages: number }>;
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = getCorsHeaders(event);
  
  console.log('[ConversationHistory] Request:', {
    method: event.httpMethod,
    path: event.path,
    pathParams: event.pathParameters,
    queryParams: event.queryStringParameters,
  });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // Authenticate user
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
      };
    }

    // Check module permission
    if (!hasModulePermission(
      userPerms.clinicRoles,
      AI_AGENTS_MODULE,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You do not have permission to view AI Agent conversations' }),
      };
    }

    const path = event.path;
    const method = event.httpMethod;
    const sessionId = event.pathParameters?.sessionId;

    // Route handling
    if (path.endsWith('/stats') && method === 'GET') {
      return await handleGetStats(event, userPerms, corsHeaders);
    }
    
    if (sessionId && method === 'GET') {
      return await handleGetConversation(sessionId, event, userPerms, corsHeaders);
    }
    
    if (sessionId && method === 'DELETE') {
      return await handleDeleteConversation(sessionId, event, userPerms, corsHeaders);
    }
    
    if (method === 'GET') {
      return await handleListConversations(event, userPerms, corsHeaders);
    }

    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };

  } catch (error) {
    console.error('[ConversationHistory] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

// ========================================================================
// LIST CONVERSATIONS
// ========================================================================

async function handleListConversations(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const {
    clinicId,
    agentId,
    userId,
    startDate,
    endDate,
    channel,
    isPublic,
    limit = '50',
    nextToken,
  } = event.queryStringParameters || {};

  const parsedLimit = Math.min(parseInt(limit, 10) || 50, 100);
  
  // Validate clinic access
  const authorizedClinics = getAuthorizedClinics(userPerms);
  if (clinicId && !authorizedClinics.includes(clinicId) && authorizedClinics.length > 0) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'You do not have access to this clinic' }),
    };
  }

  try {
    let sessions: SessionSummary[] = [];
    let paginationToken: string | undefined;

    // Build query based on filters
    if (clinicId) {
      // Query by clinic using GSI
      const result = await queryByClinic(clinicId, startDate, endDate, parsedLimit, nextToken);
      sessions = result.sessions;
      paginationToken = result.nextToken;
    } else if (agentId) {
      // Query by agent using GSI
      const result = await queryByAgent(agentId, startDate, endDate, parsedLimit, nextToken);
      sessions = result.sessions;
      paginationToken = result.nextToken;
    } else if (userId) {
      // Query by user using GSI
      const result = await queryByUser(userId, startDate, endDate, parsedLimit, nextToken);
      sessions = result.sessions;
      paginationToken = result.nextToken;
    } else {
      // Scan with filters (for admin users)
      // FIX: Only pass isPublic filter when explicitly specified in query params
      // Previously: isPublic === 'true' would evaluate to false when undefined,
      // incorrectly filtering out all public chats
      const isPublicFilter = isPublic !== undefined ? isPublic === 'true' : undefined;
      
      const result = await scanConversations(
        authorizedClinics,
        startDate,
        endDate,
        channel,
        isPublicFilter,
        parsedLimit,
        nextToken
      );
      sessions = result.sessions;
      paginationToken = result.nextToken;
    }

    // Apply additional filters
    if (channel) {
      sessions = sessions.filter(s => s.channel === channel);
    }
    if (isPublic !== undefined) {
      const isPublicBool = isPublic === 'true';
      sessions = sessions.filter(s => s.isPublicChat === isPublicBool);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        sessions,
        total: sessions.length,
        nextToken: paginationToken,
      }),
    };
  } catch (error) {
    console.error('[ListConversations] Error:', error);
    throw error;
  }
}

// ========================================================================
// GET CONVERSATION DETAIL
// ========================================================================

async function handleGetConversation(
  sessionId: string,
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Get all messages for this session
    const result = await docClient.send(new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      ScanIndexForward: true, // Oldest first
    }));

    const messages = (result.Items || []) as ConversationMessage[];
    
    if (messages.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Conversation not found' }),
      };
    }

    // Validate clinic access
    const clinicId = messages[0].clinicId;
    const authorizedClinics = getAuthorizedClinics(userPerms);
    if (authorizedClinics.length > 0 && !authorizedClinics.includes(clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You do not have access to this conversation' }),
      };
    }

    // Build conversation detail
    const userMessages = messages.filter(m => m.messageType === 'user');
    const assistantMessages = messages.filter(m => m.messageType === 'assistant');
    
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    
    const responseTimes = messages
      .filter(m => m.messageType === 'assistant' && m.responseTimeMs)
      .map(m => m.responseTimeMs!);
    
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : undefined;

    const totalTokens = messages
      .filter(m => m.tokenCount)
      .reduce((sum, m) => sum + (m.tokenCount || 0), 0);

    const conversation: ConversationDetail = {
      sessionId,
      clinicId: firstMessage.clinicId,
      agentId: firstMessage.agentId,
      agentName: firstMessage.agentName,
      userId: firstMessage.userId,
      userName: firstMessage.userName,
      visitorId: firstMessage.visitorId,
      channel: firstMessage.channel,
      isPublicChat: firstMessage.isPublicChat,
      startTime: new Date(firstMessage.timestamp).toISOString(),
      lastActivity: new Date(lastMessage.timestamp).toISOString(),
      duration: lastMessage.timestamp - firstMessage.timestamp,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      firstMessage: userMessages[0]?.content?.substring(0, 200),
      lastMessage: messages[messages.length - 1]?.content?.substring(0, 200),
      avgResponseTimeMs: avgResponseTime,
      totalTokens: totalTokens || undefined,
      messages,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(conversation),
    };
  } catch (error) {
    console.error('[GetConversation] Error:', error);
    throw error;
  }
}

// ========================================================================
// GET CONVERSATION STATS
// ========================================================================

async function handleGetStats(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const { clinicId, agentId, startDate, endDate } = event.queryStringParameters || {};

  // Validate clinic access
  const authorizedClinics = getAuthorizedClinics(userPerms);
  if (clinicId && authorizedClinics.length > 0 && !authorizedClinics.includes(clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'You do not have access to this clinic' }),
    };
  }

  try {
    // Build filter expression
    const filterParts: string[] = [];
    const exprAttrValues: Record<string, any> = {};
    const exprAttrNames: Record<string, string> = {};

    if (clinicId) {
      filterParts.push('clinicId = :clinicId');
      exprAttrValues[':clinicId'] = clinicId;
    } else if (authorizedClinics.length > 0) {
      // Filter to authorized clinics
      const clinicPlaceholders = authorizedClinics.map((_, i) => `:clinic${i}`);
      filterParts.push(`clinicId IN (${clinicPlaceholders.join(', ')})`);
      authorizedClinics.forEach((c, i) => {
        exprAttrValues[`:clinic${i}`] = c;
      });
    }

    if (agentId) {
      filterParts.push('agentId = :agentId');
      exprAttrValues[':agentId'] = agentId;
    }

    if (startDate || endDate) {
      const start = startDate ? new Date(startDate).getTime() : 0;
      const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
      filterParts.push('#ts BETWEEN :start AND :end');
      exprAttrNames['#ts'] = 'timestamp';
      exprAttrValues[':start'] = start;
      exprAttrValues[':end'] = end;
    }

    // Scan all messages (with filters)
    const scanParams: any = {
      TableName: CONVERSATIONS_TABLE,
    };
    
    if (filterParts.length > 0) {
      scanParams.FilterExpression = filterParts.join(' AND ');
      scanParams.ExpressionAttributeValues = exprAttrValues;
      if (Object.keys(exprAttrNames).length > 0) {
        scanParams.ExpressionAttributeNames = exprAttrNames;
      }
    }

    // Paginate through all results for accurate stats
    const allMessages: ConversationMessage[] = [];
    let lastKey: any;
    
    do {
      if (lastKey) {
        scanParams.ExclusiveStartKey = lastKey;
      }
      
      const result = await docClient.send(new ScanCommand(scanParams));
      allMessages.push(...(result.Items || []) as ConversationMessage[]);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Calculate statistics
    const sessionMap = new Map<string, ConversationMessage[]>();
    allMessages.forEach(msg => {
      if (!sessionMap.has(msg.sessionId)) {
        sessionMap.set(msg.sessionId, []);
      }
      sessionMap.get(msg.sessionId)!.push(msg);
    });

    const userMessages = allMessages.filter(m => m.messageType === 'user');
    const assistantMessages = allMessages.filter(m => m.messageType === 'assistant');
    
    const uniqueUsers = new Set(allMessages.filter(m => m.userId).map(m => m.userId));
    const uniqueVisitors = new Set(allMessages.filter(m => m.visitorId && !m.userId).map(m => m.visitorId));
    
    const sessionsByChannel: Record<string, number> = {};
    const sessionsByAgent: Record<string, { count: number; name: string }> = {};
    const messagesByDay: Record<string, number> = {};
    
    let totalDuration = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    sessionMap.forEach((messages, sessionId) => {
      const sorted = messages.sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      
      // Duration
      totalDuration += last.timestamp - first.timestamp;
      
      // By channel
      sessionsByChannel[first.channel] = (sessionsByChannel[first.channel] || 0) + 1;
      
      // By agent
      if (!sessionsByAgent[first.agentId]) {
        sessionsByAgent[first.agentId] = { count: 0, name: first.agentName || first.agentId };
      }
      sessionsByAgent[first.agentId].count++;
      
      // Response times
      messages.forEach(m => {
        if (m.messageType === 'assistant' && m.responseTimeMs) {
          totalResponseTime += m.responseTimeMs;
          responseTimeCount++;
        }
      });
    });

    // Messages by day
    allMessages.forEach(msg => {
      const day = new Date(msg.timestamp).toISOString().split('T')[0];
      messagesByDay[day] = (messagesByDay[day] || 0) + 1;
    });

    // Top agents
    const topAgents = Object.entries(sessionsByAgent)
      .map(([agentId, data]) => ({
        agentId,
        name: data.name,
        sessions: data.count,
        messages: allMessages.filter(m => m.agentId === agentId).length,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);

    const stats: ConversationStats = {
      totalSessions: sessionMap.size,
      totalMessages: allMessages.length,
      totalUserMessages: userMessages.length,
      totalAssistantMessages: assistantMessages.length,
      uniqueUsers: uniqueUsers.size,
      uniqueVisitors: uniqueVisitors.size,
      avgMessagesPerSession: sessionMap.size > 0 
        ? Math.round(allMessages.length / sessionMap.size * 10) / 10 
        : 0,
      avgSessionDuration: sessionMap.size > 0 
        ? Math.round(totalDuration / sessionMap.size) 
        : 0,
      avgResponseTime: responseTimeCount > 0 
        ? Math.round(totalResponseTime / responseTimeCount) 
        : 0,
      sessionsByChannel,
      sessionsByAgent,
      messagesByDay,
      topAgents,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(stats),
    };
  } catch (error) {
    console.error('[GetStats] Error:', error);
    throw error;
  }
}

// ========================================================================
// DELETE CONVERSATION
// ========================================================================

async function handleDeleteConversation(
  sessionId: string,
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  // Only admins can delete conversations
  if (!isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Only administrators can delete conversations' }),
    };
  }

  try {
    // Get all messages for this session
    const result = await docClient.send(new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      ProjectionExpression: 'sessionId, #ts',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
    }));

    const messages = result.Items || [];
    
    if (messages.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Conversation not found' }),
      };
    }

    // Delete in batches of 25 (DynamoDB limit)
    const batches = [];
    for (let i = 0; i < messages.length; i += 25) {
      const batch = messages.slice(i, i + 25).map(msg => ({
        DeleteRequest: {
          Key: { sessionId: msg.sessionId, timestamp: msg.timestamp },
        },
      }));
      batches.push(batch);
    }

    for (const batch of batches) {
      await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [CONVERSATIONS_TABLE]: batch,
        },
      }));
    }

    console.log(`[DeleteConversation] Deleted ${messages.length} messages from session ${sessionId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        deletedMessages: messages.length,
      }),
    };
  } catch (error) {
    console.error('[DeleteConversation] Error:', error);
    throw error;
  }
}

// ========================================================================
// QUERY HELPERS
// ========================================================================

async function queryByClinic(
  clinicId: string,
  startDate?: string,
  endDate?: string,
  limit?: number,
  nextToken?: string
): Promise<{ sessions: SessionSummary[]; nextToken?: string }> {
  const start = startDate ? new Date(startDate).getTime() : 0;
  const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();

  const result = await docClient.send(new QueryCommand({
    TableName: CONVERSATIONS_TABLE,
    IndexName: 'ClinicTimestampIndex',
    KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': start,
      ':end': end,
    },
    ScanIndexForward: false, // Most recent first
    Limit: limit || 50,
    ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
  }));

  const messages = (result.Items || []) as ConversationMessage[];
  const sessions = aggregateToSessions(messages);

  return {
    sessions,
    nextToken: result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

async function queryByAgent(
  agentId: string,
  startDate?: string,
  endDate?: string,
  limit?: number,
  nextToken?: string
): Promise<{ sessions: SessionSummary[]; nextToken?: string }> {
  const start = startDate ? new Date(startDate).getTime() : 0;
  const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();

  const result = await docClient.send(new QueryCommand({
    TableName: CONVERSATIONS_TABLE,
    IndexName: 'AgentTimestampIndex',
    KeyConditionExpression: 'agentId = :agentId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':agentId': agentId,
      ':start': start,
      ':end': end,
    },
    ScanIndexForward: false,
    Limit: limit || 50,
    ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
  }));

  const messages = (result.Items || []) as ConversationMessage[];
  const sessions = aggregateToSessions(messages);

  return {
    sessions,
    nextToken: result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

async function queryByUser(
  userId: string,
  startDate?: string,
  endDate?: string,
  limit?: number,
  nextToken?: string
): Promise<{ sessions: SessionSummary[]; nextToken?: string }> {
  const start = startDate ? new Date(startDate).getTime() : 0;
  const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();

  const result = await docClient.send(new QueryCommand({
    TableName: CONVERSATIONS_TABLE,
    IndexName: 'UserTimestampIndex',
    KeyConditionExpression: 'userId = :userId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':userId': userId,
      ':start': start,
      ':end': end,
    },
    ScanIndexForward: false,
    Limit: limit || 50,
    ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
  }));

  const messages = (result.Items || []) as ConversationMessage[];
  const sessions = aggregateToSessions(messages);

  return {
    sessions,
    nextToken: result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

async function scanConversations(
  authorizedClinics: string[],
  startDate?: string,
  endDate?: string,
  channel?: string,
  isPublic?: boolean,
  limit?: number,
  nextToken?: string
): Promise<{ sessions: SessionSummary[]; nextToken?: string }> {
  const filterParts: string[] = [];
  const exprAttrValues: Record<string, any> = {};
  const exprAttrNames: Record<string, string> = {};

  // Clinic filter
  if (authorizedClinics.length > 0) {
    const placeholders = authorizedClinics.map((_, i) => `:c${i}`);
    filterParts.push(`clinicId IN (${placeholders.join(', ')})`);
    authorizedClinics.forEach((c, i) => {
      exprAttrValues[`:c${i}`] = c;
    });
  }

  // Date filter
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
    filterParts.push('#ts BETWEEN :start AND :end');
    exprAttrNames['#ts'] = 'timestamp';
    exprAttrValues[':start'] = start;
    exprAttrValues[':end'] = end;
  }

  // Channel filter
  if (channel) {
    filterParts.push('channel = :channel');
    exprAttrValues[':channel'] = channel;
  }

  // Public filter
  if (isPublic !== undefined) {
    filterParts.push('isPublicChat = :isPublic');
    exprAttrValues[':isPublic'] = isPublic;
  }

  const scanParams: any = {
    TableName: CONVERSATIONS_TABLE,
    Limit: (limit || 50) * 10, // Get more items to aggregate into sessions
  };

  if (filterParts.length > 0) {
    scanParams.FilterExpression = filterParts.join(' AND ');
    scanParams.ExpressionAttributeValues = exprAttrValues;
    if (Object.keys(exprAttrNames).length > 0) {
      scanParams.ExpressionAttributeNames = exprAttrNames;
    }
  }

  if (nextToken) {
    scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
  }

  const result = await docClient.send(new ScanCommand(scanParams));
  const messages = (result.Items || []) as ConversationMessage[];
  // IMPORTANT:
  // Do NOT slice sessions here.
  // Slicing would permanently drop sessions from this scan page while still advancing the
  // LastEvaluatedKey cursor, making it impossible for clients to ever retrieve the dropped sessions.
  const sessions = aggregateToSessions(messages);

  return {
    sessions,
    nextToken: result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

// ========================================================================
// UTILITY FUNCTIONS
// ========================================================================

function aggregateToSessions(messages: ConversationMessage[]): SessionSummary[] {
  const sessionMap = new Map<string, ConversationMessage[]>();
  
  messages.forEach(msg => {
    if (!sessionMap.has(msg.sessionId)) {
      sessionMap.set(msg.sessionId, []);
    }
    sessionMap.get(msg.sessionId)!.push(msg);
  });

  const sessions: SessionSummary[] = [];
  
  sessionMap.forEach((msgs, sessionId) => {
    const sorted = msgs.sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const userMsgs = sorted.filter(m => m.messageType === 'user');
    const assistantMsgs = sorted.filter(m => m.messageType === 'assistant');
    
    const responseTimes = assistantMsgs
      .filter(m => m.responseTimeMs)
      .map(m => m.responseTimeMs!);
    
    sessions.push({
      sessionId,
      clinicId: first.clinicId,
      agentId: first.agentId,
      agentName: first.agentName,
      userId: first.userId,
      userName: first.userName,
      visitorId: first.visitorId,
      channel: first.channel,
      isPublicChat: first.isPublicChat,
      startTime: new Date(first.timestamp).toISOString(),
      lastActivity: new Date(last.timestamp).toISOString(),
      duration: last.timestamp - first.timestamp,
      messageCount: sorted.length,
      userMessageCount: userMsgs.length,
      assistantMessageCount: assistantMsgs.length,
      firstMessage: userMsgs[0]?.content?.substring(0, 200),
      lastMessage: sorted[sorted.length - 1]?.content?.substring(0, 200),
      avgResponseTimeMs: responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : undefined,
      totalTokens: sorted.reduce((sum, m) => sum + (m.tokenCount || 0), 0) || undefined,
    });
  });

  // Sort by last activity descending
  return sessions.sort((a, b) => 
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

function getAuthorizedClinics(userPerms: UserPermissions): string[] {
  // Super admins have access to all clinics
  if (isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    return []; // Empty means all clinics
  }

  // Get clinics where user has IT module access
  const authorizedClinics: string[] = [];
  for (const cr of userPerms.clinicRoles) {
    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === AI_AGENTS_MODULE);
    if (moduleAccess && moduleAccess.permissions.includes('read')) {
      authorizedClinics.push(cr.clinicId);
    }
  }

  return authorizedClinics;
}

// ========================================================================
// MESSAGE LOGGING UTILITY (exported for use by other handlers)
// ========================================================================

/**
 * Log a conversation message to DynamoDB.
 * Call this from invoke-agent.ts and websocket-message.ts to record all messages.
 */
export async function logConversationMessage(message: Omit<ConversationMessage, 'ttl'>): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days
  
  try {
    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        ...message,
        ttl,
      },
    }));
    
    console.log(`[LogMessage] Logged ${message.messageType} message for session ${message.sessionId}`);
  } catch (error) {
    console.error('[LogMessage] Failed to log message:', error);
    // Don't throw - logging should not break the main flow
  }
}

/**
 * Create a new DynamoDB client for use by other handlers.
 * This is needed because the client is scoped to this module.
 */
export function createDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}

export { CONVERSATIONS_TABLE };

