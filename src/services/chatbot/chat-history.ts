import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONVERSATIONS_TABLE || 'chatbot-conversations';

// Use common CORS headers
const corsHeaders = buildCorsHeaders();

const getGroupsFromClaims = (claims?: Record<string, any>): string[] => {
  if (!claims) return [];
  const raw = (claims as any)['cognito:groups'] ?? (claims as any)['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {}
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const isAuthorized = (groups: string[], clinicId?: string): boolean => {
  const isSuperAdmin = groups.some(g => 
    g === 'superadmin' || 
    g === 'global_admin' || 
    g === 'GLOBAL__SUPER_ADMIN' ||
    g === 'MARKETING' ||
    g.toLowerCase().includes('super_admin') ||
    g.toLowerCase().includes('global')
  );
  if (isSuperAdmin) return true;
  
  if (clinicId) {
    return groups.some(g => g.startsWith(`clinic_${clinicId}__`));
  }
  
  return groups.some(g => g.startsWith('clinic_'));
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Chat history request:', JSON.stringify(event, null, 2));

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Authorization check
    const claims = (event.requestContext as any)?.authorizer?.claims;
    const groups = getGroupsFromClaims(claims);
    
    if (!isAuthorized(groups)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Forbidden: insufficient permissions' })
      };
    }

    const { clinicId, startDate, endDate } = event.queryStringParameters || {};
    
    // Validate clinic access if clinicId specified
    if (clinicId && !isAuthorized(groups, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Forbidden: not authorized for this clinic' })
      };
    }

    let conversations: any[] = [];

    if (clinicId) {
      // Query specific clinic conversations
      conversations = await getConversationsByClinic(clinicId, startDate, endDate);
    } else {
      // Get conversations for all authorized clinics
      const authorizedClinics = getAuthorizedClinics(groups);
      if (authorizedClinics.length === 0) {
        conversations = await getAllConversations(startDate, endDate);
      } else {
        // Get conversations for specific clinics the user has access to
        const clinicPromises = authorizedClinics.map(clinic => 
          getConversationsByClinic(clinic, startDate, endDate)
        );
        const clinicResults = await Promise.all(clinicPromises);
        conversations = clinicResults.flat()
          .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        conversations,
        total: conversations.length
      })
    };

  } catch (error) {
    console.error('Error fetching chat history:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function getConversationsByClinic(
  clinicId: string, 
  startDate?: string, 
  endDate?: string
): Promise<any[]> {
  // Get all sessions for this clinic within date range
  const sessions = await getSessions(clinicId, startDate, endDate);
  
  // Get conversation details for each session
  const conversations = await Promise.all(
    sessions.map(session => getConversationDetail(session.sessionId, clinicId))
  );
  
  return conversations.filter(conv => conv !== null);
}

async function getAllConversations(
  startDate?: string, 
  endDate?: string
): Promise<any[]> {
  const params: any = {
    TableName: TABLE_NAME,
    FilterExpression: 'messageType = :msgType',
    ExpressionAttributeValues: {
      ':msgType': 'user'
    }
    // No limit - get all results
  };

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
    
    params.FilterExpression += ' AND #ts BETWEEN :start AND :end';
    params.ExpressionAttributeNames = { '#ts': 'timestamp' };
    params.ExpressionAttributeValues[':start'] = start;
    params.ExpressionAttributeValues[':end'] = end;
  }

  const result = await docClient.send(new ScanCommand(params));
  const items = result.Items || [];
  
  // Group by sessionId and get conversation details
  const sessionMap = new Map<string, any>();
  items.forEach(item => {
    if (!sessionMap.has(item.sessionId) || item.timestamp > sessionMap.get(item.sessionId).timestamp) {
      sessionMap.set(item.sessionId, item);
    }
  });

  const conversations = await Promise.all(
    Array.from(sessionMap.values())
      .map(session => getConversationDetail(session.sessionId, session.clinicId))
  );
  
  return conversations.filter(conv => conv !== null);
}

async function getSessions(
  clinicId: string, 
  startDate?: string, 
  endDate?: string
): Promise<any[]> {
  const params: any = {
    TableName: TABLE_NAME,
    FilterExpression: 'clinicId = :clinicId AND messageType = :msgType',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':msgType': 'user'
    }
    // No limit - get all results
  };

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
    
    params.FilterExpression += ' AND #ts BETWEEN :start AND :end';
    params.ExpressionAttributeNames = { '#ts': 'timestamp' };
    params.ExpressionAttributeValues[':start'] = start;
    params.ExpressionAttributeValues[':end'] = end;
  }

  const result = await docClient.send(new ScanCommand(params));
  const items = result.Items || [];
  
  // Group by sessionId and keep the latest message from each session
  const sessionMap = new Map<string, any>();
  items.forEach(item => {
    if (!sessionMap.has(item.sessionId) || item.timestamp > sessionMap.get(item.sessionId).timestamp) {
      sessionMap.set(item.sessionId, item);
    }
  });

  return Array.from(sessionMap.values())
    .sort((a, b) => b.timestamp - a.timestamp);
}

async function getConversationDetail(sessionId: string, clinicId: string): Promise<any> {
  try {
    // Get all messages for this session
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      ScanIndexForward: true // Oldest first
    }));

    const items = result.Items || [];
    if (items.length === 0) return null;

    // Separate session state and messages
    const messages = items.filter(item => 
      item.messageType === 'user' || item.messageType === 'assistant'
    ).map(item => ({
      type: item.messageType,
      content: item.message,
      timestamp: item.timestamp,
      metadata: item.metadata || {}
    }));

    const sessionState = items.find(item => item.messageType === 'session_state');
    
    if (messages.length === 0) return null;

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const userMessages = messages.filter(m => m.type === 'user');
    const assistantMessages = messages.filter(m => m.type === 'assistant');

    return {
      sessionId,
      clinicId,
      startTime: new Date(firstMessage.timestamp).toISOString(),
      lastActivity: lastMessage.timestamp,
      duration: lastMessage.timestamp - firstMessage.timestamp,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      firstMessage: firstMessage.content,
      lastMessage: lastMessage.content,
      messages: messages,
      sessionState: sessionState ? JSON.parse(sessionState.message || '{}') : null
    };
  } catch (error) {
    console.error(`Error getting conversation detail for session ${sessionId}:`, error);
    return null;
  }
}

function getAuthorizedClinics(groups: string[]): string[] {
  return groups
    .filter(g => g.startsWith('clinic_') && g.includes('__'))
    .map(g => {
      const match = g.match(/^clinic_([^_]+)__/);
      return match ? match[1] : null;
    })
    .filter(Boolean) as string[];
}
