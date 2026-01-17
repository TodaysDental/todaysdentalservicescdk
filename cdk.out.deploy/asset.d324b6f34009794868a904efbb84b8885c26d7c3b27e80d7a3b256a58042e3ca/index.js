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

// src/services/lease-management/listLeases.ts
var listLeases_exports = {};
__export(listLeases_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(listLeases_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// src/shared/utils/permissions-helper.ts
var import_zlib = require("zlib");
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
      const json = (0, import_zlib.inflateSync)(Buffer.from(b64, "base64")).toString("utf-8");
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
function isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin) {
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }
  for (const cr of clinicRoles) {
    if (cr.role === "Admin" || cr.role === "SuperAdmin" || cr.role === "Global super admin") {
      return true;
    }
  }
  return false;
}
function hasModulePermission(clinicRoles, module2, permission, isSuperAdmin, isGlobalSuperAdmin, clinicId) {
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }
  for (const cr of clinicRoles) {
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }
    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === module2);
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }
  return false;
}

// src/services/lease-management/listLeases.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var handler = async (event) => {
  console.log("List Leases Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    const clinicId = event.headers["x-clinic-id"] || event.queryStringParameters?.clinicId;
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "read",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId || void 0
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: "Permission denied. Legal module access required." });
    }
    const status = event.queryStringParameters?.status;
    const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 100;
    const lastKey = event.queryStringParameters?.lastEvaluatedKey;
    const includeDeleted = event.queryStringParameters?.includeDeleted === "true";
    let result;
    if (clinicId) {
      result = await docClient.send(new import_lib_dynamodb.QueryCommand({
        TableName: LEASE_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `CLINIC#${clinicId}`, ":sk": "LEASE#" },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : void 0
      }));
    } else if (status) {
      result = await docClient.send(new import_lib_dynamodb.QueryCommand({
        TableName: LEASE_TABLE_NAME,
        IndexName: "StatusIndex",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": status },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : void 0
      }));
    } else {
      result = await docClient.send(new import_lib_dynamodb.ScanCommand({
        TableName: LEASE_TABLE_NAME,
        FilterExpression: "begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":sk": "LEASE#" },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : void 0
      }));
    }
    let leases = result.Items || [];
    if (!includeDeleted) {
      leases = leases.filter((lease) => lease.status !== "Deleted");
    }
    leases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const tableData = leases.map((lease) => ({
      // Keys for operations
      clinicId: lease.propertyInformation?.clinicId || lease.PK?.replace("CLINIC#", ""),
      leaseId: lease.SK?.replace("LEASE#", ""),
      // Table columns
      clinicName: lease.propertyInformation?.clinicName || "",
      city: lease.propertyInformation?.city || "",
      state: lease.propertyInformation?.state || "",
      landlord: lease.propertyInformation?.landlord || "",
      rent: lease.financialDetails?.currentRentInclCAM || lease.financialDetails?.baseRent || 0,
      baseRent: lease.financialDetails?.baseRent || 0,
      startDate: lease.leaseTerms?.startDate || "",
      endDate: lease.leaseTerms?.endDate || "",
      sqft: lease.leaseTerms?.sqft || 0,
      termLength: lease.leaseTerms?.termLength || "",
      status: lease.leaseTerms?.status || lease.status || "",
      // Additional useful fields
      address: lease.propertyInformation?.address || "",
      propertyType: lease.propertyInformation?.propertyType || "",
      leaseType: lease.leaseTerms?.leaseType || "",
      securityDeposit: lease.financialDetails?.securityDeposit || 0,
      // Counts for quick reference
      documentsCount: lease.documents?.length || 0,
      assetsCount: lease.assets?.length || 0,
      eventsCount: lease.events?.length || 0,
      contactsCount: lease.contacts?.length || 0,
      // Timestamps and audit info
      createdAt: lease.createdAt,
      updatedAt: lease.updatedAt,
      createdBy: lease.createdBy || "",
      lastModifiedBy: lease.lastModifiedBy || ""
    }));
    return createResponse(200, {
      success: true,
      data: tableData,
      count: tableData.length,
      hasMore: !!result.LastEvaluatedKey,
      lastEvaluatedKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
    });
  } catch (error) {
    console.error("Error listing leases:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-clinic-id"
    },
    body: JSON.stringify(body)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
