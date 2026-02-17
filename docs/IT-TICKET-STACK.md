# IT Ticket Stack

## Overview

The IT Ticket Stack provides a full-stack IT Management System for **Bug Reporting** and **Feature Requests**. Users submit tickets via a unified form, and tickets are automatically assigned to the responsible staff member based on the selected module.

- **Amazon DynamoDB**: NoSQL tables for tickets, comments, and module-assignee mappings
- **Amazon S3**: Object storage for media uploads (images, videos, PDFs)
- **AWS Lambda**: Serverless unified handler for all CRUD operations
- **API Gateway**: RESTful API with JWT authentication and proxy routing
- **Amazon SES**: Email notifications on ticket resolution

## Architecture

### Components

1. **DynamoDB Tables**
   - `Tickets` — Primary ticket storage (bugs & features)
   - `TicketComments` — Conversation threads per ticket
   - `ModuleAssignees` — Module-to-staff auto-assignment configuration

2. **S3 Bucket**
   - Media uploads (screenshots, screen recordings, PDFs)
   - Presigned URL-based upload flow
   - Encrypted at rest, versioned, public access blocked

3. **Lambda Function (Unified Handler)**
   - Single `NodejsFunction` with `{proxy+}` routing pattern
   - Node.js 20.x runtime, ESM output, 512MB memory, 30s timeout
   - Handles all ticket/comment/media/dashboard operations

4. **SES Email Notifications**
   - Automated email on ticket resolution
   - Sent from `no-reply@todaysdentalinsights.com`
   - SES region: `us-east-1`

## File Structure

> **⚠️ Impact on Existing Code:** This stack is **fully independent**. It does **NOT** modify, affect, or break any existing stacks, services, Lambda functions, DynamoDB tables, or S3 buckets. The only existing file touched is `infra.ts` (to register the new stack with 3-4 lines). All other existing stacks listed below are shown only for context — they remain unchanged.

New files marked with **[NEW]**. Existing files shown for context only (no changes).

```
todaysdentalinsightscdk/
├── docs/
│   ├── ADMIN-STACK-API.md
│   ├── AI-AGENTS-STACK-API.md
│   ├── ANALYTICS-STACK-API.md
│   ├── API-DOCUMENTATION.md
│   ├── CHIME-STACK-API.md
│   ├── DENTAL-SOFTWARE-STACK.md
│   ├── EMAIL-STACK-API.md
│   ├── IT-TICKET-STACK.md                              ← This file
│   ├── LEASE-MANAGEMENT-API.md
│   ├── MARKETING-STACK-API.md
│   └── ...
│
├── src/
│   ├── infrastructure/
│   │   ├── infra.ts                                    ← [MODIFY] Register new stack
│   │   └── stacks/
│   │       ├── accounting-stack.ts
│   │       ├── admin-stack.ts
│   │       ├── ai-agents-stack.ts
│   │       ├── analytics-stack.ts
│   │       ├── attendance-stack.ts
│   │       ├── callback-stack.ts
│   │       ├── chatbot-stack.ts
│   │       ├── chime-stack.ts
│   │       ├── clinic-budget-stack.ts
│   │       ├── clinic-cost-stack.ts
│   │       ├── clinic-hours-stack.ts
│   │       ├── clinic-images-stack.ts
│   │       ├── clinic-insurance-stack.ts
│   │       ├── clinic-pricing-stack.ts
│   │       ├── comm-stack.ts
│   │       ├── connect-lex-ai-stack.ts
│   │       ├── consent-form-data-stack.ts
│   │       ├── core-stack.ts
│   │       ├── credentialing-stack.ts
│   │       ├── dental-software-stack.ts
│   │       ├── email-stack.ts
│   │       ├── fee-schedule-sync-stack.ts
│   │       ├── fluoride-automation-stack.ts
│   │       ├── google-ads-stack.ts
│   │       ├── hr-stack.ts
│   │       ├── insurance-automation-stack.ts
│   │       ├── insurance-plan-sync-stack.ts
│   │       ├── it-ticket-stack.ts                      ← [NEW] CDK Stack definition
│   │       ├── lease-management-stack.ts
│   │       ├── marketing-stack.ts
│   │       ├── notifications-stack.ts
│   │       ├── opendental-stack.ts
│   │       ├── patient-portal-stack.ts
│   │       ├── push-notifications-stack.ts
│   │       ├── queries-stack.ts
│   │       ├── query-generator-stack.ts
│   │       ├── rcs-stack.ts
│   │       ├── reports-stack.ts
│   │       ├── schedules-stack.ts
│   │       ├── secrets-stack.ts
│   │       └── templates-stack.ts
│   │
│   ├── services/
│   │   ├── accounting/
│   │   ├── admin/
│   │   ├── ai-agents/
│   │   ├── auth/
│   │   ├── chatbot/
│   │   ├── chime/
│   │   ├── clinic/
│   │   ├── comm/
│   │   ├── connect/
│   │   ├── credentialing/
│   │   ├── dental-software/
│   │   ├── email/
│   │   ├── fee-schedule-sync/
│   │   ├── hr/
│   │   ├── insurance-automation/
│   │   ├── insurance-plan-sync/
│   │   ├── it-ticket/                                  ← [NEW] Service folder
│   │   │   ├── index.ts                                ← [NEW] Main Lambda handler (unified router)
│   │   │   ├── types.ts                                ← [NEW] TypeScript interfaces & enums
│   │   │   └── email-notifier.ts                       ← [NEW] SES email notification helper
│   │   ├── lease-management/
│   │   ├── marketing/
│   │   ├── opendental/
│   │   ├── patient-portal/
│   │   ├── push-notifications/
│   │   ├── query-generator/
│   │   ├── rcs/
│   │   ├── secrets/
│   │   └── shared/
│   │
│   ├── shared/                                         ← Shared utilities (CORS, secrets, etc.)
│   ├── integrations/
│   └── types/
│
├── tests/
├── package.json
└── tsconfig.json
```

