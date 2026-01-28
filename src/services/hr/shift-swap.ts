/**
 * Shift Swap Service
 * 
 * Provides shift swap workflow including:
 * - Request creation
 * - Peer acceptance/decline
 * - Manager approval
 * - Swap execution
 * 
 * @module shift-swap
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize DynamoDB client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const SHIFT_SWAP_TABLE = process.env.SHIFT_SWAP_TABLE || 'HrShiftSwap';
const SHIFTS_TABLE = process.env.SHIFTS_TABLE || 'HrShifts';

// Types
export type SwapStatus = 'PENDING_PEER' | 'PENDING_MANAGER' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface ShiftSwapRecord {
    pk: string; // `SWAP#${clinicId}`
    sk: string; // `${swapId}`
    swapId: string;
    requesterId: string;
    requesterName: string;
    requesterShiftId: string;
    targetStaffId?: string;
    targetStaffName?: string;
    targetShiftId?: string;
    status: SwapStatus;
    clinicId: string;
    reason?: string;
    requesterNotes?: string;
    targetNotes?: string;
    managerNotes?: string;
    approvedBy?: string;
    declinedBy?: string;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    // GSI for looking up by staff
    gsi1pk?: string; // `STAFF#${staffId}`
    gsi1sk?: string; // `${createdAt}`
}

// Constants
const SWAP_EXPIRATION_DAYS = 7;

/**
 * Create a swap request
 */
export async function createSwapRequest(params: {
    requesterId: string;
    requesterName: string;
    requesterShiftId: string;
    targetStaffId?: string;
    targetStaffName?: string;
    targetShiftId?: string;
    clinicId: string;
    reason?: string;
    notes?: string;
}): Promise<ShiftSwapRecord> {
    const swapId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SWAP_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const record: ShiftSwapRecord = {
        pk: `SWAP#${params.clinicId}`,
        sk: swapId,
        swapId,
        requesterId: params.requesterId,
        requesterName: params.requesterName,
        requesterShiftId: params.requesterShiftId,
        targetStaffId: params.targetStaffId,
        targetStaffName: params.targetStaffName,
        targetShiftId: params.targetShiftId,
        status: params.targetStaffId ? 'PENDING_PEER' : 'PENDING_MANAGER',
        clinicId: params.clinicId,
        reason: params.reason,
        requesterNotes: params.notes,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        gsi1pk: `STAFF#${params.requesterId}`,
        gsi1sk: now.toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: record,
    }));

    return record;
}

/**
 * Get a swap request by ID
 */
export async function getSwapRequest(clinicId: string, swapId: string): Promise<ShiftSwapRecord | null> {
    const { Item } = await ddb.send(new GetCommand({
        TableName: SHIFT_SWAP_TABLE,
        Key: {
            pk: `SWAP#${clinicId}`,
            sk: swapId,
        },
    }));

    return (Item as ShiftSwapRecord) || null;
}

/**
 * Get swap requests for a clinic
 */
export async function getSwapRequestsByClinic(
    clinicId: string,
    status?: SwapStatus
): Promise<ShiftSwapRecord[]> {
    const params: any = {
        TableName: SHIFT_SWAP_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
            ':pk': `SWAP#${clinicId}`,
        },
    };

    if (status) {
        params.FilterExpression = '#status = :status';
        params.ExpressionAttributeNames = { '#status': 'status' };
        params.ExpressionAttributeValues[':status'] = status;
    }

    const { Items } = await ddb.send(new QueryCommand(params));
    return (Items || []) as ShiftSwapRecord[];
}

/**
 * Get swap requests for a specific staff member
 */
export async function getSwapRequestsByStaff(staffId: string): Promise<{
    incoming: ShiftSwapRecord[];
    outgoing: ShiftSwapRecord[];
}> {
    // Query using GSI for outgoing requests
    const { Items: outgoing } = await ddb.send(new QueryCommand({
        TableName: SHIFT_SWAP_TABLE,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
            ':pk': `STAFF#${staffId}`,
        },
        ScanIndexForward: false,
    }));

    // For incoming, we need to scan with filter (or use another GSI)
    // This is simplified - in production, use a proper GSI for target staff
    const allSwaps = await ddb.send(new QueryCommand({
        TableName: SHIFT_SWAP_TABLE,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        FilterExpression: 'targetStaffId = :targetId AND #status = :pendingPeer',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':pk': `STAFF#${staffId}`,
            ':targetId': staffId,
            ':pendingPeer': 'PENDING_PEER',
        },
    }));

    return {
        incoming: (allSwaps.Items || []) as ShiftSwapRecord[],
        outgoing: (outgoing || []) as ShiftSwapRecord[],
    };
}

/**
 * Accept a swap request (as target staff)
 */
