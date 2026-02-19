import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { getMonitorableCalls } from './utils/supervisor-tools';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;

/**
 * SUPERVISOR LIVE CALLS
 *
 * Returns all active calls that the authenticated supervisor is authorized
 * to monitor.  Used by the supervisor dashboard to populate the live-call list.
 *
 * GET /call-center/supervisor/live-calls?clinicId=xxx   (optional filter)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const corsHeaders = buildCorsHeaders({}, requestOrigin);

    try {
        if (!CHIME_CONFIG.SUPERVISOR.ENABLED) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Supervisor tools are disabled' }),
            };
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

        // Role check – only supervisors / admins
        const payload = verifyResult.payload as any;
        const roles = payload.roles || payload['custom:roles'] || [];
        const isSupervisor =
            roles.includes('supervisor') || roles.includes('admin') ||
            payload.isSuperAdmin || payload.isGlobalSuperAdmin;
        if (!isSupervisor) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Requires supervisor role' }) };
        }

        // Determine allowed clinics
        const allowedClinicIds: string[] = payload.clinicIds || payload.authorizedClinics || [];
        const filterClinicId = event.queryStringParameters?.clinicId;

        // If a specific clinic is requested, ensure supervisor is authorized for it
        if (filterClinicId) {
            const authzCheck = checkClinicAuthorization(payload, filterClinicId);
            if (!authzCheck.authorized) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Not authorized for this clinic' }) };
            }
        }

        const clinicIds = filterClinicId ? [filterClinicId] : allowedClinicIds;

        const calls = await getMonitorableCalls(
            ddb,
            supervisorId,
            clinicIds,
            CALL_QUEUE_TABLE_NAME,
            AGENT_PRESENCE_TABLE_NAME,
        );

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                calls,
                count: calls.length,
                supervisorId,
                timestamp: new Date().toISOString(),
            }),
        };
    } catch (error) {
        console.error('[supervisor-live-calls] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to fetch live calls', error: error instanceof Error ? error.message : 'Unknown' }),
        };
    }
};
