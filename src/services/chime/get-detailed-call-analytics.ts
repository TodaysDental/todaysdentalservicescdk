/**
 * Get Detailed Call Analytics
 * Provides comprehensive call information including:
 * - Call metadata (clinic, caller, direction, numbers, duration)
 * - Call history for the phone number
 * - Call insights (summary, appointment status, missed opportunity, etc.)
 * - Transcript with timestamps
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { getClinicsFromClaims, hasClinicAccess } from '../shared/utils/authorization';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);
const s3Client = new S3Client({});

const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME;
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE_NAME;
const CLINICS_TABLE = process.env.CLINICS_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

interface CallAnalyticsResponse {
  // Header Info
  clinicId: string;
  clinicName: string;
  callerName: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  to: string;
  from: string;
  callLength: number; // in seconds
  
  // Call History
  callHistory: CallHistoryEntry[];
  
  // Call Insights
  insights: {
    summary: string;
    missedOpportunity: 'yes' | 'no';
    missedOpportunityReason: string | null;
    appointmentStatus: 'scheduled' | 'not_scheduled' | 'rescheduled' | 'cancelled' | 'unknown';
    notSchedulingReason: string | null;
    billingConcerns: 'yes' | 'no';
    givenFeedback: 'yes' | 'no';
    priority: 'high' | 'medium' | 'low';
    inquiredServices: 'yes' | 'no';
    callType: 'appointment' | 'inquiry' | 'complaint' | 'billing' | 'emergency' | 'other';
  };
  
  // Transcript
  transcript: TranscriptEntry[];
}

interface CallHistoryEntry {
  callPath: string; // "from X to Y"
  date: string; // "MM/DD/YY"
  time: string; // "HH:MM:SS"
  duration: string; // "HH:MM:SS"
  typeOfCall: string;
}

interface TranscriptEntry {
  timestamp: string; // "HH:MM:SS"
  speaker: 'AGENT' | 'CUSTOMER';
  text: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[get-detailed-analytics] Invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters
  });

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // Authenticate
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID!);
    
    if (!verifyResult.ok) {
      return {
        statusCode: verifyResult.code,
        headers: corsHeaders,
        body: JSON.stringify({ message: verifyResult.message })
      };
    }

    const callId = event.pathParameters?.callId;
    if (!callId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Missing callId parameter' })
      };
    }

    // Get call record
    const callRecord = await getCallRecord(callId);
    if (!callRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call not found' })
      };
    }

    // Check authorization
    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    if (!hasClinicAccess(authorizedClinics, callRecord.clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }

    // Get clinic name
    const clinicName = await getClinicName(callRecord.clinicId);

    // Get call history for this phone number
    const callHistory = await getCallHistory(
      callRecord.phoneNumber, 
      callRecord.clinicId, 
      callId
    );

    // Get recording and transcript
    const recordingData = await getRecordingData(callId);

    // Get chat session for insights
    const sessionInsights = await getSessionInsights(callRecord.sessionId);

    // Extract caller name from session or patient lookup
    const callerName = sessionInsights.patientName || null;

    // Build response
    const response: CallAnalyticsResponse = {
      clinicId: callRecord.clinicId,
      clinicName: clinicName,
      callerName: callerName,
      direction: callRecord.direction?.toUpperCase() as 'INBOUND' | 'OUTBOUND' || 'INBOUND',
      to: callRecord.direction === 'inbound' ? callRecord.clinicPhoneNumber : callRecord.phoneNumber,
      from: callRecord.direction === 'inbound' ? callRecord.phoneNumber : callRecord.clinicPhoneNumber,
      callLength: callRecord.callDuration || 0,
      callHistory: callHistory,
      insights: {
        summary: sessionInsights.summary || 'No summary available',
        missedOpportunity: sessionInsights.missedOpportunity ? 'yes' : 'no',
        missedOpportunityReason: sessionInsights.missedOpportunityReason || null,
        appointmentStatus: sessionInsights.appointmentStatus || 'unknown',
        notSchedulingReason: sessionInsights.notSchedulingReason || null,
        billingConcerns: sessionInsights.billingConcerns ? 'yes' : 'no',
        givenFeedback: sessionInsights.givenFeedback ? 'yes' : 'no',
        priority: sessionInsights.priority || 'medium',
        inquiredServices: sessionInsights.inquiredServices ? 'yes' : 'no',
        callType: sessionInsights.callType || 'other'
      },
      transcript: recordingData.transcript || []
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error: any) {
    console.error('[get-detailed-analytics] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Internal server error',
        error: error?.message
      })
    };
  }
};

/**
 * Get call record from CallQueue table
 */
