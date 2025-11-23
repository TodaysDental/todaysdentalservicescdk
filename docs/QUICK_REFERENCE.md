# Agent Performance Tracking - Quick Reference

## Quick Integration Guide

### 1. Track Call Completion

```typescript
import { trackCallCompletion } from '../shared/utils/agent-performance-tracker';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';

const ddb = getDynamoDBClient();
const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME!;

// When a call ends
await trackCallCompletion(ddb, AGENT_PERFORMANCE_TABLE, {
  callId: callRecord.callId,
  agentId: callRecord.assignedAgentId,
  clinicId: callRecord.clinicId,
  direction: callRecord.direction, // 'inbound' or 'outbound'
  totalDuration: 300,  // seconds
  talkTime: 250,
  holdTime: 50,
  wasCompleted: true,
  wasTransferred: false,
  wasRejected: false,
  wasMissed: false,
  startTime: callRecord.queueEntryTimeIso,
  endTime: new Date().toISOString(),
});
```

### 2. Track Call Rejection

```typescript
import { trackCallRejection } from '../shared/utils/agent-performance-tracker';

// When agent rejects a call
await trackCallRejection(
  ddb,
  AGENT_PERFORMANCE_TABLE,
  agentId,
  clinicId,
  callId
);
```

### 3. Track Missed Call

```typescript
import { trackCallMissed } from '../shared/utils/agent-performance-tracker';

// When no agent available
await trackCallMissed(
  ddb,
  AGENT_PERFORMANCE_TABLE,
  agentId,
  clinicId,
  callId
);
```

### 4. Extract Metrics from Call Record

```typescript
import { extractCallMetrics } from '../shared/utils/agent-performance-tracker';

const callRecord = /* fetch from DynamoDB */;
const metrics = extractCallMetrics(callRecord);

if (metrics) {
  await trackCallCompletion(ddb, AGENT_PERFORMANCE_TABLE, metrics);
}
```

## API Queries

### Get Agent Performance

```bash
# Single agent, last 30 days
GET /chime/agent-performance?agentId=agent-123&startDate=2025-01-01&endDate=2025-01-31

# All agents in clinic
GET /chime/agent-performance?clinicId=clinic-abc

# With call details
GET /chime/agent-performance?agentId=agent-123&includeCallDetails=true

# Today's performance
GET /chime/agent-performance?agentId=agent-123
```

### Response Format

```json
{
  "success": true,
  "data": {
    "summary": {
      "period": { "from": "2025-01-01", "to": "2025-01-31", "days": 31 },
      "totalCalls": 145,
      "inboundCalls": 120,
      "outboundCalls": 25,
      "missedCalls": 5,
      "rejectedCalls": 3,
      "callsTransferred": 8,
      "callsCompleted": 137,
      "completionRate": "94.48",
      "averageHandleTime": 245,
      "averageTalkTime": 210,
      "averageHoldTime": 35,
      "sentimentBreakdown": {
        "positive": 98,
        "neutral": 35,
        "negative": 10,
        "mixed": 2
      },
      "averageSentiment": "78.50",
      "performanceScore": "86.25",
      "rating": "Good"
    },
    "dailyBreakdown": [...],
    "callDetails": [...]
  }
}
```

## Database Schema

### AgentPerformance Table

```typescript
interface AgentPerformanceRecord {
  // Keys
  agentId: string;           // Partition key
  periodDate: string;        // Sort key (YYYY-MM-DD)
  
  // Call volume
  clinicId: string;
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  missedCalls: number;
  rejectedCalls: number;
  
  // Duration (seconds)
  totalTalkTime: number;
  totalHandleTime: number;
  totalHoldTime: number;
  averageHandleTime: number;
  averageTalkTime: number;
  
  // Quality
  sentimentScores: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  averageSentiment: number;    // 0-100
  
  // Performance
  performanceScore: number;     // 0-100
  callsTransferred: number;
  callsCompleted: number;
  firstCallResolutionRate: number;
  
  // Metadata
  lastUpdated: string;
  callIds: string[];
}
```

### Indexes

1. **Primary Key**: `agentId` + `periodDate`
   - Query: Agent's performance over time

2. **GSI**: `clinicId-periodDate-index`
   - Query: All agents in clinic for specific date

3. **GSI**: `clinicId-performanceScore-index`
   - Query: Agent rankings/leaderboard

## Performance Score Formula

```javascript
performanceScore = 
  (completionRate * 0.4) +           // 40% weight
  (averageSentiment * 0.4) +         // 40% weight  
  ((100 - rejectionRate) * 0.2);     // 20% weight
```

## Rating Scale

