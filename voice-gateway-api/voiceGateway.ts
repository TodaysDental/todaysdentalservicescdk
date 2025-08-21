import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand, GetVoiceConnectorCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

// Initialize AWS clients
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({ region: process.env.AWS_REGION });
const chimeMeetings = new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION });

// Environment variables
const AGENT_SESSIONS_TABLE = process.env.AGENT_SESSIONS_TABLE!;
const CALL_HISTORY_TABLE = process.env.CALL_HISTORY_TABLE!;
const CALL_STATISTICS_TABLE = process.env.CALL_STATISTICS_TABLE!;
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE!;
const PENDING_CALLS_TABLE = process.env.PENDING_CALLS_TABLE!;

interface AgentSession {
  agentId: string;
  clinicId: string;
  meetingId?: string;
  attendeeId?: string;
  state: 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'BREAK';
  loginTime: number;
  lastHeartbeat: number;
  activeCallId?: string;
  connectionId?: string;
}

interface CallSession {
  callId: string;
  clinicId: string;
  agentId?: string;
  callType: 'INBOUND' | 'OUTBOUND';
  phoneNumber: string;
  state: 'INITIATED' | 'RINGING' | 'CONNECTED' | 'ENDED';
  startTime: number;
  connectTime?: number;
  endTime?: number;
  duration?: number;
  date: string; // YYYY-MM-DD format for GSI sort key
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://todaysdentalinsights.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const pathParams = event.pathParameters || {};

    // Extract user info from JWT token
    const userContext = await extractUserContext(event);
    if (!userContext) {
      return createResponse(401, { error: 'Unauthorized' }, corsHeaders);
    }

    // Route to appropriate handler
    if (path.startsWith('/voice-gateway/agent')) {
      return await handleAgentOperations(method, path, event.body, userContext, pathParams);
    } else if (path.startsWith('/voice-gateway/call')) {
      return await handleCallOperations(method, path, event.body, userContext, pathParams);
    } else if (path.startsWith('/voice-gateway/stats')) {
      return await handleStatsOperations(method, path, event.queryStringParameters, userContext);
    } else {
      return createResponse(404, { error: 'Not found' }, corsHeaders);
    }

  } catch (error) {
    console.error('Voice Gateway Error:', error);
    return createResponse(500, { error: 'Internal server error' }, corsHeaders);
  }
};

async function handleAgentOperations(method: string, path: string, body: string | null, userContext: any, pathParams: any): Promise<APIGatewayProxyResult> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://todaysdentalinsights.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (path.endsWith('/login') && method === 'POST') {
    return await agentLogin(body, userContext, corsHeaders);
  } else if (path.endsWith('/logout') && method === 'POST') {
    return await agentLogout(userContext, corsHeaders);
  } else if (path.endsWith('/status') && method === 'PUT') {
    return await updateAgentStatus(body, userContext, corsHeaders);
  } else if (path.endsWith('/heartbeat') && method === 'POST') {
    return await agentHeartbeat(userContext, corsHeaders);
  } else if (path.includes('/status') && method === 'GET') {
    return await getAgentsStatus(userContext, corsHeaders);
  }

  return createResponse(404, { error: 'Agent endpoint not found' }, corsHeaders);
}

async function handleCallOperations(method: string, path: string, body: string | null, userContext: any, pathParams: any): Promise<APIGatewayProxyResult> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://todaysdentalinsights.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (path.endsWith('/outbound') && method === 'POST') {
    return await initiateOutboundCall(body, userContext, corsHeaders);
  } else if (path.endsWith('/inbound') && method === 'POST') {
    return await handleInboundCall(body, userContext, corsHeaders);
  } else if (path.endsWith('/answer') && method === 'POST') {
    return await answerIncomingCall(body, userContext, corsHeaders);
  } else if (path.endsWith('/decline') && method === 'POST') {
    return await declineIncomingCall(body, userContext, corsHeaders);
  } else if (path.endsWith('/end-by-chime-id') && method === 'POST') {
    return await endCallByChimeId(body, userContext, corsHeaders);
  } else if (path.includes('/end') && method === 'POST') {
    return await endCall(pathParams.callId, userContext, corsHeaders);
  } else if (path.includes('/hold') && method === 'POST') {
    return await holdCall(pathParams.callId, userContext, corsHeaders);
  } else if (path.includes('/resume') && method === 'POST') {
    return await resumeCall(pathParams.callId, userContext, corsHeaders);
  } else if (path.endsWith('/active') && method === 'GET') {
    return await getActiveCalls(userContext, corsHeaders);
  }

  return createResponse(404, { error: 'Call endpoint not found' }, corsHeaders);
}

