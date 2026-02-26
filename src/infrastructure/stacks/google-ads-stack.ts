import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { getCdkCorsConfig, getCorsErrorHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

export interface GoogleAdsStackProps extends StackProps {
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

export class GoogleAdsStack extends Stack {
  // DynamoDB Tables
  public readonly campaignsTable: dynamodb.Table;
  public readonly keywordsTable: dynamodb.Table;
  public readonly searchQueriesTable: dynamodb.Table;

  // API Gateway
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: GoogleAdsStackProps) {
    super(scope, id, props);

    // ============================================
    // 1. DynamoDB Tables
    // ============================================

    // Table: GoogleAdsCampaigns - Google Ads campaign data
    this.campaignsTable = new dynamodb.Table(this, 'GoogleAdsCampaignsTable', {
      tableName: `${this.stackName}-Campaigns`,
      partitionKey: { name: 'campaignId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByCustomer - Query campaigns by customerId (Google Ads Customer ID)
    this.campaignsTable.addGlobalSecondaryIndex({
      indexName: 'ByCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: ByClinic - Query campaigns by clinicId for easier lookup
    this.campaignsTable.addGlobalSecondaryIndex({
      indexName: 'ByClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Table: GoogleAdsKeywords
    this.keywordsTable = new dynamodb.Table(this, 'GoogleAdsKeywordsTable', {
      tableName: `${this.stackName}-Keywords`,
      partitionKey: { name: 'keywordId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByCustomer - Query keywords by customerId
    this.keywordsTable.addGlobalSecondaryIndex({
      indexName: 'ByCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Table: GoogleAdsSearchQueries
    this.searchQueriesTable = new dynamodb.Table(this, 'GoogleAdsSearchQueriesTable', {
      tableName: `${this.stackName}-SearchQueries`,
      partitionKey: { name: 'queryId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByCustomer - Query search terms by customerId
    this.searchQueriesTable.addGlobalSecondaryIndex({
      indexName: 'ByCustomer',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ============================================
    // 2. API Gateway
    // ============================================

    this.api = new apigw.RestApi(this, 'GoogleAdsApi', {
      restApiName: 'TodaysDentalInsights-GoogleAds',
      description: 'Google Ads API for Today\'s Dental Insights',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: getCdkCorsConfig(),
    });

    // Import the Lambda authorizer function
    const authorizerFn = lambda.Function.fromFunctionArn(
      this, 'ImportedAuthorizerFn', props.authorizerFunctionArn
    );

    // Create Request Authorizer using imported function
    // NOTE: Using RequestAuthorizer (not TokenAuthorizer) to match other stacks
    const authorizer = new apigw.RequestAuthorizer(this, 'GoogleAdsAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // This is required when using an imported function from another stack
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: props.authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // Add CORS error responses
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
      GOOGLE_ADS_CAMPAIGNS_TABLE: this.campaignsTable.tableName,
      GOOGLE_ADS_KEYWORDS_TABLE: this.keywordsTable.tableName,
      GOOGLE_ADS_SEARCH_QUERIES_TABLE: this.searchQueriesTable.tableName,
      ALLOWED_ORIGINS: ALLOWED_ORIGINS_LIST.join(','),
    };

    // ============================================
    // 4. Lambda Functions
    // ============================================

    // Google Ads Campaigns Lambda
    const campaignsFn = new lambdaNode.NodejsFunction(this, 'CampaignsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Google Ads Keywords Lambda
    const keywordsFn = new lambdaNode.NodejsFunction(this, 'KeywordsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-keywords.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Google Ads Search Queries Lambda
    const searchQueriesFn = new lambdaNode.NodejsFunction(this, 'SearchQueriesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-search-queries.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(300),
      environment: envVars,
    });

    // Google Ads Bulk Operations Lambda
    const bulkFn = new lambdaNode.NodejsFunction(this, 'BulkFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-bulk.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(300),
      environment: envVars,
    });

    // Google Ads AI Suggestions Lambda (Bedrock Integration)
    // NOTE: Bedrock Claude calls can take 15-30+ seconds, so we need a higher timeout
    const aiFn = new lambdaNode.NodejsFunction(this, 'AiFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-ai.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.seconds(90),
      environment: envVars,
    });

    // Create a Lambda integration with extended timeout for AI operations
    const aiIntegration = new apigw.LambdaIntegration(aiFn, {
      timeout: Duration.seconds(29),
    });

    // Grant Bedrock permissions to AI Lambda
    aiFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['arn:aws:bedrock:*::foundation-model/*'],
    }));

    // Google Ads Ads Management Lambda
    const adsFn = new lambdaNode.NodejsFunction(this, 'AdsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-ads.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Google Ads Targeting Lambda
    const targetingFn = new lambdaNode.NodejsFunction(this, 'TargetingFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-targeting.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Google Ads Conversions Lambda
    const conversionsFn = new lambdaNode.NodejsFunction(this, 'ConversionsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-conversions.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(120),
      environment: envVars,
    });

    // Google Ads Reports Lambda
    const reportsFn = new lambdaNode.NodejsFunction(this, 'ReportsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-reports.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.seconds(300),
      environment: envVars,
    });

    // Google Ads Performance Max Lambda
    const pmaxFn = new lambdaNode.NodejsFunction(this, 'PMaxFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-pmax.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(120),
      environment: envVars,
    });

    // Google Ads Account Management Lambda
    const accountFn = new lambdaNode.NodejsFunction(this, 'AccountFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'google-ads-account.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // ============================================
    // 5. DynamoDB Permissions
    // ============================================

    this.campaignsTable.grantReadWriteData(campaignsFn);
    this.keywordsTable.grantReadWriteData(keywordsFn);
    this.searchQueriesTable.grantReadWriteData(searchQueriesFn);
    this.campaignsTable.grantReadWriteData(bulkFn);
    this.keywordsTable.grantReadWriteData(bulkFn);

    // All Lambdas need access to secrets tables
    const allLambdas = [
      campaignsFn, keywordsFn, searchQueriesFn, bulkFn, aiFn, adsFn,
      targetingFn, conversionsFn, reportsFn, pmaxFn, accountFn,
    ];

    // Grant secrets table access and KMS permissions to all lambdas
    const secretsTableArns = [
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
    ];

    for (const fn of allLambdas) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: secretsTableArns,
      }));

      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Decrypt',
        ],
        resources: [props.secretsEncryptionKeyArn],
      }));
    }

    // ============================================
    // 6. API Routes
    // ============================================

    const root = this.api.root;

    // --- Campaign Routes ---
    const campaignsRes = root.addResource('campaigns');
    campaignsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    campaignsRes.addMethod('POST', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    const campaignByIdRes = campaignsRes.addResource('{id}');
    campaignByIdRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    campaignByIdRes.addMethod('PUT', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    campaignByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    // --- Ad Groups Routes ---
    const adGroupsRes = root.addResource('ad-groups');
    adGroupsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    adGroupsRes.addMethod('POST', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    const adGroupByIdRes = adGroupsRes.addResource('{id}');
    adGroupByIdRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    adGroupByIdRes.addMethod('PUT', new apigw.LambdaIntegration(campaignsFn), { authorizer });
    adGroupByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    // --- Clinics Route ---
    const clinicsRes = root.addResource('clinics');
    clinicsRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    // --- Dashboard Route ---
    const dashboardRes = root.addResource('dashboard');
    dashboardRes.addMethod('GET', new apigw.LambdaIntegration(campaignsFn), { authorizer });

    // --- Keyword Routes ---
    const keywordsRes = root.addResource('keywords');

    const keywordsFetchRes = keywordsRes.addResource('fetch');
    keywordsFetchRes.addMethod('GET', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    const keywordsAddRes = keywordsRes.addResource('add');
    keywordsAddRes.addMethod('POST', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    const keywordsDeleteRes = keywordsRes.addResource('delete');
    keywordsDeleteRes.addMethod('POST', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    const keywordsNegativesRes = keywordsRes.addResource('negatives');
    keywordsNegativesRes.addMethod('GET', new apigw.LambdaIntegration(keywordsFn), { authorizer });
    keywordsNegativesRes.addMethod('POST', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    const keywordsNegativeByIdRes = keywordsNegativesRes.addResource('{id}');
    keywordsNegativeByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    const keywordsTemplatesRes = keywordsRes.addResource('templates');
    keywordsTemplatesRes.addMethod('GET', new apigw.LambdaIntegration(keywordsFn), { authorizer });

    // --- Search Query Routes ---
    const searchQueriesRes = root.addResource('search-queries');

    const searchQueriesReportRes = searchQueriesRes.addResource('report');
    searchQueriesReportRes.addMethod('GET', new apigw.LambdaIntegration(searchQueriesFn), { authorizer });

    const searchQueriesGlobalRes = searchQueriesRes.addResource('global');
    searchQueriesGlobalRes.addMethod('GET', new apigw.LambdaIntegration(searchQueriesFn), { authorizer });

    // --- Bulk Operation Routes ---
    const bulkRes = root.addResource('bulk');

    const bulkClinicsRes = bulkRes.addResource('clinics');
    bulkClinicsRes.addMethod('GET', new apigw.LambdaIntegration(bulkFn), { authorizer });

    const bulkPublishRes = bulkRes.addResource('publish');
    bulkPublishRes.addMethod('POST', new apigw.LambdaIntegration(bulkFn), { authorizer });

    const bulkKeywordsRes = bulkRes.addResource('keywords');
    bulkKeywordsRes.addMethod('POST', new apigw.LambdaIntegration(bulkFn), { authorizer });

    const bulkRateLimitRes = bulkRes.addResource('rate-limit');
    bulkRateLimitRes.addMethod('GET', new apigw.LambdaIntegration(bulkFn), { authorizer });

    // --- AI Suggestions Routes ---
    const aiRes = root.addResource('ai');

    const aiHeadlinesRes = aiRes.addResource('headlines');
    aiHeadlinesRes.addMethod('POST', aiIntegration, { authorizer });

    const aiDescriptionsRes = aiRes.addResource('descriptions');
    aiDescriptionsRes.addMethod('POST', aiIntegration, { authorizer });

    const aiKeywordsRes = aiRes.addResource('keywords');
    aiKeywordsRes.addMethod('POST', aiIntegration, { authorizer });

    const aiNegativeKeywordsRes = aiRes.addResource('negative-keywords');
    aiNegativeKeywordsRes.addMethod('POST', aiIntegration, { authorizer });

    const aiAnalyzeRes = aiRes.addResource('analyze-queries');
    aiAnalyzeRes.addMethod('POST', aiIntegration, { authorizer });

    const aiClinicContextRes = aiRes.addResource('clinic-context');
    const aiClinicContextByIdRes = aiClinicContextRes.addResource('{clinicId}');
    aiClinicContextByIdRes.addMethod('GET', aiIntegration, { authorizer });

    // --- Ads Management Routes ---
    const adsRes = root.addResource('ads');
    adsRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });
    adsRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    const adByIdRes = adsRes.addResource('{id}');
    adByIdRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });
    adByIdRes.addMethod('PUT', new apigw.LambdaIntegration(adsFn), { authorizer });
    adByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(adsFn), { authorizer });

    const adsPauseRes = adsRes.addResource('pause');
    adsPauseRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    const adsEnableRes = adsRes.addResource('enable');
    adsEnableRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    // --- Ad Extensions Routes ---
    const extensionsRes = root.addResource('extensions');
    extensionsRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });
    extensionsRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    const extensionByIdRes = extensionsRes.addResource('{id}');
    extensionByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(adsFn), { authorizer });

    // --- Targeting Routes ---
    const targetingRes = root.addResource('targeting');

    const targetingLocationsRes = targetingRes.addResource('locations');
    targetingLocationsRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });
    targetingLocationsRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });
    const targetingLocationByIdRes = targetingLocationsRes.addResource('{id}');
    targetingLocationByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingAudiencesRes = targetingRes.addResource('audiences');
    targetingAudiencesRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });
    targetingAudiencesRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });
    const targetingAudienceByIdRes = targetingAudiencesRes.addResource('{id}');
    targetingAudienceByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingDemographicsRes = targetingRes.addResource('demographics');
    targetingDemographicsRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });
    targetingDemographicsRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingDevicesRes = targetingRes.addResource('devices');
    targetingDevicesRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });
    targetingDevicesRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingScheduleRes = targetingRes.addResource('schedule');
    targetingScheduleRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });
    targetingScheduleRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingGeoSearchRes = targetingRes.addResource('geo-search');
    targetingGeoSearchRes.addMethod('GET', new apigw.LambdaIntegration(targetingFn), { authorizer });

    const targetingRadiusRes = targetingRes.addResource('radius');
    targetingRadiusRes.addMethod('POST', new apigw.LambdaIntegration(targetingFn), { authorizer });

    // --- Conversions Routes ---
    const conversionsRes = root.addResource('conversions');
    conversionsRes.addMethod('GET', new apigw.LambdaIntegration(conversionsFn), { authorizer });
    conversionsRes.addMethod('POST', new apigw.LambdaIntegration(conversionsFn), { authorizer });

    const conversionByIdRes = conversionsRes.addResource('{id}');
    conversionByIdRes.addMethod('GET', new apigw.LambdaIntegration(conversionsFn), { authorizer });
    conversionByIdRes.addMethod('PUT', new apigw.LambdaIntegration(conversionsFn), { authorizer });

    const conversionsUploadRes = conversionsRes.addResource('upload');
    conversionsUploadRes.addMethod('POST', new apigw.LambdaIntegration(conversionsFn), { authorizer });

    const conversionsTagRes = conversionsRes.addResource('tag');
    conversionsTagRes.addMethod('GET', new apigw.LambdaIntegration(conversionsFn), { authorizer });

    // --- Reports Routes ---
    const reportsRes = root.addResource('reports');

    const reportsCampaignRes = reportsRes.addResource('campaign');
    reportsCampaignRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsAdgroupRes = reportsRes.addResource('adgroup');
    reportsAdgroupRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsAdRes = reportsRes.addResource('ad');
    reportsAdRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsKeywordRes = reportsRes.addResource('keyword');
    reportsKeywordRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsGeographicRes = reportsRes.addResource('geographic');
    reportsGeographicRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsDeviceRes = reportsRes.addResource('device');
    reportsDeviceRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsDownloadRes = reportsRes.addResource('download');
    reportsDownloadRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    const reportsSummaryRes = reportsRes.addResource('summary');
    reportsSummaryRes.addMethod('GET', new apigw.LambdaIntegration(reportsFn), { authorizer });

    // --- Performance Max Routes ---
    const pmaxRes = root.addResource('pmax');

    const pmaxCampaignsRes = pmaxRes.addResource('campaigns');
    pmaxCampaignsRes.addMethod('GET', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    pmaxCampaignsRes.addMethod('POST', new apigw.LambdaIntegration(pmaxFn), { authorizer });

    const pmaxAssetGroupsRes = pmaxRes.addResource('asset-groups');
    pmaxAssetGroupsRes.addMethod('GET', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    pmaxAssetGroupsRes.addMethod('POST', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    const pmaxAssetGroupByIdRes = pmaxAssetGroupsRes.addResource('{id}');
    pmaxAssetGroupByIdRes.addMethod('GET', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    pmaxAssetGroupByIdRes.addMethod('PUT', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    pmaxAssetGroupByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(pmaxFn), { authorizer });


    const pmaxAssetsRes = pmaxRes.addResource('assets');
    pmaxAssetsRes.addMethod('GET', new apigw.LambdaIntegration(pmaxFn), { authorizer });
    pmaxAssetsRes.addMethod('POST', new apigw.LambdaIntegration(pmaxFn), { authorizer });

    const pmaxListingGroupsRes = pmaxRes.addResource('listing-groups');
    pmaxListingGroupsRes.addMethod('GET', new apigw.LambdaIntegration(pmaxFn), { authorizer });

    // --- Account Management Routes ---
    const accountRes = root.addResource('account');

    const accountStructureRes = accountRes.addResource('structure');
    accountStructureRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountBudgetsRes = accountRes.addResource('budgets');
    accountBudgetsRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });
    accountBudgetsRes.addMethod('POST', new apigw.LambdaIntegration(accountFn), { authorizer });
    const accountBudgetByIdRes = accountBudgetsRes.addResource('{id}');
    accountBudgetByIdRes.addMethod('PUT', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountRecommendationsRes = accountRes.addResource('recommendations');
    accountRecommendationsRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountExperimentsRes = accountRes.addResource('experiments');
    accountExperimentsRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });
    accountExperimentsRes.addMethod('POST', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountBillingRes = accountRes.addResource('billing');
    accountBillingRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountChangeHistoryRes = accountRes.addResource('change-history');
    accountChangeHistoryRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });

    const accountLabelsRes = accountRes.addResource('labels');
    accountLabelsRes.addMethod('GET', new apigw.LambdaIntegration(accountFn), { authorizer });
    accountLabelsRes.addMethod('POST', new apigw.LambdaIntegration(accountFn), { authorizer });

    // ============================================
    // 7. Outputs
    // ============================================
    new CfnOutput(this, 'GoogleAdsApiUrl', {
      value: this.api.url,
      exportName: `${this.stackName}-ApiUrl`,
    });

    new CfnOutput(this, 'CampaignsTableName', {
      value: this.campaignsTable.tableName,
      exportName: `${this.stackName}-CampaignsTableName`,
    });

    new CfnOutput(this, 'KeywordsTableName', {
      value: this.keywordsTable.tableName,
      exportName: `${this.stackName}-KeywordsTableName`,
    });

    new CfnOutput(this, 'SearchQueriesTableName', {
      value: this.searchQueriesTable.tableName,
      exportName: `${this.stackName}-SearchQueriesTableName`,
    });

    // ============================================
    // 8. Custom Domain Mapping
    // ============================================
    // Map this API under the existing custom domain as /google-ads
    new apigw.CfnBasePathMapping(this, 'GoogleAdsBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'google-ads',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    new CfnOutput(this, 'GoogleAdsCustomApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/google-ads/',
      description: 'Custom domain URL for Google Ads API',
      exportName: `${this.stackName}-CustomApiUrl`,
    });
  }
}
