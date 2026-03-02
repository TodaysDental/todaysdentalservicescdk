/**
 * Input Validation Layer
 *
 * Lightweight validation helpers for WebSocket action payloads.
 * Provides early rejection with clear error messages.
 */

import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { sendToClient } from './broadcast-service';

/** Validation result: either valid with typed data, or invalid with error. */
export type ValidationResult<T> =
    | { valid: true; data: T }
    | { valid: false; error: string };

/**
 * Validate that required string fields are present and non-empty.
 */
export function requireStrings<K extends string>(
    payload: Record<string, unknown>,
    ...keys: K[]
): ValidationResult<Record<K, string>> {
    const data: Record<string, string> = {};
    for (const key of keys) {
        const value = payload[key];
        if (typeof value !== 'string' || value.trim() === '') {
            return { valid: false, error: `Missing required field: ${key}` };
        }
        data[key] = value.trim();
    }
    return { valid: true, data: data as Record<K, string> };
}

/**
 * Validate that a payload has the expected action and required fields.
 * Sends error to client if validation fails.
 * Returns the validated data or null.
 */
export async function validateAndReply<K extends string>(
    apiGwManagement: ApiGatewayManagementApiClient,
    connectionId: string,
    payload: Record<string, unknown>,
    ...requiredFields: K[]
): Promise<Record<K, string> | null> {
    const result = requireStrings(payload, ...requiredFields);
    if (!result.valid) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: result.error,
        });
        return null;
    }
    return result.data;
}

/**
 * Validate that a field is one of the allowed values.
 */
export function requireEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    fieldName: string,
): ValidationResult<T> {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        return {
            valid: false,
            error: `Invalid ${fieldName}: must be one of ${allowed.join(', ')}`,
        };
    }
    return { valid: true, data: value as T };
}

/**
 * Validate that a value is a positive number.
 */
export function requirePositiveNumber(
    value: unknown,
    fieldName: string,
): ValidationResult<number> {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return { valid: false, error: `${fieldName} must be a positive number` };
    }
    return { valid: true, data: num };
}

/**
 * Validate that a value is a non-empty array.
 */
export function requireNonEmptyArray<T>(
    value: unknown,
    fieldName: string,
): ValidationResult<T[]> {
    if (!Array.isArray(value) || value.length === 0) {
        return { valid: false, error: `${fieldName} must be a non-empty array` };
    }
    return { valid: true, data: value as T[] };
}
