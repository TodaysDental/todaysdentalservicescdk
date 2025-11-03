import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface ChimeStackProps extends StackProps {
  userPool: any;
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

    // Clinics table (holds Chime meeting info per clinic)
    this.clinicsTable = new dynamodb.Table(this, 'ClinicsTable', {
      tableName: `${this.stackName}-Clinics`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });


    // Agent Presence table
    this.agentPresenceTable = new dynamodb.Table(this, 'AgentPresenceTable', {
      tableName: `${this.stackName}-AgentPresence`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // GSI for querying by clinic
    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // GSI for querying by status - CRITICAL for finding online agents
    this.agentPresenceTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });


    // Call Queue table
    this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
      tableName: `${this.stackName}-CallQueue`,
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queuePosition', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying by callId
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'callId-index',
      partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // 2. Chime SIP Media Application
    // ========================================

    // Lambda for SIP Media Application
    const smaHandler = new lambdaNode.NodejsFunction(this, 'SmaHandler', {
      functionName: `${this.stackName}-SmaHandler`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'inbound-router.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: {
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        HOLD_MUSIC_BUCKET: '', // Will be updated after bucket creation
        CHIME_MEDIA_REGION: 'us-east-1', // Supported Chime SDK media region
      },
    });

    // Grant DynamoDB permissions
    this.clinicsTable.grantReadData(smaHandler);
    this.agentPresenceTable.grantReadWriteData(smaHandler);
    this.callQueueTable.grantReadWriteData(smaHandler);

    // Grant Chime SDK permissions
    smaHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // SIP Media Application actions
        'chime:CreateSipMediaApplicationCall',
        'chime:UpdateSipMediaApplicationCall',
        // Include both old namespace and new namespace for meetings
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        // SDK meetings namespace
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
      ],
      resources: ['*'],
    }));

    // Create S3 bucket for hold music
    const holdMusicBucket = new s3.Bucket(this, 'HoldMusicBucket', {
      bucketName: `${this.stackName.toLowerCase()}-hold-music-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Grant read access to the SMA handler
    holdMusicBucket.grantRead(smaHandler);

    // Update the environment variable
    smaHandler.addEnvironment('HOLD_MUSIC_BUCKET', holdMusicBucket.bucketName);

    // Create the SIP Media Application
    const sipMediaApp = new customResources.AwsCustomResource(this, 'SipMediaApp', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createSipMediaApplication',
        parameters: {
          Name: `${this.stackName}-SMA`,
          AwsRegion: this.region,
          Endpoints: [{
            LambdaArn: smaHandler.functionArn,
          }],
        },
        // Use a stable physical ID to help with resource tracking
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-SipMediaApp`),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteSipMediaApplication',
        parameters: {
          SipMediaApplicationId: new customResources.PhysicalResourceIdReference(),
        },
        // Ignore errors if the SIP Media Application doesn't exist
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateSipMediaApplication',
            'chime:DeleteSipMediaApplication',
            'chime:GetSipMediaApplication',
            'chime:ListSipMediaApplications',
          ],
          resources: ['*'],
        }),
        // Allow the custom resource to read/add the Lambda resource policy for the SMA handler
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:GetPolicy',
            'lambda:AddPermission',
          ],
          resources: [smaHandler.functionArn],
        }),
      ]),
    });

    // Add explicit invoke permission for the SIP Media Application
    // The AWS SDK's createSipMediaApplication does NOT automatically grant invoke permission
    smaHandler.addPermission('ChimeSMAInvoke', {
      principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      // We need to keep using getResponseField here because we need the actual SMA ID
      sourceArn: `arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`
    });

    // Create Voice Connector
    const voiceConnector = new customResources.AwsCustomResource(this, 'VoiceConnector', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createVoiceConnector',
        parameters: {
          Name: `${this.stackName}-VC`,
          RequireEncryption: true,
          AwsRegion: this.region,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-VoiceConnector`),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteVoiceConnector',
        parameters: {
          VoiceConnectorId: new customResources.PhysicalResourceIdReference(),
        },
        // Ignore errors if the Voice Connector doesn't exist (e.g., if it was manually deleted)
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateVoiceConnector',
            'chime:DeleteVoiceConnector',
            'chime:GetVoiceConnector',
            'chime:ListVoiceConnectors',
          ],
          resources: ['*'],
        }),
      ]),
    });
    
    // Configure Voice Connector termination settings for outbound calls
    const vcTermination = new customResources.AwsCustomResource(this, 'VCTermination', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'putVoiceConnectorTermination',
        parameters: {
          // Use the getResponseField method to get the VoiceConnectorId from the voiceConnector resource
          VoiceConnectorId: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
          Termination: {
            CpsLimit: 1,  // Calls per second limit
            CallingRegions: ['US'],  // Allowed calling regions
            Disabled: false,
            // AWS Chime SDK Voice requires public IPs with minimum netmask of 27
            CidrAllowedList: [
              '52.0.0.0/27',     // AWS public range
              '54.0.0.0/27',     // AWS public range
              '3.0.0.0/27',      // AWS public range
              '18.0.0.0/27',     // AWS public range
              '34.0.0.0/27'      // Google Cloud public range
            ]
          }
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
      },
      onUpdate: {
        service: 'ChimeSDKVoice',
        action: 'putVoiceConnectorTermination',
        parameters: {
          // Also update here to use getResponseField
          VoiceConnectorId: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
          Termination: {
            CpsLimit: 1,  // Calls per second limit
            CallingRegions: ['US'],  // Allowed calling regions
            Disabled: false,
            // AWS Chime SDK Voice requires CIDR with minimum netmask of 27
            // Using multiple large CIDR blocks to cover common ranges
            CidrAllowedList: [
              '52.0.0.0/27',     // AWS range
              '54.0.0.0/27',     // AWS range
              '3.0.0.0/27',      // AWS range
              '18.0.0.0/27'      // AWS range
            ]
          }
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
      },
      onDelete: {
        // No specific deletion needed for termination settings
        // The settings are deleted along with the voice connector
        service: 'ChimeSDKVoice',
        action: 'listVoiceConnectors', // Dummy action that doesn't affect anything
        parameters: {},
        ignoreErrorCodesMatching: '.*'
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:PutVoiceConnectorTermination',
            'chime:ListVoiceConnectors',
          ],
          resources: ['*'],
        }),
      ]),
    });
    
    vcTermination.node.addDependency(voiceConnector);

    // NOTE: Voice Connector Origination is NOT needed for this architecture
    // - Inbound calls (PSTN → Voice Connector → SMA) are routed via SIP Rules (see below)
    // - Outbound calls (SMA → Voice Connector → PSTN) use the Voice Connector's default outbound routing
    // Voice Connector Origination is only needed if routing outbound calls to external SIP providers
    // 
    // Previous implementation incorrectly tried to configure origination to route TO the SMA,
    // but this is wrong because:
    // 1. The SipMediaApplication.Endpoints[0].Hostname field doesn't exist in the API response
    // 2. Origination is for OUTBOUND routing FROM the VC, not for routing TO the SMA
    // 3. SIP Rules handle all routing TO the SMA for both inbound and outbound scenarios

    // ========================================
    // Load clinic phone numbers from clinics.json
    // ========================================
    const clinicsConfigPath = path.join(__dirname, '..', 'configs', 'clinics.json');
    const clinicsData = JSON.parse(fs.readFileSync(clinicsConfigPath, 'utf-8'));
    
    // Extract phone numbers from clinics that have them
    interface ClinicConfig {
      clinicId: string;
      phoneNumber?: string;
      clinicName?: string;
    }
    
    const clinicsWithPhones = (clinicsData as ClinicConfig[])
      .filter(clinic => clinic.phoneNumber && clinic.phoneNumber.startsWith('+'))
      .map(clinic => ({
        clinicId: clinic.clinicId,
        phoneNumber: clinic.phoneNumber!,
        clinicName: clinic.clinicName || clinic.clinicId
      }));

    console.log(`Found ${clinicsWithPhones.length} clinics with phone numbers`);

    // Associate phone numbers with Voice Connector if they're not already associated
    // For phone numbers that are already provisioned with VOICE_CONNECTOR product type,
    // this will ensure they are associated with the correct Voice Connector
    
    console.log(`Associating ${clinicsWithPhones.length} phone numbers with Voice Connector`);
    
    let associatePhones: customResources.AwsCustomResource[] = [];
    
    if (clinicsWithPhones.length > 0) {
      // Process phone numbers in smaller batches (max 10 per batch)
      const BATCH_SIZE = 5;
      const phoneNumberBatches: string[][] = [];
      
      // Split phone numbers into batches
      for (let i = 0; i < clinicsWithPhones.length; i += BATCH_SIZE) {
        const batch = clinicsWithPhones.slice(i, i + BATCH_SIZE).map(c => c.phoneNumber);
        phoneNumberBatches.push(batch);
      }
      
      console.log(`Processing ${clinicsWithPhones.length} phone numbers in ${phoneNumberBatches.length} batches`);
      
      // Create a separate custom resource for each batch
      phoneNumberBatches.forEach((phoneBatch, index) => {
        const resource = new customResources.AwsCustomResource(this, `AssociatePhoneNumbers-${index}`, {
          onCreate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true // Use false to avoid stealing numbers from other stacks
            },
            // Use stable resource ID for this phone batch
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onUpdate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true // Use false to avoid stealing numbers from other stacks
            },
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onDelete: {
            // Properly clean up phone associations when stack is deleted
            service: 'ChimeSDKVoice',
            action: 'disassociatePhoneNumbersFromVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
              E164PhoneNumbers: phoneBatch,
            },
            // Ignore errors if phone numbers or voice connector no longer exist
            ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
          },
          policy: customResources.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'chime:AssociatePhoneNumbersWithVoiceConnector',
                'chime:DisassociatePhoneNumbersFromVoiceConnector',
                'chime:ListPhoneNumbers'
              ],
              resources: ['*'],
            }),
          ]),
        });
        
        resource.node.addDependency(voiceConnector);
        associatePhones.push(resource);
      });
    }

    // ========================================
    // Create SIP Rules for Phone Number Routing
    // ========================================
    
    // NOTE: No need for an outbound SIP rule.
    // For outbound calls initiated by the SMA (using CreateSipMediaApplicationCall),
    // the Voice Connector automatically routes the calls to the PSTN.
    // The flow for outbound calls is:
    // 1. outbound-call.ts Lambda calls CreateSipMediaApplicationCall
    // 2. SMA handler receives NEW_OUTBOUND_CALL event
    // 3. SMA handler makes outbound call through Voice Connector
    // 4. Voice Connector routes to PSTN (no SIP rule needed)

    // Create a single SIP rule to handle all phone numbers
    // AWS Chime has a limit of 25 SIP rules per SIP Media Application
    console.log('Creating a single SIP Rule with RequestUriHostname trigger type for all clinics');
    
    // Create a single SIP rule for all calls
    const sipRule = new customResources.AwsCustomResource(this, 'SipRule', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createSipRule',
        parameters: {
          Name: `${this.stackName}-AllPhoneNumbers`,
          // Use RequestUriHostname trigger which will match on Voice Connector domain
          TriggerType: 'RequestUriHostname', 
          // Use the VoiceConnector outbound hostname as the trigger
          TriggerValue: voiceConnector.getResponseField('VoiceConnector.OutboundHostName'),
          TargetApplications: [{
            SipMediaApplicationId: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
            Priority: 1,
            AwsRegion: this.region,
          }],
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-SipRule`),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteSipRule',
        parameters: {
          SipRuleId: new customResources.PhysicalResourceIdReference(),
        },
        // Ignore errors if the SIP rule doesn't exist
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:CreateSipRule',
            'chime:DeleteSipRule',
            'chime:GetSipRule',
            'chime:ListSipRules',
          ],
          resources: ['*'],
        }),
      ]),
    });
    
    sipRule.node.addDependency(voiceConnector);
    sipRule.node.addDependency(sipMediaApp);
    
    // Log number of clinics with phone numbers for reference
    console.log(`Found ${clinicsWithPhones.length} clinics with phone numbers that will share this SIP rule`);

    // Dependencies are added per SIP rule in the forEach loop above

    // Enable SIP Media Application logging for debugging
    const smaLogging = new customResources.AwsCustomResource(this, 'SMALogging', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'putSipMediaApplicationLoggingConfiguration',
        parameters: {
          SipMediaApplicationId: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
          SipMediaApplicationLoggingConfiguration: {
            EnableSipMediaApplicationMessageLogs: true
          }
        },
        physicalResourceId: customResources.PhysicalResourceId.of('sma-logging-config'),
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'chime:PutSipMediaApplicationLoggingConfiguration',
          ],
          resources: ['*'],
        }),
        // Add logs:ListLogDeliveries permission required for SMA logging
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:ListLogDeliveries',
            'logs:CreateLogDelivery',
            'logs:GetLogDelivery',
            'logs:UpdateLogDelivery',
            'logs:DeleteLogDelivery',
            'logs:ListLogDeliveries',
            'logs:PutResourcePolicy',
            'logs:DescribeResourcePolicies',
            'logs:DescribeLogGroups'
          ],
          resources: ['*'],
        }),
      ]),
    });

    smaLogging.node.addDependency(sipMediaApp);
    
    // Note: Phone numbers need to be associated with the Voice Connector,
    // but we don't need individual SIP rules for each phone number

    // ========================================
    // 3. Lambda Functions
    // ========================================

    // Shared Chime SDK policy for meeting operations
    const chimeSdkPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Include both old namespace and new namespace for compatibility
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteAttendee',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
        // SDK meetings namespace
        'chime-sdk-meetings:CreateMeeting',
        'chime-sdk-meetings:CreateAttendee',
        'chime-sdk-meetings:DeleteMeeting',
        'chime-sdk-meetings:GetMeeting',
        'chime-sdk-meetings:ListAttendees',
        'chime-sdk-meetings:DeleteAttendee',
        'chime-sdk-meetings:StartMeetingTranscription',
        'chime-sdk-meetings:StopMeetingTranscription',
      ],
      resources: ['*'],
    });

    // Cognito policy for user lookup
    const cognitoPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
      ],
      resources: [props.userPool.userPoolArn],
    });

    // Lambda for POST /chime/start-session
    const startSessionFn = new lambdaNode.NodejsFunction(this, 'StartSessionFn', {
      functionName: `${this.stackName}-StartSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'start-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName, // CRITICAL FIX: Add missing env var
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime meeting creation
      },
    });
    // Ensure a LogGroup exists for the Lambda so we can attach metric filters and retention
    const startSessionLogGroup = new logs.LogGroup(this, 'StartSessionLogGroup', {
      logGroupName: `/aws/lambda/${startSessionFn.functionName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Metric filter to count error lines in the Lambda logs
    new logs.MetricFilter(this, 'StartSessionErrorMetricFilter', {
      logGroup: startSessionLogGroup,
      metricNamespace: 'Chime',
      metricName: 'StartSessionErrors',
      filterPattern: logs.FilterPattern.anyTerm('ERROR', 'Error', 'Exception'),
      metricValue: '1',
    });

    // Alarm when there is at least 1 error in a 5-minute window
    new cloudwatch.Alarm(this, 'StartSessionErrorAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'Chime',
        metricName: 'StartSessionErrors',
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarm when StartSession Lambda emits errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    startSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(startSessionFn);
    this.callQueueTable.grantReadData(startSessionFn); // CRITICAL FIX: Add queue table read access
    
    // Add API Gateway permission for Admin API to invoke this function
    startSessionFn.addPermission('AdminApiInvokeStartSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/stop-session
    const stopSessionFn = new lambdaNode.NodejsFunction(this, 'StopSessionFn', {
      functionName: `${this.stackName}-StopSession`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'stop-session.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime operations
      },
    });
    stopSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(stopSessionFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    stopSessionFn.addPermission('AdminApiInvokeStopSession', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/outbound-call
    const outboundCallFn = new lambdaNode.NodejsFunction(this, 'OutboundCallFn', {
      functionName: `${this.stackName}-OutboundCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'outbound-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CLINICS_TABLE_NAME: this.clinicsTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        // These are ok to keep using getResponseField since we need the actual IDs
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        VOICE_CONNECTOR_ID: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Use stack region for consistency

        // Cognito configuration (needed for user lookup/auth in the Lambda)
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    outboundCallFn.addToRolePolicy(cognitoPolicy);
    this.agentPresenceTable.grantReadWriteData(outboundCallFn);
    this.clinicsTable.grantReadData(outboundCallFn);
    this.callQueueTable.grantReadWriteData(outboundCallFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    outboundCallFn.addPermission('AdminApiInvokeOutboundCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    // Grant permission to make outbound calls
    outboundCallFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:CreateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`],
    }));

    // Lambda for POST /chime/transfer-call
    const transferCallFn = new lambdaNode.NodejsFunction(this, 'TransferCallFn', {
      functionName: `${this.stackName}-TransferCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'transfer-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime operations
      },
    });
    this.agentPresenceTable.grantReadWriteData(transferCallFn);
    this.callQueueTable.grantReadWriteData(transferCallFn);
    
    // Grant permission to update SIP Media Application calls
    transferCallFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['chime:UpdateSipMediaApplicationCall'],
        resources: ['*'],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    transferCallFn.addPermission('AdminApiInvokeTransferCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-accepted
    const callAcceptedFn = new lambdaNode.NodejsFunction(this, 'CallAcceptedFn', {
      functionName: `${this.stackName}-CallAccepted`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-accepted.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime operations
      },
    });
    this.agentPresenceTable.grantReadWriteData(callAcceptedFn);
    this.callQueueTable.grantReadWriteData(callAcceptedFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    callAcceptedFn.addPermission('AdminApiInvokeCallAccepted', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-rejected
    const callRejectedFn = new lambdaNode.NodejsFunction(this, 'CallRejectedFn', {
      functionName: `${this.stackName}-CallRejected`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-rejected.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime operations
      },
    });
    this.agentPresenceTable.grantReadWriteData(callRejectedFn);
    this.callQueueTable.grantReadWriteData(callRejectedFn);
    callRejectedFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    callRejectedFn.addPermission('AdminApiInvokeCallRejected', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/call-hungup
    const callHungupFn = new lambdaNode.NodejsFunction(this, 'CallHungupFn', {
      functionName: `${this.stackName}-CallHungup`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'call-hungup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        // FIX 1: Pass the SIP Media Application ID (SMA_ID) to the Lambda
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime meeting operations
      },
    });
    this.agentPresenceTable.grantReadWriteData(callHungupFn);
    this.callQueueTable.grantReadWriteData(callHungupFn);
    callHungupFn.addToRolePolicy(chimeSdkPolicy); // CRITICAL FIX: Add Chime SDK permissions for meeting/attendee operations
    
    // FIX 2: Grant the Lambda permission to terminate the customer's call leg
    callHungupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/${sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId')}`],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    callHungupFn.addPermission('AdminApiInvokeCallHungup', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // Lambda for POST /chime/leave-call
    const leaveCallFn = new lambdaNode.NodejsFunction(this, 'LeaveCallFn', {
      functionName: `${this.stackName}-LeaveCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'leave-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        CHIME_MEDIA_REGION: this.region, // CRITICAL FIX: Add media region for Chime meeting operations
      },
    });
    this.agentPresenceTable.grantReadWriteData(leaveCallFn);
    this.callQueueTable.grantReadWriteData(leaveCallFn);
    leaveCallFn.addToRolePolicy(chimeSdkPolicy); // CRITICAL FIX: Add Chime SDK permissions for meeting/attendee operations
    
    // Add API Gateway permission for Admin API to invoke this function
    leaveCallFn.addPermission('AdminApiInvokeLeaveCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    // Lambda for POST /chime/hold-call
    const holdCallFn = new lambdaNode.NodejsFunction(this, 'HoldCallFn', {
      functionName: `${this.stackName}-HoldCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'hold-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        CHIME_MEDIA_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(holdCallFn);
    this.callQueueTable.grantReadWriteData(holdCallFn);
    
    // Grant permission to update SIP Media Application calls
    holdCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: ['*'],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    holdCallFn.addPermission('AdminApiInvokeHoldCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    // Lambda for POST /chime/resume-call
    const resumeCallFn = new lambdaNode.NodejsFunction(this, 'ResumeCallFn', {
      functionName: `${this.stackName}-ResumeCall`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'resume-call.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        SMA_ID: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
        CHIME_MEDIA_REGION: this.region,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(resumeCallFn);
    this.callQueueTable.grantReadWriteData(resumeCallFn);
    resumeCallFn.addToRolePolicy(chimeSdkPolicy);
    
    // Grant permission to update SIP Media Application calls
    resumeCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: ['*'],
    }));
    
    // Add API Gateway permission for Admin API to invoke this function
    resumeCallFn.addPermission('AdminApiInvokeResumeCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // ========================================
    // 4. API Gateway Routes (deprecated - now handled by AdminStack)
    // ========================================
    
    // NOTE: API routes are now created in AdminStack to avoid circular dependencies.
    // The Lambda functions are exported via CfnOutput and imported by AdminStack.

    // ========================================
    // 5. Outputs
    // ========================================
    new CfnOutput(this, 'ClinicsTableName', {
      value: this.clinicsTable.tableName,
    });
    new CfnOutput(this, 'AgentPresenceTableName', {
      value: this.agentPresenceTable.tableName,
    });
     new CfnOutput(this, 'SipMediaApplicationId', {
      value: sipMediaApp.getResponseField('SipMediaApplication.SipMediaApplicationId'),
    });
    
    // Export Chime Lambda ARNs so other stacks (Admin) can import them and
    // create API integrations without creating a two-way construct reference.
    new CfnOutput(this, 'StartSessionFnArn', {
      value: startSessionFn.functionArn,
      exportName: `${this.stackName}-StartSessionArn`,
    });
    new CfnOutput(this, 'StopSessionFnArn', {
      value: stopSessionFn.functionArn,
      exportName: `${this.stackName}-StopSessionArn`,
    });
    new CfnOutput(this, 'OutboundCallFnArn', {
      value: outboundCallFn.functionArn,
      exportName: `${this.stackName}-OutboundCallArn`,
    });
    new CfnOutput(this, 'TransferCallFnArn', {
      value: transferCallFn.functionArn,
      exportName: `${this.stackName}-TransferCallArn`,
    });
    new CfnOutput(this, 'CallAcceptedFnArn', {
      value: callAcceptedFn.functionArn,
      exportName: `${this.stackName}-CallAcceptedArn`,
    });
    new CfnOutput(this, 'CallRejectedFnArn', {
      value: callRejectedFn.functionArn,
      exportName: `${this.stackName}-CallRejectedArn`,
    });
    new CfnOutput(this, 'CallHungupFnArn', {
      value: callHungupFn.functionArn,
      exportName: `${this.stackName}-CallHungupArn`,
    });
    new CfnOutput(this, 'LeaveCallFnArn', {
      value: leaveCallFn.functionArn,
      exportName: `${this.stackName}-LeaveCallArn`,
    });
    new CfnOutput(this, 'HoldCallFnArn', {
      value: holdCallFn.functionArn,
      exportName: `${this.stackName}-HoldCallArn`,
    });
    new CfnOutput(this, 'ResumeCallFnArn', {
      value: resumeCallFn.functionArn,
      exportName: `${this.stackName}-ResumeCallArn`,
    });
    new CfnOutput(this, 'AgentPresenceTableNameExport', {
      value: this.agentPresenceTable.tableName,
      exportName: `${this.stackName}-AgentPresenceTableName`,
    });
    new CfnOutput(this, 'HoldMusicBucketName', {
      value: holdMusicBucket.bucketName,
      description: 'S3 bucket for hold music. Upload a file named "hold-music.wav" to this bucket.',
    });
    
    new CfnOutput(this, 'VoiceConnectorId', {
      value: voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId'),
      description: 'Voice Connector ID - use this to associate phone numbers',
      exportName: `${this.stackName}-VoiceConnectorId`,
    });
    
    new CfnOutput(this, 'VoiceConnectorOutboundHostName', {
      value: voiceConnector.getResponseField('VoiceConnector.OutboundHostName'),
      description: 'Voice Connector Outbound Host - use this for SIP routing',
      exportName: `${this.stackName}-VoiceConnectorHost`,
    });

    // ========================================
    // 6. Heartbeat and Cleanup Monitor
    // ========================================

    // Heartbeat Lambda
    const heartbeatFn = new lambdaNode.NodejsFunction(this, 'HeartbeatFn', {
      functionName: `${this.stackName}-Heartbeat`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'heartbeat.ts'),
      handler: 'handler',
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    
    // Grant permissions to Heartbeat Lambda
    this.agentPresenceTable.grantReadWriteData(heartbeatFn);
    
    // Add API Gateway permission for Admin API to invoke this function
    heartbeatFn.addPermission('AdminApiInvokeHeartbeat', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    // Export ARN for use in API Gateway
    new CfnOutput(this, 'HeartbeatFnArn', {
      value: heartbeatFn.functionArn,
      exportName: `${this.stackName}-HeartbeatArn`,
    });
    
    // Cleanup Monitor Lambda
    const cleanupMonitorFn = new lambdaNode.NodejsFunction(this, 'CleanupMonitorFn', {
      functionName: `${this.stackName}-CleanupMonitor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'cleanup-monitor.ts'),
      handler: 'handler',
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30), // Longer timeout for bulk operations
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        CHIME_MEDIA_REGION: this.region,
      },
    });
    
    // Grant permissions to Cleanup Monitor Lambda
    this.agentPresenceTable.grantReadWriteData(cleanupMonitorFn);
    this.callQueueTable.grantReadWriteData(cleanupMonitorFn);
    
    // Add Chime meeting delete permissions
    cleanupMonitorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:DeleteMeeting', 'chime:ListMeetings'],
      resources: ['*'], // Chime meetings don't support resource-level permissions
    }));
    
    // Create EventBridge rule to trigger cleanup monitor every 5 minutes
    const rule = new events.Rule(this, 'CleanupMonitorRule', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      description: 'Trigger cleanup monitor to handle orphaned resources and stale agent presence',
    });
    
    // Set the cleanup monitor as the target for the rule
    rule.addTarget(new targets.LambdaFunction(cleanupMonitorFn));
    
    // Export ARN for reference
    new CfnOutput(this, 'CleanupMonitorFnArn', {
      value: cleanupMonitorFn.functionArn,
      exportName: `${this.stackName}-CleanupMonitorArn`,
    });

    }
  }