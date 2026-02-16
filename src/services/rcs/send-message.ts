/**
 * RCS Send Message Handler
 * 
 * Handles outbound RCS message sending via Twilio API.
 * This Lambda is called by internal services to send RCS messages to patients.
 * 
 * Supports:
 * - Plain text messages
 * - Rich cards with title, description, media, and buttons
 * - Carousels (multiple rich cards)
 * - Placeholder replacement (same as notifications stack)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import https from 'https';
import { isUnsubscribed } from '../shared/unsubscribe';
import { renderTemplate, buildTemplateContext } from '../../shared/utils/clinic-placeholders';
import { getTwilioCredentials } from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || '';
const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || 'TodaysDentalInsights-ClinicSecrets';

// Twilio credentials cache (fetched from DynamoDB GlobalSecrets table)
let twilioCredentialsCache: { accountSid: string; authToken: string } | null = null;
let twilioCredentialsCacheExpiry = 0;
const TWILIO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedTwilioCredentials(): Promise<{ accountSid: string; authToken: string }> {
  if (twilioCredentialsCache && Date.now() < twilioCredentialsCacheExpiry) {
    return twilioCredentialsCache;
  }

  const creds = await getTwilioCredentials();
  if (!creds) {
    throw new Error('Twilio credentials not found in GlobalSecrets table');
  }

  twilioCredentialsCache = creds;
  twilioCredentialsCacheExpiry = Date.now() + TWILIO_CACHE_TTL_MS;
  return creds;
}

// ============================================
// RCS CONFIG CACHE
// ============================================

interface CachedRcsConfig {
  rcsSenderId?: string;
  messagingServiceSid?: string;
  timestamp: number;
}

const rcsConfigCache: Map<string, CachedRcsConfig> = new Map();
const RCS_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get RCS sender configuration from ClinicSecrets DynamoDB table
 */
async function getClinicRcsConfig(clinicId: string): Promise<{ rcsSenderId?: string; messagingServiceSid?: string }> {
  // Check cache first
  const cached = rcsConfigCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < RCS_CONFIG_CACHE_TTL_MS) {
    return { rcsSenderId: cached.rcsSenderId, messagingServiceSid: cached.messagingServiceSid };
  }

  try {
    const result = await ddb.send(new GetCommand({
      TableName: CLINIC_SECRETS_TABLE,
      Key: { clinicId },
      ProjectionExpression: 'rcsSenderId, messagingServiceSid',
    }));

    const config = {
      rcsSenderId: result.Item?.rcsSenderId,
      messagingServiceSid: result.Item?.messagingServiceSid,
    };

    // Cache the result
    rcsConfigCache.set(clinicId, { ...config, timestamp: Date.now() });

    return config;
  } catch (error) {
    console.error(`Failed to get RCS config for clinic ${clinicId}:`, error);
    return {};
  }
}

// ============================================
// RCS RICH MEDIA TYPES
// ============================================

/**
 * RCS Button - supports URL links and quick replies
 * Twilio RCS supports up to 4 buttons per rich card
 */
export interface RCSButton {
  type: 'url' | 'reply' | 'call' | 'location';
  label: string;              // Max 25 characters
  value: string;              // URL, reply text, phone number, or location
}

/**
 * RCS Rich Card - structured content with optional media and buttons
 */
export interface RCSRichCard {
  title?: string;             // Max 200 characters
  description?: string;       // Max 2000 characters
  mediaUrl?: string;          // Image/video URL (recommended: 1440x720 for 16:9)
  mediaHeight?: 'short' | 'medium' | 'tall';  // Card media height
  buttons?: RCSButton[];      // Max 4 buttons
}

/**
 * RCS Carousel - horizontally scrolling collection of rich cards
 */
export interface RCSCarousel {
  cards: RCSRichCard[];       // 2-10 cards
  cardWidth?: 'small' | 'medium';
}

/**
 * Patient data for placeholder replacement
 */
export interface PatientData {
  FName?: string;
  LName?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: string | undefined;
}

interface SendRcsMessageRequest {
  clinicId: string;
  to: string;
  body?: string;              // Plain text message (required if no richCard/carousel)
  mediaUrl?: string;          // Legacy single media URL (for backwards compatibility)
  rcsSenderId?: string;
  statusCallback?: string;
  messagingServiceSid?: string;
  patientId?: string;         // Optional patient ID for unsubscribe checking
  skipUnsubscribeCheck?: boolean;  // Optional flag to bypass unsubscribe check

