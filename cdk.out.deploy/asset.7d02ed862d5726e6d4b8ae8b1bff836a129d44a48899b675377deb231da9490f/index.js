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

// src/services/lease-management/getDocument.ts
var getDocument_exports = {};
__export(getDocument_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(getDocument_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");

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

// src/services/lease-management/getDocument.ts
var s3Client = new import_client_s3.S3Client({});
var LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET;
var LEGAL_MODULE = "Legal";
var handler = async (event) => {
  console.log("Get Document Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    const fileKey = event.queryStringParameters?.fileKey;
    const documentId = event.queryStringParameters?.documentId;
    const clinicIdParam = event.queryStringParameters?.clinicId || event.headers["x-clinic-id"];
    const leaseId = event.queryStringParameters?.leaseId;
    let resolvedFileKey = fileKey;
    if (!resolvedFileKey && documentId && clinicIdParam && leaseId) {
      resolvedFileKey = await findFileKeyByDocumentId(clinicIdParam, leaseId, documentId) || void 0;
    }
    if (!resolvedFileKey) {
      return createResponse(400, {
        success: false,
        error: "fileKey is required, or provide documentId with clinicId and leaseId"
      });
    }
    const clinicId = resolvedFileKey.split("/")[0];
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
    let fileMetadata = {};
    try {
      const headResult = await s3Client.send(new import_client_s3.HeadObjectCommand({
        Bucket: LEASE_DOCUMENTS_BUCKET,
        Key: resolvedFileKey
      }));
      fileMetadata = {
        contentType: headResult.ContentType,
        contentLength: headResult.ContentLength,
        lastModified: headResult.LastModified,
        metadata: headResult.Metadata
      };
    } catch (headError) {
      if (headError.name === "NotFound" || headError.$metadata?.httpStatusCode === 404) {
        return createResponse(404, { success: false, error: "Document not found" });
      }
      throw headError;
    }
    const command = new import_client_s3.GetObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: resolvedFileKey
    });
    const downloadUrl = await (0, import_s3_request_presigner.getSignedUrl)(s3Client, command, { expiresIn: 3600 });
    const keyParts = resolvedFileKey.split("/");
    const filename = keyParts[keyParts.length - 1];
    const docIdMatch = filename.match(/^(DOC-[a-zA-Z0-9]+)/);
    const extractedDocId = docIdMatch ? docIdMatch[1] : null;
    return createResponse(200, {
      success: true,
      data: {
        downloadUrl,
        fileKey: resolvedFileKey,
        documentId: extractedDocId,
        clinicId,
        leaseId: keyParts[1] !== "temp" ? keyParts[1] : null,
        filename,
        originalFilename: fileMetadata.metadata?.["original-filename"] || filename,
        contentType: fileMetadata.contentType,
        contentLength: fileMetadata.contentLength,
        lastModified: fileMetadata.lastModified,
        expiresIn: 3600
      }
    });
  } catch (error) {
    console.error("Error generating download URL:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
async function findFileKeyByDocumentId(clinicId, leaseId, documentId) {
  try {
    const prefix = `${clinicId}/${leaseId}/${documentId}`;
    const result = await s3Client.send(new import_client_s3.ListObjectsV2Command({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Prefix: prefix,
      MaxKeys: 1
    }));
    if (result.Contents && result.Contents.length > 0) {
      return result.Contents[0].Key || null;
    }
    const tempPrefix = `${clinicId}/temp/${documentId}`;
    const tempResult = await s3Client.send(new import_client_s3.ListObjectsV2Command({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Prefix: tempPrefix,
      MaxKeys: 1
    }));
    if (tempResult.Contents && tempResult.Contents.length > 0) {
      return tempResult.Contents[0].Key || null;
    }
    return null;
  } catch (error) {
    console.error("Error finding file by documentId:", error);
    return null;
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
