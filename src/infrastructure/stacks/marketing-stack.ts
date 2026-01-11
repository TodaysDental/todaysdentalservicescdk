import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { getCdkCorsConfig, getCorsErrorHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

export interface MarketingStackProps extends StackProps {
  authorizerFunctionArn: string;
  /** GlobalSecrets DynamoDB table name for retrieving Ayrshare credentials */
  globalSecretsTableName: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn: string;
}

export class MarketingStack extends Stack {
  // DynamoDB Tables
  public readonly marketingProfilesTable: dynamodb.Table;
  public readonly marketingPostsTable: dynamodb.Table;
  public readonly marketingCommentsTable: dynamodb.Table;
  public readonly marketingMediaTable: dynamodb.Table;
  public readonly marketingAnalyticsTable: dynamodb.Table;

  // S3 Bucket for media
  public readonly mediaBucket: s3.Bucket;

  // API Gateway
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: MarketingStackProps) {
    super(scope, id, props);

    // ============================================
    // 1. DynamoDB Tables
    // ============================================

    // Table 1: MarketingProfiles - Ayrshare profile mappings for each clinic
    this.marketingProfilesTable = new dynamodb.Table(this, 'MarketingProfilesTable', {
      tableName: 'MarketingProfiles',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Table 2: MarketingPosts - Social media posts
    this.marketingPostsTable = new dynamodb.Table(this, 'MarketingPostsTable', {
      tableName: 'MarketingPosts',
      partitionKey: { name: 'postId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByClinic - Query posts by clinicId
    this.marketingPostsTable.addGlobalSecondaryIndex({
      indexName: 'ByClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: ByStatus - Query posts by status
    this.marketingPostsTable.addGlobalSecondaryIndex({
      indexName: 'ByStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Table 3: MarketingComments - Comments from social media posts
    this.marketingCommentsTable = new dynamodb.Table(this, 'MarketingCommentsTable', {
      tableName: 'MarketingComments',
      partitionKey: { name: 'postId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'commentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByClinic - Query comments by clinicId
    this.marketingCommentsTable.addGlobalSecondaryIndex({
      indexName: 'ByClinic',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Table 4: MarketingMedia - Uploaded media files
    this.marketingMediaTable = new dynamodb.Table(this, 'MarketingMediaTable', {
      tableName: 'MarketingMedia',
      partitionKey: { name: 'mediaId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: ByUploader - Query media by uploader
    this.marketingMediaTable.addGlobalSecondaryIndex({
      indexName: 'ByUploader',
      partitionKey: { name: 'uploadedBy', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Table 5: MarketingAnalytics - Analytics data synced from social platforms
    this.marketingAnalyticsTable = new dynamodb.Table(this, 'MarketingAnalyticsTable', {
      tableName: 'MarketingAnalytics',
      partitionKey: { name: 'postId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'syncedAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ============================================
    // 1b. Meta Ads DynamoDB Tables
    // ============================================
    // These tables already exist in AWS, so we import them rather than creating new ones.
    // This allows CDK to grant IAM permissions without trying to recreate the tables.

    // Table 9: MetaAdDrafts - Campaign draft wizard state
    const metaAdDraftsTable = dynamodb.Table.fromTableName(this, 'MetaAdDraftsTable', 'MetaAdDrafts');

    // Table 10: MetaLeadForms - Lead generation forms
    const metaLeadFormsTable = dynamodb.Table.fromTableName(this, 'MetaLeadFormsTable', 'MetaLeadForms');

    // Table 11: MetaLeads - Captured leads from forms
    const metaLeadsTable = dynamodb.Table.fromTableName(this, 'MetaLeadsTable', 'MetaLeads');

    // Table 12: MetaBulkJobs - Bulk publish job tracking
    const metaBulkJobsTable = dynamodb.Table.fromTableName(this, 'MetaBulkJobsTable', 'MetaBulkJobs');

    // Table 13: MetaBulkResults - Individual clinic results from bulk jobs
    const metaBulkResultsTable = dynamodb.Table.fromTableName(this, 'MetaBulkResultsTable', 'MetaBulkResults');

    // Table 14: MetaScheduledCampaigns - Scheduled campaign launches
    const metaScheduledCampaignsTable = dynamodb.Table.fromTableName(this, 'MetaScheduledCampaignsTable', 'MetaScheduledCampaigns');

    // Table 15: MetaAdCampaigns - Published campaign records
    const metaAdCampaignsTable = dynamodb.Table.fromTableName(this, 'MetaAdCampaignsTable', 'MetaAdCampaigns');

    // ============================================
    // 2. S3 Bucket for Media Storage
    // ============================================
    this.mediaBucket = new s3.Bucket(this, 'MarketingMediaBucket', {
      bucketName: 'todaysdentalinsights-marketing-media',
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ALLOWED_ORIGINS_LIST,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      publicReadAccess: true,
      // Lifecycle rules for media management
      lifecycleRules: [
        {
          id: 'DeleteTempUploads',
          enabled: true,
          prefix: 'temp/uploads/',
          expiration: Duration.days(1),
        },
        {
          id: 'TransitionToStandardIA',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(90),
            },
          ],
        },
        {
          id: 'TransitionToGlacier',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(365),
            },
          ],
        },
      ],
    });

    // ============================================
    // 3. API Gateway
    // ============================================
    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'MarketingApi', {
      restApiName: 'MarketingApi',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowMethods: corsConfig.allowMethods,
        allowHeaders: corsConfig.allowHeaders,
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Add CORS headers to error responses using shared utility
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

    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // ============================================
    // 4. Authorizer Setup
    // ============================================
    const authorizerFn = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthFn',
      props.authorizerFunctionArn
    );

    const authorizer = new apigw.RequestAuthorizer(this, 'MarketingAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.seconds(0),
    });

    // Grant API Gateway permission to invoke the Authorizer
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: props.authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ============================================
    // 5. Environment Variables
    // ============================================
    
    // Ayrshare credentials are now stored in GlobalSecrets DynamoDB table
    // Lambda functions will retrieve them at runtime using secrets-helper utility
    // This removes hardcoded secrets from the codebase

    const envVars = {
      MARKETING_PROFILES_TABLE: this.marketingProfilesTable.tableName,
      MARKETING_POSTS_TABLE: this.marketingPostsTable.tableName,
      MARKETING_COMMENTS_TABLE: this.marketingCommentsTable.tableName,
      MARKETING_MEDIA_TABLE: this.marketingMediaTable.tableName,
      MARKETING_ANALYTICS_TABLE: this.marketingAnalyticsTable.tableName,
      MEDIA_BUCKET: this.mediaBucket.bucketName,
      // Secrets tables for dynamic credential retrieval
      GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
      CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
      CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
      // Webhook secret for HMAC signature verification (still from env var)
      AYRSHARE_WEBHOOK_SECRET: process.env.AYRSHARE_WEBHOOK_SECRET || '',
    };

    // ============================================
    // 6. Lambda Functions
    // ============================================

    // Profile Management Lambda
    const profilesFn = new lambdaNode.NodejsFunction(this, 'MarketingProfilesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'profiles.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Posts Management Lambda
    const postsFn = new lambdaNode.NodejsFunction(this, 'MarketingPostsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'posts.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Comments Management Lambda
    const commentsFn = new lambdaNode.NodejsFunction(this, 'MarketingCommentsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'comments.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Analytics Lambda
    const analyticsFn = new lambdaNode.NodejsFunction(this, 'MarketingAnalyticsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'analytics.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Media Management Lambda
    const mediaFn = new lambdaNode.NodejsFunction(this, 'MarketingMediaFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'media.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: envVars,
    });

    // Webhooks Lambda
    const webhooksFn = new lambdaNode.NodejsFunction(this, 'MarketingWebhooksFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'webhooks.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Analytics Sync Lambda (scheduled)
    const analyticsSyncFn = new lambdaNode.NodejsFunction(this, 'MarketingAnalyticsSyncFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'analytics-sync.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(300),
      environment: envVars,
    });

    // Auto-Schedule Lambda
    const autoScheduleFn = new lambdaNode.NodejsFunction(this, 'MarketingAutoScheduleFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'auto-schedule.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Hashtags Lambda
    const hashtagsFn = new lambdaNode.NodejsFunction(this, 'MarketingHashtagsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'hashtags.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // History Lambda
    const historyFn = new lambdaNode.NodejsFunction(this, 'MarketingHistoryFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'history.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Messages Lambda (Direct Messaging)
    const messagesFn = new lambdaNode.NodejsFunction(this, 'MarketingMessagesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'messages.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Validate Lambda
    const validateFn = new lambdaNode.NodejsFunction(this, 'MarketingValidateFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'validate.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: envVars,
    });

    // Meta Ads environment variables
    const metaAdsEnvVars = {
      ...envVars,
      META_AD_DRAFTS_TABLE: metaAdDraftsTable.tableName,
      META_LEAD_FORMS_TABLE: metaLeadFormsTable.tableName,
      META_LEADS_TABLE: metaLeadsTable.tableName,
      META_BULK_JOBS_TABLE: metaBulkJobsTable.tableName,
      META_BULK_RESULTS_TABLE: metaBulkResultsTable.tableName,
      META_SCHEDULED_CAMPAIGNS_TABLE: metaScheduledCampaignsTable.tableName,
      META_CAMPAIGNS_TABLE: metaAdCampaignsTable.tableName,
    };

    // Ads Lambda (Meta Ads via Ayrshare)
    const adsFn = new lambdaNode.NodejsFunction(this, 'MarketingAdsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'marketing', 'ads.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: metaAdsEnvVars,
    });

    // ============================================
    // EventBridge Rule for Analytics Sync (runs every 6 hours)
    // ============================================
    const analyticsSyncRule = new events.Rule(this, 'MarketingAnalyticsSyncRule', {
      ruleName: 'MarketingAnalyticsSyncSchedule',
      description: 'Triggers analytics sync Lambda every 6 hours to fetch latest social media analytics',
      schedule: events.Schedule.rate(Duration.hours(6)),
      enabled: true,
    });

    // Add the Lambda as a target for the EventBridge rule
    analyticsSyncRule.addTarget(new targets.LambdaFunction(analyticsSyncFn, {
      retryAttempts: 2,
    }));

    // ============================================
    // 7. Grant Permissions
    // ============================================

    // Profiles Lambda permissions
    this.marketingProfilesTable.grantReadWriteData(profilesFn);

    // Posts Lambda permissions
    this.marketingProfilesTable.grantReadData(postsFn);
    this.marketingPostsTable.grantReadWriteData(postsFn);

    // Comments Lambda permissions
    this.marketingProfilesTable.grantReadData(commentsFn);
    this.marketingPostsTable.grantReadData(commentsFn);
    this.marketingCommentsTable.grantReadWriteData(commentsFn);

    // Analytics Lambda permissions
    this.marketingProfilesTable.grantReadData(analyticsFn);
    this.marketingPostsTable.grantReadData(analyticsFn);
    this.marketingAnalyticsTable.grantReadWriteData(analyticsFn);

    // Media Lambda permissions
    this.marketingMediaTable.grantReadWriteData(mediaFn);
    this.mediaBucket.grantReadWrite(mediaFn);

    // Webhooks Lambda permissions
    this.marketingProfilesTable.grantReadData(webhooksFn);
    this.marketingPostsTable.grantReadData(webhooksFn);
    this.marketingCommentsTable.grantReadWriteData(webhooksFn);

    // Analytics Sync Lambda permissions
    this.marketingProfilesTable.grantReadData(analyticsSyncFn);
    this.marketingPostsTable.grantReadWriteData(analyticsSyncFn);
    this.marketingAnalyticsTable.grantReadWriteData(analyticsSyncFn);

    // Auto-Schedule Lambda permissions
    this.marketingProfilesTable.grantReadData(autoScheduleFn);
    this.marketingPostsTable.grantReadWriteData(autoScheduleFn);

    // Hashtags Lambda permissions (only needs profiles for API key)
    this.marketingProfilesTable.grantReadData(hashtagsFn);

    // History Lambda permissions
    this.marketingProfilesTable.grantReadData(historyFn);
    this.marketingPostsTable.grantReadData(historyFn);

    // Messages Lambda permissions
    this.marketingProfilesTable.grantReadData(messagesFn);

    // Validate Lambda permissions (only needs profiles for API key)
    this.marketingProfilesTable.grantReadData(validateFn);

    // Ads Lambda permissions
    this.marketingProfilesTable.grantReadData(adsFn);
    this.marketingPostsTable.grantReadData(adsFn);

    // Meta Ads Tables permissions for adsFn
    metaAdDraftsTable.grantReadWriteData(adsFn);
    metaLeadFormsTable.grantReadWriteData(adsFn);
    metaLeadsTable.grantReadWriteData(adsFn);
    metaBulkJobsTable.grantReadWriteData(adsFn);
    metaBulkResultsTable.grantReadWriteData(adsFn);
    metaScheduledCampaignsTable.grantReadWriteData(adsFn);
    metaAdCampaignsTable.grantReadWriteData(adsFn);

    // ============================================
    // 7b. Secrets Tables Permissions
    // ============================================
    // Grant all Lambda functions read access to secrets tables for dynamic credential retrieval
    // NOTE: Google Ads Lambdas have been moved to GoogleAdsStack
    const allLambdas = [
      profilesFn, postsFn, commentsFn, analyticsFn, mediaFn, webhooksFn,
      analyticsSyncFn, autoScheduleFn, hashtagsFn, historyFn, messagesFn, validateFn, adsFn,
    ];

    // IAM policy for reading from secrets tables
    const secretsReadPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
      ],
    });

    // IAM policy for KMS decryption
    const kmsDecryptPolicy = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: [props.secretsEncryptionKeyArn],
    });

    allLambdas.forEach(fn => {
      fn.addToRolePolicy(secretsReadPolicy);
      fn.addToRolePolicy(kmsDecryptPolicy);
    });

    // ============================================
    // 8. API Routes
    // ============================================
    const root = this.api.root;

    // -----------------------------------------
    // Profile Management Routes (/profiles)
    // -----------------------------------------
    const profilesRes = root.addResource('profiles');

    // POST /profiles/initialize - Create Ayrshare profiles for all clinics (deprecated, use /sync)
    const initializeRes = profilesRes.addResource('initialize');
    initializeRes.addMethod('POST', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // POST /profiles/sync - Sync profiles from clinics.json to DynamoDB
    const syncRes = profilesRes.addResource('sync');
    syncRes.addMethod('POST', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // GET /profiles - Get all clinic profiles
    profilesRes.addMethod('GET', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // GET /profiles/:clinicId - Get single clinic profile
    const profileByIdRes = profilesRes.addResource('{clinicId}');
    profileByIdRes.addMethod('GET', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // POST /profiles/:clinicId/generate-jwt - Generate JWT for social account linking
    const generateJwtRes = profileByIdRes.addResource('generate-jwt');
    generateJwtRes.addMethod('POST', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // DELETE /profiles/:clinicId/social/:platform - Unlink social network
    const socialRes = profileByIdRes.addResource('social');
    const platformRes = socialRes.addResource('{platform}');
    platformRes.addMethod('DELETE', new apigw.LambdaIntegration(profilesFn), { authorizer });

    // -----------------------------------------
    // Post Management Routes (/posts)
    // -----------------------------------------
    const postsRes = root.addResource('posts');

    // POST /posts - Create post (single or multiple clinics)
    // GET /posts - Get all posts with filtering and pagination
    postsRes.addMethod('POST', new apigw.LambdaIntegration(postsFn), { authorizer });
    postsRes.addMethod('GET', new apigw.LambdaIntegration(postsFn), { authorizer });

    // POST /posts/bulk - Bulk post creation
    const bulkPostsRes = postsRes.addResource('bulk');
    bulkPostsRes.addMethod('POST', new apigw.LambdaIntegration(postsFn), { authorizer });

    // GET /posts/:postId - Get single post
    // PATCH /posts/:postId - Update post
    // DELETE /posts/:postId - Delete post
    const postByIdRes = postsRes.addResource('{postId}');
    postByIdRes.addMethod('GET', new apigw.LambdaIntegration(postsFn), { authorizer });
    postByIdRes.addMethod('PATCH', new apigw.LambdaIntegration(postsFn), { authorizer });
    postByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(postsFn), { authorizer });

    // GET /posts/:postId/comments - Get comments for a specific post
    const postCommentsRes = postByIdRes.addResource('comments');
    postCommentsRes.addMethod('GET', new apigw.LambdaIntegration(commentsFn), { authorizer });

    // -----------------------------------------
    // Comment Management Routes (/comments)
    // -----------------------------------------
    const commentsRes = root.addResource('comments');

    // GET /comments - Get comments with filtering
    commentsRes.addMethod('GET', new apigw.LambdaIntegration(commentsFn), { authorizer });

    // POST /comments/bulk-read - Bulk mark comments as read
    const bulkReadRes = commentsRes.addResource('bulk-read');
    bulkReadRes.addMethod('POST', new apigw.LambdaIntegration(commentsFn), { authorizer });

    // POST /comments/:commentId/reply - Reply to comment
    // PATCH /comments/:commentId/read - Mark comment as read
    const commentByIdRes = commentsRes.addResource('{commentId}');
    const replyRes = commentByIdRes.addResource('reply');
    replyRes.addMethod('POST', new apigw.LambdaIntegration(commentsFn), { authorizer });

    const readRes = commentByIdRes.addResource('read');
    readRes.addMethod('PATCH', new apigw.LambdaIntegration(commentsFn), { authorizer });

    // -----------------------------------------
    // Analytics Routes (/analytics)
    // -----------------------------------------
    const analyticsRes = root.addResource('analytics');

    // GET /analytics/dashboard - Get dashboard analytics
    const dashboardRes = analyticsRes.addResource('dashboard');
    dashboardRes.addMethod('GET', new apigw.LambdaIntegration(analyticsFn), { authorizer });

    // GET /analytics/posts/:postId - Get post analytics
    const analyticsPostsRes = analyticsRes.addResource('posts');
    const analyticsPostByIdRes = analyticsPostsRes.addResource('{postId}');
    analyticsPostByIdRes.addMethod('GET', new apigw.LambdaIntegration(analyticsFn), { authorizer });

    // GET /analytics/clinics/:clinicId - Get clinic analytics
    const analyticsClinicsRes = analyticsRes.addResource('clinics');
    const analyticsClinicByIdRes = analyticsClinicsRes.addResource('{clinicId}');
    analyticsClinicByIdRes.addMethod('GET', new apigw.LambdaIntegration(analyticsFn), { authorizer });

    // GET /analytics/social - Get social account analytics
    const analyticsSocialRes = analyticsRes.addResource('social');
    analyticsSocialRes.addMethod('GET', new apigw.LambdaIntegration(analyticsFn), { authorizer });

    // GET /analytics/links - Get link analytics (shortened URLs)
    const analyticsLinksRes = analyticsRes.addResource('links');
    analyticsLinksRes.addMethod('GET', new apigw.LambdaIntegration(analyticsFn), { authorizer });

    // -----------------------------------------
    // Media Management Routes (/media)
    // -----------------------------------------
    const mediaRes = root.addResource('media');

    // POST /media/upload - Upload media
    const uploadRes = mediaRes.addResource('upload');
    uploadRes.addMethod('POST', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // GET /media - Get media library
    mediaRes.addMethod('GET', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // DELETE /media/:mediaId - Delete media
    const mediaByIdRes = mediaRes.addResource('{mediaId}');
    mediaByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // GET /media/upload-url - Get pre-signed upload URL
    const uploadUrlRes = mediaRes.addResource('upload-url');
    uploadUrlRes.addMethod('GET', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // POST /media/resize - Resize image via Ayrshare
    const resizeRes = mediaRes.addResource('resize');
    resizeRes.addMethod('POST', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // POST /media/verify-url - Verify media URL accessibility
    const verifyUrlRes = mediaRes.addResource('verify-url');
    verifyUrlRes.addMethod('POST', new apigw.LambdaIntegration(mediaFn), { authorizer });

    // -----------------------------------------
    // Auto-Schedule Routes (/auto-schedule)
    // -----------------------------------------
    const autoScheduleRes = root.addResource('auto-schedule');

    // POST /auto-schedule/set - Create or update auto-schedule
    const autoScheduleSetRes = autoScheduleRes.addResource('set');
    autoScheduleSetRes.addMethod('POST', new apigw.LambdaIntegration(autoScheduleFn), { authorizer });

    // GET /auto-schedule/list - List all schedules for a clinic
    const autoScheduleListRes = autoScheduleRes.addResource('list');
    autoScheduleListRes.addMethod('GET', new apigw.LambdaIntegration(autoScheduleFn), { authorizer });

    // DELETE /auto-schedule - Delete a schedule
    autoScheduleRes.addMethod('DELETE', new apigw.LambdaIntegration(autoScheduleFn), { authorizer });

    // -----------------------------------------
    // Hashtags Routes (/hashtags)
    // -----------------------------------------
    const hashtagsRes = root.addResource('hashtags');

    // POST /hashtags/auto - Auto-generate hashtags for text
    const hashtagsAutoRes = hashtagsRes.addResource('auto');
    hashtagsAutoRes.addMethod('POST', new apigw.LambdaIntegration(hashtagsFn), { authorizer });

    // GET /hashtags/recommend - Get hashtag recommendations
    const hashtagsRecommendRes = hashtagsRes.addResource('recommend');
    hashtagsRecommendRes.addMethod('GET', new apigw.LambdaIntegration(hashtagsFn), { authorizer });

    // GET /hashtags/search - Search hashtags on a platform
    const hashtagsSearchRes = hashtagsRes.addResource('search');
    hashtagsSearchRes.addMethod('GET', new apigw.LambdaIntegration(hashtagsFn), { authorizer });

    // GET /hashtags/check-banned - Check if hashtags are banned
    const hashtagsCheckBannedRes = hashtagsRes.addResource('check-banned');
    hashtagsCheckBannedRes.addMethod('GET', new apigw.LambdaIntegration(hashtagsFn), { authorizer });

    // -----------------------------------------
    // History Routes (/history)
    // -----------------------------------------
    const historyRes = root.addResource('history');

    // GET /history - Get post history from Ayrshare
    historyRes.addMethod('GET', new apigw.LambdaIntegration(historyFn), { authorizer });

    // -----------------------------------------
    // Messages Routes (/messages) - Direct Messaging
    // -----------------------------------------
    const messagesRes = root.addResource('messages');

    // GET /messages - Get direct messages
    messagesRes.addMethod('GET', new apigw.LambdaIntegration(messagesFn), { authorizer });

    // POST /messages/send - Send a direct message
    const messagesSendRes = messagesRes.addResource('send');
    messagesSendRes.addMethod('POST', new apigw.LambdaIntegration(messagesFn), { authorizer });

    // -----------------------------------------
    // Validate Routes (/validate)
    // -----------------------------------------
    const validateRes = root.addResource('validate');

    // POST /validate/post - Validate post content before publishing
    const validatePostRes = validateRes.addResource('post');
    validatePostRes.addMethod('POST', new apigw.LambdaIntegration(validateFn), { authorizer });

    // POST /validate/media - Validate media files for platforms
    const validateMediaRes = validateRes.addResource('media');
    validateMediaRes.addMethod('POST', new apigw.LambdaIntegration(validateFn), { authorizer });

    // POST /validate/content-moderation - Content moderation check
    const validateContentModerationRes = validateRes.addResource('content-moderation');
    validateContentModerationRes.addMethod('POST', new apigw.LambdaIntegration(validateFn), { authorizer });

    // -----------------------------------------
    // Webhook Routes (/webhooks)
    // -----------------------------------------
    const webhooksRes = root.addResource('webhooks');

    // GET /webhooks - Get registered webhooks from Ayrshare
    webhooksRes.addMethod('GET', new apigw.LambdaIntegration(webhooksFn), { authorizer });

    // POST /webhooks - Register webhook with Ayrshare
    webhooksRes.addMethod('POST', new apigw.LambdaIntegration(webhooksFn), { authorizer });

    // DELETE /webhooks - Unregister webhook from Ayrshare
    webhooksRes.addMethod('DELETE', new apigw.LambdaIntegration(webhooksFn), { authorizer });

    // POST /webhooks/ayrshare - Ayrshare webhook handler (no auth - but HMAC signature verified)
    const ayrshareWebhookRes = webhooksRes.addResource('ayrshare');
    ayrshareWebhookRes.addMethod('POST', new apigw.LambdaIntegration(webhooksFn));

    // -----------------------------------------
    // Ads Routes (/ads) - Meta Ads via Ayrshare
    // -----------------------------------------
    const adsRes = root.addResource('ads');

    // Clinic-specific ads routes
    const adsClinicRes = adsRes.addResource('{clinicId}');

    // POST /ads/{clinicId}/boost - Boost an existing post
    const adsBoostRes = adsClinicRes.addResource('boost');
    adsBoostRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    // GET /ads/{clinicId}/campaigns - List all ad campaigns
    // POST /ads/{clinicId}/campaigns - Create a new ad campaign
    const adsCampaignsRes = adsClinicRes.addResource('campaigns');
    adsCampaignsRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });
    adsCampaignsRes.addMethod('POST', new apigw.LambdaIntegration(adsFn), { authorizer });

    // GET /ads/{clinicId}/campaigns/{campaignId} - Get single campaign
    // PUT /ads/{clinicId}/campaigns/{campaignId} - Update campaign
    // DELETE /ads/{clinicId}/campaigns/{campaignId} - Delete campaign
    const adsCampaignByIdRes = adsCampaignsRes.addResource('{campaignId}');
    adsCampaignByIdRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });
    adsCampaignByIdRes.addMethod('PUT', new apigw.LambdaIntegration(adsFn), { authorizer });
    adsCampaignByIdRes.addMethod('DELETE', new apigw.LambdaIntegration(adsFn), { authorizer });

    // GET /ads/{clinicId}/analytics - Get ad analytics
    const adsAnalyticsRes = adsClinicRes.addResource('analytics');
    adsAnalyticsRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });

    // GET /ads/{clinicId}/account - Get ad account info
    const adsAccountRes = adsClinicRes.addResource('account');
    adsAccountRes.addMethod('GET', new apigw.LambdaIntegration(adsFn), { authorizer });

    // -----------------------------------------
    // Meta Ads Routes (/meta) - Use proxy resource to minimize API Gateway resources
    // The adsFn Lambda handles all path-based routing internally
    // -----------------------------------------
    const metaRes = root.addResource('meta');
    
    // Catch-all proxy: /meta/{proxy+} handles all Meta Ads routes
    // Including: /meta/ads/drafts, /meta/ads/bulk/jobs, /meta/ads/scheduled, 
    //           /meta/ads/{clinicId}/lead-forms, /meta/ads/{clinicId}/leads, etc.
    const metaProxyRes = metaRes.addResource('{proxy+}');
    metaProxyRes.addMethod('ANY', new apigw.LambdaIntegration(adsFn), { authorizer });

    // NOTE: Google Ads routes have been moved to GoogleAdsStack
    // Access via: https://apig.todaysdentalinsights.com/google-ads/

    // ============================================
    // 9. Outputs
    // ============================================
    new CfnOutput(this, 'MarketingApiUrl', {
      value: this.api.url,
      exportName: `${this.stackName}-ApiUrl`,
    });

    new CfnOutput(this, 'MarketingProfilesTableName', {
      value: this.marketingProfilesTable.tableName,
      exportName: `${this.stackName}-ProfilesTableName`,
    });

    new CfnOutput(this, 'MarketingPostsTableName', {
      value: this.marketingPostsTable.tableName,
      exportName: `${this.stackName}-PostsTableName`,
    });

    new CfnOutput(this, 'MarketingCommentsTableName', {
      value: this.marketingCommentsTable.tableName,
      exportName: `${this.stackName}-CommentsTableName`,
    });

    new CfnOutput(this, 'MarketingMediaTableName', {
      value: this.marketingMediaTable.tableName,
      exportName: `${this.stackName}-MediaTableName`,
    });

    new CfnOutput(this, 'MarketingAnalyticsTableName', {
      value: this.marketingAnalyticsTable.tableName,
      exportName: `${this.stackName}-AnalyticsTableName`,
    });

    new CfnOutput(this, 'MarketingMediaBucketName', {
      value: this.mediaBucket.bucketName,
      exportName: `${this.stackName}-MediaBucketName`,
    });

    // ============================================
    // 10. Custom Domain Mapping
    // ============================================
    // Map this API under the existing custom domain as /marketing
    new apigw.CfnBasePathMapping(this, 'MarketingBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'marketing',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    new CfnOutput(this, 'MarketingCustomApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/marketing/',
      description: 'Custom domain URL for Marketing API',
      exportName: `${this.stackName}-CustomApiUrl`,
    });
  }
}
