import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodelambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PatientPortalApptTypesStackProps extends StackProps {
  // Authorizer imported via CloudFormation export
}

export class PatientPortalApptTypesStack extends Stack {
  public readonly apptTypesTable: dynamodb.Table;
  public readonly apptTypesFn: nodelambda.NodejsFunction;
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: PatientPortalApptTypesStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'PatientPortalApptTypes',
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
    // 1. DYNAMODB TABLE
    // ========================================
    this.apptTypesTable = new dynamodb.Table(this, 'ApptTypesTable', {
      // PK: clinicId, SK: label (STRING now)
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'label', type: dynamodb.AttributeType.STRING }, // <-- CHANGED to label
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-ApptTypes`,
    });
    applyTags(this.apptTypesTable, { Table: 'appt-types' });

    // ========================================
    // 2. API GATEWAY SETUP (BASE)
    // ========================================
    const corsConfig = getCdkCorsConfig();

    this.api = new apigateway.RestApi(this, 'PatientPortalApptTypesApi', {
      restApiName: 'PatientPortalApptTypesApi',
      description: 'API for OpenDental Patient Portal Appointment Types',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowMethods: corsConfig.allowMethods,
        allowHeaders: corsConfig.allowHeaders,
        // allowCredentials: true, // <-- REMOVED: To match templates-stack.ts behavior.
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const errorHeaders = getCorsErrorHeaders();

    new apigateway.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: errorHeaders,
    });
    new apigateway.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: errorHeaders,
    });
    new apigateway.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api,
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: errorHeaders,
    });
    new apigateway.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api,
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: errorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigateway.RequestAuthorizer(this, 'PatientPortalApptTypesAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigateway.IdentitySource.header('Authorization')],
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
    // 3. LAMBDA FUNCTION
    // ========================================
    this.apptTypesFn = new nodelambda.NodejsFunction(this, 'ApptTypesHandler', {
      entry: path.join(__dirname, '../../services/patient-portal/appttypes.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: {
        format: nodelambda.OutputFormat.CJS,
        target: 'node22',
      },
      environment: {
        TABLE_NAME: this.apptTypesTable.tableName,
        PARTITION_KEY: 'clinicId',
        SORT_KEY: 'label', // <-- CHANGED to label
      },
    });
    applyTags(this.apptTypesFn, { Function: 'appt-types' });

    this.apptTypesTable.grantReadWriteData(this.apptTypesFn);

    // ========================================
    // 4. API ROUTES & INTEGRATION
    // ========================================
    const integration = new apigateway.LambdaIntegration(this.apptTypesFn);

    // Root methods
    this.api.root.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '401' }, { statusCode: '403' }],
    });
    this.api.root.addMethod('POST', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [
        { statusCode: '201' },
        { statusCode: '400' },
        { statusCode: '401' },
        { statusCode: '403' },
        { statusCode: '409' }
      ],
    });

    // Single item methods (/{id} where id is now the LABEL)
    const singleItem = this.api.root.addResource('{id}');
    singleItem.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '401' }, { statusCode: '403' }, { statusCode: '404' }],
    });
    singleItem.addMethod('PUT', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '401' }, { statusCode: '403' }],
    });
    singleItem.addMethod('DELETE', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '401' }, { statusCode: '403' }],
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.apptTypesFn, name: 'appt-types', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.apptTypesTable.tableName, 'ApptTypesTable');

    // ========================================
    // 5. DOMAIN MAPPING
    // ========================================
    new apigateway.CfnBasePathMapping(this, 'ApptTypesBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'patient-portal-appttypes-v3', // <-- CHANGED basePath to v3
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // 6. OUTPUTS
    // ========================================
    new CfnOutput(this, 'ApptTypesTableName', {
      value: this.apptTypesTable.tableName,
      exportName: `${Stack.of(this).stackName}-ApptTypesTableName`,
    });
    new CfnOutput(this, 'ApptTypesApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/patient-portal-appttypes-v3', // <-- CHANGED URL to v3
      description: 'Full URL for this service via custom domain',
      exportName: `${Stack.of(this).stackName}-ApptTypesApiUrl`,
    });
  }
}
