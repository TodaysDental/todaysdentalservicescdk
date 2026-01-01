/**
 * Insurance Card Textract Handler
 * 
 * Processes uploaded insurance card images using AWS Textract to extract:
 * - Insurance Company Name
 * - Group Name
 * - Group Number
 * - Member ID
 * - Policy Holder Name
 * - Coverage Details
 * 
 * The extracted information is formatted and can be:
 * 1. Fed to the chatbot for contextual responses
 * 2. Uploaded to OpenDental as a patient document
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TextractClient, AnalyzeDocumentCommand, DetectDocumentTextCommand, FeatureType } from '@aws-sdk/client-textract';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';
import { 
  getClinicConfig, 
  getClinicSecrets,
  getAllClinicConfigs,
  ClinicConfig,
  ClinicSecrets
} from '../../shared/utils/secrets-helper';

// Clients
const textractClient = new TextractClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Environment variables
const IMAGE_BUCKET = process.env.IMAGE_BUCKET || '';
const OPEN_DENTAL_API_BASE = 'https://api.opendental.com/api/v1';

// Clinic credentials interface for OpenDental
interface ClinicCredentials {
  clinicId: string;
  developerKey: string;
  customerKey: string;
}

// Extracted insurance information
interface InsuranceInfo {
  insuranceCompany: string;
  groupName: string;
  groupNumber: string;
  memberId: string;
  subscriberName: string;
  subscriberId: string;
  planType: string;
  effectiveDate: string;
  copay: {
    preventive: string;
    basic: string;
    major: string;
    orthodontic: string;
  };
  deductible: {
    individual: string;
    family: string;
  };
  maximumBenefit: string;
  rxBin: string;
  rxPcn: string;
  rawText: string;
  confidence: number;
}

// Get clinic credentials for OpenDental API
async function getClinicCredentials(clinicId: string): Promise<ClinicCredentials | null> {
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) return null;
  return {
    clinicId,
    developerKey: secrets.openDentalDeveloperKey,
    customerKey: secrets.openDentalCustomerKey,
  };
}

// Build CORS headers for response
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowOrigin = origin && ALLOWED_ORIGINS_LIST.includes(origin) ? origin : 'https://todaysdentalinsights.com';
  return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'POST'] }, origin);
}

/**
 * Parse insurance information from extracted text using pattern matching
 * and common insurance card formats
 */
