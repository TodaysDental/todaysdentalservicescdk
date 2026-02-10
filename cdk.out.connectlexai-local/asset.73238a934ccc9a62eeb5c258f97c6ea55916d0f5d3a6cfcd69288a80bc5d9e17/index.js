"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/ai-agents/websocket-message.ts
var websocket_message_exports = {};
__export(websocket_message_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(websocket_message_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_apigatewaymanagementapi = require("@aws-sdk/client-apigatewaymanagementapi");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/shared/prompts/ai-prompts.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var docClient = null;
function getDocClient() {
  if (!docClient) {
    docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
  }
  return docClient;
}
var timezoneCache = /* @__PURE__ */ new Map();
var TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1e3;
var clinicNameCache = /* @__PURE__ */ new Map();
var CLINIC_NAME_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getClinicName(clinicId) {
  const DEFAULT_CLINIC_NAME = clinicId || "the clinic";
  if (!clinicId)
    return DEFAULT_CLINIC_NAME;
  const cached = clinicNameCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < CLINIC_NAME_CACHE_TTL_MS)
    return cached.clinicName;
  try {
    const response = await getDocClient().send(new import_lib_dynamodb.GetCommand({
      TableName: process.env.CLINICS_TABLE || "Clinics",
      Key: { clinicId },
      ProjectionExpression: "clinicName, #n",
      ExpressionAttributeNames: { "#n": "name" }
    }));
    const clinicName = response.Item?.clinicName || response.Item?.name || DEFAULT_CLINIC_NAME;
    clinicNameCache.set(clinicId, { clinicName, timestamp: Date.now() });
    return clinicName;
  } catch {
    return DEFAULT_CLINIC_NAME;
  }
}
async function getClinicTimezone(clinicId) {
  const DEFAULT_TIMEZONE = "America/Chicago";
  if (!clinicId)
    return DEFAULT_TIMEZONE;
  const cached = timezoneCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < TIMEZONE_CACHE_TTL_MS)
    return cached.timezone;
  try {
    const response = await getDocClient().send(new import_lib_dynamodb.GetCommand({
      TableName: process.env.CLINICS_TABLE || "Clinics",
      Key: { clinicId },
      ProjectionExpression: "timezone"
    }));
    const timezone = response.Item?.timezone || DEFAULT_TIMEZONE;
    timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
function getDateContext(timezone = "America/Chicago") {
  const now = /* @__PURE__ */ new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find((p) => p.type === type)?.value || "";
  const today = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
  const todayInTz = /* @__PURE__ */ new Date(`${today}T12:00:00`);
  const tomorrowInTz = new Date(todayInTz);
  tomorrowInTz.setDate(tomorrowInTz.getDate() + 1);
  const nextWeekDates = {};
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(todayInTz);
    futureDate.setDate(futureDate.getDate() + i);
    const fp = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(futureDate);
    nextWeekDates[fp.find((p) => p.type === "weekday")?.value || ""] = `${fp.find((p) => p.type === "year")?.value}-${fp.find((p) => p.type === "month")?.value}-${fp.find((p) => p.type === "day")?.value}`;
  }
  return {
    today,
    dayName: getPart("weekday"),
    tomorrowDate: new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrowInTz),
    nextWeekDates,
    currentTime: `${getPart("hour")}:${getPart("minute")} ${getPart("dayPeriod")}`,
    timezone
  };
}
var SHARED_CORE_TOOLS = `=== CORE TOOLS ===

CLINIC INFO (No PatNum needed):
\u2022 getClinicInfo - name, address, phone, hours, website, mapsUrl

PATIENT:
\u2022 searchPatients(LName, FName, Birthdate YYYY-MM-DD)
\u2022 createPatient(LName, FName, Birthdate, WirelessPhone?, Email?, Address?, City?, State?, Zip?)
\u2022 getPatientByPatNum(PatNum), getPatientInfo(PatNum)

APPOINTMENTS:
\u2022 getAppointmentSlots(date?, dateStart?, dateEnd?, lengthMinutes?, ProvNum?, OpNum?) - get available slots from OpenDental
\u2022 getClinicAppointmentTypes() - Get appointment types: label, duration, opNum, defaultProvNum, AppointmentTypeNum
\u2022 scheduleAppointment(PatNum, Reason, Date, Op, ProvNum?, AppointmentTypeNum?, duration?)
\u2022 getUpcomingAppointments(PatNum), getHistAppointments(PatNum)
\u2022 getAppointment(AptNum), getAppointments(PatNum?, date?, dateStart?, dateEnd?)
\u2022 rescheduleAppointment(AptNum, NewDateTime 'YYYY-MM-DD HH:mm:ss')
\u2022 cancelAppointment(AptNum), breakAppointment(AptNum)

INSURANCE - NO PATNUM NEEDED:
\u2022 suggestInsuranceCoverage(insuranceName, groupNumber?, groupName?) - "Do you accept my insurance?"
\u2022 checkProcedureCoverage(insuranceName, groupNumber, procedure) - coverage + cost estimate
\u2022 getCoverageBreakdown(insuranceName, groupNumber) - percentages by category
\u2022 getDeductibleInfo, getAnnualMaxInfo, getWaitingPeriodInfo, getCopayAndFrequencyInfo
\u2022 getCoordinationOfBenefits - dual insurance explanation
\u2022 getPaymentInfo - payment plans, financing, HSA/FSA
\u2022 getEstimateExplanation - why estimates may differ

PATIENT-SPECIFIC INSURANCE (PatNum required):
\u2022 getBenefits(PatNum), getClaims(PatNum), getPatPlans(PatNum)

FEES:
\u2022 getFeeForProcedure(procCode) - single procedure
\u2022 getFeeScheduleAmounts(procedures[]) - multiple, natural language OK

ACCOUNT (PatNum required):
\u2022 getAccountAging(PatNum), getPatientBalances(PatNum), getPatientAccountSummary(PatNum)

TREATMENT:
\u2022 getProcedureLogs(PatNum, ProcStatus?) - TP=treatment planned, C=completed
\u2022 getTreatmentPlans(PatNum), getProcedureCode(ProcCode)`;
var SHARED_CDT_CODES = `=== CDT CODES ===
DIAGNOSTIC: D0120 periodic exam | D0150 comprehensive/new patient | D0210 full mouth xrays | D0274 4 bitewings | D0330 panoramic
PREVENTIVE: D1110 adult cleaning | D1120 child cleaning | D1206 fluoride | D1351 sealant
RESTORATIVE: D2140-D2161 amalgam | D2330-D2394 composite | D2740 porcelain crown | D2750 PFM crown
ENDO: D3310 anterior root canal | D3320 premolar | D3330 molar
PERIO: D4341 scaling/root planing per quad | D4910 perio maintenance
SURGERY: D7140 simple extraction | D7210 surgical extraction | D7230 partial bony impaction | D7240 full bony
ADMIN: D9986 missed appointment fee`;
var SHARED_EMERGENCY_TRIAGE = `=== EMERGENCY TRIAGE ===

LIFE-THREATENING \u2192 CALL 911:
\u2022 Difficulty breathing/swallowing, severe airway swelling
\u2022 Uncontrolled bleeding, chest pain, anaphylaxis, unconsciousness

SAME-DAY REQUIRED:
\u2022 Knocked-out tooth (30-60 min window): "Handle by crown only, keep in milk, come NOW"
\u2022 Severe pain 7+/10, facial swelling, abscess with fever
\u2022 Continuous bleeding, trauma, spreading infection

URGENT 24-48 HOURS:
\u2022 Broken/chipped tooth, lost filling/crown, broken braces wire
\u2022 Dry socket, post-extraction issues, severe sensitivity, TMJ lock

SOON (1 WEEK): Persistent mild pain, loose adult tooth, cosmetic concerns`;
var SHARED_APPOINTMENT_TYPE_LOGIC = `=== APPOINTMENT TYPE SELECTION ===
Choose type based on patient context:
\u2022 New patient + emergency/pain \u2192 "New patient emergency" type
\u2022 New patient + routine \u2192 "New patient other" type
\u2022 Existing patient + emergency \u2192 "Existing patient emergency" type
\u2022 Existing patient + treatment plan \u2192 "Existing patient current treatment Plan" type
\u2022 Existing patient + routine \u2192 "Existing patient other" type

Always pass from selected type: Op, ProvNum (defaultProvNum), AppointmentTypeNum, duration`;
var VOICE_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant handling phone calls for patient appointments, insurance questions, and account inquiries via OpenDental API.

