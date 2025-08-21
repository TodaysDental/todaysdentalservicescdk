import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

// Use require to avoid type resolution issues when local types are missing
declare const require: any;
const { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } = require('@aws-sdk/client-chime-sdk-meetings');
declare const process: any;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const meetings = new ChimeSDKMeetingsClient({});

// Environment variables
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE!;
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT!;
const AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE as string;
const QUEUE_TABLE = process.env.VOICE_QUEUE_TABLE as string;
const CALL_HISTORY_TABLE = process.env.CALL_HISTORY_TABLE as string;
const CALL_STATISTICS_TABLE = process.env.CALL_STATISTICS_TABLE as string;

interface WebSocketMessage {
  action: string;
  data?: any;
  requestId?: string;
}

interface CallEvent {
  callId: string;
  clinicId: string;
  agentId?: string;
  agentName?: string;
  callType: 'INBOUND' | 'OUTBOUND';
  phoneNumber: string;
  eventType: 'CALL_START' | 'CALL_ANSWER' | 'CALL_END' | 'CALL_MISSED';
  timestamp: number;
  meetingId?: string;
  attendeeId?: string;
  duration?: number;
  waitTime?: number;
  recordingUrl?: string;
  transcriptUrl?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Contact Center WebSocket event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId!;
  const routeKey = event.requestContext.routeKey!;