async function handleStatsOperations(method: string, path: string, queryParams: any, userContext: any): Promise<APIGatewayProxyResult> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://todaysdentalinsights.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (path.endsWith('/dashboard') && method === 'GET') {
    return await getDashboardStats(queryParams, userContext, corsHeaders);
  } else if (path.endsWith('/history') && method === 'GET') {
    return await getCallHistory(queryParams, userContext, corsHeaders);
  }

  return createResponse(404, { error: 'Stats endpoint not found' }, corsHeaders);
}

async function agentLogin(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { clinicId } = JSON.parse(body);
  const agentId = userContext.userId;

  try {
    // Store agent session without meeting (meeting will be created when call starts)
    const agentSession: AgentSession = {
      agentId,
      clinicId,
      // meetingId and attendeeId will be set when a call is initiated
      state: 'AVAILABLE',
      loginTime: Date.now(),
      lastHeartbeat: Date.now(),
    };

    await dynamodb.send(new PutCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Item: agentSession,
    }));

    // Broadcast agent status update
    await broadcastAgentUpdate(agentSession);

    return createResponse(200, {
      success: true,
      agentId,
      state: 'AVAILABLE',
      message: 'Agent logged in successfully. Meeting will be created when call starts.',
    }, corsHeaders);

  } catch (error) {
    console.error('Agent login error:', error);
    return createResponse(500, { error: 'Failed to login agent' }, corsHeaders);
  }
}

async function agentLogout(userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const agentId = userContext.userId;

  try {
    // Get agent session
    const response = await dynamodb.send(new GetCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
    }));

    if (response.Item) {
      const session = response.Item as AgentSession;
      
      // Delete Chime meeting if one exists (only created during active calls)
      if (session.meetingId) {
        try {
          await chimeMeetings.send(new DeleteMeetingCommand({
            MeetingId: session.meetingId,
          }));
        } catch (error) {
          console.warn('Failed to delete meeting during logout:', error);
          // Continue with logout even if meeting deletion fails
        }
      }

      // Update agent status to offline
      await dynamodb.send(new UpdateCommand({
        TableName: AGENT_SESSIONS_TABLE,
        Key: { agentId },
        UpdateExpression: 'SET #state = :state, #endTime = :endTime REMOVE #meetingId, #attendeeId, #activeCallId',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#endTime': 'endTime',
          '#meetingId': 'meetingId',
          '#attendeeId': 'attendeeId',
          '#activeCallId': 'activeCallId',
        },
        ExpressionAttributeValues: {
          ':state': 'OFFLINE',
          ':endTime': Date.now(),
        },
      }));

      // Broadcast agent status update
      await broadcastAgentUpdate({ ...session, state: 'OFFLINE' });
    }

    return createResponse(200, { success: true }, corsHeaders);

  } catch (error) {
    console.error('Agent logout error:', error);
    return createResponse(500, { error: 'Failed to logout agent' }, corsHeaders);
  }
}

async function updateAgentStatus(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { state } = JSON.parse(body);
  const agentId = userContext.userId;

  try {
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #state = :state, #lastHeartbeat = :heartbeat',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#lastHeartbeat': 'lastHeartbeat',
      },
      ExpressionAttributeValues: {
        ':state': state,
        ':heartbeat': Date.now(),
      },
    }));

    // Get updated session and broadcast
    const response = await dynamodb.send(new GetCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
    }));

    if (response.Item) {
      await broadcastAgentUpdate(response.Item as AgentSession);
    }

    return createResponse(200, { success: true, state }, corsHeaders);

  } catch (error) {
    console.error('Update agent status error:', error);
    return createResponse(500, { error: 'Failed to update agent status' }, corsHeaders);
  }
}

