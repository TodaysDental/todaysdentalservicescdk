#!/usr/bin/env node
import 'source-map-support/register';
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

// 1. Core Stack - Cognito and basic auth (minimal resources)
const coreStack = new CoreStack(app, 'TodaysDentalInsightsCoreV2', { env });


// 3. Granular Service Stacks - Each service has its own stack with table and API endpoints

// Templates service
const templatesStack = new TemplatesStack(app, 'TodaysDentalInsightsTemplatesV3', {
 env,
 authorizer: coreStack.authorizer,
});

// *** NEW STACK ***
// Consent Form Data service
const consentFormDataStack = new ConsentFormDataStack(app, 'TodaysDentalInsightsConsentFormDataV1', {
 env,
 authorizer: coreStack.authorizer,
});
// *** END NEW STACK ***

// Queries service
const queriesStack = new QueriesStack(app, 'TodaysDentalInsightsQueriesV3', {
 env,
 authorizer: coreStack.authorizer,
});

// Clinic Pricing service
const clinicPricingStack = new ClinicPricingStack(app, 'TodaysDentalInsightsClinicPricingV3', {
 env,
 authorizer: coreStack.authorizer,
});

// Clinic Insurance service
const clinicInsuranceStack = new ClinicInsuranceStack(app, 'TodaysDentalInsightsClinicInsuranceV3', {
 env,
 authorizer: coreStack.authorizer,
});

// OpenDental service with SFTP resources
const openDentalStack = new OpenDentalStack(app, 'TodaysDentalInsightsOpenDentalV2', {
 env,
 authorizer: coreStack.authorizer,
});

// Notifications service
const notificationsStack = new NotificationsStack(app, 'TodaysDentalInsightsNotificationsV3', {
 env,
 authorizer: coreStack.authorizer,
 templatesTableName: templatesStack.templatesTable.tableName,
});

// Amazon Chime Voice Integration - create Chime stack first and export
// Lambda ARNs. We intentionally do NOT pass the Admin API object into the
// Chime stack to avoid a two-way construct dependency which leads to
// cyclic CloudFormation references.

// ** ANALYTICS STACK INSTANTIATION (BEFORE CHIME) **
const analyticsStack = new AnalyticsStack(app, 'TodaysDentalInsightsAnalyticsV1', {
  env,
  authorizer: coreStack.authorizer,
  region: env.region || process.env.AWS_REGION || 'us-east-1',
  supervisorEmails: [], // Add supervisor emails for alerts
  // Note: callQueueTableName and agentPresenceTableName will be passed from ChimeStack
});

const chimeStack = new ChimeStack(app, 'TodaysDentalInsightsChimeV23', {
 env,
 authorizer: coreStack.authorizer,
 voiceConnectorTerminationCidrs,
 voiceConnectorOriginationRoutes,
 analyticsTableName: analyticsStack.analyticsTable.tableName,
 analyticsDedupTableName: analyticsStack.analyticsDedupTable.tableName,
 enableCallRecording: true, // Enable call recording by default
 recordingRetentionDays: 2555, // ~7 years for compliance
 medicalVocabularyName: analyticsStack.medicalVocabularyName,
});
// ** COMMUNICATIONS STACK INSTANTIATION **
const communicationsStack = new CommStack(app, 'TodaysDentalInsightsCommV1', {
    env,
    authorizer: coreStack.authorizer,
});

// Chatbot Stack - WebSocket-based dental assistant chatbot (depends on core and clinic data)
// NOTE: Declared here before AdminStack because AdminStack needs chatbotStack.conversationsTable.tableName
const chatbotStack = new ChatbotStack(app, 'TodaysDentalInsightsChatbotV2', {
 env,
 authorizer: coreStack.authorizer,
 // Chatbot reads directly from DynamoDB tables - no API calls needed
 clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
 clinicPricingTableName: clinicPricingStack.clinicPricingTable.tableName,
 clinicInsuranceTableName: clinicInsuranceStack.clinicInsuranceTable.tableName,
});

// Admin services (AdminStack will import Chime lambda ARNs and wire API
// methods). Importing the ARNs makes Admin depend on Chime (one-way), which
// avoids the cyclic dependency we were seeing.
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminV3', {
 env,
 authorizer: coreStack.authorizer,
 staffUserTableName: coreStack.staffUserTable.tableName,
 staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
 favorsTableName: communicationsStack.favorsTable.tableName,
 clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
 analyticsTableName: analyticsStack.analyticsTable.tableName,
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
chimeStack.addDependency(coreStack);

