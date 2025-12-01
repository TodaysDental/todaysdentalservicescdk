/**
 * Auth Verify OTP Endpoint
 * Validates OTP code and returns JWT tokens
 * 
 * POST /auth/verify
 * Body: { email: string, code: string }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { generateAccessToken, generateRefreshToken } from '../../shared/utils/jwt';
import { StaffUser } from '../../shared/types/user';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://todaysdentalinsights.com';

const MAX_OTP_ATTEMPTS = 5; // Lock after 5 failed attempts

interface VerifyRequest {
  email: string;
  code: string;
}

/**
 * Main handler for OTP verification
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('OTP Verify request:', event.httpMethod, event.path);

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

    const body: VerifyRequest = JSON.parse(event.body);
    
    // Sanitize and validate inputs
    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();

    if (!email || !code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and code are required' }),
      };
    }

    // Normalize code (remove spaces, dashes)
    const normalizedCode = code.replace(/[\s-]/g, '');

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
        body: JSON.stringify({ error: 'Invalid email or code' }),
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

    // Check if OTP exists
    if (!user.otpCode || !user.otpExpiry) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No OTP code found. Please request a new one.' }),
      };
    }

    // Check if OTP has expired
    const now = Date.now();
    if (now > user.otpExpiry) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'OTP code has expired. Please request a new one.' }),
      };
    }

    // Check failed attempts
    const attempts = user.otpAttempts || 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: 'Too many failed attempts. Please request a new code.',
          maxAttempts: MAX_OTP_ATTEMPTS,
        }),
      };
    }

    // Verify OTP code
    if (user.otpCode !== normalizedCode) {
      // Increment failed attempts
      await ddb.send(new PutCommand({
        TableName: STAFF_USER_TABLE,
        Item: {
          ...user,
          otpAttempts: attempts + 1,
          updatedAt: new Date().toISOString(),
        },
      }));

      const remainingAttempts = MAX_OTP_ATTEMPTS - attempts - 1;
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid code',
          remainingAttempts,
        }),
      };
    }

    // OTP is valid! Clear OTP fields and generate tokens
    await ddb.send(new PutCommand({
      TableName: STAFF_USER_TABLE,
      Item: {
        ...user,
        otpCode: undefined,
        otpExpiry: undefined,
        otpAttempts: 0,
        lastLoginAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));

    // Generate JWT tokens (MINIMAL - no permissions for enterprise scale)
    // Permissions will be fetched from cache/DB by the authorizer
    const accessToken = await generateAccessToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      // clinicRoles NOT included - keeps token small for 1000+ clinics
      isSuperAdmin: user.isSuperAdmin,
      isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    });

    const refreshToken = await generateRefreshToken({
      sub: user.email,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
    });

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
    console.error('OTP verify error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

