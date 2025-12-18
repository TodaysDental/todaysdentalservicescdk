import { S3Event } from 'aws-lambda';
import { TextractClient, StartDocumentAnalysisCommand, GetDocumentAnalysisCommand, FeatureType } from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const textractClient = new TextractClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;

export const handler = async (event: S3Event): Promise<void> => {
  console.log('Process Document Event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    if (!key.match(/\.(pdf|png|jpg|jpeg|tiff)$/i)) {
      console.log('Skipping non-document file:', key);
      continue;
    }

    try {
      const headResult = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const metadata = headResult.Metadata || {};
      const clinicId = metadata['clinic-id'] || 'unknown';
      const leaseId = metadata['lease-id'] || 'pending';
      const documentType = metadata['document-type'] || 'Document';
      const originalFilename = metadata['original-filename'] || key.split('/').pop();

      console.log(`Processing: ${key} | Clinic: ${clinicId} | Type: ${documentType}`);

      const startResult = await textractClient.send(new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
      }));

      const jobId = startResult.JobId!;
      const blocks = await waitForTextractCompletion(jobId);
      const extractedData = extractAllData(blocks);
      const documentId = key.split('/').pop()?.split('-')[0] || `DOC-${Date.now()}`;

      await docClient.send(new PutCommand({
        TableName: LEASE_TABLE_NAME,
        Item: {
          PK: `CLINIC#${clinicId}`,
          SK: `EXTRACTED#${documentId}`,
          entityType: 'ExtractedDocument',
          documentType,
          source: {
            bucket, key, filename: originalFilename,
            leaseId: leaseId !== 'pending' ? leaseId : null,
            processedAt: new Date().toISOString(),
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
          createdAt: new Date().toISOString()
        }
      }));

      console.log(`Extracted ${Object.keys(extractedData.fields).length} fields`);
    } catch (error) {
      console.error('Error processing document:', key, error);
      throw error;
    }
  }
};

async function waitForTextractCompletion(jobId: string): Promise<any[]> {
  const allBlocks: any[] = [];
  let nextToken: string | undefined;

  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await textractClient.send(new GetDocumentAnalysisCommand({
      JobId: jobId, NextToken: nextToken
    }));

    if (result.JobStatus === 'SUCCEEDED') {
      allBlocks.push(...(result.Blocks || []));
      if (result.NextToken) { nextToken = result.NextToken; continue; }
      return allBlocks;
    } else if (result.JobStatus === 'FAILED') {
      throw new Error(`Textract failed: ${result.StatusMessage}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Textract job timed out');
}


function extractAllData(blocks: any[]) {
  const blockMap: Record<string, any> = {};
  blocks.forEach(block => { blockMap[block.Id] = block; });

  const fields: Record<string, any> = {};
  const tables: any[] = [];
  const lines: any[] = [];
  let totalConfidence = 0;
  let confidenceCount = 0;

  // Extract all lines
  blocks.filter(b => b.BlockType === 'LINE').forEach(block => {
    lines.push({
      text: block.Text,
      confidence: block.Confidence,
      page: block.Page || 1
    });
    if (block.Confidence) { totalConfidence += block.Confidence; confidenceCount++; }
  });

  // Extract ALL key-value pairs dynamically
  const keyBlocks = blocks.filter(b => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY'));
  
  keyBlocks.forEach(keyBlock => {
    const keyText = getTextFromBlock(keyBlock, blockMap);
    const valueBlock = findValueBlock(keyBlock, blockMap);
    const valueText = valueBlock ? getTextFromBlock(valueBlock, blockMap) : '';

    if (keyText?.trim()) {
      const cleanKey = normalizeKey(keyText);
      fields[cleanKey] = {
        value: valueText.trim(),
        originalKey: keyText.trim(),
        confidence: keyBlock.Confidence || 0,
        page: keyBlock.Page || 1,
        type: detectValueType(valueText.trim())
      };
      if (keyBlock.Confidence) { totalConfidence += keyBlock.Confidence; confidenceCount++; }
    }
  });

  // Extract ALL tables
  blocks.filter(b => b.BlockType === 'TABLE').forEach((tableBlock, idx) => {
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
    rawText: lines.map(l => l.text).join('\n'),
    lines,
    averageConfidence: confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount * 100) / 100 : 0
  };
}

function getTextFromBlock(block: any, blockMap: Record<string, any>): string {
  let text = '';
  block.Relationships?.forEach((rel: any) => {
    if (rel.Type === 'CHILD') {
      rel.Ids.forEach((id: string) => {
        const child = blockMap[id];
        if (child?.BlockType === 'WORD') text += child.Text + ' ';
        else if (child?.BlockType === 'SELECTION_ELEMENT') {
          text += child.SelectionStatus === 'SELECTED' ? '[X] ' : '[ ] ';
        }
      });
    }
  });
  return text.trim();
}

function findValueBlock(keyBlock: any, blockMap: Record<string, any>): any {
  for (const rel of keyBlock.Relationships || []) {
    if (rel.Type === 'VALUE') return blockMap[rel.Ids[0]];
  }
  return null;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
    .replace(/[:\-_\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function detectValueType(value: string): string {
  if (!value) return 'empty';
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value)) return 'date';
  if (/^\$[\d,]+\.?\d*$/.test(value)) return 'currency';
  if (/^\d+\.?\d*\s*%$/.test(value)) return 'percentage';
  if (/^[\d,]+\.?\d*$/.test(value)) return 'number';
  if (/^\[X\]$|^\[ \]$/.test(value)) return 'checkbox';
  return 'text';
}

function extractTableData(tableBlock: any, blockMap: Record<string, any>) {
  const cells: any[] = [];
  const childRel = tableBlock.Relationships?.find((r: any) => r.Type === 'CHILD');
  
  childRel?.Ids.forEach((id: string) => {
    const cell = blockMap[id];
    if (cell?.BlockType === 'CELL') {
      cells.push({
        rowIndex: cell.RowIndex,
        colIndex: cell.ColumnIndex,
        text: getTextFromBlock(cell, blockMap)
      });
    }
  });

  const rowMap: Record<number, any[]> = {};
  let maxCol = 0;
  
  cells.forEach(cell => {
    if (!rowMap[cell.rowIndex]) rowMap[cell.rowIndex] = [];
    rowMap[cell.rowIndex][cell.colIndex - 1] = cell.text;
    maxCol = Math.max(maxCol, cell.colIndex);
  });

  const rows = Object.keys(rowMap).sort((a, b) => Number(a) - Number(b)).map(idx => rowMap[Number(idx)]);
  const headers = rows.length > 0 ? rows[0] : [];

  return { rows, headers, columnCount: maxCol };
}