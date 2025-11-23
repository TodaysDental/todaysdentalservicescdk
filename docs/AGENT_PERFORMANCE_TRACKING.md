# Agent Performance Tracking System

## Overview

This document describes the comprehensive agent performance tracking system that monitors agent activities, call metrics, and sentiment analysis to provide detailed performance ratings.

## Features

### 1. **Call Tracking**
Every call is tracked with the following information:
- **Agent Assignment**: Which agent handled the call
- **Call Direction**: Inbound or outbound call
- **Call Duration**: Total time, talk time, hold time
- **Call Outcome**: Completed, rejected, missed, transferred
- **Timestamp**: When the call started and ended

### 2. **Sentiment Analysis**
After each call:
- Call recordings are automatically transcribed using AWS Transcribe
- Transcripts are analyzed using AWS Comprehend for sentiment
- Sentiment scores (Positive, Neutral, Negative, Mixed) are calculated
- Results are stored and contribute to agent performance ratings

### 3. **Performance Metrics**

Each agent has daily performance records tracking:

#### Call Volume
- Total calls handled
- Inbound vs outbound calls
- Missed calls
- Rejected calls

#### Duration Metrics
- Total talk time
- Total handle time (includes hold time)
- Total hold time
- Average handle time per call
- Average talk time per call

#### Quality Metrics
- Sentiment score breakdown (positive, neutral, negative, mixed)
- Average sentiment score (0-100, where 100 is most positive)
- Calls transferred
- Calls completed
- First call resolution rate

#### Performance Score (0-100)
Calculated using weighted factors:
- **Completion Rate (40%)**: Percentage of calls successfully completed
- **Sentiment Score (40%)**: Average sentiment from transcriptions
- **Rejection Rate (20%)**: Inverse of rejection rate (lower rejections = higher score)

### Performance Ratings
- **90-100**: Excellent
- **75-89**: Good
- **60-74**: Average
- **40-59**: Below Average
- **0-39**: Needs Improvement

## Architecture

### DynamoDB Tables

#### 1. AgentPerformance Table
```
Partition Key: agentId (String)
Sort Key: periodDate (String) - Format: YYYY-MM-DD

Attributes:
- clinicId
- totalCalls
- inboundCalls
- outboundCalls
- missedCalls
- rejectedCalls
- totalTalkTime
- totalHandleTime
- totalHoldTime
- averageHandleTime
- averageTalkTime
- sentimentScores: {positive, neutral, negative, mixed}
- averageSentiment
- performanceScore
- callsTransferred
- callsCompleted
- firstCallResolutionRate
- lastUpdated
- callIds (List of call IDs for this period)

GSIs:
- clinicId-periodDate-index: Query all agents for a clinic by date
- clinicId-performanceScore-index: Rank agents by performance
```

#### 2. CallQueue Table (Enhanced)
Existing table now includes:
- `assignedAgentId`: Which agent handled the call
- `direction`: 'inbound' or 'outbound'
- `sentiment`: Overall sentiment from analysis
- `sentimentScore`: Numeric score (0-100)
- `sentimentScores`: Detailed breakdown

#### 3. RecordingMetadata Table (Enhanced)
Existing table now includes:
- `agentId`: Agent who handled the call
- `sentiment`: Call sentiment
- `sentimentScore`: Numeric sentiment score
- `sentimentAnalyzedAt`: When sentiment was analyzed

New GSI:
- `transcriptionJobName-index`: For finding recordings by transcription job

### Lambda Functions

#### 1. `RecordingProcessor`
**Trigger**: S3 event when new recording is uploaded

**Actions**:
- Process recording metadata
- Start transcription job
- Track agent performance metrics (initial)
- Update call records

**Environment Variables**:
- `RECORDING_METADATA_TABLE_NAME`
- `CALL_QUEUE_TABLE_NAME`
- `AGENT_PERFORMANCE_TABLE_NAME`
- `RECORDINGS_BUCKET_NAME`
- `AUTO_TRANSCRIBE_RECORDINGS`
- `ENABLE_SENTIMENT_ANALYSIS`

#### 2. `TranscriptionComplete`
**Trigger**: EventBridge event when transcription completes

**Actions**:
- Download transcription from S3
- Analyze sentiment using AWS Comprehend
- Update recording metadata with sentiment
- Update call record with sentiment
- Update agent performance with sentiment data

**Permissions**:
- Read from S3 (recordings and transcriptions)
- Comprehend DetectSentiment API
- DynamoDB read/write access

#### 3. `GetAgentPerformance`
**Trigger**: API Gateway GET /chime/agent-performance

**Query Parameters**:
- `agentId`: Get performance for specific agent
- `clinicId`: Get performance for all agents in clinic
- `startDate`: Filter by start date (YYYY-MM-DD)
- `endDate`: Filter by end date (YYYY-MM-DD)
- `includeCallDetails`: Include detailed call list (boolean)

