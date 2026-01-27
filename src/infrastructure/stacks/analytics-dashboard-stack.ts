import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

/**
 * Analytics Dashboard Stack
 * 
 * Provides comprehensive daily analytics endpoint that aggregates data from:
 * - GA4 (Google Analytics 4)
 * - Google Ads
 * - Microsoft Clarity
 * - Calls (Chime/Analytics)
 * - Patient Portal
 * - AI Agents
 * - Open Dental Production
 */

export interface AnalyticsDashboardStackProps extends StackProps {
    jwtSecret: string;

    /**
     * Consolidated SFTP Transfer Server ID for Open Dental query results
     */
    consolidatedTransferServerId: string;

    /**
     * Authorizer Lambda function ARN from CoreStack (passed as string to avoid cyclic references)
     */
    authorizerFunctionArn: string;

    // ========================================
    // EXTERNAL TABLE REFERENCES
    // ========================================

    /**
     * Call Analytics table name from AnalyticsStack
     */
    callAnalyticsTableName?: string;
    callAnalyticsTableArn?: string;

    /**
     * AI Agents Metrics table name from AiAgentsStack
     */
    aiAgentsMetricsTableName?: string;
    aiAgentsMetricsTableArn?: string;

    /**
     * Patient Portal Metrics table name from PatientPortalStack
     */
    patientPortalMetricsTableName?: string;
    patientPortalMetricsTableArn?: string;

    /**
     * Clinic Config table name from CoreStack
     */
    clinicConfigTableName?: string;
    clinicConfigTableArn?: string;

    /**
     * Clinic Secrets table name from SecretsStack
     */
    clinicSecretsTableName?: string;
    clinicSecretsTableArn?: string;

    /**
     * Global Secrets table name from SecretsStack
     */
    globalSecretsTableName?: string;
    globalSecretsTableArn?: string;

    /**
     * Secrets encryption key ARN
     */
    secretsEncryptionKeyArn?: string;
}

export class AnalyticsDashboardStack extends Stack {
    public readonly dashboardLambda: lambda.IFunction;
    public readonly api: apigw.RestApi;

