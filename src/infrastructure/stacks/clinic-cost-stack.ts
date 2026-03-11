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

export interface ClinicCostStackProps extends StackProps {
    // Authorizer imported via CloudFormation export
}

export class ClinicCostStack extends Stack {
    public readonly clinicCostTable: dynamodb.Table;
    public readonly costCrudFn: lambdaNode.NodejsFunction;
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.RequestAuthorizer;

    constructor(scope: Construct, id: string, props: ClinicCostStackProps) {
        super(scope, id, props);

        // Tags & alarm helpers
        const baseTags: Record<string, string> = {
            Stack: Stack.of(this).stackName,
            Service: 'ClinicCost',
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
        this.clinicCostTable = new dynamodb.Table(this, 'ClinicCostTable', {
            tableName: `${this.stackName}-ClinicCostOfOperation`,
            partitionKey: { name: 'clinicName', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });
        applyTags(this.clinicCostTable, { Table: 'clinic-cost-of-operation' });

        // ========================================
        // API GATEWAY SETUP
        // ========================================

        const corsConfig = getCdkCorsConfig();

        this.api = new apigw.RestApi(this, 'ClinicCostApi', {
            restApiName: 'ClinicCostApi',
            description: 'Clinic Cost of Operation service API',
            defaultCorsPreflightOptions: {
                allowOrigins: corsConfig.allowOrigins,
                allowHeaders: corsConfig.allowHeaders,
                allowMethods: corsConfig.allowMethods,
                allowCredentials: true,
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
        this.authorizer = new apigw.RequestAuthorizer(this, 'ClinicCostAuthorizer', {
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

        this.costCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicCostCrudFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'costCrud.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 256,
            timeout: Duration.seconds(10),
            bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
            environment: { CLINIC_COST_TABLE: this.clinicCostTable.tableName },
        });
        applyTags(this.costCrudFn, { Function: 'clinic-cost-crud' });

        this.clinicCostTable.grantReadWriteData(this.costCrudFn);

        // ========================================
        // API ROUTES
        // ========================================

        // /clinic-costs - List all costs
        const clinicCostsRes = this.api.root.addResource('clinic-costs');

        clinicCostsRes.addMethod('GET', new apigw.LambdaIntegration(this.costCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }]
        });

        // /clinic-costs/{clinicName} - Get or update specific clinic
        const clinicNameRes = clinicCostsRes.addResource('{clinicName}');

        clinicNameRes.addMethod('GET', new apigw.LambdaIntegration(this.costCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }, { statusCode: '404' }]
        });

        clinicNameRes.addMethod('PUT', new apigw.LambdaIntegration(this.costCrudFn), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
            methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }]
        });

        // ========================================
        // SEED INITIAL DATA (Custom Resource)
        // ========================================

        const initialData = [
            { clinicName: 'Dentistry at Kew Gardens', costPerDay: 0 },
            { clinicName: 'Canarsie Family Dentistry', costPerDay: 0 },
        ];

        const seederFn = new lambdaNode.NodejsFunction(this, 'ClinicCostSeederFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'costSeeder.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 256,
            timeout: Duration.seconds(60),
            bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
            environment: {
                CLINIC_COST_TABLE: this.clinicCostTable.tableName,
                INITIAL_DATA: JSON.stringify(initialData),
            },
        });
        applyTags(seederFn, { Function: 'clinic-cost-seeder' });

        this.clinicCostTable.grantWriteData(seederFn);

        const seederProvider = new cr.Provider(this, 'ClinicCostSeederProvider', {
            onEventHandler: seederFn,
        });

        new CustomResource(this, 'ClinicCostSeeder', {
            serviceToken: seederProvider.serviceToken,
            properties: {
                // Change this value to trigger re-seeding
                version: '1.2.0',
            },
        });

        // ========================================
        // CloudWatch Alarms
        // ========================================
        [
            { fn: this.costCrudFn, name: 'clinic-cost-crud', durationMs: Math.floor(Duration.seconds(10).toMilliseconds() * 0.8) },
        ].forEach(({ fn, name, durationMs }) => {
            createLambdaErrorAlarm(fn, name);
            createLambdaThrottleAlarm(fn, name);
            createLambdaDurationAlarm(fn, name, durationMs);
        });

        createDynamoThrottleAlarm(this.clinicCostTable.tableName, 'ClinicCostTable');

        // ========================================
        // DOMAIN MAPPING
        // ========================================
        // NOTE: The clinic-cost base path mapping is owned by the AdminN1 stack.
        // Do NOT create a duplicate CfnBasePathMapping here.

        // ========================================
        // OUTPUTS
        // ========================================

        new CfnOutput(this, 'ClinicCostTableName', {
            value: this.clinicCostTable.tableName,
            description: 'Name of the Clinic Cost of Operation DynamoDB table',
            exportName: `${Stack.of(this).stackName}-ClinicCostTableName`,
        });

        new CfnOutput(this, 'ClinicCostApiUrl', {
            value: 'https://api.todaysdentalservices.com/clinic-cost/',
            description: 'Clinic Cost API Gateway URL',
            exportName: `${Stack.of(this).stackName}-ClinicCostApiUrl`,
        });

        new CfnOutput(this, 'ClinicCostApiId', {
            value: this.api.restApiId,
            description: 'Clinic Cost API Gateway ID',
            exportName: `${Stack.of(this).stackName}-ClinicCostApiId`,
        });
    }
}
