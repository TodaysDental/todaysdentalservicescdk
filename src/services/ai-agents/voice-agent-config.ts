/**
 * Voice Agent Configuration
 * 
 * Simple configuration for which AI agent handles after-hours calls.
 * Change it whenever you want - no scheduling complexity.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { PollyClient, DescribeVoicesCommand, type DescribeVoicesCommandOutput, type Voice } from '@aws-sdk/client-polly';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
} from '../../shared/utils/permissions-helper';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const pollyClient = new PollyClient({});

const VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || 'VoiceAgentConfig';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';

const AI_AGENTS_MODULE = 'IT';
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// ========================================================================
// TYPES
// ========================================================================

/**
 * Voice settings for customizing the AI voice experience
 */
export interface VoiceSettings {
  voiceId: string;           // Polly voice ID: "Joanna", "Matthew", "Ivy", etc.
  /**
   * Amazon Polly engine.
   * Note: Availability depends on voice + region + account.
   */
  engine: 'neural' | 'standard' | 'generative' | 'long-form';
  speakingRate?: 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast';
  pitch?: 'x-low' | 'low' | 'medium' | 'high' | 'x-high';
  volume?: 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud';
}

/**
 * After-hours call routing behavior for the clinic's MAIN phone number.
 *
 * IMPORTANT:
 * - This impacts `chime/inbound-router.ts` (clinic main line routing)
 * - It is NOT the same as "voice AI is available" — it is "what to do when CLOSED"
 */
export type AfterHoursCallingMode =
  | 'OFF'                    // Ignore clinic hours; always route to human agents
  | 'FORWARD_TO_AI'          // When CLOSED, forward to clinic.aiPhoneNumber
  | 'PLAY_CLOSED_MESSAGE'    // When CLOSED, play "clinic is closed" message and hang up
  | 'FORWARD_TO_AI_ALWAYS'   // ALWAYS forward to AI, ignoring clinic hours & agent availability
  ;

function normalizeAfterHoursCallingMode(value: unknown): AfterHoursCallingMode | undefined {
  if (
    value === 'OFF' ||
    value === 'FORWARD_TO_AI' ||
    value === 'PLAY_CLOSED_MESSAGE' ||
    value === 'FORWARD_TO_AI_ALWAYS'
  ) return value as AfterHoursCallingMode;
  return undefined;
}

/**
 * Available Polly voices for selection
 */
export const AVAILABLE_VOICES = [
  { id: 'Joanna', name: 'Joanna (Female)', language: 'en-US', neural: true, recommended: true },
  { id: 'Matthew', name: 'Matthew (Male)', language: 'en-US', neural: true, recommended: false },
  { id: 'Ivy', name: 'Ivy (Female, Child)', language: 'en-US', neural: true, recommended: false },
  { id: 'Kendra', name: 'Kendra (Female)', language: 'en-US', neural: true, recommended: false },
  { id: 'Kimberly', name: 'Kimberly (Female)', language: 'en-US', neural: true, recommended: false },
  { id: 'Salli', name: 'Salli (Female)', language: 'en-US', neural: true, recommended: false },
  { id: 'Joey', name: 'Joey (Male)', language: 'en-US', neural: true, recommended: false },
  { id: 'Justin', name: 'Justin (Male, Child)', language: 'en-US', neural: true, recommended: false },
  { id: 'Kevin', name: 'Kevin (Male, Child)', language: 'en-US', neural: true, recommended: false },
  { id: 'Ruth', name: 'Ruth (Female)', language: 'en-US', neural: true, recommended: false },
  { id: 'Stephen', name: 'Stephen (Male)', language: 'en-US', neural: true, recommended: false },
] as const;

export interface VoiceAgentConfig {
  clinicId: string;

  // ========================================
  // INBOUND AI CALLING TOGGLE
  // ========================================
  /**
   * Master switch for AI-powered inbound call handling.
   * When false, all after-hours calls will be handled by traditional voicemail.
   * Default: true (enabled) if inboundAgentId is set.
   */
  aiInboundEnabled?: boolean;

  /**
   * After-hours routing mode.
   *
   * Backwards compatibility:
   * - If this field is missing, routing derives a mode from `aiInboundEnabled` and `inboundAgentId`.
   */
  afterHoursCallingMode?: AfterHoursCallingMode;

  // Current agent for after-hours inbound calls
  inboundAgentId: string;
  inboundAgentName?: string;

