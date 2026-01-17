// src/services/accounting/index.ts
import { DynamoDBClient as DynamoDBClient2 } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand as QueryCommand2,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TextractClient } from "@aws-sdk/client-textract";

// node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
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
import crypto2 from "crypto";
var native_default = {
  randomUUID: crypto2.randomUUID
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

// src/shared/utils/secrets-helper.ts
import { DynamoDBClient, GetItemCommand, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoClient = null;
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({});
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
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    }));
    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }
    const config = unmarshall(response.Item);
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}

// src/shared/utils/permissions-helper.ts
import { inflateSync } from "zlib";
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
      const json = inflateSync(Buffer.from(b64, "base64")).toString("utf-8");
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
function getAllowedClinicIds(clinicRoles, isSuperAdmin, isGlobalSuperAdmin) {
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return /* @__PURE__ */ new Set(["*"]);
  }
  const clinicIds = clinicRoles.map((cr) => cr.clinicId);
  return new Set(clinicIds);
}
function hasClinicAccess(allowedClinics, clinicId) {
  return allowedClinics.has("*") || allowedClinics.has(clinicId);
}

// src/services/accounting/index.ts
var INVOICES_TABLE = process.env.INVOICES_TABLE;
var BANK_STATEMENTS_TABLE = process.env.BANK_STATEMENTS_TABLE;
var OPENDENTAL_REPORTS_TABLE = process.env.OPENDENTAL_REPORTS_TABLE;
var RECONCILIATION_TABLE = process.env.RECONCILIATION_TABLE;
var COLUMN_CONFIG_TABLE = process.env.COLUMN_CONFIG_TABLE;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient2({}));
var s3 = new S3Client({});
var textract = new TextractClient({});
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
};
var httpErr = (code, message) => ({
  statusCode: code,
  headers: corsHeaders,
  body: JSON.stringify({ success: false, message })
});
var httpOk = (data) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
var httpCreated = (data) => ({
  statusCode: 201,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data })
});
function hasClinicAccess2(allowedClinics, clinicId) {
  return hasClinicAccess(allowedClinics, clinicId);
}
function getAllowedClinics(userPerms) {
  return getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
}
async function handler(event) {
  console.log("[Accounting] Event:", JSON.stringify(event, null, 2));
  const method = event.httpMethod || event.requestContext?.http?.method;
  let path = event.path || event.rawPath || "";
  path = path.replace(/^\/accounting/, "");
  if (method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, "Unauthorized: No authorizer context or invalid permissions");
  }
  const allowedClinics = getAllowedClinics(userPerms);
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};
  let body = {};
  try {
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }
  } catch {
    return httpErr(400, "Invalid JSON body");
  }
  try {
    if (method === "GET" && path.match(/^\/invoices\/?$/)) {
      const { clinicId } = queryParams;
      if (!clinicId)
        return httpErr(400, "clinicId is required");
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await listInvoices(clinicId);
    }
    if (method === "POST" && path.match(/^\/invoices\/upload\/?$/)) {
      const { clinicId, source, fileName, contentType } = body;
      if (!clinicId || !source || !fileName) {
        return httpErr(400, "clinicId, source, and fileName are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await createInvoiceUploadUrl(clinicId, source, fileName, contentType || "application/pdf");
    }
    if (method === "GET" && pathParams.invoiceId) {
      return await getInvoice(pathParams.invoiceId, allowedClinics);
    }
    if (method === "PUT" && pathParams.invoiceId) {
      return await updateInvoice(pathParams.invoiceId, body, allowedClinics);
    }
    if (method === "DELETE" && pathParams.invoiceId) {
      return await deleteInvoice(pathParams.invoiceId, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/brs\/open-dental\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd } = queryParams;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, paymentMode, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await fetchOpenDentalPayments(clinicId, paymentMode, dateStart, dateEnd);
    }
    if (method === "GET" && path.match(/^\/brs\/odoo\/?$/)) {
      const { clinicId, dateStart, dateEnd } = queryParams;
      if (!clinicId || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await fetchOdooBankTransactions(clinicId, dateStart, dateEnd);
    }
    if (method === "POST" && path.match(/^\/brs\/bank-file\/upload\/?$/)) {
      const { clinicId, paymentMode, fileName, contentType } = body;
      if (!clinicId || !paymentMode || !fileName) {
        return httpErr(400, "clinicId, paymentMode, and fileName are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await createBankFileUploadUrl(clinicId, paymentMode, fileName, contentType || "text/csv");
    }
    if (method === "GET" && path.match(/^\/brs\/bank-file\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, "clinicId and paymentMode are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await getBankStatements(clinicId, paymentMode);
    }
    if (method === "POST" && path.match(/^\/brs\/reconcile\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd, bankStatementId } = body;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, "clinicId, paymentMode, dateStart, dateEnd are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await generateReconciliation(clinicId, paymentMode, dateStart, dateEnd, bankStatementId);
    }
    if (method === "GET" && pathParams.reconciliationId) {
      return await getReconciliation(pathParams.reconciliationId, allowedClinics);
    }
    if (method === "POST" && path.match(/^\/brs\/approve\/?$/)) {
      const { reconciliationId } = body;
      if (!reconciliationId) {
        return httpErr(400, "reconciliationId is required");
      }
      return await approveReconciliation(reconciliationId, userPerms, allowedClinics);
    }
    if (method === "GET" && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, "clinicId and paymentMode are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await getColumnConfig(clinicId, paymentMode);
    }
    if (method === "PUT" && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode, columns } = body;
      if (!clinicId || !paymentMode || !columns) {
        return httpErr(400, "clinicId, paymentMode, and columns are required");
      }
      if (!hasClinicAccess2(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
      }
      return await updateColumnConfig(clinicId, paymentMode, columns, userPerms.email);
    }
    return httpErr(404, `Not found: ${method} ${path}`);
  } catch (error) {
    console.error("[Accounting] Error:", error);
    return httpErr(500, error.message || "Internal server error");
  }
}
async function listInvoices(clinicId) {
  const { Items } = await ddb.send(new QueryCommand2({
    TableName: INVOICES_TABLE,
    IndexName: "byClinic",
    KeyConditionExpression: "clinicId = :clinicId",
    ExpressionAttributeValues: { ":clinicId": clinicId },
    ScanIndexForward: false
    // Most recent first
  }));
  return httpOk({ invoices: Items || [] });
}
async function createInvoiceUploadUrl(clinicId, source, fileName, contentType) {
  const invoiceId = v4_default();
  const s3Key = `invoices/${clinicId}/${invoiceId}/${fileName}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const invoice = {
    invoiceId,
    clinicId,
    source,
    status: "SCANNED",
    fileUrl: `https://${DOCUMENTS_BUCKET}.s3.amazonaws.com/${s3Key}`,
    s3Key,
    createdAt: now
  };
  await ddb.send(new PutCommand({
    TableName: INVOICES_TABLE,
    Item: invoice
  }));
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType
    }),
    { expiresIn: 3600 }
  );
  return httpCreated({ invoiceId, uploadUrl, s3Key });
}
async function getInvoice(invoiceId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  return httpOk({ invoice: Item });
}
async function updateInvoice(invoiceId, updates, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  const updateExpressions = [];
  const expressionValues = {};
  const expressionNames = {};
  if (updates.vendorName !== void 0) {
    updateExpressions.push("#vendorName = :vendorName");
    expressionNames["#vendorName"] = "vendorName";
    expressionValues[":vendorName"] = updates.vendorName;
  }
  if (updates.vendorId !== void 0) {
    updateExpressions.push("#vendorId = :vendorId");
    expressionNames["#vendorId"] = "vendorId";
    expressionValues[":vendorId"] = updates.vendorId;
  }
  if (updates.dueDate !== void 0) {
    updateExpressions.push("#dueDate = :dueDate");
    expressionNames["#dueDate"] = "dueDate";
    expressionValues[":dueDate"] = updates.dueDate;
  }
  if (updates.amount !== void 0) {
    updateExpressions.push("#amount = :amount");
    expressionNames["#amount"] = "amount";
    expressionValues[":amount"] = updates.amount;
  }
  if (updates.status !== void 0) {
    updateExpressions.push("#status = :status");
    expressionNames["#status"] = "status";
    expressionValues[":status"] = updates.status;
  }
  updateExpressions.push("#updatedAt = :updatedAt");
  expressionNames["#updatedAt"] = "updatedAt";
  expressionValues[":updatedAt"] = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues
  }));
  return httpOk({ invoiceId, message: "Invoice updated successfully" });
}
async function deleteInvoice(invoiceId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  if (!Item)
    return httpErr(404, "Invoice not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  await ddb.send(new DeleteCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId }
  }));
  return httpOk({ message: "Invoice deleted successfully" });
}
async function fetchOpenDentalPayments(clinicId, paymentMode, dateStart, dateEnd) {
  const reportId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const report = {
    reportId,
    clinicId,
    paymentMode,
    reportDate: now,
    dateStart,
    dateEnd,
    rows: [],
    createdAt: now
  };
  return httpOk({ report });
}
async function fetchOdooBankTransactions(clinicId, dateStart, dateEnd) {
  const clinicConfig = await getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }
  const odooCompanyId = clinicConfig.odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }
  return httpOk({
    clinicId,
    odooCompanyId,
    dateStart,
    dateEnd,
    transactions: []
  });
}
async function createBankFileUploadUrl(clinicId, paymentMode, fileName, contentType) {
  const bankStatementId = v4_default();
  const s3Key = `bank-files/${clinicId}/${paymentMode}/${bankStatementId}/${fileName}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const bankStatement = {
    bankStatementId,
    clinicId,
    paymentMode,
    uploadDate: now,
    s3FileKey: s3Key,
    fileName,
    parsedRows: [],
    status: "UPLOADED"
  };
  await ddb.send(new PutCommand({
    TableName: BANK_STATEMENTS_TABLE,
    Item: bankStatement
  }));
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType
    }),
    { expiresIn: 3600 }
  );
  return httpCreated({ bankStatementId, uploadUrl, s3Key });
}
async function getBankStatements(clinicId, paymentMode) {
  const { Items } = await ddb.send(new QueryCommand2({
    TableName: BANK_STATEMENTS_TABLE,
    IndexName: "byClinic",
    KeyConditionExpression: "clinicId = :clinicId",
    FilterExpression: "paymentMode = :paymentMode",
    ExpressionAttributeValues: {
      ":clinicId": clinicId,
      ":paymentMode": paymentMode
    },
    ScanIndexForward: false
  }));
  return httpOk({ bankStatements: Items || [] });
}
async function generateReconciliation(clinicId, paymentMode, dateStart, dateEnd, bankStatementId) {
  const reconciliationId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const reconciliation = {
    reconciliationId,
    clinicId,
    paymentMode,
    status: "DRAFT",
    dateStart,
    dateEnd,
    rows: [],
    createdAt: now
  };
  await ddb.send(new PutCommand({
    TableName: RECONCILIATION_TABLE,
    Item: reconciliation
  }));
  return httpCreated({ reconciliation });
}
async function getReconciliation(reconciliationId, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId }
  }));
  if (!Item)
    return httpErr(404, "Reconciliation not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  return httpOk({ reconciliation: Item });
}
async function approveReconciliation(reconciliationId, userPerms, allowedClinics) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId }
  }));
  if (!Item)
    return httpErr(404, "Reconciliation not found");
  if (!hasClinicAccess2(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }
  if (Item.status === "APPROVED") {
    return httpErr(400, "Reconciliation is already approved");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId },
    UpdateExpression: "SET #status = :status, approvedAt = :approvedAt, approvedBy = :approvedBy",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":status": "APPROVED",
      ":approvedAt": now,
      ":approvedBy": userPerms.email
    }
  }));
  return httpOk({ status: "APPROVED", approvedAt: now, approvedBy: userPerms.email });
}
async function getColumnConfig(clinicId, paymentMode) {
  const configKey = `${clinicId}#${paymentMode}`;
  const { Item } = await ddb.send(new GetCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Key: { configKey }
  }));
  if (!Item) {
    return httpOk({
      columnConfig: getDefaultColumnConfig(clinicId, paymentMode)
    });
  }
  return httpOk({ columnConfig: Item });
}
async function updateColumnConfig(clinicId, paymentMode, columns, updatedBy) {
  const configKey = `${clinicId}#${paymentMode}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const columnConfig = {
    configKey,
    clinicId,
    paymentMode,
    columns,
    updatedAt: now,
    updatedBy
  };
  await ddb.send(new PutCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Item: columnConfig
  }));
  return httpOk({ columnConfig });
}
function getDefaultColumnConfig(clinicId, paymentMode) {
  return {
    configKey: `${clinicId}#${paymentMode}`,
    clinicId,
    paymentMode,
    columns: [
      { key: "referenceId", label: "Reference ID", visible: true, order: 1 },
      { key: "patientName", label: "Patient Name", visible: true, order: 2 },
      { key: "expectedAmount", label: "Expected Amount", visible: true, order: 3 },
      { key: "receivedAmount", label: "Received Amount", visible: true, order: 4 },
      { key: "difference", label: "Difference", visible: true, order: 5 },
      { key: "status", label: "Status", visible: true, order: 6 },
      { key: "reason", label: "Reason", visible: true, order: 7 }
    ],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  handler
};
