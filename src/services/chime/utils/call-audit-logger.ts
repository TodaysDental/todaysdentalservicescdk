/**
 * Call Audit Logger Module
 * 
 * HIPAA-compliant audit logging for all call center operations.
 * Tracks access, modifications, and sensitive data handling.
 * 
 * Features:
 * - Immutable audit trail
 * - PII access logging
 * - Compliance event tracking
 * - Retention policy enforcement
 * 
 * @module call-audit-logger
 */

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSafeLogData } from './pii-redactor';

export enum AuditEventType {
    // Call events
    CALL_INITIATED = 'CALL_INITIATED',
    CALL_ANSWERED = 'CALL_ANSWERED',
    CALL_TRANSFERRED = 'CALL_TRANSFERRED',
    CALL_ENDED = 'CALL_ENDED',
    CALL_ABANDONED = 'CALL_ABANDONED',

    // Recording events
    RECORDING_STARTED = 'RECORDING_STARTED',
    RECORDING_STOPPED = 'RECORDING_STOPPED',
    RECORDING_ACCESSED = 'RECORDING_ACCESSED',
    RECORDING_DELETED = 'RECORDING_DELETED',

    // Transcript events
    TRANSCRIPT_CREATED = 'TRANSCRIPT_CREATED',
    TRANSCRIPT_ACCESSED = 'TRANSCRIPT_ACCESSED',
    TRANSCRIPT_REDACTED = 'TRANSCRIPT_REDACTED',

    // Patient data events
    PATIENT_DATA_ACCESSED = 'PATIENT_DATA_ACCESSED',
    PATIENT_DATA_MODIFIED = 'PATIENT_DATA_MODIFIED',
    PII_ACCESSED = 'PII_ACCESSED',
    PII_DISCLOSED = 'PII_DISCLOSED',

    // Agent events
    AGENT_LOGIN = 'AGENT_LOGIN',
    AGENT_LOGOUT = 'AGENT_LOGOUT',
    AGENT_STATUS_CHANGE = 'AGENT_STATUS_CHANGE',

    // Supervision events
    SUPERVISION_STARTED = 'SUPERVISION_STARTED',
    SUPERVISION_ENDED = 'SUPERVISION_ENDED',
    WHISPER_SENT = 'WHISPER_SENT',
    BARGE_IN = 'BARGE_IN',

    // Administrative events
    CONFIG_CHANGED = 'CONFIG_CHANGED',
    USER_PERMISSION_CHANGED = 'USER_PERMISSION_CHANGED',
    EXPORT_REQUESTED = 'EXPORT_REQUESTED',

    // Security events
    AUTH_FAILURE = 'AUTH_FAILURE',
    UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
    CONSENT_OBTAINED = 'CONSENT_OBTAINED',
    CONSENT_REVOKED = 'CONSENT_REVOKED',
}

export enum AuditSeverity {
    INFO = 'INFO',
    WARNING = 'WARNING',
    CRITICAL = 'CRITICAL',
}

export interface AuditEvent {
    eventId: string;
    eventType: AuditEventType;
    severity: AuditSeverity;
    timestamp: string;

    // Actor information
    actorType: 'agent' | 'supervisor' | 'system' | 'patient' | 'admin';
    actorId: string;
    actorName?: string;

    // Target information
    targetType: 'call' | 'recording' | 'transcript' | 'patient' | 'agent' | 'config';
    targetId: string;

    // Context
    clinicId: string;
    callId?: string;

    // Event details
    details: Record<string, any>;

    // Compliance fields
    piiAccessed: boolean;
    hipaaRelevant: boolean;

    // Request metadata
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
}

export interface AuditConfig {
    /** Enable audit logging */
    enabled: boolean;
    /** Log PII access */
    logPiiAccess: boolean;
    /** Retention days */
    retentionDays: number;
    /** Enable CloudWatch logging */
    cloudWatchEnabled: boolean;
    /** Redact sensitive data in logs */
    redactSensitiveData: boolean;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
    enabled: process.env.CHIME_ENABLE_AUDIT_LOGGING !== 'false',
    logPiiAccess: process.env.CHIME_LOG_PII_ACCESS === 'true',
    retentionDays: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || '2555', 10), // 7 years for HIPAA
    cloudWatchEnabled: process.env.CHIME_AUDIT_CLOUDWATCH !== 'false',
    redactSensitiveData: process.env.CHIME_AUDIT_REDACT !== 'false',
};

