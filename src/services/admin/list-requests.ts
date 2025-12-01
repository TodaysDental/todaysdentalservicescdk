import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE_NAME = process.env.FAVORS_TABLE_NAME || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

/**
 * GET /admin/requests
 *
 * Lists favor requests for the authenticated user.
 * It queries both SenderIndex and ReceiverIndex GSIs in parallel and merges the results.
 * 
 * Note: This endpoint is protected by the JWT authorizer, which validates the token
 * and provides user info via event.requestContext.authorizer.
 */
export const handler = async (event: APIGatewayProxyEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ok: true }),
        };
    }

    if (!FAVORS_TABLE_NAME) {
        return httpErr(500, 'FAVORS_TABLE_NAME not configured');
    }

    try {
        // Get User ID from authorizer context (set by JWT authorizer)
        const callerID = event.requestContext.authorizer?.email || 
                         event.requestContext.authorizer?.sub;

        if (!callerID) {
            return httpErr(401, 'Could not determine authenticated user ID');
        }

        // 2. Parse query params (role, limit, nextToken)
        const qs = event.queryStringParameters || {};
        const roleRaw = (qs.role || qs.type || 'all').toLowerCase();
        const role: 'sent' | 'received' | 'all' =
            roleRaw === 'sent' || roleRaw === 'received' ? (roleRaw as any) : 'all';

        // NOTE: Frontend does not pass a limit, but if it did, the max is 100
        const limit =
            qs.limit && !Number.isNaN(parseInt(qs.limit, 10))
                ? Math.min(parseInt(qs.limit, 10), 100)
                : 50;

        let exclusiveStartKey: any = undefined;
        if (qs.nextToken) {
            try {
                exclusiveStartKey = JSON.parse(qs.nextToken);
            } catch {
                console.warn('Invalid nextToken JSON, ignoring:', qs.nextToken);
            }
        }

        // Helper to query a single GSI
        const queryByIndex = async (
            indexName: string,
            keyName: string,
            startKey?: any
        ) => {
            return ddb.send(
                new QueryCommand({
                    TableName: FAVORS_TABLE_NAME,
                    IndexName: indexName,
                    KeyConditionExpression: `${keyName} = :uid`,
                    ExpressionAttributeValues: {
                        ':uid': callerID,
                    },
                    ScanIndexForward: false, // newest first
                    Limit: limit,
                    ...(startKey ? { ExclusiveStartKey: startKey } : {}),
                })
            );
        };

        // 3. Handle role=sent → SenderIndex
        if (role === 'sent') {
            const sentResult = await queryByIndex(
                'SenderIndex',
                'senderID',
                exclusiveStartKey
            );
            const items = sentResult.Items || [];
            return httpOk({
                role: 'sent',
                items,
                nextToken: sentResult.LastEvaluatedKey
                    ? JSON.stringify(sentResult.LastEvaluatedKey)
                    : undefined,
            });
        }

        // 4. role=received → ReceiverIndex
        if (role === 'received') {
            const recvResult = await queryByIndex(
                'ReceiverIndex',
                'receiverID',
                exclusiveStartKey
            );
            const items = recvResult.Items || [];
            return httpOk({
                role: 'received',
                items,
                nextToken: recvResult.LastEvaluatedKey
                    ? JSON.stringify(recvResult.LastEvaluatedKey)
                    : undefined,
            });
        }

        // 5. role=all → merge both (Default behavior)
        const [sentResult, recvResult] = await Promise.all([
            queryByIndex('SenderIndex', 'senderID'),
            queryByIndex('ReceiverIndex', 'receiverID'),
        ]);

        const allItems = [...(sentResult.Items || []), ...(recvResult.Items || [])];

        // Deduplicate by favorRequestID
        const byId = new Map<string, any>();
        for (const item of allItems) {
            if (!item || !item.favorRequestID) continue;
            byId.set(item.favorRequestID, item);
        }

        const merged = Array.from(byId.values());

        // Sort by updatedAt desc
        merged.sort((a, b) => {
            const aTime = a.updatedAt || '';
            const bTime = b.updatedAt || '';
            if (aTime < bTime) return 1;
            if (aTime > bTime) return -1;
            return 0;
        });

        return httpOk({
            role: 'all',
            items: merged,
            nextToken: undefined,
        });
    } catch (err: any) {
        console.error('Error fetching favor requests:', err);
        return httpErr(500, err?.message || 'Internal error fetching requests');
    }
};

// ==============================
// HTTP RESPONSE HELPERS
// ==============================

function httpOk(data: Record<string, any>) {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, ...data }),
    };
}

function httpErr(code: number, message: string) {
    return {
        statusCode: code,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message }),
    };
}
