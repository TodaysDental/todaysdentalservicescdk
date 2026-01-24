/**
 * Credentialing Document Processor Handler
 * 
 * Automated document intelligence for provider credentialing:
 * 1. Triggered by S3 upload to credentialing documents bucket
 * 2. Classifies document type (license, DEA, malpractice, etc.)
 * 3. Extracts text via Textract
 * 4. Maps extracted fields to CANONICAL_FIELDS schema using Bedrock
 * 5. Stores extracted data with confidence scores in ProviderCredentials table
 * 6. Auto-populates provider profile where confidence is high
 */

import { S3Event, S3Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
    TextractClient,
    AnalyzeDocumentCommand,
    DetectDocumentTextCommand,
    StartDocumentAnalysisCommand,
    GetDocumentAnalysisCommand,
    FeatureType,
} from '@aws-sdk/client-textract';
import {
    BedrockRuntimeClient,
    InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import {
    CANONICAL_FIELDS,
    CANONICAL_FIELDS_FLAT,
    VALID_DOCUMENT_TYPES,
    validateDocumentType,
    DocumentType,
} from './credentialing-schema';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const textract = new TextractClient({});
const bedrock = new BedrockRuntimeClient({});
const s3 = new S3Client({});

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const EXTRACTED_DATA_TABLE = process.env.EXTRACTED_DATA_TABLE!;

// ========================================
// DOCUMENT CLASSIFICATION
// ========================================

interface ClassifiedDocument {
    documentType: DocumentType;
    confidence: number;
}

/**
 * Classify document type from filename and path patterns
 */
function classifyDocumentFromPath(s3Key: string): ClassifiedDocument {
    const keyLower = s3Key.toLowerCase();
    const filename = s3Key.split('/').pop() || '';
    const filenameLower = filename.toLowerCase();

    // Document type patterns (filename-based)
    const patterns: { type: DocumentType; patterns: RegExp[] }[] = [
        { type: 'stateLicense', patterns: [/license/i, /dental.*license/i, /state.*license/i, /professional.*license/i] },
        { type: 'deaCertificate', patterns: [/dea/i, /drug.*enforcement/i] },
        { type: 'cdsCertificate', patterns: [/cds/i, /controlled.*substance/i] },
        { type: 'npiConfirmation', patterns: [/npi/i, /nppes/i, /national.*provider/i] },
        { type: 'malpracticeInsurance', patterns: [/malpractice/i, /liability.*insurance/i, /coi/i, /certificate.*insurance/i] },
        { type: 'diploma', patterns: [/diploma/i, /dds/i, /dmd/i, /dental.*degree/i, /graduation/i] },
        { type: 'boardCertification', patterns: [/board.*cert/i, /specialty.*cert/i, /american.*board/i] },
        { type: 'cprCertification', patterns: [/cpr/i, /bls/i, /basic.*life/i] },
        { type: 'aclsCertification', patterns: [/acls/i, /advanced.*cardiac/i] },
        { type: 'w9', patterns: [/w-?9/i, /tax.*form/i, /taxpayer.*identification/i] },
        { type: 'cv', patterns: [/cv/i, /curriculum.*vitae/i, /resume/i] },
        { type: 'photoId', patterns: [/id/i, /driver.*license/i, /passport/i, /photo.*id/i] },
        { type: 'residencyCertificate', patterns: [/residency/i, /training.*cert/i, /postgraduate/i] },
        { type: 'transcript', patterns: [/transcript/i, /academic.*record/i] },
    ];

    // Check S3 key path (providers/{providerId}/{documentType}/...)
    const pathMatch = s3Key.match(/providers\/[^/]+\/([^/]+)\//);
    if (pathMatch) {
        const pathType = pathMatch[1];
        if (VALID_DOCUMENT_TYPES.includes(pathType as DocumentType)) {
            return { documentType: pathType as DocumentType, confidence: 0.9 };
        }
    }

    // Check filename patterns
    for (const { type, patterns: regexes } of patterns) {
        for (const regex of regexes) {
            if (regex.test(filenameLower)) {
                return { documentType: type, confidence: 0.75 };
            }
        }
    }

    return { documentType: 'other', confidence: 0.3 };
}

// ========================================
// TEXTRACT PROCESSING
// ========================================

interface ExtractedText {
    fullText: string;
    lines: string[];
    keyValuePairs: Record<string, string>;
    tables: string[][];
}

async function extractTextFromDocument(bucket: string, key: string): Promise<ExtractedText> {
    console.log(`Extracting text from s3://${bucket}/${key}`);

    // For images, use sync AnalyzeDocument. For PDFs, use async StartDocumentAnalysis.
    const extension = key.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'tiff', 'tif'].includes(extension);

    if (isImage) {
        // Sync processing for images
        const response = await textract.send(new AnalyzeDocumentCommand({
            Document: { S3Object: { Bucket: bucket, Name: key } },
            FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
        }));

        return parseTextractBlocks(response.Blocks || []);
    } else {
        // Async processing for PDFs
        const startResponse = await textract.send(new StartDocumentAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
            FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
        }));

        const jobId = startResponse.JobId!;

        // Poll for completion (max 60 seconds)
        let status = 'IN_PROGRESS';
        let attempts = 0;
        const maxAttempts = 30;
        let blocks: any[] = [];

        while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const getResponse = await textract.send(new GetDocumentAnalysisCommand({ JobId: jobId }));
            status = getResponse.JobStatus || 'FAILED';

            if (status === 'SUCCEEDED') {
                blocks = getResponse.Blocks || [];
                // Handle pagination if needed
                let nextToken = getResponse.NextToken;
                while (nextToken) {
                    const nextPage = await textract.send(new GetDocumentAnalysisCommand({
                        JobId: jobId,
                        NextToken: nextToken,
                    }));
                    blocks = blocks.concat(nextPage.Blocks || []);
                    nextToken = nextPage.NextToken;
                }
            }
            attempts++;
        }

        if (status !== 'SUCCEEDED') {
            console.warn(`Textract job ${jobId} did not complete successfully. Status: ${status}`);
            // Fallback to simple text detection
            const detectResponse = await textract.send(new DetectDocumentTextCommand({
                Document: { S3Object: { Bucket: bucket, Name: key } },
            }));
            return parseTextractBlocks(detectResponse.Blocks || []);
        }

        return parseTextractBlocks(blocks);
    }
}

