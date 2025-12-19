# AI Agents Stack API Documentation

## Overview

The AI Agents Stack provides a comprehensive set of APIs for managing and interacting with AI-powered dental assistants built on AWS Bedrock Agents. The stack supports:

- **Agent Management** - CRUD operations for AI agents with customizable prompts
- **Chat API** - Invoke agents via REST or WebSocket for real-time streaming
- **Voice AI** - Inbound and outbound voice calls powered by AI agents
- **Scheduled Calls** - Schedule and manage outbound AI calls

**Base URLs:**
- REST API: `https://apig.todaysdentalinsights.com/ai-agents`
- WebSocket: `wss://ws.todaysdentalinsights.com/ai-agents`

---

## Authentication

### Authenticated Endpoints
Most endpoints require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <jwt-token>
```

### Public Endpoints
The `/public/` prefix endpoints are designed for website chatbots and use rate limiting instead of authentication.

---

## REST API Endpoints

### 1. Agent Management

#### List All Agents

```http
GET /agents
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `clinicId` | string | Filter agents by clinic ID |
| `includePublic` | boolean | Include public agents (default: `true`) |

**Response:**
```json
{
  "agents": [
    {
      "agentId": "uuid",
      "name": "ToothFairy Assistant",
      "description": "Dental appointment assistant",
      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "systemPrompt": "...",
      "negativePrompt": "...",
      "userPrompt": "...",
      "bedrockAgentId": "ABCD1234",
      "bedrockAgentAliasId": "WXYZ5678",
      "bedrockAgentStatus": "PREPARED",
      "clinicId": "clinic-123",
      "isActive": true,
      "isPublic": false,
      "isWebsiteEnabled": true,
      "isVoiceEnabled": true,
      "isDefaultVoiceAgent": false,
      "createdAt": "2024-01-15T10:00:00Z",
      "createdBy": "John Doe",
      "updatedAt": "2024-01-15T10:00:00Z",
      "updatedBy": "John Doe",
      "usageCount": 150
    }
  ],
  "totalCount": 1,
  "defaultSystemPrompt": "...",
  "defaultNegativePrompt": "..."
}
```

---

#### Get Single Agent

```http
GET /agents/{agentId}
```

**Response:**
```json
{
  "agent": { ... },
  "model": {
    "id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "name": "Claude 3.5 Sonnet v2",
    "provider": "Anthropic",
    "description": "Best balance of intelligence and speed",
    "recommended": true
  }
}
```

---

#### Create Agent

```http
POST /agents
```

**Request Body:**
```json
{
  "name": "Appointment Assistant",
  "description": "Handles appointment scheduling",
  "clinicId": "clinic-123",
  "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "systemPrompt": "Custom system instructions...",
  "negativePrompt": "Custom restrictions...",
  "userPrompt": "Additional instructions...",
  "isPublic": false,
  "isWebsiteEnabled": true,
  "isVoiceEnabled": true,
  "isDefaultVoiceAgent": false,
  "tags": ["appointments", "scheduling"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent display name |
| `clinicId` | Yes | Clinic this agent belongs to |
| `modelId` | No | Foundation model ID (defaults to recommended) |
| `systemPrompt` | No | Level 1: Core instructions (defaults to ToothFairy prompt) |
| `negativePrompt` | No | Level 2: Restrictions (defaults to HIPAA/safety rules) |
| `userPrompt` | No | Level 3: Custom frontend instructions |
| `isWebsiteEnabled` | No | Enable public website chatbot |
| `isVoiceEnabled` | No | Enable voice/phone AI |
| `isDefaultVoiceAgent` | No | Default agent for after-hours calls |

**Response (201):**
```json
{
  "message": "Agent created. Call /prepare to make it ready for invocation.",
  "agent": { ... },
  "nextStep": "POST /agents/{agentId}/prepare"
}
```

---

#### Update Agent

```http
PUT /agents/{agentId}
```

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "systemPrompt": "Updated instructions",
  "negativePrompt": "Updated restrictions",
  "userPrompt": "Updated custom prompt",
  "isPublic": false,
  "isWebsiteEnabled": true,
  "isVoiceEnabled": true,
  "isDefaultVoiceAgent": true,
  "tags": ["updated", "tags"]
}
```

**Response (200):**
```json
{
  "message": "Agent updated. Call /prepare to apply changes.",
  "agent": { ... },
  "needsPrepare": true
}
```