  try {
    if (routeKey === 'contactCenter') {
      return await handleContactCenterMessage(connectionId, event.body);
    }

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Contact Center WebSocket handler error:', error);
    await sendErrorToConnection(connectionId, 'Internal server error', (error as Error).message);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

async function handleContactCenterMessage(connectionId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    await sendErrorToConnection(connectionId, 'Invalid message', 'Message body is required');
    return { statusCode: 400, body: 'Invalid message' };
  }

  try {
    const message: WebSocketMessage = JSON.parse(body);
    console.log('Processing contact center message:', message);

    // Validate user access
    const userContext = await getUserContext(connectionId);
    if (!userContext) {
      await sendErrorToConnection(connectionId, 'Unauthorized', 'Invalid connection or user context');
      return { statusCode: 401, body: 'Unauthorized' };
    }

    switch (message.action) {
      case 'getDashboard':
        await handleGetDashboard(connectionId, message, userContext);
        break;
      case 'getStatistics':
        await handleGetStatistics(connectionId, message, userContext);
        break;
      case 'getAgentsStatus':
        await handleGetAgentsStatus(connectionId, message, userContext);
        break;
      case 'getCallHistory':
        await handleGetCallHistory(connectionId, message, userContext);
        break;
      case 'getQueueSummary':
        await handleGetQueueSummary(connectionId, message, userContext);
        break;
      case 'getAgentPerformance':
        await handleGetAgentPerformance(connectionId, message, userContext);
        break;
      case 'transferCall':
        await handleCallTransfer(connectionId, message, userContext);
        break;
      case 'getCallRecordings':
        await handleGetCallRecordings(connectionId, message, userContext);
        break;
      case 'trackCallEvent':
        await handleCallTracking(connectionId, message, userContext);
        break;
      case 'subscribeToRealTimeUpdates':
        await handleSubscribeToRealTime(connectionId, message, userContext);
        break;
      case 'unsubscribeFromRealTimeUpdates':
        await handleUnsubscribeFromRealTime(connectionId, message, userContext);
        break;
      default:
        await sendErrorToConnection(connectionId, 'Unknown action', `Action '${message.action}' is not supported`);
        break;
    }

    return { statusCode: 200, body: 'Message processed' };
  } catch (error) {
    console.error('Error processing contact center message:', error);
    await sendErrorToConnection(connectionId, 'Processing error', (error as Error).message);
    return { statusCode: 500, body: 'Processing error' };
  }
}

// Dashboard handler - provides overview of call center status
async function handleGetDashboard(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId } = message.data || {};
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic');
    return;
  }
  
  const targetClinics = clinicId ? [clinicId] : accessCheck.userClinics;
  
  try {
    // Get agent summary for accessible clinics
    const agentPromises = targetClinics.map(async (cId) => {
      const agentsResult = await ddb.send(new QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: 'ClinicStateIndex',
        KeyConditionExpression: 'clinicId = :c',
        ExpressionAttributeValues: { ':c': cId }
      }));
      
      const agents = agentsResult.Items || [];
      return {
        clinicId: cId,
        total: agents.length,
        available: agents.filter(a => a.state === 'AVAILABLE').length,
        busy: agents.filter(a => a.state === 'BUSY').length,
        break: agents.filter(a => a.state === 'BREAK').length,
        offline: agents.filter(a => a.state === 'OFFLINE').length,
        agents: agents.map(a => ({
          agentId: a.agentId,
          agentName: a.agentName || a.agentId,
          state: a.state,
          loginTime: a.loginTime,
          activeCallId: a.activeCallId,
          lastStateChange: a.updatedAt
        }))
      };
    });
    
    const agentSummaries = await Promise.all(agentPromises);
    
    // Get today's call statistics
    const today = new Date().toISOString().split('T')[0];
    const callStatsPromises = targetClinics.map(async (cId) => {
      try {
        const statsResult = await ddb.send(new GetCommand({
          TableName: CALL_STATISTICS_TABLE,
          Key: { clinicId: cId, date: today }
        }));
        
        return {
          clinicId: cId,
          date: today,
          totalCalls: statsResult.Item?.totalCalls || 0,
          inboundCalls: statsResult.Item?.inboundCalls || 0,
          outboundCalls: statsResult.Item?.outboundCalls || 0,
          averageCallDuration: statsResult.Item?.averageCallDuration || 0,
          answeredCalls: statsResult.Item?.answeredCalls || 0,
          missedCalls: statsResult.Item?.missedCalls || 0,
          averageWaitTime: statsResult.Item?.averageWaitTime || 0
        };
      } catch (error) {
        console.warn(`Failed to get stats for clinic ${cId}:`, error);
        return {
          clinicId: cId,
          date: today,
          totalCalls: 0,
          inboundCalls: 0,
          outboundCalls: 0,
          averageCallDuration: 0,
          answeredCalls: 0,
          missedCalls: 0,
          averageWaitTime: 0
        };
      }
    });
    
    const callStatistics = await Promise.all(callStatsPromises);
    
    const dashboardData = {
      timestamp: Date.now(),
      clinics: targetClinics,
      agentSummaries,
      callStatistics,
      summary: {
        totalAgents: agentSummaries.reduce((sum, s) => sum + s.total, 0),
        availableAgents: agentSummaries.reduce((sum, s) => sum + s.available, 0),
        busyAgents: agentSummaries.reduce((sum, s) => sum + s.busy, 0),
        totalCallsToday: callStatistics.reduce((sum, s) => sum + s.totalCalls, 0),
        answeredCallsToday: callStatistics.reduce((sum, s) => sum + s.answeredCalls, 0)
      }
    };

    await sendToConnection(connectionId, {
      type: 'dashboard',
      requestId: message.requestId,
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    await sendErrorToConnection(connectionId, 'Dashboard error', 'Failed to get dashboard data', message.requestId);
  }
}

