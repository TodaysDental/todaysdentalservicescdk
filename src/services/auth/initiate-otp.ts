/**
 * Auth Initiate OTP Endpoint
 * Generates and sends OTP code to user's email
 * 
 * POST /auth/initiate
 * Body: { email: string }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import * as crypto from 'crypto';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESv2Client({ region: process.env.SES_REGION || 'us-east-1' });

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://todaysdentalinsights.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT_SECONDS = 60; // Can't request new OTP within 60 seconds

interface InitiateRequest {
  email: string;
}

/**
 * Main handler for OTP initiation
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('OTP Initiate request:', event.httpMethod, event.path);

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

    const body: InitiateRequest = JSON.parse(event.body);
    
    // Sanitize and validate email input
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' }),
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

    const user = result.Item;

    // Don't reveal if user exists or is inactive (security best practice - prevents user enumeration)
    if (!user || !user.isActive) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'If an account exists with this email, an OTP code has been sent.',
          email,
        }),
      };
    }

    // Rate limiting: Check if OTP was sent recently
    const now = Date.now();
    if (user.otpLastSent && (now - user.otpLastSent) < RATE_LIMIT_SECONDS * 1000) {
      const waitTime = Math.ceil((RATE_LIMIT_SECONDS * 1000 - (now - user.otpLastSent)) / 1000);
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          error: `Please wait ${waitTime} seconds before requesting a new code`,
          retryAfter: waitTime,
        }),
      };
    }

    // Generate OTP code
    const otpCode = generateOTPCode(OTP_LENGTH);
    const otpExpiry = now + (OTP_EXPIRY_MINUTES * 60 * 1000);

    // Update user with OTP
    await ddb.send(new PutCommand({
      TableName: STAFF_USER_TABLE,
      Item: {
        ...user,
        otpCode,
        otpExpiry,
        otpAttempts: 0,
        otpLastSent: now,
        updatedAt: new Date().toISOString(),
      },
    }));

    // Send OTP via email
    try {
      await sendOTPEmail(email, otpCode, user.givenName || 'User');
      console.log(`OTP sent successfully to ${email}`);
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      // Even if email fails, we return success to avoid revealing user existence
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'OTP code sent to your email',
        email,
        expiresIn: OTP_EXPIRY_MINUTES * 60, // seconds
      }),
    };
  } catch (error) {
    console.error('OTP initiate error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

/**
 * Generate a random OTP code
 */
function generateOTPCode(length: number): string {
  const digits = '0123456789';
  let code = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, digits.length);
    code += digits[randomIndex];
  }
  
  return code;
}

/**
 * Send OTP email using AWS SES
 */
async function sendOTPEmail(email: string, otpCode: string, userName: string): Promise<void> {
  const subject = `Your ${APP_NAME} Login Code`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Login Code</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">${APP_NAME}</h1>
  </div>
  
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h2 style="color: #333; margin-top: 0;">Hello ${userName},</h2>
    
    <p style="font-size: 16px; color: #666;">
      You requested to sign in to your ${APP_NAME} account. Use the code below to complete your login:
    </p>
    
    <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0; border: 2px solid #667eea;">
      <p style="margin: 0; color: #999; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your Login Code</p>
      <p style="font-size: 36px; font-weight: bold; color: #667eea; margin: 10px 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
        ${otpCode}
      </p>
    </div>
    
    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #856404; font-size: 14px;">
        <strong>⚠️ Important:</strong> This code expires in ${OTP_EXPIRY_MINUTES} minutes.
      </p>
    </div>
    
    <p style="font-size: 14px; color: #666; margin-top: 30px;">
      If you didn't request this code, please ignore this email or contact support if you're concerned about your account security.
    </p>
    
    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
    
    <p style="font-size: 12px; color: #999; text-align: center;">
      This is an automated message from ${APP_NAME}. Please do not reply to this email.
    </p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
Hello ${userName},

You requested to sign in to your ${APP_NAME} account.

Your login code is: ${otpCode}

This code expires in ${OTP_EXPIRY_MINUTES} minutes.

If you didn't request this code, please ignore this email.

---
This is an automated message from ${APP_NAME}.
  `.trim();

  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_EMAIL,
    Destination: {
      ToAddresses: [email],
    },
    Content: {
      Simple: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Text: {
            Data: textBody,
            Charset: 'UTF-8',
          },
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
        },
      },
    },
  }));
}