  // ========================================
  // OUTBOUND AI CALLING TOGGLE
  // ========================================
  /**
   * Master switch for AI-powered outbound calls.
   * When false, scheduled outbound calls will be skipped.
   * Default: true (enabled) if outboundAgentId is set.
   */
  aiOutboundEnabled?: boolean;

  // Current agent for outbound calls (optional default)
  outboundAgentId?: string;
  outboundAgentName?: string;

  // Voice customization per clinic
  voiceSettings?: VoiceSettings;

  // Custom filler phrases (optional - defaults used if not set)
  customFillerPhrases?: string[];

  // Custom greetings (optional)
  afterHoursGreeting?: string;
  outboundGreetings?: {
    appointment_reminder?: string;
    follow_up?: string;
    payment_reminder?: string;
    reengagement?: string;
    custom?: string;
  };

  // Audit
  updatedAt: string;
  updatedBy: string;
}

export interface ClinicHours {
  clinicId: string;
  timezone: string;
  hours: {
    [day: string]: {
      open: string; // "09:00" (24-hour format)
      close: string; // "17:00" (24-hour format)
      closed?: boolean;
    };
  };
  updatedAt: string;
  updatedBy: string;
}

type PollyEngine = 'standard' | 'neural' | 'generative' | 'long-form';

function normalizePollyEngine(value: unknown): PollyEngine | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'standard' || raw === 'neural' || raw === 'generative') return raw;
  if (raw === 'long-form' || raw === 'longform' || raw === 'long_form') return 'long-form';
  return null;
}

type PollyVoiceSummary = {
  id: string;
  name?: string;
  gender?: string;
  languageCode?: string;
  languageName?: string;
  additionalLanguageCodes?: string[];
  supportedEngines?: string[];
};

type PollyVoicesResponse = {
  engine: PollyEngine;
  languageCode?: string;
  voices: PollyVoiceSummary[];
  region?: string;
  cached?: boolean;
};

const VOICES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const voicesCache: Map<string, { cachedAt: number; response: PollyVoicesResponse }> = new Map();

async function listPollyVoices(event: APIGatewayProxyEvent): Promise<PollyVoicesResponse> {
  const qs = event.queryStringParameters || {};
  const engine = normalizePollyEngine(qs.engine || 'neural') || 'neural';
  const languageCodeRaw = typeof qs.languageCode === 'string' ? qs.languageCode.trim() : '';
  const languageCode = languageCodeRaw || undefined;

  const cacheKey = `${engine}|${languageCode || '*'}`;
  const cached = voicesCache.get(cacheKey);
  if (cached && (Date.now() - cached.cachedAt) < VOICES_CACHE_TTL_MS) {
    return { ...cached.response, cached: true };
  }

  const voices: Voice[] = [];
  let nextToken: string | undefined = undefined;

  do {
    const resp: DescribeVoicesCommandOutput = await pollyClient.send(new DescribeVoicesCommand({
      Engine: engine as any,
      ...(languageCode ? { LanguageCode: languageCode as any } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    }));

    if (Array.isArray(resp.Voices)) {
      voices.push(...resp.Voices);
    }
    nextToken = resp.NextToken;
  } while (nextToken);

  const response: PollyVoicesResponse = {
    engine,
    languageCode,
    region: process.env.AWS_REGION,
    voices: voices
      .map((v) => ({
        id: v.Id || '',
        name: v.Name || v.Id || undefined,
        gender: v.Gender,
        languageCode: v.LanguageCode,
        languageName: v.LanguageName,
        additionalLanguageCodes: v.AdditionalLanguageCodes,
        supportedEngines: v.SupportedEngines,
      }))
      .filter((v) => !!v.id)
      .sort((a, b) => {
        const langA = a.languageCode || '';
        const langB = b.languageCode || '';
        if (langA !== langB) return langA.localeCompare(langB);
        return a.id.localeCompare(b.id);
      }),
  };

  voicesCache.set(cacheKey, { cachedAt: Date.now(), response });
  return response;
}

// ========================================================================
// HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || '';

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'CORS preflight' }) };
  }

  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // GET /voices - dynamic voice list from Polly (no clinicId required)
    if (path.includes('/voices')) {
      if (httpMethod !== 'GET') {
        return { statusCode: 405, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
      }

      const engineParam = event.queryStringParameters?.engine;
      const normalizedEngine = normalizePollyEngine(engineParam || 'neural');
      if (!normalizedEngine) {
        return {
          statusCode: 400,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: 'Invalid engine. Must be one of: standard, neural, generative, long-form' }),
        };
      }

      const resp = await listPollyVoices(event);
      return {
        statusCode: 200,
        headers: getCorsHeaders(event),
        body: JSON.stringify(resp),
      };
    }

    const clinicId = event.pathParameters?.clinicId;

    if (!clinicId) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'clinicId is required' }) };
    }

    // Route to clinic-hours handlers
    if (path.includes('/clinic-hours/')) {
      if (httpMethod === 'GET') {
        return await getClinicHours(event, userPerms, clinicId);
      }
      if (httpMethod === 'PUT') {
        return await updateClinicHours(event, userPerms, clinicId);
      }
    }

    // GET /voice-config/{clinicId} - Get current config
    if (httpMethod === 'GET') {
      return await getConfig(event, userPerms, clinicId);
    }

    // PUT /voice-config/{clinicId} - Update config (change the agent)
    if (httpMethod === 'PUT') {
      return await updateConfig(event, userPerms, clinicId);
    }

    return { statusCode: 405, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error: any) {
    console.error('Voice config error:', error);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error.message }) };
  }
};

