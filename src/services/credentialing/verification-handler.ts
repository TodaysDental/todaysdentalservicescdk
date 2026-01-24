/**
 * Credentialing Verification Handler
 * 
 * Real-time verification of provider credentials via external APIs:
 * 1. NPI Verification - NPPES Registry (free, public API)
 * 2. OIG Exclusion Check - LEIE database (free, public API)
 * 3. State License Lookup - State-specific APIs (varies by state)
 * 
 * All verification results are stored with timestamps for compliance tracking.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    hasModulePermission,
    getAllowedClinicIds,
    PermissionType,
} from '../../shared/utils/permissions-helper';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const VERIFICATION_LOGS_TABLE = process.env.VERIFICATION_LOGS_TABLE!;

// Module configuration
const MODULE_NAME = 'CREDENTIALING';

// ========================================
// RESPONSE HELPERS
// ========================================

let currentCorsHeaders = buildCorsHeaders();

const httpErr = (code: number, message: string): APIGatewayProxyResult => ({
    statusCode: code,
    headers: currentCorsHeaders,
    body: JSON.stringify({ success: false, message })
});

const httpOk = (data: Record<string, any>): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: currentCorsHeaders,
    body: JSON.stringify({ success: true, ...data })
});

// ========================================
// HTTP REQUEST HELPER
// ========================================

function httpsRequest(
    url: string,
    options: { method?: string; timeout?: number } = {}
): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 15000;
        const req = https.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// ========================================
// NPPES NPI VERIFICATION
// ========================================

interface NPPESResult {
    valid: boolean;
    npi: string;
    providerName?: string;
    credential?: string;
    taxonomyCode?: string;
    taxonomyDescription?: string;
    primaryPracticeAddress?: {
        address1: string;
        address2?: string;
        city: string;
        state: string;
        zip: string;
    };
    enumerationDate?: string;
    lastUpdated?: string;
    status?: string;
    rawData?: any;
    error?: string;
}

/**
 * Verify NPI against the NPPES Registry.
 * API Docs: https://npiregistry.cms.hhs.gov/api-page
 */
