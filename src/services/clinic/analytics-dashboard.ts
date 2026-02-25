/**
 * Analytics Dashboard Lambda
 * 
 * Comprehensive daily analytics endpoint that aggregates data from multiple sources:
 * - GA4 (Google Analytics 4) - Website traffic and behavior
 * - Google Ads - Campaign performance and conversions
 * - Microsoft Clarity - Session recordings and heatmaps
 * - Calls - Inbound, outbound, missed from Chime/Analytics
 * - Patient Portal - Appointment bookings and engagement
 * - AI Agents - Voice AI call handling metrics
 * - Open Dental Production - Revenue and appointment data
 * 
 * Endpoint:
 * - GET /analytics/dashboard - Get daily analytics for a clinic
 * - GET /analytics/dashboard/all - Get daily analytics for all clinics
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import https from 'https';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import { google } from 'googleapis';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    hasModulePermission,
    PermissionType,
    getAllowedClinicIds,
    hasClinicAccess,
} from '../../shared/utils/permissions-helper';
import {
    getGoogleAdsClient,
    microsToDollars,
} from '../../shared/utils/google-ads-client';

const dynamodb = new DynamoDBClient({});

// Environment variables
const CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME || '';
const AI_AGENTS_METRICS_TABLE = process.env.AI_AGENTS_METRICS_TABLE_NAME || '';
const PATIENT_PORTAL_METRICS_TABLE = process.env.PATIENT_PORTAL_METRICS_TABLE_NAME || '';
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE_NAME || '';
const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE_NAME || '';
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE_NAME || '';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// Module permission configuration
const MODULE_NAME = 'Operations';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read',
};

// ============================================
// DYNAMO DB HELPER FUNCTIONS
// ============================================

// Cache for clinic configs and secrets to avoid repeated DynamoDB calls
let cachedClinicConfigs: Map<string, any> | null = null;
let cachedClinicSecrets: Map<string, any> | null = null;
let cachedGlobalSecrets: Map<string, any> | null = null;

/**
 * Get all clinic configurations from DynamoDB
 */
async function getAllClinicConfigs(): Promise<Map<string, any>> {
    if (cachedClinicConfigs) {
        return cachedClinicConfigs;
    }

    if (!CLINIC_CONFIG_TABLE) {
        console.warn('[AnalyticsDashboard] CLINIC_CONFIG_TABLE not configured');
        return new Map();
    }

    try {
        const result = await dynamodb.send(new ScanCommand({
            TableName: CLINIC_CONFIG_TABLE,
        }));

        const configs = new Map<string, any>();
        (result.Items || []).forEach(item => {
            const clinic = unmarshall(item);
            configs.set(clinic.clinicId, clinic);
        });

        cachedClinicConfigs = configs;
        console.log(`[AnalyticsDashboard] Loaded ${configs.size} clinic configs from DynamoDB`);
        return configs;
    } catch (error) {
        console.error('[AnalyticsDashboard] Error loading clinic configs:', error);
        return new Map();
    }
}

/**
 * Get a single clinic configuration from DynamoDB
 */
async function getClinicConfig(clinicId: string): Promise<any | null> {
    const configs = await getAllClinicConfigs();
    return configs.get(clinicId) || null;
}

/**
 * Get clinic secrets from DynamoDB
 */
async function getClinicSecrets(clinicId: string): Promise<any | null> {
    if (!CLINIC_SECRETS_TABLE) {
        console.warn('[AnalyticsDashboard] CLINIC_SECRETS_TABLE not configured');
        return null;
    }

    // Check cache first
    if (cachedClinicSecrets?.has(clinicId)) {
        return cachedClinicSecrets.get(clinicId);
    }

    try {
        const result = await dynamodb.send(new GetItemCommand({
            TableName: CLINIC_SECRETS_TABLE,
            Key: {
                clinicId: { S: clinicId },
            },
        }));

        if (!result.Item) {
            return null;
        }

        const secrets = unmarshall(result.Item);

        // Cache the result
        if (!cachedClinicSecrets) {
            cachedClinicSecrets = new Map();
        }
        cachedClinicSecrets.set(clinicId, secrets);

        return secrets;
    } catch (error) {
        console.error(`[AnalyticsDashboard] Error loading secrets for clinic ${clinicId}:`, error);
        return null;
    }
}

/**
 * Get a global secret from DynamoDB
 */
async function getGlobalSecret(secretId: string, secretType: string): Promise<string | undefined> {
    if (!GLOBAL_SECRETS_TABLE) {
        console.warn('[AnalyticsDashboard] GLOBAL_SECRETS_TABLE not configured');
        return undefined;
    }

    // Check cache first
    const cacheKey = `${secretId}:${secretType}`;
    if (cachedGlobalSecrets?.has(cacheKey)) {
        return cachedGlobalSecrets.get(cacheKey);
    }

    try {
        const result = await dynamodb.send(new GetItemCommand({
            TableName: GLOBAL_SECRETS_TABLE,
            Key: {
                secretId: { S: secretId },
                secretType: { S: secretType },
            },
        }));

        if (!result.Item) {
            return undefined;
        }

        const secret = unmarshall(result.Item);
        const value = secret.value;

        // Cache the result
        if (!cachedGlobalSecrets) {
            cachedGlobalSecrets = new Map();
        }
        cachedGlobalSecrets.set(cacheKey, value);

        return value;
    } catch (error) {
        console.error(`[AnalyticsDashboard] Error loading global secret ${secretId}/${secretType}:`, error);
        return undefined;
    }
}

/**
 * Clear all caches (useful for fresh data on cold starts or explicit refresh)
 */
function clearCaches(): void {
    cachedClinicConfigs = null;
    cachedClinicSecrets = null;
    cachedGlobalSecrets = null;
}

// ============================================
// INTERFACES
// ============================================

interface GA4Data {
    sessions: number;
    totalUsers: number;
    newUsers: number;
    bounceRate: number;
    avgSessionDuration: number;
    pageViews: number;
    conversions: number;
    status: 'success' | 'error' | 'not_configured' | 'no_data';
    error?: string;
}

