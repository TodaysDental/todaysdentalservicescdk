# HR Module - Leave & Shift Flow Diagrams

## 1. Leave Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STAFF MEMBER CREATES LEAVE REQUEST                              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │ POST /hr/leave                      │
        │ {                                   │
        │   startDate: "2026-01-25",          │
        │   endDate: "2026-01-27",            │
        │   reason: "vacation"                │
        │ }                                   │
        └─────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │ createLeave()                       │
        │ 1. Validate dates                   │
        │ 2. Lookup staff's clinics           │
        └─────────────────────────────────────┘
                          │
                ┌─────────┴──────────┐
                │                    │
                ▼                    ▼
   ┌─────────────────────────────────────────────┐
   │ Store Primary Leave Record                  │
   │ {                                           │
   │   leaveId: "uuid",                          │
   │   staffId: "jane@clinic.com",               │
   │   startDate: "2026-01-25",                  │
   │   endDate: "2026-01-27",                    │
   │   clinicIds: ["clinic-a", "clinic-b"],     │
   │   status: "pending"                         │
   │ }                                           │
   └─────────────────────────────────────────────┘
                │
                ├──────────────────┐
                │                  │
                ▼                  ▼
   ┌──────────────────────────┐ ┌──────────────────────────┐
   │ Create Clinic Index      │ │ Create Audit Logs        │
   │ Entries (GSI)            │ │ (one per clinic)         │
   │                          │ │                          │
   │ leaveId: "uuid#clinic-a" │ │ For: clinic-a            │
   │ clinicId: "clinic-a"     │ │ For: clinic-b            │
   │ startDate: "2026-01-25"  │ │                          │
   │ ...                      │ │ Action: CREATE           │
   │                          │ │ Resource: LEAVE          │
   │ leaveId: "uuid#clinic-b" │ │                          │
   │ clinicId: "clinic-b"     │ │ Metadata:                │
   │ ...                      │ │   staffClinicIds: [...]  │
   └──────────────────────────┘ └──────────────────────────┘
                │                         │
                └─────────┬───────────────┘
                          ▼
        ┌─────────────────────────────────────┐
        │ ✅ Leave Created Successfully        │
        │ Response:                           │
        │ {                                   │
        │   leaveId: "uuid",                  │
        │   message: "Leave request submitted"│
        │ }                                   │
        └─────────────────────────────────────┘
```

---

## 2. Leave Approval Flow with Shift Cancellation

```
┌────────────────────────────────────────────────────────────────┐
│ ADMIN APPROVES LEAVE REQUEST                                   │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │ PUT /hr/leave/{leaveId}/approve     │
        │ {                                   │
        │   notes: "Approved - enjoy!"        │
        │ }                                   │
        └─────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │ approveLeave()                      │
        │ 1. Get leave request                │
        │ 2. Update status to "approved"      │
        │ 3. Find overlapping shifts          │
        │ 4. Delete each shift                │
        │ 5. Create audit logs                │
        └─────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Query Shifts │ │ Delete ALL   │ │ Audit Each   │
   │              │ │ Overlapping  │ │ Shift        │
   │ byStaff:     │ │ Shifts       │ │ Deletion     │
   │ jane@...     │ │              │ │              │
   │ Between:     │ │ Example:     │ │ Action:      │
   │ 2026-01-25   │ │ - Jan 25     │ │ DELETE       │
   │ 2026-01-27   │ │   09:00-17:00│ │ Resource:    │
   │              │ │ - Jan 26     │ │ SHIFT        │
   │ Found: 2     │ │   12:00-20:00│ │              │
   │ shifts       │ │              │ │ Reason:      │
   │              │ │ Status:      │ │ "Shift       │
   │              │ │ DELETED ✓    │ │  deleted     │
   │              │ │ DELETED ✓    │ │  due to      │
   │              │ │              │ │  approved    │
   │              │ │              │ │  leave"      │
   └──────────────┘ └──────────────┘ └──────────────┘
            │             │             │
            └─────────────┼─────────────┘
                          ▼
        ┌─────────────────────────────────────────┐
        │ Create Leave Approval Audit Logs        │
        │ (one per clinic in leave.clinicIds)     │
        │                                         │
        │ For clinic-a:                           │
        │ ├─ Action: APPROVE                      │
        │ ├─ Resource: LEAVE                      │
        │ ├─ clinicId: "clinic-a"                 │
        │ └─ Metadata:                            │
        │    ├─ staffClinicIds: [clinic-a, ...]  │
        │    ├─ deletedShiftCount: 2              │
        │    └─ actionType: "Leave Approved"      │
        │                                         │
        │ For clinic-b:                           │
        │ ├─ Action: APPROVE                      │
        │ ├─ Resource: LEAVE                      │
        │ ├─ clinicId: "clinic-b"                 │
        │ └─ Metadata: [same as above]            │
        └─────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │ ✅ Leave Approved Successfully       │
        │ Response:                           │
        │ {                                   │
        │   leaveId: "uuid",                  │
        │   status: "approved",               │
        │   cancelledShifts: 2,               │
        │   message: "Leave approved.         │
        │             2 overlapping shift(s)  │
        │             have been automatically │
        │             cancelled."             │
        │ }                                   │
        └─────────────────────────────────────┘