  // Rich media additions
  richCard?: RCSRichCard;     // Single rich card
  carousel?: RCSCarousel;     // Multiple rich cards in a carousel
  contentSid?: string;        // Twilio Content Template SID (pre-registered template)
  contentVariables?: Record<string, string>;  // Variables for Twilio Content template

  // Placeholder data
  patientData?: PatientData;  // Patient data for placeholder replacement

  // Analytics tracking
  templateId?: string;        // Internal template ID for analytics tracking
  templateName?: string;      // Template name for analytics
  campaignId?: string;        // Campaign ID for campaign analytics
  campaignName?: string;      // Campaign name for analytics

  // AI auto-reply metadata (optional)
  aiAgentId?: string;
  aiAgentName?: string;
  aiSessionId?: string;
  inReplyToSid?: string; // inbound Twilio MessageSid we are replying to
}

interface TwilioMessageResponse {
  sid: string;
  status: string;
  error_code?: number;
  error_message?: string;
}

// ============================================
// PLACEHOLDER RENDERING
// ============================================

/**
 * Render placeholders in a string using clinic and patient data
 * Supports: {clinic_name}, {phone_number}, {first_name}, {patient_name}, etc.
 */
async function renderPlaceholders(
  text: string | undefined,
  clinicId: string,
  patientData?: PatientData
): Promise<string> {
  if (!text) return '';
  const context = await buildTemplateContext(clinicId, patientData);
  return renderTemplate(text, context);
}

/**
 * Render placeholders in a rich card
 */
async function renderRichCardPlaceholders(
  card: RCSRichCard,
  clinicId: string,
  patientData?: PatientData
): Promise<RCSRichCard> {
  const [title, description] = await Promise.all([
    renderPlaceholders(card.title, clinicId, patientData),
    renderPlaceholders(card.description, clinicId, patientData)
  ]);

  let buttons = card.buttons;
  if (card.buttons) {
    buttons = await Promise.all(card.buttons.map(async btn => ({
      ...btn,
      label: await renderPlaceholders(btn.label, clinicId, patientData),
      value: btn.type === 'url' ? await renderPlaceholders(btn.value, clinicId, patientData) : btn.value
    })));
  }

  return {
    ...card,
    title,
    description,
    buttons
  };
}

/**
 * Build RCS rich card JSON for Twilio Content API
 * This creates the structure needed for Twilio's messaging API
 */