// ========================================================================
// ROUTE HANDLERS
// ========================================================================

async function getConfig(
  event: APIGatewayProxyEvent,
  userPerms: any,
  clinicId: string
): Promise<APIGatewayProxyResult> {
  // Check access
  const userClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(clinicId)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
  }

  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  if (!config) {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        clinicId,
        aiInboundEnabled: false,
        afterHoursCallingMode: 'OFF',
        aiOutboundEnabled: false,
        inboundAgentId: null,
        outboundAgentId: null,
        message: 'No voice agent configured. Set one using PUT.',
      }),
    };
  }

  // Ensure UI gets a stable after-hours mode even for legacy configs
  const derivedAfterHoursMode: AfterHoursCallingMode =
    normalizeAfterHoursCallingMode(config.afterHoursCallingMode) ??
    (config.aiInboundEnabled === false
      ? 'OFF'
      : (config.aiInboundEnabled === true || !!config.inboundAgentId)
        ? 'FORWARD_TO_AI'
        : 'OFF');

  const configForResponse: VoiceAgentConfig = {
    ...config,
    afterHoursCallingMode: derivedAfterHoursMode,
  };

  // Add computed status for convenience
  const status = {
    aiInboundActive: config.aiInboundEnabled !== false && !!config.inboundAgentId,
    aiOutboundActive: config.aiOutboundEnabled !== false && !!config.outboundAgentId,
  };

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      config: configForResponse,
      status, // Computed active states (enabled AND agent configured)
    }),
  };
}

