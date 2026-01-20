// // stacks/hr-stack.ts

// import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn } from 'aws-cdk-lib';
// import { Construct } from 'constructs';
// import * as path from 'path';
// import * as lambda from 'aws-cdk-lib/aws-lambda';
// import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
// import * as apigw from 'aws-cdk-lib/aws-apigateway';
// import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
// import * as iam from 'aws-cdk-lib/aws-iam';
// import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// export interface HrStackProps extends StackProps {
//   userPool: any; // from coreStack
//   staffClinicInfoTableName: string; // from coreStack
// }

// export class HrStack extends Stack {
//   public readonly api: apigw.RestApi;
//   public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
//   public readonly hrFn: lambdaNode.NodejsFunction;
//   public readonly shiftsTable: dynamodb.Table;
//   public readonly leaveTable: dynamodb.Table;

//   constructor(scope: Construct, id: string, props: HrStackProps) {
//     super(scope, id, props);

//     // ========================================
//     // DYNAMODB TABLES
//     // ========================================

//     // Table to store all shifts
//     this.shiftsTable = new dynamodb.Table(this, 'ShiftsTable', {
//       tableName: 'todaysdentalinsights-HrShifts',
//       partitionKey: { name: 'shiftId', type: dynamodb.AttributeType.STRING },
//       billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
//       removalPolicy: RemovalPolicy.RETAIN,
//     });
//     // GSI for Staff to get their own shifts
//     this.shiftsTable.addGlobalSecondaryIndex({
//       indexName: 'byStaff',
//       partitionKey: { name: 'staffId', type: dynamodb.AttributeType.STRING },
//       sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
//     });
//     // GSI for Admins to get shifts by clinic and week
//     this.shiftsTable.addGlobalSecondaryIndex({
//       indexName: 'byClinicAndDate',
//       partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
//       sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
//     });

//     // Table to store all leave requests
//     this.leaveTable = new dynamodb.Table(this, 'LeaveTable', {
//       tableName: 'todaysdentalinsights-HrLeaveRequests',
//       partitionKey: { name: 'leaveId', type: dynamodb.AttributeType.STRING },
//       billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
//       removalPolicy: RemovalPolicy.RETAIN,
//     });
//     // GSI for Staff to get their own leave requests
//     this.leaveTable.addGlobalSecondaryIndex({
//       indexName: 'byStaff',
//       partitionKey: { name: 'staffId', type: dynamodb.AttributeType.STRING },
//       sortKey: { name: 'startDate', type: dynamodb.AttributeType.STRING },
//     });

//     // ========================================
//     // API GATEWAY
//     // ========================================

//     const corsConfig = getCdkCorsConfig();
//     this.api = new apigw.RestApi(this, 'HrApi', {
//       restApiName: 'HrApi',
//       description: 'HR Module API (Schedules, Leave)',
//       defaultCorsPreflightOptions: {
//         allowOrigins: corsConfig.allowOrigins,
//         allowHeaders: corsConfig.allowHeaders,
//         allowMethods: corsConfig.allowMethods,
//       },
//       deployOptions: {
//         stageName: 'prod',
//         metricsEnabled: true,
//         loggingLevel: apigw.MethodLoggingLevel.INFO,
//         dataTraceEnabled: false,
//       },
//     });
    
//     // Add Gateway responses for errors (like in your admin-stack.ts)
//     const corsErrorHeaders = getCorsErrorHeaders();
//     new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
//       restApi: this.api, type: apigw.ResponseType.DEFAULT_4XX, responseHeaders: corsErrorHeaders,
//     });
//     new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
//       restApi: this.api, type: apigw.ResponseType.DEFAULT_5XX, responseHeaders: corsErrorHeaders,
//     });
//     new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
//       restApi: this.api, type: apigw.ResponseType.UNAUTHORIZED, responseHeaders: corsErrorHeaders,
//     });

//     this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
//       cognitoUserPools: [props.userPool],
//     });

//     // ========================================
//     // LAMBDA FUNCTION (Unified Handler)
//     // ========================================

//     this.hrFn = new lambdaNode.NodejsFunction(this, 'HrFn', {
//       entry: path.join(__dirname, '..', '..', 'services', 'hr', 'index.ts'),
//       handler: 'handler',
//       runtime: lambda.Runtime.NODEJS_20_X, // Match your admin-stack.ts
//       memorySize: 256,
//       timeout: Duration.seconds(30),
//       bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
//       environment: {
//         USER_POOL_ID: props.userPool.userPoolId,
//         COGNITO_REGION: Stack.of(this).region,
//         SHIFTS_TABLE: this.shiftsTable.tableName,
//         LEAVE_TABLE: this.leaveTable.tableName,
//         STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName, // From CoreStack
//       },
//     });

//     // Grant Lambda permissions
//     this.shiftsTable.grantReadWriteData(this.hrFn);
//     this.leaveTable.grantReadWriteData(this.hrFn);

//     // Grant READ-ONLY permission to the existing StaffClinicInfo table
//     this.hrFn.addToRolePolicy(new iam.PolicyStatement({
//       actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
//       resources: [
//         `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
//         `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`
//       ],
//     }));