**Response**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "period": {
        "from": "2025-01-01",
        "to": "2025-01-31",
        "days": 31
      },
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
    "dailyBreakdown": [
      {
        "agentId": "agent-123",
        "periodDate": "2025-01-15",
        "totalCalls": 12,
        "performanceScore": 87,
        ...
      }
    ],
    "callDetails": [...]
  }
}
```

## Usage Examples

### 1. Get Agent Performance Report

```bash
# Get last 30 days performance for an agent
curl -X GET "https://api.example.com/chime/agent-performance?agentId=agent-123&startDate=2025-01-01&endDate=2025-01-31" \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Get Clinic-Wide Performance

```bash
# Get all agents performance for a clinic
curl -X GET "https://api.example.com/chime/agent-performance?clinicId=clinic-abc&startDate=2025-01-01" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Get Today's Performance

```bash
# Get agent's performance for today (no date parameters)
curl -X GET "https://api.example.com/chime/agent-performance?agentId=agent-123" \
  -H "Authorization: Bearer $TOKEN"
```

## Data Flow

### 1. Call Lifecycle

```
1. Call Initiated (Inbound/Outbound)
   └─> Create record in CallQueue table with assignedAgentId

2. Call in Progress
   └─> Track hold time, talk time

3. Call Ends
   └─> Update CallQueue with final metrics
   └─> Recording uploaded to S3

4. Recording Processing
   └─> RecordingProcessor Lambda triggered
   └─> Update AgentPerformance table with call metrics
   └─> Start transcription job

5. Transcription Complete
   └─> TranscriptionComplete Lambda triggered
   └─> Analyze sentiment using Comprehend
   └─> Update AgentPerformance with sentiment data
   └─> Final performance score calculated
```

### 2. Performance Score Calculation

```javascript
performanceScore = 
  (completionRate * 0.4) +      // 40% weight
  (averageSentiment * 0.4) +    // 40% weight
  ((100 - rejectionRate) * 0.2) // 20% weight
```

## Integration Points

### In Existing Call Handlers

To track performance in your call handling code:

```typescript
import { trackCallCompletion } from '../shared/utils/agent-performance-tracker';

// When call completes
await trackCallCompletion(ddb, AGENT_PERFORMANCE_TABLE_NAME, {
  callId: 'call-123',
  agentId: 'agent-456',
  clinicId: 'clinic-789',
  direction: 'inbound',
  totalDuration: 300,  // seconds
  talkTime: 250,
  holdTime: 50,
  wasCompleted: true,
  wasTransferred: false,
  wasRejected: false,
  wasMissed: false,
  startTime: '2025-01-15T10:00:00Z',
  endTime: '2025-01-15T10:05:00Z',
});
```

## Monitoring and Alerts

### CloudWatch Metrics

The system automatically tracks:
- Lambda execution errors
- Transcription job failures
- Sentiment analysis failures
- DynamoDB throttling

### Performance Thresholds

Consider setting alerts for:
- Agent performance score < 60 (needs attention)
- Average sentiment < 40 (customer dissatisfaction)
- Rejection rate > 20% (agent availability issues)
- Average handle time > threshold (efficiency concerns)

## Data Retention

- **Agent Performance Records**: Retained permanently (RETAIN policy)
- **Call Records**: 90 days TTL (configurable)
- **Recordings**: 7 years (2555 days) for compliance
- **Transcriptions**: Same as recordings

## Privacy and Compliance

- All recordings are encrypted at rest (KMS)
- Access controlled via IAM and Cognito
- HIPAA compliant architecture
- Audit trail in CloudWatch Logs
- Sentiment analysis does not store PII from transcripts

## Future Enhancements

- [ ] Real-time performance dashboards
- [ ] Automatic coaching recommendations
- [ ] Peer comparison analytics
- [ ] Predictive performance modeling
- [ ] Integration with HR systems
- [ ] Gamification features (leaderboards, achievements)
- [ ] Multi-language sentiment analysis
- [ ] Call topic extraction and categorization
- [ ] Customer satisfaction correlation

## Troubleshooting

### Issue: Performance not updating

**Check**:
1. Agent ID is correctly assigned to calls
2. Recordings are being uploaded to S3
3. Transcription jobs are completing successfully
4. EventBridge rule is active
5. Lambda has correct DynamoDB permissions

### Issue: Missing sentiment scores

**Check**:
1. Transcription completed successfully
2. Transcription file accessible in S3
3. Comprehend API permissions granted
4. TranscriptionComplete Lambda logs for errors

### Issue: Incorrect performance scores

**Verify**:
1. Call duration calculations are accurate
2. Call completion status is correctly set
3. Sentiment scores are in expected range (0-100)
4. Performance calculation logic matches requirements

## Support

For issues or questions:
- Check CloudWatch Logs for Lambda function errors
- Review DynamoDB items for data consistency
- Verify IAM permissions for all services
- Contact development team for custom modifications