## Database Schema

### Table 1: Tickets

Stores all bug reports and feature requests.

**Table Configuration:**

| Property | Value |
|----------|-------|
| Table Name | `{stackName}-Tickets` |
| Partition Key | `ticketId` (STRING) |
| Billing Mode | PAY_PER_REQUEST |
| Removal Policy | RETAIN |
| Point-in-Time Recovery | Enabled |

**Attributes:**

| Attribute | Type | Required | Description | Example Value |
|-----------|------|----------|-------------|---------------|
| `ticketId` | STRING (PK) | ✅ | UUID primary key | `"tkt-a1b2c3d4-5678"` |
| `ticketType` | STRING | ✅ | `"BUG"` or `"FEATURE"` | `"BUG"` |
| `title` | STRING | ✅ | Short summary (max 255 chars) | `"Login page crashes on mobile"` |
| `description` | STRING | ✅ | Detailed description (markdown supported) | `"When clicking login on iOS Safari..."` |
| `module` | STRING | ✅ | Target module (see Module List) | `"HR"` |
| `status` | STRING | ✅ | Current lifecycle status | `"OPEN"` |
| `priority` | STRING | ✅ | Priority level | `"HIGH"` |
| `reporterId` | STRING | ✅ | Staff ID who filed the ticket | `"staff-john-doe-123"` |
| `reporterName` | STRING | ✅ | Display name of reporter | `"John Doe"` |
| `reporterEmail` | STRING | ✅ | Email for resolution notification | `"john@todaysdental.com"` |
| `assigneeId` | STRING | ✅ | Staff ID of auto-assigned person | `"staff-admin-456"` |
| `assigneeName` | STRING | ✅ | Display name of assignee | `"Sarah Admin"` |
| `assigneeEmail` | STRING | ❌ | Email of assignee | `"sarah@todaysdental.com"` |
| `clinicId` | STRING | ✅ | Clinic context | `"clinic-001"` |
| `mediaFiles` | LIST\<MAP\> | ❌ | Uploaded media file references | See Media File Schema |
| `resolution` | STRING | ❌ | Resolution notes (filled on resolve) | `"Fixed in version 2.3.1"` |
| `resolvedAt` | STRING | ❌ | ISO timestamp of resolution | `"2026-02-16T12:00:00Z"` |
| `resolvedBy` | STRING | ❌ | Staff ID who resolved | `"staff-admin-456"` |
| `createdAt` | STRING | ✅ | ISO timestamp | `"2026-02-16T12:00:00Z"` |
| `updatedAt` | STRING | ✅ | ISO timestamp | `"2026-02-16T12:30:00Z"` |

**Enum Values:**

| Field | Allowed Values |
|-------|---------------|
| `ticketType` | `BUG`, `FEATURE` |
| `status` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `REOPENED` |
| `priority` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |

**Media File Sub-Schema (each item in `mediaFiles`):**

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `fileId` | STRING | UUID for the file | `"file-x1y2z3"` |
| `fileName` | STRING | Original file name | `"screenshot.png"` |
| `s3Key` | STRING | S3 object key | `"clinic-001/tkt-abc/file-x1y2z3-screenshot.png"` |
| `contentType` | STRING | MIME type | `"image/png"` |
| `fileSize` | NUMBER | Size in bytes | `245760` |
| `uploadedAt` | STRING | ISO timestamp | `"2026-02-16T12:05:00Z"` |

**Global Secondary Indexes (GSIs):**

| GSI Name | Partition Key | Sort Key | Purpose |
|----------|--------------|----------|---------|
| `byAssignee` | `assigneeId` | `createdAt` | Assignee dashboard — list tickets assigned to a person |
| `byModule` | `module` | `createdAt` | Filter all tickets per module |
| `byStatus` | `status` | `createdAt` | Filter by status (open, resolved, etc.) |
| `byReporter` | `reporterId` | `createdAt` | Reporter can view own submitted tickets |
| `byClinic` | `clinicId` | `createdAt` | Admin can view all tickets per clinic |

**SQL Equivalent:**

```sql
CREATE TABLE tickets (
    ticket_id       VARCHAR(64)   PRIMARY KEY,
    ticket_type     ENUM('BUG', 'FEATURE') NOT NULL,
    title           VARCHAR(255)  NOT NULL,
    description     TEXT          NOT NULL,
    module          VARCHAR(50)   NOT NULL,
    status          ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED') DEFAULT 'OPEN',
    priority        ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') DEFAULT 'MEDIUM',
    reporter_id     VARCHAR(64)   NOT NULL,
    reporter_name   VARCHAR(128)  NOT NULL,
    reporter_email  VARCHAR(255)  NOT NULL,
    assignee_id     VARCHAR(64)   NOT NULL,
    assignee_name   VARCHAR(128)  NOT NULL,
    assignee_email  VARCHAR(255),
    clinic_id       VARCHAR(64)   NOT NULL,
    media_files     JSON,
    resolution      TEXT,
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(64),
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_assignee  (assignee_id, created_at),
    INDEX idx_module    (module, created_at),
    INDEX idx_status    (status, created_at),
    INDEX idx_reporter  (reporter_id, created_at),
    INDEX idx_clinic    (clinic_id, created_at)
);
```

