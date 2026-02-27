/**
 * Conference Call Lambda Handler
 * 
 * Provides true 3-way conference calling functionality.
 * Allows an agent to merge their primary and secondary calls into a single conference,
 * or to start a new conference with multiple participants.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';
import { randomUUID } from 'crypto';
import { isPushNotificationsEnabled, sendAgentAlert, sendConferenceInviteToAgent } from './utils/push-notifications';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
// Note: Chime SDK Meetings only supports specific regions - do not use AWS_REGION as fallback
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
// FIX: Add region to ChimeSDKVoiceClient for consistency
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Conference actions
type ConferenceAction = 'merge' | 'add' | 'remove' | 'end';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[conference-call] Function invoked', {
        httpMethod: event.httpMethod,
        path: event.path,
        requestId: event.requestContext?.requestId,
    });

    const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        // 1. Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[conference-call] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        // 2. Parse request body
        const body = JSON.parse(event.body || '{}') as {
            action: ConferenceAction;
            primaryCallId?: string;
            secondaryCallId?: string;
            callIdToRemove?: string;
            conferenceId?: string;
        };

        console.log('[conference-call] Parsed request body', body);

        if (!body.action) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'action is required' }) };
        }

        // Route to appropriate handler
        switch (body.action) {
            case 'merge':
                return await mergeCallsIntoConference(agentId, body, corsHeaders, verifyResult.payload!);
            case 'add':
                return await addParticipantToConference(agentId, body, corsHeaders, verifyResult.payload!);
            case 'remove':
                return await removeParticipantFromConference(agentId, body, corsHeaders, verifyResult.payload!);
            case 'end':
                return await endConference(agentId, body, corsHeaders, verifyResult.payload!);
            default:
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid action. Valid actions: merge, add, remove, end' }) };
        }

    } catch (err: any) {
        console.error('[conference-call] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error', error: err?.message }),
        };
    }
};

/**
 * Merge primary and secondary calls into a 3-way conference
 */
