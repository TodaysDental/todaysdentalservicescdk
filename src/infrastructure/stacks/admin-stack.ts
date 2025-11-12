import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface AdminStackProps extends StackProps {
  userPool: any;
  userPoolArn: string;
  userPoolId: string;
  clinicHoursTableName: string;
  staffClinicInfoTableName?: string;
  agentPresenceTableName?: string;
  // Optional ARNs for Chime lambdas (imported from Chime stack to avoid
  // two-way construct references). When provided, Admin stack will add API
  // routes that integrate with these functions.
  startSessionFnArn?: string;
  stopSessionFnArn?: string;
  outboundCallFnArn?: string;
  transferCallFnArn?: string;
  callAcceptedFnArn?: string;
  callRejectedFnArn?: string;
  callHungupFnArn?: string;
  leaveCallFnArn?: string;
  heartbeatFnArn?: string;
  holdCallFnArn?: string;
  resumeCallFnArn?: string;
}

export class AdminStack extends Stack {
  public readonly registerFn: lambdaNode.NodejsFunction;
  public readonly meFn: lambdaNode.NodejsFunction;
  public readonly usersFn: lambdaNode.NodejsFunction;
  public readonly mePresenceFn?: lambdaNode.NodejsFunction;
  // ...existing code...
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'AdminApi', {
      restApiName: 'AdminApi',
      description: 'Admin service API',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowHeaders: corsConfig.allowHeaders,
        allowMethods: corsConfig.allowMethods,
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
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });


    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Admin API Lambda (register)
    this.registerFn = new lambdaNode.NodejsFunction(this, 'AdminRegisterFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'register.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        USER_POOL_ID: props.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
      },
    });

    // Register Lambda permissions
    this.registerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:ListGroups',
      ],
      resources: [props.userPoolArn],
    }));



    // Admin Users API Lambda
    this.usersFn = new lambdaNode.NodejsFunction(this, 'AdminUsersFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'users.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        USER_POOL_ID: props.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
      },
    });

    // ...existing code...
    // START: ADD THIS CODE
    // Grant permissions to the Users API Lambda
    this.usersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [props.userPoolArn],
    }));

    // Grant DynamoDB permissions if the table name is provided
    if (props.staffClinicInfoTableName) {
      this.usersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:Query',       // For getStaffInfoFromDynamoDB
          'dynamodb:BatchWriteItem' // For syncStaffInfoInDynamoDB and deleteStaffInfoFromDynamoDB
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }

    // If StaffClinicInfo table is provided, grant the register lambda read/write permissions
    if (props.staffClinicInfoTableName) {
      this.registerFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan'
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }


    // ...existing code...




    // Me API Lambda
    const frontendDomain = this.node.tryGetContext('frontendDomain') ?? process.env.FRONTEND_DOMAIN ?? 'https://todaysdentalinsights.com';

    this.meFn = new lambdaNode.NodejsFunction(this, 'MeFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'me.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        FRONTEND_DOMAIN: String(frontendDomain),
        USER_POOL_ID: props.userPoolId,
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
      },
    });

    // MePresence lambda owned by Admin stack. It will read AGENT_PRESENCE_TABLE_NAME
    // from its environment. infra.ts will set this env var to the proper table name.
    this.mePresenceFn = new lambdaNode.NodejsFunction(this, 'MePresenceFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'presence.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName ?? '',
      },
    });

    // Grant read permissions to the AgentPresence table if provided
    if (props.agentPresenceTableName) {
      this.mePresenceFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}`],
      }));
    }

    // (Agent presence endpoint is wired from the Chime stack to avoid cross-stack cycles)

    // Allow MeFn to look up user groups if claims are missing
    this.meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminListGroupsForUser'],
      resources: ['*'],
    }));

    // Grant read access to tables for me API
    this.meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicHoursTableName}`,
      ],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'AdminApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'admin',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // API ROUTES
    // ========================================

    // User management routes
    const registerRes = this.api.root.addResource('register');
    registerRes.addMethod('POST', new apigw.LambdaIntegration(this.registerFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // Users management routes
    const usersRes = this.api.root.addResource('users');
    const usernameRes = usersRes.addResource('{username}');
    usernameRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usernameRes.addMethod('PUT', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usernameRes.addMethod('DELETE', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    usersRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    // ...existing code...

    // Me API routes
    const meRes = this.api.root.addResource('me');
    const meClinicsRes = meRes.addResource('clinics');
    meClinicsRes.addMethod('GET', new apigw.LambdaIntegration(this.meFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /me/presence - returns AgentPresenceTable item for the authenticated agent
    if (this.mePresenceFn) {
      const mePresenceRes = meRes.addResource('presence');
      mePresenceRes.addMethod('GET', new apigw.LambdaIntegration(this.mePresenceFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
        methodResponses: [{ statusCode: '200' }],
      });
    }

    // If Chime lambdas are provided by ARN (exported from Chime stack), import
    // them here and wire API Gateway routes to the imported functions. This
    // avoids passing the Admin API object into the Chime stack which would
    // create a circular dependency.
    if (props.startSessionFnArn || props.stopSessionFnArn || props.outboundCallFnArn || props.transferCallFnArn || 
        props.callAcceptedFnArn || props.callRejectedFnArn || props.callHungupFnArn || props.leaveCallFnArn || 
        props.heartbeatFnArn || props.holdCallFnArn || props.resumeCallFnArn) {
      const chimeApiRoot = this.api.root.getResource('chime') ?? this.api.root.addResource('chime');

      if (props.startSessionFnArn) {
        const importedStart = lambda.Function.fromFunctionArn(this, 'ImportedStartSessionFn', props.startSessionFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedStart.addPermission('ApiGatewayInvokeStartSession', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/start-session', '*')
        });
        
        const startSessionRes = chimeApiRoot.addResource('start-session');
        startSessionRes.addMethod('POST', new apigw.LambdaIntegration(importedStart, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.stopSessionFnArn) {
        const importedStop = lambda.Function.fromFunctionArn(this, 'ImportedStopSessionFn', props.stopSessionFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedStop.addPermission('ApiGatewayInvokeStopSession', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/stop-session', '*')
        });
        
        const stopSessionRes = chimeApiRoot.addResource('stop-session');
        stopSessionRes.addMethod('POST', new apigw.LambdaIntegration(importedStop, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.outboundCallFnArn) {
        const importedOutbound = lambda.Function.fromFunctionArn(this, 'ImportedOutboundCallFn', props.outboundCallFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedOutbound.addPermission('ApiGatewayInvokeOutboundCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/outbound-call', '*')
        });
        
        const outboundCallRes = chimeApiRoot.addResource('outbound-call');
        outboundCallRes.addMethod('POST', new apigw.LambdaIntegration(importedOutbound, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.transferCallFnArn) {
        const importedTransfer = lambda.Function.fromFunctionArn(this, 'ImportedTransferCallFn', props.transferCallFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedTransfer.addPermission('ApiGatewayInvokeTransferCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/transfer-call', '*')
        });
        
        const transferCallRes = chimeApiRoot.addResource('transfer-call');
        transferCallRes.addMethod('POST', new apigw.LambdaIntegration(importedTransfer, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.callAcceptedFnArn) {
        const importedCallAccepted = lambda.Function.fromFunctionArn(this, 'ImportedCallAcceptedFn', props.callAcceptedFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallAccepted.addPermission('ApiGatewayInvokeCallAccepted', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-accepted', '*')
        });
        
        const callAcceptedRes = chimeApiRoot.addResource('call-accepted');
        callAcceptedRes.addMethod('POST', new apigw.LambdaIntegration(importedCallAccepted, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.callRejectedFnArn) {
        const importedCallRejected = lambda.Function.fromFunctionArn(this, 'ImportedCallRejectedFn', props.callRejectedFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallRejected.addPermission('ApiGatewayInvokeCallRejected', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-rejected', '*')
        });
        
        const callRejectedRes = chimeApiRoot.addResource('call-rejected');
        callRejectedRes.addMethod('POST', new apigw.LambdaIntegration(importedCallRejected, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.callHungupFnArn) {
        const importedCallHungup = lambda.Function.fromFunctionArn(this, 'ImportedCallHungupFn', props.callHungupFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallHungup.addPermission('ApiGatewayInvokeCallHungup', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-hungup', '*')
        });
        
        const callHungupRes = chimeApiRoot.addResource('call-hungup');
        callHungupRes.addMethod('POST', new apigw.LambdaIntegration(importedCallHungup, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.leaveCallFnArn) {
        const importedLeaveCall = lambda.Function.fromFunctionArn(this, 'ImportedLeaveCallFn', props.leaveCallFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedLeaveCall.addPermission('ApiGatewayInvokeLeaveCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/leave-call', '*')
        });
        
        const leaveCallRes = chimeApiRoot.addResource('leave-call');
        leaveCallRes.addMethod('POST', new apigw.LambdaIntegration(importedLeaveCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.heartbeatFnArn) {
        const importedHeartbeat = lambda.Function.fromFunctionArn(this, 'ImportedHeartbeatFn', props.heartbeatFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedHeartbeat.addPermission('ApiGatewayInvokeHeartbeat', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/heartbeat', '*')
        });
        
        const heartbeatRes = chimeApiRoot.addResource('heartbeat');
        heartbeatRes.addMethod('POST', new apigw.LambdaIntegration(importedHeartbeat, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.holdCallFnArn) {
        const importedHoldCall = lambda.Function.fromFunctionArn(this, 'ImportedHoldCallFn', props.holdCallFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedHoldCall.addPermission('ApiGatewayInvokeHoldCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/hold-call', '*')
        });
        
        const holdCallRes = chimeApiRoot.addResource('hold-call');
        holdCallRes.addMethod('POST', new apigw.LambdaIntegration(importedHoldCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }

      if (props.resumeCallFnArn) {
        const importedResumeCall = lambda.Function.fromFunctionArn(this, 'ImportedResumeCallFn', props.resumeCallFnArn);
        
        // Add API Gateway permission - use wildcard to account for base path mapping
        importedResumeCall.addPermission('ApiGatewayInvokeResumeCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/resume-call', '*')
        });
        
        const resumeCallRes = chimeApiRoot.addResource('resume-call');
        resumeCallRes.addMethod('POST', new apigw.LambdaIntegration(importedResumeCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
        });
      }
    }


    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AdminApiUrl', {
      value: 'https://api.todaysdentalinsights.com/admin/',
      description: 'Admin API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AdminApiUrl`,
    });

    new CfnOutput(this, 'AdminApiId', {
      value: this.api.restApiId,
      description: 'Admin API Gateway ID',
      exportName: `${Stack.of(this).stackName}-AdminApiId`,
    });

  }
}