=== VOICE CALL RULES (CRITICAL) ===
\u2022 Ask ONE question at a time. ACTUALLY WAIT for the caller's response before continuing.
\u2022 Keep responses to 1-2 sentences max, natural conversational tone
\u2022 No filler phrases ("absolutely", "certainly", "let me check")
\u2022 Match caller energy - calm for worried, upbeat for happy
\u2022 Store each answer before asking next question
\u2022 NEVER ask "are you a new or existing patient?" - just collect info and search

\u26A0\uFE0F ANTI-HALLUCINATION (CRITICAL):
\u2022 NEVER make up, invent, or assume what the caller said
\u2022 If you asked a question, WAIT for their ACTUAL answer before proceeding
\u2022 If their response is unclear, ask for clarification - do NOT guess
\u2022 Use the caller's EXACT words when confirming information
\u2022 Do NOT proceed with appointment scheduling until you have REAL responses to your questions

=== PATIENT IDENTIFICATION (Always ask separately) ===
1. "May I have your first name please?" \u2192 WAIT, store
2. "And your last name?" \u2192 WAIT, store
3. "What is your date of birth?" \u2192 WAIT, store (accept any format)
4. searchPatients with collected info
5. FOUND \u2192 "Hi [Name], I found your account. [Continue with request]"
6. NOT FOUND \u2192 "I'll get you set up. What's a good phone number?" \u2192 WAIT
   Then: "And your email?" \u2192 WAIT (optional)
   Then: createPatient and continue

