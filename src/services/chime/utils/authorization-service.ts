/**
 * Authorization Service
 * Fix 20: Handles clinic authorization with caching and inline checks
 * 
 * Prevents TOCTOU (Time-of-Check-Time-of-Use) vulnerabilities by:
 * - Including authorization in conditional expressions
 * - Caching clinic membership with short TTL
 * - Providing authorization condition builders for DynamoDB operations
 */

import { JWTPayload } from 'jose';

export interface AuthorizationResult {
    authorized: boolean;
    reason?: string;
    clinics: string[];
}

interface CacheEntry {
    clinics: string[];
    expiresAt: number;
}

export class AuthorizationService {
    private cache = new Map<string, CacheEntry>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Get authorized clinics for a user with caching
     */
    async getAuthorizedClinics(jwtPayload: JWTPayload): Promise<string[]> {
        const userId = jwtPayload.sub || '';
        const cacheKey = userId;
        
        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            console.log(`[AuthService] Using cached clinics for user ${userId} (${cached.clinics.length} clinics)`);
            return cached.clinics;
        }

        // Extract clinics from JWT claims
        const clinics = this.getClinicsFromClaims(jwtPayload);

        // Cache the result
        this.cache.set(cacheKey, {
            clinics,
            expiresAt: Date.now() + this.CACHE_TTL
        });

        console.log(`[AuthService] Cached clinics for user ${userId}: ${clinics.join(', ')}`);
        return clinics;
    }

    /**
     * Extract clinic IDs from JWT claims
     * Supports multiple claim formats: x_clinics, cognito:groups, custom:clinics
     */
    private getClinicsFromClaims(jwtPayload: JWTPayload): string[] {
        // Try different claim names (common patterns)
        const clinicClaims = [
            jwtPayload['x_clinics'],
            jwtPayload['cognito:groups'],
            jwtPayload['custom:clinics'],
            jwtPayload['clinics']
        ];

        for (const claim of clinicClaims) {
            if (Array.isArray(claim) && claim.length > 0) {
                return claim.filter(c => typeof c === 'string');
            }
            if (typeof claim === 'string') {
                // Handle comma-separated string
                return claim.split(',').map(c => c.trim()).filter(c => c.length > 0);
            }
        }

        console.warn('[AuthService] No clinic claims found in JWT payload');
        return [];
    }

    /**
     * Check if user is authorized for a specific clinic
     */
    async isAuthorizedForClinic(
        jwtPayload: JWTPayload, 
        clinicId: string
    ): Promise<AuthorizationResult> {
        const clinics = await this.getAuthorizedClinics(jwtPayload);

        // Check for wildcard access
        if (clinics.includes('ALL') || clinics.includes('*')) {
            return {
                authorized: true,
                clinics,
                reason: 'Wildcard access granted'
            };
        }

        // Check for specific clinic access
        if (clinics.includes(clinicId)) {
            return {
                authorized: true,
                clinics,
                reason: `Access to clinic ${clinicId}`
            };
        }

        return {
            authorized: false,
            clinics,
            reason: `User does not have access to clinic ${clinicId}`
        };
    }

    /**
     * Build DynamoDB condition expression for authorization
     * Use this in conditional expressions to prevent TOCTOU race conditions
     * 
     * Example:
     * const authCondition = authService.buildAuthorizationCondition(clinicId, agentId);
     * await ddb.send(new UpdateCommand({
     *   ...
     *   ConditionExpression: `#status = :connected AND ${authCondition.condition}`,
     *   ExpressionAttributeValues: {
     *     ...authCondition.values,
     *     ':connected': 'connected'
     *   }
     * }));
     */
    buildAuthorizationCondition(clinicId: string, agentId: string): {
        condition: string;
        names: Record<string, string>;
        values: Record<string, any>;
    } {
        // This condition checks that the agent is actually assigned to the call
        // Prevents one agent from manipulating another agent's calls
        return {
            condition: '(assignedAgentId = :authAgentId OR contains(agentIds, :authAgentId))',
            names: {},
            values: {
                ':authAgentId': agentId,
                ':authClinicId': clinicId
            }
        };
    }

    /**
     * Build condition for agent presence updates
     * Ensures agent can only update their own record
     */
    buildAgentSelfCondition(agentId: string): {
        condition: string;
        names: Record<string, string>;
        values: Record<string, any>;
    } {
        return {
            condition: 'agentId = :authAgentId',
            names: {},
            values: {
                ':authAgentId': agentId
            }
        };
    }

    /**
     * Build condition for clinic-specific operations
     * Ensures operation is for the correct clinic
     */
    buildClinicCondition(clinicId: string): {
        condition: string;
        names: Record<string, string>;
        values: Record<string, any>;
    } {
        return {
            condition: 'clinicId = :authClinicId',
            names: {},
            values: {
                ':authClinicId': clinicId
            }
        };
    }

    /**
     * Combine multiple conditions with AND
     */
    combineConditions(...conditions: {
        condition: string;
        names: Record<string, string>;
        values: Record<string, any>;
    }[]): {
        condition: string;
        names: Record<string, string>;
        values: Record<string, any>;
    } {
        const combined = {
            condition: conditions.map(c => `(${c.condition})`).join(' AND '),
            names: {} as Record<string, string>,
            values: {} as Record<string, any>
        };

        // Merge names and values
        for (const c of conditions) {
            Object.assign(combined.names, c.names);
            Object.assign(combined.values, c.values);
        }

        return combined;
    }

    /**
     * Invalidate cache for a specific user
     * Call this when user permissions change
     */
    invalidateCache(userId: string): void {
        this.cache.delete(userId);
        console.log(`[AuthService] Invalidated cache for user ${userId}`);
    }

    /**
     * Clear all cache
     * Call this periodically or on configuration changes
     */
    clearAllCache(): void {
        const size = this.cache.size;
        this.cache.clear();
        console.log(`[AuthService] Cleared cache (${size} entries removed)`);
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        entries: Array<{ userId: string; clinics: string[]; expiresAt: Date }>;
    } {
        const entries = Array.from(this.cache.entries()).map(([userId, entry]) => ({
            userId,
            clinics: entry.clinics,
            expiresAt: new Date(entry.expiresAt)
        }));

        return {
            size: this.cache.size,
            entries
        };
    }

    /**
     * Clean up expired cache entries
     * Call this periodically from a cleanup job
     */
    cleanupExpiredCache(): number {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt <= now) {
                this.cache.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`[AuthService] Cleaned up ${removed} expired cache entries`);
        }

        return removed;
    }
}

/**
 * Create a singleton instance
 */
export const authorizationService = new AuthorizationService();

/**
 * Helper function for backwards compatibility
 * Checks clinic authorization and returns structured result
 */
export function checkClinicAuthorization(
    jwtPayload: JWTPayload,
    clinicId: string
): AuthorizationResult {
    const clinics = authorizationService['getClinicsFromClaims'](jwtPayload);

    if (clinics.includes('ALL') || clinics.includes('*') || clinics.includes(clinicId)) {
        return {
            authorized: true,
            clinics,
            reason: `Access granted to clinic ${clinicId}`
        };
    }

    return {
        authorized: false,
        clinics,
        reason: `Access denied to clinic ${clinicId}`
    };
}

