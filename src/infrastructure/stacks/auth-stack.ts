import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export interface AuthStackProps extends cdk.StackProps {
  allowedDomains?: string[];
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props?: AuthStackProps) {
    super(scope, id, props);

    // Create Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${this.stackName}-UserPool`,
      selfSignUpEnabled: false, // We'll handle registration through admin API
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        'custom:clinicId': new cognito.StringAttribute({ mutable: true }),
        'custom:role': new cognito.StringAttribute({ mutable: true }),
        'custom:connectArn': new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create SAML logs table
    const samlLogsTable = new dynamodb.Table(this, 'SamlLogsTable', {
      tableName: `${this.stackName}-SamlLogs`,
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Create auth trigger Lambda
    const authTriggerLambda = new lambdaNodejs.NodejsFunction(this, 'AuthTriggerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'index.ts'),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
        ALLOWED_EMAIL_DOMAINS: props?.allowedDomains?.join(',') || '*',
        FROM_EMAIL: 'noreply@todaysdentalinsights.com',
        APP_NAME: 'Today\'s Dental Insights',
        SAML_LOGS_TABLE: samlLogsTable.tableName,
        CONNECT_INSTANCE_ID: process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1',
      },
    });

    // Grant DynamoDB permissions to auth Lambda
    samlLogsTable.grantWriteData(authTriggerLambda);

    // Grant Connect permissions to auth Lambda
    authTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:GetFederationToken',
        'connect:CreateUser',
        'connect:DescribeUser',
        'connect:UpdateUserRoutingProfile',
        'connect:UpdateUserSecurityProfiles'
      ],
      resources: [`arn:aws:connect:${this.region}:${this.account}:instance/*`]
    }));

    // Create verify Lambda function
    const verifyLambda = new lambdaNodejs.NodejsFunction(this, 'VerifyFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', '..', 'services', 'auth', 'verify.ts'),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
        USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
        SAML_LOGS_TABLE: samlLogsTable.tableName,
        CONNECT_INSTANCE_ID: process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1',
      },
    });

    // Grant DynamoDB permissions to verify Lambda
    samlLogsTable.grantWriteData(verifyLambda);

    // Grant Connect permissions to verify Lambda
    verifyLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:GetFederationToken',
        'connect:DescribeUser',
        'connect:CreateUser',
        'connect:UpdateUserIdentityInfo'
      ],
      resources: [`arn:aws:connect:${this.region}:${this.account}:instance/*`]
    }));

    // Create API Gateway for verify endpoint
    const api = new apigw.RestApi(this, 'AuthApi', {
      restApiName: `${this.stackName}-AuthApi`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
    });

    const auth = api.root.addResource('auth');
    const verify = auth.addResource('verify');
    verify.addMethod('POST', new apigw.LambdaIntegration(verifyLambda));

    // Add triggers to User Pool
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_AUTHENTICATION,
      authTriggerLambda
    );
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION,
      authTriggerLambda
    );
    this.userPool.addTrigger(
      cognito.UserPoolOperation.CUSTOM_MESSAGE,
      authTriggerLambda
    );


    // Create User Pool Client
    this.userPoolClient = this.userPool.addClient('app-client', {
      userPoolClientName: `${this.stackName}-AppClient`,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
    });


    // Create Identity Pool
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${this.stackName}IdentityPool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });





    // Create IAM roles for authenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Attach the role to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Grant necessary permissions to authenticated role
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'connect:GetFederationToken',
          'connect:GetFederationTokens',
          'connect:CreateParticipantConnection',
        ],
        resources: ['*'],
      })
    );

    // Output important values
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
      exportName: `${this.stackName}-UserPoolClientId`,
    });



    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'The ID of the Cognito Identity Pool',
      exportName: `${this.stackName}-IdentityPoolId`,
    });
  }
}