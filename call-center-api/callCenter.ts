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
const CALL_HISTORY_TABLE = process.env.CALL_HISTORY_TABLE as string;
const CALL_STATISTICS_TABLE = process.env.CALL_STATISTICS_TABLE as string;
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
		
		// Call Center Dashboard APIs
		if (path.endsWith('/call-center/dashboard') && event.httpMethod === 'GET') {
			return await handleDashboard(event);
		}
		
		// Call Center Statistics APIs
		if (path.endsWith('/call-center/statistics') && event.httpMethod === 'GET') {
			return await handleStatistics(event);
		}
		
		// Real-time Agent Status for Supervisors
		if (path.endsWith('/call-center/agents/status') && event.httpMethod === 'GET') {
			return await handleAgentsStatus(event);
		}
		
		// Call History APIs
		if (path.endsWith('/call-center/history') && event.httpMethod === 'GET') {
			return await handleCallHistory(event);
		}
		
		// Queue Management APIs
		if (path.endsWith('/call-center/queue/summary') && event.httpMethod === 'GET') {
			return await handleQueueSummary(event);
		}
		
		// Agent Performance APIs
		if (path.endsWith('/call-center/performance') && event.httpMethod === 'GET') {
			return await handleAgentPerformance(event);
		}
		
		// Call Transfer APIs
		if (path.endsWith('/call-center/transfer') && event.httpMethod === 'POST') {
			return await handleCallTransfer(event);
		}
		
		// Call Recording APIs
		if (path.endsWith('/call-center/recordings') && event.httpMethod === 'GET') {
			return await handleCallRecordings(event);
		}

		return resp(404, { success: false, message: 'not found' });
	} catch (err: any) {
		console.error('Call Center API error:', err);
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

function validateClinicAccess(event: APIGatewayProxyEvent, requestedClinicId?: string): { isValid: boolean; userClinics: string[]; isSuperAdmin: boolean } {
	const context = event.requestContext.authorizer;
	const userClinics = context?.x_clinics ? JSON.parse(context.x_clinics) : [];
	const isSuperAdmin = context?.x_is_super_admin === 'true';
	
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

// Dashboard handler - provides overview of call center status
async function handleDashboard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, {
			success: true,
			dashboard: {
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
			}
		});
	} catch (error) {
		console.error('Dashboard error:', error);
		return resp(500, { success: false, message: 'failed to get dashboard data' });
	}
}

// Real-time statistics handler
async function handleStatistics(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const timeRange = event.queryStringParameters?.timeRange || 'today'; // today, week, month
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { success: true, statistics });
	} catch (error) {
		console.error('Statistics error:', error);
		return resp(500, { success: false, message: 'failed to get statistics' });
	}
}

// Agents status handler for supervisor view
async function handleAgentsStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { 
			success: true, 
			agents: allAgents,
			summary: {
				total: allAgents.length,
				available: allAgents.filter(a => a.state === 'AVAILABLE').length,
				busy: allAgents.filter(a => a.state === 'BUSY').length,
				break: allAgents.filter(a => a.state === 'BREAK').length,
				offline: allAgents.filter(a => a.state === 'OFFLINE').length
			}
		});
	} catch (error) {
		console.error('Agents status error:', error);
		return resp(500, { success: false, message: 'failed to get agents status' });
	}
}

// Call history handler
async function handleCallHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const agentId = event.queryStringParameters?.agentId;
	const limit = parseInt(event.queryStringParameters?.limit || '50');
	const startDate = event.queryStringParameters?.startDate;
	const endDate = event.queryStringParameters?.endDate;
	
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { success: true, calls, count: calls.length });
	} catch (error) {
		console.error('Call history error:', error);
		return resp(500, { success: false, message: 'failed to get call history' });
	}
}

// Queue summary handler
async function handleQueueSummary(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { success: true, queues: queueSummaries });
	} catch (error) {
		console.error('Queue summary error:', error);
		return resp(500, { success: false, message: 'failed to get queue summary' });
	}
}

// Agent performance handler
async function handleAgentPerformance(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const clinicId = event.queryStringParameters?.clinicId;
	const agentId = event.queryStringParameters?.agentId;
	const timeRange = event.queryStringParameters?.timeRange || 'today';
	
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { 
			success: true, 
			performance,
			timeRange,
			startDate,
			endDate,
			summary: {
				totalAgents: performance.length,
				totalCalls: performance.reduce((sum: number, p: any) => sum + p.totalCalls, 0),
				totalAnswered: performance.reduce((sum: number, p: any) => sum + p.answeredCalls, 0)
			}
		});
	} catch (error) {
		console.error('Agent performance error:', error);
		return resp(500, { success: false, message: 'failed to get agent performance' });
	}
}

// Call transfer handler (placeholder - requires advanced Chime SDK implementation)
async function handleCallTransfer(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const body = safeJson(event.body);
	const fromCallId = body.fromCallId;
	const toAgentId = body.toAgentId;
	const transferType = body.transferType || 'WARM'; // WARM, COLD, CONFERENCE
	
	// This is a placeholder implementation
	// Full call transfer requires advanced Chime SDK meeting manipulation
	console.log(`Call transfer requested: ${fromCallId} -> ${toAgentId} (${transferType})`);
	
	return resp(200, { 
		success: true, 
		message: 'Call transfer initiated',
		transferId: `transfer-${Date.now()}`,
		note: 'Call transfer implementation requires advanced Chime SDK integration'
	});
}

// Call recordings handler
async function handleCallRecordings(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
	const callId = event.queryStringParameters?.callId;
	const clinicId = event.queryStringParameters?.clinicId;
	const limit = parseInt(event.queryStringParameters?.limit || '50');
	
	const accessCheck = validateClinicAccess(event, clinicId);
	
	if (!accessCheck.isValid) {
		return resp(403, { success: false, message: 'access denied' });
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
		
		return resp(200, { success: true, recordings, count: recordings.length });
	} catch (error) {
		console.error('Call recordings error:', error);
		return resp(500, { success: false, message: 'failed to get call recordings' });
	}
}
