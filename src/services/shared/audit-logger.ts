// services/shared/audit-logger.ts
// Complete Audit Trail Logger for HR Module

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// ========================================
// TYPES
// ========================================

export type AuditAction = 
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'DENY'
  | 'REJECT'
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'ROLE_CHANGE';

export type AuditResource = 
  | 'STAFF'
  | 'SHIFT'
  | 'LEAVE'
  | 'CLINIC_ROLE';

export type AuditUserRole = 
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'USER'
  | 'SYSTEM';

export interface AuditLogEntry {
  auditId: string;
  timestamp: string;
  resourceKey: string;  // "RESOURCE_TYPE#ID" for GSI
  
  // Who
  userId: string;
  userName?: string;
  userRole: AuditUserRole;
  
  // What
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  
  // Context
  clinicId?: string;
  ipAddress?: string;
  userAgent?: string;
  
  // Changes
  before?: Record<string, any>;
  after?: Record<string, any>;
  reason?: string;
  metadata?: Record<string, any>;
  
  // TTL (optional - for auto-cleanup after retention period)
  expiresAt?: number;
}

export interface CreateAuditLogParams {
  userId: string;
  userName?: string;
  userRole: AuditUserRole;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  clinicId?: string;
  ipAddress?: string;
  userAgent?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface AuditQueryParams {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  clinicId?: string;
  startDate?: string;
  endDate?: string;
  action?: AuditAction;
  limit?: number;
  lastEvaluatedKey?: Record<string, any>;
}

export interface AuditQueryResult {
  auditLogs: AuditLogEntry[];
  count: number;
  lastEvaluatedKey?: Record<string, any>;
}

// ========================================
// AUDIT LOGGER CLASS
// ========================================

export class AuditLogger {
  private ddb: DynamoDBDocumentClient;
  private tableName: string;
  private enabled: boolean;
  
  // Retention period in seconds (7 years = ~220,752,000 seconds)
  private static readonly DEFAULT_RETENTION_SECONDS = 7 * 365 * 24 * 60 * 60;

  constructor(ddb: DynamoDBDocumentClient, tableName?: string) {
    this.ddb = ddb;
    this.tableName = tableName || process.env.AUDIT_TABLE || '';
    this.enabled = process.env.ENABLE_AUDIT_LOGGING !== 'false' && !!this.tableName;
  }

  /**
   * Log an audit event
   * Non-blocking: Failures are logged but don't throw
   */
  async log(params: CreateAuditLogParams): Promise<string | null> {
    if (!this.enabled) {
      console.log('📝 Audit logging disabled or table not configured');
      return null;
    }

    const auditId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const entry: AuditLogEntry = {
      auditId,
      timestamp,
      resourceKey: `${params.resource}#${params.resourceId}`,
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      clinicId: params.clinicId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      before: params.before,
      after: params.after,
      reason: params.reason,
      metadata: params.metadata,
      // Set expiration for auto-cleanup (optional)
      expiresAt: Math.floor(Date.now() / 1000) + AuditLogger.DEFAULT_RETENTION_SECONDS,
    };

    try {
      await this.ddb.send(new PutCommand({
        TableName: this.tableName,
        Item: entry,
      }));
      
      console.log(`✅ Audit log created: ${params.action} ${params.resource} ${params.resourceId} by ${params.userId}`);
      return auditId;
    } catch (error) {
      // Log but don't throw - audit failures should not break main operations
      console.error('❌ Failed to create audit log:', error);
      console.error('❌ Audit params:', JSON.stringify(params, null, 2));
      return null;
    }
  }

  /**
   * Query audit logs by user ID
   */
  async queryByUser(userId: string, options?: { 
    startDate?: string; 
    endDate?: string; 
    limit?: number;
    lastEvaluatedKey?: Record<string, any>;
  }): Promise<AuditQueryResult> {
    if (!this.enabled) {
      return { auditLogs: [], count: 0 };
    }

    const limit = options?.limit || 100;
    
    let KeyConditionExpression = 'userId = :userId';
    const ExpressionAttributeValues: Record<string, any> = { ':userId': userId };

    if (options?.startDate && options?.endDate) {
      KeyConditionExpression += ' AND #ts BETWEEN :startDate AND :endDate';
      ExpressionAttributeValues[':startDate'] = options.startDate;
      ExpressionAttributeValues[':endDate'] = options.endDate;
    }

    try {
      const result = await this.ddb.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byUserId',
        KeyConditionExpression,
        ExpressionAttributeNames: options?.startDate ? { '#ts': 'timestamp' } : undefined,
        ExpressionAttributeValues,
        Limit: limit,
        ScanIndexForward: false, // Most recent first
        ExclusiveStartKey: options?.lastEvaluatedKey,
      }));

