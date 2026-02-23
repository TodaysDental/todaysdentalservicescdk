/**
 * Secrets Seeder Lambda - CloudFormation CustomResource Handler
 * 
 * This Lambda populates the three secrets/config DynamoDB tables with initial data
 * from the JSON configuration files during CDK deployment.
 * 
 * Tables:
 * - ClinicSecrets: Per-clinic sensitive credentials
 * - GlobalSecrets: System-wide API keys and credentials
 * - ClinicConfig: Non-sensitive clinic configuration
 */

import { DynamoDBClient, BatchWriteItemCommand, BatchWriteItemCommandInput } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';

// Import configuration data - these will be bundled at build time
import clinicSecretsData from '../../infrastructure/configs/clinic-secrets.json';
import globalSecretsData from '../../infrastructure/configs/global-secrets.json';
import clinicConfigData from '../../infrastructure/configs/clinic-config.json';

const dynamodb = new DynamoDBClient({});

// Environment variables
const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE!;
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE!;
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE!;

/**
 * Escape raw control characters that appear inside JSON string literals.
 *
 * This repairs common copy/paste issues where a JSON string value (most often
 * `private_key`) contains literal newlines or other control characters, which
 * makes `JSON.parse()` throw `Bad control character in string literal`.
 *
 * NOTE: This intentionally ONLY escapes control characters while we are inside
 * a JSON string (between quotes), leaving formatting whitespace (newlines outside
 * strings) untouched.
 */
function escapeControlCharsInJsonStringLiterals(jsonText: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i]!;

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }

      // Escape raw control characters inside string literals
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }

      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }

      out += ch;
      continue;
    }

    // Not in a string
    if (ch === '"') {
      out += ch;
      inString = true;
      continue;
    }

    out += ch;
  }

  return out;
}

function sanitizeFcmServiceAccountJson(value: string): { value: string; repaired: boolean } {
  try {
    JSON.parse(value);
    return { value, repaired: false };
  } catch {
    const repaired = escapeControlCharsInJsonStringLiterals(value);
    // Validate the repaired JSON; if still invalid, keep original
    try {
      JSON.parse(repaired);
      return { value: repaired, repaired: true };
    } catch {
      return { value, repaired: false };
    }
  }
}

interface ClinicSecret {
  clinicId: string;
  openDentalDeveloperKey: string;
  openDentalCustomerKey: string;
  authorizeNetApiLoginId: string;
  authorizeNetTransactionKey: string;
  gmailSmtpPassword: string;
  domainSmtpPassword: string;
  ayrshareProfileKey: string;
  ayrshareRefId: string;
  // Microsoft Clarity API token for analytics
  microsoftClarityApiToken?: string;
  // RCS messaging configuration
  rcsSenderId?: string;
  messagingServiceSid?: string;
  // Cherry financing API key
  cherryApiKey?: string;
}

interface GlobalSecret {
  secretId: string;
  secretType: string;
  value: string;
  metadata?: Record<string, any>;
}

interface ClinicConfig {
  clinicId: string;
  [key: string]: any;
}

/**
 * Batch write items to DynamoDB table
 * DynamoDB BatchWriteItem has a limit of 25 items per request
 */