// 3. Add a warning comment to prevent future circular dependencies
// DO NOT add a dependency from ChimeStack to AdminStack as this would create a circular reference:
// ChimeStack -> AdminStack -> ChimeStack

// The Admin stack now receives the agent presence table name via props,
// so no additional configuration is needed here.

const hrStack = new HrStack(app, 'TodaysDentalInsightsHrV1', {
 env,
 authorizer: coreStack.authorizer,
 staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
});
hrStack.addDependency(coreStack);


// Schedules service (depends on other services for cross-table access)
const schedulesStack = new SchedulesStack(app, 'TodaysDentalInsightsSchedulesV3', {
 env,
 authorizer: coreStack.authorizer,
 templatesTableName: templatesStack.templatesTable.tableName,
 queriesTableName: queriesStack.queriesTable.tableName,
 clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
});

const callbackStack = new CallbackStack(app, 'TodaysDentalInsightsCallbackV2', {
 env,
 authorizer: coreStack.authorizer,
});

// 7. Patient Portal Stack - Dedicated patient portal API (depends on core and OpenDental)
const patientPortalStack = new PatientPortalStack(app, 'TodaysDentalInsightsPatientPortalV2', {
 env,
 authorizer: coreStack.authorizer,
 consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
 consolidatedTransferServerBucket: openDentalStack.consolidatedSftpBucket.bucketName,
});
const patientPortalApptTypesStack = new PatientPortalApptTypesStack(app, 'TodaysDentalInsightsPatientPortalApptTypesV1', {
 env,
 authorizer: coreStack.authorizer,
});
patientPortalApptTypesStack.addDependency(coreStack);

// Clinic Hours service
const clinicHoursStack = new ClinicHoursStack(app, 'TodaysDentalInsightsClinicHoursV3', {
 env,
 authorizer: coreStack.authorizer,
});

// Add stack dependencies
// Core dependencies

// Service stack dependencies (each service only depends on core for user pool)
templatesStack.addDependency(coreStack);
consentFormDataStack.addDependency(coreStack); // Add dependency for the new stack
queriesStack.addDependency(coreStack);
clinicHoursStack.addDependency(coreStack);
clinicPricingStack.addDependency(coreStack);
clinicInsuranceStack.addDependency(coreStack);
openDentalStack.addDependency(coreStack);

communicationsStack.addDependency(coreStack); // <-- NEW DEPENDENCY ADDED HERE

// Analytics stack dependencies
analyticsStack.addDependency(coreStack);

// Cross-service dependencies for services that need data from other services
notificationsStack.addDependency(coreStack);
notificationsStack.addDependency(templatesStack);
adminStack.addDependency(coreStack);
schedulesStack.addDependency(coreStack);
schedulesStack.addDependency(templatesStack);
schedulesStack.addDependency(queriesStack);
schedulesStack.addDependency(openDentalStack);



// Other existing stack dependencies
callbackStack.addDependency(coreStack);
patientPortalStack.addDependency(coreStack);
patientPortalStack.addDependency(openDentalStack);
chatbotStack.addDependency(coreStack);
chatbotStack.addDependency(clinicPricingStack);
chatbotStack.addDependency(clinicInsuranceStack);

// Fluoride Automation Stack - Run automation for adding fluoride treatments every hour
// const fluorideAutomationStack = new FluorideAutomationStack(app, 'TodaysDentalInsightsFluorideAutomationV1', {
//  env,
//  userPool: coreStack.userPool,
// });
// fluorideAutomationStack.addDependency(coreStack);
// fluorideAutomationStack.addDependency(openDentalStack); // Add dependency on OpenDental stack for SFTP server

// CRITICAL FIX: Remove commented-out code that could lead to circular dependencies
// Note: The proper dependencies are already set above:
// 1. adminStack.addDependency(chimeStack) - Admin depends on Chime
// 2. chimeStack.addDependency(coreStack) - Chime depends on Core
// Do not uncomment the following line as it would create a circular reference:
// chimeStack.addDependency(adminStack)