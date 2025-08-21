/* eslint-disable @typescript-eslint/no-var-requires */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';

// Node globals shim for linter
declare const process: any;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CALL_HISTORY_TABLE = process.env.CALL_HISTORY_TABLE as string;
const CALL_STATISTICS_TABLE = process.env.CALL_STATISTICS_TABLE as string;

const corsHeaders = buildCorsHeaders();

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
		
		const body = JSON.parse(event.body || '{}') as CallEvent;
		
		// Validate required fields
		if (!body.callId || !body.clinicId || !body.callType || !body.eventType) {
			return resp(400, { success: false, message: 'missing required fields' });
		}
		
		console.log('Processing call event:', body);
		
		await Promise.all([
			updateCallHistory(body),
			updateCallStatistics(body)
		]);
		
		return resp(200, { success: true, message: 'call event processed' });
	} catch (err: any) {
		console.error('Call tracking error:', err);
		return resp(500, { success: false, message: err?.message || 'internal error' });
	}
};

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
