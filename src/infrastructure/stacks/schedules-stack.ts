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
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface SchedulesStackProps extends StackProps {
  templatesTableName: string;
  queriesTableName: string;
  clinicHoursTableName: string;
  consolidatedTransferServerId: string;
  /** GlobalSecrets DynamoDB table name for retrieving SFTP credentials */
  globalSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
}

export class SchedulesStack extends Stack {
  public readonly schedulesTable: dynamodb.Table;
  public readonly schedulesFn: lambdaNode.NodejsFunction;
  public readonly schedulerWorkerFn: lambdaNode.NodejsFunction;
  public readonly schedulerQueueProducerFn: lambdaNode.NodejsFunction;
  public readonly schedulerQueueConsumerFn: lambdaNode.NodejsFunction;
  public readonly schedulerQueue: sqs.Queue;
  public readonly schedulerDLQ: sqs.Queue;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: SchedulesStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Schedules',
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

    this.schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${this.stackName}-Schedules`,
    });
    applyTags(this.schedulesTable, { Table: 'schedules' });

    // ========================================
    // SQS QUEUES
    // ========================================

    // Dead Letter Queue for failed schedule processing
    this.schedulerDLQ = new sqs.Queue(this, 'SchedulerDLQ', {
      queueName: 'todaysdentalinsights-scheduler-dlq-v3',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.schedulerDLQ, { Queue: 'scheduler-dlq' });

    // Main queue for schedule processing tasks (queries patients, enqueues emails)
    this.schedulerQueue = new sqs.Queue(this, 'SchedulerQueue', {
      queueName: 'todaysdentalinsights-scheduler-queue-v3',
      visibilityTimeout: Duration.minutes(10), // Reduced - now only queries patients, doesn't send emails
      receiveMessageWaitTime: Duration.seconds(20), // Long polling
      deadLetterQueue: {
        queue: this.schedulerDLQ,
        maxReceiveCount: 7, // Retry failed messages 7 times
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.schedulerQueue, { Queue: 'scheduler-main' });

    // Dead Letter Queue for failed individual email sends
    const emailDLQ = new sqs.Queue(this, 'EmailSenderDLQ', {
      queueName: 'todaysdentalinsights-email-sender-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(emailDLQ, { Queue: 'email-sender-dlq' });

    // Queue for individual email tasks (one message per email)
    const emailQueue = new sqs.Queue(this, 'EmailSenderQueue', {
      queueName: 'todaysdentalinsights-email-sender-queue',
      visibilityTimeout: Duration.seconds(60), // 1 min per email is plenty
      receiveMessageWaitTime: Duration.seconds(10),
      deadLetterQueue: {
        queue: emailDLQ,
        maxReceiveCount: 3, // Retry failed emails 3 times
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(emailQueue, { Queue: 'email-sender-main' });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'SchedulesApi', {
      restApiName: 'SchedulesApi',
      description: 'Schedules service API',
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
    this.authorizer = new apigw.RequestAuthorizer(this, 'SchedulesAuthorizer', {
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

    // Schedules Lambda
    this.schedulesFn = new lambdaNode.NodejsFunction(this, 'SchedulesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'schedules.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SCHEDULER: this.schedulesTable.tableName,
      },
    });
    applyTags(this.schedulesFn, { Function: 'schedules' });
    this.schedulesTable.grantReadWriteData(this.schedulesFn);

    // Scheduler worker Lambda (legacy - kept for compatibility)
    this.schedulerWorkerFn = new lambdaNode.NodejsFunction(this, 'SchedulerWorkerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(120),
      bundling: { 
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],  // Native .node binaries can't be bundled
        nodeModules: ['ssh2'],  // Include ssh2 in node_modules for Lambda
      },
      environment: {
        SCHEDULES_TABLE: this.schedulesTable.tableName,
        TEMPLATES_TABLE: props.templatesTableName,
        QUERIES_TABLE: props.queriesTableName,
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
        CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        // SFTP password now retrieved from GlobalSecrets table
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        // Email analytics configuration set (imported from notifications stack)
        SES_CONFIGURATION_SET_NAME: Fn.importValue('TodaysDentalInsightsNotificationsN1-SESConfigurationSetName'),
      },
    });
    applyTags(this.schedulerWorkerFn, { Function: 'scheduler-worker' });

    // Queue Producer Lambda - scans schedules and enqueues due tasks
    this.schedulerQueueProducerFn = new lambdaNode.NodejsFunction(this, 'SchedulerQueueProducerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'queueProducer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        SCHEDULES_TABLE: this.schedulesTable.tableName,
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
        SCHEDULER_QUEUE_URL: this.schedulerQueue.queueUrl,
      },
    });
    applyTags(this.schedulerQueueProducerFn, { Function: 'scheduler-producer' });

    // Queue Consumer Lambda - queries patients and enqueues individual email tasks
    // No longer sends emails directly - just enqueues them to the email queue
    this.schedulerQueueConsumerFn = new lambdaNode.NodejsFunction(this, 'SchedulerQueueConsumerFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'queueConsumer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.minutes(5), // Reduced - only queries patients and enqueues, doesn't send emails
      reservedConcurrentExecutions: 3, // Can increase since we're not hitting SES directly
      bundling: { 
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],  // Native .node binaries can't be bundled
        nodeModules: ['ssh2'],  // Include ssh2 in node_modules for Lambda
      },
      environment: {
        SCHEDULES_TABLE: this.schedulesTable.tableName,
        TEMPLATES_TABLE: props.templatesTableName,
        QUERIES_TABLE: props.queriesTableName,
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
        CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        // SFTP password now retrieved from GlobalSecrets table
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
        // Email queue for individual email tasks
        EMAIL_QUEUE_URL: emailQueue.queueUrl,
        // Email analytics table for tracking scheduled emails
        EMAIL_ANALYTICS_TABLE: Fn.importValue('TodaysDentalInsightsNotificationsN1-EmailAnalyticsTableName'),
      },
    });
    applyTags(this.schedulerQueueConsumerFn, { Function: 'scheduler-consumer' });

    // Email Sender Lambda - processes individual email tasks from the email queue
    // High concurrency to maximize throughput while staying under SES rate limits
    // 
    // AWS SES Compliance Features:
    // - Proper sender branding (clinic name, logo, address)
    // - Functional unsubscribe links via SES subscription management
    // - Disclaimer explaining why recipients receive email
    // - List-Unsubscribe headers for email clients
    const emailSenderFn = new lambdaNode.NodejsFunction(this, 'EmailSenderFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'emailSender.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256, // Small - only sends one email per invocation
      timeout: Duration.seconds(30), // Plenty for one email
      reservedConcurrentExecutions: 10, // 10 concurrent × ~10 emails/sec each = ~100/sec (SES limit)
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        // Email analytics configuration set (imported from notifications stack)
        SES_CONFIGURATION_SET_NAME: Fn.importValue('TodaysDentalInsightsNotificationsN1-SESConfigurationSetName'),
        // Email analytics table for updating status
        EMAIL_ANALYTICS_TABLE: Fn.importValue('TodaysDentalInsightsNotificationsN1-EmailAnalyticsTableName'),
        // Clinic config table for email branding
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
    });
    applyTags(emailSenderFn, { Function: 'email-sender' });

    // Grant email sender permissions
    emailSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    
    // Grant SES Contact List permissions for subscription management
    // This enables automatic unsubscribe handling via SES
    emailSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ses:GetContact',
        'ses:CreateContact',
        'ses:UpdateContact',
        'ses:ListContacts',
      ],
      resources: [
        `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:contact-list/PatientEmails`,
        `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:contact-list/PatientEmails/*`,
      ],
    }));
    
    emailSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [`arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/TodaysDentalInsightsNotificationsN1-EmailAnalytics`],
    }));
    
    // Grant read access to ClinicConfig table for email branding
    emailSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
      ],
    }));

    // Add SQS event source for email sender (batch of 10 for efficiency)
    emailSenderFn.addEventSource(new lambdaEventSources.SqsEventSource(emailQueue, {
      batchSize: 10, // Process 10 emails per Lambda invocation
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Grant queue consumer permission to send to email queue
    emailQueue.grantSendMessages(this.schedulerQueueConsumerFn);

    // Grant permissions to scheduler worker (legacy)
    this.schedulesTable.grantReadWriteData(this.schedulerWorkerFn);
    
    // Grant permissions to queue producer
    this.schedulesTable.grantReadData(this.schedulerQueueProducerFn);
    this.schedulerQueue.grantSendMessages(this.schedulerQueueProducerFn);
    
    // Grant permissions to queue consumer
    this.schedulesTable.grantReadWriteData(this.schedulerQueueConsumerFn);
    
    // Grant read access to external tables
    const templatesTable = dynamodb.Table.fromTableAttributes(this, 'TemplatesTable', {
      tableName: props.templatesTableName,
    });
    const queriesTable = dynamodb.Table.fromTableAttributes(this, 'QueriesTable', {
      tableName: props.queriesTableName,
    });
    const clinicHoursTable = dynamodb.Table.fromTableAttributes(this, 'SchedulesClinicHoursTable', {
      tableName: props.clinicHoursTableName,
    });
    
    // Legacy worker permissions
    templatesTable.grantReadData(this.schedulerWorkerFn);
    queriesTable.grantReadData(this.schedulerWorkerFn);
    clinicHoursTable.grantReadData(this.schedulerWorkerFn);
    
    // Queue producer permissions
    clinicHoursTable.grantReadData(this.schedulerQueueProducerFn);
    
    // Queue consumer permissions
    templatesTable.grantReadData(this.schedulerQueueConsumerFn);
    queriesTable.grantReadData(this.schedulerQueueConsumerFn);
    clinicHoursTable.grantReadData(this.schedulerQueueConsumerFn);
    
    // Grant email analytics table access for tracking scheduled/sent/failed emails
    // Using IAM policy directly since we import by name from cross-stack
    this.schedulerQueueConsumerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [`arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/TodaysDentalInsightsNotificationsN1-EmailAnalytics`],
    }));

    // Add SQS event source for queue consumer
    this.schedulerQueueConsumerFn.addEventSource(new lambdaEventSources.SqsEventSource(this.schedulerQueue, {
      batchSize: 1, // Process one schedule task at a time for better isolation
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true, // Enable partial batch failure handling
    }));

    // ========================================
    // SECRETS TABLES PERMISSIONS
    // ========================================
    // Grant read access to secrets tables for dynamic SFTP credential retrieval
    if (props.globalSecretsTableName) {
      const secretsReadPolicy = new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      });

      this.schedulesFn.addToRolePolicy(secretsReadPolicy);
      this.schedulerWorkerFn.addToRolePolicy(secretsReadPolicy);
      this.schedulerQueueProducerFn.addToRolePolicy(secretsReadPolicy);
      this.schedulerQueueConsumerFn.addToRolePolicy(secretsReadPolicy);
    }

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      const kmsDecryptPolicy = new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      });

      this.schedulesFn.addToRolePolicy(kmsDecryptPolicy);
      this.schedulerWorkerFn.addToRolePolicy(kmsDecryptPolicy);
      this.schedulerQueueProducerFn.addToRolePolicy(kmsDecryptPolicy);
      this.schedulerQueueConsumerFn.addToRolePolicy(kmsDecryptPolicy);
    }

    // Grant SES and SMS permissions to legacy worker (kept for compatibility)
    this.schedulerWorkerFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['ses:SendEmail', 'ses:SendRawEmail'], 
      resources: ['*'] 
    }));
    this.schedulerWorkerFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['sms-voice:SendTextMessage'], 
      resources: ['*'] 
    }));

    // Grant SES and SMS permissions to queue consumer
    this.schedulerQueueConsumerFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['ses:SendEmail', 'ses:SendRawEmail'], 
      resources: ['*'] 
    }));
    this.schedulerQueueConsumerFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['sms-voice:SendTextMessage'], 
      resources: ['*'] 
    }));

    // Schedule the queue producer to run every 2 minutes (more frequent since it's lighter)
    new events.Rule(this, 'SchedulerQueueProducerRule', {
      description: 'Runs the schedule queue producer to enqueue due schedule tasks',
      schedule: events.Schedule.rate(Duration.minutes(2)),
      targets: [new targets.LambdaFunction(this.schedulerQueueProducerFn)],
    });

    // Legacy worker rule (kept for fallback - can be disabled by commenting out)
    // new events.Rule(this, 'SchedulerWorkerRule', {
    //   description: 'Legacy schedule worker - disabled in favor of SQS-based processing',
    //   schedule: events.Schedule.rate(Duration.minutes(5)),
    //   targets: [new targets.LambdaFunction(this.schedulerWorkerFn)],
    // });

    // ========================================
    // API ROUTES
    // ========================================

    // Schedules API routes
    const schedulesRes = this.api.root.addResource('schedules');
    schedulesRes.addMethod('GET', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });
    schedulesRes.addMethod('POST', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const scheduleIdRes = schedulesRes.addResource('{id}');
    scheduleIdRes.addMethod('GET', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });
    scheduleIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    scheduleIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // Additional compatibility endpoints
    const createSchedulerRes = this.api.root.addResource('create-scheduler');
    createSchedulerRes.addMethod('POST', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const deleteSchedulesRes = this.api.root.addResource('delete-schedules');
    deleteSchedulesRes.addMethod('POST', new apigw.LambdaIntegration(this.schedulesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'SchedulesApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'schedules',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // CLOUDWATCH MONITORING
    // ========================================

    // Monitor main queue depth
    new cloudwatch.Alarm(this, 'SchedulerQueueDepthAlarm', {
      alarmName: 'SchedulerQueue-HighDepth',
      alarmDescription: 'Scheduler queue has too many messages',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: { QueueName: this.schedulerQueue.queueName },
        statistic: 'Average',
      }),
      threshold: 50,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Monitor DLQ for failed messages
    new cloudwatch.Alarm(this, 'SchedulerDLQAlarm', {
      alarmName: 'SchedulerDLQ-HasMessages',
      alarmDescription: 'Failed schedule processing messages in DLQ',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: { QueueName: this.schedulerDLQ.queueName },
        statistic: 'Average',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Function alarms (errors/throttles/duration)
    [
      { fn: this.schedulesFn, name: 'schedules', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
      { fn: this.schedulerWorkerFn, name: 'scheduler-worker', durationMs: Math.floor(Duration.seconds(120).toMilliseconds() * 0.8) },
      { fn: this.schedulerQueueProducerFn, name: 'scheduler-producer', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
      { fn: this.schedulerQueueConsumerFn, name: 'scheduler-consumer', durationMs: Math.floor(Duration.seconds(60).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    // DynamoDB throttle alarm
    createDynamoThrottleAlarm(this.schedulesTable.tableName, 'SchedulesTable');

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'SchedulesTableName', {
      value: this.schedulesTable.tableName,
      description: 'Name of the Schedules DynamoDB table',
      exportName: `${Stack.of(this).stackName}-SchedulesTableName`,
    });

    new CfnOutput(this, 'SchedulesApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/schedules/',
      description: 'Schedules API Gateway URL',
      exportName: `${Stack.of(this).stackName}-SchedulesApiUrl`,
    });

    new CfnOutput(this, 'SchedulesApiId', {
      value: this.api.restApiId,
      description: 'Schedules API Gateway ID',
      exportName: `${Stack.of(this).stackName}-SchedulesApiId`,
    });

    new CfnOutput(this, 'SchedulerQueueUrl', {
      value: this.schedulerQueue.queueUrl,
      description: 'Scheduler SQS Queue URL',
      exportName: `${Stack.of(this).stackName}-SchedulerQueueUrl`,
    });

    new CfnOutput(this, 'SchedulerDLQUrl', {
      value: this.schedulerDLQ.queueUrl,
      description: 'Scheduler Dead Letter Queue URL',
      exportName: `${Stack.of(this).stackName}-SchedulerDLQUrl`,
    });
  }
}
