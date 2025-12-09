/**
 * Voice AI Handler for After-Hours Calls
 * 
 * Handles real-time voice conversations using:
 * - Amazon Transcribe for speech-to-text
 * - Bedrock Agent for AI conversation
 * - Amazon Polly for text-to-speech
 * - Filler phrases to avoid silence during thinking
 * - Configurable voice settings per clinic
 * - Purpose-specific greetings for outbound calls
 * - Call analytics tracking
 * 
 * Integrates with Amazon Chime SIP Media Application
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  OutputFormat,
  VoiceId,
  Engine,
} from '@aws-sdk/client-polly';
import { v4 as uuidv4 } from 'uuid';
import { AiAgent } from './agents';
import {
  getConfiguredVoiceAgent,
  getFullVoiceConfig,
  VoiceAgentConfig,
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_FILLER_PHRASES,
  DEFAULT_OUTBOUND_GREETINGS,
  DEFAULT_AFTER_HOURS_GREETING,
} from './voice-agent-config';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  // Default voice settings (can be overridden per clinic)
  DEFAULT_VOICE_ID: VoiceId.Joanna,
  DEFAULT_VOICE_ENGINE: Engine.NEURAL,
  SAMPLE_RATE: '8000', // Telephony standard
  OUTPUT_FORMAT: OutputFormat.PCM,
  
  // Goodbye message
  GOODBYE_MESSAGE: "Thank you for calling. Have a great day!",
  
  // Error message
  ERROR_MESSAGE: "I apologize, but I'm having trouble processing your request. Please try calling back during office hours or leave a message.",
  
  // Analytics retention (90 days TTL)
  ANALYTICS_TTL_DAYS: 90,
};

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE || 'VoiceAiSessions';
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';
const CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || '';
const CALL_ANALYTICS_ENABLED = process.env.CALL_ANALYTICS_ENABLED === 'true';
const CALL_RECORDINGS_BUCKET = process.env.CALL_RECORDINGS_BUCKET || '';

// ========================================================================
// TYPES
// ========================================================================

interface ClinicHours {
  clinicId: string;
  timezone: string;
  hours: {
    [day: string]: {
      open: string; // "09:00"
      close: string; // "17:00"
      closed?: boolean;
    };
  };
}

interface VoiceSession {
  sessionId: string;
  callId: string;
  clinicId: string;
  agentId: string;
  callerNumber: string;
  bedrockSessionId: string;
  startTime: string;
  lastActivityTime: string;
  status: 'active' | 'ended';
  transcripts: Array<{
    speaker: 'caller' | 'ai';
    text: string;
    timestamp: string;
  }>;
  ttl: number;
}

interface VoiceAiEvent {
  eventType: 'NEW_CALL' | 'TRANSCRIPT' | 'CALL_ENDED' | 'DTMF';
  callId: string;
  clinicId: string;
  callerNumber?: string;
  transcript?: string;
  dtmfDigits?: string;
  sessionId?: string;
  // Outbound call context
  isOutbound?: boolean;
  purpose?: 'appointment_reminder' | 'follow_up' | 'payment_reminder' | 'reengagement' | 'custom';
  patientName?: string;
  customMessage?: string;
  scheduledCallId?: string;
  aiAgentId?: string;
  clinicName?: string;
  appointmentDate?: string;
}

interface VoiceAiResponse {
  action: 'SPEAK' | 'PLAY_AUDIO' | 'HANG_UP' | 'TRANSFER' | 'CONTINUE';
  text?: string;
  audioUrl?: string;
  transferNumber?: string;
  sessionId?: string;
}

/**
 * Call Analytics Record
 * 
 * IMPORTANT: This uses the SHARED CallAnalytics table from AnalyticsStack.
 * Schema must match AnalyticsStack.analyticsTable:
 *   - PK: callId (String) - unique call identifier
 *   - SK: timestamp (Number) - call start timestamp in milliseconds
 *   - GSIs: clinicId-timestamp, agentId-timestamp, callStatus-timestamp, etc.
 * 
 * This ensures Voice AI records appear alongside Chime stream records in dashboards.
 */
