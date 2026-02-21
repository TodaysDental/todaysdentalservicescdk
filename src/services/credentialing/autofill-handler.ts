// services/credentialing/autofill-handler.ts
// Portal Autofill API Handler for Chrome Extension

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    ScanCommand,
    PutCommand,
    DeleteCommand,
    UpdateCommand,
    GetCommand
} from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    hasModulePermission,
    getAllowedClinicIds,
    PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    CANONICAL_FIELDS,
    CANONICAL_FIELDS_FLAT,
    DOCUMENT_TYPE_SECTIONS,
    VALID_DOCUMENT_TYPES,
    findUploadSection,
    SubmissionMode,
} from './credentialing-schema';

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const PORTAL_ADAPTERS_TABLE = process.env.PORTAL_ADAPTERS_TABLE!;
const PAYER_REQUIREMENTS_TABLE = process.env.PAYER_REQUIREMENTS_TABLE!;
const AUTOFILL_AUDIT_TABLE = process.env.AUTOFILL_AUDIT_TABLE!;

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

// Module configuration
const MODULE_NAME = 'CREDENTIALING';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read',
    POST: 'write',
    PUT: 'put',
    DELETE: 'delete',
};

// ========================================
// TYPES
// ========================================

type ConfidenceLevel = 'high' | 'medium' | 'low';
type SourceType = 'verified' | 'extracted' | 'manual';

interface AutofillField {
    schemaKey: string;
    value: string;
    confidence: ConfidenceLevel;
    source: SourceType;
}

interface AutofillDocument {
    documentId: string;
    documentType: string;
    fileName: string;
    downloadUrl: string;
    uploadSection?: string;
}

interface RequirementsCheck {
    portal: string;
    requiredFields: string[];
    requiredDocs: string[];
    readiness: 'ready' | 'missing' | 'conflicts';
    missingItems: string[];
    conflicts: { field: string; issue: string }[];
}

interface AutofillPayload {
    providerId: string;
    portal: string;
    fields: AutofillField[];
    documents: AutofillDocument[];
    requirements: RequirementsCheck;
}

interface PortalAdapter {
    portalId: string;
    portalName: string;
    tier: 0 | 1 | 2 | 3;
    match: {
        hostnames: string[];
        urlPatterns: string[];
        pageSignatures?: string[];
    };
    fieldMap: Record<string, {
        schemaKey: string;
        fallbackSelectors?: string[];
        type: 'text' | 'select' | 'date' | 'phone' | 'ssn';
    }>;
    navigation?: {
        sections: { name: string; selector: string }[];
        nextButton?: string;
    };
    uploads?: Record<string, {
        documentTypes: string[];
        inputSelector: string;
        confirmationSelector?: string;
    }>;
    quirks?: {
        hasIframes: boolean;
        hasShadowDom: boolean;
        dynamicFields: boolean;
        maskedInputs: string[];
    };
    customCode?: string;
    createdAt: string;
    updatedAt: string;
}

// ========================================
// SUBMISSION CHANNEL TYPES (imported from credentialing-schema.ts)
// ========================================

interface PayerRequirements {
    payerId: string;
    payerName: string;
    // Submission channel configuration
    submissionMode: SubmissionMode;
    portalUrl?: string;                     // For PORTAL or HYBRID
    submissionEmail?: string;               // For EMAIL or HYBRID
    faxNumber?: string;                     // Legacy fallback
    submissionInstructions?: string;        // Payer-specific notes
    // Document requirements
    requiredFields: string[];
    requiredDocs: string[];
    minMalpracticeLimit?: number;
    premisesLiabilityRequired?: boolean;    // Some Delta entities require this
    premisesLiabilityMinimum?: number;
    licenseStateRules?: { state: string; requirements: string[] }[];
    recredentialingCadence?: number;        // months
    specialRequirements?: string[];
    // Email template hints
    emailSubjectTemplate?: string;          // e.g., "Credentialing Application – {{providerName}}, NPI {{npi}}"
    emailBodyTemplate?: string;
    createdAt: string;
    updatedAt: string;
}

