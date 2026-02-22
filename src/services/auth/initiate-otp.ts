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
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESv2Client({ region: process.env.SES_REGION || 'us-east-1' });

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';

// Helper to get dynamic CORS headers based on request origin
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const isAllowed = origin && ALLOWED_ORIGINS_LIST.includes(origin);
  return {
    ...buildCorsHeaders({ allowOrigin: isAllowed ? origin : ALLOWED_ORIGINS_LIST[0] }),
    'Content-Type': 'application/json',
  };
}
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
<body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  
  <!-- Outer wrapper for centering -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f7; padding: 40px 20px;">
    <tr>
      <td align="center">
        
        <!-- Main card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 20px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04); overflow: hidden;">
          
          <!-- Logo / Brand header -->
          <tr>
            <td style="padding: 48px 40px 0 40px; text-align: center;">
              <div style="width: 56px; height: 56px; background: linear-gradient(145deg, #1d1d1f, #3a3a3c); border-radius: 14px; display: inline-block; line-height: 56px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);">
                <span style="color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">T</span>
              </div>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 28px 40px 0 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1d1d1f; letter-spacing: -0.3px; line-height: 1.2;">
                Hello ${userName}
              </h1>
              <p style="margin: 12px 0 0 0; font-size: 15px; font-weight: 400; color: #86868b; line-height: 1.5;">
                You requested to sign in to your<br>${APP_NAME} account.
              </p>
            </td>
          </tr>
          
          <!-- OTP Code — liquid glass card -->
          <tr>
            <td style="padding: 32px 40px;">
              <div style="background: linear-gradient(135deg, #fafafa 0%, #f2f2f7 100%); border: 1px solid rgba(0, 0, 0, 0.06); border-radius: 16px; padding: 28px 20px; text-align: center; box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.04);">
                <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 600; color: #86868b; text-transform: uppercase; letter-spacing: 1.5px;">Your Login Code</p>
                <p style="margin: 0; font-size: 40px; font-weight: 700; color: #1d1d1f; letter-spacing: 12px; font-family: 'SF Mono', 'Menlo', 'Courier New', monospace; padding-left: 12px;">
                  ${otpCode}
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Expiry notice -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="background-color: #f5f5f7; border-radius: 12px; padding: 14px 18px; text-align: center;">
                <p style="margin: 0; font-size: 13px; font-weight: 500; color: #86868b;">
                  ⏱ This code expires in <span style="color: #1d1d1f; font-weight: 600;">${OTP_EXPIRY_MINUTES} minutes</span>
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Security note -->
          <tr>
            <td style="padding: 28px 40px 0 40px; text-align: center;">
              <p style="margin: 0; font-size: 13px; font-weight: 400; color: #86868b; line-height: 1.6;">
                If you didn't request this code, you can safely ignore this email. Your account remains secure.
              </p>
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 32px 40px 0 40px;">
              <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(0,0,0,0.08), transparent);"></div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px 40px; text-align: center;">
              <p style="margin: 0; font-size: 11px; font-weight: 400; color: #aeaeb2; line-height: 1.5;">
                This is an automated message from ${APP_NAME}.<br>Please do not reply to this email.
              </p>
            </td>
          </tr>
          
        </table>
        
      </td>
    </tr>
  </table>
  
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

