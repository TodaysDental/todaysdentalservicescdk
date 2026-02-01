/**
 * Chime SDK Meeting Manager
 * =========================
 * Manages Amazon Chime SDK meetings for in-app voice/video calling.
 * This enables WebRTC-based real-time communication between users.
 */

import {
    ChimeSDKMeetingsClient,
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
    GetMeetingCommand,
    ListAttendeesCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import { v4 as uuidv4 } from 'uuid';

// ========================================
// CONFIGURATION
// ========================================

const REGION = process.env.AWS_REGION || 'us-east-1';
const CHIME_REGION = process.env.CHIME_REGION || 'us-east-1';

const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_REGION });

// ========================================
// TYPES
// ========================================

export interface ChimeMeetingInfo {
    meetingId: string;
    externalMeetingId: string;
    mediaPlacement: {
        audioHostUrl: string;
        audioFallbackUrl: string;
        signalingUrl: string;
        turnControlUrl: string;
        screenDataUrl?: string;
        screenViewingUrl?: string;
        screenSharingUrl?: string;
        eventIngestionUrl?: string;
    };
    mediaRegion: string;
}

export interface ChimeAttendeeInfo {
    attendeeId: string;
    externalUserId: string;
    joinToken: string;
}

export interface MeetingJoinInfo {
    meeting: ChimeMeetingInfo;
    attendee: ChimeAttendeeInfo;
}

// ========================================
// MEETING MANAGEMENT
// ========================================

/**
 * Create a new Chime SDK meeting for a call
 */
export async function createMeeting(
    callID: string,
    callType: 'voice' | 'video'
): Promise<ChimeMeetingInfo> {
    const externalMeetingId = `call-${callID}`;

    try {
        const response = await chimeClient.send(new CreateMeetingCommand({
            ClientRequestToken: uuidv4(),
            ExternalMeetingId: externalMeetingId,
            MediaRegion: CHIME_REGION,
            MeetingFeatures: {
                Audio: { EchoReduction: 'AVAILABLE' },
                Video: callType === 'video' ? { MaxResolution: 'HD' } : undefined,
            },
        }));

        if (!response.Meeting) {
            throw new Error('Failed to create meeting - no meeting data returned');
        }

        const meeting = response.Meeting;

        return {
            meetingId: meeting.MeetingId!,
            externalMeetingId: meeting.ExternalMeetingId!,
            mediaPlacement: {
                audioHostUrl: meeting.MediaPlacement?.AudioHostUrl!,
                audioFallbackUrl: meeting.MediaPlacement?.AudioFallbackUrl!,
                signalingUrl: meeting.MediaPlacement?.SignalingUrl!,
                turnControlUrl: meeting.MediaPlacement?.TurnControlUrl!,
                screenDataUrl: meeting.MediaPlacement?.ScreenDataUrl,
                screenViewingUrl: meeting.MediaPlacement?.ScreenViewingUrl,
                screenSharingUrl: meeting.MediaPlacement?.ScreenSharingUrl,
                eventIngestionUrl: meeting.MediaPlacement?.EventIngestionUrl,
            },
            mediaRegion: meeting.MediaRegion!,
        };
    } catch (error) {
        console.error('[ChimeMeetingManager] Error creating meeting:', error);
        throw error;
    }
}

/**
 * Create an attendee for a meeting
 */
export async function createAttendee(
    meetingId: string,
    userID: string,
    userName?: string
): Promise<ChimeAttendeeInfo> {
    try {
        const response = await chimeClient.send(new CreateAttendeeCommand({
            MeetingId: meetingId,
            ExternalUserId: userID,
            Capabilities: {
                Audio: 'SendReceive',
                Video: 'SendReceive',
                Content: 'SendReceive',
            },
        }));

        if (!response.Attendee) {
            throw new Error('Failed to create attendee - no attendee data returned');
        }

        const attendee = response.Attendee;

        return {
            attendeeId: attendee.AttendeeId!,
            externalUserId: attendee.ExternalUserId!,
            joinToken: attendee.JoinToken!,
        };
    } catch (error) {
        console.error('[ChimeMeetingManager] Error creating attendee:', error);
        throw error;
    }
}

/**
 * Create a meeting and add the first attendee (caller)
 */
export async function createMeetingWithAttendee(
    callID: string,
    callType: 'voice' | 'video',
    callerID: string,
    callerName?: string
): Promise<MeetingJoinInfo> {
    console.log(`[ChimeMeetingManager] Creating meeting for call ${callID}`);

    const meeting = await createMeeting(callID, callType);
    const attendee = await createAttendee(meeting.meetingId, callerID, callerName);

    console.log(`[ChimeMeetingManager] Meeting created: ${meeting.meetingId}, Attendee: ${attendee.attendeeId}`);

    return { meeting, attendee };
}

/**
 * Join an existing meeting as an attendee
 */
export async function joinMeeting(
    meetingId: string,
    userID: string,
    userName?: string
): Promise<MeetingJoinInfo> {
    console.log(`[ChimeMeetingManager] User ${userID} joining meeting ${meetingId}`);

    // Get meeting info
    const meetingResponse = await chimeClient.send(new GetMeetingCommand({
        MeetingId: meetingId,
    }));

    if (!meetingResponse.Meeting) {
        throw new Error('Meeting not found');
    }

    const meeting = meetingResponse.Meeting;

    // Create attendee for this user
    const attendee = await createAttendee(meetingId, userID, userName);

    return {
        meeting: {
            meetingId: meeting.MeetingId!,
            externalMeetingId: meeting.ExternalMeetingId!,
            mediaPlacement: {
                audioHostUrl: meeting.MediaPlacement?.AudioHostUrl!,
                audioFallbackUrl: meeting.MediaPlacement?.AudioFallbackUrl!,
                signalingUrl: meeting.MediaPlacement?.SignalingUrl!,
                turnControlUrl: meeting.MediaPlacement?.TurnControlUrl!,
                screenDataUrl: meeting.MediaPlacement?.ScreenDataUrl,
                screenViewingUrl: meeting.MediaPlacement?.ScreenViewingUrl,
                screenSharingUrl: meeting.MediaPlacement?.ScreenSharingUrl,
                eventIngestionUrl: meeting.MediaPlacement?.EventIngestionUrl,
            },
            mediaRegion: meeting.MediaRegion!,
        },
        attendee,
    };
}

/**
 * End a meeting
 */
export async function endMeeting(meetingId: string): Promise<void> {
    console.log(`[ChimeMeetingManager] Ending meeting ${meetingId}`);

    try {
        await chimeClient.send(new DeleteMeetingCommand({
            MeetingId: meetingId,
        }));
        console.log(`[ChimeMeetingManager] Meeting ${meetingId} ended successfully`);
    } catch (error: any) {
        // Meeting might already be ended
        if (error.name === 'NotFoundException') {
            console.log(`[ChimeMeetingManager] Meeting ${meetingId} already ended`);
        } else {
            console.error('[ChimeMeetingManager] Error ending meeting:', error);
            throw error;
        }
    }
}

/**
 * List attendees in a meeting
 */
export async function listAttendees(meetingId: string): Promise<ChimeAttendeeInfo[]> {
    try {
        const response = await chimeClient.send(new ListAttendeesCommand({
            MeetingId: meetingId,
        }));

        return (response.Attendees || []).map(attendee => ({
            attendeeId: attendee.AttendeeId!,
            externalUserId: attendee.ExternalUserId!,
            joinToken: '', // Not returned in list
        }));
    } catch (error) {
        console.error('[ChimeMeetingManager] Error listing attendees:', error);
        throw error;
    }
}