async function batchWriteItems(tableName: string, items: Record<string, any>[]): Promise<void> {
  const BATCH_SIZE = 25;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const writeRequests = batch.map(item => ({
      PutRequest: {
        Item: marshall(item, { removeUndefinedValues: true }),
      },
    }));

    const params: BatchWriteItemCommandInput = {
      RequestItems: {
        [tableName]: writeRequests,
      },
    };

    try {
      await dynamodb.send(new BatchWriteItemCommand(params));
      console.log(`[Seeder] Successfully wrote ${batch.length} items to ${tableName} (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
    } catch (error) {
      console.error(`[Seeder] Error writing batch to ${tableName}:`, error);
      throw error;
    }
  }
}

/**
 * Seed clinic secrets table
 */
async function seedClinicSecrets(): Promise<number> {
  console.log(`[Seeder] Seeding ${clinicSecretsData.length} clinic secrets...`);

  const items = (clinicSecretsData as ClinicSecret[]).map(secret => ({
    clinicId: secret.clinicId,
    openDentalDeveloperKey: secret.openDentalDeveloperKey,
    openDentalCustomerKey: secret.openDentalCustomerKey,
    authorizeNetApiLoginId: secret.authorizeNetApiLoginId,
    authorizeNetTransactionKey: secret.authorizeNetTransactionKey,
    gmailSmtpPassword: secret.gmailSmtpPassword,
    domainSmtpPassword: secret.domainSmtpPassword,
    ayrshareProfileKey: secret.ayrshareProfileKey,
    ayrshareRefId: secret.ayrshareRefId,
    // Microsoft Clarity API token for analytics
    microsoftClarityApiToken: secret.microsoftClarityApiToken,
    // RCS messaging configuration
    rcsSenderId: secret.rcsSenderId,
    messagingServiceSid: secret.messagingServiceSid,
    // Cherry financing API key
    cherryApiKey: secret.cherryApiKey,
    updatedAt: new Date().toISOString(),
  }));

  await batchWriteItems(CLINIC_SECRETS_TABLE, items);
  return items.length;
}

/**
 * Seed global secrets table
 */
async function seedGlobalSecrets(): Promise<number> {
  console.log(`[Seeder] Seeding ${globalSecretsData.length} global secrets...`);

  const items = (globalSecretsData as GlobalSecret[]).map((secret) => {
    let value = secret.value;

    // Special-case: FCM service account must be valid JSON (parsed later by push lambdas).
    // If the config contains a copy/paste newline inside a string literal, repair it here.
    if (secret.secretId === 'fcm' && secret.secretType === 'service_account') {
      const sanitized = sanitizeFcmServiceAccountJson(secret.value);
      value = sanitized.value;
      if (sanitized.repaired) {
        console.warn('[Seeder] Repaired invalid fcm/service_account JSON (escaped control characters in string literals)');
      } else {
        // If it's still invalid, keep the original but warn loudly (push will be disabled until fixed).
        try {
          JSON.parse(secret.value);
        } catch (e: any) {
          console.error('[Seeder] fcm/service_account is not valid JSON. Push notifications will be disabled until fixed.');
          console.error('[Seeder] Parse error:', e?.message || String(e));
        }
      }
    }

    return {
      secretId: secret.secretId,
      secretType: secret.secretType,
      value,
      metadata: secret.metadata || {},
      updatedAt: new Date().toISOString(),
    };
  });

  await batchWriteItems(GLOBAL_SECRETS_TABLE, items);
  return items.length;
}

/**
 * Seed clinic config table
 */
async function seedClinicConfig(): Promise<number> {
  console.log(`[Seeder] Seeding ${clinicConfigData.length} clinic configs...`);

  const items = (clinicConfigData as ClinicConfig[]).map(config => ({
    ...config,
    updatedAt: new Date().toISOString(),
  }));

  await batchWriteItems(CLINIC_CONFIG_TABLE, items);
  return items.length;
}

/**
 * Main handler for CloudFormation CustomResource events
 */
export async function handler(
  event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> {
  console.log('[Seeder] Received event:', JSON.stringify(event, null, 2));

  const requestType = event.RequestType;
  // PhysicalResourceId only exists on Update/Delete events
  const physicalResourceId = (event as any).PhysicalResourceId || `secrets-seeder-${Date.now()}`;

  try {
    if (requestType === 'Create' || requestType === 'Update') {
      console.log(`[Seeder] Processing ${requestType} request...`);

      // Seed all tables
      const clinicSecretsCount = await seedClinicSecrets();
      const globalSecretsCount = await seedGlobalSecrets();
      const clinicConfigCount = await seedClinicConfig();

      console.log('[Seeder] Seeding completed successfully!');
      console.log(`[Seeder] Summary: ${clinicSecretsCount} clinic secrets, ${globalSecretsCount} global secrets, ${clinicConfigCount} clinic configs`);

      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
          Message: 'Secrets seeding completed successfully',
          ClinicSecretsCount: clinicSecretsCount.toString(),
          GlobalSecretsCount: globalSecretsCount.toString(),
          ClinicConfigCount: clinicConfigCount.toString(),
        },
      };
    } else if (requestType === 'Delete') {
      // On delete, we don't remove the data - the tables have RETAIN policy
      console.log('[Seeder] Delete request received - data will be retained in tables');

      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
          Message: 'Delete acknowledged - data retained in tables',
        },
      };
    }

    // Unknown request type - cast event to any since TypeScript thinks this is unreachable
    const anyEvent = event as any;
    return {
      Status: 'FAILED',
      PhysicalResourceId: physicalResourceId,
      StackId: anyEvent.StackId,
      RequestId: anyEvent.RequestId,
      LogicalResourceId: anyEvent.LogicalResourceId,
      Reason: `Unknown request type: ${requestType}`,
    };
  } catch (error) {
    console.error('[Seeder] Error processing request:', error);

    // Use type assertion since event might be narrowed to never in catch block
    const anyEvent = event as any;
    return {
      Status: 'FAILED',
      PhysicalResourceId: physicalResourceId,
      StackId: anyEvent.StackId,
      RequestId: anyEvent.RequestId,
      LogicalResourceId: anyEvent.LogicalResourceId,
      Reason: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
