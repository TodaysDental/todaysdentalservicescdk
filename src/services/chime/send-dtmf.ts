/**
 * Send DTMF Lambda Handler
 * 
 * Sends DTMF (Dual-Tone Multi-Frequency) tones to the far end of an active call.
 * Used for interacting with IVR systems, entering PINs, or navigating phone menus.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';

const ddb = getDynamoDBClient();

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Valid DTMF digits
const VALID_DTMF_REGEX = /^[0-9*#]+$/;
const MAX_DTMF_LENGTH = 32;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[send-dtmf] Function invoked', {
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
            console.warn('[send-dtmf] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        // 2. Parse request body
        const body = JSON.parse(event.body || '{}') as {
            callId: string;
            digits: string;
            durationMs?: number;
            gapMs?: number;
        };

        console.log('[send-dtmf] Parsed request body', { 
            callId: body.callId, 
            digitsLength: body.digits?.length,
            durationMs: body.durationMs,
            gapMs: body.gapMs
        });

        if (!body.callId || !body.digits) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'callId and digits are required' }) 
            };
        }

        // 3. Validate DTMF digits
        if (!VALID_DTMF_REGEX.test(body.digits)) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Invalid DTMF digits. Only 0-9, *, and # are allowed' }) 
            };
        }

        if (body.digits.length > MAX_DTMF_LENGTH) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: `DTMF digits must be ${MAX_DTMF_LENGTH} characters or less` }) 
            };
        }

        // 4. Validate duration and gap parameters
        const durationMs = Math.min(Math.max(body.durationMs || 250, 50), 1000);
        const gapMs = Math.min(Math.max(body.gapMs || 50, 0), 500);

        // 5. Verify agent is on this call
        const { Item: agentPresence } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
        }));

        if (!agentPresence) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
        }

        // Check if agent is on the specified call (primary or secondary)
        const isOnCall = 
            agentPresence.currentCallId === body.callId || 
            agentPresence.secondaryCallId === body.callId;

        if (!isOnCall) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'You are not on this call' }) };
        }

        // 6. Get call record to find clinic and verify call state
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': body.callId }
        }));

        if (!callRecords || callRecords.length === 0) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
        }

        const callRecord = callRecords[0];
        const { clinicId } = callRecord;

        // Verify clinic authorization
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
        if (!authzCheck.authorized) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
        }

        // Verify call is in a state where DTMF can be sent
        const validStates = ['connected', 'dialing', 'ringing'];
        if (!validStates.includes(callRecord.status)) {
            return { 
                statusCode: 409, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: `Cannot send DTMF when call is ${callRecord.status}` }) 
            };
        }

        // 7. Get SMA ID for clinic
        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'DTMF is not configured for this clinic' }) };
        }

        // 8. Send DTMF command to SMA
        try {
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: body.callId,
                Arguments: {
                    action: 'SEND_DTMF',
                    digits: body.digits,
                    durationMs: durationMs.toString(),
                    gapMs: gapMs.toString(),
                    agentId: agentId
                }
            }));

            console.log('[send-dtmf] DTMF command sent successfully', { 
                callId: body.callId, 
                digitsLength: body.digits.length 
            });
        } catch (smaErr: any) {
            console.error('[send-dtmf] Failed to send DTMF command:', smaErr);
            return {
                statusCode: 503,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Failed to send DTMF tones',
                    error: smaErr.message
                })
            };
        }

        // 9. Log DTMF activity (for call history)
        try {
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                UpdateExpression: 'SET lastDtmfSent = :now, dtmfHistory = list_append(if_not_exists(dtmfHistory, :empty), :dtmfEntry)',
                ExpressionAttributeValues: {
                    ':now': new Date().toISOString(),
                    ':empty': [],
                    ':dtmfEntry': [{
                        digits: body.digits.replace(/./g, '*'), // Mask digits for security
                        length: body.digits.length,
                        timestamp: new Date().toISOString(),
                        agentId: agentId
                    }]
                }
            }));
        } catch (logErr) {
            // Non-fatal error
            console.warn('[send-dtmf] Failed to log DTMF activity:', logErr);
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'DTMF tones sent',
                callId: body.callId,
                digitsLength: body.digits.length
            }),
        };

    } catch (err: any) {
        console.error('[send-dtmf] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to send DTMF', error: err?.message }),
        };
    }
};

