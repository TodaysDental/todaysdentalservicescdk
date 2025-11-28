import { SignJWT, jwtVerify } from 'jose';
import * as crypto from 'crypto';

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_ISSUER = 'TodaysDentalInsights';
const JWT_AUDIENCE = 'api.todaysdentalinsights.com';

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRY = '30d'; // 30 days

export interface ModuleAccessMap {
  module: string;
  permissions: string[]; // ['read', 'write', 'put', 'delete']
}

export interface ClinicRoleMap {
  clinicId: string;
  role: string;
  moduleAccess?: ModuleAccessMap[]; // Optional module-level permissions
}

/**
 * JWT Payload - MINIMAL for enterprise scale
 * 
 * For users with many clinics (>10), clinicRoles are NOT included in JWT.
 * Instead, they are fetched from DynamoDB/cache during authorization.
 * 
 * This keeps JWT token size constant (~300 bytes) regardless of clinic count.
 */
export interface JWTPayload {
  sub: string; // user email
  email: string;
  givenName?: string;
  familyName?: string;
  // clinicRoles NOT included - fetched from cache/DB by authorizer
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  type: 'access' | 'refresh';
}

/**
 * Generate an access token (MINIMAL payload for enterprise scale)
 * 
 * NOTE: clinicRoles are NOT included in the JWT token.
 * They are fetched from DynamoDB/cache by the Lambda authorizer.
 */
export async function generateAccessToken(payload: Omit<JWTPayload, 'type'>): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  
  return await new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * Generate a refresh token (MINIMAL payload)
 */
export async function generateRefreshToken(payload: Omit<JWTPayload, 'type' | 'isSuperAdmin' | 'isGlobalSuperAdmin'>): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  
  return await new SignJWT({ 
    ...payload, 
    type: 'refresh',
    isSuperAdmin: false,
    isGlobalSuperAdmin: false
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    
    return payload as unknown as JWTPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Hash a password using bcrypt-like algorithm
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

/**
 * Generate a random verification code
 */
export function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

