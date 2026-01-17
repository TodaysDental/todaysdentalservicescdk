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
async function handler(event) {
  console.log("Phone Association Event:", JSON.stringify(event, null, 2));
  const { InstanceArn, PhoneNumber, ContactFlowArn } = event.ResourceProperties;
  const physicalResourceId = event.PhysicalResourceId || `phone-assoc-${PhoneNumber.replace(/\+/g, "")}`;
  try {
    switch (event.RequestType) {
      case "Create":
      case "Update": {
        console.log(`Looking up phone number ${PhoneNumber} in instance ${InstanceArn}`);
        const listResult = await client.send(new import_client_connect.ListPhoneNumbersV2Command({
          TargetArn: InstanceArn,
          PhoneNumberTypes: ["DID", "TOLL_FREE"],
          MaxResults: 100
        }));
        const phoneList = listResult.ListPhoneNumbersSummaryList || [];
        const phoneEntry = phoneList.find(
          (p) => p.PhoneNumber === PhoneNumber
        );
        if (!phoneEntry || !phoneEntry.PhoneNumberId) {
          throw new Error(
            `Phone number ${PhoneNumber} not found in Connect instance. Available numbers: ${phoneList.map((p) => p.PhoneNumber).join(", ") || "none"}`
          );
        }
        console.log(`Found phone number ID: ${phoneEntry.PhoneNumberId}`);
        const instanceIdMatch = InstanceArn.match(/instance\/([a-f0-9-]+)/);
        const flowIdMatch = ContactFlowArn.match(/contact-flow\/([a-f0-9-]+)/);
        if (!instanceIdMatch || !flowIdMatch) {
          throw new Error(
            `Could not parse instance ID or flow ID. InstanceArn: ${InstanceArn}, ContactFlowArn: ${ContactFlowArn}`
          );
        }
        const instanceId = instanceIdMatch[1];
        const contactFlowId = flowIdMatch[1];
        console.log(`Associating phone ${phoneEntry.PhoneNumberId} with flow ${contactFlowId} in instance ${instanceId}`);
        await client.send(new import_client_connect.AssociatePhoneNumberContactFlowCommand({
          InstanceId: instanceId,
          PhoneNumberId: phoneEntry.PhoneNumberId,
          ContactFlowId: contactFlowId
        }));
        console.log(`Successfully associated ${PhoneNumber} with flow ${ContactFlowArn}`);
        return {
          Status: "SUCCESS",
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          Data: {
            PhoneNumberId: phoneEntry.PhoneNumberId,
            PhoneNumberArn: phoneEntry.PhoneNumberArn
          }
        };
      }
      case "Delete": {
        console.log(`Delete requested - not disassociating phone number ${PhoneNumber}`);
        return {
          Status: "SUCCESS",
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId
        };
      }
      default: {
        const exhaustiveCheck = event.RequestType;
        throw new Error(`Unknown request type: ${exhaustiveCheck}`);
      }
    }
  } catch (error) {
    console.error("Phone association error:", error);
    return {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
