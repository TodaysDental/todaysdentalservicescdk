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

// src/services/connect/phone-association-handler.ts
var phone_association_handler_exports = {};
__export(phone_association_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(phone_association_handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var client = new import_client_connect.ConnectClient({});
function parseInstanceId(instanceArn) {
  const m = instanceArn.match(/instance\/([a-f0-9-]+)/);
  if (!m)
    throw new Error(`Could not parse instanceId from InstanceArn: ${instanceArn}`);
  return m[1];
}
function parseContactFlowId(contactFlowArn) {
  const m = contactFlowArn.match(/contact-flow\/([a-f0-9-]+)/);
  if (!m)
    throw new Error(`Could not parse contactFlowId from ContactFlowArn: ${contactFlowArn}`);
  return m[1];
}
async function findPhoneNumberByE164(instanceArn, phoneNumber) {
  let nextToken;
  do {
    const listResult = await client.send(new import_client_connect.ListPhoneNumbersV2Command({
      TargetArn: instanceArn,
      PhoneNumberTypes: ["DID", "TOLL_FREE"],
      MaxResults: 100,
      NextToken: nextToken
    }));
    const phoneList = listResult.ListPhoneNumbersSummaryList || [];
    const match = phoneList.find((p) => p.PhoneNumber === phoneNumber);
    if (match)
      return match;
    nextToken = listResult.NextToken;
  } while (nextToken);
  throw new Error(`Phone number ${phoneNumber} not found in Connect instance ${instanceArn}`);
}
async function handler(event) {
  console.log("Phone Association Event:", JSON.stringify(event, null, 2));
  const { InstanceArn, PhoneNumber, ContactFlowArn } = event.ResourceProperties;
  const physicalResourceId = event.PhysicalResourceId || `phone-assoc-${PhoneNumber.replace(/\D/g, "")}`;
  const instanceId = parseInstanceId(InstanceArn);
  if (event.RequestType === "Delete") {
    try {
      const phoneEntry2 = await findPhoneNumberByE164(InstanceArn, PhoneNumber);
      if (phoneEntry2.PhoneNumberId) {
        await client.send(new import_client_connect.DisassociatePhoneNumberContactFlowCommand({
          InstanceId: instanceId,
          PhoneNumberId: phoneEntry2.PhoneNumberId
        }));
        console.log(`Disassociated phone number ${PhoneNumber} (${phoneEntry2.PhoneNumberId}) from contact flow`);
      }
    } catch (e) {
      console.warn("Phone disassociation skipped/failed (best-effort):", e);
    }
    return { PhysicalResourceId: physicalResourceId };
  }
  const phoneEntry = await findPhoneNumberByE164(InstanceArn, PhoneNumber);
  if (!phoneEntry.PhoneNumberId) {
    throw new Error(`ListPhoneNumbersV2 did not return PhoneNumberId for ${PhoneNumber}`);
  }
  const contactFlowId = parseContactFlowId(ContactFlowArn);
  console.log(`Associating phone ${phoneEntry.PhoneNumberId} with flow ${contactFlowId} in instance ${instanceId}`);
  await client.send(new import_client_connect.AssociatePhoneNumberContactFlowCommand({
    InstanceId: instanceId,
    PhoneNumberId: phoneEntry.PhoneNumberId,
    ContactFlowId: contactFlowId
  }));
  console.log(`Successfully associated ${PhoneNumber} with flow ${ContactFlowArn}`);
  return {
    PhysicalResourceId: physicalResourceId,
    Data: {
      PhoneNumberId: phoneEntry.PhoneNumberId,
      PhoneNumberArn: phoneEntry.PhoneNumberArn
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