// Real-time statistics handler
async function handleGetStatistics(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId, timeRange = 'today' } = message.data || {};
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  const targetClinics = clinicId ? [clinicId] : accessCheck.userClinics;
  
  try {
    // Calculate date range based on timeRange parameter
    const now = new Date();
    let startDate: string;
    let endDate = now.toISOString().split('T')[0];
    
    switch (timeRange) {
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = weekAgo.toISOString().split('T')[0];
        break;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDate = monthAgo.toISOString().split('T')[0];
        break;
      default: // today
        startDate = endDate;
    }
    
    // Get statistics for the date range
    const statsPromises = targetClinics.map(async (cId) => {
      const statsResults = await ddb.send(new QueryCommand({
        TableName: CALL_STATISTICS_TABLE,
        KeyConditionExpression: 'clinicId = :c AND #d BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { 
          ':c': cId, 
          ':start': startDate, 
          ':end': endDate 
        }
      }));
      
      const stats = statsResults.Items || [];
      const totals = stats.reduce((acc, item) => ({
        totalCalls: acc.totalCalls + (item.totalCalls || 0),
        inboundCalls: acc.inboundCalls + (item.inboundCalls || 0),
        outboundCalls: acc.outboundCalls + (item.outboundCalls || 0),
        answeredCalls: acc.answeredCalls + (item.answeredCalls || 0),
        missedCalls: acc.missedCalls + (item.missedCalls || 0),
        totalDuration: acc.totalDuration + (item.totalDuration || 0),
        totalWaitTime: acc.totalWaitTime + (item.totalWaitTime || 0)
      }), { totalCalls: 0, inboundCalls: 0, outboundCalls: 0, answeredCalls: 0, missedCalls: 0, totalDuration: 0, totalWaitTime: 0 });
      
      return {
        clinicId: cId,
        timeRange,
        startDate,
        endDate,
        ...totals,
        averageCallDuration: totals.totalCalls > 0 ? totals.totalDuration / totals.totalCalls : 0,
        averageWaitTime: totals.answeredCalls > 0 ? totals.totalWaitTime / totals.answeredCalls : 0,
        answerRate: totals.totalCalls > 0 ? (totals.answeredCalls / totals.totalCalls) * 100 : 0,
        dailyStats: stats
      };
    });
    
    const statistics = await Promise.all(statsPromises);
    
    await sendToConnection(connectionId, {
      type: 'statistics',
      requestId: message.requestId,
      success: true,
      data: { statistics }
    });
  } catch (error) {
    console.error('Statistics error:', error);
    await sendErrorToConnection(connectionId, 'Statistics error', 'Failed to get statistics', message.requestId);
  }
}

// Agents status handler for supervisor view
async function handleGetAgentsStatus(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId } = message.data || {};
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  const targetClinics = clinicId ? [clinicId] : accessCheck.userClinics;
  
  try {
    const agentPromises = targetClinics.map(async (cId) => {
      const agentsResult = await ddb.send(new QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: 'ClinicStateIndex',
        KeyConditionExpression: 'clinicId = :c',
        ExpressionAttributeValues: { ':c': cId }
      }));
      
      return (agentsResult.Items || []).map(agent => ({
        agentId: agent.agentId,
        agentName: agent.agentName || agent.agentId,
        clinicId: agent.clinicId,
        state: agent.state,
        loginTime: agent.loginTime,
        logoutTime: agent.logoutTime,
        activeCallId: agent.activeCallId,
        meetingStatus: agent.meetingId ? 'CONNECTED' : 'DISCONNECTED',
        lastStateChange: agent.updatedAt,
        sessionDuration: agent.loginTime ? Date.now() - agent.loginTime : 0
      }));
    });
    
    const allAgents = (await Promise.all(agentPromises)).flat();
    
    await sendToConnection(connectionId, {
      type: 'agentsStatus',
      requestId: message.requestId,
      success: true,
      data: {
        agents: allAgents,
        summary: {
          total: allAgents.length,
          available: allAgents.filter(a => a.state === 'AVAILABLE').length,
          busy: allAgents.filter(a => a.state === 'BUSY').length,
          break: allAgents.filter(a => a.state === 'BREAK').length,
          offline: allAgents.filter(a => a.state === 'OFFLINE').length
        }
      }
    });
  } catch (error) {
    console.error('Agents status error:', error);
    await sendErrorToConnection(connectionId, 'Agents status error', 'Failed to get agents status', message.requestId);
  }
}

