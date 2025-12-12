/**
 * FIX #37: Environment-Specific SMA Maps via SSM Parameter Store
 * 
 * Loads SMA ID mappings from AWS Systems Manager Parameter Store
 * instead of environment variables. This allows per-environment
 * configuration without code changes.
 * 
 * Note: Requires @aws-sdk/client-ssm package
 * Install with: npm install @aws-sdk/client-ssm
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

interface ClinicSmaMap {
  [clinicId: string]: string;
}

let cachedMap: ClinicSmaMap | undefined;
let cacheExpiry: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch SMA map from SSM Parameter Store
 * 
 * Tries multiple SSM parameter paths in order:
 * 1. SMA_ID_MAP_PARAMETER env var (set by ChimeStack for AI Transcript Bridge)
 * 2. /${stackName}/SmaIdMap (created by ChimeStack CDK deployment)
 * 3. /contactcenter/${env}/sma-map (legacy/alternative configuration)
 * 4. SMA_ID_MAP environment variable (fallback)
 */
async function fetchSmaMapFromSSM(): Promise<ClinicSmaMap | undefined> {
  const now = Date.now();

  // Return cached if still valid
  if (cachedMap && now < cacheExpiry) {
    return cachedMap;
  }

  const env = process.env.ENVIRONMENT || 'dev';
  const stackName = process.env.CHIME_STACK_NAME || 'ChimeStack';
  
  // List of SSM parameter paths to try (in order of priority)
  const paramPaths = [
    process.env.SMA_ID_MAP_PARAMETER, // Set by ChimeStack for AI Transcript Bridge
    `/${stackName}/SmaIdMap`,          // ChimeStack CDK-created parameter
    `/contactcenter/${env}/sma-map`,   // Legacy/alternative configuration
  ].filter(Boolean) as string[];

  for (const paramName of paramPaths) {
    try {
      const result = await ssm.send(new GetParameterCommand({
        Name: paramName,
        WithDecryption: true
      }));

      if (result.Parameter?.Value) {
        cachedMap = JSON.parse(result.Parameter.Value);
        cacheExpiry = now + CACHE_TTL;
        console.log(`[sma-map] Loaded SMA map from SSM: ${paramName}`);
        return cachedMap || {};
      }
    } catch (err: any) {
      // Parameter not found - try next one
      if (err.name === 'ParameterNotFound') {
        console.log(`[sma-map] Parameter ${paramName} not found, trying next...`);
        continue;
      }
      // Other error - log and continue
      console.warn(`[sma-map] Error loading ${paramName}:`, err.message);
    }
  }

  // Fallback to environment variable
  const envMap = process.env.SMA_ID_MAP;
  if (envMap) {
    try {
      cachedMap = JSON.parse(envMap);
      cacheExpiry = now + CACHE_TTL;
      console.warn('[sma-map] Using SMA_ID_MAP from environment variable (consider moving to SSM)');
      return cachedMap;
    } catch (err) {
      console.error('[sma-map] Failed to parse SMA_ID_MAP:', err);
    }
  }

  // Return undefined if all else fails
  console.error('[sma-map] No SMA map configuration found. Tried SSM paths:', paramPaths.join(', '));
  return undefined;
}

/**
 * Get SMA ID for a clinic
 */
export async function getSmaIdForClinicSSM(
  clinicId: string | undefined
): Promise<string | undefined> {
  if (!clinicId) return undefined;

  const map = await fetchSmaMapFromSSM();
  return map ? map[clinicId] : undefined;
}

/**
 * Force refresh of SMA map cache
 */
export async function refreshSmaMap(): Promise<ClinicSmaMap | undefined> {
  cacheExpiry = 0; // Force refresh
  return await fetchSmaMapFromSSM();
}

/**
 * Get all SMA mappings (for admin/debugging)
 */
export async function getAllSmaMappings(): Promise<ClinicSmaMap> {
  const map = await fetchSmaMapFromSSM();
  return map || {};
}

