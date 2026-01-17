// src/services/chime/get-detailed-call-analytics.ts
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// src/shared/utils/permissions-helper.ts
import { inflateSync } from "zlib";
function parseClinicRoles(clinicRolesValue) {
  if (Array.isArray(clinicRolesValue)) {
    return clinicRolesValue;
  }
  if (typeof clinicRolesValue !== "string") {
    return [];
  }
  const raw = clinicRolesValue.trim();
  if (!raw)
    return [];
  try {
    if (raw.startsWith("z:")) {
      const b64 = raw.slice(2);
      const json = inflateSync(Buffer.from(b64, "base64")).toString("utf-8");
      return JSON.parse(json);
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse clinicRoles from authorizer context:", err);
    return [];
  }
}
function getUserPermissions(event) {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer)
    return null;
  try {
    const clinicRoles = parseClinicRoles(authorizer.clinicRolesZ ?? authorizer.clinicRoles);
    const isSuperAdmin = authorizer.isSuperAdmin === "true";
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === "true";
    const email = authorizer.email || "";
    const givenName = authorizer.givenName || "";
    const familyName = authorizer.familyName || "";
    return {
      email,
      givenName,
      familyName,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin
    };
  } catch (err) {
    console.error("Failed to parse user permissions:", err);
    return null;
  }
}
function getAllowedClinicIds(clinicRoles, isSuperAdmin, isGlobalSuperAdmin) {
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return /* @__PURE__ */ new Set(["*"]);
  }
  const clinicIds = clinicRoles.map((cr) => cr.clinicId);
  return new Set(clinicIds);
}
function hasClinicAccess(allowedClinics, clinicId) {
  return allowedClinics.has("*") || allowedClinics.has(clinicId);
}