function buildRichCardPayload(card: RCSRichCard): object {
  const cardPayload: any = {
    richCard: {
      standaloneCard: {
        cardContent: {}
      }
    }
  };

  const content = cardPayload.richCard.standaloneCard.cardContent;

  if (card.title) {
    content.title = card.title.substring(0, 200);
  }

  if (card.description) {
    content.description = card.description.substring(0, 2000);
  }

  if (card.mediaUrl) {
    content.media = {
      height: card.mediaHeight?.toUpperCase() || 'MEDIUM',
      contentInfo: {
        fileUrl: card.mediaUrl,
        forceRefresh: false
      }
    };
  }

  if (card.buttons && card.buttons.length > 0) {
    content.suggestions = card.buttons.slice(0, 4).map(btn => {
      if (btn.type === 'url') {
        return {
          action: {
            openUrlAction: {
              url: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      } else if (btn.type === 'reply') {
        return {
          reply: {
            text: btn.label.substring(0, 25),
            postbackData: btn.value
          }
        };
      } else if (btn.type === 'call') {
        return {
          action: {
            dialAction: {
              phoneNumber: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      } else if (btn.type === 'location') {
        return {
          action: {
            viewLocationAction: {
              latLong: { latitude: 0, longitude: 0 },
              label: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      }
      return null;
    }).filter(Boolean);
  }

  return cardPayload;
}

/**
 * Build RCS carousel JSON for Twilio Content API
 */
function buildCarouselPayload(carousel: RCSCarousel): object {
  const carouselPayload: any = {
    richCard: {
      carouselCard: {
        cardWidth: carousel.cardWidth?.toUpperCase() || 'MEDIUM',
        cardContents: carousel.cards.slice(0, 10).map(card => {
          const content: any = {};

          if (card.title) {
            content.title = card.title.substring(0, 200);
          }

          if (card.description) {
            content.description = card.description.substring(0, 2000);
          }

          if (card.mediaUrl) {
            content.media = {
              height: card.mediaHeight?.toUpperCase() || 'MEDIUM',
              contentInfo: {
                fileUrl: card.mediaUrl,
                forceRefresh: false
              }
            };
          }

          if (card.buttons && card.buttons.length > 0) {
            content.suggestions = card.buttons.slice(0, 4).map(btn => {
              if (btn.type === 'url') {
                return {
                  action: {
                    openUrlAction: { url: btn.value },
                    text: btn.label.substring(0, 25)
                  }
                };
              } else if (btn.type === 'reply') {
                return {
                  reply: {
                    text: btn.label.substring(0, 25),
                    postbackData: btn.value
                  }
                };
              }
              return null;
            }).filter(Boolean);
          }

          return content;
        })
      }
    }
  };

  return carouselPayload;
}

/**
 * Send RCS message via Twilio API
 * Supports plain text, rich cards, carousels, and Content templates
 */
async function sendTwilioRcsMessage(
  to: string,
  body: string,
  rcsSenderId: string,
  statusCallbackUrl: string,
  messagingServiceSid?: string,
  mediaUrl?: string,
  richCard?: RCSRichCard,
  carousel?: RCSCarousel,
  contentSid?: string,
  contentVariables?: Record<string, string>
): Promise<TwilioMessageResponse> {
  // Get Twilio credentials from DynamoDB
  const twilioCreds = await getCachedTwilioCredentials();

  return new Promise((resolve, reject) => {
    const data = new URLSearchParams();
    // Twilio requires both From and To to use the same channel prefix (rcs:)
    const rcsTo = to.startsWith('rcs:') ? to : `rcs:${to}`;
    data.append('To', rcsTo);

    if (messagingServiceSid) {
      data.append('MessagingServiceSid', messagingServiceSid);
    } else if (rcsSenderId) {
      // Ensure From also has the rcs: prefix (it should already from ClinicSecrets)
      const rcsFrom = rcsSenderId.startsWith('rcs:') ? rcsSenderId : `rcs:${rcsSenderId}`;
      data.append('From', rcsFrom);
    }

    if (statusCallbackUrl) {
      data.append('StatusCallback', statusCallbackUrl);
    }

    // Handle different message types
    if (contentSid) {
      // Use Twilio Content Template (pre-registered rich template)
      data.append('ContentSid', contentSid);
      if (contentVariables) {
        data.append('ContentVariables', JSON.stringify(contentVariables));
      }
    } else if (richCard) {
      // Send as rich card (via body with structured JSON)
      // Note: Twilio RCS uses the Messages API with specific formatting
      const payload = buildRichCardPayload(richCard);
      data.append('Body', body || richCard.title || richCard.description || '');
      if (richCard.mediaUrl) {
        data.append('MediaUrl', richCard.mediaUrl);
      }
      // Store rich card data for reference
      data.append('Attributes', JSON.stringify({ richCard: payload }));
    } else if (carousel) {
      // Send as carousel
      const payload = buildCarouselPayload(carousel);
      data.append('Body', body || 'View options');
      // Store carousel data for reference
      data.append('Attributes', JSON.stringify({ carousel: payload }));
    } else {
      // Plain text message
      data.append('Body', body);
      if (mediaUrl) {
        data.append('MediaUrl', mediaUrl);
      }
    }

    const postData = data.toString();

    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${twilioCreds.accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Basic ' + Buffer.from(`${twilioCreds.accountSid}:${twilioCreds.authToken}`).toString('base64'),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(responseBody);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`Twilio API error: ${response.message || responseBody}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${responseBody}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Send Message Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const requestBody: SendRcsMessageRequest = JSON.parse(event.body || '{}');
    const {
      clinicId,
      to,
      body: messageBody,
      mediaUrl,
      rcsSenderId,
      messagingServiceSid,
      patientId,
      skipUnsubscribeCheck,
      richCard,
      carousel,
      contentSid,
      contentVariables,
      patientData,
      templateId,
      templateName,
      campaignId,
      campaignName,
      aiAgentId,
      aiAgentName,
      aiSessionId,
      inReplyToSid,
    } = requestBody;

    // Validate required fields
    const hasContent = messageBody || richCard || carousel || contentSid;
    if (!clinicId || !to || !hasContent) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required fields: clinicId, to, and (body OR richCard OR carousel OR contentSid)',
        }),
      };
    }

    // Check if recipient has unsubscribed from RCS messages
    if (!skipUnsubscribeCheck && UNSUBSCRIBE_TABLE) {
      const rcsUnsubscribed = await isUnsubscribed(
        ddb,
        UNSUBSCRIBE_TABLE,
        { patientId, phone: to },
        clinicId,
        'RCS'
      );

      if (rcsUnsubscribed) {
        console.log(`Skipping RCS message for ${to} - unsubscribed`);

        // Store skipped message for audit
        const timestamp = Date.now();
        await ddb.send(new PutCommand({
          TableName: RCS_MESSAGES_TABLE,
          Item: {
            pk: `CLINIC#${clinicId}`,
            sk: `OUTBOUND#${timestamp}#SKIPPED`,
            clinicId,
            direction: 'outbound',
            to,
            body: messageBody,
            richCard,
            carousel,
            status: 'SKIPPED_UNSUBSCRIBED',
            timestamp,
            createdAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
          },
        }));

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            skipped: true,
            reason: 'unsubscribed',
            message: 'Recipient has unsubscribed from RCS messages',
          }),
        };
      }
    }

    // Build status callback URL for this clinic
    const statusCallbackUrl = `https://apig.todaysdentalinsights.com/rcs/${clinicId}/status`;

    // Get clinic RCS configuration from request, env var, or DynamoDB
    let effectiveRcsSenderId = rcsSenderId || process.env[`RCS_SENDER_${clinicId.toUpperCase()}`] || '';
    let effectiveMessagingServiceSid = messagingServiceSid || '';

    // If not provided in request or env, fetch from ClinicSecrets table
    if (!effectiveRcsSenderId && !effectiveMessagingServiceSid) {
      const clinicRcsConfig = await getClinicRcsConfig(clinicId);
      effectiveRcsSenderId = clinicRcsConfig.rcsSenderId || '';
      effectiveMessagingServiceSid = clinicRcsConfig.messagingServiceSid || '';
    }

    if (!effectiveRcsSenderId && !effectiveMessagingServiceSid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'No RCS sender ID or Messaging Service SID configured for this clinic',
        }),
      };
    }

    // Apply placeholder rendering
    const renderedBody = await renderPlaceholders(messageBody, clinicId, patientData);

    // Render placeholders in rich card if present
    let renderedRichCard: RCSRichCard | undefined;
    if (richCard) {
      renderedRichCard = await renderRichCardPlaceholders(richCard, clinicId, patientData);
    }

    // Render placeholders in carousel if present
    let renderedCarousel: RCSCarousel | undefined;
    if (carousel) {
      const renderedCards = await Promise.all(
        carousel.cards.map(card => renderRichCardPlaceholders(card, clinicId, patientData))
      );
      renderedCarousel = {
        ...carousel,
        cards: renderedCards
      };
    }

    // Send via Twilio
    const twilioResponse = await sendTwilioRcsMessage(
      to,
      renderedBody,
      effectiveRcsSenderId,
      statusCallbackUrl,
      effectiveMessagingServiceSid || undefined,
      mediaUrl,
      renderedRichCard,
      renderedCarousel,
      contentSid,
      contentVariables
    );

    const timestamp = Date.now();

    // Determine message type for logging
    let messageType: 'text' | 'media' | 'richCard' | 'carousel' | 'template' = 'text';
    if (contentSid) messageType = 'template';
    else if (renderedCarousel) messageType = 'carousel';
    else if (renderedRichCard) messageType = 'richCard';
    else if (mediaUrl) messageType = 'media';

    // Store the outbound message with analytics tracking fields
    await ddb.send(new PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `OUTBOUND#${timestamp}#${twilioResponse.sid}`,
        messageId: `${clinicId}#${twilioResponse.sid}`,
        clinicId,
        direction: 'outbound',
        messageSid: twilioResponse.sid,
        to,
        body: renderedBody,
        mediaUrl,
        richCard: renderedRichCard,
        carousel: renderedCarousel,
        contentSid,
        messageType,
        rcsSenderId: effectiveRcsSenderId,
        messagingServiceSid,
        status: twilioResponse.status || 'queued',
        timestamp,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
        // Analytics tracking fields
        templateId: templateId || contentSid || undefined,
        templateName: templateName || undefined,
        campaignId: campaignId || undefined,
        campaignName: campaignName || undefined,
        // AI metadata (optional)
        aiAgentId: aiAgentId || undefined,
        aiAgentName: aiAgentName || undefined,
        aiSessionId: aiSessionId || undefined,
        inReplyToSid: inReplyToSid || undefined,
        // Date fields for efficient analytics queries
        dateKey: new Date(timestamp).toISOString().split('T')[0], // YYYY-MM-DD for daily aggregation
        hourKey: new Date(timestamp).getUTCHours(), // 0-23 for hourly distribution
      },
    }));

    console.log(`RCS ${messageType} message sent for clinic ${clinicId}:`, twilioResponse.sid);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messageSid: twilioResponse.sid,
        status: twilioResponse.status,
        messageType,
      }),
    };
  } catch (error) {
    console.error('Error sending RCS message:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to send RCS message',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

