import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken, JWTPayload, hashToken } from '../../shared/utils/jwt';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TOKEN_BLACKLIST_TABLE = process.env.TOKEN_BLACKLIST_TABLE || 'TokenBlacklist';

/**
 * Lambda authorizer for API Gateway
 * Validates JWT tokens and returns IAM policy
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

    // Generate IAM policy
    const policy = generatePolicy(payload.email, 'Allow', event.methodArn, payload);
    
    console.log('Authorization successful for user:', payload.email);
    return policy;
  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized'); // This will return 401 to the client
  }
};

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  payload: JWTPayload
): APIGatewayAuthorizerResult {
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
      clinicRoles: JSON.stringify([]), // clinicRoles fetched from DB by handler, not stored in JWT
      isSuperAdmin: String(payload.isSuperAdmin),
      isGlobalSuperAdmin: String(payload.isGlobalSuperAdmin),
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

