# Outbound Call Flow - Before and After Fix

## BEFORE FIX (Broken - No Audio) ❌

```
┌─────────────┐                  ┌──────────────┐                  ┌─────────────┐
│   Agent     │                  │   API Layer  │                  │  SMA Layer  │
│  (Browser)  │                  │outbound-call │                  │inbound-router│
└──────┬──────┘                  └──────┬───────┘                  └──────┬──────┘
       │                                │                                  │
       │ 1. POST /outbound-call         │                                  │
       │ ───────────────────────────────>                                  │
       │                                │                                  │
       │                                │ 2. Create Chime Meeting          │
       │                                │    (meetingId: M-123)            │
       │                                │                                  │
       │                                │ 3. Create Agent Attendee         │
       │                                │    (attendeeId: A-456)           │
       │                                │                                  │
       │ 4. Meeting Info Response       │                                  │
       │ <───────────────────────────────                                  │
       │   { meetingId, attendee }      │                                  │
       │                                │                                  │
       │ 5. Join Meeting M-123          │                                  │
       │    (via browser SDK)           │                                  │
       │ ───────┐                       │                                  │
       │        │ ✅ AGENT IN MEETING   │                                  │
       │ <──────┘                       │                                  │
       │                                │                                  │
       │                                │ 6. CreateSipMediaApplicationCall │
       │                                │    (to: +1234567890)             │
       │                                │    ArgumentsMap:                 │
       │                                │      - meetingId: M-123          │
       │                                │      - agentId: agent-001        │
       │                                │ ─────────────────────────────────>
       │                                │                                  │
       │                                │           7. NEW_OUTBOUND_CALL   │
       │                                │              (Event from Chime)  │
       │                                │ <─────────────────────────────────
       │                                │                                  │
       │                                │              8. Update DynamoDB  │
       │                                │              9. Return []        │
       │                                │                 (empty actions!) │
       │                                │              ❌ NO BRIDGING!     │
       │                                │                                  │
       ┌──────────────────────────────────────────────────────────────────┐│
       │  Customer's phone rings...                                       ││
       │  Customer answers...                                             ││
       └──────────────────────────────────────────────────────────────────┘│
       │                                │                                  │
       │                                │           10. CALL_ANSWERED      │
       │                                │               (Event from Chime) │
       │                                │ <─────────────────────────────────
       │                                │                                  │
       │                                │              11. Update DynamoDB │
       │                                │              12. Return []       │
       │                                │                  (empty actions!)│
       │                                │              ❌ STILL NO BRIDGE! │
       │                                │                                  │
       │                                                                   │
       │  ❌ RESULT: AGENT AND CUSTOMER CANNOT HEAR EACH OTHER            │
       │     - Agent is in meeting M-123 (via browser)                    │
       │     - Customer's PSTN leg is controlled by SMA                   │
       │     - But customer NEVER JOINED the meeting                      │
       │     - NO AUDIO PATH between them!                                │
       │                                                                   │
```

## AFTER FIX (Working - Full Audio) ✅

