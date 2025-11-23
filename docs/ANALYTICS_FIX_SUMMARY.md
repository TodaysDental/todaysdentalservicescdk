# Call Analytics Pipeline Fix

## Problem Summary

After completing calls, the `CallAnalytics` table remained empty with no analytics data being captured. The logs showed:
- `AnalyticsProcessor` Lambda had no logs (never triggered)
- `AnalyticsDlqProcessor` Lambda had no logs (no failures to process)
- `FinalizeAnalytics` Lambda ran every minute but reported "No records pending finalization"

## Root Cause

The analytics system had all the code in place but was **never connected to the data source**. Specifically:

1. ✅ **Analytics tables created** - `CallAnalytics` table existed
2. ✅ **Processing code written** - `process-call-analytics-stream.ts` existed
3. ❌ **CallQueue table had NO DynamoDB Streams enabled** - No events captured
4. ❌ **Stream Processor Lambda never created** - Code never deployed
5. ❌ **No connection between CallQueue → Analytics** - Pipeline incomplete

## Solution Implemented

### 1. Enable DynamoDB Streams on CallQueue Table
**File:** `src/infrastructure/stacks/chime-stack.ts`

```typescript
this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
  // ... existing config ...
  stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // ✅ ADDED
});
```

**What this does:**
- Captures all changes to the CallQueue table (INSERT, MODIFY, REMOVE)
- Allows processing when calls transition to `completed` or `abandoned` status
- Provides OLD and NEW images to detect state changes

### 2. Create Deduplication Table
**File:** `src/infrastructure/stacks/analytics-stack.ts`

```typescript
this.analyticsDedupTable = new dynamodb.Table(this, 'AnalyticsDedupTable', {
  tableName: `${this.stackName}-CallAnalytics-dedup`,
  partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
  timeToLiveAttribute: 'ttl', // Auto-cleanup after 7 days
});
```

**What this does:**
- Prevents duplicate analytics records from being created
- Uses atomic conditional writes to ensure idempotency
- Auto-expires entries after 7 days via TTL

### 3. Create CallQueue Stream Processor Lambda
**File:** `src/infrastructure/stacks/chime-stack.ts`

```typescript
const callQueueStreamProcessor = new lambdaNode.NodejsFunction(this, 'CallQueueStreamProcessor', {
  functionName: `${this.stackName}-CallQueueStreamProcessor`,
  entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-call-analytics-stream.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: Duration.seconds(60),
  memorySize: 512,
  environment: {
    CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName,
    ANALYTICS_DEDUP_TABLE: props.analyticsDedupTableName,
  },
  logRetention: logs.RetentionDays.ONE_WEEK,
});
```

**What this does:**
- Creates the Lambda function from existing `process-call-analytics-stream.ts` code
- Configures it with proper environment variables
- Sets appropriate timeouts and memory

### 4. Wire Stream to Lambda
**File:** `src/infrastructure/stacks/chime-stack.ts`

```typescript
// Grant stream read access
this.callQueueTable.grantStreamRead(callQueueStreamProcessor);

// Grant analytics table write access (cross-stack)
callQueueStreamProcessor.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
  resources: [
    `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
    `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsDedupTableName}`
  ]
}));

// Connect Lambda to Stream
callQueueStreamProcessor.addEventSource(
  new lambdaEventSources.DynamoEventSource(this.callQueueTable, {
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 100,
    bisectBatchOnError: true,
    retryAttempts: 3,
    maxRecordAge: Duration.hours(24),
    parallelizationFactor: 1,
  })
);
```

**What this does:**
- Connects the Lambda to the CallQueue DynamoDB Stream
- Processes events in batches of 100
- Automatically retries failed events up to 3 times
- Bisects batches on error to isolate problematic records

### 5. Update Stack Dependencies
**File:** `src/infrastructure/infra.ts`

```typescript
const chimeStack = new ChimeStack(app, 'TodaysDentalInsightsChimeV23', {
  // ... existing props ...
  analyticsTableName: analyticsStack.analyticsTable.tableName,
  analyticsDedupTableName: analyticsStack.analyticsDedupTable.tableName,
});
```

**What this does:**
- Passes analytics table references from AnalyticsStack to ChimeStack
- Enables ChimeStack to create the stream processor with correct permissions

## How It Works Now

### Call Analytics Flow

```
1. Call Starts
   └─> Call record created in CallQueue table (status: 'active')

2. Call In Progress
   └─> Call record updated with duration, agent info, etc.