async function updateConfig(
  event: APIGatewayProxyEvent,
  userPerms: any,
  clinicId: string
): Promise<APIGatewayProxyResult> {
  // Check permission
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );

  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const body = JSON.parse(event.body || '{}');

  // Validate after-hours mode if provided
  const requestedAfterHoursMode = body.afterHoursCallingMode;
  const normalizedAfterHoursMode = normalizeAfterHoursCallingMode(requestedAfterHoursMode);
  if (requestedAfterHoursMode !== undefined && normalizedAfterHoursMode === undefined) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Invalid afterHoursCallingMode. Must be one of: OFF, FORWARD_TO_AI, PLAY_CLOSED_MESSAGE, FORWARD_TO_AI_ALWAYS',
      }),
    };
  }

  // Check if this is just a toggle update (no agent change)
  const isToggleOnly = (
    typeof body.aiInboundEnabled === 'boolean' ||
    typeof body.aiOutboundEnabled === 'boolean' ||
    typeof body.afterHoursCallingMode === 'string'
  ) && !body.inboundAgentId && !body.outboundAgentId;

  // If not a toggle-only update, require at least one agent ID
  if (!isToggleOnly && !body.inboundAgentId && !body.outboundAgentId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'At least inboundAgentId, outboundAgentId, aiInboundEnabled, aiOutboundEnabled, or afterHoursCallingMode is required'
      }),
    };
  }

  // Verify agents exist and belong to clinic
  let inboundAgentName: string | undefined;
  let outboundAgentName: string | undefined;

  if (body.inboundAgentId) {
    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId: body.inboundAgentId },
    }));

    if (!agentResponse.Item) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Inbound agent not found' }) };
    }

    const agent = agentResponse.Item;
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Inbound agent does not belong to this clinic' }) };
    }
    if (!agent.isActive || agent.bedrockAgentStatus !== 'PREPARED') {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Inbound agent is not ready' }) };
    }

    inboundAgentName = agent.name;
  }

  if (body.outboundAgentId) {
    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId: body.outboundAgentId },
    }));

    if (!agentResponse.Item) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Outbound agent not found' }) };
    }

    const agent = agentResponse.Item;
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Outbound agent does not belong to this clinic' }) };
    }
    if (!agent.isActive || agent.bedrockAgentStatus !== 'PREPARED') {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Outbound agent is not ready' }) };
    }

    outboundAgentName = agent.name;
  }

  // Get existing config to preserve fields
  const existingResponse = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));
  const existing = existingResponse.Item as VoiceAgentConfig | undefined;

  // Determine enabled states
  // If explicitly provided, use that. Otherwise, preserve existing or default to true if agent is set.
  const aiInboundEnabled =
    typeof body.aiInboundEnabled === 'boolean'
      ? body.aiInboundEnabled
      : (normalizedAfterHoursMode
        ? (normalizedAfterHoursMode === 'FORWARD_TO_AI' || normalizedAfterHoursMode === 'FORWARD_TO_AI_ALWAYS')
        : (existing?.aiInboundEnabled ?? true));

  const aiOutboundEnabled = typeof body.aiOutboundEnabled === 'boolean'
    ? body.aiOutboundEnabled
    : (existing?.aiOutboundEnabled ?? true);

  // Determine after-hours routing mode to store
  const afterHoursCallingMode: AfterHoursCallingMode =
    normalizedAfterHoursMode ??
    normalizeAfterHoursCallingMode(existing?.afterHoursCallingMode) ??
    (aiInboundEnabled ? 'FORWARD_TO_AI' : 'OFF');

  const config: VoiceAgentConfig = {
    clinicId,
    // AI calling toggles
    aiInboundEnabled,
    afterHoursCallingMode,
    aiOutboundEnabled,
    // Agent configurations
    inboundAgentId: body.inboundAgentId || existing?.inboundAgentId || '',
    inboundAgentName: inboundAgentName || existing?.inboundAgentName,
    outboundAgentId: body.outboundAgentId || existing?.outboundAgentId,
    outboundAgentName: outboundAgentName || existing?.outboundAgentName,
    // Voice settings (preserve existing)
    voiceSettings: body.voiceSettings || existing?.voiceSettings,
    customFillerPhrases: body.customFillerPhrases || existing?.customFillerPhrases,
    afterHoursGreeting: body.afterHoursGreeting || existing?.afterHoursGreeting,
    outboundGreetings: body.outboundGreetings || existing?.outboundGreetings,
    // Audit
    updatedAt: new Date().toISOString(),
    updatedBy: getUserDisplayName(userPerms),
  };

  await docClient.send(new PutCommand({
    TableName: VOICE_CONFIG_TABLE,
    Item: config,
  }));

  // Prepare response message based on what changed
  let message = 'Voice agent configuration updated';
  if (isToggleOnly) {
    const changes: string[] = [];
    if (typeof body.aiInboundEnabled === 'boolean') {
      changes.push(`AI inbound calling ${body.aiInboundEnabled ? 'ENABLED' : 'DISABLED'}`);
    }
    if (typeof body.aiOutboundEnabled === 'boolean') {
      changes.push(`AI outbound calling ${body.aiOutboundEnabled ? 'ENABLED' : 'DISABLED'}`);
    }
    if (typeof body.afterHoursCallingMode === 'string') {
      changes.push(`After-hours calling mode set to ${afterHoursCallingMode}`);
    }
    message = changes.join(', ');
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message,
      config,
    }),
  };
}

// ========================================================================
// CLINIC HOURS HANDLERS
// ========================================================================

async function getClinicHours(
  event: APIGatewayProxyEvent,
  userPerms: any,
  clinicId: string
): Promise<APIGatewayProxyResult> {
  // Check access
  const userClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(clinicId)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
  }

  const response = await docClient.send(new GetCommand({
    TableName: CLINIC_HOURS_TABLE,
    Key: { clinicId },
  }));

  const hours = response.Item as ClinicHours | undefined;

  if (!hours) {
    // Return default hours if not configured
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        clinicId,
        timezone: 'America/New_York',
        hours: {
          monday: { open: '09:00', close: '17:00' },
          tuesday: { open: '09:00', close: '17:00' },
          wednesday: { open: '09:00', close: '17:00' },
          thursday: { open: '09:00', close: '17:00' },
          friday: { open: '09:00', close: '17:00' },
          saturday: { closed: true },
          sunday: { closed: true },
        },
        message: 'Default hours (not configured). Update with PUT to customize.',
      }),
    };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ hours }),
  };
}