async function mergeCallsIntoConference(
    agentId: string,
    body: { primaryCallId?: string; secondaryCallId?: string },
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    // Get agent presence to find current calls
    const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agentPresence) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
    }

    const primaryCallId = body.primaryCallId || agentPresence.currentCallId;
    const secondaryCallId = body.secondaryCallId || agentPresence.secondaryCallId;

    if (!primaryCallId || !secondaryCallId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Both primary and secondary calls are required for merge' }) };
    }

    // Verify agent is on both calls
    if (agentPresence.currentCallId !== primaryCallId && agentPresence.secondaryCallId !== primaryCallId) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not on the primary call' }) };
    }
    if (agentPresence.currentCallId !== secondaryCallId && agentPresence.secondaryCallId !== secondaryCallId) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not on the secondary call' }) };
    }

    // Get both call records
    const [primaryCallResult, secondaryCallResult] = await Promise.all([
        ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': primaryCallId }
        })),
        ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': secondaryCallId }
        }))
    ]);

    if (!primaryCallResult.Items?.[0] || !secondaryCallResult.Items?.[0]) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'One or both calls not found' }) };
    }

    const primaryCall = primaryCallResult.Items[0];
    const secondaryCall = secondaryCallResult.Items[0];

    // Verify clinic authorization for both calls
    const primaryAuthz = checkClinicAuthorization(payload as any, primaryCall.clinicId);
    const secondaryAuthz = checkClinicAuthorization(payload as any, secondaryCall.clinicId);

    if (!primaryAuthz.authorized || !secondaryAuthz.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Not authorized for one or both calls' }) };
    }

    // Use the agent's existing meeting for the conference
    const meetingId = agentPresence.meetingInfo?.MeetingId;
    if (!meetingId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'No meeting found for conference' }) };
    }

    // Get SMA IDs for both clinics
    const primarySmaId = getSmaIdForClinic(primaryCall.clinicId);
    const secondarySmaId = getSmaIdForClinic(secondaryCall.clinicId);

    if (!primarySmaId || !secondarySmaId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Conference not configured for one or both clinics' }) };
    }

    // Generate conference ID
    const conferenceId = randomUUID();

    try {
        // Send merge command to both calls
        const [primaryMergeResult, secondaryMergeResult] = await Promise.all([
            chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: primarySmaId,
                TransactionId: primaryCallId,
                Arguments: {
                    action: 'CONFERENCE_MERGE',
                    conferenceId: conferenceId,
                    meetingId: meetingId,
                    agentId: agentId,
                    role: 'primary',
                    otherCallId: secondaryCallId
                }
            })),
            chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: secondarySmaId,
                TransactionId: secondaryCallId,
                Arguments: {
                    action: 'CONFERENCE_MERGE',
                    conferenceId: conferenceId,
                    meetingId: meetingId,
                    agentId: agentId,
                    role: 'secondary',
                    otherCallId: primaryCallId
                }
            }))
        ]);

        console.log('[conference-call] Merge commands sent', { conferenceId, primaryCallId, secondaryCallId });
    } catch (smaErr: any) {
        console.error('[conference-call] Failed to send merge commands:', smaErr);
        return {
            statusCode: 503,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to merge calls', error: smaErr.message })
        };
    }

    // FIX: Use TransactWriteCommand to update both call records AND agent presence atomically
    // This prevents inconsistent state if any single update fails
    const now = new Date().toISOString();
    try {
        await ddb.send(new TransactWriteCommand({
            TransactItems: [
                // Update primary call record
                {
                    Update: {
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: primaryCall.clinicId, queuePosition: primaryCall.queuePosition },
                        UpdateExpression: 'SET #status = :conferenceStatus, conferenceId = :conferenceId, conferenceRole = :role, conferenceStartedAt = :now',
                        // FIX: Add ConditionExpression to verify call is still in expected state
                        ConditionExpression: 'assignedAgentId = :agentId',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':conferenceStatus': 'conference',
                            ':conferenceId': conferenceId,
                            ':role': 'primary',
                            ':now': now,
                            ':agentId': agentId
                        }
                    }
                },
                // Update secondary call record
                {
                    Update: {
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: secondaryCall.clinicId, queuePosition: secondaryCall.queuePosition },
                        UpdateExpression: 'SET #status = :conferenceStatus, conferenceId = :conferenceId, conferenceRole = :role, conferenceStartedAt = :now',
                        // FIX: Add ConditionExpression to verify call is still in expected state
                        ConditionExpression: 'assignedAgentId = :agentId',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':conferenceStatus': 'conference',
                            ':conferenceId': conferenceId,
                            ':role': 'secondary',
                            ':now': now,
                            ':agentId': agentId
                        }
                    }
                },
                // Update agent presence
                {
                    Update: {
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'SET conferenceId = :conferenceId, conferenceCallIds = :callIds, conferenceStartedAt = :now, callStatus = :status REMOVE secondaryCallId, secondaryCallStatus',
                        // FIX: Verify agent still has both calls
                        ConditionExpression: 'currentCallId = :primaryCallId AND secondaryCallId = :secondaryCallId',
                        ExpressionAttributeValues: {
                            ':conferenceId': conferenceId,
                            ':callIds': [primaryCallId, secondaryCallId],
                            ':now': now,
                            ':status': 'conference',
                            ':primaryCallId': primaryCallId,
                            ':secondaryCallId': secondaryCallId
                        }
                    }
                }
            ]
        }));
        console.log('[conference-call] Conference merge transaction completed successfully');
    } catch (txnErr: any) {
        if (txnErr.name === 'TransactionCanceledException') {
            const reasons = txnErr.CancellationReasons || [];
            console.error('[conference-call] Conference merge transaction failed', { reasons });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Call state changed during conference merge. Please try again.',
                    error: 'STATE_CHANGED'
                })
            };
        }
        throw txnErr;
    }

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Calls merged into conference',
            conferenceId: conferenceId,
            participants: [
                { callId: primaryCallId, role: 'primary', phoneNumber: primaryCall.phoneNumber },
                { callId: secondaryCallId, role: 'secondary', phoneNumber: secondaryCall.phoneNumber }
            ],
            meetingId: meetingId
        }),
    };
}

/**
 * Add a new participant to an existing conference
 */
async function addParticipantToConference(
    agentId: string,
    body: { conferenceId?: string; callIdToAdd?: string },
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    // Get agent presence
    const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agentPresence) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
    }

    const conferenceId = body.conferenceId || agentPresence.conferenceId;
    if (!conferenceId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No active conference' }) };
    }

    // Get secondary call to add
    const callIdToAdd = body.callIdToAdd || agentPresence.secondaryCallId;
    if (!callIdToAdd) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No call available to add to conference' }) };
    }

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callIdToAdd }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Get SMA ID
    const smaId = getSmaIdForClinic(callRecord.clinicId);
    if (!smaId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Conference not configured for this clinic' }) };
    }

    // Send add to conference command
    try {
        await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: smaId,
            TransactionId: callIdToAdd,
            Arguments: {
                action: 'CONFERENCE_ADD',
                conferenceId: conferenceId,
                meetingId: agentPresence.meetingInfo?.MeetingId || '',
                agentId: agentId
            }
        }));

        console.log('[conference-call] Add participant command sent', { conferenceId, callIdToAdd });
    } catch (smaErr: any) {
        console.error('[conference-call] Failed to add participant:', smaErr);
        return {
            statusCode: 503,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to add participant to conference', error: smaErr.message })
        };
    }

    // Update call record
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET #status = :conferenceStatus, conferenceId = :conferenceId, conferenceJoinedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':conferenceStatus': 'conference',
            ':conferenceId': conferenceId,
            ':now': new Date().toISOString()
        }
    }));

    // Update agent's conference call list
    const currentConferenceCallIds = agentPresence.conferenceCallIds || [];
    if (!currentConferenceCallIds.includes(callIdToAdd)) {
        currentConferenceCallIds.push(callIdToAdd);
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET conferenceCallIds = :callIds REMOVE secondaryCallId, secondaryCallStatus',
            ExpressionAttributeValues: {
                ':callIds': currentConferenceCallIds
            }
        }));

        if (isPushNotificationsEnabled() && CHIME_CONFIG.PUSH.ENABLE_CONFERENCE_JOIN_PUSH) {
            sendConferenceInviteToAgent(agentId, {
                callId: callIdToAdd,
                clinicId: callRecord.clinicId || '',
                clinicName: callRecord.clinicName || callRecord.clinicId || '',
                conferenceId,
                initiatorAgentId: agentId,
                participantCount: currentConferenceCallIds.length,
                callerPhoneNumber: callRecord.phoneNumber,
                timestamp: new Date().toISOString(),
            }).catch(err => console.warn('[conference-call] Conference push failed (non-fatal):', err.message));
        }
    }

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Participant added to conference',
            conferenceId: conferenceId,
            addedCallId: callIdToAdd,
            totalParticipants: currentConferenceCallIds.length
        }),
    };
}

