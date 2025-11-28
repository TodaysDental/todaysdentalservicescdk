/**
 * Lambda Authorizer with Three-Tier Caching
 * 
 * For enterprise scale (1000+ clinics), permissions are NOT in JWT.
 * Instead, they are fetched from:
 * 1. In-memory cache (1 min TTL) - fastest
 * 2. ElastiCache Redis (5 min TTL) - fast
 * 3. DynamoDB (source of truth) - slower but authoritative
 * 
 * This keeps JWT tokens small (~300 bytes) regardless of clinic count.
 */

import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken } from '../../shared/utils/jwt';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

// ============================================================================
// IN-MEMORY CACHE (Layer 1 - Fastest)
// ============================================================================

interface CachedPermission {
  clinicRoles: any[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  cachedAt: number;
}

// Global variable persists across warm Lambda invocations
const memoryCache = new Map<string, CachedPermission>();
const MEMORY_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Get cached permissions from memory
 */
function getFromMemoryCache(email: string): CachedPermission | null {
  const cached = memoryCache.get(email);
  if (!cached) return null;
  
  const age = Date.now() - cached.cachedAt;
  if (age > MEMORY_CACHE_TTL) {
    memoryCache.delete(email);
    return null;
  }
  
  return cached;
}

/**
 * Save permissions to memory cache
 */
function saveToMemoryCache(email: string, data: Omit<CachedPermission, 'cachedAt'>): void {
  memoryCache.set(email, {
    ...data,
    cachedAt: Date.now(),
  });
  
  // Cleanup old entries if cache gets too large
  if (memoryCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of memoryCache.entries()) {
      if (now - value.cachedAt > MEMORY_CACHE_TTL) {
        memoryCache.delete(key);
      }
    }
  }
}

// ============================================================================
// DYNAMODB LOOKUP (Layer 3 - Source of Truth)
// ============================================================================

/**
 * Fetch user permissions from DynamoDB
 */
async function fetchFromDynamoDB(email: string): Promise<{
  clinicRoles: any[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
}> {
  console.log(`[DynamoDB] Fetching permissions for ${email}`);
  
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email },
  }));
  
  if (!result.Item) {
    throw new Error('User not found in database');
  }
  
  return {
    clinicRoles: result.Item.clinicRoles || [],
    isSuperAdmin: result.Item.isSuperAdmin || false,
    isGlobalSuperAdmin: result.Item.isGlobalSuperAdmin || false,
  };
}

// ============================================================================
// UNIFIED GET PERMISSIONS (with caching)
// ============================================================================

/**
 * Get user permissions with three-tier caching strategy
 * 
 * 1. Check in-memory cache (0.1ms)
 * 2. Check Redis cache (2ms) - TODO: Add Redis support
 * 3. Query DynamoDB (10ms)
 */
async function getUserPermissions(email: string): Promise<{
  clinicRoles: any[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
}> {
  // Layer 1: Check in-memory cache
  const memCached = getFromMemoryCache(email);
  if (memCached) {
    console.log(`[CACHE HIT] Memory cache for ${email}`);
    return memCached;
  }
  
  // Layer 2: Check Redis cache (TODO: Implement when ElastiCache is deployed)
  // const redisCached = await getFromRedisCache(email);
  // if (redisCached) {
  //   saveToMemoryCache(email, redisCached);
  //   return redisCached;
  // }
  
  // Layer 3: Query DynamoDB
  const dbData = await fetchFromDynamoDB(email);
  
  // Save to caches
  saveToMemoryCache(email, dbData);
  // await saveToRedisCache(email, dbData); // TODO: Implement
  
  return dbData;
}

// ============================================================================
// LAMBDA AUTHORIZER HANDLER
// ============================================================================

export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  console.log('Authorization request received');
  
  try {
    // Extract JWT token from Authorization header
    const token = extractToken(event);
    if (!token) {
      console.error('No token provided');
      throw new Error('No token provided');
    }

    // Verify JWT signature and expiration (minimal payload)
    const payload = await verifyToken(token);

    if (payload.type !== 'access') {
      console.error('Invalid token type:', payload.type);
      throw new Error('Invalid token type');
    }

    console.log(`Token validated for user: ${payload.email}`);

    // Fetch full permissions from cache/DB
    const permissions = await getUserPermissions(payload.email);

    console.log(`Loaded ${permissions.clinicRoles.length} clinic roles for ${payload.email}`);

    // Generate IAM policy allowing API access
    return generatePolicy(
      payload.email,
      'Allow',
      event.methodArn,
      {
        email: payload.email,
        givenName: payload.givenName || '',
        familyName: payload.familyName || '',
        // Full permissions passed in context (from cache/DB, not JWT!)
        clinicRoles: JSON.stringify(permissions.clinicRoles),
        isSuperAdmin: String(permissions.isSuperAdmin),
        isGlobalSuperAdmin: String(permissions.isGlobalSuperAdmin),
      }
    );
  } catch (error: any) {
    console.error('Authorization failed:', error.message);
    throw new Error('Unauthorized');
  }
};

/**
 * Extract JWT token from Authorization header
 */
function extractToken(event: APIGatewayRequestAuthorizerEvent): string | null {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  
  return parts[1];
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context: Record<string, string>
): APIGatewayAuthorizerResult {
  // Allow all methods in the API (not just the specific endpoint)
  const apiGatewayWildcard = resource.split('/').slice(0, 2).join('/') + '/*';
  
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: apiGatewayWildcard,
        },
      ],
    },
    context,
  };
}

