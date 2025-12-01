import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sns from 'aws-cdk-lib/aws-sns';
import clinicsJson from '../configs/clinics.json';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PatientPortalStackProps extends StackProps {
  // No authorizer needed - public endpoints only
  // Transfer Family server info for SFTP document downloads
  consolidatedTransferServerId: string;
  consolidatedTransferServerBucket: string;
}

export class PatientPortalStack extends Stack {
  public readonly patientPortalLambdaArn: string;
  public readonly sessionTableName: string;
  public readonly smsLogTableName: string;

  constructor(scope: Construct, id: string, props: PatientPortalStackProps) {
    super(scope, id, props);

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

    const defaultSmsLogTable = new dynamodb.Table(this, 'DefaultSmsLogTable', {
      tableName: `${this.stackName}-SmsLogs`,
      partitionKey: { name: 'LogId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    defaultSmsLogTable.addGlobalSecondaryIndex({
      indexName: 'PhoneNumberIndex',
      partitionKey: { name: 'PhoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Timestamp', type: dynamodb.AttributeType.STRING },
    });

    this.sessionTableName = defaultSessionTable.tableName;
    this.smsLogTableName = defaultSmsLogTable.tableName;

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
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        REGION: Stack.of(this).region,
        SESSION_TABLE_PREFIX: sessionTablePrefix,
        SMS_LOG_TABLE_PREFIX: smsLogTablePrefix,
        DEFAULT_SESSION_TABLE: defaultSessionTable.tableName,
        DEFAULT_SMS_LOG_TABLE: defaultSmsLogTable.tableName,
        TF_BUCKET: props.consolidatedTransferServerBucket,
        TF_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        TF_SFTP_PASSWORD: 'Clinic@2020!',
      },
    });

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
  }
}