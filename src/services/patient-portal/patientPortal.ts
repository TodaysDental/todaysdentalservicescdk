import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { APIContracts, APIControllers, Constants } from 'authorizenet';
import { 
  getClinicConfig as getClinicConfigFromDb, 
  getClinicSecrets, 
  getAllClinicConfigs,
  getGlobalSecret,
  ClinicConfig as DbClinicConfig, 
  ClinicSecrets 
} from '../../shared/utils/secrets-helper';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

const {
    SESSION_TABLE_PREFIX,
    SMS_LOG_TABLE_PREFIX,
    DEFAULT_SESSION_TABLE,
    DEFAULT_SMS_LOG_TABLE,
    TF_SFTP_HOST,
    // SFTP password now fetched from GlobalSecrets table dynamically
    PATIENT_PORTAL_METRICS_TABLE
} = process.env;

const API_BASE_URL = 'https://api.opendental.com/api/v1';

// Allowed origins - loaded on first request and cached
let allowedOriginsCache: string[] | null = null;

// Initialize allowed origins from config (call this early in handler)
// Combines DynamoDB data with static list from cors.ts for reliability
async function initAllowedOrigins(): Promise<void> {
    if (allowedOriginsCache) return;
    
    try {
        const configs = await getAllClinicConfigs();
        const dynamoOrigins = configs.map(c => c.websiteLink).filter(Boolean);
        
        // Combine DynamoDB origins with static list for reliability
        // Use Set to avoid duplicates
        allowedOriginsCache = [...new Set([
            'https://todaysdentalinsights.com',
            ...dynamoOrigins,
            ...ALLOWED_ORIGINS_LIST
        ])];
        
        console.log('[CORS] Loaded allowed origins:', allowedOriginsCache.length, 'origins');
    } catch (error) {
        console.warn('[CORS] Failed to load clinic configs from DynamoDB, using static list:', error);
        // Fall back to static list from cors.ts which is built from clinic-config.json
        allowedOriginsCache = ALLOWED_ORIGINS_LIST;
    }
}

function getAllowedOrigins(): string[] {
    return allowedOriginsCache || ['https://todaysdentalinsights.com'];
}

if (!SESSION_TABLE_PREFIX || !SMS_LOG_TABLE_PREFIX || !DEFAULT_SESSION_TABLE || !DEFAULT_SMS_LOG_TABLE) {
    console.error('Missing required environment variables');
    throw new Error('Missing SESSION_TABLE_PREFIX, SMS_LOG_TABLE_PREFIX, DEFAULT_SESSION_TABLE, or DEFAULT_SMS_LOG_TABLE environment variables');
}

// Clinic configuration interface for patient portal
interface ClinicConfig {
    clinicId: string;
    developerKey: string;
    customerKey: string;
    authorizeNetApiLoginId: string;
    authorizeNetTransactionKey: string;
    phoneNumber: string;
    sftpPassword?: string;
    sftpHost?: string;
    sftpPort?: number;
    sftpUsername?: string;
    [key: string]: any;
}

// Get clinic configuration by ID - combining config and secrets
async function getClinicConfig(clinicId: string): Promise<ClinicConfig> {
    const [config, secrets] = await Promise.all([
        getClinicConfigFromDb(clinicId),
        getClinicSecrets(clinicId)
    ]);
    
    if (!config || !secrets) {
        throw new Error(`Clinic configuration not found for clinicId: ${clinicId}`);
    }
    
    return {
        clinicId: config.clinicId,
        developerKey: secrets.openDentalDeveloperKey,
        customerKey: secrets.openDentalCustomerKey,
        authorizeNetApiLoginId: secrets.authorizeNetApiLoginId,
        authorizeNetTransactionKey: secrets.authorizeNetTransactionKey,
        phoneNumber: config.phoneNumber,
        clinicName: config.clinicName,
        clinicEmail: config.clinicEmail,
        clinicPhone: config.clinicPhone,
    };
}

function getCorsHeaders(origin?: string) {
    const allowedOrigins = getAllowedOrigins();
    const isOriginAllowed = origin && allowedOrigins.includes(origin);
    const allowOrigin = isOriginAllowed ? origin : 'https://todaysdentalinsights.com';
    
    if (origin && !isOriginAllowed) {
        console.warn('[CORS] Origin not in allowed list:', { 
            requestOrigin: origin, 
            allowedCount: allowedOrigins.length,
            sampleAllowed: allowedOrigins.slice(0, 5)
        });
    }
    
    return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE'] });
}

// Get clinic-specific table names
function getSessionTableName(clinicId: string): string {
    return `${SESSION_TABLE_PREFIX}${clinicId}`;
}

function getSmsLogTableName(clinicId: string): string {
    return `${SMS_LOG_TABLE_PREFIX}${clinicId}`;
}

// CORS headers will be generated dynamically based on origin

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({});
const s3Client = new S3Client({});

/**
 * Increment a per-day portal metric for a clinic.
 * Best-effort: failures are logged but do not block the main workflow.
 */
async function recordPortalMetric(clinicId: string, metric: PortalMetricKey, increment: number = 1) {
    if (!PATIENT_PORTAL_METRICS_TABLE) return;

    const metricDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)

    try {
        await docClient.send(new UpdateCommand({
            TableName: PATIENT_PORTAL_METRICS_TABLE,
            Key: { clinicId, metricDate },
            UpdateExpression: 'ADD #metric :inc SET lastUpdated = :now',
            ExpressionAttributeNames: { '#metric': metric },
            ExpressionAttributeValues: {
                ':inc': increment,
                ':now': new Date().toISOString(),
            },
        }));
    } catch (err) {
        console.error('Failed to record portal metric', { clinicId, metric, error: err });
    }
}

interface Patient {
    PatNum: number;
    FName: string;
    LName: string;
    WirelessPhone?: string;
    City?: string;
    State?: string;
    Zip?: string;
    [key: string]: any;
}

interface PaymentData {
    PayAmt: number;
    PatNum: number;
    PayDate?: string;
    CheckNum?: string;
    PayNote?: string;
    BankBranch?: string;
    ClinicNum?: number;
    isPatientPreferred?: string;
    isPrepayment?: string;
    procNums?: number[];
    payPlanNum?: number;
}

interface CardDetails {
    cardNumber: string;
    expirationDate: string;
    cardCode: string;
}

type PortalMetricKey =
    | 'appointmentsBooked'
    | 'appointmentFailures'
    | 'newPatientRegistrations'
    | 'registrationFailures'
    | 'documentUploads'
    | 'documentUploadFailures'
    | 'paymentsSucceeded'
    | 'paymentFailures';

const validateSession = async (event: APIGatewayProxyEvent, clinicId: string): Promise<Patient> => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('Invalid authorization header:', authHeader);
        throw { status: 401, message: 'Authorization header is missing or invalid.' };
    }
    const SessionId = authHeader.split(' ')[1];
    console.log(`Validating session for clinicId: ${clinicId}, SessionId: ${SessionId}`);

    const sessionTableName = getSessionTableName(clinicId);
    console.log(`Using session table: ${sessionTableName}`);

    try {
        // Try clinic-specific table first
        try {
            const command = new GetCommand({
                TableName: sessionTableName,
                Key: { SessionId },
            });
            const { Item } = await docClient.send(command);
            if (Item) {
                return validateSessionItem(Item);
            }
        } catch (primaryError: any) {
            // If clinic-specific table doesn't exist, we'll fall back to default
            if (primaryError.name !== 'ResourceNotFoundException') {
                console.error('Unexpected error accessing clinic session table:', primaryError);
            }
        }

        // Fallback to default table
        try {
            const defaultCommand = new GetCommand({
                TableName: DEFAULT_SESSION_TABLE!,
                Key: { SessionId },
            });
            const defaultResult = await docClient.send(defaultCommand);
            if (!defaultResult.Item) {
                console.error('Session not found for SessionId:', SessionId);
                throw { status: 401, message: 'Session not found.' };
            }
            return validateSessionItem(defaultResult.Item);
        } catch (fallbackError: any) {
            console.error('Session not found in default table for SessionId:', SessionId, fallbackError);
            throw { status: 401, message: 'Session not found.' };
        }
    } catch (error: any) {
        console.error('Error in validateSession:', error);
        if (error.status) {
            throw error;
        }
        throw {
            status: 500,
            message: error.message || 'Error validating session.'
        };
    }
};

