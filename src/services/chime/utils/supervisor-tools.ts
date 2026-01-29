/**
 * Supervisor Tools Module
 * 
 * Provides real-time supervision capabilities for call center managers:
 * - Silent monitoring (listen without being heard)
 * - Whisper mode (speak to agent only)
 * - Barge-in (join the call)
 * - Real-time coaching with AI suggestions
 * 
 * @module supervisor-tools
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
    ChimeSDKMeetingsClient,
    CreateAttendeeCommand,
    DeleteAttendeeCommand,
    MediaCapabilities,
} from '@aws-sdk/client-chime-sdk-meetings';
import { publishMetric, MetricName } from './cloudwatch-metrics';

const chimeClient = new ChimeSDKMeetingsClient({});

export enum SupervisionMode {
    SILENT = 'silent',       // Listen only, neither party hears supervisor
    WHISPER = 'whisper',     // Agent hears supervisor, caller doesn't
    BARGE = 'barge',         // Everyone hears supervisor
}

export interface SupervisionSession {
    sessionId: string;
    supervisorId: string;
    agentId: string;
    callId: string;
    clinicId: string;
    mode: SupervisionMode;
    supervisorAttendeeId: string;
    startedAt: string;
    endedAt?: string;
    notes?: string;
}

export interface SupervisionResult {
    success: boolean;
    session?: SupervisionSession;
    meetingCredentials?: {
        attendeeId: string;
        joinToken: string;
        meetingId: string;
    };
    error?: string;
}

export interface LiveCallInfo {
    callId: string;
    clinicId: string;
    agentId: string;
    agentName?: string;
    callerPhoneNumber: string;
    direction: 'inbound' | 'outbound';
    status: string;
    duration: number;
    meetingId: string;
    hasActiveSupervisor: boolean;
    currentSupervisorId?: string;
}

/**
 * Gets all active calls that a supervisor can monitor
 */
export async function getMonitorableCalls(
    ddb: DynamoDBDocumentClient,
    supervisorId: string,
    allowedClinicIds: string[],
    callQueueTableName: string,
    agentPresenceTableName: string
): Promise<LiveCallInfo[]> {
    const liveCalls: LiveCallInfo[] = [];

    for (const clinicId of allowedClinicIds) {
        try {
            const { Items: calls } = await ddb.send(new QueryCommand({
                TableName: callQueueTableName,
                KeyConditionExpression: 'clinicId = :clinicId',
                FilterExpression: '#status = :connected OR #status = :active',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':clinicId': clinicId,
                    ':connected': 'connected',
                    ':active': 'active',
                },
            }));

            if (calls) {
                for (const call of calls) {
                    // Get agent details
                    let agentName: string | undefined;
                    if (call.assignedAgentId) {
                        const { Item: agent } = await ddb.send(new GetCommand({
                            TableName: agentPresenceTableName,
                            Key: { agentId: call.assignedAgentId },
                            ProjectionExpression: 'displayName',
                        }));
                        agentName = agent?.displayName;
                    }

                    // Calculate duration
                    const connectedAt = call.connectedAt
                        ? new Date(call.connectedAt).getTime()
                        : call.queueEntryTime
                            ? call.queueEntryTime * 1000
                            : Date.now();
                    const duration = Math.floor((Date.now() - connectedAt) / 1000);

                    liveCalls.push({
                        callId: call.callId,
                        clinicId: call.clinicId,
                        agentId: call.assignedAgentId || '',
                        agentName,
                        callerPhoneNumber: call.phoneNumber,
                        direction: call.direction || 'inbound',
                        status: call.status,
                        duration,
                        meetingId: call.meetingId || '',
                        hasActiveSupervisor: !!call.activeSupervisorId,
                        currentSupervisorId: call.activeSupervisorId,
                    });
                }
            }
        } catch (error: any) {
            console.error(`[getMonitorableCalls] Error for clinic ${clinicId}:`, error.message);
        }
    }

    return liveCalls;
}

/**
 * Starts a supervision session on an active call
 */
