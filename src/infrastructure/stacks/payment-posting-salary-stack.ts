import { Duration, Stack, StackProps, CfnOutput, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface PaymentPostingSalaryStackProps extends StackProps {
  consolidatedTransferServerId: string;
  /** GlobalSecrets DynamoDB table name for retrieving SFTP credentials */
  globalSecretsTableName: string;
  /** ClinicSecrets DynamoDB table name for per-clinic credentials */
  clinicSecretsTableName: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn: string;
}

export class PaymentPostingSalaryStack extends Stack {
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;
  public readonly salaryFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: PaymentPostingSalaryStackProps) {
    super(scope, id, props);

    // Tags & alarm helpers
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'PaymentPostingSalary',
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

    // ========================================
    // API GATEWAY
    // ========================================

    const corsConfig = getCdkCorsConfig();
    this.api = new apigw.RestApi(this, 'PaymentPostingSalaryApi', {
      restApiName: 'PaymentPostingSalaryApi',
      description: 'Payment Posting Salary Analytics API',
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
    new apigw.GatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApi: this.api,
      type: apigw.ResponseType.ACCESS_DENIED,
      responseHeaders: corsErrorHeaders,
    });

    // Import the shared authorizer Lambda from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);
    this.authorizer = new apigw.RequestAuthorizer(this, 'PaymentPostingSalaryAuthorizer', {
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

    // Import StaffUser table name from CoreStack
    const staffUserTableName = Fn.importValue('CoreStack-StaffUserTableName');

    this.salaryFn = new lambdaNode.NodejsFunction(this, 'PaymentPostingSalaryFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'payment-posting-salary', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(120),
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: 'node22',
        externalModules: ['ssh2', 'cpu-features'],
        nodeModules: ['ssh2'],
        minify: true,
        sourceMap: true,
      },
      environment: {
        STAFF_USER_TABLE: staffUserTableName,
        CONSOLIDATED_SFTP_HOST: props.consolidatedTransferServerId + '.server.transfer.' + Stack.of(this).region + '.amazonaws.com',
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        // Secrets tables for dynamic credential retrieval
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName,
        CLINIC_SECRETS_TABLE: props.clinicSecretsTableName,
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName,
      },
      retryAttempts: 0,
    });
    applyTags(this.salaryFn, { Function: 'payment-posting-salary' });

    // Grant READ permissions to StaffUser table
    const staffUserTable = dynamodb.Table.fromTableName(this, 'StaffUserTable', staffUserTableName);
    staffUserTable.grantReadData(this.salaryFn);

    // Grant read access to secrets tables for OpenDental credentials and SFTP password (includes Scan for getClinicIds)
    this.salaryFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicSecretsTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName}/index/*`,
      ],
    }));

    // Grant KMS decryption for secrets encryption key
    this.salaryFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: [props.secretsEncryptionKeyArn],
    }));

    // ========================================
    // API ROUTES
    // ========================================

    const integration = new apigw.LambdaIntegration(this.salaryFn, {
      timeout: Duration.seconds(29),
    });
    const authOptions = {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    };

    const salaryRes = this.api.root.addResource('salary');
    salaryRes.addMethod('GET', integration, { ...authOptions });

    const salaryUsersRes = salaryRes.addResource('users');
    salaryUsersRes.addMethod('GET', integration, { ...authOptions });

    // ========================================
    // CloudWatch Alarms
    // ========================================

    createLambdaErrorAlarm(this.salaryFn, 'payment-posting-salary');
    createLambdaThrottleAlarm(this.salaryFn, 'payment-posting-salary');
    createLambdaDurationAlarm(this.salaryFn, 'payment-posting-salary', Math.floor(Duration.seconds(29).toMilliseconds() * 0.8));

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    new apigw.CfnBasePathMapping(this, 'PaymentPostingSalaryApiBasePathMapping', {
      domainName: 'apig.todaysdentalinsights.com',
      basePath: 'payment-posting',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'PaymentPostingSalaryApiUrl', {
      value: 'https://apig.todaysdentalinsights.com/payment-posting/',
      description: 'Payment Posting Salary Analytics API URL',
      exportName: `${Stack.of(this).stackName}-PaymentPostingSalaryApiUrl`,
    });
  }
}