function validateSessionItem(item: any): Patient {
    if (item.expires < Math.floor(Date.now() / 1000)) {
        console.error('Session expired for SessionId:', item.SessionId, 'Expires:', item.expires);
        throw { status: 401, message: 'Session expired.' };
    }

    if (!item.patient || !item.patient.PatNum) {
        console.error('Invalid patient data in session:', item);
        throw { status: 400, message: 'Invalid patient data in session.' };
    }

    return item.patient as Patient;
}

function normalizePhoneNumber(phone: string): string | null {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, '');
    let normalized = cleaned;
    if (cleaned.length === 10) normalized = '1' + cleaned;
    if (normalized.length === 11 && normalized.startsWith('1')) return '+' + normalized;
    return null;
}

async function logSMS(phoneNumber: string, message: string, status: string, clinicId: string, senderPhoneNumber?: string, messageType?: string, error?: string) {
    const logEntry = {
        LogId: uuidv4(),
        PhoneNumber: phoneNumber,
        Message: message,
        Timestamp: new Date().toISOString(),
        Status: status,
        SenderPhoneNumber: senderPhoneNumber || null,
        MessageType: messageType || 'General',
        Error: error || null,
        ClinicId: clinicId
    };

    const smsLogTableName = getSmsLogTableName(clinicId);

    try {
        const command = new PutCommand({
            TableName: smsLogTableName,
            Item: logEntry
        });
        await docClient.send(command);
        console.log(`SMS log entry created for phone: ${phoneNumber}, status: ${status}, clinic: ${clinicId}`);
    } catch (error: any) {
        // Try fallback to default table if clinic-specific table doesn't exist
        if (error.name === 'ResourceNotFoundException' && DEFAULT_SMS_LOG_TABLE) {
            try {
                const defaultCommand = new PutCommand({
                    TableName: DEFAULT_SMS_LOG_TABLE,
                    Item: logEntry
                });
                await docClient.send(defaultCommand);
                console.log(`SMS log entry created in default table for phone: ${phoneNumber}, status: ${status}, clinic: ${clinicId}`);
            } catch (defaultError) {
                console.error('Error logging SMS to default DynamoDB table:', defaultError);
            }
        } else {
            console.error('Error logging SMS to DynamoDB:', error);
        }
    }
}

async function sendSMS(phoneNumber: string, message: string, clinicConfig: ClinicConfig, messageType: string = 'General') {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
        await logSMS(phoneNumber, message, 'FAILED', clinicConfig.clinicId, undefined, messageType, 'Invalid phone number format');
        console.error('Invalid phone number format:', phoneNumber);
        throw new Error('Invalid phone number format. Must be a valid US phone number.');
    }

    const originationNumber = clinicConfig.phoneNumber;

    const params = {
        Message: message,
        PhoneNumber: normalizedPhone,
        MessageAttributes: {
            'AWS.SNS.SMS.OriginationNumber': {
                DataType: 'String',
                StringValue: originationNumber
            },
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional'
            },
            'MessageType': {
                DataType: 'String',
                StringValue: messageType
            }
        }
    };

    try {
        await snsClient.send(new PublishCommand(params));
        await logSMS(normalizedPhone, message, 'SUCCESS', clinicConfig.clinicId, originationNumber, messageType);
        console.log(`SMS sent successfully to ${normalizedPhone}`);
    } catch (error: any) {
        await logSMS(normalizedPhone, message, 'FAILED', clinicConfig.clinicId, originationNumber, messageType, error.message);
        console.error(`Error sending SMS to ${normalizedPhone}:`, error);
        throw new Error(`Failed to send SMS: ${error.message}`);
    }
}

async function chargeCreditCard(cardDetails: CardDetails, amount: number, clinicConfig: ClinicConfig) {
    try {
        const apiLoginId = clinicConfig.authorizeNetApiLoginId;
        const transactionKey = clinicConfig.authorizeNetTransactionKey;

        if (!apiLoginId || !transactionKey) {
            throw new Error('Missing Authorize.net credentials in environment variables');
        }

        const merchantAuthenticationType = new APIContracts.MerchantAuthenticationType();
        merchantAuthenticationType.setName(apiLoginId);
        merchantAuthenticationType.setTransactionKey(transactionKey);

        const creditCard = new APIContracts.CreditCardType();
        creditCard.setCardNumber(cardDetails.cardNumber);
        creditCard.setExpirationDate(cardDetails.expirationDate);
        creditCard.setCardCode(cardDetails.cardCode);

        const paymentType = new APIContracts.PaymentType();
        paymentType.setCreditCard(creditCard);

        const transactionRequest = new APIContracts.TransactionRequestType();
        transactionRequest.setTransactionType(APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
        transactionRequest.setAmount(parseFloat(amount.toString()));
        transactionRequest.setPayment(paymentType);

        const createRequest = new APIContracts.CreateTransactionRequest();
        createRequest.setMerchantAuthentication(merchantAuthenticationType);
        createRequest.setTransactionRequest(transactionRequest);

        const ctrl = new APIControllers.CreateTransactionController(createRequest.getJSON());
        ctrl.setEnvironment(Constants.endpoint.production); // Or Constants.endpoint.sandbox for testing

        const apiResponse = await new Promise((resolve, reject) => {
            ctrl.execute(() => {
                const response = ctrl.getResponse();
                if (response) {
                    resolve(response);
                } else {
                    reject(new Error('No response from Authorize.net'));
                }
            });
        });

        const response = new APIContracts.CreateTransactionResponse(apiResponse);
        
        if (response.getMessages().getResultCode() !== APIContracts.MessageTypeEnum.OK) {
            const error = response.getMessages().getMessage()[0];
            throw new Error(`Transaction failed: ${error.getCode()} - ${error.getText()}`);
        }

        const transactionResponse = response.getTransactionResponse();

        if (transactionResponse && transactionResponse.getMessages()) {
            return {
                success: true,
                transactionId: transactionResponse.getTransId(),
                message: `Transaction approved: ${transactionResponse.getMessages().getMessage()[0].getDescription()}`,
            };
        } else if (transactionResponse && transactionResponse.getErrors()) {
            const error = transactionResponse.getErrors().getError()[0];
            throw new Error(`Transaction failed with error code ${error.getErrorCode()}: ${error.getErrorText()}`);
        } else {
            throw new Error('Transaction failed for an unknown reason.');
        }

    } catch (error: any) {
        console.error("Authorize.Net Error:", error.message);
        throw new Error(`Error processing transaction: ${error.message}`);
    }
}

async function getPatientAging(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/accountmodules/${patNum}/Aging`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching aging data for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching patient aging data'
        };
    }
}

async function createPayment(paymentData: PaymentData, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/payments`;
    try {
        const response = await axios.post(url, paymentData, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error('Error creating payment:', error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error creating payment in Open Dental'
        };
    }
}

async function getAppointmentById(aptNum: number, patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/appointments?PatNum=${patNum}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER
            }
        });
        const appointment = response.data.find((apt: any) => apt.AptNum === Number(aptNum));
        if (!appointment) {
            throw { status: 404, message: `Appointment with AptNum ${aptNum} not found for PatNum ${patNum}` };
        }
        return appointment;
    } catch (error: any) {
        console.error(`Error fetching appointment ${aptNum}:`, error);
        throw {
            status: error.response?.status || error.status || 500,
            message: error.response?.data?.message || error.message || `Error fetching appointment ${aptNum}`
        };
    }
}

