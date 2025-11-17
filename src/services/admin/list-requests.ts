import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE_NAME = process.env.FAVORS_TABLE_NAME || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cognito = new CognitoIdentityProviderClient({ region: REGION });

const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

// Auth helpers (Copied from admin files for token validation)
const ISSUER =
  REGION && USER_POOL_ID
    ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
    : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * GET /admin/requests
 *
 * Supports:
 *  - ?role=sent      → requests where caller is senderID (SenderIndex)
 *  - ?role=received  → requests where caller is receiverID (ReceiverIndex)
 *  - ?role=all (default) → merge of both
 *
 * Each item is enriched with senderName / receiverName, using the same
 * Cognito attribute mapping as directory-lookup.ts:
 *   givenName: attrs['given_name']
 *   familyName: attrs['family_name']
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
    // 1. Get User ID from Authorization Token
    const authz =
      event?.headers?.Authorization || event?.headers?.authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return httpErr(verifyResult.code, verifyResult.message);
    }
    const callerID = verifyResult.payload.sub; // Cognito 'sub'

    if (!callerID) {
      return httpErr(401, 'Could not determine authenticated user ID');
    }

    // 2. Parse query params (role, limit, nextToken)
    const qs = event.queryStringParameters || {};
    const roleRaw = (qs.role || qs.type || 'all').toLowerCase();
    const role: 'sent' | 'received' | 'all' =
      roleRaw === 'sent' || roleRaw === 'received' ? (roleRaw as any) : 'all';

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

    // 3. role=sent → SenderIndex
    if (role === 'sent') {
      const sentResult = await queryByIndex(
        'SenderIndex',
        'senderID',
        exclusiveStartKey
      );
      const items = sentResult.Items || [];
      await addNamesToRequests(items);
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
      await addNamesToRequests(items);
      return httpOk({
        role: 'received',
        items,
        nextToken: recvResult.LastEvaluatedKey
          ? JSON.stringify(recvResult.LastEvaluatedKey)
          : undefined,
      });
    }

    // 5. role=all → merge both
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

    await addNamesToRequests(merged);

    return httpOk({
      role: 'all',
      items: merged,
      nextToken: undefined, // cross-index pagination omitted
    });
  } catch (err: any) {
    console.error('Error fetching favor requests:', err);
    return httpErr(500, err?.message || 'Internal error fetching requests');
  }
};

// ==============================
// AUTH HELPERS
// ==============================

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

// ==============================
// USER NAME ENRICHMENT HELPERS
// ==============================

/**
 * Try to resolve a user's full name using the same pattern
 * as directory-lookup.ts:
 *   givenName: attrs['given_name']
 *   familyName: attrs['family_name']
 *
 * We try both:
 *   - Filter by sub = "<id>"
 *   - If nothing, filter by username = "<id>"
 *
 * This covers the case where your stored IDs are either Cognito sub
 * or Username.
 */
async function getUserFullName(userID: string): Promise<string | null> {
  if (!USER_POOL_ID) return null;

  const tryFilter = async (filter: string) => {
    const resp = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: filter,
        Limit: 1,
      })
    );
    return resp.Users?.[0];
  };

  try {
    let user: UserType | undefined;

    // 1) Try matching by sub (most common when you store payload.sub)
    user = await tryFilter(`sub = "${userID}"`);

    // 2) If not found, try matching by username
    if (!user) {
      user = await tryFilter(`username = "${userID}"`);
    }

    if (!user) {
      console.warn('No Cognito user found for id:', userID);
      return null;
    }

    const attrs = Object.fromEntries(
      (user.Attributes || []).map((a) => [a.Name, a.Value])
    );

    // Same attribute mapping as directory-lookup.ts
    const givenName = attrs['given_name'] || '';
    const familyName = attrs['family_name'] || '';
    const full = [givenName, familyName].filter(Boolean).join(' ');

    if (!full) {
      console.warn('User has no name attributes, using ID as fallback:', userID);
      return userID; // fallback to raw ID instead of null
    }

    return full;
  } catch (err) {
    console.error('Failed to lookup user info for', userID, err);
    return null;
  }
}

async function addNamesToRequests(items: any[]): Promise<void> {
  if (!items || items.length === 0) return;

  const ids = new Set<string>();
  for (const req of items) {
    if (!req) continue;
    if (req.senderID && !req.senderName) ids.add(req.senderID);
    if (req.receiverID && !req.receiverName) ids.add(req.receiverID);
  }
  if (ids.size === 0) return;

  const idArray = Array.from(ids);
  const profiles = await Promise.all(idArray.map((id) => getUserFullName(id)));

  const nameMap: Record<string, string> = {};
  idArray.forEach((id, idx) => {
    const fullName = profiles[idx];
    if (fullName) nameMap[id] = fullName;
  });

  for (const req of items) {
    if (!req) continue;
    if (req.senderID) {
      // fallback to senderID if no name
      req.senderName = nameMap[req.senderID] || req.senderID;
    }
    if (req.receiverID) {
      // fallback to receiverID if no name
      req.receiverName = nameMap[req.receiverID] || req.receiverID;
    }
  }
}

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
