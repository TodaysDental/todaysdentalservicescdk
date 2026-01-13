#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';

// Load environment variables from .env file in the project root
// dotenv.config() looks for .env in the current working directory by default
dotenv.config();

import * as cdk from 'aws-cdk-lib';
import { CoreStack } from './stacks/core-stack';
import { CallbackStack } from './stacks/callback-stack';
import { PatientPortalStack } from './stacks/patient-portal-stack';
import { ChatbotStack } from './stacks/chatbot-stack';
// Granular service stacks
import { TemplatesStack } from './stacks/templates-stack';
// Import the new stack
import { ConsentFormDataStack } from './stacks/consent-form-data-stack';
import { SchedulesStack } from './stacks/schedules-stack';
import { QueriesStack } from './stacks/queries-stack';
import { ReportsStack } from './stacks/reports-stack';
import { ClinicHoursStack } from './stacks/clinic-hours-stack';
import { ClinicPricingStack } from './stacks/clinic-pricing-stack';
import { ClinicInsuranceStack } from './stacks/clinic-insurance-stack';
import { AdminStack } from './stacks/admin-stack';
import { OpenDentalStack } from './stacks/opendental-stack';
import { NotificationsStack } from './stacks/notifications-stack';
import { ChimeStack, type VoiceConnectorOriginationRouteConfig } from './stacks/chime-stack';
import { HrStack } from './stacks/hr-stack';
import { PatientPortalApptTypesStack } from './stacks/patient-portal-appttypes-stack';
import { FluorideAutomationStack } from './stacks/fluoride-automation-stack';
import { MarketingStack } from './stacks/marketing-stack';
import { GoogleAdsStack } from './stacks/google-ads-stack';
import { CommStack } from './stacks/comm-stack'; // <-- NEW IMPORT ADDED HERE
import { AnalyticsStack } from './stacks/analytics-stack';
import { ClinicImagesStack } from './stacks/clinic-images-stack';
import { AiAgentsStack } from './stacks/ai-agents-stack';
import { QueryGeneratorStack } from './stacks/query-generator-stack';
import { RcsStack } from './stacks/rcs-stack';
// import { CredentialingStack } from './stacks/credentialing-stack'; // TEMPORARILY DISABLED
import { LeaseManagementStack } from './stacks/lease-management-stack';
import { InsurancePlanSyncStack } from './stacks/insurance-plan-sync-stack';
import { FeeScheduleSyncStack } from './stacks/fee-schedule-sync-stack';
import { EmailStack } from './stacks/email-stack';
import { AccountingStack } from './stacks/accounting-stack';
import { SecretsStack } from './stacks/secrets-stack';
import { PushNotificationsStack } from './stacks/push-notifications-stack';
import { ConnectLexAiStack } from './stacks/connect-lex-ai-stack';
// import { DentalSoftwareStack } from './stacks/dental-software-stack';

// Import clinic config for AI phone number mapping (used by Connect/Lex stack)
import clinicConfigData from './configs/clinic-config.json';

const app = new cdk.App();

const env = { 
 account: process.env.CDK_DEFAULT_ACCOUNT,
 region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,
};

const voiceConnectorTerminationCidrsContext = app.node.tryGetContext('voiceConnectorTerminationCidrs');
let voiceConnectorTerminationCidrs: string[] | undefined;
const voiceConnectorOriginationRoutesContext = app.node.tryGetContext('voiceConnectorOriginationRoutes');
let voiceConnectorOriginationRoutes: VoiceConnectorOriginationRouteConfig[] | undefined;

if (Array.isArray(voiceConnectorTerminationCidrsContext)) {
 voiceConnectorTerminationCidrs = voiceConnectorTerminationCidrsContext
  .map((value) => String(value).trim())
  .filter((value) => value.length > 0);
} else if (typeof voiceConnectorTerminationCidrsContext === 'string') {
 const trimmed = voiceConnectorTerminationCidrsContext.trim();

 if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
  try {
   const parsed = JSON.parse(trimmed);
   if (Array.isArray(parsed)) {
    voiceConnectorTerminationCidrs = parsed
     .map((value) => String(value).trim())
     .filter((value) => value.length > 0);
   }
  } catch (error) {
   throw new Error(`Failed to parse voiceConnectorTerminationCidrs context as JSON array: ${error}`);
  }
 } else if (trimmed.length > 0) {
  voiceConnectorTerminationCidrs = trimmed.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
 }
}

if (voiceConnectorTerminationCidrs && voiceConnectorTerminationCidrs.length === 0) {
 voiceConnectorTerminationCidrs = undefined;
}

