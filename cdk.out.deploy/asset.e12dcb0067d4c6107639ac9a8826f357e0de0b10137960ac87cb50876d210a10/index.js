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

// src/services/lease-management/updateLease.ts
var updateLease_exports = {};
__export(updateLease_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(updateLease_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

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

// src/services/lease-management/updateLease.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var RESERVED_FIELDS = ["PK", "SK", "entityType", "createdAt", "createdBy", "auditLog"];
var MERGE_OBJECT_FIELDS = [
  "propertyInformation",
  "financialDetails",
  "leaseTerms",
  "renewalInformation",
  "paymentTerms",
  "clauses",
  "notesAndRemarks",
  "hiddenCharges",
  "customFields"
];
var MERGE_ARRAY_FIELDS = ["documents", "assets", "events", "contacts"];
var handler = async (event) => {
  console.log("Update Lease Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    const clinicId = event.pathParameters?.clinicId;
    const leaseId = event.pathParameters?.leaseId;
    if (!clinicId || !leaseId) {
      return createResponse(400, { success: false, error: "clinicId and leaseId are required" });
    }
    const canUpdate = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "put",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canUpdate) {
      return createResponse(403, { success: false, error: "Permission denied. Legal module access required." });
    }
    if (!event.body) {
      return createResponse(400, { success: false, error: "Request body is required" });
    }
    const updateInput = JSON.parse(event.body);
    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const modifiedBy = userPerms.email || "unknown";
    const existing = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: LEASE_TABLE_NAME, Key: { PK, SK } }));
    if (!existing.Item) {
      return createResponse(404, { success: false, error: "Lease not found" });
    }
    const updateExpressions = ["#updatedAt = :updatedAt", "#lastModifiedBy = :lastModifiedBy"];
    const expressionAttributeNames = {
      "#updatedAt": "updatedAt",
      "#lastModifiedBy": "lastModifiedBy"
    };
    const expressionAttributeValues = {
      ":updatedAt": now,
      ":lastModifiedBy": modifiedBy
    };
    const changes = [];
    for (const [field, value] of Object.entries(updateInput)) {
      if (RESERVED_FIELDS.includes(field)) {
        continue;
      }
      if (MERGE_OBJECT_FIELDS.includes(field) && typeof value === "object" && !Array.isArray(value)) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = { ...existing.Item[field] || {}, ...value };
        changes.push(`Updated ${field}`);
        continue;
      }
      if (MERGE_ARRAY_FIELDS.includes(field) && Array.isArray(value)) {
        const mergedArray = mergeArrayById(existing.Item[field] || [], value, field, modifiedBy, now);
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = mergedArray;
        changes.push(`Updated ${field} (${value.length} items)`);
        continue;
      }
      updateExpressions.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = value;
      changes.push(`Set ${field}`);
    }
    if (updateInput.leaseTerms?.status) {
      updateExpressions.push("#status = :status");
      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":status"] = updateInput.leaseTerms.status;
    }
    if (updateInput.leaseTerms?.endDate) {
      updateExpressions.push("#endDate = :endDate");
      expressionAttributeNames["#endDate"] = "endDate";
      expressionAttributeValues[":endDate"] = updateInput.leaseTerms.endDate;
    }
    const existingAuditLog = existing.Item.auditLog || [];
    const newAuditEntry = {
      action: "updated",
      timestamp: now,
      userId: modifiedBy,
      details: changes.length > 0 ? changes.join(", ") : "No changes detected"
    };
    updateExpressions.push("#auditLog = :auditLog");
    expressionAttributeNames["#auditLog"] = "auditLog";
    expressionAttributeValues[":auditLog"] = [...existingAuditLog, newAuditEntry];
    const result = await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW"
    }));
    console.log("Lease updated:", PK, SK, "by", modifiedBy, "changes:", changes);
    return createResponse(200, { success: true, data: result.Attributes, message: "Lease updated successfully" });
  } catch (error) {
    console.error("Error updating lease:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
function mergeArrayById(existingArray, newItems, fieldType, modifiedBy, now) {
  const idField = getIdFieldForType(fieldType);
  const idPrefix = getIdPrefixForType(fieldType);
  const resultMap = /* @__PURE__ */ new Map();
  existingArray.forEach((item) => {
    if (item[idField]) {
      resultMap.set(item[idField], item);
    }
  });
  newItems.forEach((item) => {
    const existingId = item[idField];
    if (item._delete === true && existingId && resultMap.has(existingId)) {
      resultMap.delete(existingId);
      return;
    }
    if (existingId && resultMap.has(existingId)) {
      const { _isNew, _delete, ...cleanItem } = item;
      resultMap.set(existingId, {
        ...resultMap.get(existingId),
        ...cleanItem,
        [idField]: existingId,
        lastModifiedBy: modifiedBy,
        lastModifiedAt: now
      });
    } else if (existingId && !resultMap.has(existingId)) {
      if (item._delete === true)
        return;
      const { _isNew, _delete, ...cleanItem } = item;
      resultMap.set(existingId, {
        ...cleanItem,
        [idField]: existingId,
        addedBy: item.addedBy || modifiedBy,
        addedAt: item.addedAt || now
      });
    } else if (!existingId) {
      const forceNew = item._isNew === true;
      const duplicateId = forceNew ? null : findDuplicateItem(item, existingArray, fieldType, idField);
      const { _isNew, _delete, ...cleanItem } = item;
      if (item._delete === true && duplicateId) {
        resultMap.delete(duplicateId);
        return;
      }
      if (duplicateId) {
        resultMap.set(duplicateId, {
          ...resultMap.get(duplicateId),
          ...cleanItem,
          [idField]: duplicateId,
          lastModifiedBy: modifiedBy,
          lastModifiedAt: now
        });
      } else if (!item._delete) {
        const newId = `${idPrefix}-${v4_default().substring(0, 8)}`;
        resultMap.set(newId, {
          ...cleanItem,
          [idField]: newId,
          addedBy: modifiedBy,
          addedAt: now
        });
      }
    }
  });
  return Array.from(resultMap.values());
}
function findDuplicateItem(newItem, existingArray, fieldType, idField) {
  for (const existing of existingArray) {
    if (!existing[idField])
      continue;
    if (isContentMatch(newItem, existing, fieldType)) {
      return existing[idField];
    }
  }
  return null;
}
function isContentMatch(newItem, existing, fieldType) {
  switch (fieldType) {
    case "documents":
      if (newItem.fileKey && existing.fileKey) {
        return newItem.fileKey === existing.fileKey;
      }
      if (newItem.fileName && existing.fileName) {
        return newItem.fileName === existing.fileName;
      }
      if (newItem.originalFileName && existing.originalFileName) {
        return newItem.originalFileName === existing.originalFileName;
      }
      return false;
    case "assets":
      if (newItem.name && existing.name) {
        const nameMatch = newItem.name.toLowerCase().trim() === existing.name.toLowerCase().trim();
        if (newItem.type && existing.type) {
          return nameMatch && newItem.type === existing.type;
        }
        return nameMatch;
      }
      return false;
    case "events":
      if (newItem.title && existing.title) {
        const titleMatch = newItem.title.toLowerCase().trim() === existing.title.toLowerCase().trim();
        const newDate = newItem.eventDate || newItem.date;
        const existDate = existing.eventDate || existing.date;
        if (newDate && existDate) {
          return titleMatch && newDate === existDate;
        }
        return titleMatch;
      }
      return false;
    case "contacts":
      if (newItem.email && existing.email) {
        return newItem.email.toLowerCase().trim() === existing.email.toLowerCase().trim();
      }
      if (newItem.phone && existing.phone) {
        const newPhone = newItem.phone.replace(/\D/g, "");
        const existPhone = existing.phone.replace(/\D/g, "");
        return newPhone === existPhone;
      }
      if (newItem.name && existing.name) {
        return newItem.name.toLowerCase().trim() === existing.name.toLowerCase().trim();
      }
      return false;
    default:
      return false;
  }
}
function getIdFieldForType(fieldType) {
  switch (fieldType) {
    case "documents":
      return "documentId";
    case "assets":
      return "assetId";
    case "events":
      return "eventId";
    case "contacts":
      return "contactId";
    default:
      return "id";
  }
}
function getIdPrefixForType(fieldType) {
  switch (fieldType) {
    case "documents":
      return "DOC";
    case "assets":
      return "AST";
    case "events":
      return "EVT";
    case "contacts":
      return "CON";
    default:
      return "ITM";
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
