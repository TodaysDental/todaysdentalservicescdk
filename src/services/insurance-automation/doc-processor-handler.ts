/**
 * Insurance Document Processor Handler
 * 
 * Real-time document processing via Textract:
 * 1. Download document from OpenDental via SFTP
 * 2. Process with Textract to extract insurance data
 * 3. Use Bedrock for complex/ambiguous data interpretation
 * 4. Validate extracted data against existing plan data
 * 5. Update plan if corrections needed (triggers deduction)
 * 6. Create commission transactions
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  TextractClient, 
  AnalyzeDocumentCommand, 
  DetectDocumentTextCommand,
  FeatureType,
} from '@aws-sdk/client-textract';
import { 
  BedrockRuntimeClient, 
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import { Client as SSH2Client } from 'ssh2';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';
import { getClinicSecrets, getGlobalSecret } from '../../shared/utils/secrets-helper';
import {
  CommissionTransaction,
  ExtractedInsuranceData,
  ValidationResult,
  ProcessDocumentRequest,
  ProcessDocumentResponse,
  COMMISSION_RATES,
} from './types';

// Clients
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const textract = new TextractClient({});
const bedrock = new BedrockRuntimeClient({});
const s3 = new S3Client({});

// Environment variables
const COMMISSIONS_TABLE = process.env.COMMISSIONS_TABLE || '';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || '';
const DOC_PROCESSING_BUCKET = process.env.DOC_PROCESSING_BUCKET || '';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// CORS helper
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowOrigin = origin && ALLOWED_ORIGINS_LIST.includes(origin) ? origin : 'https://todaysdentalinsights.com';
  return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'POST'] }, origin);
}

async function downloadBinaryFromSftp(opts: {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
  initialDelayMs?: number;
  attempts?: number;
}): Promise<Buffer> {
  const { host, port, username, password, remotePath } = opts;
  const attempts = opts.attempts ?? 6;
  const initialDelayMs = opts.initialDelayMs ?? 1500;

  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const backoff = initialDelayMs * Math.pow(1.5, i);
      await new Promise((r) => setTimeout(r, Math.floor(backoff)));
    } else if (initialDelayMs > 0) {
      await new Promise((r) => setTimeout(r, initialDelayMs));
    }

    const conn = new SSH2Client();
    try {
      const buf: Buffer = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          conn.end();
          reject(new Error('SFTP connection timeout'));
        }, 30000);

        conn
          .on('ready', () => {
            conn.sftp((err: any, sftp: any) => {
              if (err) {
                clearTimeout(timeout);
                conn.end();
                reject(err);
                return;
              }

              const chunks: Buffer[] = [];
              const rs = sftp.createReadStream(remotePath);
              rs.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
              rs.on('end', () => {
                clearTimeout(timeout);
                conn.end();
                resolve(Buffer.concat(chunks));
              });
              rs.on('error', (e: any) => {
                clearTimeout(timeout);
                conn.end();
                reject(e);
              });
            });
          })
          .on('error', (e: any) => {
            reject(e);
          })
          .connect({ host, port, username, password, readyTimeout: 15000 });
      });

      return buf;
    } catch (e: any) {
      lastErr = e;
      try {
        conn.end();
      } catch {
        // ignore
      }
    }
  }

  throw lastErr || new Error('Failed to download from SFTP');
}

function guessMimeType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'pdf') return 'application/pdf';
  if (e === 'png') return 'image/png';
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'tif' || e === 'tiff') return 'image/tiff';
  return 'application/octet-stream';
}

function normalizeExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length < 2) return 'pdf';
  const ext = parts.pop() || 'pdf';
  return ext.toLowerCase();
}

// Download document from OpenDental via Documents/DownloadSftp, then pull it from our consolidated SFTP server.
async function downloadDocumentFromOpenDental(
  clinicId: string,
  docNum: number
): Promise<{ content: Buffer; fileName: string; extension: string; s3Key: string }> {
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) {
    throw new Error(`No clinic secrets found for clinicId=${clinicId}`);
  }

  const sftpPassword = await getGlobalSecret('consolidated_sftp', 'password');
  if (!sftpPassword) {
    throw new Error('Missing consolidated_sftp password');
  }
  if (!CONSOLIDATED_SFTP_HOST) {
    throw new Error('Missing CONSOLIDATED_SFTP_HOST');
  }

  const API_HOST = 'api.opendental.com';
  const headers = {
    Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
    'Content-Type': 'application/json',
  };

  // 1) Get document metadata (filename/extension)
  const docResponse = await httpRequest(
    { hostname: API_HOST, path: `/api/v1/documents/${docNum}`, method: 'GET', headers }
  );
  if (docResponse.statusCode !== 200) {
    throw new Error(`Failed to get document metadata. status=${docResponse.statusCode}`);
  }

  const docInfo = JSON.parse(docResponse.body || '{}');
  const fileName: string = docInfo.FileName || `doc_${docNum}.pdf`;
  const extension = normalizeExtension(fileName);

  // 2) Ask OpenDental to place the file onto our consolidated SFTP server.
  // Use a root-level filename (no directories) to match the Transfer Family sftpuser
  // mapping used elsewhere in the codebase (and to avoid directory creation edge-cases).
  const unique = uuidv4().slice(0, 8);
  const remoteFileName = `InsuranceAutomationDoc_${clinicId}_${docNum}_${unique}.${extension}`;
  const remotePath = remoteFileName;

  const downloadBody = JSON.stringify({
    DocNum: docNum,
    SftpAddress: `${CONSOLIDATED_SFTP_HOST}/${remotePath}`,
    SftpUsername: 'sftpuser',
    SftpPassword: sftpPassword,
    SftpPort: 22,
  });

  const downloadResponse = await httpRequest(
    { hostname: API_HOST, path: '/api/v1/documents/DownloadSftp', method: 'POST', headers },
    downloadBody
  );

  if (downloadResponse.statusCode !== 201) {
    throw new Error(`Failed to request document download. status=${downloadResponse.statusCode}`);
  }

  // 3) Pull the file back over SFTP (Transfer Family) so we can send to Textract.
  const content = await downloadBinaryFromSftp({
    host: CONSOLIDATED_SFTP_HOST,
    port: 22,
    username: 'sftpuser',
    password: sftpPassword,
    remotePath,
    initialDelayMs: 2500,
    attempts: 8,
  });

  // 4) Upload to the processing bucket for Textract access.
  const s3Key = `temp/${clinicId}/doc-${docNum}-${unique}.${extension}`;
  await (s3 as any).send(new PutObjectCommand({
    Bucket: DOC_PROCESSING_BUCKET,
    Key: s3Key,
    Body: content,
    ContentType: guessMimeType(extension),
  }));

  return { content, fileName, extension, s3Key };
}

// HTTP request helper
async function httpRequest(
  opts: { hostname: string; path: string; method: string; headers?: Record<string, string> },
  body?: string
): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...opts.headers };
    if (body) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: opts.method,
        headers: requestHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Parse insurance info from Textract blocks
function parseInsuranceFromTextract(blocks: any[]): ExtractedInsuranceData {
  const allText = blocks.map(b => b.Text || '').join(' ');
  const allTextLower = allText.toLowerCase();
  const lines = blocks.filter(b => b.BlockType === 'LINE').map(b => b.Text || '');

  const result: ExtractedInsuranceData = {
    insuranceCompany: null,
    groupName: null,
    groupNumber: null,
    memberId: null,
    subscriberName: null,
    planType: null,
    effectiveDate: null,
    annualMax: null,
    deductible: null,
    coveragePercentages: {
      preventive: null,
      basic: null,
      major: null,
    },
    rawText: allText,
    confidence: 0,
  };

  // Insurance company patterns
  const insurancePatterns = [
    /delta\s*dental/i, /blue\s*cross/i, /blue\s*shield/i, /aetna/i, /cigna/i,
    /united\s*health/i, /humana/i, /metlife/i, /guardian/i, /anthem/i,
    /principal/i, /sun\s*life/i, /ameritas/i, /lincoln\s*financial/i, /dentemax/i,
  ];

  for (const pattern of insurancePatterns) {
    const match = allText.match(pattern);
    if (match) {
      result.insuranceCompany = match[0];
      break;
    }
  }

  // Group Number
  const groupPatterns = [
    /group\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /grp\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /group\s*number\s*[:\s]?\s*([A-Z0-9\-]+)/i,
  ];
  for (const pattern of groupPatterns) {
    const match = allText.match(pattern);
    if (match?.[1]) {
      result.groupNumber = match[1].trim();
      break;
    }
  }

  // Group Name
  const groupNamePatterns = [
    /group\s*name\s*[:\s]?\s*([A-Za-z0-9\s\-&]+?)(?=\s+(?:group|member|id|#|subscriber)|\s*$)/i,
    /employer\s*[:\s]?\s*([A-Za-z0-9\s\-&]+?)(?=\s+(?:group|member|id|#|subscriber)|\s*$)/i,
  ];
  for (const pattern of groupNamePatterns) {
    const match = allText.match(pattern);
    if (match?.[1]) {
      result.groupName = match[1].trim();
      break;
    }
  }

  // Member ID
  const memberIdPatterns = [
    /member\s*id\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /member\s*#\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /subscriber\s*id\s*[:\s]?\s*([A-Z0-9\-]+)/i,
  ];
  for (const pattern of memberIdPatterns) {
    const match = allText.match(pattern);
    if (match?.[1]) {
      result.memberId = match[1].trim();
      break;
    }
  }

  // Annual Max / Calendar Year Max / Benefit Maximum
  const annualMaxPatterns = [
    /(?:annual|calendar\s*year|benefit)\s*max(?:imum)?[^$]*?\$\s*([\d,]+)/i,
    /max(?:imum)?\s*benefit[^$]*?\$\s*([\d,]+)/i,
    /\$\s*([\d,]+)\s*(?:annual|yearly)?\s*max/i,
  ];
  for (const pattern of annualMaxPatterns) {
    const match = allText.match(pattern);
    if (match?.[1]) {
      result.annualMax = parseInt(match[1].replace(/,/g, ''), 10);
      break;
    }
  }

  // Deductible
  const deductiblePattern = /deductible[^$]*?\$\s*([\d,]+)/i;
  const deductibleMatch = allText.match(deductiblePattern);
  if (deductibleMatch?.[1]) {
    result.deductible = parseInt(deductibleMatch[1].replace(/,/g, ''), 10);
  }

  // Coverage percentages
  if (allTextLower.includes('preventive')) {
    const preventiveMatch = allText.match(/preventive[^%]*?(\d+)\s*%/i);
    if (preventiveMatch) result.coveragePercentages.preventive = parseInt(preventiveMatch[1], 10);
  }
  if (allTextLower.includes('basic')) {
    const basicMatch = allText.match(/basic[^%]*?(\d+)\s*%/i);
    if (basicMatch) result.coveragePercentages.basic = parseInt(basicMatch[1], 10);
  }
  if (allTextLower.includes('major')) {
    const majorMatch = allText.match(/major[^%]*?(\d+)\s*%/i);
    if (majorMatch) result.coveragePercentages.major = parseInt(majorMatch[1], 10);
  }

  // Calculate confidence
  const filledFields = [
    result.insuranceCompany,
    result.groupNumber,
    result.groupName,
    result.memberId,
    result.annualMax,
  ].filter(Boolean).length;
  result.confidence = Math.round((filledFields / 5) * 100);

  return result;
}

// Use Bedrock to interpret complex/ambiguous data
async function interpretWithBedrock(
  rawText: string,
  extractedData: ExtractedInsuranceData
): Promise<ExtractedInsuranceData> {
  try {
    const prompt = `You are an insurance data extraction specialist. Analyze the following text from an insurance card or document and extract the following fields. Return ONLY a JSON object with these fields:

{
  "insuranceCompany": "string or null",
  "groupName": "string or null", 
  "groupNumber": "string or null",
  "memberId": "string or null",
  "subscriberName": "string or null",
  "annualMax": number or null,
  "deductible": number or null,
  "preventiveCoverage": number or null (percentage),
  "basicCoverage": number or null (percentage),
  "majorCoverage": number or null (percentage)
}

Raw text from document:
${rawText}

Previously extracted data (may be incomplete):
${JSON.stringify(extractedData, null, 2)}

Return only the JSON object, no explanation.`;

    const response = await (bedrock as any).send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Merge with existing data (Bedrock fills in gaps)
      return {
        ...extractedData,
        insuranceCompany: extractedData.insuranceCompany || parsed.insuranceCompany,
        groupName: extractedData.groupName || parsed.groupName,
        groupNumber: extractedData.groupNumber || parsed.groupNumber,
        memberId: extractedData.memberId || parsed.memberId,
        subscriberName: extractedData.subscriberName || parsed.subscriberName,
        annualMax: extractedData.annualMax || parsed.annualMax,
        deductible: extractedData.deductible || parsed.deductible,
        coveragePercentages: {
          preventive: extractedData.coveragePercentages.preventive || parsed.preventiveCoverage,
          basic: extractedData.coveragePercentages.basic || parsed.basicCoverage,
          major: extractedData.coveragePercentages.major || parsed.majorCoverage,
        },
        confidence: Math.min(extractedData.confidence + 20, 100), // Boost confidence
      };
    }
  } catch (error: any) {
    console.warn('Bedrock interpretation failed:', error.message);
  }

  return extractedData;
}

// Validate extracted data against existing plan
async function validateExtractedData(
  clinicId: string,
  patNum: number,
  extracted: ExtractedInsuranceData
): Promise<ValidationResult & { planNum?: number; annualMaxBenefitNum?: number }> {
  const result: ValidationResult = {
    isValid: true,
    matchedFields: [],
    mismatchedFields: [],
    missingFields: [],
    corrections: {},
    shouldDeduct: false,
  };

  let planNum: number | undefined;
  let annualMaxBenefitNum: number | undefined;

  // Get existing plan data from OpenDental
  try {
    const secrets = await getClinicSecrets(clinicId);
    if (!secrets) {
      result.isValid = false;
      result.missingFields.push('clinic_credentials');
      return result;
    }

    // Query patient's insurance plan + annual max benefit (if present)
    const query = `
      SELECT 
        ip.PlanNum,
        c.CarrierName,
        ip.GroupName,
        ip.GroupNum,
        b.BenefitNum as AnnualMaxBenefitNum,
        b.MonetaryAmt as AnnualMax
      FROM patplan pp
      JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum
      JOIN insplan ip ON isub.PlanNum = ip.PlanNum
      JOIN carrier c ON ip.CarrierNum = c.CarrierNum
      LEFT JOIN benefit b ON b.PlanNum = ip.PlanNum 
        AND b.BenefitType = 5 
        AND b.CovCatNum = 0
        AND b.TimePeriod IN (1,2)
        AND b.CoverageLevel = 1
      WHERE pp.PatNum = ${patNum}
      LIMIT 1
    `;

    const API_HOST = 'api.opendental.com';
    const headers = {
      Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
      'Content-Type': 'application/json',
    };

    const response = await httpRequest(
      { hostname: API_HOST, path: '/api/v1/queries/ShortQuery', method: 'PUT', headers },
      JSON.stringify({ SqlCommand: query })
    );

    if (response.statusCode === 200) {
      const plans = JSON.parse(response.body || '[]');
      if (plans.length > 0) {
        const existingPlan = plans[0];
        planNum = existingPlan.PlanNum ? parseInt(existingPlan.PlanNum, 10) : undefined;
        annualMaxBenefitNum = existingPlan.AnnualMaxBenefitNum ? parseInt(existingPlan.AnnualMaxBenefitNum, 10) : undefined;

        const existingCarrier: string = existingPlan.CarrierName || '';
        const existingGroupNum: string = existingPlan.GroupNum || '';
        const existingGroupName: string = existingPlan.GroupName || '';
        const existingAnnualMax: number | null =
          existingPlan.AnnualMax !== undefined && existingPlan.AnnualMax !== null && existingPlan.AnnualMax !== ''
            ? parseFloat(existingPlan.AnnualMax)
            : null;

        // Compare fields
        if (extracted.insuranceCompany) {
          if (existingCarrier.toLowerCase().includes(extracted.insuranceCompany.toLowerCase())) {
            result.matchedFields.push('insuranceCompany');
          } else if (existingCarrier) {
            result.mismatchedFields.push('insuranceCompany');
            result.corrections!['insuranceCompany'] = {
              expected: existingCarrier,
              found: extracted.insuranceCompany,
            };
          } else {
            result.missingFields.push('insuranceCompany');
          }
        }

        if (extracted.groupNumber) {
          if (existingGroupNum === extracted.groupNumber) {
            result.matchedFields.push('groupNumber');
          } else if (existingGroupNum) {
            result.mismatchedFields.push('groupNumber');
            result.corrections!['groupNumber'] = {
              expected: existingGroupNum,
              found: extracted.groupNumber,
            };
          } else {
            result.missingFields.push('groupNumber');
          }
        }

        if (extracted.groupName) {
          if (existingGroupName && existingGroupName.toLowerCase() === extracted.groupName.toLowerCase()) {
            result.matchedFields.push('groupName');
          } else if (existingGroupName) {
            result.mismatchedFields.push('groupName');
            result.corrections!['groupName'] = {
              expected: existingGroupName,
              found: extracted.groupName,
            };
          } else {
            result.missingFields.push('groupName');
          }
        }

        if (extracted.annualMax) {
          if (existingAnnualMax !== null && Math.abs(existingAnnualMax - extracted.annualMax) < 1) {
            result.matchedFields.push('annualMax');
          } else if (existingAnnualMax !== null) {
            result.mismatchedFields.push('annualMax');
            result.corrections!['annualMax'] = {
              expected: existingAnnualMax,
              found: extracted.annualMax,
            };
          } else {
            result.missingFields.push('annualMax');
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error validating extracted data:', error.message);
  }

  // Determine if deduction should apply
  if (result.mismatchedFields.length > 0 || result.missingFields.length > 0) {
    result.isValid = false;
    result.shouldDeduct = true;
    const parts: string[] = [];
    if (result.mismatchedFields.length) parts.push(`Mismatched: ${result.mismatchedFields.join(', ')}`);
    if (result.missingFields.length) parts.push(`Missing in OpenDental: ${result.missingFields.join(', ')}`);
    result.deductionReason = parts.join(' | ');
  }

  return { ...result, planNum, annualMaxBenefitNum };
}

async function findRelatedCreditTransaction(clinicId: string, userId: string, docNum: number): Promise<CommissionTransaction | null> {
  // Look back a short window; enough to find the credit created by the hourly sync.
  const now = new Date();
  const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const end = now.toISOString();

  const result = await doc.send(new QueryCommand({
    TableName: COMMISSIONS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :userId AND createdAt BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':start': start,
      ':end': end,
      ':clinicId': clinicId,
      ':docNum': docNum,
      ':credit': 'CREDIT',
    },
    FilterExpression: 'clinicId = :clinicId AND docNum = :docNum AND transactionType = :credit',
    ScanIndexForward: false,
    Limit: 25,
  }));

  const items = (result.Items || []) as CommissionTransaction[];
  return items[0] || null;
}

async function createDeductionForInvalidDocument(params: {
  clinicId: string;
  userId: string;
  userName: string;
  patNum: number;
  docNum: number;
  deductionReason: string;
}): Promise<{ created: boolean; debitAmount?: number }> {
  const { clinicId, userId, userName, patNum, docNum, deductionReason } = params;

  const relatedCredit = await findRelatedCreditTransaction(clinicId, userId, docNum);
  if (!relatedCredit) {
    console.warn(`No related CREDIT transaction found for clinicId=${clinicId}, userId=${userId}, docNum=${docNum}. Skipping deduction.`);
    return { created: false };
  }

  const now = new Date();
  const transactionId = `doc-validate:${clinicId}:${docNum}:${userId}`;
  const debitAmount = -Math.abs(relatedCredit.amount);

  const transaction: CommissionTransaction = {
    pk: `${clinicId}#${userId}`,
    sk: `${now.toISOString().slice(0, 10)}#${transactionId}`,
    transactionId,
    clinicId,
    userId,
    userName,
    serviceType: relatedCredit.serviceType,
    transactionType: 'DEBIT',
    amount: debitAmount,
    patNum,
    planNum: relatedCredit.planNum,
    insuranceName: relatedCredit.insuranceName,
    groupName: relatedCredit.groupName,
    groupNumber: relatedCredit.groupNumber,
    docNum,
    docFileName: relatedCredit.docFileName,
    docUploadedAt: relatedCredit.docUploadedAt,
    docValidated: false,
    deductionReason,
    createdAt: now.toISOString(),
    source: 'REALTIME',
  };

  await doc.send(new PutCommand({
    TableName: COMMISSIONS_TABLE,
    Item: transaction,
  }));

  return { created: true, debitAmount };
}

async function updateInsPlanFields(params: {
  clinicId: string;
  planNum: number;
  groupName?: string | null;
  groupNum?: string | null;
}): Promise<boolean> {
  const { clinicId, planNum, groupName, groupNum } = params;
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) throw new Error(`No secrets found for clinic ${clinicId}`);

  const API_HOST = 'api.opendental.com';
  const headers = {
    Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
    'Content-Type': 'application/json',
  };

  const body: any = {};
  if (typeof groupName === 'string' && groupName.trim()) body.GroupName = groupName.trim();
  if (typeof groupNum === 'string' && groupNum.trim()) body.GroupNum = groupNum.trim();
  if (Object.keys(body).length === 0) return false;

  const response = await httpRequest(
    { hostname: API_HOST, path: `/api/v1/insplans/${planNum}`, method: 'PUT', headers },
    JSON.stringify(body)
  );

  return response.statusCode === 200;
}

async function updateAnnualMaxBenefit(params: {
  clinicId: string;
  annualMaxBenefitNum: number;
  annualMax: number;
}): Promise<boolean> {
  const { clinicId, annualMaxBenefitNum, annualMax } = params;
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) throw new Error(`No secrets found for clinic ${clinicId}`);

  const API_HOST = 'api.opendental.com';
  const headers = {
    Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
    'Content-Type': 'application/json',
  };

  const response = await httpRequest(
    { hostname: API_HOST, path: `/api/v1/benefits/${annualMaxBenefitNum}`, method: 'PUT', headers },
    JSON.stringify({ MonetaryAmt: annualMax })
  );

  return response.statusCode === 200;
}

async function createAnnualMaxBenefit(params: {
  clinicId: string;
  planNum: number;
  annualMax: number;
}): Promise<boolean> {
  const { clinicId, planNum, annualMax } = params;
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) throw new Error(`No secrets found for clinic ${clinicId}`);

  const API_HOST = 'api.opendental.com';
  const headers = {
    Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
    'Content-Type': 'application/json',
  };

  // Annual max: BenefitType=5 (Limitations), TimePeriod=2 (CalendarYear), CoverageLevel=1 (Individual), CovCatNum=0
  const body = {
    PlanNum: planNum,
    PatPlanNum: 0,
    CovCatNum: 0,
    BenefitType: 5,
    Percent: -1,
    MonetaryAmt: annualMax,
    TimePeriod: 2,
    QuantityQualifier: 0,
    Quantity: 0,
    CodeNum: 0,
    CoverageLevel: 1,
  };

  const response = await httpRequest(
    { hostname: API_HOST, path: `/api/v1/benefits`, method: 'POST', headers },
    JSON.stringify(body)
  );

  return response.statusCode === 201;
}

// Main handler
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  console.log('Insurance Document Processor - Processing request');

  try {
    const body: ProcessDocumentRequest = event.body ? JSON.parse(event.body) : {};
    const { clinicId, patNum, docNum, userId, userName } = body;

    if (!clinicId || !patNum || !docNum || !userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: clinicId, patNum, docNum, userId',
        }),
      };
    }

    // Download the document from OpenDental and upload into our processing bucket
    const downloaded = await downloadDocumentFromOpenDental(clinicId, docNum);
    const s3Key = downloaded.s3Key;

    let textBlocks: any[] = [];

    // Try AnalyzeDocument first (forms/tables). Fallback to DetectDocumentText if needed.
    try {
      const textractResponse = await (textract as any).send(new AnalyzeDocumentCommand({
        Document: {
          S3Object: {
            Bucket: DOC_PROCESSING_BUCKET,
            Name: s3Key,
          },
        },
        FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
      }));
      textBlocks = textractResponse.Blocks || [];
    } catch (analyzeErr: any) {
      console.warn(`AnalyzeDocument failed (${analyzeErr.name || 'error'}). Falling back to DetectDocumentText.`);
      const detectResp = await (textract as any).send(new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: DOC_PROCESSING_BUCKET,
            Name: s3Key,
          },
        },
      }));
      textBlocks = detectResp.Blocks || [];
    }

    console.log(`Textract found ${textBlocks.length} blocks`);

    // Parse insurance info
    let extractedData = parseInsuranceFromTextract(textBlocks);
    console.log('Initial extraction:', JSON.stringify(extractedData, null, 2));

    // Use Bedrock for complex interpretation if confidence is low
    if (extractedData.confidence < 60) {
      console.log('Low confidence, using Bedrock for interpretation');
      extractedData = await interpretWithBedrock(extractedData.rawText, extractedData);
      console.log('After Bedrock:', JSON.stringify(extractedData, null, 2));
    }

    // Validate against existing plan data
    const validationResult = await validateExtractedData(clinicId, patNum, extractedData);
    console.log('Validation result:', JSON.stringify(validationResult, null, 2));

    // If extraction suggests missing/mismatched values, attempt to update OpenDental (never creates new plans).
    // Only do auto-updates when we have decent confidence.
    const updatesApplied: Record<string, any> = {};
    try {
      if (validationResult.planNum && extractedData.confidence >= 60) {
        // Group fields
        const groupUpdated = await updateInsPlanFields({
          clinicId,
          planNum: validationResult.planNum,
          groupName: extractedData.groupName,
          groupNum: extractedData.groupNumber,
        });
        if (groupUpdated) updatesApplied.insplan = { groupName: extractedData.groupName, groupNum: extractedData.groupNumber };

        // Annual max benefit
        if (extractedData.annualMax) {
          if (validationResult.annualMaxBenefitNum) {
            const annualUpdated = await updateAnnualMaxBenefit({
              clinicId,
              annualMaxBenefitNum: validationResult.annualMaxBenefitNum,
              annualMax: extractedData.annualMax,
            });
            if (annualUpdated) updatesApplied.annualMax = extractedData.annualMax;
          } else {
            const annualCreated = await createAnnualMaxBenefit({
              clinicId,
              planNum: validationResult.planNum,
              annualMax: extractedData.annualMax,
            });
            if (annualCreated) updatesApplied.annualMax = extractedData.annualMax;
          }
        }
      }
    } catch (updateErr: any) {
      console.warn('Auto-update attempt failed:', updateErr.message);
    }

    // If validation indicates issues, create a deduction that reverses the related credit.
    let deductionCreated = false;
    let deductionAmount: number | undefined;
    if (validationResult.shouldDeduct && validationResult.deductionReason) {
      const ded = await createDeductionForInvalidDocument({
        clinicId,
        userId,
        userName: userName || 'Unknown',
        patNum,
        docNum,
        deductionReason: validationResult.deductionReason,
      });
      deductionCreated = ded.created;
      deductionAmount = ded.debitAmount;
    }

    // Log the processing to audit table
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const actionId = uuidv4();

    await doc.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        pk: `${clinicId}#${dateStr}`,
        sk: `${now.toISOString()}#${actionId}`,
        actionId,
        clinicId,
        actionType: validationResult.isValid ? 'DOCUMENT_VALIDATED' : 'DOCUMENT_FAILED',
        userId,
        userName: userName || 'Unknown',
        patNum,
        docNum,
        details: {
          extractedData,
          validationResult,
          updatesApplied,
          deductionCreated,
          deductionAmount,
          s3Key,
        },
        timestamp: now.toISOString(),
        ttl: Math.floor(now.getTime() / 1000) + (90 * 24 * 60 * 60),
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        extractedData,
        validationResult,
        commissionCreated: deductionCreated,
      } as ProcessDocumentResponse),
    };

  } catch (error: any) {
    console.error('Document Processor Error:', error);

    return {
      statusCode: error.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to process document',
      }),
    };
  }
};