---

### Table 2: TicketComments

Conversation thread on each ticket.

**Table Configuration:**

| Property | Value |
|----------|-------|
| Table Name | `{stackName}-TicketComments` |
| Partition Key | `ticketId` (STRING) |
| Sort Key | `commentId` (STRING) |
| Billing Mode | PAY_PER_REQUEST |
| Removal Policy | RETAIN |

**Attributes:**

| Attribute | Type | Required | Description | Example Value |
|-----------|------|----------|-------------|---------------|
| `ticketId` | STRING (PK) | ✅ | Parent ticket ID | `"tkt-a1b2c3d4-5678"` |
| `commentId` | STRING (SK) | ✅ | UUID for the comment | `"cmt-x1y2z3"` |
| `authorId` | STRING | ✅ | Staff ID of commenter | `"staff-john-doe-123"` |
| `authorName` | STRING | ✅ | Display name | `"John Doe"` |
| `content` | STRING | ✅ | Comment text (markdown) | `"Can reproduce on Chrome too"` |
| `isInternal` | BOOLEAN | ❌ | Internal note flag (default: false) | `false` |
| `createdAt` | STRING | ✅ | ISO timestamp | `"2026-02-16T13:00:00Z"` |

**SQL Equivalent:**

```sql
CREATE TABLE ticket_comments (
    ticket_id    VARCHAR(64)   NOT NULL,
    comment_id   VARCHAR(64)   NOT NULL,
    author_id    VARCHAR(64)   NOT NULL,
    author_name  VARCHAR(128)  NOT NULL,
    content      TEXT          NOT NULL,
    is_internal  BOOLEAN       DEFAULT FALSE,
    created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (ticket_id, comment_id),
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);
```

---

### Table 3: ModuleAssignees

Module-to-staff auto-assignment configuration.

**Table Configuration:**

| Property | Value |
|----------|-------|
| Table Name | `{stackName}-ModuleAssignees` |
| Partition Key | `module` (STRING) |
| Billing Mode | PAY_PER_REQUEST |
| Removal Policy | RETAIN |

**Attributes:**

| Attribute | Type | Required | Description | Example Value |
|-----------|------|----------|-------------|---------------|
| `module` | STRING (PK) | ✅ | Module name | `"HR"` |
| `assigneeId` | STRING | ✅ | Default assignee staff ID | `"staff-admin-456"` |
| `assigneeName` | STRING | ✅ | Display name | `"Sarah Admin"` |
| `assigneeEmail` | STRING | ✅ | Email of assignee | `"sarah@todaysdental.com"` |
| `backupAssigneeId` | STRING | ❌ | Fallback assignee staff ID | `"staff-backup-789"` |
| `backupAssigneeName` | STRING | ❌ | Backup display name | `"Mike Backup"` |
| `updatedAt` | STRING | ✅ | Last updated | `"2026-02-16T12:00:00Z"` |

**Module List (Seed Data):**

| Module | Description |
|--------|-------------|
| `HR` | Human Resources module |
| `Finance` | Accounting & Finance module |
| `Marketing` | Marketing & Social Media module |
| `Dental Software` | Open Dental integration module |
| `Chime` | Call Center / Telephony module |
| `Admin` | Admin panel & user management module |
| `Patient Portal` | Patient-facing portal module |
| `Email` | Email service module |
| `Credentialing` | Staff credentialing module |
| `Insurance` | Insurance automation module |
| `Lease Management` | Lease & property management module |
| `Other` | General / Unclassified |

**SQL Equivalent:**

```sql
CREATE TABLE module_assignees (
    module               VARCHAR(50)   PRIMARY KEY,
    assignee_id          VARCHAR(64)   NOT NULL,
    assignee_name        VARCHAR(128)  NOT NULL,
    assignee_email       VARCHAR(255)  NOT NULL,
    backup_assignee_id   VARCHAR(64),
    backup_assignee_name VARCHAR(128),
    updated_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- Seed data
INSERT INTO module_assignees (module, assignee_id, assignee_name, assignee_email) VALUES
  ('HR', 'staff-hr-lead', 'HR IT Lead', 'hr-it@todaysdental.com'),
  ('Finance', 'staff-finance-lead', 'Finance IT Lead', 'finance-it@todaysdental.com'),
  ('Marketing', 'staff-marketing-lead', 'Marketing IT Lead', 'marketing-it@todaysdental.com'),
  ('Dental Software', 'staff-dental-lead', 'Dental SW IT Lead', 'dental-it@todaysdental.com'),
  ('Chime', 'staff-chime-lead', 'Chime IT Lead', 'chime-it@todaysdental.com'),
  ('Admin', 'staff-super-admin', 'Super Admin', 'admin@todaysdental.com'),
  ('Patient Portal', 'staff-portal-lead', 'Portal IT Lead', 'portal-it@todaysdental.com'),
  ('Email', 'staff-email-lead', 'Email IT Lead', 'email-it@todaysdental.com'),
  ('Credentialing', 'staff-cred-lead', 'Cred IT Lead', 'cred-it@todaysdental.com'),
  ('Insurance', 'staff-insurance-lead', 'Insurance IT Lead', 'insurance-it@todaysdental.com'),
  ('Lease Management', 'staff-lease-lead', 'Lease IT Lead', 'lease-it@todaysdental.com'),
  ('Other', 'staff-general-it', 'General IT Admin', 'it@todaysdental.com');
```

