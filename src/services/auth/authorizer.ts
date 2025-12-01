import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken, JWTPayload, hashToken } from '../../shared/utils/jwt';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TOKEN_BLACKLIST_TABLE = process.env.TOKEN_BLACKLIST_TABLE || 'TokenBlacklist';
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

/**
 * Cached user permissions to reduce DynamoDB calls within same Lambda instance
 * Cache expires after 5 minutes (matches API Gateway authorizer cache TTL)
 */
interface CachedUser {
  clinicRoles: any[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  cachedAt: number;
}
const userCache = new Map<string, CachedUser>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lambda authorizer for API Gateway
 * Validates JWT tokens and returns IAM policy with user permissions from DynamoDB
 */
export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  console.log('Authorizer event:', JSON.stringify(event, null, 2));

  try {
    // Extract token from Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    
    if (!authHeader) {
      console.error('No Authorization header found');
      throw new Error('Unauthorized');
    }

    // Extract Bearer token
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      console.error('Invalid Authorization header format');
      throw new Error('Unauthorized');
    }

    const token = tokenMatch[1];

    // Check if token is blacklisted (logged out)
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      console.error('Token is blacklisted');
      throw new Error('Unauthorized');
    }

    // Verify the token
    const payload = await verifyToken(token);
    
    // Ensure it's an access token
    if (payload.type !== 'access') {
      console.error('Token is not an access token');
      throw new Error('Unauthorized');
    }

    // Fetch user's clinic roles from DynamoDB (with caching)
    const userPermissions = await getUserPermissionsFromDb(payload.email);

    // Generate IAM policy with full user context
    const policy = generatePolicy(payload.email, 'Allow', event.methodArn, payload, userPermissions);
    
    console.log('Authorization successful for user:', payload.email);
    return policy;
  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized'); // This will return 401 to the client
  }
};

/**
 * Fetch user permissions from DynamoDB StaffUser table
 * Uses in-memory cache to reduce DynamoDB calls
 */
async function getUserPermissionsFromDb(email: string): Promise<CachedUser> {
  // Check cache first
  const cached = userCache.get(email);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    console.log('Using cached permissions for:', email);
    return cached;
  }

  try {
    const result = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email },
      ProjectionExpression: 'clinicRoles, isSuperAdmin, isGlobalSuperAdmin, isActive',
    }));

    if (!result.Item) {
      console.error('User not found in StaffUser table:', email);
      // Return empty permissions - user exists in JWT but not in DB
      return {
        clinicRoles: [],
        isSuperAdmin: false,
        isGlobalSuperAdmin: false,
        cachedAt: Date.now(),
      };
    }

    // Check if user is active
    if (result.Item.isActive === false) {
      console.error('User account is inactive:', email);
      throw new Error('Account is inactive');
    }

    const permissions: CachedUser = {
      clinicRoles: result.Item.clinicRoles || [],
      isSuperAdmin: result.Item.isSuperAdmin === true,
      isGlobalSuperAdmin: result.Item.isGlobalSuperAdmin === true,
      cachedAt: Date.now(),
    };

    // Cache the result
    userCache.set(email, permissions);
    
    // Clean up old cache entries periodically
    if (userCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of userCache.entries()) {
        if (now - value.cachedAt > CACHE_TTL_MS) {
          userCache.delete(key);
        }
      }
    }

    console.log('Fetched permissions from DynamoDB for:', email, 'clinicRoles count:', permissions.clinicRoles.length);
    return permissions;
  } catch (error) {
    console.error('Error fetching user permissions from DynamoDB:', error);
    throw error;
  }
}

/**
 * Generate IAM policy for API Gateway
 * Includes user context with clinicRoles fetched from DynamoDB
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  payload: JWTPayload,
  userPermissions: CachedUser
): APIGatewayAuthorizerResult {
  // Use DB values for admin flags (more authoritative than JWT)
  // JWT flags are set at login time, DB values reflect current state
  const isSuperAdmin = userPermissions.isSuperAdmin || payload.isSuperAdmin;
  const isGlobalSuperAdmin = userPermissions.isGlobalSuperAdmin || payload.isGlobalSuperAdmin;

  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource.split('/').slice(0, 2).join('/') + '/*', // Allow all methods in the API
        },
      ],
    },
    context: {
      email: payload.email,
      givenName: payload.givenName || '',
      familyName: payload.familyName || '',
      // clinicRoles now fetched from DynamoDB StaffUser table
      clinicRoles: JSON.stringify(userPermissions.clinicRoles),
      isSuperAdmin: String(isSuperAdmin),
      isGlobalSuperAdmin: String(isGlobalSuperAdmin),
    },
  };
}

/**
 * Check if a token has been blacklisted (logged out)
 */
async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const tokenHash = hashToken(token);
    
    const result = await ddb.send(new GetCommand({
      TableName: TOKEN_BLACKLIST_TABLE,
      Key: { tokenHash },
    }));

    return !!result.Item;
  } catch (error) {
    console.error('Error checking token blacklist:', error);
    // If blacklist check fails, allow the request (fail open)
    // The token signature will still be verified
    return false;
  }
}

