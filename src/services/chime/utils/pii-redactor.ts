/**
 * PII Redactor Module
 * 
 * Provides HIPAA-compliant PII (Personally Identifiable Information) redaction
 * for transcripts, logs, and stored data.
 * 
 * Detects and redacts:
 * - SSN, Credit Cards, Phone Numbers
 * - Dates of Birth, Patient IDs
 * - Names (when detected)
 * - Email addresses
 * - Medical record numbers
 * 
 * @module pii-redactor
 */

import {
    ComprehendClient,
    DetectPiiEntitiesCommand,
    PiiEntityType,
    LanguageCode,
} from '@aws-sdk/client-comprehend';

const comprehend = new ComprehendClient({});

export interface RedactionConfig {
    /** Enable PII detection */
    enabled: boolean;
    /** PII types to redact */
    typesToRedact: PiiEntityType[];
    /** Replacement string */
    replacementTemplate: string;
    /** Use AWS Comprehend for detection */
    useComprehend: boolean;
    /** Language for detection */
    language: string;
    /** Log redacted content for audit */
    auditLog: boolean;
}

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
    enabled: process.env.CHIME_ENABLE_PII_REDACTION !== 'false',
    typesToRedact: [
        'SSN',
        'CREDIT_DEBIT_NUMBER',
        'CREDIT_DEBIT_CVV',
        'CREDIT_DEBIT_EXPIRY',
        'PHONE',
        'EMAIL',
        'ADDRESS',
        'DATE_TIME',
        'NAME',
        'DRIVER_ID',
        'PASSPORT_NUMBER',
        'BANK_ACCOUNT_NUMBER',
        'BANK_ROUTING',
    ] as PiiEntityType[],
    replacementTemplate: '[REDACTED-{TYPE}]',
    useComprehend: process.env.CHIME_USE_COMPREHEND_PII !== 'false',
    language: 'en',
    auditLog: process.env.CHIME_PII_AUDIT_LOG === 'true',
};

// Regex patterns for common PII (fallback if Comprehend not available)
const PII_PATTERNS: Record<string, RegExp> = {
    SSN: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    PHONE: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    DOB: /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12][0-9]|3[01])[-\/](?:19|20)\d{2}\b/g,
    MRN: /\b(?:MRN|mrn|MR#|Patient\s*#?)[:.\s]*([A-Z0-9]{6,12})\b/gi,
    DATE_TIME: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
};