// Call history handler
async function handleGetCallHistory(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId, agentId, limit = 50, startDate, endDate } = message.data || {};
  
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  try {
    let queryParams: any = {
      TableName: CALL_HISTORY_TABLE,
      ScanIndexForward: false, // newest first
      Limit: limit
    };
    
    if (clinicId) {
      // Query by clinic
      queryParams.IndexName = 'ClinicDateIndex';
      queryParams.KeyConditionExpression = 'clinicId = :c';
      queryParams.ExpressionAttributeValues = { ':c': clinicId };
      
      if (startDate && endDate) {
        queryParams.KeyConditionExpression += ' AND #date BETWEEN :start AND :end';
        queryParams.ExpressionAttributeNames = { '#date': 'date' };
        queryParams.ExpressionAttributeValues[':start'] = startDate;
        queryParams.ExpressionAttributeValues[':end'] = endDate;
      }
    } else {
      // Scan with filters for accessible clinics
      queryParams.FilterExpression = 'clinicId IN (' + accessCheck.userClinics.map((_, i) => `:c${i}`).join(',') + ')';
      queryParams.ExpressionAttributeValues = {};
      accessCheck.userClinics.forEach((clinic, i) => {
        queryParams.ExpressionAttributeValues[`:c${i}`] = clinic;
      });
    }
    
    if (agentId) {
      const agentFilter = 'agentId = :agent';
      if (queryParams.FilterExpression) {
        queryParams.FilterExpression += ' AND ' + agentFilter;
      } else {
        queryParams.FilterExpression = agentFilter;
      }
      queryParams.ExpressionAttributeValues[':agent'] = agentId;
    }
    
    const result = clinicId ? 
      await ddb.send(new QueryCommand(queryParams)) : 
      await ddb.send(new ScanCommand(queryParams));
    
    const calls = (result.Items || []).map(call => ({
      callId: call.callId,
      clinicId: call.clinicId,
      agentId: call.agentId,
      agentName: call.agentName,
      callType: call.callType, // INBOUND/OUTBOUND
      phoneNumber: call.phoneNumber,
      startTime: call.startTime,
      endTime: call.endTime,
      duration: call.duration,
      status: call.status, // ANSWERED/MISSED/BUSY
      waitTime: call.waitTime,
      recordingUrl: call.recordingUrl,
      transcriptUrl: call.transcriptUrl,
      date: call.date
    }));
    
    await sendToConnection(connectionId, {
      type: 'callHistory',
      requestId: message.requestId,
      success: true,
      data: { calls, count: calls.length }
    });
  } catch (error) {
    console.error('Call history error:', error);
    await sendErrorToConnection(connectionId, 'Call history error', 'Failed to get call history', message.requestId);
  }
}

// Queue summary handler
async function handleGetQueueSummary(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId } = message.data || {};
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  const targetClinics = clinicId ? [clinicId] : accessCheck.userClinics;
  
  try {
    const queuePromises = targetClinics.map(async (cId) => {
      // Get queue configuration
      const queueResult = await ddb.send(new ScanCommand({
        TableName: QUEUE_TABLE,
        FilterExpression: 'clinicId = :c',
        ExpressionAttributeValues: { ':c': cId }
      }));
      
      // Get available agents for this clinic
      const agentsResult = await ddb.send(new QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: 'ClinicStateIndex',
        KeyConditionExpression: 'clinicId = :c AND #s = :available',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':c': cId, ':available': 'AVAILABLE' }
      }));
      
      const availableAgents = agentsResult.Items || [];
      const queueEntries = queueResult.Items || [];
      
      return {
        clinicId: cId,
        phoneNumbers: queueEntries.map(q => q.phoneNumber),
        availableAgents: availableAgents.length,
        queueCapacity: availableAgents.length,
        currentLoad: availableAgents.filter(a => a.activeCallId).length
      };
    });
    
    const queueSummaries = await Promise.all(queuePromises);
    
    await sendToConnection(connectionId, {
      type: 'queueSummary',
      requestId: message.requestId,
      success: true,
      data: { queues: queueSummaries }
    });
  } catch (error) {
    console.error('Queue summary error:', error);
    await sendErrorToConnection(connectionId, 'Queue summary error', 'Failed to get queue summary', message.requestId);
  }
}

