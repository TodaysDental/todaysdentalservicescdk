/**
 * FIX #8: Agent Selection Without Locking
 * 
 * Implements optimistic reservation pattern for agents to prevent
 * race conditions during call assignment without full locking.
 */

import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

export interface ReservationResult {
  reserved: boolean;
  reservationId?: string;
  error?: string;
}

/**
 * FIX #8: Attempt to reserve an agent for call assignment
 * Uses conditional update to ensure atomic reservation
 */
export async function reserveAgent(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  callId: string,
  reservationTTLSeconds: number = 30
): Promise<ReservationResult> {
  const reservationId = `res-${randomUUID()}`;
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const reservationExpiry = nowSeconds + reservationTTLSeconds;

  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { agentId },
      UpdateExpression: `
        SET reservationId = :reservationId,
            reservedForCallId = :callId,
            reservationExpiry = :expiry,
            reservedAt = :now
      `,
      ConditionExpression: `
        #status = :online AND
        attribute_not_exists(currentCallId) AND
        attribute_not_exists(ringingCallId) AND
        (attribute_not_exists(reservationExpiry) OR reservationExpiry < :nowSeconds)
      `,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':reservationId': reservationId,
        ':callId': callId,
        ':expiry': reservationExpiry,
        ':now': now.toISOString(),
        ':online': 'Online',
        ':nowSeconds': nowSeconds
      }
    }));

    console.log(`[AgentReservation] Reserved agent ${agentId} for call ${callId} (${reservationId})`);

    return {
      reserved: true,
      reservationId
    };

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`[AgentReservation] Failed to reserve agent ${agentId} - already reserved or unavailable`);
      return {
        reserved: false,
        error: 'AGENT_UNAVAILABLE'
      };
    }

    console.error(`[AgentReservation] Error reserving agent ${agentId}:`, err);
    return {
      reserved: false,
      error: err.message
    };
  }
}

/**
 * FIX #8: Confirm a reservation and convert to active call
 * Should be called after successful assignment
 */
export async function confirmReservation(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  reservationId: string,
  callId: string
): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { agentId },
      UpdateExpression: `
        SET currentCallId = :callId,
            #status = :onCall,
            callStatus = :ringing,
            lastActivityAt = :now
        REMOVE reservationId, reservedForCallId, reservationExpiry, reservedAt
      `,
      ConditionExpression: `
        reservationId = :reservationId AND
        reservedForCallId = :callId
      `,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':reservationId': reservationId,
        ':callId': callId,
        ':onCall': 'OnCall',
        ':ringing': 'ringing',
        ':now': new Date().toISOString()
      }
    }));

    console.log(`[AgentReservation] Confirmed reservation ${reservationId} for agent ${agentId}`);
    return true;

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.error(`[AgentReservation] Reservation ${reservationId} expired or invalid for agent ${agentId}`);
      return false;
    }

    console.error(`[AgentReservation] Error confirming reservation:`, err);
    throw err;
  }
}

/**
 * FIX #8: Release a reservation (rollback if assignment fails)
 */
export async function releaseReservation(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  reservationId: string
): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { agentId },
      UpdateExpression: `
        REMOVE reservationId, reservedForCallId, reservationExpiry, reservedAt
      `,
      ConditionExpression: 'reservationId = :reservationId',
      ExpressionAttributeValues: {
        ':reservationId': reservationId
      }
    }));

    console.log(`[AgentReservation] Released reservation ${reservationId} for agent ${agentId}`);

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`[AgentReservation] Reservation ${reservationId} already released or expired`);
      return;
    }

    console.error(`[AgentReservation] Error releasing reservation:`, err);
    // Don't throw - best effort cleanup
  }
}

/**
 * FIX #8: Clean up expired reservations
 * Should be called periodically by cleanup monitor
 */
export async function cleanupExpiredReservations(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agents: any[]
): Promise<number> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let cleanedCount = 0;

  for (const agent of agents) {
    if (agent.reservationExpiry && agent.reservationExpiry < nowSeconds) {
      try {
        await ddb.send(new UpdateCommand({
          TableName: tableName,
          Key: { agentId: agent.agentId },
          UpdateExpression: `
            REMOVE reservationId, reservedForCallId, reservationExpiry, reservedAt
          `,
          ConditionExpression: 'reservationExpiry = :expiry',
          ExpressionAttributeValues: {
            ':expiry': agent.reservationExpiry
          }
        }));

        cleanedCount++;
        console.log(`[AgentReservation] Cleaned up expired reservation for agent ${agent.agentId}`);

      } catch (err: any) {
        if (err.name !== 'ConditionalCheckFailedException') {
          console.error(`[AgentReservation] Error cleaning up reservation:`, err);
        }
      }
    }
  }

  return cleanedCount;
}

/**
 * FIX #8: Try to reserve multiple agents and return the first successful reservation
 * Useful for parallel assignment attempts
 */
export async function reserveFirstAvailableAgent(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentIds: string[],
  callId: string
): Promise<{ agentId: string; reservationId: string } | null> {
  for (const agentId of agentIds) {
    const result = await reserveAgent(ddb, tableName, agentId, callId);
    
    if (result.reserved && result.reservationId) {
      return {
        agentId,
        reservationId: result.reservationId
      };
    }
  }

  return null;
}

