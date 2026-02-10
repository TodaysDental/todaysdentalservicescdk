import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const CALLS_TABLE = process.env.CALLS_TABLE || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const chimeClient = new ChimeSDKMeetingsClient({ region: REGION });

/**
 * Handles the $disconnect event by:
 * 1. Looking up the user ID from the connection record
 * 2. Removing the connection from the mapping table
 * 3. Checking if the user was in an active call and auto-ending it
 *    (prevents orphaned Chime meetings when a user closes the browser mid-call)
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId as string;

    let userID: string | undefined;

    try {
        // Step 1: Look up the user before deleting the connection record
        if (CONNECTIONS_TABLE) {
            try {
                const connResult = await ddb.send(new GetCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId },
                }));
                userID = (connResult.Item as any)?.userID;
            } catch (lookupErr) {
                console.warn(`[Disconnect] Failed to look up connection ${connectionId}:`, lookupErr);
            }
        }

        // Step 2: Remove the connection record
        await ddb.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId },
        }));

        console.log(`Connection removed: ${connectionId}${userID ? ` (user: ${userID})` : ''}`);
    } catch (error) {
        console.error('Error handling disconnect:', error);
        return { statusCode: 500, body: 'Failed to disconnect' };
    }

    // Step 3: Clean up any active calls for this user (best-effort, non-blocking)
    if (userID && CALLS_TABLE) {
        try {
            await cleanupActiveCallsForUser(userID);
        } catch (callCleanupErr) {
            // Never fail the disconnect over call cleanup
            console.error('[Disconnect] Error during call cleanup:', callCleanupErr);
        }
    }

    return { statusCode: 200, body: 'Disconnected' };
};

/**
 * Find and end any active calls where this user is a participant.
 * 
 * This handles the case where a user closes the browser or loses network
 * while on a call — without this, the Chime meeting stays active and the
 * other party's call UI stays connected indefinitely.
 * 
 * Only ends calls that are in 'connected' or 'ringing' state.
 * For 2-party calls, if the disconnecting user is the only remaining
 * connected participant, the call is ended for everyone.
 */
async function cleanupActiveCallsForUser(userID: string): Promise<void> {
    // CRITICAL: Before ending any calls, check if the user still has other active
    // WebSocket connections. Users can have multiple connections (e.g. one from the
    // main comm tab and another from CommCallActivity on Android, or multiple
    // browser tabs). We should only end calls if this was the user's LAST connection.
    try {
        const remainingConnections = await ddb.send(new QueryCommand({
            TableName: CONNECTIONS_TABLE,
            IndexName: 'UserIDIndex',
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            Limit: 1, // We only need to know if at least 1 remains
        }));

        const remaining = (remainingConnections.Items || []).length;
        if (remaining > 0) {
            console.log(`[Disconnect] User ${userID} still has ${remaining}+ active connection(s) — skipping call cleanup`);
            return;
        }
    } catch (connCheckErr) {
        console.warn(`[Disconnect] Failed to check remaining connections for ${userID}, proceeding with cleanup:`, connCheckErr);
        // If we can't check, proceed with cleanup to be safe (original behavior)
    }

    // Scan for active calls where this user is a participant.
    // Since CALLS_TABLE has no GSI on participantIDs, we scan with a filter.
    // This is acceptable because:
    // - Calls table is small (only recent calls, with TTL auto-expiry)
    // - This only runs on disconnect (not on every message)
    // - We filter server-side for 'connected' or 'ringing' status
    let lastKey: Record<string, any> | undefined;
    const activeCalls: any[] = [];

    do {
        const scanResult = await ddb.send(new ScanCommand({
            TableName: CALLS_TABLE,
            FilterExpression: '(#status = :connected OR #status = :ringing) AND contains(participantIDs, :userID)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':connected': 'connected',
                ':ringing': 'ringing',
                ':userID': userID,
            },
            ExclusiveStartKey: lastKey,
            Limit: 50, // Reasonable limit — a user shouldn't be in 50 calls at once
        }));

        activeCalls.push(...(scanResult.Items || []));
        lastKey = scanResult.LastEvaluatedKey;
    } while (lastKey);

    if (activeCalls.length === 0) {
        return; // No active calls to clean up
    }

    console.log(`[Disconnect] Found ${activeCalls.length} active call(s) for user ${userID}. Cleaning up…`);

    for (const call of activeCalls) {
        try {
            const now = new Date().toISOString();
            const startTime = new Date(call.startedAt || now).getTime();
            const endTime = new Date(now).getTime();
            const duration = Math.floor((endTime - startTime) / 1000);

            // Update call status to 'ended'
            await ddb.send(new UpdateCommand({
                TableName: CALLS_TABLE,
                Key: { callID: call.callID },
                UpdateExpression: 'SET #status = :status, endedAt = :endedAt, #duration = :duration',
                ExpressionAttributeNames: { '#status': 'status', '#duration': 'duration' },
                ExpressionAttributeValues: {
                    ':status': 'ended',
                    ':endedAt': now,
                    ':duration': duration,
                },
                // Only update if still active (avoid race with normal endCall)
                ConditionExpression: '#status = :connected OR #status = :ringing',
            }));

            // End the Chime SDK meeting
            if (call.meetingId) {
                try {
                    await chimeClient.send(new DeleteMeetingCommand({
                        MeetingId: call.meetingId,
                    }));
                    console.log(`[Disconnect] Ended Chime meeting ${call.meetingId} for call ${call.callID}`);
                } catch (chimeErr: any) {
                    if (chimeErr.name === 'NotFoundException') {
                        console.log(`[Disconnect] Chime meeting ${call.meetingId} already ended`);
                    } else {
                        console.warn(`[Disconnect] Failed to end Chime meeting ${call.meetingId}:`, chimeErr);
                    }
                }
            }

            // NOTE: We can't send WebSocket messages to other participants from the
            // $disconnect handler because we don't have a reference to the API Gateway
            // Management API endpoint. The other participant will detect the call ended
            // via Chime SDK's audioVideoDidStop observer when the meeting is deleted,
            // or they can poll/timeout on their side.
            //
            // The Chime SDK itself handles notifying attendees when a meeting is deleted,
            // which triggers the audioVideoDidStop callback on the remaining participant's
            // client, causing their cleanupSession to fire.

            console.log(`[Disconnect] Auto-ended call ${call.callID} (user ${userID} disconnected)`);
        } catch (callErr: any) {
            // ConditionalCheckFailedException = call was already ended (race condition, safe to ignore)
            if (callErr.name === 'ConditionalCheckFailedException') {
                console.log(`[Disconnect] Call ${call.callID} already ended (race condition)`);
            } else {
                console.warn(`[Disconnect] Failed to cleanup call ${call.callID}:`, callErr);
            }
        }
    }
}