// Agent performance handler
async function handleGetAgentPerformance(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicId, agentId, timeRange = 'today' } = message.data || {};
  
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  try {
    // Calculate date range
    const now = new Date();
    let startDate: string;
    let endDate = now.toISOString().split('T')[0];
    
    switch (timeRange) {
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = weekAgo.toISOString().split('T')[0];
        break;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDate = monthAgo.toISOString().split('T')[0];
        break;
      default:
        startDate = endDate;
    }
    
    // Build query for call history
    let queryParams: any = {
      TableName: CALL_HISTORY_TABLE,
      FilterExpression: '#date BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':start': startDate, ':end': endDate }
    };
    
    // Add clinic filter
    if (clinicId) {
      queryParams.FilterExpression += ' AND clinicId = :clinic';
      queryParams.ExpressionAttributeValues[':clinic'] = clinicId;
    } else {
      queryParams.FilterExpression += ' AND clinicId IN (' + accessCheck.userClinics.map((_, i) => `:c${i}`).join(',') + ')';
      accessCheck.userClinics.forEach((clinic, i) => {
        queryParams.ExpressionAttributeValues[`:c${i}`] = clinic;
      });
    }
    
    // Add agent filter if specified
    if (agentId) {
      queryParams.FilterExpression += ' AND agentId = :agent';
      queryParams.ExpressionAttributeValues[':agent'] = agentId;
    }
    
    const result = await ddb.send(new ScanCommand(queryParams));
    const calls = result.Items || [];
    
    // Group by agent
    const agentPerformance = calls.reduce((acc: any, call) => {
      const agent = call.agentId;
      if (!acc[agent]) {
        acc[agent] = {
          agentId: agent,
          agentName: call.agentName || agent,
          clinicId: call.clinicId,
          totalCalls: 0,
          answeredCalls: 0,
          totalDuration: 0,
          totalWaitTime: 0,
          inboundCalls: 0,
          outboundCalls: 0
        };
      }
      
      acc[agent].totalCalls++;
      if (call.status === 'ANSWERED') acc[agent].answeredCalls++;
      if (call.duration) acc[agent].totalDuration += call.duration;
      if (call.waitTime) acc[agent].totalWaitTime += call.waitTime;
      if (call.callType === 'INBOUND') acc[agent].inboundCalls++;
      if (call.callType === 'OUTBOUND') acc[agent].outboundCalls++;
      
      return acc;
    }, {});
    
    // Calculate metrics
    const performance = Object.values(agentPerformance).map((agent: any) => ({
      ...agent,
      averageCallDuration: agent.totalCalls > 0 ? agent.totalDuration / agent.totalCalls : 0,
      averageWaitTime: agent.answeredCalls > 0 ? agent.totalWaitTime / agent.answeredCalls : 0,
      answerRate: agent.totalCalls > 0 ? (agent.answeredCalls / agent.totalCalls) * 100 : 0
    }));
    
    await sendToConnection(connectionId, {
      type: 'agentPerformance',
      requestId: message.requestId,
      success: true,
      data: {
        performance,
        timeRange,
        startDate,
        endDate,
        summary: {
          totalAgents: performance.length,
          totalCalls: performance.reduce((sum: number, p: any) => sum + p.totalCalls, 0),
          totalAnswered: performance.reduce((sum: number, p: any) => sum + p.answeredCalls, 0)
        }
      }
    });
  } catch (error) {
    console.error('Agent performance error:', error);
    await sendErrorToConnection(connectionId, 'Agent performance error', 'Failed to get agent performance', message.requestId);
  }
}

// Call transfer handler (placeholder - requires advanced Chime SDK implementation)
async function handleCallTransfer(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { fromCallId, toAgentId, transferType = 'WARM' } = message.data || {};
  
  // This is a placeholder implementation
  // Full call transfer requires advanced Chime SDK meeting manipulation
  console.log(`Call transfer requested: ${fromCallId} -> ${toAgentId} (${transferType})`);
  
  await sendToConnection(connectionId, {
    type: 'callTransfer',
    requestId: message.requestId,
    success: true,
    data: {
      message: 'Call transfer initiated',
      transferId: `transfer-${Date.now()}`,
      note: 'Call transfer implementation requires advanced Chime SDK integration'
    }
  });
}

