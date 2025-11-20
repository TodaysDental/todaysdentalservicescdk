/**
 * FIX #54: VIP Handling Without SLA
 * 
 * Implements priority queue with time-bound SLAs for VIP calls.
 * Ensures VIP calls receive guaranteed response times.
 */

import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

export type CallPriority = 'high' | 'normal' | 'low';

export interface VipPolicy {
  maxWaitSeconds: number;
  maxRingAttempts: number;
  escalateAfterSeconds: number;
  notifyManagement: boolean;
  simultaneousRings: number;
}

/**
 * VIP policies defining SLA requirements
 */
export const VIP_POLICIES: Record<CallPriority, VipPolicy> = {
  high: {
    maxWaitSeconds: 30,
    maxRingAttempts: 5,
    escalateAfterSeconds: 60,
    notifyManagement: true,
    simultaneousRings: 5 // Ring 5 agents simultaneously
  },
  normal: {
    maxWaitSeconds: 300,
    maxRingAttempts: 3,
    escalateAfterSeconds: 600,
    notifyManagement: false,
    simultaneousRings: 2
  },
  low: {
    maxWaitSeconds: 600,
    maxRingAttempts: 2,
    escalateAfterSeconds: 1200,
    notifyManagement: false,
    simultaneousRings: 1
  }
};

/**
 * Determine call priority based on caller information
 */
export async function determineCallPriority(
  phoneNumber: string,
  clinicId: string,
  ddb: DynamoDBDocumentClient,
  vipTableName: string
): Promise<CallPriority> {
  try {
    // Check VIP table for caller
    const { Item } = await ddb.send({
      TableName: vipTableName,
      Key: { clinicId, phoneNumber }
    } as any);

    if (Item) {
      return (Item.priority as CallPriority) || 'high';
    }

    // Default to normal priority
    return 'normal';
  } catch (err) {
    console.error('[VipHandler] Error determining priority:', err);
    return 'normal';
  }
}

/**
 * Enrich call record with VIP policy and deadlines
 */
export function enrichCallWithVipPolicy(
  callRecord: any,
  priority: CallPriority
): any {
  const policy = VIP_POLICIES[priority];
  const now = Date.now();

  return {
    ...callRecord,
    priority,
    vipPolicy: policy,
    maxWaitDeadline: now + (policy.maxWaitSeconds * 1000),
    escalationDeadline: now + (policy.escalateAfterSeconds * 1000),
    ringAttempts: 0,
    maxRingAttempts: policy.maxRingAttempts
  };
}

/**
 * Check if call has exceeded SLA and should be escalated
 */
export function shouldEscalateCall(callRecord: any): boolean {
  const now = Date.now();
  
  // Check escalation deadline
  if (callRecord.escalationDeadline && now > callRecord.escalationDeadline) {
    return true;
  }

  // Check max ring attempts
  if (callRecord.ringAttempts >= callRecord.maxRingAttempts) {
    return true;
  }

  return false;
}

/**
 * Escalate a VIP call
 */
export async function escalateVipCall(
  callRecord: any,
  reason: string,
  ddb: DynamoDBDocumentClient,
  tableName: string
): Promise<void> {
  console.log(`[VipHandler] Escalating call ${callRecord.callId}: ${reason}`);

  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      clinicId: callRecord.clinicId,
      queuePosition: callRecord.queuePosition
    },
    UpdateExpression: `
      SET #status = :escalated, 
          escalationReason = :reason, 
          escalatedAt = :now,
          priority = :high
    `,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':escalated': 'escalated',
      ':reason': reason,
      ':now': new Date().toISOString(),
      ':high': 'high'
    }
  }));

  // Notify management if policy requires it
  if (callRecord.vipPolicy?.notifyManagement) {
    await sendManagementAlert({
      type: 'VIP_CALL_ESCALATED',
      callId: callRecord.callId,
      clinicId: callRecord.clinicId,
      phoneNumber: maskPhoneNumber(callRecord.phoneNumber),
      reason,
      waitTime: Date.now() - new Date(callRecord.queueEntryTimeIso).getTime(),
      ringAttempts: callRecord.ringAttempts
    });
  }
}