interface GoogleAdsData {
    clicks: number;
    impressions: number;
    cost: number;
    conversions: number;
    totalConversions: number;
    conversionBreakdown: {
        sms: number;
        phoneCalls: number;
        appointments: number;
        directions: number;
        maps: number;
        email: number;
    };
    ctr: number;
    avgCpc: number;
    costPerConversion: number;
    status: 'success' | 'error' | 'not_configured' | 'paused' | 'payment_issue';
    error?: string;
}

interface ClarityData {
    totalSessions: number;
    botSessions: number;
    nonBotSessions: number;
    uniqueUsers: number;
    pagesPerSession: number;
    avgScrollDepth: number;
    status: 'success' | 'error' | 'not_configured';
    error?: string;
}

interface CallsData {
    inbound: number;
    outbound: number;
    missed: number;
    answered: number;
    avgWaitTime: number;
    avgCallDuration: number;
    totalCalls: number;
    status: 'success' | 'error';
    error?: string;
}

interface PatientPortalData {
    appointmentsBooked: number;
    appointmentsUsed: number;
    appointmentsCancelled: number;
    appointmentsRescheduled: number;
    billPayments: number;
    status: 'success' | 'error';
    error?: string;
}

interface AIAgentsData {
    totalCalls: number;
    answeredCalls: number;
    appointmentsBooked: number;
    appointmentsUsed: number;
    appointmentsCancelled: number;
    appointmentsRescheduled: number;
    avgCallDuration: number;
    resolutionRate: number;
    transferredToHuman: number;
    status: 'success' | 'error';
    error?: string;
}

interface OpenDentalProductionData {
    grossProduction: number;
    netProduction: number;
    nextDayInsEstimate: number;
    adjustments: number;
    writeOffs: number;
    totalProcedures: number;
    morningGross: number;
    midDayGross: number;
    eveningGross: number;
    noApptGross: number;
    totalAppointments: number;
    completedAppointments: number;
    brokenAppointments: number;
    newPatients: number;
    status: 'success' | 'error' | 'not_configured' | 'no_data';
    error?: string;
}

interface ClinicDailyAnalytics {
    clinicId: string;
    clinicName: string;
    date: string;
    ga4: GA4Data;
    googleAds: GoogleAdsData;
    clarity: ClarityData;
    calls: CallsData;
    patientPortal: PatientPortalData;
    aiAgents: AIAgentsData;
    openDentalProduction: OpenDentalProductionData;
    fetchedAt: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;

    console.log(`[AnalyticsDashboard] ${method} ${path}`);

    // Handle OPTIONS for CORS
    if (method === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    // Permission check
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
    }

    const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
    if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ success: false, error: `Access denied: requires ${MODULE_NAME} module access` }) };
    }

    try {
        // Route: GET /analytics/dashboard/all - Get analytics for all clinics
        if (method === 'GET' && path.includes('/dashboard/all')) {
            return await getAllClinicsAnalytics(event, corsHeaders, userPerms);
        }

        // Route: GET /analytics/dashboard - Get analytics for a single clinic
        if (method === 'GET' && path.includes('/dashboard')) {
            return await getClinicAnalytics(event, corsHeaders, userPerms);
        }

        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Not found' }),
        };
    } catch (error: any) {
        console.error('[AnalyticsDashboard] Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: error.message || 'Internal server error',
            }),
        };
    }
}

// ============================================
// ROUTE HANDLERS
// ============================================

async function getClinicAnalytics(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>,
    userPerms: any
): Promise<APIGatewayProxyResult> {
    const clinicId = event.queryStringParameters?.clinicId;
    const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];

    if (!clinicId) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'clinicId is required' }),
        };
    }

    // Check clinic access
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (!hasClinicAccess(allowedClinics, clinicId)) {
        return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Access denied to this clinic' }),
        };
    }

    // Get clinic config from DynamoDB
    const clinicConfig = await getClinicConfig(clinicId);
    if (!clinicConfig) {
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Clinic not found' }),
        };
    }

    // Fetch all analytics data in parallel
    const analytics = await fetchClinicAnalytics(clinicId, clinicConfig, date);

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            data: analytics,
        }),
    };
}

async function getAllClinicsAnalytics(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>,
    userPerms: any
): Promise<APIGatewayProxyResult> {
    const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];

    // Get allowed clinics based on user permissions
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

    // Get all clinic configs from DynamoDB
    const allClinicConfigs = await getAllClinicConfigs();

    // Filter clinic configs to only allowed clinics
    const clinicsToFetch = Array.from(allClinicConfigs.values()).filter(c =>
        hasClinicAccess(allowedClinics, c.clinicId)
    );

    // Fetch analytics for ALL clinics with staggered starts to avoid API rate limiting
    // Per-clinic timeout (12s) protects against slow clinics blocking others
    // Stagger: 50ms between each clinic start = ~1.3s total spread for 27 clinics
    console.log(`[AnalyticsDashboard] Fetching analytics for ${clinicsToFetch.length} clinics with staggered parallel requests`);

    const STAGGER_DELAY_MS = 50; // 50ms between each clinic request start

    const results = await Promise.all(
        clinicsToFetch.map((clinic, index) =>
            new Promise<ClinicDailyAnalytics>(resolve => {
                // Stagger the start of each clinic's fetch
                setTimeout(async () => {
                    const result = await fetchClinicAnalytics(clinic.clinicId, clinic, date);
                    resolve(result);
                }, index * STAGGER_DELAY_MS);
            })
        )
    );

    // Calculate aggregated totals
    const totals = calculateTotals(results);

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            data: {
                date,
                clinics: results,
                totals,
                clinicCount: results.length,
                fetchedAt: new Date().toISOString(),
            },
        }),
    };
}

// ============================================
// DATA FETCHERS
// ============================================