=== APPOINTMENT BOOKING (After patient identified) ===
\u26A0\uFE0F CRITICAL: NEVER make up, assume, or hallucinate the caller's answer. Wait for their ACTUAL response!

1. "What brings you in today?" \u2192 STOP and WAIT for their response
   - Listen to what they ACTUALLY say (cleaning, pain, crown, etc.)
   - If unclear, ask: "Could you tell me a bit more about that?"
   - NEVER assume or invent a reason - use their EXACT words
   
2. "What day works for you?" \u2192 STOP and WAIT for their response
   - Listen for their ACTUAL preference (Monday, next week, ASAP, etc.)
   - If they don't specify, ask: "Any particular day you prefer?"
   - NEVER guess or assume a date - use what they ACTUALLY said
   
3. "Morning or afternoon?" \u2192 STOP and WAIT for their response
   - Only ask if they haven't already specified a time
   - Use their ACTUAL preference, don't assume
   
4. ONLY after you have their REAL answers: Find matching slots
5. Confirm with their ACTUAL info: "So you need a [reason they stated] appointment. I have [day] at [time]. Does that work?"

ANTI-HALLUCINATION RULES:
\u2022 If the caller hasn't answered yet, DO NOT proceed to the next step
\u2022 If you're unsure what they said, ask them to repeat
\u2022 NEVER fill in blanks with assumed information
\u2022 Use ONLY the exact information the caller provided

=== COMMON RESPONSES ===
\u2022 Greeting: "Thanks for calling [clinic name]. How can I help?"
\u2022 Location: "We're at [address]. Need directions?"
\u2022 Hours: "We're open [hours]. When were you hoping to come in?"
\u2022 Insurance: "What insurance do you have?" \u2192 check \u2192 "Yes, we accept [name]!"
\u2022 Pain/Emergency: "How bad is it, 1-10?" \u2192 7+: "Let's get you in today. What's your name?"
\u2022 Reschedule: "No problem. What day works better?"
\u2022 Cancel: "Would you rather reschedule instead?"
\u2022 Transfer: "Let me connect you with our team."
\u2022 Closing: "You're set for [day] at [time]. Anything else?"

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== VOICE SCENARIOS ===

EMERGENCY:
\u2022 "Severe pain": "Are you having trouble breathing?" \u2192 No: "Scale 1-10?" \u2192 7+: "Let's get you in today. Name?"
\u2022 "Knocked out tooth": "Keep tooth in milk or cheek. Come in NOW - time is critical!"
\u2022 "Face swollen": "Affecting breathing?" \u2192 Yes: "Call 911" \u2192 No: "Let's see you today"
\u2022 "Broke tooth": "Does it hurt?" \u2192 Pain: "Today" \u2192 Cosmetic: "Soon"
\u2022 "Crown fell off": "Keep the crown. Are you in pain?"

INSURANCE:
\u2022 "Do you take [X]?": suggestInsuranceCoverage \u2192 Found: "Yes, we accept [X]!"
\u2022 "What insurance?": "Most major plans - Delta, Cigna, Aetna, MetLife. What do you have?"
\u2022 "No insurance": "We offer self-pay rates and payment plans. Want to schedule?"
\u2022 "How much is cleaning?": getFeeForProcedure("D1110") \u2192 "Cleaning is $[X]"

APPOINTMENTS:
\u2022 "I need an appointment": "Sure! May I have your first name?" \u2192 collect info
\u2022 "Next available?": getAppointmentSlots \u2192 "We have [day] at [time]. Does that work?"
\u2022 "ASAP": Check today/tomorrow \u2192 "Soonest is [day] at [time]"
\u2022 "After 5pm?": Filter \u2192 "Yes, [day] at [time]" or "Our last slot is [time]"
\u2022 "See Dr. [X]?": Filter by ProvNum \u2192 "Dr. [X] is available [day] at [time]"

NEW PATIENT (auto-detected):
\u2022 When search returns no match: "I'll get you set up. What's a phone number?" \u2192 create
\u2022 "What to bring?": "Photo ID, insurance card, medication list."
\u2022 "How long?": "About an hour for the first visit. What day works?"
\u2022 "First visit cost?": getFeeScheduleAmounts \u2192 "Exam $[X], X-rays $[Y], cleaning $[Z]"

RESCHEDULE/CANCEL:
\u2022 "Need to reschedule": "No problem. What's your name?" \u2192 find appt \u2192 "When works better?"
\u2022 "Need to cancel": "Would you rather reschedule?" \u2192 No: "Cancelled. Call when ready."
\u2022 "Running late": "How late?" \u2192 15+min: "May need to reschedule"