async function verifyNPI(npi: string): Promise<NPPESResult> {
    const cleanNpi = npi.replace(/\D/g, '');

    if (cleanNpi.length !== 10) {
        return { valid: false, npi: cleanNpi, error: 'Invalid NPI format (must be 10 digits)' };
    }

    try {
        const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${cleanNpi}`;
        const response = await httpsRequest(url);

        if (response.statusCode !== 200) {
            return { valid: false, npi: cleanNpi, error: `NPPES API returned status ${response.statusCode}` };
        }

        const data = JSON.parse(response.body);

        if (data.result_count === 0 || !data.results || data.results.length === 0) {
            return { valid: false, npi: cleanNpi, error: 'NPI not found in NPPES registry' };
        }

        const result = data.results[0];
        const basic = result.basic || {};
        const addresses = result.addresses || [];
        const taxonomies = result.taxonomies || [];

        // Find primary practice address
        const practiceAddress = addresses.find((a: any) => a.address_purpose === 'LOCATION') || addresses[0];

        // Find primary taxonomy
        const primaryTaxonomy = taxonomies.find((t: any) => t.primary === true) || taxonomies[0];

        // Build provider name based on entity type
        let providerName: string;
        if (result.enumeration_type === 'NPI-1') {
            // Individual provider
            providerName = `${basic.first_name || ''} ${basic.middle_name || ''} ${basic.last_name || ''}`.trim();
            if (basic.credential) {
                providerName += `, ${basic.credential}`;
            }
        } else {
            // Organization (NPI-2)
            providerName = basic.organization_name || basic.name || '';
        }

        return {
            valid: true,
            npi: cleanNpi,
            providerName,
            credential: basic.credential,
            taxonomyCode: primaryTaxonomy?.code,
            taxonomyDescription: primaryTaxonomy?.desc,
            primaryPracticeAddress: practiceAddress ? {
                address1: practiceAddress.address_1,
                address2: practiceAddress.address_2,
                city: practiceAddress.city,
                state: practiceAddress.state,
                zip: practiceAddress.postal_code,
            } : undefined,
            enumerationDate: basic.enumeration_date,
            lastUpdated: basic.last_updated,
            status: basic.status || 'Active',
            rawData: result,
        };
    } catch (error: any) {
        console.error('NPI verification error:', error);
        return { valid: false, npi: cleanNpi, error: `Verification failed: ${error.message}` };
    }
}

// ========================================
// OIG EXCLUSION CHECK (LEIE)
// ========================================

interface OIGResult {
    excluded: boolean;
    npi?: string;
    lastName?: string;
    firstName?: string;
    exclusionType?: string;
    exclusionDate?: string;
    reinstateDate?: string;
    waiverDate?: string;
    waiverState?: string;
    rawData?: any;
    error?: string;
    checkedAt: string;
}

/**
 * Check OIG LEIE (List of Excluded Individuals/Entities) for exclusions.
 * API Docs: https://oig.hhs.gov/exclusions/exclusions_list.asp
 * 
 * Note: The OIG provides a downloadable database. For real-time checks,
 * we use their search API endpoint.
 */
async function checkOIGExclusion(params: {
    npi?: string;
    lastName?: string;
    firstName?: string;
}): Promise<OIGResult> {
    const { npi, lastName, firstName } = params;
    const checkedAt = new Date().toISOString();

    if (!npi && !lastName) {
        return { excluded: false, error: 'NPI or lastName required', checkedAt };
    }

    try {
        // OIG LEIE Search API
        // The API accepts name-based searches primarily
        let url = 'https://exclusions.oig.hhs.gov/api/exclusions';
        const queryParams: string[] = [];

        if (lastName) {
            queryParams.push(`lname=${encodeURIComponent(lastName.toUpperCase())}`);
        }
        if (firstName) {
            queryParams.push(`fname=${encodeURIComponent(firstName.toUpperCase())}`);
        }

        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        const response = await httpsRequest(url);

        if (response.statusCode !== 200) {
            // OIG API might not be available - return as unknown
            console.warn(`OIG API returned status ${response.statusCode}`);
            return {
                excluded: false,
                npi,
                lastName,
                firstName,
                error: `OIG API unavailable (status ${response.statusCode}). Manual check recommended.`,
                checkedAt,
            };
        }

        const data = JSON.parse(response.body);
        const exclusions = Array.isArray(data) ? data : (data.results || []);

        if (exclusions.length === 0) {
            return {
                excluded: false,
                npi,
                lastName,
                firstName,
                checkedAt,
            };
        }

        // If NPI provided, filter by NPI match
        if (npi) {
            const npiMatch = exclusions.find((e: any) => e.npi === npi);
            if (npiMatch) {
                return {
                    excluded: true,
                    npi,
                    lastName: npiMatch.lastname,
                    firstName: npiMatch.firstname,
                    exclusionType: npiMatch.excltype,
                    exclusionDate: npiMatch.excldate,
                    reinstateDate: npiMatch.reindate,
                    waiverDate: npiMatch.waiverdate,
                    waiverState: npiMatch.waiverstate,
                    rawData: npiMatch,
                    checkedAt,
                };
            }
        }

        // Check for name matches
        const nameMatch = exclusions.find((e: any) => {
            const lastMatch = lastName && e.lastname?.toUpperCase() === lastName.toUpperCase();
            const firstMatch = !firstName || e.firstname?.toUpperCase() === firstName.toUpperCase();
            return lastMatch && firstMatch;
        });

        if (nameMatch) {
            return {
                excluded: true,
                npi: nameMatch.npi,
                lastName: nameMatch.lastname,
                firstName: nameMatch.firstname,
                exclusionType: nameMatch.excltype,
                exclusionDate: nameMatch.excldate,
                reinstateDate: nameMatch.reindate,
                rawData: nameMatch,
                checkedAt,
            };
        }

        return {
            excluded: false,
            npi,
            lastName,
            firstName,
            checkedAt,
        };
    } catch (error: any) {
        console.error('OIG exclusion check error:', error);
        return {
            excluded: false,
            npi,
            lastName,
            firstName,
            error: `OIG check failed: ${error.message}. Manual verification recommended.`,
            checkedAt,
        };
    }
}

// ========================================
// STATE LICENSE VERIFICATION
// ========================================

interface StateLicenseResult {
    valid: boolean;
    licenseNumber: string;
    state: string;
    providerName?: string;
    licenseType?: string;
    status?: string;
    issueDate?: string;
    expirationDate?: string;
    disciplines?: string[];
    error?: string;
    verificationMethod: 'api' | 'manual_required';
    checkedAt: string;
}

/**
 * State license verification.
 * Note: Each state has different APIs or no public API.
 * We support direct API calls for states with public lookup APIs
 * and flag manual verification for others.
 */
async function verifyStateLicense(
    state: string,
    licenseNumber: string,
    licenseType: string = 'dental'
): Promise<StateLicenseResult> {
    const checkedAt = new Date().toISOString();
    const stateUpper = state.toUpperCase();

    // States with known public lookup APIs
    const statesWithAPIs: Record<string, string> = {
        // Texas has a public API
        'TX': 'https://public.tpbd.texas.gov/',
        // California has a public lookup
        'CA': 'https://search.dca.ca.gov/',
        // Florida has a public API
        'FL': 'https://mqa-internet.doh.state.fl.us/',
        // New York has a public lookup
        'NY': 'https://www.op.nysed.gov/',
        // Many states use FSMB or other aggregators
    };

    // For states without direct APIs, return manual verification required
    if (!statesWithAPIs[stateUpper]) {
        return {
            valid: false,
            licenseNumber,
            state: stateUpper,
            verificationMethod: 'manual_required',
            error: `No automated verification available for ${stateUpper}. Manual lookup required.`,
            checkedAt,
        };
    }

    // Texas Dental Board lookup example
    if (stateUpper === 'TX') {
        try {
            // Texas State Board of Dental Examiners API
            // Note: This is a simplified example - actual API may require registration
            const url = `https://vo.licensing.hhs.texas.gov/datamart/searchResultsDetails.do?licenseNumber=${encodeURIComponent(licenseNumber)}`;

            // In production, you would parse the response here
            // For now, return that manual verification is needed for complex cases
            return {
                valid: false,
                licenseNumber,
                state: stateUpper,
                verificationMethod: 'manual_required',
                error: 'Texas license verification requires direct state board lookup. Visit: https://vo.licensing.hhs.texas.gov/',
                checkedAt,
            };
        } catch (error: any) {
            return {
                valid: false,
                licenseNumber,
                state: stateUpper,
                verificationMethod: 'manual_required',
                error: `Texas license check failed: ${error.message}`,
                checkedAt,
            };
        }
    }

    // Default fallback for other "supported" states
    return {
        valid: false,
        licenseNumber,
        state: stateUpper,
        verificationMethod: 'manual_required',
        error: `Automated verification for ${stateUpper} is not yet implemented. Manual lookup required.`,
        checkedAt,
    };
}

