import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
    GetMeetingCommand,
    StartMeetingTranscriptionCommand,
    StopMeetingTranscriptionCommand,
    TranscriptionConfiguration
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const ACTIVE_MEETINGS_TABLE = process.env.ACTIVE_MEETINGS_TABLE!;
const TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || 'en-US';
const MEDICAL_VOCABULARY_NAME = process.env.MEDICAL_VOCABULARY_NAME;
const ENABLE_MEETING_TRANSCRIPTION = process.env.ENABLE_MEETING_TRANSCRIPTION !== 'false'; // Default to enabled

export interface MeetingInfo {
    meetingId: string;
    callId: string;
    clinicId: string;
    callType: 'inbound' | 'outbound';
    patientPhone: string;
    status: 'active' | 'ended';
    startTime: number;
    endTime?: number;
    participants: string[];
    attendeeInfo?: {
        attendeeId: string;
        joinToken: string;
        externalUserId: string;
    };
    transcriptionEnabled?: boolean; // Whether real-time transcription is active
    transcriptionStatus?: 'starting' | 'active' | 'stopped' | 'failed';
}

/**
 * Start real-time meeting transcription using Chime SDK StartMeetingTranscription API
 * 
 * This is the native way to enable real-time transcription for Chime SDK Meetings.
 * Unlike Media Insights Pipeline (which requires KVS streams), this API:
 * - Works directly with Chime SDK Meetings
 * - Supports SipMediaApplicationDialIn calls that join meetings via JoinChimeMeeting
 * - Delivers transcription events via EventBridge
 * - Supports Amazon Transcribe and Transcribe Medical
 * 
 * Transcription Flow:
 * 1. PSTN call joins meeting via JoinChimeMeeting
 * 2. We call StartMeetingTranscription API
 * 3. Chime sends audio to Amazon Transcribe
 * 4. Transcription events are published to EventBridge
 * 5. Lambda handler processes events and sends to AI
 * 
 * @param meetingId - Chime meeting ID
 * @param callId - Call ID for logging
 * @returns boolean indicating if transcription was started successfully
 */
async function startMeetingTranscription(meetingId: string, callId: string): Promise<boolean> {
    if (!ENABLE_MEETING_TRANSCRIPTION) {
        console.log(`[MeetingManager] Meeting transcription disabled via environment variable`);
        return false;
    }

    console.log(`[MeetingManager] Starting real-time transcription for meeting ${meetingId} (call ${callId})`);

    try {
        // Configure transcription settings
        // Using Amazon Transcribe (not Transcribe Medical) for dental appointments
        const transcriptionConfig: TranscriptionConfiguration = {
            EngineTranscribeSettings: {
                LanguageCode: TRANSCRIPTION_LANGUAGE as any,
                // Enable partial results for faster response time
                EnablePartialResultsStabilization: true,
                PartialResultsStability: 'high',
                // Optional: Use medical vocabulary if configured
                VocabularyName: MEDICAL_VOCABULARY_NAME || undefined,
                // Content identification for PII redaction (optional)
                // ContentIdentificationType: 'PII',
                // ContentRedactionType: 'PII',
            }
        };

        // Start transcription for the meeting
        await chime.send(new StartMeetingTranscriptionCommand({
            MeetingId: meetingId,
            TranscriptionConfiguration: transcriptionConfig
        }));

        console.log(`[MeetingManager] Successfully started transcription for meeting ${meetingId}`);
        console.log(`[MeetingManager] Transcription config:`, {
            language: TRANSCRIPTION_LANGUAGE,
            vocabulary: MEDICAL_VOCABULARY_NAME || 'default',
            partialResults: true,
            stability: 'high'
        });

        return true;
    } catch (error: any) {
        // Handle specific error cases
        if (error.name === 'ConflictException') {
            console.warn(`[MeetingManager] Transcription already active for meeting ${meetingId}`);
            return true; // Already running, consider it success
        }
        
        if (error.name === 'ServiceUnavailableException') {
            console.error(`[MeetingManager] Transcription service unavailable, will retry later`);
            return false;
        }

        console.error(`[MeetingManager] Failed to start transcription for meeting ${meetingId}:`, error);
        return false;
    }
}

/**
 * Stop meeting transcription
 * @param meetingId - Chime meeting ID
 */
async function stopMeetingTranscription(meetingId: string): Promise<void> {
    try {
        await chime.send(new StopMeetingTranscriptionCommand({
            MeetingId: meetingId
        }));
        console.log(`[MeetingManager] Stopped transcription for meeting ${meetingId}`);
    } catch (error: any) {
        // Ignore errors if transcription wasn't running
        if (error.name !== 'NotFoundException') {
            console.warn(`[MeetingManager] Error stopping transcription for meeting ${meetingId}:`, error);
        }
    }
}

/**
 * Create a Chime meeting for a call
 * @param clinicId - Clinic ID
 * @param callId - Unique call ID
 * @param callType - 'inbound' or 'outbound'
 * @param patientPhone - Patient's phone number
 * @returns Meeting and attendee information
 */
