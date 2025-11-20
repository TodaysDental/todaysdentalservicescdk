/**
 * Consistency Checker
 * Fix 13: Detects and reconciles inconsistencies between agent presence and call records
 * 
 * Handles:
 * - Agent currentCallId doesn't match call assignedAgentId
 * - Orphaned agent states (currentCallId exists but call doesn't)
 * - Stale call assignments
 * - Status mismatches between agent and call
 */

import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface InconsistencyReport {
    timestamp: string;
    totalChecked: number;
    inconsistenciesFound: number;
    reconciled: number;
    manualReviewNeeded: string[];
    errors: string[];
}

export interface InconsistencyDetail {
    type: 'MISSING_CALL' | 'AGENT_MISMATCH' | 'STATUS_MISMATCH' | 'ORPHANED_AGENT';
    agentId: string;
    callId?: string;
    agentStatus?: string;
    callStatus?: string;
    assignedAgentId?: string;
    description: string;
}

export class ConsistencyChecker {
    constructor(
        private ddb: DynamoDBDocumentClient,
        private agentTable: string,
        private callTable: string
    ) {}

    /**
     * Main entry point: Check and reconcile all inconsistencies
     */
    async checkAndReconcile(): Promise<InconsistencyReport> {
        const report: InconsistencyReport = {
            timestamp: new Date().toISOString(),
            totalChecked: 0,
            inconsistenciesFound: 0,
            reconciled: 0,
            manualReviewNeeded: [],
            errors: []
        };

        console.log('[ConsistencyChecker] Starting consistency check');

        try {
            // Get all agents with active calls
            const { Items: agents } = await this.ddb.send(new ScanCommand({
                TableName: this.agentTable,
                FilterExpression: 'attribute_exists(currentCallId) OR attribute_exists(heldCallId)',
                ProjectionExpression: 'agentId, currentCallId, heldCallId, callStatus, #status',
                ExpressionAttributeNames: { '#status': 'status' }
            }));

            if (!agents || agents.length === 0) {
                console.log('[ConsistencyChecker] No agents with active calls found');
                return report;
            }

            report.totalChecked = agents.length;
            console.log(`[ConsistencyChecker] Checking ${agents.length} agents with active calls`);

            for (const agent of agents) {
                try {
                    await this.checkAgent(agent, report);
                } catch (err: any) {
                    const errorMsg = `Error checking agent ${agent.agentId}: ${err.message}`;
                    console.error(`[ConsistencyChecker] ${errorMsg}`);
                    report.errors.push(errorMsg);
                }
            }

            console.log('[ConsistencyChecker] Check complete:', {
                checked: report.totalChecked,
                found: report.inconsistenciesFound,
                reconciled: report.reconciled,
                manual: report.manualReviewNeeded.length,
                errors: report.errors.length
            });

        } catch (err: any) {
            const errorMsg = `Fatal error during consistency check: ${err.message}`;
            console.error(`[ConsistencyChecker] ${errorMsg}`);
            report.errors.push(errorMsg);
        }

        return report;
    }

    /**
     * Check a single agent for inconsistencies
     */
    private async checkAgent(agent: any, report: InconsistencyReport): Promise<void> {
        const agentId = agent.agentId;
        const currentCallId = agent.currentCallId || agent.heldCallId;

        if (!currentCallId) {
            return; // No active call, nothing to check
        }

        // Look up the call record
        const { Items: calls } = await this.ddb.send(new QueryCommand({
            TableName: this.callTable,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': currentCallId }
        }));

        // Case 1: Call doesn't exist
        if (!calls || calls.length === 0) {
            report.inconsistenciesFound++;
            console.warn(`[ConsistencyChecker] Agent ${agentId} references non-existent call ${currentCallId}`);

            const inconsistency: InconsistencyDetail = {
                type: 'MISSING_CALL',
                agentId,
                callId: currentCallId,
                agentStatus: agent.status,
                description: `Agent references call ${currentCallId} which doesn't exist`
            };

            await this.reconcileMissingCall(agent, inconsistency, report);
            return;
        }

        const call = calls[0];

        // Case 2: Agent mismatch - agent has call but call is assigned to someone else
        if (call.assignedAgentId && call.assignedAgentId !== agentId) {
            report.inconsistenciesFound++;
            console.warn(`[ConsistencyChecker] Mismatch: agent ${agentId} has call ${currentCallId} ` +
                        `but call assigned to ${call.assignedAgentId}`);

            const inconsistency: InconsistencyDetail = {
                type: 'AGENT_MISMATCH',
                agentId,
                callId: currentCallId,
                assignedAgentId: call.assignedAgentId,
                callStatus: call.status,
                description: `Agent has call but call assigned to ${call.assignedAgentId}`
            };

            await this.reconcileAgentMismatch(agent, call, inconsistency, report);
            return;
        }

        // Case 3: Status mismatch - agent and call have different status
        if (agent.callStatus && call.status && agent.callStatus !== call.status) {
            report.inconsistenciesFound++;
            console.log(`[ConsistencyChecker] Status mismatch: agent ${agentId} ` +
                       `shows ${agent.callStatus} but call is ${call.status}`);

            const inconsistency: InconsistencyDetail = {
                type: 'STATUS_MISMATCH',
                agentId,
                callId: currentCallId,
                agentStatus: agent.callStatus,
                callStatus: call.status,
                description: `Agent status ${agent.callStatus} doesn't match call status ${call.status}`
            };

            await this.reconcileStatusMismatch(agent, call, inconsistency, report);
        }
    }

