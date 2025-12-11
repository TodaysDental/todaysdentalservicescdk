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
    // 2. S3 Bucket for Media Storage
    // ============================================
    this.mediaBucket = new s3.Bucket(this, 'MarketingMediaBucket', {
      bucketName: 'todaysdentalinsights-marketing-media',
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ALLOWED_ORIGINS_LIST,
          allowedHeaders: ['*'],
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      publicReadAccess: true,
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
    const envVars = {
      MARKETING_PROFILES_TABLE: this.marketingProfilesTable.tableName,
      MARKETING_POSTS_TABLE: this.marketingPostsTable.tableName,
      MARKETING_COMMENTS_TABLE: this.marketingCommentsTable.tableName,
      MARKETING_MEDIA_TABLE: this.marketingMediaTable.tableName,
      MARKETING_ANALYTICS_TABLE: this.marketingAnalyticsTable.tableName,
      MEDIA_BUCKET: this.mediaBucket.bucketName,
      AYRSHARE_API_KEY: process.env.AYRSHARE_API_KEY || 'A7DD2620-39C046C1-ABAAA24C-64B16202',
      AYRSHARE_PRIVATE_KEY: process.env.AYRSHARE_PRIVATE_KEY || '',
      AYRSHARE_DOMAIN: process.env.AYRSHARE_DOMAIN || 'todaysdentalinsights',
      // Webhook secret for HMAC signature verification
      // Generate a secure random string and set it as an environment variable
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

    // ============================================
    // 8. API Routes
    // ============================================
    const root = this.api.root;

    // -----------------------------------------
    // Profile Management Routes (/profiles)
    // -----------------------------------------
    const profilesRes = root.addResource('profiles');

    // POST /profiles/initialize - Create Ayrshare profiles for all clinics
    const initializeRes = profilesRes.addResource('initialize');
    initializeRes.addMethod('POST', new apigw.LambdaIntegration(profilesFn), { authorizer });

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