const normalizeOriginationRoute = (value: unknown, index: number): VoiceConnectorOriginationRouteConfig => {
 if (typeof value === 'string') {
  const host = value.trim();
  if (!host) {
   throw new Error(`voiceConnectorOriginationRoutes[${index}] must include a non-empty host value.`);
  }
  return { host };
 }

 if (value && typeof value === 'object') {
  const routeObject = value as Record<string, unknown>;
  const hostValue = routeObject.host;
  const host = typeof hostValue === 'string' ? hostValue.trim() : hostValue != null ? String(hostValue).trim() : '';

  if (!host) {
   throw new Error(`voiceConnectorOriginationRoutes[${index}] must include a non-empty host value.`);
  }

  const route: VoiceConnectorOriginationRouteConfig = { host };

  if ('port' in routeObject && routeObject.port != null) {
   const port = Number(routeObject.port);
   if (!Number.isFinite(port)) {
    throw new Error(`voiceConnectorOriginationRoutes[${index}] port must be a finite number.`);
   }
   route.port = port;
  }

  if ('protocol' in routeObject && routeObject.protocol != null) {
   route.protocol = String(routeObject.protocol).trim().toUpperCase() as VoiceConnectorOriginationRouteConfig['protocol'];
  }

  if ('priority' in routeObject && routeObject.priority != null) {
   const priority = Number(routeObject.priority);
   if (!Number.isFinite(priority)) {
    throw new Error(`voiceConnectorOriginationRoutes[${index}] priority must be a finite number.`);
   }
   route.priority = priority;
  }

  if ('weight' in routeObject && routeObject.weight != null) {
   const weight = Number(routeObject.weight);
   if (!Number.isFinite(weight)) {
    throw new Error(`voiceConnectorOriginationRoutes[${index}] weight must be a finite number.`);
   }
   route.weight = weight;
  }

  return route;
 }

 throw new Error(`voiceConnectorOriginationRoutes[${index}] must be a string host or an object with a host property.`);
};

if (Array.isArray(voiceConnectorOriginationRoutesContext)) {
 voiceConnectorOriginationRoutes = voiceConnectorOriginationRoutesContext.map((value, index) =>
  normalizeOriginationRoute(value, index)
 );
} else if (typeof voiceConnectorOriginationRoutesContext === 'string') {
 const trimmed = voiceConnectorOriginationRoutesContext.trim();
 if (trimmed.length > 0) {
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
   try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
     throw new Error('voiceConnectorOriginationRoutes context must be a JSON array.');
    }
    voiceConnectorOriginationRoutes = parsed.map((value, index) => normalizeOriginationRoute(value, index));
   } catch (error) {
    throw new Error(`Failed to parse voiceConnectorOriginationRoutes context: ${error}`);
   }
  } else {
   voiceConnectorOriginationRoutes = trimmed
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value, index) => normalizeOriginationRoute(value, index));
  }
 }
} else if (voiceConnectorOriginationRoutesContext && typeof voiceConnectorOriginationRoutesContext === 'object') {
 voiceConnectorOriginationRoutes = [normalizeOriginationRoute(voiceConnectorOriginationRoutesContext, 0)];
}

if (voiceConnectorOriginationRoutes && voiceConnectorOriginationRoutes.length === 0) {
 voiceConnectorOriginationRoutes = undefined;
}

// 1. Core Stack - JWT-based authentication (minimal resources)
const coreStack = new CoreStack(app, 'TodaysDentalInsightsCoreN1', { env });

// ========================================
// SECRETS STACK - Centralized secrets management with KMS-encrypted DynamoDB tables
// ========================================
// This stack creates:
// - KMS CMK for encryption
// - ClinicSecrets table (per-clinic API keys, passwords)
// - GlobalSecrets table (system-wide secrets: Ayrshare, Odoo, Gmail, Twilio)
// - ClinicConfig table (non-sensitive clinic configuration)
// - Seeder CustomResource to populate tables on deployment
const secretsStack = new SecretsStack(app, 'TodaysDentalInsightsSecretsN1', {
  env,
  seedInitialData: true,
});

// SecretsStack has no dependencies - it's a foundational stack

// 3. Granular Service Stacks - Each service has its own stack with table and API endpoints

// Clinic Hours service - MOVED HERE as it's used by ChatbotStack, AdminStack, and SchedulesStack
const clinicHoursStack = new ClinicHoursStack(app, 'TodaysDentalInsightsClinicHoursN1', {
  env,
});

// Clinic Pricing service
const clinicPricingStack = new ClinicPricingStack(app, 'TodaysDentalInsightsClinicPricingN1', {
  env,
});

// Clinic Insurance service - TEMPORARILY DISABLED
// const clinicInsuranceStack = new ClinicInsuranceStack(app, 'TodaysDentalInsightsClinicInsuranceN1', {
//   env,
// });

// Templates service
const templatesStack = new TemplatesStack(app, 'TodaysDentalInsightsTemplatesN1', {
  env,
  // No longer passing authorizerFunction - will import via CloudFormation export
});

// *** NEW STACK ***
// Consent Form Data service
const consentFormDataStack = new ConsentFormDataStack(app, 'TodaysDentalInsightsConsentFormDataN1', {
  env,
});
// *** END NEW STACK ***

// Queries service
const queriesStack = new QueriesStack(app, 'TodaysDentalInsightsQueriesN1', {
  env,
});

// Reports service
const reportsStack = new ReportsStack(app, 'TodaysDentalInsightsReportsN1', {
  env,
});

