/**
 * Push Notifications Stack
 * 
 * Provides mobile push notification infrastructure using AWS SNS Platform Applications.
 * Supports iOS (APNs) and Android (FCM) push notifications.
 * 
 * CREDENTIALS SOURCE: GlobalSecrets DynamoDB Table
 * 
 * Required GlobalSecrets entries for FCM (Android):
 * - secretId: fcm, secretType: server_key (Legacy FCM Server Key)
 * 
 * Required GlobalSecrets entries for APNs (iOS):
 * - secretId: apns, secretType: signing_key (.p8 private key content)
 * - secretId: apns, secretType: key_id
 * - secretId: apns, secretType: team_id
 * - secretId: apns, secretType: bundle_id
 */

import { Duration, Stack, StackProps, CfnOutput, Fn, Tags, RemovalPolicy, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cr from 'aws-cdk-lib/custom-resources';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PushNotificationsStackProps extends StackProps {
  /**
   * Name of the GlobalSecrets DynamoDB table
   * Required for reading FCM/APNs credentials
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

  /**
   * Enable APNs sandbox environment for development.
   * Default: true (creates both sandbox and production if credentials exist)
   */
  enableApnsSandbox?: boolean;
}

export class PushNotificationsStack extends Stack {
  public readonly deviceTokensTable: dynamodb.Table;
  public readonly pushApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly registerDeviceFn: lambdaNode.NodejsFunction;
  public readonly unregisterDeviceFn: lambdaNode.NodejsFunction;
  public readonly sendPushFn: lambdaNode.NodejsFunction;
  public readonly platformSetupFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: PushNotificationsStackProps) {
    super(scope, id, props);

    const {
      globalSecretsTableName,
      globalSecretsTableArn,
      secretsEncryptionKeyArn,
      enableApnsSandbox = true,
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

    // GSI for querying by endpointArn (for cleanup when endpoints are invalidated)
    this.deviceTokensTable.addGlobalSecondaryIndex({
      indexName: 'endpointArn-index',
      partitionKey: { name: 'endpointArn', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    applyTags(this.deviceTokensTable, { Table: 'device-tokens' });

    // ========================================
    // CUSTOM RESOURCE - Platform Setup Lambda
    // ========================================
    // This Lambda reads credentials from GlobalSecrets and creates SNS Platform Apps

    this.platformSetupFn = new lambdaNode.NodejsFunction(this, 'PlatformSetupFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(2), // Platform creation can take time
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      entry: path.join(__dirname, '..', '..', 'services', 'push-notifications', 'platform-setup.ts'),
      handler: 'handler',
      environment: {
        GLOBAL_SECRETS_TABLE: globalSecretsTableName,
        STACK_NAME: id,
        ENABLE_APNS_SANDBOX: enableApnsSandbox ? 'true' : 'false',
      },
    });
    applyTags(this.platformSetupFn, { Function: 'platform-setup' });

    // Grant permissions to read from GlobalSecrets
    // Note: fromTableAttributes requires either tableArn OR tableName, not both
    const globalSecretsTable = globalSecretsTableArn
      ? dynamodb.Table.fromTableArn(this, 'GlobalSecretsRef', globalSecretsTableArn)
      : dynamodb.Table.fromTableName(this, 'GlobalSecretsRef', globalSecretsTableName);
    globalSecretsTable.grantReadData(this.platformSetupFn);

    // Grant KMS decrypt if encryption key is provided
    if (secretsEncryptionKeyArn) {
      const secretsKey = kms.Key.fromKeyArn(this, 'SecretsKeyRef', secretsEncryptionKeyArn);
      secretsKey.grantDecrypt(this.platformSetupFn);
    }

    // Grant SNS permissions to create/manage platform applications
    this.platformSetupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:CreatePlatformApplication',
        'sns:SetPlatformApplicationAttributes',
        'sns:DeletePlatformApplication',
        'sns:ListPlatformApplications',
      ],
      resources: ['*'],
    }));

    // Create the Custom Resource
    const platformSetupProvider = new cr.Provider(this, 'PlatformSetupProvider', {
      onEventHandler: this.platformSetupFn,
    });

    const platformSetup = new CustomResource(this, 'PlatformSetupResource', {
      serviceToken: platformSetupProvider.serviceToken,
      properties: {
        // Include these to trigger update when secrets change
        // Force recreation after adding FCM token credentials support (2026-02-02)
        Version: '2026-02-02-fcm-json-stringify-fix',
      },
    });

    // Get platform ARNs from Custom Resource output
    const fcmPlatformArn = platformSetup.getAttString('FcmPlatformArn');
    const apnsPlatformArn = platformSetup.getAttString('ApnsPlatformArn');
    const apnsSandboxPlatformArn = platformSetup.getAttString('ApnsSandboxPlatformArn');

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
    // LAMBDA FUNCTIONS
    // ========================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        DEVICE_TOKENS_TABLE: this.deviceTokensTable.tableName,
        GLOBAL_SECRETS_TABLE: globalSecretsTableName,
        // Platform ARNs from Custom Resource (may be empty if credentials not configured)
        FCM_PLATFORM_ARN: fcmPlatformArn || '',
        APNS_PLATFORM_ARN: apnsPlatformArn || '',
        APNS_SANDBOX_PLATFORM_ARN: apnsSandboxPlatformArn || '',
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

    // Send Push Lambda
    this.sendPushFn = new lambdaNode.NodejsFunction(this, 'SendPushFn', {
      ...commonLambdaProps,
      entry: path.join(__dirname, '..', '..', 'services', 'push-notifications', 'send-push.ts'),
      handler: 'handler',
    });
    applyTags(this.sendPushFn, { Function: 'send-push' });

    // Ensure Lambda functions wait for platform setup
    this.registerDeviceFn.node.addDependency(platformSetup);
    this.unregisterDeviceFn.node.addDependency(platformSetup);
    this.sendPushFn.node.addDependency(platformSetup);

    // ========================================
    // IAM PERMISSIONS
    // ========================================

    // DynamoDB permissions
    this.deviceTokensTable.grantReadWriteData(this.registerDeviceFn);
    this.deviceTokensTable.grantReadWriteData(this.unregisterDeviceFn);
    this.deviceTokensTable.grantReadData(this.sendPushFn);

    // GlobalSecrets table permissions (for runtime credential access if needed)
    globalSecretsTable.grantReadData(this.registerDeviceFn);
    globalSecretsTable.grantReadData(this.sendPushFn);

    // Grant KMS decrypt for all lambdas if encryption key is provided
    if (secretsEncryptionKeyArn) {
      const secretsKey = kms.Key.fromKeyArn(this, 'SecretsKeyRef2', secretsEncryptionKeyArn);
      secretsKey.grantDecrypt(this.registerDeviceFn);
      secretsKey.grantDecrypt(this.unregisterDeviceFn);
      secretsKey.grantDecrypt(this.sendPushFn);
    }

    // SNS permissions for creating/managing endpoints
    const snsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:CreatePlatformEndpoint',
        'sns:GetEndpointAttributes',
        'sns:SetEndpointAttributes',
        'sns:DeleteEndpoint',
        'sns:Publish',
      ],
      resources: ['*'], // Platform application ARNs are dynamic
    });

    this.registerDeviceFn.addToRolePolicy(snsPolicy);
    this.unregisterDeviceFn.addToRolePolicy(snsPolicy);
    this.sendPushFn.addToRolePolicy(snsPolicy);

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.pushApi = new apigw.RestApi(this, 'PushNotificationsApi', {
      restApiName: 'Push Notifications API',
      description: 'API for mobile push notification management',
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

    const pushResource = this.pushApi.root.addResource('push');

    // POST /push/register - Register device token
    const registerResource = pushResource.addResource('register');
    registerResource.addMethod('POST', new apigw.LambdaIntegration(this.registerDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /push/unregister - Unregister device by token (in body)
    const unregisterResource = pushResource.addResource('unregister');
    unregisterResource.addMethod('POST', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // GET /push/devices - Get user's registered devices
    // DELETE /push/devices - Unregister device by token (in body)
    const devicesResource = pushResource.addResource('devices');
    devicesResource.addMethod('GET', new apigw.LambdaIntegration(this.registerDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    devicesResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // DELETE /push/devices/{deviceId} - Unregister specific device
    const deviceIdResource = devicesResource.addResource('{deviceId}');
    deviceIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // DELETE /push/devices/all - Unregister all user devices
    const devicesAllResource = devicesResource.addResource('all');
    devicesAllResource.addMethod('DELETE', new apigw.LambdaIntegration(this.unregisterDeviceFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /push/send - Send push notification (admin/internal)
    const sendResource = pushResource.addResource('send');
    sendResource.addMethod('POST', new apigw.LambdaIntegration(this.sendPushFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // POST /push/clinic/{clinicId}/send - Send push to clinic
    const clinicResource = pushResource.addResource('clinic');
    const clinicIdResource = clinicResource.addResource('{clinicId}');
    const clinicSendResource = clinicIdResource.addResource('send');
    clinicSendResource.addMethod('POST', new apigw.LambdaIntegration(this.sendPushFn), {
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
    // Other stacks (Comm, Chime) can invoke this Lambda directly
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

    // Output platform ARNs (may be empty if credentials not configured)
    new CfnOutput(this, 'FCMPlatformArn', {
      value: fcmPlatformArn || 'NOT_CONFIGURED',
      description: 'FCM Platform Application ARN (from GlobalSecrets)',
    });

    new CfnOutput(this, 'APNSPlatformArn', {
      value: apnsPlatformArn || 'NOT_CONFIGURED',
      description: 'APNs Platform Application ARN (from GlobalSecrets)',
    });

    new CfnOutput(this, 'APNSSandboxPlatformArn', {
      value: apnsSandboxPlatformArn || 'NOT_CONFIGURED',
      description: 'APNs Sandbox Platform Application ARN (from GlobalSecrets)',
    });
  }
}
