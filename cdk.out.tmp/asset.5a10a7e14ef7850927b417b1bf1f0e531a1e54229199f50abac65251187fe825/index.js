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

// src/services/clinic/emailSender.ts
var emailSender_exports = {};
__export(emailSender_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(emailSender_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_sesv2 = require("@aws-sdk/client-sesv2");

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamoClient = null;
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new import_client_dynamodb.DynamoDB({});
  }
  return dynamoClient;
}
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);
var clinicConfigCache = /* @__PURE__ */ new Map();
function isCacheValid(entry) {
  return entry !== void 0 && entry.expiresAt > Date.now();
}
function setCacheEntry(cache, key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}
async function getClinicConfig(clinicId) {
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }
    const config = (0, import_util_dynamodb.unmarshall)(response.Item);
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}

// src/shared/utils/email-template-wrapper.ts
async function getClinicBranding(clinicId) {
  const config = await getClinicConfig(clinicId);
  if (!config)
    return null;
  return {
    clinicId,
    clinicName: config.clinicName || "Today's Dental",
    clinicEmail: config.clinicEmail || "",
    clinicPhone: config.clinicPhone || config.phoneNumber || "",
    clinicAddress: config.clinicAddress || "",
    clinicCity: config.clinicCity || "",
    clinicState: config.clinicState || "",
    clinicZip: config.clinicZipCode || "",
    logoUrl: config.logoUrl || "https://assets.todaysdentalinsights.com/logos/todays-dental-logo.png",
    websiteUrl: config.websiteLink || "https://todaysdentalinsights.com"
  };
}
function formatPhysicalAddress(branding) {
  const parts = [
    branding.clinicAddress,
    branding.clinicCity,
    branding.clinicState,
    branding.clinicZip
  ].filter(Boolean);
  return parts.join(", ");
}
function generateEmailHeader(branding) {
  return `
    <div style="background-color: #f8f9fa; padding: 20px 0; text-align: center;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center">
            <img src="${branding.logoUrl}" alt="${branding.clinicName}" 
                 style="max-width: 200px; max-height: 80px; display: block;" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top: 10px;">
            <span style="font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; color: #2c3e50;">
              ${branding.clinicName}
            </span>
          </td>
        </tr>
      </table>
    </div>
  `;
}
function generateEmailFooter(branding, patientName) {
  const physicalAddress = formatPhysicalAddress(branding);
  const recipientName = patientName || "Valued Patient";
  const unsubscribeUrl = branding.unsubscribeUrl || "{{amazonSESUnsubscribeUrl}}";
  return `
    <div style="background-color: #f8f9fa; padding: 30px 20px; margin-top: 30px; border-top: 1px solid #e9ecef;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto;">
        <!-- Contact Information -->
        <tr>
          <td align="center" style="padding-bottom: 20px;">
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #495057; margin: 0;">
              <strong>${branding.clinicName}</strong><br />
              ${physicalAddress}<br />
              Phone: ${branding.clinicPhone}<br />
              <a href="mailto:${branding.clinicEmail}" style="color: #007bff; text-decoration: none;">${branding.clinicEmail}</a>
            </p>
          </td>
        </tr>
        
        <!-- Why You Received This Email (Disclaimer) -->
        <tr>
          <td align="center" style="padding-bottom: 20px;">
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #6c757d; margin: 0; line-height: 1.6;">
              <strong>Why am I receiving this email?</strong><br />
              You are receiving this email because you are a patient of ${branding.clinicName}. 
              This message contains important information about your dental care, appointments, 
              or account. We are committed to keeping you informed about your oral health.
            </p>
          </td>
        </tr>
        
        <!-- Unsubscribe Link -->
        <tr>
          <td align="center" style="padding-bottom: 15px;">
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #6c757d; margin: 0;">
              If you no longer wish to receive these emails, you can 
              <a href="${unsubscribeUrl}" style="color: #007bff; text-decoration: underline;">unsubscribe here</a>.
            </p>
          </td>
        </tr>
        
        <!-- Copyright and Compliance -->
        <tr>
          <td align="center">
            <p style="font-family: Arial, sans-serif; font-size: 11px; color: #adb5bd; margin: 0;">
              \xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${branding.clinicName}. All rights reserved.<br />
              This email was sent to you as a patient communication from ${branding.clinicName}.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;
}
function wrapEmailWithBranding(htmlBody, branding, patientName) {
  const header = generateEmailHeader(branding);
  const footer = generateEmailFooter(branding, patientName);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Email from ${branding.clinicName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset styles for email clients */
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; }
    
    /* Mobile responsive */
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .content-padding { padding: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center">
        <table role="presentation" class="email-container" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto;">
          <!-- Header with Logo and Clinic Name -->
          <tr>
            <td>
              ${header}
            </td>
          </tr>
          
          <!-- Main Email Content -->
          <tr>
            <td class="content-padding" style="padding: 30px 20px; background-color: #ffffff;">
              ${htmlBody}
            </td>
          </tr>
          
          <!-- Footer with Disclaimer, Unsubscribe, and Physical Address -->
          <tr>
            <td>
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
function wrapTextEmailWithBranding(textBody, branding, patientName) {
  const physicalAddress = formatPhysicalAddress(branding);
  const unsubscribeUrl = branding.unsubscribeUrl || "{{amazonSESUnsubscribeUrl}}";
  return `
${branding.clinicName}
${"=".repeat(branding.clinicName.length)}

${textBody}

---

CONTACT US
${branding.clinicName}
${physicalAddress}
Phone: ${branding.clinicPhone}
Email: ${branding.clinicEmail}
Website: ${branding.websiteUrl}

---

WHY AM I RECEIVING THIS EMAIL?
You are receiving this email because you are a patient of ${branding.clinicName}. 
This message contains important information about your dental care, appointments, or account.

To unsubscribe from these emails, visit: ${unsubscribeUrl}

\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${branding.clinicName}. All rights reserved.
  `.trim();
}
function hasEmailBranding(htmlBody) {
  return htmlBody.includes("amazonSESUnsubscribeUrl") || htmlBody.includes("Why am I receiving this email") || htmlBody.includes("unsubscribe here") || htmlBody.includes("<!DOCTYPE html>");
}
async function ensureEmailBranding(htmlBody, clinicId, patientName) {
  const branding = await getClinicBranding(clinicId);
  if (!branding) {
    console.warn(`[EmailWrapper] No branding found for clinic: ${clinicId}`);
    return {
      html: htmlBody,
      text: htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    };
  }
  if (hasEmailBranding(htmlBody)) {
    return {
      html: htmlBody,
      text: htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    };
  }
  const wrappedHtml = wrapEmailWithBranding(htmlBody, branding, patientName);
  const wrappedText = wrapTextEmailWithBranding(
    htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    branding,
    patientName
  );
  return { html: wrappedHtml, text: wrappedText };
}

// src/services/clinic/emailSender.ts
var CONTACT_LIST_NAME = "PatientEmails";
var TOPIC_NAME = "ClinicCommunications";
var ddb = new import_client_dynamodb2.DynamoDBClient({});
var doc = import_lib_dynamodb.DynamoDBDocumentClient.from(ddb);
var ses = new import_client_sesv2.SESv2Client({});
var EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE || "";
var SES_CONFIGURATION_SET_NAME = process.env.SES_CONFIGURATION_SET_NAME || "";
var clinicConfigCache2 = {};
async function getCachedClinicConfig(clinicId) {
  if (clinicConfigCache2[clinicId]) {
    return clinicConfigCache2[clinicId];
  }
  const config = await getClinicConfig(clinicId);
  if (config) {
    clinicConfigCache2[clinicId] = config;
  }
  return config;
}
async function ensureContactExists(email, clinicId) {
  try {
    await ses.send(new import_client_sesv2.GetContactCommand({
      ContactListName: CONTACT_LIST_NAME,
      EmailAddress: email
    }));
    return true;
  } catch (error) {
    if (error.name === "NotFoundException") {
      try {
        await ses.send(new import_client_sesv2.CreateContactCommand({
          ContactListName: CONTACT_LIST_NAME,
          EmailAddress: email,
          TopicPreferences: [
            {
              TopicName: TOPIC_NAME,
              SubscriptionStatus: "OPT_IN"
            }
          ],
          AttributesData: JSON.stringify({
            clinicId,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            source: "scheduled-email"
          })
        }));
        console.log(`Created contact ${email} in SES contact list`);
        return true;
      } catch (createError) {
        console.warn(`Failed to create contact ${email}:`, createError.message);
        return false;
      }
    }
    console.warn(`Error checking contact ${email}:`, error.message);
    return false;
  }
}
async function sendEmail(task) {
  const { clinicId, recipientEmail, subject, htmlBody, textBody, templateName } = task;
  const config = await getCachedClinicConfig(clinicId);
  if (!config?.sesIdentityArn) {
    throw new Error(`No SES identity configured for clinic: ${clinicId}`);
  }
  let from;
  let fromName;
  if (!config.clinicEmail) {
    const fromDomain = config.sesIdentityArn.split(":identity/")[1] || "todaysdentalinsights.com";
    from = `no-reply@${fromDomain}`;
    fromName = config.clinicName || "Today's Dental";
  } else {
    from = config.clinicEmail;
    fromName = config.clinicName || "Today's Dental";
  }
  const fromWithName = `"${fromName}" <${from}>`;
  const { html: brandedHtml, text: brandedText } = await ensureEmailBranding(
    htmlBody,
    clinicId,
    void 0
    // Patient name extracted from template context if available
  );
  const contactExists = await ensureContactExists(recipientEmail, clinicId);
  const cmd = new import_client_sesv2.SendEmailCommand({
    FromEmailAddress: fromWithName,
    FromEmailAddressIdentityArn: config.sesIdentityArn,
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: brandedHtml },
          Text: { Data: textBody || brandedText }
        },
        // Add List-Unsubscribe headers for email clients
        // These enable one-click unsubscribe in Gmail, Outlook, etc.
        Headers: [
          {
            Name: "List-Unsubscribe-Post",
            Value: "List-Unsubscribe=One-Click"
          }
        ]
      }
    },
    ConfigurationSetName: SES_CONFIGURATION_SET_NAME || void 0,
    // Enable SES subscription management for automatic unsubscribe handling
    // SES will replace {{amazonSESUnsubscribeUrl}} placeholder with actual URL
    // Only include if contact was successfully created/verified
    ...contactExists && {
      ListManagementOptions: {
        ContactListName: CONTACT_LIST_NAME,
        TopicName: TOPIC_NAME
      }
    },
    EmailTags: [
      { Name: "clinicId", Value: clinicId },
      { Name: "source", Value: "scheduled-email-queue" },
      ...templateName ? [{ Name: "templateName", Value: templateName }] : []
    ]
  });
  const response = await ses.send(cmd);
  return response.MessageId;
}
async function writeCanonicalTrackingRecord(task, sesMessageId) {
  if (!EMAIL_ANALYTICS_TABLE)
    return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await doc.send(new import_lib_dynamodb.PutCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Item: {
        messageId: sesMessageId,
        // Canonical key — matches SES event processor
        clinicId: task.clinicId,
        recipientEmail: task.recipientEmail,
        subject: task.subject,
        templateName: task.templateName || void 0,
        status: "SENT",
        sentAt: now,
        sendTimestamp: now
      }
    }));
    console.log(`Wrote canonical tracking record for SES messageId: ${sesMessageId}`);
  } catch (err) {
    console.warn(`Failed to write canonical tracking record for ${sesMessageId}:`, err);
  }
  if (task.trackingId && task.trackingId !== sesMessageId) {
    try {
      await doc.send(new import_lib_dynamodb.DeleteCommand({
        TableName: EMAIL_ANALYTICS_TABLE,
        Key: { messageId: task.trackingId }
      }));
    } catch (err) {
      console.warn(`Could not delete temp tracking record ${task.trackingId}:`, err);
    }
  }
}
async function writeFailedTrackingRecord(trackingId, errorMessage) {
  if (!EMAIL_ANALYTICS_TABLE || !trackingId)
    return;
  try {
    await doc.send(new import_lib_dynamodb.UpdateCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId: trackingId },
      UpdateExpression: "SET #status = :status, sentAt = :now, errorMessage = :err",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "FAILED",
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":err": errorMessage
      }
    }));
  } catch (err) {
    console.warn(`Failed to update email status for ${trackingId}:`, err);
  }
}
async function processEmailTask(task) {
  try {
    console.log(`Sending email to ${task.recipientEmail} for clinic ${task.clinicId}`);
    const sesMessageId = await sendEmail(task);
    if (sesMessageId) {
      await writeCanonicalTrackingRecord(task, sesMessageId);
    }
    console.log(`Successfully sent email to ${task.recipientEmail}, SES ID: ${sesMessageId}`);
  } catch (error) {
    console.error(`Failed to send email to ${task.recipientEmail}:`, error);
    await writeFailedTrackingRecord(task.trackingId, error.message || "Send failed");
    throw error;
  }
}
var handler = async (event) => {
  const failedRecords = [];
  for (const record of event.Records) {
    try {
      const task = JSON.parse(record.body);
      await processEmailTask(task);
    } catch (error) {
      console.error(`Failed to process email record ${record.messageId}:`, error);
      failedRecords.push({ itemIdentifier: record.messageId });
    }
  }
  console.log(`Email sender completed: ${event.Records.length - failedRecords.length} sent, ${failedRecords.length} failed`);
  return {
    batchItemFailures: failedRecords
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
