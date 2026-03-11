import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cr from 'aws-cdk-lib/custom-resources';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface ClinicBudgetStackProps extends StackProps {
    // Authorizer imported via CloudFormation export
}

export class ClinicBudgetStack extends Stack {
    public readonly clinicBudgetTable: dynamodb.Table;
    public readonly budgetCrudFn: lambdaNode.NodejsFunction;
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.RequestAuthorizer;

    constructor(scope: Construct, id: string, props: ClinicBudgetStackProps) {
        super(scope, id, props);

        // Tags & alarm helpers
        const baseTags: Record<string, string> = {
            Stack: Stack.of(this).stackName,
            Service: 'ClinicBudget',
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
        // DYNAMODB TABLE
        // ========================================
        this.clinicBudgetTable = new dynamodb.Table(this, 'ClinicBudgetTable', {
            tableName: `${this.stackName}-ClinicDailyBudget`,
            partitionKey: { name: 'clinicName', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });
        applyTags(this.clinicBudgetTable, { Table: 'clinic-daily-budget' });

        // ========================================
        // API GATEWAY SETUP
        // ========================================

        const corsConfig = getCdkCorsConfig();

        this.api = new apigw.RestApi(this, 'ClinicBudgetApi', {
            restApiName: 'ClinicBudgetApi',
            description: 'Clinic Daily Budget service API',
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
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_4XX,
            responseHeaders: corsErrorHeaders,
        });

        new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_5XX,
            responseHeaders: corsErrorHeaders,
        });

        new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
            restApi: this.api,
            type: apigw.ResponseType.UNAUTHORIZED,
            responseHeaders: corsErrorHeaders,
        });

        // Import the authorizer function ARN from CoreStack's export
        const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
        const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

        // Create authorizer for this stack's API
        this.authorizer = new apigw.RequestAuthorizer(this, 'ClinicBudgetAuthorizer', {
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
        // LAMBDA FUNCTION
        // ========================================

        this.budgetCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicBudgetCrudFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'budgetCrud.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 256,
            timeout: Duration.seconds(10),
            bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
            environment: { CLINIC_BUDGET_TABLE: this.clinicBudgetTable.tableName },
        });
        applyTags(this.budgetCrudFn, { Function: 'clinic-budget-crud' });

        this.clinicBudgetTable.grantReadWriteData(this.budgetCrudFn);

        // ========================================
        // API ROUTES
        // ========================================

        // /clinic-budgets - List all budgets
        const clinicBudgetsRes = this.api.root.addResource('clinic-budgets');

        clinicBudgetsRes.addMethod('GET', new apigw.LambdaIntegration(this.budgetCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }]
        });

        // /clinic-budgets/{clinicName} - Get or update specific clinic
        const clinicNameRes = clinicBudgetsRes.addResource('{clinicName}');

        clinicNameRes.addMethod('GET', new apigw.LambdaIntegration(this.budgetCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
        });

        clinicNameRes.addMethod('PUT', new apigw.LambdaIntegration(this.budgetCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }]
        });

        // ========================================
        // SEED INITIAL DATA (Custom Resource)
        // ========================================

        const initialData = [
            { clinicName: 'Dentistry at Kew Gardens', dailyBudget: 0 },
            { clinicName: 'Canarsie Family Dentistry', dailyBudget: 0 },
        ];

        const seederFn = new lambdaNode.NodejsFunction(this, 'ClinicBudgetSeederFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'budgetSeeder.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 256,
            timeout: Duration.seconds(60),
            bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
            environment: {
                CLINIC_BUDGET_TABLE: this.clinicBudgetTable.tableName,
                INITIAL_DATA: JSON.stringify(initialData),
            },
        });
        applyTags(seederFn, { Function: 'clinic-budget-seeder' });

        this.clinicBudgetTable.grantWriteData(seederFn);

        const seederProvider = new cr.Provider(this, 'ClinicBudgetSeederProvider', {
            onEventHandler: seederFn,
        });

        new CustomResource(this, 'ClinicBudgetSeeder', {
            serviceToken: seederProvider.serviceToken,
            properties: {
                // Change this value to trigger re-seeding
                version: '1.0.1',
            },
        });

        // ========================================
        // CloudWatch Alarms
        // ========================================
        [
            { fn: this.budgetCrudFn, name: 'clinic-budget-crud', durationMs: Math.floor(Duration.seconds(10).toMilliseconds() * 0.8) },
        ].forEach(({ fn, name, durationMs }) => {
            createLambdaErrorAlarm(fn, name);
            createLambdaThrottleAlarm(fn, name);
            createLambdaDurationAlarm(fn, name, durationMs);
        });

        createDynamoThrottleAlarm(this.clinicBudgetTable.tableName, 'ClinicBudgetTable');

        // NOTE: The clinic-budget base path mapping is owned by the AdminStack
        // (admin-stack.ts line ~817). Do NOT duplicate it here or CloudFormation
        // will fail with a ResourceExistenceCheck conflict.

        // ========================================
        // OUTPUTS
        // ========================================

        new CfnOutput(this, 'ClinicBudgetTableName', {
            value: this.clinicBudgetTable.tableName,
            description: 'Name of the Clinic Daily Budget DynamoDB table',
            exportName: `${Stack.of(this).stackName}-ClinicBudgetTableName`,
        });

        new CfnOutput(this, 'ClinicBudgetApiUrl', {
            value: 'https://api.todaysdentalservices.com/clinic-budget/',
            description: 'Clinic Budget API Gateway URL',
            exportName: `${Stack.of(this).stackName}-ClinicBudgetApiUrl`,
        });

        new CfnOutput(this, 'ClinicBudgetApiId', {
            value: this.api.restApiId,
            description: 'Clinic Budget API Gateway ID',
            exportName: `${Stack.of(this).stackName}-ClinicBudgetApiId`,
        });
    }
}
