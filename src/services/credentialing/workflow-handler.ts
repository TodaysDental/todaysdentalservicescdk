/**
 * Credentialing Workflow Handler
 * 
 * Step Functions task handlers for credentialing workflow orchestration.
 * Supports multi-day workflows with human review checkpoints.
 * 
 * Workflows:
 * 1. Document Intake - Process uploaded documents through OCR/AI extraction
 * 2. Credential Verification - Run NPI, OIG, license checks
 * 3. Enrollment Submission - Generate and track payer enrollments
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    UpdateCommand,
    GetCommand,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfn = new SFNClient({});

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const WORKFLOW_EXECUTIONS_TABLE = process.env.WORKFLOW_EXECUTIONS_TABLE!;
const CREDENTIALING_TASKS_TABLE = process.env.CREDENTIALING_TASKS_TABLE!;
const VERIFICATION_LOGS_TABLE = process.env.VERIFICATION_LOGS_TABLE!;
const DOCUMENT_INTAKE_STATE_MACHINE_ARN = process.env.DOCUMENT_INTAKE_STATE_MACHINE_ARN || '';
const VERIFICATION_STATE_MACHINE_ARN = process.env.VERIFICATION_STATE_MACHINE_ARN || '';
const ENROLLMENT_STATE_MACHINE_ARN = process.env.ENROLLMENT_STATE_MACHINE_ARN || '';

// ========================================
// WORKFLOW TYPES
// ========================================

export type WorkflowType = 'DOCUMENT_INTAKE' | 'CREDENTIAL_VERIFICATION' | 'ENROLLMENT_SUBMISSION';

export interface WorkflowExecution {
    executionId: string;
    workflowType: WorkflowType;
    providerId: string;
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PENDING_REVIEW' | 'CANCELLED';
    input: Record<string, any>;
    output?: Record<string, any>;
    currentStep: string;
    stepHistory: StepHistoryEntry[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    sfnExecutionArn?: string;
}

export interface StepHistoryEntry {
    step: string;
    status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
    timestamp: string;
    input?: Record<string, any>;
    output?: Record<string, any>;
    error?: string;
}

// ========================================
// STEP FUNCTION TASK PAYLOADS
// ========================================

export interface DocumentIntakePayload {
    executionId: string;
    providerId: string;
    documentId: string;
    documentType: string;
    s3Key: string;
}

export interface VerificationPayload {
    executionId: string;
    providerId: string;
    npi?: string;
    lastName?: string;
    firstName?: string;
    stateLicenseNumber?: string;
    stateLicenseState?: string;
}

export interface EnrollmentPayload {
    executionId: string;
    providerId: string;
    payerId: string;
    submissionMode: 'PORTAL' | 'EMAIL' | 'HYBRID';
    documentIds: string[];
}

// ========================================
// SHARED HTTP HELPER (used by verification steps)
// ========================================

function httpsRequest(
    url: string,
    options: { timeout?: number } = {}
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
// WORKFLOW EXECUTION MANAGEMENT
// ========================================

async function createWorkflowExecution(
    workflowType: WorkflowType,
    providerId: string,
    input: Record<string, any>
): Promise<WorkflowExecution> {
    const now = new Date().toISOString();
    const executionId = uuidv4();

    const execution: WorkflowExecution = {
        executionId,
        workflowType,
        providerId,
        status: 'RUNNING',
        input,
        currentStep: 'INITIALIZED',
        stepHistory: [{
            step: 'INITIALIZED',
            status: 'COMPLETED',
            timestamp: now,
        }],
        createdAt: now,
        updatedAt: now,
    };

    await ddb.send(new PutCommand({
        TableName: WORKFLOW_EXECUTIONS_TABLE,
        Item: execution,
    }));

    return execution;
}

async function updateWorkflowStep(
    executionId: string,
    step: string,
    status: StepHistoryEntry['status'],
    output?: Record<string, any>,
    error?: string
): Promise<void> {
    const now = new Date().toISOString();
    const historyEntry: StepHistoryEntry = { step, status, timestamp: now, output, error };

    await ddb.send(new UpdateCommand({
        TableName: WORKFLOW_EXECUTIONS_TABLE,
        Key: { executionId },
        UpdateExpression: 'SET currentStep = :step, stepHistory = list_append(stepHistory, :entry), updatedAt = :now',
        ExpressionAttributeValues: {
            ':step': step,
            ':entry': [historyEntry],
            ':now': now,
        },
    }));
}

async function completeWorkflow(
    executionId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'PENDING_REVIEW',
    output?: Record<string, any>
): Promise<void> {
    const now = new Date().toISOString();

    await ddb.send(new UpdateCommand({
        TableName: WORKFLOW_EXECUTIONS_TABLE,
        Key: { executionId },
        UpdateExpression: 'SET #s = :status, #o = :output, completedAt = :now, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status', '#o': 'output' },
        ExpressionAttributeValues: {
            ':status': status,
            ':output': output || {},
            ':now': now,
        },
    }));
}

// ========================================
// STEP FUNCTION TASK HANDLERS
// ========================================

/**
 * Document Classification Step
 * Determines document type from content/metadata
 */
