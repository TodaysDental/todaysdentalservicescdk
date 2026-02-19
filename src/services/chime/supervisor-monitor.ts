import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import {
    startSupervision,
    changeSupervisionMode,
    endSupervision,
    SupervisionMode,
} from './utils/supervisor-tools';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const SUPERVISOR_SESSIONS_TABLE_NAME = process.env.SUPERVISOR_SESSIONS_TABLE_NAME!;

/**
 * SUPERVISOR MONITOR
 *
 * Manages supervision lifecycle — start / change-mode / end.
 *
 * POST   /call-center/supervisor/monitor  { callId, clinicId, queuePosition, mode }
 * PUT    /call-center/supervisor/monitor  { sessionId, mode, clinicId, queuePosition }
 * DELETE /call-center/supervisor/monitor  { sessionId, clinicId, queuePosition, notes? }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const corsHeaders = buildCorsHeaders({}, requestOrigin);

    try {
        if (!CHIME_CONFIG.SUPERVISOR.ENABLED) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Supervisor tools are disabled' }) };
        }

        // Auth
        const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const supervisorId = getUserIdFromJwt(verifyResult.payload!);
        if (!supervisorId) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ message: 'Unauthorized' }) };
        }

        // Role check
        const payload = verifyResult.payload as any;
        const roles = payload.roles || payload['custom:roles'] || [];
        const isSupervisor = roles.includes('supervisor') || roles.includes('admin') || payload.isSuperAdmin || payload.isGlobalSuperAdmin;
        if (!isSupervisor) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Requires supervisor role' }) };
        }

        const method = event.httpMethod.toUpperCase();
        const body = JSON.parse(event.body || '{}');

        // ── START supervision ──────────────────────────────────────────────
        if (method === 'POST') {
            const { callId, clinicId, queuePosition, mode } = body;
            if (!callId || !clinicId || queuePosition === undefined || !mode) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'callId, clinicId, queuePosition, and mode are required' }) };
            }

            // Validate mode
            if (!Object.values(SupervisionMode).includes(mode)) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: `Invalid mode. Valid: ${Object.values(SupervisionMode).join(', ')}` }) };
            }

            // Validate whisper/barge config
            if (mode === SupervisionMode.WHISPER && !CHIME_CONFIG.SUPERVISOR.ENABLE_WHISPER) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Whisper mode is disabled' }) };
            }
            if (mode === SupervisionMode.BARGE && !CHIME_CONFIG.SUPERVISOR.ENABLE_BARGE) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Barge mode is disabled' }) };
            }

            // Clinic authorization
            const authzCheck = checkClinicAuthorization(payload, clinicId);
            if (!authzCheck.authorized) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Not authorized for this clinic' }) };
            }

            const result = await startSupervision(
                ddb, supervisorId, callId, clinicId, queuePosition, mode,
                CALL_QUEUE_TABLE_NAME, SUPERVISOR_SESSIONS_TABLE_NAME,
            );

            return {
                statusCode: result.success ? 200 : 400,
                headers: corsHeaders,
                body: JSON.stringify(result),
            };
        }

        // ── CHANGE MODE ────────────────────────────────────────────────────
        if (method === 'PUT') {
            const { sessionId, mode, clinicId, queuePosition } = body;
            if (!sessionId || !mode || !clinicId || queuePosition === undefined) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'sessionId, mode, clinicId, and queuePosition are required' }) };
            }

            if (!Object.values(SupervisionMode).includes(mode)) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: `Invalid mode` }) };
            }

            const result = await changeSupervisionMode(
                ddb, sessionId, supervisorId, mode, clinicId, queuePosition,
                CALL_QUEUE_TABLE_NAME,
            );

            return {
                statusCode: result.success ? 200 : 400,
                headers: corsHeaders,
                body: JSON.stringify(result),
            };
        }

        // ── END supervision ────────────────────────────────────────────────
        if (method === 'DELETE') {
            const { sessionId, clinicId, queuePosition, notes } = body;
            if (!sessionId || !clinicId || queuePosition === undefined) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'sessionId, clinicId, and queuePosition are required' }) };
            }

            const result = await endSupervision(
                ddb, sessionId, supervisorId, clinicId, queuePosition,
                CALL_QUEUE_TABLE_NAME, SUPERVISOR_SESSIONS_TABLE_NAME, notes,
            );

            return {
                statusCode: result.success ? 200 : 400,
                headers: corsHeaders,
                body: JSON.stringify(result),
            };
        }

        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ message: 'Method not allowed' }) };
    } catch (error) {
        console.error('[supervisor-monitor] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Supervisor operation failed', error: error instanceof Error ? error.message : 'Unknown' }),
        };
    }
};
