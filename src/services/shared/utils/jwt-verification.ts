import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

interface JWKSCache {
    jwks: ReturnType<typeof createRemoteJWKSet>;
    issuer: string;
    createdAt: number;
    ttl: number;
}

const cache: Map<string, JWKSCache> = new Map();
const DEFAULT_CACHE_TTL = 3600000; // 1 hour

export async function verifyIdTokenCached(
    authorizationHeader: string,
    region: string,
    userPoolId: string,
    cacheTtl: number = DEFAULT_CACHE_TTL
): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
    if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
        return { ok: false, code: 401, message: "Missing Bearer token" };
    }

    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    const cacheKey = issuer;
    const now = Date.now();

    // Check cache
    let cached = cache.get(cacheKey);
    if (!cached || (now - cached.createdAt) > cached.ttl) {
        // Create new JWKS instance
        cached = {
            jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
            issuer,
            createdAt: now,
            ttl: cacheTtl
        };
        cache.set(cacheKey, cached);
        console.log(`[JWT] Created new JWKS cache entry for ${issuer}`);
    }

    const token = authorizationHeader.slice(7).trim();
    try {
        const { payload } = await jwtVerify(token, cached.jwks, { issuer: cached.issuer });
        
        if ((payload as any).token_use !== "id") {
            return { ok: false, code: 401, message: "ID token required" };
        }
        
        return { ok: true, payload };
    } catch (err: any) {
        return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
    }
}

// Periodic cleanup of expired cache entries
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.createdAt > entry.ttl) {
            cache.delete(key);
            console.log(`[JWT] Removed expired JWKS cache entry for ${key}`);
        }
    }
}, 600000); // Every 10 minutes