export async function handleClassifyDocument(event: DocumentIntakePayload): Promise<{
    documentType: string;
    confidence: number;
    proceed: boolean;
}> {
    console.log('ClassifyDocument step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'CLASSIFY_DOCUMENT', 'STARTED');

    try {
        // Document type is already known from upload - validate it
        const confidence = event.documentType && event.documentType !== 'other' ? 0.9 : 0.5;
        const proceed = confidence >= 0.5;

        await updateWorkflowStep(event.executionId, 'CLASSIFY_DOCUMENT', 'COMPLETED', {
            documentType: event.documentType,
            confidence,
        });

        return {
            documentType: event.documentType,
            confidence,
            proceed,
        };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'CLASSIFY_DOCUMENT', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Textract Extraction Step
 * Extracts text from document using Textract
 */
export async function handleExtractText(event: DocumentIntakePayload & { documentType: string }): Promise<{
    extractedText: boolean;
    fieldCount: number;
}> {
    console.log('ExtractText step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'EXTRACT_TEXT', 'STARTED');

    try {
        // In production, this would invoke the doc processor
        // For now, we assume extraction happens via S3 trigger
        await updateWorkflowStep(event.executionId, 'EXTRACT_TEXT', 'COMPLETED', {
            s3Key: event.s3Key,
            documentType: event.documentType,
        });

        return {
            extractedText: true,
            fieldCount: 0, // Would be populated by actual extraction
        };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'EXTRACT_TEXT', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Validation Rules Step
 * Checks extracted data against business rules
 */
export async function handleValidateRules(event: {
    executionId: string;
    providerId: string;
    extractedFields?: Record<string, any>;
}): Promise<{
    isValid: boolean;
    warnings: string[];
    errors: string[];
    requiresReview: boolean;
}> {
    console.log('ValidateRules step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'VALIDATE_RULES', 'STARTED');

    try {
        const warnings: string[] = [];
        const errors: string[] = [];

        // Get provider data
        const { Item: provider } = await ddb.send(new GetCommand({
            TableName: PROVIDERS_TABLE,
            Key: { providerId: event.providerId },
        }));

        // Validation checks
        if (!provider?.npi) {
            errors.push('Provider NPI is required');
        }
        if (!provider?.stateLicenseNumber) {
            warnings.push('State license not on file - manual verification required');
        }
        if (!provider?.malpracticeInsurer) {
            warnings.push('Malpractice insurance not verified');
        }

        const isValid = errors.length === 0;
        const requiresReview = warnings.length > 0 || !isValid;

        await updateWorkflowStep(event.executionId, 'VALIDATE_RULES', 'COMPLETED', {
            isValid,
            warningCount: warnings.length,
            errorCount: errors.length,
        });

        return { isValid, warnings, errors, requiresReview };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'VALIDATE_RULES', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Human Review Step
 * Creates a task for human review when auto-approval isn't possible
 */
export async function handleCreateReviewTask(event: {
    executionId: string;
    providerId: string;
    reviewReason: string;
    taskToken?: string;
}): Promise<{
    taskId: string;
    status: 'PENDING_REVIEW';
}> {
    console.log('CreateReviewTask step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'CREATE_REVIEW_TASK', 'STARTED');

    try {
        const now = new Date().toISOString();
        const taskId = uuidv4();

        // Create credentialing task for human review
        await ddb.send(new PutCommand({
            TableName: CREDENTIALING_TASKS_TABLE,
            Item: {
                taskId,
                providerId: event.providerId,
                taskType: 'WORKFLOW_REVIEW',
                status: 'pending',
                priority: 'high',
                title: `Review Required: ${event.reviewReason}`,
                description: `Workflow ${event.executionId} requires human review.`,
                workflowExecutionId: event.executionId,
                taskToken: event.taskToken, // For Step Functions callback
                createdAt: now,
                updatedAt: now,
            },
        }));

        // Update workflow to pending review
        await completeWorkflow(event.executionId, 'PENDING_REVIEW', {
            taskId,
            reviewReason: event.reviewReason,
        });

        await updateWorkflowStep(event.executionId, 'CREATE_REVIEW_TASK', 'COMPLETED', { taskId });

        return { taskId, status: 'PENDING_REVIEW' };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'CREATE_REVIEW_TASK', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Update Provider Profile Step
 * Updates provider record with verified data
 */
export async function handleUpdateProfile(event: {
    executionId: string;
    providerId: string;
    fieldsToUpdate: Record<string, any>;
}): Promise<{
    updated: boolean;
    fieldsUpdated: string[];
}> {
    console.log('UpdateProfile step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'UPDATE_PROFILE', 'STARTED');

    try {
        const updates = event.fieldsToUpdate || {};
        const fieldsUpdated = Object.keys(updates);

        if (fieldsUpdated.length > 0) {
            const updateExprParts: string[] = ['updatedAt = :now'];
            const exprValues: Record<string, any> = { ':now': new Date().toISOString() };

            fieldsUpdated.forEach((field, i) => {
                updateExprParts.push(`#f${i} = :v${i}`);
                exprValues[`:v${i}`] = updates[field];
            });

            await ddb.send(new UpdateCommand({
                TableName: PROVIDERS_TABLE,
                Key: { providerId: event.providerId },
                UpdateExpression: 'SET ' + updateExprParts.join(', '),
                ExpressionAttributeNames: Object.fromEntries(
                    fieldsUpdated.map((f, i) => [`#f${i}`, f])
                ),
                ExpressionAttributeValues: exprValues,
            }));
        }

        await updateWorkflowStep(event.executionId, 'UPDATE_PROFILE', 'COMPLETED', { fieldsUpdated });

        return { updated: true, fieldsUpdated };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'UPDATE_PROFILE', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Notify Team Step
 * Sends notifications about workflow completion
 */
export async function handleNotifyTeam(event: {
    executionId: string;
    providerId: string;
    notificationType: 'SUCCESS' | 'FAILURE' | 'REVIEW_NEEDED';
    message: string;
}): Promise<{
    notified: boolean;
}> {
    console.log('NotifyTeam step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'NOTIFY_TEAM', 'STARTED');

    try {
        // In production, this would send SES/SNS notifications
        console.log(`Notification: ${event.notificationType} - ${event.message}`);

        await updateWorkflowStep(event.executionId, 'NOTIFY_TEAM', 'COMPLETED', {
            notificationType: event.notificationType,
        });

        return { notified: true };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'NOTIFY_TEAM', 'FAILED', undefined, error.message);
        throw error;
    }
}

/**
 * Complete Workflow Step
 * Marks the workflow execution record as SUCCEEDED/FAILED/PENDING_REVIEW.
 */
export async function handleCompleteWorkflowStep(event: {
    executionId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'PENDING_REVIEW';
    output?: Record<string, any>;
}): Promise<{ completed: boolean; status: string }> {
    console.log('CompleteWorkflow step:', event.executionId, event.status);
    await updateWorkflowStep(event.executionId, 'COMPLETE_WORKFLOW', 'STARTED');

    try {
        await completeWorkflow(event.executionId, event.status, event.output || {});
        await updateWorkflowStep(event.executionId, 'COMPLETE_WORKFLOW', 'COMPLETED', { status: event.status });
        return { completed: true, status: event.status };
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'COMPLETE_WORKFLOW', 'FAILED', undefined, error.message);
        throw error;
    }
}

// ========================================
// VERIFICATION STEPS (used by Verification State Machine)
// ========================================

interface VerificationLog {
    verificationId: string;
    providerId: string;
    verificationType: 'npi' | 'oig';
    requestParams: Record<string, any>;
    result: Record<string, any>;
    status: 'passed' | 'failed' | 'needs_review' | 'error';
    verifiedAt: string;
    verifiedBy?: string;
}

async function logVerification(log: VerificationLog): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: VERIFICATION_LOGS_TABLE,
        Item: log,
    }));
}

interface NPPESResult {
    valid: boolean;
    npi: string;
    providerName?: string;
    taxonomyCode?: string;
    taxonomyDescription?: string;
    status?: string;
    rawData?: any;
    error?: string;
}

async function verifyNpiAgainstNppes(npi: string): Promise<NPPESResult> {
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
        const taxonomies = result.taxonomies || [];
        const primaryTaxonomy = taxonomies.find((t: any) => t.primary === true) || taxonomies[0];

        // Build provider name based on entity type
        let providerName: string;
        if (result.enumeration_type === 'NPI-1') {
            providerName = `${basic.first_name || ''} ${basic.middle_name || ''} ${basic.last_name || ''}`.trim();
            if (basic.credential) providerName += `, ${basic.credential}`;
        } else {
            providerName = basic.organization_name || basic.name || '';
        }

        return {
            valid: true,
            npi: cleanNpi,
            providerName,
            taxonomyCode: primaryTaxonomy?.code,
            taxonomyDescription: primaryTaxonomy?.desc,
            status: basic.status || 'Active',
            rawData: result,
        };
    } catch (error: any) {
        console.error('NPI verification error:', error);
        return { valid: false, npi: cleanNpi, error: `Verification failed: ${error.message}` };
    }
}

interface OIGResult {
    excluded: boolean;
    npi?: string;
    lastName?: string;
    firstName?: string;
    exclusionType?: string;
    exclusionDate?: string;
    reinstateDate?: string;
    rawData?: any;
    error?: string;
    checkedAt: string;
}

async function checkOigExclusion(params: { npi?: string; lastName?: string; firstName?: string }): Promise<OIGResult> {
    const { npi, lastName, firstName } = params;
    const checkedAt = new Date().toISOString();

    if (!npi && !lastName) {
        return { excluded: false, error: 'NPI or lastName required', checkedAt };
    }

    try {
        // OIG LEIE Search API endpoint
        let url = 'https://exclusions.oig.hhs.gov/api/exclusions';
        const queryParams: string[] = [];

        if (lastName) queryParams.push(`lname=${encodeURIComponent(lastName.toUpperCase())}`);
        if (firstName) queryParams.push(`fname=${encodeURIComponent(firstName.toUpperCase())}`);
        if (queryParams.length > 0) url += '?' + queryParams.join('&');

        const response = await httpsRequest(url);
        if (response.statusCode !== 200) {
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
            return { excluded: false, npi, lastName, firstName, checkedAt };
        }

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
                    rawData: npiMatch,
                    checkedAt,
                };
            }
        }

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

        return { excluded: false, npi, lastName, firstName, checkedAt };
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

export async function handleVerifyNpi(event: VerificationPayload): Promise<NPPESResult> {
    console.log('VerifyNPI step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'VERIFY_NPI', 'STARTED');

    try {
        let npi = event.npi;
        if (!npi) {
            const { Item: provider } = await ddb.send(new GetCommand({
                TableName: PROVIDERS_TABLE,
                Key: { providerId: event.providerId },
            }));
            npi = provider?.npi;
        }

        if (!npi) {
            throw new Error('Provider NPI is required for verification');
        }

        const result = await verifyNpiAgainstNppes(npi);
        const status: VerificationLog['status'] = result.valid ? 'passed' : 'failed';

        await logVerification({
            verificationId: uuidv4(),
            providerId: event.providerId,
            verificationType: 'npi',
            requestParams: { npi },
            result,
            status,
            verifiedAt: new Date().toISOString(),
        });

        await updateWorkflowStep(event.executionId, 'VERIFY_NPI', 'COMPLETED', {
            valid: result.valid,
            npi: result.npi,
            providerName: result.providerName,
            status: result.status,
            error: result.error,
        });

        return result;
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'VERIFY_NPI', 'FAILED', undefined, error.message);
        throw error;
    }
}

export async function handleVerifyOig(event: VerificationPayload): Promise<OIGResult> {
    console.log('VerifyOIG step:', event.executionId);
    await updateWorkflowStep(event.executionId, 'VERIFY_OIG', 'STARTED');

    try {
        let npi = event.npi;
        let lastName = event.lastName;
        let firstName = event.firstName;

        if (!npi || !lastName) {
            const { Item: provider } = await ddb.send(new GetCommand({
                TableName: PROVIDERS_TABLE,
                Key: { providerId: event.providerId },
            }));
            npi = npi || provider?.npi;
            // Provider record may store full name as "name"
            if (!lastName && provider?.lastName) lastName = provider.lastName;
            if (!firstName && provider?.firstName) firstName = provider.firstName;
            if ((!firstName || !lastName) && provider?.name) {
                const parts = String(provider.name).trim().split(/\s+/);
                if (!firstName && parts.length >= 1) firstName = parts[0];
                if (!lastName && parts.length >= 2) lastName = parts.slice(1).join(' ');
            }
        }

        const result = await checkOigExclusion({ npi, lastName, firstName });
        const status: VerificationLog['status'] =
            result.excluded ? 'failed' : result.error ? 'needs_review' : 'passed';

        await logVerification({
            verificationId: uuidv4(),
            providerId: event.providerId,
            verificationType: 'oig',
            requestParams: { npi, lastName, firstName },
            result,
            status,
            verifiedAt: new Date().toISOString(),
        });

        await updateWorkflowStep(event.executionId, 'VERIFY_OIG', 'COMPLETED', {
            excluded: result.excluded,
            npi: result.npi,
            lastName: result.lastName,
            firstName: result.firstName,
            exclusionType: result.exclusionType,
            exclusionDate: result.exclusionDate,
            error: result.error,
        });

        return result;
    } catch (error: any) {
        await updateWorkflowStep(event.executionId, 'VERIFY_OIG', 'FAILED', undefined, error.message);
        throw error;
    }
}

// ========================================
// STEP FUNCTION LAMBDA HANDLER
// ========================================

interface StepFunctionEvent {
    step: string;
    payload: Record<string, any>;
}

export const stepHandler = async (event: StepFunctionEvent, context: Context): Promise<any> => {
    console.log('Step Function task:', event.step, JSON.stringify(event.payload));

    switch (event.step) {
        case 'CLASSIFY_DOCUMENT':
            return handleClassifyDocument(event.payload as DocumentIntakePayload);

        case 'EXTRACT_TEXT':
            return handleExtractText(event.payload as DocumentIntakePayload & { documentType: string });

        case 'VALIDATE_RULES':
            return handleValidateRules(event.payload as { executionId: string; providerId: string });

        case 'CREATE_REVIEW_TASK':
            return handleCreateReviewTask(event.payload as {
                executionId: string;
                providerId: string;
                reviewReason: string;
                taskToken?: string;
            });

        case 'UPDATE_PROFILE':
            return handleUpdateProfile(event.payload as {
                executionId: string;
                providerId: string;
                fieldsToUpdate: Record<string, any>;
            });

        case 'NOTIFY_TEAM':
            return handleNotifyTeam(event.payload as {
                executionId: string;
                providerId: string;
                notificationType: 'SUCCESS' | 'FAILURE' | 'REVIEW_NEEDED';
                message: string;
            });

        case 'COMPLETE_WORKFLOW':
            return handleCompleteWorkflowStep(event.payload as {
                executionId: string;
                status: 'SUCCEEDED' | 'FAILED' | 'PENDING_REVIEW';
                output?: Record<string, any>;
            });

        case 'VERIFY_NPI':
            return handleVerifyNpi(event.payload as VerificationPayload);

        case 'VERIFY_OIG':
            return handleVerifyOig(event.payload as VerificationPayload);

        default:
            throw new Error(`Unknown step: ${event.step}`);
    }
};

// ========================================
// API HANDLER - Workflow Management
// ========================================

let corsHeaders = buildCorsHeaders();

const httpErr = (code: number, msg: string): APIGatewayProxyResult => ({
    statusCode: code,
    headers: corsHeaders,
    body: JSON.stringify({ success: false, message: msg }),
});

const httpOk = (data: Record<string, any>): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ success: true, ...data }),
});

export const apiHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers?.origin || event.headers?.Origin;
    corsHeaders = buildCorsHeaders({}, origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const path = event.path.replace(/^\/credentialing/, '').replace(/\/$/, '');
    const method = event.httpMethod;

    try {
        // POST /workflow/start - Start a new workflow
        if (method === 'POST' && path === '/workflow/start') {
            const body = event.body ? JSON.parse(event.body) : {};
            const { workflowType, providerId, input } = body;

            if (!workflowType || !providerId) {
                return httpErr(400, 'workflowType and providerId are required');
            }

            // Create execution record
            const execution = await createWorkflowExecution(workflowType, providerId, input || {});

            // Start Step Function
            let stateMachineArn = '';
            switch (workflowType) {
                case 'DOCUMENT_INTAKE':
                    stateMachineArn = DOCUMENT_INTAKE_STATE_MACHINE_ARN;
                    break;
                case 'CREDENTIAL_VERIFICATION':
                    stateMachineArn = VERIFICATION_STATE_MACHINE_ARN;
                    break;
                case 'ENROLLMENT_SUBMISSION':
                    stateMachineArn = ENROLLMENT_STATE_MACHINE_ARN;
                    break;
            }

            if (!stateMachineArn) {
                await completeWorkflow(execution.executionId, 'FAILED', {
                    reason: 'State machine not configured for workflowType',
                    workflowType,
                });
                return httpErr(400, `Unsupported workflowType: ${workflowType}`);
            }

            if (stateMachineArn) {
                const sfnResult = await sfn.send(new StartExecutionCommand({
                    stateMachineArn,
                    name: execution.executionId,
                    input: JSON.stringify({
                        executionId: execution.executionId,
                        providerId,
                        ...input,
                    }),
                }));

                // Update execution with SFN ARN
                await ddb.send(new UpdateCommand({
                    TableName: WORKFLOW_EXECUTIONS_TABLE,
                    Key: { executionId: execution.executionId },
                    UpdateExpression: 'SET sfnExecutionArn = :arn',
                    ExpressionAttributeValues: { ':arn': sfnResult.executionArn },
                }));
            }

            return httpOk({ execution });
        }

        // GET /workflow/{executionId} - Get workflow status
        if (method === 'GET' && path.startsWith('/workflow/')) {
            const executionId = path.split('/')[2];
            if (!executionId) {
                return httpErr(400, 'executionId is required');
            }

            const { Item } = await ddb.send(new GetCommand({
                TableName: WORKFLOW_EXECUTIONS_TABLE,
                Key: { executionId },
            }));

            if (!Item) {
                return httpErr(404, 'Workflow not found');
            }

            return httpOk({ execution: Item });
        }

        // GET /workflows?providerId=xxx - List workflows for provider
        if (method === 'GET' && path === '/workflows') {
            const providerId = event.queryStringParameters?.providerId;
            if (!providerId) {
                return httpErr(400, 'providerId query parameter is required');
            }

            const { Items } = await ddb.send(new QueryCommand({
                TableName: WORKFLOW_EXECUTIONS_TABLE,
                IndexName: 'byProvider',
                KeyConditionExpression: 'providerId = :providerId',
                ExpressionAttributeValues: { ':providerId': providerId },
                ScanIndexForward: false,
                Limit: 50,
            }));

            return httpOk({ workflows: Items || [] });
        }

        // POST /workflow/{executionId}/approve - Approve a pending review
        if (method === 'POST' && path.match(/\/workflow\/[^/]+\/approve/)) {
            const executionId = path.split('/')[2];
            const body = event.body ? JSON.parse(event.body) : {};

            // Get the execution
            const { Item: execution } = await ddb.send(new GetCommand({
                TableName: WORKFLOW_EXECUTIONS_TABLE,
                Key: { executionId },
            }));

            if (!execution) {
                return httpErr(404, 'Workflow not found');
            }

            if (execution.status !== 'PENDING_REVIEW') {
                return httpErr(400, 'Workflow is not pending review');
            }

            // Find the associated task with taskToken
            const { Items: tasks } = await ddb.send(new QueryCommand({
                TableName: CREDENTIALING_TASKS_TABLE,
                IndexName: 'byWorkflow',
                KeyConditionExpression: 'workflowExecutionId = :execId',
                ExpressionAttributeValues: { ':execId': executionId },
            }));

            const task = tasks?.find((t: any) => t.taskToken);
            if (task?.taskToken) {
                // Send success to Step Functions to resume workflow
                await sfn.send(new SendTaskSuccessCommand({
                    taskToken: task.taskToken,
                    output: JSON.stringify({ approved: true, ...body }),
                }));
            }

            // Update workflow status
            await completeWorkflow(executionId, 'SUCCEEDED', { approvedBy: body.approvedBy });

            return httpOk({ message: 'Workflow approved' });
        }

        // POST /workflow/{executionId}/reject - Reject a pending review
        if (method === 'POST' && path.match(/\/workflow\/[^/]+\/reject/)) {
            const executionId = path.split('/')[2];
            const body = event.body ? JSON.parse(event.body) : {};

            const { Item: execution } = await ddb.send(new GetCommand({
                TableName: WORKFLOW_EXECUTIONS_TABLE,
                Key: { executionId },
            }));

            if (!execution) {
                return httpErr(404, 'Workflow not found');
            }

            // Find task with token
            const { Items: tasks } = await ddb.send(new QueryCommand({
                TableName: CREDENTIALING_TASKS_TABLE,
                IndexName: 'byWorkflow',
                KeyConditionExpression: 'workflowExecutionId = :execId',
                ExpressionAttributeValues: { ':execId': executionId },
            }));

            const task = tasks?.find((t: any) => t.taskToken);
            if (task?.taskToken) {
                await sfn.send(new SendTaskFailureCommand({
                    taskToken: task.taskToken,
                    error: 'REJECTED',
                    cause: body.reason || 'Rejected by reviewer',
                }));
            }

            await completeWorkflow(executionId, 'FAILED', { rejectedBy: body.rejectedBy, reason: body.reason });

            return httpOk({ message: 'Workflow rejected' });
        }

        return httpErr(404, 'Endpoint not found');
    } catch (error: any) {
        console.error('Workflow error:', error);
        return httpErr(500, error.message);
    }
};
