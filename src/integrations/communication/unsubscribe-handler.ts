/**
 * Unsubscribe Handler
 * 
 * Handles unsubscribe requests for email, SMS, and RCS communications.
 * 
 * Endpoints:
 * - GET /unsubscribe/{token} - Render unsubscribe confirmation page (public)
 * - POST /unsubscribe/{token} - Process unsubscribe request (public)
 * - GET /preferences - Get preferences for authenticated user (protected)
 * - PUT /preferences - Update preferences for authenticated user (protected)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  verifyUnsubscribeToken,
  recordUnsubscribe,
  recordResubscribe,
  getPreferences,
  CommunicationChannel,
  UnsubscribeTokenPayload,
} from '../../services/shared/unsubscribe';
import {
  getUserPermissions,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { 
  getClinicConfig, 
  getAllClinicConfigs,
  getGlobalSecret,
  ClinicConfig 
} from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE!;

// Cache for clinic info lookups
const clinicInfoCache = new Map<string, { name: string; email: string; phone: string }>();

// Clinic info lookup - fetch from DynamoDB
async function getClinicInfo(clinicId: string): Promise<{ name: string; email: string; phone: string }> {
  if (clinicInfoCache.has(clinicId)) {
    return clinicInfoCache.get(clinicId)!;
  }
  const config = await getClinicConfig(clinicId);
  const info = {
    name: config?.clinicName || 'Dental Clinic',
    email: config?.clinicEmail || '',
    phone: config?.clinicPhone || '',
  };
  clinicInfoCache.set(clinicId, info);
  return info;
}

// Helper functions
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

function http(code: number, body: any, event: APIGatewayProxyEvent, contentType?: string): APIGatewayProxyResult {
  const headers = getCorsHeaders(event);
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return { statusCode: code, headers, body: payload };
}

function parseBody(body: any): Record<string, any> {
  try {
    return typeof body === 'string' ? JSON.parse(body) : (body || {});
  } catch {
    return {};
  }
}

/**
 * Render the unsubscribe confirmation page (HTML)
 */
