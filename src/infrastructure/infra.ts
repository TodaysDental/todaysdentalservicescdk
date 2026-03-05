#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';

// Load environment variables from .env file in the project root
dotenv.config();

import * as cdk from 'aws-cdk-lib';
import { CoreStack } from './stacks/core-stack';
import { CallbackStack } from './stacks/callback-stack';
import { TemplatesStack } from './stacks/templates-stack';
import { SchedulesStack } from './stacks/schedules-stack';
import { AdminStack } from './stacks/admin-stack';
import { NotificationsStack } from './stacks/notifications-stack';
import { ChimeStack, type VoiceConnectorOriginationRouteConfig } from './stacks/chime-stack';
import { HrStack } from './stacks/hr-stack';
import { MarketingStack } from './stacks/marketing-stack';
import { GoogleAdsStack } from './stacks/google-ads-stack';
import { CommStack } from './stacks/comm-stack';
import { ClinicImagesStack } from './stacks/clinic-images-stack';
import { AiAgentsStack } from './stacks/ai-agents-stack';
import { LeaseManagementStack } from './stacks/lease-management-stack';
import { SecretsStack } from './stacks/secrets-stack';
import { ItTicketStack } from './stacks/it-ticket-stack';
import { ConnectLexAiStack } from './stacks/connect-lex-ai-stack';
import { PushNotificationsStack } from './stacks/push-notifications-stack';

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

// ========================================
// STACK NAME CONSTANTS
// ========================================
// Using constants prevents CloudFormation from creating implicit exports
// which cause UPDATE_ROLLBACK failures when tables need replacement.

const CHIME_STACK_NAME = 'TodaysDentalInsightsChimeN1';
const CHATBOT_STACK_NAME_CONSTANT = 'TodaysDentalInsightsChatbotN1';
const CHATBOT_CONVERSATIONS_TABLE_NAME = `${CHATBOT_STACK_NAME_CONSTANT}-ConversationN1`;
const AI_AGENTS_STACK_NAME = 'TodaysDentalInsightsAiAgentsN1';
const COMM_STACK_NAME = 'TodaysDentalInsightsCommN1';
const COMM_FAVORS_TABLE_NAME = `${COMM_STACK_NAME}-FavorRequestsV4`;
const COMM_TEAMS_TABLE_NAME = `${COMM_STACK_NAME}-TeamsV4`;

// Chime table name constants (must match actual ChimeStack table names)
const CALL_QUEUE_TABLE_NAME = `${CHIME_STACK_NAME}-CallQueueV2`;
const AGENT_PRESENCE_TABLE_NAME = `${CHIME_STACK_NAME}-AgentPresence`;
const AGENT_PERFORMANCE_TABLE_NAME = `${CHIME_STACK_NAME}-AgentPerformance`;

// AiAgentsStack table names - defined as constants to pass to ChimeStack
// CRITICAL: These must match the actual table names created in AiAgentsStack
const AI_AGENTS_VOICE_CONFIG_TABLE_NAME = `${AI_AGENTS_STACK_NAME}-VoiceAgentConfig`;

// ========================================
// CORE STACK — JWT auth & shared tables
// ========================================
const coreStack = new CoreStack(app, 'TodaysDentalInsightsCoreN1', { env });

// ========================================
// SECRETS STACK — KMS-encrypted DynamoDB tables for secrets
// ========================================
const secretsStack = new SecretsStack(app, 'TodaysDentalInsightsSecretsN1', {
  env,
  seedInitialData: true,
});

// ========================================
// PUSH NOTIFICATIONS STACK (must come before Chime, Comm, and HR)
// ========================================
const pushNotificationsStack = new PushNotificationsStack(app, 'TodaysDentalInsightsPushN1', {
  env,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  globalSecretsTableArn: secretsStack.globalSecretsTable.tableArn,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  apiDomainName: coreStack.customDomain.domainName,
});
pushNotificationsStack.addDependency(coreStack);    // imports AuthorizerFunctionArn
pushNotificationsStack.addDependency(secretsStack); // reads GlobalSecrets for FCM credentials

// ========================================
// TEMPLATES STACK
// ========================================
const templatesStack = new TemplatesStack(app, 'TodaysDentalInsightsTemplatesN1', {
  env,
  apiDomainName: coreStack.customDomain.domainName,
});
templatesStack.addDependency(coreStack);

