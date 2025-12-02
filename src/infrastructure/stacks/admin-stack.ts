import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface AdminStackProps extends StackProps {
  staffUserTableName: string;
  clinicHoursTableName: string;
  staffClinicInfoTableName?: string;
  agentPresenceTableName?: string;
  jwtSecretValue?: string;
  // ** NEW: Input for the Communications Module (Favor Requests Table Name) **
  favorsTableName: string;
  // ** NEW: Analytics Table Name **
  analyticsTableName?: string;
  // ** NEW: Additional table names for detailed analytics **
  callQueueTableName?: string;
  recordingMetadataTableName?: string;
  chatHistoryTableName?: string;
  clinicsTableName?: string;
  recordingsBucketName?: string;
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
  // ** NEW: Call Recording **
  getRecordingFnArn?: string;
}

export class AdminStack extends Stack {
  public readonly registerFnV3: lambdaNode.NodejsFunction;
  public readonly meFn: lambdaNode.NodejsFunction;
  public readonly usersFn: lambdaNode.NodejsFunction;
  public readonly directoryLookupFn: lambdaNode.NodejsFunction;
  public readonly listRequestsFn: lambdaNode.NodejsFunction; // ** NEW: Request List Lambda Property **
  public readonly mePresenceFn?: lambdaNode.NodejsFunction;
  public readonly getAnalyticsFn?: lambdaNode.NodejsFunction; // ** NEW: Analytics Query Lambda **
  public readonly getDetailedAnalyticsFn?: lambdaNode.NodejsFunction; // ** NEW: Detailed Analytics Lambda **
  // ...existing code...
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

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

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'AdminAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Admin API Lambda (register)
    this.registerFnV3 = new lambdaNode.NodejsFunction(this, 'AdminRegisterFnV3', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'register.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        JWT_SECRET: props.jwtSecretValue ?? '',
      },
    });

    // Grant permissions to DynamoDB tables
    const staffUserTable = dynamodb.Table.fromTableName(this, 'StaffUserTable', props.staffUserTableName);
    staffUserTable.grantReadWriteData(this.registerFnV3);
    
    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTable = dynamodb.Table.fromTableName(this, 'StaffClinicInfoTableImport', props.staffClinicInfoTableName);
      staffClinicInfoTable.grantReadWriteData(this.registerFnV3);
    }



    // Admin Users API Lambda
    this.usersFn = new lambdaNode.NodejsFunction(this, 'AdminUsersFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'users.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
      },
    });

    // Grant permissions to DynamoDB tables
    staffUserTable.grantReadWriteData(this.usersFn);
    
    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTable2 = dynamodb.Table.fromTableName(this, 'StaffClinicInfoTableImport2', props.staffClinicInfoTableName);
      staffClinicInfoTable2.grantReadWriteData(this.usersFn);
    }
    if (props.staffClinicInfoTableName) {
      this.usersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:Query',        // For getStaffInfoFromDynamoDB
          'dynamodb:BatchWriteItem'  // For syncStaffInfoInDynamoDB and deleteStaffInfoFromDynamoDB
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }
    
    // *** Directory Lookup Lambda for general user selection ***
    this.directoryLookupFn = new lambdaNode.NodejsFunction(this, 'DirectoryLookupFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'directory-lookup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
      },
    });

    // Grant read permissions to StaffUser table for directory lookup
    staffUserTable.grantReadData(this.directoryLookupFn);
    
    // ** NEW: List Active Requests Lambda Deployment **
    this.listRequestsFn = new lambdaNode.NodejsFunction(this, 'ListRequestsFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'admin', 'list-requests.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
            // USER_POOL_ID removed - using JWT-based authentication now
            FAVORS_TABLE_NAME: props.favorsTableName, // Pass the table name
        },
    });
    
    // ** NEW: Grant permission to query the Favors Table via the UserIndex **
   // Grant permission to query the Favors Table via GSIs for sent/received lookups