async function getCallRecord(callId: string): Promise<any> {
  try {
    // Try querying by pstnCallId index first
    const queryResult = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: 'pstnCallId-index',
      KeyConditionExpression: 'pstnCallId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));

    if (queryResult.Items && queryResult.Items.length > 0) {
      return queryResult.Items[0];
    }

    // Also try by callId field
    const queryResult2 = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));

    return queryResult2.Items?.[0] || null;

  } catch (error) {
    console.error('[getCallRecord] Error:', error);
    return null;
  }
}

/**
 * Get clinic name from Clinics table
 */
async function getClinicName(clinicId: string): Promise<string> {
  try {
    if (!CLINICS_TABLE) {
      return clinicId; // Fallback to ID if table not configured
    }

    const result = await ddb.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId }
    }));

    return result.Item?.name || result.Item?.clinicName || clinicId;
  } catch (error) {
    console.error('[getClinicName] Error:', error);
    return clinicId;
  }
}

/**
 * Get call history for a phone number
 */
async function getCallHistory(
  phoneNumber: string, 
  clinicId: string,
  currentCallId: string
): Promise<CallHistoryEntry[]> {
  try {
    // Query last 30 days of calls from this number
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: 'phoneNumber-queueEntryTime-index',
      KeyConditionExpression: 'phoneNumber = :phone AND queueEntryTime > :cutoff',
      FilterExpression: 'clinicId = :clinic',
      ExpressionAttributeValues: {
        ':phone': phoneNumber,
        ':clinic': clinicId,
        ':cutoff': thirtyDaysAgo
      },
      Limit: 50,
      ScanIndexForward: false // Most recent first
    }));

    const calls = result.Items || [];
    
    return calls
      .filter(call => call.callId !== currentCallId && call.pstnCallId !== currentCallId)
      .map(call => {
        const queueTime = call.queueEntryTime || call.queueEntryTimeIso;
        const date = queueTime 
          ? new Date(typeof queueTime === 'number' ? queueTime * 1000 : queueTime)
          : new Date();

        const duration = call.callDuration || 0;
        const durationStr = formatDuration(duration);

        const callPath = call.direction === 'inbound'
          ? `from ${call.phoneNumber} to ${call.clinicPhoneNumber || 'clinic'}`
          : `from ${call.clinicPhoneNumber || 'clinic'} to ${call.phoneNumber}`;

        const typeOfCall = determineCallType(call);

        return {
          callPath,
          date: date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }),
          time: date.toLocaleTimeString('en-US', { hour12: false }),
          duration: durationStr,
          typeOfCall
        };
      });

  } catch (error) {
    console.error('[getCallHistory] Error:', error);
    return [];
  }
}

/**
 * Get recording data and transcript
 */
async function getRecordingData(callId: string): Promise<{ transcript: TranscriptEntry[] }> {
  try {
    if (!RECORDING_METADATA_TABLE) {
      return { transcript: [] };
    }

    // Query recordings by callId
    const result = await ddb.send(new QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));

    const recording = result.Items?.[0];
    if (!recording) {
      return { transcript: [] };
    }

    // If transcript is stored in the record, use it
    if (recording.transcriptText) {
      return parseTranscriptText(recording.transcriptText);
    }

    // If transcript is in S3, fetch it
    if (recording.transcriptS3Key) {
      const transcriptData = await fetchTranscriptFromS3(recording.transcriptS3Key);
      return parseTranscriptData(transcriptData);
    }

    return { transcript: [] };

  } catch (error) {
    console.error('[getRecordingData] Error:', error);
    return { transcript: [] };
  }
}

