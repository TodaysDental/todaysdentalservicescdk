import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'; // JWTPayload is imported here

const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE_NAME = process.env.FAVORS_TABLE_NAME || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

// Auth helpers (Copied from admin files for token validation)
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Handles the REST API call GET /admin/requests to list all favor requests 
 * associated with the authenticated user (sender or receiver).
 * This endpoint is secured by the Cognito Authorizer.
 */
export const handler = async (event: APIGatewayProxyEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }
    
    if (!FAVORS_TABLE_NAME) {
        return httpErr(500, 'FAVORS_TABLE_NAME not configured');
    }

    try {
        // 1. Get User ID from Authorization Token
        const authz = event?.headers?.Authorization || event?.headers?.authorization || '';
        // NOTE: verifyIdToken uses the imported JWTPayload type
        const verifyResult = await verifyIdToken(authz); 
        if (!verifyResult.ok) {
            return httpErr(verifyResult.code, verifyResult.message);
        }
        const callerID = verifyResult.payload.sub; // The Cognito 'sub' is the userID

        if (!callerID) {
            return httpErr(401, 'Could not determine authenticated user ID');
        }

        // 2. Query the Favors Table using the GSI (UserIndex)
        // This index uses the 'userID' as the Partition Key and 'updatedAt' as the Sort Key.
        const queryResult = await ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE_NAME,
            IndexName: 'UserIndex', // The GSI created in comm-stack.ts
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { 
                ':uid': callerID 
            },
            ScanIndexForward: false, // Sort descending (most recent activity first)
            Limit: 50, // Limit number of requests returned in one call
        }));

        const requests = queryResult.Items || [];

        return httpOk({ 
            items: requests,
            nextToken: queryResult.LastEvaluatedKey ? JSON.stringify(queryResult.LastEvaluatedKey) : undefined,
        });
        
    } catch (err: any) {
        console.error('Error fetching favor requests:', err);
        return httpErr(500, err?.message || 'Internal error fetching requests');
    }
};

// ========================================
// AUTH HELPERS (from user's admin files)
// ========================================

async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
    if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
        return { ok: false, code: 401, message: "missing bearer token" };
    }
    if (!ISSUER) {
        return { ok: false, code: 500, message: "issuer not configured" };
    }
    const token = authorizationHeader.slice(7).trim();
    try {
        JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
        const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
        if ((payload as any).token_use !== "id") {
            return { ok: false, code: 401, message: "id token required" };
        }
        return { ok: true, payload };
    } catch (_err) {
        return { ok: false, code: 401, message: "invalid token" };
    }
}

// ========================================
// HTTP RESPONSE HELPERS
// ========================================

// REMOVED: interface JWTPayload { sub?: string; [key: string]: any; } 
// The definition from 'jose' is used instead.

function httpOk(data: Record<string, any>) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
    return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ success: false, message }) };
}