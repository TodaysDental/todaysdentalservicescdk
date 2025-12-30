import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  TextractClient, 
  AnalyzeDocumentCommand, 
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  FeatureType 
} from '@aws-sdk/client-textract';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const textractClient = new TextractClient({});
const s3Client = new S3Client({});
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;
const LEGAL_MODULE = 'Legal';

// Mapping of extracted field names to form field names
const FIELD_MAPPINGS: Record<string, string> = {
  // Property Information
  'property_address': 'propertyInformation.address',
  'address': 'propertyInformation.address',
  'street_address': 'propertyInformation.address',
  'suite': 'propertyInformation.addressLine2',
  'unit': 'propertyInformation.addressLine2',
  'city': 'propertyInformation.city',
  'state': 'propertyInformation.state',
  'zip': 'propertyInformation.zip',
  'zip_code': 'propertyInformation.zip',
  'postal_code': 'propertyInformation.zip',
  'landlord': 'propertyInformation.landlord',
  'landlord_name': 'propertyInformation.landlord',
  'lessor': 'propertyInformation.landlord',
  'property_manager': 'propertyInformation.propertyManager',
  'management_company': 'propertyInformation.propertyManager',
  'property_type': 'propertyInformation.propertyType',
  'square_feet': 'leaseTerms.sqft',
  'sqft': 'leaseTerms.sqft',
  'square_footage': 'leaseTerms.sqft',
  'rentable_area': 'leaseTerms.sqft',
  // Financial Details
  'monthly_rent': 'financialDetails.baseRent',
  'base_rent': 'financialDetails.baseRent',
  'rent': 'financialDetails.baseRent',
  'rent_amount': 'financialDetails.baseRent',
  'cam': 'financialDetails.camCharges',
  'cam_charges': 'financialDetails.camCharges',
  'common_area_maintenance': 'financialDetails.camCharges',
  'security_deposit': 'financialDetails.securityDeposit',
  'deposit': 'financialDetails.securityDeposit',
  'total_rent': 'financialDetails.currentRentInclCAM',
  'total_monthly': 'financialDetails.currentRentInclCAM',
  // Lease Terms
  'lease_start': 'leaseTerms.startDate',
  'start_date': 'leaseTerms.startDate',
  'commencement_date': 'leaseTerms.startDate',
  'lease_end': 'leaseTerms.endDate',
  'end_date': 'leaseTerms.endDate',
  'expiration_date': 'leaseTerms.endDate',
  'termination_date': 'leaseTerms.endDate',
  'lease_term': 'leaseTerms.termLength',
  'term': 'leaseTerms.termLength',
  'term_length': 'leaseTerms.termLength',
  'lease_type': 'leaseTerms.leaseType',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Parse Document for Autofill Event:', JSON.stringify(event, null, 2));

  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    if (!event.body) {
      return createResponse(400, { success: false, error: 'Request body is required' });
    }

    const { fileKey, clinicId } = JSON.parse(event.body);
    const clinic = event.headers['x-clinic-id'] || clinicId;

    if (!clinic) {
      return createResponse(400, { success: false, error: 'clinicId is required' });
    }
    if (!fileKey) {
      return createResponse(400, { success: false, error: 'fileKey is required' });
    }

    const canRead = hasModulePermission(
      userPerms.clinicRoles, LEGAL_MODULE, 'read',
      userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin, clinic
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: 'Permission denied' });
    }

    // Check file type
    const headResult = await s3Client.send(new HeadObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey
    }));

    const contentType = headResult.ContentType || '';
    const isPdf = fileKey.toLowerCase().endsWith('.pdf') || contentType.includes('pdf');
    const isImage = /\.(png|jpg|jpeg)$/i.test(fileKey) || contentType.includes('image');

    if (!isPdf && !isImage) {
      return createResponse(400, { 
        success: false, 
        error: 'Unsupported file format. Please upload PDF, PNG, or JPEG.' 
      });
    }

    let blocks: any[] = [];

    if (isPdf) {
      // PDFs use async API (StartDocumentAnalysis)
      console.log('Processing PDF with async Textract API...');
      blocks = await processWithAsyncTextract(fileKey);
    } else {
      // Images use sync API (AnalyzeDocument)
      console.log('Processing image with sync Textract API...');
      const s3Response = await s3Client.send(new GetObjectCommand({
        Bucket: LEASE_DOCUMENTS_BUCKET,
        Key: fileKey
      }));

      const documentBytes = await s3Response.Body?.transformToByteArray();
      if (!documentBytes) {
        return createResponse(400, { success: false, error: 'Could not read document' });
      }

      const analyzeResult = await textractClient.send(new AnalyzeDocumentCommand({
        Document: { Bytes: documentBytes },
        FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
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
      message: 'Document parsed successfully'
    });

  } catch (error: any) {
    console.error('Error parsing document:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

// Process PDF with async Textract API
async function processWithAsyncTextract(fileKey: string): Promise<any[]> {
  const startResult = await textractClient.send(new StartDocumentAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: LEASE_DOCUMENTS_BUCKET, Name: fileKey } },
    FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES]
  }));

  const jobId = startResult.JobId!;
  console.log('Started Textract job:', jobId);

  // Wait for completion (poll every 2 seconds, max 60 attempts = 2 minutes)
  const allBlocks: any[] = [];
  let nextToken: string | undefined;

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const result = await textractClient.send(new GetDocumentAnalysisCommand({
      JobId: jobId,
      NextToken: nextToken
    }));

    if (result.JobStatus === 'SUCCEEDED') {
      allBlocks.push(...(result.Blocks || []));
      if (result.NextToken) {
        nextToken = result.NextToken;
        continue;
      }
      console.log('Textract job completed, blocks:', allBlocks.length);
      return allBlocks;
    } else if (result.JobStatus === 'FAILED') {
      throw new Error(`Textract job failed: ${result.StatusMessage}`);
    }
    // Still IN_PROGRESS, continue polling
  }

  throw new Error('Textract job timed out after 2 minutes');
}