**Response (207 - Partial Success):**
```json
{
  "message": "Agent saved locally but Bedrock sync failed",
  "warning": "Bedrock update failed: ...",
  "agent": { ... },
  "bedrockSyncFailed": true,
  "nextSteps": [
    "The local agent configuration has been saved",
    "Bedrock Agent update failed - the agent is running with its previous configuration",
    "Try calling /prepare to re-sync the agent with Bedrock"
  ]
}
```

---

#### Delete Agent

```http
DELETE /agents/{agentId}
```

**Response:**
```json
{
  "message": "Agent deleted successfully",
  "agentId": "uuid",
  "bedrockAgentDeleted": true
}
```

---

#### Prepare Agent

Prepares the Bedrock Agent after creation or update. Required before the agent can handle chat requests.

```http
POST /agents/{agentId}/prepare
```

**Response (200 - Ready):**
```json
{
  "message": "Agent prepared and ready for invocation!",
  "agent": {
    "bedrockAgentStatus": "PREPARED",
    "bedrockAgentAliasId": "WXYZ5678"
  },
  "isReady": true
}
```

**Response (202 - Still Preparing):**
```json
{
  "message": "Agent is still preparing. Poll GET /agents/{agentId} to check status.",
  "agent": {
    "bedrockAgentStatus": "PREPARING"
  },
  "isReady": false,
  "checkAgain": true
}
```

---

#### List Available Models

```http
GET /models
```

**Response:**
```json
{
  "models": [
    {
      "id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "name": "Claude 3.5 Sonnet v2",
      "provider": "Anthropic",
      "description": "Latest Claude 3.5 Sonnet - Best balance of intelligence and speed",
      "recommended": true
    },
    {
      "id": "anthropic.claude-3-5-haiku-20241022-v1:0",
      "name": "Claude 3.5 Haiku",
      "provider": "Anthropic",
      "description": "Fast and efficient for simple tasks",
      "recommended": false
    }
  ],
  "defaultModel": "anthropic.claude-3-5-sonnet-20241022-v2:0"
}
```

---

### 2. Chat API (Invoke Agent)

#### Authenticated Chat

For internal users with JWT authentication.

```http
POST /clinic/{clinicId}/agents/{agentId}/chat
```

**Request Body:**
```json
{
  "message": "I'd like to schedule a dental cleaning",
  "sessionId": "existing-session-uuid",
  "endSession": false,
  "enableTrace": false
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | Yes | User's message to the agent |
| `sessionId` | No | Continue existing session (omit for new) |
| `endSession` | No | End session after this message |
| `enableTrace` | No | Include agent reasoning in response |

**Response:**
```json
{
  "response": "I'd be happy to help you schedule a dental cleaning! To get started, could you please provide your first name, last name, and date of birth?",
  "sessionId": "uuid",
  "agentId": "uuid",
  "agentName": "ToothFairy Assistant",
  "clinicId": "clinic-123",
  "metrics": {
    "latencyMs": 1250
  },
  "trace": [...]
}
```

---

#### Public Chat (Website Chatbot)

For unauthenticated website visitors. Rate limited.

```http
POST /public/clinic/{clinicId}/agents/{agentId}/chat
```

**Request Body:**
```json
{
  "message": "What are your office hours?",
  "visitorName": "Jane",
  "visitorId": "visitor-abc123",
  "sessionId": "existing-session-uuid"
}
```

**Rate Limits:**
- 10 requests per minute per visitor/IP
- 100 messages per session

**Response (429 - Rate Limited):**
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please wait 45 seconds before making more requests."
}
```

---

### 3. Voice Configuration

#### Get Voice Config

```http
GET /voice-config/{clinicId}
```

**Response:**
```json
{
  "config": {
    "clinicId": "clinic-123",
    "aiInboundEnabled": true,
    "inboundAgentId": "agent-uuid",
    "inboundAgentName": "After Hours Agent",
    "aiOutboundEnabled": true,
    "outboundAgentId": "agent-uuid",
    "outboundAgentName": "Reminder Agent",
    "voiceSettings": {
      "voiceId": "Joanna",
      "engine": "neural",
      "speakingRate": "medium",
      "pitch": "medium",
      "volume": "medium"
    },
    "afterHoursGreeting": "Thank you for calling {clinicName}...",
    "updatedAt": "2024-01-15T10:00:00Z",
    "updatedBy": "John Doe"
  },
  "status": {
    "aiInboundActive": true,
    "aiOutboundActive": true
  }
}
```