RESULTS:
├─ Leave Status: pending → approved
├─ Shifts: DELETED from DynamoDB (2 records removed)
├─ Calendar: Automatically updated (shifts gone)
├─ Audit Trail: Complete context preserved
└─ Database: Consistent state (no orphaned shifts)
```

---

## 3. Audit Log Query Flow

```
┌────────────────────────────────────────────────────────────────┐
│ ADMIN QUERIES LEAVE AUDITS FOR A CLINIC                        │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────────┐
        │ GET /hr/audit?clinicId=clinic-a       │
        │          &startDate=2026-01-01        │
        │          &endDate=2026-01-31          │
        │          &limit=100                   │
        └───────────────────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────────┐
        │ queryAuditLogs()                      │
        │ Call: auditLogger.queryByClinic()     │
        │       clinicId: "clinic-a"            │
        │       dateRange: [2026-01-01, ...]    │
        └───────────────────────────────────────┘
                          │
                          ▼
        ┌──────────────────────────────────────┐
        │ Query Audit Table GSI                │
        │ IndexName: "byClinic"                │
        │ KeyCondition:                        │
        │   clinicId = "clinic-a" AND          │
        │   timestamp BETWEEN [date1, date2]   │
        │                                      │
        │ ScanIndexForward: false              │
        │ (Most recent first)                  │
        └──────────────────────────────────────┘
                          │
                          ▼
        ┌──────────────────────────────────────┐
        │ ✅ Results Returned                   │
        │                                      │
        │ [                                    │
        │   {                                  │
        │     "auditId": "uuid1",              │
        │     "timestamp": "2026-01-20T14:00", │
        │     "action": "CREATE",              │
        │     "resource": "LEAVE",             │
        │     "resourceId": "leave-uuid",      │
        │     "userId": "jane@clinic.com",     │
        │     "clinicId": "clinic-a",          │
        │     "metadata": {                    │
        │       "staffClinicIds": [...],       │
        │       "actionType": "Leave Request   │
        │                    Created"          │
        │     }                                │
        │   },                                 │
        │   {                                  │
        │     "auditId": "uuid2",              │
        │     "timestamp": "2026-01-21T09:30", │
        │     "action": "APPROVE",             │
        │     "resource": "LEAVE",             │
        │     "resourceId": "leave-uuid",      │
        │     "userId": "admin@clinic.com",    │
        │     "clinicId": "clinic-a",          │
        │     "metadata": {                    │
        │       "deletedShiftCount": 2,        │
        │       "actionType": "Leave Approved" │
        │     }                                │
        │   },                                 │
        │   {                                  │
        │     "auditId": "uuid3",              │
        │     "timestamp": "2026-01-21T09:30", │
        │     "action": "DELETE",              │
        │     "resource": "SHIFT",             │
        │     "resourceId": "shift-uuid-1",    │
        │     "userId": "admin@clinic.com",    │
        │     "clinicId": "clinic-a",          │
        │     "reason": "Shift deleted due to  │
        │               approved leave         │
        │               request (leave-uuid)", │
        │     "metadata": {                    │
        │       "leaveId": "leave-uuid",       │
        │       "leaveStartDate": "2026-01-25",│
        │       "leaveEndDate": "2026-01-27",  │
        │       "actionType": "Shift Deleted   │
        │                    (Leave Approved)" │
        │     }                                │
        │   },                                 │
        │   {                                  │
        │     "auditId": "uuid4",              │
        │     "timestamp": "2026-01-21T09:30", │
        │     "action": "DELETE",              │
        │     "resource": "SHIFT",             │
        │     "resourceId": "shift-uuid-2",    │
        │     ... (similar to uuid3)           │
        │   }                                  │
        │ ]                                    │
        │                                      │
        │ count: 4                             │
        │ lastEvaluatedKey: null               │
        └──────────────────────────────────────┘