/**
 * Generates a unique audit event ID
 */
function generateAuditId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `audit-${timestamp}-${random}`;
}

/**
 * Creates an audit event
 */
export function createAuditEvent(
    eventType: AuditEventType,
    actor: {
        type: AuditEvent['actorType'];
        id: string;
        name?: string;
    },
    target: {
        type: AuditEvent['targetType'];
        id: string;
    },
    clinicId: string,
    details: Record<string, any> = {},
    options: {
        callId?: string;
        piiAccessed?: boolean;
        hipaaRelevant?: boolean;
        severity?: AuditSeverity;
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
    } = {}
): AuditEvent {
    // Determine severity based on event type
    let severity = options.severity || AuditSeverity.INFO;
    if ([
        AuditEventType.AUTH_FAILURE,
        AuditEventType.UNAUTHORIZED_ACCESS,
        AuditEventType.PII_DISCLOSED,
    ].includes(eventType)) {
        severity = AuditSeverity.CRITICAL;
    } else if ([
        AuditEventType.PII_ACCESSED,
        AuditEventType.PATIENT_DATA_MODIFIED,
        AuditEventType.RECORDING_DELETED,
        AuditEventType.CONFIG_CHANGED,
    ].includes(eventType)) {
        severity = AuditSeverity.WARNING;
    }

    return {
        eventId: generateAuditId(),
        eventType,
        severity,
        timestamp: new Date().toISOString(),
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        targetType: target.type,
        targetId: target.id,
        clinicId,
        callId: options.callId,
        details,
        piiAccessed: options.piiAccessed || false,
        hipaaRelevant: options.hipaaRelevant || false,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        requestId: options.requestId,
    };
}

/**
 * Writes an audit event to DynamoDB
 */
export async function logAuditEvent(
    ddb: DynamoDBDocumentClient,
    event: AuditEvent,
    auditTableName: string,
    config: Partial<AuditConfig> = {}
): Promise<{ success: boolean; eventId: string }> {
    const fullConfig = { ...DEFAULT_AUDIT_CONFIG, ...config };

    if (!fullConfig.enabled) {
        return { success: false, eventId: event.eventId };
    }

    try {
        // Redact sensitive data if configured
        const safeDetails = fullConfig.redactSensitiveData
            ? getSafeLogData(event.details)
            : event.details;

        // Calculate TTL for retention
        const ttl = Math.floor(Date.now() / 1000) + (fullConfig.retentionDays * 24 * 60 * 60);

        await ddb.send(new PutCommand({
            TableName: auditTableName,
            Item: {
                ...event,
                details: safeDetails,
                ttl,
                // Partition key for efficient querying
                pk: `CLINIC#${event.clinicId}`,
                sk: `${event.timestamp}#${event.eventId}`,
                // GSI keys
                gsi1pk: `EVENT#${event.eventType}`,
                gsi1sk: event.timestamp,
                gsi2pk: event.callId ? `CALL#${event.callId}` : `NOCALL#${event.clinicId}`,
                gsi2sk: event.timestamp,
            },
        }));

        // Log to CloudWatch if enabled
        if (fullConfig.cloudWatchEnabled) {
            console.log(JSON.stringify({
                logType: 'AUDIT',
                ...event,
                details: safeDetails,
            }));
        }

        return { success: true, eventId: event.eventId };

    } catch (error: any) {
        console.error('[logAuditEvent] Error:', error.message);
        return { success: false, eventId: event.eventId };
    }
}

/**
 * Convenience function to log and write an audit event in one call
 */
export async function audit(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    eventType: AuditEventType,
    actor: {
        type: AuditEvent['actorType'];
        id: string;
        name?: string;
    },
    target: {
        type: AuditEvent['targetType'];
        id: string;
    },
    clinicId: string,
    details: Record<string, any> = {},
    options: {
        callId?: string;
        piiAccessed?: boolean;
        hipaaRelevant?: boolean;
    } = {}
): Promise<void> {
    const event = createAuditEvent(eventType, actor, target, clinicId, details, options);
    await logAuditEvent(ddb, event, auditTableName);
}