// src/services/chime/get-detailed-call-analytics.ts
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
var dynamodbClient = new DynamoDBClient({});
var ddb = DynamoDBDocumentClient.from(dynamodbClient);
var s3Client = new S3Client({});
var CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
var RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME;
var CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE_NAME;
var CLINICS_TABLE = process.env.CLINICS_TABLE_NAME;
var handler = async (event) => {
  console.log("[get-detailed-analytics] Invoked", {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters
  });
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Unauthorized" })
      };
    }
    const callId = event.pathParameters?.callId;
    if (!callId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Missing callId parameter" })
      };
    }
    const callRecord = await getCallRecord(callId);
    if (!callRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Call not found" })
      };
    }
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (!hasClinicAccess(allowedClinics, callRecord.clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Unauthorized" })
      };
    }
    const clinicName = await getClinicName(callRecord.clinicId);
    const callHistory = await getCallHistory(
      callRecord.phoneNumber,
      callRecord.clinicId,
      callId
    );
    const recordingData = await getRecordingData(callId);
    const sessionInsights = await getSessionInsights(callRecord.sessionId);
    const callerName = sessionInsights.patientName || null;
    const response = {
      clinicId: callRecord.clinicId,
      clinicName,
      callerName,
      direction: callRecord.direction?.toUpperCase() || "INBOUND",
      to: callRecord.direction === "inbound" ? callRecord.clinicPhoneNumber : callRecord.phoneNumber,
      from: callRecord.direction === "inbound" ? callRecord.phoneNumber : callRecord.clinicPhoneNumber,
      callLength: callRecord.callDuration || 0,
      callHistory,
      insights: {
        summary: sessionInsights.summary || "No summary available",
        missedOpportunity: sessionInsights.missedOpportunity ? "yes" : "no",
        missedOpportunityReason: sessionInsights.missedOpportunityReason || null,
        appointmentStatus: sessionInsights.appointmentStatus || "unknown",
        notSchedulingReason: sessionInsights.notSchedulingReason || null,
        billingConcerns: sessionInsights.billingConcerns ? "yes" : "no",
        givenFeedback: sessionInsights.givenFeedback ? "yes" : "no",
        priority: sessionInsights.priority || "medium",
        inquiredServices: sessionInsights.inquiredServices ? "yes" : "no",
        callType: sessionInsights.callType || "other"
      },
      transcript: recordingData.transcript || []
    };
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("[get-detailed-analytics] Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Internal server error",
        error: error?.message
      })
    };
  }
};
async function getCallRecord(callId) {
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "pstnCallId-index",
      KeyConditionExpression: "pstnCallId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    if (queryResult.Items && queryResult.Items.length > 0) {
      return queryResult.Items[0];
    }
    const queryResult2 = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    return queryResult2.Items?.[0] || null;
  } catch (error) {
    console.error("[getCallRecord] Error:", error);
    return null;
  }
}
async function getClinicName(clinicId) {
  try {
    if (!CLINICS_TABLE) {
      return clinicId;
    }
    const result = await ddb.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId }
    }));
    return result.Item?.name || result.Item?.clinicName || clinicId;
  } catch (error) {
    console.error("[getClinicName] Error:", error);
    return clinicId;
  }
}
async function getCallHistory(phoneNumber, clinicId, currentCallId) {
  try {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1e3) / 1e3);
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "phoneNumber-queueEntryTime-index",
      KeyConditionExpression: "phoneNumber = :phone AND queueEntryTime > :cutoff",
      FilterExpression: "clinicId = :clinic",
      ExpressionAttributeValues: {
        ":phone": phoneNumber,
        ":clinic": clinicId,
        ":cutoff": thirtyDaysAgo
      },
      Limit: 50,
      ScanIndexForward: false
      // Most recent first
    }));
    const calls = result.Items || [];
    return calls.filter((call) => call.callId !== currentCallId && call.pstnCallId !== currentCallId).map((call) => {
      const queueTime = call.queueEntryTime || call.queueEntryTimeIso;
      const date = queueTime ? new Date(typeof queueTime === "number" ? queueTime * 1e3 : queueTime) : /* @__PURE__ */ new Date();
      const duration = call.callDuration || 0;
      const durationStr = formatDuration(duration);
      const callPath = call.direction === "inbound" ? `from ${call.phoneNumber} to ${call.clinicPhoneNumber || "clinic"}` : `from ${call.clinicPhoneNumber || "clinic"} to ${call.phoneNumber}`;
      const typeOfCall = determineCallType(call);
      return {
        callPath,
        date: date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }),
        time: date.toLocaleTimeString("en-US", { hour12: false }),
        duration: durationStr,
        typeOfCall
      };
    });
  } catch (error) {
    console.error("[getCallHistory] Error:", error);
    return [];
  }
}
async function getRecordingData(callId) {
  try {
    if (!RECORDING_METADATA_TABLE) {
      return { transcript: [] };
    }
    const result = await ddb.send(new QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    const recording = result.Items?.[0];
    if (!recording) {
      return { transcript: [] };
    }
    if (recording.transcriptText) {
      return parseTranscriptText(recording.transcriptText);
    }
    if (recording.transcriptS3Key) {
      const transcriptData = await fetchTranscriptFromS3(recording.transcriptS3Key);
      return parseTranscriptData(transcriptData);
    }
    return { transcript: [] };
  } catch (error) {
    console.error("[getRecordingData] Error:", error);
    return { transcript: [] };
  }
}
async function getSessionInsights(sessionId) {
  if (!sessionId || !CHAT_HISTORY_TABLE) {
    return getDefaultInsights();
  }
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: "sessionId = :sessionId",
      ExpressionAttributeValues: { ":sessionId": sessionId },
      ScanIndexForward: true
    }));
    const messages = result.Items || [];
    const sessionState = messages.find((m) => m.messageType === "session_state");
    if (sessionState?.insights) {
      return sessionState.insights;
    }
    return await analyzeSession(messages);
  } catch (error) {
    console.error("[getSessionInsights] Error:", error);
    return getDefaultInsights();
  }
}
async function analyzeSession(messages) {
  const userMessages = messages.filter((m) => m.messageType === "user");
  const assistantMessages = messages.filter((m) => m.messageType === "assistant");
  const summary = await buildSummary(userMessages, assistantMessages);
  const appointmentStatus = detectAppointmentStatus(messages);
  const notSchedulingReason = detectNotSchedulingReason(messages, appointmentStatus);
  const missedOpportunity = detectMissedOpportunity(messages, appointmentStatus);
  const missedOpportunityReason = missedOpportunity ? detectMissedOpportunityReason(messages, appointmentStatus) : null;
  const billingConcerns = detectBillingConcerns(messages);
  const givenFeedback = detectGivenFeedback(messages);
  const inquiredServices = detectInquiredServices(messages);
  const callType = detectCallType(messages);
  const priority = detectPriority(messages, callType, appointmentStatus);
  const patientName = extractPatientName(messages);
  return {
    summary,
    appointmentStatus,
    notSchedulingReason,
    missedOpportunity,
    missedOpportunityReason,
    billingConcerns,
    givenFeedback,
    inquiredServices,
    callType,
    priority,
    patientName
  };
}
function getDefaultInsights() {
  return {
    summary: "Call completed without recorded conversation.",
    appointmentStatus: "unknown",
    notSchedulingReason: null,
    missedOpportunity: false,
    missedOpportunityReason: null,
    billingConcerns: false,
    givenFeedback: false,
    inquiredServices: false,
    callType: "other",
    priority: "medium",
    patientName: null
  };
}
async function buildSummary(userMessages, assistantMessages) {
  if (userMessages.length === 0) {
    return "No conversation recorded.";
  }
  const firstUserMessage = userMessages[0]?.message || "";
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]?.message || "";
  let summary = "The caller ";
  if (firstUserMessage.toLowerCase().includes("appointment")) {
    summary += "called to schedule an appointment. ";
  } else if (firstUserMessage.toLowerCase().includes("emergency")) {
    summary += "called with a dental emergency. ";
  } else if (firstUserMessage.toLowerCase().includes("cancel")) {
    summary += "called to cancel an appointment. ";
  } else if (firstUserMessage.toLowerCase().includes("reschedule")) {
    summary += "called to reschedule an appointment. ";
  } else {
    summary += "initiated a conversation. ";
  }
  if (lastAssistantMessage.toLowerCase().includes("scheduled") || lastAssistantMessage.toLowerCase().includes("booked")) {
    summary += "An appointment was successfully scheduled.";
  } else if (lastAssistantMessage.toLowerCase().includes("no availability") || lastAssistantMessage.toLowerCase().includes("no slots")) {
    summary += "Unfortunately, no appointment slots were available.";
  } else {
    summary += "The conversation concluded without scheduling an appointment.";
  }
  return summary;
}
function detectAppointmentStatus(messages) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  if (allText.includes("appointment scheduled") || allText.includes("booked successfully")) {
    return "scheduled";
  }
  if (allText.includes("rescheduled")) {
    return "rescheduled";
  }
  if (allText.includes("cancelled")) {
    return "cancelled";
  }
  if (allText.includes("no availability") || allText.includes("no slots")) {
    return "not_scheduled";
  }
  return "unknown";
}
function detectNotSchedulingReason(messages, appointmentStatus) {
  if (appointmentStatus === "scheduled") {
    return null;
  }
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  if (allText.includes("no availability") || allText.includes("no slots")) {
    return "No available appointment slots";
  }
  if (allText.includes("closed")) {
    return "Clinic was closed";
  }
  if (allText.includes("will call back") || allText.includes("call later")) {
    return "Caller will call back later";
  }
  return "Not provided";
}
function detectMissedOpportunity(messages, appointmentStatus) {
  if (appointmentStatus === "scheduled") {
    return false;
  }
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  const hasIntent = allText.includes("appointment") || allText.includes("schedule") || allText.includes("book") || allText.includes("emergency");
  return hasIntent && appointmentStatus !== "scheduled";
}
function detectMissedOpportunityReason(messages, appointmentStatus) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  if (allText.includes("no availability") || allText.includes("no slots")) {
    return "No available appointment slots for the requested time";
  }
  if (allText.includes("closed")) {
    return "Clinic was closed at the time of call";
  }
  if (!allText.includes("alternative") && !allText.includes("option")) {
    return "No alternative solutions or options were provided";
  }
  return "Caller's need was not met";
}
function detectBillingConcerns(messages) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  return allText.includes("billing") || allText.includes("insurance") || allText.includes("payment") || allText.includes("cost");
}
function detectGivenFeedback(messages) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  return allText.includes("feedback") || allText.includes("complaint") || allText.includes("suggestion");
}
function detectInquiredServices(messages) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  const serviceKeywords = [
    "cleaning",
    "whitening",
    "filling",
    "crown",
    "bridge",
    "implant",
    "extraction",
    "root canal",
    "denture",
    "braces",
    "orthodontic"
  ];
  return serviceKeywords.some((keyword) => allText.includes(keyword));
}
function detectCallType(messages) {
  const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
  if (allText.includes("emergency") || allText.includes("urgent") || allText.includes("pain")) {
    return "emergency";
  }
  if (allText.includes("appointment") || allText.includes("schedule") || allText.includes("book")) {
    return "appointment";
  }
  if (allText.includes("billing") || allText.includes("insurance") || allText.includes("payment")) {
    return "billing";
  }
  if (allText.includes("complaint") || allText.includes("unhappy")) {
    return "complaint";
  }
  if (allText.includes("question") || allText.includes("how much") || allText.includes("do you")) {
    return "inquiry";
  }
  return "other";
}
function detectPriority(messages, callType, appointmentStatus) {
  if (callType === "emergency") {
    return "high";
  }
  if (appointmentStatus === "not_scheduled" && messages.length > 0) {
    const allText = messages.map((m) => m.message?.toLowerCase() || "").join(" ");
    if (allText.includes("urgent") || allText.includes("soon") || allText.includes("asap")) {
      return "high";
    }
  }
  if (callType === "appointment" || callType === "billing") {
    return "medium";
  }
  return "low";
}
function extractPatientName(messages) {
  const sessionState = messages.find((m) => m.messageType === "session_state");
  if (sessionState?.sessionState) {
    try {
      const state = typeof sessionState.sessionState === "string" ? JSON.parse(sessionState.sessionState) : sessionState.sessionState;
      if (state.FName && state.LName) {
        return `${state.FName} ${state.LName}`;
      }
    } catch (e) {
    }
  }
  for (const msg of messages) {
    const text = msg.message?.toLowerCase() || "";
    const match = text.match(/name\s+is\s+([a-z]+\s+[a-z]+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function determineCallType(call) {
  if (call.isCallback)
    return "callback";
  if (call.isVip)
    return "VIP";
  if (call.direction === "outbound")
    return "outbound";
  return call.direction || "inbound";
}
function parseTranscriptText(transcriptText) {
  const lines = transcriptText.split("\n").filter((l) => l.trim());
  const transcript = [];
  let elapsedSeconds = 0;
  for (const line of lines) {
    if (line.includes("AGENT:") || line.includes("CUSTOMER:")) {
      const speaker = line.includes("AGENT:") ? "AGENT" : "CUSTOMER";
      const text = line.replace(/^(AGENT:|CUSTOMER:)/, "").trim();
      transcript.push({
        timestamp: formatTimestamp(elapsedSeconds),
        speaker,
        text
      });
      elapsedSeconds += 5;
    }
  }
  return { transcript };
}
async function fetchTranscriptFromS3(s3Key) {
  try {
    const bucketName = process.env.RECORDINGS_BUCKET_NAME;
    if (!bucketName) {
      return null;
    }
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });
    const response = await s3Client.send(command);
    const bodyString = await response.Body?.transformToString();
    return bodyString ? JSON.parse(bodyString) : null;
  } catch (error) {
    console.error("[fetchTranscriptFromS3] Error:", error);
    return null;
  }
}
function parseTranscriptData(data) {
  if (!data || !data.results || !data.results.items) {
    return { transcript: [] };
  }
  const transcript = [];
  let currentText = "";
  let currentSpeaker = "CUSTOMER";
  let currentTime = 0;
  for (const item of data.results.items) {
    if (item.type === "pronunciation") {
      currentText += item.alternatives?.[0]?.content || "";
      currentTime = parseFloat(item.start_time || "0");
    } else if (item.type === "punctuation") {
      currentText += item.alternatives?.[0]?.content || "";
      if (currentText.trim()) {
        transcript.push({
          timestamp: formatTimestamp(currentTime),
          speaker: currentSpeaker,
          text: currentText.trim()
        });
        currentText = "";
        currentSpeaker = currentSpeaker === "AGENT" ? "CUSTOMER" : "AGENT";
      }
    }
  }
  if (currentText.trim()) {
    transcript.push({
      timestamp: formatTimestamp(currentTime),
      speaker: currentSpeaker,
      text: currentText.trim()
    });
  }
  return { transcript };
}
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
export {
  handler
};