// Call recordings handler
async function handleGetCallRecordings(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { callId, clinicId, limit = 50 } = message.data || {};
  
  const accessCheck = validateClinicAccess(userContext, clinicId);
  
  if (!accessCheck.isValid) {
    await sendErrorToConnection(connectionId, 'Access denied', 'You do not have access to this clinic', message.requestId);
    return;
  }
  
  try {
    let queryParams: any = {
      TableName: CALL_HISTORY_TABLE,
      FilterExpression: 'attribute_exists(recordingUrl)',
      Limit: limit
    };
    
    if (callId) {
      queryParams.FilterExpression += ' AND callId = :callId';
      queryParams.ExpressionAttributeValues = { ':callId': callId };
    }
    
    if (clinicId) {
      queryParams.FilterExpression += ' AND clinicId = :clinic';
      queryParams.ExpressionAttributeValues = queryParams.ExpressionAttributeValues || {};
      queryParams.ExpressionAttributeValues[':clinic'] = clinicId;
    } else {
      // Filter by accessible clinics
      queryParams.FilterExpression += ' AND clinicId IN (' + accessCheck.userClinics.map((_, i) => `:c${i}`).join(',') + ')';
      queryParams.ExpressionAttributeValues = queryParams.ExpressionAttributeValues || {};
      accessCheck.userClinics.forEach((clinic, i) => {
        queryParams.ExpressionAttributeValues[`:c${i}`] = clinic;
      });
    }
    
    const result = await ddb.send(new ScanCommand(queryParams));
    const recordings = (result.Items || []).map(call => ({
      callId: call.callId,
      clinicId: call.clinicId,
      agentId: call.agentId,
      agentName: call.agentName,
      phoneNumber: call.phoneNumber,
      callType: call.callType,
      startTime: call.startTime,
      duration: call.duration,
      recordingUrl: call.recordingUrl,
      transcriptUrl: call.transcriptUrl,
      date: call.date
    }));
    
    await sendToConnection(connectionId, {
      type: 'callRecordings',
      requestId: message.requestId,
      success: true,
      data: { recordings, count: recordings.length }
    });
  } catch (error) {
    console.error('Call recordings error:', error);
    await sendErrorToConnection(connectionId, 'Call recordings error', 'Failed to get call recordings', message.requestId);
  }
}

// Call tracking event handler with real-time broadcasting
async function handleCallTracking(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const callEvent: CallEvent = message.data;
  
  if (!callEvent || !callEvent.callId || !callEvent.clinicId || !callEvent.callType || !callEvent.eventType) {
    await sendErrorToConnection(connectionId, 'Invalid call event', 'Missing required fields', message.requestId);
    return;
  }
  
  console.log('Processing call event via WebSocket:', callEvent);
  
  try {
    await Promise.all([
      updateCallHistory(callEvent),
      updateCallStatistics(callEvent)
    ]);
    
    // Broadcast real-time updates to all subscribed connections for this clinic
    await broadcastCallEvent(callEvent, connectionId);
    
    await sendToConnection(connectionId, {
      type: 'callEventProcessed',
      requestId: message.requestId,
      success: true,
      data: { message: 'Call event processed successfully' }
    });
  } catch (error) {
    console.error('Call tracking error:', error);
    await sendErrorToConnection(connectionId, 'Call tracking error', 'Failed to process call event', message.requestId);
  }
}

// Subscribe to real-time updates
async function handleSubscribeToRealTime(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  const { clinicIds, topics } = message.data || {};
  
  try {
    // Validate clinic access
    const validClinics = clinicIds?.filter((clinicId: string) => {
      const accessCheck = validateClinicAccess(userContext, clinicId);
      return accessCheck.isValid;
    }) || userContext.clinics;
    
    // Update connection with subscription info
    await ddb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET realTimeSubscriptions = :subs, lastSeen = :timestamp',
      ExpressionAttributeValues: {
        ':subs': {
          clinicIds: validClinics,
          topics: topics || ['calls', 'agents', 'statistics']
        },
        ':timestamp': Date.now()
      }
    }));
    
    await sendToConnection(connectionId, {
      type: 'realTimeSubscribed',
      requestId: message.requestId,
      success: true,
      data: {
        subscribedClinics: validClinics,
        subscribedTopics: topics || ['calls', 'agents', 'statistics']
      }
    });
  } catch (error) {
    console.error('Real-time subscription error:', error);
    await sendErrorToConnection(connectionId, 'Subscription error', 'Failed to subscribe to real-time updates', message.requestId);
  }
}

