import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE_NAME = process.env.FAVORS_TABLE_NAME || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

// Auth helpers (Copied from admin files for token validation)
const ISSUER =
  REGION && USER_POOL_ID
    ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
    : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Handles the REST API call GET /admin/requests to list favor requests
 * associated with the authenticated user.
 *
 * Supports:
 *   - ?role=sent      → requests where caller is senderID (via SenderIndex)
 *   - ?role=received  → requests where caller is receiverID (via ReceiverIndex)
 *   - ?role=all (default) → merge of both (no cross-index pagination)
 *
 * Optional:
 *   - ?limit=50
 *   - ?nextToken=<JSON of LastEvaluatedKey>   (works for sent/received individually)
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
    const authz =
      event?.headers?.Authorization || event?.headers?.authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return httpErr(verifyResult.code, verifyResult.message);
    }
    const callerID = verifyResult.payload.sub; // The Cognito 'sub' is the userID

    if (!callerID) {
      return httpErr(401, 'Could not determine authenticated user ID');
    }

    // 2. Read filters from query string
    const qs = event.queryStringParameters || {};
    const roleRaw = (qs.role || qs.type || 'all').toLowerCase();
    const role: 'sent' | 'received' | 'all' =
      roleRaw === 'sent' || roleRaw === 'received' ? (roleRaw as any) : 'all';

    const limit =
      qs.limit && !Number.isNaN(parseInt(qs.limit, 10))
        ? Math.min(parseInt(qs.limit, 10), 100)
        : 50;

    // nextToken only applies cleanly to a SINGLE index (sent or received)
    const nextTokenRaw = qs.nextToken;
    let exclusiveStartKey: any = undefined;
    if (nextTokenRaw) {
      try {
        exclusiveStartKey = JSON.parse(nextTokenRaw);
      } catch (e) {
        console.warn('Invalid nextToken JSON, ignoring:', nextTokenRaw);
      }
    }

    // Helper to run a single-index query
    const queryByIndex = async (indexName: string, keyName: string, startKey?: any) =>
      ddb.send(
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

    // 3. Handle role-specific logic
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

    if (role === 'received') {
      const receivedResult = await queryByIndex(
        'ReceiverIndex',
        'receiverID',
        exclusiveStartKey
      );
      const items = receivedResult.Items || [];
      return httpOk({
        role: 'received',
        items,
        nextToken: receivedResult.LastEvaluatedKey
          ? JSON.stringify(receivedResult.LastEvaluatedKey)
          : undefined,
      });
    }

    // role === 'all' → query both indexes and merge (no unified pagination)
    const [sentResult, receivedResult] = await Promise.all([
      queryByIndex('SenderIndex', 'senderID'),
      queryByIndex('ReceiverIndex', 'receiverID'),
    ]);

    const allItems = [...(sentResult.Items || []), ...(receivedResult.Items || [])];

    // Deduplicate by favorRequestID
    const byId = new Map<string, any>();
    for (const item of allItems) {
      if (!item || !item.favorRequestID) continue;
      byId.set(item.favorRequestID, item);
    }

    const merged = Array.from(byId.values());

    // Sort by updatedAt desc if present
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
      // Pagination across two separate GSIs is non-trivial;
      // we deliberately omit nextToken in this mode.
      nextToken: undefined,
    });
  } catch (err: any) {
    console.error('Error fetching favor requests:', err);
    return httpErr(500, err?.message || 'Internal error fetching requests');
  }
};

// ========================================
// AUTH HELPERS (from user's admin files)
// ========================================

async function verifyIdToken(
  authorizationHeader: string
): Promise<
  | { ok: true; payload: JWTPayload }
  | { ok: false; code: number; message: string }
> {
  if (
    !authorizationHeader ||
    !authorizationHeader.toLowerCase().startsWith('bearer ')
  ) {
    return { ok: false, code: 401, message: 'missing bearer token' };
  }
  if (!ISSUER) {
    return { ok: false, code: 500, message: 'issuer not configured' };
  }
  const token = authorizationHeader.slice(7).trim();
  try {
    JWKS =
      JWKS ||
      createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    if ((payload as any).token_use !== 'id') {
      return { ok: false, code: 401, message: 'id token required' };
    }
    return { ok: true, payload };
  } catch (_err) {
    return { ok: false, code: 401, message: 'invalid token' };
  }
}

// ========================================
// HTTP RESPONSE HELPERS
// ========================================

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