---

#### Update Voice Config

```http
PUT /voice-config/{clinicId}
```

**Request Body:**
```json
{
  "aiInboundEnabled": true,
  "inboundAgentId": "agent-uuid",
  "aiOutboundEnabled": true,
  "outboundAgentId": "agent-uuid",
  "voiceSettings": {
    "voiceId": "Joanna",
    "engine": "neural",
    "speakingRate": "medium"
  },
  "afterHoursGreeting": "Custom greeting...",
  "outboundGreetings": {
    "appointment_reminder": "Hi {patientName}, this is {clinicName}...",
    "follow_up": "Hi {patientName}, calling to follow up..."
  }
}
```

**Available Voices:**
| Voice ID | Name | Neural Support |
|----------|------|----------------|
| `Joanna` | Joanna (Female) | ✅ Recommended |
| `Matthew` | Matthew (Male) | ✅ |
| `Ivy` | Ivy (Female, Child) | ✅ |
| `Kendra` | Kendra (Female) | ✅ |
| `Joey` | Joey (Male) | ✅ |

---

### 4. Clinic Hours

#### Get Clinic Hours

```http
GET /clinic-hours/{clinicId}
```

**Response:**
```json
{
  "hours": {
    "clinicId": "clinic-123",
    "timezone": "America/New_York",
    "hours": {
      "monday": { "open": "09:00", "close": "17:00" },
      "tuesday": { "open": "09:00", "close": "17:00" },
      "wednesday": { "open": "09:00", "close": "17:00" },
      "thursday": { "open": "09:00", "close": "17:00" },
      "friday": { "open": "09:00", "close": "17:00" },
      "saturday": { "closed": true },
      "sunday": { "closed": true }
    }
  }
}
```

---

#### Update Clinic Hours

```http
PUT /clinic-hours/{clinicId}
```

**Request Body:**
```json
{
  "timezone": "America/New_York",
  "hours": {
    "monday": { "open": "08:00", "close": "18:00" },
    "tuesday": { "open": "08:00", "close": "18:00" },
    "wednesday": { "open": "08:00", "close": "18:00" },
    "thursday": { "open": "08:00", "close": "18:00" },
    "friday": { "open": "08:00", "close": "16:00" },
    "saturday": { "open": "09:00", "close": "13:00" },
    "sunday": { "closed": true }
  }
}
```

**Validation Rules:**
- Times must be in 24-hour `HH:mm` format
- Open time must be before close time
- Valid days: `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`

---

### 5. Scheduled Calls (Outbound)

#### List Scheduled Calls

```http
GET /scheduled-calls?clinicId={clinicId}&status={status}
```

**Query Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `clinicId` | Yes | Filter by clinic |
| `status` | No | Filter by status: `scheduled`, `in_progress`, `completed`, `failed`, `cancelled` |

**Response:**
```json
{
  "calls": [
    {
      "callId": "uuid",
      "clinicId": "clinic-123",
      "agentId": "agent-uuid",
      "phoneNumber": "+15551234567",
      "patientName": "Jane Smith",
      "patientId": "12345",
      "scheduledTime": "2024-01-20T14:00:00Z",
      "timezone": "America/New_York",
      "purpose": "appointment_reminder",
      "status": "scheduled",
      "attempts": 0,
      "maxAttempts": 3,
      "createdAt": "2024-01-15T10:00:00Z",
      "createdBy": "John Doe"
    }
  ],
  "count": 1
}
```

---

#### Create Scheduled Call

```http
POST /scheduled-calls
```

