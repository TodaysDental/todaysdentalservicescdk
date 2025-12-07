# Analytics Stack API Documentation

## Overview

The Analytics Stack provides call analytics, reporting, agent performance tracking, and real-time insights for the call center. It processes call data from the Chime Stack and provides comprehensive analytics endpoints.

**Base URL:** `https://apig.todaysdentalinsights.com/admin/analytics`

All endpoints require JWT authentication via the Authorization header.

---

## Table of Contents

1. [Call Analytics](#1-call-analytics)
2. [Live Call Analytics](#2-live-call-analytics)
3. [Clinic Analytics](#3-clinic-analytics)
4. [Agent Analytics](#4-agent-analytics)
5. [Analytics Summary](#5-analytics-summary)
6. [Agent Rankings](#6-agent-rankings)
7. [Queue Calls](#7-queue-calls)
8. [Detailed Call Analytics](#8-detailed-call-analytics)
9. [Call Center Dashboard](#9-call-center-dashboard)
10. [Error Responses](#10-error-responses)
11. [Data Models](#11-data-models)
12. [Infrastructure Components](#12-infrastructure-components)

---

## 1. Call Analytics

### 1.1 Get Call Analytics by ID

Retrieves detailed analytics for a specific completed call.

**Endpoint:** `GET /admin/analytics/call/{callId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| If-None-Match | string | No | ETag for conditional request |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| callId | string | Call unique identifier |

**Success Response (200):**
```json
{
  "callId": "call-uuid-123",
  "clinicId": "clinic-123",
  "agentId": "agent@example.com",
  "timestamp": 1705321800,
  
  "callStartTime": "2024-01-15T10:30:00.000Z",
  "callEndTime": "2024-01-15T10:35:00.000Z",
  "totalDuration": 300,
  "talkTime": 250,
  "holdTime": 30,
  "wrapUpTime": 20,
  
  "direction": "inbound",
  "phoneNumber": "+12025551234",
  "callStatus": "completed",
  "callCategory": "appointment_scheduling",
  
  "overallSentiment": "POSITIVE",
  "sentimentScore": {
    "positive": 0.75,
    "negative": 0.05,
    "neutral": 0.15,
    "mixed": 0.05
  },
  
  "speakerMetrics": {
    "agentTalkPercentage": 45,
    "callerTalkPercentage": 50,
    "silencePercentage": 5,
    "interruptionCount": 2
  },
  
  "audioQuality": {
    "qualityScore": 4.2,
    "jitter": 12,
    "packetLoss": 0.5,
    "latency": 45
  },
  
  "detectedIssues": [],
  "keywords": ["appointment", "cleaning", "insurance"],
  
  "finalized": true,
  "finalizedAt": "2024-01-15T10:36:00.000Z",
  "analyticsState": "FINALIZED",
  
  "etag": "Y2FsbC11dWlkLTE3MDUzMjE4MDA="
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| callId | string | Unique call identifier |
| clinicId | string | Clinic handling the call |
| agentId | string | Agent who handled the call |
| timestamp | number | Call timestamp (epoch seconds) |
| totalDuration | number | Total call duration in seconds |
| talkTime | number | Active talk time in seconds |
| holdTime | number | Time on hold in seconds |
| direction | string | `inbound` or `outbound` |
| callStatus | string | Final call status |
| callCategory | string | Categorized call type |
| overallSentiment | string | `POSITIVE`, `NEGATIVE`, `NEUTRAL`, `MIXED` |
| sentimentScore | object | Detailed sentiment scores (0-1) |
| speakerMetrics | object | Talk time distribution |
| audioQuality | object | Call quality metrics |
| detectedIssues | array | Issues detected during call |
| keywords | array | Keywords extracted from call |
| analyticsState | string | Analytics processing state |

**Conditional Response (304):**
If `If-None-Match` header matches the current ETag, returns 304 Not Modified.

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing callId parameter` | No call ID provided |
| 403 | `Unauthorized` | No access to clinic |
| 404 | `Call analytics not found` | Call not found |

---

## 2. Live Call Analytics

### 2.1 Get Live Call Analytics

Retrieves real-time analytics for an active call.

**Endpoint:** `GET /admin/analytics/live`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |
| If-None-Match | string | No | ETag for conditional request |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| callId | string | Yes | Active call ID |

**Success Response (200) - Active Call:**
```json
{
  "callId": "call-uuid-123",
  "clinicId": "clinic-123",
  "agentId": "agent@example.com",
  "timestamp": 1705321800,
  
  "callStartTime": "2024-01-15T10:30:00.000Z",
  "isLive": true,
  "activeSeconds": 185,
  
  "overallSentiment": "NEUTRAL",
  "sentimentScore": {
    "positive": 0.40,
    "negative": 0.10,
    "neutral": 0.45,
    "mixed": 0.05
  },
  
  "speakerMetrics": {
    "agentTalkPercentage": 48,
    "callerTalkPercentage": 47,
    "silencePercentage": 5
  },
  
  "recentTranscript": [
    { "speaker": "caller", "text": "I need to schedule an appointment", "timestamp": "10:32:15" },
    { "speaker": "agent", "text": "I can help you with that", "timestamp": "10:32:18" }
  ],
  
  "analyticsState": "ACTIVE",
  "fetchedAt": 1705322000,
  "lastUpdatedSeconds": 5,
  "etag": "Y2FsbC11dWlkLTE3MDUzMjE4MDA="
}
```

**Success Response (200) - Call Finalizing:**
```json
{
  "callId": "call-uuid-123",
  "status": "finalizing",
  "message": "Call has ended and is being finalized. Check back shortly for complete analytics.",
  "estimatedReadyIn": 30,
  "estimatedReadyAt": 1705322030,
  "isLive": false,
  "isFinalizing": true,
  "hint": "Poll this endpoint or use GET /analytics/call/{callId} once finalized"
}
```

**Success Response (200) - Call Finalized:**
```json
{
  "status": "finalized",
  "message": "Call has been finalized. Use GET /analytics/call/{callId} for complete analytics.",
  "callId": "call-uuid-123",
  "callEndTime": "2024-01-15T10:35:00.000Z",
  "isCompleted": true,
  "redirectTo": "/analytics/call/call-uuid-123"
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Missing callId query parameter` | No call ID provided |
| 400 | `STALE_CALL_DATA` | Call data appears stale (>4 hours) |
| 403 | `Unauthorized` | No access to clinic |
| 404 | `Call analytics not found` | Call not found |

---

## 3. Clinic Analytics

### 3.1 Get Clinic Analytics

Retrieves analytics for all calls at a specific clinic within a time range.

**Endpoint:** `GET /admin/analytics/clinic/{clinicId}`

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
| startTime | number | No | Start timestamp (epoch seconds). Default: 24 hours ago |
| endTime | number | No | End timestamp (epoch seconds). Default: now |
| limit | number | No | Max results per page (default: 100, max: 100) |
| lastEvaluatedKey | string | No | Pagination token (base64 encoded) |
| sentiment | string | No | Filter by sentiment: `POSITIVE`, `NEGATIVE`, `NEUTRAL`, `MIXED` |
| minDuration | number | No | Minimum call duration in seconds |
| hasIssues | boolean | No | Filter to calls with detected issues |
| category | string | No | Filter by call category |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "startTime": 1705235400,
  "endTime": 1705321800,
  "totalCalls": 45,
  "calls": [
    {
      "callId": "call-uuid-123",
      "timestamp": 1705321800,
      "agentId": "agent@example.com",
      "phoneNumber": "+12025551234",
      "direction": "inbound",
      "totalDuration": 300,
      "overallSentiment": "POSITIVE",
      "callCategory": "appointment_scheduling",
      "callStatus": "completed"
    }
  ],
  "hasMore": true,
  "lastEvaluatedKey": "eyJjbGluaWNJZCI6ImNsaW5pYy0xMjMiLCJ0aW1lc3RhbXAiOjE3MDUzMjE4MDB9"
}
```

**Time Range Validation:**
- `startTime` must be before `endTime`
- Range cannot exceed 90 days
- `startTime` cannot be more than 1 year in the past
- `endTime` cannot be more than 1 hour in the future

---

## 4. Agent Analytics

### 4.1 Get Agent Analytics

Retrieves analytics for a specific agent.

**Endpoint:** `GET /admin/analytics/agent/{agentId}`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| agentId | string | Agent's email/ID |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| startTime | number | No | Start timestamp. Default: 7 days ago |
| endTime | number | No | End timestamp. Default: now |
| limit | number | No | Max results per page (default: 100) |
| lastEvaluatedKey | string | No | Pagination token |

**Authorization:**
- Admins can view any agent in their authorized clinics
- Non-admins can only view their own analytics

**Success Response (200):**
```json
{
  "agentId": "agent@example.com",
  "startTime": 1704716800,
  "endTime": 1705321800,
  "callsInPage": 50,
  "totalCalls": 127,
  "totalCallsNote": "Complete total from pre-aggregated data",
  
  "metrics": {
    "page": {
      "averageDuration": 285,
      "averageTalkPercentage": 48,
      "sentimentBreakdown": {
        "POSITIVE": 35,
        "NEGATIVE": 5,
        "NEUTRAL": 8,
        "MIXED": 2
      },
      "categoryBreakdown": {
        "appointment_scheduling": 20,
        "billing_inquiry": 15,
        "general_inquiry": 10,
        "complaint": 5
      },
      "issuesDetected": 3,
      "averageQualityScore": 4.1,
      "weightedSentimentScore": 72,
      "_note": "These metrics calculated from current page only"
    },
    "total": {
      "averageDuration": 290,
      "averageTalkPercentage": 47,
      "sentimentBreakdown": {...},
      "totalCalls": 127,
      "_note": "These metrics calculated from complete dataset"
    }
  },
  
  "calls": [...],
  
  "pagination": {
    "hasMore": true,
    "lastEvaluatedKey": "eyJhZ2VudElkIjoiYWdlbnRAZXhhbXBsZS5jb20iLCJ0aW1lc3RhbXAiOjE3MDUzMjE4MDB9",
    "isPaginated": true,
    "warning": null
  }
}
```

**Error Responses:**
| Status | Error | Description |
|--------|-------|-------------|
| 403 | `INSUFFICIENT_PERMISSIONS` | Cannot view other agent's data |
| 403 | `CROSS_CLINIC_ACCESS_DENIED` | Agent in unauthorized clinic |
| 404 | `AGENT_NOT_FOUND` | Agent doesn't exist |

---

## 5. Analytics Summary

### 5.1 Get Analytics Summary

Retrieves aggregate metrics for a clinic.

**Endpoint:** `GET /admin/analytics/summary`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic to summarize |
| startTime | number | No | Start timestamp. Default: 24 hours ago |
| endTime | number | No | End timestamp. Default: now |
| limit | number | No | Max records to analyze (default: 1000) |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "startTime": 1705235400,
  "endTime": 1705321800,
  
  "summary": {
    "totalCalls": 156,
    "averageDuration": 275,
    "averageTalkPercentage": 46,
    
    "sentimentBreakdown": {
      "POSITIVE": 98,
      "NEGATIVE": 12,
      "NEUTRAL": 38,
      "MIXED": 8
    },
    
    "categoryBreakdown": {
      "appointment_scheduling": 65,
      "billing_inquiry": 35,
      "general_inquiry": 30,
      "insurance_verification": 15,
      "complaint": 8,
      "other": 3
    },
    
    "topIssues": [
      { "issue": "long_hold_time", "count": 8 },
      { "issue": "call_quality_poor", "count": 5 },
      { "issue": "customer_frustrated", "count": 4 }
    ],
    
    "averageQualityScore": 4.0,
    "weightedSentimentScore": 68,
    
    "callVolumeByHour": [
      { "hour": 0, "count": 0 },
      { "hour": 1, "count": 0 },
      { "hour": 8, "count": 12 },
      { "hour": 9, "count": 25 },
      { "hour": 10, "count": 28 },
      { "hour": 11, "count": 22 },
      { "hour": 12, "count": 15 },
      { "hour": 13, "count": 18 },
      { "hour": 14, "count": 20 },
      { "hour": 15, "count": 16 }
    ],
    
    "_isPartial": false,
    "_warning": null
  },
  
  "dataCompleteness": {
    "isComplete": true,
    "isPartial": false,
    "recordsAnalyzed": 156,
    "dataQuality": "COMPLETE"
  },
  
  "pagination": {
    "hasMore": false,
    "lastEvaluatedKey": null,
    "recordsInPage": 156,
    "limit": 1000
  }
}
```

---

## 6. Agent Rankings

### 6.1 Get Agent Rankings

Retrieves agent leaderboard/rankings for a clinic.

**Endpoint:** `GET /admin/analytics/rankings`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic to get rankings for |
| period | string | No | `daily`, `weekly`, `monthly`, `quarterly`, `yearly`, `custom`. Default: `weekly` |
| criteria | string | No | Ranking criteria. Default: `performanceScore` |
| startTime | number | No | Start timestamp (for custom period) |
| endTime | number | No | End timestamp (for custom period) |
| limit | number | No | Max agents to return (default: 50, max: 100) |
| includeInactive | boolean | No | Include agents with 0 calls. Default: false |

**Ranking Criteria Options:**
| Criteria | Description |
|----------|-------------|
| `performanceScore` | Overall performance score (default) |
| `callVolume` | Total call count |
| `sentimentScore` | Customer sentiment |
| `avgHandleTime` | Average handle time (lower is better) |
| `customerSatisfaction` | Positive call percentage |
| `efficiency` | Completion rate minus issues |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "period": {
    "type": "weekly",
    "startTime": 1704716800,
    "endTime": 1705321800,
    "label": "Week of January 8, 2024"
  },
  "criteria": "performanceScore",
  
  "rankings": [
    {
      "rank": 1,
      "rankLabel": "1st",
      "agentId": "top.agent@example.com",
      "agentName": "John Smith",
      "firstName": "John",
      "lastName": "Smith",
      "initials": "JS",
      "clinicId": "clinic-123",
      "status": "Available",
      "statusLabel": "Available",
      
      "performanceScore": 92,
      "totalCalls": 145,
      "completedCalls": 142,
      "missedCalls": 3,
      "callsToday": 18,
      "missedToday": 0,
      
      "sentimentScore": 78,
      "satisfactionRating": 89,
      "positiveCallsPercent": 72,
      "negativeCallsPercent": 5,
      
      "avgHandleTime": 265,
      "avgHandleTimeFormatted": "4:25",
      "avgTalkTime": 220,
      "avgHoldTime": 15,
      
      "issueCount": 2,
      "qualityScore": 4.3,
      
      "trend": {
        "direction": "up",
        "changePercent": 8,
        "previousRank": 3
      },
      
      "badges": [
        {
          "id": "top_performer",
          "name": "Top Performer",
          "icon": "🏆",
          "color": "#FFD700",
          "description": "Ranked #1 in clinic",
          "earnedAt": "2024-01-15T00:00:00.000Z"
        },
        {
          "id": "sentiment_star",
          "name": "Sentiment Star",
          "icon": "⭐",
          "color": "#FFA500",
          "description": "90%+ positive calls",
          "earnedAt": "2024-01-15T00:00:00.000Z"
        }
      ]
    }
  ],
  
  "totalAgents": 12,
  
  "clinicStats": {
    "avgPerformanceScore": 75,
    "totalCalls": 856,
    "avgSentimentScore": 65,
    "avgHandleTime": 290
  },
  
  "highlights": {
    "topPerformer": { "agentId": "top.agent@example.com", "performanceScore": 92 },
    "mostImproved": { "agentId": "improving@example.com", "trend": { "changePercent": 25 } },
    "callLeader": { "agentId": "busy.bee@example.com", "totalCalls": 180 },
    "sentimentLeader": { "agentId": "happy@example.com", "sentimentScore": 88 }
  },
  
  "generatedAt": "2024-01-15T12:00:00.000Z",
  "dataCompleteness": "complete"
}
```

**Available Badges:**
| Badge ID | Name | Criteria |
|----------|------|----------|
| `top_performer` | Top Performer | Rank #1 |
| `call_champion` | Call Champion | 100+ calls |
| `sentiment_star` | Sentiment Star | 90%+ positive |
| `speed_demon` | Speed Demon | Below avg handle time with good quality |
| `rising_star` | Rising Star | Improved 20%+ |
| `zero_issues` | Flawless | No issues with 10+ calls |
| `customer_favorite` | Customer Favorite | 95%+ satisfaction with 20+ calls |

---

## 7. Queue Calls

### 7.1 Get Queue Calls

Retrieves all calls currently in queue for a clinic.

**Endpoint:** `GET /admin/analytics/queue`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic to get queue for |
| status | string | No | Filter: `queued`, `ringing`, `active`, `on_hold`, `all`. Default: `all` |
| limit | number | No | Max calls to return (default: 100, max: 500) |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  
  "queuedCalls": [
    {
      "callId": "call-uuid-1",
      "phoneNumber": "+12025551234",
      "callerName": "Jane Doe",
      "queuePosition": 1,
      "status": "queued",
      "statusLabel": "Waiting",
      "priority": "normal",
      "priorityLabel": "Normal",
      "waitTime": 120,
      "waitTimeFormatted": "2:00",
      "queuedAt": "2024-01-15T10:28:00.000Z",
      "direction": "inbound",
      "isVip": false,
      "callbackRequested": false
    }
  ],
  
  "ringingCalls": [
    {
      "callId": "call-uuid-2",
      "phoneNumber": "+12025559876",
      "queuePosition": 0,
      "status": "ringing",
      "statusLabel": "Ringing",
      "assignedAgentId": "agent@example.com",
      "assignedAgentName": "John Smith",
      "waitTime": 45,
      "waitTimeFormatted": "0:45"
    }
  ],
  
  "activeCalls": [
    {
      "callId": "call-uuid-3",
      "phoneNumber": "+12025554567",
      "status": "active",
      "statusLabel": "Active",
      "assignedAgentId": "other.agent@example.com",
      "waitTime": 0,
      "waitTimeFormatted": "0:00"
    }
  ],
  
  "onHoldCalls": [],
  
  "summary": {
    "totalQueued": 3,
    "totalRinging": 1,
    "totalActive": 2,
    "totalOnHold": 0,
    "avgWaitTime": 85,
    "avgWaitTimeFormatted": "1:25",
    "longestWait": 180,
    "longestWaitFormatted": "3:00"
  },
  
  "generatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Priority Levels:**
| Priority | Description |
|----------|-------------|
| `vip` | VIP customer |
| `high` | High priority |
| `normal` | Normal priority (default) |
| `low` | Low priority |

---

## 8. Detailed Call Analytics

### 8.1 Get Detailed Analytics

Retrieves comprehensive analytics including full transcript, history, and insights.

**Endpoint:** `GET /admin/analytics/detailed/{callId}`

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
  "callId": "call-uuid-123",
  "clinicId": "clinic-123",
  "agentId": "agent@example.com",
  
  "callDetails": {
    "startTime": "2024-01-15T10:30:00.000Z",
    "endTime": "2024-01-15T10:35:00.000Z",
    "duration": 300,
    "direction": "inbound",
    "phoneNumber": "+12025551234",
    "status": "completed"
  },
  
  "transcript": {
    "status": "completed",
    "fullText": "Complete transcription...",
    "segments": [
      {
        "speaker": "agent",
        "text": "Thank you for calling, how can I help you?",
        "startTime": 0,
        "endTime": 3.5,
        "confidence": 0.98
      },
      {
        "speaker": "caller",
        "text": "I need to schedule a cleaning appointment",
        "startTime": 4.0,
        "endTime": 6.8,
        "confidence": 0.95
      }
    ],
    "speakerLabels": ["agent", "caller"]
  },
  
  "sentimentAnalysis": {
    "overall": "POSITIVE",
    "scores": {
      "positive": 0.75,
      "negative": 0.05,
      "neutral": 0.15,
      "mixed": 0.05
    },
    "timeline": [
      { "segment": 1, "sentiment": "NEUTRAL", "score": 0.50 },
      { "segment": 2, "sentiment": "POSITIVE", "score": 0.70 },
      { "segment": 3, "sentiment": "POSITIVE", "score": 0.85 }
    ]
  },
  
  "callerHistory": {
    "phoneNumber": "+12025551234",
    "previousCalls": 5,
    "firstContact": "2023-06-15T14:00:00.000Z",
    "lastContact": "2024-01-10T11:30:00.000Z",
    "averageSentiment": "POSITIVE",
    "recentCalls": [
      {
        "callId": "prev-call-uuid",
        "date": "2024-01-10T11:30:00.000Z",
        "duration": 180,
        "category": "appointment_scheduling",
        "sentiment": "POSITIVE"
      }
    ]
  },
  
  "insights": {
    "callCategory": "appointment_scheduling",
    "intent": "schedule_cleaning",
    "keyTopics": ["appointment", "cleaning", "insurance", "availability"],
    "actionItems": [
      "Schedule appointment for January 20th",
      "Verify insurance coverage"
    ],
    "suggestions": [
      "Offer preventive care reminders",
      "Mention current promotions"
    ]
  },
  
  "recording": {
    "available": true,
    "recordingId": "rec-uuid-123",
    "duration": 300,
    "downloadUrl": "https://presigned-url..."
  }
}
```

---

## 9. Call Center Dashboard

### 9.1 Get Dashboard Metrics

Retrieves unified dashboard metrics for call center operations.

**Endpoint:** `GET /admin/analytics/dashboard`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | `Bearer <accessToken>` |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clinicId | string | Yes | Clinic to get dashboard for |

**Success Response (200):**
```json
{
  "clinicId": "clinic-123",
  "generatedAt": "2024-01-15T12:00:00.000Z",
  
  "realTimeMetrics": {
    "agentsOnline": 8,
    "agentsOnCall": 3,
    "agentsAvailable": 5,
    "callsInQueue": 2,
    "callsRinging": 1,
    "activeCalls": 4,
    "callsOnHold": 1,
    "averageWaitTime": 45,
    "longestWait": 120,
    "serviceLevelPercent": 85
  },
  
  "todayMetrics": {
    "totalCalls": 78,
    "inboundCalls": 65,
    "outboundCalls": 13,
    "completedCalls": 72,
    "abandonedCalls": 4,
    "missedCalls": 2,
    "averageHandleTime": 285,
    "averageWaitTime": 38,
    "averageTalkTime": 240
  },
  
  "sentimentToday": {
    "positive": 52,
    "negative": 8,
    "neutral": 15,
    "mixed": 3,
    "averageScore": 72
  },
  
  "hourlyVolume": [
    { "hour": 8, "calls": 5, "avgWait": 20 },
    { "hour": 9, "calls": 12, "avgWait": 35 },
    { "hour": 10, "calls": 15, "avgWait": 45 },
    { "hour": 11, "calls": 18, "avgWait": 55 },
    { "hour": 12, "calls": 8, "avgWait": 25 }
  ],
  
  "agentStatus": [
    { "agentId": "agent1@example.com", "name": "John Smith", "status": "OnCall", "currentCallDuration": 180 },
    { "agentId": "agent2@example.com", "name": "Jane Doe", "status": "Available", "callsToday": 12 },
    { "agentId": "agent3@example.com", "name": "Bob Wilson", "status": "OnCall", "currentCallDuration": 45 }
  ],
  
  "alerts": [
    {
      "type": "high_wait_time",
      "severity": "warning",
      "message": "Average wait time exceeds 60 seconds",
      "value": 85,
      "threshold": 60
    }
  ]
}
```

---

## 10. Error Responses

### Common Error Codes

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `MISSING_PARAMETER` | Required parameter missing |
| 400 | `INVALID_TIME_FORMAT` | Invalid timestamp format |
| 400 | `INVALID_TIME_RANGE` | startTime >= endTime |
| 400 | `TIME_RANGE_TOO_OLD` | startTime > 1 year ago |
| 400 | `TIME_RANGE_TOO_LARGE` | Range > 90 days |
| 400 | `INVALID_PAGINATION_TOKEN` | Malformed or tampered token |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 403 | `INSUFFICIENT_PERMISSIONS` | No access to resource |
| 403 | `CROSS_CLINIC_ACCESS_DENIED` | Agent in unauthorized clinic |
| 404 | `NOT_FOUND` | Resource not found |
| 500 | `INTERNAL_ERROR` | Server error |

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

## 11. Data Models

### Call Analytics Record

```typescript
interface CallAnalytics {
  callId: string;                     // Partition key
  timestamp: number;                  // Sort key (epoch seconds)
  clinicId: string;
  agentId: string;
  
  // Call details
  callStartTime: string;
  callEndTime?: string;
  totalDuration: number;              // seconds
  talkTime: number;
  holdTime: number;
  wrapUpTime?: number;
  
  direction: 'inbound' | 'outbound';
  phoneNumber: string;
  callStatus: CallStatus;
  callCategory?: string;
  
  // Sentiment
  overallSentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  sentimentScore: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
  
  // Speaker metrics
  speakerMetrics: {
    agentTalkPercentage: number;
    callerTalkPercentage: number;
    silencePercentage: number;
    interruptionCount?: number;
  };
  
  // Quality
  audioQuality: {
    qualityScore: number;             // 1-5
    jitter?: number;
    packetLoss?: number;
    latency?: number;
  };
  
  detectedIssues: string[];
  keywords: string[];
  
  // State
  analyticsState: AnalyticsState;
  finalized: boolean;
  finalizedAt?: string;
  
  ttl: number;
}

type CallStatus = 'queued' | 'ringing' | 'connected' | 'completed' | 'abandoned' | 'failed';
type AnalyticsState = 'INITIALIZING' | 'ACTIVE' | 'FINALIZING' | 'FINALIZED';
```

### Call Categories

| Category | Description |
|----------|-------------|
| `appointment_scheduling` | Scheduling appointments |
| `appointment_confirmation` | Confirming existing appointments |
| `appointment_cancellation` | Cancelling appointments |
| `billing_inquiry` | Billing questions |
| `insurance_verification` | Insurance-related calls |
| `general_inquiry` | General questions |
| `complaint` | Customer complaints |
| `emergency` | Emergency situations |
| `follow_up` | Follow-up calls |
| `other` | Uncategorized |

---

## 12. Infrastructure Components

### DynamoDB Tables

| Table | Purpose |
|-------|---------|
| `{StackName}-CallAnalyticsV2` | Call analytics data |
| `{StackName}-CallAnalytics-dedupV2` | Deduplication for processing |
| `{StackName}-AnalyticsFailuresV2` | Failed processing records |
| `{StackName}-TranscriptBuffersV2` | Transcript storage during calls |
| `{StackName}-AgentPerformanceFailuresV2` | Agent performance failures |
| `{StackName}-ReconciliationV2` | Daily reconciliation reports |

### Global Secondary Indexes

| Index | Table | Purpose |
|-------|-------|---------|
| `clinicId-timestamp-index` | CallAnalytics | Query by clinic + time |
| `agentId-timestamp-index` | CallAnalytics | Query by agent + time |
| `overallSentiment-timestamp-index` | CallAnalytics | Query by sentiment |
| `callStatus-timestamp-index` | CallAnalytics | Query by status |
| `callCategory-timestamp-index` | CallAnalytics | Query by category |
| `analyticsState-finalizationScheduledAt-index` | CallAnalytics | Finalization jobs |

### SNS Topics

| Topic | Purpose |
|-------|---------|
| `{StackName}-call-alerts` | Real-time call quality alerts |
| `{StackName}-performance-insights` | Agent performance digests |
| `{StackName}-agent-performance-alerts` | Performance tracking failures |
| `{StackName}-ReconciliationAlerts` | Reconciliation issues |

### Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Analytics Finalization | Every 1 minute | Finalize call analytics after buffer window |
| Reconciliation | Daily at 2 AM UTC | Reconcile analytics with agent performance |
| Analytics Reconciliation | Every 1 hour | Fix orphaned analytics records |

### Custom Vocabulary

Medical/dental vocabulary is configured for AWS Transcribe with terms including:
- Dental procedures (gingivectomy, apicoectomy, etc.)
- Dental materials (composite resin, zirconia, etc.)
- Dental conditions (periodontitis, bruxism, etc.)
- Insurance terms (PPO, HMO, COB, etc.)
- Common abbreviations (RCT, SRP, FMX, etc.)

---

## Rate Limits

| Endpoint | Rate Limit |
|----------|------------|
| Call analytics (by ID) | 100/minute |
| Live analytics | 60/minute per call |
| Clinic analytics | 30/minute |
| Agent analytics | 30/minute |
| Summary | 10/minute |
| Rankings | 10/minute |
| Queue calls | 60/minute |
| Dashboard | 30/minute |

---

## Caching

| Endpoint | Cache TTL |
|----------|-----------|
| Completed call analytics | 1 hour |
| Live call analytics | No cache (must revalidate) |
| Rankings | 5 minutes |
| Dashboard | 30 seconds |

Use `If-None-Match` header with ETag for conditional requests.

