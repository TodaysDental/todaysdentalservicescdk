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

// src/services/lease-management/leaseAlertHandler.ts
var leaseAlertHandler_exports = {};
__export(leaseAlertHandler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(leaseAlertHandler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_sesv2 = require("@aws-sdk/client-sesv2");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || "StaffUser";
var APP_NAME = process.env.APP_NAME || "TodaysDentalInsights";
var FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@todaysdentalinsights.com";
var SES_REGION = process.env.SES_REGION || "us-east-1";
var ses = new import_client_sesv2.SESv2Client({ region: SES_REGION });
var LEASE_END_ALERTS = [90, 60, 30, 7, 1, 0];
var RENEWAL_START_ALERTS = [30, 7, 1, 0];
var RENEWAL_END_ALERTS = [30, 7, 1, 0];
async function sendEmailViaSES(to, subject, htmlBody, textBody) {
  if (!FROM_EMAIL || !to) {
    console.warn("Skipping email: Missing FROM_EMAIL or recipient email.");
    return false;
  }
  try {
    const cmd = new import_client_sesv2.SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: htmlBody },
            Text: { Data: textBody }
          }
        }
      },
      FromEmailAddress: FROM_EMAIL
    });
    await ses.send(cmd);
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error.message);
    return false;
  }
}
function daysUntil(dateStr) {
  if (!dateStr)
    return Infinity;
  const now = /* @__PURE__ */ new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1e3));
}
function parseReminderDays(reminder) {
  if (!reminder)
    return null;
  const lower = reminder.toLowerCase().trim();
  if (lower === "day of" || lower === "on the day")
    return 0;
  if (lower === "1 day before" || lower === "1 day")
    return 1;
  if (lower === "3 days before" || lower === "3 days")
    return 3;
  if (lower === "1 week before" || lower === "1 week" || lower === "7 days")
    return 7;
  if (lower === "2 weeks before" || lower === "2 weeks" || lower === "14 days")
    return 14;
  if (lower === "1 month before" || lower === "1 month" || lower === "30 days")
    return 30;
  return null;
}
function getUrgencyLabel(days) {
  if (days === 0)
    return "TODAY";
  if (days === 1)
    return "TOMORROW";
  if (days <= 7)
    return "THIS WEEK";
  if (days <= 30)
    return "THIS MONTH";
  return "UPCOMING";
}
function getUrgencyColor(days) {
  if (days === 0)
    return "#D32F2F";
  if (days === 1)
    return "#E64A19";
  if (days <= 7)
    return "#F57C00";
  if (days <= 30)
    return "#FFA000";
  return "#0288D1";
}
function generateAlertKey(leaseId, alertType, date, daysUntil2, eventId) {
  const eventPart = eventId ? `#${eventId}` : "";
  return `${leaseId}#${alertType}${eventPart}#${date}#${daysUntil2}`;
}
async function wasAlertSentToday(alertKey) {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  try {
    const { Items } = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: LEASE_TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK = :sk",
      ExpressionAttributeValues: {
        ":pk": "ALERT_SENT",
        ":sk": `${today}#${alertKey}`
      },
      Limit: 1
    }));
    return (Items?.length || 0) > 0;
  } catch (error) {
    console.error("Error checking alert history:", error.message);
    return false;
  }
}
async function markAlertSent(alertKey, leaseId, alertType, recipientEmails) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const today = now.split("T")[0];
  try {
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: LEASE_TABLE_NAME,
      Item: {
        PK: "ALERT_SENT",
        SK: `${today}#${alertKey}`,
        alertKey,
        leaseId,
        alertType,
        recipientEmails,
        sentAt: now,
        ttl: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
        // Auto-delete after 7 days
      }
    }));
  } catch (error) {
    console.error("Error marking alert as sent:", error.message);
  }
}
async function findAlertsToSend() {
  const alertsToSend = [];
  let lastEvaluatedKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new import_lib_dynamodb.ScanCommand({
      TableName: LEASE_TABLE_NAME,
      FilterExpression: "begins_with(SK, :sk) AND (#status <> :deleted OR attribute_not_exists(#status))",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":sk": "LEASE#",
        ":deleted": "Deleted"
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    lastEvaluatedKey = LastEvaluatedKey;
    if (!Items)
      continue;
    for (const lease of Items) {
      const clinicId = lease.propertyInformation?.clinicId || lease.PK?.replace("CLINIC#", "") || "";
      const leaseId = lease.SK?.replace("LEASE#", "") || "";
      const clinicName = lease.propertyInformation?.clinicName || "Unknown Clinic";
      const address = lease.propertyInformation?.address || "";
      const leaseTerms = lease.leaseTerms || {};
      const events = lease.events || [];
      if (leaseTerms.endDate) {
        const days = daysUntil(leaseTerms.endDate);
        if (LEASE_END_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: "lease_end",
            date: leaseTerms.endDate,
            daysUntil: days
          });
        }
      }
      if (leaseTerms.renewalRequestStartDate) {
        const days = daysUntil(leaseTerms.renewalRequestStartDate);
        if (RENEWAL_START_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: "renewal_start",
            date: leaseTerms.renewalRequestStartDate,
            daysUntil: days
          });
        }
      }
      if (leaseTerms.renewalRequestEndDate) {
        const days = daysUntil(leaseTerms.renewalRequestEndDate);
        if (RENEWAL_END_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: "renewal_end",
            date: leaseTerms.renewalRequestEndDate,
            daysUntil: days
          });
        }
      }
      for (const event of events) {
        if (!event.date || !event.reminder)
          continue;
        const reminderDays = parseReminderDays(event.reminder);
        if (reminderDays === null)
          continue;
        const daysToEvent = daysUntil(event.date);
        if (daysToEvent === reminderDays) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: "event_reminder",
            eventTitle: event.title || "Lease Event",
            date: event.date,
            daysUntil: daysToEvent
          });
        }
      }
    }
  } while (lastEvaluatedKey);
  console.log(`[LeaseAlerts] Found ${alertsToSend.length} potential alerts to send`);
  return alertsToSend;
}
async function findRecipientsForClinic(clinicId) {
  const recipients = [];
  let lastEvaluatedKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new import_lib_dynamodb.ScanCommand({
      TableName: STAFF_USER_TABLE,
      FilterExpression: "isActive = :active OR attribute_not_exists(isActive)",
      ExpressionAttributeValues: { ":active": true },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    lastEvaluatedKey = LastEvaluatedKey;
    if (!Items)
      continue;
    for (const user of Items) {
      const email = user.email;
      if (!email)
        continue;
      const givenName = user.givenName || "";
      const familyName = user.familyName || "";
      const name = `${givenName} ${familyName}`.trim() || email;
      const isGlobalSuperAdmin = user.isGlobalSuperAdmin === true;
      const isSuperAdmin = user.isSuperAdmin === true;
      const clinicRoles = user.clinicRoles || [];
      if (isGlobalSuperAdmin || isSuperAdmin) {
        recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: true });
        continue;
      }
      for (const cr of clinicRoles) {
        if (cr.clinicId !== clinicId)
          continue;
        if (cr.role === "Admin" || cr.role === "SuperAdmin" || cr.role === "Global super admin") {
          recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: false });
          break;
        }
        const moduleAccess = cr.moduleAccess || [];
        const hasLegalAccess = moduleAccess.some(
          (ma) => ma.module === "Legal" && ma.permissions && ma.permissions.includes("read")
        );
        if (hasLegalAccess) {
          recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: false });
          break;
        }
      }
    }
  } while (lastEvaluatedKey);
  const uniqueRecipients = /* @__PURE__ */ new Map();
  for (const r of recipients) {
    uniqueRecipients.set(r.email, r);
  }
  return Array.from(uniqueRecipients.values());
}
function getAlertTypeLabel(alertType) {
  switch (alertType) {
    case "lease_end":
      return "Lease Expiration";
    case "renewal_start":
      return "Renewal Window Opens";
    case "renewal_end":
      return "Renewal Request Deadline";
    case "event_reminder":
      return "Event Reminder";
    default:
      return "Lease Alert";
  }
}
function getAlertMessage(alert) {
  const { alertType, daysUntil: daysUntil2, eventTitle } = alert;
  const timePhrase = daysUntil2 === 0 ? "today" : daysUntil2 === 1 ? "tomorrow" : `in ${daysUntil2} days`;
  switch (alertType) {
    case "lease_end":
      return `Your lease expires ${timePhrase}. Please review and take necessary action.`;
    case "renewal_start":
      return `Your renewal request window opens ${timePhrase}. Prepare your renewal documentation.`;
    case "renewal_end":
      return `Your renewal request deadline is ${timePhrase}. Submit your renewal request before the deadline.`;
    case "event_reminder":
      return `Reminder: "${eventTitle}" is scheduled ${timePhrase}.`;
    default:
      return `Important lease date coming up ${timePhrase}.`;
  }
}
function generateAlertEmailHtml(alert, recipientName) {
  const color = getUrgencyColor(alert.daysUntil);
  const urgencyLabel = getUrgencyLabel(alert.daysUntil);
  const dateStr = new Date(alert.date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getAlertTypeLabel(alert.alertType)}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 32px;">
    
    <!-- Header with urgency badge -->
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; padding: 8px 16px; border-radius: 4px; font-size: 14px; font-weight: bold; color: white; background-color: ${color};">
        ${urgencyLabel}
      </span>
    </div>
    
    <!-- Alert Title -->
    <h1 style="color: ${color}; text-align: center; margin: 0 0 24px 0; font-size: 24px;">
      ${getAlertTypeLabel(alert.alertType)}
    </h1>
    
    <p style="margin-bottom: 16px;">Hello ${recipientName},</p>
    
    <p style="margin-bottom: 24px; font-size: 16px;">
      ${getAlertMessage(alert)}
    </p>
    
    <!-- Lease Details Card -->
    <div style="background-color: #f8f9fa; border-left: 4px solid ${color}; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; width: 120px;">Clinic:</td>
          <td style="padding: 8px 0;">${alert.clinicName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Address:</td>
          <td style="padding: 8px 0;">${alert.address || "N/A"}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Date:</td>
          <td style="padding: 8px 0;">${dateStr}</td>
        </tr>
        ${alert.eventTitle ? `
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Event:</td>
          <td style="padding: 8px 0;">${alert.eventTitle}</td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Time Left:</td>
          <td style="padding: 8px 0; color: ${color}; font-weight: bold;">
            ${alert.daysUntil === 0 ? "TODAY" : alert.daysUntil === 1 ? "1 day" : `${alert.daysUntil} days`}
          </td>
        </tr>
      </table>
    </div>
    
    <!-- CTA Button -->
    <div style="text-align: center; margin: 32px 0;">
      <a href="https://app.todaysdentalinsights.com/lease-management" 
         style="display: inline-block; padding: 12px 32px; background-color: #1976D2; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
        View Lease Details
      </a>
    </div>
    
    <hr style="margin: 32px 0; border: none; border-top: 1px solid #E0E0E0;" />
    
    <p style="color: #888; font-size: 12px; margin: 0; text-align: center;">
      This is an automated message from ${APP_NAME}.<br/>
      You are receiving this email because you have Legal module access.
    </p>
  </div>
</body>
</html>
  `.trim();
}
function generateAlertEmailText(alert, recipientName) {
  const dateStr = new Date(alert.date).toLocaleDateString();
  const daysText = alert.daysUntil === 0 ? "TODAY" : `in ${alert.daysUntil} days`;
  return `
${getAlertTypeLabel(alert.alertType).toUpperCase()}
${"=".repeat(40)}

Hello ${recipientName},

${getAlertMessage(alert)}

DETAILS:
- Clinic: ${alert.clinicName}
- Address: ${alert.address || "N/A"}
- Date: ${dateStr}
${alert.eventTitle ? `- Event: ${alert.eventTitle}` : ""}
- Time Left: ${daysText}

View lease details: https://app.todaysdentalinsights.com/lease-management

---
This is an automated message from ${APP_NAME}.
  `.trim();
}
var handler = async (event) => {
  console.log("[LeaseAlerts] Starting alert check:", (/* @__PURE__ */ new Date()).toISOString());
  try {
    const alertsToSend = await findAlertsToSend();
    if (alertsToSend.length === 0) {
      console.log("[LeaseAlerts] No alerts to send today");
      return;
    }
    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    for (const alert of alertsToSend) {
      const alertKey = generateAlertKey(
        alert.leaseId,
        alert.alertType,
        alert.date,
        alert.daysUntil,
        alert.eventTitle
      );
      const alreadySent = await wasAlertSentToday(alertKey);
      if (alreadySent) {
        console.log(`[LeaseAlerts] Skipping duplicate: ${alertKey}`);
        skippedCount++;
        continue;
      }
      const recipients = await findRecipientsForClinic(alert.clinicId);
      if (recipients.length === 0) {
        console.log(`[LeaseAlerts] No recipients found for clinic: ${alert.clinicId}`);
        continue;
      }
      const subject = alert.daysUntil === 0 ? `\u{1F6A8} [TODAY] ${getAlertTypeLabel(alert.alertType)} - ${alert.clinicName}` : `\u{1F4C5} [${alert.daysUntil} days] ${getAlertTypeLabel(alert.alertType)} - ${alert.clinicName}`;
      const recipientEmails = [];
      for (const recipient of recipients) {
        const htmlBody = generateAlertEmailHtml(alert, recipient.name);
        const textBody = generateAlertEmailText(alert, recipient.name);
        const sent = await sendEmailViaSES(recipient.email, subject, htmlBody, textBody);
        if (sent) {
          recipientEmails.push(recipient.email);
        } else {
          failedCount++;
        }
      }
      if (recipientEmails.length > 0) {
        await markAlertSent(alertKey, alert.leaseId, alert.alertType, recipientEmails);
        sentCount++;
        console.log(`[LeaseAlerts] Sent alert: ${alertKey} to ${recipientEmails.length} recipients`);
      }
    }
    console.log(`[LeaseAlerts] Completed: ${sentCount} alerts sent, ${skippedCount} skipped (duplicates), ${failedCount} failed`);
  } catch (error) {
    console.error("[LeaseAlerts] Handler failed:", error);
    throw error;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
