import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    UserPermissions,
} from '../../shared/utils/permissions-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_COST_TABLE || 'ClinicCostOfOperation';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);

    try {
        // Get user permissions from custom authorizer
        const userPerms = getUserPermissions(event);
        if (!userPerms) {
            return err(401, 'Unauthorized - Invalid token', event);
        }

        const path = event.resource || '';
        const method = event.httpMethod;
        const clinicName = event.pathParameters?.clinicName;

        // Route handling
        // GET /clinic-costs - Get all clinic costs (any authenticated user can read)
        if (path === '/clinic-costs' && method === 'GET') {
            return getAllCosts(event, userPerms);
        }

        // GET /clinic-costs/{clinicName} - Get specific clinic cost
        if (path.endsWith('{clinicName}') && method === 'GET') {
            return getCost(event, userPerms, clinicName);
        }

        // PUT /clinic-costs/{clinicName} - Update clinic cost (Superadmin/Global Superadmin only)
        if (path.endsWith('{clinicName}') && method === 'PUT') {
            // Check if user is super admin or global super admin
            if (!userPerms.isSuperAdmin && !userPerms.isGlobalSuperAdmin) {
                return err(403, 'Only Super Admins and Global Super Admins can update clinic costs', event);
            }
            return updateCost(event, userPerms, clinicName);
        }

        return err(404, 'Not found', event);
    } catch (e: any) {
        console.error('Error in clinic cost handler:', e);
        return err(500, e?.message || 'Internal server error', event);
    }
};

/**
 * GET /clinic-costs - Get all clinic cost of operations
 */
async function getAllCosts(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
    const resp = await ddb.send(new ScanCommand({
        TableName: TABLE,
        Limit: 200
    }));

    return ok({ items: resp.Items || [] }, event);
}

/**
 * GET /clinic-costs/{clinicName} - Get specific clinic cost
 */
async function getCost(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicName?: string) {
    if (!clinicName) return err(400, 'clinicName required', event);

    const decodedClinicName = decodeURIComponent(clinicName);

    const resp = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { clinicName: decodedClinicName }
    }));

    if (!resp.Item) {
        return err(404, `Cost data for clinic '${decodedClinicName}' not found`, event);
    }

    return ok({ item: resp.Item }, event);
}

/**
 * PUT /clinic-costs/{clinicName} - Update clinic cost (Superadmin/Global Superadmin only)
 */
async function updateCost(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicName?: string) {
    if (!clinicName) return err(400, 'clinicName required', event);

    const decodedClinicName = decodeURIComponent(clinicName);
    const body = parse(event.body);

    if (typeof body.costPerDay !== 'number' || body.costPerDay < 0) {
        return err(400, 'Valid costPerDay (non-negative number) required', event);
    }

    const now = new Date().toISOString();

    // Get existing item to preserve createdAt
    const existingResp = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { clinicName: decodedClinicName }
    }));

    const item = {
        clinicName: decodedClinicName,
        costPerDay: body.costPerDay,
        currency: body.currency || 'USD',
        createdAt: existingResp.Item?.createdAt || now,
        updatedAt: now,
        updatedBy: userPerms.email || 'unknown'
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
        message: `Clinic cost updated successfully`,
        clinicName: decodedClinicName,
        costPerDay: item.costPerDay
    }, event);
}

function parse(body: any) {
    try {
        return typeof body === 'string' ? JSON.parse(body) : (body || {});
    } catch {
        return {};
    }
}

function ok(data: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
    return {
        statusCode: 200,
        headers: buildCorsHeaders({}, event.headers?.origin),
        body: JSON.stringify({ success: true, ...data })
    };
}

function err(code: number, message: string, event: APIGatewayProxyEvent): APIGatewayProxyResult {
    return {
        statusCode: code,
        headers: buildCorsHeaders({}, event.headers?.origin),
        body: JSON.stringify({ success: false, message })
    };
}