      return {
        auditLogs: (result.Items || []) as AuditLogEntry[],
        count: result.Count || 0,
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('❌ Failed to query audit logs by user:', error);
      return { auditLogs: [], count: 0 };
    }
  }

  /**
   * Query audit logs by resource (e.g., specific staff member, shift, leave request)
   */
  async queryByResource(resource: AuditResource, resourceId: string, options?: {
    limit?: number;
    lastEvaluatedKey?: Record<string, any>;
  }): Promise<AuditQueryResult> {
    if (!this.enabled) {
      return { auditLogs: [], count: 0 };
    }

    const resourceKey = `${resource}#${resourceId}`;
    const limit = options?.limit || 100;

    try {
      const result = await this.ddb.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byResource',
        KeyConditionExpression: 'resourceKey = :resourceKey',
        ExpressionAttributeValues: { ':resourceKey': resourceKey },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
        ExclusiveStartKey: options?.lastEvaluatedKey,
      }));

      return {
        auditLogs: (result.Items || []) as AuditLogEntry[],
        count: result.Count || 0,
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('❌ Failed to query audit logs by resource:', error);
      return { auditLogs: [], count: 0 };
    }
  }

  /**
   * Query audit logs by clinic
   */
  async queryByClinic(clinicId: string, options?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    lastEvaluatedKey?: Record<string, any>;
  }): Promise<AuditQueryResult> {
    if (!this.enabled) {
      return { auditLogs: [], count: 0 };
    }

    const limit = options?.limit || 100;
    
    let KeyConditionExpression = 'clinicId = :clinicId';
    const ExpressionAttributeValues: Record<string, any> = { ':clinicId': clinicId };

    if (options?.startDate && options?.endDate) {
      KeyConditionExpression += ' AND #ts BETWEEN :startDate AND :endDate';
      ExpressionAttributeValues[':startDate'] = options.startDate;
      ExpressionAttributeValues[':endDate'] = options.endDate;
    }

    try {
      const result = await this.ddb.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'byClinic',
        KeyConditionExpression,
        ExpressionAttributeNames: options?.startDate ? { '#ts': 'timestamp' } : undefined,
        ExpressionAttributeValues,
        Limit: limit,
        ScanIndexForward: false, // Most recent first
        ExclusiveStartKey: options?.lastEvaluatedKey,
      }));

      return {
        auditLogs: (result.Items || []) as AuditLogEntry[],
        count: result.Count || 0,
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('❌ Failed to query audit logs by clinic:', error);
      return { auditLogs: [], count: 0 };
    }
  }

  // ========================================
  // STATIC HELPER METHODS
  // ========================================

  /**
   * Determine user role from permissions object
   */
  static getUserRole(userPerms: any): AuditUserRole {
    if (userPerms?.isGlobalSuperAdmin) return 'SUPER_ADMIN';
    if (userPerms?.isSuperAdmin) return 'SUPER_ADMIN';
    
    // Check if any clinic role is admin
    const clinicRoles = userPerms?.clinicRoles || [];
    const hasAdminRole = clinicRoles.some((cr: any) => 
      cr.role === 'A' || cr.role === 'S' || 
      cr.role === 'ADMIN' || cr.role === 'SUPER_ADMIN'
    );
    
    if (hasAdminRole) return 'ADMIN';
    return 'USER';
  }

  /**
   * Extract IP address and user agent from API Gateway event
   */
  static extractRequestContext(event: any): { ipAddress?: string; userAgent?: string } {
    return {
      ipAddress: event?.requestContext?.identity?.sourceIp || 
                 event?.headers?.['X-Forwarded-For']?.split(',')[0]?.trim(),
      userAgent: event?.headers?.['User-Agent'] || event?.headers?.['user-agent'],
    };
  }

  /**
   * Create metadata object for staff operations
   */
  static createStaffMetadata(staffData: any): Record<string, any> {
    return {
      clinicCount: staffData?.clinicRoles?.length || 0,
      roles: staffData?.clinicRoles?.map((cr: any) => cr.role) || [],
      email: staffData?.email,
    };
  }

  /**
   * Create metadata object for shift operations
   */
  static createShiftMetadata(shiftData: any): Record<string, any> {
    return {
      startTime: shiftData?.startTime,
      endTime: shiftData?.endTime,
      clinicId: shiftData?.clinicId,
      staffId: shiftData?.staffId,
      totalHours: shiftData?.totalHours,
      status: shiftData?.status,
    };
  }

  /**
   * Create metadata object for leave operations
   */
  static createLeaveMetadata(leaveData: any, extras?: { cancelledShifts?: number }): Record<string, any> {
    return {
      requestedBy: leaveData?.staffId,
      startDate: leaveData?.startDate,
      endDate: leaveData?.endDate,
      leaveType: leaveData?.type || 'vacation',
      cancelledShifts: extras?.cancelledShifts,
    };
  }

  /**
   * Sanitize sensitive data before logging
   * Removes passwords, tokens, and other sensitive fields
   */
  static sanitizeForAudit(data: any): any {
    if (!data || typeof data !== 'object') return data;
    
    const sensitiveFields = [
      'password', 'passwordHash', 'token', 'accessToken', 
      'refreshToken', 'idToken', 'secret', 'apiKey',
      'ssn', 'socialSecurityNumber', 'bankAccount',
    ];
    
    const sanitized = { ...data };
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Calculate diff between before and after states
   */
  static calculateChanges(before: any, after: any): { changedFields: string[]; changes: Record<string, { from: any; to: any }> } {
    const changedFields: string[] = [];
    const changes: Record<string, { from: any; to: any }> = {};
    
    if (!before || !after) {
      return { changedFields, changes };
    }
    
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    
    for (const key of allKeys) {
      const beforeVal = before[key];
      const afterVal = after[key];
      
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        changedFields.push(key);
        changes[key] = { from: beforeVal, to: afterVal };
      }
    }
    
    return { changedFields, changes };
  }
}

export default AuditLogger;