// Unified submission tracking (works for PORTAL, EMAIL, and HYBRID)
interface SubmissionRecord {
    submissionId: string;
    providerId: string;
    payerId: string;
    submissionMode: SubmissionMode;
    // Channel-specific details
    channel: 'portal' | 'email' | 'fax' | 'mail';
    portalUrl?: string;
    recipientEmail?: string;
    faxNumber?: string;
    // Status tracking
    status: 'draft' | 'submitted' | 'pending_response' | 'approved' | 'rejected' | 'needs_info';
    sentAt?: string;
    lastResponseAt?: string;
    followUpDueAt?: string;
    // Content tracking
    fieldsSubmitted: string[];
    documentsAttached: string[];
    emailSubject?: string;
    emailBody?: string;
    // Audit
    submittedBy: string;
    createdAt: string;
    updatedAt: string;
    notes?: string;
}

// Email packet for submission-ready generation
interface EmailSubmissionPacket {
    providerId: string;
    payerId: string;
    subject: string;
    body: string;
    attachments: {
        documentType: string;
        fileName: string;
        downloadUrl: string;
    }[];
    readiness: 'ready' | 'missing_docs' | 'missing_fields';
    missingItems: string[];
}

interface AuditLogEntry {
    auditId: string;
    userId: string;
    userEmail: string;
    providerId: string;
    portal: string;                         // Can also be email address
    submissionMode: SubmissionMode;         // Track which channel was used
    action: 'fill' | 'upload' | 'submit_review' | 'email_generated' | 'email_sent';
    timestamp: string;
    fieldsChanged: {
        schemaKey: string;
        beforeHash?: string;
        afterHash: string;
        wasOverwritten: boolean;
    }[];
    documentsUploaded?: string[];
    confidence: number;
    ipAddress?: string;
    userAgent?: string;
}

// Schema constants (CANONICAL_FIELDS, CANONICAL_FIELDS_FLAT, DOCUMENT_TYPE_SECTIONS, findUploadSection)
// are imported from ./credentialing-schema.ts

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

const httpCreated = (data: Record<string, any>): APIGatewayProxyResult => ({
    statusCode: 201,
    headers: currentCorsHeaders,
    body: JSON.stringify({ success: true, ...data })
});