---

## S3 Media Uploads

| Property | Value |
|----------|-------|
| Bucket Name | `todays-dental-it-tickets-media-{accountId}` |
| Key Pattern | `{clinicId}/{ticketId}/{fileId}-{originalName}` |
| Allowed MIME Types | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `video/mp4`, `video/webm`, `video/quicktime`, `application/pdf` |
| Max File Size | 50 MB per file |
| Max Files Per Ticket | 5 |
| Presigned URL Expiry | 3600 seconds (1 hour) |
| Encryption | S3-managed |
| Versioning | Enabled |
| Public Access | Blocked |
| Lifecycle | Old versions → Infrequent Access after 90 days, deleted after 365 days |

**Upload Flow:**

1. Client calls `POST /tickets/{ticketId}/media/upload` with file metadata
2. Lambda generates a presigned PUT URL for S3
3. Client uploads file directly to S3 using the presigned URL
4. Client calls `POST /tickets/{ticketId}/media/confirm` to record the upload in the ticket's `mediaFiles` array

---

## CDK Stack Configuration

### Stack Name

`TodaysDentalInsightsItTicketN1`

### Stack Props

```typescript
export interface ItTicketStackProps extends StackProps {
  staffClinicInfoTableName: string;  // from CoreStack
}
```

### Lambda Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TICKETS_TABLE` | DynamoDB Table | Tickets table name |
| `COMMENTS_TABLE` | DynamoDB Table | TicketComments table name |
| `MODULE_ASSIGNEES_TABLE` | DynamoDB Table | ModuleAssignees table name |
| `MEDIA_BUCKET` | S3 Bucket | Media uploads bucket name |
| `STAFF_CLINIC_INFO_TABLE` | CoreStack prop | Staff info table for lookups |
| `STAFF_USER_TABLE` | Fn.importValue | StaffUser table for user info |
| `FROM_EMAIL` | Hardcoded | `no-reply@todaysdentalinsights.com` |
| `SES_REGION` | Hardcoded | `us-east-1` |
| `PRESIGNED_URL_EXPIRY` | Hardcoded | `3600` |

### IAM Permissions

| Permission | Resource | Actions |
|-----------|----------|---------|
| DynamoDB ReadWrite | Tickets, TicketComments, ModuleAssignees tables | All DynamoDB actions |
| DynamoDB Read | StaffClinicInfo, StaffUser tables | GetItem, Query, Scan |
| S3 ReadWrite | Media bucket | GetObject, PutObject, DeleteObject, HeadObject |
| SES Send | All identities | ses:SendEmail |

### Tags

| Tag | Value |
|-----|-------|
| `Stack` | `{stackName}` |
| `Service` | `ITTicket` |
| `ManagedBy` | `cdk` |

### CloudWatch Alarms

| Alarm | Threshold | Description |
|-------|-----------|-------------|
| Lambda Errors | ≥ 1 per minute | Fires when Lambda has any errors |
| Lambda Throttles | ≥ 1 per minute | Fires when Lambda is throttled |
| Lambda Duration | 80% of timeout (24s) | Fires when duration nears timeout |
| DynamoDB Throttle (per table) | ≥ 1 per minute | Fires when a table is throttled |

### Domain Mapping

| Property | Value |
|----------|-------|
| Domain | `apig.todaysdentalinsights.com` |
| Base Path | `it-ticket` |
| Stage | `prod` |

---

## API Endpoints

Base URL: `https://apig.todaysdentalinsights.com/it-ticket`

All endpoints require JWT authentication via `Authorization` header.

### Create Ticket

```
POST /tickets
Content-Type: application/json

{
  "ticketType": "BUG",
  "title": "Login page crashes on mobile Safari",
  "description": "When clicking the login button on iOS Safari 17.2, the page freezes and shows a white screen. Steps to reproduce:\n1. Open app in Safari on iPhone 15\n2. Enter credentials\n3. Tap Login button\n4. Page freezes",
  "module": "Admin",
  "priority": "HIGH",
  "clinicId": "clinic-001"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Ticket created and assigned successfully",
  "data": {
    "ticketId": "tkt-a1b2c3d4-5678-9012-3456-7890abcdef12",
    "ticketType": "BUG",
    "title": "Login page crashes on mobile Safari",
    "status": "OPEN",
    "priority": "HIGH",
    "module": "Admin",
    "assigneeId": "staff-super-admin",
    "assigneeName": "Super Admin",
    "reporterId": "staff-john-doe-123",
    "reporterName": "John Doe",
    "reporterEmail": "john@todaysdental.com",
    "clinicId": "clinic-001",
    "createdAt": "2026-02-16T12:56:11.000Z",
    "updatedAt": "2026-02-16T12:56:11.000Z"
  }
}
```

### List Tickets (with Filters)

```
GET /tickets?status=OPEN&module=HR&ticketType=BUG&priority=HIGH&clinicId=clinic-001&assigneeId=staff-123&reporterId=staff-456&search=login&dateFrom=2026-01-01&dateTo=2026-02-16&sortBy=createdAt&sortOrder=desc&limit=20&lastKey=xxx
```