async function breakAppointment(aptNum: number, body: any, patient: Patient, clinicConfig: ClinicConfig) {
    console.log('breakAppointment called with:', { aptNum, body, patient });

    if (!body.PatNum || !Number.isInteger(Number(body.PatNum))) {
        console.error('Invalid or missing PatNum:', body.PatNum);
        throw { status: 400, message: 'PatNum must be a valid integer.' };
    }
    if (!body.AptNum || !Number.isInteger(Number(body.AptNum))) {
        console.error('Invalid or missing AptNum:', body.AptNum);
        throw { status: 400, message: 'AptNum must be a valid integer.' };
    }
    if (body.aptStatus !== 'Broken') {
        console.error('Invalid aptStatus:', body.aptStatus);
        throw { status: 400, message: 'aptStatus must be "Broken" for breaking an appointment.' };
    }
    if (body.PatNum !== patient.PatNum) {
        console.error('PatNum mismatch:', { bodyPatNum: body.PatNum, sessionPatNum: patient.PatNum });
        throw { status: 403, message: 'PatNum in request body does not match authenticated patient.' };
    }
    if (Number(body.AptNum) !== Number(aptNum)) {
        console.error('AptNum mismatch:', { bodyAptNum: body.AptNum, pathAptNum: aptNum });
        throw { status: 400, message: 'AptNum in request body does not match path parameter.' };
    }
    if (body.reason && typeof body.reason !== 'string') {
        console.error('Invalid reason:', body.reason);
        throw { status: 400, message: 'reason must be a string.' };
    }
    const appointment = await getAppointmentById(aptNum, patient.PatNum, clinicConfig);
    if (appointment.AptStatus !== 'Scheduled') {
        console.error('Appointment is not in a cancellable state:', { aptNum, AptStatus: appointment.AptStatus });
        throw { status: 400, message: `Appointment is not cancellable. Current status: ${appointment.AptStatus}` };
    }
    if (new Date(appointment.AptDateTime) <= new Date()) {
        console.error('Appointment is in the past:', { aptNum, AptDateTime: appointment.AptDateTime });
        throw { status: 400, message: 'Cannot cancel a past appointment.' };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/appointments/${aptNum}`;

    try {
        const payload = {
            PatNum: body.PatNum,
            AptNum: body.AptNum,
            AptStatus: 'Broken',
            Note: body.reason || 'Cancelled by patient via portal',
            ClinicNum: appointment.ClinicNum || 0
        };

        console.log(`Sending PUT request to ${url} with payload:`, JSON.stringify(payload, null, 2));
        
        const response = await axios.put(url, payload, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });

        console.log('Open Dental API response:', response.status, JSON.stringify(response.data, null, 2));

        const phoneNumber = patient.WirelessPhone;
        const fname = patient.FName;
        if (phoneNumber && fname) {
            const message = `Dear ${fname}, your appointment (ID: ${aptNum}) has been cancelled. Reply 'Reschedule' to change or contact us for assistance.`;
            try {
                await sendSMS(phoneNumber, message, clinicConfig, 'AppointmentCancellation');
                const sessionTableName = getSessionTableName(clinicConfig.clinicId);
                const sessionItem = {
                    SessionId: normalizePhoneNumber(phoneNumber),
                    appointment: { aptNum, status: 'canceled' },
                    expires: Math.floor(Date.now() / 1000) + 86400
                };
                
                try {
                    const command = new PutCommand({
                        TableName: sessionTableName,
                        Item: sessionItem
                    });
                    await docClient.send(command);
                } catch (tableError: any) {
                    // Try fallback to default table
                    if (tableError.name === 'ResourceNotFoundException' && DEFAULT_SESSION_TABLE) {
                        const defaultCommand = new PutCommand({
                            TableName: DEFAULT_SESSION_TABLE,
                            Item: sessionItem
                        });
                        await docClient.send(defaultCommand);
                    }
                }
                console.log('SMS sent and appointment status stored in DynamoDB for phone:', phoneNumber);
            } catch (smsError) {
                console.error('Error in SMS or DynamoDB operation:', smsError);
            }
        } else {
            console.warn('Skipping SMS notification due to missing phoneNumber or fname:', { phoneNumber, fname });
        }
        return response.data;

    } catch (error: any) {
        console.error('Error breaking appointment:', error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || error.response?.data || 'Error breaking appointment. Please check appointment details or contact support.'
        };
    }
}

async function updateAppointment(aptNum: number, body: any, patient: Patient, clinicConfig: ClinicConfig) {
    console.log('updateAppointment called with:', { aptNum, body, patient });

    if (!body.AptDateTime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(body.AptDateTime)) {
        console.error('Invalid or missing AptDateTime:', body.AptDateTime);
        throw { status: 400, message: 'AptDateTime must be in yyyy-mm-ddThh:mm:ss format.' };
    }
    if (!body.ProvNum || !Number.isInteger(Number(body.ProvNum))) {
        console.error('Invalid or missing ProvNum:', body.ProvNum);
        throw { status: 400, message: 'ProvNum must be a valid integer.' };
    }
    if (!body.Op || !Number.isInteger(Number(body.Op))) {
        console.error('Invalid or missing Op:', body.Op);
        throw { status: 400, message: 'Op must be a valid integer.' };
    }
    if (!body.Pattern || typeof body.Pattern !== 'string') {
        console.error('Invalid or missing Pattern:', body.Pattern);
        throw { status: 400, message: 'Pattern must be a string.' };
    }
    if (body.AptStatus && !['Scheduled', 'Planned', 'Unscheduled'].includes(body.AptStatus)) {
        console.error('Invalid AptStatus:', body.AptStatus);
        throw { status: 400, message: 'AptStatus must be one of: Scheduled, Planned, Unscheduled.' };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/appointments/${aptNum}`;
    try {
        const response = await axios.put(url, body, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        console.log('Open Dental API response:', response.status, JSON.stringify(response.data, null, 2));

        const phoneNumber = patient.WirelessPhone;
        const fname = patient.FName;
        if (phoneNumber && fname) {
            const aptDateTime = body.AptDateTime || response.data.AptDateTime;
            const message = `Dear ${fname}, your appointment (ID: ${aptNum}) has been rescheduled to ${aptDateTime}. Reply 'Confirm' to confirm or 'Reschedule' to change.`;
            try {
                await sendSMS(phoneNumber, message, clinicConfig, 'AppointmentReschedule');
                const sessionTableName = getSessionTableName(clinicConfig.clinicId);
                const sessionItem = {
                    SessionId: normalizePhoneNumber(phoneNumber),
                    appointment: { aptNum, aptDateTime, patNum: patient.PatNum, status: 'rescheduled' },
                    expires: Math.floor(Date.now() / 1000) + 86400
                };
                
                try {
                    const command = new PutCommand({
                        TableName: sessionTableName,
                        Item: sessionItem
                    });
                    await docClient.send(command);
                } catch (tableError: any) {
                    // Try fallback to default table
                    if (tableError.name === 'ResourceNotFoundException' && DEFAULT_SESSION_TABLE) {
                        const defaultCommand = new PutCommand({
                            TableName: DEFAULT_SESSION_TABLE,
                            Item: sessionItem
                        });
                        await docClient.send(defaultCommand);
                    }
                }
                console.log('SMS sent and appointment status stored in DynamoDB for phone:', phoneNumber);
            } catch (smsError) {
                console.error('Error in SMS or DynamoDB operation:', smsError);
            }
        } else {
            console.warn('Skipping SMS notification due to missing phoneNumber or fname:', { phoneNumber, fname });
        }

        return response.data;
    } catch (error: any) {
        console.error('Error updating appointment:', error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error updating appointment'
        };
    }
}

async function createAppointment(body: any, patient: Patient, clinicConfig: ClinicConfig) {
    console.log('createAppointment called with body:', JSON.stringify(body, null, 2), 'and patient:', JSON.stringify(patient, null, 2));

    if (!body.PatNum || !Number.isInteger(Number(body.PatNum))) {
        console.error('Invalid or missing PatNum:', body.PatNum);
        throw { status: 400, message: 'PatNum must be a valid integer.' };
    }
    if (!body.AptDateTime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(body.AptDateTime)) {
        console.error('Invalid or missing AptDateTime:', body.AptDateTime);
        throw { status: 400, message: 'AptDateTime must be in yyyy-mm-ddThh:mm:ss format.' };
    }
    if (!body.ProvNum || !Number.isInteger(Number(body.ProvNum))) {
        console.error('Invalid or missing ProvNum:', body.ProvNum);
        throw { status: 400, message: 'ProvNum must be a valid integer.' };
    }
    if (!body.Op || !Number.isInteger(Number(body.Op))) {
        console.error('Invalid or missing Op:', body.Op);
        throw { status: 400, message: 'Op must be a valid integer.' };
    }
    if (!body.Pattern || typeof body.Pattern !== 'string') {
        console.error('Invalid or missing Pattern:', body.Pattern);
        throw { status: 400, message: 'Pattern must be a string.' };
    }
    if (body.ClinicNum && !Number.isInteger(Number(body.ClinicNum))) {
        console.error('Invalid ClinicNum:', body.ClinicNum);
        throw { status: 400, message: 'ClinicNum must be a valid integer.' };
    }
    if (body.Note && typeof body.Note !== 'string') {
        console.error('Invalid Note:', body.Note);
        throw { status: 400, message: 'Note must be a string.' };
    }
    if (body.AptStatus && !['Scheduled', 'Planned', 'Unscheduled'].includes(body.AptStatus)) {
        console.error('Invalid AptStatus:', body.AptStatus);
        throw { status: 400, message: 'AptStatus must be one of: Scheduled, Planned, Unscheduled.' };
    }
    if (body.PatNum !== patient.PatNum) {
        console.error('PatNum mismatch:', { bodyPatNum: body.PatNum, sessionPatNum: patient.PatNum });
        throw { status: 403, message: 'PatNum in request body does not match authenticated patient.' };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/appointments`;
    console.log(`Sending POST request to ${url} with body:`, JSON.stringify(body, null, 2));

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        console.log('Open Dental API response:', response.status, JSON.stringify(response.data, null, 2));

        const phoneNumber = patient.WirelessPhone;
        const fname = patient.FName;
        if (phoneNumber && fname) {
            try {
                const aptDateTime = body.AptDateTime || response.data.AptDateTime;
                const aptNum = response.data.AptNum;
                const message = `Dear ${fname}, your appointment (ID: ${aptNum}) is confirmed for ${aptDateTime}. Reply 'Confirm' to confirm, 'Reschedule' to change, or 'Cancel' to cancel.`;
                await sendSMS(phoneNumber, message, clinicConfig, 'AppointmentConfirmation');

                const sessionTableName = getSessionTableName(clinicConfig.clinicId);
                const sessionItem = {
                    SessionId: normalizePhoneNumber(phoneNumber),
                    appointment: { aptNum, aptDateTime, patNum: patient.PatNum, status: 'confirmed' },
                    expires: Math.floor(Date.now() / 1000) + 86400
                };
                
                try {
                    const command = new PutCommand({
                        TableName: sessionTableName,
                        Item: sessionItem
                    });
                    await docClient.send(command);
                } catch (tableError: any) {
                    // Try fallback to default table
                    if (tableError.name === 'ResourceNotFoundException' && DEFAULT_SESSION_TABLE) {
                        const defaultCommand = new PutCommand({
                            TableName: DEFAULT_SESSION_TABLE,
                            Item: sessionItem
                        });
                        await docClient.send(defaultCommand);
                    }
                }
                console.log('Appointment details stored in DynamoDB for phone:', phoneNumber);
            } catch (smsError) {
                console.error('Error in SMS or DynamoDB operation:', smsError);
                console.warn('Continuing despite SMS/DynamoDB error to return successful appointment creation.');
            }
        } else {
            console.warn('Skipping SMS notification due to missing phoneNumber or fname:', { phoneNumber, fname });
        }

        return response.data;
    } catch (error: any) {
        console.error('Error creating appointment:', error);
        if (error.response?.status === 400) {
            throw {
                status: 400,
                message: error.response?.data?.message || 'Invalid appointment data. Please check PatNum, AptDateTime, ProvNum, and other required fields.'
            };
        }
        if (error.response?.status === 401) {
            throw {
                status: 401,
                message: 'Unauthorized. Please verify API keys or contact Open Dental support.'
            };
        }
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error creating appointment'
        };
    }
}

async function getAppointments(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/appointments?PatNum=${encodeURIComponent(String(patNum))}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching appointments for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching appointments'
        };
    }
}

async function getProcedureLogs(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/procedurelogs?PatNum=${encodeURIComponent(String(patNum))}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching procedure logs for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching procedure logs'
        };
    }
}
async function getTreatmentPlans(
  patNum: number,
  clinicConfig: ClinicConfig,
  tpStatus?: string // e.g. "Saved", "Active", "Inactive" (whatever your OD allows)
) {
  const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
  // Build the exact OD URL you shared
  const url =
    `${API_BASE_URL}/treatplans?PatNum=${encodeURIComponent(String(patNum))}` +
    (tpStatus ? `&TPStatus=${encodeURIComponent(tpStatus)}` : '');

  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: AUTH_HEADER,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    const data = resp.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return [data];
    return [];
  } catch (err: any) {
    // OD commonly returns 404 when there are no plans (or for an unknown status) – return empty list
    if (err?.response?.status === 404) return [];
    if (err?.response?.status === 401)
      throw { status: 401, message: 'Unauthorized. Please verify Open Dental API credentials.' };
    if (err?.response?.status === 400)
      throw { status: 400, message: err?.response?.data?.message || 'Invalid request for treatment plans.' };

    throw {
      status: err?.response?.status || 500,
      message: err?.response?.data?.message || 'Error fetching treatment plans',
    };
  }
}


async function getCommLogs(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/commlogs?PatNum=${encodeURIComponent(String(patNum))}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching comm logs for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching comm logs'
        };
    }
}

async function getDocuments(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/documents?PatNum=${encodeURIComponent(String(patNum))}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching documents for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching documents'
        };
    }
}

async function getAppointmentSlots(queryParams: any, clinicConfig: ClinicConfig) {
    const { Date, ProvNum, OpNum } = queryParams;
    if (!Date) {
        throw { status: 400, message: 'Date parameter is required for appointment slots' };
    }
    
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    let url = `${API_BASE_URL}/appointments/slots?Date=${encodeURIComponent(Date)}`;
    if (ProvNum) url += `&ProvNum=${encodeURIComponent(ProvNum)}`;
    if (OpNum) url += `&OpNum=${encodeURIComponent(OpNum)}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching appointment slots:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching appointment slots'
        };
    }
}

// Enhanced getSchedules to support all Open Dental query params
async function getSchedules(queryParams: any, clinicConfig: ClinicConfig) {
    // Supported params: date, dateStart, dateEnd, SchedType, BlockoutDefNum, ProvNum, EmployeeNum
    const allowedParams = [
        'date', 'dateStart', 'dateEnd', 'SchedType', 'BlockoutDefNum', 'ProvNum', 'EmployeeNum'
    ];
    const params: Record<string, string> = {};
    for (const key of allowedParams) {
        if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
            params[key] = queryParams[key];
        }
    }
    // Default to today's date if no date params provided
    if (!params.date && !params.dateStart && !params.dateEnd) {
        params.date = new Date().toISOString().slice(0, 10);
    }
    const search = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/schedules${search ? '?' + search : ''}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching schedules:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching schedules'
        };
    }
}

