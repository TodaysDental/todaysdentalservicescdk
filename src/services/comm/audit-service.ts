/**
 * Audit Service for Communication Module
 * 
 * Provides audit trail functionality for tracking user actions on groups,
 * tasks, meetings, and messages. All writes are non-blocking (fire and forget)
 * to avoid impacting API response times.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { ddb, env } from './shared';

const AUDIT_LOGS_TABLE = env.AUDIT_LOGS_TABLE;

// 90 days in seconds for TTL
const TTL_DAYS = 90;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

/**
 * Audit action types for the communication module
 */
export type AuditAction =
  // Group Operations
  | 'CREATE_GROUP'
  | 'UPDATE_GROUP'
  | 'ADD_GROUP_MEMBER'
  | 'REMOVE_GROUP_MEMBER'
  | 'DELETE_GROUP'
  // Task Management
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'UPDATE_TASK_DEADLINE'
  | 'FORWARD_TASK'
  | 'RESPOND_TO_FORWARD'
  | 'DELETE_TASK'
  | 'TASK_STATUS_CHANGE'
  // Messaging
  | 'SEND_MESSAGE'
  | 'DELETE_MESSAGE'
  | 'FILE_UPLOAD'
  | 'TYPING_INDICATOR'
  | 'READ_STATUS_UPDATE'
  // Meetings
  | 'CREATE_MEETING'
  | 'UPDATE_MEETING'
  | 'DELETE_MEETING'
  | 'MEETING_JOIN'
  | 'MEETING_LEAVE'
  // Conversations
  | 'START_CONVERSATION'
  | 'DELETE_CONVERSATION'
  | 'SEARCH_CONVERSATIONS'
  | 'UPDATE_CONVERSATION_DEADLINE';

/**
 * Resource types for categorizing audit logs
 */
export type ResourceType = 'group' | 'task' | 'message' | 'meeting' | 'conversation';

/**
 * Audit log record structure
 */
export interface AuditLog {
  auditID: string;
  timestamp: string;
  userID: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceID: string;
  httpMethod: string;
  endpoint: string;
  status: 'success' | 'failure';
  statusCode: number;
  errorMessage?: string;
  changes?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  ipAddress?: string;
  userAgent?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
  expiryDate?: number; // TTL for auto-deletion
}

/**
 * Parameters for logging an action
 */
export interface LogActionParams {
  userID: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceID: string;
  httpMethod: string;
  endpoint: string;
  status: 'success' | 'failure';
  statusCode: number;
  errorMessage?: string;
  changes?: AuditLog['changes'];
  ipAddress?: string;
  userAgent?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

/**
 * Audit Service for tracking user actions
 */
export class AuditService {
  /**
   * Log an action asynchronously (non-blocking, fire and forget)
   * This does not await the DynamoDB write to avoid impacting API latency
   */
  static logAction(params: LogActionParams): void {
    if (!AUDIT_LOGS_TABLE) {
      console.warn('[AUDIT] Table not configured, skipping audit log');
      return;
    }

    const now = new Date();
    const expiryDate = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    const auditLog: AuditLog = {
      auditID: uuidv4(),
      timestamp: now.toISOString(),
      userID: params.userID,
      action: params.action,
      resourceType: params.resourceType,
      resourceID: params.resourceID,
      httpMethod: params.httpMethod,
      endpoint: params.endpoint,
      status: params.status,
      statusCode: params.statusCode,
      expiryDate,
      ...(params.errorMessage && { errorMessage: params.errorMessage }),
      ...(params.changes && { changes: params.changes }),
      ...(params.ipAddress && { ipAddress: params.ipAddress }),
      ...(params.userAgent && { userAgent: params.userAgent }),
      ...(params.durationMs && { durationMs: params.durationMs }),
      ...(params.metadata && { metadata: params.metadata }),
    };

    // Fire and forget - don't await
    ddb.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: auditLog,
    })).catch(err => {
      console.error('[AUDIT] Failed to write audit log:', err);
    });
  }

  /**
   * Log an action and await the write (blocking)
   * Use this when you need confirmation that the audit was recorded
   */
  static async logActionAsync(params: LogActionParams): Promise<void> {
    if (!AUDIT_LOGS_TABLE) {
      console.warn('[AUDIT] Table not configured, skipping audit log');
      return;
    }

    const now = new Date();
    const expiryDate = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    const auditLog: AuditLog = {
      auditID: uuidv4(),
      timestamp: now.toISOString(),
      userID: params.userID,
      action: params.action,
      resourceType: params.resourceType,
      resourceID: params.resourceID,
      httpMethod: params.httpMethod,
      endpoint: params.endpoint,
      status: params.status,
      statusCode: params.statusCode,
      expiryDate,
      ...(params.errorMessage && { errorMessage: params.errorMessage }),
      ...(params.changes && { changes: params.changes }),
      ...(params.ipAddress && { ipAddress: params.ipAddress }),
      ...(params.userAgent && { userAgent: params.userAgent }),
      ...(params.durationMs && { durationMs: params.durationMs }),
      ...(params.metadata && { metadata: params.metadata }),
    };

    try {
      await ddb.send(new PutCommand({
        TableName: AUDIT_LOGS_TABLE,
        Item: auditLog,
      }));
    } catch (err) {
      console.error('[AUDIT] Failed to write audit log:', err);
    }
  }

  /**
   * Get audit logs for a specific user
   */
  static async getUserAuditLogs(userID: string, limit = 50): Promise<AuditLog[]> {
    if (!AUDIT_LOGS_TABLE) return [];

    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: 'UserIDIndex',
        KeyConditionExpression: 'userID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      }));

      return (result.Items || []) as AuditLog[];
    } catch (err) {
      console.error('[AUDIT] Failed to query user audit logs:', err);
      return [];
    }
  }

  /**
   * Get audit logs for a specific resource (change history)
   */
  static async getResourceAuditLogs(resourceID: string, limit = 50): Promise<AuditLog[]> {
    if (!AUDIT_LOGS_TABLE) return [];

    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: 'ResourceIndex',
        KeyConditionExpression: 'resourceID = :id',
        ExpressionAttributeValues: { ':id': resourceID },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      }));

      return (result.Items || []) as AuditLog[];
    } catch (err) {
      console.error('[AUDIT] Failed to query resource audit logs:', err);
      return [];
    }
  }

  /**
   * Get audit logs for a specific action type
   */
  static async getActionAuditLogs(action: AuditAction, limit = 50): Promise<AuditLog[]> {
    if (!AUDIT_LOGS_TABLE) return [];

    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: 'ActionIndex',
        KeyConditionExpression: 'action = :act',
        ExpressionAttributeValues: { ':act': action },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      }));

      return (result.Items || []) as AuditLog[];
    } catch (err) {
      console.error('[AUDIT] Failed to query action audit logs:', err);
      return [];
    }
  }
}

export default AuditService;