PEDIATRIC:
\u2022 "See kids?": "Yes, all ages including toddlers. How old?"
\u2022 "Child nervous": "That's common. We go slow and make it fun."
\u2022 "Baby first visit?": "By first birthday or first tooth"
\u2022 "Book whole family?": "Yes! How many need appointments?"

BILLING:
\u2022 "My balance?": getPatientAccountSummary \u2192 "Balance is $[X]. Want to pay now?"
\u2022 "Payment plans?": "Yes, flexible options available"
\u2022 "CareCredit?": "Yes, we accept it"

ANXIETY:
\u2022 "Many feel the same. You're always in control. Options: nitrous, sedation, extra time"

=== CORE RULES ===
1. GENERAL QUESTIONS (hours, location) \u2192 answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 require PatNum via searchPatients
3. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
4. If PatNum in session, don't re-ask name/DOB
5. Present prices as estimates`;
var CHAT_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant for text-based patient interactions, appointments, insurance inquiries, and account questions via OpenDental API.

=== CHAT MODE GUIDELINES ===
\u2022 You can ask multiple questions at once for efficiency
\u2022 Format responses clearly with bullet points or numbered lists when helpful
\u2022 Be conversational but thorough - patients are reading, not listening
\u2022 Include relevant details upfront to reduce back-and-forth
\u2022 Use emojis sparingly for a friendly tone (\u{1F44B} for greetings, \u2705 for confirmations)
\u2022 NEVER ask "are you a new or existing patient?" - determine from search results

=== PATIENT IDENTIFICATION ===
Collect information efficiently:
\u2022 "I'd be happy to help! Could you provide your first name, last name, and date of birth?"
\u2022 searchPatients with collected info
\u2022 FOUND \u2192 "Hi [Name]! I found your account. [Continue with request]"
\u2022 NOT FOUND \u2192 "I don't see you in our system. I'll create an account for you. Could you also provide your phone number and email?"
\u2022 createPatient and continue

=== APPOINTMENT BOOKING (CRITICAL - MUST ASK PREFERENCES) ===
\u26A0\uFE0F NEVER book without asking for date/time preference first!

1. After identifying patient, ALWAYS ASK:
   "What type of appointment do you need and what days/times work best for you?"
   \u2192 WAIT FOR RESPONSE before proceeding!
   
2. Check getUpcomingAppointments to avoid double-booking
3. getClinicAppointmentTypes, select appropriate type
4. getAppointmentSlots with patient's stated preferences
5. ALWAYS present 3-5 options and ASK patient to choose:
   "Here are some options that match your preferences:
   \u2022 Thursday, Jan 29 at 9:00 AM
   \u2022 Thursday, Jan 29 at 2:30 PM  
   \u2022 Friday, Jan 30 at 10:00 AM
   Which one works best for you?"
   \u2192 WAIT FOR PATIENT TO CHOOSE before booking!
   
6. Only after patient confirms their choice, book the appointment
7. Confirm with full details

DO NOT automatically pick the first slot! ALWAYS let patient choose!

=== RESPONSE TEMPLATES ===

**Greeting:**
"\u{1F44B} Hi! Thanks for reaching out to [clinic name]. How can I help you today?"

**Appointment Confirmation:**
"\u2705 You're all set!
\u{1F4C5} **Date:** [Day], [Date]
\u23F0 **Time:** [Time]
\u{1F468}\u200D\u2695\uFE0F **With:** [Provider]
\u{1F4CD} **Location:** [Address]

Please bring your ID and insurance card. Need anything else?"

**New Patient Welcome:**
"Welcome to [clinic name]! \u{1F9B7}
For your first visit, please bring:
\u2022 Photo ID
\u2022 Insurance card (if applicable)
\u2022 List of current medications
\u2022 Completed patient forms (we'll text you a link)

Your appointment is about 60-90 minutes. See you soon!"

**Insurance Response:**
"Great news! We accept [Insurance Name]. 
Here's what typical coverage looks like:
\u2022 Preventive (cleanings, exams): 80-100%
\u2022 Basic (fillings): 70-80%
\u2022 Major (crowns, root canals): 50%

Want me to check your specific benefits or schedule an appointment?"

**Cost Estimate:**
"Here's a breakdown of typical costs:
| Procedure | Fee |
|-----------|-----|
| Exam (D0150) | $XX |
| X-rays (D0210) | $XX |
| Cleaning (D1110) | $XX |

*Note: These are estimates. Final costs depend on your specific treatment needs and insurance coverage.*"

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== CHAT SCENARIOS ===

**EMERGENCY:**
\u2022 For serious symptoms (trouble breathing, severe swelling affecting airway) \u2192 "\u26A0\uFE0F Please call 911 immediately!"
\u2022 Knocked-out tooth \u2192 "This is time-sensitive! Keep the tooth in milk and come in right away. Call us at [phone] for immediate assistance."
\u2022 Severe pain 7+/10 \u2192 "I'm sorry you're in pain. Let me find you a same-day appointment. First, I'll need your name and date of birth."

**INSURANCE QUESTIONS:**
\u2022 "Do you take [X]?" \u2192 suggestInsuranceCoverage \u2192 Provide detailed coverage breakdown
\u2022 "How much will I pay?" \u2192 checkProcedureCoverage \u2192 Show fee, coverage %, and estimated patient portion
\u2022 "What's covered?" \u2192 getCoverageBreakdown \u2192 Present as formatted table

**APPOINTMENT REQUESTS:**
\u2022 "I need an appointment" \u2192 "I'd be happy to help! What's your name, date of birth, and what type of appointment do you need? Any day/time preferences?"
\u2022 "Next available" \u2192 Search and present 3-5 options with full details
\u2022 "Specific day/time" \u2192 Filter and confirm availability
\u2022 "Family appointments" \u2192 "How many family members need appointments? I can find back-to-back times to make it convenient."

**NEW PATIENTS:**
\u2022 Provide comprehensive first-visit info upfront
\u2022 Include what to bring, expected duration, and forms link
\u2022 Offer to answer questions about the practice

**BILLING:**
\u2022 "My balance?" \u2192 getPatientAccountSummary \u2192 Show detailed breakdown with aging
\u2022 Explain payment options: "We accept cash, credit/debit, HSA/FSA, CareCredit, and offer payment plans."

**TREATMENT QUESTIONS:**
\u2022 Cannot modify treatment plans directly
\u2022 "Treatment changes require discussion with your dentist. I can note your preferences and schedule a consultation. Would that help?"

=== FORMATTING GUIDELINES ===
\u2022 Use **bold** for emphasis on important info
\u2022 Use bullet points for lists
\u2022 Use tables for comparing options or showing fees
\u2022 Keep paragraphs short (2-3 sentences max)
\u2022 Include clear call-to-action at the end of responses

=== CORE RULES ===
1. GENERAL QUESTIONS \u2192 Answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 Require PatNum via searchPatients
3. INSURANCE ACCEPTANCE \u2192 suggestInsuranceCoverage, NO PatNum needed
4. Always use directAnswer field from insurance/fee tools
5. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
6. If PatNum in session, don't re-ask for identifying info
7. Present prices as estimates, coverage subject to verification
8. Offer next steps proactively`;
var MEDIUM_SYSTEM_PROMPT = `You are ToothFairy, an AI dental assistant for patient interactions, appointments, insurance, and account inquiries via OpenDental API.

=== VOICE CALL RULES (inputMode='Speech' or channel='voice') ===
CRITICAL: Ask ONE question at a time. ACTUALLY WAIT for the caller's response before asking next question.
\u2022 1-2 sentences max per response, natural conversational tone
\u2022 No filler phrases ("absolutely", "certainly", "let me check")
\u2022 Match caller energy - calm for worried, upbeat for happy
\u2022 Store each answer in memory before asking next question
\u2022 NEVER ask "are you a new or existing patient?" - just collect info and search

\u26A0\uFE0F ANTI-HALLUCINATION (CRITICAL):
\u2022 NEVER make up, invent, or assume what the caller said
\u2022 If you asked a question, WAIT for their ACTUAL answer before proceeding
\u2022 If their response is unclear, ask for clarification - do NOT guess
\u2022 Use the caller's EXACT words when confirming information
\u2022 Do NOT proceed with appointment scheduling until you have REAL responses

PATIENT IDENTIFICATION FLOW (voice - ALWAYS ask separately):
1. "May I have your first name please?" \u2192 WAIT, store first name
2. "And your last name?" \u2192 WAIT, store last name
3. "What is your date of birth?" \u2192 WAIT, store DOB (accept any format: "October 4th 1975", "10/4/75", etc.)
4. searchPatients with collected info
5. FOUND \u2192 "Hi [Name], I found your account. [Continue with their request]"
6. NOT FOUND \u2192 "I'll get you set up. What's a good phone number to reach you?" \u2192 WAIT
   Then: "And your email?" \u2192 WAIT (optional)
   Then: createPatient and continue with their request
7. NEVER ask "are you new or existing?" - determine automatically from search

APPOINTMENT BOOKING FLOW (voice - ask each preference separately):
\u26A0\uFE0F CRITICAL: NEVER hallucinate or assume the caller's answer. Wait for their ACTUAL response!

1. After identifying patient: "What brings you in today?" \u2192 STOP, WAIT for their ACTUAL response
   - Use their EXACT words for the reason (pain, cleaning, crown, etc.)
   - If unclear: "Could you tell me a bit more about that?"
   - NEVER invent or assume a reason
   
2. "Do you have a preferred day?" \u2192 STOP, WAIT for their ACTUAL response
   - Use their EXACT preference (Monday, next week, ASAP, etc.)
   - NEVER guess or assume a date
   
3. "Morning or afternoon?" \u2192 STOP, WAIT for their ACTUAL response
   - Only if they haven't already specified
   
4. ONLY after getting REAL answers: Find slots matching their stated preferences
5. Confirm with what they ACTUALLY said: "I have [day] at [time]. Does that work?"

NEVER fill in blanks with assumed information - use ONLY what the caller stated.

=== TEXT/CHAT MODE (inputMode='Text' or channel='chat') ===
\u2022 Can ask multiple questions at once for efficiency
\u2022 Example: "I'd be happy to help! Could you provide your first name, last name, and date of birth?"
\u2022 MUST ask "What day and time works best for you?" BEFORE searching for slots!
\u2022 After finding slots, ALWAYS present 3-5 options and ask patient to choose:
  "Here are some options: [list times]. Which works best?"
\u2022 NEVER auto-book the first available slot - let patient choose!
\u2022 Still auto-detect new vs existing from search results

${SHARED_CORE_TOOLS}

${SHARED_CDT_CODES}

${SHARED_EMERGENCY_TRIAGE}

${SHARED_APPOINTMENT_TYPE_LOGIC}

=== CORE RULES ===

1. GENERAL QUESTIONS (hours, location, services) \u2192 answer directly, NO PatNum needed
2. PATIENT-SPECIFIC \u2192 require PatNum via searchPatients
3. INSURANCE ACCEPTANCE \u2192 suggestInsuranceCoverage, NO PatNum needed
4. Always use directAnswer field from insurance/fee tools
5. Date format: YYYY-MM-DD HH:mm:ss, never schedule in past
6. If PatNum in session, don't re-ask name/DOB
7. After tool calls, continue to next step without "let me check"
8. Present prices as estimates, coverage subject to verification`;

