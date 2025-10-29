# Cloud Contact Center API Documentation

## Complete API Reference for Frontend Development

This comprehensive documentation covers all APIs required to build a cloud contact center frontend application using the dental clinic management system.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Authentication & Authorization](#authentication--authorization)
3. [Base URLs & Endpoints](#base-urls--endpoints)
4. [Agent Management APIs](#agent-management-apis)
5. [Call Management APIs](#call-management-apis)
6. [WebRTC/Softphone APIs](#webrtcsoftphone-apis)
7. [Clinic Management APIs](#clinic-management-apis)
8. [Callback Management APIs](#callback-management-apis)
9. [WebSocket APIs](#websocket-apis)
10. [Error Handling](#error-handling)
11. [Frontend Integration Guide](#frontend-integration-guide)

---

## System Architecture

The contact center uses a hybrid architecture combining:

- **Amazon Chime SDK** for WebRTC softphone capabilities
- **Amazon Connect** for call routing and management
- **AWS Cognito** for authentication
- **DynamoDB** for state management
- **WebSocket API** for real-time updates
- **REST APIs** for CRUD operations

### Key Components

1. **Agent Softphone**: WebRTC-based using Chime SDK
2. **Call Routing**: Attribute-Based Routing (ABR) via Connect
3. **Real-time Updates**: WebSocket connections for call events
4. **State Management**: DynamoDB tables for presence and routing

---

## Authentication & Authorization

### Login Endpoint - Step 1: Initiate OTP

**POST** `/auth/initiate`

```json
{
  "email": "agent@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "delivery": "email",
  "session": "AYABePsh...ImaXqJw",
  "challengeName": "CUSTOM_CHALLENGE",
  "challengeParameters": {
    "USERNAME": "agent@example.com"
  }
}
```

### Login Endpoint - Step 2: Verify OTP

**POST** `/auth/verify`

```json
{
  "email": "agent@example.com",
  "otp": "123456",
  "session": "AYABePsh...ImaXqJw"
}
```

**Response:**
```json
{
  "success": true,
  "idToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

### Token Usage

Include the `idToken` in all API requests:

```javascript
headers: {
  'Authorization': `Bearer ${idToken}`,
  'Content-Type': 'application/json'
}
```

### Token Refresh

**POST** `/auth/refresh`

```json
{
  "refreshToken": "your-refresh-token"
}
```

---

## Base URLs & Endpoints

### Production Environment

- **Admin API**: `https://api.todaysdentalinsights.com/admin/`
- **Chime API**: `https://api.todaysdentalinsights.com/admin/chime/`
- **Clinic API**: `https://api.todaysdentalinsights.com/clinic/`
- **WebSocket**: `wss://your-websocket-url/prod`

### Development Environment

- **Admin API**: `https://dev-api.todaysdentalinsights.com/admin/`
- **Chime API**: `https://dev-api.todaysdentalinsights.com/admin/chime/`
- **Clinic API**: `https://dev-api.todaysdentalinsights.com/clinic/`
- **WebSocket**: `wss://dev-websocket-url/prod`

---

## Agent Management APIs

### 1. Get Agent Profile & Permissions

**GET** `/admin/me/clinics`

**Response:**
```json
{
  "success": true,
  "user": {
    "username": "agent@example.com",
    "email": "agent@example.com",
    "givenName": "John",
    "familyName": "Doe",
    "clinics": [
      {
        "clinicId": "dentistinnewbritain",
        "role": "ADMIN",
        "clinicName": "Dentist in New Britain"
      },
      {
        "clinicId": "dentistingreenville",
        "role": "PROVIDER",
        "clinicName": "Dentist in Greenville"
      }
    ],
    "isSuperAdmin": false
  }
}
```

### 2. Get Agent Presence/Status

**GET** `/admin/me/presence`

**Response:**
```json
{
  "presence": {
    "agentId": "cognito-sub-id",
    "status": "Online",
    "activeClinicIds": ["dentistinnewbritain"],
    "meetingInfo": {
      "MeetingId": "chime-meeting-id",
      "ExternalMeetingId": "external-meeting-id",
      "MediaRegion": "us-east-1",
      "MediaPlacement": {
        "AudioHostUrl": "audio-host-url",
        "AudioFallbackUrl": "audio-fallback-url",
        "SignalingUrl": "signaling-url",
        "TurnControlUrl": "turn-control-url"
      }
    },
    "attendeeInfo": {
      "ExternalUserId": "agent-id",
      "AttendeeId": "attendee-id",
      "JoinToken": "join-token"
    },
    "updatedAt": "2025-01-01T00:00:00.000Z",
    "ttl": 1735689600
  }
}
```

**Status Codes:**
- `404` - Agent not online/no presence record

### 3. List All Agents

**GET** `/admin/users?limit=50&nextToken=token`

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "username": "agent1@example.com",
      "email": "agent1@example.com",
      "givenName": "Jane",
      "familyName": "Smith",
      "clinics": ["dentistinnewbritain"],
      "roles": { "dentistinnewbritain": "ADMIN" },
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "nextToken": "pagination-token"
}
```

---

## Call Management APIs

### 1. Accept Inbound Call

**POST** `/admin/chime/call-accepted`

```json
{
  "contactId": "connect-contact-id",
  "clinicId": "dentistinnewbritain",
  "callerNumber": "+15551234567"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call accepted successfully",
  "contactId": "connect-contact-id"
}
```

### 2. Reject Inbound Call

**POST** `/admin/chime/call-rejected`

```json
{
  "contactId": "connect-contact-id",
  "clinicId": "dentistinnewbritain",
  "reason": "busy"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call rejected successfully"
}
```

### 3. End Call

**POST** `/admin/chime/call-hungup`

```json
{
  "contactId": "connect-contact-id",
  "clinicId": "dentistinnewbritain"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call ended successfully"
}
```

### 4. Make Outbound Call

**POST** `/admin/chime/outbound-call`

```json
{
  "clinicId": "dentistinnewbritain",
  "destinationNumber": "+15551234567",
  "callerIdNumber": "+18333805017"
}
```

**Response:**
```json
{
  "success": true,
  "contactId": "new-contact-id",
  "message": "Outbound call initiated"
}
```

### 5. Transfer Call

**POST** `/admin/chime/transfer-call`

```json
{
  "contactId": "connect-contact-id",
  "targetNumber": "+15559876543",
  "transferType": "blind"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call transferred successfully"
}
```

---

## WebRTC/Softphone APIs

### 1. Start Agent Session (Go Online)

**POST** `/admin/chime/start-session`

```json
{
  "activeClinicIds": ["dentistinnewbritain", "dentistingreenville"]
}
```

**Response:**
```json
{
  "meeting": {
    "MeetingId": "chime-meeting-id",
    "ExternalMeetingId": "external-meeting-id",
    "MediaRegion": "us-east-1",
    "MediaPlacement": {
      "AudioHostUrl": "https://audio-host.chime.aws",
      "AudioFallbackUrl": "https://audio-fallback.chime.aws",
      "SignalingUrl": "wss://signaling.chime.aws",
      "TurnControlUrl": "https://turn.chime.aws",
      "ScreenDataUrl": "https://screen.chime.aws",
      "ScreenViewingUrl": "https://viewing.chime.aws",
      "ScreenSharingUrl": "https://sharing.chime.aws",
      "EventIngestionUrl": "https://events.chime.aws"
    }
  },
  "attendee": {
    "ExternalUserId": "agent-cognito-sub",
    "AttendeeId": "chime-attendee-id",
    "JoinToken": "join-token-for-websocket"
  }
}
```

**Use this response to initialize the Chime SDK:**

```javascript
import { DefaultMeetingSession, ConsoleLogger, LogLevel, DefaultDeviceController, DefaultMeetingSessionConfiguration } from 'amazon-chime-sdk-js';

const logger = new ConsoleLogger('ChimeSDK', LogLevel.INFO);
const deviceController = new DefaultDeviceController(logger);

const configuration = new DefaultMeetingSessionConfiguration(
  response.meeting,
  response.attendee
);

const meetingSession = new DefaultMeetingSession(
  configuration,
  logger,
  deviceController
);

// Start audio
await meetingSession.audioVideo.start();
```

### 2. Stop Agent Session (Go Offline)

**POST** `/admin/chime/stop-session`

**Response:**
```json
{
  "success": true,
  "message": "Session stopped"
}
```

---

## Clinic Management APIs

### 1. Get Clinic Hours

**GET** `/clinic/clinics/{clinicId}/hours`

**Response:**
```json
{
  "clinicId": "dentistinnewbritain",
  "timezone": "America/New_York",
  "hours": {
    "monday": { "open": "08:00", "close": "17:00", "isOpen": true },
    "tuesday": { "open": "08:00", "close": "17:00", "isOpen": true },
    "wednesday": { "open": "08:00", "close": "17:00", "isOpen": true },
    "thursday": { "open": "08:00", "close": "17:00", "isOpen": true },
    "friday": { "open": "08:00", "close": "17:00", "isOpen": true },
    "saturday": { "open": "09:00", "close": "13:00", "isOpen": true },
    "sunday": { "isOpen": false }
  },
  "holidays": [
    {
      "date": "2025-12-25",
      "name": "Christmas",
      "isClosed": true
    }
  ],
  "specialHours": [
    {
      "date": "2025-12-24",
      "open": "08:00",
      "close": "12:00",
      "note": "Christmas Eve - Early Close"
    }
  ]
}
```

### 2. Update Clinic Hours

**PUT** `/clinic/clinics/{clinicId}/hours`

```json
{
  "timezone": "America/New_York",
  "hours": {
    "monday": { "open": "08:00", "close": "18:00", "isOpen": true }
  }
}
```

### 3. Get Clinic Information

**GET** `/clinic/clinics/{clinicId}/info`

**Response:**
```json
{
  "clinicId": "dentistinnewbritain",
  "name": "Dentist in New Britain",
  "address": "123 Main St, New Britain, CT 06051",
  "phone": "+18333805017",
  "email": "contact@dentistinnewbritain.com",
  "website": "https://dentistinnewbritain.com",
  "settings": {
    "allowOnlineBooking": true,
    "requirePatientPortal": true,
    "enableTextReminders": true
  }
}
```

---

## Callback Management APIs

### 1. Get Callback Requests

**GET** `/clinic/callbacks/{clinicId}`

**Response:**
```json
[
  {
    "RequestID": "uuid-123",
    "name": "John Doe",
    "phone": "+15551234567",
    "email": "john@example.com",
    "message": "Please call me about an appointment",
    "clinicId": "dentistinnewbritain",
    "calledBack": "NO",
    "source": "website",
    "createdAt": "2025-01-01T10:00:00.000Z",
    "updatedAt": "2025-01-01T10:00:00.000Z",
    "notes": null,
    "updatedBy": null
  }
]
```

### 2. Update Callback Status

**PUT** `/clinic/callbacks/{clinicId}`

```json
{
  "RequestID": "uuid-123",
  "calledBack": true,
  "notes": "Spoke with patient, scheduled for next Tuesday"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Updated"
}
```

### 3. Create Callback Request (Public)

**POST** `/clinic/callbacks/{clinicId}`

*No authentication required - for website forms*

```json
{
  "name": "Jane Smith",
  "phone": "+15559876543",
  "email": "jane@example.com",
  "message": "Need to reschedule appointment",
  "source": "website"
}
```

---

## WebSocket APIs

### Connection

**WebSocket URL:** `wss://your-websocket-url/prod`

### Authentication

Send authentication immediately after connection:

```json
{
  "action": "authenticate",
  "token": "your-jwt-token"
}
```

### Subscribe to Call Events

```json
{
  "action": "subscribe",
  "clinicIds": ["dentistinnewbritain", "dentistingreenville"]
}
```

### Incoming Call Event

```json
{
  "event": "incomingCall",
  "data": {
    "contactId": "connect-contact-id",
    "clinicId": "dentistinnewbritain",
    "callerNumber": "+15551234567",
    "callerName": "John Doe",
    "timestamp": "2025-01-01T10:00:00.000Z"
  }
}
```

### Call Status Update

```json
{
  "event": "callStatusUpdate",
  "data": {
    "contactId": "connect-contact-id",
    "status": "connected",
    "agentId": "agent-cognito-sub",
    "timestamp": "2025-01-01T10:00:05.000Z"
  }
}
```

### Agent Status Update

```json
{
  "event": "agentStatusUpdate",
  "data": {
    "agentId": "agent-cognito-sub",
    "status": "Available",
    "timestamp": "2025-01-01T10:00:00.000Z"
  }
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional error context"
  }
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

### Error Codes

- `AUTH_FAILED` - Authentication failed
- `TOKEN_EXPIRED` - JWT token expired
- `INVALID_CLINIC` - Invalid clinic ID
- `NO_ACCESS` - No access to requested resource
- `CALL_NOT_FOUND` - Call/Contact not found
- `AGENT_OFFLINE` - Agent is not online
- `SESSION_EXISTS` - Agent session already active

---

## Frontend Integration Guide

### 1. Initial Setup

```javascript
// Initialize the contact center
class ContactCenter {
  constructor(config) {
    this.apiBase = config.apiBase;
    this.wsUrl = config.wsUrl;
    this.token = null;
    this.meetingSession = null;
    this.websocket = null;
  }

  async initiateLogin(email) {
    const response = await fetch(`${this.apiBase}/auth/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to initiate login');
    }
    
    // Store session for OTP verification
    this.authSession = data.session;
    
    return data;
  }
  
  async verifyOTP(email, otp) {
    const response = await fetch(`${this.apiBase}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email, 
        otp, 
        session: this.authSession 
      })
    });
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to verify OTP');
    }
    
    this.token = data.idToken;
    
    // Store tokens securely
    localStorage.setItem('idToken', data.idToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    
    // Parse user info from JWT token
    this.user = this.parseJwt(data.idToken);
    
    return data;
  }

  parseJwt(token) {
    try {
      // Extract the JWT payload
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error('Failed to parse JWT token:', e);
      return {};
    }
  }

  async goOnline(clinicIds) {
    const response = await fetch(`${this.apiBase}/admin/chime/start-session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ activeClinicIds: clinicIds })
    });
    
    const data = await response.json();
    
    // Initialize Chime SDK
    await this.initializeChimeSDK(data.meeting, data.attendee);
    
    // Connect to WebSocket
    await this.connectWebSocket();
    
    return data;
  }

  async initializeChimeSDK(meeting, attendee) {
    // Chime SDK initialization code here
    const configuration = new DefaultMeetingSessionConfiguration(meeting, attendee);
    this.meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
    
    // Set up audio/video observers
    this.meetingSession.audioVideo.addObserver({
      audioVideoDidStart: () => console.log('Session started'),
      audioVideoDidStop: () => console.log('Session stopped')
    });
    
    // Start audio
    await this.meetingSession.audioVideo.start();
  }

  async connectWebSocket() {
    this.websocket = new WebSocket(this.wsUrl);
    
    this.websocket.onopen = () => {
      // Authenticate
      this.websocket.send(JSON.stringify({
        action: 'authenticate',
        token: this.token
      }));
      
      // Subscribe to events
      this.websocket.send(JSON.stringify({
        action: 'subscribe',
        clinicIds: this.user.x_clinics.split(',')
      }));
    };
    
    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };
  }

  handleWebSocketMessage(data) {
    switch(data.event) {
      case 'incomingCall':
        this.handleIncomingCall(data.data);
        break;
      case 'callStatusUpdate':
        this.handleCallStatusUpdate(data.data);
        break;
      case 'agentStatusUpdate':
        this.handleAgentStatusUpdate(data.data);
        break;
    }
  }

  async acceptCall(contactId, clinicId, callerNumber) {
    return await fetch(`${this.apiBase}/admin/chime/call-accepted`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contactId, clinicId, callerNumber })
    });
  }

  async makeCall(clinicId, phoneNumber) {
    return await fetch(`${this.apiBase}/admin/chime/outbound-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clinicId,
        destinationNumber: phoneNumber,
        callerIdNumber: this.getClinicPhoneNumber(clinicId)
      })
    });
  }
}
```

### 2. UI Components Required

1. **Login Screen**
   - Email field for OTP initiation
   - OTP entry field
   - Resend OTP option
   - Remember me option

2. **Agent Dashboard**
   - Status indicator (Online/Offline)
   - Active clinics selector
   - Call statistics

3. **Softphone Interface**
   - Dialpad
   - Call/End call buttons
   - Mute/Unmute toggle
   - Hold/Resume toggle
   - Transfer button
   - Volume controls

4. **Call Queue Display**
   - Incoming calls list
   - Caller information
   - Wait time
   - Accept/Reject buttons

5. **Call History**
   - Recent calls list
   - Call details (duration, notes)
   - Callback requests

6. **Settings Panel**
   - Audio device selection
   - Notification preferences
   - Status preferences

### 3. State Management

```javascript
// Redux/Zustand store structure
const store = {
  auth: {
    isAuthenticated: false,
    user: null,
    tokens: null
  },
  agent: {
    status: 'Offline',
    presence: null,
    activeClinics: []
  },
  calls: {
    activeCall: null,
    callQueue: [],
    callHistory: []
  },
  softphone: {
    isConnected: false,
    isMuted: false,
    isOnHold: false,
    audioDevices: {
      input: null,
      output: null
    }
  },
  callbacks: {
    pending: [],
    completed: []
  }
};
```

### 4. Key Event Handlers

```javascript
// Handle incoming call notification
function handleIncomingCall(callData) {
  // Show notification
  showNotification(`Incoming call from ${callData.callerNumber}`);
  
  // Add to queue
  addToCallQueue(callData);
  
  // Play ringtone
  playRingtone();
  
  // Update UI
  updateCallQueueDisplay();
}

// Handle call acceptance
async function acceptCall(contactId, clinicId, callerNumber) {
  try {
    // Stop ringtone
    stopRingtone();
    
    // Send accept request
    await contactCenter.acceptCall(contactId, clinicId, callerNumber);
    
    // Update UI
    setActiveCall({ contactId, clinicId, callerNumber });
    showCallScreen();
    
    // Start call timer
    startCallTimer();
  } catch (error) {
    showError('Failed to accept call');
  }
}

// Handle call end
async function endCall(contactId, clinicId) {
  try {
    // Send hangup request
    await contactCenter.endCall(contactId, clinicId);
    
    // Stop call timer
    stopCallTimer();
    
    // Update UI
    clearActiveCall();
    hideCallScreen();
    
    // Save call log
    saveCallToHistory();
  } catch (error) {
    showError('Failed to end call');
  }
}
```

### 5. Best Practices

1. **Token Management**
   - Refresh tokens before expiry
   - Store securely (HttpOnly cookies preferred)
   - Clear on logout

2. **Error Recovery**
   - Implement exponential backoff for retries
   - Graceful WebSocket reconnection
   - Offline queue for failed requests

3. **Performance**
   - Lazy load clinic data
   - Paginate call history
   - Cache frequently accessed data
   - Debounce search inputs

4. **User Experience**
   - Show connection status clearly
   - Provide audio level indicators
   - Enable keyboard shortcuts
   - Support dark mode
   - Implement accessibility features

5. **Security**
   - Validate all inputs
   - Sanitize phone numbers
   - Implement rate limiting
   - Log security events
   - Use HTTPS everywhere

---

## Testing Endpoints

### Health Check

**GET** `/admin/health`

```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T10:00:00.000Z",
  "version": "1.0.0"
}
```

### Echo Test (Development Only)

**POST** `/admin/echo`

```json
{
  "message": "test"
}
```

**Response:**
```json
{
  "echo": "test",
  "timestamp": "2025-01-01T10:00:00.000Z"
}
```

---

## Rate Limits

- **Authentication**: 5 requests per minute
- **API Calls**: 100 requests per minute per user
- **WebSocket Messages**: 10 per second
- **Callback Creation**: 10 per hour per IP

---

## Support & Resources

- **API Status**: https://status.todaysdentalinsights.com
- **Developer Portal**: https://developers.todaysdentalinsights.com
- **Support Email**: api-support@todaysdentalinsights.com
- **SDK Documentation**: https://docs.todaysdentalinsights.com/sdk

---

## Version History

- **v1.0.0** (2025-01-01): Initial release
- **v1.1.0** (2025-02-01): Added WebSocket support
- **v1.2.0** (2025-03-01): Enhanced call transfer capabilities

---

*Last Updated: January 2025*
