# Analytics Processing Bug Analysis

## 🐛 Root Cause: Deduplication Race Condition

### The Problem
Abandoned (and completed) calls fail to create analytics records when errors occur during processing, leaving the system in an inconsistent state that prevents future reprocessing.

### Code Location
`src/services/chime/process-call-analytics-stream.ts` - Lines 211-236

### The Bug Flow

```typescript
// Line 214-219: ❌ PROBLEM - Deduplication happens FIRST
const stateDedupResult = await checkAndMarkProcessed(
    ddb,
    DEDUP_TABLE,
    callData.callId,
    `post-call-${stateTransition}` // Creates dedup record
);

if (stateDedupResult.isDuplicate) {
    return 'DUPLICATE'; // Early return if already processed
}

// Line 230: Generate analytics (CAN FAIL)
const analytics = await generateCallAnalytics(callData, record);

// Line 233: Enrich with patient data (CAN FAIL)
await enrichWithPatientData(analytics, callData);

// Line 236: Store analytics with ANOTHER dedup check (CAN FAIL)
const stored = await storeAnalyticsWithDedup(analytics, record.eventID!);
```

### What Goes Wrong

**Scenario 1: Normal Flow (Works)**
1. ✅ Create dedup record for `post-call-abandoned`
2. ✅ Generate analytics
3. ✅ Enrich with patient data
4. ✅ Store analytics (creates second dedup record for `post-call`)
5. ✅ Result: Analytics stored

**Scenario 2: Failure After Dedup (BUG)**
1. ✅ Create dedup record for `post-call-abandoned`
2. ❌ Error in `generateCallAnalytics()` (e.g., missing field, validation error)
3. ❌ OR error in `enrichWithPatientData()` (e.g., OpenDental timeout)
4. ❌ OR error in `storeAnalyticsWithDedup()` (e.g., DynamoDB throttling)
5. ❌ Result: **Dedup record exists, BUT analytics NOT stored**
6. 🔁 Next attempt: Hits dedup check → Returns 'DUPLICATE' → **Never retries**

### Evidence from Logs

```
2025-11-25T23:26:42 INFO [Deduplication] Duplicate event detected: {
  dedupKey: 'abd8285c-fccd-4a31-8e84-39535739de06#post-call-abandoned',
  callId: 'abd8285c-fccd-4a31-8e84-39535739de06',
  stage: 'post-call-abandoned'
}
2025-11-25T23:26:42 INFO [AnalyticsStream] Duplicate state transition detected, skipping
2025-11-25T23:26:42 INFO [AnalyticsStream] Batch complete: { processed: 0, skipped: 0, duplicates: 1, errors: 0 }
```

The call is marked as duplicate but NO analytics record exists in the table.

### Why This Is Critical

1. **Data Loss**: Calls can disappear from analytics without any error being logged
2. **Silent Failure**: The system reports "duplicates: 1" as if everything is fine
3. **No Recovery**: Manual intervention required to clear dedup records and reprocess
4. **Affects All Call Types**: Impacts both abandoned and completed calls

### Impact Assessment

- **Severity**: HIGH - Data loss without error visibility
- **Frequency**: Occurs whenever ANY error happens during analytics generation
- **Scope**: All calls (inbound, outbound, completed, abandoned)
- **Detection**: Difficult - appears as successful processing in logs

## 🔧 Recommended Fixes

### Fix 1: Move Deduplication After Storage (Best)

```typescript
async function processStreamRecord(record: DynamoDBRecord): Promise<'PROCESSED' | 'SKIPPED' | 'DUPLICATE'> {
    // ... validation ...
    
    // ❌ REMOVE: Don't check dedup here
    // const stateDedupResult = await checkAndMarkProcessed(...)
    
    // Generate analytics
    const analytics = await generateCallAnalytics(callData, record);
    
    // Enrich with patient data
    await enrichWithPatientData(analytics, callData);
    
    // Store analytics (has its own dedup check)
    const stored = await storeAnalyticsWithDedup(analytics, record.eventID!);
    
    if (!stored) {
        return 'DUPLICATE';
    }
    
    // ✅ ADD: Mark state transition as processed AFTER successful storage
    await checkAndMarkProcessed(
        ddb,
        DEDUP_TABLE,
        callData.callId,
        `post-call-${stateTransition}`
    );
    
    return 'PROCESSED';
}
```

