import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken, generateAccessToken, generateRefreshToken } from '../../shared/utils/jwt';
import { StaffUser } from '../../shared/types/user';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

// Helper to get dynamic CORS headers based on request origin
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const isAllowed = origin && ALLOWED_ORIGINS_LIST.includes(origin);
  return {
    ...buildCorsHeaders({ allowOrigin: isAllowed ? origin : ALLOWED_ORIGINS_LIST[0] }),
    'Content-Type': 'application/json',
  };
}

interface RefreshRequest {
  refreshToken: string;
}

/**
 * Refresh token endpoint
 * POST /auth/refresh
 * Body: { refreshToken }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Refresh token request:', event.httpMethod, event.path);

  const headers = getCorsHeaders(event);

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const body: RefreshRequest = JSON.parse(event.body);

    // Sanitize input
    const refreshToken = body.refreshToken?.trim();

    if (!refreshToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Refresh token is required' }),
      };
    }

    // Verify the refresh token
    const payload = await verifyToken(refreshToken);

    if (payload.type !== 'refresh') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token type' }),
      };
    }

    // Get user from DynamoDB
    const result = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: payload.email.toLowerCase() },
    }));

    const user = result.Item as StaffUser | undefined;

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    // Check if user is active
    if (!user.isActive) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account is inactive' }),
      };
    }

    // Generate new tokens (MINIMAL - no permissions for enterprise scale)
    // Permissions will be fetched fresh from cache/DB by the authorizer
    const newAccessToken = await generateAccessToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      // clinicRoles NOT included - keeps token small for 1000+ clinics
      isSuperAdmin: user.isSuperAdmin,
      isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    });

    const newRefreshToken = await generateRefreshToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600, // 1 hour in seconds
        user: {
          email: user.email,
          givenName: user.givenName,
          familyName: user.familyName,
          clinicRoles: user.clinicRoles,
          isSuperAdmin: user.isSuperAdmin,
          isGlobalSuperAdmin: user.isGlobalSuperAdmin,
          emailVerified: user.emailVerified,
        },
      }),
    };
  } catch (error) {
    console.error('Refresh token error:', error);

    if (error instanceof Error && error.message.includes('Invalid or expired token')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired refresh token' }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

