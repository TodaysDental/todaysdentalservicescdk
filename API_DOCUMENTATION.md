# Authentication API Documentation

## Overview

This document describes the authentication endpoints for the TodaysDentalInsights API. The system supports two authentication methods:

1. **Password-based authentication** - Traditional email/password login
2. **OTP-based authentication** - Passwordless authentication via One-Time Password sent to email

All endpoints return JSON responses and support CORS for browser-based applications.

---

## Base Configuration

- **Base URL**: `https://api.todaysdentalinsights.com` (or your API Gateway URL)
- **CORS Origin**: `https://todaysdentalinsights.com`
- **Authentication**: JWT Bearer tokens (for protected routes)

---

## Table of Contents

1. [Register User](#1-register-user)
2. [Login (Password-based)](#2-login-password-based)
3. [OTP Initiate (Passwordless)](#3-otp-initiate-passwordless)
4. [OTP Verify (Passwordless)](#4-otp-verify-passwordless)
5. [Common Response Codes](#common-response-codes)
6. [JWT Token Structure](#jwt-token-structure)

---

## 1. Register User

Creates a new user account in the system. This is an **admin-only** endpoint that requires authentication and appropriate permissions.

### Endpoint

```
POST /register
```

### Authentication Required

Yes - Requires Bearer token with one of the following roles:
- Global Super Admin
- Super Admin
- Admin (can only register users for clinics they have access to)

### Request Headers

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "givenName": "John",
  "familyName": "Doe",
  "makeGlobalSuperAdmin": false,
  "clinics": [
    {
      "clinicId": "clinic-123",
      "role": "User",
      "moduleAccess": [
        {
          "module": "chatbot",
          "permissions": ["read", "write"]
        },
        {
          "module": "analytics",
          "permissions": ["read"]
        }
      ]
    }
  ]
}
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User's email address (will be converted to lowercase) |
| `password` | string | No | User's password (optional for OTP-only users) |
| `givenName` | string | No | User's first name |
| `familyName` | string | No | User's last name |
| `makeGlobalSuperAdmin` | boolean | No | Grant Global Super Admin role (only Global Super Admins can set this) |
| `clinics` | array | No | Array of clinic assignments with roles and permissions |

#### Clinic Object Structure

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clinicId` | string/number | Yes | Unique identifier for the clinic |
| `role` | string | Yes | User role: `"User"`, `"Admin"`, or `"SuperAdmin"` |
| `moduleAccess` | array | No | Array of module-level permissions |

#### Module Access Object Structure

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `module` | string | Yes | Module name (e.g., "chatbot", "analytics", "chime") |
| `permissions` | array | Yes | Array of permissions: `["read", "write", "put", "delete"]` |

### Available Roles

- **User**: Standard user with limited permissions
- **Admin**: Can manage users within assigned clinics
- **SuperAdmin**: Full access within assigned clinics
- **GlobalSuperAdmin**: Full system access across all clinics

### Success Response (200 OK)

```json
{
  "username": "user@example.com",
  "email": "user@example.com",
  "clinicRoles": [
    {
      "clinicId": "clinic-123",
      "role": "User",
      "moduleAccess": [
        {
          "module": "chatbot",
          "permissions": ["read", "write"]
        }
      ]
    }
  ],
  "message": "User created successfully. They can now log in using OTP sent to their email."
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "error": "invalid body"
}
```

#### 403 Forbidden
```json
{
  "error": "forbidden: admin or super admin required"
}
```

```json
{
  "error": "only global super admin can grant Global super admin role"
}
```

```json
{
  "error": "no admin access for clinics: clinic-456, clinic-789"
}
```

#### 409 Conflict
```json
{
  "error": "user already exists"
}
```

#### 500 Internal Server Error
```json
{
  "error": "registration failed"
}
```

---

## 2. Login (Password-based)

Authenticates a user using email and password, returning JWT tokens for API access.

### Endpoint

```
POST /auth/login
```

### Authentication Required

No - This is a public endpoint

### Request Headers

```http
Content-Type: application/json
```

### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User's email address |
| `password` | string | Yes | User's password |

### Success Response (200 OK)

```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "user": {
    "email": "user@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "isSuperAdmin": false,
    "isGlobalSuperAdmin": false
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | string | JWT access token (valid for 1 hour) |
| `refreshToken` | string | JWT refresh token (valid for 30 days) |
| `expiresIn` | number | Access token expiration time in seconds |
| `tokenType` | string | Token type (always "Bearer") |
| `user` | object | User information |

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Missing request body"
}
```

```json
{
  "error": "Email and password are required"
}
```

```json
{
  "error": "Invalid email format"
}
```

#### 401 Unauthorized
```json
{
  "error": "Invalid email or password"
}
```

#### 403 Forbidden
```json
{
  "error": "Account is inactive"
}
```

#### 429 Too Many Requests
```json
{
  "error": "Account temporarily locked due to too many failed login attempts",
  "retryAfter": 900,
  "message": "Please try again in 15 minutes"
}
```

**Note**: After 5 failed login attempts, the account is locked for 15 minutes.

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## 3. OTP Initiate (Passwordless)

Initiates passwordless authentication by generating and sending a one-time password (OTP) to the user's email.

### Endpoint

```
POST /auth/initiate
```

### Authentication Required

No - This is a public endpoint

### Request Headers

```http
Content-Type: application/json
```

### Request Body

```json
{
  "email": "user@example.com"
}
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User's email address |

### Success Response (200 OK)

```json
{
  "message": "OTP code sent to your email",
  "email": "user@example.com",
  "expiresIn": 600
}
```

**Security Note**: For security reasons, this endpoint always returns a success response even if the email doesn't exist in the system. This prevents user enumeration attacks.

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Success message |
| `email` | string | Email address where OTP was sent |
| `expiresIn` | number | OTP expiration time in seconds (10 minutes) |

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Missing request body"
}
```

```json
{
  "error": "Email is required"
}
```

```json
{
  "error": "Invalid email format"
}
```

#### 429 Too Many Requests
```json
{
  "error": "Please wait 45 seconds before requesting a new code",
  "retryAfter": 45
}
```

**Note**: Users must wait 60 seconds between OTP requests to prevent abuse.

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

### OTP Email

The user will receive an email containing:
- A 6-digit numeric code
- Expiration time (10 minutes from generation)
- Application name and branding

---

## 4. OTP Verify (Passwordless)

Verifies the OTP code sent to the user's email and returns JWT tokens upon successful verification.

### Endpoint

```
POST /auth/verify-otp
```

### Authentication Required

No - This is a public endpoint

### Request Headers

```http
Content-Type: application/json
```

### Request Body

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User's email address |
| `code` | string | Yes | 6-digit OTP code received via email |

**Note**: The code can include spaces or dashes (e.g., "123-456" or "123 456") which will be automatically normalized.

### Success Response (200 OK)

```json
{
  "message": "OTP verified successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "user": {
    "email": "user@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "isSuperAdmin": false,
    "isGlobalSuperAdmin": false
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | string | JWT access token (valid for 1 hour) |
| `refreshToken` | string | JWT refresh token (valid for 30 days) |
| `expiresIn` | number | Access token expiration time in seconds |
| `tokenType` | string | Token type (always "Bearer") |
| `user` | object | User information |

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Missing request body"
}
```

```json
{
  "error": "Email and code are required"
}
```

#### 401 Unauthorized
```json
{
  "error": "Invalid email or code"
}
```

```json
{
  "error": "No OTP code found. Please request a new one."
}
```

```json
{
  "error": "OTP code has expired. Please request a new one."
}
```

```json
{
  "error": "Invalid code",
  "remainingAttempts": 2
}
```

#### 403 Forbidden
```json
{
  "error": "Account is inactive"
}
```

#### 429 Too Many Requests
```json
{
  "error": "Too many failed attempts. Please request a new code.",
  "maxAttempts": 5
}
```

**Note**: Users have 5 attempts to enter the correct OTP code before it becomes invalid.

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## Common Response Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Success |
| `400` | Bad Request - Invalid input data |
| `401` | Unauthorized - Invalid credentials or token |
| `403` | Forbidden - Insufficient permissions or inactive account |
| `409` | Conflict - Resource already exists |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error - Server-side error |

---

## JWT Token Structure

### Access Token

JWT tokens are signed using HS256 algorithm and contain minimal payload to support enterprise scale (1000+ clinics per user).

**Header**:
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload**:
```json
{
  "sub": "user@example.com",
  "email": "user@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "isSuperAdmin": false,
  "isGlobalSuperAdmin": false,
  "type": "access",
  "iss": "TodaysDentalInsights",
  "aud": "api.todaysdentalinsights.com",
  "iat": 1701234567,
  "exp": 1701238167
}
```

### Important Notes

- **Clinic Roles Not Included**: For performance reasons, clinic roles and module permissions are NOT included in JWT tokens. They are fetched from DynamoDB/cache by the Lambda authorizer during API requests.
- **Access Token Expiry**: 1 hour
- **Refresh Token Expiry**: 30 days
- **Token Size**: ~300 bytes (constant regardless of clinic count)

### Token Claims

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | string | Subject - user's email |
| `email` | string | User's email address |
| `givenName` | string | User's first name |
| `familyName` | string | User's last name |
| `isSuperAdmin` | boolean | Whether user is a super admin |
| `isGlobalSuperAdmin` | boolean | Whether user is a global super admin |
| `type` | string | Token type: "access" or "refresh" |
| `iss` | string | Issuer: "TodaysDentalInsights" |
| `aud` | string | Audience: "api.todaysdentalinsights.com" |
| `iat` | number | Issued at (Unix timestamp) |
| `exp` | number | Expiration time (Unix timestamp) |

---

## Using JWT Tokens

### Making Authenticated Requests

Include the access token in the `Authorization` header:

```http
GET /api/resource HTTP/1.1
Host: api.todaysdentalinsights.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

### JavaScript Example

```javascript
// After login/OTP verification
const { accessToken } = response.data;

// Make authenticated request
fetch('https://api.todaysdentalinsights.com/api/resource', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### Token Refresh

When the access token expires (after 1 hour), use the refresh token to obtain a new access token:

```javascript
fetch('https://api.todaysdentalinsights.com/auth/refresh', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    refreshToken: refreshToken
  })
})
.then(response => response.json())
.then(data => {
  // Store new access token
  const { accessToken } = data;
})
.catch(error => console.error('Error:', error));
```

---

## Security Best Practices

### Password Requirements

When setting passwords during registration:
- Minimum 8 characters recommended
- Mix of uppercase, lowercase, numbers, and special characters recommended
- Passwords are hashed using PBKDF2 with 10,000 iterations and SHA-512

### Rate Limiting

The API implements rate limiting to prevent abuse:

1. **Login Attempts**: Maximum 5 failed attempts, then 15-minute lockout
2. **OTP Requests**: Minimum 60 seconds between requests
3. **OTP Verification**: Maximum 5 attempts per OTP code

### OTP Security

- OTP codes are 6 digits
- Valid for 10 minutes
- Single-use (cleared after successful verification)
- Constant-time comparison to prevent timing attacks

### Token Security

- Store tokens securely (httpOnly cookies or secure storage)
- Never expose tokens in URLs or logs
- Always use HTTPS in production
- Tokens are signed with HS256 and verified on every request
- JWT_SECRET must be set in environment variables

---

## Complete Authentication Flow Examples

### Example 1: Password-based Login

```javascript
// 1. Login with email and password
const loginResponse = await fetch('https://api.todaysdentalinsights.com/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePassword123!'
  })
});

