import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import clinicsJson from '../configs/clinics.json';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ChatbotStackProps extends cdk.StackProps {
  authorizer: apigw.RequestAuthorizer;
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
  public readonly clinicInsuranceTable?: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: ChatbotStackProps) {
    super(scope, id, props);

    // Use common CORS configuration
    const corsConfig = getCdkCorsConfig();
    const corsErrorHeaders = getCorsErrorHeaders();

    // =========================================================================
    // DynamoDB Tables
    // =========================================================================
    // Note: Clinic configuration is read directly from clinics.json, not stored in database

    // Conversations Table - stores all chat messages and sessions
    this.conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      tableName: 'chatbot-conversations',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Messages expire after 30 days
    });

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

    // Import the existing User Pool
    const userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', props.userPoolId);

    // Cognito Authorizer
    const cognitoAuthorizer = props.authorizer;

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



    // Chat history endpoint
    const chatHistoryResource = this.restApi.root.addResource('chat-history');
    const chatHistoryIntegration = new apigateway.LambdaIntegration(chatHistoryHandler);
    
    chatHistoryResource.addMethod('GET', chatHistoryIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Optional: Add endpoint for specific conversation details
    const conversationResource = chatHistoryResource.addResource('{sessionId}');
    conversationResource.addMethod('GET', chatHistoryIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // =========================================================================
    // Custom Domain Setup
    // =========================================================================

    // Certificate for both api.todaysdentalinsights.com and ws.todaysdentalinsights.com
    const certificateArn = this.node.tryGetContext('certificateArn') ?? 
      process.env.CERTIFICATE_ARN ?? 
      'arn:aws:acm:us-east-1:851620242036:certificate/7af77cc9-8c2e-4d1b-bd99-ac0087643686';

    // Temporarily commented out to break dependency on old API stack
    // Use existing domain with base path mapping for REST API
    // new apigateway.CfnBasePathMapping(this, 'ChatbotRestApiBasePathMapping', {
    //   domainName: 'api.todaysdentalinsights.com',
    //   basePath: 'chatbot',
    //   restApiId: this.restApi.restApiId,
    //   stage: 'prod',
    // });

    // Create WebSocket domain on a subdomain (due to AWS limitation that WebSocket and REST can't share same domain)
    const wsSubdomain = 'ws.todaysdentalinsights.com';
    const wsDomain = new apigatewayv2.DomainName(this, 'WebSocketDomain', {
      domainName: wsSubdomain,
      certificate: certificatemanager.Certificate.fromCertificateArn(
        this,
        'WsCertificate', 
        certificateArn
      ),
    });

    // API mapping for WebSocket with /chat path
    new apigatewayv2.ApiMapping(this, 'WebSocketMapping', {
      api: this.websocketApi,
      domainName: wsDomain,
      stage: websocketStage,
      apiMappingKey: 'chat', // This creates the /chat path
    });

    // Route53 record for WebSocket subdomain
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'todaysdentalinsights.com',
    });

    new route53.ARecord(this, 'WebSocketRecord', {
      zone: hostedZone,
      recordName: 'ws',
      target: route53.RecordTarget.fromAlias(new route53targets.ApiGatewayv2DomainProperties(
        wsDomain.regionalDomainName,
        wsDomain.regionalHostedZoneId
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

    new cdk.CfnOutput(this, 'RestApiEndpoint', {
      value: this.restApi.url,
      description: 'Default REST API endpoint for clinic data management',
    });

    new cdk.CfnOutput(this, 'RestCustomDomainEndpoint', {
      value: 'https://api.todaysdentalinsights.com/chatbot',
      description: 'Custom domain REST API endpoint for chatbot data management',
    });

    new cdk.CfnOutput(this, 'ConversationsTableName', {
      value: this.conversationsTable.tableName,
      description: 'DynamoDB table for conversation storage',
    });

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: certificateArn,
      description: 'SSL Certificate ARN used for custom domain',
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