// ========================================
// MAIN HANDLER (ROUTER)
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: currentCorsHeaders, body: '' };
    }

    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
        return httpErr(401, 'Unauthorized - Invalid token');
    }

    const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
    if (!hasModulePermission(
        userPerms.clinicRoles,
        MODULE_NAME,
        requiredPermission,
        userPerms.isSuperAdmin,
        userPerms.isGlobalSuperAdmin
    )) {
        return httpErr(403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
    }

    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

    const method = event.httpMethod;
    const path = event.path.replace('/credentialing/autofill', '');
    const queryParams = event.queryStringParameters || {};
    const pathParams = event.pathParameters || {};

    try {
        // ========================================
        // AUTOFILL PAYLOAD ENDPOINTS
        // ========================================

        // GET /autofill/payload - Get autofill payload for a provider
        if (method === 'GET' && path === '/payload') {
            return getAutofillPayload(queryParams, userPerms, allowedClinics);
        }

        // GET /autofill/documents - Get document download URLs for a provider
        if (method === 'GET' && path === '/documents') {
            return getAutofillDocuments(queryParams, userPerms, allowedClinics);
        }

        // POST /autofill/audit - Log an autofill event
        if (method === 'POST' && path === '/audit') {
            if (!event.body) return httpErr(400, 'Missing request body');
            return logAutofillEvent(JSON.parse(event.body), userPerms, event);
        }

        // ========================================
        // PORTAL ADAPTER ENDPOINTS
        // ========================================

        // GET /autofill/portals - List all portal adapters
        if (method === 'GET' && path === '/portals') {
            return listPortalAdapters(queryParams);
        }

        // POST /autofill/portals - Create a portal adapter
        if (method === 'POST' && path === '/portals') {
            if (!event.body) return httpErr(400, 'Missing request body');
            return createPortalAdapter(JSON.parse(event.body), userPerms);
        }

        // GET /autofill/portals/{portalId} - Get a specific portal adapter
        if (method === 'GET' && path.match(/^\/portals\/[^\/]+$/)) {
            const portalId = pathParams.portalId || path.split('/')[2];
            return getPortalAdapter(portalId);
        }

        // PUT /autofill/portals/{portalId} - Update a portal adapter
        if (method === 'PUT' && path.match(/^\/portals\/[^\/]+$/)) {
            const portalId = pathParams.portalId || path.split('/')[2];
            if (!event.body) return httpErr(400, 'Missing request body');
            return updatePortalAdapter(portalId, JSON.parse(event.body), userPerms);
        }

        // DELETE /autofill/portals/{portalId} - Delete a portal adapter
        if (method === 'DELETE' && path.match(/^\/portals\/[^\/]+$/)) {
            const portalId = pathParams.portalId || path.split('/')[2];
            return deletePortalAdapter(portalId, userPerms);
        }

        // ========================================
        // PAYER REQUIREMENTS ENDPOINTS
        // ========================================

        // GET /autofill/requirements - List payer requirements
        if (method === 'GET' && path === '/requirements') {
            return listPayerRequirements(queryParams);
        }

        // POST /autofill/requirements - Create payer requirements
        if (method === 'POST' && path === '/requirements') {
            if (!event.body) return httpErr(400, 'Missing request body');
            return createPayerRequirements(JSON.parse(event.body), userPerms);
        }

        // GET /autofill/requirements/{payerId} - Get specific payer requirements
        if (method === 'GET' && path.match(/^\/requirements\/[^\/]+$/)) {
            const payerId = pathParams.payerId || path.split('/')[2];
            return getPayerRequirements(payerId);
        }

        // PUT /autofill/requirements/{payerId} - Update payer requirements
        if (method === 'PUT' && path.match(/^\/requirements\/[^\/]+$/)) {
            const payerId = pathParams.payerId || path.split('/')[2];
            if (!event.body) return httpErr(400, 'Missing request body');
            return updatePayerRequirements(payerId, JSON.parse(event.body), userPerms);
        }

        // DELETE /autofill/requirements/{payerId} - Delete payer requirements
        if (method === 'DELETE' && path.match(/^\/requirements\/[^\/]+$/)) {
            const payerId = pathParams.payerId || path.split('/')[2];
            return deletePayerRequirements(payerId, userPerms);
        }

        // ========================================
        // EMAIL SUBMISSION ENDPOINTS
        // ========================================

        // GET /autofill/email-packet - Generate submission-ready email packet
        if (method === 'GET' && path === '/email-packet') {
            return generateEmailPacket(queryParams, userPerms, allowedClinics);
        }

        // ========================================
        // SCHEMA & METADATA
        // ========================================

        // GET /autofill/schema - Get canonical field schema
        if (method === 'GET' && path === '/schema') {
            return httpOk({
                fieldsByCategory: CANONICAL_FIELDS,
                fields: CANONICAL_FIELDS_FLAT,
                documentTypes: Object.keys(DOCUMENT_TYPE_SECTIONS),
                documentSections: DOCUMENT_TYPE_SECTIONS,
                submissionModes: ['PORTAL', 'EMAIL', 'HYBRID'],
            });
        }

        return httpErr(404, 'Not Found');
    } catch (err: any) {
        console.error('Error in autofill handler:', err);
        return httpErr(500, err.message || 'Internal server error');
    }
};

// ========================================
// AUTOFILL PAYLOAD
// ========================================

