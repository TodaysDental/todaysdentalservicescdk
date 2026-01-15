/**
 * Image Generator Lambda
 * 
 * Placeholder resolution for social media posts.
 * Takes canvas JSON + clinic IDs and returns resolved canvas data for each clinic.
 * 
 * For full server-side image generation with Sharp, deploy with a Lambda Layer
 * or use Docker bundling when available.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildCorsHeaders } from '../../shared/utils/cors';

// Try to import sharp, but provide fallback if not available
let sharp: any = null;
try {
  sharp = require('sharp');
} catch {
  console.log('Sharp not available - using placeholder resolution only mode');
}

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const CLINIC_TABLE = process.env.CLINIC_TABLE!;
const IMAGES_BUCKET = process.env.IMAGES_BUCKET!;
const MARKETING_MEDIA_BUCKET = process.env.MARKETING_MEDIA_BUCKET!;

// Placeholder types and their clinic field mappings
// Maps placeholder names to arrays of possible field names (in order of priority)
const PLACEHOLDER_MAPPING: Record<string, string[]> = {
  'clinic_name': ['clinicName', 'name'],
  'phone_number': ['clinicPhone', 'phoneNumber', 'phone'],
  'address': ['clinicAddress', 'address'],
  'email': ['clinicEmail', 'email'],
  'website': ['websiteLink', 'website'],
  'working_hours': ['workingHours', 'hours'],
  'clinic_logo': ['logoUrl', 'logo'],
  'clinic_city': ['clinicCity', 'city'],
  'clinic_state': ['clinicState', 'state'],
  // Also support camelCase versions for compatibility
  'clinicName': ['clinicName', 'name'],
  'clinicPhone': ['clinicPhone', 'phoneNumber', 'phone'],
  'clinicAddress': ['clinicAddress', 'address'],
  'clinicEmail': ['clinicEmail', 'email'],
  'clinicCity': ['clinicCity', 'city'],
  'clinicState': ['clinicState', 'state'],
  'websiteLink': ['websiteLink', 'website'],
  'phoneNumber': ['phoneNumber', 'clinicPhone', 'phone'],
  'logoUrl': ['logoUrl', 'logo'],
};

/**
 * Get clinic value from multiple possible field names
 */
function getClinicValue(clinicData: any, fieldNames: string[]): string {
  for (const field of fieldNames) {
    if (clinicData[field]) {
      return clinicData[field];
    }
  }
  return '';
}

interface CanvasElement {
  type: string;
  left: number;
  top: number;
  width?: number;
  height?: number;
  text?: string;
  fill?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: string;
  isPlaceholder?: boolean;
  placeholderType?: string;
  src?: string;
  [key: string]: any;
}

interface GenerateRequest {
  canvasJson: {
    width: number;
    height: number;
    backgroundColor?: string;
    objects: CanvasElement[];
  };
  clinicIds: string[];
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  mode?: 'resolve' | 'generate'; // 'resolve' just returns resolved JSON, 'generate' creates images
}

interface ResolvedCanvas {
  clinicId: string;
  clinicName: string;
  canvasJson: any;
  placeholdersResolved: string[];
}

interface GeneratedImage {
  clinicId: string;
  imageUrl: string;
  s3Key: string;
}

/**
 * Fetch clinic data from DynamoDB
 */
async function getClinicData(clinicIds: string[]): Promise<Record<string, any>> {
  const keys = clinicIds.map(id => ({ clinicId: id }));
  
  const response = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [CLINIC_TABLE]: { Keys: keys }
    }
  }));

  const clinics: Record<string, any> = {};
  const items = response.Responses?.[CLINIC_TABLE] || [];
  
  for (const item of items) {
    clinics[item.clinicId] = item;
  }

  return clinics;
}

/**
 * Resolve placeholders in canvas elements with clinic data
 */
function resolveCanvasPlaceholders(
  canvasJson: any, 
  clinicData: any
): { resolved: any; placeholdersResolved: string[] } {
  const resolved = JSON.parse(JSON.stringify(canvasJson));
  const placeholdersResolved: string[] = [];

  if (resolved.objects) {
    resolved.objects = resolved.objects.map((obj: CanvasElement) => {
      const resolvedObj = { ...obj };

      if (obj.isPlaceholder && obj.placeholderType) {
        const fieldNames = PLACEHOLDER_MAPPING[obj.placeholderType] || [obj.placeholderType];
        const value = getClinicValue(clinicData, fieldNames);
        placeholdersResolved.push(obj.placeholderType);

        if (obj.placeholderType === 'clinic_logo' || obj.placeholderType === 'logoUrl') {
          // Logo placeholder - update src
          resolvedObj.logoUrl = value;
          resolvedObj.src = value;
          resolvedObj.isPlaceholder = false;
        } else if (obj.text) {
          // Text placeholder - replace entire text with value OR replace {{placeholder}} pattern
          if (obj.text.includes('{{')) {
            resolvedObj.text = obj.text.replace(
              new RegExp(`\\{\\{${obj.placeholderType}\\}\\}`, 'g'),
              value
            );
          } else {
            // The text IS the placeholder display, replace entirely
            resolvedObj.text = value;
          }
          resolvedObj.isPlaceholder = false;
        }
      } else if (obj.text && typeof obj.text === 'string') {
        // Check for inline placeholders in any text
        let text = obj.text;
        for (const [placeholder, fieldNames] of Object.entries(PLACEHOLDER_MAPPING)) {
          const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
          if (regex.test(text)) {
            const value = getClinicValue(clinicData, fieldNames);
            text = text.replace(regex, value);
            if (!placeholdersResolved.includes(placeholder)) {
              placeholdersResolved.push(placeholder);
            }
          }
        }
        resolvedObj.text = text;
      }

      return resolvedObj;
    });
  }

  return { resolved, placeholdersResolved };
}

