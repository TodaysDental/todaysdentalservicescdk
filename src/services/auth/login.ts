import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { verifyPassword, generateAccessToken, generateRefreshToken } from '../../shared/utils/jwt';
import { StaffUser } from '../../shared/types/user';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://todaysdentalinsights.com';

// Security constants for rate limiting
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

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
    
    // Sanitize and validate inputs
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' }),
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' }),
      };
    }

    // Get user from DynamoDB
    const result = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email },
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

    // Check for account lockout due to failed login attempts
    const now = Date.now();
    const loginAttempts = user.loginAttempts || 0;
    const lockoutUntil = user.lockoutUntil || 0;

    if (loginAttempts >= MAX_LOGIN_ATTEMPTS && now < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: 'Account temporarily locked due to too many failed login attempts',
          retryAfter: remainingSeconds,
          message: `Please try again in ${Math.ceil(remainingSeconds / 60)} minutes`,
        }),
      };
    }

    // Verify password
    const isPasswordValid = verifyPassword(password, user.passwordHash || '');
    if (!isPasswordValid) {
      // Increment failed login attempts
      const newAttempts = loginAttempts + 1;
      const newLockoutUntil = newAttempts >= MAX_LOGIN_ATTEMPTS 
        ? now + LOCKOUT_DURATION_MS 
        : lockoutUntil;

      // Update failed attempt count (fire-and-forget to avoid slowing response)
      ddb.send(new UpdateCommand({
        TableName: STAFF_USER_TABLE,
        Key: { email },
        UpdateExpression: 'SET loginAttempts = :attempts, lockoutUntil = :lockout, updatedAt = :timestamp',
        ExpressionAttributeValues: {
          ':attempts': newAttempts,
          ':lockout': newLockoutUntil,
          ':timestamp': new Date().toISOString(),
        },
      })).catch(err => console.error('Failed to update login attempts:', err));

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    // Generate tokens (note: clinicRoles not included in JWT, fetched by authorizer from DB)
    const accessToken = await generateAccessToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      isSuperAdmin: user.isSuperAdmin,
      isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    });

    const refreshToken = await generateRefreshToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
    });

    // Update last login time and reset failed login attempts
    // Note: This is a fire-and-forget update to avoid slowing down the response
    const timestamp = new Date().toISOString();
    ddb.send(new UpdateCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: user.email },
      UpdateExpression: 'SET lastLoginAt = :timestamp, updatedAt = :timestamp, loginAttempts = :zero, lockoutUntil = :zero',
      ExpressionAttributeValues: {
        ':timestamp': timestamp,
        ':zero': 0,
      },
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
          clinicRoles: user.clinicRoles,
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