**Query Parameters — Filters:**

| Param | Required | Type | Description | Example Values |
|-------|----------|------|-------------|----------------|
| `status` | ❌ | STRING | Filter by ticket status (single or comma-separated for multi) | `OPEN` or `OPEN,IN_PROGRESS` |
| `module` | ❌ | STRING | Filter by module (single or comma-separated) | `HR` or `HR,Finance,Marketing` |
| `ticketType` | ❌ | STRING | Filter by ticket type | `BUG` or `FEATURE` |
| `priority` | ❌ | STRING | Filter by priority (single or comma-separated) | `HIGH` or `HIGH,CRITICAL` |
| `clinicId` | ❌ | STRING | Filter by clinic | `clinic-001` |
| `assigneeId` | ❌ | STRING | Filter by assignee staff ID | `staff-admin-456` |
| `reporterId` | ❌ | STRING | Filter by reporter staff ID | `staff-john-doe-123` |
| `search` | ❌ | STRING | Free-text search in title and description (case-insensitive) | `login crash` |
| `dateFrom` | ❌ | STRING | Filter tickets created on or after this date (ISO date) | `2026-01-01` |
| `dateTo` | ❌ | STRING | Filter tickets created on or before this date (ISO date) | `2026-02-16` |
| `resolvedFrom` | ❌ | STRING | Filter tickets resolved on or after this date | `2026-02-01` |
| `resolvedTo` | ❌ | STRING | Filter tickets resolved on or before this date | `2026-02-16` |
| `hasMedia` | ❌ | BOOLEAN | Filter tickets that have/don't have media attachments | `true` or `false` |

**Query Parameters — Sorting:**

| Param | Required | Type | Description | Values |
|-------|----------|------|-------------|--------|
| `sortBy` | ❌ | STRING | Field to sort by (default: `createdAt`) | `createdAt`, `updatedAt`, `priority`, `status`, `title`, `module` |
| `sortOrder` | ❌ | STRING | Sort direction (default: `desc`) | `asc`, `desc` |

**Query Parameters — Pagination:**

| Param | Required | Type | Description | Values |
|-------|----------|------|-------------|--------|
| `limit` | ❌ | NUMBER | Page size (default: 20, max: 100) | `1`–`100` |
| `lastKey` | ❌ | STRING | Pagination cursor from previous response | Base64-encoded key |

**Filter Examples:**

```
# All open bugs in HR module
GET /tickets?status=OPEN&ticketType=BUG&module=HR

# All critical/high priority tickets across all modules
GET /tickets?priority=HIGH,CRITICAL&sortBy=priority&sortOrder=desc

# All tickets created this month
GET /tickets?dateFrom=2026-02-01&dateTo=2026-02-28

# Search for "login" in open or in-progress tickets
GET /tickets?search=login&status=OPEN,IN_PROGRESS

# All resolved tickets for a specific clinic, sorted by resolution date
GET /tickets?status=RESOLVED&clinicId=clinic-001&sortBy=updatedAt&sortOrder=desc

# All feature requests assigned to a specific person
GET /tickets?ticketType=FEATURE&assigneeId=staff-admin-456

# My submitted tickets (reporter view)
GET /tickets?reporterId=staff-john-doe-123

# Tickets with media attachments in Marketing module
GET /tickets?module=Marketing&hasMedia=true

# Tickets resolved in the last 7 days
GET /tickets?status=RESOLVED&resolvedFrom=2026-02-09&resolvedTo=2026-02-16
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "ticketId": "tkt-a1b2c3d4-5678",
      "ticketType": "BUG",
      "title": "Login page crashes on mobile",
      "status": "OPEN",
      "priority": "HIGH",
      "module": "Admin",
      "assigneeName": "Super Admin",
      "reporterName": "John Doe",
      "clinicId": "clinic-001",
      "hasMedia": true,
      "mediaCount": 1,
      "createdAt": "2026-02-16T12:56:11.000Z",
      "updatedAt": "2026-02-16T12:56:11.000Z"
    }
  ],
  "filters": {
    "applied": {
      "status": ["OPEN"],
      "ticketType": "BUG",
      "module": ["Admin"]
    },
    "sortBy": "createdAt",
    "sortOrder": "desc"
  },
  "pagination": {
    "limit": 20,
    "returned": 1,
    "lastKey": "eyJ0aWNrZXRJZCI6InRrdC0uLi4ifQ==",
    "hasMore": false
  }
}
```

### Get Ticket Details

```
GET /tickets/{ticketId}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "ticketId": "tkt-a1b2c3d4-5678",
    "ticketType": "BUG",
    "title": "Login page crashes on mobile",
    "description": "When clicking login on iOS...",
    "status": "OPEN",
    "priority": "HIGH",
    "module": "Admin",
    "assigneeId": "staff-super-admin",
    "assigneeName": "Super Admin",
    "assigneeEmail": "admin@todaysdental.com",
    "reporterId": "staff-john-doe-123",
    "reporterName": "John Doe",
    "reporterEmail": "john@todaysdental.com",
    "clinicId": "clinic-001",
    "mediaFiles": [
      {
        "fileId": "file-x1y2z3",
        "fileName": "crash-screenshot.png",
        "s3Key": "clinic-001/tkt-a1b2c3d4-5678/file-x1y2z3-crash-screenshot.png",
        "contentType": "image/png",
        "fileSize": 245760,
        "uploadedAt": "2026-02-16T12:58:00.000Z"
      }
    ],
    "createdAt": "2026-02-16T12:56:11.000Z",
    "updatedAt": "2026-02-16T12:56:11.000Z"
  }
}
```