function parseTextractBlocks(blocks: any[]): ExtractedText {
    const lines: string[] = [];
    const keyValuePairs: Record<string, string> = {};
    const tables: string[][] = [];

    // Build block map for relationship resolution
    const blockMap: Record<string, any> = {};
    blocks.forEach(block => {
        blockMap[block.Id] = block;
    });

    // Extract lines and words
    for (const block of blocks) {
        if (block.BlockType === 'LINE') {
            lines.push(block.Text || '');
        }
    }

    // Extract key-value pairs from FORMS
    for (const block of blocks) {
        if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
            let key = '';
            let value = '';

            // Get key text
            if (block.Relationships) {
                for (const rel of block.Relationships) {
                    if (rel.Type === 'CHILD') {
                        for (const childId of rel.Ids || []) {
                            const child = blockMap[childId];
                            if (child && child.BlockType === 'WORD') {
                                key += (key ? ' ' : '') + (child.Text || '');
                            }
                        }
                    }
                    if (rel.Type === 'VALUE') {
                        for (const valueId of rel.Ids || []) {
                            const valueBlock = blockMap[valueId];
                            if (valueBlock?.Relationships) {
                                for (const valueRel of valueBlock.Relationships) {
                                    if (valueRel.Type === 'CHILD') {
                                        for (const childId of valueRel.Ids || []) {
                                            const child = blockMap[childId];
                                            if (child && child.BlockType === 'WORD') {
                                                value += (value ? ' ' : '') + (child.Text || '');
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (key && value) {
                keyValuePairs[key.toLowerCase().trim()] = value.trim();
            }
        }
    }

    return {
        fullText: lines.join('\n'),
        lines,
        keyValuePairs,
        tables,
    };
}

// ========================================
// BEDROCK FIELD EXTRACTION
// ========================================

interface ExtractedCredentialFields {
    [key: string]: {
        value: string | number | boolean | null;
        confidence: number;
        source: 'textract' | 'bedrock' | 'pattern';
    };
}

async function extractFieldsWithBedrock(
    documentType: DocumentType,
    extractedText: ExtractedText
): Promise<ExtractedCredentialFields> {
    // Build document-type-specific prompt
    const fieldsToExtract = getFieldsForDocumentType(documentType);

    const prompt = `You are a healthcare credentialing document extraction specialist. Analyze the following text from a ${documentType} document and extract the specified fields.

Return ONLY a valid JSON object with the following structure:
{
  "fieldName": { "value": "extracted value or null", "confidence": 0.0-1.0 },
  ...
}

Fields to extract:
${fieldsToExtract.map(f => `- ${f}`).join('\n')}

Document text:
${extractedText.fullText.substring(0, 8000)}

${Object.keys(extractedText.keyValuePairs).length > 0 ? `
Key-Value pairs detected:
${JSON.stringify(extractedText.keyValuePairs, null, 2)}
` : ''}

Instructions:
- For dates, use ISO format (YYYY-MM-DD)
- For license numbers, include the full number as shown
- For NPI, extract exactly 10 digits
- If a field cannot be found, set value to null
- Set confidence based on clarity: 0.9+ for clear matches, 0.6-0.8 for likely matches, below 0.5 for guesses

Return only the JSON object, no explanation.`;

    try {
        const response = await bedrock.send(new InvokeModelCommand({
            modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 2048,
                messages: [{ role: 'user', content: prompt }],
            }),
        }));

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const content = responseBody.content?.[0]?.text || '';

        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const result: ExtractedCredentialFields = {};

            for (const [field, data] of Object.entries(parsed)) {
                if (data && typeof data === 'object' && 'value' in data) {
                    result[field] = {
                        value: (data as any).value,
                        confidence: (data as any).confidence ?? 0.5,
                        source: 'bedrock',
                    };
                }
            }

            return result;
        }
    } catch (error: any) {
        console.error('Bedrock field extraction failed:', error.message);
    }

    // Fallback: try pattern-based extraction
    return patternBasedExtraction(documentType, extractedText);
}

function getFieldsForDocumentType(documentType: DocumentType): string[] {
    const baseFields = ['firstName', 'lastName', 'npi'];

    const typeSpecificFields: Record<string, string[]> = {
        stateLicense: ['stateLicenseNumber', 'stateLicenseState', 'stateLicenseIssueDate', 'stateLicenseExpiry', 'stateLicenseStatus'],
        deaCertificate: ['deaNumber', 'deaState', 'deaExpiry', 'deaSchedules'],
        cdsCertificate: ['cdsNumber', 'cdsState', 'cdsExpiry'],
        npiConfirmation: ['npi', 'npiType', 'practiceName', 'practiceAddress1', 'practiceCity', 'practiceState', 'practiceZip'],
        malpracticeInsurance: ['malpracticeInsurer', 'malpracticePolicyNumber', 'malpracticeLimitPerClaim', 'malpracticeLimitAggregate', 'malpracticeEffectiveDate', 'malpracticeExpiry'],
        diploma: ['dentalSchoolName', 'degreeType', 'graduationDate', 'graduationYear'],
        boardCertification: ['boardCertification', 'boardCertifyingBody', 'boardCertDate', 'boardCertExpiry'],
        cprCertification: ['cprCertDate', 'cprExpiry', 'cprProvider'],
        aclsCertification: ['aclsCertDate', 'aclsExpiry'],
        w9: ['firstName', 'lastName', 'taxId', 'taxIdType', 'practiceAddress1', 'practiceCity', 'practiceState', 'practiceZip'],
        cv: ['firstName', 'lastName', 'primarySpecialty', 'dentalSchoolName', 'graduationYear', 'residencyProgram'],
        photoId: ['firstName', 'lastName', 'dateOfBirth'],
    };

    return [...baseFields, ...(typeSpecificFields[documentType] || [])];
}

function patternBasedExtraction(documentType: DocumentType, extractedText: ExtractedText): ExtractedCredentialFields {
    const result: ExtractedCredentialFields = {};
    const text = extractedText.fullText;
    const kvPairs = extractedText.keyValuePairs;

    // Common patterns
    const patterns: Record<string, RegExp[]> = {
        npi: [/\b(\d{10})\b/, /npi[:\s#]*(\d{10})/i],
        stateLicenseNumber: [/license\s*#?\s*[:\s]?([A-Z0-9\-]+)/i, /dental\s*license[:\s#]*([A-Z0-9\-]+)/i],
        deaNumber: [/dea\s*#?\s*[:\s]?([A-Z]{2}\d{7})/i, /([A-Z]{2}\d{7})/],
        dateOfBirth: [/dob[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, /birth\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i],
        graduationYear: [/class\s*of\s*(\d{4})/i, /graduated[:\s]*(\d{4})/i, /(\d{4})/],
        expirationDate: [/exp(?:ires?|iration)?[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i],
    };

    // Check key-value pairs first
    for (const [key, value] of Object.entries(kvPairs)) {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('license') && keyLower.includes('number')) {
            result.stateLicenseNumber = { value, confidence: 0.8, source: 'textract' };
        }
        if (keyLower.includes('expir')) {
            const fieldName = documentType === 'stateLicense' ? 'stateLicenseExpiry' :
                documentType === 'deaCertificate' ? 'deaExpiry' :
                    documentType === 'malpracticeInsurance' ? 'malpracticeExpiry' : 'expirationDate';
            result[fieldName] = { value, confidence: 0.8, source: 'textract' };
        }
        if (keyLower.includes('npi')) {
            result.npi = { value, confidence: 0.85, source: 'textract' };
        }
    }

    // Try regex patterns
    for (const [field, regexes] of Object.entries(patterns)) {
        if (!result[field]) {
            for (const regex of regexes) {
                const match = text.match(regex);
                if (match?.[1]) {
                    result[field] = { value: match[1], confidence: 0.6, source: 'pattern' };
                    break;
                }
            }
        }
    }

    return result;
}

// ========================================
// DATA STORAGE
// ========================================

async function storeExtractedData(
    documentId: string,
    providerId: string,
    documentType: DocumentType,
    extractedFields: ExtractedCredentialFields,
    rawText: string
): Promise<void> {
    const now = new Date().toISOString();
    const extractionId = uuidv4();

    // Store in ExtractedData table
    await ddb.send(new PutCommand({
        TableName: EXTRACTED_DATA_TABLE,
        Item: {
            extractionId,
            documentId,
            providerId,
            documentType,
            extractedFields,
            rawTextPreview: rawText.substring(0, 500),
            status: 'pending_review',
            createdAt: now,
        },
    }));

    // Update document record with extraction status
    await ddb.send(new UpdateCommand({
        TableName: DOCUMENTS_TABLE,
        Key: { documentId },
        UpdateExpression: 'SET extractionId = :extractionId, extractionStatus = :status, extractedAt = :now',
        ExpressionAttributeValues: {
            ':extractionId': extractionId,
            ':status': 'extracted',
            ':now': now,
        },
    }));

    // Auto-populate high-confidence fields to provider credentials
    const highConfidenceFields = Object.entries(extractedFields)
        .filter(([_, data]) => data.confidence >= 0.85 && data.value !== null);

    if (highConfidenceFields.length > 0) {
        console.log(`Auto-populating ${highConfidenceFields.length} high-confidence fields for provider ${providerId}`);

        // Get or create credentials record
        const credentialId = `${providerId}#${documentType}`;
        await ddb.send(new UpdateCommand({
            TableName: PROVIDER_CREDENTIALS_TABLE,
            Key: { credentialId },
            UpdateExpression: `SET 
                providerId = :providerId,
                credentialType = :credentialType,
                ${highConfidenceFields.map(([field], i) => `#f${i} = :v${i}`).join(', ')},
                lastExtractedAt = :now,
                extractionSource = :source`,
            ExpressionAttributeNames: Object.fromEntries(
                highConfidenceFields.map(([field], i) => [`#f${i}`, field])
            ),
            ExpressionAttributeValues: {
                ':providerId': providerId,
                ':credentialType': documentType,
                ...Object.fromEntries(
                    highConfidenceFields.map(([field, data], i) => [`:v${i}`, data.value])
                ),
                ':now': now,
                ':source': 'auto-extraction',
            },
        }));
    }
}

// ========================================
// MAIN HANDLER (S3 Event Trigger)
// ========================================

export const handler: S3Handler = async (event: S3Event): Promise<void> => {
    console.log('Credentialing Document Processor - Processing S3 event');

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        console.log(`Processing document: s3://${bucket}/${key}`);

        try {
            // Skip non-document files
            const extension = key.split('.').pop()?.toLowerCase() || '';
            if (!['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'].includes(extension)) {
                console.log(`Skipping non-document file: ${key}`);
                continue;
            }

            // Extract providerId and documentId from path
            // Expected format: providers/{providerId}/{documentType}/{documentId}-{filename}.{ext}
            const pathMatch = key.match(/providers\/([^/]+)\/([^/]+)\/([^-]+)-/);
            if (!pathMatch) {
                console.warn(`Cannot parse provider/document info from key: ${key}`);
                continue;
            }

            const [, providerId, pathDocType, documentId] = pathMatch;

            // Classify document
            const classification = classifyDocumentFromPath(key);
            console.log(`Document classified as: ${classification.documentType} (confidence: ${classification.confidence})`);

            // Extract text with Textract
            const extractedText = await extractTextFromDocument(bucket, key);
            console.log(`Extracted ${extractedText.lines.length} lines, ${Object.keys(extractedText.keyValuePairs).length} key-value pairs`);

            // Extract fields with Bedrock
            const extractedFields = await extractFieldsWithBedrock(classification.documentType, extractedText);
            console.log(`Extracted ${Object.keys(extractedFields).length} fields`);

            // Store extracted data
            await storeExtractedData(
                documentId,
                providerId,
                classification.documentType,
                extractedFields,
                extractedText.fullText
            );

            console.log(`Successfully processed document ${documentId} for provider ${providerId}`);
        } catch (error: any) {
            console.error(`Error processing document ${key}:`, error.message);
            // Don't throw - continue processing other documents
        }
    }
};

// ========================================
// API HANDLER (Manual Processing Trigger)
// ========================================

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';

export const apiHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    try {
        const body = event.body ? JSON.parse(event.body) : {};
        const { documentId, providerId } = body;

        if (!documentId || !providerId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, message: 'documentId and providerId are required' }),
            };
        }

        // Get document metadata
        const { Item: document } = await ddb.send(new GetCommand({
            TableName: DOCUMENTS_TABLE,
            Key: { documentId },
        }));

        if (!document) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, message: 'Document not found' }),
            };
        }

        // Process document
        const classification = classifyDocumentFromPath(document.s3Key);
        const extractedText = await extractTextFromDocument(DOCUMENTS_BUCKET, document.s3Key);
        const extractedFields = await extractFieldsWithBedrock(classification.documentType, extractedText);

        await storeExtractedData(
            documentId,
            providerId,
            classification.documentType,
            extractedFields,
            extractedText.fullText
        );

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                documentType: classification.documentType,
                classificationConfidence: classification.confidence,
                fieldsExtracted: Object.keys(extractedFields).length,
                fields: extractedFields,
            }),
        };
    } catch (error: any) {
        console.error('Error processing document:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: error.message }),
        };
    }
};