### Fix 2: Add Cleanup on Failure

```typescript
async function processStreamRecord(record: DynamoDBRecord): Promise<'PROCESSED' | 'SKIPPED' | 'DUPLICATE'> {
    const stateTransition = wasCompleted ? 'completed' : wasAbandoned ? 'abandoned' : 'removed';
    const dedupKey = `${callData.callId}#post-call-${stateTransition}`;
    
    // Check for duplicates
    const stateDedupResult = await checkAndMarkProcessed(ddb, DEDUP_TABLE, callData.callId, `post-call-${stateTransition}`);
    
    if (stateDedupResult.isDuplicate) {
        return 'DUPLICATE';
    }
    
    try {
        // Generate and store analytics
        const analytics = await generateCallAnalytics(callData, record);
        await enrichWithPatientData(analytics, callData);
        const stored = await storeAnalyticsWithDedup(analytics, record.eventID!);
        
        if (!stored) {
            // ✅ ADD: Clean up dedup record if storage failed
            await cleanupDedupRecord(dedupKey);
            return 'DUPLICATE';
        }
        
        return 'PROCESSED';
    } catch (error) {
        // ✅ ADD: Clean up dedup record on error
        console.error('[AnalyticsStream] Error processing call, cleaning up dedup record:', error);
        await cleanupDedupRecord(dedupKey);
        throw error; // Re-throw to trigger retry
    }
}
```

### Fix 3: Add Reconciliation Job

Create a scheduled Lambda that:
1. Scans CallQueue for calls with `status = 'completed'` or `'abandoned'`
2. Checks if analytics record exists
3. If not, deletes dedup records and triggers reprocessing
4. Runs hourly or daily to catch missed calls

## 📊 Monitoring Improvements

### Add CloudWatch Metrics

```typescript
// In processStreamRecord
const metrics = {
    'AnalyticsCreated': stored ? 1 : 0,
    'AnalyticsSkipped': !stored ? 1 : 0,
    'DedupRecordOrphaned': !stored && dedupExists ? 1 : 0
};

await publishMetrics('CallAnalytics', metrics);
```

### Add Alarms

1. **Orphaned Dedup Records**: Alert when `DedupRecordOrphaned` > 5 in 5 minutes
2. **Low Analytics Rate**: Alert when `AnalyticsCreated` / `CallsCompleted` < 0.95
3. **High Skip Rate**: Alert when `AnalyticsSkipped` / `TotalCalls` > 0.1

## 🧪 Testing

### Test Cases Needed

1. **Success Path**: Call completes → Analytics created
2. **Generation Failure**: Error in `generateCallAnalytics` → Dedup cleaned up
3. **Enrichment Failure**: Error in `enrichWithPatientData` → Dedup cleaned up
4. **Storage Failure**: Error in `storeAnalyticsWithDedup` → Dedup cleaned up
5. **Network Failure**: Timeout during DynamoDB write → Dedup cleaned up
6. **Duplicate Event**: Same call processed twice → Only one analytics record

## 📝 Immediate Actions

1. ✅ **Document the issue** (this file)
2. 🔄 **Implement Fix 1** (move deduplication after storage)
3. 🔍 **Add error logging** for analytics generation failures
4. 📊 **Add CloudWatch metrics** for orphaned dedup records
5. 🚨 **Create alarms** for data loss detection
6. 🧹 **Build reconciliation job** to fix existing orphaned calls
7. 🧪 **Add integration tests** for failure scenarios

## 🎯 Success Criteria

- ✅ Zero orphaned dedup records in 7 days
- ✅ 99%+ analytics creation rate for completed/abandoned calls
- ✅ All errors logged with proper context
- ✅ Automatic recovery from transient failures
- ✅ No manual intervention required for stuck calls


