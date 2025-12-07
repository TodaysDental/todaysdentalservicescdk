# Quick Reference: Join Calls API

## 🚀 Quick Start

### 1. Get All Joinable Calls
```bash
curl -X GET "https://apig.todaysdentalinsights.com/admin/call-center/get-joinable-calls" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Join a Queued Call (Agent)
```bash
curl -X POST "https://apig.todaysdentalinsights.com/admin/call-center/join-queued-call" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"callId":"call-123","clinicId":"clinic-456"}'
```

### 3. Monitor an Active Call (Supervisor)
```bash
curl -X POST "https://apig.todaysdentalinsights.com/admin/call-center/join-active-call" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"callId":"call-789","clinicId":"clinic-456","mode":"silent"}'
```

---

## 📋 API Endpoints Summary

| Endpoint | Method | Role | Purpose |
|----------|--------|------|---------|
| `/admin/call-center/get-joinable-calls` | GET | Agent/Supervisor | List all joinable calls |
| `/admin/call-center/join-queued-call` | POST | Agent/Supervisor | Pick up queued call |
| `/admin/call-center/join-active-call` | POST | Supervisor | Monitor active call |

---

## 🎭 Monitor Modes

| Mode | Description | Audio |
|------|-------------|-------|
| `silent` | Listen only | Supervisor hears all, but is muted |
| `barge` | Full participation | All parties hear each other |
| `whisper` | Coach agent (future) | Only agent hears supervisor |

---

## 🔑 Response Fields

### Queued Call
```json
{
  "callId": "call-123",
  "phoneNumber": "+12223334444",
  "priority": "high",
  "isVip": true,
  "waitTime": 180,
  "queuePosition": "..."
}
```

### Active Call
```json
{
  "callId": "call-456",
  "assignedAgentId": "agent@example.com",
  "status": "connected",
  "duration": 240,
  "supervisors": []
}
```

---

## ⚡ TypeScript

```typescript
import { JoinQueuedCallRequest, JoinActiveCallRequest } from '@/types/join-call-types';

// Join queued call
const request: JoinQueuedCallRequest = {
  callId: 'call-123',
  clinicId: 'clinic-456'
};

// Join active call
const request: JoinActiveCallRequest = {
  callId: 'call-789',
  clinicId: 'clinic-456',
  mode: 'silent'
};
```

---

## ✅ Permissions

| Action | Agent | Supervisor |
|--------|-------|------------|
| View queued calls | ✅ Own clinics | ✅ All clinics |
| Join queued calls | ✅ Own clinics | ✅ All clinics |
| View active calls | ❌ | ✅ |
| Join active calls | ❌ | ✅ |

---

## 📖 Full Documentation

See `docs/CALL-CENTER-JOIN-API.md` for complete documentation.

