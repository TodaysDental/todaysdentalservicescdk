/**
 * Meeting Join Handler - API for Human Agents to Join Meetings
 * 
 * Enables seamless human agent handoff by allowing agents to join
 * the same Chime meeting as the AI and patient.
 * 
 * Flow:
 * 1. AI transfers call → adds to CallQueue → notifies agents
 * 2. Agent accepts → calls POST /meetings/{meetingId}/join
 * 3. Returns join credentials for agent's mobile app
 * 4. Agent joins meeting → AI can optionally leave
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';
import { addAgentToMeeting, getMeetingInfo, getChimeMeeting } from './meeting-manager';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || 'CallQueue';
const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME || 'AgentPresence';

// Module permission required to join meetings
const CALL_CENTER_MODULE = 'Call Center';

/**
 * POST /meetings/{meetingId}/join
 * 
 * Allows a human agent to join a meeting for call transfer
 * 
 * Request body:
 * {
 *   "agentUserId": "agent123",
 *   "callId": "call-uuid" // Optional, for queue tracking
 * }
 * 
 * Response:
 * {
 *   "Meeting": { MeetingId, MediaRegion, ... },
 *   "Attendee": { AttendeeId, JoinToken, ... },
 *   "message": "Successfully joined meeting"
 * }
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  console.log('[MeetingJoinHandler] Event:', JSON.stringify(event, null, 2));

  // Extract meetingId from path parameters
  const meetingId = event.pathParameters?.meetingId;
  if (!meetingId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Missing meetingId in path parameters',
        message: 'Please provide a valid meeting ID' 
      }),
    };
  }

  // Parse request body
  let body: any;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Invalid JSON in request body',
        message: 'Request body must be valid JSON' 
      }),
    };
  }

  const { agentUserId, callId } = body;

  if (!agentUserId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Missing agentUserId in request body',
        message: 'Please provide an agent user ID' 
      }),
    };
  }

  try {
    // Verify agent has permission to join meetings
    const permissions = await getUserPermissions(event);
    if (!permissions) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Authentication required' 
        }),
      };
    }
    
    if (!hasModulePermission(permissions.clinicRoles, CALL_CENTER_MODULE, 'read', permissions.isSuperAdmin, permissions.isGlobalSuperAdmin)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Insufficient permissions',
          message: 'You do not have permission to join calls' 
        }),
      };
    }

    // Get meeting info from DynamoDB
    const meetingInfo = await getMeetingInfo(meetingId);
    if (!meetingInfo) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Meeting not found',
          message: `No active meeting found with ID ${meetingId}` 
        }),
      };
    }

    // Check if meeting is still active
    if (meetingInfo.status !== 'active') {
      return {
        statusCode: 410,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Meeting ended',
          message: 'This meeting has already ended' 
        }),
      };
    }

    console.log('[MeetingJoinHandler] Agent joining meeting:', {
      meetingId,
      agentUserId,
      callId: meetingInfo.callId,
      clinicId: meetingInfo.clinicId,
    });

    // Add agent as attendee to the meeting
    const attendeeInfo = await addAgentToMeeting(meetingId, agentUserId);

    // Get full meeting details from Chime
    const meeting = await getChimeMeeting(meetingId);

    // If callId provided, update call queue to mark agent as connected
    if (callId) {
      try {
        await ddb.send(new UpdateCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #status = :connected, agentUserId = :agentId, agentJoinedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':connected': 'connected',
            ':agentId': agentUserId,
            ':now': Date.now(),
          },
        }));

        console.log('[MeetingJoinHandler] Updated call queue status to connected:', callId);
      } catch (queueError) {
        console.warn('[MeetingJoinHandler] Failed to update call queue:', queueError);
        // Non-critical error, continue with join
      }
    }

    // Update agent presence to "On Call"
    try {
      await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE,
        Key: { userId: agentUserId },
        UpdateExpression: 'SET #status = :onCall, currentCallId = :callId, updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':onCall': 'On Call',
          ':callId': meetingInfo.callId,
          ':now': Date.now(),
        },
      }));

      console.log('[MeetingJoinHandler] Updated agent presence to On Call:', agentUserId);
    } catch (presenceError) {
      console.warn('[MeetingJoinHandler] Failed to update agent presence:', presenceError);
      // Non-critical error, continue with join
    }

    // Return join credentials
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        Meeting: meeting,
        Attendee: {
          AttendeeId: attendeeInfo.attendeeId,
          JoinToken: attendeeInfo.joinToken,
          ExternalUserId: attendeeInfo.externalUserId,
        },
        callId: meetingInfo.callId,
        clinicId: meetingInfo.clinicId,
        message: 'Successfully joined meeting',
      }),
    };

  } catch (error) {
    console.error('[MeetingJoinHandler] Error joining meeting:', error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to join meeting' 
      }),
    };
  }
}