async function updateClinicHours(
  event: APIGatewayProxyEvent,
  userPerms: any,
  clinicId: string
): Promise<APIGatewayProxyResult> {
  // Check permission
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );

  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const body = JSON.parse(event.body || '{}');

  if (!body.hours || typeof body.hours !== 'object') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'hours object is required' }),
    };
  }

  // Validate hours format
  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/; // Valid 24-hour format HH:mm

  for (const [day, schedule] of Object.entries(body.hours)) {
    if (!validDays.includes(day.toLowerCase())) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: `Invalid day: ${day}. Must be one of: ${validDays.join(', ')}` }),
      };
    }
    const sched = schedule as any;
    if (!sched.closed && (!sched.open || !sched.close)) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: `Day ${day} must have open/close times or be marked closed` }),
      };
    }

    // VALIDATION FIX: Validate time format (HH:mm in 24-hour format)
    if (!sched.closed) {
      if (!timeRegex.test(sched.open)) {
        return {
          statusCode: 400,
          headers: getCorsHeaders(event),
          body: JSON.stringify({
            error: `Invalid open time for ${day}: "${sched.open}". Must be in HH:mm format (e.g., "09:00", "17:30")`
          }),
        };
      }
      if (!timeRegex.test(sched.close)) {
        return {
          statusCode: 400,
          headers: getCorsHeaders(event),
          body: JSON.stringify({
            error: `Invalid close time for ${day}: "${sched.close}". Must be in HH:mm format (e.g., "09:00", "17:30")`
          }),
        };
      }

      // VALIDATION FIX: Ensure open time is before close time
      const [openHour, openMin] = sched.open.split(':').map(Number);
      const [closeHour, closeMin] = sched.close.split(':').map(Number);
      const openMinutes = openHour * 60 + openMin;
      const closeMinutes = closeHour * 60 + closeMin;

      if (openMinutes >= closeMinutes) {
        return {
          statusCode: 400,
          headers: getCorsHeaders(event),
          body: JSON.stringify({
            error: `Invalid hours for ${day}: open time (${sched.open}) must be before close time (${sched.close})`
          }),
        };
      }
    }
  }

  const clinicHours: ClinicHours = {
    clinicId,
    timezone: body.timezone || 'America/New_York',
    hours: body.hours,
    updatedAt: new Date().toISOString(),
    updatedBy: getUserDisplayName(userPerms),
  };

  await docClient.send(new PutCommand({
    TableName: CLINIC_HOURS_TABLE,
    Item: clinicHours,
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Clinic hours updated successfully',
      hours: clinicHours,
    }),
  };
}

// ========================================================================
// EXPORTED FUNCTION - Used by voice-ai-handler.ts
// ========================================================================

/**
 * Check if AI inbound calling is enabled for a clinic
 * 
 * FIX: Unified logic with voice-ai-handler.ts getVoiceAgent()
 * 
 * Returns true in these cases:
 * 1. Config exists with aiInboundEnabled=true AND inboundAgentId is set
 * 2. Config exists with aiInboundEnabled=undefined (legacy) AND inboundAgentId is set
 * 3. NO config exists at all (new clinic - fallback agents will be used)
 * 
 * Returns false when:
 * 1. Config exists with aiInboundEnabled=false (explicitly disabled)
 * 2. Config exists but no inboundAgentId (user wants voicemail)
 */
export async function isAiInboundEnabled(clinicId: string): Promise<boolean> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  // FIX: No config = new clinic, allow fallback agent lookup
  if (!config) {
    return true; // voice-ai-handler.ts getVoiceAgent() will find a fallback
  }

  // Config exists but AI is explicitly disabled
  if (config.aiInboundEnabled === false) {
    return false;
  }

  // Config exists with agent configured
  if (config.inboundAgentId) {
    return true;
  }

  // Config exists but no agent and not explicitly enabled = use voicemail
  // (Legacy behavior: undefined + no agent = voicemail)
  if (config.aiInboundEnabled === undefined) {
    return false;
  }

  // aiInboundEnabled is true but no agent = try fallback
  return config.aiInboundEnabled === true;
}

