/* eslint-disable @typescript-eslint/no-var-requires */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';
// Use require to avoid type resolution issues when local types are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
const { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } = require('@aws-sdk/client-chime-sdk-meetings');
// Node globals shim for linter
declare const process: any;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const meetings = new ChimeSDKMeetingsClient({});

const AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE as string;
const QUEUE_TABLE = process.env.VOICE_QUEUE_TABLE as string;
const MEETING_REGION = process.env.MEETING_REGION || process.env.AWS_REGION || 'us-east-1';

const corsHeaders = buildCorsHeaders();

function resp(code: number, body: any): APIGatewayProxyResult {
	return { 
		statusCode: code, 
		headers: { 
			'Content-Type': 'application/json',
			...corsHeaders
		}, 
		body: JSON.stringify(body) 
	};
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
	try {
		if (event.httpMethod === 'OPTIONS') return resp(200, { ok: true });
		const path = event.resource || '';
		
		// Agent login/logout endpoints
		if (path.endsWith('/voice/agent/login') && event.httpMethod === 'POST') {
			return await handleAgentLogin(event);
		}
		
		if (path.endsWith('/voice/agent/logout') && event.httpMethod === 'POST') {
			return await handleAgentLogout(event);
		}

		if (path.endsWith('/voice/agent/state') && event.httpMethod === 'POST') {
			return await handleAgentStateChange(event);
		}
		
		if (path.endsWith('/voice/agent/status') && event.httpMethod === 'GET') {
			return await handleGetAgentStatus(event);
		}
		
		// Agent list/management
		if (path.endsWith('/voice/agents') && event.httpMethod === 'GET') {
			return await handleListAgents(event);
		}

		// Queue management
		if (path.endsWith('/voice/queue/assign') && event.httpMethod === 'POST') {
			return await handleQueueAssign(event);
		}
		
		if (path.endsWith('/voice/queue/status') && event.httpMethod === 'GET') {
			return await handleQueueStatus(event);
		}
		
		// Call management
		if (path.endsWith('/voice/call/end') && event.httpMethod === 'POST') {
			return await handleEndCall(event);
		}

		return resp(404, { success: false, message: 'not found' });
	} catch (err: any) {
		console.error('Voice API error:', err);
		return resp(500, { success: false, message: err?.message || 'internal error' });
	}
};

// Utility functions
function safeJson(b: any): any { 
	try { 
		return typeof b === 'string' ? JSON.parse(b) : (b || {}); 
	} catch { 
		return {}; 
	} 
}

function normalizePhone(n: string): string { 
	const d = n.replace(/[^0-9+]/g, ''); 
	if (d.startsWith('+')) return d; 
	if (d.length === 10) return '+1' + d; 
	return d; 
}

async function getClinicForNumber(phoneNumber: string): Promise<string | undefined> {
	const out = await ddb.send(new GetCommand({ TableName: QUEUE_TABLE, Key: { phoneNumber } }));
	return out?.Item?.clinicId as string | undefined;
}

async function findAvailableAgent(clinicId: string): Promise<any | undefined> {
	const q = await ddb.send(new QueryCommand({
		TableName: AGENTS_TABLE,
		IndexName: 'ClinicStateIndex',
		KeyConditionExpression: 'clinicId = :c AND #s = :a',
		ExpressionAttributeValues: { ':c': clinicId, ':a': 'AVAILABLE' },
		ExpressionAttributeNames: { '#s': 'state' },
		Limit: 1,
	}));
	return q.Items && q.Items[0];
}