**Request Body:**
```json
{
  "clinicId": "clinic-123",
  "agentId": "agent-uuid",
  "phoneNumber": "+15551234567",
  "patientName": "Jane Smith",
  "patientId": "12345",
  "scheduledTime": "2024-01-20T14:00:00Z",
  "timezone": "America/New_York",
  "purpose": "appointment_reminder",
  "appointmentId": "apt-123",
  "maxAttempts": 3
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `clinicId` | Yes | Clinic ID |
| `agentId` | Yes | AI agent to use for the call |
| `phoneNumber` | Yes | E.164 format phone number |
| `scheduledTime` | Yes | ISO 8601 datetime (must be in future) |
| `purpose` | Yes | Call purpose (see below) |
| `patientName` | No | Patient name for personalization |
| `patientId` | No | OpenDental PatNum |
| `timezone` | No | Default: `America/New_York` |
| `customMessage` | No | Custom message for `custom` purpose |
| `maxAttempts` | No | Max retry attempts (default: 3) |

**Call Purposes:**
| Purpose | Description |
|---------|-------------|
| `appointment_reminder` | Upcoming appointment reminder |
| `follow_up` | Post-visit follow-up |
| `payment_reminder` | Outstanding balance reminder |
| `reengagement` | Inactive patient re-engagement |
| `custom` | Custom message (requires `customMessage`) |

**Response (201):**
```json
{
  "message": "Outbound call scheduled successfully",
  "call": { ... }
}
```

**Response (409 - Duplicate):**
```json
{
  "error": "Duplicate scheduled call",
  "message": "A call to this phone number with the same purpose is already scheduled for this time.",
  "existingCallId": "uuid"
}
```

---

#### Bulk Schedule Calls

Schedule up to 500 calls in a single request.

```http
POST /scheduled-calls/bulk
```

**Request Body:**
```json
{
  "clinicId": "clinic-123",
  "agentId": "agent-uuid",
  "timezone": "America/New_York",
  "maxAttempts": 3,
  "calls": [
    {
      "phoneNumber": "+15551234567",
      "patientName": "Jane Smith",
      "scheduledTime": "2024-01-20T14:00:00Z",
      "purpose": "appointment_reminder"
    },
    {
      "phoneNumber": "+15559876543",
      "patientName": "John Doe",
      "scheduledTime": "2024-01-20T14:30:00Z",
      "purpose": "appointment_reminder"
    }
  ]
}
```

**Response (201):**
```json
{
  "message": "Bulk scheduling completed: 2 success, 0 failed",
  "summary": {
    "total": 2,
    "success": 2,
    "failed": 0
  },
  "results": [
    {
      "callId": "uuid-1",
      "phoneNumber": "+15551234567",
      "status": "success",
      "scheduledTime": "2024-01-20T14:00:00Z"
    },
    {
      "callId": "uuid-2",
      "phoneNumber": "+15559876543",
      "status": "success",
      "scheduledTime": "2024-01-20T14:30:00Z"
    }
  ]
}
```

---

#### Get Scheduled Call

```http
GET /scheduled-calls/{callId}
```

---

#### Cancel Scheduled Call

```http
DELETE /scheduled-calls/{callId}
```

**Response:**
```json
{
  "message": "Scheduled call cancelled successfully",
  "callId": "uuid",
  "scheduleCleanup": { "success": true }
}
```

---

## WebSocket API

The WebSocket API provides real-time streaming for chat interactions, including AI "thinking" traces.

### Connection

```
wss://ws.todaysdentalinsights.com/ai-agents?clinicId={clinicId}&agentId={agentId}
```

**Query Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `clinicId` | Yes | Clinic ID for the chatbot |
| `agentId` | Yes | AI agent to chat with |

### Sending Messages

**Client → Server:**
```json
{
  "action": "sendMessage",
  "message": "I want to schedule an appointment",
  "visitorName": "Jane",
  "visitorId": "visitor-abc123"
}
```

### Receiving Events

**Server → Client (Thinking):**
```json
{
  "type": "thinking",
  "content": "Understanding: User wants to schedule a dental appointment",
  "timestamp": "2024-01-15T10:00:00.123Z"
}
```

**Server → Client (Tool Use):**
```json
{
  "type": "tool_use",
  "toolName": "searchPatients",
  "toolInput": { "LName": "Smith", "FName": "Jane", "Birthdate": "1990-01-15" },
  "content": "Calling: /searchPatients",
  "timestamp": "2024-01-15T10:00:01.456Z"
}
```

**Server → Client (Tool Result):**
```json
{
  "type": "tool_result",
  "content": "Found patient: Jane Smith",
  "toolResult": "{...}",
  "timestamp": "2024-01-15T10:00:02.789Z"
}
```

**Server → Client (Response Chunk):**
```json
{
  "type": "chunk",
  "content": "I found your record, Jane! ",
  "timestamp": "2024-01-15T10:00:03.012Z"
}
```

**Server → Client (Complete):**
```json
{
  "type": "complete",
  "content": "I found your record, Jane! When would you like to come in for your appointment?",
  "sessionId": "ws-abc12345-uuid",
  "timestamp": "2024-01-15T10:00:03.345Z"
}
```

**Server → Client (Error):**
```json
{
  "type": "error",
  "content": "Rate limit exceeded. Please wait 30 seconds.",
  "timestamp": "2024-01-15T10:00:04.678Z"
}
```

### Rate Limits

| Limit | Value |
|-------|-------|
| Messages per minute | 20 |
| Max message length | 4,000 characters |
| Messages per session | 100 |

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "details": "Additional context (optional)",
  "errorType": "ValidationException"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async processing) |
| 207 | Multi-Status (partial success) |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 409 | Conflict (duplicate) |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## Agent Lifecycle

Agents follow a specific lifecycle:

```
CREATE → CREATING → NOT_PREPARED → PREPARE → PREPARING → PREPARED (Ready!)
                         ↑                        ↓
                         └── UPDATE ──────────────┘