    /**
     * Reconcile: Agent references a call that doesn't exist
     */
    private async reconcileMissingCall(
        agent: any, 
        inconsistency: InconsistencyDetail, 
        report: InconsistencyReport
    ): Promise<void> {
        try {
            // Clean up agent - remove call references
            await this.ddb.send(new UpdateCommand({
                TableName: this.agentTable,
                Key: { agentId: agent.agentId },
                UpdateExpression: 'SET #status = :online, inconsistencyFixedAt = :now ' +
                                 'REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':online': 'Online',
                    ':now': new Date().toISOString()
                }
            }));

            console.log(`[ConsistencyChecker] Reconciled: Cleaned up agent ${agent.agentId}`);
            report.reconciled++;
        } catch (err: any) {
            console.error(`[ConsistencyChecker] Failed to reconcile missing call for ${agent.agentId}:`, err);
            report.errors.push(`Failed to clean up agent ${agent.agentId}: ${err.message}`);
        }
    }

    /**
     * Reconcile: Agent has call but call is assigned to different agent
     */
    private async reconcileAgentMismatch(
        agent: any, 
        call: any, 
        inconsistency: InconsistencyDetail, 
        report: InconsistencyReport
    ): Promise<void> {
        // Determine correct state based on call record (source of truth)
        if (call.status === 'connected' && call.assignedAgentId) {
            // Call is assigned to different agent - clean up this agent
            try {
                await this.ddb.send(new UpdateCommand({
                    TableName: this.agentTable,
                    Key: { agentId: agent.agentId },
                    UpdateExpression: 'SET #status = :online, inconsistencyFixedAt = :now ' +
                                     'REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':online': 'Online',
                        ':now': new Date().toISOString()
                    }
                }));

                console.log(`[ConsistencyChecker] Reconciled: Freed agent ${agent.agentId} (call assigned to ${call.assignedAgentId})`);
                report.reconciled++;
            } catch (err: any) {
                console.error(`[ConsistencyChecker] Failed to reconcile agent mismatch:`, err);
                report.errors.push(`Failed to fix agent mismatch for ${agent.agentId}: ${err.message}`);
            }
        } else if (call.status === 'completed' || call.status === 'abandoned') {
            // Call is finished - clean up agent
            try {
                await this.ddb.send(new UpdateCommand({
                    TableName: this.agentTable,
                    Key: { agentId: agent.agentId },
                    UpdateExpression: 'SET #status = :online, inconsistencyFixedAt = :now ' +
                                     'REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':online': 'Online',
                        ':now': new Date().toISOString()
                    }
                }));

                console.log(`[ConsistencyChecker] Reconciled: Freed agent ${agent.agentId} (call ${call.status})`);
                report.reconciled++;
            } catch (err: any) {
                console.error(`[ConsistencyChecker] Failed to clean up finished call:`, err);
                report.errors.push(`Failed to clean up agent ${agent.agentId}: ${err.message}`);
            }
        } else {
            // Ambiguous case - log for manual review
            const issue = `Cannot auto-reconcile agent ${agent.agentId} / call ${call.callId} ` +
                         `(call status: ${call.status}, assigned: ${call.assignedAgentId})`;
            console.warn(`[ConsistencyChecker] ${issue}`);
            report.manualReviewNeeded.push(issue);
        }
    }

    /**
     * Reconcile: Agent and call have different status
     */
    private async reconcileStatusMismatch(
        agent: any, 
        call: any, 
        inconsistency: InconsistencyDetail, 
        report: InconsistencyReport
    ): Promise<void> {
        // Call record is source of truth - update agent to match
        try {
            await this.ddb.send(new UpdateCommand({
                TableName: this.agentTable,
                Key: { agentId: agent.agentId },
                UpdateExpression: 'SET callStatus = :status, statusSyncedAt = :now',
                ExpressionAttributeValues: {
                    ':status': call.status,
                    ':now': new Date().toISOString()
                }
            }));

            console.log(`[ConsistencyChecker] Reconciled: Updated agent ${agent.agentId} status ` +
                       `from ${agent.callStatus} to ${call.status}`);
            report.reconciled++;
        } catch (err: any) {
            console.error(`[ConsistencyChecker] Failed to sync status:`, err);
            report.errors.push(`Failed to sync status for ${agent.agentId}: ${err.message}`);
        }
    }

    /**
     * Check a specific agent on demand
     */
    async checkSpecificAgent(agentId: string): Promise<InconsistencyDetail | null> {
        const { Item: agent } = await this.ddb.send(new GetCommand({
            TableName: this.agentTable,
            Key: { agentId }
        }));

        if (!agent || (!agent.currentCallId && !agent.heldCallId)) {
            return null;
        }

        const report: InconsistencyReport = {
            timestamp: new Date().toISOString(),
            totalChecked: 1,
            inconsistenciesFound: 0,
            reconciled: 0,
            manualReviewNeeded: [],
            errors: []
        };

        await this.checkAgent(agent, report);

        return report.inconsistenciesFound > 0 ? {
            type: 'ORPHANED_AGENT',
            agentId,
            description: `Found ${report.inconsistenciesFound} inconsistencies`
        } : null;
    }
}