// ========================================
// VERIFICATION LOG STORAGE
// ========================================

interface VerificationLog {
    verificationId: string;
    providerId: string;
    verificationType: 'npi' | 'oig' | 'state_license' | 'dea';
    requestParams: Record<string, any>;
    result: Record<string, any>;
    status: 'passed' | 'failed' | 'needs_review' | 'error';
    verifiedAt: string;
    verifiedBy?: string;
    expiresAt?: string;
}

async function logVerification(log: VerificationLog): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: VERIFICATION_LOGS_TABLE,
        Item: log,
    }));
}

// ========================================
// COMPREHENSIVE PROVIDER VERIFICATION
// ========================================

interface ComprehensiveVerificationResult {
    providerId: string;
    overallStatus: 'passed' | 'failed' | 'needs_review';
    npiVerification?: NPPESResult & { status: string };
    oigExclusion?: OIGResult & { status: string };
    stateLicense?: StateLicenseResult & { status: string };
    verifiedAt: string;
    issues: string[];
}

async function runComprehensiveVerification(
    providerId: string,
    providerData: {
        npi?: string;
        firstName?: string;
        lastName?: string;
        stateLicenseNumber?: string;
        stateLicenseState?: string;
    },
    userId?: string
): Promise<ComprehensiveVerificationResult> {
    const verifiedAt = new Date().toISOString();
    const issues: string[] = [];
    let overallStatus: 'passed' | 'failed' | 'needs_review' = 'passed';

    const result: ComprehensiveVerificationResult = {
        providerId,
        overallStatus,
        verifiedAt,
        issues,
    };

    // 1. NPI Verification
    if (providerData.npi) {
        const npiResult = await verifyNPI(providerData.npi);
        const npiStatus = npiResult.valid ? 'passed' : 'failed';
        result.npiVerification = { ...npiResult, status: npiStatus };

        if (!npiResult.valid) {
            issues.push(`NPI verification failed: ${npiResult.error || 'Invalid NPI'}`);
            overallStatus = 'failed';
        }

        await logVerification({
            verificationId: uuidv4(),
            providerId,
            verificationType: 'npi',
            requestParams: { npi: providerData.npi },
            result: npiResult,
            status: npiStatus,
            verifiedAt,
            verifiedBy: userId,
        });
    }

    // 2. OIG Exclusion Check
    if (providerData.npi || providerData.lastName) {
        const oigResult = await checkOIGExclusion({
            npi: providerData.npi,
            lastName: providerData.lastName,
            firstName: providerData.firstName,
        });

        let oigStatus: 'passed' | 'failed' | 'needs_review' = 'passed';
        if (oigResult.excluded) {
            oigStatus = 'failed';
            issues.push(`EXCLUDED from OIG/LEIE: ${oigResult.exclusionType || 'Unknown type'}`);
            overallStatus = 'failed';
        } else if (oigResult.error) {
            oigStatus = 'needs_review';
            issues.push(`OIG check warning: ${oigResult.error}`);
            if (overallStatus !== 'failed') overallStatus = 'needs_review';
        }

        result.oigExclusion = { ...oigResult, status: oigStatus };

        await logVerification({
            verificationId: uuidv4(),
            providerId,
            verificationType: 'oig',
            requestParams: { npi: providerData.npi, lastName: providerData.lastName, firstName: providerData.firstName },
            result: oigResult,
            status: oigStatus,
            verifiedAt,
            verifiedBy: userId,
        });
    }

    // 3. State License Verification
    if (providerData.stateLicenseNumber && providerData.stateLicenseState) {
        const licenseResult = await verifyStateLicense(
            providerData.stateLicenseState,
            providerData.stateLicenseNumber
        );

        let licenseStatus: 'passed' | 'failed' | 'needs_review' = 'passed';
        if (licenseResult.verificationMethod === 'manual_required') {
            licenseStatus = 'needs_review';
            issues.push(`State license (${providerData.stateLicenseState}) requires manual verification`);
            if (overallStatus !== 'failed') overallStatus = 'needs_review';
        } else if (!licenseResult.valid) {
            licenseStatus = 'failed';
            issues.push(`State license verification failed: ${licenseResult.error || 'Invalid license'}`);
            overallStatus = 'failed';
        }

        result.stateLicense = { ...licenseResult, status: licenseStatus };

        await logVerification({
            verificationId: uuidv4(),
            providerId,
            verificationType: 'state_license',
            requestParams: { state: providerData.stateLicenseState, licenseNumber: providerData.stateLicenseNumber },
            result: licenseResult,
            status: licenseStatus,
            verifiedAt,
            verifiedBy: userId,
        });
    }

    result.overallStatus = overallStatus;
    result.issues = issues;

    // Update provider verification status
    if (providerId) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: PROVIDERS_TABLE,
                Key: { providerId },
                UpdateExpression: 'SET verificationStatus = :status, lastVerifiedAt = :at, verificationIssues = :issues',
                ExpressionAttributeValues: {
                    ':status': overallStatus,
                    ':at': verifiedAt,
                    ':issues': issues,
                },
            }));
        } catch (err) {
            console.warn('Could not update provider verification status:', err);
        }
    }

    return result;
}