async function renderUnsubscribePage(tokenPayload: UnsubscribeTokenPayload, success?: boolean, error?: string): Promise<string> {
  const clinicInfo = tokenPayload.clinicId 
    ? await getClinicInfo(tokenPayload.clinicId) 
    : { name: 'Dental Clinic', email: '', phone: '' };
  const channelName = tokenPayload.channel === 'EMAIL' ? 'emails' : 
                      tokenPayload.channel === 'SMS' ? 'text messages' : 'RCS messages';

  if (success) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed - ${clinicInfo.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .icon { font-size: 64px; margin-bottom: 24px; }
    h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 16px; }
    p { color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
    .clinic-name { color: #764ba2; font-weight: 600; }
    .footer { font-size: 14px; color: #999; margin-top: 32px; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✅</div>
    <h1>You've Been Unsubscribed</h1>
    <p>
      You will no longer receive ${channelName} from 
      <span class="clinic-name">${clinicInfo.name}</span>.
    </p>
    <p>
      If you unsubscribed by mistake, please contact us at 
      <a href="mailto:${clinicInfo.email}">${clinicInfo.email}</a> or 
      call us at ${clinicInfo.phone}.
    </p>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ${clinicInfo.name}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
  }

  if (error) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Unsubscribe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .icon { font-size: 64px; margin-bottom: 24px; }
    h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 16px; }
    p { color: #666; font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⚠️</div>
    <h1>Something Went Wrong</h1>
    <p>${error}</p>
  </div>
</body>
</html>`;
  }

  // Confirmation page with form
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe - ${clinicInfo.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .header { text-align: center; margin-bottom: 32px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 16px; }
    .clinic-name { color: #764ba2; font-weight: 600; }
    .options { margin: 24px 0; }
    .option { 
      display: flex; 
      align-items: center; 
      padding: 16px; 
      border: 2px solid #e0e0e0; 
      border-radius: 12px; 
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .option:hover { border-color: #667eea; background: #f8f9ff; }
    .option.selected { border-color: #667eea; background: #f0f3ff; }
    .option input { margin-right: 16px; width: 20px; height: 20px; }
    .option-content h3 { color: #1a1a1a; font-size: 16px; margin-bottom: 4px; }
    .option-content p { color: #888; font-size: 14px; }
    .reason { margin: 24px 0; }
    .reason label { display: block; color: #666; font-size: 14px; margin-bottom: 8px; }
    .reason textarea { 
      width: 100%; 
      padding: 12px; 
      border: 2px solid #e0e0e0; 
      border-radius: 8px; 
      font-size: 14px;
      resize: vertical;
      min-height: 80px;
    }
    .reason textarea:focus { outline: none; border-color: #667eea; }
    .btn { 
      display: block;
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 12px;
    }
    .btn-primary { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
    }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(102,126,234,0.4); }
    .btn-secondary { background: #f0f0f0; color: #666; }
    .btn-secondary:hover { background: #e0e0e0; }
    .footer { text-align: center; font-size: 14px; color: #999; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon">📧</div>
      <h1>Manage Your Preferences</h1>
      <p class="subtitle">
        Choose what you'd like to unsubscribe from at 
        <span class="clinic-name">${clinicInfo.name}</span>
      </p>
    </div>

    <form method="POST" id="unsubscribeForm">
      <div class="options">
        <label class="option" onclick="selectOption(this)">
          <input type="radio" name="scope" value="channel" checked>
          <div class="option-content">
            <h3>Unsubscribe from ${channelName} only</h3>
            <p>You'll still receive other communications from us</p>
          </div>
        </label>

        <label class="option" onclick="selectOption(this)">
          <input type="radio" name="scope" value="clinic">
          <div class="option-content">
            <h3>Unsubscribe from all communications</h3>
            <p>Stop all emails, texts, and messages from ${clinicInfo.name}</p>
          </div>
        </label>

        <label class="option" onclick="selectOption(this)">
          <input type="radio" name="scope" value="global">
          <div class="option-content">
            <h3>Unsubscribe from all clinics</h3>
            <p>Stop all communications from Today's Dental network</p>
          </div>
        </label>
      </div>

      <div class="reason">
        <label for="reason">Why are you unsubscribing? (optional)</label>
        <textarea name="reason" id="reason" placeholder="Help us improve..."></textarea>
      </div>

      <button type="submit" class="btn btn-primary">Confirm Unsubscribe</button>
      <a href="javascript:history.back()" class="btn btn-secondary" style="text-align: center; text-decoration: none; display: block;">Cancel</a>
    </form>

    <div class="footer">
      <p>© ${new Date().getFullYear()} ${clinicInfo.name}. All rights reserved.</p>
    </div>
  </div>

  <script>
    function selectOption(el) {
      document.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
    }
    // Initialize first option as selected
    document.querySelector('.option').classList.add('selected');
  </script>
</body>
</html>`;
}

/**
 * Handle GET /unsubscribe/{token} - Render unsubscribe page
 */
async function handleGetUnsubscribe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const token = event.pathParameters?.token;
  
  if (!token) {
    return http(400, await renderUnsubscribePage({} as UnsubscribeTokenPayload, false, 'Invalid unsubscribe link.'), event, 'text/html');
  }

  const payload = verifyUnsubscribeToken(decodeURIComponent(token));
  
  if (!payload) {
    return http(400, await renderUnsubscribePage({} as UnsubscribeTokenPayload, false, 
      'This unsubscribe link has expired or is invalid. Please contact the clinic directly.'), event, 'text/html');
  }

  return http(200, await renderUnsubscribePage(payload), event, 'text/html');
}

/**
 * Handle POST /unsubscribe/{token} - Process unsubscribe
 */
async function handlePostUnsubscribe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const token = event.pathParameters?.token;
  
  if (!token) {
    return http(400, await renderUnsubscribePage({} as UnsubscribeTokenPayload, false, 'Invalid unsubscribe link.'), event, 'text/html');
  }

  const payload = verifyUnsubscribeToken(decodeURIComponent(token));
  
  if (!payload) {
    return http(400, await renderUnsubscribePage({} as UnsubscribeTokenPayload, false, 
      'This unsubscribe link has expired or is invalid. Please contact the clinic directly.'), event, 'text/html');
  }

  try {
    // Parse form data or JSON body
    let body: Record<string, any> = {};
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body || '');
      body = Object.fromEntries(params.entries());
    } else {
      body = parseBody(event.body);
    }

    const scope = body.scope || 'channel';
    const reason = body.reason || undefined;

    // Determine what to unsubscribe from based on scope
    let channels: CommunicationChannel[] = [];
    let clinicId = payload.clinicId;

    if (scope === 'global') {
      channels = ['EMAIL', 'SMS', 'RCS'];
      clinicId = 'GLOBAL';
    } else if (scope === 'clinic') {
      channels = ['EMAIL', 'SMS', 'RCS'];
    } else {
      channels = [payload.channel];
    }

    // Build identifier from payload
    const identifier: { patientId?: string; email?: string; phone?: string } = {};
    if (payload.patientId) identifier.patientId = payload.patientId;
    if (payload.email) identifier.email = payload.email;
    if (payload.phone) identifier.phone = payload.phone;

    // Record the unsubscribe
    await recordUnsubscribe(ddb, UNSUBSCRIBE_TABLE, identifier, clinicId, channels, reason, token);

    console.log(`Unsubscribe recorded: ${JSON.stringify(identifier)}, clinic: ${clinicId}, channels: ${channels.join(',')}`);

    return http(200, await renderUnsubscribePage(payload, true), event, 'text/html');
  } catch (error) {
    console.error('Error processing unsubscribe:', error);
    return http(500, await renderUnsubscribePage(payload, false, 
      'We encountered an error processing your request. Please try again or contact the clinic directly.'), event, 'text/html');
  }
}

