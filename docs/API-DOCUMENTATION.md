# TodaysDentalInsights API Documentation

## Overview

This document provides comprehensive API documentation for the TodaysDentalInsights platform, built on a **Core Infrastructure Stack** that provides authentication, authorization, and shared services. The platform includes stacks for **Auth**, **Callback**, **Templates**, **Analytics**, **Chatbot**, **Chime**, **Clinic Hours**, **Clinic Insurance**, **Clinic Pricing**, **Communication**, **Consent Form Data**, and **Queries**.

**Base URL:** `https://apig.todaysdentalinsights.com`

---

## Table of Contents

0. [Core Infrastructure Stack](#0-core-infrastructure-stack)
1. [Authentication Stack (Auth)](#1-authentication-stack-auth)
2. [Registration Stack (Admin)](#2-registration-stack-admin)
3. [Callback Stack](#3-callback-stack)
4. [Templates Stack](#4-templates-stack)
5. [Analytics Stack](#5-analytics-stack)
6. [Chatbot Stack](#6-chatbot-stack)
7. [Chime Stack (Voice/Call Center)](#7-chime-stack-voicecall-center)
8. [Clinic Hours Stack](#8-clinic-hours-stack)
9. [Clinic Insurance Stack](#9-clinic-insurance-stack)
10. [Clinic Pricing Stack](#10-clinic-pricing-stack)
11. [Communication Stack (WebSocket)](#11-communication-stack-websocket)
12. [Consent Form Data Stack](#12-consent-form-data-stack)
13. [Queries Stack](#13-queries-stack)
14. [Common Response Codes](#14-common-response-codes)
15. [Security & Rate Limiting](#15-security--rate-limiting)
16. [Data Models](#16-data-models)

---

## 0. Core Infrastructure Stack

The Core Infrastructure Stack provides the foundational components for the entire TodaysDentalInsights platform, including authentication, authorization, and shared data storage.

### Key Components

#### Custom Lambda Authorizer
- **Function:** Validates JWT tokens and enforces API access control
- **Caching:** 5-minute in-memory cache for user permissions
- **Integration:** Fetches current user permissions from DynamoDB on each request
- **Security:** Checks token blacklists and user account status

#### DynamoDB Tables
- **StaffUser:** User profiles, roles, and permissions
- **StaffClinicInfo:** Clinic-specific user information
- **TokenBlacklist:** Revoked authentication tokens (TTL-enabled)

#### Authentication API
- **Base Path:** `/auth`
- **Endpoints:** OTP initiation, verification, token refresh, and logout
- **Security:** Email-based OTP authentication with rate limiting

#### Custom Domain
- **Domain:** `apig.todaysdentalinsights.com`
- **SSL:** AWS Certificate Manager certificate
- **DNS:** Route53 hosted zone integration

### Infrastructure Outputs
- `AuthorizerFunctionArn`: Lambda authorizer for cross-stack reference
- `StaffUserTableName`: User data table for permission queries
- `ApiDomainName`: Custom domain for API endpoints

---

## 1. Authentication Stack (Auth)

The Auth stack handles user authentication using OTP (One-Time Password) flow via email. All auth endpoints are **public** (no authorization required).

**Base Path:** `/auth`

---

### 1.1 Initiate OTP

Initiates the OTP authentication flow by sending a 6-digit code to the user's email.

**Endpoint:** `POST /auth/initiate`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's registered email address |

**Success Response (200):**
```json
{
  "message": "OTP code sent to your email",
  "email": "user@example.com",
  "expiresIn": 600
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| message | string | Success message |
| email | string | Email where OTP was sent |
| expiresIn | number | OTP expiration time in seconds (10 minutes) |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing request body` | No request body provided |
| 400 | `Email is required` | Email field is missing |
| 400 | `Invalid email format` | Email format validation failed |
| 429 | `Please wait X seconds before requesting a new code` | Rate limit exceeded (60 second cooldown) |
| 500 | `Internal server error` | Server-side error |

> **Security Note:** For security reasons, this endpoint always returns 200 for valid email formats, even if the user doesn't exist. This prevents user enumeration attacks.

---

### 1.2 Verify OTP

Validates the OTP code and returns JWT access and refresh tokens.

**Endpoint:** `POST /auth/verify`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address |
| code | string | Yes | 6-digit OTP code from email |

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "email": "user@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "clinicRoles": [
      {
        "clinicId": "clinic-123",
        "role": "Admin",
        "basePay": 75000,
        "hourlyPay": 35,
        "moduleAccess": [
          { "module": "HR", "permissions": ["read", "write"] }
        ]
      }
    ],
    "isSuperAdmin": false,
    "isGlobalSuperAdmin": false,
    "emailVerified": true
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| accessToken | string | JWT access token (expires in 1 hour) |
| refreshToken | string | JWT refresh token (expires in 30 days) |
| expiresIn | number | Access token expiration in seconds |
| user | object | User profile information |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing request body` | No request body provided |
| 400 | `Email and code are required` | Missing required fields |
| 401 | `Invalid email or code` | User not found |
| 401 | `No OTP code found. Please request a new one.` | No pending OTP |
| 401 | `OTP code has expired. Please request a new one.` | OTP expired (10 min) |
| 401 | `Invalid code` | Wrong OTP code |
| 403 | `Account is inactive` | User account is deactivated |
| 429 | `Too many failed attempts. Please request a new code.` | Max 5 attempts exceeded |
| 500 | `Internal server error` | Server-side error |

---

### 1.3 Refresh Token

Exchanges a valid refresh token for new access and refresh tokens.

**Endpoint:** `POST /auth/refresh`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| refreshToken | string | Yes | Valid refresh token |

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "email": "user@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "clinicRoles": [
      {
        "clinicId": "clinic-123",
        "role": "Admin",
        "basePay": 75000,
        "hourlyPay": 35,
        "moduleAccess": [
          { "module": "HR", "permissions": ["read", "write"] }
        ]
      }
    ],
    "isSuperAdmin": false,
    "isGlobalSuperAdmin": false,
    "emailVerified": true
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| accessToken | string | JWT access token (expires in 1 hour) |
| refreshToken | string | JWT refresh token (expires in 30 days) |
| expiresIn | number | Access token expiration in seconds |
| user | object | User profile information (same as auth/verify) |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing request body` | No request body provided |
| 400 | `Refresh token is required` | Token field is missing |
| 401 | `Invalid token type` | Not a refresh token |
| 401 | `User not found` | User no longer exists |
| 401 | `Invalid or expired refresh token` | Token validation failed |
| 403 | `Account is inactive` | User account is deactivated |
| 500 | `Internal server error` | Server-side error |

---

### 1.4 Logout

Invalidates the user's tokens and adds them to a blacklist.

**Endpoint:** `POST /auth/logout`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Optional | `Bearer <accessToken>` |

**Request Body (Optional):**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**
```json
{
  "message": "Successfully logged out",
  "success": true
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 500 | `Internal server error` | Server-side error |

> **Note:** Logout is designed to be graceful - it will succeed even if tokens are already expired or invalid.

---

## 2. Registration Stack (Admin)

The Admin stack handles user registration and management. All endpoints require **admin authorization**.

**Base Path:** `/admin`

---

### 2.1 Register User

Creates a new user account with clinic-specific role assignments.

**Endpoint:** `POST /admin/register`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization Requirements:**
- Caller must have `Admin`, `SuperAdmin`, or `Global super admin` role
- Non-global admins can only register users for clinics they have access to
- Only `Global super admin` can create other global super admins

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "SecureP@ssw0rd!",
  "givenName": "John",
  "familyName": "Doe",
  "clinics": [
    {
      "clinicId": "clinic-123",
      "role": "Office Manager",
      "basePay": 65000,
      "hourlyPay": 30,
      "workLocation": {
        "isRemote": false,
        "isOnPremise": true
      },
      "openDentalUserNum": 42,
      "openDentalUsername": "jdoe",
      "employeeNum": 1001,
      "moduleAccess": [
        { "module": "Operations", "permissions": ["read", "write", "put"] },
        { "module": "HR", "permissions": ["read"] }
      ]
    }
  ],
  "makeGlobalSuperAdmin": false
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address (becomes username) |
| password | string | No | Password (optional for OTP-only users) |
| givenName | string | No | User's first name |
| familyName | string | No | User's last name |
| clinics | array | Yes* | Clinic role assignments (*not required if `makeGlobalSuperAdmin` is true) |
| makeGlobalSuperAdmin | boolean | No | Create as global super admin |

**Clinic Assignment Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |
| role | string | Yes | User role (see [Available Roles](#user-roles)) |
| basePay | number | No | Annual base pay in dollars |
| hourlyPay | number | No | Hourly pay rate |
| workLocation | object | No | Remote/on-premise configuration |
| openDentalUserNum | number | No | Open Dental user number |
| openDentalUsername | string | No | Open Dental username |
| employeeNum | number | No | Employee number |
| moduleAccess | array | No | Per-module permissions |

**Password Requirements (if provided):**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Cannot be common passwords (password123, qwerty, etc.)

**Success Response (200):**
```json
{
  "success": true,
  "username": "newuser@example.com",
  "email": "newuser@example.com",
  "clinicRoles": [
    {
      "clinicId": "clinic-123",
      "role": "Office Manager",
      "basePay": 65000,
      "hourlyPay": 30,
      "moduleAccess": [
        { "module": "Operations", "permissions": ["read", "write", "put"] }
      ]
    }
  ],
  "message": "User created successfully. They can now log in using OTP sent to their email."
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `email is required` | Missing email field |
| 400 | `invalid email format` | Email validation failed |
| 400 | `password must be at least 8 characters long` | Password too short |
| 400 | `clinics array is required for non-global users` | Missing clinic assignments |
| 400 | `clinicId is required for each clinic mapping` | Missing clinic ID |
| 400 | `role is required for each clinic mapping` | Missing role |
| 400 | `invalid role: X` | Invalid role value |
| 400 | `invalid module: X` | Invalid module name |
| 400 | `invalid permission: X` | Invalid permission type |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 403 | `only global super admin can grant Global super admin role` | Cannot create global admin |
| 403 | `no admin access for clinics: X` | No access to specified clinics |
| 409 | `user already exists` | Email already registered |
| 500 | `registration failed` | Server-side error |

---

### 2.2 Get Current User (Self)

Retrieves the authenticated user's own profile information.

**Endpoint:** `GET /admin/users/self`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization:** Any authenticated user can access their own profile.

**Success Response (200):**
```json
{
  "email": "user@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "clinicRoles": [
    {
      "clinicId": "clinic-123",
      "role": "Office Manager",
      "moduleAccess": [
        { "module": "Operations", "permissions": ["read", "write"] }
      ]
    }
  ],
  "isSuperAdmin": false,
  "isGlobalSuperAdmin": false,
  "isActive": true,
  "staffDetails": [...],
  "rolesByClinic": { "clinic-123": { ... } }
}
```

---

### 2.3 List Users

Lists all users (admin only). Non-global admins only see users from clinics they have access to.

**Endpoint:** `GET /admin/users`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization:** Requires `Admin`, `SuperAdmin`, or `Global super admin` role.

**Success Response (200):**
```json
{
  "users": [
    {
      "email": "user@example.com",
      "givenName": "John",
      "familyName": "Doe",
      "clinicRoles": [...],
      "isSuperAdmin": false,
      "isGlobalSuperAdmin": false,
      "isActive": true,
      "staffDetails": [...],
      "rolesByClinic": { ... }
    }
  ]
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 500 | `internal server error` | Server-side error |

---

### 2.4 Get User by Username

Retrieves a specific user's details (admin only).

**Endpoint:** `GET /admin/users/{username}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| username | string | User's email address (URL encoded) |

**Authorization:** 
- Requires `Admin`, `SuperAdmin`, or `Global super admin` role
- Non-global admins can only view users from clinics they have access to

**Success Response (200):**
```json
{
  "email": "user@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "clinicRoles": [...],
  "isSuperAdmin": false,
  "isGlobalSuperAdmin": false,
  "isActive": true,
  "staffDetails": [...],
  "rolesByClinic": { ... }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 403 | `no access to this user` | User not in caller's clinics |
| 404 | `user not found` | User doesn't exist |
| 500 | `internal server error` | Server-side error |

---

### 2.5 Update User

Updates an existing user's information (admin only).

**Endpoint:** `PUT /admin/users/{username}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| username | string | User's email address (URL encoded) |

**Authorization:** 
- Requires `Admin`, `SuperAdmin`, or `Global super admin` role
- Non-global admins can only update users from clinics they have access to
- Only `Global super admin` can grant global super admin role

**Request Body:**
```json
{
  "givenName": "John",
  "familyName": "Doe",
  "clinicRoles": [
    {
      "clinicId": "clinic-123",
      "role": "Office Manager",
      "moduleAccess": [
        { "module": "Operations", "permissions": ["read", "write", "put"] }
      ]
    }
  ],
  "isActive": true,
  "password": "NewSecureP@ssw0rd!",
  "makeGlobalSuperAdmin": false
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| givenName | string | No | Updated first name |
| familyName | string | No | Updated last name |
| clinicRoles | array | No | Updated clinic role assignments |
| isActive | boolean | No | Account active status |
| password | string | No | New password (will be hashed) |
| makeGlobalSuperAdmin | boolean | No | Grant global super admin role |

**Success Response (200):**
```json
{
  "success": true,
  "user": {
    "email": "user@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "clinicRoles": [...],
    "isActive": true
  }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 403 | `no access to update this user` | User not in caller's clinics |
| 403 | `only global super admin can grant Global super admin role` | Cannot grant global admin |
| 403 | `no admin access for clinics: X` | Cannot assign to unauthorized clinics |
| 404 | `user not found` | User doesn't exist |
| 500 | `internal server error` | Server-side error |

---

### 2.6 Delete User

Deactivates a user account (admin only).

**Endpoint:** `DELETE /admin/users/{username}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| username | string | User's email address (URL encoded) |

**Authorization:** 
- Requires `Admin`, `SuperAdmin`, or `Global super admin` role
- Non-global admins can only delete users from clinics they have access to
- Only `Global super admin` can delete other global super admins

**Success Response (200):**
```json
{
  "success": true,
  "message": "user deleted"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 403 | `no access to delete this user` | User not in caller's clinics |
| 403 | `only global super admin can delete global super admin users` | Cannot delete global admin |
| 404 | `user not found` | User doesn't exist |
| 500 | `internal server error` | Server-side error |

---

### 2.7 Directory Lookup

Lists all active users for selection in UI components (any authenticated user).

**Endpoint:** `GET /admin/directory`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| nextToken | string | No | Pagination token for next page |

**Authorization:** Any authenticated user.

**Success Response (200):**
```json
{
  "items": [
    {
      "userID": "user@example.com",
      "email": "user@example.com",
      "givenName": "John",
      "familyName": "Doe"
    }
  ],
  "nextToken": "eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ=="
}
```

---

### 2.8 List Favor Requests

Lists favor requests for the authenticated user (sent/received/all).

**Endpoint:** `GET /admin/requests`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| role | string | No | Filter: `sent`, `received`, or `all` (default: `all`) |
| limit | number | No | Max results per page (default: 20) |
| nextToken | string | No | Pagination token |

**Authorization:** Any authenticated user.

**Success Response (200):**
```json
{
  "role": "all",
  "items": [
    {
      "favorRequestID": "550e8400-e29b-41d4-a716-446655440000",
      "senderID": "sender@example.com",
      "receiverID": "receiver@example.com",
      "status": "pending",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "nextToken": "eyJmYXZvclJlcXVlc3RJRCI6IjU1MGU4NDAwLi4uIn0="
}
```

---

## 3. Callback Stack

The Callback stack manages customer callback requests for clinics. POST is **public** (for website forms); GET and PUT require **authorization**.

**Base Path:** `/callback`

---

### 3.1 Create Callback Request

Creates a new callback request (public endpoint for website contact forms).

**Endpoint:** `POST /callback/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Clinic identifier |

**Request Body:**
```json
{
  "name": "Jane Smith",
  "phone": "+1234567890",
  "email": "jane.smith@example.com",
  "message": "I'd like to schedule a dental cleaning appointment.",
  "module": "Operations",
  "source": "website"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Customer's full name |
| phone | string | Yes | Phone number (validated format) |
| email | string | No | Customer's email address |
| message | string | No | Additional notes or request details |
| module | string | No | Department module (default: `Operations`) |
| source | string | No | Request source (default: `website`) |

**Available Modules:** `HR`, `Accounting`, `Operations`, `Finance`, `Marketing`, `Insurance`, `IT`

**Success Response (201):**
```json
{
  "message": "Callback request created successfully",
  "contact": {
    "RequestID": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Jane Smith",
    "phone": "+1234567890",
    "email": "jane.smith@example.com",
    "message": "I'd like to schedule a dental cleaning appointment.",
    "clinicId": "clinic-123",
    "module": "Operations",
    "calledBack": "NO",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "source": "website"
  }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId is required in path` | Missing clinic ID |
| 400 | `Both name and phone are required.` | Missing required fields |
| 400 | `Invalid phone number format.` | Phone validation failed |
| 400 | `Invalid email format.` | Email validation failed |
| 400 | `Invalid module: X` | Invalid module value |
| 409 | `Callback request with this ID already exists.` | Duplicate request |
| 500 | `Internal server error` | Server-side error |

---

### 3.2 List Callback Requests

Retrieves callback requests for a clinic, filtered by user's module permissions.

**Endpoint:** `GET /callback/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Clinic identifier |

**Success Response (200):**
```json
{
  "callbacks": [
    {
      "RequestID": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Jane Smith",
      "phone": "+1234567890",
      "email": "jane.smith@example.com",
      "message": "Appointment inquiry",
      "clinicId": "clinic-123",
      "module": "Operations",
      "calledBack": "NO",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "source": "website"
    }
  ],
  "callbacksByModule": {
    "Operations": [...],
    "HR": [...]
  },
  "totalCount": 25
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| callbacks | array | List of callback requests (filtered by user's permissions) |
| callbacksByModule | object | Callbacks grouped by module |
| totalCount | number | Total number of callbacks user has access to |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId is required in path` | Missing clinic ID |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Forbidden: no access to this clinic` | User lacks clinic access |
| 500 | `Internal server error` | Server-side error |

---

### 3.3 Update Callback Request

Updates an existing callback request (mark as called, add notes, etc.).

**Endpoint:** `PUT /callback/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Clinic identifier |

**Request Body:**
```json
{
  "RequestID": "550e8400-e29b-41d4-a716-446655440000",
  "calledBack": "YES",
  "notes": "Scheduled appointment for next Tuesday at 2pm",
  "module": "Operations"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| RequestID | string | Yes | Callback request ID |
| calledBack | string/boolean | No | Status: `YES`/`NO` or `true`/`false` |
| notes | string | No | Internal notes |
| name | string | No | Updated customer name |
| phone | string | No | Updated phone number |
| email | string | No | Updated email |
| message | string | No | Updated message |
| module | string | No | Updated module |

**Success Response (200):**
```json
{
  "message": "Updated"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId is required in path` | Missing clinic ID |
| 400 | `RequestID is required for updates.` | Missing request ID |
| 400 | `Nothing to update.` | No update fields provided |
| 400 | `Invalid module: X` | Invalid module value |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Forbidden: no access to this clinic` | User lacks clinic access |
| 403 | `You do not have permission to update callbacks in the X module` | Module permission denied |
| 500 | `Internal server error` | Server-side error |

---

### 3.4 Admin: List All Callbacks

Lists callbacks across clinics (admin only).

**Endpoint:** `GET /callback/admin/callbacks`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | No | Filter by specific clinic |
| limit | number | No | Max results (default: 50, max: 100) |

**Authorization:** Requires `Admin`, `SuperAdmin`, or `Global super admin` role.

**Success Response (200):**
```json
{
  "contacts": [...],
  "clinicId": "clinic-123",
  "count": 15
}
```

---

### 3.5 Admin: Bulk Operations

Performs bulk operations on callbacks (admin only).

**Endpoint:** `POST /callback/admin/callbacks/bulk`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "operation": "markCalled",
  "clinicId": "clinic-123",
  "requestIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660f9511-f3ac-52e5-b827-557766551111"
  ]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| operation | string | Yes | Operation type: `markCalled`, `delete` |
| clinicId | string | Yes | Target clinic ID |
| requestIds | array | Yes | List of callback request IDs |

**Success Response (200):**
```json
{
  "message": "Bulk update completed: 2/2 successful",
  "results": [
    { "id": "550e8400...", "status": "success" },
    { "id": "660f9511...", "status": "success" }
  ]
}
```

---

## 4. Templates Stack

The Templates stack manages email and text message templates for clinics, organized by system modules. All endpoints require **authorization**.

**Base Path:** `/templates`

---

### 4.1 List Templates

Retrieves all templates the user has access to, filtered by module permissions.

**Endpoint:** `GET /templates`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Success Response (200):**
```json
{
  "templates": [
    {
      "template_id": "550e8400-e29b-41d4-a716-446655440000",
      "template_name": "Appointment Reminder",
      "module": "Operations",
      "email_subject": "Reminder: Your Upcoming Appointment",
      "email_body": "Dear {{patient_name}}, this is a reminder of your appointment on {{date}} at {{time}}.",
      "text_message": "Reminder: Appointment on {{date}} at {{time}}. Reply CONFIRM or call us.",
      "created_at": "2024-01-15T10:30:00.000Z",
      "modified_at": "2024-01-20T15:45:00.000Z",
      "modified_by": "John Doe",
      "clinic_id": "clinic-123"
    }
  ],
  "templatesByModule": {
    "Operations": [...],
    "HR": [...]
  },
  "accessibleModules": ["Operations", "HR", "Marketing"],
  "totalCount": 15
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| templates | array | List of templates (filtered by user's module permissions) |
| templatesByModule | object | Templates grouped by module |
| accessibleModules | array | Modules user has access to |
| totalCount | number | Total number of templates user can access |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 500 | `Internal Server Error` | Server-side error |

---

### 4.2 Create Template

Creates a new template in a specific module.

**Endpoint:** `POST /templates`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization Requirements:**
- User must have `write` permission for the specified module
- Admin, SuperAdmin, and Global Super Admin have permission for all modules

**Request Body:**
```json
{
  "template_name": "New Patient Welcome",
  "module": "Operations",
  "email_subject": "Welcome to Our Dental Practice!",
  "email_body": "Dear {{patient_name}},\n\nWelcome to {{clinic_name}}! We're excited to have you as a new patient.",
  "text_message": "Welcome to {{clinic_name}}! We look forward to seeing you.",
  "clinic_id": "clinic-123"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| template_name | string | Yes | Template name/title |
| module | string | Yes | System module (see [System Modules](#system-modules)) |
| email_subject | string | No | Email subject line |
| email_body | string | Yes | Email body content (supports placeholders) |
| text_message | string | No | SMS/text message content |
| clinic_id | string | No | Optional clinic-specific template |

**Available Modules:** `HR`, `Accounting`, `Operations`, `Finance`, `Marketing`, `Insurance`, `IT`

**Success Response (201):**
```json
{
  "template_id": "550e8400-e29b-41d4-a716-446655440000",
  "module": "Operations",
  "message": "Template created successfully"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Template name and email body are required` | Missing required fields |
| 400 | `Module is required` | Missing module field |
| 400 | `Invalid module: X` | Invalid module value |
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 403 | `You do not have permission to create templates in the X module` | Insufficient module permission |
| 500 | `Internal Server Error` | Server-side error |

---

### 4.3 Update Template

Updates an existing template.

**Endpoint:** `PUT /templates/{templateId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| templateId | string | Template UUID |

**Authorization Requirements:**
- User must have `put` permission for the template's module
- Admin, SuperAdmin, and Global Super Admin have permission for all modules

**Request Body:**
```json
{
  "template_name": "Updated Template Name",
  "module": "Operations",
  "email_subject": "Updated Subject",
  "email_body": "Updated email body content.",
  "text_message": "Updated text message.",
  "clinic_id": "clinic-123",
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| template_name | string | Yes | Template name/title |
| module | string | Yes | System module |
| email_subject | string | No | Email subject line |
| email_body | string | Yes | Email body content |
| text_message | string | No | SMS/text message content |
| clinic_id | string | No | Optional clinic-specific template |
| created_at | string | No | Preserve original creation timestamp |

**Success Response (200):**
```json
{
  "template_id": "550e8400-e29b-41d4-a716-446655440000",
  "module": "Operations",
  "message": "Template updated successfully"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Template name and email body are required` | Missing required fields |
| 400 | `Invalid module: X` | Invalid module value |
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 403 | `You do not have permission to update templates in the X module` | Insufficient module permission |
| 500 | `Internal Server Error` | Server-side error |

---

### 4.4 Delete Template

Deletes an existing template.

**Endpoint:** `DELETE /templates/{templateId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| templateId | string | Template UUID |

**Authorization Requirements:**
- User must have `delete` permission for the template's module
- Admin, SuperAdmin, and Global Super Admin have permission for all modules

**Success Response (200):**
```json
{
  "message": "Template deleted successfully",
  "template_id": "550e8400-e29b-41d4-a716-446655440000",
  "module": "Operations"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 403 | `You do not have permission to delete templates in the X module` | Insufficient module permission |
| 404 | `Template not found` | Template does not exist |
| 500 | `Internal Server Error` | Server-side error |

---

## 5. Analytics Stack

The Analytics stack provides call analytics and metrics for monitoring call center performance. All endpoints require authentication and clinic-based authorization.

**Base Path:** `/admin/analytics`

---

### 5.1 Get Call Analytics

Retrieves analytics for a specific call by its ID.

**Endpoint:** `GET /admin/analytics/call/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| callId | string | Yes | Unique call identifier |

**Success Response (200):**
```json
{
  "callId": "call-abc-123",
  "clinicId": "clinic-456",
  "agentId": "agent@example.com",
  "timestamp": 1701388800,
  "callStartTime": "2024-12-01T12:00:00Z",
  "callEndTime": "2024-12-01T12:15:00Z",
  "totalDuration": 900,
  "overallSentiment": "POSITIVE",
  "callCategory": "appointment",
  "speakerMetrics": {
    "agentTalkPercentage": 45,
    "customerTalkPercentage": 55
  },
  "audioQuality": {
    "qualityScore": 0.95
  },
  "detectedIssues": [],
  "finalized": true,
  "etag": "Y2FsbC1hYmMtMTIzLTE3MDEzODg4MDA="
}
```

**Response Headers:**
| Header | Description |
|--------|-------------|
| ETag | Content version for caching |
| Cache-Control | `public, max-age=3600` for completed calls |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing callId parameter` | Call ID not provided |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Unauthorized` | User lacks access to the call's clinic |
| 404 | `Call analytics not found` | No analytics for this call |

---

### 5.2 Get Live Call Analytics

Retrieves real-time analytics for an active/ongoing call.

**Endpoint:** `GET /admin/analytics/live?callId={callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| callId | string | Yes | Unique call identifier |

**Success Response (200) - Active Call:**
```json
{
  "callId": "call-abc-123",
  "clinicId": "clinic-456",
  "analyticsState": "ACTIVE",
  "isLive": true,
  "activeSeconds": 245,
  "lastUpdatedSeconds": 2,
  "speakerMetrics": {
    "agentTalkPercentage": 42
  },
  "overallSentiment": "NEUTRAL",
  "fetchedAt": 1701388800000,
  "etag": "Y2FsbC1hYmMtMTIzLTE3MDEzODg4MDA="
}
```

**Success Response (200) - Finalizing:**
```json
{
  "callId": "call-abc-123",
  "status": "finalizing",
  "message": "Call has ended and is being finalized. Check back shortly for complete analytics.",
  "estimatedReadyIn": 30,
  "isLive": false,
  "isFinalizing": true
}
```

**Success Response (200) - Finalized:**
```json
{
  "status": "finalized",
  "message": "Call has been finalized. Use GET /analytics/call/{callId} for complete analytics.",
  "callId": "call-abc-123",
  "isCompleted": true,
  "redirectTo": "/analytics/call/call-abc-123"
}
```

**Response Headers:**
| Header | Description |
|--------|-------------|
| ETag | Content version for conditional polling |
| Cache-Control | `no-cache, must-revalidate` |
| X-Last-Updated | ISO timestamp of last update |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing callId query parameter` | Call ID not provided |
| 400 | `STALE_CALL_DATA` | Call appears inactive for >4 hours |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Unauthorized` | User lacks access to the call's clinic |
| 404 | `Call analytics not found` | No analytics for this call |

---

### 5.3 Get Clinic Analytics

Retrieves analytics for all calls within a clinic for a time range.

**Endpoint:** `GET /admin/analytics/clinic/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Target clinic identifier |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| startTime | number | No | 24 hours ago | Start timestamp (epoch seconds) |
| endTime | number | No | Now | End timestamp (epoch seconds) |
| limit | number | No | 100 | Max results per page (max 100) |
| lastEvaluatedKey | string | No | - | Pagination token |
| sentiment | string | No | - | Filter by sentiment (POSITIVE, NEGATIVE, NEUTRAL, MIXED) |
| category | string | No | - | Filter by call category |
| minDuration | number | No | - | Minimum call duration in seconds |
| hasIssues | boolean | No | - | Filter for calls with detected issues |

**Success Response (200):**
```json
{
  "clinicId": "clinic-456",
  "startTime": 1701302400,
  "endTime": 1701388800,
  "totalCalls": 50,
  "calls": [
    {
      "callId": "call-abc-123",
      "timestamp": 1701388800,
      "agentId": "agent@example.com",
      "totalDuration": 900,
      "overallSentiment": "POSITIVE",
      "callCategory": "appointment"
    }
  ],
  "hasMore": true,
  "lastEvaluatedKey": "eyJjbGluaWNJZCI6ImNsaW5pYy00NTYiLCJ0aW1lc3RhbXAiOjE3MDEzMDI0MDB9"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing clinicId parameter` | Clinic ID not provided |
| 400 | `INVALID_TIME_FORMAT` | Invalid timestamp format |
| 400 | `INVALID_TIME_RANGE` | startTime >= endTime |
| 400 | `TIME_RANGE_TOO_OLD` | Start time >1 year ago |
| 400 | `TIME_RANGE_TOO_LARGE` | Range exceeds 90 days |
| 400 | `INVALID_PAGINATION_TOKEN` | Malformed or tampered token |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Unauthorized` | User lacks access to clinic |

---

### 5.4 Get Agent Analytics

Retrieves analytics and performance metrics for a specific agent.

**Endpoint:** `GET /admin/analytics/agent/{agentId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agentId | string | Yes | Agent's email address |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| startTime | number | No | 7 days ago | Start timestamp (epoch seconds) |
| endTime | number | No | Now | End timestamp (epoch seconds) |
| limit | number | No | 100 | Max results per page (max 100) |
| lastEvaluatedKey | string | No | - | Pagination token |

**Success Response (200):**
```json
{
  "agentId": "agent@example.com",
  "startTime": 1700784000,
  "endTime": 1701388800,
  "callsInPage": 25,
  "totalCalls": 150,
  "metrics": {
    "page": {
      "averageDuration": 420,
      "averageTalkPercentage": 45,
      "sentimentBreakdown": {
        "POSITIVE": 15,
        "NEUTRAL": 8,
        "NEGATIVE": 2
      },
      "categoryBreakdown": {
        "appointment": 18,
        "inquiry": 5,
        "billing": 2
      },
      "issuesDetected": 3,
      "averageQualityScore": 0.92,
      "weightedSentimentScore": 72,
      "_isPageLevel": true
    },
    "total": {
      "totalCalls": 150,
      "averageDuration": 415,
      "weightedSentimentScore": 68,
      "_isComplete": true
    }
  },
  "calls": [],
  "pagination": {
    "hasMore": true,
    "lastEvaluatedKey": "...",
    "isPaginated": true
  }
}
```

**Authorization:**
- Users can view their own analytics
- Admins can view analytics for agents in their authorized clinics
- Super Admins can view all agent analytics

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing agentId parameter` | Agent ID not provided |
| 400 | `INVALID_PAGINATION_TOKEN` | Malformed or tampered token |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `INSUFFICIENT_PERMISSIONS` | Non-admin viewing another agent |
| 403 | `CROSS_CLINIC_ACCESS_DENIED` | Admin lacks access to agent's clinic |
| 404 | `AGENT_NOT_FOUND` | Agent has no clinic assignment |

---

### 5.5 Get Analytics Summary

Retrieves aggregate metrics for a clinic.

**Endpoint:** `GET /admin/analytics/summary`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| clinicId | string | Yes | - | Target clinic identifier |
| startTime | number | No | 24 hours ago | Start timestamp (epoch seconds) |
| endTime | number | No | Now | End timestamp (epoch seconds) |
| limit | number | No | 1000 | Max records to analyze (max 1000) |
| lastEvaluatedKey | string | No | - | Pagination token |

**Success Response (200):**
```json
{
  "clinicId": "clinic-456",
  "startTime": 1701302400,
  "endTime": 1701388800,
  "summary": {
    "totalCalls": 250,
    "averageDuration": 425,
    "averageTalkPercentage": 46,
    "sentimentBreakdown": {
      "POSITIVE": 150,
      "NEUTRAL": 75,
      "NEGATIVE": 20,
      "MIXED": 5
    },
    "categoryBreakdown": {
      "appointment": 180,
      "inquiry": 40,
      "billing": 20,
      "emergency": 10
    },
    "issuesDetected": 15,
    "averageQualityScore": 0.91,
    "weightedSentimentScore": 71,
    "topIssues": [
      { "issue": "long_hold_time", "count": 8 },
      { "issue": "customer_frustration", "count": 5 }
    ],
    "callVolumeByHour": [
      { "hour": 0, "count": 2 },
      { "hour": 8, "count": 25 },
      { "hour": 9, "count": 45 }
    ]
  },
  "dataCompleteness": {
    "isComplete": true,
    "recordsAnalyzed": 250
  },
  "pagination": {
    "hasMore": false,
    "recordsInPage": 250
  }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required for summary` | Clinic ID not provided |
| 400 | `INVALID_PAGINATION_TOKEN` | Malformed pagination token |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Unauthorized` | User lacks access to clinic |

---

### 5.6 Get Detailed Call Analytics

Retrieves comprehensive call information including call history, insights, and transcript.

**Endpoint:** `GET /admin/analytics/detailed/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| callId | string | Yes | Unique call identifier |

**Success Response (200):**
```json
{
  "clinicId": "clinic-456",
  "clinicName": "Sunshine Dental",
  "callerName": "John Smith",
  "direction": "INBOUND",
  "to": "+18005551234",
  "from": "+15551234567",
  "callLength": 420,
  "callHistory": [
    {
      "callPath": "from +15551234567 to +18005551234",
      "date": "11/28/24",
      "time": "14:30:00",
      "duration": "00:05:30",
      "typeOfCall": "inbound"
    }
  ],
  "insights": {
    "summary": "The caller called to schedule an appointment. An appointment was successfully scheduled.",
    "missedOpportunity": "no",
    "missedOpportunityReason": null,
    "appointmentStatus": "scheduled",
    "notSchedulingReason": null,
    "billingConcerns": "no",
    "givenFeedback": "no",
    "priority": "medium",
    "inquiredServices": "yes",
    "callType": "appointment"
  },
  "transcript": [
    {
      "timestamp": "00:00:05",
      "speaker": "AGENT",
      "text": "Thank you for calling Sunshine Dental, how may I help you?"
    },
    {
      "timestamp": "00:00:12",
      "speaker": "CUSTOMER",
      "text": "Hi, I'd like to schedule a cleaning appointment."
    }
  ]
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing callId parameter` | Call ID not provided |
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `Unauthorized` | User lacks access to the call's clinic |
| 404 | `Call not found` | No call record exists |

---

## 6. Chatbot Stack

The Chatbot stack provides an AI-powered dental clinic assistant using WebSocket for real-time chat and REST API for chat history management.

**WebSocket URL:** `wss://ws.todaysdentalinsights.com/chat`
**REST Base Path:** `/chatbot`

---

### 6.1 WebSocket Connection

Connect to the chatbot WebSocket to start a real-time conversation. This is a **public** endpoint for customer-facing chat.

**Endpoint:** `wss://ws.todaysdentalinsights.com/chat?clinicId={clinicId}`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Target clinic identifier |

**Connection Response:**
```json
{
  "message": "Connected successfully",
  "sessionId": "clinic-123-abc-1701388800000",
  "clinicId": "clinic-123",
  "clinicName": "Sunshine Dental"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing clinicId parameter` | Clinic ID not provided |
| 400 | `Invalid clinicId` | Clinic does not exist |
| 500 | `Internal server error` | Server-side error |

---

### 6.2 WebSocket Message

Send a message to the chatbot and receive AI-powered responses.

**Route:** Default route (send JSON message to WebSocket)

**Message Format:**
```json
{
  "action": "sendMessage",
  "message": "I'd like to schedule an appointment for a cleaning",
  "sessionId": "clinic-123-abc-1701388800000"
}
```

**Message Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | Must be `sendMessage` |
| message | string | Yes | User's message text |
| sessionId | string | Yes | Session ID from connection |

**Response (pushed via WebSocket):**
```json
{
  "type": "assistant",
  "message": "I'd be happy to help you schedule a cleaning appointment! Let me check our available times. What day works best for you?",
  "sessionId": "clinic-123-abc-1701388800000",
  "timestamp": 1701388850000,
  "metadata": {
    "toolsUsed": [],
    "processingTimeMs": 1250
  }
}
```

**Response Types:**
| Type | Description |
|------|-------------|
| `assistant` | AI chatbot response |
| `thinking` | Filler response while processing (if enabled) |
| `error` | Error message |

---

### 6.3 WebSocket Disconnect

The WebSocket connection is automatically closed when the client disconnects. A disconnection record is stored for analytics.

---

### 6.4 Get Chat History

Retrieves chat conversation history. Requires authentication and Marketing module read permission.

**Endpoint:** `GET /chatbot/chat-history`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | No | Filter by clinic (defaults to all authorized clinics) |
| startDate | string | No | Start date filter (YYYY-MM-DD) |
| endDate | string | No | End date filter (YYYY-MM-DD) |

**Success Response (200):**
```json
{
  "conversations": [
    {
      "sessionId": "clinic-123-abc-1701388800000",
      "clinicId": "clinic-123",
      "startTime": "2024-12-01T12:00:00.000Z",
      "lastActivity": 1701389700000,
      "duration": 900000,
      "messageCount": 15,
      "userMessageCount": 7,
      "assistantMessageCount": 8,
      "firstMessage": "I'd like to schedule an appointment",
      "lastMessage": "Thank you for booking with us!",
      "messages": [
        {
          "type": "user",
          "content": "I'd like to schedule an appointment",
          "timestamp": 1701388800000
        },
        {
          "type": "assistant",
          "content": "I'd be happy to help! What type of appointment are you looking for?",
          "timestamp": 1701388810000
        }
      ],
      "sessionState": {
        "patientName": "John Smith",
        "appointmentScheduled": true
      }
    }
  ],
  "total": 1
}
```

**Authorization:**
- Requires Marketing module `read` permission
- Admin users can view all conversations
- Non-admin users see only conversations for clinics where they have Marketing module access

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 403 | `You do not have permission to read chat history in the Marketing module` | Insufficient module permission |
| 403 | `You do not have permission to read chat history for this clinic` | No access to specified clinic |
| 500 | `Internal server error` | Server-side error |

---

### 6.5 Get Conversation Detail

Retrieves details for a specific chat conversation.

**Endpoint:** `GET /chatbot/chat-history/{sessionId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sessionId | string | Yes | Conversation session identifier |

**Success Response (200):**
```json
{
  "sessionId": "clinic-123-abc-1701388800000",
  "clinicId": "clinic-123",
  "startTime": "2024-12-01T12:00:00.000Z",
  "lastActivity": 1701389700000,
  "duration": 900000,
  "messageCount": 15,
  "userMessageCount": 7,
  "assistantMessageCount": 8,
  "firstMessage": "I'd like to schedule an appointment",
  "lastMessage": "Thank you for booking with us!",
  "messages": [
    {
      "type": "user",
      "content": "I'd like to schedule an appointment",
      "timestamp": 1701388800000,
      "metadata": {}
    },
    {
      "type": "assistant",
      "content": "I'd be happy to help! What type of appointment are you looking for?",
      "timestamp": 1701388810000,
      "metadata": {
        "toolsUsed": []
      }
    }
  ],
  "sessionState": {
    "patientName": "John Smith",
    "phoneNumber": "+15551234567",
    "appointmentScheduled": true,
    "appointmentType": "cleaning"
  }
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid token |
| 403 | `You do not have permission to read chat history in the Marketing module` | Insufficient module permission |
| 404 | Conversation not found | Session does not exist |
| 500 | `Internal server error` | Server-side error |

---

## 7. Chime Stack (Voice/Call Center)

The Chime stack provides voice/call center functionality using Amazon Chime SDK. It handles agent sessions, inbound/outbound calls, call transfers, recordings, and real-time call management.

**Base Path:** `/admin/chime`

---

### 7.1 Start Agent Session

Starts an agent's call center session, creating a Chime meeting for the agent.

**Endpoint:** `POST /admin/chime/start-session`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "activeClinicIds": ["clinic-123", "clinic-456"]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| activeClinicIds | string[] | Yes | Array of clinic IDs the agent will handle calls for |

**Success Response (200):**
```json
{
  "message": "Session started successfully",
  "agentId": "agent@example.com",
  "meetingId": "meeting-uuid-123",
  "attendeeId": "attendee-uuid-456",
  "joinToken": "eyJhbGciOiJIUzI1NiIs...",
  "mediaRegion": "us-east-1",
  "activeClinicIds": ["clinic-123", "clinic-456"]
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `activeClinicIds array is required` | Missing clinic IDs |
| 401 | `Unauthorized` | Invalid or missing token |
| 403 | `Invalid token: missing sub` | Token missing subject claim |
| 500 | `Internal server error` | Server-side error |

---

### 7.2 Stop Agent Session

Ends an agent's call center session.

**Endpoint:** `POST /admin/chime/stop-session`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Success Response (200):**
```json
{
  "message": "Session stopped successfully",
  "agentId": "agent@example.com"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Invalid or missing token |
| 404 | `Session not found` | No active session for agent |
| 500 | `Internal server error` | Server-side error |

---

### 7.3 Outbound Call

Initiates an outbound call from a clinic to a phone number.

**Endpoint:** `POST /admin/chime/outbound-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "toPhoneNumber": "+15551234567",
  "fromClinicId": "clinic-123"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| toPhoneNumber | string | Yes | Target phone number (E.164 format) |
| fromClinicId | string | Yes | Clinic ID to place call from |

**Success Response (200):**
```json
{
  "message": "Outbound call initiated",
  "callId": "call-uuid-123",
  "pstnCallId": "pstn-call-uuid",
  "toPhoneNumber": "+15551234567",
  "fromPhoneNumber": "+18005551234",
  "clinicId": "clinic-123"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `toPhoneNumber and fromClinicId are required` | Missing required fields |
| 400 | `Invalid phone number` | Phone number validation failed |
| 401 | `Unauthorized` | Invalid or missing token |
| 403 | `Not authorized for clinic` | User lacks access to clinic |
| 500 | `Internal server error` | Server-side error |

---

### 7.4 Transfer Call

Transfers an active call to another agent or external number.

**Endpoint:** `POST /admin/chime/transfer-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123",
  "transferType": "agent",
  "targetAgentId": "other-agent@example.com"
}
```

Or for external transfer:
```json
{
  "callId": "call-uuid-123",
  "transferType": "external",
  "targetPhoneNumber": "+15559876543"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | Active call identifier |
| transferType | string | Yes | `agent` or `external` |
| targetAgentId | string | Conditional | Target agent ID (if type=agent) |
| targetPhoneNumber | string | Conditional | Target phone (if type=external) |

**Success Response (200):**
```json
{
  "message": "Call transfer initiated",
  "callId": "call-uuid-123",
  "transferType": "agent",
  "targetAgentId": "other-agent@example.com"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `callId and transferType are required` | Missing required fields |
| 400 | `Target agent or phone number required` | Missing transfer target |
| 401 | `Unauthorized` | Invalid or missing token |
| 404 | `Call not found` | Call does not exist |
| 500 | `Internal server error` | Server-side error |

---

### 7.5 Call Accepted

Signals that an agent has accepted an incoming call.

**Endpoint:** `POST /admin/chime/call-accepted`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123"
}
```

**Success Response (200):**
```json
{
  "message": "Call accepted",
  "callId": "call-uuid-123",
  "agentId": "agent@example.com"
}
```

---

### 7.6 Call Rejected

Signals that an agent has rejected an incoming call.

**Endpoint:** `POST /admin/chime/call-rejected`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123",
  "reason": "busy"
}
```

**Success Response (200):**
```json
{
  "message": "Call rejected",
  "callId": "call-uuid-123",
  "reason": "busy"
}
```

---

### 7.7 Call Hung Up

Signals that a call has been hung up/ended.

**Endpoint:** `POST /admin/chime/call-hungup`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123"
}
```

**Success Response (200):**
```json
{
  "message": "Call ended",
  "callId": "call-uuid-123",
  "duration": 245
}
```

---

### 7.8 Leave Call

Agent leaves a call without ending it (for transfers).

**Endpoint:** `POST /admin/chime/leave-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123"
}
```

**Success Response (200):**
```json
{
  "message": "Left call successfully",
  "callId": "call-uuid-123"
}
```

---

### 7.9 Hold Call

Places an active call on hold.

**Endpoint:** `POST /admin/chime/hold-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123"
}
```

**Success Response (200):**
```json
{
  "message": "Call placed on hold",
  "callId": "call-uuid-123",
  "holdStartTime": "2024-12-01T12:00:00Z"
}
```

---

### 7.10 Resume Call

Resumes a call from hold.

**Endpoint:** `POST /admin/chime/resume-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "callId": "call-uuid-123"
}
```

**Success Response (200):**
```json
{
  "message": "Call resumed",
  "callId": "call-uuid-123",
  "holdDuration": 30
}
```

---

### 7.11 Heartbeat

Sends a heartbeat to maintain agent's online status.

**Endpoint:** `POST /admin/chime/heartbeat`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Success Response (200):**
```json
{
  "message": "Heartbeat received",
  "agentId": "agent@example.com",
  "status": "online",
  "lastHeartbeat": "2024-12-01T12:00:00Z"
}
```

---

### 7.12 Get Recording

Retrieves call recording metadata and download URL.

**Endpoint:** `GET /admin/recordings/{recordingId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| recordingId | string | Yes | Recording identifier |

**Success Response (200):**
```json
{
  "recordingId": "rec-uuid-123",
  "callId": "call-uuid-456",
  "clinicId": "clinic-123",
  "duration": 300,
  "uploadedAt": "2024-12-01T12:00:00Z",
  "fileSize": 5242880,
  "format": "wav",
  "transcriptionStatus": "COMPLETED",
  "downloadUrl": "https://presigned-url...",
  "downloadUrlExpiresAt": "2024-12-01T13:00:00Z"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing recordingId` | Recording ID not provided |
| 401 | `Unauthorized` | Invalid or missing token |
| 403 | `Unauthorized` | User lacks access to recording's clinic |
| 404 | `Recording not found` | Recording does not exist |

---

### 7.13 Get Recordings for Call

Retrieves all recordings for a specific call.

**Endpoint:** `GET /admin/recordings/call/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| callId | string | Yes | Call identifier |

**Success Response (200):**
```json
{
  "callId": "call-uuid-456",
  "recordings": [
    {
      "recordingId": "rec-uuid-123",
      "duration": 300,
      "uploadedAt": "2024-12-01T12:00:00Z",
      "fileSize": 5242880,
      "transcriptionStatus": "COMPLETED",
      "downloadUrl": "https://presigned-url..."
    }
  ],
  "downloadUrlExpiresAt": "2024-12-01T13:00:00Z"
}
```

---

### 7.14 List Recordings for Clinic

Lists recordings for a clinic with pagination.

**Endpoint:** `GET /admin/recordings/clinic/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| startTime | number | No | 7 days ago | Start timestamp (epoch ms) |
| endTime | number | No | Now | End timestamp (epoch ms) |
| limit | number | No | 100 | Max results (max 100) |
| lastEvaluatedKey | string | No | - | Pagination token |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "recordings": [
    {
      "recordingId": "rec-uuid-123",
      "callId": "call-uuid-456",
      "duration": 300,
      "uploadedAt": "2024-12-01T12:00:00Z",
      "fileSize": 5242880,
      "agentId": "agent@example.com",
      "transcriptionStatus": "COMPLETED"
    }
  ],
  "hasMore": true,
  "lastEvaluatedKey": "eyJyZWNvcmRpbmdJZCI6..."
}
```

---

## 8. Clinic Hours Stack

The Clinic Hours stack manages clinic operating hours and schedules. It provides CRUD operations for managing clinic business hours with automatic hourly synchronization from OpenDental.

**Base Path:** `/clinic-hours`

---

### 8.1 List All Clinic Hours

Retrieves clinic hours for all authorized clinics.

**Endpoint:** `GET /clinic-hours/hours`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Success Response (200):**
```json
{
  "success": true,
  "items": [
    {
      "clinicId": "clinic-123",
      "monday": { "open": "08:00", "close": "17:00", "closed": false },
      "tuesday": { "open": "08:00", "close": "17:00", "closed": false },
      "wednesday": { "open": "08:00", "close": "17:00", "closed": false },
      "thursday": { "open": "08:00", "close": "17:00", "closed": false },
      "friday": { "open": "08:00", "close": "16:00", "closed": false },
      "saturday": { "open": "09:00", "close": "13:00", "closed": false },
      "sunday": { "closed": true },
      "timeZone": "America/New_York",
      "updatedAt": 1701388800000,
      "updatedBy": "admin@example.com"
    }
  ]
}
```

**Authorization:**
- Admin users see all clinic hours
- Non-admin users see only hours for clinics they have access to via Operations module

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 500 | `Failed to list clinic hours` | Server-side error |

---

### 8.2 Create Clinic Hours

Creates hours configuration for a clinic.

**Endpoint:** `POST /clinic-hours/hours`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "clinicId": "clinic-123",
  "monday": { "open": "08:00", "close": "17:00" },
  "tuesday": { "open": "08:00", "close": "17:00" },
  "wednesday": { "open": "08:00", "close": "17:00" },
  "thursday": { "open": "08:00", "close": "17:00" },
  "friday": { "open": "08:00", "close": "16:00" },
  "saturday": { "open": "09:00", "close": "13:00" },
  "sunday": { "closed": true }
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |
| monday - sunday | object | No | Day hours configuration |
| [day].open | string | Conditional | Opening time (HH:MM format) |
| [day].close | string | Conditional | Closing time (HH:MM format) |
| [day].closed | boolean | No | If true, clinic is closed that day |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "message": "Clinic hours created successfully"
}
```

**Authorization:**
- Requires Operations module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `[day] requires both open and close times when not closed` | Invalid day configuration |
| 400 | `[day] times must be in HH:MM format` | Invalid time format |
| 400 | `[day] close time must be after open time` | Invalid time range |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to create clinic hours for this clinic` | Insufficient permissions |
| 404 | `Clinic not found` | Clinic doesn't exist |
| 500 | `Failed to create clinic hours` | Server-side error |

---

### 8.3 Get Clinic Hours

Retrieves hours for a specific clinic.

**Endpoint:** `GET /clinic-hours/hours/{clinicId}`

Alternative: `GET /clinic-hours/clinics/{clinicId}/hours`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "monday": { "open": "08:00", "close": "17:00", "closed": false },
  "tuesday": { "open": "08:00", "close": "17:00", "closed": false },
  "wednesday": { "open": "08:00", "close": "17:00", "closed": false },
  "thursday": { "open": "08:00", "close": "17:00", "closed": false },
  "friday": { "open": "08:00", "close": "16:00", "closed": false },
  "saturday": { "open": "09:00", "close": "13:00", "closed": false },
  "sunday": { "closed": true },
  "timeZone": "America/New_York",
  "updatedAt": 1701388800000,
  "updatedBy": "admin@example.com"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access clinic hours for this clinic` | Insufficient permissions |
| 404 | `not found` | Clinic hours not configured |
| 500 | `Failed to get clinic hours` | Server-side error |

---

### 8.4 Update Clinic Hours

Updates hours configuration for a clinic.

**Endpoint:** `PUT /clinic-hours/hours/{clinicId}`

Alternative: `PUT /clinic-hours/clinics/{clinicId}/hours`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "monday": { "open": "09:00", "close": "18:00" },
  "tuesday": { "open": "09:00", "close": "18:00" },
  "wednesday": { "open": "09:00", "close": "18:00" },
  "thursday": { "open": "09:00", "close": "18:00" },
  "friday": { "open": "09:00", "close": "17:00" },
  "saturday": { "closed": true },
  "sunday": { "closed": true }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "message": "Clinic hours updated successfully"
}
```

**Authorization:**
- Requires Operations module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `[day] requires both open and close times when not closed` | Invalid day configuration |
| 400 | `[day] times must be in HH:MM format` | Invalid time format |
| 400 | `[day] close time must be after open time` | Invalid time range |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access clinic hours for this clinic` | Insufficient permissions |
| 404 | `Clinic not found` | Clinic doesn't exist |
| 500 | `Failed to update clinic hours` | Server-side error |

---

### 8.5 Delete Clinic Hours

Deletes hours configuration for a clinic.

**Endpoint:** `DELETE /clinic-hours/hours/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "message": "Clinic hours deleted successfully"
}
```

**Authorization:**
- Requires Operations module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access clinic hours for this clinic` | Insufficient permissions |
| 500 | `Failed to delete clinic hours` | Server-side error |

---

## 9. Clinic Insurance Stack

The Clinic Insurance stack manages insurance provider information and accepted plans for each clinic.

**Base Path:** `/clinic-insurance`

---

### 9.1 Get Clinic Insurance Plans

Retrieves all insurance providers and their accepted plans for a specific clinic.

**Endpoint:** `GET /clinic-insurance/clinics/{clinicId}/insurance`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Success Response (200):**
```json
{
  "success": true,
  "items": [
    {
      "insuranceProvider": "Delta Dental",
      "plans": [
        {
          "name": "PPO",
          "planName": "PPO",
          "isAccepted": true,
          "accepted": true,
          "coverageDetails": "Full coverage for preventive care",
          "details": "Full coverage for preventive care"
        },
        {
          "name": "Premier",
          "planName": "Premier",
          "isAccepted": true,
          "accepted": true,
          "coverageDetails": "80% coverage for basic procedures",
          "details": "80% coverage for basic procedures"
        }
      ],
      "notes": "Preferred provider"
    },
    {
      "insuranceProvider": "Cigna",
      "plans": [
        {
          "name": "DPPO",
          "planName": "DPPO",
          "isAccepted": true,
          "accepted": true,
          "coverageDetails": "Standard dental PPO coverage",
          "details": "Standard dental PPO coverage"
        }
      ],
      "notes": ""
    }
  ]
}
```

**Authorization:**
- Requires Insurance module `read` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access insurance information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

### 9.2 Create Insurance Provider

Adds a new insurance provider with plans to a clinic.

**Endpoint:** `POST /clinic-insurance/clinics/{clinicId}/insurance`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "insuranceProvider": "Delta Dental",
  "plans": [
    {
      "name": "PPO",
      "isAccepted": true,
      "coverageDetails": "Full coverage for preventive care"
    },
    {
      "name": "Premier",
      "isAccepted": true,
      "coverageDetails": "80% coverage for basic procedures"
    }
  ],
  "notes": "Preferred provider"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| insuranceProvider | string | Yes | Name of the insurance provider |
| plans | array | No | Array of insurance plans |
| plans[].name | string | No | Plan name |
| plans[].isAccepted | boolean | No | Whether plan is accepted (default: true) |
| plans[].coverageDetails | string | No | Coverage details description |
| notes | string | No | Notes about the provider |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "insuranceProvider": "Delta Dental"
}
```

**Authorization:**
- Requires Insurance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `insuranceProvider required` | Missing provider name |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access insurance information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

### 9.3 Update Insurance Provider

Updates an existing insurance provider and its plans for a clinic. This replaces all existing plans for the provider.

**Endpoint:** `PUT /clinic-insurance/clinics/{clinicId}/insurance`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "insuranceProvider": "Delta Dental",
  "plans": [
    {
      "name": "PPO",
      "isAccepted": true,
      "coverageDetails": "Updated coverage for preventive care"
    },
    {
      "name": "Premier",
      "isAccepted": false,
      "coverageDetails": "No longer accepting new patients"
    }
  ],
  "notes": "Updated notes"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "insuranceProvider": "Delta Dental"
}
```

**Authorization:**
- Requires Insurance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `insuranceProvider required` | Missing provider name |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access insurance information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

### 9.4 Delete Insurance Provider

Removes an insurance provider and all its plans from a clinic.

**Endpoint:** `DELETE /clinic-insurance/clinics/{clinicId}/insurance`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "insuranceProvider": "Delta Dental"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "insuranceProvider": "Delta Dental"
}
```

**Authorization:**
- Requires Insurance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `insuranceProvider required` | Missing provider name |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access insurance information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

## 10. Clinic Pricing Stack

The Clinic Pricing stack manages pricing information for dental procedures and services at each clinic.

**Base Path:** `/clinic-pricing`

---

### 10.1 Get Clinic Pricing

Retrieves all pricing items for a specific clinic.

**Endpoint:** `GET /clinic-pricing/clinics/{clinicId}/pricing`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Success Response (200):**
```json
{
  "success": true,
  "items": [
    {
      "clinicId": "clinic-123",
      "category": "Preventive Care",
      "procedureName": "Adult Teeth Cleaning",
      "minPrice": 75,
      "maxPrice": 150,
      "description": "Professional dental cleaning for adults",
      "isActive": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-06-01T14:00:00Z"
    },
    {
      "clinicId": "clinic-123",
      "category": "Restorative",
      "procedureName": "Composite Filling",
      "minPrice": 150,
      "maxPrice": 300,
      "description": "Tooth-colored filling for cavities",
      "isActive": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-06-01T14:00:00Z"
    }
  ]
}
```

**Authorization:**
- Requires Finance module `read` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access pricing information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

### 10.2 Create Pricing Item

Creates a new pricing item for a clinic.

**Endpoint:** `POST /clinic-pricing/clinics/{clinicId}/pricing`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "category": "Preventive Care",
  "procedureName": "Adult Teeth Cleaning",
  "minPrice": 75,
  "maxPrice": 150,
  "description": "Professional dental cleaning for adults",
  "isActive": true
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| category | string | Yes | Category/service type (sort key) |
| procedureName | string | No | Specific procedure name |
| minPrice | number | No | Minimum price (default: 0) |
| maxPrice | number | No | Maximum price (default: 0) |
| price | number | No | Single price (sets both min and max) |
| description | string | No | Description of the service |
| isActive | boolean | No | Whether pricing is active (default: true) |

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "category": "Preventive Care"
}
```

**Authorization:**
- Requires Finance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `category required` | Missing category |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access pricing information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

### 10.3 Update Pricing Item

Updates an existing pricing item for a clinic.

**Endpoint:** `PUT /clinic-pricing/clinics/{clinicId}/pricing`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "category": "Preventive Care",
  "procedureName": "Adult Teeth Cleaning",
  "minPrice": 85,
  "maxPrice": 175,
  "description": "Updated: Professional dental cleaning for adults",
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "category": "Preventive Care"
}
```

**Authorization:**
- Requires Finance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `category required` | Missing category |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access pricing information for this clinic` | Insufficient permissions |
| 404 | `pricing item not found` | Pricing item doesn't exist |
| 500 | Server error | Server-side error |

---

### 10.4 Delete Pricing Item

Deletes a pricing item from a clinic.

**Endpoint:** `DELETE /clinic-pricing/clinics/{clinicId}/pricing`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| Content-Type | string | Yes | `application/json` |

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic identifier |

**Request Body:**
```json
{
  "category": "Preventive Care"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clinicId": "clinic-123",
  "category": "Preventive Care"
}
```

**Authorization:**
- Requires Finance module `write` permission for the clinic

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `clinicId required` | Missing clinic ID |
| 400 | `category required` | Missing category |
| 401 | `Unauthorized - Invalid token` | Invalid or missing token |
| 403 | `You do not have permission to access pricing information for this clinic` | Insufficient permissions |
| 500 | Server error | Server-side error |

---

## 11. Communication Stack (WebSocket)

The Communication stack provides real-time messaging capabilities for internal team communications using WebSocket. It supports favor requests, direct messages, team/group messaging, and file sharing.

**WebSocket URL:** `wss://{api-id}.execute-api.{region}.amazonaws.com/prod`

---

### 11.1 WebSocket Connection

Establishes a WebSocket connection with JWT authentication.

**Endpoint:** `wss://{api-endpoint}/prod?token={accessToken}`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| token | string | Yes | JWT access token |
| idToken | string | Alternative | JWT access token (alias) |

**Connection Response:**
On successful connection, the connection ID is registered in DynamoDB with the user's information.

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid access token |
| 401 | `Access token required` | Wrong token type provided |
| 401 | `Invalid Token Payload` | Token missing required claims |

---

### 11.2 WebSocket Actions

Send JSON messages to the WebSocket to perform various actions.

#### 11.2.1 Create Favor Request

Creates a new favor/task request to send to a user or team.

**Action:** `createFavorRequest`

**Message Format:**
```json
{
  "action": "createFavorRequest",
  "receiverID": "receiver@example.com",
  "initialMessage": "Can you help me with patient charts?",
  "requestType": "Ask a Favor",
  "deadline": "2024-12-15T17:00:00Z"
}
```

**For Team/Group Request:**
```json
{
  "action": "createFavorRequest",
  "teamID": "team-uuid-123",
  "initialMessage": "Team task: Review monthly reports",
  "requestType": "Assign Task",
  "deadline": "2024-12-15T17:00:00Z"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | `createFavorRequest` |
| receiverID | string | Conditional | Receiver's user ID (for direct requests) |
| teamID | string | Conditional | Team ID (for group requests) |
| initialMessage | string | Yes | Initial message content |
| requestType | string | Yes | `General`, `Assign Task`, `Ask a Favor`, or `Other` |
| deadline | string | No | ISO timestamp for deadline |

**Response (pushed to sender):**
```json
{
  "action": "favorRequestCreated",
  "favorRequest": {
    "favorRequestID": "favor-uuid-123",
    "senderID": "sender@example.com",
    "receiverID": "receiver@example.com",
    "status": "active",
    "requestType": "Ask a Favor",
    "initialMessage": "Can you help me with patient charts?",
    "createdAt": "2024-12-01T12:00:00Z",
    "updatedAt": "2024-12-01T12:00:00Z"
  }
}
```

---

#### 11.2.2 Send Message

Sends a message within an existing favor request conversation.

**Action:** `sendMessage`

**Message Format:**
```json
{
  "action": "sendMessage",
  "favorRequestID": "favor-uuid-123",
  "content": "Here's the information you requested"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | `sendMessage` |
| favorRequestID | string | Yes | Favor request conversation ID |
| content | string | Yes | Message content |

**Response (pushed to all participants):**
```json
{
  "action": "newMessage",
  "message": {
    "favorRequestID": "favor-uuid-123",
    "senderID": "sender@example.com",
    "content": "Here's the information you requested",
    "timestamp": 1701388800000,
    "type": "text"
  }
}
```

---

#### 11.2.3 Get Upload URL

Gets a presigned S3 URL for file upload.

**Action:** `getUploadUrl`

**Message Format:**
```json
{
  "action": "getUploadUrl",
  "favorRequestID": "favor-uuid-123",
  "fileName": "document.pdf",
  "fileType": "application/pdf",
  "fileSize": 1048576
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | `getUploadUrl` |
| favorRequestID | string | Yes | Favor request conversation ID |
| fileName | string | Yes | Name of file to upload |
| fileType | string | Yes | MIME type of file |
| fileSize | number | Yes | File size in bytes |

**Response:**
```json
{
  "action": "uploadUrlGenerated",
  "uploadUrl": "https://s3.amazonaws.com/...",
  "fileKey": "favor-uuid-123/uuid-document.pdf",
  "expiresIn": 300
}
```

---

#### 11.2.4 Send File Message

Sends a file message after uploading to S3.

**Action:** `sendFileMessage`

**Message Format:**
```json
{
  "action": "sendFileMessage",
  "favorRequestID": "favor-uuid-123",
  "fileKey": "favor-uuid-123/uuid-document.pdf",
  "fileDetails": {
    "fileName": "document.pdf",
    "fileType": "application/pdf",
    "fileSize": 1048576
  }
}
```

**Response (pushed to all participants):**
```json
{
  "action": "newMessage",
  "message": {
    "favorRequestID": "favor-uuid-123",
    "senderID": "sender@example.com",
    "content": "Shared a file: document.pdf",
    "timestamp": 1701388800000,
    "type": "file",
    "fileKey": "favor-uuid-123/uuid-document.pdf",
    "fileDetails": {
      "fileName": "document.pdf",
      "fileType": "application/pdf",
      "fileSize": 1048576
    }
  }
}
```

---

#### 11.2.5 Get Messages

Retrieves message history for a favor request.

**Action:** `getMessages`

**Message Format:**
```json
{
  "action": "getMessages",
  "favorRequestID": "favor-uuid-123",
  "limit": 50
}
```

**Response:**
```json
{
  "action": "messagesRetrieved",
  "favorRequestID": "favor-uuid-123",
  "messages": [
    {
      "senderID": "sender@example.com",
      "content": "Hello!",
      "timestamp": 1701388800000,
      "type": "text"
    }
  ]
}
```

---

#### 11.2.6 Resolve Favor Request

Marks a favor request as resolved/completed.

**Action:** `resolveFavorRequest`

**Message Format:**
```json
{
  "action": "resolveFavorRequest",
  "favorRequestID": "favor-uuid-123"
}
```

**Response:**
```json
{
  "action": "favorRequestResolved",
  "favorRequestID": "favor-uuid-123",
  "status": "resolved"
}
```

---

#### 11.2.7 Get Favor Requests

Retrieves all favor requests for the current user.

**Action:** `getFavorRequests`

**Message Format:**
```json
{
  "action": "getFavorRequests"
}
```

**Response:**
```json
{
  "action": "favorRequestsRetrieved",
  "favorRequests": [
    {
      "favorRequestID": "favor-uuid-123",
      "senderID": "sender@example.com",
      "receiverID": "receiver@example.com",
      "status": "active",
      "requestType": "Ask a Favor",
      "initialMessage": "Can you help?",
      "unreadCount": 2,
      "createdAt": "2024-12-01T12:00:00Z",
      "updatedAt": "2024-12-01T14:00:00Z"
    }
  ]
}
```

---

#### 11.2.8 Create Team

Creates a new team/group for group messaging.

**Action:** `createTeam`

**Message Format:**
```json
{
  "action": "createTeam",
  "name": "Front Desk Team",
  "members": ["user1@example.com", "user2@example.com"]
}
```

**Response:**
```json
{
  "action": "teamCreated",
  "team": {
    "teamID": "team-uuid-123",
    "ownerID": "owner@example.com",
    "name": "Front Desk Team",
    "members": ["user1@example.com", "user2@example.com"],
    "createdAt": "2024-12-01T12:00:00Z"
  }
}
```

---

#### 11.2.9 Get Teams

Retrieves teams the user owns or is a member of.

**Action:** `getTeams`

**Message Format:**
```json
{
  "action": "getTeams"
}
```

**Response:**
```json
{
  "action": "teamsRetrieved",
  "teams": [
    {
      "teamID": "team-uuid-123",
      "ownerID": "owner@example.com",
      "name": "Front Desk Team",
      "members": ["user1@example.com", "user2@example.com"]
    }
  ]
}
```

---

### 11.3 WebSocket Disconnect

The connection is automatically cleaned up when the client disconnects. The connection record is removed from DynamoDB.

---

## 12. Consent Form Data Stack

The Consent Form Data Stack manages patient consent forms used during intake and procedures. It provides CRUD operations for consent form templates with module-based access control.

**Base Path:** `/consent-forms`

---

### 12.1 List Consent Forms

Retrieves all consent form templates.

**Endpoint:** `GET /consent-forms`

**Authorization:** Requires `read` permission on `Operations` module

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |

**Success Response (200):**
```json
{
  "consentForms": [
    {
      "consent_form_id": "uuid-here",
      "templateName": "General Consent Form",
      "elements": [
        {
          "type": "text",
          "label": "Patient Name",
          "required": true
        },
        {
          "type": "signature",
          "label": "Patient Signature",
          "required": true
        }
      ],
      "modified_at": "2024-12-01T10:30:00.000Z",
      "modified_by": "John Smith"
    }
  ]
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| consentForms | array | Array of consent form objects |

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid authorization |
| 403 | `You do not have permission to read consent forms in the Operations module` | Insufficient permissions |

---

### 12.2 Get Consent Form

Retrieves a specific consent form by ID.

**Endpoint:** `GET /consent-forms/{consentFormId}`

**Authorization:** Requires `read` permission on `Operations` module

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| consentFormId | string | Yes | Unique consent form identifier |

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |

**Success Response (200):**
```json
{
  "consent_form_id": "uuid-here",
  "templateName": "General Consent Form",
  "elements": [
    {
      "type": "text",
      "label": "Patient Name",
      "required": true
    },
    {
      "type": "checkbox",
      "label": "I agree to the terms",
      "required": true
    },
    {
      "type": "signature",
      "label": "Patient Signature",
      "required": true
    }
  ],
  "modified_at": "2024-12-01T10:30:00.000Z",
  "modified_by": "John Smith"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid authorization |
| 403 | `You do not have permission to read consent forms in the Operations module` | Insufficient permissions |
| 404 | `Consent form not found` | No consent form exists with the given ID |

---

### 12.3 Create Consent Form

Creates a new consent form template.

**Endpoint:** `POST /consent-forms`

**Authorization:** Requires `write` permission on `Operations` module

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "templateName": "Procedure Consent Form",
  "elements": [
    {
      "type": "text",
      "label": "Patient Name",
      "required": true,
      "placeholder": "Enter full name"
    },
    {
      "type": "date",
      "label": "Date of Birth",
      "required": true
    },
    {
      "type": "textarea",
      "label": "Medical History",
      "required": false
    },
    {
      "type": "checkbox",
      "label": "I understand the risks and benefits of this procedure",
      "required": true
    },
    {
      "type": "signature",
      "label": "Patient Signature",
      "required": true
    }
  ]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| templateName | string | Yes | Name of the consent form template |
| elements | array | Yes | Array of form elements |

**Element Types:**
| Type | Description |
|------|-------------|
| text | Single-line text input |
| textarea | Multi-line text input |
| checkbox | Checkbox for agreements |
| date | Date picker |
| signature | Signature capture field |
| select | Dropdown selection |

**Element Properties:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| type | string | Yes | Element type (see table above) |
| label | string | Yes | Display label for the element |
| required | boolean | Yes | Whether the field is required |
| placeholder | string | No | Placeholder text for input fields |
| options | array | No | Options for select elements |

**Success Response (201):**
```json
{
  "consent_form_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Consent form created successfully"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `templateName and elements array are required` | Missing required fields |
| 401 | `Unauthorized - Invalid token` | Missing or invalid authorization |
| 403 | `You do not have permission to modify consent forms in the Operations module` | Insufficient permissions |

---

### 12.4 Update Consent Form

Updates an existing consent form template.

**Endpoint:** `PUT /consent-forms/{consentFormId}`

**Authorization:** Requires `write` permission on `Operations` module

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| consentFormId | string | Yes | Unique consent form identifier |

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |
| Content-Type | string | Yes | `application/json` |

**Request Body:**
```json
{
  "templateName": "Updated Procedure Consent Form",
  "elements": [
    {
      "type": "text",
      "label": "Patient Full Name",
      "required": true
    },
    {
      "type": "signature",
      "label": "Patient Signature",
      "required": true
    }
  ]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| templateName | string | Yes | Name of the consent form template |
| elements | array | Yes | Array of form elements |

**Success Response (200):**
```json
{
  "consent_form_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Consent form updated successfully"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `templateName and elements array are required` | Missing required fields |
| 401 | `Unauthorized - Invalid token` | Missing or invalid authorization |
| 403 | `You do not have permission to modify consent forms in the Operations module` | Insufficient permissions |

---

### 12.5 Delete Consent Form

Deletes a consent form template.

**Endpoint:** `DELETE /consent-forms/{consentFormId}`

**Authorization:** Requires `write` permission on `Operations` module

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| consentFormId | string | Yes | Unique consent form identifier |

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |

**Success Response (200):**
```json
{
  "message": "Consent form deleted successfully"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid authorization |
| 403 | `You do not have permission to modify consent forms in the Operations module` | Insufficient permissions |

---

## 13. Queries Stack

The Queries Stack stores reusable SQL queries for reporting/analytics. All endpoints are protected by the custom JWT authorizer and enforce **IT module** access levels.

**Base Path:** `/queries`

**Authorization Mapping:**
- `GET /queries` and `GET /queries/{queryName}` require `read` permission on the IT module
- `POST /queries` requires `write` permission on the IT module
- `PUT /queries/{queryName}` requires `put` permission on the IT module
- `DELETE /queries/{queryName}` requires `delete` permission on the IT module

---

### 13.1 List Queries

Retrieves all saved queries.

**Endpoint:** `GET /queries`

**Success Response (200):**
```json
[
  {
    "QueryName": "active-patients",
    "QueryDescription": "Patients with upcoming visits",
    "Query": "SELECT * FROM patients WHERE nextVisit IS NOT NULL"
  }
]
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid JWT |
| 403 | `You do not have read permission for the IT module` | Lacking IT read access |

---

### 13.2 Get Query By Name

Returns a single query by `queryName`.

**Endpoint:** `GET /queries/{queryName}`

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized - Invalid token` | Missing or invalid JWT |
| 403 | `You do not have read permission for the IT module` | Lacking IT read access |
| 404 | `Not Found` | Query name does not exist |

---

### 13.3 Create Query

Creates a new stored query.

**Endpoint:** `POST /queries`

**Headers:** `Content-Type: application/json`, `Authorization: Bearer <accessToken>`

**Request Body:**
```json
{
  "QueryName": "call-volume",
  "QueryDescription": "Aggregated call volume per clinic",
  "Query": "SELECT clinicId, COUNT(*) as calls FROM calls GROUP BY clinicId"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing required fields` | One of `QueryName`, `QueryDescription`, or `Query` is missing |
| 401 | `Unauthorized - Invalid token` | Missing or invalid JWT |
| 403 | `You do not have write permission for the IT module` | Lacking IT write access |

---

### 13.4 Update Query

Updates an existing query definition.

**Endpoint:** `PUT /queries/{queryName}`

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `queryName required` | Missing path parameter |
| 401 | `Unauthorized - Invalid token` | Missing or invalid JWT |
| 403 | `You do not have put permission for the IT module` | Lacking IT put access |
| 404 | `Not Found` | Query name does not exist |

---

### 13.5 Delete Query

Deletes a stored query.

**Endpoint:** `DELETE /queries/{queryName}`

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `queryName required` | Missing path parameter |
| 401 | `Unauthorized - Invalid token` | Missing or invalid JWT |
| 403 | `You do not have delete permission for the IT module` | Lacking IT delete access |

---

## 14. Common Response Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (CORS preflight) |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 405 | Method Not Allowed |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 501 | Not Implemented |

---

## 15. Security & Rate Limiting

### Authentication Flow

1. **Request OTP:** User calls `POST /auth/initiate` with their email
2. **Check Email:** User receives 6-digit OTP code via email
3. **Verify OTP:** User calls `POST /auth/verify` with email and code
4. **Receive Tokens:** On success, user receives access and refresh tokens
5. **Use API:** Include `Authorization: Bearer <accessToken>` in protected requests
6. **Refresh:** When access token expires, call `POST /auth/refresh`
7. **Logout:** Call `POST /auth/logout` to invalidate tokens

### Token Details

| Token Type | Expiration | Purpose |
|------------|------------|---------|
| Access Token | 1 hour | API authentication |
| Refresh Token | 30 days | Get new access tokens |
| OTP Code | 10 minutes | Email verification |

### JWT Token Structure

Access tokens contain minimal user identification data:

```typescript
interface JWTPayload {
  sub: string;           // User email (subject)
  email: string;         // User email address
  givenName?: string;    // User's first name
  familyName?: string;   // User's last name
  iat: number;           // Issued at timestamp
  exp: number;           // Expiration timestamp
  // Note: clinicRoles are NOT included in JWT for size optimization
  // Permissions are fetched fresh from DynamoDB by the authorizer
}
```

Refresh tokens contain only the essential data needed for renewal:

```typescript
interface RefreshTokenPayload {
  sub: string;           // User email
  iat: number;           // Issued at timestamp
  exp: number;           // Expiration timestamp (30 days)
}
```

### Rate Limits

| Endpoint | Limit | Duration |
|----------|-------|----------|
| OTP Initiate | 1 request | 60 seconds |
| OTP Verify | 5 attempts | Per OTP code |
| Password Login | 5 attempts | 15 min lockout |

### Token Blacklisting

- Logged out tokens are added to a blacklist
- Blacklist entries auto-expire after 31 days (via DynamoDB TTL)

### Custom Lambda Authorizer

All protected API endpoints use a custom Lambda authorizer that validates JWT tokens and enforces access control. The authorizer performs the following steps:

1. **Token Validation:** Verifies the JWT signature and expiration
2. **Blacklist Check:** Ensures the token hasn't been revoked via logout
3. **Permission Fetching:** Queries DynamoDB to get current user permissions
4. **Context Enrichment:** Adds user permissions to the API Gateway context
5. **Policy Generation:** Returns IAM policy allowing or denying access

#### DynamoDB Integration

The authorizer fetches user permissions from the `StaffUser` DynamoDB table, which contains:

- `clinicRoles`: Array of per-clinic role assignments with module access permissions
- `isSuperAdmin`: Global super admin flag
- `isGlobalSuperAdmin`: Global super admin flag
- `isActive`: Account status (inactive users are rejected)

**Important Security Note:** JWT tokens intentionally exclude `clinicRoles` to keep token size manageable. Permissions are fetched fresh from DynamoDB on each request to ensure up-to-date access control.

#### In-Memory Caching

To reduce DynamoDB load and improve performance, the authorizer implements in-memory caching:

- **Cache TTL:** 5 minutes (matching API Gateway authorizer cache)
- **Cache Key:** User email
- **Cached Data:** User permissions and super admin flags
- **Cache Miss:** Falls back to DynamoDB query

#### Authorizer Context

The authorizer enriches the API Gateway context with user information, making it available to all Lambda functions:

```typescript
context: {
  email: string,              // User's email address
  givenName: string,          // User's first name (if available)
  familyName: string,         // User's last name (if available)
  clinicRoles: string,        // JSON string of clinic role assignments
  isSuperAdmin: string,       // "true" or "false"
  isGlobalSuperAdmin: string, // "true" or "false"
}
```

#### Permission Checking

Downstream Lambda functions use shared utilities to check permissions:

- **Module Access:** Users must have appropriate permissions for system modules (HR, Operations, etc.)
- **Clinic Access:** Users can only access data for clinics they have roles in
- **Super Admin Override:** Super admins bypass all permission checks
- **Role-Based Access:** Regular users require specific module permissions per clinic

#### Infrastructure Tables

The Core Stack maintains three critical DynamoDB tables:

**StaffUser Table:**
- Primary Key: `email` (string)
- Stores user profiles, roles, and permissions
- Used by authorizer for permission fetching
- Point-in-time recovery enabled for security

**StaffClinicInfo Table:**
- Primary Key: `email` (string), Sort Key: `clinicId` (string)
- Stores clinic-specific user information
- Enables efficient clinic-based queries

**TokenBlacklist Table:**
- Primary Key: `tokenHash` (string)
- Stores SHA-256 hashes of revoked tokens
- TTL-enabled for automatic cleanup
- Prevents reuse of logged-out tokens

---

## 16. Data Models

### User Roles

Available roles for clinic assignments:

| Role | Description |
|------|-------------|
| `Accounting` | Accounting staff |
| `patient coordinator` | Front desk coordinator |
| `treatment coordinator` | Treatment planning coordinator |
| `patient coordinator (remote)` | Remote patient coordinator |
| `Regional manager` | Regional clinic manager |
| `Office Manager` | Clinic office manager |
| `Marketing` | Marketing team member |
| `Insurance` | Insurance specialist |
| `Payment Posting` | Payment processing staff |
| `Credentialing` | Credentialing specialist |
| `Admin` | Clinic administrator |
| `SuperAdmin` | Super administrator |
| `Global super admin` | System-wide administrator |

### System Modules

Available modules for permission assignments:

| Module | Description |
|--------|-------------|
| `HR` | Human Resources |
| `Accounting` | Accounting & Finance |
| `Operations` | Daily Operations |
| `Finance` | Financial Management |
| `Marketing` | Marketing & Outreach |
| `Insurance` | Insurance Management |
| `IT` | Information Technology |

### Module Permissions

Available permission levels:

| Permission | Description |
|------------|-------------|
| `read` | View data |
| `write` | Create new records |
| `put` | Update existing records |
| `delete` | Delete records |

### Callback Request Object

```typescript
interface CallbackRequest {
  RequestID: string;        // UUID
  name: string;             // Customer name
  phone: string;            // Phone number
  email?: string;           // Email address
  message?: string;         // Request message
  module: string;           // Department module
  clinicId: string;         // Clinic identifier
  calledBack: 'YES' | 'NO'; // Status
  notes?: string;           // Internal notes
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
  updatedBy?: string;       // Last updated by (user name)
  source: string;           // Request source
}
```

### Template Object

```typescript
interface Template {
  template_id: string;      // UUID
  template_name: string;    // Template name/title
  module: string;           // System module (HR, Operations, etc.)
  email_subject?: string;   // Email subject line
  email_body: string;       // Email body content
  text_message?: string;    // SMS/text message content
  created_at: string;       // ISO timestamp
  modified_at: string;      // ISO timestamp
  modified_by: string;      // Last modified by (user name or email)
  clinic_id?: string;       // Optional: clinic-specific template
}
```

### Staff User Object

```typescript
interface StaffUser {
  email: string;                          // Primary key
  givenName?: string;
  familyName?: string;
  clinicRoles: ClinicRoleAssignment[];    // Per-clinic roles
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ClinicRoleAssignment {
  clinicId: string;
  role: UserRole;
  basePay?: number;
  hourlyPay?: number;
  workLocation?: { isRemote: boolean; isOnPremise: boolean };
  openDentalUserNum?: number;
  openDentalUsername?: string;
  employeeNum?: number;
  moduleAccess?: ModuleAccess[];
}

interface ModuleAccess {
  module: string;       // HR, Operations, etc.
  permissions: string[]; // ['read', 'write', 'put', 'delete']
}
```

### Call Analytics Object

```typescript
interface CallAnalytics {
  callId: string;                    // Primary key - unique call identifier
  timestamp: number;                 // Sort key - epoch timestamp
  clinicId: string;                  // Clinic identifier
  agentId: string;                   // Agent's email address
  callStartTime: string;             // ISO timestamp
  callEndTime?: string;              // ISO timestamp (null if active)
  totalDuration: number;             // Call duration in seconds
  overallSentiment: Sentiment;       // POSITIVE, NEGATIVE, NEUTRAL, MIXED
  callCategory: string;              // appointment, inquiry, billing, etc.
  analyticsState: AnalyticsState;    // INITIALIZING, ACTIVE, FINALIZING, FINALIZED
  speakerMetrics: SpeakerMetrics;
  audioQuality: AudioQuality;
  detectedIssues: string[];          // Array of detected issue types
  finalized: boolean;                // Whether analytics are complete
  updatedAt: string;                 // ISO timestamp
  finalizedAt?: string;              // ISO timestamp when finalized
}

type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
type AnalyticsState = 'INITIALIZING' | 'ACTIVE' | 'FINALIZING' | 'FINALIZED';

interface SpeakerMetrics {
  agentTalkPercentage: number;       // 0-100
  customerTalkPercentage: number;    // 0-100
}

interface AudioQuality {
  qualityScore: number;              // 0.0-1.0
}
```

### Call Insights Object

```typescript
interface CallInsights {
  summary: string;                   // AI-generated call summary
  missedOpportunity: 'yes' | 'no';
  missedOpportunityReason?: string;
  appointmentStatus: AppointmentStatus;
  notSchedulingReason?: string;
  billingConcerns: 'yes' | 'no';
  givenFeedback: 'yes' | 'no';
  priority: 'high' | 'medium' | 'low';
  inquiredServices: 'yes' | 'no';
  callType: CallType;
}

type AppointmentStatus = 'scheduled' | 'not_scheduled' | 'rescheduled' | 'cancelled' | 'unknown';
type CallType = 'appointment' | 'inquiry' | 'complaint' | 'billing' | 'emergency' | 'other';
```

### Chatbot Conversation Object

```typescript
interface ChatbotConversation {
  sessionId: string;           // Unique session identifier
  clinicId: string;            // Clinic identifier
  startTime: string;           // ISO timestamp
  lastActivity: number;        // Epoch timestamp of last message
  duration: number;            // Duration in milliseconds
  messageCount: number;        // Total messages
  userMessageCount: number;    // User messages
  assistantMessageCount: number; // AI responses
  firstMessage: string;        // First user message
  lastMessage: string;         // Last message in conversation
  messages: ChatMessage[];     // Full message history
  sessionState?: SessionState; // Extracted session data
}

interface ChatMessage {
  type: 'user' | 'assistant' | 'connection' | 'disconnection';
  content: string;
  timestamp: number;           // Epoch timestamp
  metadata?: {
    toolsUsed?: string[];
    processingTimeMs?: number;
  };
}

interface SessionState {
  patientName?: string;
  phoneNumber?: string;
  appointmentScheduled?: boolean;
  appointmentType?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}
```

### Call Recording Object

```typescript
interface CallRecording {
  recordingId: string;         // Unique recording identifier
  callId: string;              // Associated call identifier
  clinicId: string;            // Clinic identifier
  agentId?: string;            // Agent who handled the call
  duration: number;            // Recording duration in seconds
  uploadedAt: string;          // ISO timestamp
  fileSize: number;            // File size in bytes
  format: string;              // Audio format (e.g., 'wav')
  s3Bucket: string;            // S3 bucket name
  s3Key: string;               // S3 object key
  transcriptionStatus?: TranscriptionStatus;
  transcriptionJobName?: string;
  transcriptS3Key?: string;
  sentiment?: SentimentAnalysis;
}

type TranscriptionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

interface SentimentAnalysis {
  overall: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  score: number;
  segments?: SentimentSegment[];
}

interface SentimentSegment {
  text: string;
  sentiment: string;
  confidence: number;
  startTime: number;
  endTime: number;
}
```

### Agent Session Object

```typescript
interface AgentSession {
  agentId: string;             // Agent identifier (email)
  status: AgentStatus;         // Current agent status
  clinicId?: string;           // Currently active clinic
  activeClinicIds: string[];   // Clinics agent can handle
  meetingId?: string;          // Chime meeting ID
  attendeeId?: string;         // Chime attendee ID
  currentCallId?: string;      // Active call ID (if any)
  lastHeartbeat: number;       // Epoch timestamp
  sessionStartTime: number;    // Session start timestamp
  ttl: number;                 // DynamoDB TTL
}

type AgentStatus = 'online' | 'offline' | 'busy' | 'away' | 'on-call';
```

### Call Queue Object

```typescript
interface CallQueueEntry {
  clinicId: string;            // Partition key
  queuePosition: number;       // Sort key
  callId: string;              // Unique call identifier
  pstnCallId?: string;         // PSTN call ID
  phoneNumber: string;         // Caller phone number
  callerName?: string;         // Caller name (if known)
  queueEntryTime: number;      // When call entered queue
  status: CallStatus;          // Current call status
  assignedAgentId?: string;    // Assigned agent
  answeredAt?: number;         // When call was answered
  endedAt?: number;            // When call ended
  duration?: number;           // Call duration in seconds
  holdTime?: number;           // Total hold time in seconds
  notes?: string;              // Agent notes
  ttl: number;                 // DynamoDB TTL
}

type CallStatus = 'queued' | 'ringing' | 'in-progress' | 'on-hold' | 
                  'transferred' | 'completed' | 'missed' | 'abandoned';
```

### Clinic Hours Object

```typescript
interface ClinicHours {
  clinicId: string;            // Clinic identifier (partition key)
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
  timeZone: string;            // IANA timezone (e.g., "America/New_York")
  updatedAt: number;           // Last update timestamp (epoch ms)
  updatedBy: string;           // Email of user who made last update
}

interface DayHours {
  open?: string;               // Opening time in HH:MM format
  close?: string;              // Closing time in HH:MM format
  closed?: boolean;            // If true, clinic is closed that day
}
```

### Clinic Insurance Object

```typescript
interface ClinicInsuranceProvider {
  insuranceProvider: string;   // Insurance provider name
  plans: InsurancePlan[];      // Array of accepted plans
  notes?: string;              // Notes about the provider
}

interface InsurancePlan {
  name: string;                // Plan name
  planName: string;            // Plan name (alias)
  isAccepted: boolean;         // Whether plan is accepted
  accepted: boolean;           // Whether plan is accepted (alias)
  coverageDetails?: string;    // Coverage details description
  details?: string;            // Coverage details (alias)
}

// DynamoDB record structure
interface ClinicInsuranceRecord {
  clinicId: string;            // Partition key
  insuranceProvider_planName: string; // Sort key (format: "Provider#PlanName")
  insuranceProvider: string;   // Insurance provider name
  planName: string;            // Plan name
  isAccepted: boolean;         // Whether plan is accepted
  coverageDetails?: string;    // Coverage details
  notes?: string;              // Notes
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
}
```

### Clinic Pricing Object

```typescript
interface ClinicPricingItem {
  clinicId: string;            // Partition key
  category: string;            // Sort key (service category)
  procedureName?: string;      // Specific procedure name
  minPrice: number;            // Minimum price
  maxPrice: number;            // Maximum price
  description?: string;        // Service description
  isActive: boolean;           // Whether pricing is active
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
}

// Common pricing categories
type PricingCategory = 
  | 'Preventive Care'          // Cleanings, exams, x-rays
  | 'Restorative'              // Fillings, crowns, bridges
  | 'Cosmetic'                 // Whitening, veneers
  | 'Orthodontics'             // Braces, aligners
  | 'Oral Surgery'             // Extractions, implants
  | 'Periodontics'             // Gum treatment
  | 'Endodontics'              // Root canals
  | 'Emergency'                // Emergency services
  | string;                    // Custom categories allowed
```

### Consent Form Object

```typescript
interface ConsentForm {
  consent_form_id: string;    // Unique identifier (UUID)
  templateName: string;       // Name of the consent form template
  elements: FormElement[];    // Array of form elements
  modified_at: string;        // ISO timestamp of last modification
  modified_by: string;        // User who last modified (display name)
}

interface FormElement {
  type: FormElementType;      // Element type
  label: string;              // Display label
  required: boolean;          // Whether field is required
  placeholder?: string;       // Placeholder text (for inputs)
  options?: string[];         // Options (for select elements)
  defaultValue?: any;         // Default value
}

type FormElementType = 
  | 'text'                    // Single-line text input
  | 'textarea'                // Multi-line text input
  | 'checkbox'                // Checkbox for agreements
  | 'date'                    // Date picker
  | 'signature'               // Signature capture field
  | 'select'                  // Dropdown selection
  | 'radio'                   // Radio button group
  | 'number'                  // Numeric input
  | 'email'                   // Email input
  | 'phone';                  // Phone number input
```

### Communication Objects

```typescript
// WebSocket Connection Record
interface WsConnection {
  connectionId: string;        // WebSocket connection ID
  userID: string;              // User identifier (email)
  email: string;               // User email
  ttl: number;                 // TTL for auto-cleanup (epoch seconds)
  connectedAt: string;         // ISO timestamp
}

// Favor Request (Task/Message Thread)
interface FavorRequest {
  favorRequestID: string;      // Unique request ID
  senderID: string;            // Sender's user ID
  receiverID?: string;         // Receiver's user ID (for direct requests)
  teamID?: string;             // Team ID (for group requests)
  userID: string;              // Primary user ID for indexing
  status: FavorStatus;         // Request status
  requestType: RequestType;    // Type of request
  initialMessage: string;      // First message content
  deadline?: string;           // ISO timestamp deadline
  unreadCount: number;         // Unread message count
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
}

type FavorStatus = 'active' | 'resolved';
type RequestType = 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';

// Message Record
interface CommMessage {
  favorRequestID: string;      // Partition key
  timestamp: number;           // Sort key (epoch ms)
  senderID: string;            // Sender's user ID
  content: string;             // Message content
  type: MessageType;           // Message type
  fileKey?: string;            // S3 key for file messages
  fileDetails?: FileDetails;   // File metadata
}

type MessageType = 'text' | 'file';

interface FileDetails {
  fileName: string;            // Original filename
  fileType: string;            // MIME type
  fileSize: number;            // Size in bytes
}

// Team/Group Record
interface Team {
  teamID: string;              // Partition key
  ownerID: string;             // Sort key / owner's user ID
  name: string;                // Team name
  members: string[];           // Array of member user IDs
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
}
```

---

## Example Client Implementation

### JavaScript/TypeScript

```typescript
class TDIApiClient {
  private baseUrl = 'https://apig.todaysdentalinsights.com';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  // Initiate OTP login
  async initiateLogin(email: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  // Verify OTP and get tokens
  async verifyOtp(email: string, code: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    
    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    const data = await response.json();
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
  }

  // Make authenticated request
  private async authRequest(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Auto-refresh if token expired
    if (response.status === 401 && this.refreshToken) {
      await this.refresh();
      return this.authRequest(path, options);
    }
    
    return response;
  }

  // Refresh tokens
  async refresh(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken })
    });
    
    if (!response.ok) {
      throw new Error('Session expired. Please login again.');
    }
    
    const data = await response.json();
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
  }

  // Get callbacks for a clinic
  async getCallbacks(clinicId: string): Promise<any> {
    const response = await this.authRequest(`/callback/${clinicId}`);
    return response.json();
  }

  // Create a callback request (public)
  async createCallback(clinicId: string, data: {
    name: string;
    phone: string;
    email?: string;
    message?: string;
  }): Promise<any> {
    const response = await fetch(`${this.baseUrl}/callback/${clinicId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Register a new user (admin)
  async registerUser(userData: {
    email: string;
    givenName?: string;
    familyName?: string;
    clinics: Array<{ clinicId: string; role: string }>;
  }): Promise<any> {
    const response = await this.authRequest('/admin/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    return response.json();
  }

  // Get all templates user has access to
  async getTemplates(): Promise<any> {
    const response = await this.authRequest('/templates');
    return response.json();
  }

  // Create a new template
  async createTemplate(data: {
    template_name: string;
    module: string;
    email_body: string;
    email_subject?: string;
    text_message?: string;
    clinic_id?: string;
  }): Promise<any> {
    const response = await this.authRequest('/templates', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Update a template
  async updateTemplate(templateId: string, data: {
    template_name: string;
    module: string;
    email_body: string;
    email_subject?: string;
    text_message?: string;
  }): Promise<any> {
    const response = await this.authRequest(`/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Delete a template
  async deleteTemplate(templateId: string): Promise<any> {
    const response = await this.authRequest(`/templates/${templateId}`, {
      method: 'DELETE'
    });
    return response.json();
  }

  // Get call analytics by call ID
  async getCallAnalytics(callId: string): Promise<any> {
    const response = await this.authRequest(`/admin/analytics/call/${callId}`);
    return response.json();
  }

  // Get live call analytics (for active calls)
  async getLiveCallAnalytics(callId: string): Promise<any> {
    const response = await this.authRequest(`/admin/analytics/live?callId=${callId}`);
    return response.json();
  }

  // Get clinic analytics with optional filters
  async getClinicAnalytics(clinicId: string, options?: {
    startTime?: number;
    endTime?: number;
    limit?: number;
    sentiment?: string;
    category?: string;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime.toString());
    if (options?.endTime) params.append('endTime', options.endTime.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.sentiment) params.append('sentiment', options.sentiment);
    if (options?.category) params.append('category', options.category);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.authRequest(`/admin/analytics/clinic/${clinicId}${query}`);
    return response.json();
  }

  // Get agent analytics
  async getAgentAnalytics(agentId: string, options?: {
    startTime?: number;
    endTime?: number;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime.toString());
    if (options?.endTime) params.append('endTime', options.endTime.toString());
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.authRequest(`/admin/analytics/agent/${agentId}${query}`);
    return response.json();
  }

  // Get analytics summary for a clinic
  async getAnalyticsSummary(clinicId: string, options?: {
    startTime?: number;
    endTime?: number;
  }): Promise<any> {
    const params = new URLSearchParams({ clinicId });
    if (options?.startTime) params.append('startTime', options.startTime.toString());
    if (options?.endTime) params.append('endTime', options.endTime.toString());
    
    const response = await this.authRequest(`/admin/analytics/summary?${params.toString()}`);
    return response.json();
  }

  // Get detailed call analytics with transcript and insights
  async getDetailedCallAnalytics(callId: string): Promise<any> {
    const response = await this.authRequest(`/admin/analytics/detailed/${callId}`);
    return response.json();
  }

  // =====================
  // CHATBOT METHODS
  // =====================

  // Connect to chatbot WebSocket (public - no auth required)
  connectToChatbot(clinicId: string, onMessage: (data: any) => void): WebSocket {
    const wsUrl = `wss://ws.todaysdentalinsights.com/chat?clinicId=${clinicId}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };
    
    return ws;
  }

  // Send message to chatbot (via WebSocket)
  sendChatMessage(ws: WebSocket, sessionId: string, message: string): void {
    ws.send(JSON.stringify({
      action: 'sendMessage',
      message,
      sessionId
    }));
  }

  // Get chat history (requires Marketing module read permission)
  async getChatHistory(options?: {
    clinicId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.clinicId) params.append('clinicId', options.clinicId);
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.authRequest(`/chatbot/chat-history${query}`);
    return response.json();
  }

  // Get specific conversation detail
  async getConversationDetail(sessionId: string): Promise<any> {
    const response = await this.authRequest(`/chatbot/chat-history/${sessionId}`);
    return response.json();
  }

  // =====================
  // CHIME/CALL CENTER METHODS
  // =====================

  // Start agent session
  async startAgentSession(activeClinicIds: string[]): Promise<any> {
    const response = await this.authRequest('/admin/chime/start-session', {
      method: 'POST',
      body: JSON.stringify({ activeClinicIds })
    });
    return response.json();
  }

  // Stop agent session
  async stopAgentSession(): Promise<any> {
    const response = await this.authRequest('/admin/chime/stop-session', {
      method: 'POST'
    });
    return response.json();
  }

  // Make outbound call
  async makeOutboundCall(toPhoneNumber: string, fromClinicId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/outbound-call', {
      method: 'POST',
      body: JSON.stringify({ toPhoneNumber, fromClinicId })
    });
    return response.json();
  }

  // Transfer call
  async transferCall(callId: string, options: {
    transferType: 'agent' | 'external';
    targetAgentId?: string;
    targetPhoneNumber?: string;
  }): Promise<any> {
    const response = await this.authRequest('/admin/chime/transfer-call', {
      method: 'POST',
      body: JSON.stringify({ callId, ...options })
    });
    return response.json();
  }

  // Accept call
  async acceptCall(callId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/call-accepted', {
      method: 'POST',
      body: JSON.stringify({ callId })
    });
    return response.json();
  }

  // Reject call
  async rejectCall(callId: string, reason?: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/call-rejected', {
      method: 'POST',
      body: JSON.stringify({ callId, reason })
    });
    return response.json();
  }

  // Hang up call
  async hangupCall(callId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/call-hungup', {
      method: 'POST',
      body: JSON.stringify({ callId })
    });
    return response.json();
  }

  // Leave call (for transfers)
  async leaveCall(callId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/leave-call', {
      method: 'POST',
      body: JSON.stringify({ callId })
    });
    return response.json();
  }

  // Put call on hold
  async holdCall(callId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/hold-call', {
      method: 'POST',
      body: JSON.stringify({ callId })
    });
    return response.json();
  }

  // Resume call from hold
  async resumeCall(callId: string): Promise<any> {
    const response = await this.authRequest('/admin/chime/resume-call', {
      method: 'POST',
      body: JSON.stringify({ callId })
    });
    return response.json();
  }

  // Send heartbeat
  async sendHeartbeat(): Promise<any> {
    const response = await this.authRequest('/admin/chime/heartbeat', {
      method: 'POST'
    });
    return response.json();
  }

  // Get recording
  async getRecording(recordingId: string): Promise<any> {
    const response = await this.authRequest(`/admin/recordings/${recordingId}`);
    return response.json();
  }

  // Get recordings for call
  async getRecordingsForCall(callId: string): Promise<any> {
    const response = await this.authRequest(`/admin/recordings/call/${callId}`);
    return response.json();
  }

  // List recordings for clinic
  async listClinicRecordings(clinicId: string, options?: {
    startTime?: number;
    endTime?: number;
    limit?: number;
    lastEvaluatedKey?: string;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime.toString());
    if (options?.endTime) params.append('endTime', options.endTime.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.lastEvaluatedKey) params.append('lastEvaluatedKey', options.lastEvaluatedKey);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.authRequest(`/admin/recordings/clinic/${clinicId}${query}`);
    return response.json();
  }

  // =====================
  // CLINIC HOURS METHODS
  // =====================

  // List all clinic hours
  async listClinicHours(): Promise<any> {
    const response = await this.authRequest('/clinic-hours/hours');
    return response.json();
  }

  // Get clinic hours for specific clinic
  async getClinicHours(clinicId: string): Promise<any> {
    const response = await this.authRequest(`/clinic-hours/hours/${clinicId}`);
    return response.json();
  }

  // Create clinic hours
  async createClinicHours(data: {
    clinicId: string;
    monday?: { open: string; close: string; closed?: boolean };
    tuesday?: { open: string; close: string; closed?: boolean };
    wednesday?: { open: string; close: string; closed?: boolean };
    thursday?: { open: string; close: string; closed?: boolean };
    friday?: { open: string; close: string; closed?: boolean };
    saturday?: { open: string; close: string; closed?: boolean };
    sunday?: { open: string; close: string; closed?: boolean };
  }): Promise<any> {
    const response = await this.authRequest('/clinic-hours/hours', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Update clinic hours
  async updateClinicHours(clinicId: string, data: {
    monday?: { open: string; close: string; closed?: boolean };
    tuesday?: { open: string; close: string; closed?: boolean };
    wednesday?: { open: string; close: string; closed?: boolean };
    thursday?: { open: string; close: string; closed?: boolean };
    friday?: { open: string; close: string; closed?: boolean };
    saturday?: { open: string; close: string; closed?: boolean };
    sunday?: { open: string; close: string; closed?: boolean };
  }): Promise<any> {
    const response = await this.authRequest(`/clinic-hours/hours/${clinicId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Delete clinic hours
  async deleteClinicHours(clinicId: string): Promise<any> {
    const response = await this.authRequest(`/clinic-hours/hours/${clinicId}`, {
      method: 'DELETE'
    });
    return response.json();
  }

  // =====================
  // CLINIC INSURANCE METHODS
  // =====================

  // Get clinic insurance providers and plans
  async getClinicInsurance(clinicId: string): Promise<any> {
    const response = await this.authRequest(`/clinic-insurance/clinics/${clinicId}/insurance`);
    return response.json();
  }

  // Create insurance provider with plans
  async createClinicInsurance(clinicId: string, data: {
    insuranceProvider: string;
    plans?: Array<{
      name: string;
      isAccepted?: boolean;
      coverageDetails?: string;
    }>;
    notes?: string;
  }): Promise<any> {
    const response = await this.authRequest(`/clinic-insurance/clinics/${clinicId}/insurance`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Update insurance provider (replaces all plans)
  async updateClinicInsurance(clinicId: string, data: {
    insuranceProvider: string;
    plans?: Array<{
      name: string;
      isAccepted?: boolean;
      coverageDetails?: string;
    }>;
    notes?: string;
  }): Promise<any> {
    const response = await this.authRequest(`/clinic-insurance/clinics/${clinicId}/insurance`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Delete insurance provider
  async deleteClinicInsurance(clinicId: string, insuranceProvider: string): Promise<any> {
    const response = await this.authRequest(`/clinic-insurance/clinics/${clinicId}/insurance`, {
      method: 'DELETE',
      body: JSON.stringify({ insuranceProvider })
    });
    return response.json();
  }

  // =====================
  // CLINIC PRICING METHODS
  // =====================

  // Get clinic pricing items
  async getClinicPricing(clinicId: string): Promise<any> {
    const response = await this.authRequest(`/clinic-pricing/clinics/${clinicId}/pricing`);
    return response.json();
  }

  // Create pricing item
  async createClinicPricing(clinicId: string, data: {
    category: string;
    procedureName?: string;
    minPrice?: number;
    maxPrice?: number;
    price?: number;
    description?: string;
    isActive?: boolean;
  }): Promise<any> {
    const response = await this.authRequest(`/clinic-pricing/clinics/${clinicId}/pricing`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Update pricing item
  async updateClinicPricing(clinicId: string, data: {
    category: string;
    procedureName?: string;
    minPrice?: number;
    maxPrice?: number;
    price?: number;
    description?: string;
    isActive?: boolean;
  }): Promise<any> {
    const response = await this.authRequest(`/clinic-pricing/clinics/${clinicId}/pricing`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Delete pricing item
  async deleteClinicPricing(clinicId: string, category: string): Promise<any> {
    const response = await this.authRequest(`/clinic-pricing/clinics/${clinicId}/pricing`, {
      method: 'DELETE',
      body: JSON.stringify({ category })
    });
    return response.json();
  }

  // =====================
  // CONSENT FORM DATA METHODS
  // =====================

  // List all consent forms
  async listConsentForms(): Promise<any> {
    const response = await this.authRequest('/consent-forms');
    return response.json();
  }

  // Get a specific consent form
  async getConsentForm(consentFormId: string): Promise<any> {
    const response = await this.authRequest(`/consent-forms/${consentFormId}`);
    return response.json();
  }

  // Create a new consent form
  async createConsentForm(data: {
    templateName: string;
    elements: Array<{
      type: string;
      label: string;
      required: boolean;
      placeholder?: string;
      options?: string[];
    }>;
  }): Promise<any> {
    const response = await this.authRequest('/consent-forms', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Update an existing consent form
  async updateConsentForm(consentFormId: string, data: {
    templateName: string;
    elements: Array<{
      type: string;
      label: string;
      required: boolean;
      placeholder?: string;
      options?: string[];
    }>;
  }): Promise<any> {
    const response = await this.authRequest(`/consent-forms/${consentFormId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    return response.json();
  }

  // Delete a consent form
  async deleteConsentForm(consentFormId: string): Promise<any> {
    const response = await this.authRequest(`/consent-forms/${consentFormId}`, {
      method: 'DELETE'
    });
    return response.json();
  }

  // =====================
  // COMMUNICATION (WEBSOCKET) METHODS
  // =====================

  private commWs: WebSocket | null = null;
  private commMessageHandlers: Map<string, (data: any) => void> = new Map();

  // Connect to communication WebSocket
  connectToComm(wsUrl: string, onMessage: (action: string, data: any) => void): WebSocket {
    const url = `${wsUrl}?token=${this.accessToken}`;
    this.commWs = new WebSocket(url);
    
    this.commWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data.action, data);
    };
    
    return this.commWs;
  }

  // Disconnect from communication WebSocket
  disconnectFromComm(): void {
    if (this.commWs) {
      this.commWs.close();
      this.commWs = null;
    }
  }

  // Create a favor request
  createFavorRequest(params: {
    receiverID?: string;
    teamID?: string;
    initialMessage: string;
    requestType: 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';
    deadline?: string;
  }): void {
    this.commWs?.send(JSON.stringify({
      action: 'createFavorRequest',
      ...params
    }));
  }

  // Send a message in a favor request
  sendCommMessage(favorRequestID: string, content: string): void {
    this.commWs?.send(JSON.stringify({
      action: 'sendMessage',
      favorRequestID,
      content
    }));
  }

  // Get upload URL for file sharing
  getCommUploadUrl(favorRequestID: string, fileName: string, fileType: string, fileSize: number): void {
    this.commWs?.send(JSON.stringify({
      action: 'getUploadUrl',
      favorRequestID,
      fileName,
      fileType,
      fileSize
    }));
  }

  // Send file message after upload
  sendFileMessage(favorRequestID: string, fileKey: string, fileDetails: {
    fileName: string;
    fileType: string;
    fileSize: number;
  }): void {
    this.commWs?.send(JSON.stringify({
      action: 'sendFileMessage',
      favorRequestID,
      fileKey,
      fileDetails
    }));
  }

  // Get messages for a favor request
  getCommMessages(favorRequestID: string, limit?: number): void {
    this.commWs?.send(JSON.stringify({
      action: 'getMessages',
      favorRequestID,
      limit: limit || 50
    }));
  }

  // Resolve/complete a favor request
  resolveFavorRequest(favorRequestID: string): void {
    this.commWs?.send(JSON.stringify({
      action: 'resolveFavorRequest',
      favorRequestID
    }));
  }

  // Get all favor requests for current user
  getFavorRequests(): void {
    this.commWs?.send(JSON.stringify({
      action: 'getFavorRequests'
    }));
  }

  // Create a team/group
  createTeam(name: string, members: string[]): void {
    this.commWs?.send(JSON.stringify({
      action: 'createTeam',
      name,
      members
    }));
  }

  // Get teams for current user
  getTeams(): void {
    this.commWs?.send(JSON.stringify({
      action: 'getTeams'
    }));
  }

  // Logout
  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken: this.refreshToken })
    });
    
    this.accessToken = null;
    this.refreshToken = null;
  }
}
```

---

## CORS Configuration

All endpoints support the following origins:
- `https://todaysdentalinsights.com`
- Clinic-specific website URLs (configured per clinic)

**Allowed Headers:**
- `Content-Type`
- `Authorization`
- `Origin`
- `Accept`
- `X-Requested-With`

**Allowed Methods:**
- `OPTIONS` (preflight)
- `GET`
- `POST`
- `PUT`
- `DELETE` (where applicable)

---

*Last Updated: December 2024*
*API Version: v1.0*