// ========================================
// NOTIFICATIONS STACK
// ========================================
const notificationsStack = new NotificationsStack(app, 'TodaysDentalInsightsNotificationsN1', {
  env,
  templatesTableName: templatesStack.templatesTable.tableName,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  smaIdMapParameterName: '/TodaysDentalInsightsChimeN1/SmaIdMap',
  chimeMediaRegion: process.env.CHIME_MEDIA_REGION || 'us-east-1',
  apiDomainName: coreStack.customDomain.domainName,
});
notificationsStack.addDependency(coreStack);
notificationsStack.addDependency(secretsStack);
notificationsStack.addDependency(templatesStack);

// ========================================
// MARKETING STACK
// ========================================
const marketingStack = new MarketingStack(app, 'TodaysDentalInsightsMarketingN1', {
  env,
  authorizerFunctionArn: coreStack.authorizerFunction.functionArn,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  apiDomainName: coreStack.customDomain.domainName,
});
marketingStack.addDependency(coreStack);
marketingStack.addDependency(secretsStack);

// ========================================
// GOOGLE ADS STACK
// ========================================
const googleAdsStack = new GoogleAdsStack(app, 'TodaysDentalInsightsGoogleAdsN1', {
  env,
  authorizerFunctionArn: coreStack.authorizerFunction.functionArn,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  apiDomainName: coreStack.customDomain.domainName,
});
googleAdsStack.addDependency(coreStack);
googleAdsStack.addDependency(secretsStack);

// ========================================
// CALLBACK STACK
// ========================================
const callbackStack = new CallbackStack(app, 'TodaysDentalInsightsCallbackN1', {
  env,
  apiDomainName: coreStack.customDomain.domainName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
});
callbackStack.addDependency(coreStack);
callbackStack.addDependency(secretsStack);

// ========================================
// CHIME MEDIA REGION & CONNECT CONFIG
// ========================================
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const CONNECT_CALL_RECORDINGS_BUCKET_NAME =
  process.env.CONNECT_CALL_RECORDINGS_BUCKET_NAME || 'amazon-connect-c827a75574aa';
const CONNECT_CALL_RECORDINGS_PREFIX =
  process.env.CONNECT_CALL_RECORDINGS_PREFIX || 'connect/todaysdentalcommunications/CallRecordings';
const CONNECT_CALL_RECORDINGS_KMS_KEY_ARN =
  process.env.CONNECT_CALL_RECORDINGS_KMS_KEY_ARN ||
  'arn:aws:kms:us-east-1:851620242036:key/5dae5a1c-2e8f-4157-a04c-20e3293d01a7';

// ========================================
// COMM STACK (must be before Admin and HR)
// ========================================
const communicationsStack = new CommStack(app, COMM_STACK_NAME, {
  env,
  jwtSecret: coreStack.jwtSecretValue,
  authorizerFunctionArn: coreStack.authorizerFunction.functionArn,
  // Push Notifications Integration
  deviceTokensTableName: pushNotificationsStack.deviceTokensTable.tableName,
  deviceTokensTableArn: pushNotificationsStack.deviceTokensTable.tableArn,
  sendPushFunctionArn: pushNotificationsStack.sendPushFn.functionArn,
  apiDomainName: coreStack.customDomain.domainName,
});
communicationsStack.addDependency(coreStack);
communicationsStack.addDependency(pushNotificationsStack);

// ========================================
// CHIME STACK (Voice/Call infrastructure)
// ========================================
const ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI !== 'false';

const chimeStack = new ChimeStack(app, CHIME_STACK_NAME, {
  env,
  jwtSecret: coreStack.jwtSecretValue,
  voiceConnectorTerminationCidrs,
  voiceConnectorOriginationRoutes,
  analyticsTableName: `TodaysDentalInsightsAnalyticsN1-CallAnalyticsN1`,
  analyticsDedupTableName: `TodaysDentalInsightsAnalyticsN1-CallAnalytics-dedupV2`,
  enableCallRecording: true,
  recordingRetentionDays: 2555,
  chimeMediaRegion: CHIME_MEDIA_REGION,
  connectCallRecordingsBucketName: CONNECT_CALL_RECORDINGS_BUCKET_NAME,
  connectCallRecordingsPrefix: CONNECT_CALL_RECORDINGS_PREFIX,
  connectCallRecordingsKmsKeyArn: CONNECT_CALL_RECORDINGS_KMS_KEY_ARN,
  enableAfterHoursAi: ENABLE_AFTER_HOURS_AI,
  clinicHoursTableName: `TodaysDentalInsightsClinicHoursN1-ClinicHours`,
  voiceConfigTableName: ENABLE_AFTER_HOURS_AI ? AI_AGENTS_VOICE_CONFIG_TABLE_NAME : undefined,
  // Push Notifications — direct references (no circular dep; Chime doesn't feed back into Push)
  deviceTokensTableName: pushNotificationsStack.deviceTokensTable.tableName,
  deviceTokensTableArn: pushNotificationsStack.deviceTokensTable.tableArn,
  sendPushFunctionArn: pushNotificationsStack.sendPushFn.functionArn,
  staffUserTableName: coreStack.staffUserTable.tableName,
});
chimeStack.addDependency(pushNotificationsStack);
chimeStack.addDependency(notificationsStack);

