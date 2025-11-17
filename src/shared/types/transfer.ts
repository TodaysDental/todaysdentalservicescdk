export type TransferMode = 'blind' | 'conference';

export interface TransferRequest {
    callId: string;
    fromAgentId: string;
    toAgentId: string;
    clinicId: string;
    transferType?: TransferMode;
    transferMode?: TransferMode;
    enableConference?: boolean;
    transferNotes?: string;
}

export interface TransferResponse {
    message: string;
    transferStatus: TransferStatus;
    transferType?: TransferMode;
    transferNotes?: string;
    isConferenceTransfer?: boolean;
}

export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface CallTransferState {
    transferStatus?: TransferStatus;
    transferToAgentId?: string;
    previousAgentId?: string;
    transferInitiatedAt?: number;
    transferMode?: TransferMode;
    isConferenceTransfer?: boolean;
    transferNotes?: string;
}