async function agentHeartbeat(userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const agentId = userContext.userId;

  try {
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #lastHeartbeat = :heartbeat',
      ExpressionAttributeNames: {
        '#lastHeartbeat': 'lastHeartbeat',
      },
      ExpressionAttributeValues: {
        ':heartbeat': Date.now(),
      },
    }));

    return createResponse(200, { success: true, timestamp: Date.now() }, corsHeaders);

  } catch (error) {
    console.error('Agent heartbeat error:', error);
    return createResponse(500, { error: 'Failed to update heartbeat' }, corsHeaders);
  }
}

// Helper function to create a meeting for an agent when a call starts
async function createMeetingForAgent(agentId: string): Promise<{ meetingId: string; attendeeId: string; meeting: any; attendee: any }> {
  try {
    // Create Chime meeting for call
    const meetingResponse = await chimeMeetings.send(new CreateMeetingCommand({
      ClientRequestToken: `${agentId}-${Date.now()}`,
      ExternalMeetingId: `${agentId}-call-${Date.now()}`,
      MediaRegion: 'us-east-1',
    }));

    const attendeeResponse = await chimeMeetings.send(new CreateAttendeeCommand({
      MeetingId: meetingResponse.Meeting!.MeetingId!,
      ExternalUserId: agentId,
    }));

    return {
      meetingId: meetingResponse.Meeting!.MeetingId!,
      attendeeId: attendeeResponse.Attendee!.AttendeeId!,
      meeting: meetingResponse.Meeting,
      attendee: attendeeResponse.Attendee,
    };
  } catch (error) {
    console.error('Failed to create meeting for agent:', error);
    throw error;
  }
}

async function getAgentsStatus(userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: AGENT_SESSIONS_TABLE,
      FilterExpression: '#state <> :offline',
      ExpressionAttributeNames: {
        '#state': 'state',
      },
      ExpressionAttributeValues: {
        ':offline': 'OFFLINE',
      },
    }));

    const agents = response.Items || [];
    
    return createResponse(200, { agents }, corsHeaders);

  } catch (error) {
    console.error('Get agents status error:', error);
    return createResponse(500, { error: 'Failed to get agents status' }, corsHeaders);
  }
}

async function initiateOutboundCall(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { phoneNumber, clinicId } = JSON.parse(body);
  const agentId = userContext.userId;

  try {
    // Generate call ID
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create meeting for this call
    const { meetingId, attendeeId, meeting, attendee } = await createMeetingForAgent(agentId);

    // Create call session
    const now = Date.now();
    const callSession: CallSession = {
      callId,
      clinicId,
      agentId,
      callType: 'OUTBOUND',
      phoneNumber,
      state: 'INITIATED',
      startTime: now,
      date: new Date(now).toISOString().split('T')[0], // YYYY-MM-DD format
    };

    await dynamodb.send(new PutCommand({
      TableName: CALL_HISTORY_TABLE,
      Item: callSession,
    }));

    // Update agent status to busy and assign meeting
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #state = :state, #activeCallId = :callId, #meetingId = :meetingId, #attendeeId = :attendeeId',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#activeCallId': 'activeCallId',
        '#meetingId': 'meetingId',
        '#attendeeId': 'attendeeId',
      },
      ExpressionAttributeValues: {
        ':state': 'BUSY',
        ':callId': callId,
        ':meetingId': meetingId,
        ':attendeeId': attendeeId,
      },
    }));

    // Use the new outbound calling system to make real external calls
    const { initiateOutboundCall: initiateCall } = await import('./outboundCalling');
    
    const externalCallResult = await initiateCall({
      phoneNumber,
      clinicId,
      agentId,
    });

    if (!externalCallResult.success) {
      // Cleanup the created meeting and call session if external call failed
      try {
        await chimeMeetings.send(new DeleteMeetingCommand({
          MeetingId: meetingId,
        }));
        // Remove call from history since it failed
        await dynamodb.send(new DeleteCommand({
          TableName: CALL_HISTORY_TABLE,
          Key: { callId },
        }));
        // Reset agent status
        await dynamodb.send(new UpdateCommand({
          TableName: AGENT_SESSIONS_TABLE,
          Key: { agentId },
          UpdateExpression: 'SET #state = :state REMOVE #activeCallId, #meetingId, #attendeeId',
          ExpressionAttributeNames: {
            '#state': 'state',
            '#activeCallId': 'activeCallId',
            '#meetingId': 'meetingId',
            '#attendeeId': 'attendeeId',
          },
          ExpressionAttributeValues: {
            ':state': 'AVAILABLE',
          },
        }));
      } catch (cleanupError) {
        console.error('Failed to cleanup after outbound call failure:', cleanupError);
      }
      
      return createResponse(400, { 
        error: externalCallResult.error || 'Failed to initiate outbound call to external number' 
      }, corsHeaders);
    }
    
    // Broadcast call update
    await broadcastCallUpdate(callSession);

    return createResponse(200, {
      success: true,
      callId,
      state: 'INITIATED',
      meeting: meeting,
      attendee: attendee,
      message: 'Outbound call initiated to external number with meeting created',
      externalCallId: externalCallResult.callId,
    }, corsHeaders);

  } catch (error) {
    console.error('Initiate outbound call error:', error);
    return createResponse(500, { error: 'Failed to initiate call' }, corsHeaders);
  }
}

