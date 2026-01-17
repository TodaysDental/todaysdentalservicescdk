# Meeting Transcription Implementation - Complete Guide

## Overview

This implementation enables **real-time voice transcription** and **natural language AI conversation** for Chime SDK Meetings used with **SipMediaApplicationDialIn** phone numbers.

## Key Components

### 1. StartMeetingTranscription API

The solution uses Chime SDK's native `StartMeetingTranscription` API, which:
- Works directly with Chime SDK Meetings
- Supports PSTN calls that join via `JoinChimeMeeting`
- Uses Amazon Transcribe for real-time speech-to-text
- Delivers transcription events via EventBridge

### 2. Architecture Flow

```
┌──────────────┐     ┌─────┐     ┌──────────────────┐     ┌─────────────┐
│ PSTN Caller  │────→│ SMA │────→│ JoinChimeMeeting │────→│ Chime Meeting│
└──────────────┘     └─────┘     └──────────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │ StartMeetingTranscription │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │   Amazon Transcribe   │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │     EventBridge       │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │ Transcription Handler │
                                                    │       (Lambda)        │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │    Bedrock Agent      │
                                                    │    (AI Response)      │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │    Amazon Polly       │
                                                    │    (Text-to-Speech)   │
                                                    └───────────────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────┐
                                                    │ UpdateSipMediaApplicationCall │
                                                    │    (Play Audio)       │
                                                    └───────────────────────┘
```

## Files Modified/Created

### Core Implementation

1. **`src/services/chime/meeting-manager.ts`**
   - Added `StartMeetingTranscriptionCommand` and `StopMeetingTranscriptionCommand` imports
   - Implemented `startMeetingTranscription()` function
   - Updated `createMeetingForCall()` to automatically start transcription
   - Added `stopMeetingTranscription()` for cleanup
   - Added Lambda handler operations for manual transcription control

2. **`src/services/chime/meeting-transcription-handler.ts`** (NEW)
   - EventBridge event handler for transcription events
   - Processes transcript text from Amazon Transcribe
   - Invokes Bedrock Agent for AI responses
   - Converts AI responses to speech via Amazon Polly
   - Plays audio back to meeting via `UpdateSipMediaApplicationCall`

3. **`src/services/chime/inbound-router.ts`**
   - Added `startMeetingTranscription()` and `stopMeetingTranscriptionForMeeting()` functions
   - Updated `ACTION_SUCCESSFUL` handler for `JoinChimeMeeting` to:
     - First try `StartMeetingTranscription` (primary approach)
     - Fall back to Media Insights Pipeline if transcription fails
     - Update call record with transcription status

### CDK Infrastructure

4. **`src/infrastructure/stacks/ai-agents-stack.ts`**
   - Added EventBridge imports (`events`, `targets`)
   - Added `AiAgentsStackProps` properties:
     - `medicalVocabularyName`
     - `bedrockAgentId`
     - `bedrockAgentAliasId`
     - `aiTranscriptStreamName`
     - `aiTranscriptStreamArn`
   - Updated `meetingManagerFn` with transcription permissions
   - Created `transcriptionHandlerFn` Lambda
   - Created EventBridge rule for Chime meeting events
   - Added environment variables for transcription configuration

## Environment Variables

### Meeting Manager Lambda

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_MEETING_TRANSCRIPTION` | Enable/disable transcription | `true` |
| `TRANSCRIPTION_LANGUAGE` | Transcribe language code | `en-US` |
| `MEDICAL_VOCABULARY_NAME` | Custom vocabulary for dental terms | (none) |

### Transcription Handler Lambda

| Variable | Description |
|----------|-------------|
| `ACTIVE_MEETINGS_TABLE` | DynamoDB table for meeting state |
| `CONVERSATIONS_TABLE` | DynamoDB table for conversation history |
| `VOICE_SESSIONS_TABLE` | DynamoDB table for voice sessions |
| `BEDROCK_AGENT_ID` | Bedrock Agent ID for AI |
| `BEDROCK_AGENT_ALIAS_ID` | Bedrock Agent Alias ID |
| `TTS_BUCKET` | S3 bucket for Polly audio files |
| `POLLY_VOICE_ID` | Polly voice (default: Joanna) |

### Inbound Router Lambda

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_MEETING_TRANSCRIPTION` | Enable transcription after JoinChimeMeeting | `true` |
| `TRANSCRIPTION_LANGUAGE` | Transcribe language code | `en-US` |
| `MEDICAL_VOCABULARY_NAME` | Custom vocabulary | (none) |

## IAM Permissions Required

### Meeting Manager / Inbound Router

```json
{
  "Effect": "Allow",
  "Action": [
    "chime:StartMeetingTranscription",
    "chime:StopMeetingTranscription",
    "transcribe:StartStreamTranscription",
    "transcribe:StartStreamTranscriptionWebSocket"
  ],
  "Resource": "*"
}
```