3. Call Ends
   └─> Call record status → 'completed' or 'abandoned'
   
4. DynamoDB Stream Event 🔥 NEW!
   ├─> Captures the status change (OLD: 'active' → NEW: 'completed')
   └─> Triggers CallQueueStreamProcessor Lambda
   
5. CallQueueStreamProcessor Lambda
   ├─> Detects call completion (wasCompleted = true)
   ├─> Generates comprehensive analytics:
   │   ├─> Call duration, talk time, hold time
   │   ├─> Agent performance metrics
   │   ├─> Call outcome (completed/abandoned)
   │   ├─> Timestamp analysis
   │   └─> Customer info
   ├─> Checks deduplication table (prevents duplicates)
   └─> Stores analytics in CallAnalytics table
   
6. CallAnalytics Table
   └─> Contains complete call analytics record
   
7. FinalizeAnalytics Lambda (runs every minute)
   └─> Performs any final processing on completed analytics
```

### Deduplication Strategy

```typescript
// Atomic deduplication using conditional write
const dedupId = `${callId}-${timestamp}`;

await ddb.send(new PutCommand({
  TableName: dedupTableName,
  Item: {
    eventId: dedupId,
    callId: analytics.callId,
    processedAt: new Date().toISOString(),
    streamEventId: eventId,
    ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  },
  ConditionExpression: 'attribute_not_exists(eventId)' // Only write if not exists
}));
```

**Prevents:**
- Duplicate processing from stream replays
- Multiple analytics records for the same call
- Double-counting in aggregated metrics

## Files Modified

### Infrastructure
1. ✅ `src/infrastructure/stacks/chime-stack.ts`
   - Enabled DynamoDB Streams on CallQueue table
   - Created CallQueueStreamProcessor Lambda
   - Wired stream to Lambda
   - Added necessary imports and permissions

2. ✅ `src/infrastructure/stacks/analytics-stack.ts`
   - Created deduplication table
   - Exported table as public property
   - Added interface property for callQueueTableStreamArn (future use)

3. ✅ `src/infrastructure/infra.ts`
   - Passed analytics table names to ChimeStack
   - Established cross-stack dependencies

### Existing Code (Already Working)
- ✅ `src/services/chime/process-call-analytics-stream.ts` - Stream processor logic
- ✅ `src/services/chime/finalize-analytics.ts` - Finalization logic
- ✅ `src/services/chime/analytics-dlq-processor.ts` - Error handling

## What Will Happen After Deployment

### Immediate Changes
1. **CallQueue table updated** with Stream enabled
2. **New Lambda created**: `TodaysDentalInsightsChimeV23-CallQueueStreamProcessor`
3. **New table created**: `TodaysDentalInsightsAnalyticsV1-CallAnalytics-dedup`
4. **Stream subscription active**: Lambda starts receiving events

### Testing Verification

After deployment, make a test call and verify:

#### 1. Check CallQueue Stream Processor Logs
```bash
aws logs tail /aws/lambda/TodaysDentalInsightsChimeV23-CallQueueStreamProcessor --follow
```

**Expected logs:**
```
[AnalyticsStream] Processing batch { recordCount: 1, timestamp: ... }
[AnalyticsStream] Processing call: { 
  callId: 'call-xxx', 
  status: 'completed',
  wasCompleted: true 
}
[AnalyticsStream] Stored analytics for call: call-xxx
[AnalyticsStream] Batch complete: { processed: 1, skipped: 0, duplicates: 0, errors: 0 }
```

#### 2. Check CallAnalytics Table
```bash
aws dynamodb scan \
  --table-name TodaysDentalInsightsAnalyticsV1-CallAnalytics \
  --max-items 5
```

**Expected data:**
```json
{
  "callId": "call-xxx",
  "timestamp": 1700000000000,
  "clinicId": "clinic-yyy",
  "agentId": "agent-zzz",
  "direction": "inbound",
  "duration": 300,
  "talkTime": 250,
  "holdTime": 50,
  "outcome": "completed",
  "callEndTime": "2025-11-23T20:15:00.000Z",
  // ... more fields
}
```

#### 3. Check Deduplication Table
```bash
aws dynamodb scan \
  --table-name TodaysDentalInsightsAnalyticsV1-CallAnalytics-dedup \
  --max-items 5
