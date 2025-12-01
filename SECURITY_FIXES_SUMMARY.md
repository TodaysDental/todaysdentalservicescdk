# Security Fixes - Authentication & Registration

## Overview
All critical, high, and medium severity security flaws in the registration and login system have been fixed. This document summarizes the changes made.

---

## ✅ CRITICAL FIXES

### 1. **Timing Attack Vulnerability Fixed** (jwt.ts)
**Issue**: Password verification used direct string comparison (`===`) which is vulnerable to timing attacks.

**Fix**: Implemented constant-time comparison using `crypto.timingSafeEqual()`:
```typescript
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }
  
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  
  const [salt, hash] = parts;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  
  // Use constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(verifyHash, 'hex')
    );
  } catch (error) {
    return false;
  }
}
```

**Impact**: Prevents attackers from using response time to deduce password information.

---

### 2. **JWT Secret Generation Fixed** (jwt.ts)
**Issue**: JWT secret was falling back to a random value on each Lambda cold start, causing:
- All existing tokens to become invalid
- Users randomly logged out
- Tokens signed by one Lambda instance couldn't be verified by another

**Fix**: Fail fast if JWT_SECRET is not set:
```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required but not set');
}
```

**Impact**: Ensures consistent token validation across all Lambda instances and prevents random logouts.

---

### 3. **lastLoginAt Update Bug Fixed** (login.ts)
**Issue**: Code was using `GetCommand` instead of `UpdateCommand`, so it was reading the user but never updating the `lastLoginAt` field.

**Fix**: Replaced with proper `UpdateCommand`:
```typescript
ddb.send(new UpdateCommand({
  TableName: STAFF_USER_TABLE,
  Key: { email: user.email },
  UpdateExpression: 'SET lastLoginAt = :timestamp, updatedAt = :timestamp, loginAttempts = :zero, lockoutUntil = :zero',
  ExpressionAttributeValues: {
    ':timestamp': timestamp,
    ':zero': 0,
  },
})).catch(err => console.error('Failed to update lastLoginAt:', err));
```

**Impact**: Now properly tracks last login time and resets failed login attempts on successful login.

---

## ✅ HIGH SEVERITY FIXES

### 4. **Login Rate Limiting Implemented** (login.ts)
**Issue**: No protection against brute-force password attacks. Attackers could make unlimited login attempts.

**Fix**: Added comprehensive rate limiting:
- Maximum 5 failed attempts before lockout
- 15-minute lockout period after 5 failed attempts
- Failed attempts tracked in DynamoDB
- Lockout automatically expires after timeout

```typescript
// Constants
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Check for lockout
if (loginAttempts >= MAX_LOGIN_ATTEMPTS && now < lockoutUntil) {
  const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
  return {
    statusCode: 429,
    headers,
    body: JSON.stringify({ 
      error: 'Account temporarily locked due to too many failed login attempts',
      retryAfter: remainingSeconds,
      message: `Please try again in ${Math.ceil(remainingSeconds / 60)} minutes`,
    }),
  };
}
```

**New Fields Added to StaffUser**:
- `loginAttempts?: number` - Tracks failed password login attempts
- `lockoutUntil?: number` - Unix timestamp when account lockout expires

**Impact**: Prevents brute-force attacks on user accounts.

---

### 5. **Password Complexity Requirements** (register.ts)
**Issue**: No password strength validation. Weak passwords like "123456" or "password" were accepted.

**Fix**: Added comprehensive password validation:
```typescript
if (body.password) {
  if (body.password.length < 8) {
    throw new Error('password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(body.password)) {
    throw new Error('password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(body.password)) {
    throw new Error('password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(body.password)) {
    throw new Error('password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(body.password)) {
    throw new Error('password must contain at least one special character');
  }
  // Check for common weak passwords
  const weakPasswords = ['password', 'password123', '12345678', 'qwerty', 'abc123'];
  if (weakPasswords.includes(body.password.toLowerCase())) {
    throw new Error('password is too common, please choose a stronger password');
  }
}
```

**Requirements**:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Not in common weak passwords list

**Impact**: Significantly improves password security.

---

### 6. **User Enumeration Vulnerability Fixed** (initiate-otp.ts)
**Issue**: Different responses for non-existent vs inactive accounts allowed attackers to enumerate valid user emails.

**Before**:
```typescript
if (!user) {
  return { statusCode: 200, body: 'If account exists...' };
}
if (!user.isActive) {
  return { statusCode: 403, body: 'Account is inactive' }; // ⚠️ Reveals account exists!
}
```

**After**:
```typescript
// Don't reveal if user exists or is inactive (prevents user enumeration)
if (!user || !user.isActive) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      message: 'If an account exists with this email, an OTP code has been sent.',
      email,
    }),
  };
}
```

**Impact**: Prevents attackers from discovering valid user emails.

---

## ✅ MEDIUM SEVERITY FIXES

### 7. **Input Sanitization** (All Auth Endpoints)
**Issue**: User inputs were not consistently sanitized, potentially allowing injection attacks or data integrity issues.

**Fix**: Added input sanitization across all auth endpoints:

**login.ts**:
```typescript
const email = body.email?.trim().toLowerCase();
const password = body.password;

// Validate email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email format' }) };
}
```

**register.ts**:
```typescript
const username = body.email.trim().toLowerCase();
const givenName = body.givenName?.trim();
const familyName = body.familyName?.trim();
```

**initiate-otp.ts**, **verify-otp.ts**, **refresh.ts**: Similar sanitization applied.

**Impact**: Improves data consistency and prevents potential injection attacks.

---

### 8. **Token Revocation & Logout Endpoint** (NEW)
**Issue**: No way to invalidate tokens before expiration. Once issued, tokens remained valid for their full lifetime even after logout.

