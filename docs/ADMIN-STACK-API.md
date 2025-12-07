# Admin Stack API Documentation

## Overview

The Admin Stack provides user management, directory services, presence tracking, and request management APIs. All endpoints (except where noted) require JWT authentication.

**Base URL:** `https://apig.todaysdentalinsights.com/admin`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [User Registration](#2-user-registration)
3. [User Management](#3-user-management)
4. [Directory Lookup](#4-directory-lookup)
5. [Favor Requests](#5-favor-requests)
6. [User Profile (Me)](#6-user-profile-me)
7. [Agent Presence](#7-agent-presence)
8. [Recordings API](#8-recordings-api)
9. [Analytics Routes](#9-analytics-routes)
10. [Chime Integration Routes](#10-chime-integration-routes)
11. [Error Responses](#11-error-responses)
12. [Data Models](#12-data-models)

---

## 1. Authentication

All Admin Stack endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <accessToken>
```

The custom Lambda authorizer validates tokens and caches permissions for 5 minutes.

---

## 2. User Registration

### 2.1 Register New User

Creates a new user account in the system.

**Endpoint:** `POST /admin/register`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization:** Requires `Admin`, `SuperAdmin`, or `Global super admin` role.

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "clinics": [
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
  "makeGlobalSuperAdmin": false
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address (unique identifier) |
| givenName | string | No | User's first name |
| familyName | string | No | User's last name |
| clinics | array | Yes | Clinic role assignments (required for non-global users) |
| clinics[].clinicId | string | Yes | Clinic identifier |
| clinics[].role | string | Yes | Role: `Admin`, `SuperAdmin`, `Office Manager`, `Receptionist`, `Dental Assistant`, `Hygienist`, `Dentist`, `Lab Tech` |
| clinics[].basePay | number | No | Annual base salary |
| clinics[].hourlyPay | number | No | Hourly rate |
| clinics[].moduleAccess | array | No | Module permissions array |
| makeGlobalSuperAdmin | boolean | No | Grant global super admin role (requires Global super admin) |

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

## 3. User Management

### 3.1 List Users

Lists all users. Non-global admins only see users from clinics they have access to.

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
      "clinicRoles": [
        {
          "clinicId": "clinic-123",
          "role": "Office Manager",
          "moduleAccess": [...]
        }
      ],
      "isSuperAdmin": false,
      "isGlobalSuperAdmin": false,
      "isActive": true,
      "staffDetails": [...],
      "rolesByClinic": { "clinic-123": {...} }
    }
  ]
}
```

---

### 3.2 Get User by Username

Retrieves a specific user's details.

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
- Special case: `self` returns authenticated user's own profile

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
  "rolesByClinic": { "clinic-123": {...} }
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 403 | `forbidden: admin or super admin required` | Insufficient privileges |
| 403 | `no access to this user` | User not in caller's clinics |
| 404 | `user not found` | User doesn't exist |

---

### 3.3 Update User

Updates an existing user's information.

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

---

### 3.4 Delete User

Deactivates a user account.

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
- Only `Global super admin` can delete other global super admins

**Success Response (200):**
```json
{
  "success": true,
  "message": "user deleted"
}
```

---

## 4. Directory Lookup

### 4.1 List Directory

Lists all active users for selection in UI components.

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

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| items | array | List of directory entries |
| items[].userID | string | User's unique identifier |
| items[].email | string | User's email address |
| items[].givenName | string | User's first name |
| items[].familyName | string | User's last name |
| nextToken | string | Pagination token (null if no more pages) |

---

## 5. Favor Requests

### 5.1 List Favor Requests

Lists favor requests for the authenticated user.

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
      "teamID": null,
      "status": "pending",
      "title": "Request Title",
      "description": "Request description",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "nextToken": "eyJmYXZvclJlcXVlc3RJRCI6IjU1MGU4NDAwLi4uIn0="
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| role | string | Filter applied |
| items | array | List of favor requests |
| items[].favorRequestID | string | Request unique identifier |
| items[].senderID | string | Sender's user ID |
| items[].receiverID | string | Receiver's user ID (null for team requests) |
| items[].teamID | string | Team ID (for team requests) |
| items[].status | string | Request status: `pending`, `accepted`, `rejected`, `completed` |
| items[].title | string | Request title |
| items[].description | string | Request description |
| nextToken | string | Pagination token |

---

## 6. User Profile (Me)

### 6.1 Get My Clinics

Retrieves clinic information for the authenticated user.

**Endpoint:** `GET /admin/me/clinics`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization:** Any authenticated user.

**Success Response (200):**
```json
{
  "clinics": [
    {
      "clinicId": "clinic-123",
      "clinicName": "Dental Clinic A",
      "role": "Office Manager",
      "moduleAccess": [
        { "module": "Operations", "permissions": ["read", "write"] }
      ],
      "operatingHours": {
        "monday": { "open": "09:00", "close": "17:00" },
        "tuesday": { "open": "09:00", "close": "17:00" }
      }
    }
  ]
}
```

---

## 7. Agent Presence

### 7.1 Get My Presence

Retrieves the current presence/status information for the authenticated agent.

**Endpoint:** `GET /admin/me/presence`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Authorization:** Any authenticated user.

**Success Response (200):**
```json
{
  "agentId": "agent@example.com",
  "status": "Online",
  "activeClinicIds": ["clinic-123", "clinic-456"],
  "meetingInfo": {
    "MeetingId": "abc-123-def",
    "MediaPlacement": {...}
  },
  "attendeeInfo": {
    "AttendeeId": "attendee-123",
    "JoinToken": "..."
  },
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "lastHeartbeatAt": "2024-01-15T10:29:00.000Z",
  "sessionExpiresAt": "2024-01-15T18:30:00.000Z"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| agentId | string | Agent's unique identifier |
| status | string | Current status: `Online`, `Offline`, `OnCall`, `ringing`, `dialing`, `Busy` |
| activeClinicIds | array | Clinics agent is available for |
| meetingInfo | object | Chime meeting details (if active) |
| attendeeInfo | object | Chime attendee details (if active) |
| updatedAt | string | Last update timestamp |
| lastHeartbeatAt | string | Last heartbeat timestamp |
| sessionExpiresAt | string | Session expiry time |

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 404 | `Agent presence not found` | No presence record exists |

---

## 8. Recordings API

### 8.1 Get Recording by ID

Retrieves metadata and download URL for a specific recording.

**Endpoint:** `GET /admin/recordings/{recordingId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| recordingId | string | Recording unique identifier |

**Success Response (200):**
```json
{
  "recordingId": "rec-123456",
  "callId": "call-789",
  "clinicId": "clinic-123",
  "agentId": "agent@example.com",
  "phoneNumber": "+1234567890",
  "direction": "inbound",
  "duration": 185,
  "durationFormatted": "3:05",
  "timestamp": 1705321800,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "fileSize": 2048576,
  "fileSizeFormatted": "2.0 MB",
  "downloadUrl": "https://presigned-url...",
  "downloadUrlExpiresAt": "2024-01-15T11:30:00.000Z",
  "transcription": {
    "status": "completed",
    "text": "Transcription text...",
    "segments": [...]
  },
  "sentiment": {
    "overall": "POSITIVE",
    "scores": { "positive": 0.85, "negative": 0.05, "neutral": 0.10 }
  }
}
```

---

### 8.2 Get Recordings by Call ID

Retrieves all recordings for a specific call.

**Endpoint:** `GET /admin/recordings/call/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| callId | string | Call unique identifier |

**Success Response (200):**
```json
{
  "callId": "call-789",
  "recordings": [
    {
      "recordingId": "rec-123456",
      "duration": 185,
      "timestamp": 1705321800,
      "downloadUrl": "https://presigned-url..."
    }
  ]
}
```

---

### 8.3 Get Recordings by Clinic

Retrieves recordings for a specific clinic.

**Endpoint:** `GET /admin/recordings/clinic/{clinicId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| clinicId | string | Clinic identifier |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| startTime | number | No | Start timestamp (epoch seconds) |
| endTime | number | No | End timestamp (epoch seconds) |
| limit | number | No | Max recordings to return (default: 50) |
| lastEvaluatedKey | string | No | Pagination token |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "recordings": [...],
  "count": 50,
  "hasMore": true,
  "lastEvaluatedKey": "eyJyZWNvcmRpbmdJZCI6InJlYy0xMjM0NTYifQ=="
}
```

---

## 9. Analytics Routes

The Admin Stack exposes analytics endpoints. See [ANALYTICS-STACK-API.md](./ANALYTICS-STACK-API.md) for detailed documentation.

| Endpoint | Description |
|----------|-------------|
| `GET /admin/analytics/call/{callId}` | Get analytics for specific call |
| `GET /admin/analytics/clinic/{clinicId}` | Get analytics for clinic |
| `GET /admin/analytics/agent/{agentId}` | Get analytics for agent |
| `GET /admin/analytics/summary` | Get aggregate metrics |
| `GET /admin/analytics/live` | Get real-time call analytics |
| `GET /admin/analytics/rankings` | Get agent rankings/leaderboard |
| `GET /admin/analytics/queue` | Get calls in queue |
| `GET /admin/analytics/detailed/{callId}` | Get comprehensive call analytics |
| `GET /admin/analytics/dashboard` | Get unified dashboard metrics |

---

## 10. Chime Integration Routes

The Admin Stack exposes Chime call control endpoints. See [CHIME-STACK-API.md](./CHIME-STACK-API.md) for detailed documentation.

| Endpoint | Description |
|----------|-------------|
| `POST /admin/chime/start-session` | Start agent session |
| `POST /admin/chime/stop-session` | Stop agent session |
| `POST /admin/chime/outbound-call` | Initiate outbound call |
| `POST /admin/chime/transfer-call` | Transfer active call |
| `POST /admin/chime/call-accepted` | Accept incoming call |
| `POST /admin/chime/call-rejected` | Reject incoming call |
| `POST /admin/chime/call-hungup` | End active call |
| `POST /admin/chime/leave-call` | Leave call without ending |
| `POST /admin/chime/heartbeat` | Send agent heartbeat |
| `POST /admin/chime/hold-call` | Place call on hold |
| `POST /admin/chime/resume-call` | Resume call from hold |

---

## 11. Error Responses

### Common Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource conflict (e.g., duplicate user) |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Server-side error |

### Error Response Format

```json
{
  "message": "Human-readable error message",
  "error": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

---

## 12. Data Models

### User Object

```typescript
interface User {
  email: string;                    // Primary key
  givenName?: string;
  familyName?: string;
  clinicRoles: ClinicRole[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ClinicRole {
  clinicId: string;
  role: string;
  basePay?: number;
  hourlyPay?: number;
  moduleAccess?: ModuleAccess[];
}

interface ModuleAccess {
  module: string;
  permissions: string[];           // 'read', 'write', 'put', 'delete'
}
```

### Available Roles

| Role | Description |
|------|-------------|
| `Admin` | Clinic administrator |
| `SuperAdmin` | Super administrator for clinic |
| `Global super admin` | Platform-wide super admin |
| `Office Manager` | Office management staff |
| `Receptionist` | Front desk staff |
| `Dental Assistant` | Clinical support |
| `Hygienist` | Dental hygienist |
| `Dentist` | Dental practitioner |
| `Lab Tech` | Laboratory technician |

### Available Modules

| Module | Description |
|--------|-------------|
| `HR` | Human resources |
| `Operations` | Clinical operations |
| `Marketing` | Marketing and outreach |
| `Finance` | Financial management |
| `Inventory` | Inventory management |
| `Patients` | Patient records |
| `Scheduling` | Appointment scheduling |
| `Reporting` | Reports and analytics |

---

## Rate Limiting

| Endpoint Category | Rate Limit |
|-------------------|------------|
| Read operations | 100 requests/minute |
| Write operations | 50 requests/minute |
| Directory lookup | 200 requests/minute |

---

## Security Notes

1. All endpoints require HTTPS
2. JWT tokens expire after 1 hour
3. Refresh tokens expire after 30 days
4. Token blacklisting is enforced on logout
5. CORS is configured for authorized origins only
6. Non-global admins are scoped to their assigned clinics

