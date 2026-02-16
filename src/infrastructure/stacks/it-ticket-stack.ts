// ============================================
// IT Ticket Stack — CDK Infrastructure
// ============================================
// Self-contained stack for the IT Ticket System (Bug Reporting & Feature Requests).
// Does NOT modify or depend on any existing stacks other than CoreStack (authorizer + StaffClinicInfo).
// Pattern follows hr-stack.ts: DynamoDB + Lambda + API Gateway + proxy routing + SES + tags + alarms.

import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// ========================================
// STACK PROPS
// ========================================

export interface ItTicketStackProps extends StackProps {
    staffClinicInfoTableName: string; // from CoreStack
}

// ========================================
// STACK CLASS
// ========================================

export class ItTicketStack extends Stack {
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.RequestAuthorizer;
    public readonly itTicketFn: lambdaNode.NodejsFunction;
    public readonly ticketsTable: dynamodb.Table;
    public readonly ticketCommentsTable: dynamodb.Table;
    public readonly moduleAssigneesTable: dynamodb.Table;
    public readonly mediaBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: ItTicketStackProps) {
        super(scope, id, props);

        // ========================================
        // TAGS & ALARM HELPERS
        // ========================================

        const baseTags: Record<string, string> = {
            Stack: Stack.of(this).stackName,
            Service: 'ITTicket',
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

        // Table 1: Tickets
        this.ticketsTable = new dynamodb.Table(this, 'TicketsTable', {
            tableName: `${this.stackName}-Tickets`,
            partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        applyTags(this.ticketsTable, { Table: 'tickets' });

        // GSI: byAssignee — Assignee dashboard
        this.ticketsTable.addGlobalSecondaryIndex({
            indexName: 'byAssignee',
            partitionKey: { name: 'assigneeId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
        });

        // GSI: byModule — Filter by module
        this.ticketsTable.addGlobalSecondaryIndex({
            indexName: 'byModule',
            partitionKey: { name: 'module', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
        });

        // GSI: byStatus — Filter by status
        this.ticketsTable.addGlobalSecondaryIndex({
            indexName: 'byStatus',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
        });

        // GSI: byReporter — Reporter's own tickets
        this.ticketsTable.addGlobalSecondaryIndex({
            indexName: 'byReporter',
            partitionKey: { name: 'reporterId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
        });

        // GSI: byClinic — Admin view: all tickets per clinic
        this.ticketsTable.addGlobalSecondaryIndex({
            indexName: 'byClinic',
            partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
        });

        // Table 2: TicketComments
        this.ticketCommentsTable = new dynamodb.Table(this, 'TicketCommentsTable', {
            tableName: `${this.stackName}-TicketComments`,
            partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'commentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });
        applyTags(this.ticketCommentsTable, { Table: 'ticket-comments' });

        // Table 3: ModuleAssignees
        this.moduleAssigneesTable = new dynamodb.Table(this, 'ModuleAssigneesTable', {
            tableName: `${this.stackName}-ModuleAssignees`,
            partitionKey: { name: 'module', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });
        applyTags(this.moduleAssigneesTable, { Table: 'module-assignees' });

        // ========================================
        // S3 BUCKET — Media Uploads
        // ========================================

        this.mediaBucket = new s3.Bucket(this, 'ItTicketMediaBucket', {
            bucketName: `todays-dental-it-tickets-media-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            removalPolicy: RemovalPolicy.RETAIN,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                    maxAge: 3600,
                },
            ],
            lifecycleRules: [
                {
                    id: 'OldVersionsToIA',
                    noncurrentVersionTransitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: Duration.days(90),
                        },
                    ],
                    noncurrentVersionExpiration: Duration.days(365),
                },
            ],
        });
        applyTags(this.mediaBucket, { Resource: 'media-bucket' });

        // ========================================
        // API GATEWAY
        // ========================================

        const corsConfig = getCdkCorsConfig();
        this.api = new apigw.RestApi(this, 'ItTicketApi', {
            restApiName: 'ItTicketApi',
            description: 'IT Ticket System API (Bug Reports & Feature Requests)',
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

        // Gateway error responses with CORS headers
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
        this.authorizer = new apigw.RequestAuthorizer(this, 'ItTicketAuthorizer', {
            handler: authorizerFn,
            identitySources: [apigw.IdentitySource.header('Authorization')],
            resultsCacheTtl: Duration.minutes(5),
        });

        // Grant API Gateway permission to invoke the authorizer Lambda
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

        this.itTicketFn = new lambdaNode.NodejsFunction(this, 'ItTicketFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'it-ticket', 'index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(30),
            bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
            environment: {
                TICKETS_TABLE: this.ticketsTable.tableName,
                COMMENTS_TABLE: this.ticketCommentsTable.tableName,
                MODULE_ASSIGNEES_TABLE: this.moduleAssigneesTable.tableName,
                MEDIA_BUCKET: this.mediaBucket.bucketName,
                STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName,
                STAFF_USER_TABLE: staffUserTableName,
                FROM_EMAIL: 'no-reply@todaysdentalinsights.com',
                SES_REGION: 'us-east-1',
                PRESIGNED_URL_EXPIRY: '3600',
            },
        });
        applyTags(this.itTicketFn, { Function: 'it-ticket' });

        // ========================================
        // IAM PERMISSIONS
        // ========================================

        // Grant Lambda ReadWrite on its own tables
        this.ticketsTable.grantReadWriteData(this.itTicketFn);
        this.ticketCommentsTable.grantReadWriteData(this.itTicketFn);
        this.moduleAssigneesTable.grantReadWriteData(this.itTicketFn);

        // Grant S3 ReadWrite on media bucket
        this.mediaBucket.grantReadWrite(this.itTicketFn);

        // Grant READ-ONLY permission to StaffClinicInfo table (from CoreStack)
        this.itTicketFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}/index/*`,
            ],
        }));

        // Grant READ permission to StaffUser table (for user lookups)
        this.itTicketFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/*-StaffUser/index/*`,
            ],
        }));

        // Grant SES send permission for resolution emails
        this.itTicketFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
        }));

        // ========================================
        // API ROUTES — Proxy Integration
        // ========================================
        //
        // Uses {proxy+} pattern with a single ANY method to route all requests
        // to the Lambda function. The Lambda handler routes requests based on path and method.
        //

        const lambdaIntegration = new apigw.LambdaIntegration(this.itTicketFn, {
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
        // CLOUDWATCH ALARMS
        // ========================================

        [
            { fn: this.itTicketFn, name: 'it-ticket', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
        ].forEach(({ fn, name, durationMs }) => {
            createLambdaErrorAlarm(fn, name);
            createLambdaThrottleAlarm(fn, name);
            createLambdaDurationAlarm(fn, name, durationMs);
        });

        createDynamoThrottleAlarm(this.ticketsTable.tableName, 'TicketsTable');
        createDynamoThrottleAlarm(this.ticketCommentsTable.tableName, 'TicketCommentsTable');
        createDynamoThrottleAlarm(this.moduleAssigneesTable.tableName, 'ModuleAssigneesTable');

        // ========================================
        // DOMAIN MAPPING
        // ========================================

        new apigw.CfnBasePathMapping(this, 'ItTicketApiBasePathMapping', {
            domainName: 'apig.todaysdentalinsights.com',
            basePath: 'it-ticket', // Available at https://apig.todaysdentalinsights.com/it-ticket
            restApiId: this.api.restApiId,
            stage: this.api.deploymentStage.stageName,
        });

        // ========================================
        // OUTPUTS
        // ========================================

        new CfnOutput(this, 'ItTicketApiUrl', {
            value: 'https://apig.todaysdentalinsights.com/it-ticket/',
            description: 'IT Ticket System API Gateway URL',
            exportName: `${Stack.of(this).stackName}-ItTicketApiUrl`,
        });

        new CfnOutput(this, 'TicketsTableName', {
            value: this.ticketsTable.tableName,
            exportName: `${Stack.of(this).stackName}-TicketsTableName`,
        });

        new CfnOutput(this, 'MediaBucketName', {
            value: this.mediaBucket.bucketName,
            exportName: `${Stack.of(this).stackName}-MediaBucketName`,
        });
    }
}
