/**
 * Secrets Helper Utility
 * 
 * Provides functions to retrieve secrets and configuration from DynamoDB tables.
 * Includes in-memory caching to reduce DynamoDB reads.
 * 
 * Tables:
 * - ClinicSecrets: Per-clinic sensitive credentials
 * - GlobalSecrets: System-wide API keys and credentials  
 * - ClinicConfig: Non-sensitive clinic configuration
 * 
 * Usage:
 *   import { getClinicSecret, getGlobalSecret, getClinicConfig } from '../../shared/utils/secrets-helper';
 *   
 *   const apiKey = await getGlobalSecret('ayrshare', 'api_key');
 *   const authNetKey = await getClinicSecret('dentistinnewbritain', 'authorizeNetTransactionKey');
 *   const config = await getClinicConfig('dentistinnewbritain');
 */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// DynamoDB client - singleton
let dynamoClient: DynamoDB | null = null;

function getDynamoClient(): DynamoDB {
  if (!dynamoClient) {
    dynamoClient = new DynamoDB({});
  }
  return dynamoClient;
}

// ========================================
// ENVIRONMENT VARIABLES
// ========================================
// These should be set by the consuming Lambda's environment

const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || 'TodaysDentalInsights-ClinicSecrets';
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || 'TodaysDentalInsights-GlobalSecrets';
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || 'TodaysDentalInsights-ClinicConfig';

// ========================================
// CACHE CONFIGURATION
// ========================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// Cache TTL in milliseconds (5 minutes default)
const CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || '300000', 10);

// In-memory caches
const clinicSecretsCache = new Map<string, CacheEntry<ClinicSecrets>>();
const globalSecretsCache = new Map<string, CacheEntry<string>>();
const clinicConfigCache = new Map<string, CacheEntry<ClinicConfig>>();

// ========================================
// TYPES
// ========================================

export interface ClinicSecrets {
  clinicId: string;
  openDentalDeveloperKey: string;
  openDentalCustomerKey: string;
  authorizeNetApiLoginId: string;
  authorizeNetTransactionKey: string;
  gmailSmtpPassword: string;
  domainSmtpPassword: string;
  ayrshareProfileKey: string;
  ayrshareRefId: string;
  updatedAt?: string;
}

export interface GlobalSecretEntry {
  secretId: string;
  secretType: string;
  value: string;
  metadata?: Record<string, any>;
  updatedAt?: string;
}

export interface ClinicConfig {
  clinicId: string;
  odooCompanyId?: number;
  clinicAddress: string;
  clinicCity: string;
  clinicEmail: string;
  clinicFax?: string;
  clinicName: string;
  clinicZipCode: string;
  clinicPhone: string;
  clinicState: string;
  timezone: string;
  logoUrl: string;
  mapsUrl?: string;
  scheduleUrl?: string;
  websiteLink: string;
  phoneNumber: string;
  sesIdentityArn?: string;
  smsOriginationArn?: string;
  sftpFolderPath?: string;
  hostedZoneId?: string;
  email?: {
    gmail?: EmailConfig;
    domain?: EmailConfig;
  };
  ayrshare?: AyrshareConfig;
  updatedAt?: string;
}

export interface EmailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  fromEmail: string;
  fromName: string;
}

export interface AyrshareConfig {
  enabled: boolean;
  connectedPlatforms: string[];
  facebook?: {
    connected: boolean;
    pageId: string;
    pageName: string;
  };
}

// ========================================
// CACHE HELPERS
// ========================================

function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiresAt > Date.now();
}

function setCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ========================================
// CLINIC SECRETS FUNCTIONS
// ========================================

/**
 * Get all secrets for a specific clinic
 * @param clinicId - The clinic identifier
 * @returns ClinicSecrets object or null if not found
 */
