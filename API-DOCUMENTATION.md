# Dental Clinic Management API Documentation

This comprehensive API documentation covers user management, call operations, and agent status management for the dental clinic system using **Connect-native architecture**.

## Architecture Overview

The system uses **Amazon Connect-native architecture** with:
- **Attribute-Based Routing (ABR)** for call distribution
- **Connect user hierarchies** for clinic-based organization
- **Connect contact attributes** for call state management
- **Connect APIs** for all user and routing operations
- **Zero DynamoDB dependencies** for Connect functionality

**Note:** Only business logic tables (clinic hours, staff info) remain in DynamoDB. All Connect-specific functionality uses native Connect APIs and features exclusively.

This approach provides maximum scalability, reliability, and seamless integration with Amazon Connect's native capabilities.

## Table of Contents
1. [Authentication](#authentication)
   - [Staff/Admin Login](#staff-admin-login)
   - [Patient Portal Login](#patient-portal-login)
   - [Logout](#logout)
2. [User Management](#user-management)
   - [Register User](#register-user)
   - [Update User](#update-user)
   - [Get Users](#get-users)
   - [Delete User](#delete-user)
3. [Call Operations](#call-operations)
   - [Get Inbound Calls](#get-inbound-calls)
   - [Make Outbound Call](#make-outbound-call)
   - [Accept/Reject Inbound Calls](#accept-reject-inbound-calls)
   - [Get Call History](#get-call-history)
4. [Agent Status Management](#agent-status-management)
   - [Update Agent Status](#update-agent-status)
   - [Check Clinic Access](#check-clinic-access)
   - [Get Agent Events](#get-agent-events)
5. [Connect User Management](#connect-user-management)
   - [Create Connect User](#create-connect-user)
   - [Update Connect User](#update-connect-user)
   - [Delete Connect User](#delete-connect-user)
   - [Describe Connect User](#describe-connect-user)
   - [List Connect Users](#list-connect-users)
   - [Add User to Clinic](#add-user-to-clinic)
   - [Remove User from Clinic](#remove-user-from-clinic)
6. [Callback Management](#callback-management)
   - [Create Callback Request](#create-callback-request)
   - [Get Callbacks](#get-callbacks)
   - [Update Callback Status](#update-callback-status)

## Authentication

The system supports multiple authentication methods for different user types:

1. **Staff/Admin Login** - Email-based OTP authentication via AWS Cognito
2. **Patient Portal Login** - Session-based authentication with Open Dental integration
3. **Logout** - Session cleanup and token invalidation

All API endpoints (except patient portal login and callback creation) require authentication via Bearer token in the Authorization header.

**Common Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

---

### Staff/Admin Login

**Endpoint:** `POST /auth/initiate` (start) → `POST /auth/verify` (complete)

**Description:** Two-step email OTP authentication for staff and administrators using AWS Cognito.

#### Step 1: Initiate Authentication

**Endpoint:** `POST /auth/initiate`

**Request Body:**
```json
{
  "email": "admin@dentistinnewbritain.com"
}
```

**Response:**
```json
{
  "success": true,
  "delivery": "email",
  "session": "cognito-session-id",
  "challengeName": "CUSTOM_CHALLENGE",
  "challengeParameters": {
    "delivery": "email",
    "emailMasked": "a****@dentistinnewbritain.com",
    "ttlSeconds": "300"
  }
}
```

**Features:**
- Email domain restriction (configurable via `ALLOWED_EMAIL_DOMAINS`)
- 6-digit numeric OTP sent via SES
- 5-minute OTP expiration
- Maximum 3 challenge attempts

#### Step 2: Verify OTP

**Endpoint:** `POST /auth/verify`

**Request Body:**
```json
{
  "email": "admin@dentistinnewbritain.com",
  "otp": "123456",
  "session": "cognito-session-id"
}
```

**Response:**
```json
{
  "success": true,
  "idToken": "jwt-id-token",
  "accessToken": "jwt-access-token",
  "refreshToken": "jwt-refresh-token",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**JWT Token Claims:**
```json
{
  "sub": "user-uuid",
  "email": "admin@dentistinnewbritain.com",
  "email_verified": "true",
  "preferred_username": "admin@dentistinnewbritain.com",
  "x_is_super_admin": "true",
  "x_clinics": "ALL",
  "x_rbc": "dentistinnewbritain:A,dentistingreenville:P",
  "x_hourly_pay": "25.50",
  "x_od_usernum": "12345",
  "x_od_username": "admin_user",
  "cognito:groups": [
    "GLOBAL__SUPER_ADMIN",
    "clinic_dentistinnewbritain__ADMIN",
    "clinic_dentistingreenville__PROVIDER"
  ]
}
```

**Role Codes (x_rbc format):**
- `S` - SUPER_ADMIN
- `A` - ADMIN
- `P` - PROVIDER
- `M` - MARKETING
- `U` - USER
- `D` - DOCTOR
- `H` - HYGIENIST
- `DA` - DENTAL_ASSISTANT
- `TC` - TRAINEE
- `PC` - PATIENT_COORDINATOR

**Error Responses:**
```json
{
  "success": false,
  "message": "invalid code"
}
```

---

### Patient Portal Login

**Endpoint:** `GET /patient-portal/{clinicId}/patients/simple`

**Description:** Patient authentication via Open Dental patient records using last name and birthdate.

**Query Parameters:**
- `LName` (required) - Patient's last name
- `Birthdate` (required) - Birthdate in YYYY-MM-DD format
- `FName` (optional) - First name for disambiguation

**Authentication Flow:**
1. Search Open Dental for matching patients
2. Create session token if single match found
3. Return session token for subsequent API calls

**Example Request:**
```
GET /patient-portal/dentistinnewbritain/patients/simple?LName=Doe&Birthdate=1980-01-15&FName=John
```

**Response (Single Match):**
```json
{
  "token": "session-uuid",
  "patient": {
    "PatNum": 12345,
    "FName": "John",
    "LName": "Doe",
    "Birthdate": "1980-01-15",
    "WirelessPhone": "+15551234567"
  }
}
```

**Response (Multiple Matches):**
```json
{
  "ambiguous": true,
  "message": "Multiple records found. Please provide a first name to continue."
}
```

**Response (New Patient):**
```json
null
```

**Session Management:**
- Sessions stored in DynamoDB with 1-hour expiration
- Session format: `Bearer <session-token>`
- Automatic cleanup on logout

**Error Responses:**
```json
{
  "message": "LName and Birthdate are required query parameters."
}
```

---

### Logout

**Endpoint:** `POST /patient-portal/{clinicId}/logout` (Patient Portal)

**Description:** Invalidates patient sessions and cleans up authentication state.

**Request Headers:**
```
Authorization: Bearer <session-token>
```

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

**Staff/Admin Logout:**
- Token-based logout handled by Cognito
- Revoke tokens using Cognito API or SDK
- Clear local storage on frontend

**Required Permissions:** Valid session token

---

## Token Usage

### Staff/Admin JWT Tokens

Include in Authorization header for all admin APIs:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Patient Portal Session Tokens

Include in Authorization header for patient portal APIs:

```
Authorization: Bearer session-uuid
```

### Token Validation

**JWT Claims Available:**
- Standard Cognito claims (sub, email, groups, etc.)
- Custom claims (x_is_super_admin, x_clinics, x_rbc, etc.)
- Role-based access control enforced at API level

**Token Expiration:**
- JWT tokens: 1 hour (configurable)
- Patient sessions: 1 hour
- Refresh tokens available for JWT renewal

---

## User Management

### Register User

**Endpoint:** `POST /admin/register`

**Description:** Register a new user and assign clinic roles with detailed staff information. Connect user creation is **automatic** for all non-super-admin users.

**Request Body:**
```json
{
  "email": "user@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "clinics": [
    {
      "clinicId": "dentistinnewbritain",
      "role": "ADMIN"
    },
    {
      "clinicId": "dentistingreenville",
      "role": "PROVIDER"
    }
  ],
  "makeGlobalSuperAdmin": false,
  "staffDetails": [
    {
      "clinicId": "dentistinnewbritain",
      "UserNum": 12345,
      "UserName": "jdoe",
      "EmployeeNum": 67890,
      "employeeName": "John Doe",
      "ProviderNum": "P12345",
      "providerName": "Dr. John Doe",
      "ClinicNum": "C001",
      "hourlyPay": 25.50
    }
  ],
  "connectSecurityProfileIds": ["agent-security-profile-id"],
  "connectPhoneType": "SOFT_PHONE"
}
```

**Response:**
```json
{
  "success": true,
  "username": "user@example.com",
  "groupsAssigned": [
    "clinic_dentistinnewbritain__ADMIN",
    "clinic_dentistingreenville__PROVIDER"
  ],
  "voiceAgents": {
    "enabled": true,
    "agentsProcessed": 2,
    "results": [...]
  },
  "connectUser": {
    "success": true,
    "message": "Connect user created successfully",
    "connectUserId": "user-id-from-connect",
    "connectUserArn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/user-id",
    "clinics": ["dentistinnewbritain", "dentistingreenville"]
  }
}
```

**Connect User Creation:**

Connect user creation is **automatic** for all non-super-admin users. The system automatically:

- Creates Amazon Connect users in the Connect instance
- Assigns the master routing profile (automatic clinic-based routing via proficiencies)
- Sets up user proficiencies based on assigned clinics
- Configures phone settings and security profiles

**Optional Connect Configuration:**

- `connectSecurityProfileIds` (array, optional): List of Connect security profile IDs. Uses default if not provided.
- `connectPhoneType` (string, optional): Phone type for Connect user - `"SOFT_PHONE"` or `"DESK_PHONE"`. Defaults to `"SOFT_PHONE"`.
- Creates a Connect user with the specified security profiles and phone type
- Sets up proficiencies based on assigned clinic roles (Attribute-Based Routing)
- Creates clinic hierarchy groups for organizational purposes
- User can immediately handle calls for assigned clinics via Connect-native routing
- Note: Voice agents are created in Amazon Connect for users with USER role (Connect-native architecture)

**Roles Available:**
- `SUPER_ADMIN` - Full system access
- `ADMIN` - Clinic administration
- `PROVIDER` - Healthcare provider
- `MARKETING` - Marketing staff
- `USER` - Basic user
- `DOCTOR` - Doctor
- `HYGIENIST` - Dental hygienist
- `DENTAL_ASSISTANT` - Dental assistant
- `TRAINEE` - Trainee
- `PATIENT_COORDINATOR` - Patient coordinator

**Required Permissions:** Super Admin or Clinic Admin

---

### Update User

**Endpoint:** `PUT /admin/users/{username}`

**Description:** Update user information, clinic roles, and staff details.

**Request Body:**
```json
{
  "givenName": "John",
  "familyName": "Doe",
  "clinics": [
    {
      "clinicId": "dentistinnewbritain",
      "role": "ADMIN"
    }
  ],
  "makeGlobalSuperAdmin": false,
  "staffDetails": [
    {
      "clinicId": "dentistinnewbritain",
      "UserNum": 12345,
      "hourlyPay": 30.00,
      "employeeName": "John Doe"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "username": "user@example.com",
  "groupsAssigned": [
    "clinic_dentistinnewbritain__ADMIN"
  ],
  "voiceAgents": {
    "enabled": true,
    "agentsProcessed": 1,
    "results": [...]
  }
}
```

**Required Permissions:** Super Admin or Clinic Admin

---

### Get Users

**Endpoint:** `GET /admin/users` (list) or `GET /admin/users/{username}` (single)

**Description:** Retrieve user information including clinic roles and staff details.

**Query Parameters (for list):**
- `limit` (optional): Number of users to return (1-50, default: 25)
- `nextToken` (optional): Pagination token for next page

**Response (single user):**
```json
{
  "success": true,
  "username": "user@example.com",
  "email": "user@example.com",
  "givenName": "John",
  "familyName": "Doe",
  "groups": [
    "clinic_dentistinnewbritain__ADMIN"
  ],
  "clinics": ["dentistinnewbritain"],
  "rolesByClinic": {
    "dentistinnewbritain": "ADMIN"
  },
  "isSuperAdmin": false,
  "staffDetails": [
    {
      "clinicId": "dentistinnewbritain",
      "UserNum": 12345,
      "UserName": "jdoe",
      "EmployeeNum": 67890,
      "employeeName": "John Doe",
      "ProviderNum": "P12345",
      "providerName": "Dr. John Doe",
      "ClinicNum": "C001",
      "hourlyPay": 25.50,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

**Response (user list):**
```json
{
  "success": true,
  "items": [
    {
      "username": "user1@example.com",
      "email": "user1@example.com",
      "givenName": "Jane",
      "familyName": "Smith",
      "groups": ["clinic_dentistinnewbritain__PROVIDER"],
      "clinics": ["dentistinnewbritain"],
      "rolesByClinic": {
        "dentistinnewbritain": "PROVIDER"
      },
      "isSuperAdmin": false,
      "staffDetails": [...]
    }
  ],
  "nextToken": "..."
}
```

**Required Permissions:** Super Admin or Clinic Admin

---

### Delete User

**Endpoint:** `DELETE /admin/users/{username}`

**Description:** Delete a user and all associated data.

**Response:**
```json
{
  "success": true,
  "username": "user@example.com",
  "deleted": true,
  "voiceAgents": {
    "enabled": true,
    "agentsDeleted": 2,
    "results": [...]
  },
  "staffInfo": {
    "deleted": 1
  }
}
```

**Required Permissions:** Super Admin or Clinic Admin

---

## Call Operations

### Get Inbound Calls

**Endpoint:** Event-driven via `connectEventHandler` (Amazon Connect EventBridge)

**Description:** Automatically processes inbound call events and stores them in the routing table.

**Supported Events:**
- `CONTACT_INITIATED` - New inbound call started
- `CONTACT_CONNECTED` - Call connected to agent
- `CONTACT_DISCONNECTED` - Call ended
- `CONTACT_MISSED` - Call missed/unanswered
- `CONTACT_QUEUED` - Call placed in queue

**Event Data Structure:**
```json
{
  "eventType": "CONTACT_INITIATED",
  "contactId": "contact-uuid",
  "contactAttributes": {
    "clinicId": "dentistinnewbritain",
    "callerNumber": "+15551234567",
    "destinationNumber": "+18333805017"
  },
  "timestamp": "2025-01-01T00:00:00.000Z",
  "instanceId": "connect-instance-id"
}
```

**Database Storage:** Events are stored in `CONNECT_ROUTING_TABLE` with the following structure:
```json
{
  "clinicId": "dentistinnewbritain",
  "contactId": "contact-uuid",
  "routingType": "inbound_call",
  "status": "initiated",
  "initiatedAt": 1735689600000,
  "callerNumber": "+15551234567",
  "destinationNumber": "+18333805017",
  "contactAttributes": {...}
}
```

---

### Make Outbound Call

**Endpoint:** `POST /connect/participant`

**Description:** Initiate an outbound call from a specific clinic's phone number.

**Request Body:**
```json
{
  "action": "start_outbound_call",
  "clinicId": "dentistinnewbritain",
  "destinationNumber": "+15551234567"
}
```

**Response:**
```json
{
  "success": true,
  "contactId": "contact-uuid",
  "message": "Outbound call initiated successfully"
}
```

**Required Permissions:** Authenticated user with clinic access

---

### Accept/Reject Inbound Calls

**Endpoint:** `POST /connect/participant`

**Description:** Accept or reject incoming calls.

**Accept Call Request:**
```json
{
  "action": "accept_inbound_call",
  "contactId": "contact-uuid",
  "participantId": "agent-participant-id"
}
```

**Reject Call Request:**
```json
{
  "action": "reject_inbound_call",
  "contactId": "contact-uuid",
  "participantId": "agent-participant-id"
}
```

**Response:**
```json
{
  "success": true,
  "contactId": "contact-uuid",
  "participantId": "agent-participant-id",
  "message": "Inbound call accepted/rejected successfully"
}
```

**Required Permissions:** Authenticated user with clinic access

---

### Get Call History

**Endpoint:** `POST /connect/participant`

**Description:** Retrieve call history and active contacts for an agent.

**Request Body:**
```json
{
  "action": "get_agent_events",
  "participantId": "agent-participant-id"
}
```

**Response:**
```json
{
  "success": true,
  "agentEvents": [
    {
      "clinicId": "dentistinnewbritain",
      "contactId": "contact-uuid",
      "routingType": "inbound_call",
      "status": "connected",
      "connectedAt": 1735689600000,
      "callerNumber": "+15551234567"
    }
  ],
  "activeContacts": [
    {
      "clinicId": "dentistinnewbritain",
      "contactId": "active-contact-uuid",
      "routingType": "inbound_call",
      "status": "initiated",
      "initiatedAt": 1735689700000
    }
  ],
  "message": "Agent events retrieved successfully"
}
```

**Required Permissions:** Authenticated user with clinic access

---

## Connect User Management (Connect-Native Architecture)

Amazon Connect user management provides comprehensive APIs for managing Connect agents (users) in your instance using **Connect-native architecture**. The system uses:

- **Connect user hierarchies** for clinic-based organization
- **User proficiencies** for Attribute-Based Routing
- **Connect contact attributes** for call state management
- **Connect APIs** for all user operations

**Note:** Connect users are **automatically created** during user registration via the `/admin/register` endpoint. These endpoints are for advanced administrative operations and require super admin privileges.

### Create Connect User (Advanced Admin Operation)

**Endpoint:** `POST /connect/user`

**Description:** Create a new agent in Amazon Connect manually (for advanced administrative operations).

**Request Body:**
```json
{
  "action": "create",
  "username": "agent-username",
  "identityInfo": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@dentistinnewbritain.com"
  },
  "phoneConfig": {
    "phoneType": "SOFT_PHONE",
    "autoAccept": false,
    "afterContactWorkTimeLimit": 0,
    "deskPhoneNumber": ""
  },
  "securityProfileIds": ["security-profile-id-1", "security-profile-id-2"],
  "routingProfileId": "routing-profile-id",
  "password": "SecurePassword123!",
  "hierarchyGroupId": "hierarchy-group-id" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Connect user created successfully",
  "data": {
    "userId": "user-id-from-connect",
    "userArn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/user-id",
    "username": "agent-username"
  }
}
```

### Update Connect User

**Endpoint:** `PUT /connect/user`

**Description:** Update specific aspects of an existing Connect user.

**Request Body:**
```json
{
  "action": "update",
  "updateType": "identity", // "identity", "phone", "security", "routing", "proficiencies"
  "userId": "user-id-from-connect",
  "identityInfo": {
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@dentistinnewbritain.com"
  }
}
```

**Supported Update Types:**
- `identity` - Update name and email (requires `identityInfo`)
- `phone` - Update phone configuration (requires `phoneConfig`)
- `security` - Update security profiles (requires `securityProfileIds`)
- `routing` - Update routing profile (requires `routingProfileId`)
- `proficiencies` - Update user proficiencies (requires `proficiencies`)

**Response:**
```json
{
  "success": true,
  "message": "Connect user identity updated successfully",
  "data": {
    "userId": "user-id-from-connect",
    "identityInfo": { ... },
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

### Delete Connect User

**Endpoint:** `DELETE /connect/user?action=delete&userId=user-id-from-connect`

**Description:** Delete an agent from Amazon Connect.

**Query Parameters:**
- `action`: Must be "delete"
- `userId`: The Connect user ID to delete

**Response:**
```json
{
  "success": true,
  "message": "Connect user deleted successfully",
  "data": {
    "userId": "user-id-from-connect"
  }
}
```

### Describe Connect User

**Endpoint:** `GET /connect/user?action=describe&userId=user-id-from-connect`

**Description:** Get detailed information about a specific Connect user.

**Query Parameters:**
- `action`: Must be "describe"
- `userId`: The Connect user ID to describe

**Response:**
```json
{
  "success": true,
  "message": "Connect user retrieved successfully",
  "data": {
    "UserId": "user-id-from-connect",
    "Username": "agent-username",
    "IdentityInfo": {
      "FirstName": "John",
      "LastName": "Doe",
      "Email": "john.doe@dentistinnewbritain.com"
    },
    "PhoneConfig": {
      "PhoneType": "SOFT_PHONE",
      "AutoAccept": false,
      "AfterContactWorkTimeLimit": 0,
      "DeskPhoneNumber": ""
    },
    "DirectoryUserId": "directory-user-id",
    "SecurityProfileIds": ["security-profile-id"],
    "RoutingProfileId": "routing-profile-id",
    "HierarchyGroupId": "hierarchy-group-id",
    "Tags": {},
    "LastModifiedTime": "2025-01-01T00:00:00.000Z",
    "LastModifiedRegion": "us-east-1"
  }
}
```

### List Connect Users

**Endpoint:** `GET /connect/user?action=list`

**Description:** List all agents in the Amazon Connect instance.

**Query Parameters:**
- `action`: Must be "list"

**Response:**
```json
{
  "success": true,
  "message": "Connect users retrieved successfully",
  "data": {
    "users": [
      {
        "Id": "user-id-1",
        "Arn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/user-id-1",
        "Username": "agent-username-1"
      },
      {
        "Id": "user-id-2",
        "Arn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/user-id-2",
        "Username": "agent-username-2"
      }
    ],
    "nextToken": "next-token-for-pagination"
  }
}
```

### Add User to Clinic

**Endpoint:** `POST /connect/user`

**Description:** Add a system user to a clinic (creates Connect user if needed and updates proficiencies).

**Request Body:**
```json
{
  "action": "add",
  "clinicId": "dentistinnewbritain"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User added to clinic successfully",
  "data": {
    "userId": "system-user-id",
    "clinics": ["dentistinnewbritain"],
    "connectUserId": "connect-user-id",
    "connectUserArn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/connect-user-id",
    "email": "user@domain.com",
    "createdAt": 1735689600000,
    "updatedAt": 1735689600000,
    "createdBy": "system-user-id"
  }
}
```

### Remove User from Clinic

**Endpoint:** `POST /connect/user`

**Description:** Remove a system user from a clinic (updates Connect user proficiencies or deletes if no clinics remain).

**Request Body:**
```json
{
  "action": "remove",
  "clinicId": "dentistinnewbritain"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User removed from clinic successfully",
  "data": {
    "userId": "system-user-id",
    "clinics": [],
    "connectUserId": "connect-user-id",
    "connectUserArn": "arn:aws:connect:us-east-1:account:instance/instance-id/user/connect-user-id",
    "email": "user@domain.com",
    "createdAt": 1735689600000,
    "updatedAt": 1735689600000,
    "createdBy": "system-user-id"
  }
}
```

**Authentication:** All Connect user management endpoints require authentication via Bearer token. Only super admin users can perform create, update, delete, describe, and list operations. Regular users can only add/remove themselves from clinics.

**Error Handling:**
- `400` - Bad request (missing required parameters)
- `401` - Unauthorized (invalid or missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found (user not found)
- `500` - Internal server error (Connect API errors)

---

## Agent Status Management

### Update Agent Status

**Endpoint:** `POST /connect/participant`

**Description:** Update an agent's status in Amazon Connect.

**Request Body:**
```json
{
  "action": "update_agent_status",
  "participantId": "agent-participant-id",
  "agentStatus": "Available"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent status updated successfully"
}
```

**Required Permissions:** Authenticated user with clinic access

---

### Check Clinic Access

**Endpoint:** `POST /connect/access-control`

**Description:** Check user access to a specific clinic and get clinic information.

**Request Body:**
```json
{
  "action": "check",
  "clinicId": "dentistinnewbritain"
}
```

**Response:**
```json
{
  "success": true,
  "access": true,
  "accessLevel": "ADMIN",
  "clinicInfo": {
    "isOpen": true,
    "hours": {
      "monday": {
        "open": "08:00",
        "close": "17:00",
        "open": true
      }
    }
  },
  "message": "Access verified"
}
```

**Required Permissions:** Authenticated user

---

### Get Agent Events

**Endpoint:** `POST /connect/participant`

**Description:** Get recent events and active contacts for an agent.

**Request Body:**
```json
{
  "action": "get_agent_events",
  "participantId": "agent-participant-id"
}
```

**Response:**
```json
{
  "success": true,
  "agentEvents": [
    {
      "clinicId": "dentistinnewbritain",
      "contactId": "contact-uuid",
      "routingType": "inbound_call",
      "status": "connected",
      "connectedAt": 1735689600000
    }
  ],
  "activeContacts": [
    {
      "clinicId": "dentistinnewbritain",
      "contactId": "active-contact-uuid",
      "routingType": "inbound_call",
      "status": "initiated"
    }
  ],
  "message": "Agent events retrieved successfully"
}
```

**Required Permissions:** Authenticated user with clinic access

---

## Callback Management

### Create Callback Request

**Endpoint:** `POST /clinic/callbacks/{clinicId}`

**Description:** Create a callback request (public endpoint for website forms).

**Request Body:**
```json
{
  "name": "John Doe",
  "phone": "+15551234567",
  "email": "john@example.com",
  "message": "Please call me back about an appointment",
  "source": "website"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Callback request created successfully",
  "contact": {
    "RequestID": "uuid",
    "name": "John Doe",
    "phone": "+15551234567",
    "clinicId": "dentistinnewbritain",
    "calledBack": "NO",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z",
    "email": "john@example.com",
    "message": "Please call me back about an appointment",
    "source": "website"
  }
}
```

**Required Permissions:** None (public endpoint)

---

### Get Callbacks

**Endpoint:** `GET /clinic/callbacks/{clinicId}`

**Description:** Retrieve callback requests for a clinic.

**Response:**
```json
[
  {
    "RequestID": "uuid",
    "name": "John Doe",
    "phone": "+15551234567",
    "clinicId": "dentistinnewbritain",
    "calledBack": "NO",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z",
    "email": "john@example.com",
    "message": "Please call me back about an appointment",
    "source": "website",
    "notes": "Called but no answer",
    "updatedBy": "Agent Name"
  }
]
```

**Required Permissions:** Authenticated user with clinic access

---

### Update Callback Status

**Endpoint:** `PUT /clinic/callbacks/{clinicId}`

**Description:** Update callback request status and add notes.

**Request Body:**
```json
{
  "RequestID": "uuid",
  "calledBack": true,
  "notes": "Spoke with patient, scheduled appointment for next week"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Updated"
}
```

**Required Permissions:** Authenticated user with clinic access

---

## Error Handling

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `405` - Method Not Allowed
- `500` - Internal Server Error

**Error Response Format:**
```json
{
  "success": false,
  "message": "Error description"
}
```

## Environment Variables

**Required Environment Variables:**
- `USER_POOL_ID` - Cognito User Pool ID
- `CONNECT_INSTANCE_ID` - Amazon Connect Instance ID
- `CONNECT_USERS_TABLE` - DynamoDB table for Connect users
- `CONNECT_ROUTING_TABLE` - DynamoDB table for call routing
- `CLINIC_HOURS_TABLE` - DynamoDB table for clinic hours
- `STAFF_CLINIC_INFO_TABLE` - DynamoDB table for staff information
- `VOICE_AGENTS_TABLE` - DynamoDB table for voice agents

## Rate Limiting

API endpoints implement standard AWS API Gateway rate limiting. Consider implementing additional rate limiting for high-traffic endpoints.

## WebSocket Integration

For real-time call notifications, implement WebSocket connections using the provided event handlers in `connectEventHandler.ts`.

## Security Considerations

1. All endpoints (except callback creation) require JWT authentication
2. Role-based access control (RBAC) is enforced at the API level
3. Clinic-specific data isolation ensures users only see data for clinics they have access to
4. Input validation is performed on all endpoints
5. CORS headers are configured for cross-origin requests

## Deployment

APIs are deployed as AWS Lambda functions with API Gateway integration. Environment variables should be configured in the deployment environment.

## Support

For technical support or questions about the API, refer to the development team or AWS documentation for the respective services (Cognito, Connect, DynamoDB, Lambda).