/**
 * Remove a participant from the conference
 */
async function removeParticipantFromConference(
    agentId: string,
    body: { conferenceId?: string; callIdToRemove?: string },
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    if (!body.callIdToRemove) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'callIdToRemove is required' }) };
    }

    // Get agent presence
    const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agentPresence) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
    }

    const conferenceId = body.conferenceId || agentPresence.conferenceId;
    if (!conferenceId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No active conference' }) };
    }

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': body.callIdToRemove }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Get SMA ID
    const smaId = getSmaIdForClinic(callRecord.clinicId);
    if (!smaId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Conference not configured for this clinic' }) };
    }

    // Send remove from conference command (this will disconnect only this participant)
    try {
        await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: smaId,
            TransactionId: body.callIdToRemove,
            Arguments: {
                action: 'CONFERENCE_REMOVE',
                conferenceId: conferenceId,
                agentId: agentId
            }
        }));

        console.log('[conference-call] Remove participant command sent', { conferenceId, callIdToRemove: body.callIdToRemove });
    } catch (smaErr: any) {
        console.error('[conference-call] Failed to remove participant:', smaErr);
        return {
            statusCode: 503,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to remove participant from conference', error: smaErr.message })
        };
    }

    // Update call record
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET #status = :completed, conferenceLeftAt = :now REMOVE conferenceId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':completed': 'completed',
            ':now': new Date().toISOString()
        }
    }));

    // Update agent's conference call list
    const currentConferenceCallIds = agentPresence.conferenceCallIds || [];
    const updatedCallIds = currentConferenceCallIds.filter((id: string) => id !== body.callIdToRemove);

    // If only one call left, downgrade from conference to regular call
    if (updatedCallIds.length === 1) {
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET currentCallId = :callId, callStatus = :status REMOVE conferenceId, conferenceCallIds',
            ExpressionAttributeValues: {
                ':callId': updatedCallIds[0],
                ':status': 'connected'
            }
        }));
    } else if (updatedCallIds.length > 1) {
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET conferenceCallIds = :callIds',
            ExpressionAttributeValues: {
                ':callIds': updatedCallIds
            }
        }));
    }

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Participant removed from conference',
            conferenceId: conferenceId,
            removedCallId: body.callIdToRemove,
            remainingParticipants: updatedCallIds.length
        }),
    };
}

/**
 * End the entire conference, disconnecting all participants
 */
async function endConference(
    agentId: string,
    body: { conferenceId?: string },
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    // Get agent presence
    const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));

    if (!agentPresence) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
    }

    const conferenceId = body.conferenceId || agentPresence.conferenceId;
    if (!conferenceId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No active conference' }) };
    }

    const conferenceCallIds = agentPresence.conferenceCallIds || [];
    if (conferenceCallIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No participants in conference' }) };
    }

    // End each call in the conference
    const endPromises = conferenceCallIds.map(async (callId: string) => {
        try {
            const { Items: callRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': callId }
            }));

            if (callRecords && callRecords.length > 0) {
                const callRecord = callRecords[0];
                const smaId = getSmaIdForClinic(callRecord.clinicId);

                if (smaId) {
                    await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                        SipMediaApplicationId: smaId,
                        TransactionId: callId,
                        Arguments: {
                            action: 'CONFERENCE_END',
                            conferenceId: conferenceId,
                            agentId: agentId
                        }
                    }));
                }

                // Update call record
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: 'SET #status = :completed, conferenceEndedAt = :now',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':completed': 'completed',
                        ':now': new Date().toISOString()
                    }
                }));
            }
        } catch (err) {
            console.error(`[conference-call] Failed to end call ${callId}:`, err);
        }
    });

    await Promise.all(endPromises);

    // Update agent presence
    await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET #status = :online, lastActivityAt = :now REMOVE conferenceId, conferenceCallIds, currentCallId, secondaryCallId, callStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':online': 'Online',
            ':now': new Date().toISOString()
        }
    }));

    console.log('[conference-call] Conference ended', { conferenceId, endedCalls: conferenceCallIds.length });

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Conference ended',
            conferenceId: conferenceId,
            endedCalls: conferenceCallIds.length
        }),
    };
}

