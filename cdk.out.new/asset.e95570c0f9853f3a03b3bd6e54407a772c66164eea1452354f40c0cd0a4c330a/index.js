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

// hours-api/hoursSync.ts
var hoursSync_exports = {};
__export(hoursSync_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(hoursSync_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
function loadConnect() {
  try {
    return require("@aws-sdk/client-connect");
  } catch {
    return {};
  }
}
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.CLINIC_HOURS_TABLE || "ClinicHours";
var CONNECT_INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || "";
var handler = async (event) => {
  const CONNECT = loadConnect();
  if (!CONNECT_INSTANCE_ARN || !CONNECT.ConnectClient) {
    return { ok: false, reason: "connect not configured" };
  }
  const connectClient = new CONNECT.ConnectClient({});
  const instanceId = arnTail(CONNECT_INSTANCE_ARN);
  for (const rec of event.Records) {
    if (rec.eventName !== "INSERT" && rec.eventName !== "MODIFY") continue;
    const newImage = rec.dynamodb?.NewImage;
    if (!newImage) continue;
    const item = (0, import_util_dynamodb.unmarshall)(newImage);
    const clinicId = String(item.clinicId || "");
    if (!clinicId) continue;
    const hoursId = item.connectHoursId;
    const name = `clinic_${clinicId}_hours`;
    const tz = String(item.timeZone || item.timezone || "America/New_York");
    const config = buildHoursConfig(item);
    if (hoursId) {
      try {
        await connectClient.send(new CONNECT.UpdateHoursOfOperationCommand({
          InstanceId: instanceId,
          HoursOfOperationId: hoursId,
          Name: name,
          TimeZone: tz,
          Config: config,
          Description: `Hours for ${clinicId}`
        }));
      } catch {
      }
      continue;
    }
    try {
      const resp = await connectClient.send(new CONNECT.CreateHoursOfOperationCommand({
        InstanceId: instanceId,
        Name: name,
        TimeZone: tz,
        Config: config,
        Description: `Hours for ${clinicId}`,
        Tags: { clinicId }
      }));
      const newId = resp?.HoursOfOperationId;
      const newArn = resp?.HoursOfOperationArn;
      if (newId) {
        await ddb.send(new import_lib_dynamodb.UpdateCommand({
          TableName: TABLE,
          Key: { clinicId },
          UpdateExpression: "SET connectHoursId = :id, connectHoursArn = :arn",
          ExpressionAttributeValues: { ":id": newId, ":arn": newArn || null }
        }));
      }
    } catch {
    }
  }
  return { ok: true };
};
function buildHoursConfig(item) {
  const days = item.days || {};
  const map = { sun: "SUNDAY", mon: "MONDAY", tue: "TUESDAY", wed: "WEDNESDAY", thu: "THURSDAY", fri: "FRIDAY", sat: "SATURDAY" };
  const configs = [];
  for (const [key, value] of Object.entries(map)) {
    const ranges = days[key] || [];
    for (const r of ranges) {
      const [sh, sm] = String(r.start || "09:00").split(":").map((n) => parseInt(n, 10));
      const [eh, em] = String(r.end || "17:00").split(":").map((n) => parseInt(n, 10));
      configs.push({
        Day: value,
        StartTime: { Hours: sh, Minutes: sm },
        EndTime: { Hours: eh, Minutes: em }
      });
    }
  }
  if (configs.length === 0) {
    configs.push({ Day: "SUNDAY", StartTime: { Hours: 0, Minutes: 0 }, EndTime: { Hours: 23, Minutes: 59 } });
  }
  return configs;
}
function arnTail(arn) {
  const parts = String(arn).split("/");
  return parts[parts.length - 1] || arn;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
