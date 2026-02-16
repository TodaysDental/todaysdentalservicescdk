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

// src/services/clinic/budgetSeeder.ts
var budgetSeeder_exports = {};
__export(budgetSeeder_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(budgetSeeder_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.CLINIC_BUDGET_TABLE || "ClinicDailyBudget";
var INITIAL_DATA = process.env.INITIAL_DATA || "[]";
var handler = async (event) => {
  console.log("Seeder event:", JSON.stringify(event, null, 2));
  const requestType = event.RequestType;
  try {
    if (requestType === "Create" || requestType === "Update") {
      const items = JSON.parse(INITIAL_DATA);
      console.log(`Seeding ${items.length} clinic budget records...`);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const batchSize = 25;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const putRequests = batch.map((item) => ({
          PutRequest: {
            Item: {
              clinicName: item.clinicName,
              dailyBudget: item.dailyBudget,
              currency: "USD",
              createdAt: now,
              updatedAt: now,
              updatedBy: "system-seeder"
            }
          }
        }));
        await ddb.send(new import_lib_dynamodb.BatchWriteCommand({
          RequestItems: {
            [TABLE]: putRequests
          }
        }));
        console.log(`Seeded batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)`);
      }
      console.log("Seeding completed successfully");
    } else if (requestType === "Delete") {
      console.log("Delete request - data will be retained");
    }
    return {
      Status: "SUCCESS",
      PhysicalResourceId: `clinic-budget-seeder-${event.LogicalResourceId}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {
        Message: `Successfully processed ${requestType} request`
      }
    };
  } catch (error) {
    console.error("Seeder error:", error);
    return {
      Status: "FAILED",
      Reason: error.message || "Unknown error during seeding",
      PhysicalResourceId: `clinic-budget-seeder-${event.LogicalResourceId}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
