import { Duration, Stack, StackProps, CfnOutput, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface QueryGeneratorStackProps extends StackProps {
  // No additional props needed - schema is bundled with Lambda
}

export class QueryGeneratorStack extends Stack {
  public readonly queryGeneratorFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: QueryGeneratorStackProps = {}) {
    super(scope, id, props);

    // ========================================
    // TAGS & ALARM HELPERS
    // ========================================

    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'QueryGenerator',
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

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'QueryGeneratorApi', {
      restApiName: 'QueryGeneratorApi',
      description: 'AI-powered SQL Query Generator API using OpenDental schema',
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

    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'QueryGeneratorAuthorizer', {
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
    // LAMBDA FUNCTION
    // ========================================

    // Path to the service directory containing both the Lambda and schema.json
    const serviceDir = path.join(__dirname, '..', '..', 'services', 'query-generator');

    this.queryGeneratorFn = new lambdaNode.NodejsFunction(this, 'QueryGeneratorFn', {
      entry: path.join(serviceDir, 'query-generator.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512, // Slightly higher for schema processing
      timeout: Duration.seconds(60), // Allow time for Bedrock response
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        // Bundle the schema.json file with the Lambda
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // Copy schema.json to the output directory (cross-platform)
            const schemaSource = path.join(inputDir, 'src', 'services', 'query-generator', 'schema.json');
            const schemaDest = path.join(outputDir, 'schema.json');
            // Use 'copy' on Windows, 'cp' on Unix/Mac
            if (process.platform === 'win32') {
              return [`copy "${schemaSource}" "${schemaDest}"`];
            }
            return [`cp "${schemaSource}" "${schemaDest}"`];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
      environment: {
        DEBUG_MODE: 'false',
        AWS_REGION: this.region,
      },
    });

    applyTags(this.queryGeneratorFn, { Function: 'query-generator' });

    // Grant Bedrock InvokeModel permission for Claude models
    this.queryGeneratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        // Claude Sonnet 4.5 - both inference profile AND foundation model (required for cross-region inference)
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`,
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
        // Foundation models (for fallback)
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
        // Also allow cross-region profiles for Claude 3.5 models
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0`,
      ],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    const generateResource = this.api.root.addResource('generate');
    
    // POST /generate - Generate SQL query from natural language
    generateResource.addMethod('POST', new apigw.LambdaIntegration(this.queryGeneratorFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '500' },
      ],
    });

    // Also add a query endpoint as an alias
    const queryResource = this.api.root.addResource('query');
    queryResource.addMethod('POST', new apigw.LambdaIntegration(this.queryGeneratorFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '500' },
      ],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'QueryGeneratorApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'query-generator',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'QueryGeneratorApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/query-generator/',
      description: 'Query Generator API Gateway URL',
      exportName: `${Stack.of(this).stackName}-QueryGeneratorApiUrl`,
    });

    new CfnOutput(this, 'QueryGeneratorApiId', {
      value: this.api.restApiId,
      description: 'Query Generator API Gateway ID',
      exportName: `${Stack.of(this).stackName}-QueryGeneratorApiId`,
    });

    new CfnOutput(this, 'QueryGeneratorFunctionArn', {
      value: this.queryGeneratorFn.functionArn,
      description: 'Query Generator Lambda Function ARN',
      exportName: `${Stack.of(this).stackName}-QueryGeneratorFunctionArn`,
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================

    createLambdaErrorAlarm(this.queryGeneratorFn, 'query-generator');
    createLambdaThrottleAlarm(this.queryGeneratorFn, 'query-generator');
    createLambdaDurationAlarm(
      this.queryGeneratorFn, 
      'query-generator', 
      Math.floor(Duration.seconds(60).toMilliseconds() * 0.8)
    );
  }
}