/**
 * Get session insights from chat history
 */
async function getSessionInsights(sessionId: string | undefined): Promise<any> {
  if (!sessionId || !CHAT_HISTORY_TABLE) {
    return getDefaultInsights();
  }

  try {
    // Get all messages for the session
    const result = await ddb.send(new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      ScanIndexForward: true
    }));

    const messages = result.Items || [];
    
    // Find session state which contains analyzed insights
    const sessionState = messages.find(m => m.messageType === 'session_state');
    if (sessionState?.insights) {
      return sessionState.insights;
    }

    // Extract insights from messages
    return await analyzeSession(messages);

  } catch (error) {
    console.error('[getSessionInsights] Error:', error);
    return getDefaultInsights();
  }
}

/**
 * Analyze session messages to extract insights
 */
async function analyzeSession(messages: any[]): Promise<any> {
  const userMessages = messages.filter(m => m.messageType === 'user');
  const assistantMessages = messages.filter(m => m.messageType === 'assistant');
  
  // Build summary from conversation
  const summary = await buildSummary(userMessages, assistantMessages);
  
  // Detect appointment scheduling attempts
  const appointmentStatus = detectAppointmentStatus(messages);
  const notSchedulingReason = detectNotSchedulingReason(messages, appointmentStatus);
  
  // Detect missed opportunities
  const missedOpportunity = detectMissedOpportunity(messages, appointmentStatus);
  const missedOpportunityReason = missedOpportunity 
    ? detectMissedOpportunityReason(messages, appointmentStatus)
    : null;
  
  // Detect other flags
  const billingConcerns = detectBillingConcerns(messages);
  const givenFeedback = detectGivenFeedback(messages);
  const inquiredServices = detectInquiredServices(messages);
  const callType = detectCallType(messages);
  const priority = detectPriority(messages, callType, appointmentStatus);
  
  // Extract patient name if available
  const patientName = extractPatientName(messages);

  return {
    summary,
    appointmentStatus,
    notSchedulingReason,
    missedOpportunity,
    missedOpportunityReason,
    billingConcerns,
    givenFeedback,
    inquiredServices,
    callType,
    priority,
    patientName
  };
}

function getDefaultInsights() {
  return {
    summary: 'Call completed without recorded conversation.',
    appointmentStatus: 'unknown',
    notSchedulingReason: null,
    missedOpportunity: false,
    missedOpportunityReason: null,
    billingConcerns: false,
    givenFeedback: false,
    inquiredServices: false,
    callType: 'other',
    priority: 'medium',
    patientName: null
  };
}

/**
 * Build a summary from conversation messages
 */
async function buildSummary(userMessages: any[], assistantMessages: any[]): Promise<string> {
  if (userMessages.length === 0) {
    return 'No conversation recorded.';
  }

  // Try to extract the main topic/intent
  const firstUserMessage = userMessages[0]?.message || '';
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]?.message || '';

  // Simple summary generation
  let summary = 'The caller ';
  
  if (firstUserMessage.toLowerCase().includes('appointment')) {
    summary += 'called to schedule an appointment. ';
  } else if (firstUserMessage.toLowerCase().includes('emergency')) {
    summary += 'called with a dental emergency. ';
  } else if (firstUserMessage.toLowerCase().includes('cancel')) {
    summary += 'called to cancel an appointment. ';
  } else if (firstUserMessage.toLowerCase().includes('reschedule')) {
    summary += 'called to reschedule an appointment. ';
  } else {
    summary += 'initiated a conversation. ';
  }

  // Add outcome
  if (lastAssistantMessage.toLowerCase().includes('scheduled') || 
      lastAssistantMessage.toLowerCase().includes('booked')) {
    summary += 'An appointment was successfully scheduled.';
  } else if (lastAssistantMessage.toLowerCase().includes('no availability') || 
             lastAssistantMessage.toLowerCase().includes('no slots')) {
    summary += 'Unfortunately, no appointment slots were available.';
  } else {
    summary += 'The conversation concluded without scheduling an appointment.';
  }

  return summary;
}