async function handleInboundCall(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { phoneNumber, clinicId, assignedAgentId } = JSON.parse(body);
  
  // Use assigned agent if provided, otherwise use the requesting user (for manual assignment)
  const agentId = assignedAgentId || userContext.userId;

  try {
    // Generate call ID
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create meeting for this call
    const { meetingId, attendeeId, meeting, attendee } = await createMeetingForAgent(agentId);

    // Create call session
    const now = Date.now();
    const callSession: CallSession = {
      callId,
      clinicId,
      agentId,
      callType: 'INBOUND',
      phoneNumber,
      state: 'RINGING',
      startTime: now,
      date: new Date(now).toISOString().split('T')[0], // YYYY-MM-DD format
    };

    await dynamodb.send(new PutCommand({
      TableName: CALL_HISTORY_TABLE,
      Item: callSession,
    }));

    // Update agent status to busy and assign meeting
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #state = :state, #activeCallId = :callId, #meetingId = :meetingId, #attendeeId = :attendeeId',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#activeCallId': 'activeCallId',
        '#meetingId': 'meetingId',
        '#attendeeId': 'attendeeId',
      },
      ExpressionAttributeValues: {
        ':state': 'BUSY',
        ':callId': callId,
        ':meetingId': meetingId,
        ':attendeeId': attendeeId,
      },
    }));

    // Broadcast call update
    await broadcastCallUpdate(callSession);

    return createResponse(200, {
      success: true,
      callId,
      state: 'RINGING',
      meeting: meeting,
      attendee: attendee,
      message: 'Inbound call routed with meeting created',
    }, corsHeaders);

  } catch (error) {
    console.error('Handle inbound call error:', error);
    return createResponse(500, { error: 'Failed to handle inbound call' }, corsHeaders);
  }
}