this.listRequestsFn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}`,
        // GSIs used by list-requests.ts
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/UserIndex`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/SenderIndex`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/ReceiverIndex`,
    ],
}));



    // If StaffClinicInfo table is provided, grant the register lambda read/write permissions
    if (props.staffClinicInfoTableName) {
      this.registerFnV3.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:Query',       
          'dynamodb:BatchWriteItem'
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
        // USER_POOL_ID removed - using JWT-based authentication now
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

    // ** NEW: Analytics Query Lambda **
    if (props.analyticsTableName) {
      this.getAnalyticsFn = new lambdaNode.NodejsFunction(this, 'GetAnalyticsFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-call-analytics.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 256,
        timeout: Duration.seconds(30),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
          CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName,
          AWS_REGION_OVERRIDE: Stack.of(this).region,
        },
      });

      // Grant read permissions to the analytics table
      this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}/index/*`,
        ],
      }));
    }

    // ** NEW: Detailed Analytics Lambda **
    if (props.callQueueTableName && props.recordingMetadataTableName) {
      this.getDetailedAnalyticsFn = new lambdaNode.NodejsFunction(this, 'GetDetailedAnalyticsFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-detailed-call-analytics.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: Duration.seconds(30),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
          CALL_QUEUE_TABLE_NAME: props.callQueueTableName,
          RECORDING_METADATA_TABLE_NAME: props.recordingMetadataTableName,
          CHAT_HISTORY_TABLE_NAME: props.chatHistoryTableName || '',
          CLINICS_TABLE_NAME: props.clinicsTableName || '',
          RECORDINGS_BUCKET_NAME: props.recordingsBucketName || '',
          AWS_REGION_OVERRIDE: Stack.of(this).region,
        },
      });

      // Grant read permissions to all required tables
      const tableResources: string[] = [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}/index/*`,
      ];

      if (props.chatHistoryTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.chatHistoryTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.chatHistoryTableName}/index/*`
        );
      }

      if (props.clinicsTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicsTableName}`
        );
      }

      this.getDetailedAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: tableResources,
      }));

      // Grant S3 read permissions if bucket is provided
      if (props.recordingsBucketName) {
        this.getDetailedAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [`arn:aws:s3:::${props.recordingsBucketName}/*`],
        }));
      }
    }

    // Note: User roles are now stored in DynamoDB StaffUser table, not Cognito groups

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
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'AdminApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'admin',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // API ROUTES
    // ========================================

    // User management routes
    const registerRes = this.api.root.addResource('register');
    registerRes.addMethod('POST', new apigw.LambdaIntegration(this.registerFnV3), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // Users management routes
    const usersRes = this.api.root.addResource('users');
    const usernameRes = usersRes.addResource('{username}');
    usernameRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usernameRes.addMethod('PUT', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usernameRes.addMethod('DELETE', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usersRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // *** Directory Lookup Route for any authenticated user ***
    const directoryRes = this.api.root.addResource('directory');
    directoryRes.addMethod('GET', new apigw.LambdaIntegration(this.directoryLookupFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    
    // ** NEW: List Requests Route (For the "Mini-Slack" sidebar) **
    const requestsRes = this.api.root.addResource('requests');
    requestsRes.addMethod('GET', new apigw.LambdaIntegration(this.listRequestsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
    });

    // Me API routes
    const meRes = this.api.root.addResource('me');
    const meClinicsRes = meRes.addResource('clinics');
    meClinicsRes.addMethod('GET', new apigw.LambdaIntegration(this.meFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /me/presence - returns AgentPresenceTable item for the authenticated agent
    if (this.mePresenceFn) {
      const mePresenceRes = meRes.addResource('presence');
      mePresenceRes.addMethod('GET', new apigw.LambdaIntegration(this.mePresenceFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
    }

    // ** NEW: Analytics Routes **
    if (this.getAnalyticsFn) {
      const analyticsRes = this.api.root.addResource('analytics');
      
      // GET /analytics/call/{callId}
      const callRes = analyticsRes.addResource('call');
      const callIdRes = callRes.addResource('{callId}');
      callIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
      
      // GET /analytics/clinic/{clinicId}
      const clinicRes = analyticsRes.addResource('clinic');
      const clinicIdRes = clinicRes.addResource('{clinicId}');
      clinicIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
      
      // GET /analytics/agent/{agentId}
      const agentRes = analyticsRes.addResource('agent');
      const agentIdRes = agentRes.addResource('{agentId}');
      agentIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
      
      // GET /analytics/summary
      const summaryRes = analyticsRes.addResource('summary');
      summaryRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/live?callId={callId} - Real-time/live call analytics with query params
      const liveRes = analyticsRes.addResource('live');
      liveRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/detailed/{callId} - Comprehensive analytics with history, insights, and transcript
      if (this.getDetailedAnalyticsFn) {
        const detailedRes = analyticsRes.addResource('detailed');
        const detailedCallIdRes = detailedRes.addResource('{callId}');
        detailedCallIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getDetailedAnalyticsFn), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
          methodResponses: [{ statusCode: '200' }],
        });
      }
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
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
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }
    }

    // ========================================
    // RECORDING API ROUTES (if enabled in Chime stack)
    // ========================================

    if (props.getRecordingFnArn) {
      const getRecordingFn = lambda.Function.fromFunctionArn(
        this,
        'ImportedGetRecordingFn',
        props.getRecordingFnArn
      );

      // Add API Gateway permission
      getRecordingFn.addPermission('ApiGatewayInvokeGetRecording', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: this.api.arnForExecuteApi('*', '/recordings/*', '*')
      });

      const recordingsRes = this.api.root.addResource('recordings');

      // GET /recordings/{recordingId}
      const recordingIdRes = recordingsRes.addResource('{recordingId}');
      recordingIdRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      // GET /recordings/call/{callId}
      const callRecordingsRes = recordingsRes.addResource('call');
      const callIdRecordingRes = callRecordingsRes.addResource('{callId}');
      callIdRecordingRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      // GET /recordings/clinic/{clinicId}
      const clinicRecordingsRes = recordingsRes.addResource('clinic');
      const clinicIdRecordingRes = clinicRecordingsRes.addResource('{clinicId}');
      clinicIdRecordingRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      new CfnOutput(this, 'RecordingsApiUrl', {
        value: 'https://apig.todaysdentalinsights.com/admin/recordings',
        description: 'Recordings API URL',
        exportName: `${Stack.of(this).stackName}-RecordingsApiUrl`
      });
    }

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AdminApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/admin/',
      description: 'Admin API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AdminApiUrl`,
    });

    new CfnOutput(this, 'AdminApiId', {
      value: this.api.restApiId,
      description: 'Admin API Gateway ID',
      exportName: `${Stack.of(this).stackName}-AdminApiId`,
    });
    
    new CfnOutput(this, 'DirectoryApiUrl', {
        value: 'https://apig.todaysdentalinsights.com/admin/directory',
        description: 'User Directory Lookup API URL',
        exportName: `${Stack.of(this).stackName}-DirectoryApiUrl`,
    });
    
    new CfnOutput(this, 'RequestsApiUrl', {
        value: 'https://apig.todaysdentalinsights.com/admin/requests',
        description: 'Active Favor Requests List API URL',
        exportName: `${Stack.of(this).stackName}-RequestsApiUrl`,
    });
  }
}
