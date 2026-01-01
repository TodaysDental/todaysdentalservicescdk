/**
 * CORS Utility
 * 
 * Provides CORS configuration for both CDK (build-time) and Lambda (runtime) usage.
 * 
 * For CDK stacks: Uses clinicsData from JSON (synchronous, build-time)
 * For Lambda runtime: Can use getAllClinicConfigs() from secrets-helper (async)
 */

// For CDK build-time usage, we use clinic-config.json (non-sensitive data only)
// This is used when synthesizing CDK stacks and cannot be async
import clinicConfigData from '../../infrastructure/configs/clinic-config.json';
import { getAllClinicConfigs, ClinicConfig } from './secrets-helper';

// Alias for backward compatibility
const clinicsData = clinicConfigData;

export type CorsOptions = {
  allowOrigin?: string;
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
};

// Static list for CDK build-time (synchronous)
// This is required because CDK synthesis cannot use async operations
export const ALLOWED_ORIGINS_LIST = [
  'https://todaysdentalinsights.com',
  'https://todaysdentalinsights.com/',
  ...(clinicsData as any[])
    .map(c => String(c.websiteLink))
    .filter(Boolean)
];

// Cache for runtime-loaded origins
let runtimeOriginsCache: string[] | null = null;

/**
 * Get allowed origins at runtime from DynamoDB
 * This is the preferred method for Lambda functions
 */
export async function getAllowedOriginsAsync(): Promise<string[]> {
  if (runtimeOriginsCache) {
    return runtimeOriginsCache;
  }

  try {
    const configs = await getAllClinicConfigs();
    runtimeOriginsCache = [
      'https://todaysdentalinsights.com',
      'https://todaysdentalinsights.com/',
      ...configs.map((c: ClinicConfig) => c.websiteLink).filter(Boolean)
    ];
    return runtimeOriginsCache;
  } catch (error) {
    console.warn('[CORS] Failed to load origins from DynamoDB, falling back to static list:', error);
    return ALLOWED_ORIGINS_LIST;
  }
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'Referer'];

// Helper function to determine which origin to allow based on request origin
function getAllowedOrigin(requestOrigin?: string, allowedOrigins: string[] = ALLOWED_ORIGINS_LIST): string {
  console.log('[CORS] Determining allowed origin', { requestOrigin, allowedOrigins: allowedOrigins.slice(0, 5) });
  
  // If no specific origin requested, use the main domain
  if (!requestOrigin) {

    return allowedOrigins[0]; // 'https://todaysdentalinsights.com'
  }
  
  // If the request origin is in our allowed list, use it
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Otherwise, default to main domain
  console.warn('[CORS] Request origin not allowed, using default:', { requestOrigin, defaultOrigin: allowedOrigins[0] });
  return allowedOrigins[0];
}

export function buildCorsHeaders(options: CorsOptions = {}, requestOrigin?: string): Record<string, string> {
  
  const allowOrigin = options.allowOrigin || getAllowedOrigin(requestOrigin);
  const allowMethods = (options.allowMethods || DEFAULT_METHODS).join(', ');
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  const allowHeaders = uniqueHeaders.join(', ');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Credentials': 'true',
  };
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0) headers['Access-Control-Max-Age'] = String(maxAgeSeconds);
  
  console.log('[CORS] Generated headers:', headers);
  return headers;
}

/**
 * Build CORS headers asynchronously using DynamoDB-loaded origins
 * Use this in Lambda handlers for dynamic origin validation
 */
export async function buildCorsHeadersAsync(options: CorsOptions = {}, requestOrigin?: string): Promise<Record<string, string>> {
  const allowedOrigins = await getAllowedOriginsAsync();
  
  const allowOrigin = options.allowOrigin || getAllowedOrigin(requestOrigin, allowedOrigins);
  const allowMethods = (options.allowMethods || DEFAULT_METHODS).join(', ');
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  const allowHeaders = uniqueHeaders.join(', ');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Credentials': 'true',
  };
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0) headers['Access-Control-Max-Age'] = String(maxAgeSeconds);
  
  return headers;
}

// CDK-specific CORS configuration helper (synchronous - uses static list)
export function getCdkCorsConfig(options: CorsOptions = {}) {
  const allowOrigins = options.allowOrigin ? [options.allowOrigin] : ALLOWED_ORIGINS_LIST;
  const allowMethods = options.allowMethods || DEFAULT_METHODS;
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  
  return {
    allowOrigins,
    allowHeaders: uniqueHeaders,
    allowMethods,
    allowCredentials: true, // Required for Authorization header / cookies
  };
}

// Get CORS error headers for API Gateway responses
export function getCorsErrorHeaders(options: CorsOptions = {}): Record<string, string> {
  console.log('[CORS] Building error headers for API Gateway');
  
  // For API Gateway error responses, use the main domain as default
  const corsHeaders = buildCorsHeaders(options, ALLOWED_ORIGINS_LIST[0]);
  const errorHeaders = Object.entries(corsHeaders).reduce((acc, [key, value]) => {
    acc[key] = `'${value}'`; // API Gateway expects single quotes around header values
    return acc;
  }, {} as Record<string, string>);
  
  console.log('[CORS] Generated error headers:', errorHeaders);
  return errorHeaders;
}

// Get CORS headers for API Gateway mock integration (OPTIONS method)
// This is used for preflight requests where we want to echo back the requesting origin
export function getCorsOptionsIntegrationParams(options: CorsOptions = {}): {
  responseParameters: Record<string, string>;
  allowedMethods: string;
  allowedHeaders: string;
} {
  const allowMethods = options.allowMethods || DEFAULT_METHODS;
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  
  return {
    responseParameters: {
      // Echo back the requesting origin (API Gateway will validate it's in allowed list)
      'method.response.header.Access-Control-Allow-Origin': 'method.request.header.Origin',
      'method.response.header.Access-Control-Allow-Methods': `'${allowMethods.join(',')}'`,
      'method.response.header.Access-Control-Allow-Headers': `'${uniqueHeaders.join(',')}'`,
      'method.response.header.Access-Control-Allow-Credentials': "'true'",
      'method.response.header.Access-Control-Max-Age': "'86400'",
    },
    allowedMethods: allowMethods.join(','),
    allowedHeaders: uniqueHeaders.join(','),
  };
}

/**
 * Clear the runtime origins cache
 * Useful for testing or forcing a refresh
 */
export function clearOriginsCache(): void {
  runtimeOriginsCache = null;
}