async function endCall(callId: string, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const agentId = userContext.userId;

  try {
    const endTime = Date.now();

    // Get call session
    const callResponse = await dynamodb.send(new GetCommand({
      TableName: CALL_HISTORY_TABLE,
      Key: { callId },
    }));

    if (!callResponse.Item) {
      return createResponse(404, { error: 'Call not found' }, corsHeaders);
    }

    const call = callResponse.Item as CallSession;
    const duration = endTime - call.startTime;

    // Get agent session to access meeting info
    const agentResponse = await dynamodb.send(new GetCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
    }));

    // Delete the meeting if it exists
    if (agentResponse.Item && agentResponse.Item.meetingId) {
      try {
        await chimeMeetings.send(new DeleteMeetingCommand({
          MeetingId: agentResponse.Item.meetingId,
        }));
      } catch (error) {
        console.warn('Failed to delete meeting when ending call:', error);
        // Continue with call ending even if meeting deletion fails
      }
    }

    // Update call session
    await dynamodb.send(new UpdateCommand({
      TableName: CALL_HISTORY_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #state = :state, #endTime = :endTime, #duration = :duration',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#endTime': 'endTime',
        '#duration': 'duration',
      },
      ExpressionAttributeValues: {
        ':state': 'ENDED',
        ':endTime': endTime,
        ':duration': duration,
      },
    }));

    // Update agent status back to available and remove meeting info
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_SESSIONS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #state = :state REMOVE #activeCallId, #meetingId, #attendeeId',
      ExpressionAttributeNames: {
        '#state': 'state',
        '#activeCallId': 'activeCallId',
        '#meetingId': 'meetingId',
        '#attendeeId': 'attendeeId',
      },
      ExpressionAttributeValues: {
        ':state': 'AVAILABLE',
      },
    }));

    // Broadcast updates
    const updatedCall: CallSession = { 
      ...call, 
      state: 'ENDED' as const, 
      endTime, 
      duration 
    };
    await broadcastCallUpdate(updatedCall);

    return createResponse(200, { 
      success: true, 
      callId, 
      duration,
      message: 'Call ended and meeting cleaned up'
    }, corsHeaders);

  } catch (error) {
    console.error('End call error:', error);
    return createResponse(500, { error: 'Failed to end call' }, corsHeaders);
  }
}

async function answerIncomingCall(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { callId } = JSON.parse(body);
  const agentId = userContext.userId;

  try {
    console.log(`[VoiceGateway] Agent ${agentId} answering call ${callId}`);

    // Import agentAnswerCall from the multi-agent ring module
    const { agentAnswerCall } = await import('../chime-sip-inbound/multiAgentRing');
    
    const result = await agentAnswerCall(agentId, callId);
    
    if (!result.success) {
      return createResponse(409, { 
        error: 'Call already answered or no longer available',
        message: 'Another agent may have already taken this call'
      }, corsHeaders);
    }

    console.log(`[VoiceGateway] Call ${callId} successfully answered by agent ${agentId}`);

    return createResponse(200, {
      success: true,
      callId,
      meeting: result.meeting,
      attendee: result.attendee,
      message: 'Call answered successfully, meeting created',
    }, corsHeaders);

  } catch (error) {
    console.error('[VoiceGateway] Answer call error:', error);
    return createResponse(500, { error: 'Failed to answer call' }, corsHeaders);
  }
}

async function declineIncomingCall(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { callId } = JSON.parse(body);
  const agentId = userContext.userId;

  try {
    console.log(`[VoiceGateway] Agent ${agentId} declining call ${callId}`);

    // Get pending call to see if this agent was ringing
    const pendingCallResponse = await dynamodb.send(new GetCommand({
      TableName: PENDING_CALLS_TABLE,
      Key: { callId },
    }));

    const pendingCall = pendingCallResponse.Item;
    if (!pendingCall || !pendingCall.ringingAgents.includes(agentId)) {
      return createResponse(404, { error: 'Call not found or not ringing for this agent' }, corsHeaders);
    }

    // Remove this agent from the ringing list
    const updatedRingingAgents = pendingCall.ringingAgents.filter((id: string) => id !== agentId);
    
    if (updatedRingingAgents.length === 0) {
      // No more agents ringing - mark call as timeout and route to voicemail
      await dynamodb.send(new UpdateCommand({
        TableName: PENDING_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #status = :status, #ringingAgents = :agents',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#ringingAgents': 'ringingAgents',
        },
        ExpressionAttributeValues: {
          ':status': 'ALL_DECLINED',
          ':agents': [],
        },
      }));

      // TODO: Trigger voicemail flow via Chime SIP
    } else {
      // Update ringing agents list
      await dynamodb.send(new UpdateCommand({
        TableName: PENDING_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #ringingAgents = :agents',
        ExpressionAttributeNames: {
          '#ringingAgents': 'ringingAgents',
        },
        ExpressionAttributeValues: {
          ':agents': updatedRingingAgents,
        },
      }));
    }

    return createResponse(200, { 
      success: true, 
      callId,
      message: 'Call declined successfully',
      remainingAgents: updatedRingingAgents.length,
    }, corsHeaders);

  } catch (error) {
    console.error('[VoiceGateway] Decline call error:', error);
    return createResponse(500, { error: 'Failed to decline call' }, corsHeaders);
  }
}