async function fetchClinicAnalytics(
    clinicId: string,
    clinicConfig: any,
    date: string
): Promise<ClinicDailyAnalytics> {
    console.log(`[AnalyticsDashboard] Fetching analytics for ${clinicId} on ${date}`);

    // Fetch all data sources in parallel
    // Open Dental has a per-clinic timeout to prevent blocking
    const openDentalWithTimeout = Promise.race([
        fetchOpenDentalProduction(clinicId, date),
        new Promise<OpenDentalProductionData>((_, reject) =>
            setTimeout(() => reject(new Error('Open Dental timeout')), 50000) // 50s timeout per clinic
        )
    ]).catch((error): OpenDentalProductionData => {
        console.warn(`[OpenDental] Timeout/error for ${clinicId}: ${error.message}`);
        return {
            grossProduction: 0,
            netProduction: 0,
            nextDayInsEstimate: 0,
            adjustments: 0,
            writeOffs: 0,
            totalProcedures: 0,
            morningGross: 0,
            midDayGross: 0,
            eveningGross: 0,
            noApptGross: 0,
            totalAppointments: 0,
            completedAppointments: 0,
            brokenAppointments: 0,
            newPatients: 0,
            status: 'error',
            error: error.message,
        };
    });

    const [ga4, googleAds, clarity, calls, patientPortal, aiAgents, openDental] = await Promise.all([
        fetchGA4Data(clinicConfig.ga4PropertyId, date),
        fetchGoogleAdsData(clinicConfig.googleAds?.customerId, date),
        fetchClarityData(clinicId, clinicConfig.microsoftClarityProjectId, date),
        fetchCallsData(clinicId, date),
        fetchPatientPortalData(clinicId, date),
        fetchAIAgentsData(clinicId, date),
        openDentalWithTimeout,
    ]);

    return {
        clinicId,
        clinicName: clinicConfig.clinicName || clinicId,
        date,
        ga4,
        googleAds,
        clarity,
        calls,
        patientPortal,
        aiAgents,
        openDentalProduction: openDental,
        fetchedAt: new Date().toISOString(),
    };
}

// ============================================
// GA4 DATA FETCHER
// ============================================

// Cache for GA4 auth client to avoid repeated initialization
let cachedGA4AuthClient: any = null;

/**
 * Get or create authenticated GA4 client using service account
 */
async function getGA4AuthClient(): Promise<any> {
    if (cachedGA4AuthClient) {
        return cachedGA4AuthClient;
    }

    // Get GA4 credentials from global secrets DynamoDB table
    const serviceAccountEmail = await getGlobalSecret('ga4', 'service_account_email');
    const privateKey = await getGlobalSecret('ga4', 'private_key');

    if (!serviceAccountEmail || !privateKey) {
        throw new Error('GA4 service account credentials not configured in GlobalSecrets table');
    }

    // Create JWT auth client with service account credentials
    const auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: privateKey.replace(/\\n/g, '\n'), // Ensure newlines are properly formatted
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });

    cachedGA4AuthClient = auth;
    return auth;
}

async function fetchGA4Data(propertyId: string | undefined, date: string): Promise<GA4Data> {
    if (!propertyId) {
        return {
            sessions: 0,
            totalUsers: 0,
            newUsers: 0,
            bounceRate: 0,
            avgSessionDuration: 0,
            pageViews: 0,
            conversions: 0,
            status: 'not_configured',
        };
    }

    try {
        // Get authenticated client
        const auth = await getGA4AuthClient();

        // Initialize the Analytics Data API client
        const analyticsData = google.analyticsdata({
            version: 'v1beta',
            auth,
        });

        console.log(`[GA4] Fetching data for property ${propertyId} on ${date}`);

        // Run the report - matching Python reference metrics
        const response = await analyticsData.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
                dateRanges: [
                    {
                        startDate: date,
                        endDate: date,
                    },
                ],
                metrics: [
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                    { name: 'newUsers' },
                    { name: 'bounceRate' },
                    { name: 'averageSessionDuration' },
                    { name: 'screenPageViews' },
                    { name: 'conversions' },
                ],
            },
        });

        // Parse the response
        const rows = response.data.rows || [];
        if (rows.length === 0) {
            console.log(`[GA4] No data returned for property ${propertyId} on ${date}`);
            return {
                sessions: 0,
                totalUsers: 0,
                newUsers: 0,
                bounceRate: 0,
                avgSessionDuration: 0,
                pageViews: 0,
                conversions: 0,
                status: 'no_data',
            };
        }

        const metricValues = rows[0].metricValues || [];

        // Extract metrics (order matches the request)
        const sessions = parseInt(metricValues[0]?.value || '0', 10);
        const totalUsers = parseInt(metricValues[1]?.value || '0', 10);
        const newUsers = parseInt(metricValues[2]?.value || '0', 10);
        const bounceRate = parseFloat(metricValues[3]?.value || '0') * 100; // Convert to percentage
        const avgSessionDuration = parseFloat(metricValues[4]?.value || '0');
        const pageViews = parseInt(metricValues[5]?.value || '0', 10);
        const conversions = parseFloat(metricValues[6]?.value || '0');

        console.log(`[GA4] Successfully fetched data for ${propertyId}: ${sessions} sessions, ${conversions} conversions`);

        return {
            sessions,
            totalUsers,
            newUsers,
            bounceRate: Math.round(bounceRate * 100) / 100, // Round to 2 decimal places
            avgSessionDuration: Math.round(avgSessionDuration * 100) / 100,
            pageViews,
            conversions: Math.round(conversions * 100) / 100,
            status: 'success',
        };
    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`[GA4] Error fetching data for property ${propertyId}:`, errorMessage);

        // Clear cached auth on authentication errors to allow retry with fresh credentials
        if (errorMessage.includes('invalid_grant') || errorMessage.includes('Invalid JWT')) {
            cachedGA4AuthClient = null;
        }

        // Provide specific error messages for common issues
        let status: GA4Data['status'] = 'error';
        let errorDetail = errorMessage;

        if (errorMessage.includes('invalid_grant') || errorMessage.includes('Invalid JWT')) {
            errorDetail = 'GA4 service account private key is invalid or does not match. Please update the private_key in GlobalSecrets.';
        } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
            errorDetail = 'Service account missing permission on GA4 property. Grant Viewer access in GA4 Admin.';
        } else if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
            errorDetail = 'Invalid GA4 property ID';
        }

        return {
            sessions: 0,
            totalUsers: 0,
            newUsers: 0,
            bounceRate: 0,
            avgSessionDuration: 0,
            pageViews: 0,
            conversions: 0,
            status,
            error: errorDetail,
        };
    }
}

// ============================================
// GOOGLE ADS DATA FETCHER
// ============================================