### Transcription Handler

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeAgent",
    "polly:SynthesizeSpeech",
    "s3:PutObject",
    "s3:GetObject",
    "chime:UpdateSipMediaApplicationCall",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem"
  ],
  "Resource": "*"
}
```

## EventBridge Configuration

### Event Pattern

```json
{
  "source": ["aws.chime"],
  "detail-type": [
    "Chime Meeting State Change",
    "Chime Meeting Transcription"
  ]
}
```

### Target

Lambda function: `{StackName}-TranscriptionHandlerFn`

## Transcription Event Types

| Event Type | Description |
|------------|-------------|
| `TranscriptionStarted` | Transcription has begun for the meeting |
| `TranscriptionStopped` | Transcription has ended |
| `TranscriptionFailed` | Transcription failed to start |
| `Transcript` | Actual transcribed text from a participant |

## How It Works

### Inbound Call Flow

1. **Call Arrives**: PSTN call received on SipMediaApplicationDialIn number
2. **Clinic Check**: Inbound router checks business hours via ClinicHours table
3. **After-Hours**: If clinic is closed, route to AI via Chime meeting
4. **Create Meeting**: `createAiMeetingWithPipeline()` creates Chime SDK Meeting
5. **Join Meeting**: SMA executes `JoinChimeMeeting` action
6. **Start Transcription**: On `ACTION_SUCCESSFUL`, call `StartMeetingTranscription`
7. **Caller Speaks**: Audio goes through Chime Meeting to Amazon Transcribe
8. **Transcript Event**: EventBridge delivers transcript to handler Lambda
9. **AI Processing**: Handler invokes Bedrock Agent with transcript text
10. **TTS Response**: AI response converted to speech via Polly
11. **Play Audio**: Audio played to caller via `UpdateSipMediaApplicationCall`

### Fallback Behavior

If `StartMeetingTranscription` fails:
1. Try Media Insights Pipeline (may not work for SipMediaApplicationDialIn)
2. If both fail, system uses DTMF fallback mode

## Testing

### Manual Test Steps

1. Call the clinic phone number after hours
2. Verify meeting is created (check CloudWatch logs)
3. Verify transcription starts (check for `[Transcription] Successfully started` log)
4. Speak to the AI
5. Verify transcript appears in logs (`[TRANSCRIPT]` entries)
6. Verify AI responds (Polly audio plays back)

### CloudWatch Log Queries

**Check Transcription Status:**
```sql
fields @timestamp, @message
| filter @message like /\[Transcription\]/
| sort @timestamp desc
| limit 50
```

**Check Transcript Events:**
```sql
fields @timestamp, @message
| filter @message like /\[TRANSCRIPT\]/
| sort @timestamp desc
| limit 100
```

**Check AI Responses:**
```sql
fields @timestamp, @message
| filter @message like /Bedrock response/
| sort @timestamp desc
| limit 50
```

## Known Limitations

1. **Latency**: There's inherent latency in the transcription → AI → TTS pipeline
2. **Partial Results**: We skip partial transcript results to avoid processing incomplete sentences
3. **Single Speaker**: Current implementation optimizes for patient-AI conversation (2 participants)
4. **Region**: Chime SDK Meetings and Transcribe must be in same region

## Troubleshooting

### Transcription Not Starting

Check:
- `ENABLE_MEETING_TRANSCRIPTION` environment variable is `true`
- Meeting was created successfully before calling `StartMeetingTranscription`
- IAM permissions include `chime:StartMeetingTranscription`

### No AI Response

Check:
- Bedrock Agent ID and Alias ID are configured
- Transcription events are being received (check EventBridge)
- Polly has permissions to synthesize speech
- TTS bucket is accessible

### Audio Not Playing

Check:
- S3 bucket has proper permissions
- `UpdateSipMediaApplicationCall` has proper permissions
- Audio file format is correct (8kHz PCM WAV)

## Deployment

```bash
cd D:\TodaysDental\todaysdentalinsightscdk
npm run build
npm run deploy
```

## Cost Considerations

| Service | Cost Factor |
|---------|-------------|
| Amazon Transcribe | Per-second of audio processed |
| Amazon Polly | Per-character synthesized |
| Amazon Bedrock | Per-token processed |
| EventBridge | Per-million events |
| Lambda | Per-invocation + duration |
| S3 | Storage + requests |

Estimated cost per AI call: $0.01-$0.05 depending on call duration and AI complexity.

## Future Enhancements

1. **Vocabulary Optimization**: Create custom Transcribe vocabulary for dental terms
2. **Speaker Diarization**: Identify different speakers in multi-party calls
3. **Sentiment Analysis**: Add real-time sentiment monitoring
4. **Call Recording**: Store transcripts with call recordings
5. **Analytics Dashboard**: Real-time metrics for AI call performance
