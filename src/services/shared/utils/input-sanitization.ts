export interface SanitizationResult<T> {
    sanitized?: T;
    error?: string;
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9\s.,!?:;'"\-@#$/()&+]*$/;

export function sanitizePhoneNumber(input: unknown): SanitizationResult<string> {
    if (typeof input !== 'string') {
        return { error: 'Phone number must be a string' };
    }
    
    const trimmed = input.trim();
    
    if (!E164_REGEX.test(trimmed)) {
        return { error: 'Phone number must be in E.164 format (e.g., +12065550100)' };
    }
    
    // Additional validation: remove any potential SIP injection characters
    if (trimmed.includes('@') || trimmed.includes(':') || trimmed.includes(';')) {
        return { error: 'Phone number contains invalid characters' };
    }
    
    return { sanitized: trimmed };
}

export function sanitizeText(
    input: unknown,
    maxLength: number = 500,
    fieldName: string = 'text'
): SanitizationResult<string> {
    if (input === undefined || input === null) {
        return { sanitized: undefined };
    }
    
    if (typeof input !== 'string') {
        return { error: `${fieldName} must be a string` };
    }
    
    const trimmed = input.trim();
    
    if (!trimmed) {
        return { sanitized: undefined };
    }
    
    if (!ALPHANUMERIC_REGEX.test(trimmed)) {
        return { error: `${fieldName} contains unsupported characters` };
    }
    
    // XSS protection: escape HTML entities
    const escaped = trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    
    return { sanitized: escaped.slice(0, maxLength) };
}

export function validateClinicId(input: unknown): SanitizationResult<string> {
    if (typeof input !== 'string') {
        return { error: 'Clinic ID must be a string' };
    }
    
    const trimmed = input.trim();
    
    // Clinic IDs should be alphanumeric with optional underscores/hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return { error: 'Clinic ID contains invalid characters' };
    }
    
    if (trimmed.length > 100) {
        return { error: 'Clinic ID too long' };
    }
    
    return { sanitized: trimmed };
}