function parseInsuranceInfo(textBlocks: any[]): InsuranceInfo {
  const allText = textBlocks.map(b => b.Text || '').join(' ');
  const allTextLower = allText.toLowerCase();
  const lines = textBlocks.filter(b => b.BlockType === 'LINE').map(b => b.Text || '');
  
  const result: InsuranceInfo = {
    insuranceCompany: '',
    groupName: '',
    groupNumber: '',
    memberId: '',
    subscriberName: '',
    subscriberId: '',
    planType: '',
    effectiveDate: '',
    copay: {
      preventive: '',
      basic: '',
      major: '',
      orthodontic: '',
    },
    deductible: {
      individual: '',
      family: '',
    },
    maximumBenefit: '',
    rxBin: '',
    rxPcn: '',
    rawText: allText,
    confidence: 0,
  };
  
  // Common insurance company patterns
  const insurancePatterns = [
    /delta\s*dental/i,
    /blue\s*cross/i,
    /blue\s*shield/i,
    /aetna/i,
    /cigna/i,
    /united\s*health/i,
    /humana/i,
    /metlife/i,
    /guardian/i,
    /anthem/i,
    /principal/i,
    /sun\s*life/i,
    /ameritas/i,
    /lincoln\s*financial/i,
    /dentemax/i,
    /careington/i,
  ];
  
  // Find insurance company
  for (const pattern of insurancePatterns) {
    const match = allText.match(pattern);
    if (match) {
      result.insuranceCompany = match[0];
      break;
    }
  }
  
  // If not found by pattern, look for the first prominent text (usually company name)
  if (!result.insuranceCompany && lines.length > 0) {
    // First line often contains company name
    result.insuranceCompany = lines[0];
  }
  
  // Group Number patterns
  const groupPatterns = [
    /group\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /grp\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /group\s*number\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /group\s*no\.?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
  ];
  
  for (const pattern of groupPatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.groupNumber = match[1].trim();
      break;
    }
  }
  
  // Group Name patterns
  const groupNamePatterns = [
    /group\s*name\s*[:\s]?\s*([A-Za-z0-9\s\-&]+?)(?=\s+(?:group|member|id|#|subscriber)|\s*$)/i,
    /employer\s*[:\s]?\s*([A-Za-z0-9\s\-&]+?)(?=\s+(?:group|member|id|#|subscriber)|\s*$)/i,
  ];
  
  for (const pattern of groupNamePatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.groupName = match[1].trim();
      break;
    }
  }
  
  // Member ID patterns
  const memberIdPatterns = [
    /member\s*id\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /member\s*#\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /id\s*#?\s*[:\s]?\s*([A-Z0-9\-]+)/i,
    /subscriber\s*id\s*[:\s]?\s*([A-Z0-9\-]+)/i,
  ];
  
  for (const pattern of memberIdPatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.memberId = match[1].trim();
      break;
    }
  }
  
  // Subscriber/Member Name
  const namePatterns = [
    /subscriber\s*[:\s]?\s*([A-Za-z]+\s+[A-Za-z]+)/i,
    /member\s*name\s*[:\s]?\s*([A-Za-z]+\s+[A-Za-z]+)/i,
    /name\s*[:\s]?\s*([A-Za-z]+\s+[A-Za-z]+)/i,
  ];
  
  for (const pattern of namePatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.subscriberName = match[1].trim();
      break;
    }
  }
  
  // Plan Type
  const planPatterns = [
    /plan\s*type\s*[:\s]?\s*([A-Za-z0-9\s\-]+)/i,
    /(ppo|hmo|dhmo|indemnity|epo)/i,
  ];
  
  for (const pattern of planPatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.planType = match[1].trim().toUpperCase();
      break;
    }
  }
  
  // Effective Date
  const datePatterns = [
    /effective\s*(?:date)?\s*[:\s]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /eff\s*(?:date)?\s*[:\s]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ];
  
  for (const pattern of datePatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.effectiveDate = match[1].trim();
      break;
    }
  }
  
  // Copay/Coinsurance percentages
  if (allTextLower.includes('preventive') || allTextLower.includes('diagnostic')) {
    const preventiveMatch = allText.match(/preventive[^%]*?(\d+)\s*%/i);
    if (preventiveMatch) result.copay.preventive = `${preventiveMatch[1]}%`;
  }
  
  if (allTextLower.includes('basic')) {
    const basicMatch = allText.match(/basic[^%]*?(\d+)\s*%/i);
    if (basicMatch) result.copay.basic = `${basicMatch[1]}%`;
  }
  
  if (allTextLower.includes('major')) {
    const majorMatch = allText.match(/major[^%]*?(\d+)\s*%/i);
    if (majorMatch) result.copay.major = `${majorMatch[1]}%`;
  }
  
  // Deductible
  const deductiblePattern = /deductible[^$]*?\$\s*([\d,]+)/i;
  const deductibleMatch = allText.match(deductiblePattern);
  if (deductibleMatch) {
    result.deductible.individual = `$${deductibleMatch[1]}`;
  }
  
  // Maximum Benefit
  const maxBenefitPatterns = [
    /(?:annual|yearly)?\s*max(?:imum)?\s*(?:benefit)?[^$]*?\$\s*([\d,]+)/i,
    /\$\s*([\d,]+)\s*(?:annual|yearly)?\s*max/i,
  ];
  
  for (const pattern of maxBenefitPatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      result.maximumBenefit = `$${match[1]}`;
      break;
    }
  }
  
  // RX BIN/PCN (if medical+dental card)
  const rxBinMatch = allText.match(/(?:rx\s*)?bin\s*[:\s]?\s*(\d{6})/i);
  if (rxBinMatch) result.rxBin = rxBinMatch[1];
  
  const rxPcnMatch = allText.match(/pcn\s*[:\s]?\s*([A-Z0-9]+)/i);
  if (rxPcnMatch) result.rxPcn = rxPcnMatch[1];
  
  // Calculate confidence based on how many fields were extracted
  const filledFields = [
    result.insuranceCompany,
    result.groupNumber,
    result.memberId,
    result.subscriberName,
    result.planType,
  ].filter(Boolean).length;
  result.confidence = Math.round((filledFields / 5) * 100);
  
  return result;
}