export async function getClinicSecrets(clinicId: string): Promise<ClinicSecrets | null> {
  // Check cache first
  const cached = clinicSecretsCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_SECRETS_TABLE,
      Key: {
        clinicId: { S: clinicId },
      },
    });

    if (!response.Item) {
      console.warn(`[SecretsHelper] No secrets found for clinic: ${clinicId}`);
      return null;
    }

    const secrets = unmarshall(response.Item) as ClinicSecrets;
    setCacheEntry(clinicSecretsCache, clinicId, secrets);
    return secrets;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic secrets for ${clinicId}:`, error);
    throw error;
  }
}

/**
 * Get a specific secret value for a clinic
 * @param clinicId - The clinic identifier
 * @param secretName - The name of the secret field
 * @returns The secret value or null if not found
 */
export async function getClinicSecret(
  clinicId: string,
  secretName: keyof Omit<ClinicSecrets, 'clinicId' | 'updatedAt'>
): Promise<string | null> {
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) {
    return null;
  }
  return secrets[secretName] || null;
}

/**
 * Get all clinic secrets (for bulk operations)
 * @returns Array of all clinic secrets
 */
export async function getAllClinicSecrets(): Promise<ClinicSecrets[]> {
  try {
    const response = await getDynamoClient().scan({
      TableName: CLINIC_SECRETS_TABLE,
    });

    if (!response.Items) {
      return [];
    }

    const secrets = response.Items.map(item => unmarshall(item) as ClinicSecrets);

    // Update cache for each clinic
    secrets.forEach(secret => {
      setCacheEntry(clinicSecretsCache, secret.clinicId, secret);
    });

    return secrets;
  } catch (error) {
    console.error('[SecretsHelper] Error fetching all clinic secrets:', error);
    throw error;
  }
}

// ========================================
// GLOBAL SECRETS FUNCTIONS
// ========================================

/**
 * Get a global secret value
 * @param secretId - The secret identifier (e.g., 'ayrshare', 'odoo')
 * @param secretType - The type of secret (e.g., 'api_key', 'private_key')
 * @returns The secret value or null if not found
 */
export async function getGlobalSecret(secretId: string, secretType: string): Promise<string | null> {
  const cacheKey = `${secretId}#${secretType}`;

  // Check cache first
  const cached = globalSecretsCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  try {
    const response = await getDynamoClient().getItem({
      TableName: GLOBAL_SECRETS_TABLE,
      Key: {
        secretId: { S: secretId },
        secretType: { S: secretType },
      },
    });

    if (!response.Item) {
      console.warn(`[SecretsHelper] No global secret found: ${secretId}/${secretType}`);
      return null;
    }

    const entry = unmarshall(response.Item) as GlobalSecretEntry;
    setCacheEntry(globalSecretsCache, cacheKey, entry.value);
    return entry.value;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secret ${secretId}/${secretType}:`, error);
    throw error;
  }
}

/**
 * Get a global secret entry with metadata
 * @param secretId - The secret identifier
 * @param secretType - The type of secret
 * @returns GlobalSecretEntry or null if not found
 */
export async function getGlobalSecretEntry(secretId: string, secretType: string): Promise<GlobalSecretEntry | null> {
  try {
    const response = await getDynamoClient().getItem({
      TableName: GLOBAL_SECRETS_TABLE,
      Key: {
        secretId: { S: secretId },
        secretType: { S: secretType },
      },
    });

    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as GlobalSecretEntry;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secret entry ${secretId}/${secretType}:`, error);
    throw error;
  }
}

/**
 * Get all secrets for a given secretId (e.g., all ayrshare secrets)
 * @param secretId - The secret identifier
 * @returns Array of GlobalSecretEntry
 */
export async function getGlobalSecretsByType(secretId: string): Promise<GlobalSecretEntry[]> {
  try {
    const response = await getDynamoClient().query({
      TableName: GLOBAL_SECRETS_TABLE,
      KeyConditionExpression: 'secretId = :sid',
      ExpressionAttributeValues: {
        ':sid': { S: secretId },
      },
    });

    if (!response.Items) {
      return [];
    }

    return response.Items.map(item => unmarshall(item) as GlobalSecretEntry);
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secrets for ${secretId}:`, error);
    throw error;
  }
}

// ========================================
// CLINIC CONFIG FUNCTIONS
// ========================================

/**
 * Get configuration for a specific clinic
 * @param clinicId - The clinic identifier
 * @returns ClinicConfig object or null if not found
 */
export async function getClinicConfig(clinicId: string): Promise<ClinicConfig | null> {
  // Check cache first
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }

  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId },
      },
    });

    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }

    const config = unmarshall(response.Item) as ClinicConfig;
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}

/**
 * Get all clinic configurations
 * @returns Array of all clinic configs
 */
export async function getAllClinicConfigs(): Promise<ClinicConfig[]> {
  try {
    const response = await getDynamoClient().scan({
      TableName: CLINIC_CONFIG_TABLE,
    });

    if (!response.Items) {
      return [];
    }

    const configs = response.Items.map(item => unmarshall(item) as ClinicConfig);

    // Update cache for each clinic
    configs.forEach(config => {
      setCacheEntry(clinicConfigCache, config.clinicId, config);
    });

    return configs;
  } catch (error) {
    console.error('[SecretsHelper] Error fetching all clinic configs:', error);
    throw error;
  }
}

/**
 * Get clinic configurations by state
 * @param state - The state to filter by
 * @returns Array of clinic configs in that state
 */
export async function getClinicConfigsByState(state: string): Promise<ClinicConfig[]> {
  try {
    const response = await getDynamoClient().query({
      TableName: CLINIC_CONFIG_TABLE,
      IndexName: 'byState',
      KeyConditionExpression: 'clinicState = :state',
      ExpressionAttributeValues: {
        ':state': { S: state },
      },
    });

    if (!response.Items) {
      return [];
    }

    return response.Items.map(item => unmarshall(item) as ClinicConfig);
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic configs for state ${state}:`, error);
    throw error;
  }
}

// ========================================
// COMBINED HELPERS
// ========================================

/**
 * Get full clinic data including both secrets and config
 * Useful when you need both in the same operation
 */
export interface FullClinicData {
  config: ClinicConfig;
  secrets: ClinicSecrets;
}

