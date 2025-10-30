import clinicsData from '../../infrastructure/configs/clinics.json';

export type CorsOptions = {
  allowOrigin?: string;
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
};

export const ALLOWED_ORIGINS_LIST = [
  'https://todaysdentalinsights.com',
  'https://todaysdentalinsights.com/',
  ...(clinicsData as any[])
    .map(c => String(c.websiteLink))
    .filter(Boolean)
];

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'Referer'];

// Helper function to determine which origin to allow based on request origin
function getAllowedOrigin(requestOrigin?: string): string {
  console.log('[CORS] Determining allowed origin', { requestOrigin, allowedOrigins: ALLOWED_ORIGINS_LIST });
  
  // If no specific origin requested, use the main domain
  if (!requestOrigin) {
    console.log('[CORS] No request origin provided, using default origin');
    return ALLOWED_ORIGINS_LIST[0]; // 'https://todaysdentalinsights.com'
  }
  
  // If the request origin is in our allowed list, use it
  if (ALLOWED_ORIGINS_LIST.includes(requestOrigin)) {
    console.log('[CORS] Request origin allowed:', requestOrigin);
    return requestOrigin;
  }
  
  // Otherwise, default to main domain
  console.warn('[CORS] Request origin not allowed, using default:', { requestOrigin, defaultOrigin: ALLOWED_ORIGINS_LIST[0] });
  return ALLOWED_ORIGINS_LIST[0];
}

export function buildCorsHeaders(options: CorsOptions = {}, requestOrigin?: string): Record<string, string> {
  console.log('[CORS] Building CORS headers', { options, requestOrigin });
  
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