/**
 * Send alert to management
 */
async function sendManagementAlert(alert: any): Promise<void> {
  const topicArn = process.env.MANAGEMENT_ALERT_TOPIC_ARN;
  
  if (!topicArn) {
    console.warn('[VipHandler] No management alert topic configured');
    return;
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: topicArn,
      Subject: `[URGENT] VIP Call Escalation - ${alert.type}`,
      Message: JSON.stringify(alert, null, 2),
      MessageAttributes: {
        alertType: {
          DataType: 'String',
          StringValue: alert.type
        },
        priority: {
          DataType: 'String',
          StringValue: 'HIGH'
        }
      }
    }));

    console.log('[VipHandler] Management alert sent:', alert.type);
  } catch (err) {
    console.error('[VipHandler] Failed to send management alert:', err);
  }
}

/**
 * Mask phone number for privacy (show last 4 digits only)
 */
function maskPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.length < 4) {
    return '***';
  }
  const lastFour = phoneNumber.slice(-4);
  return `***-***-${lastFour}`;
}

/**
 * Monitor VIP calls for SLA violations
 * Called periodically by cleanup-monitor
 */
export async function monitorVipCallSLA(
  ddb: DynamoDBDocumentClient,
  tableName: string
): Promise<void> {
  const now = Date.now();

  try {
    // Query for high-priority calls in queued/ringing state
    const { Items: vipCalls } = await ddb.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'priority-queueEntryTime-index',
      KeyConditionExpression: 'priority = :high',
      FilterExpression: '#status IN (:queued, :ringing)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':high': 'high',
        ':queued': 'queued',
        ':ringing': 'ringing'
      }
    }));

    if (!vipCalls || vipCalls.length === 0) {
      return;
    }

    console.log(`[VipHandler] Monitoring ${vipCalls.length} VIP calls`);

    // Check each VIP call for SLA violations
    for (const call of vipCalls) {
      if (shouldEscalateCall(call)) {
        const reason = call.ringAttempts >= call.maxRingAttempts
          ? 'MAX_RING_ATTEMPTS_EXCEEDED'
          : 'SLA_VIOLATION';

        await escalateVipCall(call, reason, ddb, tableName);
      }
    }
  } catch (err) {
    console.error('[VipHandler] Error monitoring VIP calls:', err);
    throw err;
  }
}

/**
 * Get statistics about VIP call handling
 */
export async function getVipCallStats(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  clinicId: string,
  startTime: number,
  endTime: number
): Promise<{
  totalVipCalls: number;
  escalatedCalls: number;
  averageWaitTime: number;
  slaViolations: number;
}> {
  // Query for VIP calls in time range
  const { Items: calls } = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'clinicId = :clinicId AND queuePosition BETWEEN :start AND :end',
    FilterExpression: 'priority = :high',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': startTime,
      ':end': endTime,
      ':high': 'high'
    }
  }));

  if (!calls || calls.length === 0) {
    return {
      totalVipCalls: 0,
      escalatedCalls: 0,
      averageWaitTime: 0,
      slaViolations: 0
    };
  }

  const totalVipCalls = calls.length;
  const escalatedCalls = calls.filter(c => c.status === 'escalated').length;
  
  const waitTimes = calls
    .filter(c => c.queueEntryTimeIso && c.connectedAt)
    .map(c => new Date(c.connectedAt).getTime() - new Date(c.queueEntryTimeIso).getTime());
  
  const averageWaitTime = waitTimes.length > 0
    ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length
    : 0;

  const slaViolations = calls.filter(c => {
    if (!c.queueEntryTimeIso || !c.vipPolicy) return false;
    const waitTime = (c.connectedAt ? new Date(c.connectedAt) : new Date()).getTime() 
                     - new Date(c.queueEntryTimeIso).getTime();
    return waitTime > (c.vipPolicy.maxWaitSeconds * 1000);
  }).length;

  return {
    totalVipCalls,
    escalatedCalls,
    averageWaitTime: Math.floor(averageWaitTime / 1000), // Convert to seconds
    slaViolations
  };
}