export async function createMeetingForCall(
    clinicId: string,
    callId: string,
    callType: 'inbound' | 'outbound',
    patientPhone: string
): Promise<MeetingInfo> {
    console.log(`[MeetingManager] Creating meeting for call ${callId}`);

    try {
        // Create Chime meeting
        const meetingResult = await chime.send(new CreateMeetingCommand({
            ExternalMeetingId: `call-${callId}`,
            MediaRegion: CHIME_MEDIA_REGION,
            MeetingFeatures: {
                Audio: {
                    EchoReduction: 'AVAILABLE'
                }
            },
            // IMPORTANT: For SipMediaApplicationDialIn product type limitations:
            // - We cannot use Voice Connector streaming (VC streaming requires direct SIP routing)
            // - Instead, we use Media Insights Pipeline attached to the meeting
            // - The pipeline will create KVS streams automatically
            Tags: [
                { Key: 'CallId', Value: callId },
                { Key: 'ClinicId', Value: clinicId },
                { Key: 'CallType', Value: callType }
            ]
        }));

        if (!meetingResult.Meeting?.MeetingId) {
            throw new Error('Failed to create meeting - no meeting ID returned');
        }

        const meetingId = meetingResult.Meeting.MeetingId;
        console.log(`[MeetingManager] Created meeting ${meetingId} for call ${callId}`);

        // Create attendee for patient (PSTN)
        const attendeeResult = await chime.send(new CreateAttendeeCommand({
            MeetingId: meetingId,
            ExternalUserId: `patient-${callId}`
        }));

        if (!attendeeResult.Attendee?.AttendeeId) {
            throw new Error('Failed to create attendee - no attendee ID returned');
        }

        const attendeeInfo = {
            attendeeId: attendeeResult.Attendee.AttendeeId,
            joinToken: attendeeResult.Attendee.JoinToken || '',
            externalUserId: `patient-${callId}`
        };

        // Start real-time transcription for natural language AI conversation
        // CRITICAL: This uses Chime SDK's native StartMeetingTranscription API
        // which works with SipMediaApplicationDialIn calls joining via JoinChimeMeeting
        const transcriptionEnabled = await startMeetingTranscription(meetingId, callId);
        
        // Store meeting info in DynamoDB
        const meetingInfo: MeetingInfo = {
            meetingId,
            callId,
            clinicId,
            callType,
            patientPhone,
            status: 'active',
            startTime: Date.now(),
            participants: [attendeeInfo.attendeeId],
            attendeeInfo,
            transcriptionEnabled,
            transcriptionStatus: transcriptionEnabled ? 'starting' : undefined
        };

        await ddb.send(new PutCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Item: meetingInfo
        }));

        console.log(`[MeetingManager] Stored meeting info for ${meetingId}${transcriptionEnabled ? ' with transcription enabled' : ' (transcription disabled)'}`);

        return meetingInfo;
    } catch (error) {
        console.error(`[MeetingManager] Error creating meeting for call ${callId}:`, error);
        throw error;
    }
}

/**
 * Add a human agent to an existing meeting
 * @param meetingId - Meeting ID
 * @param agentUserId - Agent's user ID
 * @returns Attendee information for the agent
 */
export async function addAgentToMeeting(meetingId: string, agentUserId: string): Promise<{
    attendeeId: string;
    joinToken: string;
    externalUserId: string;
}> {
    console.log(`[MeetingManager] Adding agent ${agentUserId} to meeting ${meetingId}`);

    try {
        // Create attendee for agent
        const attendeeResult = await chime.send(new CreateAttendeeCommand({
            MeetingId: meetingId,
            ExternalUserId: `agent-${agentUserId}`
        }));

        if (!attendeeResult.Attendee?.AttendeeId) {
            throw new Error('Failed to create attendee for agent - no attendee ID returned');
        }

        const attendeeInfo = {
            attendeeId: attendeeResult.Attendee.AttendeeId,
            joinToken: attendeeResult.Attendee.JoinToken || '',
            externalUserId: `agent-${agentUserId}`
        };

        // Update meeting participants in DynamoDB
        await ddb.send(new UpdateCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId },
            UpdateExpression: 'SET participants = list_append(if_not_exists(participants, :empty_list), :agent)',
            ExpressionAttributeValues: {
                ':agent': [attendeeInfo.attendeeId],
                ':empty_list': []
            }
        }));

        console.log(`[MeetingManager] Added agent ${agentUserId} to meeting ${meetingId}`);

        return attendeeInfo;
    } catch (error) {
        console.error(`[MeetingManager] Error adding agent to meeting ${meetingId}:`, error);
        throw error;
    }
}

/**
 * Get meeting information by meeting ID
 * @param meetingId - Meeting ID
 * @returns Meeting information
 */
export async function getMeetingInfo(meetingId: string): Promise<MeetingInfo | null> {
    try {
        const result = await ddb.send(new GetCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId }
        }));

        return result.Item as MeetingInfo | null;
    } catch (error) {
        console.error(`[MeetingManager] Error getting meeting info for ${meetingId}:`, error);
        throw error;
    }
}