// ========================================
// API HANDLER
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers?.origin || event.headers?.Origin;
    currentCorsHeaders = buildCorsHeaders({}, origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: currentCorsHeaders, body: '' };
    }

    // Authentication
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
        return httpErr(401, 'Unauthorized');
    }

    const methodPermission: PermissionType = event.httpMethod === 'GET' ? 'read' : 'write';
    if (!hasModulePermission(
        userPerms.clinicRoles || [],
        MODULE_NAME,
        methodPermission,
        userPerms.isSuperAdmin || false,
        userPerms.isGlobalSuperAdmin || false
    )) {
        return httpErr(403, 'Insufficient permissions');
    }

    const path = event.path.replace(/^\/credentialing/, '').replace(/\/$/, '');
    const method = event.httpMethod;

    try {
        // GET /verify/npi?npi=1234567890
        if (method === 'GET' && path === '/verify/npi') {
            const npi = event.queryStringParameters?.npi;
            if (!npi) {
                return httpErr(400, 'npi query parameter is required');
            }
            const result = await verifyNPI(npi);
            return httpOk({ verification: result });
        }

        // GET /verify/oig?lastName=Smith&firstName=John&npi=1234567890
        if (method === 'GET' && path === '/verify/oig') {
            const { lastName, firstName, npi } = event.queryStringParameters || {};
            if (!lastName && !npi) {
                return httpErr(400, 'lastName or npi query parameter is required');
            }
            const result = await checkOIGExclusion({ lastName, firstName, npi });
            return httpOk({ verification: result });
        }

        // GET /verify/license?state=TX&licenseNumber=12345
        if (method === 'GET' && path === '/verify/license') {
            const { state, licenseNumber } = event.queryStringParameters || {};
            if (!state || !licenseNumber) {
                return httpErr(400, 'state and licenseNumber query parameters are required');
            }
            const result = await verifyStateLicense(state, licenseNumber);
            return httpOk({ verification: result });
        }

        // POST /verify/comprehensive - Run all verifications for a provider
        if (method === 'POST' && path === '/verify/comprehensive') {
            const body = event.body ? JSON.parse(event.body) : {};
            const { providerId, npi, firstName, lastName, stateLicenseNumber, stateLicenseState } = body;

            if (!providerId && !npi) {
                return httpErr(400, 'providerId or npi is required');
            }

            // If providerId provided, fetch provider data
            let providerData = { npi, firstName, lastName, stateLicenseNumber, stateLicenseState };

            if (providerId && !npi) {
                const { Item: provider } = await ddb.send(new GetCommand({
                    TableName: PROVIDERS_TABLE,
                    Key: { providerId },
                }));
                if (provider) {
                    providerData = {
                        npi: provider.npi,
                        firstName: provider.firstName,
                        lastName: provider.lastName,
                        stateLicenseNumber: provider.stateLicenseNumber,
                        stateLicenseState: provider.stateLicenseState,
                    };
                }
            }

            const result = await runComprehensiveVerification(
                providerId || `temp-${uuidv4().slice(0, 8)}`,
                providerData,
                userPerms.email
            );

            return httpOk({ verification: result });
        }

        // GET /verify/logs?providerId=xxx
        if (method === 'GET' && path === '/verify/logs') {
            const providerId = event.queryStringParameters?.providerId;
            if (!providerId) {
                return httpErr(400, 'providerId query parameter is required');
            }

            const { Items } = await ddb.send(new QueryCommand({
                TableName: VERIFICATION_LOGS_TABLE,
                IndexName: 'byProvider',
                KeyConditionExpression: 'providerId = :providerId',
                ExpressionAttributeValues: { ':providerId': providerId },
                ScanIndexForward: false,
                Limit: 50,
            }));

            return httpOk({ logs: Items || [] });
        }

        return httpErr(404, 'Endpoint not found');
    } catch (error: any) {
        console.error('Verification error:', error);
        return httpErr(500, `Verification error: ${error.message}`);
    }
};