/**
 * Handle GET /preferences - Get preferences for authenticated user
 */
async function handleGetPreferences(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters || {};
  const email = query.email || userPerms.email;
  const phone = query.phone;
  const patientId = query.patientId;

  if (!email && !phone && !patientId) {
    return http(400, { error: 'At least one identifier (email, phone, or patientId) is required' }, event);
  }

  try {
    const identifier: { patientId?: string; email?: string; phone?: string } = {};
    if (patientId) identifier.patientId = patientId;
    else if (email) identifier.email = email;
    else if (phone) identifier.phone = phone;

    const preferences = await getPreferences(ddb, UNSUBSCRIBE_TABLE, identifier);

    // Transform for API response
    const response = preferences.map(pref => ({
      clinicId: pref.clinicId,
      unsubscribedChannels: pref.unsubscribedChannels,
      unsubscribedAt: pref.unsubscribedAt,
      reason: pref.unsubscribeReason,
    }));

    return http(200, { success: true, preferences: response }, event);
  } catch (error) {
    console.error('Error getting preferences:', error);
    return http(500, { error: 'Failed to get preferences' }, event);
  }
}

/**
 * Handle PUT /preferences - Update preferences for authenticated user
 */
async function handlePutPreferences(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  
  const email = body.email || userPerms.email;
  const phone = body.phone;
  const patientId = body.patientId;
  const clinicId = body.clinicId || 'GLOBAL';
  const subscribeChannels: CommunicationChannel[] = body.subscribe || [];
  const unsubscribeChannels: CommunicationChannel[] = body.unsubscribe || [];

  if (!email && !phone && !patientId) {
    return http(400, { error: 'At least one identifier (email, phone, or patientId) is required' }, event);
  }

  try {
    const identifier: { patientId?: string; email?: string; phone?: string } = {};
    if (patientId) identifier.patientId = patientId;
    else if (email) identifier.email = email;
    else if (phone) identifier.phone = phone;

    // Process unsubscribes
    if (unsubscribeChannels.length > 0) {
      await recordUnsubscribe(ddb, UNSUBSCRIBE_TABLE, identifier, clinicId, unsubscribeChannels);
    }

    // Process resubscribes
    if (subscribeChannels.length > 0) {
      await recordResubscribe(ddb, UNSUBSCRIBE_TABLE, identifier, clinicId, subscribeChannels);
    }

    // Get updated preferences
    const preferences = await getPreferences(ddb, UNSUBSCRIBE_TABLE, identifier);
    const response = preferences.map(pref => ({
      clinicId: pref.clinicId,
      unsubscribedChannels: pref.unsubscribedChannels,
      unsubscribedAt: pref.unsubscribedAt,
    }));

    return http(200, { success: true, preferences: response }, event);
  } catch (error) {
    console.error('Error updating preferences:', error);
    return http(500, { error: 'Failed to update preferences' }, event);
  }
}

/**
 * Main handler
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Unsubscribe Handler Event:', JSON.stringify(event, null, 2));

  if (event.httpMethod === 'OPTIONS') {
    return http(204, '', event);
  }

  const path = event.path || '';
  const method = event.httpMethod;

  // Public unsubscribe endpoints (no auth required)
  if (path.includes('/unsubscribe/') && event.pathParameters?.token) {
    if (method === 'GET') {
      return handleGetUnsubscribe(event);
    }
    if (method === 'POST') {
      return handlePostUnsubscribe(event);
    }
  }

  // Protected preferences endpoints (auth required)
  if (path.endsWith('/preferences')) {
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return http(401, { error: 'Unauthorized - Invalid token' }, event);
    }

    if (method === 'GET') {
      return handleGetPreferences(event, userPerms);
    }
    if (method === 'PUT') {
      return handlePutPreferences(event, userPerms);
    }
  }

  return http(405, { error: 'Method Not Allowed' }, event);
};
