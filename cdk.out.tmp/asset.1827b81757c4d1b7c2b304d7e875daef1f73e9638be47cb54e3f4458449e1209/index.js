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

// src/services/lease-management/processDocument.ts
var processDocument_exports = {};
__export(processDocument_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(processDocument_exports);
var import_client_textract = require("@aws-sdk/client-textract");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_s3 = require("@aws-sdk/client-s3");
var textractClient = new import_client_textract.TextractClient({});
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var s3Client = new import_client_s3.S3Client({});
var LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME;
var handler = async (event) => {
  console.log("Process Document Event:", JSON.stringify(event, null, 2));
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    if (!key.match(/\.(pdf|png|jpg|jpeg|tiff)$/i)) {
      console.log("Skipping non-document file:", key);
      continue;
    }
    try {
      const headResult = await s3Client.send(new import_client_s3.HeadObjectCommand({ Bucket: bucket, Key: key }));
      const metadata = headResult.Metadata || {};
      const clinicId = metadata["clinic-id"] || extractClinicIdFromKey(key);
      const leaseId = metadata["lease-id"] || extractLeaseIdFromKey(key);
      const documentType = metadata["document-type"] || "Document";
      const originalFilename = metadata["original-filename"] || key.split("/").pop();
      const filename = key.split("/").pop() || "";
      const docIdMatch = filename.match(/^(DOC-[a-zA-Z0-9]+)/);
      const documentId = docIdMatch ? docIdMatch[1] : `DOC-${Date.now()}`;
      console.log(`Processing: ${key} | Clinic: ${clinicId} | Lease: ${leaseId} | DocId: ${documentId} | Type: ${documentType}`);
      const startResult = await textractClient.send(new import_client_textract.StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        FeatureTypes: [import_client_textract.FeatureType.FORMS, import_client_textract.FeatureType.TABLES]
      }));
      const jobId = startResult.JobId;
      const blocks = await waitForTextractCompletion(jobId);
      const extractedData = extractAllData(blocks);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await docClient.send(new import_lib_dynamodb.PutCommand({
        TableName: LEASE_TABLE_NAME,
        Item: {
          PK: `CLINIC#${clinicId}`,
          SK: `EXTRACTED#${documentId}`,
          entityType: "ExtractedDocument",
          documentId,
          leaseId: leaseId !== "pending" ? leaseId : null,
          documentType,
          source: {
            bucket,
            key,
            fileKey: key,
            filename: originalFilename,
            leaseId: leaseId !== "pending" ? leaseId : null,
            processedAt: now,
            textractJobId: jobId
          },
          fields: extractedData.fields,
          tables: extractedData.tables,
          rawText: extractedData.rawText,
          lines: extractedData.lines,
          extraction: {
            totalFields: Object.keys(extractedData.fields).length,
            totalTables: extractedData.tables.length,
            totalLines: extractedData.lines.length,
            averageConfidence: extractedData.averageConfidence
          },
          createdAt: now,
          updatedAt: now
        }
      }));
      if (leaseId && leaseId !== "pending") {
        await linkExtractedDataToLease(clinicId, leaseId, documentId, key, documentType, now);
      }
      console.log(`Extracted ${Object.keys(extractedData.fields).length} fields for document ${documentId}`);
    } catch (error) {
      console.error("Error processing document:", key, error);
      throw error;
    }
  }
};
function extractClinicIdFromKey(key) {
  const parts = key.split("/");
  return parts[0] || "unknown";
}
function extractLeaseIdFromKey(key) {
  const parts = key.split("/");
  if (parts.length >= 2 && parts[1] !== "temp") {
    return parts[1];
  }
  return "pending";
}
async function linkExtractedDataToLease(clinicId, leaseId, documentId, fileKey, documentType, processedAt) {
  try {
    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;
    const existing = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK }
    }));
    if (!existing.Item) {
      console.log(`Lease not found for ${clinicId}/${leaseId}, skipping link`);
      return;
    }
    const documents = existing.Item.documents || [];
    const docIndex = documents.findIndex((doc) => doc.documentId === documentId);
    if (docIndex >= 0) {
      documents[docIndex] = {
        ...documents[docIndex],
        fileKey,
        extractionStatus: "completed",
        extractedAt: processedAt,
        hasExtractedData: true
      };
    } else {
      documents.push({
        documentId,
        fileKey,
        type: documentType,
        extractionStatus: "completed",
        extractedAt: processedAt,
        hasExtractedData: true,
        uploadedAt: processedAt
      });
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
        ":updatedAt": processedAt
      }
    }));
    console.log(`Linked extracted data ${documentId} to lease ${leaseId}`);
  } catch (error) {
    console.error("Error linking extracted data to lease:", error);
  }
}
async function waitForTextractCompletion(jobId) {
  const allBlocks = [];
  let nextToken;
  for (let attempt = 0; attempt < 60; attempt++) {
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
      return allBlocks;
    } else if (result.JobStatus === "FAILED") {
      throw new Error(`Textract failed: ${result.StatusMessage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2e3));
  }
  throw new Error("Textract job timed out");
}
function extractAllData(blocks) {
  const blockMap = {};
  blocks.forEach((block) => {
    blockMap[block.Id] = block;
  });
  const fields = {};
  const tables = [];
  const lines = [];
  let totalConfidence = 0;
  let confidenceCount = 0;
  blocks.filter((b) => b.BlockType === "LINE").forEach((block) => {
    lines.push({
      text: block.Text,
      confidence: block.Confidence,
      page: block.Page || 1
    });
    if (block.Confidence) {
      totalConfidence += block.Confidence;
      confidenceCount++;
    }
  });
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
        page: keyBlock.Page || 1,
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
        page: tableBlock.Page || 1,
        rows: tableData.rows,
        headers: tableData.headers,
        rowCount: tableData.rows.length,
        columnCount: tableData.columnCount
      });
    }
  });
  return {
    fields,
    tables,
    rawText: lines.map((l) => l.text).join("\n"),
    lines,
    averageConfidence: confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount * 100) / 100 : 0
  };
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
  if (/^\[X\]$|^\[ \]$/.test(value))
    return "checkbox";
  return "text";
}
function extractTableData(tableBlock, blockMap) {
  const cells = [];
  const childRel = tableBlock.Relationships?.find((r) => r.Type === "CHILD");
  childRel?.Ids.forEach((id) => {
    const cell = blockMap[id];
    if (cell?.BlockType === "CELL") {
      cells.push({
        rowIndex: cell.RowIndex,
        colIndex: cell.ColumnIndex,
        text: getTextFromBlock(cell, blockMap)
      });
    }
  });
  const rowMap = {};
  let maxCol = 0;
  cells.forEach((cell) => {
    if (!rowMap[cell.rowIndex])
      rowMap[cell.rowIndex] = [];
    rowMap[cell.rowIndex][cell.colIndex - 1] = cell.text;
    maxCol = Math.max(maxCol, cell.colIndex);
  });
  const rows = Object.keys(rowMap).sort((a, b) => Number(a) - Number(b)).map((idx) => rowMap[Number(idx)]);
  const headers = rows.length > 0 ? rows[0] : [];
  return { rows, headers, columnCount: maxCol };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
