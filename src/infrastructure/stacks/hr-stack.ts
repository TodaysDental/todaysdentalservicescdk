// // stacks/hr-stack.ts

// import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
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
//       authorizationType: apigw.AuthorizationType.COGNITO,
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

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface HrStackProps extends StackProps {
  userPool: any; // from coreStack
  staffClinicInfoTableName: string; // from coreStack
}

export class HrStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
  public readonly hrFn: lambdaNode.NodejsFunction;
  public readonly shiftsTable: dynamodb.Table;
  public readonly leaveTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: HrStackProps) {
    super(scope, id, props);

    // ========================================
    // DYNAMODB TABLES
    // ========================================

    // Table to store all shifts
    this.shiftsTable = new dynamodb.Table(this, 'ShiftsTable', {
      tableName: 'todaysdentalinsights-HrShifts',
      partitionKey: { name: 'shiftId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
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
      tableName: 'todaysdentalinsights-HrLeaveRequests',
      partitionKey: { name: 'leaveId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
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

    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    // ========================================
    // LAMBDA FUNCTION (Unified Handler)
    // ========================================

    this.hrFn = new lambdaNode.NodejsFunction(this, 'HrFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'hr', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X, // Match your admin-stack.ts
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: Stack.of(this).region,
        SHIFTS_TABLE: this.shiftsTable.tableName,
        LEAVE_TABLE: this.leaveTable.tableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName, // From CoreStack
        // --- NEW: SES ENVIRONMENT VARIABLES ---
        APP_NAME: 'TodaysDentalInsights', // Hardcoded as in core-stack.ts
        FROM_EMAIL: 'no-reply@todaysdentalinsights.com', // Hardcoded as in core-stack.ts
        SES_REGION: 'us-east-1', // Hardcoded as in core-stack.ts
        // --- END NEW ---
      },
    });

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

    // Grant Cognito permissions
    this.hrFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser'
      ],
      resources: [props.userPool.userPoolArn],
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
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    // /dashboard
    const dashboardRes = this.api.root.addResource('dashboard');
    dashboardRes.addMethod('GET', lambdaIntegration, authOptions);

    // /clinics (utility endpoint to get clinic list)
    const clinicsRes = this.api.root.addResource('clinics');
    clinicsRes.addMethod('GET', lambdaIntegration, authOptions);

    // /shifts
    const shiftsRes = this.api.root.addResource('shifts');
    shiftsRes.addMethod('GET', lambdaIntegration, authOptions);  // Get shifts (for Admin or Staff)
    shiftsRes.addMethod('POST', lambdaIntegration, authOptions); // Create shift (Admin only)

    // /shifts/{shiftId}
    const shiftIdRes = shiftsRes.addResource('{shiftId}');
    shiftIdRes.addMethod('PUT', lambdaIntegration, authOptions);    // Update shift (Admin only)
    shiftIdRes.addMethod('DELETE', lambdaIntegration, authOptions); // Delete shift (Admin only)

    // /shifts/{shiftId}/reject
    const shiftRejectRes = shiftIdRes.addResource('reject');
    shiftRejectRes.addMethod('PUT', lambdaIntegration, authOptions); // Reject shift (Staff only)

    // /leave
    const leaveRes = this.api.root.addResource('leave');
    leaveRes.addMethod('GET', lambdaIntegration, authOptions);  // Get leave requests (Admin or Staff)
    leaveRes.addMethod('POST', lambdaIntegration, authOptions); // Create leave request (Staff)

    // /leave/{leaveId}
    const leaveIdRes = leaveRes.addResource('{leaveId}');
    leaveIdRes.addMethod('DELETE', lambdaIntegration, authOptions); // Delete leave request (Staff or Admin)

    // /leave/{leaveId}/approve
    const leaveApproveRes = leaveIdRes.addResource('approve');
    leaveApproveRes.addMethod('PUT', lambdaIntegration, authOptions); // Approve leave (Admin only)
    
    // /leave/{leaveId}/deny
    const leaveDenyRes = leaveIdRes.addResource('deny');
    leaveDenyRes.addMethod('PUT', lambdaIntegration, authOptions); // Deny leave (Admin only)

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'HrApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'hr', // This API will be available at /hr
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'HrApiUrl', {
      value: 'https://api.todaysdentalinsights.com/hr/',
      description: 'HR Module API Gateway URL',
      exportName: `${Stack.of(this).stackName}-HrApiUrl`,
    });
  }
}