// OpenDental service with SFTP resources
const openDentalStack = new OpenDentalStack(app, 'TodaysDentalInsightsOpenDentalN1', {
  env,
  // Pass secrets table names for dynamic SFTP credential retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
openDentalStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for SFTP password

// Notifications service
const notificationsStack = new NotificationsStack(app, 'TodaysDentalInsightsNotificationsN1', {
  env,
  templatesTableName: templatesStack.templatesTable.tableName,
  // Pass secrets table names for dynamic secret retrieval (unsubscribe secret)
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
notificationsStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for unsubscribe secret
const marketingStack = new MarketingStack(app, 'TodaysDentalInsightsMarketingN1', {
  env,
  authorizerFunctionArn: coreStack.authorizerFunction.functionArn,
  // Pass secrets table names for dynamic secret retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
marketingStack.addDependency(secretsStack); // Explicit - uses secrets tables for Ayrshare credentials

// Google Ads Stack - Separated from Marketing to stay under 500 resource limit
const googleAdsStack = new GoogleAdsStack(app, 'TodaysDentalInsightsGoogleAdsN1', {
  env,
  authorizerFunctionArn: coreStack.authorizerFunction.functionArn,
  // Pass secrets table names for dynamic secret retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
googleAdsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
googleAdsStack.addDependency(secretsStack); // Explicit - uses secrets tables for Google Ads credentials

// Amazon Chime Voice Integration - create Chime stack first and export
// Lambda ARNs. We intentionally do NOT pass the Admin API object into the
// Chime stack to avoid a two-way construct dependency which leads to
// cyclic CloudFormation references.

// Define ChimeStack name for consistent cross-stack references
const CHIME_STACK_NAME = 'TodaysDentalInsightsChimeN1';

// Define ChatbotStack name for consistent cross-stack references
// CRITICAL: This avoids CloudFormation export/import which causes UPDATE_ROLLBACK_IN_PROGRESS issues
const CHATBOT_STACK_NAME = 'TodaysDentalInsightsChatbotN1';
// The conversations table name follows the pattern: ${stackName}-ConversationN1
const CHATBOT_CONVERSATIONS_TABLE_NAME = `${CHATBOT_STACK_NAME}-ConversationN1`;

// Define AnalyticsStack name for consistent cross-stack references
// CRITICAL FIX: Using constant names prevents CloudFormation from creating implicit exports
// which cause UPDATE_ROLLBACK failures when the table needs replacement
const ANALYTICS_STACK_NAME = 'TodaysDentalInsightsAnalyticsN1';
// Table names follow the pattern: ${stackName}-TableNameSuffix
const ANALYTICS_TABLE_NAME = `${ANALYTICS_STACK_NAME}-CallAnalyticsN1`;
const ANALYTICS_DEDUP_TABLE_NAME = `${ANALYTICS_STACK_NAME}-CallAnalytics-dedupV2`;

// ChimeStack table names - defined as constants to pass to AnalyticsStack
// CRITICAL: These must match the actual table names created in ChimeStack
const CALL_QUEUE_TABLE_NAME = `${CHIME_STACK_NAME}-CallQueueV2`;
const AGENT_PRESENCE_TABLE_NAME = `${CHIME_STACK_NAME}-AgentPresence`;
const AGENT_PERFORMANCE_TABLE_NAME = `${CHIME_STACK_NAME}-AgentPerformance`;

// Define AI Agents stack name for consistent cross-stack references
const AI_AGENTS_STACK_NAME = 'TodaysDentalInsightsAiAgentsN1';

// Define Push Notifications stack name for consistent cross-stack references
const PUSH_NOTIFICATIONS_STACK_NAME = 'TodaysDentalInsightsPushN1';

// Define CommStack name and table names for consistent cross-stack references
// CRITICAL: Using constant names prevents CloudFormation from creating implicit exports
// which cause UPDATE_ROLLBACK failures when the table needs replacement
const COMM_STACK_NAME = 'TodaysDentalInsightsCommN1';
const COMM_FAVORS_TABLE_NAME = `${COMM_STACK_NAME}-FavorRequestsV4`;
const COMM_TEAMS_TABLE_NAME = `${COMM_STACK_NAME}-TeamsV4`;

// ** ANALYTICS STACK INSTANTIATION (BEFORE CHIME) **
// ========================================
// NOTE ON CIRCULAR DEPENDENCY RESOLUTION:
// ========================================
// There's a 3-way dependency: AnalyticsStack <-> ChimeStack <-> AiAgentsStack
// 
// Solution: Deploy in phases
// Phase 1 (first deploy): AnalyticsStack (no Voice AI) -> ChimeStack -> AiAgentsStack
// Phase 2 (second deploy): Update AnalyticsStack with Voice AI tables from AiAgentsStack
//
// For Phase 1, ENABLE_VOICE_AI_ANALYTICS should be false
// For Phase 2, set ENABLE_VOICE_AI_ANALYTICS=true after AiAgentsStack is deployed

const ENABLE_VOICE_AI_ANALYTICS = process.env.ENABLE_VOICE_AI_ANALYTICS === 'true';

const analyticsStack = new AnalyticsStack(app, ANALYTICS_STACK_NAME, {
  env,
  jwtSecret: coreStack.jwtSecretValue,
  region: env.region || process.env.AWS_REGION || 'us-east-1',
  supervisorEmails: [], // Add supervisor emails for alerts
  // ========================================
  // CHIME STACK INTEGRATION
  // ========================================
  // Pass explicit table names to avoid fragile derivation
  chimeStackName: CHIME_STACK_NAME,
  // Explicit table names from constants (must match ChimeStack table names)
  callQueueTableName: CALL_QUEUE_TABLE_NAME,
  agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
  agentPerformanceTableName: AGENT_PERFORMANCE_TABLE_NAME,
  
  // ========================================
  // VOICE AI INTEGRATION (Phase 2 Deployment)
  // ========================================
  // Requires AiAgentsStack to be deployed first
  // Set ENABLE_VOICE_AI_ANALYTICS=true after initial deployment
  voiceSessionsTableName: ENABLE_VOICE_AI_ANALYTICS 
    ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-VoiceSessionsTableName`) 
    : undefined,
  voiceSessionsTableArn: ENABLE_VOICE_AI_ANALYTICS 
    ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-VoiceSessionsTableArn`) 
    : undefined,
  aiAgentsTableName: ENABLE_VOICE_AI_ANALYTICS 
    ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-AiAgentsTableName`) 
    : undefined,
  aiAgentsTableArn: ENABLE_VOICE_AI_ANALYTICS 
    ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-AiAgentsTableArn`) 
    : undefined,
});

// Flag to enable after-hours AI routing (requires AiAgentsStack to be deployed first)
// AiAgentsStack is deployed, so we enable this by default
// Can be disabled via environment variable: ENABLE_AFTER_HOURS_AI=false
const ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI !== 'false';

// Chime Media Region - Chime SDK only supports specific regions for media operations
// Override via environment variable if deploying to a different region
// Supported: us-east-1, us-west-2, eu-west-2, ap-southeast-1, etc.
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';

// ========================================
// PUSH NOTIFICATIONS STACK (must be defined before ChimeStack and CommStack)
// ========================================
// Mobile push notifications via SNS (iOS APNs + Android FCM)
// Prerequisites: Store credentials in Secrets Manager before enabling platform applications:
// - todaysdentalinsights/push/apns - APNs credentials (signingKey, keyId, teamId, bundleId)
// - todaysdentalinsights/push/fcm - FCM credentials (serverKey)
//
// Used by: CommStack (offline messaging), ChimeStack (call notifications)
const pushNotificationsStack = new PushNotificationsStack(app, PUSH_NOTIFICATIONS_STACK_NAME, {
  env,
  // Enable these after creating the Secrets Manager secrets (see docs/PUSH-NOTIFICATIONS-SETUP.md):
  // apnsSecretName: 'todaysdentalinsights/push/apns',
  // fcmSecretName: 'todaysdentalinsights/push/fcm',
  enableApnsSandbox: true,
});
pushNotificationsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn

const chimeStack = new ChimeStack(app, CHIME_STACK_NAME, {
 env,
 jwtSecret: coreStack.jwtSecretValue,
 voiceConnectorTerminationCidrs,
 voiceConnectorOriginationRoutes,
 // CRITICAL FIX: Use constant table names instead of direct references to avoid CloudFormation
 // implicit exports which cause UPDATE_ROLLBACK failures when the table needs replacement
 analyticsTableName: ANALYTICS_TABLE_NAME,
 analyticsDedupTableName: ANALYTICS_DEDUP_TABLE_NAME,
 enableCallRecording: true, // Enable call recording by default
 recordingRetentionDays: 2555, // ~7 years for compliance
 medicalVocabularyName: analyticsStack.medicalVocabularyName,
 // Chime Media Region - passed to all Lambda functions for consistent region usage
 chimeMediaRegion: CHIME_MEDIA_REGION,
  // Voice AI integration (from AiAgentsStack)
  // NOTE: Set ENABLE_AFTER_HOURS_AI=true after AiAgentsStack is deployed
  enableAfterHoursAi: ENABLE_AFTER_HOURS_AI,
  voiceAiLambdaArn: ENABLE_AFTER_HOURS_AI ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-VoiceAiFunctionArn`) : undefined,
  // CRITICAL FIX: Use ClinicHoursStack table directly - it's the source of truth for clinic hours
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
 aiAgentsTableName: ENABLE_AFTER_HOURS_AI ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-AiAgentsTableName`) : undefined,
 voiceConfigTableName: ENABLE_AFTER_HOURS_AI ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-VoiceConfigTableName`) : undefined,
 scheduledCallsTableName: ENABLE_AFTER_HOURS_AI ? cdk.Fn.importValue(`${AI_AGENTS_STACK_NAME}-ScheduledCallsTableName`) : undefined,
 // NOTE: ChimeStack creates the recordings bucket - it will be shared with AiAgentsStack
 // Enable real-time transcription for Voice AI - required for AI to listen to speech
 // This sets up Media Insights Pipeline + Amazon Transcribe + Kinesis for speech-to-text
 enableRealTimeTranscription: ENABLE_AFTER_HOURS_AI,
 // Enable AI phone numbers - creates SIP Rules for aiPhoneNumber entries in clinic-config.json
 // Calls to AI phone numbers route directly to Voice AI (no business hours check)
 enableAiPhoneNumbers: ENABLE_AFTER_HOURS_AI,
 // ========================================
 // PUSH NOTIFICATIONS INTEGRATION
 // ========================================
 // Enables mobile push notifications for call events (incoming, missed, voicemail)
 deviceTokensTableName: pushNotificationsStack.deviceTokensTable.tableName,
 deviceTokensTableArn: pushNotificationsStack.deviceTokensTable.tableArn,
 sendPushFunctionArn: pushNotificationsStack.sendPushFn.functionArn,
});
// ChimeStack depends on PushNotificationsStack for call notifications
chimeStack.addDependency(pushNotificationsStack);

// ** COMMUNICATIONS STACK INSTANTIATION **
const communicationsStack = new CommStack(app, 'TodaysDentalInsightsCommN1', {
    env,
    jwtSecret: coreStack.jwtSecretValue,
    // Push Notifications Integration
    // Enables mobile push notifications for offline users receiving messages/tasks
    deviceTokensTableName: pushNotificationsStack.deviceTokensTable.tableName,
    deviceTokensTableArn: pushNotificationsStack.deviceTokensTable.tableArn,
    sendPushFunctionArn: pushNotificationsStack.sendPushFn.functionArn,
});

// Chatbot Stack - WebSocket-based dental assistant chatbot (depends on core and clinic data)
// NOTE: Use CHATBOT_STACK_NAME constant for consistent naming and to avoid cross-stack reference issues
const chatbotStack = new ChatbotStack(app, CHATBOT_STACK_NAME, {
  env,
  // Chatbot reads directly from DynamoDB tables - no API calls needed
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
  clinicPricingTableName: clinicPricingStack.clinicPricingTable.tableName,
  clinicInsuranceTableName: 'TodaysDentalInsightsClinicInsuranceN1-ClinicInsurance', // TEMP: hardcoded while stack disabled
});

// Admin services (AdminStack will import Chime lambda ARNs and wire API
// methods). Importing the ARNs makes Admin depend on Chime (one-way), which
// avoids the cyclic dependency we were seeing.
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminN1', {
 env,
 staffUserTableName: coreStack.staffUserTable.tableName,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  // CRITICAL FIX: Use constant table names instead of direct references to avoid CloudFormation
  // implicit exports which cause UPDATE_ROLLBACK failures when the table needs replacement
  favorsTableName: COMM_FAVORS_TABLE_NAME,
  teamsTableName: COMM_TEAMS_TABLE_NAME, // For group favor requests
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
  // CRITICAL FIX: Use constant table name instead of direct reference to avoid CloudFormation
  // implicit exports which cause UPDATE_ROLLBACK failures when the table needs replacement
  analyticsTableName: ANALYTICS_TABLE_NAME,
  jwtSecretValue: coreStack.jwtSecretValue,
  // Pass secrets table names for dynamic credential retrieval (cPanel credentials)
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
 // Additional table names for detailed analytics
 callQueueTableName: chimeStack.callQueueTable.tableName,
 recordingMetadataTableName: chimeStack.recordingMetadataTable?.tableName,
 // CRITICAL FIX: Use constant table name instead of cross-stack reference
 // This avoids CloudFormation export/import which causes UPDATE_ROLLBACK_IN_PROGRESS issues
 // when the exporting stack (ChatbotStack) tries to rollback while AdminStack still references the export
 chatHistoryTableName: CHATBOT_CONVERSATIONS_TABLE_NAME,
 clinicsTableName: chimeStack.clinicsTable.tableName,
 recordingsBucketName: chimeStack.recordingsBucket?.bucketName,
 // Import ARNs exported by the Chime stack
 startSessionFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-StartSessionArn`),
 stopSessionFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-StopSessionArn`),
 outboundCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-OutboundCallArn`),
 transferCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-TransferCallArn`),
 callAcceptedFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallAcceptedArn`),
 callRejectedFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallRejectedArn`),
 callHungupFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallHungupArn`),
 leaveCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-LeaveCallArn`),
 heartbeatFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-HeartbeatArn`),
 agentPresenceTableName: cdk.Fn.importValue(`${chimeStack.stackName}-AgentPresenceTableName`),
 holdCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-HoldCallArn`),
 resumeCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-ResumeCallArn`),
 // New features: Add Call, DTMF, Notes, Conference
 addCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-AddCallArn`),
 sendDtmfFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-SendDtmfArn`),
 callNotesFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallNotesArn`),
 conferenceCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-ConferenceCallArn`),
 // New features: Join Queue and Active Calls
 joinQueuedCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-JoinQueuedCallArn`),
 joinActiveCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-JoinActiveCallArn`),
 getJoinableCallsFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-GetJoinableCallsArn`),
 // Call Recording
 getRecordingFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-GetRecordingFnArn`),
});

