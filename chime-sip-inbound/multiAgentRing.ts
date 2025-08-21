import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeMeetings = new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION });

interface PendingCall {
  callId: string;
  fromNumber: string;
  clinicId: string;
  chimeCallId: string;
  ringStartTime: number;
  ringingAgents: string[];
  assignedAgent?: string;
  status: 'RINGING' | 'ANSWERED' | 'TIMEOUT' | 'HANGUP';
}

// Ring multiple agents simultaneously
export async function ringMultipleAgents(
  fromNumber: string,
  clinicId: string,
  chimeCallId: string
): Promise<{ success: boolean; ringingAgents: string[] }> {
  
  // Find ALL available agents for this clinic
  const availableAgents = await findAllAvailableAgents(clinicId);
  
  if (availableAgents.length === 0) {
    return { success: false, ringingAgents: [] };
  }

  // Create pending call record
  const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const pendingCall: PendingCall = {
    callId,
    fromNumber,
    clinicId,
    chimeCallId,
    ringStartTime: Date.now(),
    ringingAgents: availableAgents.map(a => a.agentId),
    status: 'RINGING'
  };

  await dynamodb.send(new PutCommand({
    TableName: process.env.PENDING_CALLS_TABLE!,
    Item: pendingCall
  }));

  // Notify ALL available agents via WebSocket/Voice Gateway
  for (const agent of availableAgents) {
    await notifyAgentOfIncomingCall(agent.agentId, callId, fromNumber);
  }

  // Set timeout to stop ringing after 30 seconds
  setTimeout(() => handleRingTimeout(callId), 30000);

  return { 
    success: true, 
    ringingAgents: availableAgents.map(a => a.agentId) 
  };
}

// Agent answers the call
export async function agentAnswerCall(
  agentId: string, 
  callId: string
): Promise<{ success: boolean; meeting?: any; attendee?: any }> {
  
  // Get pending call
  const callResult = await dynamodb.send(new GetCommand({
    TableName: process.env.PENDING_CALLS_TABLE!,
    Key: { callId }
  }));

  const pendingCall = callResult.Item as PendingCall;
  if (!pendingCall || pendingCall.status !== 'RINGING') {
    return { success: false }; // Call already answered or ended
  }

  // Mark call as answered by this agent
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.PENDING_CALLS_TABLE!,
    Key: { callId },
    UpdateExpression: 'SET #status = :status, #assignedAgent = :agent',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#assignedAgent': 'assignedAgent'
    },
    ExpressionAttributeValues: {
      ':status': 'ANSWERED',
      ':agent': agentId
    }
  }));

  // Stop ringing for all other agents
  await stopRingingForOtherAgents(callId, agentId, pendingCall.ringingAgents);

  // Create meeting for the answering agent
  const { meeting, attendee } = await createMeetingForAgent(agentId);

  // Update agent session with meeting info
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.AGENT_SESSIONS_TABLE!,
    Key: { agentId },
    UpdateExpression: 'SET #state = :state, #activeCallId = :callId, #meetingId = :meetingId, #attendeeId = :attendeeId',
    ExpressionAttributeNames: {
      '#state': 'state',
      '#activeCallId': 'activeCallId',
      '#meetingId': 'meetingId',
      '#attendeeId': 'attendeeId'
    },
    ExpressionAttributeValues: {
      ':state': 'BUSY',
      ':callId': callId,
      ':meetingId': meeting.MeetingId,
      ':attendeeId': attendee.AttendeeId
    }
  }));

  return { success: true, meeting, attendee };
}

// Stop ringing for other agents when one answers
async function stopRingingForOtherAgents(
  callId: string, 
  answeringAgentId: string, 
  allRingingAgents: string[]
): Promise<void> {
  
  const otherAgents = allRingingAgents.filter(id => id !== answeringAgentId);
  
  // Notify all other agents that call was answered
  for (const agentId of otherAgents) {
    await notifyAgentCallAnswered(agentId, callId);
  }
}

// Handle ring timeout (no one answered)
async function handleRingTimeout(callId: string): Promise<void> {
  
  const callResult = await dynamodb.send(new GetCommand({
    TableName: process.env.PENDING_CALLS_TABLE!,
    Key: { callId }
  }));

  const pendingCall = callResult.Item as PendingCall;
  if (!pendingCall || pendingCall.status !== 'RINGING') {
    return; // Call already handled
  }

  // Mark as timeout
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.PENDING_CALLS_TABLE!,
    Key: { callId },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'TIMEOUT'
    }
  }));

  // Stop ringing for all agents
  for (const agentId of pendingCall.ringingAgents) {
    await notifyAgentCallTimeout(agentId, callId);
  }

  // TODO: Route to voicemail or play message
}

