/* eslint-disable @typescript-eslint/no-var-requires */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';

// Use require to avoid local type dependency issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
const { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } = require('@aws-sdk/client-chime-sdk-voice');

// Node globals shim for linter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const voice = new (ChimeSDKVoiceClient as any)({});

const AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE as string;
const SIP_MEDIA_APPLICATION_ID = process.env.SIP_MEDIA_APPLICATION_ID as string;
const CLINIC_CALLER_ID_MAP = safeParseJson(process.env.CLINIC_CALLER_ID_MAP || '{}') as Record<string, string>;

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
		if (event.httpMethod !== 'POST') return resp(405, { success: false, message: 'method not allowed' });

		const body = safeJson(event.body);
		const destination = normalizePhone(String(body.phoneNumber || ''));
		const clinicId = String(body.clinicId || '').trim();
		const preferredAgentId = String(body.agentId || '').trim();
		if (!destination || !clinicId) return resp(400, { success: false, message: 'phoneNumber and clinicId are required' });

		const callerId = CLINIC_CALLER_ID_MAP[clinicId];
		if (!callerId) return resp(400, { success: false, message: 'caller ID not configured for clinic' });

		let agent: any | undefined;
		if (preferredAgentId) {
			const r = await ddb.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId: preferredAgentId } }));
			agent = r.Item;
		}
		if (!agent) {
			const q = await ddb.send(new QueryCommand({
				TableName: AGENTS_TABLE,
				IndexName: 'ClinicStateIndex',
				KeyConditionExpression: 'clinicId = :c AND #s = :a',
				ExpressionAttributeValues: { ':c': clinicId, ':a': 'AVAILABLE' },
				ExpressionAttributeNames: { '#s': 'state' },
				Limit: 1,
			}));
			agent = q.Items && q.Items[0];
		}
		if (!agent?.meetingId) return resp(409, { success: false, message: 'no available agent meeting' });

		// Mark agent BUSY
		await ddb.send(new UpdateCommand({
			TableName: AGENTS_TABLE,
			Key: { agentId: agent.agentId },
			UpdateExpression: 'SET #s = :b, updatedAt = :t, activeCallId = :c',
			ExpressionAttributeNames: { '#s': 'state' },
			ExpressionAttributeValues: { ':b': 'BUSY', ':t': Date.now(), ':c': `outbound-${Date.now()}` },
		}));

		// Launch outbound PSTN via SMA; pass meeting context for bridging in TransactionAttributes
		const cmd = new (CreateSipMediaApplicationCallCommand as any)({
			FromPhoneNumber: callerId,
			ToPhoneNumber: destination,
			SipMediaApplicationId: SIP_MEDIA_APPLICATION_ID,
			ArgumentsMap: {
				meetingId: String(agent.meetingId),
				agentId: String(agent.agentId),
				clinicId: String(clinicId),
			},
		});
		
		try {
			const result = await voice.send(cmd);
			return resp(200, { 
				success: true, 
				callId: result.SipMediaApplicationCall?.CallId,
				agentId: agent.agentId,
				meetingId: agent.meetingId
			});
		} catch (error) {
			// Reset agent state on call failure
			await ddb.send(new UpdateCommand({
				TableName: AGENTS_TABLE,
				Key: { agentId: agent.agentId },
				UpdateExpression: 'SET #s = :a, updatedAt = :t REMOVE activeCallId',
				ExpressionAttributeNames: { '#s': 'state' },
				ExpressionAttributeValues: { ':a': 'AVAILABLE', ':t': Date.now() },
			}));
			throw error;
		}
	} catch (err: any) {
		return resp(500, { success: false, message: err?.message || 'failed to start outbound call' });
	}
};

function safeJson(b: any): any { try { return typeof b === 'string' ? JSON.parse(b) : (b || {}); } catch { return {}; } }
function safeParseJson(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
function normalizePhone(n: string): string { const d = n.replace(/[^0-9+]/g, ''); if (d.startsWith('+')) return d; if (d.length === 10) return '+1' + d; return d; }