/**
 * Logs a call event
 */
export async function auditCallEvent(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    eventType: AuditEventType,
    callId: string,
    clinicId: string,
    agentId: string,
    agentName?: string,
    details: Record<string, any> = {}
): Promise<void> {
    await audit(
        ddb,
        auditTableName,
        eventType,
        { type: 'agent', id: agentId, name: agentName },
        { type: 'call', id: callId },
        clinicId,
        details,
        { callId }
    );
}

/**
 * Logs a PII access event
 */
export async function auditPiiAccess(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    actorId: string,
    actorType: AuditEvent['actorType'],
    targetType: AuditEvent['targetType'],
    targetId: string,
    clinicId: string,
    accessReason: string,
    dataTypes: string[]
): Promise<void> {
    await audit(
        ddb,
        auditTableName,
        AuditEventType.PII_ACCESSED,
        { type: actorType, id: actorId },
        { type: targetType, id: targetId },
        clinicId,
        {
            accessReason,
            dataTypes,
        },
        { piiAccessed: true, hipaaRelevant: true }
    );
}

/**
 * Queries audit events for a clinic
 */
export async function getAuditEvents(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    clinicId: string,
    startTime: string,
    endTime: string,
    filters?: {
        eventType?: AuditEventType;
        actorId?: string;
        callId?: string;
        severityMin?: AuditSeverity;
    }
): Promise<AuditEvent[]> {
    try {
        let queryParams: any = {
            TableName: auditTableName,
            KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
            ExpressionAttributeValues: {
                ':pk': `CLINIC#${clinicId}`,
                ':start': startTime,
                ':end': endTime,
            },
        };

        // Add filters
        if (filters) {
            const filterExpressions: string[] = [];

            if (filters.eventType) {
                filterExpressions.push('eventType = :eventType');
                queryParams.ExpressionAttributeValues[':eventType'] = filters.eventType;
            }

            if (filters.actorId) {
                filterExpressions.push('actorId = :actorId');
                queryParams.ExpressionAttributeValues[':actorId'] = filters.actorId;
            }

            if (filters.callId) {
                filterExpressions.push('callId = :callId');
                queryParams.ExpressionAttributeValues[':callId'] = filters.callId;
            }

            if (filterExpressions.length > 0) {
                queryParams.FilterExpression = filterExpressions.join(' AND ');
            }
        }

        const { Items } = await ddb.send(new QueryCommand(queryParams));
        return (Items || []) as AuditEvent[];

    } catch (error: any) {
        console.error('[getAuditEvents] Error:', error.message);
        return [];
    }
}

/**
 * Gets audit events for a specific call
 */
export async function getCallAuditTrail(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    callId: string
): Promise<AuditEvent[]> {
    try {
        const { Items } = await ddb.send(new QueryCommand({
            TableName: auditTableName,
            IndexName: 'gsi2',
            KeyConditionExpression: 'gsi2pk = :pk',
            ExpressionAttributeValues: {
                ':pk': `CALL#${callId}`,
            },
            ScanIndexForward: true, // Chronological order
        }));

        return (Items || []) as AuditEvent[];

    } catch (error: any) {
        console.error('[getCallAuditTrail] Error:', error.message);
        return [];
    }
}

/**
 * Generates a compliance report for a date range
 */
export async function generateComplianceReport(
    ddb: DynamoDBDocumentClient,
    auditTableName: string,
    clinicId: string,
    startDate: string,
    endDate: string
): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    piiAccessCount: number;
    criticalEvents: number;
    uniqueActors: number;
}> {
    const events = await getAuditEvents(ddb, auditTableName, clinicId, startDate, endDate);

    const eventsByType: Record<string, number> = {};
    const uniqueActors = new Set<string>();
    let piiAccessCount = 0;
    let criticalEvents = 0;

    for (const event of events) {
        eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
        uniqueActors.add(event.actorId);
        if (event.piiAccessed) piiAccessCount++;
        if (event.severity === AuditSeverity.CRITICAL) criticalEvents++;
    }

    return {
        totalEvents: events.length,
        eventsByType,
        piiAccessCount,
        criticalEvents,
        uniqueActors: uniqueActors.size,
    };
}