// Helper function to create meeting
async function createMeetingForAgent(agentId: string): Promise<{ meeting: any; attendee: any }> {
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
    meeting: meetingResponse.Meeting,
    attendee: attendeeResponse.Attendee,
  };
}

async function findAllAvailableAgents(clinicId: string): Promise<Array<{ agentId: string }>> {
  const response = await dynamodb.send(new ScanCommand({
    TableName: process.env.AGENT_SESSIONS_TABLE!,
    FilterExpression: '#clinicId = :clinicId AND #state = :state',
    ExpressionAttributeNames: {
      '#clinicId': 'clinicId',
      '#state': 'state',
    },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':state': 'AVAILABLE',
    },
  }));

  return (response.Items || []).map(item => ({ agentId: item.agentId }));
}

// WebSocket notifications to agents
async function notifyAgentOfIncomingCall(agentId: string, callId: string, fromNumber: string): Promise<void> {
  try {
    console.log(`[Ring] Notifying agent ${agentId} of incoming call ${callId} from ${fromNumber}`);
    
    // Get agent's WebSocket connection
    const connections = await getAgentWebSocketConnections(agentId);
    
    const message = {
      type: 'INCOMING_CALL',
      callId,
      fromNumber,
      action: 'START_RING',
      timestamp: Date.now(),
    };

    // Send to all agent's connections (they might have multiple tabs open)
    for (const connectionId of connections) {
      await sendWebSocketMessage(connectionId, message);
    }
    
  } catch (error) {
    console.error(`[Ring] Failed to notify agent ${agentId}:`, error);
  }
}

async function notifyAgentCallAnswered(agentId: string, callId: string): Promise<void> {
  try {
    console.log(`[Ring] Stopping ring for agent ${agentId}, call ${callId} answered by another agent`);
    
    const connections = await getAgentWebSocketConnections(agentId);
    
    const message = {
      type: 'CALL_ANSWERED_BY_OTHER',
      callId,
      action: 'STOP_RING',
      timestamp: Date.now(),
    };

    for (const connectionId of connections) {
      await sendWebSocketMessage(connectionId, message);
    }
    
  } catch (error) {
    console.error(`[Ring] Failed to notify agent ${agentId} of call answered:`, error);
  }
}

async function notifyAgentCallTimeout(agentId: string, callId: string): Promise<void> {
  try {
    console.log(`[Ring] Ring timeout for agent ${agentId}, call ${callId}`);
    
    const connections = await getAgentWebSocketConnections(agentId);
    
    const message = {
      type: 'CALL_TIMEOUT',
      callId,
      action: 'STOP_RING',
      timestamp: Date.now(),
    };

    for (const connectionId of connections) {
      await sendWebSocketMessage(connectionId, message);
    }
    
  } catch (error) {
    console.error(`[Ring] Failed to notify agent ${agentId} of timeout:`, error);
  }
}

// WebSocket helper functions
async function getAgentWebSocketConnections(agentId: string): Promise<string[]> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: process.env.WEBSOCKET_CONNECTIONS_TABLE!,
      FilterExpression: '#userId = :userId',
      ExpressionAttributeNames: {
        '#userId': 'userId',
      },
      ExpressionAttributeValues: {
        ':userId': agentId,
      },
    }));

    return (response.Items || []).map(item => item.connectionId);
  } catch (error) {
    console.error('Failed to get WebSocket connections for agent:', agentId, error);
    return [];
  }
}

async function sendWebSocketMessage(connectionId: string, message: any): Promise<void> {
  try {
    // This would use your existing WebSocket API Gateway management client
    // const apiGatewayManagement = new ApiGatewayManagementApiClient({
    //   endpoint: process.env.WEBSOCKET_API_ENDPOINT
    // });

    // await apiGatewayManagement.send(new PostToConnectionCommand({
    //   ConnectionId: connectionId,
    //   Data: JSON.stringify(message),
    // }));

    console.log(`[WebSocket] Sent message to ${connectionId}:`, message);
  } catch (error) {
    console.error(`[WebSocket] Failed to send message to ${connectionId}:`, error);
    
    // If connection is stale, remove it from the table
    if (error instanceof Error && error.name === 'GoneException') {
      await removeStaleConnection(connectionId);
    }
  }
}

async function removeStaleConnection(connectionId: string): Promise<void> {
  try {
    await dynamodb.send(new DeleteCommand({
      TableName: process.env.WEBSOCKET_CONNECTIONS_TABLE!,
      Key: { connectionId },
    }));
    console.log(`[WebSocket] Removed stale connection: ${connectionId}`);
  } catch (error) {
    console.error(`[WebSocket] Failed to remove stale connection ${connectionId}:`, error);
  }
}
