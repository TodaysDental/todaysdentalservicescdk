import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events'; 
import * as targets from 'aws-cdk-lib/aws-events-targets'; 
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// Import clinic data to dynamically configure the scheduler
import clinicsData from '../configs/clinics.json'; 

export interface ClinicHoursStackProps extends StackProps {
  // Authorizer imported via CloudFormation export
}

export class ClinicHoursStack extends Stack {
  public readonly clinicHoursTable: dynamodb.Table;
  public readonly hoursCrudFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: ClinicHoursStackProps) {
    super(scope, id, props);

    // Tags & alarms helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'ClinicHours',
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
    // DYNAMODB TABLE
    // ========================================

    this.clinicHoursTable = new dynamodb.Table(this, 'ClinicHoursTable', {
      tableName: `${this.stackName}-ClinicHours`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.clinicHoursTable, { Table: 'clinic-hours' });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'ClinicHoursApi', {
      restApiName: 'ClinicHoursApi',
      description: 'Clinic Hours service API',
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

    // Import the authorizer function ARN
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    this.authorizer = new apigw.RequestAuthorizer(this, 'ClinicHoursAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // =========================================================
    // CRUD LAMBDA FUNCTION (Updated to use merged clinicHours.ts)
    // =========================================================
    
    this.hoursCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicHoursCrudFn', {
      // Point to the MERGED file
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'clinicHours.ts'), 
      // Use the API handler export
      handler: 'apiHandler', 
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node22',
        minify: false,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          'jose',
        ],
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        CLINIC_HOURS_TABLE: this.clinicHoursTable.tableName,
      },
    });
    applyTags(this.hoursCrudFn, { Function: 'clinic-hours-crud' });

    // Permissions for CRUD Fn
    this.hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Scan', 'dynamodb:Query'
      ],
      resources: [this.clinicHoursTable.tableArn, `${this.clinicHoursTable.tableArn}/*`],
    }));

    this.hoursCrudFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [ 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents' ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    }));


    // ================================================================
    // HOURLY SCHEDULER LAMBDA (Updated to use merged clinicHours.ts)
    // ================================================================
    
    const allClinicIds = (clinicsData as any[]).map(c => c.clinicId).join(',');
    
    // UPDATED: We only provide the BASE URL here. 
    // The Lambda (clinicHours.ts) appends /opendental/api/clinic/{id}/schedules...
    const schedulesApiBaseUrl = 'https://apig.todaysdentalinsights.com';

    const hoursSchedulerFn = new lambdaNode.NodejsFunction(this, 'HoursSchedulerFn', {
      // Point to the MERGED file
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'clinicHours.ts'), 
      // Use the Scheduler handler export
      handler: 'schedulerHandler', 
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node22',
        minify: false,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', 'axios'], 
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        CLINIC_HOURS_TABLE: this.clinicHoursTable.tableName,
        // Pass the base URL; the Lambda constructs the full path
        SCHEDULES_API_URL: schedulesApiBaseUrl, 
        ALL_CLINIC_IDS: allClinicIds,
      },
    });
    applyTags(hoursSchedulerFn, { Function: 'hours-scheduler' });

    this.clinicHoursTable.grantReadWriteData(hoursSchedulerFn); 
    
    // ========================================
    // EVENTBRIDGE RULE
    // ========================================

    const rule = new events.Rule(this, 'HourlyClinicHoursUpdateRule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      description: 'Triggers the Lambda to fetch OpenDental schedules and update ClinicHoursTable hourly.',
    });

    rule.addTarget(new targets.LambdaFunction(hoursSchedulerFn));

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.hoursCrudFn, name: 'clinic-hours-crud', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: hoursSchedulerFn, name: 'hours-scheduler', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.clinicHoursTable.tableName, 'ClinicHoursTable');

    // ========================================
    // API ROUTES
    // ========================================

    // Legacy hours routes
    const hoursRes = this.api.root.addResource('hours');
    hoursRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }]
    });
    hoursRes.addMethod('POST', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }]
    });

    const hoursIdRes = hoursRes.addResource('{clinicId}');
    hoursIdRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
    });
    hoursIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }]
    });
    hoursIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }]
    });

    // New format clinic hours routes
    const clinicsRes = this.api.root.addResource('clinics');
    const clinicIdRes = clinicsRes.addResource('{clinicId}');
    const clinicHoursRes = clinicIdRes.addResource('hours');

    clinicHoursRes.addMethod('GET', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
    });
    clinicHoursRes.addMethod('PUT', new apigw.LambdaIntegration(this.hoursCrudFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }]
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'ClinicHoursApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'clinic-hours',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ClinicHoursTableName', {
      value: this.clinicHoursTable.tableName,
      description: 'Name of the Clinic Hours DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ClinicHoursTableName`,
    });

    new CfnOutput(this, 'ClinicHoursApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/clinic-hours/',
      description: 'Clinic Hours API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ClinicHoursApiUrl`,
    });

    new CfnOutput(this, 'ClinicHoursApiId', {
      value: this.api.restApiId,
      description: 'Clinic Hours API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ClinicHoursApiId`,
    });
  }
}