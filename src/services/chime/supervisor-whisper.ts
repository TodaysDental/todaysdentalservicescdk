import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';
import {
    sendWhisperMessage,
    getWhisperMessages,
    markWhisperMessagesRead,
} from './utils/supervisor-tools';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;

/**
 * SUPERVISOR WHISPER MESSAGES
 *
 * POST /call-center/supervisor/whisper   { agentId, callId, message }
 * GET  /call-center/supervisor/whisper?agentId=xxx&callId=yyy
 * PUT  /call-center/supervisor/whisper   { agentId, messageIds: string[] }  (mark read)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const corsHeaders = buildCorsHeaders({}, requestOrigin);

    try {
        if (!CHIME_CONFIG.SUPERVISOR.ENABLED || !CHIME_CONFIG.SUPERVISOR.ENABLE_WHISPER) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Whisper is disabled' }) };
        }

        const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const userId = getUserIdFromJwt(verifyResult.payload!);
        if (!userId) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ message: 'Unauthorized' }) };
        }

        const method = event.httpMethod.toUpperCase();

        // ── SEND whisper message (supervisor → agent) ─────────────────────
        if (method === 'POST') {
            const payload = verifyResult.payload as any;
            const roles = payload.roles || payload['custom:roles'] || [];
            const isSupervisor = roles.includes('supervisor') || roles.includes('admin') || payload.isSuperAdmin || payload.isGlobalSuperAdmin;
            if (!isSupervisor) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Requires supervisor role' }) };
            }

            const body = JSON.parse(event.body || '{}');
            const { agentId, callId, message } = body;
            if (!agentId || !callId || !message) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'agentId, callId, and message are required' }) };
            }

            const result = await sendWhisperMessage(ddb, userId, agentId, callId, message, AGENT_PRESENCE_TABLE_NAME);
            return {
                statusCode: result.success ? 200 : 400,
                headers: corsHeaders,
                body: JSON.stringify(result),
            };
        }

        // ── GET whisper messages (agent polls for coaching messages) ──────
        if (method === 'GET') {
            const agentId = event.queryStringParameters?.agentId || userId;
            const callId = event.queryStringParameters?.callId;
            if (!callId) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'callId query param is required' }) };
            }

            const messages = await getWhisperMessages(ddb, agentId, callId, AGENT_PRESENCE_TABLE_NAME);
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ messages, count: messages.length }),
            };
        }

        // ── MARK READ ────────────────────────────────────────────────────
        if (method === 'PUT') {
            const body = JSON.parse(event.body || '{}');
            const { messageIds } = body;
            const agentId = body.agentId || userId;
            if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'messageIds array is required' }) };
            }

            await markWhisperMessagesRead(ddb, agentId, messageIds, AGENT_PRESENCE_TABLE_NAME);
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Messages marked as read' }),
            };
        }

        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ message: 'Method not allowed' }) };
    } catch (error) {
        console.error('[supervisor-whisper] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Whisper operation failed', error: error instanceof Error ? error.message : 'Unknown' }),
        };
    }
};