async function getAutofillPayload(
    queryParams: any,
    userPerms: any,
    allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
    const { providerId, portal } = queryParams;

    if (!providerId) {
        return httpErr(400, 'providerId is required');
    }

    // Get provider
    const { Item: provider } = await ddb.send(new GetCommand({
        TableName: PROVIDERS_TABLE,
        Key: { providerId },
    }));

    if (!provider) {
        return httpErr(404, 'Provider not found');
    }

    // Check access
    if (!allowedClinics.has('*')) {
        const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
        if (!hasAccess) {
            return httpErr(403, 'No access to this provider');
        }
    }

    // Get all credentials for the provider
    const { Items: credentials } = await ddb.send(new QueryCommand({
        TableName: PROVIDER_CREDENTIALS_TABLE,
        KeyConditionExpression: 'providerId = :providerId',
        ExpressionAttributeValues: { ':providerId': providerId },
    }));

    // Build field values from provider and credentials
    const fields: AutofillField[] = [];

    // Provider-level fields
    const providerFields: Record<string, { value: string; source: SourceType }> = {
        firstName: { value: provider.name?.split(' ')[0] || '', source: 'manual' },
        lastName: { value: provider.name?.split(' ').slice(1).join(' ') || '', source: 'manual' },
        npi: { value: provider.npi || '', source: 'verified' },
        email: { value: provider.email || '', source: 'manual' },
        specialty: { value: provider.specialty || '', source: 'manual' },
    };

    for (const [key, { value, source }] of Object.entries(providerFields)) {
        if (value) {
            fields.push({
                schemaKey: key,
                value,
                confidence: source === 'verified' ? 'high' : 'medium',
                source,
            });
        }
    }

    // ── Credential fields ──────────────────────────────────────────────────
    //
    // IMPORTANT: credentials are stored FLAT in DynamoDB.
    // upsertProviderCredential spreads credentialData directly onto the record:
    //   { providerId, credentialType, ...credentialData, updatedAt }
    // So dateOfBirth, carrier, licenseNumber etc. sit directly on the cred object.
    //
    // Key normalizer maps wizard field names → canonical schema keys the
    // content-script's FIELD_PATTERNS expects.

    const FIELD_KEY_NORMALIZER: Record<string, string> = {
        // Identity
        dob:            'dateOfBirth',
        birthDate:      'dateOfBirth',
        // License
        licenseNumber:  'stateLicenseNumber',
        licenseState:   'stateLicenseState',
        licenseType:    'stateLicenseType',
        // Insurance / Malpractice
        carrier:        'malpracticeInsurer',
        policyNumber:   'malpracticePolicyNumber',
        coverageAmount: 'malpracticeLimitPerClaim',
        totalAggregate: 'malpracticeLimitAggregate',
        // Education
        institution:    'dentalSchoolName',
        fieldOfStudy:   'primarySpecialty',
        // Work history
        employer:       'currentEmployer',
        position:       'currentEmployerTitle',
        // Clinic info
        tinEin:         'taxId',
        officePhone:    'practicePhone',
        officeFax:      'practiceFax',
        officeAddress:  'practiceAddress1',
        officeCity:     'practiceCity',
        officeState:    'practiceState',
        officeZip:      'practiceZip',
    };

    // DynamoDB / structural keys that are never autofill data
    const SKIP_KEYS = new Set([
        'providerId', 'credentialType', 'updatedAt', 'createdAt',
        'additionalLicenses', 'additionalHistory',
        'oigCheck', 'npdbCheck', 'stateBoardCheck',
        'hasExclusions', 'exclusionDetails',
    ]);

    for (const cred of credentials || []) {
        const credType: string = cred.credentialType || '';

        const confidence: ConfidenceLevel =
            ['identity', 'license', 'insurance'].includes(credType) ? 'high' : 'medium';
        const source: SourceType = 'verified';

        // Some keys are ambiguous across credential types (e.g. 'expirationDate')
        // — resolve them based on which credential type we're reading.
        const typeNorm: Record<string, string> = {};
        if (credType === 'insurance') {
            typeNorm['expirationDate'] = 'malpracticeExpiry';
            typeNorm['effectiveDate']  = 'malpracticeEffectiveDate';
            typeNorm['issueDate']      = 'malpracticeEffectiveDate';
        } else if (credType === 'license') {
            typeNorm['expirationDate'] = 'stateLicenseExpiry';
            typeNorm['issueDate']      = 'stateLicenseIssueDate';
        } else if (credType === 'workHistory') {
            typeNorm['endDate']   = 'currentEmployerEndDate';
            typeNorm['startDate'] = 'currentEmployerStartDate';
        }

        for (const [rawKey, val] of Object.entries(cred)) {
            if (SKIP_KEYS.has(rawKey)) continue;
            if (val === undefined || val === null || val === '') continue;
            if (typeof val === 'object') continue; // skip nested/array values

            // Resolve canonical key: type-specific → global normalizer → raw key
            const canonicalKey = typeNorm[rawKey] ?? FIELD_KEY_NORMALIZER[rawKey] ?? rawKey;

            // Don't overwrite a higher-confidence field already added
            if (fields.some(f => f.schemaKey === canonicalKey)) continue;

            fields.push({ schemaKey: canonicalKey, value: String(val), confidence, source });
        }

        // Identity credential: override the naive name-split firstName/lastName
        // from provider.name with the more accurate explicitly-stored values.
        if (credType === 'identity') {
            if (cred.firstName) {
                const f = fields.find(x => x.schemaKey === 'firstName');
                if (f) f.value = String(cred.firstName);
                else fields.push({ schemaKey: 'firstName', value: String(cred.firstName), confidence: 'high', source: 'verified' });
            }
            if (cred.lastName) {
                const f = fields.find(x => x.schemaKey === 'lastName');
                if (f) f.value = String(cred.lastName);
                else fields.push({ schemaKey: 'lastName', value: String(cred.lastName), confidence: 'high', source: 'verified' });
            }
        }
    }

    // Get documents for the provider
    const { Items: documents } = await ddb.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'byProvider',
        KeyConditionExpression: 'providerId = :providerId',
        ExpressionAttributeValues: { ':providerId': providerId },
    }));

    // Generate presigned URLs for documents
    const autofillDocs: AutofillDocument[] = [];
    for (const doc of documents || []) {
        const command = new GetObjectCommand({
            Bucket: DOCUMENTS_BUCKET,
            Key: doc.s3Key,
        });
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

        autofillDocs.push({
            documentId: doc.documentId,
            documentType: doc.documentType,
            fileName: doc.fileName,
            downloadUrl,
            uploadSection: findUploadSection(doc.documentType),
        });
    }

    // Check requirements if portal specified
    let requirements: RequirementsCheck = {
        portal: portal || 'generic',
        requiredFields: [],
        requiredDocs: [],
        readiness: 'ready',
        missingItems: [],
        conflicts: [],
    };

    if (portal) {
        requirements = await checkRequirements(portal, fields, autofillDocs);
    }

    const payload: AutofillPayload = {
        providerId,
        portal: portal || 'generic',
        fields,
        documents: autofillDocs,
        requirements,
    };

    return httpOk({ payload });
}