// Handler functions
async function handleAgentLogin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const agentId = String(body.agentId || '').trim();
	const clinicId = String(body.clinicId || '').trim();
	const agentName = String(body.agentName || agentId);
	
	if (!agentId || !clinicId) {
		return resp(400, { success: false, message: 'agentId and clinicId required' });
	}

	// Check if agent already logged in
	const existing = await ddb.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
	let meeting: any = existing?.Item?.meeting;
	let meetingId: string | undefined = meeting?.MeetingId || existing?.Item?.meetingId;
	let meetingRegion: string | undefined = meeting?.MediaRegion || existing?.Item?.meetingRegion || MEETING_REGION;
	
	// Create new meeting if none exists or if forced refresh
	if (!meetingId || body.forceNewMeeting) {
		const externalMeetingId = `${agentId}-${Date.now()}`;
		const meetingResponse = await meetings.send(new CreateMeetingCommand({ 
			ClientRequestToken: externalMeetingId,
			ExternalMeetingId: externalMeetingId,  // Required by Chime SDK
			MediaRegion: meetingRegion 
		}));
		meeting = meetingResponse.Meeting;
		meetingId = meeting?.MeetingId;
		meetingRegion = meeting?.MediaRegion;
	}

	// Create attendee for agent, with fallback if meeting doesn't exist
	let attendee;
	try {
		attendee = await meetings.send(new CreateAttendeeCommand({ 
			MeetingId: String(meetingId), 
			ExternalUserId: agentId 
		}));
	} catch (error: any) {
		// If meeting not found, create a new meeting and try again
		if (error.name === 'NotFoundException' || error.message?.includes('not found')) {
			console.log(`Meeting ${meetingId} not found, creating new meeting for agent ${agentId}`);
			const externalMeetingId = `${agentId}-${Date.now()}`;
			const meetingResponse = await meetings.send(new CreateMeetingCommand({ 
				ClientRequestToken: externalMeetingId,
				ExternalMeetingId: externalMeetingId,
				MediaRegion: meetingRegion 
			}));
			meeting = meetingResponse.Meeting;
			meetingId = meeting?.MeetingId;
			meetingRegion = meeting?.MediaRegion;
			
			// Try creating attendee again with new meeting
			attendee = await meetings.send(new CreateAttendeeCommand({ 
				MeetingId: String(meetingId), 
				ExternalUserId: agentId 
			}));
		} else {
			throw error; // Re-throw if it's a different error
		}
	}
	
	await ddb.send(new PutCommand({
		TableName: AGENTS_TABLE,
		Item: {
			agentId,
			clinicId,
			agentName,
			state: 'AVAILABLE',
			meetingId,
			meetingRegion,
			meeting,  // Store complete meeting object
			agentAttendeeId: attendee.Attendee?.AttendeeId,
			loginTime: Date.now(),
			updatedAt: Date.now(),
		},
	}));

	return resp(200, {
		success: true,
		agentId,
		meeting,  // Return complete meeting object
		agentAttendee: attendee.Attendee,
		state: 'AVAILABLE'
	});
}

async function handleAgentLogout(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const agentId = String(body.agentId || '').trim();
	
	if (!agentId) {
		return resp(400, { success: false, message: 'agentId required' });
	}

	// Get agent to check current state
	const agent = await ddb.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
	if (!agent?.Item) {
		return resp(404, { success: false, message: 'agent not found' });
	}

	// Update agent state to OFFLINE
	await ddb.send(new UpdateCommand({
		TableName: AGENTS_TABLE,
		Key: { agentId },
		UpdateExpression: 'SET #s = :s, updatedAt = :t, logoutTime = :lt',
		ExpressionAttributeNames: { '#s': 'state' },
		ExpressionAttributeValues: { 
			':s': 'OFFLINE', 
			':t': Date.now(),
			':lt': Date.now()
		},
	}));

	return resp(200, { success: true, message: 'agent logged out' });
}

async function handleAgentStateChange(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const agentId = String(body.agentId || '').trim();
	const state = String(body.state || '').trim().toUpperCase();
	
	if (!agentId || !state) {
		return resp(400, { success: false, message: 'agentId and state required' });
	}
	
	// Validate state
	const validStates = ['AVAILABLE', 'BUSY', 'BREAK', 'OFFLINE'];
	if (!validStates.includes(state)) {
		return resp(400, { success: false, message: 'invalid state. Valid states: ' + validStates.join(', ') });
	}
	
	await ddb.send(new UpdateCommand({
		TableName: AGENTS_TABLE,
		Key: { agentId },
		UpdateExpression: 'SET #s = :s, updatedAt = :t',
		ExpressionAttributeNames: { '#s': 'state' },
		ExpressionAttributeValues: { ':s': state, ':t': Date.now() },
	}));
	
	return resp(200, { success: true, agentId, state });
}

