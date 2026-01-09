/**
 * Push Notifications Stack
 * 
 * Provides mobile push notification infrastructure using AWS SNS Platform Applications.
 * Supports iOS (APNs) and Android (FCM) push notifications.
 * 
 * Prerequisites:
 * - Store APNs credentials in AWS Secrets Manager (see SECRETS-SETUP.md)
 * - Store FCM credentials in AWS Secrets Manager (see SECRETS-SETUP.md)
 */

import { Duration, Stack, StackProps, CfnOutput, Fn, Tags, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import { CfnResource } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PushNotificationsStackProps extends StackProps {
  /**
   * Optional: Name of the Secrets Manager secret containing APNs credentials.
   * Expected secret structure:
   * {
   *   "signingKey": "-----BEGIN PRIVATE KEY-----\n...",
   *   "keyId": "ABC123DEFG",
   *   "teamId": "TEAM123456",
   *   "bundleId": "com.yourcompany.app"
   * }
   */
  apnsSecretName?: string;

  /**
   * Optional: Name of the Secrets Manager secret containing FCM credentials.
   * Expected secret structure:
   * {
   *   "serverKey": "AAAA..."
   * }
   */
  fcmSecretName?: string;

  /**
   * Enable APNs sandbox environment for development.
   * Default: true (creates both sandbox and production)
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
  // Platform application types use 'any' for CDK version compatibility
  // CfnPlatformApplication may not be exported in all CDK versions
  public readonly fcmPlatformApp?: any;
  public readonly apnsPlatformApp?: any;
  public readonly apnsSandboxPlatformApp?: any;

  constructor(scope: Construct, id: string, props: PushNotificationsStackProps = {}) {
    super(scope, id, props);

    const { apnsSecretName, fcmSecretName, enableApnsSandbox = true } = props;

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
    // SNS PLATFORM APPLICATIONS
    // ========================================

    // Environment variables for Lambda functions
    const platformArnEnvVars: Record<string, string> = {};

    // FCM Platform Application (Android)
    if (fcmSecretName) {
      const fcmSecret = secretsmanager.Secret.fromSecretNameV2(this, 'FCMSecret', fcmSecretName);
      
      this.fcmPlatformApp = new CfnResource(this, 'FCMPlatformApp', {
        type: 'AWS::SNS::PlatformApplication',
        properties: {
          Name: `${id}-FCM`,
          Platform: 'GCM',
          Attributes: {
            PlatformCredential: fcmSecret.secretValueFromJson('serverKey').unsafeUnwrap(),
          },
        },
      });
      applyTags(this.fcmPlatformApp as unknown as Construct, { Platform: 'fcm' });
      platformArnEnvVars.FCM_PLATFORM_ARN = this.fcmPlatformApp.ref;
    }

    // APNs Platform Application (iOS Production)
    if (apnsSecretName) {
      const apnsSecret = secretsmanager.Secret.fromSecretNameV2(this, 'APNSSecret', apnsSecretName);
      
      // Production APNs
      this.apnsPlatformApp = new CfnResource(this, 'APNSPlatformApp', {
        type: 'AWS::SNS::PlatformApplication',
        properties: {
          Name: `${id}-APNS`,
          Platform: 'APNS',
          Attributes: {
            PlatformCredential: apnsSecret.secretValueFromJson('signingKey').unsafeUnwrap(),
            PlatformPrincipal: apnsSecret.secretValueFromJson('keyId').unsafeUnwrap(),
            TeamId: apnsSecret.secretValueFromJson('teamId').unsafeUnwrap(),
            BundleId: apnsSecret.secretValueFromJson('bundleId').unsafeUnwrap(),
          },
        },
      });
      applyTags(this.apnsPlatformApp as unknown as Construct, { Platform: 'apns' });
      platformArnEnvVars.APNS_PLATFORM_ARN = this.apnsPlatformApp.ref;

      // Sandbox APNs (for development)
      if (enableApnsSandbox) {
        this.apnsSandboxPlatformApp = new CfnResource(this, 'APNSSandboxPlatformApp', {
          type: 'AWS::SNS::PlatformApplication',
          properties: {
            Name: `${id}-APNS-Sandbox`,
            Platform: 'APNS_SANDBOX',
            Attributes: {
              PlatformCredential: apnsSecret.secretValueFromJson('signingKey').unsafeUnwrap(),
              PlatformPrincipal: apnsSecret.secretValueFromJson('keyId').unsafeUnwrap(),
              TeamId: apnsSecret.secretValueFromJson('teamId').unsafeUnwrap(),
              BundleId: apnsSecret.secretValueFromJson('bundleId').unsafeUnwrap(),
            },
          },
        });
        applyTags(this.apnsSandboxPlatformApp as unknown as Construct, { Platform: 'apns-sandbox' });
        platformArnEnvVars.APNS_SANDBOX_PLATFORM_ARN = this.apnsSandboxPlatformApp.ref;
      }
    }

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
        ...platformArnEnvVars,
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

    // ========================================
    // IAM PERMISSIONS
    // ========================================

    // DynamoDB permissions
    this.deviceTokensTable.grantReadWriteData(this.registerDeviceFn);
    this.deviceTokensTable.grantReadWriteData(this.unregisterDeviceFn);
    this.deviceTokensTable.grantReadData(this.sendPushFn);

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

    if (this.fcmPlatformApp) {
      new CfnOutput(this, 'FCMPlatformAppArn', {
        value: this.fcmPlatformApp.ref,
        description: 'FCM Platform Application ARN',
        exportName: `${Stack.of(this).stackName}-FCMPlatformAppArn`,
      });
    }

    if (this.apnsPlatformApp) {
      new CfnOutput(this, 'APNSPlatformAppArn', {
        value: this.apnsPlatformApp.ref,
        description: 'APNs Platform Application ARN',
        exportName: `${Stack.of(this).stackName}-APNSPlatformAppArn`,
      });
    }

    if (this.apnsSandboxPlatformApp) {
      new CfnOutput(this, 'APNSSandboxPlatformAppArn', {
        value: this.apnsSandboxPlatformApp.ref,
        description: 'APNs Sandbox Platform Application ARN',
        exportName: `${Stack.of(this).stackName}-APNSSandboxPlatformAppArn`,
      });
    }
  }
}

