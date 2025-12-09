import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

/**
 * AI Agents Stack
 * 
 * Provides customizable AI agents with a 3-level prompt system:
 * 1. System Prompt (constant) - Defined by us, sets the agent's base behavior
 * 2. Negative Prompt (constant) - What the agent should NOT do
 * 3. User Prompt (customizable) - User-defined instructions from the frontend
 * 
 * Users can create agents, choose models, configure parameters, etc.
 */
export interface AiAgentsStackProps extends StackProps {
  // JWT secret for authentication (optional, uses exported value if not provided)
  jwtSecretValue?: string;
}

export class AiAgentsStack extends Stack {
  public readonly agentsTable: dynamodb.Table;
  public readonly agentExecutionsTable: dynamodb.Table;
  public readonly agentsFn: lambdaNode.NodejsFunction;
  public readonly invokeAgentFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: AiAgentsStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'AIAgents',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    const createLambdaErrorAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: fn.metricErrors({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, name: string) =>
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: fn.metricThrottles({ period: Duration.minutes(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${name} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createLambdaDurationAlarm = (fn: lambda.IFunction, name: string, thresholdMs: number) =>
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${name} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) =>
      new cloudwatch.Alarm(this, `${idSuffix}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: tableName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // AI Agents Table - stores agent configurations
    this.agentsTable = new dynamodb.Table(this, 'AiAgentsTable', {
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-AiAgents`,
      pointInTimeRecovery: true,
    });
    applyTags(this.agentsTable, { Table: 'ai-agents' });

    // Add GSI for clinic-based queries
    this.agentsTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for model-based queries
    this.agentsTable.addGlobalSecondaryIndex({
      indexName: 'ModelIndex',
      partitionKey: { name: 'modelId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Agent Executions Table - stores execution history and logs
    this.agentExecutionsTable = new dynamodb.Table(this, 'AgentExecutionsTable', {
      partitionKey: { name: 'executionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-AgentExecutions`,
      timeToLiveAttribute: 'ttl', // Auto-expire old executions after 90 days
    });
    applyTags(this.agentExecutionsTable, { Table: 'agent-executions' });

    // Add GSI for agent-based execution queries
    this.agentExecutionsTable.addGlobalSecondaryIndex({
      indexName: 'AgentExecutionIndex',
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'AiAgentsApi', {
      restApiName: 'AiAgentsApi',
      description: 'AI Agents service API - Create, manage, and invoke customizable AI agents',
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

    // Create a reference to the authorizer function
    const authorizerFn = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthorizerFn',
      authorizerFunctionArn
    );

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'AiAgentsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // AI Agents CRUD Handler
    this.agentsFn = new lambdaNode.NodejsFunction(this, 'AiAgentsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'agents.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        EXECUTIONS_TABLE: this.agentExecutionsTable.tableName,
      },
    });
    applyTags(this.agentsFn, { Function: 'ai-agents-crud' });

    this.agentsTable.grantReadWriteData(this.agentsFn);
    this.agentExecutionsTable.grantReadData(this.agentsFn);

    // Invoke Agent Handler
    this.invokeAgentFn = new lambdaNode.NodejsFunction(this, 'InvokeAgentFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'ai-agents', 'invoke-agent.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.minutes(5), // Longer timeout for AI model invocations
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        AGENTS_TABLE: this.agentsTable.tableName,
        EXECUTIONS_TABLE: this.agentExecutionsTable.tableName,
      },
    });
    applyTags(this.invokeAgentFn, { Function: 'invoke-agent' });

    this.agentsTable.grantReadData(this.invokeAgentFn);
    this.agentExecutionsTable.grantReadWriteData(this.invokeAgentFn);

    // Grant Bedrock permissions for AI model invocations
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'], // Allow all Bedrock models
    });
    this.invokeAgentFn.addToRolePolicy(bedrockPolicy);

    // ========================================
    // API ROUTES
    // ========================================

    // /agents - List and Create agents
    const agentsRes = this.api.root.addResource('agents');
    agentsRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    agentsRes.addMethod('POST', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // /agents/{agentId} - Get, Update, Delete specific agent
    const agentIdRes = agentsRes.addResource('{agentId}');
    agentIdRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });
    agentIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    agentIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    // /agents/{agentId}/invoke - Invoke the agent
    const invokeRes = agentIdRes.addResource('invoke');
    invokeRes.addMethod('POST', new apigw.LambdaIntegration(this.invokeAgentFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '404' }],
    });

    // /agents/{agentId}/executions - Get execution history for an agent
    const executionsRes = agentIdRes.addResource('executions');
    executionsRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // /models - List available AI models
    const modelsRes = this.api.root.addResource('models');
    modelsRes.addMethod('GET', new apigw.LambdaIntegration(this.agentsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'AiAgentsApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'ai-agents',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AiAgentsTableName', {
      value: this.agentsTable.tableName,
      description: 'Name of the AI Agents DynamoDB table',
      exportName: `${Stack.of(this).stackName}-AiAgentsTableName`,
    });

    new CfnOutput(this, 'AgentExecutionsTableName', {
      value: this.agentExecutionsTable.tableName,
      description: 'Name of the Agent Executions DynamoDB table',
      exportName: `${Stack.of(this).stackName}-AgentExecutionsTableName`,
    });

    new CfnOutput(this, 'AiAgentsApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/ai-agents/',
      description: 'AI Agents API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AiAgentsApiUrl`,
    });

    new CfnOutput(this, 'AiAgentsApiId', {
      value: this.api.restApiId,
      description: 'AI Agents API Gateway ID',
      exportName: `${Stack.of(this).stackName}-AiAgentsApiId`,
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.agentsFn, name: 'ai-agents-crud', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.invokeAgentFn, name: 'invoke-agent', durationMs: Math.floor(Duration.minutes(5).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.agentsTable.tableName, 'AiAgentsTable');
    createDynamoThrottleAlarm(this.agentExecutionsTable.tableName, 'AgentExecutionsTable');
  }
}