function addCredentialFields(
    fields: AutofillField[],
    data: Record<string, any>,
    keys: string[],
    source: SourceType
) {
    for (const key of keys) {
        if (data[key]) {
            fields.push({
                schemaKey: key,
                value: String(data[key]),
                confidence: 'high',
                source,
            });
        }
    }
}

// findUploadSection imported from credentialing-schema.ts

async function checkRequirements(
    portal: string,
    fields: AutofillField[],
    documents: AutofillDocument[]
): Promise<RequirementsCheck> {
    // Try to find payer requirements
    const { Item: requirements } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId: portal },
    }));

    if (!requirements) {
        return {
            portal,
            requiredFields: [],
            requiredDocs: [],
            readiness: 'ready',
            missingItems: [],
            conflicts: [],
        };
    }

    const missingItems: string[] = [];
    const conflicts: { field: string; issue: string }[] = [];

    // Check required fields
    const fieldKeys = new Set(fields.map(f => f.schemaKey));
    for (const reqField of requirements.requiredFields || []) {
        if (!fieldKeys.has(reqField)) {
            missingItems.push(`Field: ${reqField}`);
        }
    }

    // Check required documents
    const docTypes = new Set(documents.map(d => d.documentType));
    for (const reqDoc of requirements.requiredDocs || []) {
        if (!docTypes.has(reqDoc)) {
            missingItems.push(`Document: ${reqDoc}`);
        }
    }

    // Check malpractice limits
    if (requirements.minMalpracticeLimit) {
        const malpracticeField = fields.find(f => f.schemaKey === 'malpracticeLimit');
        if (malpracticeField) {
            const limit = parseInt(malpracticeField.value.replace(/[^0-9]/g, ''));
            if (limit < requirements.minMalpracticeLimit) {
                conflicts.push({
                    field: 'malpracticeLimit',
                    issue: `Minimum limit is $${requirements.minMalpracticeLimit.toLocaleString()}, current is $${limit.toLocaleString()}`,
                });
            }
        }
    }

    const readiness = conflicts.length > 0 ? 'conflicts' :
        missingItems.length > 0 ? 'missing' : 'ready';

    return {
        portal,
        requiredFields: requirements.requiredFields || [],
        requiredDocs: requirements.requiredDocs || [],
        readiness,
        missingItems,
        conflicts,
    };
}

async function getAutofillDocuments(
    queryParams: any,
    userPerms: any,
    allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
    const { providerId, portal, documentTypes } = queryParams;

    if (!providerId) {
        return httpErr(400, 'providerId is required');
    }

    // Verify provider access
    const { Item: provider } = await ddb.send(new GetCommand({
        TableName: PROVIDERS_TABLE,
        Key: { providerId },
    }));

    if (!provider) {
        return httpErr(404, 'Provider not found');
    }

    if (!allowedClinics.has('*')) {
        const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
        if (!hasAccess) {
            return httpErr(403, 'No access to this provider');
        }
    }

    // Get documents
    const { Items: documents } = await ddb.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'byProvider',
        KeyConditionExpression: 'providerId = :providerId',
        ExpressionAttributeValues: { ':providerId': providerId },
    }));

    // Filter by document types if specified
    let filteredDocs = documents || [];
    if (documentTypes) {
        const types = documentTypes.split(',').map((t: string) => t.trim());
        filteredDocs = filteredDocs.filter(d => types.includes(d.documentType));
    }

    // Generate presigned URLs
    const autofillDocs: AutofillDocument[] = [];
    for (const doc of filteredDocs) {
        const command = new GetObjectCommand({
            Bucket: DOCUMENTS_BUCKET,
            Key: doc.s3Key,
        });
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

        autofillDocs.push({
            documentId: doc.documentId,
            documentType: doc.documentType,
            fileName: doc.fileName,
            downloadUrl,
            uploadSection: findUploadSection(doc.documentType),
        });
    }

    return httpOk({ documents: autofillDocs });
}

