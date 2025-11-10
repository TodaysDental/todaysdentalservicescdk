import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodelambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PatientPortalApptTypesStackProps extends StackProps {
  userPool: cognito.IUserPool;
}

export class PatientPortalApptTypesStack extends Stack {
  public readonly apptTypesTable: dynamodb.Table;
  public readonly apptTypesFn: nodelambda.NodejsFunction;
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: PatientPortalApptTypesStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================
    this.apptTypesTable = new dynamodb.Table(this, 'ApptTypesTable', {
      // UPDATED: Composite Primary Key
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'AppointmentTypeNum', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'todaysdentalinsights-PatientPortal-ApptTypes',
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================
    this.api = new apigateway.RestApi(this, 'PatientPortalApptTypesApi', {
      restApiName: 'PatientPortalApptTypesApi',
      description: 'API for OpenDental Patient Portal Appointment Types',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const corsErrorHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
    };

    new apigateway.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigateway.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigateway.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api,
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    // ========================================
    // LAMBDA FUNCTION
    // ========================================
    this.apptTypesFn = new nodelambda.NodejsFunction(this, 'ApptTypesHandler', {
      entry: path.join(__dirname, '../../src/services/patient-portal/appttypes.ts'),
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
        // UPDATED: New key definitions
        PARTITION_KEY: 'clinicId',
        SORT_KEY: 'AppointmentTypeNum',
      },
    });

    this.apptTypesTable.grantReadWriteData(this.apptTypesFn);

    // ========================================
    // API ROUTES
    // ========================================
    const integration = new apigateway.LambdaIntegration(this.apptTypesFn);

    this.api.root.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    this.api.root.addMethod('POST', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    this.api.root.addMethod('PUT', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    const singleItem = this.api.root.addResource('{id}');
    singleItem.addMethod('DELETE', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });
    singleItem.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    new apigateway.CfnBasePathMapping(this, 'ApptTypesBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'patient-portal-appttypes',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'ApptTypesTableName', {
      value: this.apptTypesTable.tableName,
      exportName: `${Stack.of(this).stackName}-ApptTypesTableName`,
    });
    new CfnOutput(this, 'ApptTypesApiUrl', {
      value: 'https://api.todaysdentalinsights.com/patient-portal-appttypes',
      exportName: `${Stack.of(this).stackName}-ApptTypesApiUrl`,
    });
  }
}