async function endCallByChimeId(body: string | null, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, { error: 'Request body required' }, corsHeaders);
  }

  const { chimeCallId } = JSON.parse(body);

  try {
    console.log(`[VoiceGateway] Ending call by Chime ID: ${chimeCallId}`);

    // Find call by Chime call ID
    const callsResponse = await dynamodb.send(new ScanCommand({
      TableName: CALL_HISTORY_TABLE,
      FilterExpression: '#chimeCallId = :chimeCallId',
      ExpressionAttributeNames: {
        '#chimeCallId': 'chimeCallId',
      },
      ExpressionAttributeValues: {
        ':chimeCallId': chimeCallId,
      },
    }));

    const calls = callsResponse.Items || [];
    if (calls.length === 0) {
      console.log('[VoiceGateway] No call found with Chime ID:', chimeCallId);
      return createResponse(404, { error: 'Call not found' }, corsHeaders);
    }

    const call = calls[0] as CallSession;
    
    // End the call using existing logic
    return await endCall(call.callId, { userId: call.agentId || 'system' }, corsHeaders);

  } catch (error) {
    console.error('[VoiceGateway] End call by Chime ID error:', error);
    return createResponse(500, { error: 'Failed to end call' }, corsHeaders);
  }
}

async function holdCall(callId: string, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // TODO: Implement call hold functionality
  return createResponse(200, { success: true, callId, action: 'hold' }, corsHeaders);
}

async function resumeCall(callId: string, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // TODO: Implement call resume functionality
  return createResponse(200, { success: true, callId, action: 'resume' }, corsHeaders);
}

async function getActiveCalls(userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: CALL_HISTORY_TABLE,
      FilterExpression: '#state IN (:initiated, :ringing, :connected)',
      ExpressionAttributeNames: {
        '#state': 'state',
      },
      ExpressionAttributeValues: {
        ':initiated': 'INITIATED',
        ':ringing': 'RINGING',
        ':connected': 'CONNECTED',
      },
    }));

    const activeCalls = response.Items || [];
    
    return createResponse(200, { calls: activeCalls }, corsHeaders);

  } catch (error) {
    console.error('Get active calls error:', error);
    return createResponse(500, { error: 'Failed to get active calls' }, corsHeaders);
  }
}

async function getDashboardStats(queryParams: any, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const clinicId = queryParams?.clinicId;
    
    // Get active agents
    const agentsResponse = await dynamodb.send(new ScanCommand({
      TableName: AGENT_SESSIONS_TABLE,
      FilterExpression: clinicId ? '#clinicId = :clinicId AND #state <> :offline' : '#state <> :offline',
      ExpressionAttributeNames: {
        '#state': 'state',
        ...(clinicId && { '#clinicId': 'clinicId' }),
      },
      ExpressionAttributeValues: {
        ':offline': 'OFFLINE',
        ...(clinicId && { ':clinicId': clinicId }),
      },
    }));

    const agents = agentsResponse.Items || [];
    const availableAgents = agents.filter(a => a.state === 'AVAILABLE').length;
    const busyAgents = agents.filter(a => a.state === 'BUSY').length;

    // Get today's call stats
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const callsResponse = await dynamodb.send(new ScanCommand({
      TableName: CALL_HISTORY_TABLE,
      FilterExpression: '#startTime >= :todayStart' + (clinicId ? ' AND #clinicId = :clinicId' : ''),
      ExpressionAttributeNames: {
        '#startTime': 'startTime',
        ...(clinicId && { '#clinicId': 'clinicId' }),
      },
      ExpressionAttributeValues: {
        ':todayStart': todayStart,
        ...(clinicId && { ':clinicId': clinicId }),
      },
    }));

    const todaysCalls = callsResponse.Items || [];
    const answeredCalls = todaysCalls.filter(c => c.state === 'ENDED' && c.connectTime).length;
    const inboundCalls = todaysCalls.filter(c => c.callType === 'INBOUND').length;
    const outboundCalls = todaysCalls.filter(c => c.callType === 'OUTBOUND').length;

    const dashboard = {
      summary: {
        totalAgents: agents.length,
        availableAgents,
        busyAgents,
        totalCallsToday: todaysCalls.length,
        answeredCallsToday: answeredCalls,
        inboundCallsToday: inboundCalls,
        outboundCallsToday: outboundCalls,
        answerRate: todaysCalls.length > 0 ? (answeredCalls / todaysCalls.length) * 100 : 0,
        averageWaitTime: 0, // TODO: Calculate from call data
      },
    };

    return createResponse(200, { dashboard }, corsHeaders);

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return createResponse(500, { error: 'Failed to get dashboard stats' }, corsHeaders);
  }
}

