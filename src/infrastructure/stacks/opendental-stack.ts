import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as transfer from 'aws-cdk-lib/aws-transfer';
import * as cr from 'aws-cdk-lib/custom-resources';
import clinicsData from '../configs/clinics.json';
import { Clinic } from '../configs/clinics';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface OpenDentalStackProps extends StackProps {
  authorizer: apigw.RequestAuthorizer;
}

export class OpenDentalStack extends Stack {
  public readonly consolidatedSftpBucket: s3.Bucket;
  public readonly consolidatedTransferServer: transfer.CfnServer;
  public readonly consolidatedTransferRole: iam.Role;
  public readonly consolidatedTransferAuthFn: lambdaNode.NodejsFunction;
  public readonly openDentalFn: lambdaNode.NodejsFunction;
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: OpenDentalStackProps) {
    super(scope, id, props);

    // ========================================
    // S3 BUCKETS AND TRANSFER FAMILY
    // ========================================

    // Create single S3 bucket for all clinics with separate folders
    this.consolidatedSftpBucket = new s3.Bucket(this, 'ConsolidatedTransferBucket', {
      bucketName: 'todaysdentalinsights-consolidated-sftp-v2',
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Seed expected S3 prefixes for each clinic so folders appear immediately after deploy
    (clinicsData as Clinic[]).forEach((c) => {
      const clinicFolder = `sftp-home/${c.sftpFolderPath}/`;
      const queriesFolder = `sftp-home/${c.sftpFolderPath}/QuerytemplateCSV/`;

      new cr.AwsCustomResource(this, `SeedSftpHome-${c.sftpFolderPath}`, {
        onCreate: {
          service: 'S3',
          action: 'putObject',
          parameters: {
            Bucket: this.consolidatedSftpBucket.bucketName,
            Key: `${clinicFolder}.keep`,
            Body: '',
          },
          physicalResourceId: cr.PhysicalResourceId.of(`SeedSftpHome-${c.sftpFolderPath}-v1`),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [`${this.consolidatedSftpBucket.bucketArn}/*`],
        }),
      });

      new cr.AwsCustomResource(this, `SeedSftpQueries-${c.sftpFolderPath}`, {
        onCreate: {
          service: 'S3',
          action: 'putObject',
          parameters: {
            Bucket: this.consolidatedSftpBucket.bucketName,
            Key: `${queriesFolder}.keep`,
            Body: '',
          },
          physicalResourceId: cr.PhysicalResourceId.of(`SeedSftpQueries-${c.sftpFolderPath}-v1`),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [`${this.consolidatedSftpBucket.bucketArn}/*`],
        }),
      });
    });

    // Create folder structure for dedicated sftpuser (for Open Dental queries)
    new cr.AwsCustomResource(this, 'SeedSftpUser', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: this.consolidatedSftpBucket.bucketName,
          Key: 'sftp-home/sftpuser/.keep',
          Body: '',
        },
        physicalResourceId: cr.PhysicalResourceId.of('SeedSftpUser-v1'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [`${this.consolidatedSftpBucket.bucketArn}/*`],
      }),
    });

    // Create IAM role for consolidated Transfer Family server
    this.consolidatedTransferRole = new iam.Role(this, 'ConsolidatedTransferRole', {
      assumedBy: new iam.ServicePrincipal('transfer.amazonaws.com'),
      description: 'Transfer Family role for consolidated SFTP server',
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:ListBucket'],
              resources: [this.consolidatedSftpBucket.bucketArn],
              conditions: {
                StringLike: {
                  's3:prefix': ['sftp-home/*']
                }
              }
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              resources: [`${this.consolidatedSftpBucket.bucketArn}/sftp-home/*/*`]
            })
          ]
        })
      }
    });

    // Extract only necessary clinic data for SFTP auth (to avoid env var size limits)
    const minimalClinicData = (clinicsData as any[]).map((clinic: any) => ({
      clinicId: clinic.clinicId,
      sftpFolderPath: clinic.sftpFolderPath,
      clinicName: clinic.clinicName // Include name for logging purposes
    }));

    // Create consolidated Transfer Family auth Lambda
    this.consolidatedTransferAuthFn = new lambdaNode.NodejsFunction(this, 'ConsolidatedTransferAuthFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'open-dental', 'consolidatedTransferAuth.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.CJS, target: 'node22' },
      environment: {
        TF_BUCKET: this.consolidatedSftpBucket.bucketName,
        TF_PASSWORD: 'Clinic2020',
        TF_ROLE_ARN: this.consolidatedTransferRole.roleArn,
        CLINICS_CONFIG: JSON.stringify(minimalClinicData),
      },
    });

    // Allow AWS Transfer service to invoke the auth lambda
    this.consolidatedTransferAuthFn.addPermission('AllowConsolidatedTransferInvoke', {
      principal: new iam.ServicePrincipal('transfer.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });

    // Create single consolidated Transfer Family server
    this.consolidatedTransferServer = new transfer.CfnServer(this, 'ConsolidatedTransferServer', {
      identityProviderType: 'AWS_LAMBDA',
      identityProviderDetails: { function: this.consolidatedTransferAuthFn.functionArn },
      protocols: ['SFTP'],
      endpointType: 'PUBLIC',
      loggingRole: this.consolidatedTransferRole.roleArn,
    });

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();
    
    this.api = new apigw.RestApi(this, 'OpenDentalApi', {
      restApiName: 'OpenDentalApi',
      description: 'OpenDental service API',
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

    this.authorizer = props.authorizer;

    // ========================================
    // LAMBDA FUNCTION
    // ========================================

    // Open Dental proxy Lambda
    this.openDentalFn = new lambdaNode.NodejsFunction(this, 'OpenDentalProxyFn', {
      entry: path.join(__dirname, '..', '..', 'integrations', 'open-dental', 'openDentalProxy.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,  // Increased memory for better performance
      timeout: Duration.seconds(120),  // Increased timeout for SFTP operations
      bundling: { 
        format: lambdaNode.OutputFormat.CJS, 
        target: 'node22',
        externalModules: [],
        minify: true,
        sourceMap: true
      },
      environment: {
        CONSOLIDATED_SFTP_HOST: this.consolidatedTransferServer.attrServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        CONSOLIDATED_SFTP_USERNAME: 'sftpuser', // Fixed username for Open Dental queries
        CONSOLIDATED_SFTP_PASSWORD: 'Clinic2020',
        CONSOLIDATED_SFTP_PORT: '22',
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
      },
      retryAttempts: 2
    });

    // Add explicit dependency on Transfer Server to ensure it exists before Lambda
    this.openDentalFn.node.addDependency(this.consolidatedTransferServer);

    // ========================================
    // API ROUTES
    // ========================================

    // Add API resources and methods
    const apiBase = this.api.root.addResource('api');
    const clinicBase = apiBase.addResource('clinic');
    const clinicRes = clinicBase.addResource('{clinicId}');
    const clinicProxy = clinicRes.addResource('{proxy+}');
    
    // Configure integration with proper error templates
    const errorResponses = [
      {
        selectionPattern: '.*"status":400.*',
        statusCode: '400',
        responseTemplates: {
          'application/json': JSON.stringify({ 
            message: "$util.escapeJavaScript($input.path('$.errorMessage'))"
          })
        }
      },
      {
        selectionPattern: '.*"status":403.*',
        statusCode: '403',
        responseTemplates: {
          'application/json': JSON.stringify({
            message: "$util.escapeJavaScript($input.path('$.errorMessage'))"
          })
        }
      },
      {
        selectionPattern: '.*',
        statusCode: '500',
        responseTemplates: {
          'application/json': JSON.stringify({
            message: 'Internal server error'
          })
        }
      }
    ];

    const integration = new apigw.LambdaIntegration(this.openDentalFn, {
      proxy: true,
      integrationResponses: [
        {
          statusCode: '200'
        },
        ...errorResponses
      ]
    });

    clinicProxy.addMethod('ANY', integration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
      methodResponses: [
        { 
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true
          }
        },
        { 
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true
          }
        },
        { 
          statusCode: '403',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true
          }
        },
        { 
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true
          }
        }
      ]
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'ConsolidatedTransferServerEndpoint', {
      value: this.consolidatedTransferServer.attrServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
      description: 'Consolidated Transfer Family SFTP endpoint for all clinics',
      exportName: `${Stack.of(this).stackName}-ConsolidatedTransferServerEndpoint`
    });

    new CfnOutput(this, 'ConsolidatedTransferServerBucket', {
      value: this.consolidatedSftpBucket.bucketName,
      description: 'S3 bucket for consolidated SFTP files',
      exportName: `${Stack.of(this).stackName}-ConsolidatedTransferServerBucket`
    });

    new CfnOutput(this, 'ConsolidatedTransferServerId', {
      value: this.consolidatedTransferServer.attrServerId,
      description: 'Transfer Family server ID for use in other stacks',
      exportName: `${Stack.of(this).stackName}-ConsolidatedTransferServerId`
    });

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'OpenDentalApiBasePathMapping', {
      domainName: 'api.todaysdentalinsights.com',
      basePath: 'opendental',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    new CfnOutput(this, 'OpenDentalApiUrl', {
      value: 'https://api.todaysdentalinsights.com/opendental/',
      description: 'OpenDental API Gateway URL',
      exportName: `${Stack.of(this).stackName}-OpenDentalApiUrl`,
    });

    new CfnOutput(this, 'OpenDentalApiId', {
      value: this.api.restApiId,
      description: 'OpenDental API Gateway ID',
      exportName: `${Stack.of(this).stackName}-OpenDentalApiId`,
    });
  }
}
