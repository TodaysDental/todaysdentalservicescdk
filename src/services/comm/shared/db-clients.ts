/**
 * Shared SDK Clients for Communications Stack
 *
 * Singleton instances reused across Lambda invocations.
 * Lazily initialized where appropriate to reduce cold-start impact.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SNSClient } from '@aws-sdk/client-sns';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient } from '@aws-sdk/client-lambda';

export const REGION = process.env.AWS_REGION || 'us-east-1';

// ── Eagerly initialized (used by every request) ────────────────────────────
export const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION }),
);

// ── Lazily initialized (only loaded when needed) ───────────────────────────
let _s3: S3Client | undefined;
export function getS3(): S3Client {
    if (!_s3) _s3 = new S3Client({ region: REGION });
    return _s3;
}

let _sns: SNSClient | undefined;
export function getSNS(): SNSClient {
    if (!_sns) _sns = new SNSClient({ region: REGION });
    return _sns;
}

let _ses: SESv2Client | undefined;
export function getSES(): SESv2Client {
    if (!_ses) _ses = new SESv2Client({ region: REGION });
    return _ses;
}

let _cognito: CognitoIdentityProviderClient | undefined;
export function getCognito(): CognitoIdentityProviderClient {
    if (!_cognito) _cognito = new CognitoIdentityProviderClient({ region: REGION });
    return _cognito;
}

let _lambda: LambdaClient | undefined;
export function getLambda(): LambdaClient {
    if (!_lambda) _lambda = new LambdaClient({ region: REGION });
    return _lambda;
}

// ── Environment variable helpers ────────────────────────────────────────────
export const env = {
    get CONNECTIONS_TABLE() { return process.env.CONNECTIONS_TABLE || ''; },
    get MESSAGES_TABLE() { return process.env.MESSAGES_TABLE || ''; },
    get FAVORS_TABLE() { return process.env.FAVORS_TABLE || ''; },
    get TEAMS_TABLE() { return process.env.TEAMS_TABLE || ''; },
    get MEETINGS_TABLE() { return process.env.MEETINGS_TABLE || ''; },
    get USER_PREFERENCES_TABLE() { return process.env.USER_PREFERENCES_TABLE || ''; },
    get FILE_BUCKET_NAME() { return process.env.FILE_BUCKET_NAME || ''; },
    get NOTIFICATIONS_TOPIC_ARN() { return process.env.NOTIFICATIONS_TOPIC_ARN || process.env.NOTICES_TOPIC_ARN || ''; },
    get SES_SOURCE_EMAIL() { return process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalservices.com'; },
    get USER_POOL_ID() { return process.env.USER_POOL_ID || ''; },
    get DEVICE_TOKENS_TABLE() { return process.env.DEVICE_TOKENS_TABLE || ''; },
    get SEND_PUSH_FUNCTION_ARN() { return process.env.SEND_PUSH_FUNCTION_ARN || ''; },
    get CALLS_TABLE() { return process.env.CALLS_TABLE || ''; },
    get CONVERSATION_SETTINGS_TABLE() { return process.env.CONVERSATION_SETTINGS_TABLE || ''; },
    get GIPHY_API_KEY() { return process.env.GIPHY_API_KEY || ''; },
    get AUDIT_LOGS_TABLE() { return process.env.AUDIT_LOGS_TABLE || ''; },
    get USER_TEAMS_TABLE() { return process.env.USER_TEAMS_TABLE || ''; },
    get FILES_CDN_DOMAIN() { return process.env.FILES_CDN_DOMAIN || ''; },

    get CHANNELS_TABLE() { return process.env.CHANNELS_TABLE || ''; },
    get USER_STARRED_MESSAGES_TABLE() { return process.env.USER_STARRED_MESSAGES_TABLE || ''; },

    get PUSH_NOTIFICATIONS_ENABLED() {
        return !!(this.DEVICE_TOKENS_TABLE && this.SEND_PUSH_FUNCTION_ARN);
    },
} as const;