```

1. **Create Agent** - POST to `/agents`, agent is created in Bedrock
2. **Prepare Agent** - POST to `/agents/{id}/prepare`, agent is compiled and aliased
3. **Use Agent** - POST to chat endpoints
4. **Update Agent** - PUT to `/agents/{id}`, agent goes back to NOT_PREPARED
5. **Re-Prepare** - POST to `/agents/{id}/prepare` again

---

## 3-Level Prompt System

Agents use a hierarchical prompt system:

| Level | Name | Purpose |
|-------|------|---------|
| 1 | System Prompt | Core instructions (ToothFairy persona) |
| 2 | Negative Prompt | Restrictions (HIPAA, medical boundaries) |
| 3 | User Prompt | Custom frontend instructions |

All three levels are combined into the Bedrock Agent instruction.

---

## Available OpenDental Tools

The AI agents can use these tools via Action Groups:

### Patient Management
- `searchPatients` - Search by name and birthdate
- `createPatient` - Create new patient record
- `getPatientByPatNum` - Get patient by ID
- `getPatientInfo` - Get comprehensive patient info
- `getAllergies` - Get patient allergies
- `getProgNotes` - Get progress notes

### Appointments
- `scheduleAppointment` - Book new appointment
- `getUpcomingAppointments` - List upcoming appointments
- `rescheduleAppointment` - Change appointment time
- `cancelAppointment` - Cancel appointment
- `getAppointment` - Get single appointment
- `getAppointments` - Query appointments with filters
- `getPlannedAppts` - Get planned appointments

### Treatment
- `getProcedureLogs` - Get procedure history
- `getTreatmentPlans` - Get treatment plans

### Billing & Insurance
- `getAccountAging` - Get account aging report
- `getPatientBalances` - Get patient balances
- `getServiceDateView` - Get service date breakdown
- `getBenefits` - Get insurance benefits
- `getCarriers` - List insurance carriers
- `getClaims` - Get insurance claims
- `getFamilyInsurance` - Get family insurance info

---

## Security Considerations

1. **Session Binding** - Sessions are bound to specific users to prevent hijacking
2. **Rate Limiting** - Both REST and WebSocket endpoints enforce rate limits
3. **Clinic Isolation** - Agents only access data for their assigned clinic
4. **HIPAA Compliance** - Negative prompts enforce patient privacy rules
5. **Audit Logging** - All operations are logged with user attribution

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Create agent
const response = await fetch('https://apig.todaysdentalinsights.com/ai-agents/agents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'My Assistant',
    clinicId: 'clinic-123',
    isWebsiteEnabled: true,
  }),
});
const { agent, nextStep } = await response.json();

// Prepare agent
await fetch(`https://apig.todaysdentalinsights.com/ai-agents/agents/${agent.agentId}/prepare`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
});

// Chat with agent
const chatResponse = await fetch(
  `https://apig.todaysdentalinsights.com/ai-agents/clinic/${clinicId}/agents/${agent.agentId}/chat`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Hello, I need to schedule an appointment',
    }),
  }
);
```

### WebSocket Connection

```typescript
const ws = new WebSocket(
  `wss://ws.todaysdentalinsights.com/ai-agents?clinicId=${clinicId}&agentId=${agentId}`
);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'thinking':
      console.log('AI is thinking:', data.content);
      break;
    case 'tool_use':
      console.log('Calling tool:', data.toolName);
      break;
    case 'chunk':
      appendToResponse(data.content);
      break;
    case 'complete':
      finishResponse(data.content);
      break;
    case 'error':
      showError(data.content);
      break;
  }
};

ws.send(JSON.stringify({
  action: 'sendMessage',
  message: 'Schedule an appointment for next Monday',
  visitorName: 'Jane',
}));
```





