/**
 * Format insurance info for chatbot consumption
 */
function formatInsuranceForChatbot(info: InsuranceInfo): string {
  const parts: string[] = [];
  
  parts.push('I found the following information from your insurance card:');
  
  if (info.insuranceCompany) {
    parts.push(`• Insurance Company: ${info.insuranceCompany}`);
  }
  if (info.groupName) {
    parts.push(`• Group Name: ${info.groupName}`);
  }
  if (info.groupNumber) {
    parts.push(`• Group Number: ${info.groupNumber}`);
  }
  if (info.memberId) {
    parts.push(`• Member ID: ${info.memberId}`);
  }
  if (info.subscriberName) {
    parts.push(`• Subscriber Name: ${info.subscriberName}`);
  }
  if (info.planType) {
    parts.push(`• Plan Type: ${info.planType}`);
  }
  if (info.effectiveDate) {
    parts.push(`• Effective Date: ${info.effectiveDate}`);
  }
  
  // Coverage details
  const coverageDetails: string[] = [];
  if (info.copay.preventive) {
    coverageDetails.push(`Preventive: ${info.copay.preventive} coverage`);
  }
  if (info.copay.basic) {
    coverageDetails.push(`Basic: ${info.copay.basic} coverage`);
  }
  if (info.copay.major) {
    coverageDetails.push(`Major: ${info.copay.major} coverage`);
  }
  
  if (coverageDetails.length > 0) {
    parts.push(`• Coverage: ${coverageDetails.join(', ')}`);
  }
  
  if (info.deductible.individual) {
    parts.push(`• Deductible: ${info.deductible.individual}`);
  }
  if (info.maximumBenefit) {
    parts.push(`• Annual Maximum: ${info.maximumBenefit}`);
  }
  
  if (info.confidence < 60) {
    parts.push('\n⚠️ Some information may be incomplete. Please verify the details are correct.');
  }
  
  return parts.join('\n');
}

/**
 * Upload document to OpenDental
 */
async function uploadToOpenDental(
  clinicCreds: ClinicCredentials,
  patNum: number,
  imageBase64: string,
  extension: string,
  description: string
): Promise<any> {
  const AUTH_HEADER = `ODFHIR ${clinicCreds.developerKey}/${clinicCreds.customerKey}`;
  
  // Determine image type based on extension
  const isPdfDoc = extension.toLowerCase() === '.pdf';
  const imgType = isPdfDoc ? 'Document' : 'Photo';
  
  const uploadPayload = {
    PatNum: patNum,
    rawBase64: imageBase64,
    extension: extension,
    Description: description,
    ImgType: imgType, // 'Document' for PDFs, 'Photo' for images
    DocCategory: 1, // Default category - adjust based on clinic setup
    DateCreated: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };
  
  const response = await axios.post(`${OPEN_DENTAL_API_BASE}/documents/Upload`, uploadPayload, {
    headers: {
      'Authorization': AUTH_HEADER,
      'Content-Type': 'application/json',
    },
  });
  
  return response.data;
}

