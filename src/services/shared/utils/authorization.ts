import { JWTPayload } from 'jose';

export function getClinicsFromClaims(payload: JWTPayload): string[] {
    const xClinics = String((payload as any)["x_clinics"] || "").trim();
    if (xClinics === "ALL") return ["ALL"];
    if (xClinics) {
        return xClinics.split(',').map((s) => s.trim()).filter(Boolean);
    }
    
    const xRbc = String((payload as any)["x_rbc"] || "").trim();
    if (xRbc) {
        return xRbc.split(',').map((pair) => pair.split(':')[0]).filter(Boolean);
    }
    
    const groups = Array.isArray((payload as any)["cognito:groups"]) 
        ? ((payload as any)["cognito:groups"] as string[]) 
        : [];
    if (groups.length > 0) {
        const clinicIds = groups
            .map((name) => {
                const match = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(name));
                return match ? match[1] : '';
            })
            .filter(Boolean);
        if (clinicIds.length > 0) {
            return clinicIds;
        }
    }
    
    return [];
}

export function hasClinicAccess(
    authorizedClinics: string[],
    requestedClinic: string
): boolean {
    return authorizedClinics[0] === "ALL" || authorizedClinics.includes(requestedClinic);
}

export interface AuthorizationResult {
    authorized: boolean;
    reason?: string;
}

export function checkClinicAuthorization(
    payload: JWTPayload,
    clinicId: string
): AuthorizationResult {
    const authorizedClinics = getClinicsFromClaims(payload);
    
    if (authorizedClinics.length === 0) {
        return {
            authorized: false,
            reason: 'No clinic access configured for user'
        };
    }
    
    if (!hasClinicAccess(authorizedClinics, clinicId)) {
        return {
            authorized: false,
            reason: `Not authorized for clinic ${clinicId}`
        };
    }
    
    return { authorized: true };
}
