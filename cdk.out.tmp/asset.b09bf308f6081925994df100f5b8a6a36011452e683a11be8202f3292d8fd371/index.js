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

// src/services/lease-management/parseDocumentForAutofill.ts
var parseDocumentForAutofill_exports = {};
__export(parseDocumentForAutofill_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(parseDocumentForAutofill_exports);
var import_client_textract = require("@aws-sdk/client-textract");
var import_client_s3 = require("@aws-sdk/client-s3");
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

// src/services/lease-management/parseDocumentForAutofill.ts
var textractClient = new import_client_textract.TextractClient({});
var s3Client = new import_client_s3.S3Client({});
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET;
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var LEGAL_MODULE = "Legal";
var FIELD_MAPPINGS = {
  // Property Information
  "property_address": "propertyInformation.address",
  "address": "propertyInformation.address",
  "street_address": "propertyInformation.address",
  "suite": "propertyInformation.addressLine2",
  "unit": "propertyInformation.addressLine2",
  "city": "propertyInformation.city",
  "state": "propertyInformation.state",
  "zip": "propertyInformation.zip",
  "zip_code": "propertyInformation.zip",
  "postal_code": "propertyInformation.zip",
  "landlord": "propertyInformation.landlord",
  "landlord_name": "propertyInformation.landlord",
  "lessor": "propertyInformation.landlord",
  "property_manager": "propertyInformation.propertyManager",
  "management_company": "propertyInformation.propertyManager",
  "property_type": "propertyInformation.propertyType",
  "square_feet": "leaseTerms.sqft",
  "sqft": "leaseTerms.sqft",
  "square_footage": "leaseTerms.sqft",
  "rentable_area": "leaseTerms.sqft",
  // Financial Details
  "monthly_rent": "financialDetails.baseRent",
  "base_rent": "financialDetails.baseRent",
  "rent": "financialDetails.baseRent",
  "rent_amount": "financialDetails.baseRent",
  "cam": "financialDetails.camCharges",
  "cam_charges": "financialDetails.camCharges",
  "common_area_maintenance": "financialDetails.camCharges",
  "security_deposit": "financialDetails.securityDeposit",
  "deposit": "financialDetails.securityDeposit",
  "total_rent": "financialDetails.currentRentInclCAM",
  "total_monthly": "financialDetails.currentRentInclCAM",
  // Lease Terms
  "lease_start": "leaseTerms.startDate",
  "start_date": "leaseTerms.startDate",
  "commencement_date": "leaseTerms.startDate",
  "lease_end": "leaseTerms.endDate",
  "end_date": "leaseTerms.endDate",
  "expiration_date": "leaseTerms.endDate",
  "termination_date": "leaseTerms.endDate",
  "lease_term": "leaseTerms.termLength",
  "term": "leaseTerms.termLength",
  "term_length": "leaseTerms.termLength",
  "lease_type": "leaseTerms.leaseType"
};
var handler = async (event) => {
  console.log("Parse Document for Autofill Event:", JSON.stringify(event, null, 2));
  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: "Unauthorized" });
    }
    if (!event.body) {
      return createResponse(400, { success: false, error: "Request body is required" });
    }
    const { fileKey, clinicId } = JSON.parse(event.body);
    const clinic = event.headers["x-clinic-id"] || clinicId;
    if (!clinic) {
      return createResponse(400, { success: false, error: "clinicId is required" });
    }
    if (!fileKey) {
      return createResponse(400, { success: false, error: "fileKey is required" });
    }
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      "read",
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinic
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: "Permission denied" });
    }
    const headResult = await s3Client.send(new import_client_s3.HeadObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey
    }));
    const contentType = headResult.ContentType || "";
    const isPdf = fileKey.toLowerCase().endsWith(".pdf") || contentType.includes("pdf");
    const isImage = /\.(png|jpg|jpeg)$/i.test(fileKey) || contentType.includes("image");
    if (!isPdf && !isImage) {
      return createResponse(400, {
        success: false,
        error: "Unsupported file format. Please upload PDF, PNG, or JPEG."
      });
    }
    const filename = fileKey.split("/").pop() || "";
    const docIdMatch = filename.match(/^(DOC-[a-zA-Z0-9]+)/);
    const documentId = docIdMatch ? docIdMatch[1] : null;
    if (documentId) {
      const existingData = await getExistingExtractedData(clinic, documentId);
      if (existingData) {
        console.log("Using existing extracted data for document:", documentId);
        const formData2 = mapToFormFields(existingData.fields || {});
        return createResponse(200, {
          success: true,
          data: {
            formData: formData2,
            rawFields: existingData.fields || {},
            tables: existingData.tables || [],
            rentSchedule: extractRentSchedule(existingData.tables || []),
            confidence: existingData.extraction?.averageConfidence || 0,
            unmappedFields: getUnmappedFields(existingData.fields || {}),
            source: "cached"
          },
          message: "Document data retrieved from cache"
        });
      }
    }
    console.log("No cached data found, processing with Textract...");
    let blocks = [];
    if (isPdf) {
      console.log("Processing PDF with async Textract API...");
      blocks = await processWithAsyncTextract(fileKey);
    } else {
      console.log("Processing image with sync Textract API...");
      const s3Response = await s3Client.send(new import_client_s3.GetObjectCommand({
        Bucket: LEASE_DOCUMENTS_BUCKET,
        Key: fileKey
      }));
      const documentBytes = await s3Response.Body?.transformToByteArray();
      if (!documentBytes) {
        return createResponse(400, { success: false, error: "Could not read document" });
      }
      const analyzeResult = await textractClient.send(new import_client_textract.AnalyzeDocumentCommand({
        Document: { Bytes: documentBytes },
        FeatureTypes: [import_client_textract.FeatureType.FORMS, import_client_textract.FeatureType.TABLES]
      }));
      blocks = analyzeResult.Blocks || [];
    }
    const extractedData = extractAllData(blocks);
    const formData = mapToFormFields(extractedData.fields);
    const rentSchedule = extractRentSchedule(extractedData.tables);
    return createResponse(200, {
      success: true,
      data: {
        formData,
        rawFields: extractedData.fields,
        tables: extractedData.tables,
        rentSchedule,
        confidence: extractedData.averageConfidence,
        unmappedFields: getUnmappedFields(extractedData.fields)
      },
      message: "Document parsed successfully"
    });
  } catch (error) {
    console.error("Error parsing document:", error);
    return createResponse(500, { success: false, error: "Internal server error", message: error.message });
  }
};
async function processWithAsyncTextract(fileKey) {
  const startResult = await textractClient.send(new import_client_textract.StartDocumentAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: LEASE_DOCUMENTS_BUCKET, Name: fileKey } },
    FeatureTypes: [import_client_textract.FeatureType.FORMS, import_client_textract.FeatureType.TABLES]
  }));
  const jobId = startResult.JobId;
  console.log("Started Textract job:", jobId);
  const allBlocks = [];
  let nextToken;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3e3));
    const result = await textractClient.send(new import_client_textract.GetDocumentAnalysisCommand({
      JobId: jobId,
      NextToken: nextToken
    }));
    if (result.JobStatus === "SUCCEEDED") {
      allBlocks.push(...result.Blocks || []);
      if (result.NextToken) {
        nextToken = result.NextToken;
        continue;
      }
      console.log("Textract job completed, blocks:", allBlocks.length);
      return allBlocks;
    } else if (result.JobStatus === "FAILED") {
      throw new Error(`Textract job failed: ${result.StatusMessage}`);
    }
  }
  throw new Error("Textract job timed out after 90 seconds");
}
async function getExistingExtractedData(clinicId, documentId) {
  try {
    const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: LEASE_TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK = :sk",
      ExpressionAttributeValues: {
        ":pk": `CLINIC#${clinicId}`,
        ":sk": `EXTRACTED#${documentId}`
      }
    }));
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    return null;
  } catch (error) {
    console.error("Error fetching existing extracted data:", error);
    return null;
  }
}
function extractAllData(blocks) {
  const blockMap = {};
  blocks.forEach((block) => {
    blockMap[block.Id] = block;
  });
  const fields = {};
  const tables = [];
  let totalConfidence = 0;
  let confidenceCount = 0;
  const keyBlocks = blocks.filter((b) => b.BlockType === "KEY_VALUE_SET" && b.EntityTypes?.includes("KEY"));
  keyBlocks.forEach((keyBlock) => {
    const keyText = getTextFromBlock(keyBlock, blockMap);
    const valueBlock = findValueBlock(keyBlock, blockMap);
    const valueText = valueBlock ? getTextFromBlock(valueBlock, blockMap) : "";
    if (keyText?.trim()) {
      const cleanKey = normalizeKey(keyText);
      fields[cleanKey] = {
        value: valueText.trim(),
        originalKey: keyText.trim(),
        confidence: keyBlock.Confidence || 0,
        type: detectValueType(valueText.trim())
      };
      if (keyBlock.Confidence) {
        totalConfidence += keyBlock.Confidence;
        confidenceCount++;
      }
    }
  });
  blocks.filter((b) => b.BlockType === "TABLE").forEach((tableBlock, idx) => {
    const tableData = extractTableData(tableBlock, blockMap);
    if (tableData.rows.length > 0) {
      tables.push({
        tableIndex: idx,
        rows: tableData.rows,
        headers: tableData.headers,
        rowCount: tableData.rows.length
      });
    }
  });
  return {
    fields,
    tables,
    averageConfidence: confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount * 100) / 100 : 0
  };
}
function mapToFormFields(fields) {
  const formData = {
    propertyInformation: {},
    financialDetails: {},
    leaseTerms: {}
  };
  for (const [extractedKey, fieldData] of Object.entries(fields)) {
    const formPath = FIELD_MAPPINGS[extractedKey];
    if (formPath) {
      const [section, field] = formPath.split(".");
      let value = fieldData.value;
      if (fieldData.type === "currency") {
        value = parseFloat(value.replace(/[$,]/g, "")) || 0;
      } else if (fieldData.type === "number") {
        value = parseFloat(value.replace(/,/g, "")) || 0;
      } else if (fieldData.type === "date") {
        value = normalizeDate(value);
      }
      if (!formData[section])
        formData[section] = {};
      formData[section][field] = value;
    }
  }
  if (formData.financialDetails.baseRent && formData.financialDetails.camCharges) {
    formData.financialDetails.currentRentInclCAM = formData.financialDetails.baseRent + formData.financialDetails.camCharges;
  }
  return formData;
}
function getUnmappedFields(fields) {
  const unmapped = {};
  for (const [key, fieldData] of Object.entries(fields)) {
    if (!FIELD_MAPPINGS[key]) {
      unmapped[fieldData.originalKey] = fieldData.value;
    }
  }
  return unmapped;
}
function extractRentSchedule(tables) {
  const schedule = [];
  for (const table of tables) {
    const headers = table.headers?.map((h) => h?.toLowerCase() || "") || [];
    const hasYearOrPeriod = headers.some((h) => h.includes("year") || h.includes("period") || h.includes("month"));
    const hasRent = headers.some((h) => h.includes("rent") || h.includes("amount") || h.includes("payment"));
    if (hasYearOrPeriod && hasRent) {
      for (let i = 1; i < table.rows.length; i++) {
        const row = table.rows[i];
        const entry = {};
        headers.forEach((header, idx) => {
          if (row[idx])
            entry[header || `col${idx}`] = row[idx];
        });
        if (Object.keys(entry).length > 0)
          schedule.push(entry);
      }
    }
  }
  return schedule;
}
function normalizeDate(dateStr) {
  if (!dateStr)
    return "";
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  ];
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format === formats[2]) {
        return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      } else {
        return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
      }
    }
  }
  return dateStr;
}
function getTextFromBlock(block, blockMap) {
  let text = "";
  block.Relationships?.forEach((rel) => {
    if (rel.Type === "CHILD") {
      rel.Ids.forEach((id) => {
        const child = blockMap[id];
        if (child?.BlockType === "WORD")
          text += child.Text + " ";
        else if (child?.BlockType === "SELECTION_ELEMENT") {
          text += child.SelectionStatus === "SELECTED" ? "[X] " : "[ ] ";
        }
      });
    }
  });
  return text.trim();
}
function findValueBlock(keyBlock, blockMap) {
  for (const rel of keyBlock.Relationships || []) {
    if (rel.Type === "VALUE")
      return blockMap[rel.Ids[0]];
  }
  return null;
}
function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/[:\-_\s]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
function detectValueType(value) {
  if (!value)
    return "empty";
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value))
    return "date";
  if (/^\$[\d,]+\.?\d*$/.test(value))
    return "currency";
  if (/^\d+\.?\d*\s*%$/.test(value))
    return "percentage";
  if (/^[\d,]+\.?\d*$/.test(value))
    return "number";
  return "text";
}
function extractTableData(tableBlock, blockMap) {
  const cells = [];
  const childRel = tableBlock.Relationships?.find((r) => r.Type === "CHILD");
  childRel?.Ids.forEach((id) => {
    const cell = blockMap[id];
    if (cell?.BlockType === "CELL") {
      cells.push({ rowIndex: cell.RowIndex, colIndex: cell.ColumnIndex, text: getTextFromBlock(cell, blockMap) });
    }
  });
  const rowMap = {};
  cells.forEach((cell) => {
    if (!rowMap[cell.rowIndex])
      rowMap[cell.rowIndex] = [];
    rowMap[cell.rowIndex][cell.colIndex - 1] = cell.text;
  });
  const rows = Object.keys(rowMap).sort((a, b) => Number(a) - Number(b)).map((idx) => rowMap[Number(idx)]);
  return { rows, headers: rows.length > 0 ? rows[0] : [] };
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
