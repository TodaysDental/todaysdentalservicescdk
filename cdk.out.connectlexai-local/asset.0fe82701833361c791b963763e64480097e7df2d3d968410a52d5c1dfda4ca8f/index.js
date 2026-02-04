"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/integrations/communication/email-analytics-processor.ts
var email_analytics_processor_exports = {};
__export(email_analytics_processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(email_analytics_processor_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE;
var EMAIL_STATS_TABLE = process.env.EMAIL_STATS_TABLE;
var eventStatusMap = {
  "Send": "SENT",
  "Delivery": "DELIVERED",
  "Bounce": "BOUNCED",
  "Complaint": "COMPLAINED",
  "Open": "OPENED",
  "Click": "CLICKED",
  "Reject": "REJECTED",
  "RenderingFailure": "FAILED",
  "DeliveryDelay": "SENT"
  // Keep as sent, just note the delay
};
var statusPriority = {
  "QUEUED": 0,
  "SENT": 1,
  "DELIVERED": 2,
  "OPENED": 3,
  "CLICKED": 4,
  "BOUNCED": 10,
  // Terminal states have high priority
  "COMPLAINED": 10,
  "REJECTED": 10,
  "FAILED": 10
};
var handler = async (event) => {
  console.log("Processing SES events:", JSON.stringify(event));
  const promises = event.Records.map(processRecord);
  await Promise.allSettled(promises);
};
async function processRecord(record) {
  try {
    const message = JSON.parse(record.Sns.Message);
    console.log("Processing event:", message.eventType, "MessageId:", message.mail.messageId);
    await updateEmailTracking(message);
    await updateAggregateStats(message);
  } catch (error) {
    console.error("Error processing record:", error);
  }
}
async function updateEmailTracking(event) {
  const messageId = event.mail.messageId;
  const eventType = event.eventType;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  let existingRecord;
  try {
    const result = await ddb.send(new import_lib_dynamodb.GetCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId }
    }));
    existingRecord = result.Item;
  } catch (error) {
    console.error("Error getting existing record:", error);
  }
  const newStatus = eventStatusMap[eventType];
  const currentPriority = existingRecord ? statusPriority[existingRecord.status] : 0;
  const newPriority = statusPriority[newStatus];
  const updateExpressions = [];
  const expressionNames = {};
  const expressionValues = {};
  updateExpressions.push("#lastEventAt = :lastEventAt");
  expressionNames["#lastEventAt"] = "lastEventAt";
  expressionValues[":lastEventAt"] = timestamp;
  if (newPriority >= currentPriority) {
    updateExpressions.push("#status = :status");
    expressionNames["#status"] = "status";
    expressionValues[":status"] = newStatus;
  }
  switch (eventType) {
    case "Send":
      updateExpressions.push("sendTimestamp = :sendTs");
      expressionValues[":sendTs"] = event.mail.timestamp;
      if (!existingRecord) {
        updateExpressions.push("recipientEmail = :recipient");
        updateExpressions.push("sentAt = :sentAt");
        expressionValues[":recipient"] = event.mail.destination[0];
        expressionValues[":sentAt"] = event.mail.timestamp;
        if (event.mail.tags?.clinicId) {
          updateExpressions.push("clinicId = :clinicId");
          expressionValues[":clinicId"] = event.mail.tags.clinicId[0];
        }
        if (event.mail.commonHeaders?.subject) {
          updateExpressions.push("subject = :subject");
          expressionValues[":subject"] = event.mail.commonHeaders.subject;
        }
      }
      break;
    case "Delivery":
      updateExpressions.push("deliveryTimestamp = :deliveryTs");
      expressionValues[":deliveryTs"] = event.delivery?.timestamp;
      break;
    case "Bounce":
      updateExpressions.push("bounceTimestamp = :bounceTs");
      updateExpressions.push("bounceType = :bounceType");
      updateExpressions.push("bounceSubType = :bounceSubType");
      expressionValues[":bounceTs"] = event.bounce?.timestamp;
      expressionValues[":bounceType"] = event.bounce?.bounceType;
      expressionValues[":bounceSubType"] = event.bounce?.bounceSubType;
      if (event.bounce?.bouncedRecipients?.[0]?.diagnosticCode) {
        updateExpressions.push("bounceReason = :bounceReason");
        expressionValues[":bounceReason"] = event.bounce.bouncedRecipients[0].diagnosticCode;
      }
      break;
    case "Complaint":
      updateExpressions.push("complaintTimestamp = :complaintTs");
      expressionValues[":complaintTs"] = event.complaint?.timestamp;
      if (event.complaint?.complaintFeedbackType) {
        updateExpressions.push("complaintFeedbackType = :feedbackType");
        expressionValues[":feedbackType"] = event.complaint.complaintFeedbackType;
      }
      break;
    case "Open":
      updateExpressions.push("openTimestamp = if_not_exists(openTimestamp, :openTs)");
      updateExpressions.push("openCount = if_not_exists(openCount, :zero) + :one");
      expressionValues[":openTs"] = event.open?.timestamp;
      expressionValues[":zero"] = 0;
      expressionValues[":one"] = 1;
      if (event.open?.userAgent) {
        updateExpressions.push("userAgent = :userAgent");
        expressionValues[":userAgent"] = event.open.userAgent;
      }
      break;
    case "Click":
      updateExpressions.push("clickTimestamp = if_not_exists(clickTimestamp, :clickTs)");
      expressionValues[":clickTs"] = event.click?.timestamp;
      if (event.click?.link) {
        updateExpressions.push("clickedLinks = list_append(if_not_exists(clickedLinks, :emptyList), :newLink)");
        expressionValues[":emptyList"] = [];
        expressionValues[":newLink"] = [event.click.link];
      }
      break;
    case "Reject":
      updateExpressions.push("bounceReason = :rejectReason");
      expressionValues[":rejectReason"] = event.reject?.reason || "Rejected by SES";
      break;
    case "RenderingFailure":
      updateExpressions.push("bounceReason = :renderError");
      expressionValues[":renderError"] = event.renderingFailure?.errorMessage || "Template rendering failed";
      break;
  }
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId },
      UpdateExpression: "SET " + updateExpressions.join(", "),
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : void 0,
      ExpressionAttributeValues: expressionValues
    }));
    console.log("Updated tracking for messageId:", messageId);
  } catch (error) {
    console.error("Error updating tracking record:", error);
    throw error;
  }
}
async function updateAggregateStats(event) {
  const clinicId = event.mail.tags?.clinicId?.[0] || "unknown";
  const eventType = event.eventType;
  const now = /* @__PURE__ */ new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let attributeToIncrement = null;
  let additionalUpdates = {};
  switch (eventType) {
    case "Send":
      attributeToIncrement = "totalSent";
      break;
    case "Delivery":
      attributeToIncrement = "totalDelivered";
      break;
    case "Open":
      attributeToIncrement = "totalOpened";
      break;
    case "Click":
      attributeToIncrement = "totalClicked";
      break;
    case "Bounce":
      attributeToIncrement = "totalBounced";
      if (event.bounce?.bounceType === "Permanent") {
        additionalUpdates["hardBounces"] = 1;
      } else {
        additionalUpdates["softBounces"] = 1;
      }
      break;
    case "Complaint":
      attributeToIncrement = "totalComplained";
      break;
    case "Reject":
    case "RenderingFailure":
      attributeToIncrement = "totalFailed";
      break;
  }
  if (!attributeToIncrement)
    return;
  const updates = [
    `${attributeToIncrement} = if_not_exists(${attributeToIncrement}, :zero) + :one`,
    "lastUpdated = :now"
  ];
  const values = {
    ":zero": 0,
    ":one": 1,
    ":now": now.toISOString()
  };
  for (const [attr, inc] of Object.entries(additionalUpdates)) {
    updates.push(`${attr} = if_not_exists(${attr}, :zero) + :inc${attr}`);
    values[`:inc${attr}`] = inc;
  }
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: EMAIL_STATS_TABLE,
      Key: {
        clinicId,
        period: monthKey
      },
      UpdateExpression: "SET " + updates.join(", "),
      ExpressionAttributeValues: values
    }));
    console.log("Updated stats for clinic:", clinicId, "period:", monthKey);
  } catch (error) {
    console.error("Error updating aggregate stats:", error);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
