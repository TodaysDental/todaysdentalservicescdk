import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigw2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigw2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';

import { CfnResource } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import clinicsData from '../clinic-config/clinics.json';
import { Clinic } from '../clinic-config/clinics';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as transfer from 'aws-cdk-lib/aws-transfer';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class ApiAndCognitoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Custom domains are already configured externally

    // 1) Cognito User Pool with Custom Auth
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      mfa: cognito.Mfa.OFF,
      removalPolicy: RemovalPolicy.RETAIN, // change to DESTROY for dev
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        // compact flags for tokens
        x_is_super_admin: new cognito.StringAttribute({ mutable: true }),
        x_clinics: new cognito.StringAttribute({ mutable: true }),
        x_rbc: new cognito.StringAttribute({ mutable: true }),
      },
    });

    // Custom auth requires a trigger Lambda; use multi-trigger handler
    const triggersFn = new lambdaNode.NodejsFunction(this, 'CognitoTriggersFn', {
      entry: path.join(__dirname, '..', 'cognito-triggers', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        APP_NAME: 'TodaysDentalInsights',
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
        SES_REGION: 'us-east-1',
      },
    });

    // Allow SES + Cognito IDP actions from lambda
    triggersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListGroupsForUser',
        'cognito-idp:AdminListGroupsForUser',
      ],
      resources: ['*'],
    }));

    userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, triggersFn);
    userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, triggersFn);
    userPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, triggersFn);
    userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, triggersFn);
    userPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, triggersFn);
    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, triggersFn);

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: { custom: true },
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    // 1b) Pre-create Cognito groups
    // Global super admin
    new cognito.CfnUserPoolGroup(this, 'GlobalSuperAdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'GLOBAL__SUPER_ADMIN',
      description: 'Global super administrators',
    });

    // Create groups using IDs from clinic-config so names stay in sync (no clinic-level SUPER_ADMIN)
    const roles = ['ADMIN', 'PROVIDER', 'MARKETING', 'USER'];
    (clinicsData as Clinic[]).forEach((c) => {
      const idFromConfig = String(c.clinicId);
      const nameFromConfig = String(c.clinicName || c.clinicId);
      roles.forEach((role) => {
        new cognito.CfnUserPoolGroup(this, `Group_${idFromConfig}_${role}`, {
          userPoolId: userPool.userPoolId,
          groupName: `clinic_${idFromConfig}__${role}`,
          description: `${nameFromConfig} - ${role}`,
        });
      });
    });

    // Removed all Amazon Connect infrastructure - migrated to Chime SDK Voice
    
    // Create DynamoDB tables first (needed for Lambda environment variables)
    const agentsTable = dynamodb.Table.fromTableName(this, 'VoiceAgentsTable', 'VoiceAgents');

    const queueTable = dynamodb.Table.fromTableName(this, 'VoiceQueuesTable', 'VoiceQueues');

    const clinicHoursTable = new dynamodb.Table(this, 'ClinicHoursTable', {
      tableName: 'ClinicHoursV2',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    let registerFn: lambdaNode.NodejsFunction;

    // 2c) Admin API Lambda (register) - create even if Connect resources not created
    registerFn = new lambdaNode.NodejsFunction(this, 'AdminRegisterFn', {
      entry: path.join(__dirname, '..', 'admin-api', 'register.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        VOICE_AGENTS_TABLE: agentsTable.tableName,
      },
    });

    // Register Lambda permissions
    registerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListGroups',
      ],
      resources: [userPool.userPoolArn],
    }));

    // Grant register Lambda access to VoiceAgents table
    registerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
        'dynamodb:Query'
      ],
      resources: [agentsTable.tableArn],
    }));

    // Users CRUD Lambda (GET/PUT/DELETE /users/{username})
    const usersFn = new lambdaNode.NodejsFunction(this, 'AdminUsersFn', {
      entry: path.join(__dirname, '..', 'admin-api', 'users.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        VOICE_AGENTS_TABLE: agentsTable.tableName,
      },
    });
    usersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:ListGroups',
      ],
      resources: [userPool.userPoolArn],
    }));

    // Grant users Lambda access to VoiceAgents table
    usersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:GetItem',
        'dynamodb:Query'
      ],
      resources: [agentsTable.tableArn, `${agentsTable.tableArn}/index/*`],
    }));

    // 3) API Gateway REST API
    const api = new apigw.RestApi(this, 'AdminApi', {
      restApiName: 'AdminApi',
      description: 'Admin API for user registration and role assignment',
      defaultCorsPreflightOptions: {
        // Restrict to the production frontend origin so browsers accept the header
        allowOrigins: ['https://todaysdentalinsights.com'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE'],
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Ensure API Gateway error responses also include CORS so browsers can read them
    const corsErrorHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': `'https://todaysdentalinsights.com'`,
      'Access-Control-Allow-Headers': `'Content-Type,Authorization'`,
      'Access-Control-Allow-Methods': `'OPTIONS,GET,POST,PUT,DELETE'`,
    };
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: api,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: api,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: api,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const registerRes = api.root.addResource('register');
    registerRes.addMethod('POST', new apigw.LambdaIntegration(registerFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Users routes: /users and /users/{username}
    const usersRes = api.root.addResource('users');
    usersRes.addMethod('GET', new apigw.LambdaIntegration(usersFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    const userItemRes = usersRes.addResource('{username}');
    userItemRes.addMethod('GET', new apigw.LambdaIntegration(usersFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] });
    userItemRes.addMethod('PUT', new apigw.LambdaIntegration(usersFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }] });
    userItemRes.addMethod('DELETE', new apigw.LambdaIntegration(usersFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });

    // 2b) Auth endpoints (initiate and verify) - no authorizer
    const initiateFn = new lambdaNode.NodejsFunction(this, 'AuthInitiateFn', {
      entry: path.join(__dirname, '..', 'auth-api', 'initiate.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    initiateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:InitiateAuth'],
      resources: ['*'],
    }));

    const verifyFn = new lambdaNode.NodejsFunction(this, 'AuthVerifyFn', {
      entry: path.join(__dirname, '..', 'auth-api', 'verify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });
    verifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:RespondToAuthChallenge'],
      resources: ['*'],
    }));

    // Removed Connect outbound API - replaced with Chime SDK Voice outbound API (defined later)

    // Removed Connect realtime API - replaced with Chime SDK Voice agent management

    // Hours CRUD
    const hoursCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicHoursCrudFn', {
      entry: path.join(__dirname, '..', 'hours-api', 'hoursCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: { CLINIC_HOURS_TABLE: clinicHoursTable.tableName },
    });
    hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan'
      ],
      resources: ['*'],
    }));
    const hoursRes = api.root.addResource('hours');
    hoursRes.addMethod('GET', new apigw.LambdaIntegration(hoursCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    hoursRes.addMethod('POST', new apigw.LambdaIntegration(hoursCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    const hoursIdRes = hoursRes.addResource('{clinicId}');
    hoursIdRes.addMethod('GET', new apigw.LambdaIntegration(hoursCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] });
    hoursIdRes.addMethod('PUT', new apigw.LambdaIntegration(hoursCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    hoursIdRes.addMethod('DELETE', new apigw.LambdaIntegration(hoursCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });

    // Hours sync Lambda (triggered by DynamoDB stream)
    const hoursSyncFn = new lambdaNode.NodejsFunction(this, 'ClinicHoursSyncFn', {
      entry: path.join(__dirname, '..', 'hours-api', 'hoursSync.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: { 
        CLINIC_HOURS_TABLE: clinicHoursTable.tableName 
      },
    });
    clinicHoursTable.grantReadWriteData(hoursSyncFn);

    // Add DynamoDB stream event source for hours sync
    const streamEventSource = new lambdaEventSources.DynamoEventSource(clinicHoursTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      retryAttempts: 3,
    });
    hoursSyncFn.addEventSource(streamEventSource);

    // Post-call CRUD
    const postCallCrudFn = new lambdaNode.NodejsFunction(this, 'PostCallCrudFn', {
      entry: path.join(__dirname, '..', 'analytics', 'postCallCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: { POSTCALL_TABLE: 'PostCallInsights' },
    });
    postCallCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan'
      ],
      resources: ['*'],
    }));
    const postCallsRes = api.root.addResource('postcalls');
    postCallsRes.addMethod('GET', new apigw.LambdaIntegration(postCallCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    postCallsRes.addMethod('POST', new apigw.LambdaIntegration(postCallCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    const postCallIdRes = postCallsRes.addResource('{contactId}');
    postCallIdRes.addMethod('GET', new apigw.LambdaIntegration(postCallCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }, { statusCode: '404' }] });
    postCallIdRes.addMethod('PUT', new apigw.LambdaIntegration(postCallCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    postCallIdRes.addMethod('DELETE', new apigw.LambdaIntegration(postCallCrudFn), { authorizer, authorizationType: apigw.AuthorizationType.COGNITO, methodResponses: [{ statusCode: '200' }] });
    const authRes = api.root.addResource('auth');
    const initiateRes = authRes.addResource('initiate');
    initiateRes.addMethod('POST', new apigw.LambdaIntegration(initiateFn), { methodResponses: [{ statusCode: '200' }] });
    const verifyRes = authRes.addResource('verify');
    verifyRes.addMethod('POST', new apigw.LambdaIntegration(verifyFn), { methodResponses: [{ statusCode: '200' }] });

    // 4) Templates DynamoDB table
    const templatesTable = new dynamodb.Table(this, 'TemplatesTable', {
      partitionKey: { name: 'template_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // change to DESTROY for dev if desired
      tableName: 'Templates',
    });

    // 5) Templates Lambda
    const templatesFn = new lambdaNode.NodejsFunction(this, 'TemplatesFn', {
      entry: path.join(__dirname, '..', 'templates-api', 'templates.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: templatesTable.tableName,
      },
    });
    templatesTable.grantReadWriteData(templatesFn);

    // 6) Templates API routes with Cognito auth (Lambda enforces group-level RBAC)
    const templatesRes = api.root.addResource('templates');
    templatesRes.addMethod('GET', new apigw.LambdaIntegration(templatesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    templatesRes.addMethod('POST', new apigw.LambdaIntegration(templatesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const templateIdRes = templatesRes.addResource('{templateId}');
    templateIdRes.addMethod('PUT', new apigw.LambdaIntegration(templatesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    templateIdRes.addMethod('DELETE', new apigw.LambdaIntegration(templatesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });



    // 6e) Transfer Family setup - create separate resources for each clinic
    const transferServers: Record<string, transfer.CfnServer> = {};
    
    (clinicsData as Clinic[]).forEach((c) => {
      const idFromConfig = String(c.clinicId);
      const nameFromConfig = String(c.clinicName || c.clinicId);

      // Create S3 bucket for this clinic
      const clinicBucket = new s3.Bucket(this, `TransferBucket_${idFromConfig}`, {
        bucketName: `transfer-${idFromConfig}-sftp`,
        removalPolicy: RemovalPolicy.RETAIN,
        versioned: false,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      });

      // Create IAM role for this clinic's Transfer Family server
      const transferRole = new iam.Role(this, `TransferRole_${idFromConfig}`, {
        assumedBy: new iam.ServicePrincipal('transfer.amazonaws.com'),
        description: `Transfer Family role for ${nameFromConfig}`,
        inlinePolicies: {
          S3Access: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['s3:ListBucket'],
                resources: [clinicBucket.bucketArn],
                conditions: {
                  StringLike: {
                    's3:prefix': ['sftp-home/sftpuser/*']
                  }
                }
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                resources: [`${clinicBucket.bucketArn}/sftp-home/sftpuser/*`]
              })
            ]
          })
        }
      });

      // Create Transfer Family auth Lambda for this clinic
      const transferAuthFn = new lambdaNode.NodejsFunction(this, `TransferAuthFn_${idFromConfig}`, {
        entry: path.join(__dirname, '..', 'open-dental', 'transferAuth.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
        environment: {
          TF_BUCKET: clinicBucket.bucketName,
          TF_PASSWORD: 'Clinic@2020!',
          TF_PREFIX: 'sftp-home/sftpuser',
          TF_ROLE_ARN: transferRole.roleArn,
          TF_USERNAME: 'sftpuser',
          CLINIC_ID: idFromConfig,
        },
      });

      // Allow AWS Transfer service to invoke the auth lambda
      transferAuthFn.addPermission(`AllowTransferInvoke_${idFromConfig}`, {
        principal: new iam.ServicePrincipal('transfer.amazonaws.com'),
        action: 'lambda:InvokeFunction',
      });

      // Create Transfer Family server for this clinic
      const transferServer = new transfer.CfnServer(this, `TransferServer_${idFromConfig}`, {
        identityProviderType: 'AWS_LAMBDA',
        identityProviderDetails: { function: transferAuthFn.functionArn },
        protocols: ['SFTP'],
        endpointType: 'PUBLIC',
        loggingRole: transferRole.roleArn,
      });

      transferServers[idFromConfig] = transferServer;

      // Output the server endpoint for each clinic
      new CfnOutput(this, `TransferServerEndpoint_${idFromConfig}`, {
        value: transferServer.attrServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        description: `Transfer Family SFTP endpoint for ${nameFromConfig}`,
        exportName: `TransferServerEndpoint-${idFromConfig}`
      });

      new CfnOutput(this, `TransferServerBucket_${idFromConfig}`, {
        value: clinicBucket.bucketName,
        description: `S3 bucket for ${nameFromConfig} SFTP files`,
        exportName: `TransferServerBucket-${idFromConfig}`
      });
    });

    // 6f) Open Dental proxy Lambda (per-clinic routing) - after Transfer Family setup
    // Build dynamic clinic credentials with their respective Transfer Family endpoints
    const clinicCredsForProxy: Record<string, any> = {};
    (clinicsData as Clinic[]).forEach((c) => {
      const idFromConfig = String(c.clinicId);
      const transferServer = transferServers[idFromConfig];
      
      clinicCredsForProxy[idFromConfig] = {
        developerKey: c.developerKey,
        customerKey: c.customerKey,
        sftpHost: transferServer.attrServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        sftpPort: 22,
        sftpUsername: 'sftpuser',
        sftpPassword: 'Clinic@2020!',
        // Remote directory should be relative to the SFTP home directory
        sftpRemoteDir: 'QuerytemplateCSV',
      };
    });

    const openDentalFn = new lambdaNode.NodejsFunction(this, 'OpenDentalProxyFn', {
      entry: path.join(__dirname, '..', 'open-dental', 'openDentalProxy.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22', externalModules: [] },
      environment: {
        OPEN_DENTAL_CLINIC_CREDS: JSON.stringify(clinicCredsForProxy),
      },
    });

    // Move clinic proxy under a non-conflicting base path to avoid collisions with top-level routes
    const clinicBase = api.root.addResource('clinic');
    const clinicRes = clinicBase.addResource('{clinicId}');
    const clinicProxy = clinicRes.addResource('{proxy+}');
    clinicProxy.addMethod('ANY', new apigw.LambdaIntegration(openDentalFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }, { statusCode: '500' }],
    });

    // Notifications API: POST /clinic/{clinicId}/notification
    const notifyFn = new lambdaNode.NodejsFunction(this, 'ClinicNotifyFn', {
      entry: path.join(__dirname, '..', 'notifications-api', 'notify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TEMPLATES_TABLE: 'Templates',
        OPEN_DENTAL_CLINIC_CREDS: JSON.stringify(clinicCredsForProxy),
        CLINIC_SES_IDENTITY_ARN_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { if ((c as any).sesIdentityArn) acc[String(c.clinicId)] = String((c as any).sesIdentityArn); return acc; }, {})),
        CLINIC_SMS_ORIGINATION_ARN_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { if ((c as any).smsOriginationArn) acc[String(c.clinicId)] = String((c as any).smsOriginationArn); return acc; }, {})),
      },
    });
    notifyFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail', 'ses:SendRawEmail'], resources: ['*'] }));
    notifyFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sms-voice:SendTextMessage'], resources: ['*'] }));
    const clinicNotify = clinicRes.addResource('notification');
    clinicNotify.addMethod('POST', new apigw.LambdaIntegration(notifyFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // 6c) Schedules DynamoDB table
    const schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'SCHEDULER',
    });

    // Schedules Lambda
    const schedulesFn = new lambdaNode.NodejsFunction(this, 'SchedulesFn', {
      entry: path.join(__dirname, '..', 'schedules-api', 'schedules.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SCHEDULER: schedulesTable.tableName,
      },
    });
    schedulesTable.grantReadWriteData(schedulesFn);

    // Schedules API routes (Cognito auth). Lambda enforces superadmin-only writes
    const schedulesRes = api.root.addResource('schedules');
    schedulesRes.addMethod('GET', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    schedulesRes.addMethod('POST', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const scheduleIdRes = schedulesRes.addResource('{id}');
    scheduleIdRes.addMethod('GET', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });
    scheduleIdRes.addMethod('PUT', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    scheduleIdRes.addMethod('DELETE', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // Additional compatibility endpoints
    const createSchedulerRes = api.root.addResource('create-scheduler');
    createSchedulerRes.addMethod('POST', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const deleteSchedulesRes = api.root.addResource('delete-schedules');
    deleteSchedulesRes.addMethod('POST', new apigw.LambdaIntegration(schedulesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // 6b) Queries DynamoDB table
    const queriesTable = new dynamodb.Table(this, 'SqlQueriesTable', {
      partitionKey: { name: 'QueryName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'SQL_Queries',
    });

    // Queries Lambda
    const queriesFn = new lambdaNode.NodejsFunction(this, 'QueriesFn', {
      entry: path.join(__dirname, '..', 'queries-api', 'queries.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: queriesTable.tableName,
      },
    });
    queriesTable.grantReadWriteData(queriesFn);

    // Queries API routes with Cognito auth
    const queriesRes = api.root.addResource('queries');
    // GET all, POST create
    queriesRes.addMethod('GET', new apigw.LambdaIntegration(queriesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    queriesRes.addMethod('POST', new apigw.LambdaIntegration(queriesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const queryNameRes = queriesRes.addResource('{queryName}');
    // GET one, PUT update, DELETE
    queryNameRes.addMethod('GET', new apigw.LambdaIntegration(queriesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });
    queryNameRes.addMethod('PUT', new apigw.LambdaIntegration(queriesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    queryNameRes.addMethod('DELETE', new apigw.LambdaIntegration(queriesFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // 12) Scheduler worker Lambda will be defined after ClinicHours table (uses its ARN for grants)

    // 6g) Me API for current user
    const frontendDomain = this.node.tryGetContext('frontendDomain') ?? process.env.FRONTEND_DOMAIN ?? 'https://todaysdentalinsights.com';

    const meFn = new lambdaNode.NodejsFunction(this, 'MeFn', {
      entry: path.join(__dirname, '..', 'me-api', 'me.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        FRONTEND_DOMAIN: String(frontendDomain),
        USER_POOL_ID: userPool.userPoolId,
        VOICE_AGENTS_TABLE: agentsTable.tableName,
        VOICE_QUEUE_TABLE: queueTable.tableName,
        CLINIC_HOURS_TABLE: clinicHoursTable.tableName,
      },
    });
    // Allow MeFn to look up user groups if claims are missing
    meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminListGroupsForUser'],
      resources: ['*'],
    }));
    const meRes = api.root.addResource('me');
    const meClinicsRes = meRes.addResource('clinics');
    meClinicsRes.addMethod('GET', new apigw.LambdaIntegration(meFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Replace /me/connect with /me/chime (Chime SDK Voice)
    const meChimeRes = meRes.addResource('chime');
    meChimeRes.addMethod('GET', new apigw.LambdaIntegration(meFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Back-compat routes: /me/connect and /connect/me
    const meConnectRes = meRes.addResource('connect');
    meConnectRes.addMethod('GET', new apigw.LambdaIntegration(meFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    const connectRes = api.root.addResource('connect');
    const connectMeRes = connectRes.addResource('me');
    connectMeRes.addMethod('GET', new apigw.LambdaIntegration(meFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Voice API (agents, state, queue mapping)
    const voiceApiFn = new lambdaNode.NodejsFunction(this, 'VoiceApiFn', {
      entry: path.join(__dirname, '..', 'voice-api', 'voice.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        VOICE_AGENTS_TABLE: 'VoiceAgents',
        VOICE_QUEUE_TABLE: 'VoiceQueues',
        MEETING_REGION: Stack.of(this).region,
      },
    });

    const voiceOutboundFn = new lambdaNode.NodejsFunction(this, 'VoiceOutboundFn', {
      entry: path.join(__dirname, '..', 'voice-api', 'outbound.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        VOICE_AGENTS_TABLE: 'VoiceAgents',
        SIP_MEDIA_APPLICATION_ID: '', // Set via context/env or output SMA id post-deploy
        CLINIC_CALLER_ID_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { 
          acc[String(c.clinicId)] = c.phoneNumber; 
          return acc; 
        }, {})),
      },
    });

    // Tables already defined above
    agentsTable.grantReadWriteData(voiceApiFn);
    agentsTable.grantReadWriteData(voiceOutboundFn);
    queueTable.grantReadWriteData(voiceApiFn);
    
    // Grant Voice API Lambda permission to create meetings and attendees
    voiceApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:GetMeeting',
        'chime-sdk-meetings:DeleteMeeting'
      ],
      resources: ['*'],
    }));

    const voiceRes = api.root.addResource('voice');
    
    // Agent endpoints
    const agentRes = voiceRes.addResource('agent');
    agentRes.addResource('login').addMethod('POST', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    agentRes.addResource('logout').addMethod('POST', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    agentRes.addResource('state').addMethod('POST', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    agentRes.addResource('status').addMethod('GET', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Agents list endpoint
    const agentsRes = voiceRes.addResource('agents');
    agentsRes.addMethod('GET', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Queue endpoints
    const queueRes = voiceRes.addResource('queue');
    queueRes.addResource('assign').addMethod('POST', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    queueRes.addResource('status').addMethod('GET', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Call management endpoints  
    const callRes = voiceRes.addResource('call');
    callRes.addResource('end').addMethod('POST', new apigw.LambdaIntegration(voiceApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Outbound voice (Chime)
    const outboundRes = voiceRes.addResource('outbound');
    outboundRes.addMethod('POST', new apigw.LambdaIntegration(voiceOutboundFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // 13) Amazon Chime SDK Voice: Voice Connector + SIP Media Application + SIP Rule
    const smaFn = new lambdaNode.NodejsFunction(this, 'ChimeSmaHandlerFn', {
      entry: path.join(__dirname, '..', 'chime-voice', 'smaHandler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        VOICE_AGENTS_TABLE: 'VoiceAgents',
        VOICE_QUEUE_TABLE: 'VoiceQueues',
        CLINIC_HOURS_TABLE: clinicHoursTable.tableName,
      },
    });

    // Note: Chime SDK Voice resources are not available as CloudFormation resources
    // They need to be created using AWS SDK calls or the AWS CLI
    // See scripts/setup-chime-resources.ts for programmatic setup
    
    smaFn.addPermission('AllowChimeInvokeSma', {
      principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:chime:${Stack.of(this).region}:${Stack.of(this).account}:sip-media-application/*`,
    });

    // Set the SIP Media Application ID from Chime setup
    voiceOutboundFn.addEnvironment('SIP_MEDIA_APPLICATION_ID', 'e83628ed-0153-4723-8202-596793d5266a');
    
    // Grant permission to initiate SMA calls
    voiceOutboundFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:CreateSipMediaApplicationCall', 'chime-sdk-voice:CreateSipMediaApplicationCall'],
      resources: [
        `arn:aws:chime:${Stack.of(this).region}:${Stack.of(this).account}:sip-media-application/*`,
        '*'
      ],
    }));

    // Output Lambda ARN for Chime SMA setup script
    new CfnOutput(this, 'ChimeSmaHandlerArn', { value: smaFn.functionArn });
    
    // Output each clinic's phone number
    (clinicsData as Clinic[]).forEach((clinic) => {
      new CfnOutput(this, `ChimeInboundNumber${clinic.clinicId}`, { 
        value: clinic.phoneNumber, 
        description: `Active inbound number for ${clinic.clinicName} (Chime SDK Voice)` 
      });
    });

    // Grant SMA Lambda read/write access to queue/agents for routing and hours checking
    agentsTable.grantReadWriteData(smaFn);
    queueTable.grantReadData(smaFn);
    clinicHoursTable.grantReadData(smaFn);
    
    // Grant SMA Lambda permission to create meeting attendees for call bridging
    smaFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateAttendee',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:GetMeeting'
      ],
      resources: ['*'],
    }));

    // 8) Post-call analytics storage table
    const postCallTable = new dynamodb.Table(this, 'PostCallInsightsTable', {
      partitionKey: { name: 'contactId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${Stack.of(this).stackName}-PostCallInsights`,
    });

    // 9) Post-call classifier Lambda - Migrated from Amazon Connect to Chime SDK Voice
    const classifierFn = new lambdaNode.NodejsFunction(this, 'PostCallClassifierFn', {
      entry: path.join(__dirname, '..', 'analytics', 'postCallClassifier.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        POSTCALL_TABLE: postCallTable.tableName,
        CHIME_VOICE_CONNECTOR_ID: 'PLACEHOLDER_SET_AFTER_CHIME_SETUP', // Chime SDK Voice Connector
        RECORDINGS_BUCKET: String(this.node.tryGetContext('recordingsBucket') ?? process.env.RECORDINGS_BUCKET ?? ''),
        RECORDINGS_PREFIX: String(this.node.tryGetContext('recordingsPrefix') ?? process.env.RECORDINGS_PREFIX ?? 'chime-voice/{callId}'),
        RECORDING_URL_TTL_SECONDS: String(this.node.tryGetContext('recordingUrlTtlSeconds') ?? process.env.RECORDING_URL_TTL_SECONDS ?? '86400'),
      },
    });
    postCallTable.grantWriteData(classifierFn);
    classifierFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:HeadObject',
        's3:GetObject'
      ],
      resources: ['*'],
    }));

    // 10) EventBridge rule for Chime SDK Voice post-call events (migrated from Contact Lens)
    new events.Rule(this, 'ChimePostCallRule', {
      description: 'Trigger post-call classifier on Chime SDK Voice post-call events',
      eventPattern: {
        source: ['aws.chime'],
        detailType: ['Chime SDK Voice Call Event'],
      },
      targets: [new targets.LambdaFunction(classifierFn)],
    });

    // 11) Clinic Hours table already defined above - no longer syncing to Connect

    // 12) Scheduler worker Lambda (EventBridge triggered) - after ClinicHours exists
    const schedulerWorkerFn = new lambdaNode.NodejsFunction(this, 'SchedulerWorkerFn', {
      entry: path.join(__dirname, '..', 'scheduler', 'worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(120),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SCHEDULES_TABLE: schedulesTable.tableName,
        TEMPLATES_TABLE: templatesTable.tableName,
        QUERIES_TABLE: queriesTable.tableName,
        CLINIC_HOURS_TABLE: clinicHoursTable.tableName,
        OPEN_DENTAL_CLINIC_CREDS: JSON.stringify(clinicCredsForProxy),
        CLINIC_SES_IDENTITY_ARN_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { if ((c as any).sesIdentityArn) acc[String(c.clinicId)] = String((c as any).sesIdentityArn); return acc; }, {})),
        CLINIC_SMS_ORIGINATION_ARN_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { if ((c as any).smsOriginationArn) acc[String(c.clinicId)] = String((c as any).smsOriginationArn); return acc; }, {})),
      },
    });
    schedulesTable.grantReadWriteData(schedulerWorkerFn);
    templatesTable.grantReadData(schedulerWorkerFn);
    queriesTable.grantReadData(schedulerWorkerFn);
    clinicHoursTable.grantReadData(schedulerWorkerFn);
    schedulerWorkerFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail', 'ses:SendRawEmail'], resources: ['*'] }));
    schedulerWorkerFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sms-voice:SendTextMessage'], resources: ['*'] }));

    new events.Rule(this, 'SchedulerWorkerRule', {
      description: 'Runs the schedule worker to send emails/SMS based on SCHEDULER table',
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(schedulerWorkerFn)],
    });

    // 14) Call Center Infrastructure - Enhanced DynamoDB Tables and APIs
    
    // Call History Table for tracking all call events and records
    const callHistoryTable = new dynamodb.Table(this, 'CallHistoryTable', {
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'CallHistory',
      pointInTimeRecovery: true,
    });
    
    // Add GSI for clinic-based queries
    callHistoryTable.addGlobalSecondaryIndex({
      indexName: 'ClinicDateIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });
    
    // Add GSI for agent-based queries
    callHistoryTable.addGlobalSecondaryIndex({
      indexName: 'AgentDateIndex',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });
    
    // Call Statistics Table for aggregated metrics per clinic per day
    const callStatisticsTable = new dynamodb.Table(this, 'CallStatisticsTable', {
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'CallStatistics',
    });

    // WebSocket Connections Table (moved here to be available for Lambda functions)
    const websocketConnectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
      tableName: 'VoiceGateway-WebSocketConnections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for user-based queries
    websocketConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });
    
    // Call Center API Lambda for dashboard, statistics, and management
    const callCenterApiFn = new lambdaNode.NodejsFunction(this, 'CallCenterApiFn', {
      entry: path.join(__dirname, '..', 'call-center-api', 'callCenter.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        VOICE_AGENTS_TABLE: 'VoiceAgents',
        VOICE_QUEUE_TABLE: 'VoiceQueues',
        CALL_HISTORY_TABLE: callHistoryTable.tableName,
        CALL_STATISTICS_TABLE: callStatisticsTable.tableName,
        WEBSOCKET_CONNECTIONS_TABLE: websocketConnectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: '', // Will be set after WebSocket API creation
      },
    });
    
    // Call Tracking Lambda for processing call events
    const callTrackingFn = new lambdaNode.NodejsFunction(this, 'CallTrackingFn', {
      entry: path.join(__dirname, '..', 'call-center-api', 'callTracking.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(15),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        CALL_HISTORY_TABLE: callHistoryTable.tableName,
        CALL_STATISTICS_TABLE: callStatisticsTable.tableName,
        WEBSOCKET_CONNECTIONS_TABLE: websocketConnectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: '', // Will be set after WebSocket API creation
      },
    });
    
    // Grant table permissions
    agentsTable.grantReadData(callCenterApiFn);
    queueTable.grantReadData(callCenterApiFn);
    callHistoryTable.grantReadWriteData(callCenterApiFn);
    callStatisticsTable.grantReadWriteData(callCenterApiFn);
    websocketConnectionsTable.grantReadData(callCenterApiFn);
    
    callHistoryTable.grantReadWriteData(callTrackingFn);
    callStatisticsTable.grantReadWriteData(callTrackingFn);
    websocketConnectionsTable.grantReadData(callTrackingFn);

    // =====================================
    // VOICE GATEWAY API AND WEBSOCKET
    // =====================================

    // DynamoDB Tables for Voice Gateway
    const agentSessionsTable = new dynamodb.Table(this, 'AgentSessionsTable', {
      tableName: 'VoiceGateway-AgentSessions',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for clinic-based queries
    agentSessionsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
    });

    // Voice Gateway Lambda Function
    const voiceGatewayFn = new lambdaNode.NodejsFunction(this, 'VoiceGatewayFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../voice-gateway-api/voiceGateway.ts'),
      timeout: Duration.seconds(30),
      memorySize: 1024,
      environment: {
        AGENT_SESSIONS_TABLE: agentSessionsTable.tableName,
        CALL_HISTORY_TABLE: callHistoryTable.tableName,
        CALL_STATISTICS_TABLE: callStatisticsTable.tableName,
        WEBSOCKET_CONNECTIONS_TABLE: websocketConnectionsTable.tableName,
        CLINIC_CALLER_ID_MAP: JSON.stringify((clinicsData as Clinic[]).reduce((acc: any, c: Clinic) => { 
          acc[String(c.clinicId)] = c.phoneNumber; 
          return acc; 
        }, {})),
      },
      bundling: {
        externalModules: ['aws-sdk'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-chime-sdk-voice',
          '@aws-sdk/client-chime-sdk-meetings',
          '@aws-sdk/client-apigatewaymanagementapi',
        ],
      },
    });

    // Grant Voice Gateway permissions
    agentSessionsTable.grantReadWriteData(voiceGatewayFn);
    callHistoryTable.grantReadWriteData(voiceGatewayFn);
    callStatisticsTable.grantReadWriteData(voiceGatewayFn);
    websocketConnectionsTable.grantReadWriteData(voiceGatewayFn);

    // Grant Chime permissions
    voiceGatewayFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMeeting',
        'chime:DeleteMeeting',
        'chime:CreateAttendee',
        'chime:DeleteAttendee',
        'chime:GetMeeting',
        'chime:ListMeetings',
        'chime:CreateSipMediaApplicationCall',
        'chime:GetVoiceConnector',
        'chime:ListVoiceConnectors',
      ],
      resources: ['*'],
    }));

    // WebSocket API for real-time updates
    const websocketHandler = new lambdaNode.NodejsFunction(this, 'WebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../websocket-api/websocketHandler.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        WEBSOCKET_CONNECTIONS_TABLE: websocketConnectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: '', // Will be set after WebSocket API creation
      },
      bundling: {
        externalModules: ['aws-sdk'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
        ],
      },
    });

    // Contact Center WebSocket Handler
    const contactCenterWebSocketHandler = new lambdaNode.NodejsFunction(this, 'ContactCenterWebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../websocket-api/contactCenterWebSocket.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        WEBSOCKET_CONNECTIONS_TABLE: websocketConnectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: '', // Will be set after WebSocket API creation
        VOICE_AGENTS_TABLE: agentsTable.tableName,
        VOICE_QUEUE_TABLE: queueTable.tableName,
        CALL_HISTORY_TABLE: callHistoryTable.tableName,
        CALL_STATISTICS_TABLE: callStatisticsTable.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
          '@aws-sdk/client-chime-sdk-meetings',
        ],
      },
    });

    // Grant WebSocket handler permissions
    websocketConnectionsTable.grantReadWriteData(websocketHandler);
    websocketConnectionsTable.grantReadWriteData(contactCenterWebSocketHandler);

    // Grant contact center handler access to all required tables
    agentsTable.grantReadWriteData(contactCenterWebSocketHandler);
    queueTable.grantReadData(contactCenterWebSocketHandler);
    callHistoryTable.grantReadWriteData(contactCenterWebSocketHandler);
    callStatisticsTable.grantReadWriteData(contactCenterWebSocketHandler);

    // Grant Chime SDK permissions for contact center handler
    contactCenterWebSocketHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListMeetings',
        'chime:ListAttendees',
      ],
      resources: ['*'],
    }));

    // Create WebSocket API
    const websocketApi = new apigw2.WebSocketApi(this, 'CallCenterWebSocketApi', {
      apiName: 'CallCenterWebSocketApi',
      description: 'WebSocket API for real-time call center updates',
      connectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('ConnectIntegration', websocketHandler),
      },
      disconnectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', websocketHandler),
      },
      defaultRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration('DefaultIntegration', websocketHandler),
      },
    });

    // Add custom routes
    websocketApi.addRoute('ping', {
      integration: new apigw2Integrations.WebSocketLambdaIntegration('PingIntegration', websocketHandler),
    });
    websocketApi.addRoute('subscribe', {
      integration: new apigw2Integrations.WebSocketLambdaIntegration('SubscribeIntegration', websocketHandler),
    });
    websocketApi.addRoute('unsubscribe', {
      integration: new apigw2Integrations.WebSocketLambdaIntegration('UnsubscribeIntegration', websocketHandler),
    });
    websocketApi.addRoute('contactCenter', {
      integration: new apigw2Integrations.WebSocketLambdaIntegration('ContactCenterIntegration', contactCenterWebSocketHandler),
    });

    // Create WebSocket stage
    const websocketStage = new apigw2.WebSocketStage(this, 'CallCenterWebSocketStage', {
      webSocketApi: websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Update WebSocket handlers with API endpoint (convert WSS to HTTPS for management API)
    const managementApiEndpoint = websocketStage.url.replace('wss://', 'https://');
    websocketHandler.addEnvironment('WEBSOCKET_API_ENDPOINT', managementApiEndpoint);
    contactCenterWebSocketHandler.addEnvironment('WEBSOCKET_API_ENDPOINT', managementApiEndpoint);
    callCenterApiFn.addEnvironment('WEBSOCKET_API_ENDPOINT', managementApiEndpoint);
    callTrackingFn.addEnvironment('WEBSOCKET_API_ENDPOINT', managementApiEndpoint);

    // Grant WebSocket API management permissions
    const websocketApiPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${websocketApi.apiId}/*/*`],
    });
    
    websocketHandler.addToRolePolicy(websocketApiPolicy);
    voiceGatewayFn.addToRolePolicy(websocketApiPolicy);
    contactCenterWebSocketHandler.addToRolePolicy(websocketApiPolicy);
    callCenterApiFn.addToRolePolicy(websocketApiPolicy);
    callTrackingFn.addToRolePolicy(websocketApiPolicy);

    // Update Voice Gateway with WebSocket endpoint
    voiceGatewayFn.addEnvironment('WEBSOCKET_API_ENDPOINT', managementApiEndpoint);

    // Add Voice Gateway routes to existing API Gateway
    const voiceGatewayResource = api.root.addResource('voice-gateway');
    
    // Agent routes
    const agentResource = voiceGatewayResource.addResource('agent');
    agentResource.addResource('login').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    agentResource.addResource('logout').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    
    // Status resource with both PUT and GET methods
    const agentStatusResource = agentResource.addResource('status');
    agentStatusResource.addMethod('PUT', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    agentStatusResource.addMethod('GET', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    
    agentResource.addResource('heartbeat').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });

    // Call routes
    const callResource = voiceGatewayResource.addResource('call');
    callResource.addResource('outbound').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    callResource.addResource('active').addMethod('GET', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    
    // Call ID specific routes
    const callIdResource = callResource.addResource('{callId}');
    callIdResource.addResource('end').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    callIdResource.addResource('hold').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    callIdResource.addResource('resume').addMethod('POST', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });

    // Stats routes
    const statsResource = voiceGatewayResource.addResource('stats');
    statsResource.addResource('dashboard').addMethod('GET', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    statsResource.addResource('history').addMethod('GET', new apigw.LambdaIntegration(voiceGatewayFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer,
    });
    
    // Call Center API Routes
    const callCenterRes = api.root.addResource('call-center');
    
    // Dashboard endpoint
    callCenterRes.addResource('dashboard').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Statistics endpoint
    callCenterRes.addResource('statistics').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Agents status endpoint
    const agentsStatusRes = callCenterRes.addResource('agents');
    agentsStatusRes.addResource('status').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Call history endpoint
    callCenterRes.addResource('history').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Queue summary endpoint
    const queueSummaryRes = callCenterRes.addResource('queue');
    queueSummaryRes.addResource('summary').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Agent performance endpoint
    callCenterRes.addResource('performance').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Call transfer endpoint
    callCenterRes.addResource('transfer').addMethod('POST', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Call recordings endpoint
    callCenterRes.addResource('recordings').addMethod('GET', new apigw.LambdaIntegration(callCenterApiFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // Call tracking endpoint (for internal use by SMA)
    callCenterRes.addResource('track').addMethod('POST', new apigw.LambdaIntegration(callTrackingFn), {
      methodResponses: [{ statusCode: '200' }],
    });

    // 7) Use existing custom domain: api.todaysdentalinsights.com (already configured)
    const adminApiUrlOutput = 'https://api.todaysdentalinsights.com/';

    // Outputs
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'AdminApiUrl', { value: adminApiUrlOutput });
    new CfnOutput(this, 'CallHistoryTableName', { value: callHistoryTable.tableName });
    new CfnOutput(this, 'CallStatisticsTableName', { value: callStatisticsTable.tableName });
    new CfnOutput(this, 'AgentSessionsTableName', { value: agentSessionsTable.tableName });
    new CfnOutput(this, 'WebSocketConnectionsTableName', { value: websocketConnectionsTable.tableName });
    new CfnOutput(this, 'WebSocketApiUrl', { value: websocketStage.url });
    new CfnOutput(this, 'VoiceGatewayApiUrl', { value: `${adminApiUrlOutput}voice-gateway` });
  }
}


