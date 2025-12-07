# Call Center Join Operations API

## Overview

This module provides comprehensive functionality for agents and supervisors to join both **queued calls** (calls waiting for an agent) and **active calls** (calls currently in progress). This enables:

- **Manual Call Pickup**: Agents can browse queued calls and choose which to answer
- **Supervisor Monitoring**: Supervisors can listen to active calls for quality assurance
- **Barge-In**: Supervisors can join calls to assist agents or handle escalations
- **Real-time Dashboard**: View all joinable calls across clinics

**Base URL:** `https://apig.todaysdentalinsights.com/admin/call-center`

All endpoints require JWT authentication via the Authorization header.

---

## Table of Contents

1. [Join Queued Call](#1-join-queued-call)
2. [Join Active Call](#2-join-active-call)
3. [Get Joinable Calls](#3-get-joinable-calls)
4. [Use Cases](#4-use-cases)
5. [Error Responses](#5-error-responses)
6. [Data Models](#6-data-models)

---

## 1. Join Queued Call

Allows an agent or supervisor to manually pick up a call that is waiting in the queue.

### Endpoint

`POST /admin/call-center/join-queued-call`

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

### Request Body

```json
{
  "callId": "call-12345",
  "clinicId": "clinic-123"
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | ID of the queued call to join |
| clinicId | string | Yes | ID of the clinic the call belongs to |

### Success Response (200)

```json
{
  "message": "Call pickup initiated",
  "callId": "call-12345",
  "meetingId": "meeting-abc-xyz",
  "agentAttendee": {
    "AttendeeId": "att-123",
    "ExternalUserId": "agent-john@example.com",
    "JoinToken": "eyJhbGc..."
  },
  "meetingInfo": {
    "MeetingId": "meeting-abc-xyz",
    "MediaRegion": "us-east-1",
    "MediaPlacement": { ... }
  },
  "status": "ringing"
}
```

### Permissions

- **Agents**: Can join calls from clinics they have access to
- **Supervisors**: Can join calls from any clinic

### Behavior

1. Validates agent has access to the clinic
2. Checks call is in `queued` status
3. Verifies agent is `idle` (not on another call)
4. Creates Chime meeting and attendee
5. Updates call status to `ringing`
6. Bridges customer into the meeting
7. Returns meeting credentials to agent

### Error Responses

- `400`: Call is not in queue, agent not idle
- `403`: Agent doesn't have access to clinic
- `404`: Call not found or agent session not found
- `500`: Failed to create meeting or bridge customer

---

## 2. Join Active Call

Allows supervisors to join active calls for monitoring, coaching, or assistance.

### Endpoint

`POST /admin/call-center/join-active-call`

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |
| Authorization | string | Yes | `Bearer <accessToken>` |

### Request Body

```json
{
  "callId": "call-12345",
  "clinicId": "clinic-123",
  "mode": "silent"
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| callId | string | Yes | ID of the active call to join |
| clinicId | string | Yes | ID of the clinic the call belongs to |
| mode | string | Yes | Monitoring mode: `silent`, `barge`, or `whisper` |

### Monitor Modes

| Mode | Description | Who Can Hear |
|------|-------------|--------------|
| **silent** | Listen-only mode (supervisor muted) | Supervisor hears agent + customer, but cannot speak |
| **barge** | Full participation (supervisor unmuted) | All parties hear each other (agent + customer + supervisor) |
| **whisper** | Coach mode (coming soon) | Only agent hears supervisor, customer does not |

### Success Response (200)

```json
{
  "message": "Successfully joined call in silent mode",
  "callId": "call-12345",
  "meetingId": "meeting-abc-xyz",
  "supervisorAttendee": {
    "AttendeeId": "att-789",
    "ExternalUserId": "supervisor-jane@example.com",
    "JoinToken": "eyJhbGc..."
  },
  "meetingInfo": {
    "MeetingId": "meeting-abc-xyz",
    "MediaRegion": "us-east-1",
    "MediaPlacement": { ... }
  },
  "mode": "silent",
  "callDetails": {
    "agentId": "john@example.com",
    "customerPhone": "+12223334444",
    "status": "connected",
    "connectedAt": 1701234567890,
    "duration": 120
  },
  "instructions": {
    "silent": "You are in listen-only mode. Mute your microphone."
  }
}
```

### Permissions

- **Supervisors and Admins Only**: Regular agents cannot join active calls

### Behavior

1. Validates user has supervisor role
2. Checks call is in joinable status (`connected`, `on-hold`, or `ringing`)
3. Verifies call has an active Chime meeting
4. Prevents duplicate joins by same supervisor
5. Creates supervisor attendee in the meeting
6. Tracks supervisor in call record
7. Optionally notifies agent of monitoring (barge mode)
8. Returns meeting credentials to supervisor

### Error Responses

- `400`: Call not in joinable status, already joined, invalid mode
- `403`: User is not a supervisor
- `404`: Call not found or meeting not active
- `500`: Failed to create attendee

---

## 3. Get Joinable Calls

Returns all calls that can be joined by the requesting user, including both queued and active calls.

### Endpoint

`GET /admin/call-center/get-joinable-calls`

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | No | Filter by specific clinic |
| includeQueued | boolean | No | Include queued calls (default: true) |
| includeActive | boolean | No | Include active calls (default: true for supervisors) |

### Success Response (200)

```json
{
  "queuedCalls": [
    {
      "callId": "call-12345",
      "clinicId": "clinic-123",
      "phoneNumber": "+12223334444",
      "status": "queued",
      "priority": "high",
      "isVip": true,
      "isCallback": false,
      "queuedAt": 1701234567890,
      "queuePosition": "20231129-123456-abc",
      "waitTime": 180,
      "customerName": "John Doe",
      "reason": "Toothache"
    }
  ],
  "activeCalls": [
    {
      "callId": "call-67890",
      "clinicId": "clinic-123",
      "phoneNumber": "+13334445555",
      "status": "connected",
      "assignedAgentId": "agent@example.com",
      "agentName": "Jane Smith",
      "connectedAt": 1701234500000,
      "duration": 240,
      "isOnHold": false,
      "supervisors": []
    }
  ],
  "summary": {
    "totalQueued": 5,
    "totalActive": 12,
    "clinics": ["clinic-123", "clinic-456"],
    "longestQueueWait": 300,
    "longestCallDuration": 600,
    "vipInQueue": 2,
    "callbacksInQueue": 1,
    "callsOnHold": 3
  },
  "capabilities": {
    "canJoinQueued": true,
    "canJoinActive": true,
    "canMonitor": true,
    "canBarge": true
  }
}
```

### Response Fields

#### QueuedCall Object

| Field | Type | Description |
|-------|------|-------------|
| callId | string | Unique call identifier |
| clinicId | string | Clinic ID |
| phoneNumber | string | Customer phone number |
| status | string | Always "queued" |
| priority | string | Call priority: "high", "normal", or "low" |
| isVip | boolean | VIP customer flag |
| isCallback | boolean | Scheduled callback flag |
| queuedAt | number | Timestamp when call entered queue |
| queuePosition | string | Position identifier in queue |
| waitTime | number | Wait time in seconds |
| customerName | string | Customer name (if available) |
| reason | string | Call reason (if available) |

#### ActiveCall Object

| Field | Type | Description |
|-------|------|-------------|
| callId | string | Unique call identifier |
| clinicId | string | Clinic ID |
| phoneNumber | string | Customer phone number |
| status | string | "connected", "on-hold", or "ringing" |
| assignedAgentId | string | Agent handling the call |
| agentName | string | Agent display name |
| connectedAt | number | Timestamp when call connected |
| duration | number | Call duration in seconds |
| isOnHold | boolean | Whether call is on hold |
| supervisors | array | List of supervisors currently monitoring |

### Behavior

1. Retrieves user's accessible clinics
2. Queries all calls for those clinics
3. Filters by status (queued or active)
4. Sorts queued calls by priority and wait time
5. Sorts active calls by duration
6. Returns aggregated summary statistics
7. Includes user's capabilities based on role

### Permissions

- **Agents**: See queued calls from their clinics
- **Supervisors**: See both queued and active calls from all clinics

---

## 4. Use Cases

### Use Case 1: Agent Picks Up Queued Call

**Scenario**: An agent wants to manually select which call to answer from the queue.

**Flow**:
1. Agent calls `GET /call-center/get-joinable-calls`
2. Agent reviews `queuedCalls` array
3. Agent selects a VIP or high-priority call
4. Agent calls `POST /call-center/join-queued-call` with selected `callId`
5. Agent receives meeting credentials and joins the call
6. Customer is automatically bridged into the meeting

**Benefits**:
- Prioritize VIP customers
- Handle callbacks first
- Choose calls matching agent's expertise

---

### Use Case 2: Supervisor Silent Monitoring

**Scenario**: A supervisor wants to listen to an agent's call for quality assurance.

**Flow**:
1. Supervisor calls `GET /call-center/get-joinable-calls?includeActive=true`
2. Supervisor reviews `activeCalls` array
3. Supervisor selects a call to monitor
4. Supervisor calls `POST /call-center/join-active-call` with `mode: "silent"`
5. Supervisor joins meeting muted
6. Supervisor listens to agent-customer interaction

**Benefits**:
- Quality assurance without disrupting call
- Training and evaluation
- Compliance monitoring

---

### Use Case 3: Supervisor Barge-In

**Scenario**: An agent is struggling with a difficult customer and needs supervisor assistance.

**Flow**:
1. Supervisor calls `GET /call-center/get-joinable-calls?includeActive=true`
2. Supervisor identifies the agent's call
3. Supervisor calls `POST /call-center/join-active-call` with `mode: "barge"`
4. Supervisor joins meeting unmuted
5. Supervisor speaks to help resolve the issue
6. All parties (agent + customer + supervisor) hear each other

**Benefits**:
- Immediate escalation support
- Customer retention
- Agent training in real-time

---

### Use Case 4: Real-Time Dashboard

**Scenario**: Build a live call center dashboard.

**Flow**:
1. Frontend polls `GET /call-center/get-joinable-calls` every 5-10 seconds
2. Display queued calls with wait times
3. Display active calls with durations
4. Show summary statistics (calls in queue, longest wait, etc.)
5. Provide "Join" buttons for each call

**Benefits**:
- Full visibility into call center operations
- Quick response to queue buildup
- Data-driven staffing decisions

---

## 5. Error Responses

### Common Error Codes

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid parameters or call not in joinable state |
| 401 | Unauthorized - Missing or invalid JWT token |
| 403 | Forbidden - Insufficient permissions for this operation |
| 404 | Not Found - Call or session not found |
| 500 | Internal Server Error - System error during processing |

### Example Error Response

```json
{
  "message": "You do not have access to this clinic",
  "error": "Forbidden"
}
```

```json
{
  "message": "Call is not in queue. Current status: connected",
  "currentStatus": "connected"
}
```

```json
{
  "message": "Forbidden: Only supervisors can join active calls",
  "requiredRole": "supervisor"
}
```

---

## 6. Data Models

### TypeScript Types

See `src/shared/types/join-call-types.ts` for complete TypeScript definitions:

```typescript
export type MonitorMode = 'silent' | 'barge' | 'whisper';

export interface JoinQueuedCallRequest {
  callId: string;
  clinicId: string;
}

export interface JoinActiveCallRequest {
  callId: string;
  clinicId: string;
  mode: MonitorMode;
}

export interface GetJoinableCallsResponse {
  queuedCalls: QueuedCall[];
  activeCalls: ActiveCall[];
  summary: CallSummary;
  capabilities: UserCapabilities;
}
```

---

## Frontend Integration Example

### React Component for Queued Calls

```typescript
import { useState, useEffect } from 'react';

function QueuedCallsPanel() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    const fetchCalls = async () => {
      const response = await fetch(
        'https://apig.todaysdentalinsights.com/admin/call-center/get-joinable-calls',
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      const data = await response.json();
      setCalls(data.queuedCalls);
    };

    fetchCalls();
    const interval = setInterval(fetchCalls, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const handleJoinCall = async (callId, clinicId) => {
    const response = await fetch(
      'https://apig.todaysdentalinsights.com/admin/call-center/join-queued-call',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ callId, clinicId })
      }
    );
    const data = await response.json();
    
    // Join Chime meeting using data.meetingInfo and data.agentAttendee
    await joinChimeMeeting(data.meetingInfo, data.agentAttendee);
  };

  return (
    <div>
      <h2>Queued Calls ({calls.length})</h2>
      {calls.map(call => (
        <div key={call.callId} className={call.isVip ? 'vip-call' : ''}>
          <span>{call.phoneNumber}</span>
          <span>Wait: {Math.floor(call.waitTime / 60)}m</span>
          <button onClick={() => handleJoinCall(call.callId, call.clinicId)}>
            Pick Up
          </button>
        </div>
      ))}
    </div>
  );
}
```

---

## Architecture Notes

### How It Works

1. **Queued Calls**: Stored in DynamoDB `CallQueueTable` with status `'queued'`
2. **Active Calls**: Calls with status `'connected'`, `'on-hold'`, or `'ringing'`
3. **Chime Meetings**: Each call has a Chime SDK meeting for real-time audio
4. **Attendees**: Agents, customers, and supervisors are meeting attendees
5. **Dynamic Join**: New attendees can be added to ongoing meetings

### Security

- All endpoints require JWT authentication
- Role-based access control (agents vs supervisors)
- Clinic-level permissions enforced
- Supervisor actions are logged for audit trails

### Performance

- Queries optimized using DynamoDB GSIs
- Pagination support for large call volumes
- Real-time updates via frequent polling or WebSocket (future)

---

## Related Documentation

- [Chime Stack API](./CHIME-STACK-API.md) - Core call control operations
- [Admin Stack API](./ADMIN-STACK-API.md) - Admin and management endpoints
- [Analytics Stack API](./ANALYTICS-STACK-API.md) - Call analytics and reporting

