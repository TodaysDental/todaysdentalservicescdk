import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
    GetMeetingCommand
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const ACTIVE_MEETINGS_TABLE = process.env.ACTIVE_MEETINGS_TABLE!;

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
            }
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
            attendeeInfo
        };

        await ddb.send(new PutCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Item: meetingInfo
        }));

        console.log(`[MeetingManager] Stored meeting info for ${meetingId}`);

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
            UpdateExpression: 'SET #status = :ended, endTime = :endTime',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':ended': 'ended',
                ':endTime': Date.now()
            }
        }));

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
