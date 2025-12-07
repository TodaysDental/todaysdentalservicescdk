# Chime Stack API Documentation

## Overview

The Chime Stack provides voice/call center functionality using Amazon Chime SDK. It handles agent sessions, inbound/outbound calls, call transfers, call hold/resume, DTMF/keypad tones, call notes, conference calling, and recording capabilities.

**Base URL:** `https://apig.todaysdentalinsights.com/admin/chime`

All endpoints require JWT authentication via the Authorization header.

---

## Table of Contents

1. [Agent Session Management](#1-agent-session-management)
2. [Call Operations](#2-call-operations)
3. [Call Control](#3-call-control)
   - 3.1 Accept Call
   - 3.2 Reject Call
   - 3.3 Hang Up Call
   - 3.4 Leave Call
   - 3.5 Hold Call
   - 3.6 Resume Call
   - 3.7 Add Call (Second Call)
   - 3.8 Send DTMF (Keypad)
   - 3.9 Call Notes
   - 3.10 Conference Call
4. [Agent Heartbeat](#4-agent-heartbeat)
5. [WebSocket Events](#5-websocket-events)
6. [Error Responses](#6-error-responses)
7. [Data Models](#7-data-models)
8. [Infrastructure Components](#8-infrastructure-components)

---

## 1. Agent Session Management

### 1.1 Start Session

Initiates an agent session, creating a Chime meeting and marking the agent as online.

**Endpoint:** `POST /admin/chime/start-session`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "activeClinicIds": ["clinic-123", "clinic-456"]
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| activeClinicIds | string[] | Yes | Clinics agent is available to handle calls for |

**Success Response (200):**
```json
{
  "meeting": {
    "MeetingId": "abc-123-def-456",
    "MediaRegion": "us-east-1",
    "MediaPlacement": {
      "AudioHostUrl": "wss://haxrp.m1.ue1.app.chime.aws:443/...",
      "AudioFallbackUrl": "wss://haxrp.m1.ue1.app.chime.aws:443/...",
      "SignalingUrl": "wss://signal.m1.ue1.app.chime.aws/...",
      "TurnControlUrl": "https://ccp.cp.ue1.app.chime.aws/..."
    },
    "ExternalMeetingId": "agent-session-uuid"
  },
  "attendee": {
    "AttendeeId": "attendee-uuid",
    "ExternalUserId": "agent@example.com",
    "JoinToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| meeting | object | Chime meeting configuration |
| meeting.MeetingId | string | Unique meeting identifier |
| meeting.MediaRegion | string | AWS region for media (us-east-1) |
| meeting.MediaPlacement | object | WebSocket URLs for audio/signaling |
| attendee | object | Agent's attendee credentials |
| attendee.AttendeeId | string | Unique attendee identifier |
| attendee.JoinToken | string | Token for joining the meeting |

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `activeClinicIds array is required` | Missing clinic IDs |
| 403 | `Forbidden: not authorized for clinic X` | Agent not assigned to clinic |
| 403 | `Invalid token: missing sub` | Invalid JWT token |
| 500 | `Failed to create meeting` | Chime SDK error |

**Usage Example:**
```javascript
const response = await fetch('https://apig.todaysdentalinsights.com/admin/chime/start-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({
    activeClinicIds: ['clinic-123']
  })
});

const { meeting, attendee } = await response.json();

// Use with Chime SDK client
const meetingSession = new DefaultMeetingSession(
  new MeetingSessionConfiguration(meeting, attendee),
  logger,
  deviceController
);
```

---

### 1.2 Stop Session

Ends an agent session and marks the agent as offline.

**Endpoint:** `POST /admin/chime/stop-session`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:** None required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Session stopped successfully"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Unauthorized` | Missing or invalid token |
| 500 | `Failed to stop session` | Server error |

---

## 2. Call Operations

### 2.1 Outbound Call

Initiates an outbound call to a customer.

**Endpoint:** `POST /admin/chime/outbound-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "toPhoneNumber": "+12025551234",
  "fromClinicId": "clinic-123"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| toPhoneNumber | string | Yes | Destination phone number (E.164 format) |
| fromClinicId | string | Yes | Clinic to make call from |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Outbound call initiated.",
  "callId": "call-transaction-uuid",
  "callReference": "outbound-1705321800000-agent@example.com"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether call was initiated |
| callId | string | SIP transaction ID |
| callReference | string | Internal call reference |

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `toPhoneNumber and fromClinicId are required` | Missing parameters |
| 400 | `Invalid phone number format` | Phone validation failed |
| 400 | `Agent session is invalid` | No active session |
| 403 | `Forbidden: not authorized for clinic` | No clinic access |
| 404 | `Clinic phone number not found` | Clinic not configured |
| 409 | `Agent is already on another call` | Agent busy |
| 429 | `All outbound lines are currently in use` | Rate limited |
| 500 | `Failed to make outbound call` | Server error |

**Phone Number Format:**
- Must be E.164 format: `+[country code][number]`
- Examples: `+12025551234`, `+447700900123`

**Outbound Call States:**

The agent's presence record is updated with detailed state information during outbound calls:

| dialingState | Description | Frontend Action |
|--------------|-------------|-----------------|
| `initiated` | Call initiated, SMA processing | Show "Dialing..." |
| `ringing` | Far end is ringing | Play ringback tone, show "Ringing..." |
| (removed) | Call connected or ended | Stop ringback, update UI |

**Call End Reasons (for failed outbound calls):**

| Reason | User Message | SIP Code |
|--------|--------------|----------|
| `busy` | "Line is busy" | 486 |
| `no_answer` | "No answer - call timed out" | 480 |
| `declined` | "Call was declined" | 603 |
| `cancelled` | "Call was cancelled" | 487 |
| `invalid_number` | "Number not found or invalid" | 404 |
| `timeout` | "Call timed out" | 408 |
| `voicemail` | "Went to voicemail" | 200 (short duration) |
| `network_error` | "Network error - please try again" | 502, 504 |

**Frontend Integration Notes:**

1. **Ringback Tone:** When `dialingState === 'ringing'`, the frontend should play a local ringback audio file
2. **Call End Notification:** Check `lastDialingFailed` and `lastCallEndMessage` for user feedback
3. **Poll or Subscribe:** Use heartbeat/WebSocket to detect state changes

---

### 2.2 Transfer Call

Transfers an active call to another agent or external number.

**Endpoint:** `POST /admin/chime/transfer-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid",
  "transferTo": "target-agent@example.com",
  "transferType": "warm"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | Call to transfer |
| transferTo | string | Yes | Target agent ID or phone number |
| transferType | string | No | `warm` (default) or `cold` |

**Transfer Types:**
- **Warm Transfer:** Agent introduces caller to target before disconnecting
- **Cold Transfer:** Immediate transfer without introduction

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call transfer initiated",
  "transferId": "transfer-uuid"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `callId and transferTo are required` | Missing parameters |
| 404 | `Call not found` | Invalid call ID |
| 404 | `Target agent not available` | Agent offline |
| 409 | `Call is not in a transferable state` | Call state invalid |

---

## 3. Call Control

### 3.1 Accept Call

Accepts an incoming call that is ringing.

**Endpoint:** `POST /admin/chime/call-accepted`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call accepted",
  "callInfo": {
    "callId": "call-uuid",
    "phoneNumber": "+12025551234",
    "clinicId": "clinic-123",
    "direction": "inbound"
  }
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `callId is required` | Missing call ID |
| 404 | `Call not found or already answered` | Invalid state |
| 409 | `Call already claimed by another agent` | Race condition |

---

### 3.2 Reject Call

Rejects an incoming call, sending it back to queue.

**Endpoint:** `POST /admin/chime/call-rejected`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid",
  "reason": "busy"
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | Call to reject |
| reason | string | No | Rejection reason: `busy`, `unavailable`, `other` |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call rejected and returned to queue"
}
```

---

### 3.3 Hang Up Call

Ends the current active call.

**Endpoint:** `POST /admin/chime/call-hungup`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call ended",
  "callDuration": 185,
  "callDurationFormatted": "3:05"
}
```

---

### 3.4 Leave Call

Agent leaves the call without ending it (for transfers or supervisor joins).

**Endpoint:** `POST /admin/chime/leave-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Left call successfully"
}
```

---

### 3.5 Hold Call

Places the active call on hold.

**Endpoint:** `POST /admin/chime/hold-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call placed on hold",
  "holdStartTime": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `callId is required` | Missing call ID |
| 404 | `Call not found` | Invalid call ID |
| 409 | `Call is already on hold` | Already held |

---

### 3.6 Resume Call

Resumes a call from hold.

**Endpoint:** `POST /admin/chime/resume-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call resumed",
  "holdDuration": 45
}
```

---

### 3.7 Add Call

Initiates a second call while on an existing call (for consultations, warm transfers, or conference calls).

**Endpoint:** `POST /admin/chime/add-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "primaryCallId": "call-uuid",
  "toPhoneNumber": "+12025551234",
  "fromClinicId": "clinic-123",
  "holdPrimaryCall": true
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| primaryCallId | string | Yes | Current active call ID |
| toPhoneNumber | string | Yes | Phone number to dial (E.164 format) |
| fromClinicId | string | Yes | Clinic to make call from |
| holdPrimaryCall | boolean | No | Whether to hold primary call (default: true) |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Secondary call initiated",
  "secondaryCallId": "secondary-call-uuid",
  "primaryCallId": "call-uuid",
  "primaryCallOnHold": true
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `primaryCallId, toPhoneNumber, and fromClinicId are required` | Missing parameters |
| 404 | `Agent session not found` | No active session |
| 409 | `Agent is not on the specified primary call` | Not on call |
| 409 | `Agent already has a secondary call active` | Already on two calls |

---

### 3.8 Send DTMF

Sends DTMF (keypad) tones to the far end of an active call.

**Endpoint:** `POST /admin/chime/send-dtmf`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:**
```json
{
  "callId": "call-uuid",
  "digits": "1234#",
  "durationMs": 250,
  "gapMs": 50
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | Active call ID |
| digits | string | Yes | DTMF digits (0-9, *, #, max 32 chars) |
| durationMs | number | No | Tone duration in ms (50-1000, default: 250) |
| gapMs | number | No | Gap between tones in ms (0-500, default: 50) |

**Success Response (200):**
```json
{
  "success": true,
  "message": "DTMF tones sent",
  "callId": "call-uuid",
  "digitsLength": 5
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `callId and digits are required` | Missing parameters |
| 400 | `Invalid DTMF digits` | Invalid characters |
| 403 | `You are not on this call` | Not authorized |
| 409 | `Cannot send DTMF when call is on_hold` | Invalid call state |

---

### 3.9 Call Notes

Manage notes for calls (create, read, update, delete).

#### Get Notes

**Endpoint:** `GET /admin/chime/call-notes` or `GET /admin/chime/call-notes/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Success Response (200):**
```json
{
  "success": true,
  "callId": "call-uuid",
  "notes": [
    {
      "noteId": "note-uuid",
      "callId": "call-uuid",
      "agentId": "agent@example.com",
      "content": "Patient requesting callback for billing question",
      "noteType": "callback",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "isPrivate": false
    }
  ],
  "totalNotes": 1
}
```

#### Create Note

**Endpoint:** `POST /admin/chime/call-notes`

**Request Body:**
```json
{
  "callId": "call-uuid",
  "content": "Patient mentioned dental anxiety",
  "noteType": "medical",
  "isPrivate": false
}
```

**Request Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | Call ID |
| content | string | Yes | Note content (max 5000 chars) |
| noteType | string | No | Type: `general`, `followup`, `important`, `medical`, `billing`, `callback` |
| isPrivate | boolean | No | Only visible to creator (default: false) |

**Success Response (201):**
```json
{
  "success": true,
  "message": "Note created",
  "note": {
    "noteId": "note-uuid",
    "callId": "call-uuid",
    "agentId": "agent@example.com",
    "content": "Patient mentioned dental anxiety",
    "noteType": "medical",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "isPrivate": false
  }
}
```

#### Update Note

**Endpoint:** `PUT /admin/chime/call-notes`

**Request Body:**
```json
{
  "callId": "call-uuid",
  "noteId": "note-uuid",
  "content": "Updated note content",
  "noteType": "important"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Note updated",
  "note": { ... }
}
```

#### Delete Note

**Endpoint:** `DELETE /admin/chime/call-notes`

**Request Body:**
```json
{
  "callId": "call-uuid",
  "noteId": "note-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Note deleted",
  "noteId": "note-uuid"
}
```

**Error Responses (All Note Operations):**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Note content is required` | Missing content |
| 400 | `Note content exceeds maximum length` | Content too long |
| 403 | `You can only update/delete your own notes` | Not owner |
| 404 | `Call not found` | Invalid call ID |
| 404 | `Note not found` | Invalid note ID |

---

### 3.10 Conference Call

Manage 3-way conference calls (merge, add participants, remove, end).

**Endpoint:** `POST /admin/chime/conference-call`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

#### Merge Calls

Merge primary and secondary calls into a 3-way conference.

**Request Body:**
```json
{
  "action": "merge",
  "primaryCallId": "call-uuid-1",
  "secondaryCallId": "call-uuid-2"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Calls merged into conference",
  "conferenceId": "conference-uuid",
  "participants": [
    { "callId": "call-uuid-1", "role": "primary", "phoneNumber": "+12025551234" },
    { "callId": "call-uuid-2", "role": "secondary", "phoneNumber": "+12025555678" }
  ],
  "meetingId": "meeting-uuid"
}
```

#### Add Participant

Add a new participant to an existing conference.

**Request Body:**
```json
{
  "action": "add",
  "conferenceId": "conference-uuid",
  "callIdToAdd": "call-uuid-3"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Participant added to conference",
  "conferenceId": "conference-uuid",
  "addedCallId": "call-uuid-3",
  "totalParticipants": 3
}
```

#### Remove Participant

Remove a participant from the conference (only that participant is disconnected).

**Request Body:**
```json
{
  "action": "remove",
  "conferenceId": "conference-uuid",
  "callIdToRemove": "call-uuid-2"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Participant removed from conference",
  "conferenceId": "conference-uuid",
  "removedCallId": "call-uuid-2",
  "remainingParticipants": 2
}
```

#### End Conference

End the entire conference, disconnecting all participants.

**Request Body:**
```json
{
  "action": "end",
  "conferenceId": "conference-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Conference ended",
  "conferenceId": "conference-uuid",
  "endedCalls": 3
}
```

**Conference Actions:**
| Action | Description |
|--------|-------------|
| `merge` | Merge primary and secondary calls into conference |
| `add` | Add a participant to existing conference |
| `remove` | Remove a participant from conference |
| `end` | End entire conference |

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `action is required` | Missing action |
| 400 | `Both primary and secondary calls are required for merge` | Missing call IDs |
| 400 | `No active conference` | No conference found |
| 403 | `Agent is not on the primary call` | Not authorized |
| 404 | `One or both calls not found` | Invalid call IDs |

---

## 4. Agent Heartbeat

### 4.1 Send Heartbeat

Updates agent's presence and extends session TTL.

**Endpoint:** `POST /admin/chime/heartbeat`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Request Body:** None required

**Success Response (200):**
```json
{
  "success": true,
  "status": "Online",
  "sessionExpiresAt": "2024-01-15T18:30:00.000Z",
  "nextHeartbeatBy": "2024-01-15T10:31:00.000Z"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Heartbeat recorded |
| status | string | Current agent status |
| sessionExpiresAt | string | Session expiry time |
| nextHeartbeatBy | string | Recommended next heartbeat time |

**Heartbeat Timing:**
- Send heartbeat every 30 seconds
- Session expires after 5 minutes without heartbeat
- Cleanup monitor runs every 5 minutes to mark stale agents offline

---

## 5. WebSocket Events

When using the Chime SDK, the following events are emitted:

### Agent Status Events

```javascript
// Agent status changed
{
  "type": "AGENT_STATUS_CHANGED",
  "agentId": "agent@example.com",
  "status": "OnCall",
  "previousStatus": "Online",
  "timestamp": "2024-01-15T10:30:00.000Z"
}

// Incoming call notification
{
  "type": "INCOMING_CALL",
  "callId": "call-uuid",
  "phoneNumber": "+12025551234",
  "clinicId": "clinic-123",
  "queuePosition": 1,
  "waitTime": 30
}

// Call ended
{
  "type": "CALL_ENDED",
  "callId": "call-uuid",
  "duration": 185,
  "disposition": "completed"
}
```

---

## 6. Error Responses

### Common Error Codes

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `INVALID_REQUEST` | Invalid request parameters |
| 400 | `INVALID_PHONE_NUMBER` | Phone number validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `CALL_NOT_FOUND` | Call ID not found |
| 404 | `AGENT_NOT_FOUND` | Agent not found |
| 409 | `AGENT_BUSY` | Agent already on a call |
| 409 | `CALL_STATE_INVALID` | Call not in expected state |
| 409 | `RACE_CONDITION` | Another agent claimed the call |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 500 | `CHIME_ERROR` | Chime SDK error |

### Error Response Format

```json
{
  "message": "Human-readable error message",
  "error": "ERROR_CODE",
  "code": "ChimeSpecificErrorCode",
  "requestId": "request-uuid"
}
```

---

## 7. Data Models

### Agent Presence

```typescript
interface AgentPresence {
  agentId: string;                    // Primary key
  status: AgentStatus;
  activeClinicIds: string[];
  meetingInfo: ChimeMeeting;
  attendeeInfo: ChimeAttendee;
  
  // Call state
  currentCallId?: string;
  ringingCallId?: string;
  callStatus?: 'ringing' | 'dialing' | 'connected' | 'hold';
  
  // Timestamps
  updatedAt: string;
  lastHeartbeatAt: string;
  sessionExpiresAt: string;
  ttl: number;                        // DynamoDB TTL
}

type AgentStatus = 'Online' | 'Offline' | 'OnCall' | 'ringing' | 'dialing' | 'Busy';
```

### Call Queue Entry

```typescript
interface CallQueueEntry {
  clinicId: string;                   // Partition key
  queuePosition: number;              // Sort key
  
  callId: string;
  phoneNumber: string;
  status: CallStatus;
  direction: 'inbound' | 'outbound';
  
  // Assignment
  assignedAgentId?: string;
  agentIds?: string[];
  
  // Meeting info
  meetingInfo?: ChimeMeeting;
  attendeeInfo?: ChimeAttendee;
  
  // Timestamps
  queueEntryTime: number;             // Epoch seconds
  queueEntryTimeIso: string;
  claimedAt?: string;
  connectedAt?: string;
  
  ttl: number;
}

type CallStatus = 'queued' | 'ringing' | 'dialing' | 'connected' | 'on_hold' | 'completed' | 'abandoned';
```

### Clinic Configuration

```typescript
interface Clinic {
  clinicId: string;                   // Primary key
  phoneNumber: string;                // E.164 format
  clinicName: string;
  meetingInfo?: ChimeMeeting;
}
```

---

## 8. Infrastructure Components

### DynamoDB Tables

| Table | Purpose |
|-------|---------|
| `{StackName}-Clinics` | Clinic phone numbers and configuration |
| `{StackName}-AgentPresence` | Agent online status and session info |
| `{StackName}-CallQueueV2` | Active calls and queue |
| `{StackName}-Locks` | Distributed locks for call assignment |
| `{StackName}-AgentPerformance` | Agent performance metrics |
| `{StackName}-RecordingMetadata` | Call recording metadata |

### S3 Buckets

| Bucket | Purpose |
|--------|---------|
| `{stackname}-hold-music-*` | Hold music audio files |
| `{stackname}-recordings-*` | Call recordings (encrypted) |

### Voice Connector

- Handles PSTN telephony
- Configured per-clinic with SIP Media Applications
- SIP rules route calls to appropriate Lambda handlers

### Recording Pipeline

1. **Recording:** Chime records calls to S3 (KMS encrypted)
2. **Processing:** Lambda processes new recordings
3. **Transcription:** AWS Transcribe generates transcripts
4. **Sentiment:** AWS Comprehend analyzes sentiment
5. **Storage:** Metadata stored in DynamoDB

---

## TTL Policies

| Resource | TTL |
|----------|-----|
| Agent Session | 8 hours from creation |
| Active Call | 4 hours |
| Completed Call Metadata | 7 days |
| Locks | 60 seconds |
| Recording Metadata | 7 years (configurable) |

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| Start/Stop Session | 10/minute per agent |
| Outbound Calls | 5/minute per agent |
| Heartbeat | 2/minute per agent |
| Other operations | 60/minute per agent |

---

## Security Notes

1. **Call Recording:** Encrypted at rest with KMS
2. **Transcription:** Medical vocabulary enabled for dental terms
3. **Phone Numbers:** Validated and sanitized before use
4. **Sessions:** Expire after 8 hours of inactivity
5. **Atomic Operations:** Uses DynamoDB conditional writes to prevent race conditions
6. **Idempotency:** Outbound calls use idempotency tokens to prevent duplicates

