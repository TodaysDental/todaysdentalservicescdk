import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface NotificationsStackProps extends StackProps {
  authorizer: apigw.RequestAuthorizer;
  templatesTableName: string;
}

export class NotificationsStack extends Stack {
  public readonly notifyFn: lambdaNode.NodejsFunction;
  public readonly notificationsApi: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly notificationsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: NotificationsStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE SETUP
    // ========================================

    this.notificationsTable = new dynamodb.Table(this, 'NotificationsTable', {
      partitionKey: { name: 'PatNum', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'notificationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `${id}-Notifications`,
    });

    // Use the custom Lambda authorizer
    this.authorizer = props.authorizer;
      resultsCacheTtl: Duration.seconds(0), // Don't cache auth results
      identitySource: 'method.request.header.Authorization'
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();    this.notificationsApi = new apigw.RestApi(this, 'NotificationsApi', {
      restApiName: 'Notifications API',
      description: 'API for managing notifications',
      defaultCorsPreflightOptions: corsConfig,
      defaultMethodOptions: {
        authorizationType: apigw.AuthorizationType.COGNITO,
        authorizer: this.authorizer
      }
    });

    const corsErrorHeaders = getCorsErrorHeaders();
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });
    
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.notificationsApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });


    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    this.notifyFn = new lambdaNode.NodejsFunction(this, 'ClinicNotifyFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'communication', 'notify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TEMPLATES_TABLE: props.templatesTableName,
        NOTIFICATIONS_TABLE: this.notificationsTable.tableName,
      },
    });

    // Grant SES and SMS permissions
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['ses:SendEmail', 'ses:SendRawEmail'], 
      resources: ['*'] 
    }));
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({ 
      actions: ['sms-voice:SendTextMessage'], 
      resources: ['*'] 
    }));

    // Grant read access to templates table
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.templatesTableName}`],
    }));

    // Grant read/write access to notifications table
    this.notifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [this.notificationsTable.tableArn],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    // Notifications API: GET /notifications
    const notificationsResource = this.notificationsApi.root.addResource('notifications');

    notificationsResource.addMethod('GET', new apigw.LambdaIntegration(this.notifyFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestParameters: {
        'method.request.querystring.PatNum': true,
        'method.request.querystring.email': false
      },
      methodResponses: [
        { 
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '403' }
      ],
    });

    // Notifications API: POST /clinic/{clinicId}/notification
    const clinicBase = this.notificationsApi.root.addResource('clinic');
    const clinicRes = clinicBase.addResource('{clinicId}');
    const clinicNotify = clinicRes.addResource('notification');

    clinicNotify.addMethod('POST', new apigw.LambdaIntegration(this.notifyFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      requestValidatorOptions: {
        validateRequestBody: true,
        validateRequestParameters: true
      },
      methodResponses: [
        { 
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        },
        { statusCode: '400' },
        { statusCode: '403' }
      ],
      requestModels: {
        'application/json': new apigw.Model(this, 'NotificationRequestModel', {
          restApi: this.notificationsApi,
          contentType: 'application/json',
          modelName: 'NotificationRequest',
          schema: {
            type: apigw.JsonSchemaType.OBJECT,
            required: ['PatNum', 'notificationTypes', 'templateMessage'],
            properties: {
              PatNum: { type: apigw.JsonSchemaType.STRING },
              FName: { type: apigw.JsonSchemaType.STRING },
              LName: { type: apigw.JsonSchemaType.STRING },
              Email: { 
                type: apigw.JsonSchemaType.STRING,
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
              },
              phone: { 
                type: apigw.JsonSchemaType.STRING,
                pattern: '^\\+?[1-9]\\d{9,14}$'
              },
              notificationTypes: { 
                type: apigw.JsonSchemaType.ARRAY,
                items: { 
                  type: apigw.JsonSchemaType.STRING,
                  enum: ['EMAIL', 'SMS']
                },
                minItems: 1
              },
              templateMessage: { type: apigw.JsonSchemaType.STRING },
              toEmail: { type: apigw.JsonSchemaType.STRING }
            }
          }
        })
      }
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'NotificationsApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'notifications',
      restApiId: this.notificationsApi.restApiId,
      stage: this.notificationsApi.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'NotificationsApiUrl', {
      value: 'https://api.todaysdentalinsights.com/notifications/',
      description: 'Notifications API Gateway URL',
      exportName: `${Stack.of(this).stackName}-NotificationsApiUrl`,
    });

    new CfnOutput(this, 'NotificationsApiId', {
      value: this.notificationsApi.restApiId,
      description: 'Notifications API Gateway ID',
      exportName: `${Stack.of(this).stackName}-NotificationsApiId`,
    });
  }
}
