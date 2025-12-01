import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  isAdminUser,
  hasModulePermission,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONVERSATIONS_TABLE || 'chatbot-conversations';

// Use common CORS headers
const corsHeaders = buildCorsHeaders();


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
    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
      };
    }

    // Check if user has read permission for Marketing module (chatbot functionality)
    if (!hasModulePermission(
      userPerms.clinicRoles,
      'Marketing',
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You do not have permission to read chat history in the Marketing module' }),
      };
    }

    const { clinicId, startDate, endDate } = event.queryStringParameters || {};

    // Validate clinic access if clinicId specified
    if (clinicId && !hasModulePermission(
      userPerms.clinicRoles,
      'Marketing',
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'You do not have permission to read chat history for this clinic' })
      };
    }

    let conversations: any[] = [];

    if (clinicId) {
      // Query specific clinic conversations
      conversations = await getConversationsByClinic(clinicId, startDate, endDate);
    } else {
      // Get conversations for all authorized clinics
      const authorizedClinics = getAuthorizedClinics(userPerms);
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

function getAuthorizedClinics(userPerms: UserPermissions): string[] {
  // If user is admin, they have access to all clinics
  if (isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    // For now, return empty array to get all conversations - in production you might want to limit this
    return [];
  }

  // Get clinics where user has Marketing module access
  const authorizedClinics: string[] = [];
  for (const cr of userPerms.clinicRoles) {
    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === 'Marketing');
    if (moduleAccess && moduleAccess.permissions.includes('read')) {
      authorizedClinics.push(cr.clinicId);
    }
  }

  return authorizedClinics;
}