async function fetchGoogleAdsData(customerId: string | undefined, date: string): Promise<GoogleAdsData> {
    if (!customerId) {
        return {
            clicks: 0,
            impressions: 0,
            cost: 0,
            conversions: 0,
            totalConversions: 0,
            conversionBreakdown: { sms: 0, phoneCalls: 0, appointments: 0, directions: 0, maps: 0, email: 0 },
            ctr: 0,
            avgCpc: 0,
            costPerConversion: 0,
            status: 'not_configured',
        };
    }

    try {
        const client = await getGoogleAdsClient(customerId);

        // General metrics query
        const metricsQuery = `
      SELECT
        customer.id,
        customer.descriptive_name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions
      FROM customer
      WHERE segments.date = '${date}'
    `;

        // Conversion breakdown query
        const conversionQuery = `
      SELECT
        segments.conversion_action_name,
        metrics.conversions
      FROM customer
      WHERE segments.date = '${date}'
    `;

        const [metricsResults, conversionResults] = await Promise.all([
            client.query(metricsQuery).catch(() => []),
            client.query(conversionQuery).catch(() => []),
        ]);

        // Parse metrics
        let clicks = 0, impressions = 0, cost = 0, totalConversions = 0;

        (metricsResults as any[]).forEach((row: any) => {
            clicks += row.metrics?.clicks || 0;
            impressions += row.metrics?.impressions || 0;
            cost += microsToDollars(row.metrics?.cost_micros || 0);
            totalConversions += row.metrics?.conversions || 0;
        });

        // Parse conversion breakdown
        const breakdown = { sms: 0, phoneCalls: 0, appointments: 0, directions: 0, maps: 0, email: 0 };

        (conversionResults as any[]).forEach((row: any) => {
            const name = (row.segments?.conversion_action_name || '').toLowerCase();
            const count = row.metrics?.conversions || 0;

            if (name.includes('a_sms') || name.includes('sms')) breakdown.sms += count;
            else if (name.includes('phone') || name.includes('calls')) breakdown.phoneCalls += count;
            else if (name.includes('schedule') || name.includes('appointment')) breakdown.appointments += count;
            else if (name.includes('direction')) breakdown.directions += count;
            else if (name.includes('map')) breakdown.maps += count;
            else if (name.includes('email') || name.includes('mail')) breakdown.email += count;
        });

        // Determine status
        let status: GoogleAdsData['status'] = 'success';
        if (cost === 0 && clicks === 0 && impressions === 0) {
            status = 'payment_issue';
        } else if (cost === 0) {
            status = 'paused';
        }

        return {
            clicks,
            impressions,
            cost,
            conversions: totalConversions,
            totalConversions,
            conversionBreakdown: breakdown,
            ctr: impressions > 0 ? (clicks / impressions * 100) : 0,
            avgCpc: clicks > 0 ? (cost / clicks) : 0,
            costPerConversion: totalConversions > 0 ? (cost / totalConversions) : 0,
            status,
        };
    } catch (error: any) {
        console.error(`[GoogleAds] Error fetching data for customer ${customerId}:`, error);
        return {
            clicks: 0,
            impressions: 0,
            cost: 0,
            conversions: 0,
            totalConversions: 0,
            conversionBreakdown: { sms: 0, phoneCalls: 0, appointments: 0, directions: 0, maps: 0, email: 0 },
            ctr: 0,
            avgCpc: 0,
            costPerConversion: 0,
            status: 'error',
            error: error.message,
        };
    }
}

// ============================================
// MICROSOFT CLARITY DATA FETCHER
// ============================================

