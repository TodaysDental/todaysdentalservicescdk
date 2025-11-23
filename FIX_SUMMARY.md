# Post-Call Analytics Fix - Quick Summary

## What Was Fixed

**Problem:** Transcripts are being saved but post-call analytics (sentiment analysis, agent performance updates) are not happening.

**Root Cause:** The EventBridge-triggered Lambda cannot find the recording metadata after transcription completes, causing the analytics pipeline to fail silently.

## Changes Made

### 1. Added Fallback Mechanism ✅
- Primary: Query by `transcriptionJobName` using GSI
- Fallback: Extract callId from job name and query by `callId-index`
- This handles GSI eventual consistency issues

### 2. Enhanced Logging ✅
- Added detailed logs with ✅/❌ indicators
- Logs every step of the process
- Better error messages for debugging

### 3. Save Transcript Early ✅
- Transcript text is now saved before sentiment analysis
- Ensures data is preserved even if analytics fails

## Files Changed

```
✏️ src/services/chime/process-transcription.ts
   - Added fallback mechanism
   - Enhanced logging
   - Added saveTranscriptText() function

✏️ src/services/shared/utils/recording-manager.ts
   - Enhanced logging when saving transcriptionJobName

📄 docs/POST_CALL_ANALYTICS_FIX.md (NEW)
   - Complete troubleshooting guide
   - Testing instructions
   - Verification steps
```

## Deploy Now

```bash
npx cdk deploy --all --require-approval never
```

## Quick Test

1. Make a test call
2. Wait 2-3 minutes for transcription
3. Check CloudWatch logs:
   ```bash
   aws logs tail /aws/lambda/YourStack-TranscriptionComplete --follow
   ```
4. Look for:
   ```
   ✅ Found recording metadata
   ✅ Sentiment analysis complete
   ✅ Agent performance updated
   ```

## If It Still Doesn't Work

Check these in order:

1. **GSI exists?**
   - Go to DynamoDB Console
   - Check RecordingMetadata table
   - Verify `transcriptionJobName-index` GSI exists

2. **transcriptionJobName saved?**
   - Query RecordingMetadata table
   - Check if field is populated after transcription starts

3. **EventBridge rule active?**
   - Go to EventBridge Console
   - Check `TranscriptionCompleteRule` is enabled
   - Verify it has the Lambda function as target

4. **Lambda has permissions?**
   - Check Lambda execution role
   - Verify DynamoDB read/write permissions
   - Verify Comprehend permissions

## Expected Timeline

- **Recording upload:** Immediate
- **Transcription start:** 5-10 seconds
- **Transcription complete:** 1-2 minutes per minute of audio
- **Analytics processing:** 5-10 seconds
- **Total:** ~2-3 minutes for a 1-minute call

## Where to Look

### CloudWatch Log Groups
- `/aws/lambda/YourStack-RecordingProcessor` - Recording processing
- `/aws/lambda/YourStack-TranscriptionComplete` - Post-call analytics

### DynamoDB Tables
- `YourStack-RecordingMetadata` - Transcript and sentiment data
- `YourStack-AgentPerformance` - Agent metrics
- `YourStack-CallQueueV2` - Call records with sentiment

## Success Indicators

After a successful call:

✅ RecordingMetadata has:
   - `transcriptionJobName`
   - `transcriptText`
   - `sentiment`
   - `sentimentScore`

✅ AgentPerformance has:
   - Updated `sentimentScores`
   - Updated `averageSentiment`
   - Call ID in `callIds` list

✅ CallQueue has:
   - `sentiment` field
   - `sentimentScore` field

## Need More Help?

See the complete guide: `docs/POST_CALL_ANALYTICS_FIX.md`

---
**Status:** Ready to deploy ✅