/**
 * Main handler for insurance image processing
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = getCorsHeaders(event);
  
  console.log('Insurance Textract Handler - Processing request');
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    
    const { 
      images,           // Array of base64 images (front/back of card)
      clinicId,         // Clinic identifier
      patNum,           // Optional: Patient number for OpenDental upload
      uploadToOD,       // Optional: Whether to upload to OpenDental
      sessionId,        // Optional: Chat session ID for context
    } = body;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'At least one image or PDF is required. Send files as base64 encoded strings.',
          example: {
            images: [{ base64: 'base64_data_here', type: 'image/jpeg' }],
            clinicId: 'your-clinic-id',
          },
          supportedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'application/pdf'],
        }),
      };
    }
    
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'clinicId is required' }),
      };
    }
    
    // Get clinic credentials for OpenDental API
    const clinicCreds = await getClinicCredentials(clinicId);
    if (!clinicCreds) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: `Clinic not found: ${clinicId}` }),
      };
    }
    
    const allExtractedInfo: InsuranceInfo[] = [];
    const uploadedDocuments: any[] = [];
    
    // Process each image/PDF
    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      
      // Parse base64 data
      let base64Content = imageData.base64 || imageData;
      let fileType = imageData.type || 'image/jpeg';
      
      // Remove data URL prefix if present and detect type
      if (base64Content.includes(',')) {
        const parts = base64Content.split(',');
        const header = parts[0].toLowerCase();
        
        if (header.includes('application/pdf')) {
          fileType = 'application/pdf';
        } else if (header.includes('image/')) {
          const typeMatch = header.match(/image\/(jpeg|jpg|png|gif|bmp)/i);
          if (typeMatch) fileType = `image/${typeMatch[1].toLowerCase()}`;
        }
        base64Content = parts[1];
      }
      
      // Determine file extension
      const extMap: { [key: string]: string } = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'application/pdf': '.pdf',
      };
      const extension = extMap[fileType] || '.jpg';
      const isPdf = fileType === 'application/pdf';
      
      // Upload to S3 for Textract processing
      const s3Key = `insurance-cards/${clinicId}/${uuidv4()}${extension}`;
      const fileBuffer = Buffer.from(base64Content, 'base64');
      
      await s3Client.send(new PutObjectCommand({
        Bucket: IMAGE_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: fileType,
      }));
      
      console.log(`Uploaded ${isPdf ? 'PDF' : 'image'} to S3: ${s3Key}`);
      
      try {
        // Use Textract to analyze the document
        // For PDFs, try AnalyzeDocument first (works for single-page PDFs)
        // Fall back to DetectDocumentText if needed
        let textBlocks: any[] = [];
        
        try {
          const textractResponse = await textractClient.send(new AnalyzeDocumentCommand({
            Document: {
              S3Object: {
                Bucket: IMAGE_BUCKET,
                Name: s3Key,
              },
            },
            FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
          }));
          textBlocks = textractResponse.Blocks || [];
        } catch (analyzeError: any) {
          // If AnalyzeDocument fails (e.g., multi-page PDF), try DetectDocumentText
          console.warn('AnalyzeDocument failed, trying DetectDocumentText:', analyzeError.message);
          
          const detectResponse = await textractClient.send(new DetectDocumentTextCommand({
            Document: {
              S3Object: {
                Bucket: IMAGE_BUCKET,
                Name: s3Key,
              },
            },
          }));
          textBlocks = detectResponse.Blocks || [];
        }
        
        console.log(`Textract found ${textBlocks.length} blocks from ${isPdf ? 'PDF' : 'image'}`);
        
        // Parse insurance information
        const insuranceInfo = parseInsuranceInfo(textBlocks);
        allExtractedInfo.push(insuranceInfo);
        
        console.log(`Extracted insurance info:`, JSON.stringify(insuranceInfo, null, 2));
        
        // Upload to OpenDental if requested
        if (uploadToOD && patNum) {
          try {
            const side = images.length > 1 ? (i === 0 ? 'Front' : 'Back') : '';
            const description = `Insurance Card${side ? ` (${side})` : ''} - ${insuranceInfo.insuranceCompany || 'Unknown Insurance'}`;
            
            const uploadResult = await uploadToOpenDental(
              clinicCreds,
              patNum,
              base64Content,
              extension,
              description
            );
            
            uploadedDocuments.push({
              side,
              docNum: uploadResult.DocNum,
              fileName: uploadResult.FileName,
            });
            
            console.log(`Uploaded to OpenDental: ${uploadResult.DocNum}`);
          } catch (uploadError: any) {
            console.error('Failed to upload to OpenDental:', uploadError.message);
            // Continue processing - don't fail the entire request
          }
        }
      } finally {
        // Clean up S3 object after processing
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: IMAGE_BUCKET,
            Key: s3Key,
          }));
        } catch (deleteError) {
          console.warn('Failed to delete S3 object:', s3Key);
        }
      }
    }
    
    // Combine information from front and back of card
    const combinedInfo: InsuranceInfo = allExtractedInfo.reduce((acc, info) => {
      return {
        insuranceCompany: acc.insuranceCompany || info.insuranceCompany,
        groupName: acc.groupName || info.groupName,
        groupNumber: acc.groupNumber || info.groupNumber,
        memberId: acc.memberId || info.memberId,
        subscriberName: acc.subscriberName || info.subscriberName,
        subscriberId: acc.subscriberId || info.subscriberId,
        planType: acc.planType || info.planType,
        effectiveDate: acc.effectiveDate || info.effectiveDate,
        copay: {
          preventive: acc.copay.preventive || info.copay.preventive,
          basic: acc.copay.basic || info.copay.basic,
          major: acc.copay.major || info.copay.major,
          orthodontic: acc.copay.orthodontic || info.copay.orthodontic,
        },
        deductible: {
          individual: acc.deductible.individual || info.deductible.individual,
          family: acc.deductible.family || info.deductible.family,
        },
        maximumBenefit: acc.maximumBenefit || info.maximumBenefit,
        rxBin: acc.rxBin || info.rxBin,
        rxPcn: acc.rxPcn || info.rxPcn,
        rawText: `${acc.rawText}\n---\n${info.rawText}`,
        confidence: Math.max(acc.confidence, info.confidence),
      };
    }, allExtractedInfo[0]);
    
    // Format for chatbot response
    const chatbotMessage = formatInsuranceForChatbot(combinedInfo);
    
    // Build response
    const response = {
      success: true,
      extractedInfo: combinedInfo,
      chatbotMessage,
      uploadedDocuments: uploadedDocuments.length > 0 ? uploadedDocuments : undefined,
      prompt: buildInsurancePrompt(combinedInfo),
    };
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
    
  } catch (error: any) {
    console.error('Insurance Textract Handler Error:', error);
    
    return {
      statusCode: error.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: error.message || 'Failed to process insurance card image',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }),
    };
  }
};

/**
 * Build a prompt for the chatbot with insurance context
 */