const { accessToken, refreshToken, user } = await loginResponse.json();

// 2. Store tokens securely
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);

// 3. Make authenticated requests
const dataResponse = await fetch('https://api.todaysdentalinsights.com/api/data', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});
```

### Example 2: OTP-based Login (Passwordless)

```javascript
// 1. Request OTP code
const initiateResponse = await fetch('https://api.todaysdentalinsights.com/auth/initiate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com'
  })
});

const { message } = await initiateResponse.json();
console.log(message); // "OTP code sent to your email"

// 2. User receives email with 6-digit code
// 3. Verify OTP code
const verifyResponse = await fetch('https://api.todaysdentalinsights.com/auth/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    code: '123456'
  })
});

const { accessToken, refreshToken, user } = await verifyResponse.json();

// 4. Store tokens and make authenticated requests
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

### Example 3: Admin Creating New User

```javascript
// 1. Admin must be logged in first
const accessToken = localStorage.getItem('accessToken');

// 2. Register new user
const registerResponse = await fetch('https://api.todaysdentalinsights.com/register', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'newuser@example.com',
    password: 'SecurePassword123!',
    givenName: 'Jane',
    familyName: 'Smith',
    clinics: [
      {
        clinicId: 'clinic-123',
        role: 'User',
        moduleAccess: [
          {
            module: 'chatbot',
            permissions: ['read', 'write']
          },
          {
            module: 'analytics',
            permissions: ['read']
          }
        ]
      }
    ]
  })
});

const result = await registerResponse.json();
console.log(result.message); // "User created successfully..."
```

---

## Error Handling Best Practices

```javascript
async function loginUser(email, password) {
  try {
    const response = await fetch('https://api.todaysdentalinsights.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      
      switch (response.status) {
        case 400:
          throw new Error('Invalid input: ' + error.error);
        case 401:
          throw new Error('Invalid email or password');
        case 403:
          throw new Error('Account is inactive. Please contact support.');
        case 429:
          throw new Error(`Too many attempts. ${error.message}`);
        case 500:
          throw new Error('Server error. Please try again later.');
        default:
          throw new Error('An unexpected error occurred');
      }
    }

    return await response.json();
  } catch (error) {
    console.error('Login failed:', error);
    // Show error to user
    throw error;
  }
}
```

---

## Support

For additional support or questions about the API:
- **Email**: support@todaysdentalinsights.com
- **Documentation**: https://docs.todaysdentalinsights.com

---

## Changelog

### Version 1.0.0 (Current)
- Initial API documentation
- Password-based authentication
- OTP-based passwordless authentication
- User registration with role-based access control
- JWT token system with minimal payload for enterprise scale