interface CallAnalytics {
  // Primary Key (shared table schema)
  callId: string;             // PK - unique call identifier
  timestamp: number;          // SK - call timestamp in milliseconds
  
  // Core fields (aligned with AnalyticsStack)
  clinicId: string;
  callStatus: 'active' | 'completed' | 'error';  // For GSI queries
  callCategory: 'ai_voice' | 'ai_outbound';      // Distinguishes AI calls
  
  // Call details
  callType: 'inbound' | 'outbound';
  purpose?: string;           // For outbound: appointment_reminder, follow_up, etc.
  duration: number;           // seconds
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'completed' | 'transferred' | 'error';
  
  // Agent info
  aiAgentId: string;          // Maps to agentId GSI
  aiAgentName?: string;
  
  // Caller info
  callerNumber?: string;
  patientName?: string;
  
  // Analytics fields
  transcriptSummary?: string;
  toolsUsed?: string[];       // Which OpenDental tools were called
  appointmentBooked?: boolean;
  overallSentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'MIXED';  // Aligned with Comprehend
  
  // Source identifier
  analyticsSource: 'voice_ai';  // Identifies these records came from Voice AI
  
  // TTL
  ttl: number;
}

/**
 * Cached voice config per clinic (for performance)
 */
const voiceConfigCache: Map<string, { config: VoiceAgentConfig | null; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Check if clinic is currently open
 */
async function isClinicOpen(clinicId: string): Promise<boolean> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: CLINIC_HOURS_TABLE,
      Key: { clinicId },
    }));

    const clinicHours = response.Item as ClinicHours | undefined;
    if (!clinicHours?.hours) {
      // No hours defined = always use AI
      return false;
    }

    const now = new Date();
    const timezone = clinicHours.timezone || 'America/New_York';
    
    // Get current time in clinic's timezone
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    
    const dayOfWeek = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentTime = hour * 60 + minute; // Minutes since midnight

    const todayHours = clinicHours.hours[dayOfWeek];
    if (!todayHours || todayHours.closed) {
      return false;
    }

    const [openHour, openMin] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
    const openTime = openHour * 60 + openMin;
    const closeTime = closeHour * 60 + closeMin;

    return currentTime >= openTime && currentTime < closeTime;
  } catch (error) {
    console.error('Error checking clinic hours:', error);
    return false; // Default to AI if can't check hours
  }
}

/**
 * Get cached voice config for a clinic
 */
async function getCachedVoiceConfig(clinicId: string): Promise<VoiceAgentConfig | null> {
  const cached = voiceConfigCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
  }
  
  const config = await getFullVoiceConfig(clinicId);
  voiceConfigCache.set(clinicId, { config, timestamp: Date.now() });
  return config;
}

/**
 * Get a random thinking phrase (uses clinic-specific or defaults)
 */
async function getThinkingPhrase(clinicId: string): Promise<string> {
  const config = await getCachedVoiceConfig(clinicId);
  const phrases = config?.customFillerPhrases?.length 
    ? config.customFillerPhrases 
    : DEFAULT_FILLER_PHRASES;
  
  const index = Math.floor(Math.random() * phrases.length);
  return phrases[index];
}

/**
 * Get greeting for the call based on type and purpose
 */
