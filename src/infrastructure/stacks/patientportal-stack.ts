import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodelambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as path from 'path';

// Extend props to include userPool for auth, matching the reference
export interface PatientPortalStackProps extends StackProps {
  userPool: cognito.IUserPool;
}

export class PatientPortalStack extends Stack {
  public readonly apptTypesTable: dynamodb.Table;
  public readonly apptTypesFn: nodelambda.NodejsFunction;
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: PatientPortalStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLE
    // ========================================
    this.apptTypesTable = new dynamodb.Table(this, 'ApptTypesTable', {
      partitionKey: { name: 'AppointmentTypeNum', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Changed to RETAIN for prod safety
      tableName: 'todaysdentalinsights-PatientPortal-ApptTypes',
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================
    this.api = new apigateway.RestApi(this, 'PatientPortalApi', {
      restApiName: 'PatientPortalApi',
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

    // Define standard CORS headers for 4xx/5xx responses
    // (Replaces the missing getCorsErrorHeaders() util from reference)
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
      entry: path.join(__dirname, '../src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X, // Upgraded to match reference
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: {
        format: nodelambda.OutputFormat.CJS,
        target: 'node22',
        // Force AWS SDK v3 to be bundled if not present in runtime yet,
        // or exclude if you prefer using the runtime version.
        // Reference didn't explicitly exclude, so we keep default bundling.
      },
      environment: {
        TABLE_NAME: this.apptTypesTable.tableName,
        PRIMARY_KEY: 'AppointmentTypeNum',
      },
    });

    this.apptTypesTable.grantReadWriteData(this.apptTypesFn);

    // ========================================
    // API ROUTES
    // ========================================
    // The requirement was /patient-portal/appttypes.
    // We will map the custom domain base path to 'patient-portal',
    // so here we only need to add 'appttypes' to the root.
    const apptTypesResource = this.api.root.addResource('appttypes');

    const integration = new apigateway.LambdaIntegration(this.apptTypesFn);

    // GET /appttypes (List all)
    apptTypesResource.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });
    // POST /appttypes (Create new)
    apptTypesResource.addMethod('POST', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });
    // PUT /appttypes (Update existing)
    apptTypesResource.addMethod('PUT', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // Single item operations: /appttypes/{id}
    const singleApptTypeResource = apptTypesResource.addResource('{id}');

    singleApptTypeResource.addMethod('DELETE', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    singleApptTypeResource.addMethod('GET', integration, {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================
    // Maps api.todaysdentalinsights.com/patient-portal -> This API
    // NOTE: This resource requires that the custom domain 'api.todaysdentalinsights.com'
    // already exists in API Gateway in your account.
    new apigateway.CfnBasePathMapping(this, 'PatientPortalApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'patient-portal',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'ApptTypesTableName', {
      value: this.apptTypesTable.tableName,
      description: 'Name of the Appointment Types DynamoDB table',
      exportName: `${Stack.of(this).stackName}-ApptTypesTableName`,
    });

    // The direct API URL (useful for testing before custom domain propagates)
    new CfnOutput(this, 'PatientPortalApiUrl', {
      value: this.api.url,
      description: 'Patient Portal API Gateway URL',
      exportName: `${Stack.of(this).stackName}-PatientPortalApiUrl`,
    });

    // The custom domain URL for this service
    new CfnOutput(this, 'PatientPortalCustomDomainUrl', {
      value: 'https://api.todaysdentalinsights.com/patient-portal/appttypes',
      description: 'Patient Portal Custom Domain URL',
      exportName: `${Stack.of(this).stackName}-PatientPortalCustomDomainUrl`,
    });

    new CfnOutput(this, 'PatientPortalApiId', {
      value: this.api.restApiId,
      description: 'Patient Portal API Gateway ID',
      exportName: `${Stack.of(this).stackName}-PatientPortalApiId`,
    });
  }
}