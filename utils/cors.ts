export type CorsOptions = {
  allowOrigin?: string;
  allowMethods?: string[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
};

const DEFAULT_ORIGIN = process.env.CORS_ORIGIN || 'https://todaysdentalinsights.com';
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization'];

export function buildCorsHeaders(options: CorsOptions = {}): Record<string, string> {
  const allowOrigin = options.allowOrigin || DEFAULT_ORIGIN;
  const allowMethods = (options.allowMethods || DEFAULT_METHODS).join(', ');
  const uniqueHeaders = Array.from(new Set([...(options.allowHeaders || []), ...DEFAULT_HEADERS]));
  const allowHeaders = uniqueHeaders.join(', ');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
  };
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0) headers['Access-Control-Max-Age'] = String(maxAgeSeconds);
  return headers;
}


