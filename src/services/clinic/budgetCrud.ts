import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    UserPermissions,
} from '../../shared/utils/permissions-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_BUDGET_TABLE || 'ClinicDailyBudget';

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
        // GET /clinic-budgets - Get all clinic budgets (any authenticated user can read)
        if (path === '/clinic-budgets' && method === 'GET') {
            return getAllBudgets(event, userPerms);
        }

        // GET /clinic-budgets/{clinicName} - Get specific clinic budget
        if (path.endsWith('{clinicName}') && method === 'GET') {
            return getBudget(event, userPerms, clinicName);
        }

        // PUT /clinic-budgets/{clinicName} - Update clinic budget (Superadmin/Global Superadmin only)
        if (path.endsWith('{clinicName}') && method === 'PUT') {
            // Check if user is super admin or global super admin
            if (!userPerms.isSuperAdmin && !userPerms.isGlobalSuperAdmin) {
                return err(403, 'Only Super Admins and Global Super Admins can update clinic budgets', event);
            }
            return updateBudget(event, userPerms, clinicName);
        }

        return err(404, 'Not found', event);
    } catch (e: any) {
        console.error('Error in clinic budget handler:', e);
        return err(500, e?.message || 'Internal server error', event);
    }
};

/**
 * GET /clinic-budgets - Get all clinic daily budgets
 */
async function getAllBudgets(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
    const resp = await ddb.send(new ScanCommand({
        TableName: TABLE,
        Limit: 200
    }));

    return ok({ items: resp.Items || [] }, event);
}

/**
 * GET /clinic-budgets/{clinicName} - Get specific clinic budget
 */
async function getBudget(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicName?: string) {
    if (!clinicName) return err(400, 'clinicName required', event);

    const decodedClinicName = decodeURIComponent(clinicName);

    const resp = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { clinicName: decodedClinicName }
    }));

    return ok({ item: resp.Item ?? null }, event);
}

/**
 * PUT /clinic-budgets/{clinicName} - Update clinic budget (Superadmin/Global Superadmin only)
 */
async function updateBudget(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicName?: string) {
    if (!clinicName) return err(400, 'clinicName required', event);

    const decodedClinicName = decodeURIComponent(clinicName);
    const body = parse(event.body);

    if (typeof body.dailyBudget !== 'number' || body.dailyBudget < 0) {
        return err(400, 'Valid dailyBudget (non-negative number) required', event);
    }

    const now = new Date().toISOString();

    // Get existing item to preserve createdAt
    const existingResp = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { clinicName: decodedClinicName }
    }));

    const item = {
        clinicName: decodedClinicName,
        dailyBudget: body.dailyBudget,
        currency: body.currency || 'USD',
        createdAt: existingResp.Item?.createdAt || now,
        updatedAt: now,
        updatedBy: userPerms.email || 'unknown'
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
        message: `Clinic budget updated successfully`,
        clinicName: decodedClinicName,
        dailyBudget: item.dailyBudget
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