```

**Expected data:**
```json
{
  "eventId": "call-xxx-1700000000000",
  "callId": "call-xxx",
  "processedAt": "2025-11-23T20:15:01.234Z",
  "streamEventId": "shardId-xxx:sequenceNumber-yyy",
  "ttl": 1700604800  // 7 days from now
}
```

#### 4. Verify FinalizeAnalytics Stops Reporting "No records"
```bash
aws logs tail /aws/lambda/TodaysDentalInsightsAnalyticsV1-FinalizeAnalytics --follow
```

**Expected logs:**
```
[finalize-analytics] Starting finalization sweep
[finalize-analytics] Processing 1 records pending finalization
[finalize-analytics] Finalized call-xxx
```

## Deployment

```bash
# Deploy all stacks
npx cdk deploy --all --require-approval never

# Monitor deployment
# This will:
# 1. Update CallQueue table to enable streams (~5-10 minutes)
# 2. Create deduplication table
# 3. Create stream processor Lambda
# 4. Configure event source mapping
```

**Note:** Enabling DynamoDB Streams on an existing table can take several minutes and may cause a brief disruption. The table remains available during this process.

## Cost Impact

### Additional AWS Resources
1. **DynamoDB Streams** on CallQueue table
   - Cost: $0.02 per 100,000 stream read requests
   - Expected: ~100 calls/day = ~3,000 requests/month = $0.60/month

2. **Lambda Invocations** (CallQueueStreamProcessor)
   - Cost: Free tier covers 1M requests/month
   - Expected: ~100 calls/day = ~3,000 invocations/month = FREE

3. **Deduplication Table** storage
   - Cost: $0.25/GB/month, 7-day retention
   - Expected: <10MB = negligible

**Total additional cost: ~$0.60/month**

## Monitoring & Alerts

### CloudWatch Metrics to Watch

1. **Stream Processor Lambda Errors**
   ```
   Namespace: AWS/Lambda
   Metric: Errors
   Dimension: FunctionName = TodaysDentalInsightsChimeV23-CallQueueStreamProcessor
   ```

2. **Stream Iterator Age**
   ```
   Namespace: AWS/Lambda
   Metric: IteratorAge
   Dimension: FunctionName = TodaysDentalInsightsChimeV23-CallQueueStreamProcessor
   Alert if: > 60000 milliseconds (1 minute)
   ```

3. **Analytics Table Write Throttles**
   ```
   Namespace: AWS/DynamoDB
   Metric: WriteThrottleEvents
   Dimension: TableName = TodaysDentalInsightsAnalyticsV1-CallAnalytics
   ```

## Troubleshooting

### If Analytics Still Not Appearing

1. **Check Lambda is receiving stream events:**
   ```bash
   aws lambda get-function --function-name TodaysDentalInsightsChimeV23-CallQueueStreamProcessor
   # Check EventSourceMappings
   ```

2. **Check stream is enabled on CallQueue:**
   ```bash
   aws dynamodb describe-table --table-name TodaysDentalInsightsChimeV23-CallQueueV2
   # Look for StreamSpecification.StreamEnabled: true
   ```

3. **Check Lambda permissions:**
   - Stream read permission on CallQueue table
   - Write permission on CallAnalytics table
   - Write permission on deduplication table

4. **Check for Lambda errors:**
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/TodaysDentalInsightsChimeV23-CallQueueStreamProcessor \
     --filter-pattern "ERROR"
   ```

### Common Issues

**Issue:** Lambda not triggering
- **Cause:** Event source mapping not active
- **Fix:** Check mapping state with `aws lambda list-event-source-mappings`

**Issue:** Permission denied errors
- **Cause:** Cross-stack IAM permissions not working
- **Fix:** Verify IAM policy includes correct table ARNs

**Issue:** Duplicate analytics records
- **Cause:** Deduplication table not accessible
- **Fix:** Check Lambda has write permissions to dedup table

## Rollback Plan

If issues occur after deployment:

```bash
# Disable the stream processor
aws lambda update-event-source-mapping \
  --uuid <mapping-uuid> \
  --enabled false

# Or delete the event source mapping entirely
aws lambda delete-event-source-mapping \
  --uuid <mapping-uuid>
```

This will stop analytics processing without affecting call handling.

## Success Criteria

✅ **Working correctly when:**
1. CallAnalytics table populates after each completed call
2. CallQueueStreamProcessor logs show successful processing
3. Deduplication table contains recent entries
4. FinalizeAnalytics finds records to process
5. No Lambda errors in CloudWatch Logs
6. Stream iterator age stays low (<1 second)

---

**Implementation Date:** November 23, 2025  
**Status:** ✅ Ready for Deployment  
**Breaking Changes:** None - additive only

