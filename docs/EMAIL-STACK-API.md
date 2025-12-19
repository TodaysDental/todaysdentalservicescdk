# Email Stack API Documentation (TodaysDentalInsightsEmailN1)

## Overview

The Email Stack provides clinic-specific email operations with two integration methods:

1. **Gmail REST API (OAuth2)** - For clinics with Gmail OAuth configured
2. **IMAP/SMTP** - For traditional email access using IMAP for fetching and SMTP for sending

All endpoints are authorized and require clinic-level access permissions.

## Base URL

**Custom Domain (Recommended):**
```
https://apig.todaysdentalinsights.com/email
```

**Default API Gateway URL:**
```
https://{api-id}.execute-api.{region}.amazonaws.com/prod
```

The custom domain URL is exported as `TodaysDentalInsightsEmailN1-EmailCustomDomainUrl` from the CloudFormation stack.

## Authentication

All endpoints require a valid JWT token in the `Authorization` header. The token is validated using the shared authorizer from CoreStack.

```
Authorization: Bearer <your-jwt-token>
```

### Access Control

- **Clinic-level access**: Users can only access email for clinics they have permissions to
- **Domain-level access** (clinicId=`domain`): Requires super admin or global super admin privileges
- Super admins have access to all clinic emails

---

## Gmail REST API Endpoints

The Gmail API uses OAuth2 refresh tokens to access Gmail accounts. Each clinic must have OAuth credentials configured in `clinics.json`:

- `email.gmailUserId` - Gmail account email address
- `email.gmailRefreshToken` - OAuth2 refresh token

### 1. Fetch Inbox Emails (Gmail)

**GET** `/gmail/{clinicId}`

Retrieves the most recent emails from the clinic's Gmail inbox using the Gmail REST API.

#### Path Parameters

| Parameter | Type   | Required | Description                         |
|-----------|--------|----------|-------------------------------------|
| clinicId  | string | Yes      | The clinic identifier (e.g., "TD-001") |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                          |
|-----------|--------|----------|---------|--------------------------------------|
| limit     | number | No       | 5       | Number of emails to retrieve (max: 20) |

#### Example Request

```bash
curl -X GET "https://apig.todaysdentalinsights.com/email/gmail/TD-001?limit=10" \
  -H "Authorization: Bearer <your-jwt-token>"
```

#### Success Response (200)

```json
{
  "message": "Most recent INBOX emails fetched successfully (Gmail REST)",
  "count": 5,
  "emails": [
    {
      "id": "18c3f5a7b9d0e123",
      "threadId": "18c3f5a7b9d0e100",
      "from": "patient@example.com",
      "to": "clinic@todaysdental.com",
      "subject": "Appointment Request",
      "date": "2024-12-19T10:30:00.000Z",
      "internalDate": "2024-12-19T10:30:00.000Z",
      "snippet": "Hi, I would like to schedule an appointment for next week...",
      "text": "Hi, I would like to schedule an appointment for next week. Please let me know your available times. Thank you!"
    }
  ]
}
```

#### Email Response Fields

| Field        | Type   | Description                                    |
|--------------|--------|------------------------------------------------|
| id           | string | Unique Gmail message ID                        |
| threadId     | string | Gmail thread ID (for conversation grouping)    |
| from         | string | Sender email address                           |
| to           | string | Recipient email address(es)                    |
| subject      | string | Email subject line                             |
| date         | string | Email date (ISO 8601)                          |
| internalDate | string | Gmail internal timestamp (ISO 8601)            |
| snippet      | string | Short preview of the email (max 200 chars)     |
| text         | string | Full email body text (max 8000 chars)          |

---

### 2. Send Email (Gmail)

**POST** `/gmail/{clinicId}`

Sends an email using the clinic's Gmail account via Gmail REST API.

#### Path Parameters

| Parameter | Type   | Required | Description                         |
|-----------|--------|----------|-------------------------------------|
| clinicId  | string | Yes      | The clinic identifier (e.g., "TD-001") |

#### Request Body

```json
{
  "to": "recipient@example.com",
  "subject": "Your Appointment Confirmation",
  "body": "Dear Patient,\n\nYour appointment has been confirmed for December 20th at 2:00 PM.\n\nBest regards,\nTodays Dental"
}
```

