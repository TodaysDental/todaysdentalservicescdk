import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface CallbackStackProps extends StackProps {
  // Authorizer imported via CloudFormation export
  /** Custom domain name token from CoreStack — creates implicit dependency so domain exists first */
  apiDomainName?: string;

  /**
   * KMS Key ARN used to encrypt secrets tables (ClinicConfig).
   * Required for the Callback Lambda to read the KMS-encrypted ClinicConfig table
   * during dynamic CORS origin validation.
   */
  secretsEncryptionKeyArn?: string;
}

export class CallbackStack extends Stack {
  public readonly callbackTablePrefix: string;
  public readonly callbackLambdaArn: string;
  public readonly defaultCallbackTableName: string;
  public readonly defaultCallbackTableArn: string;

  constructor(scope: Construct, id: string, props: CallbackStackProps) {
    super(scope, id, props);

    // ===========================================
    // Tags and Alarm Helpers
    // ===========================================
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Callback',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
      }
    };
    applyTags(this);

    const createLambdaErrorAlarm = (fn: lambda.IFunction, displayName: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${displayName} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, displayName: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${displayName} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaDurationAlarm = (fn: lambda.IFunction, displayName: string, thresholdMs: number) => {
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: Duration.minutes(5),
        }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${displayName} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
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
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // ===========================================
    // CALLBACK DYNAMODB TABLES
    // ===========================================

    // We'll create individual tables for each clinic using the existing pattern
    // Each clinic gets its own todaysdentalinsights-callback-{clinicId} table
    const tablePrefix = 'todaysdentalinsights-callback-';
    this.callbackTablePrefix = tablePrefix;

    // Create a sample/default table for clinics that don't have specific tables yet
    const defaultCallbackTable = new dynamodb.Table(this, 'DefaultCallbackTable', {
      tableName: `${this.stackName}-CallbackRequests`,
      partitionKey: { name: 'RequestID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(defaultCallbackTable, { Table: 'callback-default' });
    this.defaultCallbackTableName = defaultCallbackTable.tableName;
    this.defaultCallbackTableArn = defaultCallbackTable.tableArn;

    // Note: Legacy RequestCallBacks_* tables may exist from previous deployments
    // Lambda will use the wildcard permissions to access both old and new naming patterns

    // Add GSI for efficient querying by creation date
    defaultCallbackTable.addGlobalSecondaryIndex({
      indexName: 'CreatedAtIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for status-based queries
    defaultCallbackTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'calledBack', type: dynamodb.AttributeType.STRING },
    });

    // ===========================================
    // ENHANCED CALLBACK LAMBDA
    // ===========================================

    const callbackLambda = new lambdaNode.NodejsFunction(this, 'CallbackLambda', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'callBack.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        REGION: Stack.of(this).region,
        TABLE_PREFIX: tablePrefix,
        DEFAULT_TABLE: defaultCallbackTable.tableName,
        // CORS origins are now dynamically loaded from DynamoDB via shared/utils/cors.ts
        // The Lambda uses getAllClinicConfigs() from secrets-helper to fetch clinic websites
      },
    });
    applyTags(callbackLambda, { Function: 'callback' });

    this.callbackLambdaArn = callbackLambda.functionArn;

    // Grant permissions for all RequestCallBacks_* tables
    callbackLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:Query'
      ],
      resources: [
        // New naming pattern
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-callback-*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-callback-*/index/*`,
        // Legacy naming pattern (backward compatibility)
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/RequestCallBacks_*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/RequestCallBacks_*/index/*`,
        // Default table
        defaultCallbackTable.tableArn,
        `${defaultCallbackTable.tableArn}/index/*`,
      ],
    }));

    // Grant read access to ClinicConfig table for dynamic CORS origin validation
    // The Lambda uses getAllClinicConfigs() from secrets-helper to fetch clinic website URLs
    callbackLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/TodaysDentalInsights-ClinicConfig`,
      ],
    }));

    // Grant KMS decrypt access for the ClinicConfig table (encrypted with SecretsStack KMS key)
    // Without this, the Lambda gets AccessDeniedException: kms:Decrypt when scanning the table
    if (props.secretsEncryptionKeyArn) {
      callbackLambda.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // ===========================================
    // INDEPENDENT API GATEWAY FOR CALLBACKS
    // ===========================================

    // Create independent API Gateway for callbacks
    const callbackApi = new apigw.RestApi(this, 'CallbackApi', {
      restApiName: 'CallbackApi',
      description: 'Dedicated API for callback management',
      defaultCorsPreflightOptions: getCdkCorsConfig({
        allowHeaders: ['Content-Type', 'Origin', 'Accept', 'X-Requested-With']
      }),
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: callbackApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: callbackApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: callbackApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for this stack's API
    const authorizer = new apigw.RequestAuthorizer(this, 'CallbackAuthorizer', {
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
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${callbackApi.restApiId}/authorizers/*`,
    });

    // Create callback endpoints: /{clinicId}
    const callbackResource = callbackApi.root.addResource('{clinicId}');

    // Add specific methods
    callbackResource.addMethod('GET', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '404' }
      ],
    });

    callbackResource.addMethod('POST', new apigw.LambdaIntegration(callbackLambda), {
      // No auth required for POST (public callback creation)
      authorizationType: apigw.AuthorizationType.NONE,
      apiKeyRequired: false,
      methodResponses: [
        { statusCode: '201' },
        { statusCode: '400' },
        { statusCode: '500' }
      ],
    });

    callbackResource.addMethod('PUT', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '404' }
      ],
    });

    // ===========================================
    // CloudWatch Alarms (Lambda + DynamoDB)
    // ===========================================
    const lambdaAlarmTargets: Array<{ fn: lambda.IFunction; name: string; durationMs: number }> = [
      { fn: callbackLambda, name: 'callback', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ];

    lambdaAlarmTargets.forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(defaultCallbackTable.tableName, 'DefaultCallbackTable');

    // ===========================================
    // CALLBACK MANAGEMENT API
    // ===========================================

    // Add admin endpoints for callback management
    const adminCallbackResource = callbackApi.root
      .addResource('admin')
      .addResource('callbacks');

    // List all callbacks across all clinics (admin only)
    adminCallbackResource.addMethod('GET', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // Bulk operations endpoint
    const bulkCallbackResource = adminCallbackResource.addResource('bulk');
    bulkCallbackResource.addMethod('POST', new apigw.LambdaIntegration(callbackLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ===========================================
    // OUTPUTS
    // ===========================================

    new CfnOutput(this, 'CallbackTablePrefix', {
      value: this.callbackTablePrefix,
      description: 'Prefix for callback DynamoDB tables',
      exportName: `${Stack.of(this).stackName}-CallbackTablePrefix`,
    });

    new CfnOutput(this, 'CallbackLambdaArn', {
      value: this.callbackLambdaArn,
      description: 'ARN of the callback Lambda function',
      exportName: `${Stack.of(this).stackName}-CallbackLambdaArn`,
    });

    new CfnOutput(this, 'DefaultCallbackTableName', {
      value: defaultCallbackTable.tableName,
      description: 'Name of the default callback table',
      exportName: `${Stack.of(this).stackName}-DefaultCallbackTableName`,
    });

    new CfnOutput(this, 'CallbackApiUrl', {
      value: callbackApi.url,
      description: 'URL of the dedicated callback API',
      exportName: `${Stack.of(this).stackName}-CallbackApiUrl`,
    });

    new CfnOutput(this, 'CallbackApiEndpoint', {
      value: `${callbackApi.url}callback/{clinicId}`,
      description: 'Callback API endpoint pattern',
      exportName: `${Stack.of(this).stackName}-CallbackApiEndpoint`,
    });

    // Map this API under the existing custom domain as /callback
    new apigw.CfnBasePathMapping(this, 'CallbackBasePathMapping', {
      domainName: props.apiDomainName ?? 'api.todaysdentalservices.com',
      basePath: 'callback',
      restApiId: callbackApi.restApiId,
      stage: callbackApi.deploymentStage.stageName,
    });
  }
}