### Update Ticket

```
PUT /tickets/{ticketId}
Content-Type: application/json

{
  "priority": "CRITICAL",
  "status": "IN_PROGRESS"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Ticket updated successfully",
  "data": { /* updated ticket */ }
}
```

### Resolve / Complete Ticket

Marks the ticket as resolved and triggers an email notification to the reporter.

```
PUT /tickets/{ticketId}/resolve
Content-Type: application/json

{
  "resolution": "Fixed the CSS media query that was breaking the login button layout on iOS Safari. Deployed in version 2.3.1."
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Ticket resolved. Email notification sent to reporter.",
  "data": {
    "ticketId": "tkt-a1b2c3d4-5678",
    "status": "RESOLVED",
    "resolution": "Fixed the CSS media query...",
    "resolvedAt": "2026-02-16T14:30:00.000Z",
    "resolvedBy": "staff-super-admin",
    "emailSent": true
  }
}
```

**Email Sent to Reporter:**

> **Subject:** ✅ Your BUG ticket has been resolved — "Login page crashes on mobile"
>
> Hi John,
>
> Your ticket **#tkt-a1b2c3d4-5678** has been resolved.
>
> **Resolution:** Fixed the CSS media query that was breaking the login button layout on iOS Safari. Deployed in version 2.3.1.
>
> **Resolved by:** Super Admin
>
> If you believe this issue is not fully resolved, you can reopen the ticket from your dashboard.

### Reopen Ticket

```
PUT /tickets/{ticketId}/reopen
```

**Response (200):**
```json
{
  "success": true,
  "message": "Ticket reopened",
  "data": { "ticketId": "...", "status": "REOPENED" }
}
```

### Add Comment

```
POST /tickets/{ticketId}/comments
Content-Type: application/json

{
  "content": "I can reproduce this on Chrome 120 as well. Looks like a CSS issue.",
  "isInternal": false
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "ticketId": "tkt-a1b2c3d4-5678",
    "commentId": "cmt-abc123",
    "authorName": "Sarah Admin",
    "content": "I can reproduce this on Chrome 120 as well...",
    "isInternal": false,
    "createdAt": "2026-02-16T13:15:00.000Z"
  }
}
```

### List Comments

```
GET /tickets/{ticketId}/comments
```

**Response (200):**
```json
{
  "success": true,
  "data": [ /* array of comments, sorted by createdAt ascending */ ]
}
```

### Upload Media (Get Presigned URL)

```
POST /tickets/{ticketId}/media/upload
Content-Type: application/json

{
  "fileName": "bug-recording.mp4",
  "contentType": "video/mp4",
  "fileSize": 15728640
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "fileId": "file-m1n2o3",
    "uploadUrl": "https://todays-dental-it-tickets-media-123456.s3.amazonaws.com/clinic-001/tkt-abc/file-m1n2o3-bug-recording.mp4?X-Amz-...",
    "s3Key": "clinic-001/tkt-abc/file-m1n2o3-bug-recording.mp4",
    "expiresIn": 3600
  }
}
```

### Confirm Media Upload

```
POST /tickets/{ticketId}/media/confirm
Content-Type: application/json

{
  "fileId": "file-m1n2o3",
  "fileName": "bug-recording.mp4",
  "s3Key": "clinic-001/tkt-abc/file-m1n2o3-bug-recording.mp4",
  "contentType": "video/mp4",
  "fileSize": 15728640
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Media file attached to ticket",
  "data": { /* updated mediaFiles array */ }
}
```

### Assignee Dashboard (with Filters)

```
GET /dashboard?ticketType=BUG&module=HR&priority=HIGH,CRITICAL&dateFrom=2026-02-01&dateTo=2026-02-16
```

**Query Parameters:**

| Param | Required | Description | Values |
|-------|----------|-------------|--------|
| `ticketType` | ❌ | Filter dashboard counts by type | `BUG`, `FEATURE` |
| `module` | ❌ | Filter by module | Any module name or comma-separated |
| `priority` | ❌ | Filter by priority | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` or comma-separated |
| `dateFrom` | ❌ | Tickets created on/after this date | ISO date `2026-02-01` |
| `dateTo` | ❌ | Tickets created on/before this date | ISO date `2026-02-16` |
| `clinicId` | ❌ | Filter by clinic | Clinic ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalAssigned": 12,
      "open": 5,
      "inProgress": 3,
      "resolved": 4,
      "bugs": 8,
      "features": 4
    },
    "byPriority": {
      "CRITICAL": 1,
      "HIGH": 3,
      "MEDIUM": 5,
      "LOW": 3
    },
    "byModule": {
      "HR": 4,
      "Admin": 3,
      "Marketing": 2,
      "Other": 3
    },
    "recentTickets": [
      {
        "ticketId": "tkt-abc",
        "ticketType": "BUG",
        "title": "Login crashes",
        "status": "OPEN",
        "priority": "CRITICAL",
        "module": "Admin",
        "reporterName": "John Doe",
        "createdAt": "2026-02-16T12:56:11.000Z"
      }
    ],
    "filters": {
      "applied": { "ticketType": "BUG", "module": ["HR"], "priority": ["HIGH", "CRITICAL"], "dateFrom": "2026-02-01", "dateTo": "2026-02-16" }
    }
  }
}
```

