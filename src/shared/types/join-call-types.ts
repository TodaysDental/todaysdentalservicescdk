/**
 * Call Center Join Operations - TypeScript Types
 * 
 * Types for joining queued calls and active calls
 * Used by agents to pick up queued calls and supervisors to monitor/join active calls
 */

/**
 * Monitor mode for joining active calls
 * - silent: Listen only (supervisor is muted)
 * - barge: Join and speak (all parties can hear supervisor)
 * - whisper: Coach agent only (customer can't hear supervisor) - FUTURE
 */
export type MonitorMode = 'silent' | 'barge' | 'whisper';

/**
 * Request body for joining a queued call
 * POST /call-center/join-queued-call
 */
export interface JoinQueuedCallRequest {
  callId: string;
  clinicId: string;
}

/**
 * Response from joining a queued call
 */
export interface JoinQueuedCallResponse {
  message: string;
  callId: string;
  meetingId: string;
  agentAttendee: {
    AttendeeId: string;
    ExternalUserId: string;
    JoinToken: string;
  };
  meetingInfo: any;
  status: 'ringing';
}

/**
 * Request body for joining an active call
 * POST /call-center/join-active-call
 */
export interface JoinActiveCallRequest {
  callId: string;
  clinicId: string;
  mode: MonitorMode;
}

/**
 * Response from joining an active call
 */
export interface JoinActiveCallResponse {
  message: string;
  callId: string;
  meetingId: string;
  supervisorAttendee: {
    AttendeeId: string;
    ExternalUserId: string;
    JoinToken: string;
  };
  meetingInfo: any;
  mode: MonitorMode;
  callDetails: {
    agentId: string;
    customerPhone: string;
    status: string;
    connectedAt?: number;
    duration: number;
  };
  instructions?: {
    silent?: string;
    barge?: string;
    whisper?: string;
  };
}

/**
 * Queued call information
 */
export interface QueuedCall {
  callId: string;
  clinicId: string;
  phoneNumber: string;
  status: 'queued';
  priority: 'high' | 'normal' | 'low';
  isVip: boolean;
  isCallback: boolean;
  queuedAt: number;
  queuePosition: string;
  waitTime: number; // in seconds
  customerName?: string;
  reason?: string;
}

/**
 * Active call information
 */
export interface ActiveCall {
  callId: string;
  clinicId: string;
  phoneNumber: string;
  status: 'connected' | 'on-hold' | 'ringing';
  assignedAgentId: string;
  agentName?: string;
  connectedAt?: number;
  duration: number; // in seconds
  isOnHold: boolean;
  supervisors?: SupervisorInfo[];
}

/**
 * Supervisor monitoring information
 */
export interface SupervisorInfo {
  supervisorId: string;
  mode: MonitorMode;
  joinedAt: number;
}

/**
 * Response from get-joinable-calls endpoint
 * GET /call-center/get-joinable-calls
 */
export interface GetJoinableCallsResponse {
  queuedCalls: QueuedCall[];
  activeCalls: ActiveCall[];
  summary: {
    totalQueued: number;
    totalActive: number;
    clinics: string[];
    longestQueueWait: number; // in seconds
    longestCallDuration: number; // in seconds
    vipInQueue: number;
    callbacksInQueue: number;
    callsOnHold: number;
  };
  capabilities: {
    canJoinQueued: boolean;
    canJoinActive: boolean;
    canMonitor: boolean;
    canBarge: boolean;
  };
}

/**
 * Query parameters for get-joinable-calls
 */
export interface GetJoinableCallsParams {
  clinicId?: string;
  includeQueued?: boolean;
  includeActive?: boolean;
}

/**
 * Error response for join operations
 */
export interface JoinCallErrorResponse {
  message: string;
  error?: string;
  currentStatus?: string;
  existingMode?: MonitorMode;
  requiredRole?: string;
  validModes?: MonitorMode[];
  joinableStatuses?: string[];
}