/**
 * Generate image using Sharp (if available)
 */
async function generateImageWithSharp(
  canvasJson: any,
  clinicData: any,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  quality: number = 90
): Promise<Buffer | null> {
  if (!sharp) {
    console.log('Sharp not available for image generation');
    return null;
  }

  const { width, height, backgroundColor = '#ffffff' } = canvasJson;

  try {
    // Create base image with background
    let image = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: hexToRgba(backgroundColor),
      }
    });

    // For full image generation, we would composite text and shapes here
    // This is a simplified version - full implementation requires more complex rendering

    // Convert to desired format
    switch (format) {
      case 'jpeg':
        return image.jpeg({ quality }).toBuffer();
      case 'webp':
        return image.webp({ quality }).toBuffer();
      default:
        return image.png().toBuffer();
    }
  } catch (error) {
    console.error('Error generating image with Sharp:', error);
    return null;
  }
}

/**
 * Convert hex color to RGBA object
 */
function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  // Handle gradient backgrounds - just use white
  if (hex.includes('gradient')) {
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }

  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle shorthand
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }

  const r = parseInt(hex.slice(0, 2), 16) || 255;
  const g = parseInt(hex.slice(2, 4), 16) || 255;
  const b = parseInt(hex.slice(4, 6), 16) || 255;
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

  return { r, g, b, alpha };
}

/**
 * Upload generated image to S3
 */
async function uploadToS3(
  buffer: Buffer,
  clinicId: string,
  format: string
): Promise<{ key: string; url: string }> {
  const timestamp = Date.now();
  const key = `generated/${clinicId}/${timestamp}.${format}`;

  await s3.send(new PutObjectCommand({
    Bucket: MARKETING_MEDIA_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: `image/${format}`,
    Metadata: {
      clinicId,
      generatedAt: new Date().toISOString(),
    }
  }));

  // Generate presigned URL for access
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MARKETING_MEDIA_BUCKET,
      Key: key,
    }),
    { expiresIn: 604800 } // 7 days
  );

  return { key, url };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ============================================
    // POST /generate - Generate/resolve for clinics
    // ============================================
    if (event.httpMethod === 'POST') {
      const body: GenerateRequest = JSON.parse(event.body || '{}');
      const { canvasJson, clinicIds, format = 'png', quality = 90, mode = 'resolve' } = body;

      if (!canvasJson || !clinicIds || clinicIds.length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'canvasJson and clinicIds are required' })
        };
      }

      // Validate canvas dimensions
      if (!canvasJson.width || !canvasJson.height) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Canvas width and height are required' })
        };
      }

      // Fetch clinic data
      const clinicData = await getClinicData(clinicIds);

      // Mode: 'resolve' - Just return resolved canvas JSON for client-side rendering
      if (mode === 'resolve' || !sharp) {
        const resolvedCanvases: ResolvedCanvas[] = [];
        const errors: Array<{ clinicId: string; error: string }> = [];

        for (const clinicId of clinicIds) {
          try {
            const clinic = clinicData[clinicId];
            
            if (!clinic) {
              errors.push({ clinicId, error: 'Clinic not found' });
              continue;
            }

            const { resolved, placeholdersResolved } = resolveCanvasPlaceholders(canvasJson, clinic);

            resolvedCanvases.push({
              clinicId,
              clinicName: clinic.clinicName || clinicId,
              canvasJson: resolved,
              placeholdersResolved,
            });
          } catch (error: any) {
            console.error(`Error resolving placeholders for clinic ${clinicId}:`, error);
            errors.push({ clinicId, error: error.message });
          }
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            mode: 'resolve',
            sharpAvailable: !!sharp,
            resolved: resolvedCanvases.length,
            failed: errors.length,
            canvases: resolvedCanvases,
            errors: errors.length > 0 ? errors : undefined,
          })
        };
      }

      // Mode: 'generate' - Generate actual images with Sharp
      const results: GeneratedImage[] = [];
      const errors: Array<{ clinicId: string; error: string }> = [];

      for (const clinicId of clinicIds) {
        try {
          const clinic = clinicData[clinicId];
          
          if (!clinic) {
            errors.push({ clinicId, error: 'Clinic not found' });
            continue;
          }

          // Resolve placeholders
          const { resolved } = resolveCanvasPlaceholders(canvasJson, clinic);

          // Generate image
          const imageBuffer = await generateImageWithSharp(resolved, clinic, format, quality);

          if (!imageBuffer) {
            errors.push({ clinicId, error: 'Failed to generate image' });
            continue;
          }

          // Upload to S3
          const { key, url } = await uploadToS3(imageBuffer, clinicId, format);

          results.push({
            clinicId,
            imageUrl: url,
            s3Key: key,
          });
        } catch (error: any) {
          console.error(`Error generating image for clinic ${clinicId}:`, error);
          errors.push({ clinicId, error: error.message });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          mode: 'generate',
          generated: results.length,
          failed: errors.length,
          images: results,
          errors: errors.length > 0 ? errors : undefined,
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Image Generator Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