async function handleGetAgentStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const agentId = event.pathParameters?.agentId || event.queryStringParameters?.agentId;
	
	if (!agentId) {
		return resp(400, { success: false, message: 'agentId required' });
	}
	
	const agent = await ddb.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
	if (!agent?.Item) {
		return resp(404, { success: false, message: 'agent not found' });
	}
	
	return resp(200, { success: true, agent: agent.Item });
}

async function handleListAgents(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const state = event.queryStringParameters?.state;
	
	let queryParams: any = {
		TableName: AGENTS_TABLE
	};
	
	if (clinicId && state) {
		// Query by clinic and state
		queryParams = {
			...queryParams,
			IndexName: 'ClinicStateIndex',
			KeyConditionExpression: 'clinicId = :c AND #s = :s',
			ExpressionAttributeValues: { ':c': clinicId, ':s': state.toUpperCase() },
			ExpressionAttributeNames: { '#s': 'state' }
		};
		const result = await ddb.send(new QueryCommand(queryParams));
		return resp(200, { success: true, agents: result.Items || [] });
		
	} else if (clinicId) {
		// Query by clinic only
		queryParams = {
			...queryParams,
			IndexName: 'ClinicStateIndex',
			KeyConditionExpression: 'clinicId = :c',
			ExpressionAttributeValues: { ':c': clinicId }
		};
		const result = await ddb.send(new QueryCommand(queryParams));
		return resp(200, { success: true, agents: result.Items || [] });
		
	} else {
		// Scan all agents (use with caution)
		const result = await ddb.send(new ScanCommand(queryParams));
		return resp(200, { success: true, agents: result.Items || [] });
	}
}

async function handleQueueAssign(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const phoneNumber = normalizePhone(String(body.phoneNumber || ''));
	
	if (!phoneNumber) {
		return resp(400, { success: false, message: 'phoneNumber required' });
	}
	
	const clinicId = await getClinicForNumber(phoneNumber);
	if (!clinicId) {
		return resp(404, { success: false, message: 'no clinic mapping found for this number' });
	}
	
	const agent = await findAvailableAgent(clinicId);
	if (!agent) {
		return resp(409, { success: false, message: 'no available agents for this clinic' });
	}
	
	return resp(200, { success: true, clinicId, agent });
}

async function handleQueueStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	
	if (!clinicId) {
		return resp(400, { success: false, message: 'clinicId required' });
	}
	
	// Get all agents for this clinic
	const result = await ddb.send(new QueryCommand({
		TableName: AGENTS_TABLE,
		IndexName: 'ClinicStateIndex',
		KeyConditionExpression: 'clinicId = :c',
		ExpressionAttributeValues: { ':c': clinicId }
	}));
	
	const agents = result.Items || [];
	const summary = {
		total: agents.length,
		available: agents.filter(a => a.state === 'AVAILABLE').length,
		busy: agents.filter(a => a.state === 'BUSY').length,
		break: agents.filter(a => a.state === 'BREAK').length,
		offline: agents.filter(a => a.state === 'OFFLINE').length
	};
	
	return resp(200, { success: true, clinicId, summary, agents });
}

async function handleEndCall(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const agentId = String(body.agentId || '').trim();
	const callId = String(body.callId || '').trim();
	
	if (!agentId) {
		return resp(400, { success: false, message: 'agentId required' });
	}
	
	// Mark agent as available again
	await ddb.send(new UpdateCommand({
		TableName: AGENTS_TABLE,
		Key: { agentId },
		UpdateExpression: 'SET #s = :s, updatedAt = :t REMOVE activeCallId',
		ExpressionAttributeNames: { '#s': 'state' },
		ExpressionAttributeValues: { ':s': 'AVAILABLE', ':t': Date.now() },
	}));
	
	return resp(200, { success: true, message: 'call ended, agent marked available' });
}


