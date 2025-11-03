# Outbound Call Fix - Testing Checklist

## Prerequisites
- [ ] CDK deployment completed successfully
- [ ] Agent has valid credentials and is logged in
- [ ] Clinic has a valid phone number configured
- [ ] Test phone number available for outbound calls

## Test Scenarios

### 1. Basic Outbound Call (Happy Path)
- [ ] Agent initiates outbound call from UI
- [ ] Customer's phone rings
- [ ] Customer answers call
- [ ] **CRITICAL**: Both agent and customer can hear each other
- [ ] Agent can end call successfully
- [ ] Agent status returns to "Online" after call ends

**Expected Database States:**
- Initial: Agent status = "Online"
- After API call: Agent status = "Online" (still), call record created
- After NEW_OUTBOUND_CALL: Agent status = "dialing"
- After CALL_ANSWERED: Agent status = "OnCall", callStatus = "connected"
- After HANGUP: Agent status = "Online", call record status = "completed"

### 2. Customer Doesn't Answer
- [ ] Agent initiates outbound call
- [ ] Customer's phone rings but no answer
- [ ] Call times out after ~30 seconds
- [ ] Agent returns to "Online" status
- [ ] Call record status = "abandoned"

### 3. Customer Rejects Call
- [ ] Agent initiates outbound call
- [ ] Customer explicitly rejects/declines call
- [ ] Agent receives notification of rejection
- [ ] Agent returns to "Online" status
- [ ] Call record status = "abandoned"

### 4. Audio Quality Test
- [ ] Agent initiates call
- [ ] Customer answers
- [ ] Agent speaks - verify customer hears clearly
- [ ] Customer speaks - verify agent hears clearly
- [ ] No echo or feedback
- [ ] No significant latency (< 500ms)

### 5. Call Duration Test
- [ ] Agent initiates call
- [ ] Customer answers
- [ ] Conversation lasts 5+ minutes
- [ ] Audio remains stable throughout
- [ ] Either party can end call successfully
- [ ] Call duration recorded accurately in database

### 6. Multiple Outbound Calls
- [ ] Agent completes first outbound call
- [ ] Agent immediately initiates second outbound call
- [ ] Second call works as expected
- [ ] No state leakage from first call

### 7. Error Handling
- [ ] Agent initiates call with invalid phone number
- [ ] Verify graceful error handling
- [ ] Agent can retry with correct number

### 8. Meeting Cleanup
- [ ] Agent initiates call
- [ ] Customer answers
- [ ] Call completes (either party hangs up)
- [ ] Verify meeting is deleted from Chime
- [ ] No orphaned meetings remain

## CloudWatch Logs Verification

Check SMA Lambda logs (`inbound-router`) for:
- [ ] `[NEW_OUTBOUND_CALL] Processing outbound call` logged
- [ ] `[NEW_OUTBOUND_CALL] Call dialing, waiting for CALL_ANSWERED event` logged
- [ ] `[CALL_ANSWERED] Customer answered outbound call` logged
- [ ] `[CALL_ANSWERED] Creating customer attendee for meeting` logged
- [ ] `[CALL_ANSWERED] Created customer attendee {attendeeId}` logged
- [ ] `[CALL_ANSWERED] Bridging customer PSTN leg into meeting` logged
- [ ] No errors or exceptions during call flow

Check API Lambda logs (`outbound-call`) for:
- [ ] `[outbound-call] Creating dedicated outbound call meeting` logged
- [ ] `[outbound-call] SIP call initiated successfully` logged
- [ ] Meeting ID and attendee ID logged

## DynamoDB Verification

### AgentPresenceTable
After CALL_ANSWERED, verify agent record contains:
- [ ] `status: "OnCall"`
- [ ] `currentCallId: "{callId}"`
- [ ] `callStatus: "connected"`
- [ ] `lastActivityAt: {recent timestamp}`

### CallQueueTable
After CALL_ANSWERED, verify call record contains:
- [ ] `status: "connected"`
- [ ] `direction: "outbound"`
- [ ] `assignedAgentId: "{agentId}"`
- [ ] `meetingInfo.MeetingId: "{meetingId}"`
- [ ] `customerAttendeeInfo.AttendeeId: "{attendeeId}"` (NEW - from fix)
- [ ] `acceptedAt: {timestamp}`

## Comparison with Inbound Calls

To ensure parity, verify:
- [ ] Outbound call audio quality matches inbound calls
- [ ] Outbound call latency similar to inbound calls
- [ ] Call controls work the same (mute, hold, transfer)
- [ ] Status updates occur at same frequency

## Known Issues Before Fix

Document that before this fix:
- ❌ Agent and customer could NOT hear each other
- ❌ SMA returned empty actions in CALL_ANSWERED
- ❌ Customer PSTN leg was never bridged to meeting
- ❌ No `customerAttendeeInfo` in CallQueueTable

## Verification of Fix

Document that after this fix:
- ✅ Agent and customer CAN hear each other
- ✅ SMA returns `JoinChimeMeeting` action in CALL_ANSWERED
- ✅ Customer PSTN leg is bridged to meeting
- ✅ `customerAttendeeInfo` properly stored in CallQueueTable

## Rollback Plan

If issues occur:
1. Check CloudWatch logs for errors
2. Verify meeting IDs match between API and SMA
3. Verify attendee creation succeeded
4. Check network connectivity between Chime regions
5. If needed, revert to previous version and investigate offline

## Success Criteria

✅ Fix is successful if:
1. Agent and customer can have bidirectional conversation
2. All database states are correct
3. No audio quality issues
4. No errors in CloudWatch logs
5. Call cleanup works properly
6. Multiple consecutive calls work correctly