| Field   | Type   | Required | Description               |
|---------|--------|----------|---------------------------|
| to      | string | Yes      | Recipient email address   |
| subject | string | Yes      | Email subject line        |
| body    | string | Yes      | Email body (plain text)   |

#### Example Request

```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/gmail/TD-001" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "patient@example.com",
    "subject": "Appointment Confirmation",
    "body": "Your appointment is confirmed for December 20th at 2:00 PM."
  }'
```

#### Success Response (200)

```json
{
  "message": "Email sent successfully (Gmail REST)",
  "id": "18c3f5a7b9d0e456",
  "threadId": "18c3f5a7b9d0e400"
}
```

---

## IMAP/SMTP Endpoints

The IMAP/SMTP API uses traditional email protocols for fetching (IMAP) and sending (SMTP) emails.

### Configuration

Clinic email configuration in `clinics.json` supports two provider types:

**New Structure (Recommended):**
```json
{
  "email": {
    "gmail": {
      "imapHost": "imap.gmail.com",
      "imapPort": 993,
      "smtpHost": "smtp.gmail.com",
      "smtpPort": 587,
      "smtpUser": "clinic@gmail.com",
      "smtpPassword": "app-password",
      "fromEmail": "clinic@gmail.com",
      "fromName": "Todays Dental Clinic"
    },
    "domain": {
      "imapHost": "imap.gmail.com",
      "imapPort": 993,
      "smtpHost": "smtp.gmail.com",
      "smtpPort": 587,
      "smtpUser": "clinic@todaysdental.com",
      "smtpPassword": "app-password",
      "fromEmail": "clinic@todaysdental.com",
      "fromName": "Todays Dental Clinic"
    }
  }
}
```

**Legacy Structure (Backward Compatible):**
```json
{
  "email": {
    "imapHost": "imap.gmail.com",
    "imapPort": 993,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "clinic@example.com",
    "smtpPassword": "app-password"
  }
}
```

---

### 3. Fetch Emails (IMAP)

**GET** `/imap/{clinicId}`

Retrieves the most recent emails from the clinic's mailbox using IMAP protocol.

#### Path Parameters

| Parameter | Type   | Required | Description                                              |
|-----------|--------|----------|----------------------------------------------------------|
| clinicId  | string | Yes      | The clinic identifier (e.g., "TD-001") or "domain"       |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                                     |
|-----------|--------|----------|---------|-------------------------------------------------|
| emailType | string | No       | gmail   | Email provider type: `gmail` or `domain`        |

#### Special Values

- `clinicId=domain`: Access domain-level email (todaysdentalinsights.com). **Requires super admin access.**

#### Example Requests

**Fetch clinic Gmail inbox:**
```bash
curl -X GET "https://apig.todaysdentalinsights.com/email/imap/TD-001?emailType=gmail" \
  -H "Authorization: Bearer <your-jwt-token>"
```

**Fetch clinic domain inbox:**
```bash
curl -X GET "https://apig.todaysdentalinsights.com/email/imap/TD-001?emailType=domain" \
  -H "Authorization: Bearer <your-jwt-token>"
```

**Fetch domain-level inbox (super admin only):**
```bash
curl -X GET "https://apig.todaysdentalinsights.com/email/imap/domain" \
  -H "Authorization: Bearer <your-jwt-token>"
```

#### Success Response (200)

```json
{
  "message": "Emails fetched successfully",
  "count": 5,
  "emails": [
    {
      "uid": 12345,
      "from": "patient@example.com",
      "to": "clinic@todaysdental.com",
      "subject": "Question about my bill",
      "date": "2024-12-19T09:15:00.000Z",
      "snippet": "Hi, I have a question about the charges on my recent bill...",
      "text": "Hi, I have a question about the charges on my recent bill. Could you please call me back at (555) 123-4567? Thanks!"
    }
  ]
}
```

#### Email Response Fields

