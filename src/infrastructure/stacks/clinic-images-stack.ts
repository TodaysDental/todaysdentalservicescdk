import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

// Import clinics data for Route 53 configuration
import clinicsData from '../configs/clinics.json';

export interface ClinicImagesStackProps extends StackProps {
  /**
   * Optional: Certificate ARN for custom domains
   * If not provided, will use the default todaysdentalinsights.com certificate
   */
  certificateArn?: string;
  /**
   * Optional: Hosted Zone ID for Route 53
   */
  hostedZoneId?: string;
  /**
   * Optional: Enable public access to images via CloudFront (future enhancement)
   */
  enablePublicAccess?: boolean;
}

export class ClinicImagesStack extends Stack {
  public readonly imagesBucket: s3.Bucket;
  public readonly imagesTable: dynamodb.Table;
  public readonly imagesFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props?: ClinicImagesStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'ClinicImages',
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
    // S3 BUCKET FOR IMAGES
    // ========================================

    this.imagesBucket = new s3.Bucket(this, 'ClinicImagesBucket', {
      bucketName: `todays-dental-clinic-images-${this.account}`,
      versioned: true, // Keep versions for audit trail
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Private by default
      removalPolicy: RemovalPolicy.RETAIN, // Don't delete images on stack deletion
      lifecycleRules: [
        {
          // Move old versions to cheaper storage after 90 days
          noncurrentVersionExpiration: Duration.days(365),
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(90),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: [
            'https://todaysdentalinsights.com',
            // Add clinic websites from clinics.json
            ...(clinicsData as any[])
              .map((c) => String(c.websiteLink))
              .filter(Boolean),
          ],
          allowedHeaders: ['*'],
          exposedHeaders: [
            'ETag',
            'x-amz-meta-image-id',
            'x-amz-meta-clinic-id',
          ],
          maxAge: 3600,
        },
      ],
    });
    applyTags(this.imagesBucket, { Bucket: 'clinic-images' });

    // ========================================
    // DYNAMODB TABLE FOR IMAGE METADATA
    // ========================================

    this.imagesTable = new dynamodb.Table(this, 'ClinicImagesTable', {
      tableName: `${this.stackName}-ClinicImages`,
      partitionKey: { name: 'imageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    applyTags(this.imagesTable, { Table: 'clinic-images' });

    // GSI for querying images by clinic
    this.imagesTable.addGlobalSecondaryIndex({
      indexName: 'ClinicIdIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying images by category within a clinic
    this.imagesTable.addGlobalSecondaryIndex({
      indexName: 'ClinicCategoryIndex',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'ClinicImagesApi', {
      restApiName: 'ClinicImagesApi',
      description: 'Clinic Images service API - Upload, manage, and retrieve clinic images',
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
      binaryMediaTypes: ['image/*', 'application/octet-stream', 'application/pdf'],
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

    // Create a reference to the authorizer function
    const authorizerFn = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthorizerFn',
      authorizerFunctionArn
    );

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'ImagesAuthorizer', {
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

    this.imagesFn = new lambdaNode.NodejsFunction(this, 'ImagesFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'images.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512, // Higher memory for image processing
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TABLE_NAME: this.imagesTable.tableName,
        BUCKET_NAME: this.imagesBucket.bucketName,
        PRESIGNED_URL_EXPIRY: '3600', // 1 hour
      },
    });
    applyTags(this.imagesFn, { Function: 'clinic-images' });

    // Grant permissions
    this.imagesTable.grantReadWriteData(this.imagesFn);
    this.imagesBucket.grantReadWrite(this.imagesFn);

    // Grant presigned URL generation permissions
    this.imagesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:HeadObject'],
        resources: [`${this.imagesBucket.bucketArn}/*`],
      })
    );

    // ========================================
    // API ROUTES
    // ========================================

    const imagesRes = this.api.root.addResource('images');

    // GET /images - List images (PUBLIC - no auth required)
    imagesRes.addMethod('GET', new apigw.LambdaIntegration(this.imagesFn), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }],
    });