//     // --- THIS IS THE FIX ---
//     // Added 'cognito-idp:AdminGetUser' to the policy
//     this.hrFn.addToRolePolicy(new iam.PolicyStatement({
//       actions: [
//         'cognito-idp:ListUsers',
//         'cognito-idp:AdminGetUser' // <-- ADD THIS PERMISSION
//       ],
//       resources: [props.userPool.userPoolArn],
//     }));
//     // --- END OF FIX ---

//     // ========================================
//     // API ROUTES
//     // ========================================

//     const lambdaIntegration = new apigw.LambdaIntegration(this.hrFn);
//     const authOptions = {
//       authorizer: this.authorizer,
//       authorizationType: apigw.AuthorizationType.CUSTOM,
//     };

//     // /dashboard
//     const dashboardRes = this.api.root.addResource('dashboard');
//     dashboardRes.addMethod('GET', lambdaIntegration, authOptions);

//     // /clinics (utility endpoint to get clinic list)
//     const clinicsRes = this.api.root.addResource('clinics');
//     clinicsRes.addMethod('GET', lambdaIntegration, authOptions);

//     // /shifts
//     const shiftsRes = this.api.root.addResource('shifts');
//     shiftsRes.addMethod('GET', lambdaIntegration, authOptions);  // Get shifts (for Admin or Staff)
//     shiftsRes.addMethod('POST', lambdaIntegration, authOptions); // Create shift (Admin only)

//     // /shifts/{shiftId}
//     const shiftIdRes = shiftsRes.addResource('{shiftId}');
//     shiftIdRes.addMethod('PUT', lambdaIntegration, authOptions);    // Update shift (Admin only)
//     shiftIdRes.addMethod('DELETE', lambdaIntegration, authOptions); // Delete shift (Admin only)

//     // /shifts/{shiftId}/reject
//     const shiftRejectRes = shiftIdRes.addResource('reject');
//     shiftRejectRes.addMethod('PUT', lambdaIntegration, authOptions); // Reject shift (Staff only)

//     // /leave
//     const leaveRes = this.api.root.addResource('leave');
//     leaveRes.addMethod('GET', lambdaIntegration, authOptions);  // Get leave requests (Admin or Staff)
//     leaveRes.addMethod('POST', lambdaIntegration, authOptions); // Create leave request (Staff)

//     // /leave/{leaveId}
//     const leaveIdRes = leaveRes.addResource('{leaveId}');
//     leaveIdRes.addMethod('DELETE', lambdaIntegration, authOptions); // Delete leave request (Staff or Admin)

//     // /leave/{leaveId}/approve
//     const leaveApproveRes = leaveIdRes.addResource('approve');
//     leaveApproveRes.addMethod('PUT', lambdaIntegration, authOptions); // Approve leave (Admin only)
    
//     // /leave/{leaveId}/deny
//     const leaveDenyRes = leaveIdRes.addResource('deny');
//     leaveDenyRes.addMethod('PUT', lambdaIntegration, authOptions); // Deny leave (Admin only)

//     // ========================================
//     // DOMAIN MAPPING
//     // ========================================

//     new apigw.CfnBasePathMapping(this, 'HrApiBasePathMapping', {
//       domainName: 'api.todaysdentalinsights.com',
//       basePath: 'hr', // This API will be available at /hr
//       restApiId: this.api.restApiId,
//       stage: this.api.deploymentStage.stageName,
//     });

//     // ========================================
//     // OUTPUTS
//     // ========================================

//     new CfnOutput(this, 'HrApiUrl', {
//       value: 'https://api.todaysdentalinsights.com/hr/',
//       description: 'HR Module API Gateway URL',
//       exportName: `${Stack.of(this).stackName}-HrApiUrl`,
//     });
//   }
// }
// stacks/hr-stack.ts

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface HrStackProps extends StackProps {
  staffClinicInfoTableName: string; // from coreStack
  clinicsTableName: string; // from ChimeStack - for timezone lookup
}

