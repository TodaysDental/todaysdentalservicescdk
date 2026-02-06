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

// NOTE:
// - CHIME_MEDIA_REGION controls where meeting media is hosted.
// - If unset, we fall back to CHIME_REGION (legacy), then AWS_REGION, then us-east-1.
const CHIME_MEDIA_REGION =
    process.env.CHIME_MEDIA_REGION ||
    process.env.CHIME_REGION ||
    process.env.AWS_REGION ||
    'us-east-1';

const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

// ========================================
// TYPES
// ========================================

export interface ChimeMeetingInfo {
    // Matches the shape expected by `amazon-chime-sdk-js` MeetingSessionConfiguration
    MeetingId: string;
    ExternalMeetingId?: string;
    MediaPlacement: {
        AudioHostUrl: string;
        AudioFallbackUrl: string;
        SignalingUrl: string;
        TurnControlUrl: string;
        ScreenDataUrl?: string;
        ScreenViewingUrl?: string;
        ScreenSharingUrl?: string;
        EventIngestionUrl?: string;
    };
    MediaRegion: string;
}

export interface ChimeAttendeeInfo {
    // Matches the shape expected by `amazon-chime-sdk-js` MeetingSessionConfiguration
    AttendeeId: string;
    ExternalUserId: string;
    JoinToken: string;
}

export interface MeetingJoinInfo {
    meeting: ChimeMeetingInfo;
    attendee: ChimeAttendeeInfo;
}

// ========================================
// MEETING MANAGEMENT
// ========================================

function makeExternalUserId(userID: string): string {
    // Chime SDK constraints:
    // - 2 to 64 chars
    // - only certain printable characters are allowed; we keep it conservative.
    const safe = (userID || 'user')
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9+\-_.@]/g, '_');

    const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
    const maxBaseLen = 64 - (1 + suffix.length);
    const base = (safe.length >= 2 ? safe : 'user').slice(0, Math.max(2, maxBaseLen));
    return `${base}-${suffix}`.slice(0, 64);
}

/**
 * Create a new Chime SDK meeting for a call
 */
export async function createMeeting(
    callID: string,
    callType: 'voice' | 'video'
): Promise<ChimeMeetingInfo> {
    const externalMeetingId = `call-${callID}`.slice(0, 64);

    try {
        const response = await chimeClient.send(new CreateMeetingCommand({
            ClientRequestToken: uuidv4(),
            ExternalMeetingId: externalMeetingId,
            MediaRegion: CHIME_MEDIA_REGION,
            MeetingFeatures: {
                Audio: { EchoReduction: 'AVAILABLE' },
                Video: callType === 'video' ? { MaxResolution: 'HD' } : undefined,
            },
        }));

        if (!response.Meeting?.MeetingId || !response.Meeting?.MediaPlacement || !response.Meeting?.MediaRegion) {
            throw new Error('Failed to create meeting - no meeting data returned');
        }

        // Return the meeting object in the exact shape expected by the frontend Chime SDK.
        return response.Meeting as unknown as ChimeMeetingInfo;
    } catch (error) {
        console.error('[ChimeMeetingManager] Error creating meeting:', error);
        throw error;
    }
}

/**
 * Create a new Chime SDK meeting for a scheduled meeting link.
 * Uses a distinct ExternalMeetingId prefix to avoid mixing with call meetings.
 */
export async function createMeetingForScheduledMeeting(meetingID: string): Promise<ChimeMeetingInfo> {
    const externalMeetingId = `meeting-${meetingID}`.slice(0, 64);

    try {
        const response = await chimeClient.send(new CreateMeetingCommand({
            ClientRequestToken: uuidv4(),
            ExternalMeetingId: externalMeetingId,
            MediaRegion: CHIME_MEDIA_REGION,
            MeetingFeatures: {
                Audio: { EchoReduction: 'AVAILABLE' },
                Video: { MaxResolution: 'HD' },
            },
        }));

        if (!response.Meeting?.MeetingId || !response.Meeting?.MediaPlacement || !response.Meeting?.MediaRegion) {
            throw new Error('Failed to create scheduled meeting - no meeting data returned');
        }

        return response.Meeting as unknown as ChimeMeetingInfo;
    } catch (error) {
        console.error('[ChimeMeetingManager] Error creating scheduled meeting:', error);
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
            // Use a safe, <=64-char external user id (email can be too long)
            ExternalUserId: makeExternalUserId(userID),
            Capabilities: {
                Audio: 'SendReceive',
                Video: 'SendReceive',
                Content: 'SendReceive',
            },
        }));

        if (!response.Attendee?.AttendeeId || !response.Attendee?.ExternalUserId || !response.Attendee?.JoinToken) {
            throw new Error('Failed to create attendee - no attendee data returned');
        }

        return response.Attendee as unknown as ChimeAttendeeInfo;
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
    const attendee = await createAttendee(meeting.MeetingId, callerID, callerName);

    console.log(`[ChimeMeetingManager] Meeting created: ${meeting.MeetingId}, Attendee: ${attendee.AttendeeId}`);

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

    if (!meetingResponse.Meeting?.MeetingId || !meetingResponse.Meeting?.MediaPlacement || !meetingResponse.Meeting?.MediaRegion) {
        throw new Error('Meeting not found');
    }

    // Create attendee for this user
    const attendee = await createAttendee(meetingId, userID, userName);

    return {
        meeting: meetingResponse.Meeting as unknown as ChimeMeetingInfo,
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
            AttendeeId: attendee.AttendeeId!,
            ExternalUserId: attendee.ExternalUserId!,
            JoinToken: '', // Not returned in list
        }));
    } catch (error) {
        console.error('[ChimeMeetingManager] Error listing attendees:', error);
        throw error;
    }
}
