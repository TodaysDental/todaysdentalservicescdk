import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as logs from 'aws-cdk-lib/aws-logs';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';
import clinicsData from '../configs/clinics.json';
import { CONNECT_CONFIG } from '../configs/connect-config';
import { ClinicRoutingCustomResource } from '../utils/ClinicRoutingCustomResource';

export interface ConnectStackProps extends StackProps {
  userPool: any;
  userPoolId: string;
  userPoolArn: string;
  clinicHoursTableName?: string; // Still needed for business hours logic
  chatbotApiUrl: string;
  // Connect-native architecture - voice agents created directly in Connect, no DynamoDB needed
}

export class ConnectStack extends Stack {
  // Connect Instance from configuration
  private readonly EXISTING_CONNECT_INSTANCE_ID = CONNECT_CONFIG.INSTANCE_ID;
  private readonly EXISTING_CONNECT_INSTANCE_ARN = CONNECT_CONFIG.INSTANCE_ARN;
  
  public connectInstanceId: string;
  public masterRoutingProfileId: string = CONNECT_CONFIG.ROUTING_PROFILES.GLOBAL_ALL_CLINICS;

  // Connect-native architecture - no DynamoDB tables needed

  // API Gateway
  public restApi: apigw.RestApi;
  public authorizer: apigw.CognitoUserPoolsAuthorizer;