// ========================================
// AUDIT LOGGING
// ========================================

async function logAutofillEvent(
    body: any,
    userPerms: any,
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
    const { providerId, portal, action, fieldsChanged, documentsUploaded, confidence } = body;

    if (!providerId || !portal || !action) {
        return httpErr(400, 'providerId, portal, and action are required');
    }

    const validActions = ['fill', 'upload', 'submit_review', 'email_generated', 'email_sent'];
    if (!validActions.includes(action)) {
        return httpErr(400, `action must be one of: ${validActions.join(', ')}`);
    }

    // Determine submission mode from action
    const submissionMode: SubmissionMode =
        (action === 'email_generated' || action === 'email_sent') ? 'EMAIL' :
            body.submissionMode || 'PORTAL';

    const auditEntry: AuditLogEntry = {
        auditId: uuidv4(),
        userId: userPerms.userId || userPerms.email,
        userEmail: userPerms.email,
        providerId,
        portal,
        submissionMode,
        action,
        timestamp: new Date().toISOString(),
        fieldsChanged: fieldsChanged || [],
        documentsUploaded: documentsUploaded || [],
        confidence: confidence || 0,
        ipAddress: event.requestContext?.identity?.sourceIp,
        userAgent: event.headers?.['User-Agent'] || event.headers?.['user-agent'],
    };

    await ddb.send(new PutCommand({
        TableName: AUTOFILL_AUDIT_TABLE,
        Item: auditEntry,
    }));

    return httpCreated({
        auditId: auditEntry.auditId,
        message: 'Autofill event logged successfully'
    });
}

// ========================================
// PORTAL ADAPTERS
// ========================================

async function listPortalAdapters(queryParams: any): Promise<APIGatewayProxyResult> {
    const { tier, limit = '50', lastKey } = queryParams;

    let params: any = {
        TableName: PORTAL_ADAPTERS_TABLE,
        Limit: parseInt(limit),
    };

    if (lastKey) {
        params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
    }

    if (tier !== undefined) {
        params = {
            ...params,
            IndexName: 'byTier',
            KeyConditionExpression: '#tier = :tier',
            ExpressionAttributeNames: { '#tier': 'tier' },
            ExpressionAttributeValues: { ':tier': parseInt(tier) },
        };
        const result = await ddb.send(new QueryCommand(params));
        return httpOk({
            adapters: result.Items || [],
            lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null,
        });
    }

    const result = await ddb.send(new ScanCommand(params));
    return httpOk({
        adapters: result.Items || [],
        lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null,
    });
}

async function createPortalAdapter(body: any, userPerms: any): Promise<APIGatewayProxyResult> {
    const { portalId, portalName, tier, match, fieldMap, navigation, uploads, quirks, customCode } = body;

    if (!portalId || !portalName || tier === undefined || !match) {
        return httpErr(400, 'portalId, portalName, tier, and match are required');
    }

    if (!match.hostnames || !Array.isArray(match.hostnames) || match.hostnames.length === 0) {
        return httpErr(400, 'match.hostnames must be a non-empty array');
    }

    // Check for duplicate
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Key: { portalId },
    }));

    if (existing) {
        return httpErr(400, 'A portal adapter with this ID already exists');
    }

    const now = new Date().toISOString();
    const adapter: PortalAdapter = {
        portalId,
        portalName,
        tier,
        match,
        fieldMap: fieldMap || {},
        navigation,
        uploads,
        quirks,
        customCode,
        createdAt: now,
        updatedAt: now,
    };

    await ddb.send(new PutCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Item: adapter,
    }));

    return httpCreated({ portalId, message: 'Portal adapter created successfully', adapter });
}

