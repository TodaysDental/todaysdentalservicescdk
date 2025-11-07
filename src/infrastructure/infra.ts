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
import { ChimeStack } from './stacks/chime-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,
};

// 1. Core Stack - Cognito and basic auth (minimal resources)
const coreStack = new CoreStack(app, 'TodaysDentalInsightsCoreV2', { env });


// 3. Granular Service Stacks - Each service has its own stack with table and API endpoints

// Templates service
const templatesStack = new TemplatesStack(app, 'TodaysDentalInsightsTemplatesV3', {
  env,
  userPool: coreStack.userPool,
});

// *** NEW STACK ***
// Consent Form Data service
const consentFormDataStack = new ConsentFormDataStack(app, 'TodaysDentalInsightsConsentFormDataV1', {
  env,
  userPool: coreStack.userPool,
});
// *** END NEW STACK ***

// Queries service
const queriesStack = new QueriesStack(app, 'TodaysDentalInsightsQueriesV3', {
  env,
  userPool: coreStack.userPool,
});

// Clinic Pricing service
const clinicPricingStack = new ClinicPricingStack(app, 'TodaysDentalInsightsClinicPricingV3', {
  env,
  userPool: coreStack.userPool,
});

// Clinic Insurance service
const clinicInsuranceStack = new ClinicInsuranceStack(app, 'TodaysDentalInsightsClinicInsuranceV3', {
  env,
  userPool: coreStack.userPool,
});

// OpenDental service with SFTP resources
const openDentalStack = new OpenDentalStack(app, 'TodaysDentalInsightsOpenDentalV2', {
  env,
  userPool: coreStack.userPool,
});

// Notifications service
const notificationsStack = new NotificationsStack(app, 'TodaysDentalInsightsNotificationsV3', {
  env,
  userPool: coreStack.userPool,
  templatesTableName: templatesStack.templatesTable.tableName,
});

// Amazon Chime Voice Integration - create Chime stack first and export
// Lambda ARNs. We intentionally do NOT pass the Admin API object into the
// Chime stack to avoid a two-way construct dependency which leads to
// cyclic CloudFormation references.
const chimeStack = new ChimeStack(app, 'TodaysDentalInsightsChimeV22', {
  env,
  userPool: coreStack.userPool,
});

// Admin services (AdminStack will import Chime lambda ARNs and wire API
// methods). Importing the ARNs makes Admin depend on Chime (one-way), which
// avoids the cyclic dependency we were seeing.
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminV3', {
  env,
  userPool: coreStack.userPool,
  userPoolArn: coreStack.userPool.userPoolArn,
  userPoolId: coreStack.userPool.userPoolId,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
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


// Schedules service (depends on other services for cross-table access)
const schedulesStack = new SchedulesStack(app, 'TodaysDentalInsightsSchedulesV3', {
  env,
  userPool: coreStack.userPool,
  templatesTableName: templatesStack.templatesTable.tableName,
  queriesTableName: queriesStack.queriesTable.tableName,
  clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
  consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
});


// 6. Callback Stack - Dedicated callback API (depends on core)
const callbackStack = new CallbackStack(app, 'TodaysDentalInsightsCallbackV2', {
  env,
  userPoolArn: coreStack.userPool.userPoolArn,
  userPoolId: coreStack.userPool.userPoolId,
});

// 7. Patient Portal Stack - Dedicated patient portal API (depends on core and OpenDental)
const patientPortalStack = new PatientPortalStack(app, 'TodaysDentalInsightsPatientPortalV2', {
  env,
  userPoolArn: coreStack.userPool.userPoolArn,
  userPoolId: coreStack.userPool.userPoolId,
  consolidatedTransferServerId: openDentalStack.consolidatedTransferServer.attrServerId,
  consolidatedTransferServerBucket: openDentalStack.consolidatedSftpBucket.bucketName,
});

// 8. Chatbot Stack - WebSocket-based dental assistant chatbot (depends on core and clinic data)
const chatbotStack = new ChatbotStack(app, 'TodaysDentalInsightsChatbotV2', {
  env,
  userPoolArn: coreStack.userPool.userPoolArn,
  userPoolId: coreStack.userPool.userPoolId,
  // Chatbot reads directly from DynamoDB tables - no API calls needed
  clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
  clinicPricingTableName: clinicPricingStack.clinicPricingTable.tableName,
  clinicInsuranceTableName: clinicInsuranceStack.clinicInsuranceTable.tableName,
});

// Clinic Hours service
const clinicHoursStack = new ClinicHoursStack(app, 'TodaysDentalInsightsClinicHoursV3', {
  env,
  userPool: coreStack.userPool,
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

// CRITICAL FIX: Remove commented-out code that could lead to circular dependencies
// Note: The proper dependencies are already set above:
// 1. adminStack.addDependency(chimeStack) - Admin depends on Chime
// 2. chimeStack.addDependency(coreStack) - Chime depends on Core
// Do not uncomment the following line as it would create a circular reference:
// chimeStack.addDependency(adminStack)