function detectAppointmentStatus(messages: any[]): string {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  
  if (allText.includes('appointment scheduled') || allText.includes('booked successfully')) {
    return 'scheduled';
  }
  if (allText.includes('rescheduled')) {
    return 'rescheduled';
  }
  if (allText.includes('cancelled')) {
    return 'cancelled';
  }
  if (allText.includes('no availability') || allText.includes('no slots')) {
    return 'not_scheduled';
  }
  
  return 'unknown';
}

function detectNotSchedulingReason(messages: any[], appointmentStatus: string): string | null {
  if (appointmentStatus === 'scheduled') {
    return null;
  }

  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  
  if (allText.includes('no availability') || allText.includes('no slots')) {
    return 'No available appointment slots';
  }
  if (allText.includes('closed')) {
    return 'Clinic was closed';
  }
  if (allText.includes('will call back') || allText.includes('call later')) {
    return 'Caller will call back later';
  }
  
  return 'Not provided';
}

function detectMissedOpportunity(messages: any[], appointmentStatus: string): boolean {
  // Missed opportunity if caller wanted appointment but didn't get one
  if (appointmentStatus === 'scheduled') {
    return false;
  }

  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  
  // Indicators of intent to schedule
  const hasIntent = allText.includes('appointment') || 
                   allText.includes('schedule') || 
                   allText.includes('book') ||
                   allText.includes('emergency');

  return hasIntent && appointmentStatus !== 'scheduled';
}

function detectMissedOpportunityReason(messages: any[], appointmentStatus: string): string {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');

  if (allText.includes('no availability') || allText.includes('no slots')) {
    return 'No available appointment slots for the requested time';
  }
  if (allText.includes('closed')) {
    return 'Clinic was closed at the time of call';
  }
  if (!allText.includes('alternative') && !allText.includes('option')) {
    return 'No alternative solutions or options were provided';
  }

  return 'Caller\'s need was not met';
}

function detectBillingConcerns(messages: any[]): boolean {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  return allText.includes('billing') || 
         allText.includes('insurance') || 
         allText.includes('payment') ||
         allText.includes('cost');
}

function detectGivenFeedback(messages: any[]): boolean {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  return allText.includes('feedback') || 
         allText.includes('complaint') ||
         allText.includes('suggestion');
}

function detectInquiredServices(messages: any[]): boolean {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  const serviceKeywords = [
    'cleaning', 'whitening', 'filling', 'crown', 'bridge', 'implant',
    'extraction', 'root canal', 'denture', 'braces', 'orthodontic'
  ];
  
  return serviceKeywords.some(keyword => allText.includes(keyword));
}

function detectCallType(messages: any[]): string {
  const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
  
  if (allText.includes('emergency') || allText.includes('urgent') || allText.includes('pain')) {
    return 'emergency';
  }
  if (allText.includes('appointment') || allText.includes('schedule') || allText.includes('book')) {
    return 'appointment';
  }
  if (allText.includes('billing') || allText.includes('insurance') || allText.includes('payment')) {
    return 'billing';
  }
  if (allText.includes('complaint') || allText.includes('unhappy')) {
    return 'complaint';
  }
  if (allText.includes('question') || allText.includes('how much') || allText.includes('do you')) {
    return 'inquiry';
  }
  
  return 'other';
}