async function getPortalAdapter(portalId: string): Promise<APIGatewayProxyResult> {
    const { Item } = await ddb.send(new GetCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Key: { portalId },
    }));

    if (!Item) {
        return httpErr(404, 'Portal adapter not found');
    }

    return httpOk({ adapter: Item });
}

async function updatePortalAdapter(portalId: string, body: any, userPerms: any): Promise<APIGatewayProxyResult> {
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Key: { portalId },
    }));

    if (!existing) {
        return httpErr(404, 'Portal adapter not found');
    }

    const updated = {
        ...existing,
        ...body,
        portalId, // Ensure portalId cannot be changed
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Item: updated,
    }));

    return httpOk({ message: 'Portal adapter updated successfully', adapter: updated });
}

async function deletePortalAdapter(portalId: string, userPerms: any): Promise<APIGatewayProxyResult> {
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Key: { portalId },
    }));

    if (!existing) {
        return httpErr(404, 'Portal adapter not found');
    }

    await ddb.send(new DeleteCommand({
        TableName: PORTAL_ADAPTERS_TABLE,
        Key: { portalId },
    }));

    return httpOk({ message: 'Portal adapter deleted successfully' });
}

// ========================================
// PAYER REQUIREMENTS
// ========================================

async function listPayerRequirements(queryParams: any): Promise<APIGatewayProxyResult> {
    const { limit = '50', lastKey } = queryParams;

    const params: any = {
        TableName: PAYER_REQUIREMENTS_TABLE,
        Limit: parseInt(limit),
    };

    if (lastKey) {
        params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
    }

    const result = await ddb.send(new ScanCommand(params));
    return httpOk({
        requirements: result.Items || [],
        lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null,
    });
}

async function createPayerRequirements(body: any, userPerms: any): Promise<APIGatewayProxyResult> {
    const { payerId, payerName, requiredFields, requiredDocs, minMalpracticeLimit, licenseStateRules, recredentialingCadence, specialRequirements } = body;

    if (!payerId || !payerName) {
        return httpErr(400, 'payerId and payerName are required');
    }

    // Check for duplicate
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    if (existing) {
        return httpErr(400, 'Payer requirements for this ID already exist');
    }

    const now = new Date().toISOString();
    const requirements: PayerRequirements = {
        payerId,
        payerName,
        submissionMode: body.submissionMode || 'PORTAL',
        portalUrl: body.portalUrl,
        submissionEmail: body.submissionEmail,
        faxNumber: body.faxNumber,
        submissionInstructions: body.submissionInstructions,
        requiredFields: requiredFields || [],
        requiredDocs: requiredDocs || [],
        minMalpracticeLimit,
        premisesLiabilityRequired: body.premisesLiabilityRequired,
        premisesLiabilityMinimum: body.premisesLiabilityMinimum,
        licenseStateRules,
        recredentialingCadence,
        specialRequirements,
        emailSubjectTemplate: body.emailSubjectTemplate,
        emailBodyTemplate: body.emailBodyTemplate,
        createdAt: now,
        updatedAt: now,
    };

    await ddb.send(new PutCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Item: requirements,
    }));

    return httpCreated({ payerId, message: 'Payer requirements created successfully', requirements });
}

async function getPayerRequirements(payerId: string): Promise<APIGatewayProxyResult> {
    const { Item } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    if (!Item) {
        return httpErr(404, 'Payer requirements not found');
    }

    return httpOk({ requirements: Item });
}

async function updatePayerRequirements(payerId: string, body: any, userPerms: any): Promise<APIGatewayProxyResult> {
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    if (!existing) {
        return httpErr(404, 'Payer requirements not found');
    }

    const updated = {
        ...existing,
        ...body,
        payerId, // Ensure payerId cannot be changed
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Item: updated,
    }));

    return httpOk({ message: 'Payer requirements updated successfully', requirements: updated });
}