async function getGreeting(
  clinicId: string, 
  isOutbound: boolean, 
  purpose?: string,
  context?: { patientName?: string; clinicName?: string; appointmentDate?: string; customMessage?: string }
): Promise<string> {
  const config = await getCachedVoiceConfig(clinicId);
  let greeting: string;
  
  if (isOutbound && purpose) {
    // Use outbound greeting based on purpose
    const customGreetings = config?.outboundGreetings;
    greeting = customGreetings?.[purpose as keyof typeof customGreetings] 
      || DEFAULT_OUTBOUND_GREETINGS[purpose] 
      || DEFAULT_OUTBOUND_GREETINGS['custom'];
  } else {
    // Use after-hours inbound greeting
    greeting = config?.afterHoursGreeting || DEFAULT_AFTER_HOURS_GREETING;
  }
  
  // Replace placeholders with context
  if (context) {
    greeting = greeting
      .replace(/{patientName}/g, context.patientName || 'there')
      .replace(/{clinicName}/g, context.clinicName || 'our dental office')
      .replace(/{appointmentDate}/g, context.appointmentDate || 'your scheduled date')
      .replace(/{customMessage}/g, context.customMessage || '');
  }
  
  return greeting;
}

/**
 * Get voice settings for a clinic (or defaults)
 */
async function getVoiceSettings(clinicId: string): Promise<VoiceSettings> {
  const config = await getCachedVoiceConfig(clinicId);
  return config?.voiceSettings || DEFAULT_VOICE_SETTINGS;
}

/**
 * Convert text to speech using Amazon Polly with clinic-specific voice settings
 */
async function textToSpeech(text: string, clinicId?: string): Promise<Buffer> {
  const voiceSettings = clinicId ? await getVoiceSettings(clinicId) : DEFAULT_VOICE_SETTINGS;
  
  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: CONFIG.OUTPUT_FORMAT,
    VoiceId: voiceSettings.voiceId as VoiceId,
    Engine: voiceSettings.engine === 'neural' ? Engine.NEURAL : Engine.STANDARD,
    SampleRate: CONFIG.SAMPLE_RATE,
  });

  const response = await pollyClient.send(command);
  
  if (response.AudioStream) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  
  throw new Error('No audio stream returned from Polly');
}

/**
 * Record call analytics to the SHARED CallAnalytics table (from AnalyticsStack)
 * 
 * Uses the correct schema: PK=callId, SK=timestamp (Number)
 * This ensures Voice AI records are visible in the same dashboards as Chime records.
 */
async function recordCallAnalytics(params: {
  callId: string;
  clinicId: string;
  callType: 'inbound' | 'outbound';
  purpose?: string;
  duration: number;
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'completed' | 'transferred' | 'error';
  aiAgentId: string;
  aiAgentName?: string;
  callerNumber?: string;
  patientName?: string;
  transcriptSummary?: string;
  toolsUsed?: string[];
  appointmentBooked?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
}): Promise<void> {
  if (!CALL_ANALYTICS_ENABLED || !CALL_ANALYTICS_TABLE) {
    console.warn('[recordCallAnalytics] Call analytics disabled or table not configured');
    return;
  }

  try {
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + (CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60);
    
    // Map sentiment to Comprehend format
    const overallSentiment = params.sentiment 
      ? params.sentiment.toUpperCase() as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'
      : undefined;
    
    const analytics: CallAnalytics = {
      // Primary Key (shared table schema)
      callId: params.callId,
      timestamp: now,
      
      // Core fields
      clinicId: params.clinicId,
      callStatus: params.outcome === 'error' ? 'error' : 'completed',
      callCategory: params.callType === 'outbound' ? 'ai_outbound' : 'ai_voice',
      
      // Call details
      callType: params.callType,
      purpose: params.purpose,
      duration: params.duration,
      outcome: params.outcome,
      
      // Agent info
      aiAgentId: params.aiAgentId,
      aiAgentName: params.aiAgentName,
      
      // Caller info
      callerNumber: params.callerNumber,
      patientName: params.patientName,
      
      // Analytics fields
      transcriptSummary: params.transcriptSummary,
      toolsUsed: params.toolsUsed,
      appointmentBooked: params.appointmentBooked,
      overallSentiment,
      
      // Source identifier
      analyticsSource: 'voice_ai',
      
      // TTL
      ttl,
    };
    
    await docClient.send(new PutCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Item: analytics,
    }));
    
    console.log('[recordCallAnalytics] Analytics recorded to shared table:', {
      callId: analytics.callId,
      clinicId: analytics.clinicId,
      callType: analytics.callType,
      callCategory: analytics.callCategory,
      outcome: analytics.outcome,
      analyticsSource: analytics.analyticsSource,
    });
  } catch (error) {
    console.error('[recordCallAnalytics] Failed to record analytics:', error);
    // Don't throw - analytics failures shouldn't affect call handling
  }
}

