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

// src/services/lease-management/getExtractedData.ts
var getExtractedData_exports = {};
__export(getExtractedData_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(getExtractedData_exports);
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

// src/services/lease-management/getExtractedData.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var handler = async (event) => {
  console.log("Get Extracted Data Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    const clinicId = event.headers["x-clinic-id"] || event.queryStringParameters?.clinicId;
    const documentId = event.queryStringParameters?.documentId;
    const leaseId = event.queryStringParameters?.leaseId;
    if (!clinicId) {
      return createResponse(400, { success: false, error: "clinicId is required" });
    }
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "read",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: "Permission denied. Legal module access required." });
    }
    if (documentId) {
      const result = await docClient.send(new import_lib_dynamodb.GetCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK: `CLINIC#${clinicId}`, SK: `EXTRACTED#${documentId}` }
      }));
      if (!result.Item) {
        return createResponse(404, { success: false, error: "Extracted data not found" });
      }
      return createResponse(200, {
        success: true,
        data: formatExtractedDocument(result.Item)
      });
    } else {
      const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
        TableName: LEASE_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CLINIC#${clinicId}`,
          ":sk": "EXTRACTED#"
        }
      }));
      let extractedDocs = (result.Items || []).map(formatExtractedDocument);
      if (leaseId) {
        extractedDocs = extractedDocs.filter((doc) => doc.leaseId === leaseId);
      }
      extractedDocs.sort(
        (a, b) => new Date(b.processedAt || b.createdAt).getTime() - new Date(a.processedAt || a.createdAt).getTime()
      );
      return createResponse(200, {
        success: true,
        data: extractedDocs,
        count: extractedDocs.length
      });
    }
  } catch (error) {
    console.error("Error getting extracted data:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
function formatExtractedDocument(item) {
  return {
    documentId: item.documentId || item.SK?.replace("EXTRACTED#", ""),
    clinicId: item.PK?.replace("CLINIC#", ""),
    leaseId: item.leaseId || item.source?.leaseId,
    documentType: item.documentType,
    source: {
      bucket: item.source?.bucket,
      fileKey: item.source?.key || item.source?.fileKey,
      filename: item.source?.filename,
      processedAt: item.source?.processedAt,
      textractJobId: item.source?.textractJobId
    },
    fields: item.fields || {},
    tables: item.tables || [],
    rawText: item.rawText,
    lines: item.lines || [],
    extraction: {
      totalFields: item.extraction?.totalFields || Object.keys(item.fields || {}).length,
      totalTables: item.extraction?.totalTables || (item.tables || []).length,
      totalLines: item.extraction?.totalLines || (item.lines || []).length,
      averageConfidence: item.extraction?.averageConfidence || 0
    },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    processedAt: item.source?.processedAt || item.createdAt
  };
}
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