// Unsubscribe from real-time updates
async function handleUnsubscribeFromRealTime(connectionId: string, message: WebSocketMessage, userContext: any): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'REMOVE realTimeSubscriptions SET lastSeen = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': Date.now()
      }
    }));
    
    await sendToConnection(connectionId, {
      type: 'realTimeUnsubscribed',
      requestId: message.requestId,
      success: true,
      data: { message: 'Unsubscribed from real-time updates' }
    });
  } catch (error) {
    console.error('Real-time unsubscription error:', error);
    await sendErrorToConnection(connectionId, 'Unsubscription error', 'Failed to unsubscribe from real-time updates', message.requestId);
  }
}

// Utility functions
function validateClinicAccess(userContext: any, requestedClinicId?: string): { isValid: boolean; userClinics: string[]; isSuperAdmin: boolean } {
  const userClinics = userContext.clinics || [];
  const isSuperAdmin = userContext.isSuperAdmin || false;
  
  // Super admins can access all clinics
  if (isSuperAdmin) {
    return { isValid: true, userClinics, isSuperAdmin: true };
  }
  
  // If no specific clinic requested, user can access their clinics
  if (!requestedClinicId) {
    return { isValid: true, userClinics, isSuperAdmin: false };
  }
  
  // Check if user has access to the requested clinic
  const hasAccess = userClinics.includes(requestedClinicId);
  return { isValid: hasAccess, userClinics, isSuperAdmin: false };
}

async function getUserContext(connectionId: string): Promise<any> {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    
    if (!result.Item) {
      return null;
    }
    
    // Extract user context from stored connection data
    return {
      userId: result.Item.userId,
      email: result.Item.email || '',
      isSuperAdmin: result.Item.isSuperAdmin || false,
      clinics: result.Item.clinics || [],
    };
  } catch (error) {
    console.error('Failed to get user context:', error);
    return null;
  }
}

async function sendToConnection(connectionId: string, data: any): Promise<void> {
  try {
    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint: WEBSOCKET_API_ENDPOINT,
    });

    await apiGateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    }));

  } catch (error: any) {
    console.error('Failed to send message to connection:', error);
    
    // If connection is stale, remove it
    if (error.statusCode === 410) {
      try {
        await ddb.send(new DeleteCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          Key: { connectionId },
        }));
        console.log(`Removed stale connection: ${connectionId}`);
      } catch (deleteError) {
        console.error('Failed to remove stale connection:', deleteError);
      }
    }
    throw error;
  }
}

async function sendErrorToConnection(connectionId: string, error: string, details: string, requestId?: string): Promise<void> {
  await sendToConnection(connectionId, {
    type: 'error',
    requestId,
    success: false,
    error,
    details,
    timestamp: Date.now()
  });
}

async function broadcastCallEvent(callEvent: CallEvent, excludeConnectionId?: string): Promise<void> {
  try {
    // Get all connections subscribed to real-time updates for this clinic
    const response = await ddb.send(new ScanCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'attribute_exists(realTimeSubscriptions)'
    }));

    const connections = response.Items || [];
    const promises = connections
      .filter(conn => {
        if (conn.connectionId === excludeConnectionId) return false;
        
        const subscriptions = conn.realTimeSubscriptions;
        if (!subscriptions) return false;
        
        const subscribedClinics = subscriptions.clinicIds || [];
        const subscribedTopics = subscriptions.topics || [];
        
        return subscribedClinics.includes(callEvent.clinicId) && 
               subscribedTopics.includes('calls');
      })
      .map(conn => sendToConnection(conn.connectionId, {
        type: 'realTimeUpdate',
        category: 'callEvent',
        data: callEvent,
        timestamp: Date.now()
      }));

    await Promise.allSettled(promises);

  } catch (error) {
    console.error('Failed to broadcast call event:', error);
  }
}

