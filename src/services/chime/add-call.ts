/**
 * Add Call Lambda Handler
 * 
 * Allows an agent to initiate a second call while on an existing call.
 * This enables warm transfers, consultations, and conference calls.
 * 
 * The agent's primary call is placed on hold while the second call is dialed.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { sanitizePhoneNumber } from '../shared/utils/input-sanitization';
import { getSmaIdForClinic } from './utils/sma-map';
import { TTL_POLICY } from './config/ttl-policy';

const ddb = getDynamoDBClient();
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[add-call] Function invoked', {
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
            console.warn('[add-call] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        // 2. Parse request body
        const body = JSON.parse(event.body || '{}') as {
            primaryCallId: string;
            toPhoneNumber: string;
            fromClinicId: string;
            holdPrimaryCall?: boolean;
        };

        console.log('[add-call] Parsed request body', { 
            primaryCallId: body.primaryCallId, 
            toPhoneNumber: body.toPhoneNumber, 
            fromClinicId: body.fromClinicId 
        });

        if (!body.primaryCallId || !body.toPhoneNumber || !body.fromClinicId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'primaryCallId, toPhoneNumber, and fromClinicId are required' }) 
            };
        }

        // 3. Validate phone number
        const phoneValidation = sanitizePhoneNumber(body.toPhoneNumber);
        if (!phoneValidation.sanitized) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: phoneValidation.error }) 
            };
        }
        const toPhoneNumber = phoneValidation.sanitized;

        // 4. Validate clinic authorization
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, body.fromClinicId);
        if (!authzCheck.authorized) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
        }

        // 5. Verify agent is currently on the primary call
        const { Item: agentPresence } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
        }));

        if (!agentPresence) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Agent session not found' }) };
        }

        if (agentPresence.currentCallId !== body.primaryCallId) {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent is not on the specified primary call' }) };
        }

        if (agentPresence.status !== 'OnCall' && agentPresence.callStatus !== 'connected') {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent must be connected to a call to add another call' }) };
        }

        // 6. Check if agent already has a secondary call
        if (agentPresence.secondaryCallId) {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent already has a secondary call active' }) };
        }

        // 7. Get clinic phone number
        const { Item: clinic } = await ddb.send(new GetCommand({
            TableName: CLINICS_TABLE_NAME,
            Key: { clinicId: body.fromClinicId },
        }));

        if (!clinic || !clinic.phoneNumber) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Clinic phone number not found' }) };
        }
        const fromPhoneNumber = clinic.phoneNumber;

        // 8. Get SMA ID for clinic
        const smaId = getSmaIdForClinic(body.fromClinicId);
        if (!smaId) {
            return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Add call is not configured for this clinic' }) };
        }

        // 9. Update agent status to indicate secondary call dialing
        const secondaryCallReference = `add-call-${Date.now()}-${agentId}`;
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET secondaryCallStatus = :dialing, secondaryCallReference = :ref, lastActivityAt = :now',
                ConditionExpression: 'attribute_not_exists(secondaryCallId)',
                ExpressionAttributeValues: {
                    ':dialing': 'dialing',
                    ':ref': secondaryCallReference,
                    ':now': new Date().toISOString()
                }
            }));
        } catch (err: any) {
            if (err.name === 'ConditionalCheckFailedException') {
                return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ message: 'Agent already has a secondary call' }) };
            }
            throw err;
        }

        // 10. Initiate the secondary call
        const idempotencyKey = randomUUID();
        
        const callCommandInput = {
            FromPhoneNumber: fromPhoneNumber,
            ToPhoneNumber: toPhoneNumber,
            SipMediaApplicationId: smaId,
            ClientRequestToken: idempotencyKey,
            ArgumentsMap: {
                "callType": "AddCall",
                "agentId": agentId,
                "primaryCallId": body.primaryCallId,
                "meetingId": agentPresence.meetingInfo?.MeetingId || '',
                "callReference": secondaryCallReference,
                "idempotencyKey": idempotencyKey,
                "toPhoneNumber": toPhoneNumber,
                "fromPhoneNumber": fromPhoneNumber,
                "fromClinicId": body.fromClinicId,
                "holdPrimaryCall": body.holdPrimaryCall !== false ? 'true' : 'false'
            }
        };

        let callResponse;
        try {
            callResponse = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand(callCommandInput));
        } catch (err: any) {
            // Rollback agent status on failure
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'REMOVE secondaryCallStatus, secondaryCallReference',
            }));
            
            console.error('[add-call] Failed to initiate secondary call:', err);
            return { 
                statusCode: 500, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Failed to initiate secondary call', error: err.message }) 
            };
        }

        const secondaryCallId = callResponse.SipMediaApplicationCall?.TransactionId;
        if (!secondaryCallId) {
            throw new Error('CreateSipMediaApplicationCall did not return a TransactionId');
        }

        console.log('[add-call] Secondary call initiated', { secondaryCallId });

        // 11. Store secondary call in queue table
        const now = new Date();
        const nowTs = Math.floor(now.getTime() / 1000);
        const callTTL = nowTs + TTL_POLICY.ACTIVE_CALL_SECONDS;
        const { generateUniqueQueuePosition } = require('../shared/utils/unique-id');
        const queuePosition = generateUniqueQueuePosition();

        await ddb.send(new PutCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Item: {
                clinicId: body.fromClinicId,
                callId: secondaryCallId,
                queuePosition,
                queueEntryTime: nowTs,
                queueEntryTimeIso: now.toISOString(),
                phoneNumber: toPhoneNumber,
                status: 'dialing',
                direction: 'outbound',
                callType: 'add-call',
                assignedAgentId: agentId,
                primaryCallId: body.primaryCallId,
                callReference: secondaryCallReference,
                meetingInfo: agentPresence.meetingInfo,
                ttl: callTTL
            }
        }));

        // 12. Update agent presence with secondary call info
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET secondaryCallId = :callId, secondaryCallStatus = :status, lastActivityAt = :now',
            ExpressionAttributeValues: {
                ':callId': secondaryCallId,
                ':status': 'dialing',
                ':now': new Date().toISOString()
            }
        }));

        // 13. If holdPrimaryCall is true, mark primary call as on_hold
        if (body.holdPrimaryCall !== false) {
            // Find and update the primary call
            const { Items: primaryCallRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': body.primaryCallId }
            }));

            if (primaryCallRecords && primaryCallRecords.length > 0) {
                const primaryCall = primaryCallRecords[0];
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: primaryCall.clinicId, queuePosition: primaryCall.queuePosition },
                    UpdateExpression: 'SET #status = :holdStatus, holdStartTime = :now, heldByAgentId = :agentId, heldForSecondaryCall = :secondaryCallId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':holdStatus': 'on_hold',
                        ':now': new Date().toISOString(),
                        ':agentId': agentId,
                        ':secondaryCallId': secondaryCallId
                    }
                }));
            }
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Secondary call initiated',
                secondaryCallId: secondaryCallId,
                primaryCallId: body.primaryCallId,
                primaryCallOnHold: body.holdPrimaryCall !== false
            }),
        };

    } catch (err: any) {
        console.error('[add-call] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to add call', error: err?.message }),
        };
    }
};