async function getCallHistory(queryParams: any, userContext: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const clinicId = queryParams?.clinicId;
    const limit = parseInt(queryParams?.limit || '50');
    const dateParam = queryParams?.date; // Optional date filter (YYYY-MM-DD)

    let params: any = {
      TableName: CALL_HISTORY_TABLE,
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    };

    if (clinicId) {
      params.IndexName = 'ClinicDateIndex';
      
      if (dateParam) {
        // Query for specific clinic and date
        params.KeyConditionExpression = '#clinicId = :clinicId AND #date = :date';
        params.ExpressionAttributeNames = { 
          '#clinicId': 'clinicId',
          '#date': 'date'
        };
        params.ExpressionAttributeValues = { 
          ':clinicId': clinicId,
          ':date': dateParam 
        };
      } else {
        // Query for clinic with date range (get recent calls)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        params.KeyConditionExpression = '#clinicId = :clinicId AND #date BETWEEN :startDate AND :endDate';
        params.ExpressionAttributeNames = { 
          '#clinicId': 'clinicId',
          '#date': 'date'
        };
        params.ExpressionAttributeValues = { 
          ':clinicId': clinicId,
          ':startDate': thirtyDaysAgo,
          ':endDate': today
        };
      }
      
      const response = await dynamodb.send(new QueryCommand(params));
      
      // Sort by startTime in descending order since GSI is sorted by date
      const sortedCalls = (response.Items || []).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      
      return createResponse(200, { calls: sortedCalls }, corsHeaders);
    } else {
      // No clinic specified, do a scan (less efficient but works)
      const response = await dynamodb.send(new ScanCommand(params));
      
      // Sort by startTime in descending order
      const sortedCalls = (response.Items || []).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      
      return createResponse(200, { calls: sortedCalls }, corsHeaders);
    }

  } catch (error) {
    console.error('Get call history error:', error);
    return createResponse(500, { error: 'Failed to get call history' }, corsHeaders);
  }
}

async function broadcastAgentUpdate(agentSession: AgentSession): Promise<void> {
  // TODO: Implement WebSocket broadcasting to connected clients
  console.log('Broadcasting agent update:', agentSession);
}

async function broadcastCallUpdate(callSession: CallSession): Promise<void> {
  // TODO: Implement WebSocket broadcasting to connected clients
  console.log('Broadcasting call update:', callSession);
}

async function extractUserContext(event: APIGatewayProxyEvent): Promise<any> {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    
    // Decode JWT token
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    return {
      userId: payload.sub || payload.email || payload.username,
      email: payload.email || '',
      isSuperAdmin: payload['custom:x_is_super_admin'] === 'true',
      clinics: JSON.parse(payload['custom:x_clinics'] || '[]'),
    };
  } catch (error) {
    console.error('Failed to extract user context:', error);
    return null;
  }
}

function createResponse(statusCode: number, body: any, headers: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}
