/**
 * Logout endpoint with token revocation
 * POST /auth/logout
 * 
 * Invalidates the user's refresh token and optionally stores the access token
 * in a blacklist to prevent further use until expiration.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken } from '../../shared/utils/jwt';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const TOKEN_BLACKLIST_TABLE = process.env.TOKEN_BLACKLIST_TABLE || 'TokenBlacklist';

// Helper to get dynamic CORS headers based on request origin
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const isAllowed = origin && ALLOWED_ORIGINS_LIST.includes(origin);
  return {
    ...buildCorsHeaders({ allowOrigin: isAllowed ? origin : ALLOWED_ORIGINS_LIST[0] }),
    'Content-Type': 'application/json',
  };
}

interface LogoutRequest {
  refreshToken?: string;
}

/**
 * Logout endpoint handler
 * Revokes refresh token and blacklists access token
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Logout request:', event.httpMethod, event.path);

  const headers = getCorsHeaders(event);

  // Handle OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Extract access token from Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    let userEmail: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const accessToken = authHeader.substring(7).trim();
        const payload = await verifyToken(accessToken);
        userEmail = payload.email;

        // Blacklist the access token to prevent further use
        // Token will auto-expire from blacklist after its natural expiration
        await blacklistToken(accessToken, payload.email);
      } catch (error) {
        // Token might already be expired or invalid, continue with logout
        console.warn('Access token verification failed during logout:', error);
      }
    }

    // Parse request body for refresh token
    if (event.body) {
      try {
        const body: LogoutRequest = JSON.parse(event.body);
        const refreshToken = body.refreshToken?.trim();

        if (refreshToken) {
          // Verify and revoke refresh token
          try {
            const payload = await verifyToken(refreshToken);
            userEmail = userEmail || payload.email;

            // Clear refresh token from user record
            await revokeRefreshToken(payload.email);
            
            // Also blacklist the refresh token
            await blacklistToken(refreshToken, payload.email);
          } catch (error) {
            console.warn('Refresh token verification failed during logout:', error);
          }
        }
      } catch (parseError) {
        // Body is optional for logout
        console.warn('Failed to parse logout request body:', parseError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Successfully logged out',
        success: true,
      }),
    };
  } catch (error) {
    console.error('Logout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        success: false,
      }),
    };
  }
};

/**
 * Revoke refresh token from user record
 */
async function revokeRefreshToken(email: string): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email },
      UpdateExpression: 'REMOVE refreshToken SET refreshTokenExpiry = :zero, updatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':timestamp': new Date().toISOString(),
      },
    }));
    console.log(`Revoked refresh token for user: ${email}`);
  } catch (error) {
    console.error(`Failed to revoke refresh token for ${email}:`, error);
    throw error;
  }
}

/**
 * Blacklist a token to prevent reuse before natural expiration
 * Uses DynamoDB TTL to auto-delete expired blacklist entries
 */
async function blacklistToken(token: string, email: string): Promise<void> {
  try {
    // Hash the token to avoid storing the full token
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Calculate TTL (tokens expire in 1 hour for access, 30 days for refresh)
    // Set blacklist TTL to 31 days to cover both cases
    const ttl = Math.floor(Date.now() / 1000) + (31 * 24 * 60 * 60);

    await ddb.send(new PutCommand({
      TableName: TOKEN_BLACKLIST_TABLE,
      Item: {
        tokenHash, // Primary key
        email,
        blacklistedAt: new Date().toISOString(),
        ttl, // DynamoDB TTL field for auto-cleanup
      },
    }));
    console.log(`Blacklisted token for user: ${email}`);
  } catch (error) {
    // Don't fail logout if blacklist fails
    console.error(`Failed to blacklist token for ${email}:`, error);
  }
}