// ========================================
// ADMIN STACK
// ========================================
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminN1', {
  env,
  staffUserTableName: coreStack.staffUserTable.tableName,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  favorsTableName: COMM_FAVORS_TABLE_NAME,
  teamsTableName: COMM_TEAMS_TABLE_NAME,
  clinicHoursTableName: `TodaysDentalInsightsClinicHoursN1-ClinicHours`,
  analyticsTableName: `TodaysDentalInsightsAnalyticsN1-CallAnalyticsN1`,
  jwtSecretValue: coreStack.jwtSecretValue,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  callQueueTableName: chimeStack.callQueueTable.tableName,
  recordingMetadataTableName: chimeStack.recordingMetadataTable?.tableName,
  chatHistoryTableName: CHATBOT_CONVERSATIONS_TABLE_NAME,
  clinicsTableName: chimeStack.clinicsTable.tableName,
  recordingsBucketName: chimeStack.recordingsBucket?.bucketName,
  transcriptBufferTableName: `TodaysDentalInsightsAnalyticsN1-TranscriptBuffersV2`,
  agentActiveFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-AgentActiveArn`),
  agentInactiveFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-AgentInactiveArn`),
  outboundCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-OutboundCallArn`),
  transferCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-TransferCallArn`),
  callAcceptedFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallAcceptedArn`),
  callAcceptedV2FnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallAcceptedV2Arn`),
  callRejectedV2FnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallRejectedV2Arn`),
  callHungupV2FnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallHungupV2Arn`),
  callRejectedFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallRejectedArn`),
  callHungupFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallHungupArn`),
  leaveCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-LeaveCallArn`),
  agentPresenceTableName: cdk.Fn.importValue(`${chimeStack.stackName}-AgentPresenceTableName`),
  agentActiveTableName: chimeStack.agentActiveTable.tableName,
  holdCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-HoldCallArn`),
  resumeCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-ResumeCallArn`),
  addCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-AddCallArn`),
  sendDtmfFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-SendDtmfArn`),
  callNotesFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-CallNotesArn`),
  conferenceCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-ConferenceCallArn`),
  joinQueuedCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-JoinQueuedCallArn`),
  joinActiveCallFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-JoinActiveCallArn`),
  getJoinableCallsFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-GetJoinableCallsArn`),
  getOnlineAgentsFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-GetOnlineAgentsArn`),
  getRecordingFnArn: cdk.Fn.importValue(`${chimeStack.stackName}-GetRecordingFnArn`),
  apiDomainName: coreStack.customDomain.domainName,
});
adminStack.addDependency(coreStack);
adminStack.addDependency(chimeStack);
adminStack.addDependency(secretsStack);

// ========================================
// HR STACK
// ========================================
const hrStack = new HrStack(app, 'TodaysDentalInsightsHrN1', {
  env,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  clinicsTableName: chimeStack.clinicsTable.tableName,
  // Push Notifications Integration
  deviceTokensTableName: pushNotificationsStack.deviceTokensTable.tableName,
  deviceTokensTableArn: pushNotificationsStack.deviceTokensTable.tableArn,
  sendPushFunctionArn: pushNotificationsStack.sendPushFn.functionArn,
  apiDomainName: coreStack.customDomain.domainName,
});
hrStack.addDependency(coreStack);
hrStack.addDependency(chimeStack);
hrStack.addDependency(pushNotificationsStack);

// ========================================
// CLINIC IMAGES STACK
// ========================================
const clinicImagesStack = new ClinicImagesStack(app, 'TodaysDentalInsightsClinicImagesN1', {
  env,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  apiDomainName: coreStack.customDomain.domainName,
});
clinicImagesStack.addDependency(coreStack);
clinicImagesStack.addDependency(secretsStack);

// ========================================
// AI AGENTS STACK
// ========================================
// NOTE: Chime props are passed as hardcoded constants (not chimeStack.xxx) to break a
// synth-time cyclic dependency: AiAgents→Chime→Notifications→AiAgents.
// ChimeStack reads VoiceConfigTableName from AI_AGENTS_VOICE_CONFIG_TABLE_NAME constant
// at synth time, so aiAgentsStack must deploy first.
const ENABLE_VOICE_AI_ANALYTICS = process.env.ENABLE_VOICE_AI_ANALYTICS === 'true';
const ANALYTICS_TABLE_NAME = 'TodaysDentalInsightsAnalyticsN1-CallAnalyticsN1';

const aiAgentsStack = new AiAgentsStack(app, AI_AGENTS_STACK_NAME, {
  env,
  clinicHoursTableName: `TodaysDentalInsightsClinicHoursN1-ClinicHours`,
  clinicHoursTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/TodaysDentalInsightsClinicHoursN1-ClinicHours`,
  // Chime props as hardcoded constants (must match actual ChimeStack table names)
  clinicsTableName: `${CHIME_STACK_NAME}-Clinics`,
  clinicsTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/${CHIME_STACK_NAME}-Clinics`,
  smaIdMapParameterName: `/${CHIME_STACK_NAME}/SmaIdMap`,
  chimeStackName: CHIME_STACK_NAME,
  callQueueTableName: CALL_QUEUE_TABLE_NAME,
  agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
  agentPerformanceTableName: AGENT_PERFORMANCE_TABLE_NAME,
  mediaInsightsPipelineParameter: `/${CHIME_STACK_NAME}/MediaInsightsPipelineConfigArn`,
  holdMusicBucketName: `${CHIME_STACK_NAME.toLowerCase()}-hold-music`,
  holdMusicBucketArn: `arn:aws:s3:::${CHIME_STACK_NAME.toLowerCase()}-hold-music`,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  callAnalyticsTableName: ANALYTICS_TABLE_NAME,
  callAnalyticsTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/${ANALYTICS_TABLE_NAME}`,
  sharedRecordingsBucketName: `${CHIME_STACK_NAME.toLowerCase()}-recordings-${env.account}`,
  sharedRecordingsBucketArn: `arn:aws:s3:::${CHIME_STACK_NAME.toLowerCase()}-recordings-${env.account}`,
  webSocketDomainName: 'ws.todaysdentalservices.com',
  wsHostedZoneId: 'Z0739065CXDA7H4CVUFQ',
  connectInstanceId: '147f641d-ae2f-4d9f-8126-5ac2ff0c26f4',
  outboundContactFlowId: '9a66f56c-0d7d-41ad-9447-dda3cf1699ee',
  // Callback tables (from CallbackStack) for the action group Lambda
  callbackTablePrefix: 'todaysdentalinsights-callback-',
  defaultCallbackTableName: `TodaysDentalInsightsCallbackN1-CallbackRequests`,
  defaultCallbackTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/TodaysDentalInsightsCallbackN1-CallbackRequests`,
  apiDomainName: coreStack.customDomain.domainName,
});
aiAgentsStack.addDependency(coreStack);
aiAgentsStack.addDependency(secretsStack);
// AiAgentsStack must deploy BEFORE ChimeStack because ChimeStack uses
// AI_AGENTS_VOICE_CONFIG_TABLE_NAME (constant, but the table must exist first).
chimeStack.addDependency(aiAgentsStack);

// ========================================
// SCHEDULES STACK (depends on Templates + SecretStack)
// ========================================
const schedulesStack = new SchedulesStack(app, 'TodaysDentalInsightsSchedulesN1', {
  env,
  templatesTableName: templatesStack.templatesTable.tableName,
  queriesTableName: `TodaysDentalInsightsQueriesN1-Queries`,
  clinicHoursTableName: `TodaysDentalInsightsClinicHoursN1-ClinicHours`,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  consentFormTemplatesTableName: `TodaysDentalInsightsConsentFormDataN1-ConsentFormData`,
  consentFormInstancesTableName: `TodaysDentalInsightsConsentFormDataN1-ConsentFormInstances`,
  smaIdMapParameterName: `/${CHIME_STACK_NAME}/SmaIdMap`,
  chimeMediaRegion: CHIME_MEDIA_REGION,
  connectInstanceId: '147f641d-ae2f-4d9f-8126-5ac2ff0c26f4',
  outboundContactFlowId: '9a66f56c-0d7d-41ad-9447-dda3cf1699ee',
  apiDomainName: coreStack.customDomain.domainName,
});
schedulesStack.addDependency(coreStack);
schedulesStack.addDependency(secretsStack);
schedulesStack.addDependency(templatesStack);

// ========================================
// CONNECT + LEX AI STACK
// ========================================
const clinicsWithAiPhones = (clinicConfigData as any[])
  .filter((c: any) => c.aiPhoneNumber && c.aiPhoneNumber.trim() !== '')
  .map((c: any) => ({
    clinicId: c.clinicId,
    aiPhoneNumber: c.aiPhoneNumber.trim(),
  }));

const aiPhoneNumbersMap = clinicsWithAiPhones.reduce(
  (acc, c) => ({ ...acc, [c.aiPhoneNumber]: c.clinicId }),
  {} as Record<string, string>
);

const primaryAiPhoneNumber = clinicsWithAiPhones[0]?.aiPhoneNumber || '+14439272295';
const defaultClinicForAi = clinicsWithAiPhones[0]?.clinicId || 'dentistingreenville';
const connectAiPhoneNumbers = Array.from(new Set(clinicsWithAiPhones.map((c) => c.aiPhoneNumber)));

console.log(`[ConnectLexAiStack] Found ${clinicsWithAiPhones.length} clinics with AI phone numbers`);

const connectLexAiStack = new ConnectLexAiStack(app, 'TodaysDentalInsightsConnectLexAiN1', {
  env,
  connectInstanceId: '147f641d-ae2f-4d9f-8126-5ac2ff0c26f4',
  connectInstanceArn: 'arn:aws:connect:us-east-1:489502444760:instance/147f641d-ae2f-4d9f-8126-5ac2ff0c26f4',
  connectAiPhoneNumber: primaryAiPhoneNumber,
  connectAiPhoneNumbers,
  agentsTableName: aiAgentsStack.agentsTable.tableName,
  agentsTableArn: aiAgentsStack.agentsTable.tableArn,
  sessionsTableName: aiAgentsStack.sessionsTable.tableName,
  sessionsTableArn: aiAgentsStack.sessionsTable.tableArn,
  voiceConfigTableName: aiAgentsStack.voiceConfigTable.tableName,
  voiceConfigTableArn: aiAgentsStack.voiceConfigTable.tableArn,
  scheduledCallsTableName: aiAgentsStack.scheduledCallsTable.tableName,
  scheduledCallsTableArn: aiAgentsStack.scheduledCallsTable.tableArn,
  callAnalyticsTableName: ANALYTICS_TABLE_NAME,
  callAnalyticsTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/${ANALYTICS_TABLE_NAME}`,
  transcriptBufferTableName: `TodaysDentalInsightsAnalyticsN1-TranscriptBuffersV2`,
  transcriptBufferTableArn: `arn:aws:dynamodb:${env.region || 'us-east-1'}:${env.account}:table/TodaysDentalInsightsAnalyticsN1-TranscriptBuffersV2`,
  aiPhoneNumbersJson: JSON.stringify(aiPhoneNumbersMap),
  defaultClinicId: defaultClinicForAi,
  thinkingAudioMode: 'verbal',
  clinicSecretsTableName: secretsStack.clinicSecretsTable.tableName,
  clinicConfigTableName: secretsStack.clinicConfigTable.tableName,
  globalSecretsTableName: secretsStack.globalSecretsTable.tableName,
  secretsEncryptionKeyArn: secretsStack.secretsEncryptionKey.keyArn,
  useAsyncPattern: true,
  asyncMaxPollLoops: 25,
});
connectLexAiStack.addDependency(aiAgentsStack);
connectLexAiStack.addDependency(secretsStack);

// ========================================
// NOTIFICATIONS — post-AI-Agents dependency
// ========================================
notificationsStack.addDependency(aiAgentsStack);

// ========================================
// IT TICKET STACK
// ========================================
const ITTicketStack = new ItTicketStack(app, 'TodaysDentalInsightsItTicketN1', {
  env,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  apiDomainName: coreStack.customDomain.domainName,
});
ITTicketStack.addDependency(coreStack);

// ========================================
// LEASE MANAGEMENT STACK
// ========================================
const leaseManagementStack = new LeaseManagementStack(app, 'TodaysDentalInsightsLeaseManagementN1', {
  env,
  apiDomainName: coreStack.customDomain.domainName,
});
leaseManagementStack.addDependency(coreStack);