| Score | Rating | Description |
|-------|--------|-------------|
| 90-100 | Excellent | Outstanding performance |
| 75-89 | Good | Above expectations |
| 60-74 | Average | Meeting expectations |
| 40-59 | Below Average | Needs improvement |
| 0-39 | Needs Improvement | Requires immediate attention |

## Common Patterns

### 1. Update Performance After Call Ends

```typescript
// In call-hungup.ts, call-rejected.ts, etc.
const callRecord = await getCallRecord(callId);

if (callRecord && callRecord.assignedAgentId) {
  const metrics = extractCallMetrics(callRecord);
  
  if (metrics) {
    await trackCallCompletion(
      ddb,
      process.env.AGENT_PERFORMANCE_TABLE_NAME!,
      metrics
    );
  }
}
```

### 2. Get Real-time Performance

```typescript
import { getAgentDailyPerformance } from '../shared/utils/agent-performance-tracker';

const performance = await getAgentDailyPerformance(
  ddb,
  AGENT_PERFORMANCE_TABLE,
  agentId,
  '2025-01-15' // Optional, defaults to today
);

console.log(`Agent ${agentId} performance score: ${performance?.performanceScore}`);
```

### 3. Handle Outbound Calls

```typescript
// In outbound-call.ts
const callRecord = {
  callId,
  assignedAgentId: agentId,
  clinicId: body.fromClinicId,
  direction: 'outbound',
  queueEntryTime: nowTs,
  queueEntryTimeIso: now.toISOString(),
  // ... other fields
};

// Store in CallQueue table
await ddb.send(new PutCommand({
  TableName: CALL_QUEUE_TABLE_NAME,
  Item: callRecord
}));

// Performance will be tracked automatically when recording is processed
```

## Environment Variables

Make sure these are set in your Lambda functions:

```bash
AGENT_PERFORMANCE_TABLE_NAME=YourStack-AgentPerformance
CALL_QUEUE_TABLE_NAME=YourStack-CallQueueV2
RECORDING_METADATA_TABLE_NAME=YourStack-RecordingMetadata
RECORDINGS_BUCKET_NAME=yourstack-recordings-...
```

## Troubleshooting

### Performance not updating?

1. **Check agent assignment:**
   ```typescript
   console.log('Assigned agent:', callRecord.assignedAgentId);
   ```

2. **Verify table name:**
   ```typescript
   console.log('Table:', process.env.AGENT_PERFORMANCE_TABLE_NAME);
   ```

3. **Check CloudWatch logs:**
   - Look for `[AgentPerformanceTracker]` log lines
   - Check for DynamoDB errors

### Sentiment not appearing?

1. **Verify transcription:**
   - Check S3 for transcription output
   - Check EventBridge rule is enabled

2. **Check Comprehend permissions:**
   - Lambda needs `comprehend:DetectSentiment`

3. **Review logs:**
   - `/aws/lambda/YourStack-TranscriptionComplete`

## Best Practices

1. ✅ Always check if `assignedAgentId` exists before tracking
2. ✅ Use try-catch blocks - performance tracking shouldn't break call flow
3. ✅ Log performance updates for debugging
4. ✅ Track both successful and failed calls
5. ✅ Include call direction (inbound/outbound)
6. ✅ Set realistic thresholds for alerts

## Example: Complete Integration in Call Handler

```typescript
export const handler = async (event: any): Promise<any> => {
  const ddb = getDynamoDBClient();
  const callId = event.callId;
  
  try {
    // ... handle call logic ...
    
    // Get call record
    const callRecord = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId }
    }));
    
    const call = callRecord.Items?.[0];
    
    if (call && call.assignedAgentId) {
      // Extract metrics
      const metrics = extractCallMetrics(call);
      
      if (metrics) {
        // Track performance (non-blocking)
        trackCallCompletion(
          ddb,
          process.env.AGENT_PERFORMANCE_TABLE_NAME!,
          metrics
        ).catch(err => {
          console.error('Failed to track performance:', err);
          // Don't fail the call if performance tracking fails
        });
      }
    }
    
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
```

## Testing

```bash
# 1. Make a test call
curl -X POST https://your-api.com/chime/outbound-call \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fromClinicId":"clinic-abc","toPhoneNumber":"+15551234567"}'

# 2. Wait for call to complete and recording to process (~5-10 min)

# 3. Check performance
curl -X GET "https://your-api.com/chime/agent-performance?agentId=agent-123" \
  -H "Authorization: Bearer $TOKEN"

# 4. Verify response includes updated metrics
```

## Resources

- **Full Documentation**: `docs/AGENT_PERFORMANCE_TRACKING.md`
- **Implementation Summary**: `docs/IMPLEMENTATION_SUMMARY.md`
- **Source Code**: `src/services/shared/utils/agent-performance-tracker.ts`

