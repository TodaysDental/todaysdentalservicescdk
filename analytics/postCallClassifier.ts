import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import keywords from './keywords.json';
// Removed Amazon Connect dependency - now using Chime SDK Voice events
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.POSTCALL_TABLE || 'PostCallInsights';
// Chime SDK Voice configuration
const CHIME_VOICE_CONNECTOR_ID = process.env.CHIME_VOICE_CONNECTOR_ID || '';
const s3 = new S3Client({});
const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET || '';
const RECORDINGS_PREFIX = process.env.RECORDINGS_PREFIX || '';
const RECORDING_URL_TTL_SECONDS = parseInt(process.env.RECORDING_URL_TTL_SECONDS || '86400', 10);
// Removed CLINIC_QUEUE_ARN_MAP - clinic ID now comes directly from Chime SDK Voice events

type ChimeVoiceEvent = {
  version: string;
  account: string;
  region: string;
  detail: {
    CallId: string; // Changed from ContactId to CallId for Chime SDK
    VoiceConnectorId: string; // Changed from InstanceArn
    Transcripts?: Array<{ Content: string; ParticipantRole?: string; }>
    Sentiment?: { OverallSentiment?: string; }
    Channel?: string;
    ClinicId?: string; // Direct clinic identification
    AgentId?: string; // Direct agent identification
    Attributes?: Record<string, string>;
  };
};

export const handler = async (event: EventBridgeEvent<string, ChimeVoiceEvent['detail']>) => {
  const detail = event.detail;
  const callId = detail.CallId; // Updated from ContactId to CallId
  const transcript = (detail.Transcripts || []).map(t => t.Content).join(' ').toLowerCase();
  const sentiment = (detail.Sentiment?.OverallSentiment || '').toLowerCase();
  const attrs = detail.Attributes || {};

  // Extract data directly from Chime SDK Voice event (no need for additional API calls)
  const agentId = detail.AgentId;
  const clinicId = detail.ClinicId;
  const customerNumber = attrs.customerNumber || attrs.phoneNumber;

  const category = classifyCategory(transcript);
  const callType = classifyType(transcript);
  const score = scoreOpportunity(transcript, sentiment);

  const recording = await tryResolveRecording(detail).catch(() => undefined);

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      callId, // Updated field name
      contactId: callId, // Keep for backward compatibility
      ts: Date.now(),
      category,
      callType,
      score,
      sentiment,
      voiceConnectorId: detail.VoiceConnectorId || null, // Chime SDK specific
      attributes: attrs,
      agentId: agentId || null,
      agentUsername: agentId || null, // Use agentId as username for simplicity
      customerNumber: customerNumber || null,
      clinicId: clinicId || null,
      recording: recording || null,
    },
  }));

  return { ok: true };
};

function classifyCategory(text: string): 'opportunity' | 'not_opportunity' | 'neutral' | 'scored' {
  if (hasAny(text, (keywords as any).opportunity)) return 'opportunity';
  if (hasAny(text, (keywords as any).not_opportunity)) return 'not_opportunity';
  if (hasAny(text, (keywords as any).neutral)) return 'neutral';
  return 'scored';
}

// Removed resolveAgentAndNumber function - data now comes directly from Chime SDK Voice events

// Removed arnTail function - no longer needed with Chime SDK Voice

async function tryResolveRecording(detail: any): Promise<{ bucket: string; key: string; url: string } | undefined> {
  if (!RECORDINGS_BUCKET) return undefined;
  const callId = detail?.CallId;
  if (!callId) return undefined;
  const voiceConnectorId = detail?.VoiceConnectorId;

  const candidateKeys = new Set<string>();
  if (RECORDINGS_PREFIX) {
    const base = RECORDINGS_PREFIX
      .replaceAll('{callId}', callId)
      .replaceAll('{contactId}', callId) // Backward compatibility
      .replaceAll('{voiceConnectorId}', String(voiceConnectorId || ''))
      .replaceAll('{CALL_ID}', callId)
      .replaceAll('{VOICE_CONNECTOR_ID}', String(voiceConnectorId || ''));
    candidateKeys.add(base);
    candidateKeys.add(base.endsWith('.wav') || base.endsWith('.mp3') ? base : `${base}.wav`);
    candidateKeys.add(base.endsWith('.wav') || base.endsWith('.mp3') ? base : `${base}.mp3`);
  }
  // Common Chime SDK recording paths
  candidateKeys.add(`chime-voice/${callId}.wav`);
  candidateKeys.add(`chime-voice/${callId}.mp3`);
  candidateKeys.add(`recordings/${callId}.wav`);
  candidateKeys.add(`recordings/${callId}.mp3`);
  candidateKeys.add(`${callId}.wav`);
  candidateKeys.add(`${callId}.mp3`);
  // Backward compatibility with Connect paths
  candidateKeys.add(`connect/${callId}.wav`);
  candidateKeys.add(`connect/${callId}.mp3`);

  for (const key of candidateKeys) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: RECORDINGS_BUCKET, Key: key }));
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: RECORDINGS_BUCKET, Key: key }), { expiresIn: RECORDING_URL_TTL_SECONDS });
      return { bucket: RECORDINGS_BUCKET, key, url };
    } catch {}
  }
  return undefined;
}

// Removed resolveClinicId function - clinicId now comes directly from Chime SDK Voice events

function safeParseJson(s: string | undefined): any {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

function classifyType(text: string): 'marketing' | 'insurance' | 'billing' | 'appointment' | 'unknown' {
  if (hasAny(text, (keywords as any).marketing)) return 'marketing';
  if (hasAny(text, (keywords as any).insurance)) return 'insurance';
  if (hasAny(text, (keywords as any).billing)) return 'billing';
  if (hasAny(text, (keywords as any).appointment)) return 'appointment';
  return 'unknown';
}

function hasAny(text: string, arr: string[] = []) {
  return arr.some((k) => text.includes(String(k).toLowerCase()));
}

function scoreOpportunity(text: string, sentiment: string): number {
  let score = 0;
  if (sentiment === 'positive') score += 2;
  if (sentiment === 'negative') score -= 2;
  if (hasAny(text, (keywords as any).opportunity)) score += 3;
  if (hasAny(text, (keywords as any).not_opportunity)) score -= 3;
  if (hasAny(text, (keywords as any).appointment)) score += 2;
  return Math.max(0, Math.min(10, score + 5)); // normalize to 0-10 roughly
}