// Call history and statistics update functions (reused from callTracking.ts)
async function updateCallHistory(callEvent: CallEvent): Promise<void> {
  const date = new Date(callEvent.timestamp).toISOString().split('T')[0];
  const callRecord = {
    callId: callEvent.callId,
    clinicId: callEvent.clinicId,
    agentId: callEvent.agentId,
    agentName: callEvent.agentName,
    callType: callEvent.callType,
    phoneNumber: callEvent.phoneNumber,
    date,
    lastEventType: callEvent.eventType,
    lastEventTime: callEvent.timestamp,
    meetingId: callEvent.meetingId,
    attendeeId: callEvent.attendeeId
  };
  
  switch (callEvent.eventType) {
    case 'CALL_START':
      await ddb.send(new PutCommand({
        TableName: CALL_HISTORY_TABLE,
        Item: {
          ...callRecord,
          startTime: callEvent.timestamp,
          status: 'RINGING'
        }
      }));
      break;
      
    case 'CALL_ANSWER':
      await ddb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId: callEvent.callId },
        UpdateExpression: 'SET answerTime = :time, #status = :status, waitTime = :wait, lastEventType = :event, lastEventTime = :eventTime',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':time': callEvent.timestamp,
          ':status': 'ANSWERED',
          ':wait': callEvent.waitTime || 0,
          ':event': callEvent.eventType,
          ':eventTime': callEvent.timestamp
        }
      }));
      break;
      
    case 'CALL_END':
      const duration = callEvent.duration || 0;
      await ddb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId: callEvent.callId },
        UpdateExpression: 'SET endTime = :time, duration = :duration, #status = :status, lastEventType = :event, lastEventTime = :eventTime' +
          (callEvent.recordingUrl ? ', recordingUrl = :recording' : '') +
          (callEvent.transcriptUrl ? ', transcriptUrl = :transcript' : ''),
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':time': callEvent.timestamp,
          ':duration': duration,
          ':status': duration > 0 ? 'COMPLETED' : 'MISSED',
          ':event': callEvent.eventType,
          ':eventTime': callEvent.timestamp,
          ...(callEvent.recordingUrl && { ':recording': callEvent.recordingUrl }),
          ...(callEvent.transcriptUrl && { ':transcript': callEvent.transcriptUrl })
        }
      }));
      break;
      
    case 'CALL_MISSED':
      await ddb.send(new UpdateCommand({
        TableName: CALL_HISTORY_TABLE,
        Key: { callId: callEvent.callId },
        UpdateExpression: 'SET endTime = :time, #status = :status, lastEventType = :event, lastEventTime = :eventTime',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':time': callEvent.timestamp,
          ':status': 'MISSED',
          ':event': callEvent.eventType,
          ':eventTime': callEvent.timestamp
        }
      }));
      break;
  }
}

async function updateCallStatistics(callEvent: CallEvent): Promise<void> {
  const date = new Date(callEvent.timestamp).toISOString().split('T')[0];
  const statsKey = { clinicId: callEvent.clinicId, date };
  
  // Get current statistics
  const currentStats = await ddb.send(new GetCommand({
    TableName: CALL_STATISTICS_TABLE,
    Key: statsKey
  }));
  
  const stats = currentStats.Item || {
    ...statsKey,
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    answeredCalls: 0,
    missedCalls: 0,
    totalDuration: 0,
    totalWaitTime: 0,
    updatedAt: callEvent.timestamp
  };
  
  // Update statistics based on event type
  switch (callEvent.eventType) {
    case 'CALL_START':
      stats.totalCalls++;
      if (callEvent.callType === 'INBOUND') stats.inboundCalls++;
      if (callEvent.callType === 'OUTBOUND') stats.outboundCalls++;
      break;
      
    case 'CALL_ANSWER':
      stats.answeredCalls++;
      if (callEvent.waitTime) {
        stats.totalWaitTime += callEvent.waitTime;
      }
      break;
      
    case 'CALL_END':
      if (callEvent.duration) {
        stats.totalDuration += callEvent.duration;
      }
      break;
      
    case 'CALL_MISSED':
      stats.missedCalls++;
      break;
  }
  
  // Calculate derived metrics
  stats.averageCallDuration = stats.totalCalls > 0 ? stats.totalDuration / stats.totalCalls : 0;
  stats.averageWaitTime = stats.answeredCalls > 0 ? stats.totalWaitTime / stats.answeredCalls : 0;
  stats.answerRate = stats.totalCalls > 0 ? (stats.answeredCalls / stats.totalCalls) * 100 : 0;
  stats.updatedAt = callEvent.timestamp;
  
  // Save updated statistics
  await ddb.send(new PutCommand({
    TableName: CALL_STATISTICS_TABLE,
    Item: stats
  }));
}
