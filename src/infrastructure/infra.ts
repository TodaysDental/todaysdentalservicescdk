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

import { CommStack } from './stacks/comm-stack'; // <-- NEW IMPORT ADDED HERE
import { AnalyticsStack } from './stacks/analytics-stack';

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


// 3. Granular Service Stacks - Each service has its own stack with table and API endpoints

// Clinic Hours service - MOVED HERE as it's used by ChatbotStack, AdminStack, and SchedulesStack
const clinicHoursStack = new ClinicHoursStack(app, 'TodaysDentalInsightsClinicHoursN1', {
  env,
});

// Clinic Pricing service
const clinicPricingStack = new ClinicPricingStack(app, 'TodaysDentalInsightsClinicPricingN1', {
  env,
});

// Clinic Insurance service
const clinicInsuranceStack = new ClinicInsuranceStack(app, 'TodaysDentalInsightsClinicInsuranceN1', {
  env,
});

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

// OpenDental service with SFTP resources
const openDentalStack = new OpenDentalStack(app, 'TodaysDentalInsightsOpenDentalN1', {
  env,
});

// Notifications service
const notificationsStack = new NotificationsStack(app, 'TodaysDentalInsightsNotificationsN1', {
  env,
  templatesTableName: templatesStack.templatesTable.tableName,
});

// Amazon Chime Voice Integration - create Chime stack first and export
// Lambda ARNs. We intentionally do NOT pass the Admin API object into the
// Chime stack to avoid a two-way construct dependency which leads to
// cyclic CloudFormation references.

// ** ANALYTICS STACK INSTANTIATION (BEFORE CHIME) **
const analyticsStack = new AnalyticsStack(app, 'TodaysDentalInsightsAnalyticsN1', {
  env,
  jwtSecret: coreStack.jwtSecretValue,
  region: env.region || process.env.AWS_REGION || 'us-east-1',
  supervisorEmails: [], // Add supervisor emails for alerts
  // Note: callQueueTableName and agentPresenceTableName will be passed from ChimeStack
});

const chimeStack = new ChimeStack(app, 'TodaysDentalInsightsChimeN1', {
 env,
 jwtSecret: coreStack.jwtSecretValue,
 voiceConnectorTerminationCidrs,
 voiceConnectorOriginationRoutes,
 analyticsTableName: analyticsStack.analyticsTable.tableName,
 analyticsDedupTableName: analyticsStack.analyticsDedupTable.tableName,
 enableCallRecording: true, // Enable call recording by default
 recordingRetentionDays: 2555, // ~7 years for compliance
 medicalVocabularyName: analyticsStack.medicalVocabularyName,
});
// ** COMMUNICATIONS STACK INSTANTIATION **
const communicationsStack = new CommStack(app, 'TodaysDentalInsightsCommN1', {
    env,
    jwtSecret: coreStack.jwtSecretValue,
});

// Chatbot Stack - WebSocket-based dental assistant chatbot (depends on core and clinic data)
// NOTE: Declared here before AdminStack because AdminStack needs chatbotStack.conversationsTable.tableName
const chatbotStack = new ChatbotStack(app, 'TodaysDentalInsightsChatbotN1', {
  env,
  // Chatbot reads directly from DynamoDB tables - no API calls needed
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
  clinicPricingTableName: clinicPricingStack.clinicPricingTable.tableName,
  clinicInsuranceTableName: clinicInsuranceStack.clinicInsuranceTable.tableName,
});

// Admin services (AdminStack will import Chime lambda ARNs and wire API
// methods). Importing the ARNs makes Admin depend on Chime (one-way), which
// avoids the cyclic dependency we were seeing.
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminN1', {
 env,
 staffUserTableName: coreStack.staffUserTable.tableName,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  favorsTableName: communicationsStack.favorsTable.tableName,
  teamsTableName: communicationsStack.teamsTable.tableName, // For group favor requests
  clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
  analyticsTableName: analyticsStack.analyticsTable.tableName,
  jwtSecretValue: coreStack.jwtSecretValue,
 // Additional table names for detailed analytics
 callQueueTableName: chimeStack.callQueueTable.tableName,
 recordingMetadataTableName: chimeStack.recordingMetadataTable?.tableName,
 chatHistoryTableName: chatbotStack.conversationsTable.tableName,
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


// Schedules service (depends on other services for cross-table access)
const schedulesStack = new SchedulesStack(app, 'TodaysDentalInsightsSchedulesN1', {
 env,
 templatesTableName: templatesStack.templatesTable.tableName,
 queriesTableName: queriesStack.queriesTable.tableName,
 clinicHoursTableName: clinicHoursStack.clinicHoursTable.tableName,
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
});

const callbackStack = new CallbackStack(app, 'TodaysDentalInsightsCallbackN1', {
 env,
});

// 7. Patient Portal Stack - Dedicated patient portal API (depends on core and OpenDental)
const patientPortalStack = new PatientPortalStack(app, 'TodaysDentalInsightsPatientPortalN1', {
 env,
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
 consolidatedTransferServerBucket: openDentalStack.consolidatedSftpBucket.bucketName,
});
const patientPortalApptTypesStack = new PatientPortalApptTypesStack(app, 'TodaysDentalInsightsPatientPortalApptTypesN1', {
 env,
});
// patientPortalApptTypesStack.addDependency(coreStack); // Implicit

// Clinic Hours service - REMOVED FROM HERE, moved to top after coreStack

// Add stack dependencies
// Core dependencies

// NOTE: When using Fn.importValue() for AuthorizerFunctionArn, dependencies are NOT implicit
// Explicit dependencies are required to ensure CoreStack is deployed first

// Service stack dependencies - EXPLICIT because they import AuthorizerFunctionArn
templatesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
consentFormDataStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
queriesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicHoursStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicPricingStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
clinicInsuranceStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
openDentalStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
hrStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn

communicationsStack.addDependency(coreStack); // Explicit - uses JWT secret

// Analytics stack dependencies
// analyticsStack.addDependency(coreStack); // Implicit through jwtSecret

// Cross-service dependencies for services that need data from other services
notificationsStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
notificationsStack.addDependency(templatesStack); // Explicit - uses table name
adminStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
schedulesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
schedulesStack.addDependency(templatesStack); // Explicit - uses table name
schedulesStack.addDependency(queriesStack); // Explicit - uses table name
schedulesStack.addDependency(openDentalStack); // Explicit - uses server ID



// Other existing stack dependencies
callbackStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
patientPortalApptTypesStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
// patientPortalStack.addDependency(coreStack); // Note: PatientPortalStack might not import it - verify
patientPortalStack.addDependency(openDentalStack); // Explicit - uses SFTP resources
chatbotStack.addDependency(coreStack); // Explicit - imports AuthorizerFunctionArn
chatbotStack.addDependency(clinicPricingStack); // Explicit - uses table name
chatbotStack.addDependency(clinicInsuranceStack); // Explicit - uses table name

// Fluoride Automation Stack - Run automation for adding fluoride treatments every hour
// const fluorideAutomationStack = new FluorideAutomationStack(app, 'TodaysDentalInsightsFluorideAutomationV1', {
//  env,
// });
// fluorideAutomationStack.addDependency(openDentalStack); // Add dependency on OpenDental stack for SFTP server

// CRITICAL FIX: Remove commented-out code that could lead to circular dependencies
// Note: The proper dependencies are already set above:
// 1. adminStack.addDependency(chimeStack) - Admin depends on Chime
// 2. chimeStack.addDependency(coreStack) - Chime depends on Core
// Do not uncomment the following line as it would create a circular reference:
// chimeStack.addDependency(adminStack)