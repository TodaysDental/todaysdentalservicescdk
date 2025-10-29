export interface TransferRequest {
    callId: string;
    fromAgentId: string;
    toAgentId: string;
    clinicId: string;
}

export interface TransferResponse {
    message: string;
    transferStatus: TransferStatus;
}

export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface CallTransferState {
    transferStatus?: TransferStatus;
    transferToAgentId?: string;
    previousAgentId?: string;
    transferInitiatedAt?: number;
}