export async function getFullClinicData(clinicId: string): Promise<FullClinicData | null> {
  const [config, secrets] = await Promise.all([
    getClinicConfig(clinicId),
    getClinicSecrets(clinicId),
  ]);

  if (!config || !secrets) {
    return null;
  }

  return { config, secrets };
}

/**
 * Get clinic IDs from config table
 * @returns Array of clinic IDs
 */
export async function getClinicIds(): Promise<string[]> {
  const configs = await getAllClinicConfigs();
  return configs.map(c => c.clinicId);
}

// ========================================
// CACHE MANAGEMENT
// ========================================

/**
 * Clear all caches - useful for testing or forcing refresh
 */
export function clearAllCaches(): void {
  clinicSecretsCache.clear();
  globalSecretsCache.clear();
  clinicConfigCache.clear();
  console.log('[SecretsHelper] All caches cleared');
}

/**
 * Clear cache for a specific clinic
 */
export function clearClinicCache(clinicId: string): void {
  clinicSecretsCache.delete(clinicId);
  clinicConfigCache.delete(clinicId);
}

/**
 * Clear cache for a specific global secret
 */
export function clearGlobalSecretCache(secretId: string, secretType: string): void {
  globalSecretsCache.delete(`${secretId}#${secretType}`);
}

// ========================================
// CONVENIENCE GETTERS FOR COMMON SECRETS
// ========================================

/**
 * Get Ayrshare API Key
 */
export async function getAyrshareApiKey(): Promise<string | null> {
  return getGlobalSecret('ayrshare', 'api_key');
}

/**
 * Get Ayrshare Private Key
 */
export async function getAyrsharePrivateKey(): Promise<string | null> {
  return getGlobalSecret('ayrshare', 'private_key');
}

/**
 * Get Ayrshare Domain
 */
export async function getAyrshareDomain(): Promise<string | null> {
  return getGlobalSecret('ayrshare', 'domain');
}

/**
 * Get Odoo API Key
 */
export async function getOdooApiKey(): Promise<string | null> {
  return getGlobalSecret('odoo', 'api_key');
}

/**
 * Get Odoo configuration (URL + database)
 */
export async function getOdooConfig(): Promise<{ url: string; database: string; apiKey: string } | null> {
  const [configEntry, apiKey] = await Promise.all([
    getGlobalSecretEntry('odoo', 'config'),
    getGlobalSecret('odoo', 'api_key'),
  ]);

  if (!configEntry || !apiKey) {
    return null;
  }

  return {
    url: configEntry.value,
    database: configEntry.metadata?.database || 'todays-dental-services',
    apiKey,
  };
}

/**
 * Get Gmail OAuth credentials
 */
export async function getGmailOAuthCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const [clientId, clientSecret] = await Promise.all([
    getGlobalSecret('gmail', 'client_id'),
    getGlobalSecret('gmail', 'client_secret'),
  ]);

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

/**
 * Get Twilio credentials
 */
export async function getTwilioCredentials(): Promise<{ accountSid: string; authToken: string } | null> {
  const [accountSid, authToken] = await Promise.all([
    getGlobalSecret('twilio', 'account_sid'),
    getGlobalSecret('twilio', 'auth_token'),
  ]);

  if (!accountSid || !authToken) {
    return null;
  }

  return { accountSid, authToken };
}

/**
 * Get cPanel credentials for email account management
 * Uses API Token authentication (preferred over password auth)
 */
export async function getCpanelCredentials(): Promise<{
  host: string;
  port: number;
  username: string;
  apiToken: string;
  domain: string;
} | null> {
  const [apiTokenEntry, configEntry] = await Promise.all([
    getGlobalSecretEntry('cpanel', 'api_token'),
    getGlobalSecretEntry('cpanel', 'config'),
  ]);

  if (!apiTokenEntry) {
    console.warn('[SecretsHelper] cPanel API token not found in GlobalSecrets');
    return null;
  }

  // Get config from api_token metadata or config entry
  const metadata = apiTokenEntry.metadata || configEntry?.metadata || {};

  return {
    host: metadata.host || configEntry?.value || 'box2383.bluehost.com',
    port: parseInt(metadata.port || '2083', 10),
    username: metadata.user || 'todayse4',
    apiToken: apiTokenEntry.value,
    domain: metadata.domain || 'todaysdentalpartners.com',
  };
}

/**
 * Get Firebase Cloud Messaging (FCM) credentials for push notifications
 * Uses the FCM HTTP v1 API with service account authentication
 */
export async function getFCMCredentials(): Promise<{
  projectId: string;
  serviceAccountKey: string;
} | null> {
  const [projectId, serviceAccountKey] = await Promise.all([
    getGlobalSecret('fcm', 'project_id'),
    getGlobalSecret('fcm', 'service_account'),
  ]);

  if (!projectId || !serviceAccountKey) {
    console.warn('[SecretsHelper] FCM credentials not found in GlobalSecrets');
    return null;
  }

  return { projectId, serviceAccountKey };
}