function detectPriority(messages: any[], callType: string, appointmentStatus: string): string {
  if (callType === 'emergency') {
    return 'high';
  }
  
  if (appointmentStatus === 'not_scheduled' && messages.length > 0) {
    const allText = messages.map(m => m.message?.toLowerCase() || '').join(' ');
    if (allText.includes('urgent') || allText.includes('soon') || allText.includes('asap')) {
      return 'high';
    }
  }

  if (callType === 'appointment' || callType === 'billing') {
    return 'medium';
  }

  return 'low';
}

function extractPatientName(messages: any[]): string | null {
  // Look for session state with PatNum and name
  const sessionState = messages.find(m => m.messageType === 'session_state');
  if (sessionState?.sessionState) {
    try {
      const state = typeof sessionState.sessionState === 'string' 
        ? JSON.parse(sessionState.sessionState)
        : sessionState.sessionState;
      
      if (state.FName && state.LName) {
        return `${state.FName} ${state.LName}`;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Try to extract from messages
  for (const msg of messages) {
    const text = msg.message?.toLowerCase() || '';
    const match = text.match(/name\s+is\s+([a-z]+\s+[a-z]+)/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function determineCallType(call: any): string {
  if (call.isCallback) return 'callback';
  if (call.isVip) return 'VIP';
  if (call.direction === 'outbound') return 'outbound';
  return call.direction || 'inbound';
}

function parseTranscriptText(transcriptText: string): { transcript: TranscriptEntry[] } {
  // Simple parsing of transcript text
  // Format: "AGENT: text\nCUSTOMER: text\n..."
  const lines = transcriptText.split('\n').filter(l => l.trim());
  const transcript: TranscriptEntry[] = [];
  
  let elapsedSeconds = 0;
  for (const line of lines) {
    if (line.includes('AGENT:') || line.includes('CUSTOMER:')) {
      const speaker = line.includes('AGENT:') ? 'AGENT' : 'CUSTOMER';
      const text = line.replace(/^(AGENT:|CUSTOMER:)/, '').trim();
      
      transcript.push({
        timestamp: formatTimestamp(elapsedSeconds),
        speaker,
        text
      });
      
      // Estimate ~5 seconds per line
      elapsedSeconds += 5;
    }
  }
  
  return { transcript };
}

async function fetchTranscriptFromS3(s3Key: string): Promise<any> {
  try {
    const bucketName = process.env.RECORDINGS_BUCKET_NAME;
    if (!bucketName) {
      return null;
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });

    const response = await s3Client.send(command);
    const bodyString = await response.Body?.transformToString();
    
    return bodyString ? JSON.parse(bodyString) : null;
  } catch (error) {
    console.error('[fetchTranscriptFromS3] Error:', error);
    return null;
  }
}

function parseTranscriptData(data: any): { transcript: TranscriptEntry[] } {
  if (!data || !data.results || !data.results.items) {
    return { transcript: [] };
  }

  const transcript: TranscriptEntry[] = [];
  let currentText = '';
  let currentSpeaker: 'AGENT' | 'CUSTOMER' = 'CUSTOMER';
  let currentTime = 0;

  for (const item of data.results.items) {
    if (item.type === 'pronunciation') {
      currentText += item.alternatives?.[0]?.content || '';
      currentTime = parseFloat(item.start_time || '0');
    } else if (item.type === 'punctuation') {
      currentText += item.alternatives?.[0]?.content || '';
      
      // End of sentence - create entry
      if (currentText.trim()) {
        transcript.push({
          timestamp: formatTimestamp(currentTime),
          speaker: currentSpeaker,
          text: currentText.trim()
        });
        
        currentText = '';
        // Alternate speaker for next segment
        currentSpeaker = currentSpeaker === 'AGENT' ? 'CUSTOMER' : 'AGENT';
      }
    }
  }

  // Add any remaining text
  if (currentText.trim()) {
    transcript.push({
      timestamp: formatTimestamp(currentTime),
      speaker: currentSpeaker,
      text: currentText.trim()
    });
  }

  return { transcript };
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