| Field   | Type   | Description                                    |
|---------|--------|------------------------------------------------|
| uid     | number | IMAP unique identifier for the message         |
| from    | string | Sender email address                           |
| to      | string | Recipient email address(es)                    |
| subject | string | Email subject line                             |
| date    | string | Email date (ISO 8601)                          |
| snippet | string | Short preview of the email (max 300 chars)     |
| text    | string | Full email body text                           |
| error   | string | (Optional) Error message if parsing failed     |
| detail  | string | (Optional) Error details if parsing failed     |

---

### 4. Send Email (SMTP)

**POST** `/imap/{clinicId}`

Sends an email using SMTP protocol via the clinic's configured mail server.

#### Path Parameters

| Parameter | Type   | Required | Description                                              |
|-----------|--------|----------|----------------------------------------------------------|
| clinicId  | string | Yes      | The clinic identifier (e.g., "TD-001") or "domain"       |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                                     |
|-----------|--------|----------|---------|-------------------------------------------------|
| emailType | string | No       | gmail   | Email provider type: `gmail` or `domain`        |

#### Request Body

```json
{
  "to": "recipient@example.com",
  "subject": "Your Dental Appointment",
  "body": "Dear Patient,\n\nThis is a reminder about your upcoming appointment.\n\nBest regards,\nTodays Dental"
}
```

| Field   | Type   | Required | Description               |
|---------|--------|----------|---------------------------|
| to      | string | Yes      | Recipient email address   |
| subject | string | Yes      | Email subject line        |
| body    | string | Yes      | Email body (plain text)   |

#### Example Requests

**Send from clinic Gmail account:**
```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/imap/TD-001?emailType=gmail" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "patient@example.com",
    "subject": "Appointment Reminder",
    "body": "Your appointment is tomorrow at 10:00 AM."
  }'
```

**Send from clinic domain account:**
```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/imap/TD-001?emailType=domain" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "patient@example.com",
    "subject": "Appointment Reminder",
    "body": "Your appointment is tomorrow at 10:00 AM."
  }'
```

**Send from domain-level account (super admin only):**
```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/imap/domain" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "admin@example.com",
    "subject": "System Notification",
    "body": "This is a system notification from Todays Dental Insights."
  }'
```

#### Success Response (200)

```json
{
  "message": "Email sent successfully!",
  "info": "250 2.0.0 OK 1703001234 abc123xyz - gsmtp"
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "message": "Error description"
}
```

Or with additional details:

```json
{
  "message": "Error description",
  "error": "Detailed error message"
}
```

### Common HTTP Status Codes

| Code | Description                                                      |
|------|------------------------------------------------------------------|
| 200  | Success                                                          |
| 400  | Bad Request - Missing required parameters or invalid input       |
| 401  | Unauthorized - Missing or invalid authentication                 |
| 403  | Forbidden - User does not have access to the requested clinic    |
| 404  | Not Found - Clinic not found                                     |
| 500  | Internal Server Error - Server-side error                        |

### Common Error Messages

| Error                                                    | Cause                                           |
|----------------------------------------------------------|-------------------------------------------------|
| `Missing clinicId parameter`                             | clinicId not provided in path                   |
| `Clinic not found: {clinicId}`                           | Invalid clinic ID                               |
| `Forbidden: You do not have access to this clinic`       | User lacks permissions for the clinic           |
| `Forbidden: Domain-level email requires super admin access` | Non-admin accessing domain email             |
| `Clinic {clinicId} does not have Gmail OAuth configured` | Missing Gmail refresh token                     |
| `Clinic {clinicId} does not have email configured`       | Missing email configuration                     |
| `Missing to/subject/body in request`                     | Incomplete send email payload                   |
| `Missing SMTP credentials`                               | IMAP/SMTP not configured for clinic             |

---

## Stack Architecture

### Lambda Functions

| Function           | Description                                     | Timeout | Memory |
|--------------------|-------------------------------------------------|---------|--------|
| GmailHandlerFn     | Handles Gmail REST API operations               | 30s     | 512 MB |
| ImapSmtpHandlerFn  | Handles IMAP/SMTP email operations              | 60s     | 512 MB |

### CloudWatch Alarms

Both Lambda functions have configured alarms for:
- **Error Alarm**: Triggers when Lambda errors occur
- **Throttle Alarm**: Triggers when Lambda is throttled

### API Gateway Configuration