export async function acceptSwapRequest(
    clinicId: string,
    swapId: string,
    notes?: string
): Promise<ShiftSwapRecord | null> {
    const swap = await getSwapRequest(clinicId, swapId);
    if (!swap || swap.status !== 'PENDING_PEER') {
        return null;
    }

    const updatedSwap: ShiftSwapRecord = {
        ...swap,
        status: 'PENDING_MANAGER',
        targetNotes: notes,
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: updatedSwap,
    }));

    return updatedSwap;
}

/**
 * Decline a swap request (as target staff)
 */
export async function declineSwapRequest(
    clinicId: string,
    swapId: string,
    staffId: string,
    notes?: string
): Promise<ShiftSwapRecord | null> {
    const swap = await getSwapRequest(clinicId, swapId);
    if (!swap || swap.status !== 'PENDING_PEER') {
        return null;
    }

    const updatedSwap: ShiftSwapRecord = {
        ...swap,
        status: 'DECLINED',
        declinedBy: staffId,
        targetNotes: notes,
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: updatedSwap,
    }));

    return updatedSwap;
}

/**
 * Approve a swap request (as manager)
 */
export async function approveSwapRequest(
    clinicId: string,
    swapId: string,
    approverId: string,
    notes?: string
): Promise<ShiftSwapRecord | null> {
    const swap = await getSwapRequest(clinicId, swapId);
    if (!swap || swap.status !== 'PENDING_MANAGER') {
        return null;
    }

    const updatedSwap: ShiftSwapRecord = {
        ...swap,
        status: 'APPROVED',
        approvedBy: approverId,
        managerNotes: notes,
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: updatedSwap,
    }));

    // Execute the swap - update the shifts
    await executeSwap(swap);

    return updatedSwap;
}

/**
 * Reject a swap request (as manager)
 */
export async function rejectSwapRequest(
    clinicId: string,
    swapId: string,
    rejectorId: string,
    reason: string
): Promise<ShiftSwapRecord | null> {
    const swap = await getSwapRequest(clinicId, swapId);
    if (!swap || swap.status !== 'PENDING_MANAGER') {
        return null;
    }

    const updatedSwap: ShiftSwapRecord = {
        ...swap,
        status: 'DECLINED',
        declinedBy: rejectorId,
        managerNotes: reason,
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: updatedSwap,
    }));

    return updatedSwap;
}

/**
 * Cancel a swap request (as requester)
 */
export async function cancelSwapRequest(
    clinicId: string,
    swapId: string,
    requesterId: string
): Promise<boolean> {
    const swap = await getSwapRequest(clinicId, swapId);
    if (!swap || swap.requesterId !== requesterId) {
        return false;
    }

    if (swap.status === 'APPROVED') {
        return false; // Cannot cancel approved swaps
    }

    const updatedSwap: ShiftSwapRecord = {
        ...swap,
        status: 'CANCELLED',
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_SWAP_TABLE,
        Item: updatedSwap,
    }));

    return true;
}

/**
 * Execute the actual shift swap (update shift assignments)
 */
async function executeSwap(swap: ShiftSwapRecord): Promise<void> {
    // Update requester's shift to target staff
    if (swap.targetStaffId && swap.targetStaffName) {
        await ddb.send(new UpdateCommand({
            TableName: SHIFTS_TABLE,
            Key: {
                pk: `CLINIC#${swap.clinicId}`,
                sk: swap.requesterShiftId,
            },
            UpdateExpression: 'SET staffId = :staffId, staffName = :staffName, updatedAt = :now, swapId = :swapId',
            ExpressionAttributeValues: {
                ':staffId': swap.targetStaffId,
                ':staffName': swap.targetStaffName,
                ':now': new Date().toISOString(),
                ':swapId': swap.swapId,
            },
        }));
    }

    // Update target's shift to requester (if bidirectional swap)
    if (swap.targetShiftId) {
        await ddb.send(new UpdateCommand({
            TableName: SHIFTS_TABLE,
            Key: {
                pk: `CLINIC#${swap.clinicId}`,
                sk: swap.targetShiftId,
            },
            UpdateExpression: 'SET staffId = :staffId, staffName = :staffName, updatedAt = :now, swapId = :swapId',
            ExpressionAttributeValues: {
                ':staffId': swap.requesterId,
                ':staffName': swap.requesterName,
                ':now': new Date().toISOString(),
                ':swapId': swap.swapId,
            },
        }));
    }
}

/**
 * Expire old pending swap requests (called by scheduled Lambda)
 */
export async function expireOldRequests(): Promise<number> {
    const now = new Date().toISOString();
    let expiredCount = 0;

    // This would need to scan all clinics - in production, use a GSI on expiresAt
    // Simplified implementation here
    console.log(`[ShiftSwap] Expiring requests older than ${now}`);

    return expiredCount;
}

export default {
    createSwapRequest,
    getSwapRequest,
    getSwapRequestsByClinic,
    getSwapRequestsByStaff,
    acceptSwapRequest,
    declineSwapRequest,
    approveSwapRequest,
    rejectSwapRequest,
    cancelSwapRequest,
    expireOldRequests,
};