**Fix**: Created comprehensive logout system:

#### New `logout.ts` Endpoint:
- Accepts Authorization header (access token) and/or refresh token in body
- Verifies and blacklists tokens
- Clears refresh token from user record
- Returns success even if tokens are invalid (graceful logout)

#### New `TokenBlacklist` DynamoDB Table:
- Partition Key: `tokenHash` (SHA-256 hash of token)
- Attributes: `email`, `blacklistedAt`, `ttl`
- TTL enabled for automatic cleanup of expired blacklist entries

#### Updated Authorizers:
Both `authorizer.ts` and `authorizer-with-cache.ts` now check token blacklist:
```typescript
// Check if token is blacklisted (logged out)
const isBlacklisted = await isTokenBlacklisted(token);
if (isBlacklisted) {
  console.error('Token is blacklisted');
  throw new Error('Unauthorized');
}
```

#### Infrastructure Updates (core-stack.ts):
- Added `TokenBlacklist` DynamoDB table with TTL
- Created `AuthLogoutFn` Lambda function
- Added `/logout` POST endpoint to Auth API
- Granted appropriate permissions

**API Usage**:
```bash
POST /auth/logout
Authorization: Bearer <access-token>
Body: {
  "refreshToken": "<refresh-token>"  // optional
}
```

**Impact**: 
- Users can now properly log out
- Logged-out tokens cannot be reused
- Automatic cleanup of expired blacklist entries via DynamoDB TTL

---

## 📊 Summary of Changes

### Files Modified:
1. ✅ `src/shared/utils/jwt.ts` - Fixed timing attack, JWT secret, added token hashing
2. ✅ `src/shared/types/user.ts` - Added `loginAttempts` and `lockoutUntil` fields
3. ✅ `src/services/auth/login.ts` - Fixed lastLoginAt, added rate limiting, input sanitization
4. ✅ `src/services/auth/logout.ts` - **NEW** Logout endpoint with token revocation
5. ✅ `src/services/auth/authorizer.ts` - Added token blacklist check
6. ✅ `src/services/auth/authorizer-with-cache.ts` - Added token blacklist check
7. ✅ `src/services/auth/initiate-otp.ts` - Fixed user enumeration, added input sanitization
8. ✅ `src/services/auth/verify-otp.ts` - Added input sanitization
9. ✅ `src/services/auth/refresh.ts` - Added input sanitization
10. ✅ `src/services/admin/register.ts` - Added password complexity validation, input sanitization
11. ✅ `src/infrastructure/stacks/core-stack.ts` - Added TokenBlacklist table, logout endpoint

### Database Schema Updates:
**StaffUser Table** (new optional fields):
- `loginAttempts?: number` - Failed password login attempt count
- `lockoutUntil?: number` - Unix timestamp when lockout expires

**TokenBlacklist Table** (NEW):
- `tokenHash: string` (PK) - SHA-256 hash of the token
- `email: string` - User email for logging
- `blacklistedAt: string` - ISO timestamp when blacklisted
- `ttl: number` - Unix timestamp for DynamoDB TTL auto-cleanup

### New API Endpoints:
- `POST /auth/logout` - Logout and revoke tokens

---

## 🔒 Security Improvements Summary

| Category | Before | After |
|----------|--------|-------|
| **Password Verification** | Vulnerable to timing attacks | Constant-time comparison |
| **JWT Secret** | Random on cold start | Required environment variable |
| **Login Attempts** | Unlimited | Max 5, 15-min lockout |
| **Password Strength** | No requirements | Strong requirements enforced |
| **User Enumeration** | Possible via inactive check | Prevented |
| **Input Validation** | Inconsistent | Comprehensive sanitization |
| **Token Revocation** | Not possible | Full logout system |
| **Last Login Tracking** | Broken | Fixed and working |

---

## 🚀 Deployment Notes

### Required Environment Variables:
Ensure `JWT_SECRET` is set before deployment:
```bash
export JWT_SECRET="your-secure-secret-key-here"
```

### Database Migration:
No migration needed - new fields are optional and backward compatible.

### Testing Checklist:
- [ ] Test login with correct credentials
- [ ] Test login with incorrect credentials (verify rate limiting after 5 attempts)
- [ ] Test password registration with weak passwords (should fail)
- [ ] Test password registration with strong passwords (should succeed)
- [ ] Test OTP initiation with non-existent email (should return generic message)
- [ ] Test OTP initiation with inactive account (should return generic message)
- [ ] Test logout functionality (access token should be rejected after logout)
- [ ] Test lastLoginAt is updated on successful login

---

## 📝 Additional Recommendations

While all identified issues have been fixed, consider these future enhancements:

1. **MFA (Multi-Factor Authentication)**: Add TOTP-based 2FA for sensitive accounts
2. **Password History**: Prevent reuse of last N passwords
3. **Security Logging**: Log all authentication events to CloudWatch for audit
4. **IP-based Rate Limiting**: Add API Gateway throttling or WAF rules
5. **Session Management**: Track active sessions per user
6. **Password Expiration**: Force password changes after X days for compliance
7. **Account Recovery**: Implement secure account recovery flow

---

## ✅ All Security Issues Resolved

All 8 identified security flaws have been successfully fixed:
1. ✅ Timing attack vulnerability
2. ✅ JWT secret generation issue
3. ✅ lastLoginAt update bug
4. ✅ No login rate limiting
5. ✅ No password complexity requirements
6. ✅ User enumeration vulnerability
7. ✅ Missing input sanitization
8. ✅ No token revocation/logout

**No linter errors introduced. All code follows TypeScript best practices.**

