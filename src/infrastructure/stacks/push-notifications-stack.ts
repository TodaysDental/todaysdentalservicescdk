/**
 * Push Notifications Stack
 * 
 * Provides mobile push notification infrastructure using direct Firebase Cloud Messaging (FCM).
 * Supports iOS (via APNs through Firebase) and Android (FCM) push notifications.
 * 
 * DIRECT FIREBASE INTEGRATION - No AWS SNS Platform Applications
 * 
 * CREDENTIALS SOURCE: GlobalSecrets DynamoDB Table
 * 
 * Required GlobalSecrets entries for FCM (Android & iOS):
 * - secretId: fcm, secretType: service_account (Firebase Service Account JSON)
 * 
 * For iOS support, configure APNs key in Firebase Console:
 * 1. Go to Firebase Console > Project Settings > Cloud Messaging
 * 2. Upload your APNs authentication key (.p8 file)
 * 3. Firebase will route iOS notifications to APNs automatically
 */

import { Duration, Stack, StackProps, CfnOutput, Fn, Tags, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PushNotificationsStackProps extends StackProps {
  /**
   * Name of the GlobalSecrets DynamoDB table
   * Required for reading FCM credentials at runtime
   */
  globalSecretsTableName: string;

  /**
   * ARN of the GlobalSecrets DynamoDB table
   * Required for IAM permissions
   */
  globalSecretsTableArn?: string;

  /**
   * ARN of the KMS key used to encrypt GlobalSecrets
   * Required if the table is encrypted
   */
  secretsEncryptionKeyArn?: string;
}

export class PushNotificationsStack extends Stack {
  public readonly deviceTokensTable: dynamodb.Table;
  public readonly pushApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly registerDeviceFn: lambdaNode.NodejsFunction;
  public readonly unregisterDeviceFn: lambdaNode.NodejsFunction;
  public readonly sendPushFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: PushNotificationsStackProps) {
    super(scope, id, props);

    const {
      globalSecretsTableName,
      globalSecretsTableArn,
      secretsEncryptionKeyArn,
    } = props;

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'PushNotifications',
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

    // ========================================
    // DYNAMODB TABLE - Device Tokens
    // ========================================

    this.deviceTokensTable = new dynamodb.Table(this, 'DeviceTokensTable', {
      tableName: `${id}-DeviceTokens`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI for querying by clinicId
    this.deviceTokensTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for O(1) token lookups (replaces expensive full table scans)
    // Used for token collision detection and device handoff scenarios
    this.deviceTokensTable.addGlobalSecondaryIndex({
      indexName: 'deviceToken-index',
      partitionKey: { name: 'deviceToken', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    applyTags(this.deviceTokensTable, { Table: 'device-tokens' });

    // ========================================
    // IMPORT AUTHORIZER FROM CORE STACK
    // ========================================

    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    this.authorizer = new apigw.RequestAuthorizer(this, 'PushNotificationsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // ========================================
    // GLOBALSECRECTS TABLE REFERENCE
    // ========================================

    const globalSecretsTable = globalSecretsTableArn
      ? dynamodb.Table.fromTableArn(this, 'GlobalSecretsRef', globalSecretsTableArn)
      : dynamodb.Table.fromTableName(this, 'GlobalSecretsRef', globalSecretsTableName);

    // ========================================
    // IMPORT STAFF USER TABLE (SOURCE OF TRUTH FOR CLINIC ACCESS)
    // ========================================

    const staffUserTableName = Fn.importValue('CoreStack-StaffUserTableName');
    const staffUserTable = dynamodb.Table.fromTableName(this, 'StaffUserTableRef', staffUserTableName);

    // ========================================
    // DEAD-LETTER QUEUE FOR ASYNC FAILURES
    // ========================================

    // DLQ to capture failed async push notification invocations
    // This enables monitoring and potential retry of failed messages
    const sendPushDlq = new sqs.Queue(this, 'SendPushDLQ', {
      queueName: `${id}-SendPush-DLQ`,
      retentionPeriod: Duration.days(14), // Retain failed messages for 14 days
      visibilityTimeout: Duration.seconds(300), // 5 minutes for processing
    });
    applyTags(sendPushDlq, { Queue: 'send-push-dlq' });

    // CloudWatch alarm for DLQ messages (alert on any failures)
    new cloudwatch.Alarm(this, 'SendPushDLQAlarm', {
      metric: sendPushDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when push notification failures are in DLQ',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        DEVICE_TOKENS_TABLE: this.deviceTokensTable.tableName,
        GLOBAL_SECRETS_TABLE: globalSecretsTableName,
      },
    };

    // Register Device Lambda
    this.registerDeviceFn = new lambdaNode.NodejsFunction(this, 'RegisterDeviceFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '..', '..', 'services', 'push-notifications', 'register-device.ts'),
      handler: 'handler',
    });
    applyTags(this.registerDeviceFn, { Function: 'register-device' });

    // Unregister Device Lambda
    this.unregisterDeviceFn = new lambdaNode.NodejsFunction(this, 'UnregisterDeviceFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '..', '..', 'services', 'push-notifications', 'unregister-device.ts'),
      handler: 'handler',
    });
    applyTags(this.unregisterDeviceFn, { Function: 'unregister-device' });

    // Send Push Lambda with DLQ for async failure tracking
    this.sendPushFn = new lambdaNode.NodejsFunction(this, 'SendPushFn', {
      ...commonLambdaProps,
      timeout: Duration.seconds(60), // Longer timeout for batch sending
      entry: path.join(__dirname, '..', '..', 'services', 'push-notifications', 'send-push.ts'),
      handler: 'handler',
      environment: {
        ...commonLambdaProps.environment,
        STAFF_USER_TABLE: staffUserTableName,
      },
      // Configure async invocation error handling
      // Failed async invocations will be sent to the DLQ after 2 retries
      retryAttempts: 2,
      onFailure: new lambdaDestinations.SqsDestination(sendPushDlq),
    });
    applyTags(this.sendPushFn, { Function: 'send-push' });

    // ========================================
    // IAM PERMISSIONS
    // ========================================

    // DynamoDB permissions for device tokens
    this.deviceTokensTable.grantReadWriteData(this.registerDeviceFn);
    this.deviceTokensTable.grantReadWriteData(this.unregisterDeviceFn);
    this.deviceTokensTable.grantReadData(this.sendPushFn);

    // GlobalSecrets table permissions (for FCM credential access)
    globalSecretsTable.grantReadData(this.sendPushFn);

    // StaffUser table permissions (for dynamic clinic targeting based on current access)
    staffUserTable.grantReadData(this.sendPushFn);

    // Grant KMS decrypt for all lambdas if encryption key is provided
    if (secretsEncryptionKeyArn) {
      const secretsKey = kms.Key.fromKeyArn(this, 'SecretsKeyRef', secretsEncryptionKeyArn);
      secretsKey.grantDecrypt(this.registerDeviceFn);
      secretsKey.grantDecrypt(this.unregisterDeviceFn);
      secretsKey.grantDecrypt(this.sendPushFn);
    }

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.pushApi = new apigw.RestApi(this, 'PushNotificationsApi', {
      restApiName: 'Push Notifications API',
      description: 'API for mobile push notification management (Direct Firebase)',
      defaultCorsPreflightOptions: corsConfig,
      defaultMethodOptions: {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.authorizer,
      },
    });

    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.pushApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.pushApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.pushApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.pushApi,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Grant API Gateway permission to invoke authorizer
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.pushApi.restApiId}/authorizers/*`,
    });

    // ========================================
    // API ROUTES
    // ========================================
    // Note: Base path mapping uses 'push', so API routes start from root.
    // External URL: https://apig.todaysdentalinsights.com/push/register
    // maps to API Gateway path: /register (base path 'push' is stripped)

    // POST /register - Register device token
    const registerResource = this.pushApi.root.addResource('register');
    registerResource.addMethod('POST', new apigw.LambdaIntegration(this.registerDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /unregister - Unregister device by token (in body)
    const unregisterResource = this.pushApi.root.addResource('unregister');
    unregisterResource.addMethod('POST', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // GET /devices - Get user's registered devices
    // DELETE /devices - Unregister device by token (in body)
    const devicesResource = this.pushApi.root.addResource('devices');
    devicesResource.addMethod('GET', new apigw.LambdaIntegration(this.registerDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    devicesResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // DELETE /devices/{deviceId} - Unregister specific device
    const deviceIdResource = devicesResource.addResource('{deviceId}');
    deviceIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // DELETE /devices/all - Unregister all user devices
    const devicesAllResource = devicesResource.addResource('all');
    devicesAllResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /send - Send push notification (admin/internal)
    const sendResource = this.pushApi.root.addResource('send');
    sendResource.addMethod('POST', new apigw.LambdaIntegration(this.sendPushFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /clinic/{clinicId}/send - Send push to clinic
    const clinicResource = this.pushApi.root.addResource('clinic');
    const clinicIdResource = clinicResource.addResource('{clinicId}');
    const clinicSendResource = clinicIdResource.addResource('send');
    clinicSendResource.addMethod('POST', new apigw.LambdaIntegration(this.sendPushFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /heartbeat - Heartbeat to extend TTL
    const heartbeatResource = this.pushApi.root.addResource('heartbeat');
    heartbeatResource.addMethod('POST', new apigw.LambdaIntegration(this.registerDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'PushApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'push',
      restApiId: this.pushApi.restApiId,
      stage: this.pushApi.deploymentStage.stageName,
    });

    // ========================================
    // CLOUDWATCH ALARMS
    // ========================================

    [
      { fn: this.registerDeviceFn, name: 'register-device' },
      { fn: this.unregisterDeviceFn, name: 'unregister-device' },
      { fn: this.sendPushFn, name: 'send-push' },
    ].forEach(({ fn, name }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'PushApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/push/',
      description: 'Push Notifications API URL',
      exportName: `${Stack.of(this).stackName}-PushApiUrl`,
    });

    new CfnOutput(this, 'PushApiId', {
      value: this.pushApi.restApiId,
      description: 'Push Notifications API Gateway ID',
      exportName: `${Stack.of(this).stackName}-PushApiId`,
    });

    new CfnOutput(this, 'DeviceTokensTableName', {
      value: this.deviceTokensTable.tableName,
      description: 'Device Tokens DynamoDB Table Name',
      exportName: `${Stack.of(this).stackName}-DeviceTokensTableName`,
    });

    // Export table ARN for cross-stack IAM permissions
    new CfnOutput(this, 'DeviceTokensTableArn', {
      value: this.deviceTokensTable.tableArn,
      description: 'Device Tokens DynamoDB Table ARN',
      exportName: `${Stack.of(this).stackName}-DeviceTokensTableArn`,
    });

    // Export send-push Lambda function ARN for cross-stack invocation
    // Other stacks (Comm, Chime, HR) can invoke this Lambda directly
    new CfnOutput(this, 'SendPushFunctionArn', {
      value: this.sendPushFn.functionArn,
      description: 'Send Push Lambda Function ARN for cross-stack invocation',
      exportName: `${Stack.of(this).stackName}-SendPushFunctionArn`,
    });

    new CfnOutput(this, 'SendPushFunctionName', {
      value: this.sendPushFn.functionName,
      description: 'Send Push Lambda Function Name',
      exportName: `${Stack.of(this).stackName}-SendPushFunctionName`,
    });

    // Export DLQ information for monitoring and processing
    new CfnOutput(this, 'SendPushDLQArn', {
      value: sendPushDlq.queueArn,
      description: 'Dead-Letter Queue ARN for failed push notifications',
      exportName: `${Stack.of(this).stackName}-SendPushDLQArn`,
    });

    new CfnOutput(this, 'SendPushDLQUrl', {
      value: sendPushDlq.queueUrl,
      description: 'Dead-Letter Queue URL for failed push notifications',
      exportName: `${Stack.of(this).stackName}-SendPushDLQUrl`,
    });

    // Note: SNS Platform ARN outputs removed - using direct Firebase integration
    new CfnOutput(this, 'DeliveryMethod', {
      value: 'DIRECT_FIREBASE_FCM_V1',
      description: 'Push notification delivery method',
    });
  }
}
