"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/lease-management/uploadDocument.ts
var uploadDocument_exports = {};
__export(uploadDocument_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(uploadDocument_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

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

// src/services/lease-management/uploadDocument.ts
var s3Client = new import_client_s3.S3Client({});
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET;
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var handler = async (event) => {
  console.log("Upload Document Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    if (!event.body) {
      return createResponse(400, { success: false, error: "Request body is required" });
    }
    const { clinicId, leaseId, fileName, contentType, documentType, description } = JSON.parse(event.body);
    const clinic = event.headers["x-clinic-id"] || clinicId;
    if (!clinic) {
      return createResponse(400, { success: false, error: "clinicId is required" });
    }
    const canUpload = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "write",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinic
    );
    if (!canUpload) {
      return createResponse(403, { success: false, error: "Permission denied. Legal module access required." });
    }
    if (!fileName || !contentType) {
      return createResponse(400, { success: false, error: "fileName and contentType are required" });
    }
    const uploadedBy = userPerms.email || "unknown";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const documentId = `DOC-${v4_default().substring(0, 8)}`;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileKey = leaseId ? `${clinic}/${leaseId}/${documentId}-${sanitizedFileName}` : `${clinic}/temp/${documentId}-${sanitizedFileName}`;
    const command = new import_client_s3.PutObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey,
      ContentType: contentType,
      Metadata: {
        "clinic-id": clinic,
        "lease-id": leaseId || "pending",
        "document-type": documentType || "Other",
        "description": description || "",
        "original-filename": fileName,
        "uploaded-by": uploadedBy,
        "document-id": documentId
      }
    });
    const uploadUrl = await (0, import_s3_request_presigner.getSignedUrl)(s3Client, command, { expiresIn: 900 });
    if (leaseId) {
      await addDocumentToLease(clinic, leaseId, {
        documentId,
        fileKey,
        fileName: sanitizedFileName,
        originalFileName: fileName,
        contentType,
        type: documentType || "Other",
        description: description || "",
        uploadedBy,
        uploadedAt: now,
        extractionStatus: "pending",
        hasExtractedData: false
      });
    }
    return createResponse(200, {
      success: true,
      data: {
        uploadUrl,
        fileKey,
        documentId,
        bucket: LEASE_DOCUMENTS_BUCKET,
        expiresIn: 900,
        leaseId: leaseId || null
      },
      message: "Upload URL generated successfully"
    });
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
async function addDocumentToLease(clinicId, leaseId, documentInfo) {
  try {
    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;
    const existing = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK }
    }));
    if (!existing.Item) {
      console.log(`Lease not found for ${clinicId}/${leaseId}, document will be linked after Textract processing`);
      return;
    }
    const documents = existing.Item.documents || [];
    const existingIndex = documents.findIndex((doc) => doc.documentId === documentInfo.documentId);
    if (existingIndex >= 0) {
      documents[existingIndex] = { ...documents[existingIndex], ...documentInfo };
    } else {
      documents.push(documentInfo);
    }
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: "SET #documents = :documents, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#documents": "documents",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":documents": documents,
        ":updatedAt": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    console.log(`Added document ${documentInfo.documentId} to lease ${leaseId}`);
  } catch (error) {
    console.error("Error adding document to lease:", error);
  }
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
