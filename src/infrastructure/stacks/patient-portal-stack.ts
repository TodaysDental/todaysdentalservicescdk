import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
// NOTE: clinicConfigData is used at CDK synthesis time for infrastructure creation
// Lambda functions should use DynamoDB secrets tables at runtime
import clinicConfigData from '../configs/clinic-config.json';

// Alias for backward compatibility
const clinicsJson = clinicConfigData;
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PatientPortalStackProps extends StackProps {
  // No authorizer needed - public endpoints only
  // Transfer Family server info for SFTP document downloads
  consolidatedTransferServerId: string;
  consolidatedTransferServerBucket: string;
  /** GlobalSecrets DynamoDB table name for retrieving SFTP credentials */
  globalSecretsTableName?: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
  // ========================================
  // AI AGENTS INTEGRATION (from AiAgentsStack)
  // ========================================
  /** AI Agents Metrics table name for tracking billsPaid through AI agent flow */
  aiAgentsMetricsTableName?: string;
  /** AI Agents Metrics table ARN for IAM permissions */
  aiAgentsMetricsTableArn?: string;
}

export class PatientPortalStack extends Stack {
  public readonly patientPortalLambdaArn: string;
  public readonly sessionTableName: string;
  public readonly smsLogTableName: string;
  public readonly portalMetricsTableName: string;