    constructor(scope: Construct, id: string, props: AnalyticsDashboardStackProps) {
        super(scope, id, props);

        // ========================================
        // Stack-wide tagging helpers
        // ========================================
        const baseTags: Record<string, string> = {
            Stack: Stack.of(this).stackName,
            Service: 'AnalyticsDashboard',
            ManagedBy: 'cdk',
        };
        const applyTags = (resource: Construct, extra?: Record<string, string>) => {
            Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
            if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
        };
        applyTags(this);

        // ========================================
        // Alarm helpers
        // ========================================
        const createLambdaErrorAlarm = (fn: lambda.IFunction, name: string) => {
            new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
                metric: fn.metricErrors({ period: Duration.minutes(1), statistic: 'Sum' }),
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: `Alert when ${name} Lambda has errors`,
            });
        };

        const createLambdaThrottleAlarm = (fn: lambda.IFunction, name: string) => {
            new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
                metric: fn.metricThrottles({ period: Duration.minutes(1), statistic: 'Sum' }),
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: `Alert when ${name} Lambda is throttled`,
            });
        };

        // ========================================
        // REST API WITH CORS
        // ========================================
        const corsConfig = getCdkCorsConfig();
        const corsErrorHeaders = getCorsErrorHeaders();

        this.api = new apigw.RestApi(this, 'AnalyticsDashboardApi', {
            restApiName: 'AnalyticsDashboardApi',
            description: 'Analytics Dashboard API - aggregates GA4, Google Ads, Clarity, calls, patient portal, AI agents, and Open Dental production',
            defaultCorsPreflightOptions: corsConfig,
            deployOptions: {
                stageName: 'prod',
                metricsEnabled: true,
                loggingLevel: apigw.MethodLoggingLevel.INFO,
                dataTraceEnabled: false,
            },
        });

        // CORS error responses
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

        new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
            restApi: this.api,
            type: apigw.ResponseType.ACCESS_DENIED,
            responseHeaders: corsErrorHeaders,
        });

        // ========================================
        // LAMBDA AUTHORIZER
        // ========================================
        // Import the authorizer function from ARN (avoids cross-stack cyclic dependency)
        const authorizerFn = lambda.Function.fromFunctionArn(
            this,
            'ImportedAuthorizerFunction',
            props.authorizerFunctionArn
        );

        const authorizer = new apigw.TokenAuthorizer(this, 'AnalyticsDashboardAuthorizer', {
            handler: authorizerFn,
            identitySource: 'method.request.header.Authorization',
            resultsCacheTtl: Duration.minutes(5),
        });

        // Grant API Gateway permission to invoke the authorizer Lambda
        // This is required when using imported functions (fromFunctionArn)
        // because CDK cannot automatically set up the permission
        new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
            action: 'lambda:InvokeFunction',
            functionName: props.authorizerFunctionArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${this.api.restApiId}/authorizers/*`,
        });

        // ========================================
        // ANALYTICS DASHBOARD LAMBDA
        // ========================================

        const dashboardFn = new lambdaNode.NodejsFunction(this, 'AnalyticsDashboardFunction', {
            functionName: `${this.stackName}-AnalyticsDashboard`,
            entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'analytics-dashboard.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: Duration.seconds(120), // Extended timeout for SFTP operations and aggregating from multiple sources
            memorySize: 1024, // Higher memory for parallel fetches and SFTP operations
            bundling: {
                // SSH2 requires native bindings so we need special handling
                externalModules: ['ssh2', 'cpu-features'],
                nodeModules: ['ssh2'],
                minify: true,
                sourceMap: true,
            },
            environment: {
                JWT_SECRET: props.jwtSecret,
                CALL_ANALYTICS_TABLE_NAME: props.callAnalyticsTableName || '',
                AI_AGENTS_METRICS_TABLE_NAME: props.aiAgentsMetricsTableName || '',
                PATIENT_PORTAL_METRICS_TABLE_NAME: props.patientPortalMetricsTableName || '',
                CLINIC_CONFIG_TABLE_NAME: props.clinicConfigTableName || '',
                CLINIC_SECRETS_TABLE_NAME: props.clinicSecretsTableName || '',
                GLOBAL_SECRETS_TABLE_NAME: props.globalSecretsTableName || '',
                // SFTP configuration for Open Dental query results
                CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
                NODE_OPTIONS: '--enable-source-maps',
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        applyTags(dashboardFn, { Function: 'analytics-dashboard' });

        // ========================================
        // IAM PERMISSIONS
        // ========================================

        // Call Analytics table permissions
        if (props.callAnalyticsTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.callAnalyticsTableArn,
                    `${props.callAnalyticsTableArn}/index/*`,
                ],
            }));
        }

        // AI Agents Metrics table permissions
        if (props.aiAgentsMetricsTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.aiAgentsMetricsTableArn,
                    `${props.aiAgentsMetricsTableArn}/index/*`,
                ],
            }));
        }

        // Patient Portal Metrics table permissions
        if (props.patientPortalMetricsTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.patientPortalMetricsTableArn,
                    `${props.patientPortalMetricsTableArn}/index/*`,
                ],
            }));
        }

        // Clinic Config table permissions
        if (props.clinicConfigTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.clinicConfigTableArn,
                    `${props.clinicConfigTableArn}/index/*`,
                ],
            }));
        }

        // Clinic Secrets table permissions (for Clarity API tokens, etc.)
        if (props.clinicSecretsTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:GetItem'],
                resources: [
                    props.clinicSecretsTableArn,
                ],
            }));
        }

        // Global Secrets table permissions (for GA4 and other API credentials)
        if (props.globalSecretsTableArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:Query', 'dynamodb:GetItem'],
                resources: [
                    props.globalSecretsTableArn,
                    `${props.globalSecretsTableArn}/index/*`,
                ],
            }));
        }

        // KMS permissions for decrypting secrets
        if (props.secretsEncryptionKeyArn) {
            dashboardFn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['kms:Decrypt'],
                resources: [props.secretsEncryptionKeyArn],
            }));
        }

        // Create alarms
        createLambdaErrorAlarm(dashboardFn, 'AnalyticsDashboard');
        createLambdaThrottleAlarm(dashboardFn, 'AnalyticsDashboard');

        this.dashboardLambda = dashboardFn;

        // ========================================
        // API GATEWAY ROUTES
        // ========================================

        const integration = new apigw.LambdaIntegration(dashboardFn, {
            proxy: true,
        });

        // Create /analytics resource
        const analyticsResource = this.api.root.addResource('analytics', {
            defaultCorsPreflightOptions: corsConfig,
        });

        // Create /analytics/dashboard resource
        const dashboardResource = analyticsResource.addResource('dashboard', {
            defaultCorsPreflightOptions: corsConfig,
        });

        // GET /analytics/dashboard - Single clinic analytics
        dashboardResource.addMethod('GET', integration, {
            authorizer: authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        // Create /analytics/dashboard/all resource
        const allResource = dashboardResource.addResource('all', {
            defaultCorsPreflightOptions: corsConfig,
        });

        // GET /analytics/dashboard/all - All clinics analytics
        allResource.addMethod('GET', integration, {
            authorizer: authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        // Create /analytics/dashboard/{clinicId} resource
        const clinicResource = dashboardResource.addResource('{clinicId}', {
            defaultCorsPreflightOptions: corsConfig,
        });

        // GET /analytics/dashboard/{clinicId} - Specific clinic analytics
        clinicResource.addMethod('GET', integration, {
            authorizer: authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        console.log('[AnalyticsDashboardStack] API routes configured:');
        console.log('  - GET /analytics/dashboard - Single clinic analytics (with query params)');
        console.log('  - GET /analytics/dashboard/all - All clinics analytics');
        console.log('  - GET /analytics/dashboard/{clinicId} - Specific clinic analytics');

        // ========================================
        // CUSTOM DOMAIN MAPPING
        // ========================================
        new apigw.CfnBasePathMapping(this, 'AnalyticsDashboardApiBasePathMapping', {
            domainName: 'apig.todaysdentalinsights.com',
            basePath: 'analytics-dashboard',
            restApiId: this.api.restApiId,
            stage: this.api.deploymentStage.stageName,
        });

        // ========================================
        // OUTPUTS
        // ========================================

        new CfnOutput(this, 'ApiUrl', {
            value: 'https://apig.todaysdentalinsights.com/analytics-dashboard/',
            description: 'Analytics Dashboard API endpoint URL',
            exportName: `${this.stackName}-ApiUrl`,
        });

        new CfnOutput(this, 'DashboardLambdaArn', {
            value: dashboardFn.functionArn,
            description: 'Analytics Dashboard Lambda ARN',
            exportName: `${this.stackName}-DashboardLambdaArn`,
        });

        new CfnOutput(this, 'DashboardLambdaName', {
            value: dashboardFn.functionName,
            description: 'Analytics Dashboard Lambda Name',
            exportName: `${this.stackName}-DashboardLambdaName`,
        });
    }
}