// Get a single schedule by ScheduleNum
async function getScheduleByNum(scheduleNum: string, clinicConfig: ClinicConfig) {
    if (!scheduleNum) {
        throw { status: 400, message: 'ScheduleNum is required' };
    }
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/schedules/${encodeURIComponent(scheduleNum)}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching schedule ${scheduleNum}:`, error);
        if (error.response?.status === 404) {
            throw { status: 404, message: 'Schedule not found' };
        }
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching schedule'
        };
    }
}

async function getPatientNotes(patNum: number, clinicConfig: ClinicConfig) {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/patientnotes/${patNum}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching patient notes for PatNum ${patNum}:`, error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching patient notes'
        };
    }
}

async function getAccountModuleData(patNum: number, moduleType: string, queryParams: any, clinicConfig: ClinicConfig) {
    const moduleTypeMap: { [key: string]: string } = {
        'aging': 'Aging',
        'patientbalances': 'PatientBalances',
        'servicedateview': 'ServiceDateView'
    };

    const mappedModuleType = moduleTypeMap[moduleType.toLowerCase()];
    if (!mappedModuleType) {
        console.error(`Unsupported account module type: ${moduleType}`);
        throw { status: 400, message: `Unsupported account module type: ${moduleType}. Supported: aging, patientbalances, servicedateview` };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    let url = `${API_BASE_URL}/accountmodules/${patNum}/${mappedModuleType}`;
    
    if (moduleType.toLowerCase() === 'servicedateview' && queryParams.isFamily) {
        url += `?isFamily=${encodeURIComponent(queryParams.isFamily)}`;
    }

    console.log(`Sending request to ${url} with headers:`, { Authorization: AUTH_HEADER });

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Open Dental API response for ${url}:`, response.status, JSON.stringify(response.data, null, 2));

        switch (moduleType.toLowerCase()) {
            case 'aging':
                if (!response.data || typeof response.data !== 'object') {
                    throw { status: 500, message: 'Invalid Aging response format' };
                }
                return response.data;
            case 'patientbalances':
                if (!Array.isArray(response.data)) {
                    throw { status: 500, message: 'Invalid PatientBalances response format' };
                }
                return response.data;
            case 'servicedateview':
                if (!Array.isArray(response.data)) {
                    throw { status: 500, message: 'Invalid ServiceDateView response format' };
                }
                return response.data;
            default:
                throw { status: 400, message: `Unsupported account module type: ${moduleType}` };
        }
    } catch (error: any) {
        console.error(`Error fetching account module data for ${moduleType}:`, error);
        console.error('Error details:', {
            url,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
            patNum,
            moduleType,
            clinicId: clinicConfig.clinicId
        });
        
        if (error.response?.status === 400 && error.response?.data?.includes('not a valid method')) {
            throw {
                status: 400,
                message: `The ${moduleType} module is not accessible with the current API configuration. Please verify API permissions or contact Open Dental support.`
            };
        }
        
        if (error.response?.status === 401) {
            throw {
                status: 401,
                message: `Unauthorized access to Open Dental API. Please verify API credentials for clinic ${clinicConfig.clinicId}`
            };
        }
        
        if (error.response?.status === 404) {
            throw {
                status: 404,
                message: `Patient ${patNum} not found or ${moduleType} data not available`
            };
        }
        
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || error.message || `Error fetching account module data for ${moduleType}`
        };
    }
}

async function findPatient(params: any, clinicConfig: ClinicConfig) {
    console.log('findPatient called with params:', params);
    const { FName, LName, Birthdate } = params;

    if (!LName || !Birthdate) {
        console.error('Missing required parameters:', { LName, Birthdate });
        throw { status: 400, message: 'LName and Birthdate are required query parameters.' };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(Birthdate)) {
        console.error('Invalid Birthdate format:', Birthdate);
        throw { status: 400, message: 'Birthdate must be in yyyy-mm-dd format.' };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    // The API search uses LName to get a list of potential candidates.
    // We can't always trust its date filter, so we filter manually.
    const url = `${API_BASE_URL}/patients?LName=${encodeURIComponent(LName)}&Birthdate=${encodeURIComponent(Birthdate)}`;
    
    try {
        const response = await axios.get(url, { headers: { 'Authorization': AUTH_HEADER } });
        const patientsFromApi = response.data;

        // --- CRITICAL FIX: Manually filter the results for an EXACT date match ---
        // The API might return patients with the same last name but different birthdays.
        // We ensure we only work with patients who match both criteria.
        const strictlyMatchedPatients = patientsFromApi.filter((patient: any) => 
            patient.Birthdate.startsWith(Birthdate)
        );
        // Using .startsWith() is robust for dates, as the API might return 'YYYY-MM-DDTHH:MM:SS'.

        console.log(`Found ${strictlyMatchedPatients.length} patient(s) with exact LName and Birthdate match.`);

        let patientToLogin = null;

        if (strictlyMatchedPatients.length === 1) {
            // SCENARIO 1: Perfect, unambiguous match.
            patientToLogin = strictlyMatchedPatients[0];

        } else if (strictlyMatchedPatients.length > 1) {
            // SCENARIO 2: Multiple records with the SAME LName and DOB exist. Ambiguity.
            if (FName) {
                // If a First Name was provided, try to find the specific patient.
                patientToLogin = strictlyMatchedPatients.find((p: any) => p.FName.toLowerCase() === FName.toLowerCase());
            } else {
                // No First Name provided yet. Signal ambiguity to the frontend.
                console.log('Ambiguity detected. Signaling frontend to ask for First Name.');
                return { ambiguous: true, message: "Multiple records found. Please provide a first name to continue." };
            }
        }
        
        // If we reach here with no patientToLogin, it means either 0 records were found,
        // or multiple were found but the provided FName didn't match any of them.
        if (!patientToLogin) {
            console.log('No specific patient record found to log in.');
            return null; // This tells the frontend the user is a new patient.
        }

        // --- SUCCESS: We have a single, specific patient to log in ---
        console.log('Logging in patient:', patientToLogin.PatNum);
        const SessionId = uuidv4();
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const sessionTableName = getSessionTableName(clinicConfig.clinicId);
        const sessionItem = { SessionId, patient: patientToLogin, expires };

        try {
            await docClient.send(new PutCommand({ TableName: sessionTableName, Item: sessionItem }));
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException' && DEFAULT_SESSION_TABLE) {
                await docClient.send(new PutCommand({ TableName: DEFAULT_SESSION_TABLE, Item: sessionItem }));
            } else { throw error; }
        }

        return { token: SessionId, patient: patientToLogin };

    } catch (error: any) {
        if (error.response?.status === 404) {
             // A 404 from Open Dental also means no patient was found.
             console.log('Received 404 from Open Dental, indicating no patient found.');
             return null;
        }
        console.error('Unhandled error in findPatient:', error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error fetching patient data'
        };
    }
}

async function createPatient(body: any, clinicConfig: ClinicConfig) {
    // Validate required fields
    const { FName, LName, Birthdate, WirelessPhone } = body;
    const requiredFields = [
        ['FName', FName],
        ['LName', LName],
        ['Birthdate', Birthdate],
        ['WirelessPhone', WirelessPhone]
    ];

    const missingFields = requiredFields.filter(([field, value]) => !value);
    if (missingFields.length > 0) {
        throw {
            status: 400,
            message: `Missing required fields: ${missingFields.map(([field]) => field).join(', ')}`
        };
    }

    // Validate birthdate format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(Birthdate)) {
        throw {
            status: 400,
            message: 'Birthdate must be in yyyy-mm-dd format'
        };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/patients`;
    try {
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error('Error creating patient:', error);
        throw {
            status: error.response?.status || 500,
            message: error.response?.data?.message || 'Error creating patient in Open Dental'
        };
    }
}

function getImageTypeFromExtension(extension: string): string {
    const ext = extension.toLowerCase();
    
    // Map file extensions to Open Dental image types
    const imageTypes: { [key: string]: string } = {
        '.jpg': 'Photo',
        '.jpeg': 'Photo',
        '.png': 'Photo',
        '.gif': 'Photo',
        '.bmp': 'Photo',
        '.tiff': 'Radiograph',
        '.tif': 'Radiograph',
        '.pdf': 'Document',
        '.doc': 'Document',
        '.docx': 'Document',
        '.txt': 'Document',
        '.rtf': 'Document'
    };
    
    return imageTypes[ext] || 'Document';
}

// Consolidated SFTP configuration (no longer need per-clinic credentials)

async function downloadDocumentFromSftp(docNum: number, clinicConfig: ClinicConfig): Promise<{ fileBuffer: Buffer; fileName: string; mimeType: string }> {
    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    
    // First get document details
    try {
        const docResponse = await axios.get(`${API_BASE_URL}/documents/${docNum}`, {
            headers: {
                'Authorization': AUTH_HEADER
            }
        });
        
        const document = docResponse.data;
        
        // Validate document exists and has a file
        if (!document || !document.FileName) {
            throw new Error('Document not found or has no associated file');
        }
        
        // Check if this is a mount (mounts have MountNum instead of DocNum)
        if (document.MountNum && !document.DocNum) {
            throw new Error('Mount downloads are not supported through this endpoint. Please contact support for mount access.');
        }
        
        const fileName = document.FileName;
        
        // Use consolidated SFTP configuration for all clinics
        // Host from environment, password from GlobalSecrets table
        const sftpPassword = await getGlobalSecret('consolidated_sftp', 'password');
        if (!TF_SFTP_HOST || !sftpPassword) {
            throw new Error('SFTP configuration not available');
        }
        
        const sftpHost = TF_SFTP_HOST;
        const sftpPort = 22;
        const sftpUsername = 'sftpuser';
        
        // According to our Transfer Family config, place files at the root of the SFTP home
        // Use format: hostname/filename (no subdirectory)
        const sftpAddress = `${sftpHost}/${fileName}`;
        
        console.log('Using SFTP configuration:', {
            sftpHost,
            sftpPort,
            sftpUsername,
            sftpAddress,
            fileName,
            clinicId: clinicConfig.clinicId
        });
        
        // Call Open Dental DownloadSftp API
        const downloadResponse = await axios.post(`${API_BASE_URL}/documents/DownloadSftp`, {
            DocNum: docNum,
            SftpAddress: sftpAddress,
            SftpUsername: sftpUsername,
            SftpPassword: sftpPassword
        }, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Document downloaded to SFTP:', downloadResponse.data);
        
        // Now retrieve the file from S3 (since SFTP is backed by S3)
        // Use the Transfer Family bucket - should be consistent with consolidatedTransferAuth.ts
        const bucketName = process.env.TF_BUCKET || 'todaysdentalinsights-sftp';
        // The S3 key maps to the user's logical home directory: sftp-home/sftpuser/filename
        const s3Key = `sftp-home/sftpuser/${fileName}`;
        
        // Add a small delay to ensure the file is available in S3
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
            const s3Response = await s3Client.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: s3Key
            }));
            
            if (!s3Response.Body) {
                throw new Error('Empty file received from S3');
            }
            
            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            const stream = s3Response.Body as any;
            
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            
            const fileBuffer = Buffer.concat(chunks);
            
            // Validate file size
            if (fileBuffer.length === 0) {
                throw new Error('Downloaded file is empty');
            }
            
            // Determine MIME type based on file extension
            const mimeType = getMimeType(fileName);
            
            return {
                fileBuffer,
                fileName,
                mimeType
            };
            
        } catch (s3Error: any) {
            console.error('Error retrieving file from S3:', s3Error);
            if (s3Error.name === 'NoSuchKey') {
                throw new Error('Document file not found on server. The file may have been moved or deleted.');
            }
            throw new Error(`Failed to retrieve document file: ${s3Error.message}`);
        }
        
    } catch (axiosError: any) {
        console.error('Error in document download process:', axiosError);
        if (axiosError.response?.status === 404) {
            throw new Error('Document not found');
        }
        if (axiosError.response?.status === 401) {
            throw new Error('Unauthorized access to document');
        }
        if (axiosError.message) {
            throw new Error(axiosError.message);
        }
        throw new Error('Failed to download document. Please try again later.');
    }
}