```

---

## 4. Data Model Relationships

```
┌─────────────────────────────────────┐
│ Staff Member (Email)                │
│ jane@clinic.com                     │
└─────────────────────────────────────┘
         │
         │ (works at multiple clinics)
         │
    ┌────┴────┬──────────┐
    │          │          │
    ▼          ▼          ▼
┌─────┐  ┌─────┐  ┌────────────┐
│Clinic-A│Clinic-B│StaffInfoTable│
│        │        │             │
│Stored: │Stored: │jane@..#clinic-a
│Shifts  │Shifts  │jane@..#clinic-b
└─────┘  └─────┘  └────────────┘
    │          │
    │    Leave Requested
    │          │
    └────┬─────┘
         │
         ▼
   ┌──────────────────────────────────┐
   │ Leave Record                     │
   │                                  │
   │ leaveId: "uuid"                  │
   │ staffId: "jane@clinic.com"       │
   │ clinicIds: [                     │
   │   "clinic-a",  ◄─────────────┐   │
   │   "clinic-b"   ◄──────────┐  │   │
   │ ]                          │  │   │
   │ startDate: "2026-01-25"    │  │   │
   │ endDate: "2026-01-27"      │  │   │
   │ status: "pending"          │  │   │
   └──────────────────────────────────┘
              │
         ┌────┴────┬──────────┐
         │          │          │
         ▼          ▼          ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Audit    │ │ Audit    │ │ Shifts   │
   │ Clinic-A │ │ Clinic-B │ │ Table    │
   │          │ │          │ │          │
   │Action:   │ │Action:   │ │shift-1  │
   │CREATE    │ │CREATE    │ │ ✓ LINKED│
   │          │ │          │ │ (clinic-a
   │Action:   │ │Action:   │ │  date: 01-25
   │APPROVE   │ │APPROVE   │ │          │
   │          │ │          │ │ shift-2  │
   │Action:   │ │ ...      │ │ ✓ LINKED│
   │DELETE    │ │          │ │ (clinic-a
   │SHIFT     │ │          │ │  date: 01-26
   │          │ │          │ │          │
   │ ...      │ │ ...      │ │ All      │
   │          │ │          │ │ other    │
   │          │ │          │ │ shifts   │
   └──────────┘ └──────────┘ └──────────┘
                              (not touched)
```

---

## 5. Clinic Index Entry Strategy

```
┌──────────────────────────────────────────────────────┐
│ Primary Leave Record (Partition Key: leaveId)        │
│                                                      │
│ leaveId: "leave-12345"                               │
│ staffId: "jane@clinic.com"                           │
│ clinicIds: ["clinic-a", "clinic-b"]                  │
│ startDate: "2026-01-25"                              │
│ endDate: "2026-01-27"                                │
│ status: "approved"                                   │
│ reason: "vacation"                                   │
└──────────────────────────────────────────────────────┘
         │
         │ (Denormalized for GSI queries)
         │
    ┌────┴────┬──────────┐
    │          │          │
    ▼          ▼          ▼
┌──────────────────────────────────────────┐
│ Clinic Index Entries (GSI: clinicId)     │
│                                          │
│ Entry 1:                                 │
│ leaveId: "leave-12345#clinic-a"          │
│ clinicId: "clinic-a" (GSI Partition)     │
│ startDate: "2026-01-25" (GSI Sort)       │
│ staffId: "jane@clinic.com"               │
│ primaryLeaveId: "leave-12345"            │
│ isClinicIndexEntry: true                 │
│ clinicIds: ["clinic-a", "clinic-b"]      │
│ status: "approved"                       │
│                                          │
│ Entry 2:                                 │
│ leaveId: "leave-12345#clinic-b"          │
│ clinicId: "clinic-b" (GSI Partition)     │
│ startDate: "2026-01-25" (GSI Sort)       │
│ staffId: "jane@clinic.com"               │
│ primaryLeaveId: "leave-12345"            │
│ isClinicIndexEntry: true                 │
│ clinicIds: ["clinic-a", "clinic-b"]      │
│ status: "approved"                       │
└──────────────────────────────────────────┘

QUERY EXAMPLE:
GET /hr/leave (Admin view for Clinic A)
│
├─ Query byClinicAndStatus GSI
│  WHERE clinicId = "clinic-a"
│  AND startDate >= "2026-01-01"
│
└─ Returns:
   ├─ Entry 1 (clinic-a index)
   ├─ Entry 2 (clinic-a index)
   └─ Filter isClinicIndexEntry = false
      (to show primary records only in UI)
```

---

## 6. State Transition Diagram

```
┌────────────────────────────────────────┐
│ LEAVE STATES & TRANSITIONS             │
└────────────────────────────────────────┘

         ┌─────────┐
         │ PENDING │  ◄─── Staff creates leave
         └────┬────┘
              │
         ┌────┴────────────┐
         │                 │
         ▼                 ▼
    ┌────────────┐     ┌──────────┐
    │ APPROVED   │     │ DENIED   │
    │            │     │          │
    │ Effect:    │     │ Effect:  │
    │ ▶ Shifts   │     │ ▶ No     │
    │   deleted  │     │   action │
    │ ▶ Audit    │     │ ▶ Audit  │
    │   logged   │     │   logged │
    └────┬───────┘     └──────────┘
         │
         │ (can be deleted while pending or denied)
         │ (admin can deny approved leaves - future)
         ▼
    ┌──────────┐
    │ DELETED  │
    │ (soft)   │
    │          │
    │ Effect:  │
    │ ▶ Removed│
    │ ▶ Shifts │
    │   not    │
    │   restored
    └──────────┘
```

---

## 7. Shift Deletion Cascade

```
┌──────────────────────────────────┐
│ Leave Request Approved            │
│ for Jan 25-27, 2026              │
└──────────────────────────────────┘
         │
         ▼
   ┌───────────────────┐
   │ Find Overlapping  │
   │ Shifts            │
   │                   │
   │ Query: byStaff    │
   │ Filter: status =  │
   │   'scheduled'     │
   │ Date Range:       │
   │   01-25 to 01-27  │
   └───────────────────┘
         │
    ┌────┴────┬──────────┐
    │          │          │
    ▼          ▼          ▼
┌──────────┐┌──────────┐┌──────────┐
│ Shift 1  ││ Shift 2  ││ Shift 3  │
│          ││          ││          │
│01-25     ││01-26     ││01-28     │
│09:00-17:00││12:00-20:00││09:00-17:00
│Status:   ││Status:   ││Status:   │
│scheduled ││scheduled ││scheduled │
│          ││          ││          │
│✓ WITHIN  ││✓ WITHIN  ││✗ AFTER   │
│ DATE     ││ DATE     ││ RANGE    │
│ RANGE    ││ RANGE    ││ (not     │
│          ││          ││  touched)│
└─────┬────┘└─────┬────┘└──────────┘
      │           │
      │    DELETE │
      │           │
   ┌──┴───┬───────┴──┐
   │      │          │
   ▼      ▼          ▼
┌─────────────────────────────┐
│ For Each Overlapping Shift: │
│ 1. Delete from SHIFTS TABLE │
│ 2. Create DELETE audit log  │
│    - Action: DELETE         │
│    - Resource: SHIFT        │
│    - Reason: "Shift deleted │
│      due to approved leave  │
│      request"               │
│    - Include leaveId        │
│    - Include dates          │
│    - Mark actionType:       │
│      "Shift Deleted         │
│      (Leave Approved)"      │
│ 3. Return to user:          │
│    "2 shift(s) cancelled"   │
└─────────────────────────────┘
         │
         ▼
┌──────────────────────┐
│ RESULT:              │
│                      │
│ • Shifts GONE from   │
│   DynamoDB           │
│ • Calendar UPDATED   │
│ • Audit TRAIL shows  │
│   WHY (leave ref)    │
│ • Staff notified     │
│   (email)            │
│ • No orphaned data   │
└──────────────────────┘
```

---

## 8. Frontend Integration Points

```
┌─────────────────────────────────────────────────────────┐
│ FRONTEND COMPONENTS AFFECTED                            │
└─────────────────────────────────────────────────────────┘

1. LEAVE CREATION
   ├─ Form submission creates leave
   ├─ Response includes: leaveId, status
   └─ Show: "Leave request submitted"

2. LEAVE LIST
   ├─ Query: GET /hr/leave
   ├─ Response includes: clinicIds, staffInfo
   ├─ Filter by clinic
   └─ Show: clinic-specific leaves

3. SHIFT CALENDAR
   ├─ Query: GET /hr/shifts?clinicId=...&startDate=...
   ├─ When leave approved:
   │  ├─ Shifts deleted
   │  ├─ Calendar auto-refreshes
   │  └─ Shifts disappear (no "cancelled" state)
   └─ Show: only remaining shifts

4. AUDIT TRAIL DASHBOARD
   ├─ Query: GET /hr/audit?clinicId=...
   ├─ Display timeline:
   │  ├─ Leave created
   │  ├─ Leave approved
   │  ├─ Shift 1 deleted (due to leave)
   │  ├─ Shift 2 deleted (due to leave)
   │  └─ Full context preserved
   └─ Show: clinic-specific entries

5. APPROVAL WORKFLOW
   ├─ Admin sees pending leaves
   ├─ Click "Approve"
   ├─ System shows:
   │  ├─ "Approving leave..."
   │  ├─ "Found 2 overlapping shifts"
   │  ├─ "Deleting shifts..."
   │  └─ "Leave approved! 2 shifts cancelled"
   └─ Calendar updates automatically

6. NOTIFICATIONS (Optional)
   ├─ Staff gets email when leave approved
   ├─ Staff notified: "X shifts cancelled"
   └─ Admin sees confirmation in UI
```

---

## Query Examples

### Create Leave (Multi-Clinic Staff)
```bash
POST /hr/leave
{
  "startDate": "2026-01-25",
  "endDate": "2026-01-27",
  "reason": "vacation"
}

# Response
{
  "success": true,
  "leaveId": "leave-12345",
  "message": "Leave request submitted"
}

# Behind the scenes:
# - Staff email: jane@clinic.com
# - Lookup: StaffClinicInfo for jane@clinic.com
# - Found: clinic-a, clinic-b
# - Store: primary leave + 2 clinic index entries
# - Audit: CREATE logs for clinic-a and clinic-b
```

### Approve Leave with Shift Cancellation
```bash
PUT /hr/leave/leave-12345/approve
{
  "notes": "Approved - enjoy your vacation!"
}

# Response
{
  "success": true,
  "leaveId": "leave-12345",
  "status": "approved",
  "cancelledShifts": 2,
  "message": "Leave approved. 2 overlapping shift(s) have been automatically cancelled."
}

# Shifts deleted:
# - shift-001 (2026-01-25, 09:00-17:00) ✓ DELETED
# - shift-002 (2026-01-26, 12:00-20:00) ✓ DELETED

# Audit entries:
# - APPROVE LEAVE (clinic-a, clinic-b)
# - DELETE SHIFT #1 (clinic-a)
# - DELETE SHIFT #2 (clinic-a)
```

### Query Clinic-Specific Audit
```bash
GET /hr/audit?clinicId=clinic-a&startDate=2026-01-01&endDate=2026-01-31&limit=100

# Response
{
  "success": true,
  "auditLogs": [
    {
      "auditId": "audit-001",
      "timestamp": "2026-01-20T14:00:00Z",
      "action": "CREATE",
      "resource": "LEAVE",
      "resourceId": "leave-12345",
      "userId": "jane@clinic.com",
      "clinicId": "clinic-a",
      "metadata": {
        "actionType": "Leave Request Created",
        "staffClinicIds": ["clinic-a", "clinic-b"]
      }
    },
    {
      "auditId": "audit-002",
      "timestamp": "2026-01-21T09:30:00Z",
      "action": "APPROVE",
      "resource": "LEAVE",
      "resourceId": "leave-12345",
      "userId": "admin@clinic.com",
      "clinicId": "clinic-a",
      "metadata": {
        "actionType": "Leave Approved",
        "deletedShiftCount": 2
      }
    },
    {
      "auditId": "audit-003",
      "timestamp": "2026-01-21T09:30:00Z",
      "action": "DELETE",
      "resource": "SHIFT",
      "resourceId": "shift-001",
      "userId": "admin@clinic.com",
      "clinicId": "clinic-a",
      "reason": "Shift deleted due to approved leave request (leave-12345)",
      "metadata": {
        "actionType": "Shift Deleted (Leave Approved)",
        "leaveId": "leave-12345",
        "leaveStartDate": "2026-01-25",
        "leaveEndDate": "2026-01-27"
      }
    }
  ],
  "count": 3
}
```
