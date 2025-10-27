import clinicsJson from '../../infrastructure/configs/clinics.json';

export type CorsOptions = {
  allowOrigin?: string;
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
};

export const ALLOWED_ORIGINS_LIST = [
  'https://todaysdentalinsights.com',
  'https://todaysdentalinsights.com/',
  ...(clinicsJson as any[])
    .map(c => String(c.websiteLink))
    .filter(Boolean)
];

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'Referer'];

// Helper function to determine which origin to allow based on request origin
function getAllowedOrigin(requestOrigin?: string): string {
  // If no specific origin requested, use the main domain
  if (!requestOrigin) {
    return ALLOWED_ORIGINS_LIST[0]; // 'https://todaysdentalinsights.com'
  }
  
  // If the request origin is in our allowed list, use it
  if (ALLOWED_ORIGINS_LIST.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Otherwise, default to main domain
  return ALLOWED_ORIGINS_LIST[0];
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
  return headers;
}

// CDK-specific CORS configuration helper
export function getCdkCorsConfig(options: CorsOptions = {}) {
  const allowOrigins = options.allowOrigin ? [options.allowOrigin] : ALLOWED_ORIGINS_LIST;
  const allowMethods = options.allowMethods || DEFAULT_METHODS;
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  
  return {
    allowOrigins,
    allowHeaders: uniqueHeaders,
    allowMethods,
  };
}

// Get CORS error headers for API Gateway responses
export function getCorsErrorHeaders(options: CorsOptions = {}): Record<string, string> {
  // For API Gateway error responses, use the main domain as default
  const corsHeaders = buildCorsHeaders(options, ALLOWED_ORIGINS_LIST[0]);
  return Object.entries(corsHeaders).reduce((acc, [key, value]) => {
    acc[key] = `'${value}'`; // API Gateway expects single quotes around header values
    return acc;
  }, {} as Record<string, string>);
}