/**
 * Get or create voice session
 */
async function getOrCreateSession(
  callId: string,
  clinicId: string,
  agentId: string,
  callerNumber: string
): Promise<VoiceSession> {
  // Check for existing session
  const existingResponse = await docClient.send(new QueryCommand({
    TableName: VOICE_SESSIONS_TABLE,
    IndexName: 'CallIdIndex',
    KeyConditionExpression: 'callId = :cid',
    ExpressionAttributeValues: { ':cid': callId },
  }));

  if (existingResponse.Items && existingResponse.Items.length > 0) {
    return existingResponse.Items[0] as VoiceSession;
  }

  // Create new session
  const sessionId = uuidv4();
  const bedrockSessionId = uuidv4();
  const now = new Date().toISOString();
  
  const session: VoiceSession = {
    sessionId,
    callId,
    clinicId,
    agentId,
    callerNumber,
    bedrockSessionId,
    startTime: now,
    lastActivityTime: now,
    status: 'active',
    transcripts: [],
    ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hour TTL
  };

  await docClient.send(new PutCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Item: session,
  }));

  return session;
}

/**
 * Update session with new transcript
 */
async function updateSessionTranscript(
  sessionId: string,
  speaker: 'caller' | 'ai',
  text: string
): Promise<void> {
  const now = new Date().toISOString();
  
  await docClient.send(new UpdateCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Key: { sessionId },
    UpdateExpression: 'SET transcripts = list_append(if_not_exists(transcripts, :empty), :transcript), lastActivityTime = :now',
    ExpressionAttributeValues: {
      ':empty': [],
      ':transcript': [{ speaker, text, timestamp: now }],
      ':now': now,
    },
  }));
}

/**
 * Get the voice AI agent for a clinic's after-hours calls
 * Priority order:
 * 1. CONFIGURED agent (from VoiceAgentConfig - change anytime via API)
 * 2. Agent with isDefaultVoiceAgent = true (fallback)
 * 3. Any voice-enabled agent for the clinic
 * 4. Any active agent for the clinic (last resort)
 */