  constructor(scope: Construct, id: string, props: PatientPortalStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'PatientPortal',
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

    // ===========================================
    // PATIENT PORTAL DYNAMODB TABLES (CLINIC-SPECIFIC)
    // ===========================================

    const sessionTablePrefix = 'todaysdentalinsights-patient-sessions-';
    const smsLogTablePrefix = 'todaysdentalinsights-sms-logs-';

    const defaultSessionTable = new dynamodb.Table(this, 'DefaultSessionTable', {
      tableName: `${this.stackName}-PatientSessions`,
      partitionKey: { name: 'SessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires', // Auto-expire sessions
    });
    applyTags(defaultSessionTable, { Table: 'patient-sessions' });

    const defaultSmsLogTable = new dynamodb.Table(this, 'DefaultSmsLogTable', {
      tableName: `${this.stackName}-SmsLogs`,
      partitionKey: { name: 'LogId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(defaultSmsLogTable, { Table: 'sms-logs' });

    defaultSmsLogTable.addGlobalSecondaryIndex({
      indexName: 'PhoneNumberIndex',
      partitionKey: { name: 'PhoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Aggregated per-day metrics for patient portal activity
    const portalMetricsTable = new dynamodb.Table(this, 'PatientPortalMetricsTable', {
      tableName: `${this.stackName}-PortalMetrics`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'metricDate', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    applyTags(portalMetricsTable, { Table: 'patient-portal-metrics' });

    this.sessionTableName = defaultSessionTable.tableName;
    this.smsLogTableName = defaultSmsLogTable.tableName;
    this.portalMetricsTableName = portalMetricsTable.tableName;

    // ===========================================
    // SNS TOPICS AND PERMISSIONS
    // ===========================================

    // ===========================================
    // PATIENT PORTAL LAMBDA FUNCTION
    // ===========================================

    const patientPortalLambda = new lambdaNode.NodejsFunction(this, 'PatientPortalLambda', {
      entry: path.join(__dirname, '..', '..', 'services', 'patient-portal', 'patientPortal.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],  // Native .node binaries can't be bundled
        nodeModules: ['ssh2'],  // Include ssh2 in node_modules for Lambda
      },
      environment: {
        REGION: Stack.of(this).region,
        SESSION_TABLE_PREFIX: sessionTablePrefix,
        SMS_LOG_TABLE_PREFIX: smsLogTablePrefix,
        DEFAULT_SESSION_TABLE: defaultSessionTable.tableName,
        DEFAULT_SMS_LOG_TABLE: defaultSmsLogTable.tableName,
        TF_BUCKET: props.consolidatedTransferServerBucket,
        TF_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        PATIENT_PORTAL_METRICS_TABLE: portalMetricsTable.tableName,
        // Secrets tables for dynamic credential retrieval (SFTP password now from GlobalSecrets)
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        // AI Agents Metrics table for tracking billsPaid (payments processed via AI agent)
        AI_AGENTS_METRICS_TABLE: props.aiAgentsMetricsTableName || '',
      },
    });
    applyTags(patientPortalLambda, { Function: 'patient-portal' });

    this.patientPortalLambdaArn = patientPortalLambda.functionArn;

    patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:Query',
        'dynamodb:DeleteItem'
      ],
      resources: [
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-patient-sessions-*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-patient-sessions-*/index/*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-sms-logs-*`,
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-sms-logs-*/index/*`,
        defaultSessionTable.tableArn,
        `${defaultSessionTable.tableArn}/index/*`,
        defaultSmsLogTable.tableArn,
        `${defaultSmsLogTable.tableArn}/index/*`,
        portalMetricsTable.tableArn,
      ],
    }));

    portalMetricsTable.grantReadWriteData(patientPortalLambda);

    // Grant read access to secrets tables for dynamic SFTP credential retrieval
    if (props.globalSecretsTableName) {
      patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName || 'TodaysDentalInsights-ClinicSecrets'}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      }));
    }

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // Grant write access to AI Agents Metrics table for tracking billsPaid
    // This enables the patient portal to update the billsPaid metric when
    // a payment is processed through the AI agent-assisted flow
    if (props.aiAgentsMetricsTableArn) {
      patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'],
        resources: [props.aiAgentsMetricsTableArn],
      }));
    }

    // Grant write access to Callback tables for saving failed appointment bookings as callbacks
    // This enables clinic staff to follow up with patients when patient portal booking fails
    patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [
        // Clinic-specific callback tables
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/todaysdentalinsights-callback-*`,
        // Default callback table as fallback
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/TodaysDentalInsightsCallbackN1-CallbackRequests`,
      ],
    }));

    patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'sns:Publish',
        'sns:GetSMSAttributes',
        'sns:SetSMSAttributes'
      ],
      resources: ['*'], // SNS SMS requires * permission
    }));

    patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:ListBucket'
      ],
      resources: [
        `arn:aws:s3:::${props.consolidatedTransferServerBucket}`,
        `arn:aws:s3:::${props.consolidatedTransferServerBucket}/*`
      ],
    }));

    (clinicsJson as any[]).forEach((clinic) => {
      if (clinic.smsOriginationArn) {
        patientPortalLambda.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            'sns-voice:*'
          ],
          resources: [clinic.smsOriginationArn],
        }));
      }
    });

    // ===========================================
    // INDEPENDENT API GATEWAY FOR PATIENT PORTAL
    // ===========================================

    const patientPortalApi = new apigw.RestApi(this, 'PatientPortalApi', {
      restApiName: 'PatientPortalApi',
      description: 'Dedicated API for patient portal management',
      defaultCorsPreflightOptions: getCdkCorsConfig(),
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: patientPortalApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: patientPortalApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: patientPortalApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    const patientPortalBaseResource = patientPortalApi.root.addResource('patientportal');
    const patientPortalResource = patientPortalBaseResource.addResource('{clinicId}');

    const methods = ['GET', 'POST', 'PUT', 'DELETE'];
    methods.forEach(method => {
      patientPortalResource.addMethod(method, new apigw.LambdaIntegration(patientPortalLambda), {
        methodResponses: [
          { statusCode: '200' }, { statusCode: '201' }, { statusCode: '400' },
          { statusCode: '401' }, { statusCode: '403' }, { statusCode: '404' },
          { statusCode: '500' }
        ],
      });
    });

    const proxyResource = patientPortalResource.addResource('{proxy+}');
    methods.forEach(method => {
      proxyResource.addMethod(method, new apigw.LambdaIntegration(patientPortalLambda), {
        methodResponses: [
          { statusCode: '200' }, { statusCode: '201' }, { statusCode: '400' },
          { statusCode: '401' }, { statusCode: '403' }, { statusCode: '404' },
          { statusCode: '500' }
        ],
      });
    });

    const rootClinicResource = patientPortalApi.root.addResource('{clinicId}');
    methods.forEach(method => {
      rootClinicResource.addMethod(method, new apigw.LambdaIntegration(patientPortalLambda), {
        methodResponses: [
          { statusCode: '200' }, { statusCode: '201' }, { statusCode: '400' },
          { statusCode: '401' }, { statusCode: '403' }, { statusCode: '404' },
          { statusCode: '500' }
        ],
      });
    });

    const rootProxyResource = rootClinicResource.addResource('{proxy+}');
    methods.forEach(method => {
      rootProxyResource.addMethod(method, new apigw.LambdaIntegration(patientPortalLambda), {
        methodResponses: [
          { statusCode: '200' }, { statusCode: '201' }, { statusCode: '400' },
          { statusCode: '401' }, { statusCode: '403' }, { statusCode: '404' },
          { statusCode: '500' }
        ],
      });
    });

    // ===========================================
    // PUBLIC APPOINTMENT TYPES ENDPOINT
    // ===========================================

    // 1. Get a reference to the existing ApptTypes table
    const apptTypesTable = dynamodb.Table.fromTableName(
      this,
      'ImportedApptTypesTable',
      'todaysdentalinsights-PatientPortal-ApptTypes-V3'
    );

    // 2. Define the new Lambda function for the public endpoint
    const publicApptTypesLambda = new lambdaNode.NodejsFunction(this, 'PublicApptTypesLambda', {
      entry: path.join(__dirname, '..', '..', 'services', 'patient-portal', 'public-appttypes.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        REGION: Stack.of(this).region,
        APPTTYPES_TABLE_NAME: apptTypesTable.tableName,
      },
    });
    applyTags(publicApptTypesLambda, { Function: 'public-appttypes' });

    // 3. Grant *read-only* permission to the new Lambda
    apptTypesTable.grantReadData(publicApptTypesLambda);

    // 4. Define the API Gateway integration
    const publicApptTypesIntegration = new apigw.LambdaIntegration(publicApptTypesLambda);

    // 5. Add the new route: /{clinicId}/appttypes
    const apptTypesResourceOnRoot = rootClinicResource.addResource('appttypes');
    apptTypesResourceOnRoot.addMethod('GET', publicApptTypesIntegration, {
      methodResponses: [
        { statusCode: '200' }, { statusCode: '400' },
        { statusCode: '404' }, { statusCode: '500' }
      ],
    });

    // 6. Add the same route to the /patientportal/{clinicId}/appttypes path
    const apptTypesResourceOnPortal = patientPortalResource.addResource('appttypes');
    apptTypesResourceOnPortal.addMethod('GET', publicApptTypesIntegration, {
      methodResponses: [
        { statusCode: '200' }, { statusCode: '400' },
        { statusCode: '404' }, { statusCode: '500' }
      ],
    });

    // --- NEWLY ADDED CODE ---

    // 7. Add the new route: /{clinicId}/appttypes/{label}
    const singleApptTypeResourceOnRoot = apptTypesResourceOnRoot.addResource('{label}');
    singleApptTypeResourceOnRoot.addMethod('GET', publicApptTypesIntegration, {
      // NO authorizer - this makes it public
      methodResponses: [
        { statusCode: '200' }, { statusCode: '400' },
        { statusCode: '404' }, { statusCode: '500' }
      ],
    });

    // 8. Add the same route to the /patientportal/{clinicId}/appttypes/{label} path
    const singleApptTypeResourceOnPortal = apptTypesResourceOnPortal.addResource('{label}');
    singleApptTypeResourceOnPortal.addMethod('GET', publicApptTypesIntegration, {
      // NO authorizer - this makes it public
      methodResponses: [
        { statusCode: '200' }, { statusCode: '400' },
        { statusCode: '404' }, { statusCode: '500' }
      ],
    });

    // --- END OF NEWLY ADDED CODE ---

    // ===========================================
    // OUTPUTS
    // ===========================================

    new CfnOutput(this, 'PatientPortalLambdaArn', {
      value: this.patientPortalLambdaArn,
      description: 'ARN of the patient portal Lambda function (representative)',
      exportName: `${Stack.of(this).stackName}-PatientPortalLambdaArn`,
    });

    new CfnOutput(this, 'SessionTableName', {
      value: this.sessionTableName,
      description: 'Name of the patient session table',
      exportName: `${Stack.of(this).stackName}-SessionTableName`,
    });

    new CfnOutput(this, 'SmsLogTableName', {
      value: this.smsLogTableName,
      description: 'Name of the SMS log table',
      exportName: `${Stack.of(this).stackName}-SmsLogTableName`,
    });

    new CfnOutput(this, 'PatientPortalApiUrl', {
      value: patientPortalApi.url,
      description: 'URL of the dedicated patient portal API',
      exportName: `${Stack.of(this).stackName}-PatientPortalApiUrl`,
    });

    new CfnOutput(this, 'PatientPortalApiEndpoint', {
      value: `${patientPortalApi.url}patientportal/{clinicId}`,
      description: 'Patient Portal API endpoint pattern',
      exportName: `${Stack.of(this).stackName}-PatientPortalApiEndpoint`,
    });

    // Map this API under the existing custom domain as /patientportal
    new apigw.CfnBasePathMapping(this, 'PatientPortalBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'patientportal',
      restApiId: patientPortalApi.restApiId,
      stage: patientPortalApi.deploymentStage.stageName,
    });

    // ===========================================
    // CloudWatch Alarms
    // ===========================================
    [
      { fn: patientPortalLambda, name: 'patient-portal', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: publicApptTypesLambda, name: 'public-appttypes', durationMs: Math.floor(Duration.seconds(10).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(defaultSessionTable.tableName, 'PatientSessionsTable');
    createDynamoThrottleAlarm(defaultSmsLogTable.tableName, 'SmsLogsTable');
    createDynamoThrottleAlarm(portalMetricsTable.tableName, 'PatientPortalMetricsTable');
  }
}