/**
 * Get after-hours routing mode for clinic main-line inbound calls.
 *
 * Backwards compatibility:
 * - If `afterHoursCallingMode` is missing, derive:
 *   - aiInboundEnabled === false -> OFF
 *   - aiInboundEnabled === true OR inboundAgentId set -> FORWARD_TO_AI
 *   - else -> OFF
 * - If NO config exists at all, default to FORWARD_TO_AI (matches legacy `isAiInboundEnabled()` behavior)
 */
export async function getAfterHoursCallingMode(clinicId: string): Promise<AfterHoursCallingMode> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  // Explicit mode wins
  const explicit = normalizeAfterHoursCallingMode(config?.afterHoursCallingMode);
  if (explicit) return explicit;

  // Legacy default: no config -> allow after-hours AI forwarding
  if (!config) return 'FORWARD_TO_AI';

  if (config.aiInboundEnabled === false) return 'OFF';
  if (config.aiInboundEnabled === true || !!config.inboundAgentId) return 'FORWARD_TO_AI';

  return 'OFF';
}

/**
 * Check if AI outbound calling is enabled for a clinic
 * Returns true only if:
 * 1. aiOutboundEnabled is not explicitly false
 * 2. An outboundAgentId is configured
 * 
 * Note: Outbound has stricter requirements than inbound - must have explicit agent
 */
export async function isAiOutboundEnabled(clinicId: string): Promise<boolean> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  if (!config || !config.outboundAgentId) {
    return false;
  }

  // Default to enabled if not explicitly disabled
  return config.aiOutboundEnabled !== false;
}

/**
 * Get the configured voice agent for a clinic
 * Returns the currently set inbound agent, or null if not configured OR if disabled
 * 
 * FIX: This only returns explicitly configured agents. For fallback agents,
 * use voice-ai-handler.ts getVoiceAgent() which has full fallback logic.
 */
export async function getConfiguredVoiceAgent(clinicId: string): Promise<{ agentId: string; agentName?: string } | null> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  // Return null if no config, no agent, or explicitly disabled
  if (!config || !config.inboundAgentId || config.aiInboundEnabled === false) {
    return null;
  }

  return {
    agentId: config.inboundAgentId,
    agentName: config.inboundAgentName,
  };
}

/**
 * Get the configured outbound agent for a clinic
 * Returns null if not configured OR if disabled
 */
export async function getConfiguredOutboundAgent(clinicId: string): Promise<{ agentId: string; agentName?: string } | null> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  const config = response.Item as VoiceAgentConfig | undefined;

  // Return null if no config, no agent, or explicitly disabled
  if (!config || !config.outboundAgentId || config.aiOutboundEnabled === false) {
    return null;
  }

  return {
    agentId: config.outboundAgentId,
    agentName: config.outboundAgentName,
  };
}

/**
 * Get the full voice configuration for a clinic
 * Includes voice settings, custom greetings, and filler phrases
 */
export async function getFullVoiceConfig(clinicId: string): Promise<VoiceAgentConfig | null> {
  const response = await docClient.send(new GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId },
  }));

  return (response.Item as VoiceAgentConfig) || null;
}

/**
 * Default voice settings
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceId: 'Joanna',
  engine: 'neural',
  speakingRate: 'medium',
  pitch: 'medium',
  volume: 'medium',
};

/**
 * Default filler phrases used while AI is thinking
 */
export const DEFAULT_FILLER_PHRASES = [
  "Let me check that for you.",
  "One moment please.",
  "I'm looking into that now.",
  "Let me find that information.",
  "Just a moment while I check.",
  "I'm checking our system now.",
];

/**
 * Default outbound call greetings by purpose
 */
export const DEFAULT_OUTBOUND_GREETINGS: Record<string, string> = {
  appointment_reminder: "Hi {patientName}, this is {clinicName} calling to remind you about your upcoming dental appointment. Would you like to confirm, reschedule, or do you have any questions?",
  follow_up: "Hi {patientName}, this is {clinicName} calling to follow up on your recent visit. How are you feeling? Do you have any questions or concerns?",
  payment_reminder: "Hi {patientName}, this is {clinicName}. We're calling about an outstanding balance on your account. Would you like to discuss payment options or have any questions?",
  reengagement: "Hi {patientName}, this is {clinicName}. We noticed it's been a while since your last visit and wanted to check in. Would you like to schedule a check-up or cleaning?",
  custom: "{customMessage}",
};

/**
 * Default after-hours greeting
 */
export const DEFAULT_AFTER_HOURS_GREETING = "Thank you for calling {clinicName}. Our office is currently closed, but I'm ToothFairy, your AI dental assistant. I can help you schedule appointments, answer questions, or take a message. How can I help you today?";