// CRITICAL FIX: Avoid circular dependencies between adminStack and chimeStack
// 1. Ensure Admin is deployed after Chime (explicit dependency for clarity)
// This is needed because Admin imports exported values from Chime
adminStack.addDependency(chimeStack);

// 2. ChimeStack depends only on Core, not on AdminStack
// This avoids the circular dependency where ChimeStack -> AdminStack -> ChimeStack
// chimeStack.addDependency(coreStack); // Implicit through authorizerFunction

// 3. Add a warning comment to prevent future circular dependencies
// DO NOT add a dependency from ChimeStack to AdminStack as this would create a circular reference:
// ChimeStack -> AdminStack -> ChimeStack

// The Admin stack now receives the agent presence table name via props,
// so no additional configuration is needed here.

const hrStack = new HrStack(app, 'TodaysDentalInsightsHrN1', {
 env,
 staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
});
// hrStack.addDependency(coreStack); // Implicit

// TEMPORARILY DISABLED - Credentialing Stack
// const credentialingStack = new CredentialingStack(app, 'TodaysDentalInsightsCredentialingN1', {
//   env,
//   staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
// });
// credentialingStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn


// Schedules service (depends on other services for cross-table access)
const schedulesStack = new SchedulesStack(app, 'TodaysDentalInsightsSchedulesN1', {
 env,
 templatesTableName: templatesStack.templatesTable.tableName,
 queriesTableName: queriesStack.queriesTable.tableName,
 clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
 // Pass secrets table names for dynamic SFTP credential retrieval
 globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
 clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
 secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
schedulesStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for SFTP password

const callbackStack = new CallbackStack(app, 'TodaysDentalInsightsCallbackN1', {
 env,
});

// 7. Patient Portal Stack - Dedicated patient portal API (depends on core and OpenDental)
const patientPortalStack = new PatientPortalStack(app, 'TodaysDentalInsightsPatientPortalN1', {
 env,
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
 consolidatedTransferServerBucket: openDentalStack.consolidatedSftpBucket.bucketName,
 // Pass secrets table names for dynamic SFTP credential retrieval
 globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
 clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
 clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
 secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
patientPortalStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for SFTP password
const patientPortalApptTypesStack = new PatientPortalApptTypesStack(app, 'TodaysDentalInsightsPatientPortalApptTypesN1', {
 env,
});
// patientPortalApptTypesStack.addDependency(coreStack); // Implicit

// Clinic Images Stack - S3 bucket and API for clinic image management
const clinicImagesStack = new ClinicImagesStack(app, 'TodaysDentalInsightsClinicImagesN1', {
  env,
  // Pass secrets table names for dynamic clinic configuration retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
clinicImagesStack.addDependency(secretsStack); // Explicit - uses ClinicConfig for clinic data

// AI Agents Stack - Customizable AI agents with 3-level prompt system
// Integrates with existing Chime infrastructure for voice AI
// CRITICAL FIX: Uses shared CallAnalytics table from AnalyticsStack to avoid data fragmentation
const aiAgentsStack = new AiAgentsStack(app, AI_AGENTS_STACK_NAME, {
  env,
  // ========================================
  // CLINIC HOURS INTEGRATION (from ClinicHoursStack)
  // ========================================
  // CRITICAL FIX: Use the shared ClinicHours table from ClinicHoursStack
  // This table is synced hourly from OpenDental and contains the authoritative clinic hours
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
  clinicHoursTableArn: clinicHoursStack.clinicHoursTable.tableArn,
  
  // ========================================
  // CHIME STACK INTEGRATION (REQUIRED)
  // ========================================
  // CRITICAL FIX: Pass all required props explicitly to avoid fragile hardcoded defaults
  clinicsTableName: chimeStack.clinicsTable.tableName,
  clinicsTableArn: chimeStack.clinicsTable.tableArn,
  // SMA ID Map SSM Parameter name (value stored in SSM due to CloudFormation 1024 char limit)
  smaIdMapParameterName: `/${CHIME_STACK_NAME}/SmaIdMap`,
  chimeStackName: CHIME_STACK_NAME,

  // ========================================
  // SECRETS STACK INTEGRATION (from SecretsStack)
  // ========================================
  // Required for Action Group Lambda to read from KMS-encrypted secrets tables (ClinicSecrets fallback)
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  
  // ========================================
  // UNIFIED ANALYTICS (REQUIRED)
  // ========================================
  // Use shared CallAnalytics table from AnalyticsStack
  // This ensures Voice AI call records go to the same table as Chime stream records,
  // making dashboards and reconciliation jobs see all data in one place.
  // Schema: PK=callId (String), SK=timestamp (Number)
  // CRITICAL FIX: Use constant table name instead of direct reference to avoid CloudFormation
  // implicit exports which cause UPDATE_ROLLBACK failures when the table needs replacement
  callAnalyticsTableName: ANALYTICS_TABLE_NAME,
  // Construct ARN from known components to avoid cross-stack reference
  callAnalyticsTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/${ANALYTICS_TABLE_NAME}`,
  
  // ========================================
  // SHARED RECORDINGS BUCKET
  // ========================================
  // Use ChimeStack's recordings bucket to avoid data fragmentation
  // between AI calls and human calls
  sharedRecordingsBucketName: chimeStack.recordingsBucket?.bucketName,
  sharedRecordingsBucketArn: chimeStack.recordingsBucket?.bucketArn,
  
  // ========================================
  // WEBSOCKET DOMAIN (from ChatbotStack)
  // ========================================
  // CRITICAL FIX: Use explicit values for the WebSocket domain created by ChatbotStack
  // These are static AWS-assigned values that don't change after domain creation
  // Using hardcoded values avoids CloudFormation cross-stack reference issues
  webSocketDomainName: 'ws.todaysdentalinsights.com',
  webSocketRegionalDomainName: 'd-1623htv8c4.execute-api.us-east-1.amazonaws.com',
  webSocketRegionalHostedZoneId: 'Z1UJRXOUMOOFQ8',
});

// Add dependencies so AI Agents stack deploys after Chime, Analytics, Chatbot, and ClinicHours
// Chatbot creates the ws.todaysdentalinsights.com domain that AI Agents uses
// ClinicHours provides the shared clinic hours table
aiAgentsStack.addDependency(chimeStack);
aiAgentsStack.addDependency(analyticsStack);
aiAgentsStack.addDependency(chatbotStack);
aiAgentsStack.addDependency(clinicHoursStack);
aiAgentsStack.addDependency(secretsStack);

// ========================================
// CONNECT + LEX AI STACK
// ========================================
// Provides a fully serverless AI phone number via Amazon Connect + Lex V2.
// Alternative to Chime Voice Connector (which requires an SBC for direct inbound calls).
// Writes to the same AnalyticsStack tables (CallAnalyticsN1 + TranscriptBuffersV2) for unified dashboards.

// Build AI phone numbers mapping from clinic-config.json (same pattern as ChimeStack)
const clinicsWithAiPhones = (clinicConfigData as any[])
  .filter((c: any) => c.aiPhoneNumber && c.aiPhoneNumber.trim() !== '')
  .map((c: any) => ({
    clinicId: c.clinicId,
    aiPhoneNumber: c.aiPhoneNumber.trim(),
  }));

// Map aiPhoneNumber -> clinicId for Lex hook to detect which clinic the call is for
const aiPhoneNumbersMap = clinicsWithAiPhones.reduce(
  (acc, c) => ({ ...acc, [c.aiPhoneNumber]: c.clinicId }),
  {} as Record<string, string>
);

// Use the first AI phone number as the primary Connect AI phone (or fallback)
const primaryAiPhoneNumber = clinicsWithAiPhones[0]?.aiPhoneNumber || '+14439272295';
const defaultClinicForAi = clinicsWithAiPhones[0]?.clinicId || 'dentistingreenville';

console.log(`[ConnectLexAiStack] Found ${clinicsWithAiPhones.length} clinics with AI phone numbers`);

const connectLexAiStack = new ConnectLexAiStack(app, 'TodaysDentalInsightsConnectLexAiN1', {
  env,
  // Existing Amazon Connect instance
  connectInstanceId: '0626aa86-d377-44c8-9311-84e4f230cc72',
  connectInstanceArn: 'arn:aws:connect:us-east-1:851620242036:instance/0626aa86-d377-44c8-9311-84e4f230cc72',
  // Phone number to attach to AI contact flow (uses first AI phone from config)
  connectAiPhoneNumber: primaryAiPhoneNumber,
  // AI Agents table for Bedrock agent lookup (from AiAgentsStack)
  agentsTableName: aiAgentsStack.agentsTable.tableName,
  agentsTableArn: aiAgentsStack.agentsTable.tableArn,
  // Sessions table for session management (from AiAgentsStack)
  sessionsTableName: aiAgentsStack.sessionsTable.tableName,
  sessionsTableArn: aiAgentsStack.sessionsTable.tableArn,
  // Shared analytics tables from AnalyticsStack
  callAnalyticsTableName: ANALYTICS_TABLE_NAME,
  callAnalyticsTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/${ANALYTICS_TABLE_NAME}`,
  transcriptBufferTableName: analyticsStack.transcriptBufferTable.tableName,
  transcriptBufferTableArn: analyticsStack.transcriptBufferTable.tableArn,
  // AI phone numbers mapping for clinic detection (built from clinic-config.json)
  aiPhoneNumbersJson: JSON.stringify(aiPhoneNumbersMap),
  defaultClinicId: defaultClinicForAi,
  // Thinking audio URL from ChimeStack - plays keyboard sounds during AI processing
  thinkingAudioUrl: chimeStack.thinkingAudioUrl,
});
connectLexAiStack.addDependency(aiAgentsStack);
connectLexAiStack.addDependency(analyticsStack);
connectLexAiStack.addDependency(chimeStack); // Needs public audio bucket from ChimeStack

// Query Generator Stack - AI-powered SQL query generation using Bedrock
const queryGeneratorStack = new QueryGeneratorStack(app, 'TodaysDentalInsightsQueryGeneratorN1', {
  env,
});

// RCS Messaging Stack - Twilio RCS messaging webhooks for all clinics
// Provides incoming message, fallback, and status callback webhooks
const rcsStack = new RcsStack(app, 'TodaysDentalInsightsRcsN1', {
  env,
  // Twilio credentials are now fetched from GlobalSecrets DynamoDB table at runtime
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
rcsStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for Twilio credentials

// Dental Software Stack - RDS MySQL database and S3 for clinic management
// const dentalSoftwareStack = new DentalSoftwareStack(app, 'TodaysDentalInsightsDentalSoftwareN1', {
//   env,
// });

// Clinic Hours service - REMOVED FROM HERE, moved to top after coreStack

// Add stack dependencies
// Core dependencies

// NOTE: When using Fn.importValue() for AuthorizerFunctionArn, dependencies are NOT implicit
// Explicit dependencies are required to ensure CoreStack is deployed first

// Service stack dependencies - EXPLICIT because they import AuthorizerFunctionArn
templatesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
consentFormDataStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
queriesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
reportsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicHoursStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicPricingStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
// clinicInsuranceStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn - DISABLED
openDentalStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
hrStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn

communicationsStack.addDependency(coreStack); // Explicit - uses JWT secret
communicationsStack.addDependency(pushNotificationsStack); // Explicit - uses push notification Lambda

// Analytics stack dependencies
// CRITICAL FIX: Explicit dependency on CoreStack for jwtSecret
analyticsStack.addDependency(coreStack);

// Cross-service dependencies for services that need data from other services
notificationsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
notificationsStack.addDependency(templatesStack); // Explicit - uses table name
adminStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
adminStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for cPanel credentials
schedulesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
schedulesStack.addDependency(templatesStack); // Explicit - uses table name
schedulesStack.addDependency(queriesStack); // Explicit - uses table name
schedulesStack.addDependency(openDentalStack); // Explicit - uses server ID
// NEW: Schedules stack imports RCS stack exports (RCS templates table + send Lambda ARN)
schedulesStack.addDependency(rcsStack); // Explicit - imports RCS stack outputs via Fn.importValue



// Other existing stack dependencies
callbackStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
patientPortalApptTypesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicImagesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
aiAgentsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
queryGeneratorStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
rcsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
rcsStack.addDependency(notificationsStack); // Explicit - imports UnsubscribeTableName
// dentalSoftwareStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
// patientPortalStack.addDependency(coreStack); // Note: PatientPortalStack might not import it - verify
patientPortalStack.addDependency(openDentalStack); // Explicit - uses SFTP resources
chatbotStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
chatbotStack.addDependency(clinicPricingStack); // Explicit - uses table name
// chatbotStack.addDependency(clinicInsuranceStack); // Explicit - uses table name - DISABLED

// Fluoride Automation Stack - Run automation for adding fluoride treatments every hour
// const fluorideAutomationStack = new FluorideAutomationStack(app, 'TodaysDentalInsightsFluorideAutomationV1', {
//  env,
// });
// fluorideAutomationStack.addDependency(openDentalStack); // Add dependency on OpenDental stack for SFTP server

// Lease Management Stack - Manages lease documents for all 28 clinics
// Features: CRUD operations, S3 document storage, Textract OCR extraction
const leaseManagementStack = new LeaseManagementStack(app, 'TodaysDentalInsightsLeaseManagementN1', {
  env,
});
leaseManagementStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn

// Insurance Plan Sync Stack - Syncs insurance plan data from OpenDental every 15 minutes
// Stores comprehensive plan info: maximums, deductibles, coverage percentages, waiting periods, etc.
const insurancePlanSyncStack = new InsurancePlanSyncStack(app, 'TodaysDentalInsightsInsurancePlanSyncN1', {
  env,
  consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
  // Pass secrets table names for dynamic SFTP credential retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
insurancePlanSyncStack.addDependency(openDentalStack); // Explicit - uses SFTP server ID
insurancePlanSyncStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for SFTP password

// Fee Schedule Sync Stack - Syncs fee schedule data from OpenDental every 15 minutes
// Stores fee amounts for procedure codes across all fee schedules (feesched, fee, procedurecode)
const feeScheduleSyncStack = new FeeScheduleSyncStack(app, 'TodaysDentalInsightsFeeScheduleSyncN1', {
  env,
  consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
  // Pass secrets table names for dynamic SFTP credential retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
feeScheduleSyncStack.addDependency(openDentalStack); // Explicit - uses SFTP server ID
feeScheduleSyncStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets for SFTP password

// Email Stack - Clinic-specific email operations (Gmail REST API + IMAP/SMTP)
// Domain-level credentials are defined as constants in email-stack.ts:
// - GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET: Google OAuth2 credentials
// - DOMAIN_SMTP_USER, DOMAIN_SMTP_PASSWORD: Domain email credentials
const emailStack = new EmailStack(app, 'TodaysDentalInsightsEmailN1', {
  env,
  // Pass secrets table names for dynamic secret retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
emailStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn (if needed later)
emailStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets table for Gmail/cPanel credentials

// Accounting Stack - Invoice intake (Accounts Payable) and Bank Reconciliation
// Integrates with OpenDental for payment data and Odoo for bank transactions
const accountingStack = new AccountingStack(app, 'TodaysDentalInsightsAccountingN1', {
  env,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  // Pass secrets table names for dynamic secret retrieval
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
accountingStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
accountingStack.addDependency(secretsStack); // Explicit - uses GlobalSecrets table for Odoo credentials

// Push Notifications Stack is instantiated earlier in the file (before ChimeStack and CommStack)
// See the PUSH NOTIFICATIONS STACK section above

// CRITICAL FIX: Remove commented-out code that could lead to circular dependencies
// Note: The proper dependencies are already set above:
// 1. adminStack.addDependency(chimeStack) - Admin depends on Chime
// 2. chimeStack.addDependency(coreStack) - Chime depends on Core
// Do not uncomment the following line as it would create a circular reference:
// chimeStack.addDependency(adminStack)