```
┌─────────────┐                  ┌──────────────┐                  ┌─────────────┐
│   Agent     │                  │   API Layer  │                  │  SMA Layer  │
│  (Browser)  │                  │outbound-call │                  │inbound-router│
└──────┬──────┘                  └──────┬───────┘                  └──────┬──────┘
       │                                │                                  │
       │ 1. POST /outbound-call         │                                  │
       │ ───────────────────────────────>                                  │
       │                                │                                  │
       │                                │ 2. Create Chime Meeting          │
       │                                │    (meetingId: M-123)            │
       │                                │                                  │
       │                                │ 3. Create Agent Attendee         │
       │                                │    (attendeeId: A-456)           │
       │                                │                                  │
       │ 4. Meeting Info Response       │                                  │
       │ <───────────────────────────────                                  │
       │   { meetingId, attendee }      │                                  │
       │                                │                                  │
       │ 5. Join Meeting M-123          │                                  │
       │    (via browser SDK)           │                                  │
       │ ───────┐                       │                                  │
       │        │ ✅ AGENT IN MEETING   │                                  │
       │ <──────┘                       │                                  │
       │                                │                                  │
       │                                │ 6. CreateSipMediaApplicationCall │
       │                                │    (to: +1234567890)             │
       │                                │    ArgumentsMap:                 │
       │                                │      - meetingId: M-123          │
       │                                │      - agentId: agent-001        │
       │                                │      - callType: "Outbound"      │
       │                                │ ─────────────────────────────────>
       │                                │                                  │
       │                                │           7. NEW_OUTBOUND_CALL   │
       │                                │              (Event from Chime)  │
       │                                │ <─────────────────────────────────
       │                                │                                  │
       │                                │              8. Update DynamoDB  │
       │                                │                 status="dialing" │
       │                                │              9. Return []        │
       │                                │                 (wait for answer)│
       │                                │                                  │
       ┌──────────────────────────────────────────────────────────────────┐│
       │  Customer's phone rings...                                       ││
       │  Customer answers...                                             ││
       └──────────────────────────────────────────────────────────────────┘│
       │                                │                                  │
       │                                │           10. CALL_ANSWERED      │
       │                                │               (Event from Chime) │
       │                                │               Args:              │
       │                                │                 - meetingId: M-123
       │                                │                 - agentId        │
       │                                │                 - callType       │
       │                                │ <─────────────────────────────────
       │                                │                                  │
       │                                │              11. Create Customer │
       │                                │                  Attendee        │
       │                                │                  ExternalUserId: │
       │                                │                  "customer-pstn-{id}"
       │                                │                  ✅ AttendeeId:  │
       │                                │                     C-789        │
       │                                │                                  │
       │                                │              12. Update DynamoDB │
       │                                │                  status="connected"
       │                                │                  customerAttendee│
       │                                │                                  │
       │                                │              13. Return:         │
       │                                │                  JoinChimeMeeting│
       │                                │                  {               │
       │                                │                    MeetingId: M-123
       │                                │                    AttendeeId: C-789
       │                                │                    JoinToken: ...│
       │                                │                  }               │
       │                                │              ✅ BRIDGE ACTION!  │
       │                                │                                  │
       │                                │              14. SMA executes    │
       │                                │                  JoinChimeMeeting│
       │                                │              ───────┐            │
       │                                │                     │ Customer   │
       │                                │              <──────┘ joins M-123
       │                                                                   │
       │  ✅ RESULT: BIDIRECTIONAL AUDIO ESTABLISHED!                     │
       │                                                                   │
       │     Meeting M-123:                                               │
       │     ┌─────────────────────────────────────────┐                  │
       │     │  Attendee A-456: Agent (Browser)       │                  │
       │     │  Attendee C-789: Customer (PSTN/SMA)   │                  │
       │     │                                         │                  │
       │     │  ◄──────────── Audio ──────────────►   │                  │
       │     └─────────────────────────────────────────┘                  │
       │                                                                   │
       │  Agent can hear Customer ✅                                      │
       │  Customer can hear Agent ✅                                      │
       │                                                                   │
```

## Key Differences Summary

| Aspect | Before Fix ❌ | After Fix ✅ |
|--------|--------------|-------------|
| **CALL_ANSWERED Handler** | Returns empty actions `[]` | Returns `JoinChimeMeeting` action |
| **Customer Attendee** | Never created | Created with `CreateAttendeeCommand` |
| **Customer in Meeting** | ❌ No - PSTN leg isolated | ✅ Yes - PSTN leg joined meeting |
| **Agent hears Customer** | ❌ No audio | ✅ Clear audio |
| **Customer hears Agent** | ❌ No audio | ✅ Clear audio |
| **Database Record** | No `customerAttendeeInfo` | Has `customerAttendeeInfo` field |

## Critical Code Changes

### File: `inbound-router.ts` - CALL_ANSWERED Handler

**Before:**
```typescript
case 'CALL_ANSWERED': {
    // ... update database ...
    return buildActions([]);  // ❌ Empty - no bridging!
}
```

**After:**
```typescript
case 'CALL_ANSWERED': {
    // 1. Create customer attendee
    const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `customer-pstn-${callId}`
    }));
    
    // 2. Update database
    // ... (agent status, call queue) ...
    
    // 3. BRIDGE customer PSTN leg into meeting
    return buildActions([
        buildJoinChimeMeetingAction({ MeetingId: meetingId }, customerAttendee)
    ]);  // ✅ Bridges customer into meeting!
}
```

## Why This Fix Works

1. **Chime Meeting Architecture**: A Chime Meeting is a virtual room where attendees can communicate
   
2. **Agent Join**: Agent joins via browser SDK using their attendee credentials
   
3. **Customer PSTN Leg**: Customer's phone call is controlled by the SMA (Sip Media Application)
   
4. **The Bridge**: For the customer to join the meeting, the SMA must:
   - Create an attendee for the PSTN leg
   - Execute a `JoinChimeMeeting` action with that attendee's credentials
   
5. **Without Bridge**: Customer's PSTN leg remains in SMA control but isolated from the meeting
   
6. **With Bridge**: Customer's PSTN leg is connected to the meeting, enabling audio with agent

## Testing the Fix

**Verification Steps:**
1. Agent initiates outbound call
2. Check CloudWatch logs for: `[CALL_ANSWERED] Bridging customer PSTN leg into meeting`
3. Customer answers phone
4. **CRITICAL TEST**: Agent says "hello" - customer should hear it
5. **CRITICAL TEST**: Customer says "hello" - agent should hear it
6. Check DynamoDB CallQueueTable for `customerAttendeeInfo` field

**Success Indicators:**
- ✅ Clear bidirectional audio
- ✅ No echo or feedback
- ✅ Low latency (< 500ms)
- ✅ Stable connection throughout call
- ✅ `customerAttendeeInfo` in database

