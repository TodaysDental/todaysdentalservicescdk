# Outbound Call Flow Fix - Critical Issue Resolution

## Problem Identified

The outbound call flow had a critical issue where the agent and customer could not hear each other during outbound calls:

1. **API Layer** (`outbound-call.ts`): Correctly created a dedicated Chime Meeting and returned its info to the agent's browser
2. **API Layer** (`outbound-call.ts`): Correctly called `CreateSipMediaApplicationCallCommand` to connect customer's PSTN leg to the SMA
3. **SMA Layer** (`inbound-router.ts`): Received `NEW_OUTBOUND_CALL` event with `meetingId` from the API
4. **THE BUG**: The SMA handlers (`NEW_OUTBOUND_CALL` and `CALL_ANSWERED`) updated DynamoDB but returned `buildActions([])` (empty actions)
   - Agent joined the Chime Meeting via browser
   - Customer was on the PSTN line with the SMA
   - **BUT** the SMA never bridged the customer's PSTN leg into the meeting
   - Result: No audio connection between agent and customer

## Root Cause

The SMA (Sip Media Application) is responsible for managing the customer's PSTN leg. When a customer answers an outbound call, the SMA must:
1. Create an attendee for the customer's PSTN leg
2. Execute a `JoinChimeMeeting` action to bridge that leg into the meeting

The previous implementation returned empty actions, leaving the customer PSTN leg disconnected from the meeting.

## Solution Implemented

### File: `src/services/chime/inbound-router.ts`

#### 1. `CALL_ANSWERED` Handler (Lines 648-738)

**Key Changes:**
- Extract `meetingId` from `args` (passed from `outbound-call.ts`)
- Create a new attendee for the customer's PSTN leg using `CreateAttendeeCommand`
  - `ExternalUserId: 'customer-pstn-{callId}'`
- Store customer attendee info in the call queue table
- **CRITICAL**: Return `buildJoinChimeMeetingAction` to bridge the customer's PSTN leg into the meeting

**Code Flow:**
```typescript
// When customer answers the phone
case 'CALL_ANSWERED': {
    if (isOutbound && agentId && callId && meetingId) {
        // 1. Create attendee for customer's PSTN leg
        const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
            MeetingId: meetingId,
            ExternalUserId: `customer-pstn-${callId}`
        }));
        
        // 2. Update agent status to OnCall
        // ... DynamoDB updates ...
        
        // 3. BRIDGE customer PSTN leg into meeting
        return buildActions([
            buildJoinChimeMeetingAction({ MeetingId: meetingId }, customerAttendee)
        ]);
    }
}
```

#### 2. `NEW_OUTBOUND_CALL` Handler (Lines 574-636)

**Key Changes:**
- Simplified to focus on initial call setup
- Returns empty actions while call is dialing
- Delegates bridging to `CALL_ANSWERED` event (when customer picks up)

### File: `src/services/chime/outbound-call.ts`

**Key Changes:**
- Added missing imports for `ChimeSDKMeetingsClient`, `CreateMeetingCommand`, and `CreateAttendeeCommand`
- These were already being used in the code but not imported

## Call Flow After Fix

### Outbound Call Sequence

1. **Agent Initiates Call** (Browser → API)
   - Agent clicks "Call" in UI
   - Browser calls `/chime/outbound-call` API

2. **API Creates Meeting** (`outbound-call.ts`)
   - Creates dedicated Chime Meeting
   - Creates agent attendee
   - Returns meeting info to browser
   - Agent browser joins meeting and waits

3. **API Initiates PSTN Call** (`outbound-call.ts`)
   - Calls `CreateSipMediaApplicationCallCommand`
   - Passes `meetingId` in `ArgumentsMap`
   - Customer's phone starts ringing

4. **SMA Receives NEW_OUTBOUND_CALL** (`inbound-router.ts`)
   - Updates agent status to "dialing"
   - Creates call record in queue table
   - Returns empty actions (call continues ringing)

5. **Customer Answers Phone**
   - Chime generates `CALL_ANSWERED` event

6. **SMA Bridges Connection** (`inbound-router.ts` - CRITICAL FIX)
   - Creates customer attendee for PSTN leg
   - Updates agent status to "OnCall"
   - **Returns `JoinChimeMeeting` action**
   - Customer PSTN leg joins the meeting
   - **Audio connection established!**

7. **Conversation**
   - Agent (in browser meeting) ↔ Customer (PSTN in meeting)
   - Both can hear each other

## Testing Recommendations

1. **Basic Outbound Call**
   - Agent initiates outbound call
   - Customer answers
   - Verify bidirectional audio

2. **Call States**
   - Verify agent status: "Online" → "dialing" → "OnCall"
   - Verify call queue status: "dialing" → "connected"

3. **Error Scenarios**
   - Customer doesn't answer (no answer)
   - Customer rejects call (busy signal)
   - Network issues during call setup

4. **Database Verification**
   - Check `AgentPresenceTable` for correct status updates
   - Check `CallQueueTable` for `customerAttendeeInfo` field
   - Verify meeting cleanup on call end

## Impact

- **Before Fix**: Agent and customer couldn't hear each other on outbound calls
- **After Fix**: Full bidirectional audio on outbound calls
- **Side Effects**: None - this only affects outbound call flow
- **Inbound Calls**: Unaffected - they already had proper bridging logic

## Related Files

- `src/services/chime/outbound-call.ts` - API endpoint for initiating outbound calls
- `src/services/chime/inbound-router.ts` - SMA event handler (the main fix)
- `src/services/chime/call-accepted.ts` - Agent accepting inbound calls (separate flow)
- `src/services/chime/call-rejected.ts` - Agent rejecting calls (separate flow)

## Key Takeaway

**The SMA must explicitly bridge the customer PSTN leg into the meeting using a `JoinChimeMeeting` action.** Simply creating the meeting and having the agent join is not sufficient - the customer's phone call must be actively connected to that meeting via SMA actions.

