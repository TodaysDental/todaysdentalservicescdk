/**
 * FIX #27: Priority Queue Manager
 * 
 * Implements weighted priority queue with starvation prevention.
 * Ensures:
 * - High priority calls get preference
 * - Low priority calls don't wait indefinitely
 * - VIP calls prioritized
 * - Recent callbacks prioritized
 * - SLA violations avoided
 */

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface CallContext {
  callId: string;
  clinicId: string;
  phoneNumber?: string;
  priority: 'high' | 'normal' | 'low';
  isVip: boolean;
  isCallback: boolean;
  previousCallCount?: number;
  previousAgentId?: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  language?: string;
}

interface ScoredCall {
  call: any;
  score: number;
}

export class PriorityQueueManager {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private callQueueTable: string
  ) {}

  /**
   * Get the next highest priority call for an agent
   */
  async getNextCallForAgent(
    agentInfo: any,
    clinicId: string
  ): Promise<any | null> {
    // Get all queued calls for clinic
    const { Items: queuedCalls } = await this.ddb.send(new QueryCommand({
      TableName: this.callQueueTable,
      KeyConditionExpression: 'clinicId = :clinicId',
      FilterExpression: '#status = :queued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':queued': 'queued'
      }
    }));

    if (!queuedCalls || queuedCalls.length === 0) {
      return null;
    }

    // Score each call based on priority and wait time
    const scoredCalls = queuedCalls.map(call => {
      const score = this.calculatePriorityScore(call);
      return { call, score };
    });

    // Sort by score (highest first)
    scoredCalls.sort((a, b) => b.score - a.score);

    // Return highest priority call that agent can handle
    for (const { call } of scoredCalls) {
      if (this.canAgentHandleCall(agentInfo, call)) {
        return call;
      }
    }

    return null;
  }

  /**
   * Calculate priority score for a call
   * Higher score = higher priority
   */
  private calculatePriorityScore(call: any): number {
    let score = 0;
    const now = Date.now();
    const queueTime = (now - new Date(call.queueEntryTime).getTime()) / 1000;

    // Base priority weights
    const PRIORITY_WEIGHTS: Record<'high' | 'normal' | 'low', number> = {
      high: 1000,
      normal: 100,
      low: 10
    };

    // Start with priority
    const priority = (call.priority as 'high' | 'normal' | 'low') || 'normal';
    score += PRIORITY_WEIGHTS[priority];

    // Add wait time bonus (prevents starvation)
    // After 5 minutes, even low priority calls start getting priority
    const waitBonus = Math.min(queueTime, 600) * 2; // Max 1200 points after 10 min
    score += waitBonus;

    // VIP bonus
    if (call.isVip) {
      score += 500;
    }

    // Callback bonus (customer already waited once)
    if (call.isCallback) {
      score += 300;
    }

    // Repeated attempt penalty (already offered to many agents)
    const attemptPenalty = (call.ringAttemptCount || 0) * 50;
    score -= attemptPenalty;

    // Age-based boost (prevent indefinite queue)
    if (queueTime > 900) { // 15 minutes
      score += 1000; // Emergency boost
    }

    // SLA violation imminent
    if (call.maxWaitDeadline && now > call.maxWaitDeadline - 60000) {
      score += 2000; // Highest priority
    }

    return score;
  }

  /**
   * Check if agent can handle this call
   */
  private canAgentHandleCall(agent: any, call: any): boolean {
    // Check required skills
    if (call.requiredSkills && call.requiredSkills.length > 0) {
      const agentSkills = agent.skills || [];
      const hasAllSkills = call.requiredSkills.every((skill: string) =>
        agentSkills.includes(skill)
      );
      if (!hasAllSkills) return false;
    }

    // Check language
    if (call.language) {
      const agentLanguages = agent.languages || ['en'];
      if (!agentLanguages.includes(call.language)) return false;
    }

    // Check VIP capability
    if (call.isVip && !agent.canHandleVip) {
      return false;
    }

    // Check if agent recently rejected this call
    if (call.rejections && call.rejections[agent.agentId]) {
      const rejectedAt = new Date(call.rejections[agent.agentId]).getTime();
      const rejectionAge = Date.now() - rejectedAt;
      if (rejectionAge < 5 * 60 * 1000) { // 5 minute cooldown
        return false;
      }
    }

    return true;
  }

  /**
   * Get queue metrics for monitoring
   */
  async getQueueMetrics(clinicId: string): Promise<{
    totalQueued: number;
    byPriority: Record<string, number>;
    longestWait: number;
    averageWait: number;
  }> {
    const { Items: queuedCalls } = await this.ddb.send(new QueryCommand({
      TableName: this.callQueueTable,
      KeyConditionExpression: 'clinicId = :clinicId',
      FilterExpression: '#status = :queued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':queued': 'queued'
      }
    }));

    if (!queuedCalls || queuedCalls.length === 0) {
      return {
        totalQueued: 0,
        byPriority: {},
        longestWait: 0,
        averageWait: 0
      };
    }

    const now = Date.now();
    const byPriority: Record<string, number> = {};
    let totalWait = 0;
    let longestWait = 0;

    for (const call of queuedCalls) {
      const priority = call.priority || 'normal';
      byPriority[priority] = (byPriority[priority] || 0) + 1;

      const waitTime = (now - new Date(call.queueEntryTime).getTime()) / 1000;
      totalWait += waitTime;
      longestWait = Math.max(longestWait, waitTime);
    }

    return {
      totalQueued: queuedCalls.length,
      byPriority,
      longestWait,
      averageWait: totalWait / queuedCalls.length
    };
  }
}