async function getVoiceAgent(clinicId: string): Promise<AiAgent | null> {
  // FIRST: Check if there's a configured agent for this clinic
  const configuredAgent = await getConfiguredVoiceAgent(clinicId);
  if (configuredAgent) {
    // Fetch the full agent details
    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId: configuredAgent.agentId },
    }));
    
    if (agentResponse.Item && agentResponse.Item.isActive && agentResponse.Item.bedrockAgentStatus === 'PREPARED') {
      console.log(`Using CONFIGURED voice agent for clinic ${clinicId}:`, configuredAgent.agentId);
      return agentResponse.Item as AiAgent;
    }
  }

  // SECOND: Try to find the DEFAULT voice agent for this clinic
  const defaultResponse = await docClient.send(new QueryCommand({
    TableName: AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: 'isActive = :active AND isVoiceEnabled = :voice AND isDefaultVoiceAgent = :default AND bedrockAgentStatus = :status',
    ExpressionAttributeValues: {
      ':cid': clinicId,
      ':active': true,
      ':voice': true,
      ':default': true,
      ':status': 'PREPARED',
    },
  }));

  if (defaultResponse.Items && defaultResponse.Items.length > 0) {
    console.log(`Using DEFAULT voice agent for clinic ${clinicId}:`, defaultResponse.Items[0].agentId);
    return defaultResponse.Items[0] as AiAgent;
  }

  // THIRD: Try any voice-enabled agent for the clinic
  const voiceResponse = await docClient.send(new QueryCommand({
    TableName: AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: 'isActive = :active AND isVoiceEnabled = :voice AND bedrockAgentStatus = :status',
    ExpressionAttributeValues: {
      ':cid': clinicId,
      ':active': true,
      ':voice': true,
      ':status': 'PREPARED',
    },
    Limit: 1,
  }));

  if (voiceResponse.Items && voiceResponse.Items.length > 0) {
    console.log(`Using voice-enabled agent for clinic ${clinicId}:`, voiceResponse.Items[0].agentId);
    return voiceResponse.Items[0] as AiAgent;
  }

  // FOURTH: Fallback - any active agent
  const fallbackResponse = await docClient.send(new QueryCommand({
    TableName: AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: 'isActive = :active AND bedrockAgentStatus = :status',
    ExpressionAttributeValues: {
      ':cid': clinicId,
      ':active': true,
      ':status': 'PREPARED',
    },
    Limit: 1,
  }));

  if (fallbackResponse.Items && fallbackResponse.Items.length > 0) {
    console.log(`Using fallback agent for clinic ${clinicId}:`, fallbackResponse.Items[0].agentId);
    return fallbackResponse.Items[0] as AiAgent;
  }

  console.warn(`No suitable agent found for clinic ${clinicId}`);
  return null;
}

/**
 * Invoke AI agent and get response
 */