### Dashboard Stats (Admin — with Filters)

```
GET /dashboard/stats?clinicId=clinic-001&dateFrom=2026-01-01&dateTo=2026-02-16&ticketType=BUG
```

**Query Parameters:**

| Param | Required | Description | Values |
|-------|----------|-------------|--------|
| `clinicId` | ❌ | Filter stats by clinic | Clinic ID |
| `dateFrom` | ❌ | Stats for tickets created on/after | ISO date |
| `dateTo` | ❌ | Stats for tickets created on/before | ISO date |
| `ticketType` | ❌ | Filter stats by type | `BUG`, `FEATURE` |
| `assigneeId` | ❌ | Filter stats for a specific assignee | Staff ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "byModule": {
      "HR": { "open": 2, "inProgress": 1, "resolved": 5, "total": 8 },
      "Admin": { "open": 1, "inProgress": 0, "resolved": 2, "total": 3 }
    },
    "byType": { "BUG": 7, "FEATURE": 4 },
    "byPriority": { "CRITICAL": 1, "HIGH": 3, "MEDIUM": 5, "LOW": 2 },
    "byAssignee": {
      "staff-hr-lead": { "name": "HR IT Lead", "open": 2, "resolved": 5, "total": 7 },
      "staff-super-admin": { "name": "Super Admin", "open": 1, "resolved": 2, "total": 3 }
    },
    "overall": {
      "total": 11,
      "open": 3,
      "inProgress": 1,
      "resolved": 7,
      "closed": 0,
      "avgResolutionHours": 24.5
    },
    "trend": {
      "last7Days": { "created": 4, "resolved": 3 },
      "last30Days": { "created": 11, "resolved": 7 }
    },
    "filters": {
      "applied": { "clinicId": "clinic-001", "dateFrom": "2026-01-01", "dateTo": "2026-02-16", "ticketType": "BUG" }
    }
  }
}
```

### List Module Assignees

```
GET /modules/assignees
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    { "module": "HR", "assigneeId": "staff-hr-lead", "assigneeName": "HR IT Lead", "assigneeEmail": "hr-it@todaysdental.com" },
    { "module": "Finance", "assigneeId": "staff-finance-lead", "assigneeName": "Finance IT Lead", "assigneeEmail": "finance-it@todaysdental.com" }
  ]
}
```

### Update Module Assignee

```
PUT /modules/assignees/{module}
Content-Type: application/json

{
  "assigneeId": "staff-new-admin-123",
  "assigneeName": "New HR Lead",
  "assigneeEmail": "new-hr@todaysdental.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Module assignee updated",
  "data": { "module": "HR", "assigneeId": "staff-new-admin-123", "assigneeName": "New HR Lead" }
}
```

---

## Filters Reference

This section documents how filters are implemented at the Lambda handler level.

### Supported Filters by Endpoint

| Filter | `/tickets` | `/dashboard` | `/dashboard/stats` | `/tickets/{id}/comments` |
|--------|:----------:|:------------:|:-------------------:|:------------------------:|
| `status` | ✅ multi | ✅ single | ✅ | ❌ |
| `module` | ✅ multi | ✅ multi | ✅ | ❌ |
| `ticketType` | ✅ | ✅ | ✅ | ❌ |
| `priority` | ✅ multi | ✅ multi | ✅ | ❌ |
| `clinicId` | ✅ | ✅ | ✅ | ❌ |
| `assigneeId` | ✅ | ❌ (implicit) | ✅ | ❌ |
| `reporterId` | ✅ | ❌ | ❌ | ❌ |
| `search` | ✅ | ❌ | ❌ | ✅ |
| `dateFrom` / `dateTo` | ✅ | ✅ | ✅ | ❌ |
| `resolvedFrom` / `resolvedTo` | ✅ | ❌ | ✅ | ❌ |
| `hasMedia` | ✅ | ❌ | ❌ | ❌ |
| `sortBy` | ✅ | ❌ | ❌ | ❌ |
| `sortOrder` | ✅ | ❌ | ❌ | ❌ |
| `limit` / `lastKey` | ✅ | ✅ | ❌ | ✅ |

### Multi-Value Filters

Filters marked with **multi** accept comma-separated values:

```
# Multiple statuses
?status=OPEN,IN_PROGRESS

# Multiple modules
?module=HR,Finance,Marketing

# Multiple priorities
?priority=HIGH,CRITICAL
```

The Lambda uses an `IN`-style filter expression in DynamoDB:
```
FilterExpression: '#status IN (:s1, :s2)'
```

### GSI Routing Logic

The Lambda chooses the most efficient DynamoDB GSI based on which filters are provided:

| Filter Combination | GSI Used | Strategy |
|-------------------|----------|----------|
| `assigneeId` only | `byAssignee` | Query PK=assigneeId, SK=createdAt range |
| `module` (single) | `byModule` | Query PK=module, SK=createdAt range |
| `status` (single) | `byStatus` | Query PK=status, SK=createdAt range |
| `reporterId` only | `byReporter` | Query PK=reporterId, SK=createdAt range |
| `clinicId` only | `byClinic` | Query PK=clinicId, SK=createdAt range |
| Multiple filters | Best GSI + FilterExpression | Pick best GSI, apply remaining as FilterExpression |
| No filters | Scan | Full table scan with limit (avoid in production) |

**Priority Order for GSI Selection:**
1. `assigneeId` → `byAssignee` (most specific for dashboard)
2. `clinicId` → `byClinic` (scoped to clinic)
3. `status` → `byStatus` (common filter)
4. `module` → `byModule` (module-specific view)
5. `reporterId` → `byReporter` (reporter's own tickets)
6. Fallback → Scan with FilterExpression

### Date Range Filter Implementation

Date range filters use the `createdAt` sort key on each GSI:

```typescript
// KeyConditionExpression when dateFrom and dateTo are provided:
'#pk = :pkVal AND #sk BETWEEN :dateFrom AND :dateTo'