async function fetchClarityData(clinicId: string, projectId: string | undefined, date: string): Promise<ClarityData> {
    if (!projectId) {
        return {
            totalSessions: 0,
            botSessions: 0,
            nonBotSessions: 0,
            uniqueUsers: 0,
            pagesPerSession: 0,
            avgScrollDepth: 0,
            status: 'not_configured',
        };
    }

    try {
        // Get Clarity API token from clinic secrets DynamoDB table
        const clinicSecrets = await getClinicSecrets(clinicId);
        const apiToken = clinicSecrets?.microsoftClarityApiToken;

        if (!apiToken) {
            console.log(`[Clarity] No API token found for clinic ${clinicId}`);
            return {
                totalSessions: 0,
                botSessions: 0,
                nonBotSessions: 0,
                uniqueUsers: 0,
                pagesPerSession: 0,
                avgScrollDepth: 0,
                status: 'error',
                error: 'No Clarity API token configured',
            };
        }

        // Microsoft Clarity Live Insights API
        const startDateTime = `${date}T00:00:00`;
        const endDateTime = `${date}T23:59:59`;

        const url = `https://www.clarity.ms/export-data/api/v1/project-live-insights?startDate=${encodeURIComponent(startDateTime)}&endDate=${encodeURIComponent(endDateTime)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Clarity API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Parse Traffic metrics (same logic as Python reference)
        let totalSessions = 0, botSessions = 0, uniqueUsers = 0, avgPages = 0;
        const trafficMetric = (data as any[]).find((m: any) => m.metricName === 'Traffic');
        if (trafficMetric?.information) {
            const info = trafficMetric.information;
            totalSessions = info.reduce((sum: number, i: any) => sum + (parseFloat(i.totalSessionCount) || 0), 0);
            botSessions = info.reduce((sum: number, i: any) => sum + (parseFloat(i.totalBotSessionCount) || 0), 0);
            uniqueUsers = info.reduce((sum: number, i: any) => sum + (parseFloat(i.distinctUserCount) || 0), 0);
            const pagesValues = info.filter((i: any) => i.pagesPerSessionPercentage != null).map((i: any) => parseFloat(i.pagesPerSessionPercentage));
            if (pagesValues.length > 0) {
                avgPages = pagesValues.reduce((a: number, b: number) => a + b, 0) / pagesValues.length;
            }
        }
        const nonBotSessions = totalSessions - botSessions;

        // Parse ScrollDepth metrics
        let avgScrollDepth = 0;
        const scrollMetric = (data as any[]).find((m: any) => m.metricName === 'ScrollDepth');
        if (scrollMetric?.information) {
            const scrollValues = scrollMetric.information
                .filter((i: any) => i.averageScrollDepth != null)
                .map((i: any) => parseFloat(i.averageScrollDepth));
            if (scrollValues.length > 0) {
                avgScrollDepth = scrollValues.reduce((a: number, b: number) => a + b, 0) / scrollValues.length;
            }
        }

        console.log(`[Clarity] Fetched data for ${clinicId}: ${totalSessions} sessions, ${uniqueUsers} users`);

        return {
            totalSessions: Math.round(totalSessions),
            botSessions: Math.round(botSessions),
            nonBotSessions: Math.round(nonBotSessions),
            uniqueUsers: Math.round(uniqueUsers),
            pagesPerSession: Math.round(avgPages * 100) / 100,
            avgScrollDepth: Math.round(avgScrollDepth * 100) / 100,
            status: 'success',
        };
    } catch (error: any) {
        console.error(`[Clarity] Error fetching data for project ${projectId}:`, error);
        return {
            totalSessions: 0,
            botSessions: 0,
            nonBotSessions: 0,
            uniqueUsers: 0,
            pagesPerSession: 0,
            avgScrollDepth: 0,
            status: 'error',
            error: error.message,
        };
    }
}

// ============================================
// CALLS DATA FETCHER
// ============================================

async function fetchCallsData(clinicId: string, date: string): Promise<CallsData> {
    if (!CALL_ANALYTICS_TABLE) {
        return {
            inbound: 0,
            outbound: 0,
            missed: 0,
            answered: 0,
            avgWaitTime: 0,
            avgCallDuration: 0,
            totalCalls: 0,
            status: 'error',
            error: 'Call analytics table not configured',
        };
    }

    try {
        // Query call analytics for the date range
        const startOfDay = new Date(`${date}T00:00:00Z`).getTime();
        const endOfDay = new Date(`${date}T23:59:59Z`).getTime();

        const result = await dynamodb.send(new QueryCommand({
            TableName: CALL_ANALYTICS_TABLE,
            IndexName: 'clinicId-timestamp-index',
            KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            ExpressionAttributeValues: {
                ':clinicId': { S: clinicId },
                ':start': { N: startOfDay.toString() },
                ':end': { N: endOfDay.toString() },
            },
        }));

        const calls = (result.Items || []).map(item => unmarshall(item));

        let inbound = 0, outbound = 0, missed = 0, answered = 0;
        let totalWaitTime = 0, totalDuration = 0, answeredCount = 0;

        calls.forEach(call => {
            // Count by direction
            if (call.callDirection === 'inbound') inbound++;
            else if (call.callDirection === 'outbound') outbound++;

            // Count by outcome
            if (call.callStatus === 'missed' || call.callStatus === 'abandoned') missed++;
            else if (call.callStatus === 'completed' || call.callStatus === 'answered') {
                answered++;
                answeredCount++;
                totalWaitTime += call.waitTime || 0;
                totalDuration += call.duration || 0;
            }
        });

        return {
            inbound,
            outbound,
            missed,
            answered,
            avgWaitTime: answeredCount > 0 ? totalWaitTime / answeredCount : 0,
            avgCallDuration: answeredCount > 0 ? totalDuration / answeredCount : 0,
            totalCalls: calls.length,
            status: 'success',
        };
    } catch (error: any) {
        console.error(`[Calls] Error fetching data for clinic ${clinicId}:`, error);
        return {
            inbound: 0,
            outbound: 0,
            missed: 0,
            answered: 0,
            avgWaitTime: 0,
            avgCallDuration: 0,
            totalCalls: 0,
            status: 'error',
            error: error.message,
        };
    }
}

// ============================================
// PATIENT PORTAL DATA FETCHER
// ============================================

async function fetchPatientPortalData(clinicId: string, date: string): Promise<PatientPortalData> {
    if (!PATIENT_PORTAL_METRICS_TABLE) {
        return {
            appointmentsBooked: 0,
            appointmentsUsed: 0,
            appointmentsCancelled: 0,
            appointmentsRescheduled: 0,
            billPayments: 0,
            status: 'error',
            error: 'Patient portal metrics table not configured',
        };
    }

    try {
        // Query patient portal metrics table
        // Schema: clinicId (PK), metricDate (SK)
        const result = await dynamodb.send(new GetItemCommand({
            TableName: PATIENT_PORTAL_METRICS_TABLE,
            Key: {
                clinicId: { S: clinicId },
                metricDate: { S: date },
            },
        }));

        if (!result.Item) {
            return {
                appointmentsBooked: 0,
                appointmentsUsed: 0,
                appointmentsCancelled: 0,
                appointmentsRescheduled: 0,
                billPayments: 0,
                status: 'success',
            };
        }

        const metrics = unmarshall(result.Item);

        return {
            appointmentsBooked: metrics.appointmentsBooked || 0,
            appointmentsUsed: metrics.appointmentsUsed || 0,
            appointmentsCancelled: metrics.appointmentsCancelled || 0,
            appointmentsRescheduled: metrics.appointmentsRescheduled || 0,
            billPayments: metrics.paymentsSucceeded || 0,
            status: 'success',
        };
    } catch (error: any) {
        console.error(`[PatientPortal] Error fetching data for clinic ${clinicId}:`, error);
        return {
            appointmentsBooked: 0,
            appointmentsUsed: 0,
            appointmentsCancelled: 0,
            appointmentsRescheduled: 0,
            billPayments: 0,
            status: 'error',
            error: error.message,
        };
    }
}

// ============================================
// AI AGENTS DATA FETCHER
// ============================================

async function fetchAIAgentsData(clinicId: string, date: string): Promise<AIAgentsData> {
    if (!AI_AGENTS_METRICS_TABLE) {
        return {
            totalCalls: 0,
            answeredCalls: 0,
            appointmentsBooked: 0,
            appointmentsUsed: 0,
            appointmentsCancelled: 0,
            appointmentsRescheduled: 0,
            avgCallDuration: 0,
            resolutionRate: 0,
            transferredToHuman: 0,
            status: 'error',
            error: 'AI agents metrics table not configured',
        };
    }

    try {
        // Query AI agents metrics table
        // Schema: clinicId (PK), metricDate (SK)
        const result = await dynamodb.send(new GetItemCommand({
            TableName: AI_AGENTS_METRICS_TABLE,
            Key: {
                clinicId: { S: clinicId },
                metricDate: { S: date },
            },
        }));

        if (!result.Item) {
            return {
                totalCalls: 0,
                answeredCalls: 0,
                appointmentsBooked: 0,
                appointmentsUsed: 0,
                appointmentsCancelled: 0,
                appointmentsRescheduled: 0,
                avgCallDuration: 0,
                resolutionRate: 0,
                transferredToHuman: 0,
                status: 'success',
            };
        }

        const metrics = unmarshall(result.Item);

        return {
            totalCalls: metrics.totalCalls || 0,
            answeredCalls: metrics.answeredCalls || 0,
            appointmentsBooked: metrics.appointmentsBooked || 0,
            appointmentsUsed: metrics.appointmentsUsed || 0,
            appointmentsCancelled: metrics.appointmentsCancelled || 0,
            appointmentsRescheduled: metrics.appointmentsRescheduled || 0,
            avgCallDuration: metrics.avgCallDuration || 0,
            resolutionRate: metrics.resolutionRate || 0,
            transferredToHuman: metrics.transferredToHuman || 0,
            status: 'success',
        };
    } catch (error: any) {
        console.error(`[AIAgents] Error fetching data for clinic ${clinicId}:`, error);
        return {
            totalCalls: 0,
            answeredCalls: 0,
            appointmentsBooked: 0,
            appointmentsUsed: 0,
            appointmentsCancelled: 0,
            appointmentsRescheduled: 0,
            avgCallDuration: 0,
            resolutionRate: 0,
            transferredToHuman: 0,
            status: 'error',
            error: error.message,
        };
    }
}

// ============================================
// OPEN DENTAL PRODUCTION DATA FETCHER
// ============================================

async function fetchOpenDentalProduction(clinicId: string, date: string): Promise<OpenDentalProductionData> {
    try {
        // Get clinic secrets for Open Dental API credentials
        const clinicSecrets = await getClinicSecrets(clinicId);

        if (!clinicSecrets?.openDentalDeveloperKey || !clinicSecrets?.openDentalCustomerKey) {
            console.log(`[OpenDental] No API credentials configured for clinic ${clinicId}`);
            return {
                grossProduction: 0,
                netProduction: 0,
                nextDayInsEstimate: 0,
                adjustments: 0,
                writeOffs: 0,
                totalProcedures: 0,
                morningGross: 0,
                midDayGross: 0,
                eveningGross: 0,
                noApptGross: 0,
                totalAppointments: 0,
                completedAppointments: 0,
                brokenAppointments: 0,
                newPatients: 0,
                status: 'not_configured',
            };
        }

        // Generate the daily report SQL query
        const sqlCommand = generateDailyReportQuery(date);

        console.log(`[OpenDental] Executing daily report query for clinic ${clinicId} on ${date}`);

        // Execute the query via Open Dental API with SFTP result delivery
        const result = await executeOpenDentalQuery(
            clinicSecrets.openDentalDeveloperKey,
            clinicSecrets.openDentalCustomerKey,
            sqlCommand,
            clinicId
        );

        // Parse the result - we expect up to 2 rows (Today and Yesterday)
        // Find the "Today" row
        const todayRow = result.find((row: any) => row.Period === 'Today') || result[0];

        if (!todayRow) {
            console.log(`[OpenDental] No data returned for clinic ${clinicId} on ${date}`);
            return {
                grossProduction: 0,
                netProduction: 0,
                nextDayInsEstimate: 0,
                adjustments: 0,
                writeOffs: 0,
                totalProcedures: 0,
                morningGross: 0,
                midDayGross: 0,
                eveningGross: 0,
                noApptGross: 0,
                totalAppointments: 0,
                completedAppointments: 0,
                brokenAppointments: 0,
                newPatients: 0,
                status: 'no_data',
            };
        }

        console.log(`[OpenDental] Successfully fetched production data for clinic ${clinicId}`);

        return {
            grossProduction: parseFloat(todayRow.Total_Gross || '0'),
            netProduction: parseFloat(todayRow.Net_Production || '0'),
            nextDayInsEstimate: parseFloat(todayRow.Next_Day_Ins_Estimate || '0'),
            adjustments: parseFloat(todayRow.Adjustments || '0'),
            writeOffs: parseFloat(todayRow.WriteOffs || '0'),
            totalProcedures: parseInt(todayRow.Total_Procedures || '0', 10),
            morningGross: parseFloat(todayRow.Morning_Gross || '0'),
            midDayGross: parseFloat(todayRow.MidDay_Gross || '0'),
            eveningGross: parseFloat(todayRow.Evening_Gross || '0'),
            noApptGross: parseFloat(todayRow.No_Appt_Gross || '0'),
            totalAppointments: parseInt(todayRow.Total_Appts || '0', 10),
            completedAppointments: parseInt(todayRow.Total_Complete_2 || '0', 10),
            brokenAppointments: parseInt(todayRow.Total_Broken_5 || '0', 10),
            newPatients: parseInt(todayRow.Total_New_Patients || '0', 10),
            status: 'success',
        };
    } catch (error: any) {
        console.error(`[OpenDental] Error fetching data for clinic ${clinicId}:`, error);
        return {
            grossProduction: 0,
            netProduction: 0,
            nextDayInsEstimate: 0,
            adjustments: 0,
            writeOffs: 0,
            totalProcedures: 0,
            morningGross: 0,
            midDayGross: 0,
            eveningGross: 0,
            noApptGross: 0,
            totalAppointments: 0,
            completedAppointments: 0,
            brokenAppointments: 0,
            newPatients: 0,
            status: 'error',
            error: error.message,
        };
    }
}

/**
 * Generate the SQL query for daily production report
 */
function generateDailyReportQuery(selectedDate: string): string {
    return `SELECT 
    CASE 
        WHEN d.report_date = '${selectedDate}' THEN 'Today'
        WHEN d.report_date = DATE_SUB('${selectedDate}', INTERVAL 1 DAY) THEN 'Yesterday'
    END AS Period,
    d.report_date AS Date,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        LEFT JOIN appointment a ON pl.AptNum = a.AptNum
        WHERE pl.ProcStatus = 2 
          AND pl.ProcDate = d.report_date
          AND TIME(a.AptDateTime) BETWEEN '08:00:00' AND '11:59:59'), 2), 0) AS Morning_Gross,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        LEFT JOIN appointment a ON pl.AptNum = a.AptNum
        WHERE pl.ProcStatus = 2 
          AND pl.ProcDate = d.report_date
          AND TIME(a.AptDateTime) BETWEEN '12:00:00' AND '14:59:59'), 2), 0) AS MidDay_Gross,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        LEFT JOIN appointment a ON pl.AptNum = a.AptNum
        WHERE pl.ProcStatus = 2 
          AND pl.ProcDate = d.report_date
          AND TIME(a.AptDateTime) BETWEEN '15:00:00' AND '17:59:59'), 2), 0) AS Evening_Gross,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        WHERE pl.ProcStatus = 2 
          AND pl.ProcDate = d.report_date
          AND (pl.AptNum = 0 OR pl.AptNum IS NULL)), 2), 0) AS No_Appt_Gross,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        WHERE pl.ProcStatus = 2 AND pl.ProcDate = d.report_date), 2), 0) AS Total_Gross,
    
    COALESCE(ROUND((SELECT SUM(AdjAmt) 
        FROM adjustment 
        WHERE AdjDate = d.report_date), 2), 0) AS Adjustments,
    
    COALESCE(ROUND((SELECT SUM(WriteOff) 
        FROM claimproc 
        WHERE Status IN (0,1,4,7) AND ProcDate = d.report_date), 2), 0) AS WriteOffs,
    
    COALESCE(ROUND((SELECT SUM(pl.ProcFee * pl.UnitQty) 
        FROM procedurelog pl 
        WHERE pl.ProcStatus = 2 AND pl.ProcDate = d.report_date), 2), 0) +
    COALESCE((SELECT SUM(AdjAmt) 
        FROM adjustment 
        WHERE AdjDate = d.report_date), 0) -
    COALESCE((SELECT SUM(WriteOff) 
        FROM claimproc 
        WHERE Status IN (0,1,4,7) AND ProcDate = d.report_date), 0) AS Net_Production,
    
    COALESCE((SELECT COUNT(pl.ProcNum) 
        FROM procedurelog pl 
        WHERE pl.ProcStatus = 2 AND pl.ProcDate = d.report_date), 0) AS Total_Procedures,
    
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59'), 0) AS Morning_Total_Appts,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 1), 0) AS Morning_Scheduled_1,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 2), 0) AS Morning_Complete_2,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 3), 0) AS Morning_UnschedList_3,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 4), 0) AS Morning_ASAP_4,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 5), 0) AS Morning_Broken_5,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 6), 0) AS Morning_Planned_6,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '08:00:00' AND '11:59:59' AND AptStatus = 2 AND IsNewPatient = 1), 0) AS Morning_New_Patients,
    
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59'), 0) AS MidDay_Total_Appts,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 1), 0) AS MidDay_Scheduled_1,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 2), 0) AS MidDay_Complete_2,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 3), 0) AS MidDay_UnschedList_3,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 4), 0) AS MidDay_ASAP_4,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 5), 0) AS MidDay_Broken_5,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 6), 0) AS MidDay_Planned_6,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '12:00:00' AND '14:59:59' AND AptStatus = 2 AND IsNewPatient = 1), 0) AS MidDay_New_Patients,
    
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59'), 0) AS Evening_Total_Appts,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 1), 0) AS Evening_Scheduled_1,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 2), 0) AS Evening_Complete_2,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 3), 0) AS Evening_UnschedList_3,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 4), 0) AS Evening_ASAP_4,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 5), 0) AS Evening_Broken_5,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 6), 0) AS Evening_Planned_6,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND TIME(AptDateTime) BETWEEN '15:00:00' AND '17:59:59' AND AptStatus = 2 AND IsNewPatient = 1), 0) AS Evening_New_Patients,
    
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date), 0) AS Total_Appts,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 1), 0) AS Total_Scheduled_1,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 2), 0) AS Total_Complete_2,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 3), 0) AS Total_UnschedList_3,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 4), 0) AS Total_ASAP_4,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 5), 0) AS Total_Broken_5,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 6), 0) AS Total_Planned_6,
    COALESCE((SELECT COUNT(*) FROM appointment WHERE DATE(AptDateTime) = d.report_date AND AptStatus = 2 AND IsNewPatient = 1), 0) AS Total_New_Patients,

    COALESCE(ROUND((SELECT SUM(cp.InsEstTotal)
        FROM claimproc cp
        INNER JOIN procedurelog pl ON cp.ProcNum = pl.ProcNum
        INNER JOIN appointment a ON pl.AptNum = a.AptNum
        WHERE a.AptStatus = 1
          AND DATE(a.AptDateTime) = DATE_ADD(d.report_date, INTERVAL 1 DAY)
          AND cp.Status = 6
    ), 2), 0) AS Next_Day_Ins_Estimate

