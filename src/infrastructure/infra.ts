#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from './stacks/core-stack';
import { CallbackStack } from './stacks/callback-stack';
import { PatientPortalStack } from './stacks/patient-portal-stack';
import { ChatbotStack } from './stacks/chatbot-stack';
// Granular service stacks
import { TemplatesStack } from './stacks/templates-stack';
import { SchedulesStack } from './stacks/schedules-stack';
import { QueriesStack } from './stacks/queries-stack';
import { ClinicHoursStack } from './stacks/clinic-hours-stack';
import { ClinicPricingStack } from './stacks/clinic-pricing-stack';
import { ClinicInsuranceStack } from './stacks/clinic-insurance-stack';
import { AdminStack } from './stacks/admin-stack';
import { OpenDentalStack } from './stacks/opendental-stack';
import { NotificationsStack } from './stacks/notifications-stack';
import { ConnectStack } from './stacks/connect-stack';

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

// Queries service
const queriesStack = new QueriesStack(app, 'TodaysDentalInsightsQueriesV3', {
  env,
  userPool: coreStack.userPool,
});

// Placeholder for Connect stack - will be created after chatbot stack

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

// Admin services
const adminStack = new AdminStack(app, 'TodaysDentalInsightsAdminV3', {
  env,
  userPool: coreStack.userPool,
  userPoolArn: coreStack.userPool.userPoolArn,
  userPoolId: coreStack.userPool.userPoolId,
  staffClinicInfoTableName: coreStack.staffClinicInfoTable.tableName,
  clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
  // voiceAgentsTableName: coreStack.voiceAgentsTable.tableName, // Not needed in Connect-native architecture
});


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

// 9. Connect Stack - Amazon Connect integration for voice calls (depends on chatbot for after-hours routing)
const connectStack = new ConnectStack(app, 'TodaysDentalInsightsConnectV1', {
  env,
  userPool: coreStack.userPool,
  userPoolId: coreStack.userPool.userPoolId,
  userPoolArn: coreStack.userPool.userPoolArn,
  clinicHoursTableName: 'todaysdentalinsights-ClinicHoursV3',
  chatbotApiUrl: 'https://api.todaysdentalinsights.com/chatbot',
  // voiceAgentsTableName: coreStack.voiceAgentsTable.tableName, // Not needed in Connect-native architecture
});

// 10. Clinic Hours service (depends on Connect stack for instance ID)
const clinicHoursStack = new ClinicHoursStack(app, 'TodaysDentalInsightsClinicHoursV3', {
  env,
  userPool: coreStack.userPool,
  connectInstanceId: connectStack.connectInstanceId,
});

// Add stack dependencies
// Core dependencies

// Service stack dependencies (each service only depends on core for user pool)
templatesStack.addDependency(coreStack);
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

// Connect stack dependencies
connectStack.addDependency(coreStack);
connectStack.addDependency(chatbotStack);
clinicHoursStack.addDependency(connectStack);


// Other existing stack dependencies
callbackStack.addDependency(coreStack);
patientPortalStack.addDependency(coreStack);
patientPortalStack.addDependency(openDentalStack);
chatbotStack.addDependency(coreStack);
chatbotStack.addDependency(clinicPricingStack);
chatbotStack.addDependency(clinicInsuranceStack);