function getMimeType(fileName: string): string {
    const extension = fileName.toLowerCase().split('.').pop();
    
    const mimeTypes: { [key: string]: string } = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'bmp': 'image/bmp',
        'tiff': 'image/tiff',
        'tif': 'image/tiff',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'txt': 'text/plain',
        'rtf': 'application/rtf',
        'dcm': 'application/dicom'
    };
    
    return mimeTypes[extension || ''] || 'application/octet-stream';
}

// Additional helper functions - simplified versions from original
async function getChartModuleData(patNum: number, moduleType: string, clinicConfig: ClinicConfig) {
    const moduleTypeMap: { [key: string]: { endpoint: string; method: string } } = {
        'plannedappts': { endpoint: `chartmodules/${patNum}/PlannedAppts`, method: 'get' },
        'patientinfo': { endpoint: `patients/${patNum}`, method: 'get' }
    };

    const moduleConfig = moduleTypeMap[moduleType.toLowerCase()];
    if (!moduleConfig) {
        console.error(`Invalid module type: ${moduleType}`);
        throw { status: 400, message: `Invalid module type: ${moduleType}. Supported types: plannedappts, patientinfo` };
    }

    const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
    const url = `${API_BASE_URL}/${moduleConfig.endpoint}`;
    console.log(`Sending request to ${url} with headers:`, { Authorization: AUTH_HEADER });

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Open Dental API response for ${url}:`, response.status, JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error: any) {
        console.error(`Error fetching chart module data for PatNum ${patNum}, ModuleType ${moduleType}:`, error);
        if (error.response?.status === 400 && error.response?.data?.includes('not a valid method')) {
            throw {
                status: 400,
                message: `The ${moduleType} module is not accessible with the current API configuration. Please verify API permissions or contact Open Dental support.`
            };
        }
        throw {
            status: error.response?.status || 500,
            message: error.response?.data || `Error fetching chart module data for ${moduleType}`
        };
    }
}

// Main handler function
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Initialize allowed origins on first request
    await initAllowedOrigins();
    
    // Always set CORS headers first, even for early errors
    const origin = event.headers?.origin || event.headers?.Origin;
    const corsHeaders = getCorsHeaders(origin);
    
    console.log('Received event:', JSON.stringify(event, null, 2));
    console.log('Request origin:', origin);
    console.log('CORS headers being set:', corsHeaders);

    const incomingMethod = event.httpMethod;
    
    // Declare variables at function scope for error handling
    let httpMethod = incomingMethod || 'GET';
    let normalizedResource = '/';
    let clinicId = '';
    if (incomingMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        // Extract clinic ID from path parameters or path for custom domain
        const pathParams = event.pathParameters || {};
        clinicId = pathParams['clinicId'] || '';
        
        // If no clinicId from path parameters (custom domain case), extract from path
        if (!clinicId) {
            const pathSegments = (event.path || '').split('/').filter(Boolean);
            clinicId = pathSegments[0]; // First segment after domain should be clinicId
        }
        
        if (!clinicId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'clinicId is required in path parameters' })
            };
        }

        console.log(`Processing request for clinic: ${clinicId}`);

        // Get clinic configuration
        let clinicConfig: ClinicConfig;
        try {
            clinicConfig = await getClinicConfig(clinicId);
        } catch (error: any) {
            console.error('Error getting clinic config:', error);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: error.message })
            };
        }

        const resourceRaw = event.resource || '/';
        const pathRaw = event.path || resourceRaw;
        const resource = resourceRaw.includes('{proxy+') ? pathRaw : resourceRaw;
        
        // Handle both direct API Gateway and custom domain paths
        // Direct API Gateway: /patientportal/{clinicId}/patients/simple
        // Custom domain: /{clinicId}/patients/simple (base path already removed)
        if (resource.startsWith('/patientportal/')) {
            // Direct API Gateway URL - remove /patientportal/{clinicId}
            normalizedResource = resource.replace(/^\/patientportal\/[^\/]+/, '').toLowerCase();
        } else {
            // Custom domain URL - remove /{clinicId}
            normalizedResource = resource.replace(/^\/[^\/]+/, '').toLowerCase();
        }
        if (!normalizedResource) normalizedResource = '/';
        
        // Clean up any double slashes
        normalizedResource = normalizedResource.replace(/\/+/g, '/');
        
        httpMethod = incomingMethod || 'GET';

        let queryParams = event.queryStringParameters || {};

        let body: any;
        try {
            body = event.body ? JSON.parse(event.body) : {};
        } catch (error) {
            console.error('Error parsing request body:', error);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Invalid JSON in request body.' })
            };
        }

        let response: any;
        let patient: Patient;

        const routeKey = `${httpMethod} ${normalizedResource}`;
        console.log('Route key:', routeKey);

        // Handle all the same routes as the original patientportal.js
        switch (true) {
            case routeKey === 'GET /patients/simple':
            case normalizedResource.startsWith('/patients/simple') && httpMethod === 'GET':
                response = await findPatient(queryParams, clinicConfig);
                break;
            case routeKey === 'POST /patients':
            case normalizedResource === '/patients' && httpMethod === 'POST':
                try {
                    response = await createPatient(body, clinicConfig);
                    await recordPortalMetric(clinicId, 'newPatientRegistrations');
                } catch (err) {
                    await recordPortalMetric(clinicId, 'registrationFailures');
                    throw err;
                }
                break;
	    // GET /treatmentplans  (PatNum from query or session)
case normalizedResource === '/treatmentplans' && httpMethod === 'GET': {
  const patient = await validateSession(event, clinicId);
  const patNum = queryParams.PatNum ? Number(queryParams.PatNum) : Number(patient.PatNum);
  if (!patNum || Number.isNaN(patNum)) {
    throw { status: 400, message: 'PatNum must be provided as a query parameter or be present in session.' };
  }

  // NEW: normalize TPStatus from query
  const tpStatus: string | undefined =
    (queryParams as any)?.TPStatus ??
    (queryParams as any)?.tpStatus ??
    (queryParams as any)?.tpstatus ??
    undefined;

  response = await getTreatmentPlans(patNum, clinicConfig, tpStatus);
  break;
}

            case routeKey === 'POST /logout':
                const authHeader = event.headers?.Authorization || event.headers?.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const SessionId = authHeader.split(' ')[1];
                    const sessionTableName = getSessionTableName(clinicId);
                    
                    try {
                        const command = new DeleteCommand({
                            TableName: sessionTableName,
                            Key: { SessionId },
                        });
                        await docClient.send(command);
                    } catch (error: any) {
                        // Try fallback to default table
                        if (error.name === 'ResourceNotFoundException' && DEFAULT_SESSION_TABLE) {
                            const defaultCommand = new DeleteCommand({
                                TableName: DEFAULT_SESSION_TABLE,
                                Key: { SessionId },
                            });
                            await docClient.send(defaultCommand);
                        }
                        // Continue regardless of delete success - logout should always succeed
                    }
                }
                response = { message: 'Logged out successfully' };
                break;
            case /\/chartmodules\/.+\/.+/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const [, , patNum, moduleType] = normalizedResource.split('/');
                if (moduleType && moduleType.toLowerCase() === 'patientinfo') {
                    if (Number(patNum) !== Number(patient.PatNum)) {
                        throw { status: 403, message: 'PatNum in path does not match authenticated patient.' };
                    }
                    response = patient;
                    break;
                }
                try {
                    response = await getChartModuleData(parseInt(patNum), moduleType, clinicConfig);
                } catch (chartErr: any) {
                    console.error('Chart module fetch failed, attempting fallback if applicable:', chartErr);
                    // Best-effort fallback for PlannedAppts: try appointments list
                    if (moduleType && moduleType.toLowerCase() === 'plannedappts') {
                        try {
                            const appts = await getAppointments(parseInt(patNum), clinicConfig);
                            response = appts || [];
                            break;
                        } catch (fallbackErr) {
                            console.error('Fallback to appointments failed, returning empty array for PlannedAppts:', fallbackErr);
                            response = [];
                            break;
                        }
                    }
                    throw chartErr;
                }
                break;
            }
            case normalizedResource.startsWith('/appointments/slots') && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                response = await getAppointmentSlots(queryParams, clinicConfig);
                break;
            }
            case normalizedResource.startsWith('/appointments') && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const patNum = queryParams.PatNum ? Number(queryParams.PatNum) : Number(patient.PatNum);
                if (!patNum || Number.isNaN(patNum)) {
                    throw { status: 400, message: 'PatNum must be provided as a query parameter or in session.' };
                }
                response = await getAppointments(patNum, clinicConfig);
                break;
            }
            case normalizedResource === '/procedurelogs' && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const patNum = queryParams.PatNum ? Number(queryParams.PatNum) : Number(patient.PatNum);
                if (!patNum || Number.isNaN(patNum)) {
                    throw { status: 400, message: 'PatNum must be provided as a query parameter or in session.' };
                }
                response = await getProcedureLogs(patNum, clinicConfig);
                break;
            }
            case normalizedResource === '/commlogs' && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const patNum = queryParams.PatNum ? Number(queryParams.PatNum) : Number(patient.PatNum);
                if (!patNum || Number.isNaN(patNum)) {
                    throw { status: 400, message: 'PatNum must be provided as a query parameter or in session.' };
                }
                response = await getCommLogs(patNum, clinicConfig);
                break;
            }
            case normalizedResource === '/documents' && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const patNum = queryParams.PatNum ? Number(queryParams.PatNum) : Number(patient.PatNum);
                if (!patNum || Number.isNaN(patNum)) {
                    throw { status: 400, message: 'PatNum must be provided as a query parameter or in session.' };
                }
                response = await getDocuments(patNum, clinicConfig);
                break;
            }
            case normalizedResource === '/schedules' && httpMethod === 'GET': {
                // No session validation: open endpoint
                response = await getSchedules(queryParams, clinicConfig);
                break;
            }
            // GET /schedules/:ScheduleNum
            case /^\/schedules\/(\d+)$/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const scheduleNum = normalizedResource.split('/')[2];
                response = await getScheduleByNum(scheduleNum, clinicConfig);
                break;
            }
            case /\/patientnotes\/.+/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const patNum = normalizedResource.split('/').pop();
                if (!patNum || Number.isNaN(Number(patNum))) {
                    throw { status: 400, message: 'Valid PatNum must be provided in path.' };
                }
                response = await getPatientNotes(Number(patNum), clinicConfig);
                break;
            }
            case /\/accountmodules\/.+\/.+/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const [, , patNum, moduleType] = normalizedResource.split('/');
                if (!patNum || Number.isNaN(Number(patNum))) {
                    throw { status: 400, message: 'Valid PatNum must be provided in path.' };
                }
                
                // Ensure patient can only access their own data
                if (Number(patNum) !== Number(patient.PatNum)) {
                    console.error('PatNum mismatch:', { 
                        requestedPatNum: patNum, 
                        sessionPatNum: patient.PatNum,
                        moduleType,
                        clinicId 
                    });
                    throw { status: 403, message: 'Access denied. PatNum in path does not match authenticated patient.' };
                }
                
                console.log(`Fetching ${moduleType} data for PatNum ${patNum}, clinic ${clinicId}`);
                response = await getAccountModuleData(Number(patNum), moduleType, queryParams, clinicConfig);
                break;
            }
            case /\/appointments\/.+\/break$/.test(normalizedResource) && httpMethod === 'PUT': {
                patient = await validateSession(event, clinicId);
                const aptNum = normalizedResource.split('/')[2];
                if (!aptNum || Number.isNaN(Number(aptNum))) {
                    throw { status: 400, message: 'Valid AptNum must be provided in path.' };
                }
                response = await breakAppointment(Number(aptNum), body, patient, clinicConfig);
                break;
            }
            case /\/appointments\/[^/]+$/.test(normalizedResource) && httpMethod === 'PUT': {
                patient = await validateSession(event, clinicId);
                const aptNum = normalizedResource.split('/')[2];
                if (!aptNum || Number.isNaN(Number(aptNum))) {
                    throw { status: 400, message: 'Valid AptNum must be provided in path.' };
                }
                response = await updateAppointment(Number(aptNum), body, patient, clinicConfig);
                break;
            }
            case normalizedResource === '/appointments' && httpMethod === 'POST': {
                patient = await validateSession(event, clinicId);
                try {
                    response = await createAppointment(body, patient, clinicConfig);
                    await recordPortalMetric(clinicId, 'appointmentsBooked');
                } catch (err) {
                    await recordPortalMetric(clinicId, 'appointmentFailures');
                    throw err;
                }
                break;
            }
            case normalizedResource === '/payments' && httpMethod === 'POST': {
                patient = await validateSession(event, clinicId);
                const patNum = body.PatNum || patient.PatNum;
                if (!patNum) {
                    throw { status: 400, message: 'PatNum is required in request body or session.' };
                }
                if (!body.cardDetails || !body.cardDetails.cardNumber || !body.cardDetails.expirationDate || !body.cardDetails.cardCode) {
                    throw { status: 400, message: 'Missing required cardDetails (cardNumber, expirationDate, cardCode) in request body.' };
                }

                const paymentData: PaymentData = {
                    PayAmt: 0,
                    PatNum: patNum
                };

                if (body.PayDate) {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.PayDate)) {
                        throw { status: 400, message: 'PayDate must be in yyyy-mm-dd format.' };
                    }
                    paymentData.PayDate = body.PayDate;
                }

                if (body.CheckNum) paymentData.CheckNum = body.CheckNum;
                if (body.PayNote) paymentData.PayNote = body.PayNote;
                if (body.BankBranch) paymentData.BankBranch = body.BankBranch;
                if (body.ClinicNum) paymentData.ClinicNum = body.ClinicNum;
                if (body.isPatientPreferred) paymentData.isPatientPreferred = body.isPatientPreferred.toString();
                if (body.isPrepayment) paymentData.isPrepayment = body.isPrepayment.toString();

                if (body.procNums) {
                    if (!Array.isArray(body.procNums) || body.procNums.some((num: any) => !Number.isInteger(Number(num)))) {
                        throw { status: 400, message: 'procNums must be an array of integers.' };
                    }
                    if (!body.isPrepayment) {
                        paymentData.procNums = body.procNums;
                    }
                }

                if (body.payPlanNum) {
                    if (!Number.isInteger(Number(body.payPlanNum))) {
                        throw { status: 400, message: 'payPlanNum must be an integer.' };
                    }
                    if (!body.isPrepayment) {
                        throw { status: 400, message: 'payPlanNum is only allowed if isPrepayment is true.' };
                    }
                    paymentData.payPlanNum = Number(body.payPlanNum);
                }

                const agingData = await getPatientAging(patNum, clinicConfig);
                const amount = parseFloat(agingData.PatEstBal || agingData.EstBal || 0);
                if (amount <= 0) {
                    throw { status: 400, message: 'No payable balance found for the patient.' };
                }

                paymentData.PayAmt = parseFloat(amount.toFixed(2));

                try {
                    const paymentResult = await chargeCreditCard(body.cardDetails, amount, clinicConfig);
                    const openDentalPayment = await createPayment(paymentData, clinicConfig);

                    response = {
                        ...paymentResult,
                        patNum,
                        amountCharged: amount,
                        openDentalPayment: {
                            PayNum: openDentalPayment.PayNum,
                            PayAmt: openDentalPayment.PayAmt,
                            PayDate: openDentalPayment.PayDate,
                            PatNum: openDentalPayment.PatNum
                        }
                    };

                    await recordPortalMetric(clinicId, 'paymentsSucceeded');
                } catch (err) {
                    await recordPortalMetric(clinicId, 'paymentFailures');
                    throw err;
                }
                break;
            }
            case /\/documents\/\d+\/download$/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const docNum = parseInt(normalizedResource.split('/')[2]);
                if (!docNum || Number.isNaN(docNum)) {
                    throw { status: 400, message: 'Valid DocNum must be provided in path.' };
                }
                
                try {
                    const { fileBuffer, fileName, mimeType } = await downloadDocumentFromSftp(docNum, clinicConfig);
                    
                    return {
                        statusCode: 200,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': mimeType,
                            'Content-Disposition': `attachment; filename="${fileName}"`,
                            'Content-Length': fileBuffer.length.toString(),
                        },
                        body: fileBuffer.toString('base64'),
                        isBase64Encoded: true,
                    };
                } catch (err: any) {
                    console.error('Error downloading document:', err);
                    throw {
                        status: err.response?.status || 500,
                        message: err.message || 'Error downloading document'
                    };
                }
            }
            case /\/documents\/\d+\/view$/.test(normalizedResource) && httpMethod === 'GET': {
                patient = await validateSession(event, clinicId);
                const docNum = parseInt(normalizedResource.split('/')[2]);
                if (!docNum || Number.isNaN(docNum)) {
                    throw { status: 400, message: 'Valid DocNum must be provided in path.' };
                }
                
                try {
                    const { fileBuffer, fileName, mimeType } = await downloadDocumentFromSftp(docNum, clinicConfig);
                    
                    return {
                        statusCode: 200,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': mimeType,
                            'Content-Disposition': `inline; filename="${fileName}"`,
                            'Content-Length': fileBuffer.length.toString(),
                        },
                        body: fileBuffer.toString('base64'),
                        isBase64Encoded: true,
                    };
                } catch (err: any) {
                    console.error('Error viewing document:', err);
                    throw {
                        status: err.response?.status || 500,
                        message: err.message || 'Error viewing document'
                    };
                }
            }
            case normalizedResource === '/documents/upload' && httpMethod === 'POST': {
                patient = await validateSession(event, clinicId);
                
                if (!body.rawBase64 || !body.extension) {
                    throw { status: 400, message: 'rawBase64 and extension are required for document upload.' };
                }
                
                // Validate file extension
                const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.doc', '.docx', '.txt', '.rtf'];
                if (!allowedExtensions.includes(body.extension.toLowerCase())) {
                    throw { status: 400, message: `File type ${body.extension} is not allowed. Allowed types: ${allowedExtensions.join(', ')}` };
                }
                
                // Validate base64 data
                try {
                    // Check if base64 is valid and not too large (10MB limit)
                    const buffer = Buffer.from(body.rawBase64, 'base64');
                    const fileSizeInMB = buffer.length / (1024 * 1024);
                    if (fileSizeInMB > 10) {
                        throw { status: 400, message: 'File size exceeds 10MB limit.' };
                    }
                } catch (err) {
                    throw { status: 400, message: 'Invalid base64 file data.' };
                }
                
                const AUTH_HEADER = `ODFHIR ${clinicConfig.developerKey}/${clinicConfig.customerKey}`;
                
                // Prepare upload payload
                const uploadPayload: any = {
                    PatNum: patient.PatNum,
                    rawBase64: body.rawBase64,
                    extension: body.extension,
                    Description: body.description || `Patient uploaded document${body.extension}`,
                    ImgType: getImageTypeFromExtension(body.extension),
                    DateCreated: new Date().toISOString().replace('T', ' ').substring(0, 19)
                };
                
                // Add optional fields if provided
                if (body.docCategory) uploadPayload.DocCategory = body.docCategory;
                if (body.toothNumbers) uploadPayload.ToothNumbers = body.toothNumbers;
                if (body.provNum) uploadPayload.ProvNum = body.provNum;
                if (body.printHeading) uploadPayload.PrintHeading = body.printHeading;
                
                try {
                    const uploadResponse = await axios.post(`${API_BASE_URL}/documents/Upload`, uploadPayload, {
                        headers: {
                            'Authorization': AUTH_HEADER,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    console.log('Document uploaded successfully:', uploadResponse.data);
                    response = uploadResponse.data;
                    await recordPortalMetric(clinicId, 'documentUploads');
                } catch (err: any) {
                    console.error('Error uploading document:', err);
                    await recordPortalMetric(clinicId, 'documentUploadFailures');
                    if (err.response?.status === 400) {
                        throw { status: 400, message: err.response?.data?.message || 'Invalid document data. Please check file format and try again.' };
                    }
                    if (err.response?.status === 401) {
                        throw { status: 401, message: 'Unauthorized access to upload documents.' };
                    }
                    throw { status: err.response?.status || 500, message: err.response?.data?.message || 'Failed to upload document. Please try again.' };
                }
                break;
            }
            // Add more endpoints as needed...
            default:
                console.error(`Route not found: ${routeKey}`);
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: `Not Found: ${httpMethod} ${normalizedResource}` }),
                };
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(response),
        };
        
    } catch (error: any) {
        console.error('Error processing request:', error);
        console.error('Request details:', {
            method: httpMethod,
            resource: normalizedResource,
            clinicId,
            headers: event.headers,
            pathParameters: event.pathParameters,
            queryStringParameters: event.queryStringParameters
        });
        console.error('Error stack:', error.stack);
        
        const status = error.status || error.response?.status || 500;
        const detail = error.message || error.response?.data?.message || 'Internal server error';
        console.error(`Responding with status ${status}:`, detail);
        return {
            statusCode: status,
            headers: corsHeaders,
            body: JSON.stringify({
                message: detail
            }),
        };
    }
};
