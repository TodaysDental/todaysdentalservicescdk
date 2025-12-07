import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';
import { Fn } from 'aws-cdk-lib';

export class DentalSoftwareStack extends Stack {
  public readonly clinicBucket: s3.Bucket;
  public readonly clinicDatabase: rds.DatabaseInstance;
  public readonly clinicApi: apigw.RestApi;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // VPC CONFIGURATION
    // ========================================

    // Create VPC for RDS and Lambda functions
    this.vpc = new ec2.Vpc(this, 'DentalSoftwareVPC', {
      maxAzs: 2, // Use 2 availability zones for high availability
      natGateways: 1, // Use 1 NAT gateway to reduce costs
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS MySQL database',
      allowAllOutbound: false,
    });

    // Security group for Lambda functions
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Allow Lambda to connect to RDS
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow Lambda functions to access MySQL'
    );

    // ========================================
    // S3 BUCKET FOR CLINIC DATA
    // ========================================

    this.clinicBucket = new s3.Bucket(this, 'ClinicDataBucket', {
      bucketName: `${this.stackName.toLowerCase()}-clinic-data`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: Duration.days(90),
          enabled: true,
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['https://todaysdentalinsights.com'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // ========================================
    // RDS MYSQL DATABASE
    // ========================================

    // Create secret for database credentials
    const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `${this.stackName}/database/credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Create RDS MySQL instance
    this.clinicDatabase = new rds.DatabaseInstance(this, 'ClinicDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_35,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'dental_software',
      credentials: rds.Credentials.fromSecret(dbSecret),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      multiAz: false, // Set to true for production
      publiclyAccessible: false,
    });

    // ========================================
    // LAMBDA LAYER FOR DEPENDENCIES
    // ========================================

    // Create a Lambda layer for mysql2 package
    const mysqlLayer = new lambda.LayerVersion(this, 'MysqlLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'shared', 'layers', 'mysql-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'MySQL2 client library for Lambda functions',
    });

    // ========================================
    // API GATEWAY
    // ========================================

    this.clinicApi = new apigw.RestApi(this, 'ClinicApi', {
      restApiName: 'DentalSoftwareClinicApi',
      description: 'API for Dental Software Clinic Management',
      defaultCorsPreflightOptions: getCdkCorsConfig({
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE'],
      }),
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    // Add CORS error responses
    const corsErrorHeaders = getCorsErrorHeaders();

    new apigw.GatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApi: this.clinicApi,
      type: apigw.ResponseType.DEFAULT_4XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApi: this.clinicApi,
      type: apigw.ResponseType.DEFAULT_5XX,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApi: this.clinicApi,
      type: apigw.ResponseType.UNAUTHORIZED,
      responseHeaders: corsErrorHeaders,
    });

    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.clinicApi,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the custom authorizer from CoreStack
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFunction = lambda.Function.fromFunctionArn(
      this,
      'ImportedAuthorizer',
      authorizerFunctionArn
    );

    const authorizer = new apigw.TokenAuthorizer(this, 'ClinicApiAuthorizer', {
      handler: authorizerFunction,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: Duration.seconds(300),
    });

    // ========================================
    // ENVIRONMENT VARIABLES FOR LAMBDA
    // ========================================

    const lambdaEnvironment = {
      DB_HOST: this.clinicDatabase.dbInstanceEndpointAddress,
      DB_PORT: this.clinicDatabase.dbInstanceEndpointPort,
      DB_USER: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
      DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
      DB_NAME: 'dental_software',
      CLINIC_BUCKET: this.clinicBucket.bucketName,
      CORS_ORIGIN: 'https://todaysdentalinsights.com',
    };

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    // Single Lambda function to handle all dental-software routes
    const dentalSoftwareFn = new lambdaNode.NodejsFunction(this, 'DentalSoftwareFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'dental-software', 'dental-software.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(60),
      bundling: { 
        format: lambdaNode.OutputFormat.ESM, 
        target: 'node20',
        externalModules: ['mysql2'],
      },
      environment: lambdaEnvironment,
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      layers: [mysqlLayer],
    });

    // Grant S3 permissions
    this.clinicBucket.grantReadWrite(dentalSoftwareFn);

    // Grant database secret read permissions
    dbSecret.grantRead(dentalSoftwareFn);

    // ========================================
    // API ROUTES WITH PROXY
    // ========================================

    // Use {proxy+} to route all requests to a single Lambda function
    const proxyResource = this.clinicApi.root.addResource('{proxy+}');
    
    // Add method for all HTTP verbs with proxy integration
    proxyResource.addMethod('ANY', new apigw.LambdaIntegration(dentalSoftwareFn), {
      authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    // ========================================
    // CUSTOM DOMAIN MAPPING
    // ========================================

    // Map Clinic API to custom domain under /dental-software path
    new apigw.CfnBasePathMapping(this, 'ClinicApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'dental-software',
      restApiId: this.clinicApi.restApiId,
      stage: this.clinicApi.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ClinicApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/dental-software/',
      description: 'Clinic API endpoint URL',
    });

    new CfnOutput(this, 'ClinicBucketName', {
      value: this.clinicBucket.bucketName,
      description: 'S3 bucket for clinic data',
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: this.clinicDatabase.dbInstanceEndpointAddress,
      description: 'RDS MySQL database endpoint',
    });

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'ARN of the database credentials secret',
    });

    new CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for dental software stack',
    });
  
  }
}
