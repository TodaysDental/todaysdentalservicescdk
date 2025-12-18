import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class LeaseManagementStack extends cdk.Stack {
  public readonly leaseTable: dynamodb.Table;
  public readonly leaseDocumentsBucket: s3.Bucket;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for Lease Documents
    this.leaseDocumentsBucket = new s3.Bucket(this, 'LeaseDocumentsBucket', {
      bucketName: `dental-lease-documents-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // DynamoDB Table for Lease Management
    this.leaseTable = new dynamodb.Table(this, 'LeaseTable', {
      tableName: 'LeaseTable',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    this.leaseTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'endDate', type: dynamodb.AttributeType.STRING },
    });

    const lambdaEnv = {
      LEASE_TABLE_NAME: this.leaseTable.tableName,
      LEASE_DOCUMENTS_BUCKET: this.leaseDocumentsBucket.bucketName,
    };

    // Create Lease Lambda
    const createLeaseLambda = new lambda.Function(this, 'CreateLeaseLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'createLease.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Get Lease Lambda
    const getLeaseLambda = new lambda.Function(this, 'GetLeaseLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'getLease.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Update Lease Lambda
    const updateLeaseLambda = new lambda.Function(this, 'UpdateLeaseLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'updateLease.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Delete Lease Lambda
    const deleteLeaseLambda = new lambda.Function(this, 'DeleteLeaseLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'deleteLease.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // List Leases Lambda
    const listLeasesLambda = new lambda.Function(this, 'ListLeasesLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'listLeases.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Upload Document Lambda
    const uploadDocumentLambda = new lambda.Function(this, 'UploadDocumentLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'uploadDocument.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Get Document Lambda
    const getDocumentLambda = new lambda.Function(this, 'GetDocumentLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'getDocument.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Process Document Lambda (Textract)
    const processDocumentLambda = new lambda.Function(this, 'ProcessDocumentLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'processDocument.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
    });

    // Get Extracted Data Lambda
    const getExtractedDataLambda = new lambda.Function(this, 'GetExtractedDataLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'getExtractedData.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lease-management')),
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Grant DynamoDB permissions
    this.leaseTable.grantReadWriteData(createLeaseLambda);
    this.leaseTable.grantReadData(getLeaseLambda);
    this.leaseTable.grantReadWriteData(updateLeaseLambda);
    this.leaseTable.grantReadWriteData(deleteLeaseLambda);
    this.leaseTable.grantReadData(listLeasesLambda);
    this.leaseTable.grantReadWriteData(processDocumentLambda);
    this.leaseTable.grantReadData(getExtractedDataLambda);

    // Grant S3 permissions
    this.leaseDocumentsBucket.grantReadWrite(createLeaseLambda);
    this.leaseDocumentsBucket.grantRead(getLeaseLambda);
    this.leaseDocumentsBucket.grantReadWrite(updateLeaseLambda);
    this.leaseDocumentsBucket.grantReadWrite(uploadDocumentLambda);
    this.leaseDocumentsBucket.grantRead(getDocumentLambda);
    this.leaseDocumentsBucket.grantRead(processDocumentLambda);

    // Grant Textract permissions to processDocumentLambda
    processDocumentLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'textract:StartDocumentAnalysis',
        'textract:GetDocumentAnalysis',
        'textract:AnalyzeDocument'
      ],
      resources: ['*']
    }));

    // S3 trigger for document processing
    this.leaseDocumentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processDocumentLambda),
      { suffix: '.pdf' }
    );
    this.leaseDocumentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processDocumentLambda),
      { suffix: '.png' }
    );
    this.leaseDocumentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processDocumentLambda),
      { suffix: '.jpg' }
    );

    // API Gateway
    this.api = new apigateway.RestApi(this, 'LeaseManagementApi', {
      restApiName: 'Lease Management API',
      description: 'API for managing dental clinic leases',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'x-clinic-id'],
      },
    });

    const leasesResource = this.api.root.addResource('leases');
    leasesResource.addMethod('POST', new apigateway.LambdaIntegration(createLeaseLambda));
    leasesResource.addMethod('GET', new apigateway.LambdaIntegration(listLeasesLambda));

    // /leases/{clinicId}/{leaseId}
    const clinicResource = leasesResource.addResource('{clinicId}');
    const leaseResource = clinicResource.addResource('{leaseId}');
    leaseResource.addMethod('GET', new apigateway.LambdaIntegration(getLeaseLambda));
    leaseResource.addMethod('PUT', new apigateway.LambdaIntegration(updateLeaseLambda));
    leaseResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteLeaseLambda));

    // /leases/documents/upload
    const documentsResource = leasesResource.addResource('documents');
    const uploadResource = documentsResource.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadDocumentLambda));

    // /leases/documents/download
    const downloadResource = documentsResource.addResource('download');
    downloadResource.addMethod('GET', new apigateway.LambdaIntegration(getDocumentLambda));

    // /leases/documents/extracted - Get extracted data from Textract
    const extractedResource = documentsResource.addResource('extracted');
    extractedResource.addMethod('GET', new apigateway.LambdaIntegration(getExtractedDataLambda));

    // Outputs
    new cdk.CfnOutput(this, 'LeaseTableNameOutput', { value: this.leaseTable.tableName });
    new cdk.CfnOutput(this, 'LeaseDocumentsBucketOutput', { value: this.leaseDocumentsBucket.bucketName });
    new cdk.CfnOutput(this, 'LeaseApiUrlOutput', { value: this.api.url });
  }
}