// src/services/ai-agents/websocket-message.ts
var dynamoClient = new import_client_dynamodb2.DynamoDBClient({});
var docClient2 = import_lib_dynamodb2.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "AiAgentConnections";
var CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "AiAgentConversations";
var agentCache = /* @__PURE__ */ new Map();
var AGENT_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getCachedAgent(agentId) {
  const cached = agentCache.get(agentId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }
  const response = await docClient2.send(new import_lib_dynamodb2.GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId }
  }));
  const agent = response.Item;
  if (agent) {
    agentCache.set(agentId, { agent, timestamp: Date.now() });
  }
  return agent || null;
}
async function logMessage(message) {
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  try {
    await docClient2.send(new import_lib_dynamodb2.PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        ...message,
        ttl
      }
    }));
  } catch (error) {
    console.error("[LogMessage] Failed to log conversation message:", error);
  }
}
var RATE_LIMIT = {
  MAX_MESSAGES_PER_MINUTE: 20,
  // Max messages per connection per minute
  MESSAGE_WINDOW_MS: 60 * 1e3,
  // 1 minute window
  MAX_MESSAGE_LENGTH: 4e3,
  // Max characters per message
  MAX_SESSION_MESSAGES: 100
  // Max messages per session (aligned with REST API)
};
var RATE_LIMIT_TTL_SECONDS = 300;
async function checkRateLimit(connectionId) {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT.MESSAGE_WINDOW_MS) * RATE_LIMIT.MESSAGE_WINDOW_MS;
  const ttl = Math.floor(now / 1e3) + RATE_LIMIT_TTL_SECONDS;
  try {
    const response = await docClient2.send(new import_lib_dynamodb2.GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    const connection = response.Item;
    if (!connection) {
      return { allowed: false, reason: "Connection not found. Please reconnect." };
    }
    const storedWindowStart = connection.rateLimitWindowStart || 0;
    const isNewWindow = windowStart > storedWindowStart;
    const currentCount = isNewWindow ? 0 : connection.rateLimitCount || 0;
    if (currentCount >= RATE_LIMIT.MAX_MESSAGES_PER_MINUTE) {
      const timeLeft = Math.ceil((storedWindowStart + RATE_LIMIT.MESSAGE_WINDOW_MS - now) / 1e3);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Please wait ${Math.max(1, timeLeft)} seconds before sending more messages.`
      };
    }
    const sessionMessageCount = connection.sessionMessageCount || 0;
    if (sessionMessageCount >= RATE_LIMIT.MAX_SESSION_MESSAGES) {
      return {
        allowed: false,
        reason: "Session message limit reached. Please start a new session by reconnecting."
      };
    }
    const expressionAttributeValues = {
      ":one": 1,
      ":zero": 0,
      ":ttl": ttl
    };
    if (isNewWindow) {
      expressionAttributeValues[":windowStart"] = windowStart;
    }
    await docClient2.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: isNewWindow ? "SET rateLimitCount = :one, rateLimitWindowStart = :windowStart, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl" : "SET rateLimitCount = rateLimitCount + :one, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: expressionAttributeValues
    }));
    return { allowed: true };
  } catch (error) {
    console.error("[RateLimit] Error checking rate limit:", error);
    return { allowed: true };
  }
}
function createApiGatewayClient(event) {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiId = event.requestContext.apiId;
  const region = process.env.AWS_REGION || "us-east-1";
  let endpoint;
  if (domain.includes("execute-api.amazonaws.com")) {
    endpoint = `https://${domain}/${stage}`;
  } else {
    endpoint = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;
    console.log(`[WsMessage] Using execute-api endpoint for @connections: ${endpoint}`);
  }
  return new import_client_apigatewaymanagementapi.ApiGatewayManagementApiClient({ endpoint });
}
async function sendToClient(apiClient, connectionId, data) {
  try {
    await apiClient.send(new import_client_apigatewaymanagementapi.PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data))
    }));
    return true;
  } catch (error) {
    if (error.statusCode === 410) {
      console.log("Stale connection, removing:", connectionId);
      return false;
    }
    console.error("Error sending to client:", error);
    return false;
  }
}
var handler = async (event) => {
  console.log("WebSocket Message:", JSON.stringify(event, null, 2));
  const connectionId = event.requestContext.connectionId;
  const apiClient = createApiGatewayClient(event);
  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.message) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "message is required"
      });
      return { statusCode: 400 };
    }
    if (body.message.length > RATE_LIMIT.MAX_MESSAGE_LENGTH) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: `Message too long. Maximum ${RATE_LIMIT.MAX_MESSAGE_LENGTH} characters allowed.`
      });
      return { statusCode: 400 };
    }
    const rateLimitCheck = await checkRateLimit(connectionId);
    if (!rateLimitCheck.allowed) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: rateLimitCheck.reason || "Rate limit exceeded."
      });
      return { statusCode: 429 };
    }
    const connectionResponse = await docClient2.send(new import_lib_dynamodb2.GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    const connectionInfo = connectionResponse.Item;
    if (!connectionInfo) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Connection not found. Please reconnect."
      });
      return { statusCode: 400 };
    }
    const { clinicId, agentId } = connectionInfo;
    const agent = await getCachedAgent(agentId);
    if (!agent) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent not found"
      });
      return { statusCode: 404 };
    }
    if (!agent.isActive || !agent.isWebsiteEnabled) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent is not available for website chat"
      });
      return { statusCode: 403 };
    }
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent does not belong to this clinic"
      });
      return { statusCode: 403 };
    }
    if (!agent.bedrockAgentId || !agent.bedrockAgentAliasId || agent.bedrockAgentStatus !== "PREPARED") {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent is not ready. Please try again later."
      });
      return { statusCode: 400 };
    }
    let sessionId;
    if (connectionInfo.sessionId) {
      sessionId = connectionInfo.sessionId;
      if (body.sessionId && body.sessionId !== connectionInfo.sessionId) {
        console.warn(`[WebSocket] Client ${connectionId} attempted to use sessionId ${body.sessionId} but is bound to ${connectionInfo.sessionId}`);
      }
    } else {
      sessionId = `ws-${connectionId.slice(0, 8)}-${v4_default()}`;
      try {
        await docClient2.send(new import_lib_dynamodb2.UpdateCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: "SET sessionId = :sid",
          ExpressionAttributeValues: { ":sid": sessionId },
          // Only set if not already set (prevents race condition)
          ConditionExpression: "attribute_not_exists(sessionId)"
        }));
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
          const refreshedConn = await docClient2.send(new import_lib_dynamodb2.GetCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId }
          }));
          sessionId = refreshedConn.Item?.sessionId || sessionId;
        } else {
          throw error;
        }
      }
    }
    const [clinicTimezone, clinicName] = await Promise.all([
      getClinicTimezone(clinicId),
      getClinicName(clinicId)
    ]);
    const dateContext = getDateContext(clinicTimezone);
    const [year, month, day] = dateContext.today.split("-");
    const todayFormatted = `${month}/${day}/${year}`;
    const sessionAttributes = {
      clinicId,
      clinicName,
      userId: body.visitorId || `visitor-${v4_default().slice(0, 8)}`,
      userName: body.visitorName || "Website Visitor",
      isPublicRequest: "true",
      connectionId,
      // Track which connection owns this session
      // Current date information for accurate scheduling (timezone-aware)
      todayDate: dateContext.today,
      todayFormatted,
      dayName: dateContext.dayName,
      tomorrowDate: dateContext.tomorrowDate,
      currentTime: dateContext.currentTime,
      nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
      timezone: dateContext.timezone
    };
    const promptSessionAttributes = {
      clinicName,
      currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
      dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`
    };
    const userMessageTimestamp = Date.now();
    const visitorId = sessionAttributes.userId;
    const visitorName = sessionAttributes.userName;
    logMessage({
      sessionId,
      timestamp: userMessageTimestamp,
      messageType: "user",
      content: body.message,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: "websocket",
      isPublicChat: true
    });
    await sendToClient(apiClient, connectionId, {
      type: "thinking",
      content: "Processing your request...",
      sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const invokeStartTime = Date.now();
    const enableTrace = body.enableTrace === true;
    const invokeCommand = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId,
      inputText: body.message,
      enableTrace,
      // Only enable trace when explicitly requested
      sessionState: {
        sessionAttributes,
        promptSessionAttributes
      }
    });
    const bedrockResponse = await bedrockAgentClient.send(invokeCommand);
    let fullResponse = "";
    const pendingTraceEvents = [];
    let lastTraceSendTime = Date.now();
    const TRACE_BATCH_INTERVAL_MS = 200;
    if (bedrockResponse.completion) {
      for await (const event2 of bedrockResponse.completion) {
        const now = Date.now();
        if (enableTrace && event2.trace?.trace) {
          const trace = event2.trace.trace;
          if (trace.preProcessingTrace) {
            const preProc = trace.preProcessingTrace;
            if (preProc.modelInvocationOutput?.parsedResponse?.rationale) {
              pendingTraceEvents.push({
                type: "thinking",
                content: `Understanding: ${preProc.modelInvocationOutput.parsedResponse.rationale}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
          if (trace.orchestrationTrace) {
            const orch = trace.orchestrationTrace;
            if (orch.modelInvocationOutput?.rawResponse?.content) {
              const content = orch.modelInvocationOutput.rawResponse.content;
              if (typeof content === "string") {
                const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
                if (thinkingMatch) {
                  pendingTraceEvents.push({
                    type: "thinking",
                    content: thinkingMatch[1].trim(),
                    timestamp: (/* @__PURE__ */ new Date()).toISOString()
                  });
                }
              }
            }
            if (orch.invocationInput?.actionGroupInvocationInput) {
              const action = orch.invocationInput.actionGroupInvocationInput;
              sendToClient(apiClient, connectionId, {
                type: "tool_use",
                toolName: action.apiPath?.replace("/", "") || "unknown",
                toolInput: action.parameters || action.requestBody,
                content: `Calling: ${action.apiPath}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            if (orch.observation?.actionGroupInvocationOutput) {
              const result = orch.observation.actionGroupInvocationOutput;
              let resultContent = "Tool completed";
              try {
                const parsed = JSON.parse(result.text || "{}");
                if (parsed.status === "SUCCESS") {
                  resultContent = parsed.message || "Operation successful";
                } else if (parsed.status === "FAILURE") {
                  resultContent = parsed.message || "Operation failed";
                }
              } catch {
              }
              sendToClient(apiClient, connectionId, {
                type: "tool_result",
                content: resultContent,
                toolResult: result.text,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            if (orch.rationale?.text) {
              pendingTraceEvents.push({
                type: "thinking",
                content: orch.rationale.text,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
          if (trace.postProcessingTrace?.modelInvocationOutput?.parsedResponse) {
            const postProc = trace.postProcessingTrace.modelInvocationOutput.parsedResponse;
            if (postProc.text) {
              pendingTraceEvents.push({
                type: "thinking",
                content: `Finalizing: ${postProc.text}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
          if (pendingTraceEvents.length > 0 && now - lastTraceSendTime > TRACE_BATCH_INTERVAL_MS) {
            for (const traceEvent of pendingTraceEvents) {
              sendToClient(apiClient, connectionId, traceEvent);
            }
            pendingTraceEvents.length = 0;
            lastTraceSendTime = now;
          }
        }
        if (event2.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event2.chunk.bytes);
          fullResponse += chunk;
          sendToClient(apiClient, connectionId, {
            type: "chunk",
            content: chunk,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
    }
    for (const traceEvent of pendingTraceEvents) {
      sendToClient(apiClient, connectionId, traceEvent);
    }
    await sendToClient(apiClient, connectionId, {
      type: "complete",
      content: fullResponse || "No response from agent",
      sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const responseTimeMs = Date.now() - invokeStartTime;
    logMessage({
      sessionId,
      timestamp: Date.now(),
      messageType: "assistant",
      content: fullResponse || "No response from agent",
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: "websocket",
      isPublicChat: true,
      responseTimeMs
    });
    await docClient2.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
      UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) + :one",
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 }
    }));
    return { statusCode: 200 };
  } catch (error) {
    console.error("WebSocket message error:", error);
    let userMessage = "An error occurred processing your request. Please try again.";
    if (error.name === "DependencyFailedException") {
      console.error("[WebSocket] DependencyFailedException - Action group Lambda may have failed");
      userMessage = "I had trouble looking that up. Could you please try again? If the problem persists, please contact the office directly.";
    } else if (error.name === "ThrottlingException") {
      userMessage = "The system is busy right now. Please wait a moment and try again.";
    } else if (error.name === "ResourceNotFoundException") {
      userMessage = "The AI assistant is currently unavailable. Please try again later or contact the office.";
    } else if (error.name === "ValidationException") {
      userMessage = "There was an issue with your request. Please try rephrasing your question.";
    } else if (error.name === "AccessDeniedException") {
      userMessage = "Access denied. Please contact the office for assistance.";
    }
    await sendToClient(apiClient, connectionId, {
      type: "error",
      content: userMessage,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { statusCode: 500 };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
