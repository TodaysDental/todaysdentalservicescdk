import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
// Use cdk-amazon-chime-resources for Chime SIP resources
import * as chime from 'cdk-amazon-chime-resources';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
// Assuming 'getCdkCorsConfig' is exported from your shared utils
import { getCdkCorsConfig } from '../../shared/utils/cors';
import clinicsData from '../configs/clinics.json';

export interface ChimeStackProps extends StackProps {
  userPool: UserPool;
  // Pass in the existing API and Authorizer from AdminStack (optional). If omitted,
  // the Chime stack will not create API Gateway routes and the Admin stack should
  // wire integrations separately.
  api?: apigw.RestApi;
  authorizer?: apigw.CognitoUserPoolsAuthorizer;
}

export class ChimeStack extends Stack {
  public readonly clinicsTable: dynamodb.Table;
  public readonly agentPresenceTable: dynamodb.Table;
  public readonly callQueueTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ChimeStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. DynamoDB Tables
    // ========================================

    // Table to map clinicId to its public Chime phone number
    this.clinicsTable = new dynamodb.Table(this, 'ClinicsTable', {
      tableName: `${this.stackName}-Clinics`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN for production
    });

    // GSI to look up a clinic by its phone number (for inbound calls)
    this.clinicsTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
    });

    // Create a Lambda function to populate the table with initial data
    const populateTableFn = new lambdaNode.NodejsFunction(this, 'PopulateTableFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'populate-clinics-table.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(30),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
      },
    });

    // Grant the Lambda function permissions to write to the table
    this.clinicsTable.grantWriteData(populateTableFn);

    // Create a custom resource that will trigger the Lambda
    new cr.AwsCustomResource(this, 'PopulateTableTrigger', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: populateTableFn.functionName,
          InvocationType: 'Event',
        },
        physicalResourceId: cr.PhysicalResourceId.of('PopulateTableResource'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [populateTableFn.functionArn],
        }),
      ]),
    });

    // Populate table with initial data from clinics.json using the Lambda function
    new CustomResource(this, 'PopulateClinicsTable', {
      serviceToken: populateTableFn.functionArn,
      properties: {
        // Add a timestamp to force the custom resource to run on every deployment
        timestamp: new Date().toISOString()
      }
    });

    // Table to track real-time agent status and their Chime meeting details
    this.agentPresenceTable = new dynamodb.Table(this, 'AgentPresenceTable', {
      tableName: `${this.stackName}-AgentPresence`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING }, // Cognito 'sub'
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN for production
      timeToLiveAttribute: 'ttl', // Auto-clean up sessions
    });

    // Table to manage the call queue for each clinic
    this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
      tableName: `${this.stackName}-CallQueue`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queuePosition', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-cleanup of abandoned calls
    });

    // GSI for looking up queue items by callId
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'callId-index',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // GSI for looking up calls by status
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queueEntryTime', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // GSI to find available agents for a specific clinic
    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING }, // 'Online', 'Offline'
    });

    // ========================================
    // 2. Chime SDK PSTN Resources
    // ========================================

    // Lambda "brain" that handles all call routing logic
    const smaHandler = new lambdaNode.NodejsFunction(this, 'SmaHandler', {
      functionName: `${this.stackName}-SmaHandler`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'inbound-router.ts'),
      handler: 'handler',
  runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
      },
    });

    // The SIP Media Application that points to the Lambda "brain"
    const sipMediaApp = new chime.ChimeSipMediaApp(this, 'SipMediaApplication', {
      region: this.region,
      name: `${this.stackName}-SipMediaApp`,
      endpoint: smaHandler.functionArn,
    });

    // Grant the SMA handler permission to be invoked by Chime
    smaHandler.addPermission('SmaHandlerInvokePermission', {
      principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      // SourceArn must be a valid ARN string. The Chime SIP Media Application construct
      // exposes the application id (sipMediaApp.sipMediaAppId) but Lambda Permission
      // expects a full ARN. Construct the SIP Media Application ARN here so CloudFormation
      // validation passes.
      sourceArn: `arn:aws:chime:${this.region}:${this.account}:sip-media-application/${sipMediaApp.sipMediaAppId}`,
    });
    
    // Grant SMA handler permissions to DDB tables and Chime
    this.clinicsTable.grantReadData(smaHandler);
    this.agentPresenceTable.grantReadWriteData(smaHandler);
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['chime:UpdateSipMediaApplicationCall', 'chime:JoinChimeMeeting'],
        resources: ['*'], // Scope down if needed
    }));

    // Voice Connector (bridge to PSTN)
    const voiceConnector = new chime.ChimeVoiceConnector(this, 'VoiceConnector', {
      region: this.region,
      name: `${this.stackName}-VoiceConnector`,
      encryption: true,
    });

    // Create SIP Rules using reliable AWS SDK implementation
    // This replaces the broken cdk-amazon-chime-resources library
    
    const createSipRulesFn = new lambdaNode.NodejsFunction(this, 'CreateSipRulesFn', {
      functionName: `${this.stackName}-CreateSipRules`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'create-sip-rules.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.minutes(5),
      // Do not set AWS_REGION: the Lambda runtime reserves this variable.
      // If your function needs the region, read from process.env.AWS_REGION at runtime
      // or pass a different custom variable name (e.g., COGNITO_REGION) instead.
    });

    // Grant permissions to manage SIP rules
    createSipRulesFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'chime:CreateSipRule',
        'chime:DeleteSipRule',
        'chime:ListSipRules',
        'chime:GetSipRule',
        'chime:UpdateSipRule'
      ],
      resources: ['*']
    }));

    // Create custom resource to manage SIP rules
    const sipRulesResource = new CustomResource(this, 'SipRulesManager', {
      serviceToken: createSipRulesFn.functionArn,
      properties: {
        SipMediaApplicationId: sipMediaApp.sipMediaAppId,
        StackName: this.stackName,
        // Force update when clinics data changes
        ClinicsDataHash: this.node.tryGetContext('clinicsDataHash') || Date.now().toString()
      }
    });

    // Ensure SIP rules are created after SMA
    sipRulesResource.node.addDependency(sipMediaApp);

    console.log('✅ SIP Rules will be created using reliable AWS SDK implementation');
    console.log('🔧 Features: Conflict handling, retry logic, proper cleanup');
    
    // Output the number of unique phone numbers
    const uniquePhoneNumbers = new Set<string>();
    clinicsData.forEach((clinic) => {
      if (clinic.phoneNumber) {
        uniquePhoneNumbers.add(clinic.phoneNumber);
      }
    });
    
    new CfnOutput(this, 'UniquePhoneNumbers', {
      value: uniquePhoneNumbers.size.toString(),
      description: 'Number of unique phone numbers with SIP rules'
    });

    // Note: Phone numbers are configured in clinics.json and must be provisioned in the Chime SDK
    // console and associate them with this SIP Rule or Voice Connector.
    // Then, update the 'triggerValue' of the SipRule or associate the VC.
    // Finally, populate the `ClinicsTable` with the clinicId -> phoneNumber mapping.

    // ========================================
    // 3. Agent API Lambda Functions
    // ========================================

    // Shared policy for API Lambdas to interact with Chime Meetings
    const chimeSdkPolicy = new iam.PolicyStatement({
        actions: [
            'chime:CreateMeeting',
            'chime:CreateAttendee',
            'chime:DeleteMeeting',
            'chime:CreateSipMediaApplicationCall',
        ],
        resources: ['*'],
    });

    // Lambda for POST /chime/start-session
    const startSessionFn = new lambdaNode.NodejsFunction(this, 'StartSessionFn', {
      functionName: `${this.stackName}-StartSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'start-session.ts'),
      handler: 'handler',
  runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    startSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(startSessionFn);

    // Lambda for POST /chime/stop-session
    const stopSessionFn = new lambdaNode.NodejsFunction(this, 'StopSessionFn', {
      functionName: `${this.stackName}-StopSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'stop-session.ts'),
      handler: 'handler',
  runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    stopSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(stopSessionFn);

    // Lambda for POST /chime/outbound-call
    const outboundCallFn = new lambdaNode.NodejsFunction(this, 'OutboundCallFn', {
      functionName: `${this.stackName}-OutboundCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'outbound-call.ts'),
      handler: 'handler',
  runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
  SMA_ID: sipMediaApp.sipMediaAppId, // Pass SMA ID to the Lambda
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    this.clinicsTable.grantReadData(outboundCallFn);
    this.agentPresenceTable.grantReadData(outboundCallFn);

    // ========================================
    // 4. API Gateway Routes
    // ========================================
    
    if (props.api) {
      // Add a '/chime' resource to your *existing* Admin API
      const chimeApiRoot = props.api.root.addResource('chime');
      
      const corsOptions = {
        ...getCdkCorsConfig(),
        allowMethods: ['POST', 'OPTIONS'],
      };

      // POST /chime/start-session
      const startSessionRes = chimeApiRoot.addResource('start-session');
      startSessionRes.addMethod('POST', new apigw.LambdaIntegration(startSessionFn), {
        authorizer: props.authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
      try {
        startSessionRes.addCorsPreflight(corsOptions);
      } catch (e) {
        if (!(`${e}`.includes('There is already a Construct with name')))
          throw e;
      }

      // POST /chime/stop-session
      const stopSessionRes = chimeApiRoot.addResource('stop-session');
      stopSessionRes.addMethod('POST', new apigw.LambdaIntegration(stopSessionFn), {
        authorizer: props.authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
      try {
        stopSessionRes.addCorsPreflight(corsOptions);
      } catch (e) {
        if (!(`${e}`.includes('There is already a Construct with name')))
          throw e;
      }
    
      // POST /chime/outbound-call
      const outboundCallRes = chimeApiRoot.addResource('outbound-call');
      outboundCallRes.addMethod('POST', new apigw.LambdaIntegration(outboundCallFn), {
        authorizer: props.authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
      try {
        outboundCallRes.addCorsPreflight(corsOptions);
      } catch (e) {
        if (!(`${e}`.includes('There is already a Construct with name')))
          throw e;
      }

    // POST /chime/transfer-call
    const transferCallFn = new lambdaNode.NodejsFunction(this, 'TransferCallFn', {
      functionName: `${this.stackName}-TransferCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'transfer-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });

    // Grant DynamoDB permissions
    this.agentPresenceTable.grantReadWriteData(transferCallFn);

      const transferCallRes = chimeApiRoot.addResource('transfer-call');
      transferCallRes.addMethod('POST', new apigw.LambdaIntegration(transferCallFn), {
        authorizer: props.authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
      try {
        transferCallRes.addCorsPreflight(corsOptions);
      } catch (e) {
        if (!(`${e}`.includes('There is already a Construct with name')))
          throw e;
      }
    }

    // NOTE: The Agent presence API route is owned by the AdminStack to avoid
    // circular cross-stack references. The Chime stack only creates the
    // AgentPresence table and outputs its name.

    // ========================================
    // 5. Outputs
    // ========================================
    if (props.api) {
      new CfnOutput(this, 'ChimeApiUrl', {
        value: `${props.api.url}chime`,
        description: 'Chime Contact Center API endpoint root',
      });
    }
    new CfnOutput(this, 'ClinicsTableName', {
      value: this.clinicsTable.tableName,
    });
    new CfnOutput(this, 'AgentPresenceTableName', {
      value: this.agentPresenceTable.tableName,
    });
     new CfnOutput(this, 'SipMediaApplicationId', {
      value: sipMediaApp.sipMediaAppId,
    });
    }
  }