export class HrStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly hrFn: lambdaNode.NodejsFunction;
  public readonly shiftsTable: dynamodb.Table;
  public readonly leaveTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: HrStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'HR',
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
    // DYNAMODB TABLES
    // ========================================

    // Table to store all shifts
    this.shiftsTable = new dynamodb.Table(this, 'ShiftsTable', {
      tableName: `${this.stackName}-Shifts`,
      partitionKey: { name: 'shiftId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.shiftsTable, { Table: 'hr-shifts' });
    // GSI for Staff to get their own shifts
    this.shiftsTable.addGlobalSecondaryIndex({
      indexName: 'byStaff',
      partitionKey: { name: 'staffId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });
    // GSI for Admins to get shifts by clinic and week
    this.shiftsTable.addGlobalSecondaryIndex({
      indexName: 'byClinicAndDate',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });

    // Table to store all leave requests
    this.leaveTable = new dynamodb.Table(this, 'LeaveTable', {
      tableName: `${this.stackName}-LeaveRequests`,
      partitionKey: { name: 'leaveId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    applyTags(this.leaveTable, { Table: 'hr-leave' });
    // GSI for Staff to get their own leave requests
    this.leaveTable.addGlobalSecondaryIndex({
      indexName: 'byStaff',
      partitionKey: { name: 'staffId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startDate', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.api = new apigw.RestApi(this, 'HrApi', {
      restApiName: 'HrApi',
      description: 'HR Module API (Schedules, Leave)',
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
    
    // Add Gateway responses for errors (like in your admin-stack.ts)
    const corsErrorHeaders = getCorsErrorHeaders();
    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.api, type: apigw.ResponseType.DEFAULT_4XX, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.api, type: apigw.ResponseType.DEFAULT_5XX, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.api, type: apigw.ResponseType.UNAUTHORIZED, responseHeaders: corsErrorHeaders,
    });
    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api, type: apigw.ResponseType.ACCESS_DENIED, responseHeaders: corsErrorHeaders,
    });

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    
    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'HrAuthorizer', {
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
    // LAMBDA FUNCTION (Unified Handler)
    // ========================================

    // Import StaffUser table name from CoreStack
    const staffUserTableName = Fn.importValue('CoreStack-StaffUserTableName');

    this.hrFn = new lambdaNode.NodejsFunction(this, 'HrFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'hr', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X, // Match your admin-stack.ts
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        SHIFTS_TABLE: this.shiftsTable.tableName,
        LEAVE_TABLE: this.leaveTable.tableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName, // From CoreStack
        STAFF_USER_TABLE: staffUserTableName, // For user lookups (replaces Cognito)
        CLINICS_TABLE: props.clinicsTableName, // From ChimeStack - for timezone lookup
        // --- SES ENVIRONMENT VARIABLES ---
        APP_NAME: 'TodaysDentalInsights',
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
        SES_REGION: 'us-east-1',
      },
    });
    applyTags(this.hrFn, { Function: 'hr' });

    // Grant Lambda permissions
    this.shiftsTable.grantReadWriteData(this.hrFn);
    this.leaveTable.grantReadWriteData(this.hrFn);

    // Grant READ-ONLY permission to the existing StaffClinicInfo table
    this.hrFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`
      ],
    }));

    // Grant READ permission to StaffUser table (for user lookups - replaces Cognito)
    this.hrFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`
      ],
    }));

    // Grant READ permission to Clinics table (for timezone lookup)
    this.hrFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicsTableName}`,
      ],
    }));

    // --- UPDATED: SESv2 Permissions ---
    this.hrFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail', // This is the required SESv2 send action
      ],
      resources: ['*'], 
    }));
    // --- END UPDATED ---

    // ========================================
    // API ROUTES
    // ========================================

    const lambdaIntegration = new apigw.LambdaIntegration(this.hrFn);
    const authOptions = {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    };
    const defaultMethodResponses = [
      { statusCode: '200' },
      { statusCode: '201' },
      { statusCode: '204' },
      { statusCode: '400' },
      { statusCode: '401' },
      { statusCode: '403' },
      { statusCode: '404' },
      { statusCode: '500' },
    ];

    // /dashboard
    const dashboardRes = this.api.root.addResource('dashboard');
    dashboardRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /clinics (utility endpoint to get clinic list)
    const clinicsRes = this.api.root.addResource('clinics');
    clinicsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });

    // /shifts
    const shiftsRes = this.api.root.addResource('shifts');
    shiftsRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // Get shifts (for Admin or Staff)
    shiftsRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create shift (Admin only)

    // /shifts/{shiftId}
    const shiftIdRes = shiftsRes.addResource('{shiftId}');
    shiftIdRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });    // Update shift (Admin only)
    shiftIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete shift (Admin only)

    // /shifts/{shiftId}/reject
    const shiftRejectRes = shiftIdRes.addResource('reject');
    shiftRejectRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Reject shift (Staff only)

    // /leave
    const leaveRes = this.api.root.addResource('leave');
    leaveRes.addMethod('GET', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses });  // Get leave requests (Admin or Staff)
    leaveRes.addMethod('POST', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Create leave request (Staff)

    // /leave/{leaveId}
    const leaveIdRes = leaveRes.addResource('{leaveId}');
    leaveIdRes.addMethod('DELETE', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Delete leave request (Staff or Admin)

    // /leave/{leaveId}/approve
    const leaveApproveRes = leaveIdRes.addResource('approve');
    leaveApproveRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Approve leave (Admin only)
    
    // /leave/{leaveId}/deny
    const leaveDenyRes = leaveIdRes.addResource('deny');
    leaveDenyRes.addMethod('PUT', lambdaIntegration, { ...authOptions, methodResponses: defaultMethodResponses }); // Deny leave (Admin only)

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.hrFn, name: 'hr', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.shiftsTable.tableName, 'ShiftsTable');
    createDynamoThrottleAlarm(this.leaveTable.tableName, 'LeaveTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'HrApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'hr', // This API will be available at /hr
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'HrApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/hr/',
      description: 'HR Module API Gateway URL',
      exportName: `${Stack.of(this).stackName}-HrApiUrl`,
    });
  }
}