async function invokeAiAgent(
  agent: AiAgent,
  session: VoiceSession,
  userMessage: string
): Promise<{ response: string; thinking: string[] }> {
  const thinking: string[] = [];
  let fullResponse = '';

  const sessionAttributes: Record<string, string> = {
    clinicId: session.clinicId,
    callerNumber: session.callerNumber,
    isVoiceCall: 'true',
  };

  const invokeCommand = new InvokeAgentCommand({
    agentId: agent.bedrockAgentId,
    agentAliasId: agent.bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: {
      sessionAttributes,
    },
  });

  const bedrockResponse = await bedrockAgentClient.send(invokeCommand);

  if (bedrockResponse.completion) {
    for await (const event of bedrockResponse.completion) {
      // Capture thinking/trace
      if (event.trace?.trace) {
        const trace = event.trace.trace;
        
        if (trace.orchestrationTrace?.rationale?.text) {
          thinking.push(trace.orchestrationTrace.rationale.text);
        }
        
        if (trace.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const action = trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          thinking.push(`Checking: ${action.apiPath}`);
        }
      }

      // Capture response
      if (event.chunk?.bytes) {
        fullResponse += new TextDecoder().decode(event.chunk.bytes);
      }
    }
  }

  return { response: fullResponse || "I'm sorry, I couldn't process that request.", thinking };
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: VoiceAiEvent): Promise<VoiceAiResponse[]> => {
  console.log('Voice AI Event:', JSON.stringify(event, null, 2));

  const responses: VoiceAiResponse[] = [];
  const callStartTime = Date.now();
  let toolsUsed: string[] = [];

  try {
    switch (event.eventType) {
      case 'NEW_CALL': {
        const { 
          callId, 
          clinicId, 
          callerNumber,
          isOutbound,
          purpose,
          patientName,
          customMessage,
          clinicName,
          appointmentDate,
          aiAgentId,
        } = event;

        // For outbound calls, we skip the "is clinic open" check
        if (!isOutbound) {
          // Inbound call - check if clinic is open
          const isOpen = await isClinicOpen(clinicId);
          if (isOpen) {
            // During office hours - transfer to human
            return [{
              action: 'TRANSFER',
              transferNumber: 'QUEUE', // Transfer to agent queue
            }];
          }
        }

        // Get AI agent (use specific agent for outbound, or find one for inbound)
        let agent: AiAgent | null = null;
        
        if (aiAgentId) {
          // Specific agent requested (for outbound calls)
          const agentResponse = await docClient.send(new GetCommand({
            TableName: AGENTS_TABLE,
            Key: { agentId: aiAgentId },
          }));
          if (agentResponse.Item?.isActive && agentResponse.Item?.bedrockAgentStatus === 'PREPARED') {
            agent = agentResponse.Item as AiAgent;
          }
        }
        
        // Fallback to finding an agent
        if (!agent) {
          agent = await getVoiceAgent(clinicId);
        }
        
        if (!agent) {
          // Record analytics for failed call
          await recordCallAnalytics({
            callId,
            clinicId,
            callType: isOutbound ? 'outbound' : 'inbound',
            purpose,
            duration: 0,
            outcome: 'error',
            aiAgentId: '',
            callerNumber,
            patientName,
          });
          
          return [{
            action: 'SPEAK',
            text: "I'm sorry, our AI assistant is not available right now. Please call back during office hours.",
          }, {
            action: 'HANG_UP',
          }];
        }

        // Create session
        const session = await getOrCreateSession(callId, clinicId, agent.agentId, callerNumber || 'unknown');

        // Get appropriate greeting
        const greeting = await getGreeting(
          clinicId,
          isOutbound || false,
          purpose,
          { patientName, clinicName, appointmentDate, customMessage }
        );

        // Play greeting
        responses.push({
          action: 'SPEAK',
          text: greeting,
          sessionId: session.sessionId,
        });

        // Continue listening
        responses.push({
          action: 'CONTINUE',
          sessionId: session.sessionId,
        });

        console.log('[NEW_CALL] Session created:', {
          sessionId: session.sessionId,
          callId,
          clinicId,
          isOutbound,
          purpose,
          agentId: agent.agentId,
        });

        break;
      }

      case 'TRANSCRIPT': {
        // Caller said something
        const { callId, clinicId, transcript, sessionId } = event;

        if (!transcript || !sessionId) {
          return [{ action: 'CONTINUE', sessionId }];
        }

        // Get session
        const sessionResponse = await docClient.send(new GetCommand({
          TableName: VOICE_SESSIONS_TABLE,
          Key: { sessionId },
        }));
        const session = sessionResponse.Item as VoiceSession;

        if (!session) {
          return [{
            action: 'SPEAK',
            text: CONFIG.ERROR_MESSAGE,
          }, {
            action: 'HANG_UP',
          }];
        }

        // Save caller transcript
        await updateSessionTranscript(sessionId, 'caller', transcript);

        // Get agent
        const agent = await getVoiceAgent(clinicId);
        if (!agent) {
          return [{
            action: 'SPEAK',
            text: CONFIG.ERROR_MESSAGE,
          }, {
            action: 'HANG_UP',
          }];
        }

        // Check for goodbye phrases
        const lowerTranscript = transcript.toLowerCase();
        if (
          lowerTranscript.includes('goodbye') ||
          lowerTranscript.includes('bye') ||
          lowerTranscript.includes('thank you') ||
          lowerTranscript.includes('that\'s all')
        ) {
          await updateSessionTranscript(sessionId, 'ai', CONFIG.GOODBYE_MESSAGE);
          return [{
            action: 'SPEAK',
            text: CONFIG.GOODBYE_MESSAGE,
            sessionId,
          }, {
            action: 'HANG_UP',
          }];
        }

        // Play thinking phrase while AI processes (avoid silence)
        const fillerPhrase = await getThinkingPhrase(clinicId);
        responses.push({
          action: 'SPEAK',
          text: fillerPhrase,
          sessionId,
        });

        // Invoke AI agent
        const { response: aiResponse, thinking } = await invokeAiAgent(agent, session, transcript);

        // Extract tools used from thinking trace
        const detectedTools = thinking
          .filter((t: string) => t.includes('Checking:'))
          .map((t: string) => t.replace('Checking: ', ''));
        toolsUsed = [...new Set([...toolsUsed, ...detectedTools])];

        // Save AI response
        await updateSessionTranscript(sessionId, 'ai', aiResponse);

        // Speak AI response
        responses.push({
          action: 'SPEAK',
          text: aiResponse,
          sessionId,
        });

        // Continue listening
        responses.push({
          action: 'CONTINUE',
          sessionId,
        });

        break;
      }

      case 'DTMF': {
        // Caller pressed a key
        const { sessionId, dtmfDigits } = event;

        // Handle DTMF input (e.g., "Press 0 to speak to a representative")
        if (dtmfDigits === '0') {
          return [{
            action: 'SPEAK',
            text: "I'll connect you to our voicemail. Please leave a message after the tone.",
            sessionId,
          }, {
            action: 'TRANSFER',
            transferNumber: 'VOICEMAIL',
          }];
        }

        responses.push({
          action: 'CONTINUE',
          sessionId,
        });
        break;
      }

      case 'CALL_ENDED': {
        // Call ended
        const { sessionId, callId, clinicId, isOutbound, purpose, patientName, callerNumber } = event;

        if (sessionId) {
          // Get session for duration calculation
          const sessionResponse = await docClient.send(new GetCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
          }));
          const session = sessionResponse.Item as VoiceSession | undefined;
          
          // Update session status
          await docClient.send(new UpdateCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET #status = :ended, lastActivityTime = :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':ended': 'ended',
              ':now': new Date().toISOString(),
            },
          }));

          // Record analytics
          if (session) {
            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
            const transcriptSummary = session.transcripts
              ?.slice(-5)
              .map((t: { speaker: string; text: string }) => `${t.speaker}: ${t.text}`)
              .join(' | ');
            
            // Check if an appointment was booked (look for scheduling keywords in AI responses)
            const aiResponses = session.transcripts
              ?.filter((t: { speaker: string }) => t.speaker === 'ai')
              .map((t: { text: string }) => t.text.toLowerCase())
              .join(' ') || '';
            const appointmentBooked = 
              aiResponses.includes('scheduled') || 
              aiResponses.includes('booked') ||
              aiResponses.includes('appointment confirmed');

            await recordCallAnalytics({
              callId: session.callId,
              clinicId: session.clinicId,
              callType: isOutbound ? 'outbound' : 'inbound',
              purpose,
              duration,
              outcome: 'completed',
              aiAgentId: session.agentId,
              callerNumber: session.callerNumber,
              patientName,
              transcriptSummary,
              toolsUsed,
              appointmentBooked,
            });
          }
        }

        break;
      }

      default:
        console.warn('Unknown event type:', event.eventType);
    }

    return responses;
  } catch (error: any) {
    console.error('Voice AI error:', error);
    
    // Try to record error analytics
    try {
      await recordCallAnalytics({
        callId: event.callId,
        clinicId: event.clinicId,
        callType: event.isOutbound ? 'outbound' : 'inbound',
        purpose: event.purpose,
        duration: Math.floor((Date.now() - callStartTime) / 1000),
        outcome: 'error',
        aiAgentId: '',
        callerNumber: event.callerNumber,
        patientName: event.patientName,
      });
    } catch {
      // Ignore analytics errors
    }
    
    return [{
      action: 'SPEAK',
      text: CONFIG.ERROR_MESSAGE,
    }, {
      action: 'HANG_UP',
    }];
  }
};

// ========================================================================
// EXPORTS FOR CHIME INTEGRATION
// ========================================================================

export { 
  textToSpeech, 
  isClinicOpen, 
  getVoiceAgent, 
  getGreeting, 
  getVoiceSettings,
  recordCallAnalytics,
};

