import * as cdk from 'aws-cdk-lib';
import { Fn, Tags } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ChatbotStackProps extends cdk.StackProps {
  // Optional table names for existing DynamoDB tables - direct access, no API calls
  clinicHoursTableName?: string;
  clinicPricingTableName?: string;
  clinicInsuranceTableName?: string;
}

export class ChatbotStack extends cdk.Stack {
  public readonly websocketApi: apigatewayv2.WebSocketApi;
  public readonly restApi: apigateway.RestApi;
  public readonly conversationsTable: dynamodb.Table;
  public readonly clinicHoursTable?: dynamodb.ITable;
  public readonly clinicPricingTable?: dynamodb.ITable;
  /** WebSocket custom domain for wss://ws.todaysdentalinsights.com */
  public readonly webSocketDomain: apigatewayv2.DomainName;
  public readonly clinicInsuranceTable?: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: ChatbotStackProps) {
    super(scope, id, props);

    // Tags + alarm helpers
    const baseTags: Record<string, string> = {
      Stack: cdk.Stack.of(this).stackName,
      Service: 'Chatbot',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    const createLambdaErrorAlarm = (fn: lambda.IFunction, name: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, name: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaDurationAlarm = (fn: lambda.IFunction, name: string, thresholdMs: number) => {
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${name} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) => {
      new cloudwatch.Alarm(this, `${idSuffix}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: tableName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Use common CORS configuration
    const corsConfig = getCdkCorsConfig();
    const corsErrorHeaders = getCorsErrorHeaders();

    // =========================================================================
    // DynamoDB Tables
    // =========================================================================
    // Note: Clinic configuration is read directly from clinics.json, not stored in database

    // Conversations Table - stores all chat messages and sessions
    // Note: Using 'ConversationsTableV2' logical ID to recreate table after state drift
    this.conversationsTable = new dynamodb.Table(this, 'ConversationTableN1', {
      tableName: `${this.stackName}-ConversationN1`,
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Messages expire after 30 days
    });
    applyTags(this.conversationsTable, { Table: 'conversations' });

    // Add GSI for clinic-based conversation queries
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    // Add GSI for connectionId-based queries (production optimization for disconnect handler)
    this.conversationsTable.addGlobalSecondaryIndex({
      indexName: 'ConnectionIndex',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });


    // =========================================================================
    // Lambda Functions
    // =========================================================================

    // Common Lambda layer for shared dependencies
    const commonLayer = new lambda.LayerVersion(this, 'ChatbotCommonLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'shared', 'layers', 'common')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'Common dependencies for chatbot functions',
    });

    // WebSocket Connect Handler
    const connectHandler = new NodejsFunction(this, 'WebSocketConnectHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', '..', 'services', 'chatbot', 'websocket-connect.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [commonLayer],
      environment: {
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        ALLOWED_ORIGINS: corsConfig.allowOrigins.join(','),
      },
    });
    applyTags(connectHandler, { Function: 'websocket-connect' });

    // WebSocket Disconnect Handler
    const disconnectHandler = new NodejsFunction(this, 'WebSocketDisconnectHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', '..', 'services', 'chatbot', 'websocket-disconnect.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [commonLayer],
      environment: {
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
      },
    });
    applyTags(disconnectHandler, { Function: 'websocket-disconnect' });

    // Import existing DynamoDB tables from other stacks
    if (props.clinicHoursTableName) {
      this.clinicHoursTable = dynamodb.Table.fromTableAttributes(this, 'ImportedClinicHoursTable', {
        tableName: props.clinicHoursTableName,
      });
    }

    if (props.clinicPricingTableName) {
      this.clinicPricingTable = dynamodb.Table.fromTableAttributes(this, 'ImportedClinicPricingTable', {
        tableName: props.clinicPricingTableName,
      });
    }

    if (props.clinicInsuranceTableName) {
      this.clinicInsuranceTable = dynamodb.Table.fromTableAttributes(this, 'ImportedClinicInsuranceTable', {
        tableName: props.clinicInsuranceTableName,
      });
    }

    // WebSocket Message Handler - Main AI chatbot logic
    const messageHandler = new NodejsFunction(this, 'WebSocketMessageHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', '..', 'services', 'chatbot', 'websocket-message.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      layers: [commonLayer],
      environment: {
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        ALLOWED_ORIGINS: corsConfig.allowOrigins.join(','),
        // Direct DynamoDB table access - no API calls needed
        CLINIC_HOURS_TABLE: this.clinicHoursTable?.tableName || 'ClinicHours',
        CLINIC_PRICING_TABLE: this.clinicPricingTable?.tableName || 'ClinicPricing', 
        CLINIC_INSURANCE_TABLE: this.clinicInsuranceTable?.tableName || 'ClinicInsurance',
      },
    });
    applyTags(messageHandler, { Function: 'websocket-message' });

    // Note: Clinic data is accessed directly from DynamoDB tables in websocket-message.ts
    // No need for separate CRUD handlers since dedicated service stacks handle data management

    // Chat History Handler for viewing chat conversations
    const chatHistoryHandler = new NodejsFunction(this, 'ChatHistoryHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', '..', 'services', 'chatbot', 'chat-history.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      layers: [commonLayer],
      environment: {
        CONVERSATIONS_TABLE: this.conversationsTable.tableName,
        ALLOWED_ORIGINS: corsConfig.allowOrigins.join(','),
      },
    });
    applyTags(chatHistoryHandler, { Function: 'chat-history' });

    // =========================================================================
    // IAM Permissions
    // =========================================================================

    // Grant DynamoDB permissions
    // Note: Clinic config is read from clinics.json, no database permissions needed

    this.conversationsTable.grantReadWriteData(connectHandler);
    this.conversationsTable.grantReadWriteData(disconnectHandler);
    this.conversationsTable.grantReadWriteData(messageHandler);
    this.conversationsTable.grantReadData(chatHistoryHandler);

    // Grant read permissions to clinic data tables if they exist
    if (this.clinicHoursTable) {
      this.clinicHoursTable.grantReadData(messageHandler);
    }
    if (this.clinicPricingTable) {
      this.clinicPricingTable.grantReadData(messageHandler);
    }
    if (this.clinicInsuranceTable) {
      this.clinicInsuranceTable.grantReadData(messageHandler);
    }

    // Add explicit DynamoDB permissions for imported tables
    const tableResources: string[] = [
      // Conversations table (already exists)
      this.conversationsTable.tableArn,
      `${this.conversationsTable.tableArn}/index/*`,
    ];

    // Add imported table ARNs if they exist
    if (this.clinicHoursTable) {
      tableResources.push(this.clinicHoursTable.tableArn);
      tableResources.push(`${this.clinicHoursTable.tableArn}/index/*`);
    }
    if (this.clinicPricingTable) {
      tableResources.push(this.clinicPricingTable.tableArn);
      tableResources.push(`${this.clinicPricingTable.tableArn}/index/*`);
    }
    if (this.clinicInsuranceTable) {
      tableResources.push(this.clinicInsuranceTable.tableArn);
      tableResources.push(`${this.clinicInsuranceTable.tableArn}/index/*`);
    }

    const dynamoDbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: tableResources,
    });

    messageHandler.addToRolePolicy(dynamoDbPolicy);

    // Grant Bedrock permissions for AI functionality
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    });

    messageHandler.addToRolePolicy(bedrockPolicy);

    // Grant API Gateway management permissions for WebSocket
    const apiGatewayPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: ['*'],
    });

    messageHandler.addToRolePolicy(apiGatewayPolicy);

    // =========================================================================
    // API Gateway WebSocket API
    // =========================================================================

    this.websocketApi = new apigatewayv2.WebSocketApi(this, 'ChatbotWebSocketApi', {
      apiName: 'chatbot-websocket-api',
      description: 'WebSocket API for dental clinic chatbot',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('MessageIntegration', messageHandler),
      },
    });

    // WebSocket Stage
    const websocketStage = new apigatewayv2.WebSocketStage(this, 'ChatbotWebSocketStage', {
      webSocketApi: this.websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // =========================================================================
    // REST API for CRUD operations
    // =========================================================================

    this.restApi = new apigateway.RestApi(this, 'ChatbotRestApi', {
      restApiName: 'chatbot-rest-api',
      description: 'REST API for managing chatbot clinic data',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowMethods: corsConfig.allowMethods,
        allowHeaders: corsConfig.allowHeaders,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Import the existing User Pool - commented out as system now uses JWT auth
    // const userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', props.userPoolId);

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    const cognitoAuthorizer = new apigateway.RequestAuthorizer(this, 'ChatbotAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // Add CORS error responses
    new apigateway.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.restApi,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigateway.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.restApi,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigateway.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.restApi,
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.restApi.restApiId}/authorizers/*`,
    });

    // Chat history endpoint
    const chatHistoryResource = this.restApi.root.addResource('chat-history');
    const chatHistoryIntegration = new apigateway.LambdaIntegration(chatHistoryHandler);
    
    chatHistoryResource.addMethod('GET', chatHistoryIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // Optional: Add endpoint for specific conversation details
    const conversationResource = chatHistoryResource.addResource('{sessionId}');
    conversationResource.addMethod('GET', chatHistoryIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // CloudWatch alarms
    const lambdaAlarmTargets: Array<{ fn: lambda.IFunction; name: string; durationMs: number }> = [
      { fn: connectHandler, name: 'websocket-connect', durationMs: Math.floor(cdk.Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: disconnectHandler, name: 'websocket-disconnect', durationMs: Math.floor(cdk.Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: messageHandler, name: 'websocket-message', durationMs: Math.floor(cdk.Duration.minutes(5).toMilliseconds() * 0.8) },
      { fn: chatHistoryHandler, name: 'chat-history', durationMs: Math.floor(cdk.Duration.seconds(30).toMilliseconds() * 0.8) },
    ];

    lambdaAlarmTargets.forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.conversationsTable.tableName, 'ConversationTableN1');


    // =========================================================================
    // REST API Custom Domain Mapping
    // =========================================================================
    // Map this API under the existing custom domain created in CoreStack as /chatbot
    new apigateway.CfnBasePathMapping(this, 'ChatbotRestApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'chatbot',
      restApiId: this.restApi.restApiId,
      stage: this.restApi.deploymentStage.stageName,
    });

    // =========================================================================
    // WebSocket API Custom Domain Setup
    // =========================================================================
    // Certificate for ws.todaysdentalinsights.com
    const wsCertificateArn = 'arn:aws:acm:us-east-1:851620242036:certificate/4609e555-88a2-403f-b053-9d0899a899b9';

    // Create WebSocket custom domain (WebSocket APIs cannot share domain with REST APIs)
    // This domain is shared with AiAgentsStack which adds its own API mapping
    this.webSocketDomain = new apigatewayv2.DomainName(this, 'WebSocketDomain', {
      domainName: 'ws.todaysdentalinsights.com',
      certificate: certificatemanager.Certificate.fromCertificateArn(
        this,
        'WsCertificate',
        wsCertificateArn
      ),
    });

    // API mapping for WebSocket with /chat path
    new apigatewayv2.ApiMapping(this, 'WebSocketMapping', {
      api: this.websocketApi,
      domainName: this.webSocketDomain,
      stage: websocketStage,
      apiMappingKey: 'chat',
    });

    // Route53 record for WebSocket subdomain
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z0782155122P6UMFMK24C',
      zoneName: 'todaysdentalinsights.com',
    });

    new route53.ARecord(this, 'WebSocketRecord', {
      zone: hostedZone,
      recordName: 'ws',
      target: route53.RecordTarget.fromAlias(new route53targets.ApiGatewayv2DomainProperties(
        this.webSocketDomain.regionalDomainName,
        this.webSocketDomain.regionalHostedZoneId 
      )),
    });

    // =========================================================================
    // Outputs
    // =========================================================================

    new cdk.CfnOutput(this, 'WebSocketApiEndpoint', {
      value: websocketStage.url,
      description: 'Default WebSocket API endpoint for chatbot',
    });

    new cdk.CfnOutput(this, 'WebSocketCustomDomainEndpoint', {
      value: 'wss://ws.todaysdentalinsights.com/chat',
      description: 'Custom domain WebSocket API endpoint for chatbot',
    });

    // Export WebSocket domain attributes for cross-stack references (used by AiAgentsStack)
    new cdk.CfnOutput(this, 'WebSocketDomainName', {
      value: this.webSocketDomain.name,
      description: 'WebSocket custom domain name for cross-stack API mappings',
      exportName: `${this.stackName}-WebSocketDomainName`,
    });
    
    new cdk.CfnOutput(this, 'WebSocketRegionalDomainName', {
      value: this.webSocketDomain.regionalDomainName,
      description: 'Regional domain name for WebSocket custom domain',
      exportName: `${this.stackName}-WebSocketRegionalDomainName`,
    });
    
    new cdk.CfnOutput(this, 'WebSocketRegionalHostedZoneId', {
      value: this.webSocketDomain.regionalHostedZoneId,
      description: 'Regional hosted zone ID for WebSocket custom domain',
      exportName: `${this.stackName}-WebSocketRegionalHostedZoneId`,
    });

    new cdk.CfnOutput(this, 'RestApiEndpoint', {
      value: this.restApi.url,
      description: 'Default REST API endpoint for clinic data management',
    });

    new cdk.CfnOutput(this, 'RestCustomDomainEndpoint', {
      value: 'https://apig.todaysdentalinsights.com/chatbot',
      description: 'Custom domain REST API endpoint for chatbot data management',
    });

    new cdk.CfnOutput(this, 'ConversationsTableName', {
      value: this.conversationsTable.tableName,
      description: 'DynamoDB table for conversation storage',
    });

    // Output imported table information
    if (this.clinicHoursTable) {
      new cdk.CfnOutput(this, 'ImportedClinicHoursTableName', {
        value: this.clinicHoursTable.tableName,
        description: 'Imported Clinic Hours DynamoDB table name',
      });
    }

    if (this.clinicPricingTable) {
      new cdk.CfnOutput(this, 'ImportedClinicPricingTableName', {
        value: this.clinicPricingTable.tableName,
        description: 'Imported Clinic Pricing DynamoDB table name',
      });
    }

    if (this.clinicInsuranceTable) {
      new cdk.CfnOutput(this, 'ImportedClinicInsuranceTableName', {
        value: this.clinicInsuranceTable.tableName,
        description: 'Imported Clinic Insurance DynamoDB table name',
      });
    }
  }
}
