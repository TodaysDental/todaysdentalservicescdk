/**
 * Meta Ads CDK Stack
 *
 * Provisions the full Meta Ads backend infrastructure:
 * - DynamoDB table (MetaAdsCampaigns)
 * - API Gateway (TodaysDentalInsights-MetaAds)
 * - 7 Lambda functions
 * - IAM permissions & CORS
 * - Custom domain base path mapping (/meta-ads)
 */

import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

// ============================================
// PROPS
// ============================================

export interface MetaAdsStackProps extends StackProps {
    authorizerFunctionArn: string;
    /** GlobalSecrets DynamoDB table name for retrieving credentials */
    globalSecretsTableName: string;
    /** ClinicSecrets DynamoDB table name for per-clinic credentials */
    clinicSecretsTableName: string;
    /** ClinicConfig DynamoDB table name for clinic configuration */
    clinicConfigTableName: string;
    /** KMS key ARN for decrypting secrets */
    secretsEncryptionKeyArn: string;
}

// ============================================
// STACK
// ============================================

export class MetaAdsStack extends Stack {
    public readonly campaignsTable: dynamodb.Table;
    public readonly api: apigw.RestApi;

    constructor(scope: Construct, id: string, props: MetaAdsStackProps) {
        super(scope, id, props);

        // ============================================
        // 1. DynamoDB Tables
        // ============================================

        this.campaignsTable = new dynamodb.Table(this, 'MetaAdsCampaignsTable', {
            tableName: `${this.stackName}-Campaigns`,
            partitionKey: { name: 'campaignId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        // GSI: ByAdAccount — query campaigns by Meta ad account ID
        this.campaignsTable.addGlobalSecondaryIndex({
            indexName: 'ByAdAccount',
            partitionKey: { name: 'adAccountId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // GSI: ByClinic — query campaigns by clinicId (for multi-clinic ops)
        this.campaignsTable.addGlobalSecondaryIndex({
            indexName: 'ByClinic',
            partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ============================================
        // 2. API Gateway
        // ============================================

        this.api = new apigw.RestApi(this, 'MetaAdsApi', {
            restApiName: 'TodaysDentalInsights-MetaAds',
            description: 'Meta Ads API for Today\'s Dental Insights',
            deployOptions: { stageName: 'prod' },
            defaultCorsPreflightOptions: getCdkCorsConfig(),
        });

        // Import authorizer
        const authorizerFn = lambda.Function.fromFunctionArn(
            this, 'ImportedAuthorizerFn', props.authorizerFunctionArn
        );

        const authorizer = new apigw.RequestAuthorizer(this, 'MetaAdsAuthorizer', {
            handler: authorizerFn,
            identitySources: [apigw.IdentitySource.header('Authorization')],
            resultsCacheTtl: Duration.minutes(5),
        });

        new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
            action: 'lambda:InvokeFunction',
            functionName: props.authorizerFunctionArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
        });

        // CORS error responses
        const corsErrorHeaders = getCorsErrorHeaders();
        const corsResponseParameters: { [key: string]: string } = {};
        for (const [key, value] of Object.entries(corsErrorHeaders)) {
            corsResponseParameters[`gatewayresponse.header.${key}`] = `'${value}'`;
        }

        new apigw.GatewayResponse(this, 'UnauthorizedResponse', {
            restApi: this.api,
            type: apigw.ResponseType.UNAUTHORIZED,
            statusCode: '401',
            responseHeaders: corsResponseParameters,
        });

        new apigw.GatewayResponse(this, 'AccessDeniedResponse', {
            restApi: this.api,
            type: apigw.ResponseType.ACCESS_DENIED,
            statusCode: '403',
            responseHeaders: corsResponseParameters,
        });

        // ============================================
        // 3. Environment Variables
        // ============================================

        const envVars = {
            NODE_OPTIONS: '--enable-source-maps',
            GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
            CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
            CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
            SECRETS_ENCRYPTION_KEY_ARN: props.secretsEncryptionKeyArn,
            META_ADS_CAMPAIGNS_TABLE: this.campaignsTable.tableName,
            ALLOWED_ORIGINS: ALLOWED_ORIGINS_LIST.join(','),
        };

        // ============================================
        // 4. Lambda Functions
        // ============================================

        const campaignsFn = new lambdaNode.NodejsFunction(this, 'CampaignsFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(60),
            environment: envVars,
        });

        const adsetsFn = new lambdaNode.NodejsFunction(this, 'AdSetsFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-adsets.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(60),
            environment: envVars,
        });

        const creativesFn = new lambdaNode.NodejsFunction(this, 'CreativesFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-creatives.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(60),
            environment: envVars,
        });

        const insightsFn = new lambdaNode.NodejsFunction(this, 'InsightsFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-insights.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(60),
            environment: envVars,
        });

        const audiencesFn = new lambdaNode.NodejsFunction(this, 'AudiencesFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-audiences.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(60),
            environment: envVars,
        });

        const mediaFn = new lambdaNode.NodejsFunction(this, 'MediaFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-media.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 1024,
            timeout: Duration.seconds(120),
            environment: envVars,
        });

        const bulkFn = new lambdaNode.NodejsFunction(this, 'BulkFn', {
            entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'meta-ads-bulk.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: Duration.seconds(300),
            environment: envVars,
        });

        // ============================================
        // 5. DynamoDB Permissions
        // ============================================

        this.campaignsTable.grantReadWriteData(campaignsFn);
        this.campaignsTable.grantReadWriteData(bulkFn);

        // All Lambdas need access to secrets tables
        const allLambdas = [
            campaignsFn, adsetsFn, creativesFn, insightsFn,
            audiencesFn, mediaFn, bulkFn,
        ];

        const secretsTableArns = [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
        ];

        for (const fn of allLambdas) {
            fn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
                resources: secretsTableArns,
            }));

            fn.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['kms:Decrypt'],
                resources: [props.secretsEncryptionKeyArn],
            }));
        }

        // ============================================
        // 6. API Routes
        // ============================================

        const root = this.api.root;

        // --- Account Routes ---
        const accountsRes = root.addResource('accounts');
        accountsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        const accountByIdRes = accountsRes.addResource('{id}');
        accountByIdRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        // --- Settings Routes ---
        const settingsRes = root.addResource('settings');
        settingsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
        settingsRes.addMethod('PUT', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        // --- Dashboard Route ---
        const dashboardRes = root.addResource('dashboard');
        dashboardRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        // --- Campaign Routes ---
        const campaignsRes = root.addResource('campaigns');
        campaignsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
        campaignsRes.addMethod('POST', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        const campaignByIdRes = campaignsRes.addResource('{id}');
        campaignByIdRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
        campaignByIdRes.addMethod('PUT', new apigw.LambdaIntegration(campaignsFn), { authorizer });
        campaignByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(campaignsFn), { authorizer });

        // --- Ad Set Routes ---
        const adsetsRes = root.addResource('adsets');
        adsetsRes.addMethod('GET', new apigw.LambdaIntegration(adsetsFn), { authorizer });
        adsetsRes.addMethod('POST', new apigw.LambdaIntegration(adsetsFn), { authorizer });

        const adsetByIdRes = adsetsRes.addResource('{id}');
        adsetByIdRes.addMethod('GET', new apigw.LambdaIntegration(adsetsFn), { authorizer });
        adsetByIdRes.addMethod('PUT', new apigw.LambdaIntegration(adsetsFn), { authorizer });
        adsetByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(adsetsFn), { authorizer });

        // --- Creative Routes ---
        const creativesRes = root.addResource('creatives');
        creativesRes.addMethod('GET', new apigw.LambdaIntegration(creativesFn), { authorizer });
        creativesRes.addMethod('POST', new apigw.LambdaIntegration(creativesFn), { authorizer });

        const creativeByIdRes = creativesRes.addResource('{id}');
        creativeByIdRes.addMethod('GET', new apigw.LambdaIntegration(creativesFn), { authorizer });
        creativeByIdRes.addMethod('PUT', new apigw.LambdaIntegration(creativesFn), { authorizer });

        // --- Ad Routes ---
        const adsRes = root.addResource('ads');
        adsRes.addMethod('GET', new apigw.LambdaIntegration(creativesFn), { authorizer });
        adsRes.addMethod('POST', new apigw.LambdaIntegration(creativesFn), { authorizer });

        const adByIdRes = adsRes.addResource('{id}');
        adByIdRes.addMethod('GET', new apigw.LambdaIntegration(creativesFn), { authorizer });
        adByIdRes.addMethod('PUT', new apigw.LambdaIntegration(creativesFn), { authorizer });
        adByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(creativesFn), { authorizer });

        // --- Insights Routes ---
        const insightsRes = root.addResource('insights');
        const insightsAccountRes = insightsRes.addResource('account');
        const insightsAccountByIdRes = insightsAccountRes.addResource('{id}');
        insightsAccountByIdRes.addMethod('GET', new apigw.LambdaIntegration(insightsFn), { authorizer });

        const insightsCampaignRes = insightsRes.addResource('campaign');
        const insightsCampaignByIdRes = insightsCampaignRes.addResource('{id}');
        insightsCampaignByIdRes.addMethod('GET', new apigw.LambdaIntegration(insightsFn), { authorizer });

        const insightsAdSetRes = insightsRes.addResource('adset');
        const insightsAdSetByIdRes = insightsAdSetRes.addResource('{id}');
        insightsAdSetByIdRes.addMethod('GET', new apigw.LambdaIntegration(insightsFn), { authorizer });

        const insightsAdRes = insightsRes.addResource('ad');
        const insightsAdByIdRes = insightsAdRes.addResource('{id}');
        insightsAdByIdRes.addMethod('GET', new apigw.LambdaIntegration(insightsFn), { authorizer });

        // --- Audience Routes ---
        const audiencesRes = root.addResource('audiences');
        audiencesRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });
        audiencesRes.addMethod('POST', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const audienceLookalikeRes = audiencesRes.addResource('lookalike');
        audienceLookalikeRes.addMethod('POST', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const audienceByIdRes = audiencesRes.addResource('{id}');
        audienceByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        // --- Interest & Behavior Routes ---
        const interestsRes = root.addResource('interests');
        const interestsSearchRes = interestsRes.addResource('search');
        interestsSearchRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const behaviorsRes = root.addResource('behaviors');
        behaviorsRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        // --- Reach Estimate ---
        const reachEstimateRes = root.addResource('reach-estimate');
        reachEstimateRes.addMethod('POST', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        // --- Pixel Routes ---
        const pixelsRes = root.addResource('pixels');
        pixelsRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const pixelByIdRes = pixelsRes.addResource('{id}');
        const pixelEventsRes = pixelByIdRes.addResource('events');
        pixelEventsRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        // --- Lead Routes ---
        const leadsRes = root.addResource('leads');

        const leadsFormsRes = leadsRes.addResource('forms');
        leadsFormsRes.addMethod('POST', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const leadsFormsByPageRes = leadsFormsRes.addResource('{pageId}');
        leadsFormsByPageRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const leadsByFormRes = leadsRes.addResource('{formId}');
        leadsByFormRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        const leadsAdRes = leadsRes.addResource('ad');
        const leadsAdByIdRes = leadsAdRes.addResource('{adId}');
        leadsAdByIdRes.addMethod('GET', new apigw.LambdaIntegration(audiencesFn), { authorizer });

        // --- Media Routes ---
        const mediaRes = root.addResource('media');

        const mediaImagesRes = mediaRes.addResource('images');
        mediaImagesRes.addMethod('GET', new apigw.LambdaIntegration(mediaFn), { authorizer });
        mediaImagesRes.addMethod('POST', new apigw.LambdaIntegration(mediaFn), { authorizer });

        const mediaVideosRes = mediaRes.addResource('videos');
        mediaVideosRes.addMethod('GET', new apigw.LambdaIntegration(mediaFn), { authorizer });
        mediaVideosRes.addMethod('POST', new apigw.LambdaIntegration(mediaFn), { authorizer });

        // --- Bulk Routes ---
        const bulkRes = root.addResource('bulk');

        const bulkPublishRes = bulkRes.addResource('publish');
        bulkPublishRes.addMethod('POST', new apigw.LambdaIntegration(bulkFn), { authorizer });

        const bulkBatchRes = bulkRes.addResource('{batchId}');
        const bulkBatchStatusRes = bulkBatchRes.addResource('status');
        bulkBatchStatusRes.addMethod('GET', new apigw.LambdaIntegration(bulkFn), { authorizer });

        // ============================================
        // 7. Outputs
        // ============================================

        new CfnOutput(this, 'MetaAdsApiUrl', {
            value: this.api.url,
            exportName: `${this.stackName}-ApiUrl`,
        });

        new CfnOutput(this, 'CampaignsTableName', {
            value: this.campaignsTable.tableName,
            exportName: `${this.stackName}-CampaignsTableName`,
        });

        // ============================================
        // 8. Custom Domain Mapping
        // ============================================

        new apigw.CfnBasePathMapping(this, 'MetaAdsBasePathMapping', {
            domainName: 'apig.todaysdentalinsights.com',
            basePath: 'meta-ads',
            restApiId: this.api.restApiId,
            stage: this.api.deploymentStage.stageName,
        });

        new CfnOutput(this, 'MetaAdsCustomApiUrl', {
            value: 'https://apig.todaysdentalinsights.com/meta-ads/',
            description: 'Custom domain URL for Meta Ads API',
            exportName: `${this.stackName}-CustomApiUrl`,
        });
    }
}