FROM (
    SELECT '${selectedDate}' AS report_date
    UNION ALL
    SELECT DATE_SUB('${selectedDate}', INTERVAL 1 DAY) AS report_date
) d

ORDER BY d.report_date DESC`;
}

/**
 * Download CSV from SFTP server
 */
async function downloadCsvFromSftp(opts: {
    host: string;
    port: number;
    username: string;
    password: string;
    filename: string;
}): Promise<string> {
    const { host, port, username, password, filename } = opts;
    const conn = new SSH2Client();

    return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
            conn.end();
            reject(new Error('SFTP connection timeout'));
        }, 15000); // Reduced timeout for faster failure detection

        conn
            .on('ready', () => {
                conn.sftp((err: any, sftp: any) => {
                    if (err) {
                        clearTimeout(timeout);
                        conn.end();
                        reject(err);
                        return;
                    }

                    // File is already ready since we use IsAsync: 'false' - read immediately
                    const filePath = `./${filename}`;
                    const readStream = sftp.createReadStream(filePath);
                    let csvContent = '';

                    readStream.on('data', (chunk: any) => { csvContent += chunk.toString(); });
                    readStream.on('end', () => {
                        clearTimeout(timeout);
                        conn.end();
                        resolve(csvContent);
                    });
                    readStream.on('error', (e: any) => {
                        clearTimeout(timeout);
                        conn.end();
                        reject(e);
                    });
                });
            })
            .on('error', (e: any) => {
                clearTimeout(timeout);
                reject(e);
            })
            .connect({ host, port, username, password, readyTimeout: 10000 }); // Reduced from 15s
    });
}

/**
 * Execute an SQL query via Open Dental API with SFTP result delivery
 * Open Dental API /queries endpoint writes results to an SFTP server - it does NOT return data directly
 */
async function executeOpenDentalQuery(
    developerKey: string,
    customerKey: string,
    sqlCommand: string,
    clinicId: string
): Promise<any[]> {
    const API_HOST = 'api.opendental.com';
    const API_PATH = '/api/v1/queries';

    // Get SFTP password from GlobalSecrets
    const sftpPassword = await getGlobalSecret('consolidated_sftp', 'password');
    if (!sftpPassword) {
        throw new Error('SFTP password not configured in GlobalSecrets');
    }

    if (!CONSOLIDATED_SFTP_HOST) {
        throw new Error('CONSOLIDATED_SFTP_HOST environment variable not configured');
    }

    // Generate unique filename for the query results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueId = Math.random().toString(36).substring(2, 10);
    const csvFilename = `analytics_${clinicId}_${timestamp}_${uniqueId}.csv`;

    // Build SFTP address - Open Dental expects format: hostname/filename
    const sftpAddress = `${CONSOLIDATED_SFTP_HOST}/${csvFilename}`;

    console.log(`[OpenDental] Executing query for ${clinicId}, results to: ${csvFilename}`);

    const requestBody = JSON.stringify({
        SqlCommand: sqlCommand,
        SftpAddress: sftpAddress,
        SftpUsername: 'sftpuser',
        SftpPassword: sftpPassword,
        SftpPort: 22,
        IsAsync: 'false',
    });

    const options = {
        hostname: API_HOST,
        path: API_PATH,
        method: 'POST',
        headers: {
            'Authorization': `ODFHIR ${developerKey}/${customerKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody).toString(),
        },
    };

    // Submit query to Open Dental API
    const apiResponse = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode || 500, body: data });
            });
        });

        req.on('error', (err) => {
            console.error('[OpenDental] Request error:', err);
            reject(new Error(`Open Dental request failed: ${err.message}`));
        });

        req.write(requestBody);
        req.end();
    });

    if (apiResponse.statusCode !== 201) {
        console.error(`[OpenDental] API returned status ${apiResponse.statusCode}: ${apiResponse.body.substring(0, 500)}`);
        throw new Error(`Open Dental API error: ${apiResponse.statusCode} - ${apiResponse.body.substring(0, 200)}`);
    }

    console.log(`[OpenDental] Query submitted successfully, downloading results from SFTP`);

    // Download CSV from SFTP
    try {
        const csvData = await downloadCsvFromSftp({
            host: CONSOLIDATED_SFTP_HOST,
            port: 22,
            username: 'sftpuser',
            password: sftpPassword,
            filename: csvFilename,
        });

        // Handle empty or "OK" response (no data)
        if (csvData.trim() === 'OK' || csvData.trim() === '') {
            console.log(`[OpenDental] Query returned no data for ${clinicId}`);
            return [];
        }

        // Parse CSV to JSON
        const records = parseCsv(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true,
        });

        console.log(`[OpenDental] Parsed ${records.length} records from CSV`);
        return Array.isArray(records) ? records : [];
    } catch (sftpError: any) {
        console.error(`[OpenDental] Failed to download/parse CSV: ${sftpError.message}`);
        throw new Error(`Failed to retrieve Open Dental results: ${sftpError.message}`);
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateTotals(clinics: ClinicDailyAnalytics[]): any {
    return {
        ga4: {
            sessions: clinics.reduce((sum, c) => sum + c.ga4.sessions, 0),
            totalUsers: clinics.reduce((sum, c) => sum + c.ga4.totalUsers, 0),
            pageViews: clinics.reduce((sum, c) => sum + c.ga4.pageViews, 0),
            conversions: clinics.reduce((sum, c) => sum + c.ga4.conversions, 0),
        },
        googleAds: {
            clicks: clinics.reduce((sum, c) => sum + c.googleAds.clicks, 0),
            impressions: clinics.reduce((sum, c) => sum + c.googleAds.impressions, 0),
            cost: clinics.reduce((sum, c) => sum + c.googleAds.cost, 0),
            conversions: clinics.reduce((sum, c) => sum + c.googleAds.conversions, 0),
        },
        clarity: {
            totalSessions: clinics.reduce((sum, c) => sum + c.clarity.totalSessions, 0),
            uniqueUsers: clinics.reduce((sum, c) => sum + c.clarity.uniqueUsers, 0),
        },
        calls: {
            inbound: clinics.reduce((sum, c) => sum + c.calls.inbound, 0),
            outbound: clinics.reduce((sum, c) => sum + c.calls.outbound, 0),
            missed: clinics.reduce((sum, c) => sum + c.calls.missed, 0),
            answered: clinics.reduce((sum, c) => sum + c.calls.answered, 0),
            totalCalls: clinics.reduce((sum, c) => sum + c.calls.totalCalls, 0),
        },
        patientPortal: {
            appointmentsBooked: clinics.reduce((sum, c) => sum + c.patientPortal.appointmentsBooked, 0),
            appointmentsUsed: clinics.reduce((sum, c) => sum + c.patientPortal.appointmentsUsed, 0),
            billPayments: clinics.reduce((sum, c) => sum + c.patientPortal.billPayments, 0),
        },
        aiAgents: {
            totalCalls: clinics.reduce((sum, c) => sum + c.aiAgents.totalCalls, 0),
            appointmentsBooked: clinics.reduce((sum, c) => sum + c.aiAgents.appointmentsBooked, 0),
            transferredToHuman: clinics.reduce((sum, c) => sum + c.aiAgents.transferredToHuman, 0),
        },
        openDentalProduction: {
            grossProduction: clinics.reduce((sum, c) => sum + c.openDentalProduction.grossProduction, 0),
            netProduction: clinics.reduce((sum, c) => sum + c.openDentalProduction.netProduction, 0),
            nextDayInsEstimate: clinics.reduce((sum, c) => sum + c.openDentalProduction.nextDayInsEstimate, 0),
            totalProcedures: clinics.reduce((sum, c) => sum + c.openDentalProduction.totalProcedures, 0),
            totalAppointments: clinics.reduce((sum, c) => sum + c.openDentalProduction.totalAppointments, 0),
            newPatients: clinics.reduce((sum, c) => sum + c.openDentalProduction.newPatients, 0),
        },
    };
}
