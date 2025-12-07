# Dental Software API Documentation

## Overview

Dental Software service exposes CRUD endpoints for core practice data (clinics, accounts, definitions, users, accounting autopay rules, session tracking, patient adjustments, and alerting categories). Authentication is not enforced by this Lambda itself; deployments may front it with an authorizer or gateway policy.

**Base URL:** `/dental-software`

**Authorization:** Requires `Authorization: Bearer <accessToken>` (same JWT scheme as Admin/Core stacks). OPTIONS preflight is supported.

---

## Table of Contents

1. [Initialization](#1-initialization)
2. [Clinics](#2-clinics)
3. [Accounts](#3-accounts)
4. [Definitions](#4-definitions)
5. [Accounting AutoPay](#5-accounting-autopay)
6. [Users (userod)](#6-users-userod)
7. [Active Instances](#7-active-instances)
8. [Adjustments](#8-adjustments)
9. [Alert Categories](#9-alert-categories)
10. [Alert Category Links](#10-alert-category-links)
11. [Alert Items](#11-alert-items)
12. [Alert Reads](#12-alert-reads)
13. [Alert Subscriptions](#13-alert-subscriptions)
14. [Allergies](#14-allergies)
15. [Allergy Definitions](#15-allergy-definitions)
16. [API Keys](#16-api-keys)
17. [API Subscriptions](#17-api-subscriptions)
18. [Appointments](#18-appointments)
19. [Appointment Rules](#19-appointment-rules)
20. [Appointment Types](#20-appointment-types)
21. [Appointment Field Definitions](#21-appointment-field-definitions)
22. [Appointment Fields](#22-appointment-fields)
23. [Appointment General Messages Sent](#23-appointment-general-messages-sent)
24. [Appointment Reminder Rules](#24-appointment-reminder-rules)
25. [Appointment Reminders Sent](#25-appointment-reminders-sent)
26. [Appointment Thank You Sent](#26-appointment-thank-you-sent)
27. [Appointment Views](#27-appointment-views)
28. [Appointment View Items](#28-appointment-view-items)
29. [ASAP Communications](#29-asap-communications)
30. [Autocodes](#30-autocodes)
31. [Autocode Conditions](#31-autocode-conditions)
32. [Autocode Items](#32-autocode-items)
33. [AutoComm Exclude Dates](#33-autocomm-exclude-dates)
34. [Automation](#34-automation)
35. [Automation Conditions](#35-automation-conditions)
36. [Autonotes](#36-autonotes)
37. [Autonote Controls](#37-autonote-controls)
38. [Benefits](#38-benefits)
39. [Branding](#39-branding)
40. [Canadian Networks](#40-canadian-networks)
41. [Carriers](#41-carriers)
42. [CDC Race/Ethnicity](#42-cdc-raceethnicity)
43. [CDS Permissions](#43-cds-permissions)
44. [Central Connections](#44-central-connections)
45. [Certifications](#45-certifications)
46. [Certification Employees](#46-certification-employees)
47. [Chart Views](#47-chart-views)
48. [Chats](#48-chats)
49. [Chat Attachments](#49-chat-attachments)
50. [Chat Messages](#50-chat-messages)
51. [Chat Reactions](#51-chat-reactions)
52. [Chat User Attachments](#52-chat-user-attachments)
53. [Chat User Status (ChatUserod)](#53-chat-user-status-chatuserod)
54. [Claims](#54-claims)
55. [Claim Attachments](#55-claim-attachments)
56. [Claim Condition Code Logs](#56-claim-condition-code-logs)
57. [Claim Forms](#57-claim-forms)
58. [Claim Form Items](#58-claim-form-items)
59. [Error Responses](#59-error-responses)

---

## 1. Initialization

### 1.1 Init Database

Creates tables if missing: Clinic, Account, Definition, Userod, AccountingAutoPay, ActiveInstance, Adjustment, AlertCategory, AlertCategoryLink.

**Endpoint:** `POST /dental-software/init-database`

**Headers:**
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Content-Type | string | Yes | `application/json` |

**Success Response (200):**
```json
{ "success": true, "message": "Database initialized successfully. ..." }
```

---

## 2. Clinics

### 2.1 List Clinics
**Endpoint:** `GET /dental-software/clinics`

### 2.2 Create Clinic
**Endpoint:** `POST /dental-software/clinics`

**Body:**
```json
{ "Description": "Main", "Address": "1 St", "City": "City", "State": "ST", "Zip": "00000", "Phone": "5551234567", "BankNumber": "123" }
```

### 2.3 Get / Update / Delete Clinic
**Endpoints:**  
`GET /dental-software/clinics/{ClinicNum}`  
`PUT /dental-software/clinics/{ClinicNum}`  
`DELETE /dental-software/clinics/{ClinicNum}`

---

## 3. Accounts

### 3.1 List Accounts
`GET /dental-software/accounts`

### 3.2 Create Account
`POST /dental-software/accounts`

**Body (required):**
```json
{ "Description": "Cash", "AcctType": 0 }
```
Optional: `BankNumber`, `Inactive`, `AccountColor`, `IsAssetAccount`, `CashFlowReserve`

### 3.3 Get / Update / Delete Account
`GET|PUT|DELETE /dental-software/accounts/{AccountNum}`

---

## 4. Definitions

### 4.1 List Definitions
`GET /dental-software/definitions?category=<DefCat>&includeHidden=<bool>`

### 4.2 Create Definition
`POST /dental-software/definitions`

**Body (required):**
```json
{ "Category": 10, "ItemOrder": 0, "ItemName": "Cash" }
```
Optional: `ItemValue`, `ItemColor`, `IsHidden`

### 4.3 Get / Update / Delete Definition
`GET|PUT|DELETE /dental-software/definitions/{DefNum}`

---

## 5. Accounting AutoPay

### 5.1 List AutoPay Rules
`GET /dental-software/accountingautopay`

### 5.2 Create AutoPay Rule
`POST /dental-software/accountingautopay`

**Body:**
```json
{ "PayType": 123, "PickList": "101,102,105" }
```

### 5.3 Get / Update / Delete AutoPay Rule
`GET|PUT|DELETE /dental-software/accountingautopay/{AccountingAutoPayNum}`

---

## 6. Users (userod)

### 6.1 List Users
`GET /dental-software/userod`

### 6.2 Create User
`POST /dental-software/userod`

**Body (required):** `{ "UserName": "alice", "Password": "HashType$Salt$Hash" }`  
Optional fields: `UserGroupNum`, `EmployeeNum`, `ClinicNum`, `ProvNum`, `IsHidden`, `TaskListInBox`, `AnesthProvType`, `DefaultHidePopups`, `PasswordIsStrong`, `ClinicIsRestricted`, `InboxHidePopups`, `UserNumCEMT`, `DateTFail`, `FailedAttempts`, `DomainUser`, `IsPasswordResetRequired`, `MobileWebPin`, `MobileWebPinFailedAttempts`, `DateTLastLogin`, `EClipboardClinicalPin`, `BadgeId`

### 6.3 Get / Update / Delete User
`GET|PUT|DELETE /dental-software/userod/{UserNum}`

Conflicts: duplicate `UserName` → 409. Blank UserName/Password rejected (400).

---

## 7. Active Instances

Tracks OD sessions.

### 7.1 List
`GET /dental-software/activeinstance`

### 7.2 Create
`POST /dental-software/activeinstance`

**Body:**
```json
{
  "ComputerNum": 1,
  "UserNum": 2,
  "ProcessId": 9999,
  "DateTimeLastActive": "2024-01-01T10:00:00",
  "DateTRecorded": "2024-01-01T10:00:00",
  "ConnectionType": 0
}
```
`ConnectionType`: 0=Direct, 1=MiddleTier, 2=Thinfinity, 3=AppStream

### 7.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/activeinstance/{ActiveInstanceNum}`

---

## 8. Adjustments

### 8.1 List
`GET /dental-software/adjustment`

### 8.2 Create
`POST /dental-software/adjustment`

**Body (required):**
```json
{ "AdjDate": "2024-01-01", "AdjAmt": 25.0, "PatNum": 1, "AdjType": 10 }
```
Optional: `ProvNum`, `AdjNote`, `ProcDate`, `ProcNum`, `ClinicNum`, `StatementNum`, `SecUserNumEntry`, `TaxTransID`  
`DateEntry` is DB-managed (not settable).

### 8.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/adjustment/{AdjNum}`

---

## 9. Alert Categories

### 9.1 List
`GET /dental-software/alertcategory`

### 9.2 Create
`POST /dental-software/alertcategory`

**Body:** `{ "Description": "My Alerts", "IsHQCategory": false, "InternalName": null }`

### 9.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/alertcategory/{AlertCategoryNum}`

HQ categories (`IsHQCategory=true`) cannot be edited or deleted (403).

---

## 10. Alert Category Links

Represents alert types attached to categories.

**AlertType enum:** 0=Generic, 1=OnlinePaymentsPending, 2=VoiceMailMonitor, 3=RadiologyProcedures, 4=CallbackRequested, 5=WebSchedNewPat

### 10.1 List
`GET /dental-software/alertcategorylink`

### 10.2 Create
`POST /dental-software/alertcategorylink`

**Body:** `{ "AlertCategoryNum": 5, "AlertType": 0 }`  
Fails with 403 if the category is HQ-locked.

### 10.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/alertcategorylink/{AlertCategoryLinkNum}`  
PUT body: `{ "AlertCategoryNum"?: number, "AlertType"?: number }`

---

## 11. Alert Items

Alerts shown in the main menu for user attention and action.

**AlertType enum (partial):** 0=Generic, 1=OnlinePaymentsPending, 2=VoiceMailMonitor, 3=RadiologyProcedures, 4=CallbackRequested, 5=WebSchedNewPat, 6=WebSchedNewPatApptCreated, … up to 49=DefaultEmailNotSet  
**SeverityType:** 0=Normal, 1=Low, 2=Medium, 3=High  
**ActionType (bitwise):** 0=None, 1=MarkAsRead, 2=OpenForm, 4=Delete, 8=ShowItemValue  
**FormToOpen:** 0=None … 20=FormAdvertisingMassEmailUpload

### 11.1 List
`GET /dental-software/alertitem`

### 11.2 Create
`POST /dental-software/alertitem`

**Body (required):**
```json
{ "Description": "Alert text", "Type": 0 }
```
Optional: `ClinicNum` (0 or -1 for all), `Severity`, `Actions`, `FormToOpen`, `FKey`, `ItemValue`, `UserNum` (0 for all)

### 11.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/alertitem/{AlertItemNum}`  
PUT body: any of the fields above (Description trimmed; Type 0–49; Severity 0–3; Actions ≥0; FormToOpen 0–20)

---

## 12. Alert Reads

Tracks which user has read which alert item.

### 12.1 List
`GET /dental-software/alertread`

### 12.2 Create
`POST /dental-software/alertread`

**Body (required):**
```json
{ "AlertItemNum": 1, "UserNum": 2 }
```

### 12.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/alertread/{AlertReadNum}`  
PUT body: `{ "AlertItemNum"?: number, "UserNum"?: number }`

---

## 13. Alert Subscriptions

Subscribes a user (and optional clinic) to alert categories. Users do not receive alerts without a subscription row.

### 13.1 List
`GET /dental-software/alertsub`

### 13.2 Create
`POST /dental-software/alertsub`

**Body (required):**
```json
{ "UserNum": 2, "AlertCategoryNum": 5 }
```
Optional: `ClinicNum` (default 0), `Type` (deprecated, defaults 0)

### 13.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/alertsub/{AlertSubNum}`  
PUT body: `{ "UserNum"?: number, "ClinicNum"?: number, "Type"?: number, "AlertCategoryNum"?: number }`

---

## 14. Allergies

Patient allergy records linked to allergy definitions.

### 14.1 List
`GET /dental-software/allergy`

### 14.2 Create
`POST /dental-software/allergy`

**Body (required):**
```json
{ "AllergyDefNum": 1, "PatNum": 10 }
```
Optional: `Reaction`, `StatusIsActive` (default true), `DateAdverseReaction`

### 14.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/allergy/{AllergyNum}`  
PUT body: `{ "AllergyDefNum"?: number, "PatNum"?: number, "Reaction"?: string, "StatusIsActive"?: boolean, "DateAdverseReaction"?: string }`

---

## 15. Allergy Definitions

Master list of allergy definitions.

### 15.1 List
`GET /dental-software/allergydef`

### 15.2 Create
`POST /dental-software/allergydef`

**Body (required):**
```json
{ "Description": "Penicillin" }
```
Optional: `ICD9Code`, `SNOMEDCTCode`, `IsHidden`

### 15.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/allergydef/{AllergyDefNum}`  
PUT body: `{ "Description"?: string, "ICD9Code"?: string, "SNOMEDCTCode"?: string, "IsHidden"?: boolean }`

---

## 16. API Keys

Stores customer API key and developer name (copy from HQ).

### 16.1 List
`GET /dental-software/apikey`

### 16.2 Create
`POST /dental-software/apikey`

**Body (required):**
```json
{ "CustApiKey": "key123", "DevName": "Developer Inc" }
```

### 16.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apikey/{APIKeyNum}`  
PUT body: `{ "CustApiKey"?: string, "DevName"?: string }`

---

## 17. API Subscriptions

Subscription to send events to an endpoint for DB/UI changes.

### 17.1 List
`GET /dental-software/apisubscription`

### 17.2 Create
`POST /dental-software/apisubscription`

**Body (required):**
```json
{
  "EndPointUrl": "https://example.com/webhook",
  "CustomerKey": "key123",
  "WatchTable": "patient",
  "PollingSeconds": 30,
  "UiEventType": "None"
}
```
Optional: `Workstation`, `DateTimeStart`, `DateTimeStop`, `Note`

### 17.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apisubscription/{ApiSubscriptionNum}`  
PUT body: any of the fields above

---

## 18. Appointments

Core scheduling records.

### 18.1 List
`GET /dental-software/appointment`

### 18.2 Create
`POST /dental-software/appointment`

**Body (required):**
```json
{ "PatNum": 1, "AptStatus": 1, "Pattern": "XXXX////" }
```
Optional: `Confirmed`, `TimeLocked`, `Op`, `Note`, `ProvNum`, `ProvHyg`, `AptDateTime`, `NextAptNum`, `UnschedStatus`, `IsNewPatient`, `ProcDescript`, `Assistant`, `ClinicNum`, `IsHygiene`, `DateTimeArrived`, `DateTimeSeated`, `DateTimeDismissed`, `InsPlan1`, `InsPlan2`, `DateTimeAskedToArrive`, `ProcsColored`, `ColorOverride`, `AppointmentTypeNum`, `SecUserNumEntry`, `Priority`, `ProvBarText`, `PatternSecondary`, `SecurityHash`, `ItemOrderPlanned`, `IsMirrored`

### 18.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/appointment/{AptNum}`  
PUT body: any of the fields above

---

## 19. Appointment Rules

Blocks double booking for code ranges.

### 19.1 List
`GET /dental-software/appointmentrule`

### 19.2 Create
`POST /dental-software/appointmentrule`

**Body (required):**
```json
{ "RuleDesc": "No double booking for codes", "CodeStart": "D0000", "CodeEnd": "D9999", "IsEnabled": true }
```

### 19.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/appointmentrule/{AppointmentRuleNum}`  
PUT body: `{ "RuleDesc"?: string, "CodeStart"?: string, "CodeEnd"?: string, "IsEnabled"?: boolean }`

---

## 20. Appointment Types

Overrides appointment color and metadata.

### 20.1 List
`GET /dental-software/appointmenttype`

### 20.2 Create
`POST /dental-software/appointmenttype`

**Body (required):**
```json
{ "AppointmentTypeName": "Prophy", "ItemOrder": 0 }
```
Optional: `AppointmentTypeColor`, `IsHidden`, `Pattern`, `CodeStr`, `CodeStrRequired`, `RequiredProcCodesNeeded` (0=None,1=AtLeastOne,2=All), `BlockoutTypes`

### 20.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/appointmenttype/{AppointmentTypeNum}`  
PUT body: any of the fields above

---

## 21. Appointment Field Definitions

Defines custom fields available on appointments.

### 21.1 List
`GET /dental-software/apptfielddef`

### 21.2 Create
`POST /dental-software/apptfielddef`

**Body (required):**
```json
{ "FieldName": "CustomNote", "FieldType": 0 }
```
`FieldType`: 0=Text, 1=PickList  
Optional: `PickList` (CRLF-separated values when FieldType=1), `ItemOrder`

### 21.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptfielddef/{ApptFieldDefNum}`  
PUT body: `{ "FieldName"?: string, "FieldType"?: number, "PickList"?: string, "ItemOrder"?: number }`

---

## 22. Appointment Fields

Custom field values on specific appointments.

### 22.1 List
`GET /dental-software/apptfield`

### 22.2 Create
`POST /dental-software/apptfield`

**Body (required):**
```json
{ "AptNum": 123, "FieldName": "CustomNote", "FieldValue": "Text here" }
```

### 22.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptfield/{ApptFieldNum}`  
PUT body: `{ "AptNum"?: number, "FieldName"?: string, "FieldValue"?: string }`

---

## 23. Appointment General Messages Sent

Records sent general messages to avoid duplicates.

### 23.1 List
`GET /dental-software/apptgeneralmessagesent`

### 23.2 Create
`POST /dental-software/apptgeneralmessagesent`

**Body (required):**
```json
{ "ApptNum": 1, "PatNum": 1, "ClinicNum": 0 }
```
Optional: `TSPrior`, `ApptReminderRuleNum`, `SendStatus`, `ApptDateTime`, `MessageType`, `MessageFk`, `DateTimeSent`, `ResponseDescript`

### 23.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptgeneralmessagesent/{ApptGeneralMessageSentNum}`  
PUT body: any of the fields above

---

## 24. Appointment Reminder Rules

Automated messaging rules for reminders/confirmations (per clinic or default).

### 24.1 List
`GET /dental-software/apptreminderrule`

### 24.2 Create
`POST /dental-software/apptreminderrule`

**Body (required):**
```json
{ "TypeCur": 0, "TSPrior": 1440, "SendOrder": "1,2" }
```
`TypeCur` enum: -1 Undefined, 0 Reminder, 1 ConfirmationFutureDay, 2 ReminderFutureDay (deprecated), 3 PatientPortalInvite, 4 ScheduleThankYou, 5 Arrival, 6 Birthday, 7 GeneralMessage, 8 WebSchedRecall, 9 NewPatientThankYou, 10 PayPortalMsgToPay, 11 EClipboardWeb  
Required: `TypeCur`, `TSPrior`, `SendOrder` (comma list of comm types). Optional: `IsSendAll`, templates (SMS/Email, agg variants, auto replies, failure replies, come-in), `ClinicNum`, `DoNotSendWithin`, `IsEnabled`, `IsAutoReplyEnabled`, `Language`, `EmailTemplateType`/`AggEmailTemplateType` (0=Regular,1=Html,2=RawHtml), `IsSendForMinorsBirthday`, `EmailHostingTemplateNum`, `MinorAge`, `SendMultipleInvites` (0/1/2), `TimeSpanMultipleInvites`.

### 24.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptreminderrule/{ApptReminderRuleNum}`  
PUT body: any of the fields above

---

## 25. Appointment Reminders Sent

Records individual reminder sends to avoid duplicate sends.

### 25.1 List
`GET /dental-software/apptremindersent`

### 25.2 Create
`POST /dental-software/apptremindersent`

**Body (required):**
```json
{ "ApptNum": 1 }
```
Optional: `ApptDateTime`, `DateTimeSent`, `TSPrior`, `ApptReminderRuleNum`, `PatNum`, `ClinicNum`, `SendStatus`, `MessageType`, `MessageFk`, `ResponseDescript`

### 25.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptremindersent/{ApptReminderSentNum}`  
PUT body: any of the fields above

---

## 26. Appointment Thank You Sent

Records thank-you sends to avoid duplicate sends.

### 26.1 List
`GET /dental-software/apptthankyousent`

### 26.2 Create
`POST /dental-software/apptthankyousent`

**Body (required):**
```json
{ "ApptNum": 1 }
```
Optional: `ApptDateTime`, `ApptSecDateTEntry`, `TSPrior`, `ApptReminderRuleNum`, `ClinicNum`, `PatNum`, `ResponseDescript`, `DateTimeThankYouTransmit`, `ShortGUID`, `SendStatus`, `MessageType`, `MessageFk`, `DateTimeEntry`, `DateTimeSent`

### 26.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptthankyousent/{ApptThankYouSentNum}`  
PUT body: any of the fields above

---

## 27. Appointment Views

Represents saved appointment module views (clinic-scoped ordering, stacking behavior, scrolling, mirroring).

### 27.1 List
`GET /dental-software/apptview`

### 27.2 Create
`POST /dental-software/apptview`

**Body (required):**
```json
{ "Description": "Default view", "ItemOrder": 0, "RowsPerIncr": 1 }
```

Optional: `OnlyScheduledProvs`, `OnlySchedBeforeTime`, `OnlySchedAfterTime`, `StackBehavUR` (0 vertical, 1 horizontal), `StackBehavLR` (0 vertical, 1 horizontal), `ClinicNum`, `ApptTimeScrollStart`, `IsScrollStartDynamic`, `IsApptBubblesDisabled`, `WidthOpMinimum`, `WaitingRmName` (0 LastFirst, 1 FirstLastI, 2 First), `OnlyScheduledProvDays`, `ShowMirroredAppts`

### 27.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptview/{ApptViewNum}`  
PUT body: any of the fields above

---

## 28. Appointment View Items

Items attached to an appointment view. Each item references one of operatory, provider, or a display element.

### 28.1 List
`GET /dental-software/apptviewitem`

### 28.2 Create
`POST /dental-software/apptviewitem`

**Body (required):**
```json
{ "ApptViewNum": 1 }
```

Optional: `OpNum`, `ProvNum`, `ElementDesc`, `ElementOrder`, `ElementColor`, `ElementAlignment` (0 Main, 1 UR, 2 LR), `ApptFieldDefNum`, `PatFieldDefNum`, `IsMobile`

### 28.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/apptviewitem/{ApptViewItemNum}`  
PUT body: any of the fields above

---

## 29. ASAP Communications

ASAP notifications sent for open slots (Web Sched ASAP). Tracks SMS/email status and patient responses.

### 29.1 List
`GET /dental-software/asapcomm`

### 29.2 Create
`POST /dental-software/asapcomm`

**Body (required):**
```json
{ "FKey": 123, "FKeyType": 1, "PatNum": 10, "ClinicNum": 1 }
```

Optional: `ScheduleNum`, `ShortGUID`, `DateTimeEntry`, `DateTimeExpire`, `DateTimeSmsScheduled`, `SmsSendStatus` (0-5 AutoCommStatus), `EmailSendStatus` (0-5 AutoCommStatus), `DateTimeSmsSent`, `DateTimeEmailSent`, `EmailMessageNum`, `ResponseStatus` (0-11 AsapRSVPStatus), `DateTimeOrig`, `TemplateText`, `TemplateEmail`, `TemplateEmailSubj`, `Note`, `GuidMessageToMobile`, `EmailTemplateType` (0 Regular, 1 Html, 2 RawHtml), `UserNum`

Enums: `FKeyType` (0 None, 1 ScheduledAppt, 2 UnscheduledAppt, 3 PlannedAppt, 4 Recall, 5 Broken); `AutoCommStatus` (0 Undefined, 1 DoNotSend, 2 SendNotAttempted, 3 SendSuccessful, 4 SendFailed, 5 SentAwaitingReceipt); `AsapRSVPStatus` (0 UnableToSend ... 11 DeclinedStopComm)

### 29.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/asapcomm/{AsapCommNum}`  
PUT body: any of the fields above

---

## 30. Autocodes

Automated procedure selection helpers.

### 30.1 List
`GET /dental-software/autocode`

### 30.2 Create
`POST /dental-software/autocode`

**Body (required):**
```json
{ "Description": "Amalgam" }
```

Optional: `IsHidden` (bool), `LessIntrusive` (bool)

### 30.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autocode/{AutoCodeNum}`  
PUT body: any of the fields above

---

## 31. Autocode Conditions

AutoCode conditions attached to AutoCodeItems.

### 31.1 List
`GET /dental-software/autocodecond`

### 31.2 Create
`POST /dental-software/autocodecond`

**Body (required):**
```json
{ "AutoCodeItemNum": 1, "Cond": 0 }
```
`Cond` enum (AutoCondition): 0 Anterior, 1 Posterior, 2 Premolar, 3 Molar, 4 One_Surf, 5 Two_Surf, 6 Three_Surf, 7 Four_Surf, 8 Five_Surf, 9 First, 10 EachAdditional, 11 Maxillary, 12 Mandibular, 13 Primary, 14 Permanent, 15 Pontic, 16 Retainer, 17 AgeOver18

### 31.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autocodecond/{AutoCodeCondNum}`  
PUT body: any of the fields above

---

## 32. Autocode Items

AutoCode items linking an AutoCode to a procedure code (with legacy OldCode).

### 32.1 List
`GET /dental-software/autocodeitem`

### 32.2 Create
`POST /dental-software/autocodeitem`

**Body (required):**
```json
{ "AutoCodeNum": 1, "CodeNum": 1000 }
```
Optional: `OldCode`

### 32.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autocodeitem/{AutoCodeItemNum}`  
PUT body: any of the fields above

---

## 33. AutoComm Exclude Dates

Holiday/closed-day exclusions for AutoComm sends (per clinic).

### 33.1 List
`GET /dental-software/autocommexcludedate`

### 33.2 Create
`POST /dental-software/autocommexcludedate`

**Body (required):**
```json
{ "ClinicNum": 1, "DateExclude": "2024-12-25T00:00:00" }
```

### 33.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autocommexcludedate/{AutoCommExcludeDateNum}`  
PUT body: any of the fields above

---

## 34. Automation

Defines automated actions triggered by events.

### 34.1 List
`GET /dental-software/automation`

### 34.2 Create
`POST /dental-software/automation`

**Body (required):**
```json
{ "Description": "Completion popup", "Autotrigger": 0, "AutoAction": 4 }
```

Optional: `ProcCodes`, `SheetDefNum`, `CommType`, `MessageContent`, `AptStatus`, `AppointmentTypeNum`, `PatStatus`  
Enums: `Autotrigger` (0 ProcedureComplete, 1 ApptBreak, 2 ApptNewPatCreate, 3 PatientOpen, 4 ApptCreate, 5 ProcSchedule, 6 BillingTypeSet, 7 RxCreate, 8 ClaimCreate, 9 ClaimOpen, 10 ApptComplete); `AutoAction` (0 PrintPatientLetter, 1 CreateCommlog, 2 PrintReferralLetter, 3 ShowExamSheet, 4 PopUp, 5 SetApptASAP, 6 ShowConsentForm, 7 SetApptType, 8 PopUpThenDisable10Min, 9 PatRestrictApptSchedTrue, 10 PatRestrictApptSchedFalse, 11 PrintRxInstruction, 12 ChangePatStatus); `PatStatus` (0 Patient, 1 NonPatient, 2 Inactive, 3 Archived, 4 Deleted, 5 Deceased, 6 Prospective)

### 34.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/automation/{AutomationNum}`  
PUT body: any of the fields above

---

## 35. Automation Conditions

Conditions that gate automation execution.

### 35.1 List
`GET /dental-software/automationcondition`

### 35.2 Create
`POST /dental-software/automationcondition`

**Body (required):**
```json
{ "AutomationNum": 1, "CompareField": 0, "Comparison": 0 }
```
Optional: `CompareString`  
Enums: `CompareField` (AutoCondField: 0 NeedsSheet, 1 Problem, 2 Medication, 3 Allergy, 4 Age, 5 Gender, 6 Labresult, 7 InsuranceNotEffective, 8 BillingType, 9 IsProcRequired, 10 IsControlled, 11 IsPatientInstructionPresent, 12 PlanNum, 13 ClaimContainsProcCode); `Comparison` (0 Equals, 1 GreaterThan, 2 LessThan, 3 Contains, 4 None)

### 35.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/automationcondition/{AutomationConditionNum}`  
PUT body: any of the fields above

---

## 36. Autonotes

Autonote templates.

### 36.1 List
`GET /dental-software/autonote`

### 36.2 Create
`POST /dental-software/autonote`

**Body (required):**
```json
{ "AutoNoteName": "Follow-up" }
```
Optional: `MainText`, `Category` (DefNum in AutoNoteCat)

### 36.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autonote/{AutoNoteNum}`  
PUT body: any of the fields above

---

## 37. Autonote Controls

Prompts used within Autonotes.

### 37.1 List
`GET /dental-software/autonotecontrol`

### 37.2 Create
`POST /dental-software/autonotecontrol`

**Body (required):**
```json
{ "Descript": "Pain level", "ControlType": "OneResponse", "ControlLabel": "Pain 1-10" }
```
Optional: `ControlOptions` (newline-separated options for combo/multi)

`ControlType`: `Text`, `OneResponse`, `MultiResponse`

### 37.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/autonotecontrol/{AutoNoteControlNum}`  
PUT body: any of the fields above

---

## 38. Benefits

Insurance benefits (percentages, deductibles, limits, frequency).

### 38.1 List
`GET /dental-software/benefit`

### 38.2 Create
`POST /dental-software/benefit`

**Body (required):**
```json
{ "BenefitType": 1 }
```
Must include at least one of `PlanNum` or `PatPlanNum`.

Optional: `PlanNum`, `PatPlanNum`, `CovCatNum`, `Percent` (0-100 or -1), `MonetaryAmt`, `TimePeriod` (0 None,1 ServiceYear,2 CalendarYear,3 Lifetime,4 Years,5 NumberInLast12Months), `QuantityQualifier` (0 None,1 NumberOfServices,2 AgeLimit,3 Visits,4 Years,5 Months), `Quantity`, `CodeNum`, `CoverageLevel` (0 None,1 Individual,2 Family), `CodeGroupNum`, `TreatArea` (0 None,1 Surf,2 Tooth,3 Mouth,4 Quad,5 Sextant,6 Arch,7 ToothRange), `ToothRange`

### 38.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/benefit/{BenefitNum}`  
PUT body: any of the fields above

---

## 39. Branding

Clinic-level branding configs (logos, palettes, descriptions).

### 39.1 List
`GET /dental-software/branding`

### 39.2 Create
`POST /dental-software/branding`

**Body (required):**
```json
{ "BrandingType": 1 }
```

Optional: `ClinicNum` (0 for global), `ValueString`, `DateTimeUpdated`  
`BrandingType`: 0 None, 1 LogoFilePath, 2 MaterialColorPalette, 3 OfficeDescription

### 39.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/branding/{BrandingNum}`  
PUT body: any of the fields above

---

## 40. Canadian Networks

Canadian network metadata (prefixes, RPR handler flag).

### 40.1 List
`GET /dental-software/canadiannetwork`

### 40.2 Create
`POST /dental-software/canadiannetwork`

**Body (required):**
```json
{ "Abbrev": "NET1", "Descript": "Network One" }
```
Optional: `CanadianTransactionPrefix`, `CanadianIsRprHandler`

### 40.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/canadiannetwork/{CanadianNetworkNum}`  
PUT body: any of the fields above

---

## 41. Carriers

Stores carrier contact/EDI metadata for plans.

### 41.1 List
`GET /dental-software/carrier`

### 41.2 Create
`POST /dental-software/carrier`

**Body (required):**
```json
{ "CarrierName": "ACME Insurance" }
```
Optional: `Address`, `Address2`, `City`, `State`, `Zip`, `Phone`, `ElectID`, `NoSendElect` (0 send, 1 block, 2 block non-primary), `IsCDA`, `CDAnetVersion`, `CanadianNetworkNum`, `IsHidden`, `CanadianEncryptionMethod`, `CanadianSupportedTypes`, `SecUserNumEntry`, `SecDateEntry`, `TIN`, `CarrierGroupName`, `ApptTextBackColor`, `IsCoinsuranceInverted`, `TrustedEtransFlags` (bit flags, currently 0 none, 1 real-time eligibility), `CobInsPaidBehaviorOverride` (0 Default,1 ClaimLevel,2 ProcedureLevel,3 Both), `EraAutomationOverride` (0 UseGlobal,1 ReviewAll,2 SemiAutomatic,3 FullyAutomatic), `OrthoInsPayConsolidate` (0 Global,1 ForceConsolidateOn,2 ForceConsolidateOff), `PaySuiteTransSup` (0 None,1 ExtendedReversal,2 PlanDetails,3 Both)

### 41.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/carrier/{CarrierNum}`  
PUT body: any of the fields above

---

## 42. CDC Race/Ethnicity

CDCREC race/ethnicity codes (around 200 rows).

### 42.1 List
`GET /dental-software/cdcrec`

### 42.2 Create
`POST /dental-software/cdcrec`

**Body (required):**
```json
{
  "CdcrecCode": "1002-5",
  "HeirarchicalCode": "R1.01.001",
  "Description": "Abenaki"
}
```

### 42.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/cdcrec/{CdcrecNum}`  
PUT body: any of the fields above

---

## 43. CDS Permissions

User-level CDS intervention permissions.

### 43.1 List
`GET /dental-software/cdspermission`

### 43.2 Create
`POST /dental-software/cdspermission`

**Body (required):**
```json
{ "UserNum": 123 }
```
Optional booleans: `SetupCDS`, `ShowCDS`, `ShowInfobutton`, `EditBibliography`, `ProblemCDS`, `MedicationCDS`, `AllergyCDS`, `DemographicCDS`, `LabTestCDS`, `VitalCDS`

### 43.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/cdspermission/{CDSPermissionNum}`  
PUT body: any of the fields above

---

## 44. Central Connections

Connection metadata for remote databases or web services used by Central Manager.

### 44.1 List
`GET /dental-software/centralconnection`

### 44.2 Create
`POST /dental-software/centralconnection`

**Body (required: ServerName or ServiceURI):**
```json
{
  "ServerName": "db.example.com",
  "DatabaseName": "opendental",
  "MySqlUser": "oduser",
  "MySqlPassword": "encryptedpw"
}
```
Optional: `ServiceURI`, `OdUser`, `OdPassword`, `Note`, `ItemOrder`, `WebServiceIsEcw`, `ConnectionStatus`, `HasClinicBreakdownReports`

### 44.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/centralconnection/{CentralConnectionNum}`  
PUT body: any of the fields above

---

## 45. Certifications

Clinical training/certification definitions.

### 45.1 List
`GET /dental-software/cert`

### 45.2 Create
`POST /dental-software/cert`

**Body (required):**
```json
{ "Description": "HIPAA Training" }
```
Optional: `WikiPageLink`, `ItemOrder`, `IsHidden`, `CertCategoryNum`

### 45.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/cert/{CertNum}`  
PUT body: any of the fields above

---

## 46. Certification Employees

Cert completions per employee.

### 46.1 List
`GET /dental-software/certemployee`

### 46.2 Create
`POST /dental-software/certemployee`

**Body (required):**
```json
{ "CertNum": 10, "EmployeeNum": 200 }
```
Optional: `DateCompleted`, `Note`, `UserNum`

### 46.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/certemployee/{CertEmployeeNum}`  
PUT body: any of the fields above

---

## 47. Chart Views

Chart module view definitions.

### 47.1 List
`GET /dental-software/chartview`

### 47.2 Create
`POST /dental-software/chartview`

**Body (required):**
```json
{ "Description": "Progress Notes" }
```
Optional: `ItemOrder`, `ProcStatuses` (bitwise: 0 None, 1 TP, 2 Complete, 4 ExistingCurProv, 8 ExistingOtherProv, 16 Referred, 32 Deleted, 64 Condition, 127 All), `ObjectTypes` (bitwise: 0 None, 1 Appointments, 2 CommLog, 4 CommLogFamily, 8 Tasks, 16 Email, 32 LabCases, 64 Rx, 128 Sheets, 256 CommLogSuperFamily, 511 All), `ShowProcNotes`, `IsAudit`, `SelectedTeethOnly`, `OrionStatusFlags` (int), `DatesShowing` (0 All, 1 Today, 2 Yesterday, 3 ThisYear, 4 LastYear), `IsTpCharting`

### 47.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chartview/{ChartViewNum}`  
PUT body: any of the fields above

---

## 48. Chats

Chat room definitions.

### 48.1 List
`GET /dental-software/chat`

### 48.2 Create
`POST /dental-software/chat`

**Body (required):**
```json
{ "Name": "Front Desk" }
```

### 48.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chat/{ChatNum}`  
PUT body: any of the fields above

---

## 49. Chat Attachments

Files or images attached to chat messages. Binary fields are expected as base64 strings.

### 49.1 List
`GET /dental-software/chatattach`

### 49.2 Create
`POST /dental-software/chatattach`

**Body (required):**
```json
{ "ChatMsgNum": 123, "FileName": "image.png" }
```
Optional: `Thumbnail` (base64 png), `FileData` (base64 file content)

### 49.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chatattach/{ChatAttachNum}`  
PUT body: any of the fields above

---

## 50. Chat Messages

Individual messages posted within a chat.

### 50.1 List
`GET /dental-software/chatmsg`

### 50.2 Create
`POST /dental-software/chatmsg`

**Body (required):**
```json
{
  "ChatNum": 10,
  "UserNum": 5,
  "DateTimeSent": "2024-01-01T10:00:00Z",
  "SeqCount": 1
}
```
Optional: `Message` (string), `Quote` (ChatMsgNum), `EventType` (number), `IsImportant` (bool)

### 50.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chatmsg/{ChatMsgNum}`  
PUT body: any of the fields above

---

## 51. Chat Reactions

Emoji reactions tied to a chat message.

### 51.1 List
`GET /dental-software/chatreaction`

### 51.2 Create
`POST /dental-software/chatreaction`

**Body (required):**
```json
{ "ChatMsgNum": 123, "UserNum": 5, "EmojiName": "Angry face with horns" }
```

### 51.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chatreaction/{ChatReactionNum}`  
PUT body: any of the fields above

---

## 52. Chat User Attachments

Links a user to a chat and tracks read/mute state.

### 52.1 List
`GET /dental-software/chatuserattach`

### 52.2 Create
`POST /dental-software/chatuserattach`

**Body (required):**
```json
{ "UserNum": 5, "ChatNum": 10 }
```
Optional: `IsRead` (bool), `DateTimeRemoved` (ISO string), `IsMute` (bool)

### 52.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chatuserattach/{ChatUserAttachNum}`  
PUT body: any of the fields above

---

## 53. Chat User Status (ChatUserod)

Status and options for a chat user.

### 53.1 List
`GET /dental-software/chatuserod`

### 53.2 Create
`POST /dental-software/chatuserod`

**Body (required):**
```json
{ "UserNum": 5 }
```
Optional: `UserStatus` (0 Available, 1 Away, 2 DoNotDisturb), `DateTimeStatusReset` (ISO string), `Photo` (string), `PhotoCrop` (string), `OpenBackground` (bool), `CloseKeepRunning` (bool), `MuteNotifications` (bool), `DismissNotifySecs` (int), `MuteImportantNotifications` (bool), `DismissImportantNotifySecs` (int)

### 53.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/chatuserod/{ChatUserodNum}`  
PUT body: any of the fields above

---

## 54. Claims

Insurance claim headers. Many fields are optional; the required fields are `PatNum`, `ClaimStatus` (one of U,H,W,P,S,R,I), and `ClaimType` (e.g., P,S,PreAuth,Other,Cap).

### 54.1 List
`GET /dental-software/claim`

### 54.2 Create
`POST /dental-software/claim`

**Body (required):**
```json
{ "PatNum": 123, "ClaimStatus": "U", "ClaimType": "P" }
```
Optional (partial list): `DateService`, `DateSent`, `DateReceived`, `PlanNum`, `ProvTreat`, `ClaimFee`, `InsPayEst`, `InsPayAmt`, `DedApplied`, `PreAuthString`, `IsProsthesis`, `PriorDate`, `ReasonUnderPaid`, `ClaimNote`, `ProvBill`, `ReferringProv`, `RefNumString`, `PlaceService` (0-17), `AccidentRelated`, `AccidentDate`, `AccidentST`, `EmployRelated` (0 Unknown, 1 Yes, 2 No), `IsOrtho`, `OrthoRemainM`, `OrthoDate`, `PatRelat`, `PlanNum2`, `PatRelat2`, `WriteOff`, `Radiographs`, `ClinicNum`, `ClaimForm`, `AttachedImages`, `AttachedModels`, `AttachedFlags`, `AttachmentID`, `Canadian*` fields, `InsSubNum`, `InsSubNum2`, `Canada*` fields, `PriorAuthorizationNumber`, `SpecialProgramCode` (0 None, 1 EPSDT_1, 2 Handicapped_2, 3 SpecialFederal_3, 5 Disability_5, 9 SecondOpinion_9), `UniformBillType`, `MedType` (0 Dental, 1 Medical, 2 Institutional), `AdmissionTypeCode`, `AdmissionSourceCode`, `PatientStatusCode`, `CustomTracking`, `DateResent`, `CorrectionType` (0 Original, 1 Replacement, 2 Void), `ClaimIdentifier`, `OrigRefNum`, `ProvOrderOverride`, `OrthoTotalM`, `ShareOfCost`, `SecUserNumEntry`, `SecDateEntry`, `SecDateTEdit`, `OrderingReferralNum`, `DateSentOrig`, `DateIllnessInjuryPreg`, `DateIllnessInjuryPregQualifier` (0/431/484), `DateOther`, `DateOtherQualifier` (0, 90, 91, 304, 439, 444, 453, 454, 455, 471), `IsOutsideLab`, `SecurityHash`, `Narrative`

### 54.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/claim/{ClaimNum}`  
PUT body: any of the fields above

---

## 55. Claim Attachments

Files attached to claims.

### 55.1 List
`GET /dental-software/claimattach`

### 55.2 Create
`POST /dental-software/claimattach`

**Body (required):**
```json
{ "ClaimNum": 123, "DisplayedFileName": "tooth2.jpg" }
```
Optional: `ActualFileName`, `ImageReferenceId`

### 55.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/claimattach/{ClaimAttachNum}`  
PUT body: any of the fields above

---

## 56. Claim Condition Code Logs

One row per claim; stores condition codes 18-28 (UB04).

### 56.1 List
`GET /dental-software/claimcondcodelog`

### 56.2 Create
`POST /dental-software/claimcondcodelog`

**Body (required):**
```json
{ "ClaimNum": 5001 }
```
Optional: `Code0`..`Code10` (each max length 2)

### 56.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/claimcondcodelog/{ClaimCondCodeLogNum}`  
PUT body: any of the fields above

---

## 57. Claim Forms

Claim form definitions and print settings.

### 57.1 List
`GET /dental-software/claimform`

### 57.2 Create
`POST /dental-software/claimform`

**Body (required):**
```json
{ "Description": "ADA2002" }
```
Optional: `IsHidden`, `FontName`, `FontSize`, `UniqueID`, `PrintImages`, `OffsetX`, `OffsetY`, `Width`, `Height`

### 57.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/claimform/{ClaimFormNum}`  
PUT body: any of the fields above

---

## 58. Claim Form Items

Individual field/layout items for a claim form.

### 58.1 List
`GET /dental-software/claimformitem`

### 58.2 Create
`POST /dental-software/claimformitem`

**Body (required):**
```json
{ "ClaimFormNum": 10, "FieldName": "PatientName" }
```
Optional: `ImageFileName`, `FormatString`, `XPos`, `YPos`, `Width`, `Height`

### 58.3 Get / Update / Delete
`GET|PUT|DELETE /dental-software/claimformitem/{ClaimFormItemNum}`  
PUT body: any of the fields above

---

## 59. Error Responses

| Status | Error Pattern | Notes |
|--------|---------------|-------|
| 400 | validation errors, bad enum/range, missing required fields, FK violations | Check message for field name |
| 403 | HQ categories cannot be edited/deleted (alertcategory, alertcategorylink) | |
| 404 | not found | Returned when entity ID does not exist |
| 409 | uniqueness conflict (e.g., duplicate UserName) | |
| 500 | internal server error | Unexpected exceptions |

All error responses include `{ success: false, error: string, message?: string }`.

