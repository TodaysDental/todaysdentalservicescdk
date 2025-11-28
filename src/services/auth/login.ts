import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyPassword, generateAccessToken, generateRefreshToken } from '../../shared/utils/jwt';
import { StaffUser } from '../../shared/types/user';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://todaysdentalinsights.com';

interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login endpoint
 * POST /auth/login
 * Body: { email, password }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Login request:', event.httpMethod, event.path);

  const headers = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
  };

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const body: LoginRequest = JSON.parse(event.body);
    const { email, password } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' }),
      };
    }

    // Get user from DynamoDB
    const result = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: email.toLowerCase() },
    }));

    const user = result.Item as StaffUser | undefined;

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' }),
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

    // Verify password
    const isPasswordValid = verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    // Generate tokens
    const accessToken = await generateAccessToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      roles: user.roles,
      clinics: user.clinics,
      isSuperAdmin: user.isSuperAdmin,
      isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    });

    const refreshToken = await generateRefreshToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
    });

    // Update last login time
    // Note: This is a fire-and-forget update to avoid slowing down the response
    ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: user.email },
    })).catch(err => console.error('Failed to update lastLoginAt:', err));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        accessToken,
        refreshToken,
        expiresIn: 3600, // 1 hour in seconds
        user: {
          email: user.email,
          givenName: user.givenName,
          familyName: user.familyName,
          roles: user.roles,
          clinics: user.clinics,
          isSuperAdmin: user.isSuperAdmin,
          isGlobalSuperAdmin: user.isGlobalSuperAdmin,
          emailVerified: user.emailVerified,
        },
      }),
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