/**
 * Get meeting information by call ID
 * @param callId - Call ID
 * @returns Meeting information
 */
export async function getMeetingByCallId(callId: string): Promise<MeetingInfo | null> {
    try {
        // Query by GSI if available, otherwise scan (less efficient)
        // For now, we'll assume a GSI exists on callId
        const result = await ddb.send(new GetCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { callId }
        }));

        return result.Item as MeetingInfo | null;
    } catch (error) {
        console.error(`[MeetingManager] Error getting meeting by call ID ${callId}:`, error);
        return null;
    }
}

/**
 * End a meeting and clean up resources
 * @param meetingId - Meeting ID
 */
export async function endMeeting(meetingId: string): Promise<void> {
    console.log(`[MeetingManager] Ending meeting ${meetingId}`);

    try {
        // Update meeting status in DynamoDB
        await ddb.send(new UpdateCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId },
            UpdateExpression: 'SET #status = :ended, endTime = :endTime, transcriptionStatus = :transcriptionStatus',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':ended': 'ended',
                ':endTime': Date.now(),
                ':transcriptionStatus': 'stopped'
            }
        }));

        // Stop transcription before deleting the meeting
        await stopMeetingTranscription(meetingId);

        // Delete Chime meeting (this disconnects all participants)
        try {
            await chime.send(new DeleteMeetingCommand({
                MeetingId: meetingId
            }));
            console.log(`[MeetingManager] Deleted Chime meeting ${meetingId}`);
        } catch (deleteError) {
            // Meeting might already be deleted, log but don't fail
            console.warn(`[MeetingManager] Error deleting Chime meeting ${meetingId}:`, deleteError);
        }

        console.log(`[MeetingManager] Ended meeting ${meetingId}`);
    } catch (error) {
        console.error(`[MeetingManager] Error ending meeting ${meetingId}:`, error);
        throw error;
    }
}

/**
 * Get meeting details from Chime
 * @param meetingId - Meeting ID
 * @returns Chime meeting details
 */
export async function getChimeMeeting(meetingId: string) {
    try {
        const result = await chime.send(new GetMeetingCommand({
            MeetingId: meetingId
        }));

        return result.Meeting;
    } catch (error) {
        console.error(`[MeetingManager] Error getting Chime meeting ${meetingId}:`, error);
        throw error;
    }
}

/**
 * Lambda handler for meeting management operations
 * This can be invoked by other services to create/manage meetings
 */
export async function handler(event: any) {
    console.log('[MeetingManager] Event:', JSON.stringify(event, null, 2));

    const operation = event.operation;

    try {
        switch (operation) {
            case 'createMeeting':
                const { clinicId, callId, callType, patientPhone } = event;
                const meetingInfo = await createMeetingForCall(clinicId, callId, callType, patientPhone);
                return {
                    statusCode: 200,
                    body: JSON.stringify(meetingInfo)
                };

            case 'addAgent':
                const { meetingId, agentUserId } = event;
                const attendeeInfo = await addAgentToMeeting(meetingId, agentUserId);
                return {
                    statusCode: 200,
                    body: JSON.stringify(attendeeInfo)
                };

            case 'getMeeting':
                const meetingData = await getMeetingInfo(event.meetingId);
                return {
                    statusCode: 200,
                    body: JSON.stringify(meetingData)
                };

            case 'endMeeting':
                await endMeeting(event.meetingId);
                return {
                    statusCode: 200,
                    body: JSON.stringify({ message: 'Meeting ended successfully' })
                };

            case 'startTranscription': {
                const transcriptionStarted = await startMeetingTranscription(event.meetingId, event.callId || 'unknown');
                // Update transcription status in DynamoDB
                if (transcriptionStarted) {
                    await ddb.send(new UpdateCommand({
                        TableName: ACTIVE_MEETINGS_TABLE,
                        Key: { meetingId: event.meetingId },
                        UpdateExpression: 'SET transcriptionEnabled = :enabled, transcriptionStatus = :status',
                        ExpressionAttributeValues: {
                            ':enabled': true,
                            ':status': 'active'
                        }
                    }));
                }
                return {
                    statusCode: 200,
                    body: JSON.stringify({ 
                        transcriptionEnabled: transcriptionStarted,
                        message: transcriptionStarted ? 'Transcription started' : 'Failed to start transcription'
                    })
                };
            }

            case 'stopTranscription':
                await stopMeetingTranscription(event.meetingId);
                await ddb.send(new UpdateCommand({
                    TableName: ACTIVE_MEETINGS_TABLE,
                    Key: { meetingId: event.meetingId },
                    UpdateExpression: 'SET transcriptionStatus = :status',
                    ExpressionAttributeValues: {
                        ':status': 'stopped'
                    }
                }));
                return {
                    statusCode: 200,
                    body: JSON.stringify({ message: 'Transcription stopped' })
                };

            default:
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid operation' })
                };
        }
    } catch (error) {
        console.error('[MeetingManager] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