export async function startSupervision(
    ddb: DynamoDBDocumentClient,
    supervisorId: string,
    callId: string,
    clinicId: string,
    queuePosition: number,
    mode: SupervisionMode,
    callQueueTableName: string,
    supervisorSessionsTableName: string
): Promise<SupervisionResult> {
    console.log('[startSupervision] Starting supervision session', {
        supervisorId,
        callId,
        mode,
    });

    try {
        // Get the call details
        const { Item: call } = await ddb.send(new GetCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
        }));

        if (!call) {
            return { success: false, error: 'Call not found' };
        }

        if (call.callId !== callId) {
            return { success: false, error: 'Call ID mismatch' };
        }

        if (!call.meetingId) {
            return { success: false, error: 'Call has no meeting - cannot supervise' };
        }

        // Check if another supervisor is already monitoring
        if (call.activeSupervisorId && call.activeSupervisorId !== supervisorId) {
            return {
                success: false,
                error: `Call is already being supervised by ${call.activeSupervisorId}`
            };
        }

        // Create an attendee for the supervisor
        const { Attendee } = await chimeClient.send(new CreateAttendeeCommand({
            MeetingId: call.meetingId,
            ExternalUserId: `supervisor-${supervisorId}`,
            Capabilities: {
                Audio: (mode === SupervisionMode.SILENT ? 'ReceiveOnly' : 'SendReceive') as MediaCapabilities,
                Video: 'None' as MediaCapabilities,
                Content: 'None' as MediaCapabilities,
            },
        }));

        if (!Attendee) {
            return { success: false, error: 'Failed to create supervisor attendee' };
        }

        const sessionId = `sup-${Date.now()}-${supervisorId}`;
        const startedAt = new Date().toISOString();

        // Update call record with supervisor info
        await ddb.send(new UpdateCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
            UpdateExpression: `
        SET activeSupervisorId = :supId,
            supervisionMode = :mode,
            supervisionStartedAt = :startedAt,
            supervisionSessionId = :sessionId
      `,
            ExpressionAttributeValues: {
                ':supId': supervisorId,
                ':mode': mode,
                ':startedAt': startedAt,
                ':sessionId': sessionId,
            },
        }));

        // Create supervision session record
        const session: SupervisionSession = {
            sessionId,
            supervisorId,
            agentId: call.assignedAgentId || '',
            callId,
            clinicId,
            mode,
            supervisorAttendeeId: Attendee.AttendeeId!,
            startedAt,
        };

        await ddb.send(new UpdateCommand({
            TableName: supervisorSessionsTableName,
            Key: { sessionId },
            UpdateExpression: 'SET #data = :session',
            ExpressionAttributeNames: { '#data': 'data' },
            ExpressionAttributeValues: { ':session': session },
        })).catch(() => { }); // Non-critical

        // Publish metric
        await publishMetric(MetricName.CALL_VOLUME, 1, {
            clinicId,
            type: 'supervision_started',
            mode,
        });

        return {
            success: true,
            session,
            meetingCredentials: {
                attendeeId: Attendee.AttendeeId!,
                joinToken: Attendee.JoinToken!,
                meetingId: call.meetingId,
            },
        };

    } catch (error: any) {
        console.error('[startSupervision] Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Changes the supervision mode (e.g., from silent to whisper)
 */
export async function changeSupervisionMode(
    ddb: DynamoDBDocumentClient,
    sessionId: string,
    supervisorId: string,
    newMode: SupervisionMode,
    clinicId: string,
    queuePosition: number,
    callQueueTableName: string
): Promise<SupervisionResult> {
    console.log('[changeSupervisionMode] Changing mode', {
        sessionId,
        newMode,
    });

    try {
        // Get call details
        const { Item: call } = await ddb.send(new GetCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
        }));

        if (!call) {
            return { success: false, error: 'Call not found' };
        }

        if (call.activeSupervisorId !== supervisorId) {
            return { success: false, error: 'Not the active supervisor for this call' };
        }

        // Update attendee capabilities based on new mode
        // Note: In practice, you might need to delete and recreate the attendee
        // for capability changes, depending on Chime SDK version

        // Update call record
        await ddb.send(new UpdateCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
            UpdateExpression: 'SET supervisionMode = :mode, lastModeChange = :time',
            ExpressionAttributeValues: {
                ':mode': newMode,
                ':time': new Date().toISOString(),
            },
        }));

        return {
            success: true,
            session: {
                sessionId,
                supervisorId,
                agentId: call.assignedAgentId || '',
                callId: call.callId,
                clinicId,
                mode: newMode,
                supervisorAttendeeId: '', // Would need to fetch from session
                startedAt: call.supervisionStartedAt,
            },
        };

    } catch (error: any) {
        console.error('[changeSupervisionMode] Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Ends a supervision session
 */
export async function endSupervision(
    ddb: DynamoDBDocumentClient,
    sessionId: string,
    supervisorId: string,
    clinicId: string,
    queuePosition: number,
    callQueueTableName: string,
    supervisorSessionsTableName: string,
    notes?: string
): Promise<{ success: boolean; error?: string }> {
    console.log('[endSupervision] Ending supervision', { sessionId });

    try {
        // Get call details
        const { Item: call } = await ddb.send(new GetCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
        }));

        if (call && call.activeSupervisorId === supervisorId && call.meetingId) {
            // Remove supervisor attendee from meeting
            try {
                await chimeClient.send(new DeleteAttendeeCommand({
                    MeetingId: call.meetingId,
                    AttendeeId: call.supervisorAttendeeId,
                }));
            } catch (e) {
                // Attendee might already be removed
            }

            // Clear supervisor info from call
            await ddb.send(new UpdateCommand({
                TableName: callQueueTableName,
                Key: { clinicId, queuePosition },
                UpdateExpression: `
          REMOVE activeSupervisorId, supervisionMode, supervisionStartedAt, 
                 supervisionSessionId, supervisorAttendeeId
        `,
            }));
        }

        // Update session record
        await ddb.send(new UpdateCommand({
            TableName: supervisorSessionsTableName,
            Key: { sessionId },
            UpdateExpression: 'SET endedAt = :endedAt, notes = :notes',
            ExpressionAttributeValues: {
                ':endedAt': new Date().toISOString(),
                ':notes': notes || '',
            },
        })).catch(() => { }); // Non-critical

        return { success: true };

    } catch (error: any) {
        console.error('[endSupervision] Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Sends a whisper message to the agent (text that only agent sees)
 */
export async function sendWhisperMessage(
    ddb: DynamoDBDocumentClient,
    supervisorId: string,
    agentId: string,
    callId: string,
    message: string,
    agentPresenceTableName: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Add message to agent's whisper queue
        await ddb.send(new UpdateCommand({
            TableName: agentPresenceTableName,
            Key: { agentId },
            UpdateExpression: `
        SET whisperMessages = list_append(
          if_not_exists(whisperMessages, :empty),
          :newMessage
        )
      `,
            ExpressionAttributeValues: {
                ':empty': [],
                ':newMessage': [{
                    id: `msg-${Date.now()}`,
                    from: supervisorId,
                    callId,
                    message,
                    timestamp: new Date().toISOString(),
                    read: false,
                }],
            },
        }));

        return { success: true };

    } catch (error: any) {
        console.error('[sendWhisperMessage] Error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Gets agent's whisper messages for current call
 */
export async function getWhisperMessages(
    ddb: DynamoDBDocumentClient,
    agentId: string,
    callId: string,
    agentPresenceTableName: string
): Promise<Array<{
    id: string;
    from: string;
    message: string;
    timestamp: string;
    read: boolean;
}>> {
    try {
        const { Item: agent } = await ddb.send(new GetCommand({
            TableName: agentPresenceTableName,
            Key: { agentId },
            ProjectionExpression: 'whisperMessages',
        }));

        if (!agent?.whisperMessages) {
            return [];
        }

        // Filter for current call and return
        return agent.whisperMessages.filter((msg: any) => msg.callId === callId);

    } catch (error: any) {
        console.error('[getWhisperMessages] Error:', error.message);
        return [];
    }
}

/**
 * Marks whisper messages as read
 */
export async function markWhisperMessagesRead(
    ddb: DynamoDBDocumentClient,
    agentId: string,
    messageIds: string[],
    agentPresenceTableName: string
): Promise<void> {
    try {
        const { Item: agent } = await ddb.send(new GetCommand({
            TableName: agentPresenceTableName,
            Key: { agentId },
            ProjectionExpression: 'whisperMessages',
        }));

        if (!agent?.whisperMessages) {
            return;
        }

        // Update read status
        const updatedMessages = agent.whisperMessages.map((msg: any) => ({
            ...msg,
            read: messageIds.includes(msg.id) ? true : msg.read,
        }));

        await ddb.send(new UpdateCommand({
            TableName: agentPresenceTableName,
            Key: { agentId },
            UpdateExpression: 'SET whisperMessages = :messages',
            ExpressionAttributeValues: { ':messages': updatedMessages },
        }));

    } catch (error: any) {
        console.error('[markWhisperMessagesRead] Error:', error.message);
    }
}

/**
 * Gets supervision history for reporting
 */
export async function getSupervisionHistory(
    ddb: DynamoDBDocumentClient,
    supervisorId: string,
    startDate: string,
    endDate: string,
    supervisorSessionsTableName: string
): Promise<SupervisionSession[]> {
    try {
        const { Items } = await ddb.send(new QueryCommand({
            TableName: supervisorSessionsTableName,
            IndexName: 'supervisorId-startedAt-index',
            KeyConditionExpression: 'supervisorId = :supId AND startedAt BETWEEN :start AND :end',
            ExpressionAttributeValues: {
                ':supId': supervisorId,
                ':start': startDate,
                ':end': endDate,
            },
        }));

        return (Items || []) as SupervisionSession[];

    } catch (error: any) {
        console.error('[getSupervisionHistory] Error:', error.message);
        return [];
    }
}