// When only dateFrom:
'#pk = :pkVal AND #sk >= :dateFrom'

// When only dateTo:
'#pk = :pkVal AND #sk <= :dateTo'
```

### Search Filter Implementation

The `search` parameter performs a case-insensitive contains search on `title` and `description`:

```typescript
// Applied as FilterExpression (post-query)
FilterExpression: 'contains(#title, :search) OR contains(#desc, :search)'
```

> **Note:** Search uses DynamoDB `contains()` which is case-sensitive. The Lambda lowercases both the search term and field values before comparison for case-insensitive matching.

### Sort Implementation

| `sortBy` Value | Implementation |
|----------------|----------------|
| `createdAt` (default) | Uses GSI sort key directly (most efficient) |
| `updatedAt` | Post-query sort in Lambda |
| `priority` | Post-query sort with custom order: CRITICAL > HIGH > MEDIUM > LOW |
| `status` | Post-query sort with custom order: OPEN > IN_PROGRESS > REOPENED > RESOLVED > CLOSED |
| `title` | Post-query alphabetical sort |
| `module` | Post-query alphabetical sort |

### Filter Validation

The Lambda validates all filter values before querying:

| Filter | Validation Rule | Error on Invalid |
|--------|----------------|------------------|
| `status` | Must be one of: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `REOPENED` | 400 Bad Request |
| `ticketType` | Must be: `BUG` or `FEATURE` | 400 Bad Request |
| `priority` | Must be one of: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | 400 Bad Request |
| `module` | Must be a known module from ModuleAssignees table | 400 Bad Request |
| `dateFrom` / `dateTo` | Must be valid ISO date (YYYY-MM-DD) | 400 Bad Request |
| `sortBy` | Must be one of: `createdAt`, `updatedAt`, `priority`, `status`, `title`, `module` | 400 Bad Request |
| `sortOrder` | Must be: `asc` or `desc` | 400 Bad Request |
| `limit` | Must be 1–100 | 400 Bad Request |
| `hasMedia` | Must be `true` or `false` | 400 Bad Request |

---

## Auto-Assignment Logic

When a ticket is created via `POST /tickets`:

1. Lambda reads `ModuleAssignees` table using PK = `request.module`
2. **If mapping found** → sets `assigneeId`, `assigneeName`, `assigneeEmail` from the record
3. **If not found** → assigns to the `"Other"` module's default assignee
4. Ticket is saved with status `OPEN`

```
User submits ticket (module = "HR")
  ↓
Lambda queries ModuleAssignees[PK="HR"]
  ↓
Found: { assigneeId: "staff-hr-lead", assigneeName: "HR IT Lead" }
  ↓
Ticket created with assigneeId = "staff-hr-lead", status = "OPEN"
```

## Resolution Email Flow

When an assignee calls `PUT /tickets/{ticketId}/resolve`:

```
Assignee clicks Resolve
  ↓
Lambda validates: caller.staffId === ticket.assigneeId
  ↓
Updates ticket: status → RESOLVED, resolvedAt, resolvedBy, resolution
  ↓
Calls sendResolutionEmail() via SESv2
  ↓
Email sent to ticket.reporterEmail
  ↓
Response includes emailSent: true
```

---

## Security

- **Authentication**: JWT-based via custom Lambda authorizer (imported from CoreStack)
- **Authorization**: Ticket actions restricted by role (reporter, assignee, admin)
- **Encryption**: DynamoDB and S3 encrypted at rest
- **HTTPS**: All API calls over TLS 1.2+
- **CORS**: Configured via shared `getCdkCorsConfig()` utility
- **Media Uploads**: Presigned URLs with 1-hour expiry, content-type validation

## Deployment

### Prerequisites

1. AWS credentials configured
2. CoreStack deployed (provides authorizer function ARN and StaffClinicInfo table)

### Deploy the Stack

```powershell
npx cdk deploy TodaysDentalInsightsItTicketN1
```

### Seed Module Assignees

After deployment, seed the `ModuleAssignees` table via AWS Console or script with your actual staff assignments.

### Verify

```powershell
# CDK synth validation
npx cdk synth TodaysDentalInsightsItTicketN1 --no-lookups

# TypeScript typecheck
npx tsc --noEmit
```

## Monitoring

- CloudWatch Logs for Lambda function
- CloudWatch Alarms for errors, throttles, and duration
- API Gateway metrics and access logging enabled
- DynamoDB throttle alarms per table

## Future Enhancements

- [ ] Ticket SLA tracking (time-to-resolve targets)
- [ ] Slack/Teams webhook notifications on ticket creation
- [ ] Bulk ticket export (CSV/Excel)
- [ ] Ticket tagging and custom labels
- [ ] AI-powered ticket classification (Bedrock)
- [ ] Recurring bug detection (duplicate detection)
- [ ] Audit trail table for ticket status changes