  // Lambda Functions
  public connectUserFn: lambdaNode.NodejsFunction;
  public connectRoutingFn: lambdaNode.NodejsFunction;
  public accessControlFn: lambdaNode.NodejsFunction;
  public connectConfigFn: lambdaNode.NodejsFunction;
  public contactFlowGeneratorFn: lambdaNode.NodejsFunction;
  public participantServiceFn: lambdaNode.NodejsFunction;
  public connectEventHandlerFn: lambdaNode.NodejsFunction;
  public voiceAgentFn: lambdaNode.NodejsFunction;
  public samlAuthFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: ConnectStackProps) {
    super(scope, id, props);

    // Set the instance ID for use by other stacks
    this.connectInstanceId = this.EXISTING_CONNECT_INSTANCE_ID;

    // ========================================
    // EXISTING AMAZON CONNECT INSTANCE
    // ========================================

    const EXISTING_CONNECT_INSTANCE_ARN = 'arn:aws:connect:us-east-1:851620242036:instance/e265b644-3dad-4490-b7c4-27036090c5f1';
    const EXISTING_CONNECT_INSTANCE_ID = 'e265b644-3dad-4490-b7c4-27036090c5f1';

    // Set the instance ID for use by other stacks
    this.connectInstanceId = EXISTING_CONNECT_INSTANCE_ID;

    // ========================================
    // AMAZON CONNECT RESOURCES (ABR APPROACH)
    // ========================================

    // Create Hours of Operation (default business hours)
    const defaultHoursOfOperation = new connect.CfnHoursOfOperation(this, 'DefaultHoursOfOperation', {
      instanceArn: this.EXISTING_CONNECT_INSTANCE_ARN,
      name: 'Default Business Hours',
      description: 'Standard business hours for all clinics',
      timeZone: 'America/New_York', // You can customize this per clinic later
      config: [
        {
          day: 'MONDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          day: 'TUESDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          day: 'WEDNESDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          day: 'THURSDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          day: 'FRIDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          day: 'SATURDAY',
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          day: 'SUNDAY',
          startTime: { hours: 0, minutes: 0 },
          endTime: { hours: 0, minutes: 0 }, // Closed
        },
      ],
    });

    // Create queues for each clinic (ABR: one queue per clinic)
    const clinicQueues: Record<string, connect.CfnQueue> = {};
    for (const clinic of clinicsData as any[]) {
      const queue = new connect.CfnQueue(this, `Queue-${clinic.clinicId}`, {
      instanceArn: this.EXISTING_CONNECT_INSTANCE_ARN,
      name: `q-${clinic.clinicId}`,
        description: `Queue for ${clinic.clinicName} (Attribute-Based Routing)`,
        hoursOfOperationArn: defaultHoursOfOperation.attrHoursOfOperationArn,
        maxContacts: 100,
        // Note: Phone number and quick connect configuration will be handled by setup script
        // as these require specific Connect resources that are easier to manage via API
      });

      clinicQueues[clinic.clinicId] = queue;
    }

    // Create master routing profile (Connect-native: single profile for all agents)
    const masterRoutingProfile = new connect.CfnRoutingProfile(this, 'MasterRoutingProfile', {
      instanceArn: this.EXISTING_CONNECT_INSTANCE_ARN,
      name: 'rp-MasterAgent',
      description: 'Master routing profile for all clinics (Connect-native architecture)',
      defaultOutboundQueueArn: Object.values(clinicQueues)[0].attrQueueArn,
      mediaConcurrencies: [
        {
          channel: 'VOICE',
          concurrency: 1,
        },
      ],
      queueConfigs: Object.entries(clinicQueues).map(([clinicId, queue]) => ({
        queueReference: {
          queueArn: queue.attrQueueArn,
          channel: 'VOICE',
        },
        priority: 1,
        delay: 0,
      })),
    });

    // Store references for use by other resources
    this.masterRoutingProfileId = masterRoutingProfile.attrRoutingProfileArn;

    // Note: Quick connects and advanced queue configuration will be handled by setup script
    // as these require specific Connect resources (phone numbers, users) that are easier to manage via API

    // ========================================
    // CONNECT-NATIVE ARCHITECTURE
    // ========================================
    // No DynamoDB tables needed - using Connect APIs and user proficiencies only

    // ========================================
    // CONNECT-NATIVE SETUP
    // ========================================
    // Configuration is now handled by the setup script (setup-connect-integration.ts)
    // All Connect resources are managed via Connect APIs and environment variables

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    const commonConfig = {
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node22',
        minify: false,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-connect',
          '@aws-sdk/client-connectparticipant',
        ],
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        POWERTOOLS_SERVICE_NAME: 'connect-stack',
        STACK_NAME: this.stackName,
        ENVIRONMENT: 'prod',
        // Connect Configuration (Connect-native architecture)
        CONNECT_INSTANCE_ID: EXISTING_CONNECT_INSTANCE_ID,
        CONNECT_INSTANCE_ARN: EXISTING_CONNECT_INSTANCE_ARN,
        CONNECT_MASTER_ROUTING_PROFILE_ID: masterRoutingProfile.attrRoutingProfileArn,
        CONNECT_SECURITY_PROFILE_ID: process.env.CONNECT_SECURITY_PROFILE_ID || 'default-security-profile-id',
        CHATBOT_API_URL: props.chatbotApiUrl || 'https://placeholder-chatbot-url.com',
        // User Pool
        USER_POOL_ID: props.userPoolId,
        // Clinic Hours Table (still needed for business logic)
        CLINIC_HOURS_TABLE: props.clinicHoursTableName || 'todaysdentalinsights-ClinicHoursV3',
      },
    };

    // Connect User Management Function
    this.connectUserFn = new lambdaNode.NodejsFunction(this, 'ConnectUserFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connectUser.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      description: 'Manages Connect user access and clinic assignments',
    });

    // Connect Routing Function
    this.connectRoutingFn = new lambdaNode.NodejsFunction(this, 'ConnectRoutingFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connectRouting.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(30),
      description: 'Handles Connect call routing and access control',
    });


    // Access Control Function
    this.accessControlFn = new lambdaNode.NodejsFunction(this, 'AccessControlFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'accessControl.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      description: 'Validates user access to clinic calls',
    });

    // Connect Configuration Function
    this.connectConfigFn = new lambdaNode.NodejsFunction(this, 'ConnectConfigFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connectConfig.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      description: 'Manages Connect configuration and phone number sync',
    });

    // Contact Flow Generator Function
    this.contactFlowGeneratorFn = new lambdaNode.NodejsFunction(this, 'ContactFlowGeneratorFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'contactFlowGenerator.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      description: 'Generates Connect contact flows based on clinic hours and agent availability',
    });

    // Connect Participant Service Function
    this.participantServiceFn = new lambdaNode.NodejsFunction(this, 'ConnectParticipantServiceFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'participantService.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(30),
      description: 'Manages Connect participant interactions for softphone functionality',
    });

    // Connect Event Handler Function
    this.connectEventHandlerFn = new lambdaNode.NodejsFunction(this, 'ConnectEventHandlerFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connectEventHandler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      description: 'Processes Connect events for real-time softphone notifications',
    });

    // Voice Agent Function
    this.voiceAgentFn = new lambdaNode.NodejsFunction(this, 'VoiceAgentFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'voiceAgent.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(30),
      description: 'Manages voice agents in Amazon Connect (Connect-native architecture)',
    });

    // SAML Authentication Function
    this.samlAuthFn = new lambdaNode.NodejsFunction(this, 'SAMLAuthFunction', {
      ...commonConfig,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'samlAuth.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(30),
      description: 'Manages SAML authentication for Amazon Connect',
    });

    // ========================================
    // IAM PERMISSIONS
    // ========================================

    // Clinic hours table permissions (still needed for business hours logic)
    if (props.clinicHoursTableName) {
      const clinicHoursTable = dynamodb.Table.fromTableAttributes(this, 'ConnectClinicHoursTable', {
        tableName: props.clinicHoursTableName,
      });
      clinicHoursTable.grantReadData(this.contactFlowGeneratorFn);
      clinicHoursTable.grantReadData(this.connectRoutingFn);
      clinicHoursTable.grantReadData(this.accessControlFn);
    }

    // Connect-native architecture - no voice agents table needed for Connect functionality

    // ========================================
    // GRANULAR IAM POLICIES
    // ========================================

    // Connect User Management - User-related Connect permissions (Connect-native approach)
    const connectUserPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:CreateUser',
        'connect:DeleteUser',
        'connect:DescribeUser',
        'connect:ListUsers',
        'connect:UpdateUserIdentityInfo',
        'connect:UpdateUserPhoneConfig',
        'connect:UpdateUserRoutingProfile',
        'connect:UpdateUserSecurityProfiles',
        'connect:UpdateUserProficiencies', // Required for Attribute-Based Routing
        'connect:UpdateUserHierarchy', // For clinic-based user hierarchies
        'connect:ListUserHierarchies',
        'connect:DescribeUserHierarchyGroup',
        'connect:CreateUserHierarchyGroup',
        'connect:UpdateUserHierarchyStructure',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // Connect Routing - Call routing and contact management permissions
    const connectRoutingPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:GetContactAttributes',
        'connect:UpdateContactAttributes',
        'connect:DescribePhoneNumber',
        'connect:ListPhoneNumbers',
        'connect:CreateContact',
        'connect:DescribeContact',
        'connect:ListContacts',
        'connect:StartOutboundVoiceContact',
        'connect:StopContact',
        'connect:UpdateAgentStatus',
        'connect:ListAgentStatuses',
        'connect:DescribeAgentStatus',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // Contact Flow Generator - Contact flow management permissions
    const contactFlowPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:CreateContactFlow',
        'connect:DeleteContactFlow',
        'connect:DescribeContactFlow',
        'connect:ListContactFlows',
        'connect:UpdateContactFlowContent',
        'connect:CreateHoursOfOperation',
        'connect:UpdateHoursOfOperation',
        'connect:DescribeHoursOfOperation',
        'connect:ListHoursOfOperations',
        'connect:CreateQueue',
        'connect:UpdateQueueStatus',
        'connect:DescribeQueue',
        'connect:ListQueues',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // Participant Service - Voice and participant permissions (Connect-native)
    const participantPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:StartOutboundVoiceContact',
        'connect:StopContact',
        'connect:UpdateAgentStatus',
        'connect:GetContactAttributes',
        'connect:UpdateContactAttributes',
        'connect:GetCurrentUserData',
        'connect:ListCurrentUserData',
        'connect:CreateParticipant',
        'connect:DescribeContact',
        'connect:ListContactsByContactReference',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // Event Handler - Connect events and monitoring permissions
    const connectEventPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:DescribeContact',
        'connect:ListContacts',
        'connect:GetContactAttributes',
        'connect:GetCurrentUserData',
        'connect:ListCurrentUserData',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // Voice Agent - User management permissions for voice agents
    const voiceAgentPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:CreateUser',
        'connect:DeleteUser',
        'connect:DescribeUser',
        'connect:ListUsers',
        'connect:UpdateUserIdentityInfo',
        'connect:UpdateUserPhoneConfig',
        'connect:UpdateUserRoutingProfile',
        'connect:UpdateUserSecurityProfiles',
        'connect:UpdateUserProficiencies',
        'connect:UpdateUserHierarchy',
        'connect:ListUserHierarchies',
        'connect:DescribeUserHierarchyGroup',
        'connect:CreateUserHierarchyGroup',
        'connect:UpdateUserHierarchyStructure',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN, `${this.EXISTING_CONNECT_INSTANCE_ARN}/*`],
    });

    // SAML Authentication - Connect permissions for SAML configuration
    const samlAuthPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:DescribeInstance',
        'connect:ListInstances',
      ],
      resources: [this.EXISTING_CONNECT_INSTANCE_ARN],
    });

    // Access Control - Clinic hours and voice agents permissions only
    const accessControlPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        // Only clinic hours table needed for business logic
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicHoursTableName || 'todaysdentalinsights-ClinicHoursV3'}`,
      ],
    });

    // Apply granular permissions (Connect-native architecture)
    this.connectEventHandlerFn.addToRolePolicy(connectEventPermissions);
    this.connectUserFn.addToRolePolicy(connectUserPermissions);
    this.connectRoutingFn.addToRolePolicy(connectRoutingPermissions);
    this.contactFlowGeneratorFn.addToRolePolicy(contactFlowPermissions);
    this.participantServiceFn.addToRolePolicy(participantPermissions);
    this.voiceAgentFn.addToRolePolicy(voiceAgentPermissions);
    this.samlAuthFn.addToRolePolicy(samlAuthPermissions);
    this.accessControlFn.addToRolePolicy(accessControlPermissions);



    // CloudWatch permissions for logging
    const logsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    });

    [this.connectUserFn, this.connectRoutingFn, this.accessControlFn, this.connectConfigFn, this.contactFlowGeneratorFn, this.participantServiceFn, this.connectEventHandlerFn, this.voiceAgentFn, this.samlAuthFn].forEach(fn => {
      fn.addToRolePolicy(logsPolicy);
    });

    // EventBridge permissions for the event handler
    const eventBridgePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'events:PutEvents',
        'events:PutRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'events:DeleteRule',
        'events:DescribeRule',
        'events:ListRules',
        'events:ListTargetsByRule',
      ],
      resources: [`arn:aws:events:${this.region}:${this.account}:*`],
    });

    this.connectEventHandlerFn.addToRolePolicy(eventBridgePolicy);

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.restApi = new apigw.RestApi(this, 'ConnectRestApi', {
      restApiName: `${this.stackName}-ConnectApi`,
      description: 'Connect service REST API',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowHeaders: corsConfig.allowHeaders,
        allowMethods: corsConfig.allowMethods,
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.restApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.restApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.restApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
    });

    // Map this API under the existing custom domain as /connect
    new apigw.CfnBasePathMapping(this, 'ConnectApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'connect',
      restApiId: this.restApi.restApiId,
      stage: this.restApi.deploymentStage.stageName,
    });

    // ========================================
    // API ROUTES
    // ========================================

    // Connect management routes
    const connectRes = this.restApi.root.addResource('connect');

    const userRes = connectRes.addResource('user');
    // POST for create, add, remove actions
    userRes.addMethod('POST', new apigw.LambdaIntegration(this.connectUserFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    // GET for list and describe actions
    userRes.addMethod('GET', new apigw.LambdaIntegration(this.connectUserFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    // PUT for update actions
    userRes.addMethod('PUT', new apigw.LambdaIntegration(this.connectUserFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    // DELETE for delete actions
    userRes.addMethod('DELETE', new apigw.LambdaIntegration(this.connectUserFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    const routingRes = connectRes.addResource('routing');
    routingRes.addMethod('POST', new apigw.LambdaIntegration(this.connectRoutingFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Connect configuration routes
    const configRes = connectRes.addResource('config');
    configRes.addMethod('GET', new apigw.LambdaIntegration(this.connectConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    configRes.addMethod('POST', new apigw.LambdaIntegration(this.connectConfigFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Access control routes
    const accessRes = connectRes.addResource('access');
    accessRes.addMethod('POST', new apigw.LambdaIntegration(this.accessControlFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Contact flow management routes
    const flowRes = connectRes.addResource('flow');
    flowRes.addMethod('POST', new apigw.LambdaIntegration(this.contactFlowGeneratorFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Outbound calling routes
    const outboundRes = connectRes.addResource('outbound');
    outboundRes.addMethod('POST', new apigw.LambdaIntegration(this.connectRoutingFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Clinic phone number routes
    const phoneRes = connectRes.addResource('phone');
    phoneRes.addMethod('POST', new apigw.LambdaIntegration(this.connectRoutingFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Connect Participant Service routes
    const participantRes = connectRes.addResource('participant');
    participantRes.addMethod('POST', new apigw.LambdaIntegration(this.participantServiceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // Voice Agent routes
    const voiceAgentRes = connectRes.addResource('voice-agent');
    voiceAgentRes.addMethod('POST', new apigw.LambdaIntegration(this.voiceAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    voiceAgentRes.addMethod('GET', new apigw.LambdaIntegration(this.voiceAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    voiceAgentRes.addMethod('PUT', new apigw.LambdaIntegration(this.voiceAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    voiceAgentRes.addMethod('DELETE', new apigw.LambdaIntegration(this.voiceAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // SAML Authentication routes
    const samlAuthRes = connectRes.addResource('saml-auth');
    samlAuthRes.addMethod('POST', new apigw.LambdaIntegration(this.samlAuthFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    samlAuthRes.addMethod('GET', new apigw.LambdaIntegration(this.samlAuthFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // ========================================
    // EVENTBRIDGE RULES
    // ========================================

    // Hours sync is now handled directly in the API calls, no need for EventBridge rule

    // ========================================
    // PHONE NUMBER ASSIGNMENTS
    // ========================================

    // Note: Core Connect resources (queues, routing profile, hours of operation) are now created in CDK
    // Phone numbers and contact flows are configured via the setup script
    // (deployment-scripts/setup-connect-integration.ts) as these require specific Connect
    // resources that are easier to manage via API calls

    // ========================================
    // EVENTBRIDGE RULES FOR CONNECT EVENTS
    // ========================================

    // EventBridge rule to capture Connect events
    const connectEventRule = new events.Rule(this, 'ConnectEventRule', {
      ruleName: `${this.stackName}-ConnectEvents`,
      description: 'Captures events from Amazon Connect for softphone notifications',
      eventPattern: {
        source: ['aws.connect'],
        detailType: [
          'Contact Initiated',
          'Contact Connected',
          'Contact Disconnected',
          'Contact Missed',
          'Contact Queued',
          'Agent Connected',
          'Agent Disconnected',
          'Agent Connecting',
        ],
      },
    });

    // Add the event handler as a target
    connectEventRule.addTarget(new targets.LambdaFunction(this.connectEventHandlerFn));

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ConnectInstanceId', {
      value: EXISTING_CONNECT_INSTANCE_ID,
      description: 'Amazon Connect Instance ID',
      exportName: `${this.stackName}-ConnectInstanceId`,
    });

    new CfnOutput(this, 'ConnectInstanceArn', {
      value: EXISTING_CONNECT_INSTANCE_ARN,
      description: 'Amazon Connect Instance ARN',
      exportName: `${this.stackName}-ConnectInstanceArn`,
    });

    new CfnOutput(this, 'MasterRoutingProfileId', {
      value: masterRoutingProfile.attrRoutingProfileArn,
      description: 'Master Routing Profile ARN (ABR approach)',
      exportName: `${this.stackName}-MasterRoutingProfileId`,
    });

    new CfnOutput(this, 'MasterRoutingProfileName', {
      value: 'rp-MasterAgent',
      description: 'Master Routing Profile Name',
      exportName: `${this.stackName}-MasterRoutingProfileName`,
    });

    // Connect-native architecture - no custom DynamoDB tables for Connect functionality

    new CfnOutput(this, 'ConnectRestApiUrl', {
      value: this.restApi.url,
      description: 'Connect REST API Gateway URL',
      exportName: `${this.stackName}-ConnectRestApiUrl`,
    });

    new CfnOutput(this, 'ConnectParticipantServiceFunctionArn', {
      value: this.participantServiceFn.functionArn,
      description: 'Connect Participant Service Lambda Function ARN',
      exportName: `${this.stackName}-ConnectParticipantServiceFunctionArn`,
    });

    new CfnOutput(this, 'ConnectEventHandlerFunctionArn', {
      value: this.connectEventHandlerFn.functionArn,
      description: 'Connect Event Handler Lambda Function ARN',
      exportName: `${this.stackName}-ConnectEventHandlerFunctionArn`,
    });

    new CfnOutput(this, 'VoiceAgentFunctionArn', {
      value: this.voiceAgentFn.functionArn,
      description: 'Voice Agent Lambda Function ARN',
      exportName: `${this.stackName}-VoiceAgentFunctionArn`,
    });

    new CfnOutput(this, 'SAMLAuthFunctionArn', {
      value: this.samlAuthFn.functionArn,
      description: 'SAML Authentication Lambda Function ARN',
      exportName: `${this.stackName}-SAMLAuthFunctionArn`,
    });

    // Phone numbers are configured via the setup script and referenced in clinics.json
  }
}
