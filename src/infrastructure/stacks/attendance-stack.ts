// stacks/attendance-stack.ts
// Geofence + WiFi staff attendance tracking

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// Import clinic config for geofence data (bundled at CDK synthesis time)
import clinicConfigData from '../configs/clinic-config.json';

export interface AttendanceStackProps extends StackProps {
    staffClinicInfoTableName: string;    // from CoreStack — workLocation.isOnPremise check
    clinicHoursTableName: string;        // from ClinicHoursStack — operating hours check
    shiftsTableName: string;             // from HrStack — shift-aware tracking
    // Push Notifications Integration (from PushNotificationsStack)
    deviceTokensTableName?: string;
    deviceTokensTableArn?: string;
    sendPushFunctionArn?: string;
}

export class AttendanceStack extends Stack {
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.RequestAuthorizer;
    public readonly attendanceFn: lambdaNode.NodejsFunction;
    public readonly attendanceTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props: AttendanceStackProps) {
        super(scope, id, props);

        // Build geofence config map: clinicId -> { enabled, lat, lng, radius, wifiSSIDs, lateThresholdMinutes }
        const geofenceConfigMap: Record<string, any> = {};
        (clinicConfigData as any[]).forEach((clinic: any) => {
            if (clinic.geofence) {
                geofenceConfigMap[clinic.clinicId] = {
                    ...clinic.geofence,
                    timezone: clinic.timezone || 'America/New_York',
                };
            }
        });
        const geofenceConfigStr = JSON.stringify(geofenceConfigMap);

        // Tags & alarm helpers
        const baseTags: Record<string, string> = {
            Stack: Stack.of(this).stackName,
            Service: 'Attendance',
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
                alarmDescription: `Alert when ${name} Lambda p99 duration exceeds ${thresholdMs}ms`,
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
        // DYNAMODB TABLE
        // ========================================

        this.attendanceTable = new dynamodb.Table(this, 'AttendanceTable', {
            tableName: `${this.stackName}-Attendance`,
            partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'userId#timestamp', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        applyTags(this.attendanceTable, { Table: 'attendance' });

        // GSI: byUser — staff's own history across all clinics
        this.attendanceTable.addGlobalSecondaryIndex({
            indexName: 'byUser',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
        });

        // GSI: byDate — admin daily roster for a clinic
        this.attendanceTable.addGlobalSecondaryIndex({
            indexName: 'byDate',
            partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
        });

        // ========================================
        // API GATEWAY
        // ========================================

        const corsConfig = getCdkCorsConfig();
        this.api = new apigw.RestApi(this, 'AttendanceApi', {
            restApiName: 'AttendanceApi',
            description: 'Staff Attendance Tracking API (Geofence + WiFi)',
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

        // Import authorizer from CoreStack
        const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
        const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

        this.authorizer = new apigw.RequestAuthorizer(this, 'AttendanceAuthorizer', {
            handler: authorizerFn,
            identitySources: [apigw.IdentitySource.header('Authorization')],
            resultsCacheTtl: Duration.minutes(5),
        });

        new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
            action: 'lambda:InvokeFunction',
            functionName: authorizerFunctionArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
        });

        // ========================================
        // LAMBDA FUNCTION (Unified Handler)
        // ========================================

        const staffUserTableName = Fn.importValue('CoreStack-StaffUserTableName');

        this.attendanceFn = new lambdaNode.NodejsFunction(this, 'AttendanceFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'hr', 'attendance.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 256,
            timeout: Duration.seconds(30),
            bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
            environment: {
                ATTENDANCE_TABLE: this.attendanceTable.tableName,
                STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
                CLINIC_HOURS_TABLE: props.clinicHoursTableName,
                SHIFTS_TABLE: props.shiftsTableName,
                STAFF_USER_TABLE: staffUserTableName,
                GEOFENCE_CONFIG: geofenceConfigStr,
                // Push notifications
                ...(props.deviceTokensTableName && { DEVICE_TOKENS_TABLE: props.deviceTokensTableName }),
                ...(props.sendPushFunctionArn && { SEND_PUSH_FUNCTION_ARN: props.sendPushFunctionArn }),
            },
        });
        applyTags(this.attendanceFn, { Function: 'attendance' });

        // Grant permissions
        this.attendanceTable.grantReadWriteData(this.attendanceFn);

        // READ access to cross-stack tables
        const readOnlyTables = [
            { name: props.staffClinicInfoTableName, label: 'StaffClinicInfo' },
            { name: props.clinicHoursTableName, label: 'ClinicHours' },
            { name: props.shiftsTableName, label: 'Shifts' },
        ];
        readOnlyTables.forEach(({ name }) => {
            this.attendanceFn.addToRolePolicy(new iam.PolicyStatement({
                actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
                resources: [
                    `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}`,
                    `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}/index/*`,
                ],
            }));
        });

        // StaffUser table read
        this.attendanceFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`,
            ],
        }));

        // Push notifications permissions
        if (props.deviceTokensTableArn) {
            this.attendanceFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.deviceTokensTableArn,
                    `${props.deviceTokensTableArn}/index/*`,
                ],
            }));
        }
        if (props.sendPushFunctionArn) {
            this.attendanceFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['lambda:InvokeFunction'],
                resources: [props.sendPushFunctionArn],
            }));
        }

        // ========================================
        // API ROUTES - Proxy Integration
        // ========================================

        const lambdaIntegration = new apigw.LambdaIntegration(this.attendanceFn, {
            allowTestInvoke: false,
        });
        const authOptions = {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        };

        const proxyResource = this.api.root.addResource('{proxy+}');
        proxyResource.addMethod('ANY', lambdaIntegration, {
            ...authOptions,
            requestParameters: {
                'method.request.path.proxy': true,
            },
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '201' },
                { statusCode: '204' },
                { statusCode: '400' },
                { statusCode: '401' },
                { statusCode: '403' },
                { statusCode: '404' },
                { statusCode: '500' },
            ],
        });

        // ========================================
        // EVENTBRIDGE - Weekly Digest
        // ========================================

        const digestFn = new lambdaNode.NodejsFunction(this, 'AttendanceDigestFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'hr', 'attendance-digest.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 256,
            timeout: Duration.seconds(60),
            bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
            environment: {
                ATTENDANCE_TABLE: this.attendanceTable.tableName,
                SHIFTS_TABLE: props.shiftsTableName,
                STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
                APP_NAME: 'TodaysDentalInsights',
                FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
                SES_REGION: 'us-east-1',
            },
        });
        applyTags(digestFn, { Function: 'attendance-digest' });

        // Digest Lambda permissions
        this.attendanceTable.grantReadData(digestFn);
        readOnlyTables.forEach(({ name }) => {
            digestFn.addToRolePolicy(new iam.PolicyStatement({
                actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
                resources: [
                    `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}`,
                    `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}/index/*`,
                ],
            }));
        });
        digestFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`,
            ],
        }));
        digestFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
        }));

        // Every Monday 8 AM EST (13:00 UTC)
        new events.Rule(this, 'WeeklyDigestRule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '13', weekDay: 'MON' }),
            targets: [new targets.LambdaFunction(digestFn)],
        });

        // ========================================
        // CloudWatch Alarms
        // ========================================
        [
            { fn: this.attendanceFn, name: 'attendance', durationMs: 24000 },
            { fn: digestFn, name: 'attendance-digest', durationMs: 48000 },
        ].forEach(({ fn, name, durationMs }) => {
            createLambdaErrorAlarm(fn, name);
            createLambdaThrottleAlarm(fn, name);
            createLambdaDurationAlarm(fn, name, durationMs);
        });
        createDynamoThrottleAlarm(this.attendanceTable.tableName, 'AttendanceTable');

        // ========================================
        // DOMAIN MAPPING
        // ========================================

        new apigw.CfnBasePathMapping(this, 'AttendanceApiBasePathMapping', {
            domainName: 'apig.todaysdentalinsights.com',
            basePath: 'attendance',
            restApiId: this.api.restApiId,
            stage: this.api.deploymentStage.stageName,
        });

        // ========================================
        // OUTPUTS
        // ========================================

        new CfnOutput(this, 'ApiUrl', {
            value: 'https://apig.todaysdentalinsights.com/attendance/',
            description: 'Attendance API URL',
            exportName: `${Stack.of(this).stackName}-ApiUrl`,
        });

        new CfnOutput(this, 'AttendanceTableName', {
            value: this.attendanceTable.tableName,
            description: 'Attendance DynamoDB Table Name',
            exportName: `${Stack.of(this).stackName}-AttendanceTableName`,
        });
    }
}