// Extract all data from Textract blocks
function extractAllData(blocks: any[]) {
  const blockMap: Record<string, any> = {};
  blocks.forEach(block => { blockMap[block.Id] = block; });

  const fields: Record<string, any> = {};
  const tables: any[] = [];
  let totalConfidence = 0;
  let confidenceCount = 0;

  // Extract key-value pairs
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
        type: detectValueType(valueText.trim())
      };
      if (keyBlock.Confidence) { 
        totalConfidence += keyBlock.Confidence; 
        confidenceCount++; 
      }
    }
  });

  // Extract tables
  blocks.filter(b => b.BlockType === 'TABLE').forEach((tableBlock, idx) => {
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

// Map extracted fields to form structure
function mapToFormFields(fields: Record<string, any>): Record<string, any> {
  const formData: Record<string, any> = {
    propertyInformation: {},
    financialDetails: {},
    leaseTerms: {}
  };

  for (const [extractedKey, fieldData] of Object.entries(fields)) {
    const formPath = FIELD_MAPPINGS[extractedKey];
    
    if (formPath) {
      const [section, field] = formPath.split('.');
      let value = fieldData.value;

      if (fieldData.type === 'currency') {
        value = parseFloat(value.replace(/[$,]/g, '')) || 0;
      } else if (fieldData.type === 'number') {
        value = parseFloat(value.replace(/,/g, '')) || 0;
      } else if (fieldData.type === 'date') {
        value = normalizeDate(value);
      }

      if (!formData[section]) formData[section] = {};
      formData[section][field] = value;
    }
  }

  if (formData.financialDetails.baseRent && formData.financialDetails.camCharges) {
    formData.financialDetails.currentRentInclCAM = 
      formData.financialDetails.baseRent + formData.financialDetails.camCharges;
  }

  return formData;
}

function getUnmappedFields(fields: Record<string, any>): Record<string, string> {
  const unmapped: Record<string, string> = {};
  for (const [key, fieldData] of Object.entries(fields)) {
    if (!FIELD_MAPPINGS[key]) {
      unmapped[fieldData.originalKey] = fieldData.value;
    }
  }
  return unmapped;
}

function extractRentSchedule(tables: any[]): any[] {
  const schedule: any[] = [];
  for (const table of tables) {
    const headers = table.headers?.map((h: string) => h?.toLowerCase() || '') || [];
    const hasYearOrPeriod = headers.some((h: string) => h.includes('year') || h.includes('period') || h.includes('month'));
    const hasRent = headers.some((h: string) => h.includes('rent') || h.includes('amount') || h.includes('payment'));
    
    if (hasYearOrPeriod && hasRent) {
      for (let i = 1; i < table.rows.length; i++) {
        const row = table.rows[i];
        const entry: any = {};
        headers.forEach((header: string, idx: number) => {
          if (row[idx]) entry[header || `col${idx}`] = row[idx];
        });
        if (Object.keys(entry).length > 0) schedule.push(entry);
      }
    }
  }
  return schedule;
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  ];
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format === formats[2]) {
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      } else {
        return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
      }
    }
  }
  return dateStr;
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
  return 'text';
}

function extractTableData(tableBlock: any, blockMap: Record<string, any>) {
  const cells: any[] = [];
  const childRel = tableBlock.Relationships?.find((r: any) => r.Type === 'CHILD');
  childRel?.Ids.forEach((id: string) => {
    const cell = blockMap[id];
    if (cell?.BlockType === 'CELL') {
      cells.push({ rowIndex: cell.RowIndex, colIndex: cell.ColumnIndex, text: getTextFromBlock(cell, blockMap) });
    }
  });

  const rowMap: Record<number, any[]> = {};
  cells.forEach(cell => {
    if (!rowMap[cell.rowIndex]) rowMap[cell.rowIndex] = [];
    rowMap[cell.rowIndex][cell.colIndex - 1] = cell.text;
  });

  const rows = Object.keys(rowMap).sort((a, b) => Number(a) - Number(b)).map(idx => rowMap[Number(idx)]);
  return { rows, headers: rows.length > 0 ? rows[0] : [] };
}

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-clinic-id',
    },
    body: JSON.stringify(body),
  };
}