    // POST /images - Request upload URL
    imagesRes.addMethod('POST', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // POST /images/confirm - Confirm upload
    const confirmRes = imagesRes.addResource('confirm');
    confirmRes.addMethod('POST', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // ========================================
    // BULK OPERATIONS: /images/bulk
    // ========================================
    const bulkRes = imagesRes.addResource('bulk');

    // POST /images/bulk - Request multiple upload URLs
    bulkRes.addMethod('POST', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // PUT /images/bulk - Update multiple images
    bulkRes.addMethod('PUT', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // DELETE /images/bulk - Delete multiple images
    bulkRes.addMethod('DELETE', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // POST /images/bulk/confirm - Confirm multiple uploads
    const bulkConfirmRes = bulkRes.addResource('confirm');
    bulkConfirmRes.addMethod('POST', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '201' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // Routes for specific image: /images/{imageId}
    const imageIdRes = imagesRes.addResource('{imageId}');

    // GET /images/{imageId} - Get image details (PUBLIC - no auth required)
    imageIdRes.addMethod('GET', new apigw.LambdaIntegration(this.imagesFn), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });

    // PUT /images/{imageId} - Update image metadata
    imageIdRes.addMethod('PUT', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '403' }],
    });

    // DELETE /images/{imageId} - Delete image
    imageIdRes.addMethod('DELETE', new apigw.LambdaIntegration(this.imagesFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }, { statusCode: '403' }],
    });

    // GET /images/{imageId}/download - Get presigned download URL (PUBLIC - no auth required)
    const downloadRes = imageIdRes.addResource('download');
    downloadRes.addMethod('GET', new apigw.LambdaIntegration(this.imagesFn), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }, { statusCode: '404' }],
    });

    // ========================================
    // CloudWatch Alarms
    // ========================================
    [
      { fn: this.imagesFn, name: 'clinic-images', durationMs: Math.floor(Duration.seconds(30).toMilliseconds() * 0.8) },
    ].forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    createDynamoThrottleAlarm(this.imagesTable.tableName, 'ClinicImagesTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'ImagesApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'images',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // CLINIC-SPECIFIC SUBDOMAIN ROUTING
    // ========================================
    // This creates CNAME records for each clinic pointing to the API Gateway
    // Example: images.dentistinnewbritain.com -> apig.todaysdentalinsights.com/images
    
    for (const clinic of clinicsData as any[]) {
      try {
        const clinicDomain = new URL(clinic.websiteLink).hostname;
        
        // Create hosted zone reference (assumes you have hosted zones for each clinic)
        if (clinic.hostedZoneId) {
          const clinicHostedZone = route53.HostedZone.fromHostedZoneAttributes(
            this,
            `HostedZone-${clinic.clinicId}`,
            {
              hostedZoneId: clinic.hostedZoneId,
              zoneName: clinicDomain,
            }
          );

          // Create CNAME record: images.{clinicDomain} -> apig.todaysdentalinsights.com
          new route53.CnameRecord(this, `ImagesCname-${clinic.clinicId}`, {
            zone: clinicHostedZone,
            recordName: 'images',
            domainName: 'apig.todaysdentalinsights.com',
            ttl: Duration.minutes(5),
          });
        }
      } catch (error) {
        console.warn(`Skipping Route 53 setup for clinic ${clinic.clinicId}: ${error}`);
      }
    }

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ImagesBucketName', {
      value: this.imagesBucket.bucketName,
      description: 'Name of the S3 bucket for clinic images',
      exportName: `${Stack.of(this).stackName}-ImagesBucketName`,
    });

    new CfnOutput(this, 'ImagesBucketArn', {
      value: this.imagesBucket.bucketArn,
      description: 'ARN of the S3 bucket for clinic images',
      exportName: `${Stack.of(this).stackName}-ImagesBucketArn`,
    });

    new CfnOutput(this, 'ImagesTableName', {
      value: this.imagesTable.tableName,
      description: 'Name of the DynamoDB table for image metadata',
      exportName: `${Stack.of(this).stackName}-ImagesTableName`,
    });

    new CfnOutput(this, 'ImagesApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/images/',
      description: 'Clinic Images API Gateway URL',
      exportName: `${Stack.of(this).stackName}-ImagesApiUrl`,
    });

    new CfnOutput(this, 'ImagesApiId', {
      value: this.api.restApiId,
      description: 'Clinic Images API Gateway ID',
      exportName: `${Stack.of(this).stackName}-ImagesApiId`,
    });
  }
}