async function deletePayerRequirements(payerId: string, userPerms: any): Promise<APIGatewayProxyResult> {
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    if (!existing) {
        return httpErr(404, 'Payer requirements not found');
    }

    await ddb.send(new DeleteCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    return httpOk({ message: 'Payer requirements deleted successfully' });
}

// ========================================
// EMAIL SUBMISSION PACKET GENERATION
// ========================================

async function generateEmailPacket(
    queryParams: any,
    userPerms: any,
    allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
    const { providerId, payerId } = queryParams;

    if (!providerId || !payerId) {
        return httpErr(400, 'providerId and payerId are required');
    }

    // Get provider
    const { Item: provider } = await ddb.send(new GetCommand({
        TableName: PROVIDERS_TABLE,
        Key: { providerId },
    }));

    if (!provider) {
        return httpErr(404, 'Provider not found');
    }

    // Check access
    if (!allowedClinics.has('*')) {
        const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
        if (!hasAccess) {
            return httpErr(403, 'No access to this provider');
        }
    }

    // Get payer requirements (optional - will use defaults if not found)
    const { Item: payerReqs } = await ddb.send(new GetCommand({
        TableName: PAYER_REQUIREMENTS_TABLE,
        Key: { payerId },
    }));

    // Get documents for the provider
    const { Items: documents } = await ddb.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'byProvider',
        KeyConditionExpression: 'providerId = :providerId',
        ExpressionAttributeValues: { ':providerId': providerId },
    }));

    // Build provider name
    const providerName = provider.name || `${provider.firstName || ''} ${provider.lastName || ''}`.trim();

    // Build email subject
    let subject: string;
    if (payerReqs?.emailSubjectTemplate) {
        subject = payerReqs.emailSubjectTemplate
            .replace('{{providerName}}', providerName)
            .replace('{{npi}}', provider.npi || 'N/A')
            .replace('{{payerName}}', payerReqs.payerName || payerId);
    } else {
        subject = `Credentialing Application – ${providerName}, NPI ${provider.npi || 'N/A'}`;
    }

    // Build email body
    let body: string;
    if (payerReqs?.emailBodyTemplate) {
        body = payerReqs.emailBodyTemplate
            .replace('{{providerName}}', providerName)
            .replace('{{npi}}', provider.npi || 'N/A')
            .replace('{{payerName}}', payerReqs.payerName || payerId);
    } else {
        body = buildDefaultEmailBody(providerName, provider.npi, payerReqs?.payerName || payerId);
    }

    // Generate presigned URLs for required documents
    const requiredDocs = payerReqs?.requiredDocs || [];
    const attachments: { documentType: string; fileName: string; downloadUrl: string }[] = [];
    const missingDocs: string[] = [];

    // Group documents by type
    const docsByType: Record<string, any> = {};
    for (const doc of documents || []) {
        docsByType[doc.documentType] = doc;
    }

    // Check required documents and generate URLs
    for (const reqDoc of requiredDocs) {
        const doc = docsByType[reqDoc];
        if (doc) {
            const command = new GetObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: doc.s3Key,
            });
            const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

            attachments.push({
                documentType: reqDoc,
                fileName: doc.fileName,
                downloadUrl,
            });
        } else {
            missingDocs.push(reqDoc);
        }
    }

    // Add non-required documents that we have
    for (const doc of documents || []) {
        if (!requiredDocs.includes(doc.documentType)) {
            const command = new GetObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: doc.s3Key,
            });
            const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

            attachments.push({
                documentType: doc.documentType,
                fileName: doc.fileName,
                downloadUrl,
            });
        }
    }

    // Check required fields
    const missingFields: string[] = [];
    const requiredFields = payerReqs?.requiredFields || [];
    for (const field of requiredFields) {
        // Simple check - in production, would check credentials table
        if (!provider[field] && field !== 'npi') {
            missingFields.push(field);
        }
    }

    const readiness = missingDocs.length > 0 ? 'missing_docs' :
        missingFields.length > 0 ? 'missing_fields' : 'ready';

    const packet: EmailSubmissionPacket = {
        providerId,
        payerId,
        subject,
        body,
        attachments,
        readiness,
        missingItems: [...missingDocs.map(d => `Document: ${d}`), ...missingFields.map(f => `Field: ${f}`)],
    };

    return httpOk({
        packet,
        payerInfo: {
            payerName: payerReqs?.payerName || payerId,
            submissionMode: payerReqs?.submissionMode || 'EMAIL',
            submissionEmail: payerReqs?.submissionEmail,
            submissionInstructions: payerReqs?.submissionInstructions,
        },
    });
}

function buildDefaultEmailBody(providerName: string, npi: string, payerName: string): string {
    return `Dear ${payerName} Credentialing Team,

Please find attached the completed credentialing application and supporting documents for ${providerName}.

Provider Details:
- Name: ${providerName}
- NPI: ${npi || 'N/A'}

Attachments included with this submission are listed in the email attachments.

Please let us know if any additional information is required.

Thank you,
${providerName}`;
}
