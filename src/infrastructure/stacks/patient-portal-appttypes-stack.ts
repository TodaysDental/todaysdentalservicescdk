import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodelambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as path from 'path';
// Assuming this stack is in src/infrastructure/stacks/, this path goes to src/shared/utils/cors
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

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
    // 1. DYNAMODB TABLE
    // ========================================
    this.apptTypesTable = new dynamodb.Table(this, 'ApptTypesTable', {
      // Composite Primary Key: clinicId (PK) + AppointmentTypeNum (SK)
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'AppointmentTypeNum', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: 'todaysdentalinsights-PatientPortal-ApptTypes',
    });

    // ========================================
    // 2. API GATEWAY SETUP (BASE)
    // ========================================
    
    // Load dynamic CORS configuration
    const corsConfig = getCdkCorsConfig();

    this.api = new apigateway.RestApi(this, 'PatientPortalApptTypesApi', {
      restApiName: 'PatientPortalApptTypesApi',
      description: 'API for OpenDental Patient Portal Appointment Types',
      defaultCorsPreflightOptions: {
        // Use allowed origins from clinics.json via util
        allowOrigins: corsConfig.allowOrigins,
        allowMethods: corsConfig.allowMethods,
        allowHeaders: corsConfig.allowHeaders,
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Load dynamic error response headers
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

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    // ========================================
    // 3. LAMBDA FUNCTION
    // ========================================
    this.apptTypesFn = new nodelambda.NodejsFunction(this, 'ApptTypesHandler', {
      // Path correction: Go up two levels from stacks/ to src/, then down to services/
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
        SORT_KEY: 'AppointmentTypeNum',
      },
    });

    this.apptTypesTable.grantReadWriteData(this.apptTypesFn);

    // ========================================
    // 4. API ROUTES & INTEGRATION
    // ========================================
    const integration = new apigateway.LambdaIntegration(this.apptTypesFn);

    // Root methods (POST/PUT to create, GET to list all for a clinic)
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

    // Single item methods (GET one, DELETE one)
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

    // ========================================
    // 5. DOMAIN MAPPING
    // ========================================
    new apigateway.CfnBasePathMapping(this, 'ApptTypesBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'patient-portal-appttypes',
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
      value: 'https://api.todaysdentalinsights.com/patient-portal-appttypes',
      description: 'Full URL for this service via custom domain',
      exportName: `${Stack.of(this).stackName}-ApptTypesApiUrl`,
    });
  }
}