function buildInsurancePrompt(info: InsuranceInfo): string {
  return `
The patient has uploaded their insurance card. Here is the extracted information:

INSURANCE INFORMATION:
- Insurance Company: ${info.insuranceCompany || 'Not detected'}
- Group Name: ${info.groupName || 'Not detected'}
- Group Number: ${info.groupNumber || 'Not detected'}
- Member ID: ${info.memberId || 'Not detected'}
- Subscriber Name: ${info.subscriberName || 'Not detected'}
- Plan Type: ${info.planType || 'Not detected'}
- Effective Date: ${info.effectiveDate || 'Not detected'}

COVERAGE DETAILS:
- Preventive Coverage: ${info.copay.preventive || 'Not detected'}
- Basic Coverage: ${info.copay.basic || 'Not detected'}
- Major Coverage: ${info.copay.major || 'Not detected'}
- Deductible: ${info.deductible.individual || 'Not detected'}
- Annual Maximum: ${info.maximumBenefit || 'Not detected'}

When responding to the patient:
1. Confirm the insurance information you found
2. If any critical information is missing (Group Number, Member ID), ask the patient to verify
3. Explain typical dental coverage:
   - Preventive (cleanings, x-rays, exams) usually covered at 80-100%
   - Basic (fillings, simple extractions) usually covered at 70-80%
   - Major (crowns, root canals, implants) usually covered at 50%
4. Mention that coverage can vary and they should verify benefits with their insurance provider
5. Offer to help schedule an appointment or answer questions about specific procedures
`.trim();
}