| Setting              | Value    |
|----------------------|----------|
| Stage                | prod     |
| Throttling Rate      | 100 RPS  |
| Throttling Burst     | 200      |
| Authorizer Cache TTL | 5 min    |

### Stack Outputs

| Output Name            | Description                        | Export Name                                   |
|------------------------|------------------------------------|-----------------------------------------------|
| EmailApiUrl            | Email API Endpoint URL             | `TodaysDentalInsightsEmailN1-EmailApiUrl`     |
| EmailCustomDomainUrl   | Email API Custom Domain URL        | `TodaysDentalInsightsEmailN1-EmailCustomDomainUrl` |
| GmailHandlerFnArn      | Gmail Handler Lambda ARN           | `TodaysDentalInsightsEmailN1-GmailHandlerFnArn` |
| ImapSmtpHandlerFnArn   | IMAP/SMTP Handler Lambda ARN       | `TodaysDentalInsightsEmailN1-ImapSmtpHandlerFnArn` |

---

## Configuration Reference

### Environment Variables

**Gmail Handler:**
| Variable            | Description                       |
|---------------------|-----------------------------------|
| GMAIL_CLIENT_ID     | Google OAuth2 Client ID           |
| GMAIL_CLIENT_SECRET | Google OAuth2 Client Secret       |

**IMAP/SMTP Handler:**
| Variable              | Description                          |
|-----------------------|--------------------------------------|
| DOMAIN_SMTP_USER      | Domain-level SMTP username           |
| DOMAIN_SMTP_PASSWORD  | Domain-level SMTP password           |
| DOMAIN_IMAP_HOST      | Domain-level IMAP host               |
| DOMAIN_IMAP_PORT      | Domain-level IMAP port               |

### Clinic Configuration (clinics.json)

```json
{
  "clinicId": "TD-001",
  "clinicName": "Todays Dental Cayce",
  "clinicEmail": "cayce@todaysdental.com",
  "email": {
    "gmailUserId": "clinic.email@gmail.com",
    "gmailRefreshToken": "1//0abc...refresh_token...",
    "gmail": {
      "imapHost": "imap.gmail.com",
      "imapPort": 993,
      "smtpHost": "smtp.gmail.com",
      "smtpPort": 587,
      "smtpUser": "clinic.email@gmail.com",
      "smtpPassword": "gmail-app-password",
      "fromEmail": "clinic.email@gmail.com",
      "fromName": "Todays Dental Cayce"
    },
    "domain": {
      "imapHost": "imap.gmail.com",
      "imapPort": 993,
      "smtpHost": "smtp.gmail.com",
      "smtpPort": 587,
      "smtpUser": "cayce@todaysdental.com",
      "smtpPassword": "domain-app-password",
      "fromEmail": "cayce@todaysdental.com",
      "fromName": "Todays Dental Cayce"
    }
  }
}
```

---

## Best Practices

1. **Use Gmail REST API when available**: OAuth2 is more secure than app passwords
2. **Prefer emailType=domain for patient communication**: Maintain professional branding
3. **Monitor CloudWatch alarms**: Set up notifications for Lambda errors
4. **Rotate credentials regularly**: Update app passwords and refresh tokens periodically
5. **Use appropriate rate limiting**: The API is throttled to 100 RPS

---

## Example Use Cases

### Send Appointment Confirmation

```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/gmail/TD-001" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "patient@example.com",
    "subject": "Appointment Confirmed - Todays Dental",
    "body": "Dear Patient,\n\nYour appointment has been confirmed:\n\nDate: December 20, 2024\nTime: 2:00 PM\nLocation: 1234 Main St, Cayce, SC\n\nPlease arrive 15 minutes early.\n\nThank you,\nTodays Dental"
  }'
```

### Check Inbox for New Messages

```bash
curl -X GET "https://apig.todaysdentalinsights.com/email/gmail/TD-001?limit=20" \
  -H "Authorization: Bearer <token>"
```

### Send System Notification (Super Admin)

```bash
curl -X POST "https://apig.todaysdentalinsights.com/email/imap/domain" \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "clinic-manager@example.com",
    "subject": "System Maintenance Notice",
    "body": "Scheduled maintenance will occur on Saturday at 2:00 AM EST."
  }'
```