// Additional HIPAA-specific patterns
const HIPAA_PATTERNS: Record<string, RegExp> = {
    INSURANCE_ID: /\b(?:Member|Group|Policy|ID)[\s#:]*([A-Z0-9]{8,15})\b/gi,
    PRESCRIPTION: /\b(?:RX|Rx|rx)[\s#:]*([0-9]{6,12})\b/g,
    DIAGNOSIS_CODE: /\b[A-Z]\d{2}(?:\.\d{1,4})?\b/g, // ICD-10 codes
};

export interface RedactionResult {
    original: string;
    redacted: string;
    piiFound: Array<{
        type: string;
        value: string;
        start: number;
        end: number;
    }>;
    confidence: number;
}

/**
 * Redacts PII from text using AWS Comprehend
 */
export async function redactWithComprehend(
    text: string,
    config: Partial<RedactionConfig> = {}
): Promise<RedactionResult> {
    const fullConfig = { ...DEFAULT_REDACTION_CONFIG, ...config };

    if (!text || text.length < 10) {
        return {
            original: text,
            redacted: text,
            piiFound: [],
            confidence: 100,
        };
    }

    try {
        const response = await comprehend.send(new DetectPiiEntitiesCommand({
            Text: text,
            LanguageCode: fullConfig.language as LanguageCode,
        }));

        const entities = response.Entities || [];
        const piiFound: RedactionResult['piiFound'] = [];

        // Sort entities by start position (descending) to replace from end
        const sortedEntities = [...entities].sort((a, b) =>
            (b.BeginOffset || 0) - (a.BeginOffset || 0)
        );

        let redacted = text;

        for (const entity of sortedEntities) {
            if (!entity.BeginOffset || !entity.EndOffset || !entity.Type) continue;

            // Check if this type should be redacted
            if (!fullConfig.typesToRedact.includes(entity.Type as PiiEntityType)) continue;

            const originalValue = text.substring(entity.BeginOffset, entity.EndOffset);
            const replacement = fullConfig.replacementTemplate.replace('{TYPE}', entity.Type);

            redacted =
                redacted.substring(0, entity.BeginOffset) +
                replacement +
                redacted.substring(entity.EndOffset);

            piiFound.push({
                type: entity.Type,
                value: originalValue,
                start: entity.BeginOffset,
                end: entity.EndOffset,
            });
        }

        // Calculate confidence based on entity scores
        const avgScore = entities.length > 0
            ? entities.reduce((sum, e) => sum + (e.Score || 0), 0) / entities.length
            : 1;

        return {
            original: text,
            redacted,
            piiFound,
            confidence: Math.round(avgScore * 100),
        };

    } catch (error: any) {
        console.error('[redactWithComprehend] Error:', error.message);
        // Fall back to regex-based redaction
        return redactWithRegex(text, config);
    }
}

/**
 * Redacts PII using regex patterns (fallback method)
 */
export function redactWithRegex(
    text: string,
    config: Partial<RedactionConfig> = {}
): RedactionResult {
    const fullConfig = { ...DEFAULT_REDACTION_CONFIG, ...config };

    let redacted = text;
    const piiFound: RedactionResult['piiFound'] = [];

    // Process each pattern
    for (const [type, pattern] of Object.entries({ ...PII_PATTERNS, ...HIPAA_PATTERNS })) {
        // Reset regex state
        pattern.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            const value = match[0];
            const replacement = fullConfig.replacementTemplate.replace('{TYPE}', type);

            // Only add unique findings
            if (!piiFound.some(p => p.start === match!.index && p.type === type)) {
                piiFound.push({
                    type,
                    value,
                    start: match.index,
                    end: match.index + value.length,
                });
            }
        }

        // Reset and replace
        pattern.lastIndex = 0;
        redacted = redacted.replace(pattern,
            fullConfig.replacementTemplate.replace('{TYPE}', type)
        );
    }

    return {
        original: text,
        redacted,
        piiFound,
        confidence: 70, // Lower confidence for regex-based detection
    };
}

/**
 * Main redaction function - uses Comprehend or regex based on config
 */
export async function redactPII(
    text: string,
    config: Partial<RedactionConfig> = {}
): Promise<RedactionResult> {
    const fullConfig = { ...DEFAULT_REDACTION_CONFIG, ...config };

    if (!fullConfig.enabled) {
        return {
            original: text,
            redacted: text,
            piiFound: [],
            confidence: 100,
        };
    }

    if (fullConfig.useComprehend) {
        return redactWithComprehend(text, config);
    }

    return redactWithRegex(text, config);
}

/**
 * Redacts PII from an array of transcript segments
 */
export async function redactTranscript(
    segments: Array<{ text: string; timestamp: string; speaker: string }>,
    config: Partial<RedactionConfig> = {}
): Promise<{
    segments: Array<{ text: string; timestamp: string; speaker: string }>;
    totalPiiFound: number;
    types: Record<string, number>;
}> {
    const types: Record<string, number> = {};
    let totalPiiFound = 0;

    const redactedSegments = await Promise.all(
        segments.map(async (segment) => {
            const result = await redactPII(segment.text, config);

            for (const pii of result.piiFound) {
                types[pii.type] = (types[pii.type] || 0) + 1;
                totalPiiFound++;
            }

            return {
                ...segment,
                text: result.redacted,
            };
        })
    );

    return {
        segments: redactedSegments,
        totalPiiFound,
        types,
    };
}

/**
 * Checks if text contains PII without redacting
 */
export async function containsPII(
    text: string,
    config: Partial<RedactionConfig> = {}
): Promise<{
    hasPII: boolean;
    types: string[];
    count: number;
}> {
    const result = await redactPII(text, config);

    const types = Array.from(new Set(result.piiFound.map(p => p.type)));

    return {
        hasPII: result.piiFound.length > 0,
        types,
        count: result.piiFound.length,
    };
}

/**
 * Redacts PII from JSON object (recursively)
 */
export async function redactObject<T extends Record<string, any>>(
    obj: T,
    fieldsToRedact: string[] = ['phoneNumber', 'email', 'ssn', 'name', 'address', 'dob'],
    config: Partial<RedactionConfig> = {}
): Promise<T> {
    const cloned = JSON.parse(JSON.stringify(obj));

    async function processValue(value: any, key: string): Promise<any> {
        if (value === null || value === undefined) return value;

        if (typeof value === 'string') {
            // Check if this field should be fully redacted
            if (fieldsToRedact.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
                return '[REDACTED]';
            }
            // Check for PII in longer text fields
            if (value.length > 20) {
                const result = await redactPII(value, config);
                return result.redacted;
            }
        }

        if (Array.isArray(value)) {
            return Promise.all(value.map((item, idx) => processValue(item, String(idx))));
        }

        if (typeof value === 'object') {
            const processed: Record<string, any> = {};
            for (const [k, v] of Object.entries(value)) {
                processed[k] = await processValue(v, k);
            }
            return processed;
        }

        return value;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(cloned)) {
        result[key] = await processValue(value, key);
    }

    return result as T;
}

/**
 * Masks a phone number for display (shows last 4 digits)
 */
export function maskPhoneNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return `***-***-${digits.slice(-4)}`;
}

/**
 * Masks an email address
 */
export function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    return `${local.charAt(0)}***@${domain}`;
}

/**
 * Gets a safe logging version of call data (for CloudWatch, etc.)
 */
export function getSafeLogData<T extends Record<string, any>>(
    data: T,
    sensitiveKeys: string[] = ['phoneNumber', 'callerPhoneNumber', 'email', 'name']
): T {
    const safe: Record<string, any> = { ...data };

    for (const key of sensitiveKeys) {
        if (safe[key]) {
            if (key.toLowerCase().includes('phone')) {
                safe[key] = maskPhoneNumber(String(safe[key]));
            } else if (key.toLowerCase().includes('email')) {
                safe[key] = maskEmail(String(safe[key]));
            } else {
                safe[key] = '[REDACTED]';
            }
        }
    }

    return safe as T;
}
