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
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface ChimeStackProps extends StackProps {
  userPool: any;
  api?: apigw.RestApi;
  authorizer?: apigw.CognitoUserPoolsAuthorizer;
  /**
   * Optional list of CIDR blocks that are allowed to send SIP traffic to the
   * Amazon Chime Voice Connector termination endpoint. Each CIDR must have a
   * prefix of /27 or smaller as required by the service.
   *
   * Termination settings control outbound calling permissions only. Inbound
   * routing continues to flow through the origination routes and SIP rule
   * resources defined later in this stack, so leaving this undefined will not
   * block phone numbers from reaching the contact center.
   */
  voiceConnectorTerminationCidrs?: string[];
  /**
   * Optional list of origination routes that allow the contact center to
   * receive inbound calls from an external SIP provider. When undefined we
   * skip provisioning the origination custom resource entirely which avoids
   * submitting placeholder hosts that Amazon Chime Voice Connector rejects.
   */
  voiceConnectorOriginationRoutes?: VoiceConnectorOriginationRouteConfig[];
}

export type VoiceConnectorOriginationProtocol = 'UDP' | 'TCP' | 'TLS';

export interface VoiceConnectorOriginationRouteConfig {
  host: string;
  port?: number;
  protocol?: VoiceConnectorOriginationProtocol;
  priority?: number;
  weight?: number;
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

    // Add GSI for phoneNumber lookups
    this.clinicsTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
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

    // Upload audio files from local assets directory
    new s3deploy.BucketDeployment(this, 'DeployHoldMusic', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'assets', 'audio'))
      ],
      destinationBucket: holdMusicBucket,
      prune: false,
    });

    const chimeCustomResourceRole = new iam.Role(this, 'ChimeVoiceCustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Shared role for Chime Voice custom resources',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:AssociatePhoneNumbersWithVoiceConnector',
        'chime:CreateSipMediaApplication',
        'chime:CreateSipRule',
        'chime:CreateVoiceConnector',
        'chime:DeleteSipMediaApplication',
        'chime:DeleteSipRule',
        'chime:DeleteVoiceConnector',
        'chime:DeleteVoiceConnectorOrigination',
        'chime:DeleteVoiceConnectorTermination',
        'chime:DisassociatePhoneNumbersFromVoiceConnector',
        'chime:GetSipMediaApplication',
        'chime:GetSipRule',
        'chime:GetVoiceConnector',
        'chime:GetVoiceConnectorOrigination',
        'chime:GetVoiceConnectorTermination',
        'chime:ListPhoneNumbers',
        'chime:ListSipMediaApplications',
        'chime:ListSipRules',
        'chime:ListVoiceConnectors',
        'chime:PutSipMediaApplicationLoggingConfiguration',
        'chime:PutVoiceConnectorOrigination',
        'chime:PutVoiceConnectorTermination',
        'chime:UpdateSipRule',
      ],
      resources: ['*'],
    }));

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogDelivery',
        'logs:DeleteLogDelivery',
        'logs:DescribeLogGroups',
        'logs:DescribeResourcePolicies',
        'logs:GetLogDelivery',
        'logs:ListLogDeliveries',
        'logs:PutResourcePolicy',
        'logs:UpdateLogDelivery',
      ],
      resources: ['*'],
    }));

    chimeCustomResourceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:AddPermission', 'lambda:GetPolicy'],
      resources: [smaHandler.functionArn],
    }));

    // Create Voice Connector - FIX: Capture the ID correctly
    const voiceConnector = new customResources.AwsCustomResource(this, 'VoiceConnector', {
      onCreate: {
        service: 'ChimeSDKVoice',
        action: 'createVoiceConnector',
        parameters: {
          Name: `${this.stackName}-VC`,
          RequireEncryption: true,
          AwsRegion: this.region,
        },
        physicalResourceId: customResources.PhysicalResourceId.fromResponse('VoiceConnector.VoiceConnectorId'),
      },
      onDelete: {
        service: 'ChimeSDKVoice',
        action: 'deleteVoiceConnector',
        parameters: {
          VoiceConnectorId: new customResources.PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
      },
      role: chimeCustomResourceRole,
    });

    // Store Voice Connector details with correct nested paths
    const voiceConnectorId = voiceConnector.getResponseField('VoiceConnector.VoiceConnectorId');
    const voiceConnectorOutboundHost = voiceConnector.getResponseField('VoiceConnector.OutboundHostName');

    const terminationCidrs = props.voiceConnectorTerminationCidrs
      ?.map((cidr) => cidr.trim())
      .filter((cidr) => cidr.length > 0);

    const hasTerminationCidrs = Boolean(terminationCidrs && terminationCidrs.length > 0);

    if (hasTerminationCidrs) {
      const invalidCidrs = terminationCidrs!.filter((cidr) => {
        const [_, prefix] = cidr.split('/');
        const prefixNumber = Number(prefix);
        return Number.isNaN(prefixNumber) || prefixNumber < 27 || prefixNumber > 32;
      });

      if (invalidCidrs.length > 0) {
        throw new Error(`voiceConnectorTerminationCidrs must contain CIDR blocks with a /27 or smaller prefix. Invalid entries: ${invalidCidrs.join(', ')}`);
      }
    }

    // ========================================
    // Voice Connector Termination - For OUTBOUND calls
    // ========================================
    // Allow deployments to optionally configure termination CIDR blocks. When
    // no CIDRs are provided we skip provisioning the termination custom
    // resource entirely so CloudFormation does not submit empty values that
    // Chime rejects (e.g., null CIDR lists or 0.0.0.0/0 defaults).
    let vcTermination: customResources.AwsCustomResource | undefined;

    if (hasTerminationCidrs) {
      const terminationConfig = {
        CpsLimit: 1,
        CallingRegions: ['US'],
        CidrAllowedList: terminationCidrs!,
        Disabled: false,
      };

      vcTermination = new customResources.AwsCustomResource(this, 'VCTermination', {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Termination: {
              ...terminationConfig,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Termination: {
              ...terminationConfig,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-termination`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteVoiceConnectorTermination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
        },
        role: chimeCustomResourceRole,
      });

      vcTermination.node.addDependency(voiceConnector);
    }

    // ========================================
    // Voice Connector Origination - For INBOUND calls
    // ========================================
    const originationRoutes = props.voiceConnectorOriginationRoutes?.map((route, index) => {
      const host = route.host?.trim();

      if (!host) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] must include a non-empty host value.`);
      }

      if (/\.voiceconnector\.chime\.aws$/i.test(host)) {
        throw new Error(
          `voiceConnectorOriginationRoutes[${index}] host "${host}" uses an Amazon-managed domain that cannot be set ` +
          'as an origination route. Provide the SIP host from your carrier or SBC instead.'
        );
      }

      const port = route.port ?? 5060;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] port must be an integer between 1 and 65535.`);
      }

      const protocol = (route.protocol ?? 'UDP').toUpperCase();
      if (!['UDP', 'TCP', 'TLS'].includes(protocol)) {
        throw new Error(
          `voiceConnectorOriginationRoutes[${index}] protocol must be one of UDP, TCP, or TLS. Received: ${protocol}`
        );
      }

      const priority = route.priority ?? index + 1;
      if (!Number.isInteger(priority) || priority < 1 || priority > 20) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] priority must be an integer between 1 and 20.`);
      }

      const weight = route.weight ?? 1;
      if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
        throw new Error(`voiceConnectorOriginationRoutes[${index}] weight must be an integer between 1 and 10.`);
      }

      return {
        Host: host,
        Port: port,
        Protocol: protocol as VoiceConnectorOriginationProtocol,
        Priority: priority,
        Weight: weight,
      };
    });

    if (originationRoutes && originationRoutes.length > 0) {
      const vcOrigination = new customResources.AwsCustomResource(this, 'VCOrigination', {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Origination: {
              Routes: originationRoutes,
              Disabled: false,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-origination`),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'putVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
            Origination: {
              Routes: originationRoutes,
              Disabled: false,
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-voice-connector-origination`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteVoiceConnectorOrigination',
          parameters: {
            VoiceConnectorId: voiceConnectorId,
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
        },
        role: chimeCustomResourceRole,
      });

      // CRITICAL: Add dependencies - Origination must wait for Termination
      vcOrigination.node.addDependency(voiceConnector);
      if (vcTermination) {
        vcOrigination.node.addDependency(vcTermination);
      }
    }

    // ========================================
    // Load clinic phone numbers from clinics.json
    // ========================================
    const clinicsConfigPath = path.join(__dirname, '..', 'configs', 'clinics.json');
    const clinicsData = JSON.parse(fs.readFileSync(clinicsConfigPath, 'utf-8'));
    
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

    // ========================================
    // Create per-clinic SIP Media Applications and SIP Rules
    // ========================================

    const clinicSipRules: Record<string, customResources.AwsCustomResource> = {};
    const smaIdMap: Record<string, string> = {};
    const phoneNumberToClinicId = new Map<string, string>();

    let previousClinicResource: Construct | undefined;

    clinicsWithPhones.forEach((clinic) => {
      const sanitizedId = clinic.clinicId.replace(/[^A-Za-z0-9]/g, '-');

      const smaResource = new customResources.AwsCustomResource(this, `SipMediaApp-${sanitizedId}`, {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'createSipMediaApplication',
          parameters: {
            Name: `${this.stackName}-${sanitizedId}-SMA`,
            AwsRegion: this.region,
            Endpoints: [{
              LambdaArn: smaHandler.functionArn,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipMediaApplication.SipMediaApplicationId'),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteSipMediaApplication',
          parameters: {
            SipMediaApplicationId: new customResources.PhysicalResourceIdReference(),
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
        },
        role: chimeCustomResourceRole,
      });

      if (previousClinicResource) {
        smaResource.node.addDependency(previousClinicResource);
      }

      const smaIdToken = smaResource.getResponseField('SipMediaApplication.SipMediaApplicationId');
      smaIdMap[clinic.clinicId] = smaIdToken;
      phoneNumberToClinicId.set(clinic.phoneNumber, clinic.clinicId);

      const sipRule = new customResources.AwsCustomResource(this, `SipRule-${sanitizedId}`, {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'createSipRule',
          parameters: {
            Name: `${this.stackName}-${sanitizedId}-Rule`,
            TriggerType: 'ToPhoneNumber',
            TriggerValue: clinic.phoneNumber,
            TargetApplications: [{
              SipMediaApplicationId: smaIdToken,
              Priority: 1,
              AwsRegion: this.region,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
        },
        onUpdate: {
          service: 'ChimeSDKVoice',
          action: 'updateSipRule',
          parameters: {
            SipRuleId: new customResources.PhysicalResourceIdReference(),
            Name: `${this.stackName}-${sanitizedId}-Rule`,
            TriggerType: 'ToPhoneNumber',
            TriggerValue: clinic.phoneNumber,
            TargetApplications: [{
              SipMediaApplicationId: smaIdToken,
              Priority: 1,
              AwsRegion: this.region,
            }],
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-${sanitizedId}-SipRule`),
        },
        onDelete: {
          service: 'ChimeSDKVoice',
          action: 'deleteSipRule',
          parameters: {
            SipRuleId: new customResources.PhysicalResourceIdReference(),
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
        },
        role: chimeCustomResourceRole,
      });

      sipRule.node.addDependency(voiceConnector);
      sipRule.node.addDependency(smaResource);
      if (vcTermination) {
        sipRule.node.addDependency(vcTermination);
      }

      clinicSipRules[clinic.clinicId] = sipRule;

      const smaLogging = new customResources.AwsCustomResource(this, `SmaLogging-${sanitizedId}`, {
        onCreate: {
          service: 'ChimeSDKVoice',
          action: 'putSipMediaApplicationLoggingConfiguration',
          parameters: {
            SipMediaApplicationId: smaIdToken,
            SipMediaApplicationLoggingConfiguration: {
              EnableSipMediaApplicationMessageLogs: true
            }
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-${sanitizedId}-logging-config`),
        },
        role: chimeCustomResourceRole,
      });

      smaLogging.node.addDependency(smaResource);
      smaLogging.node.addDependency(sipRule);

      previousClinicResource = smaLogging;
    });

    if (clinicsWithPhones.length > 0) {
      smaHandler.addPermission('ChimeVoiceInvoke', {
        principal: new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
        sourceArn: `arn:aws:chime:${this.region}:${this.account}:vc/*`,
      });
    }

    const smaIdMapJson = Stack.of(this).toJsonString(smaIdMap);

    // Associate phone numbers with Voice Connector
    console.log(`Associating ${clinicsWithPhones.length} phone numbers with Voice Connector`);

    let associatePhones: customResources.AwsCustomResource[] = [];
    
    if (clinicsWithPhones.length > 0) {
      const BATCH_SIZE = 5;
      const phoneNumberBatches: string[][] = [];
      
      for (let i = 0; i < clinicsWithPhones.length; i += BATCH_SIZE) {
        const batch = clinicsWithPhones.slice(i, i + BATCH_SIZE).map(c => c.phoneNumber);
        phoneNumberBatches.push(batch);
      }
      
      console.log(`Processing ${clinicsWithPhones.length} phone numbers in ${phoneNumberBatches.length} batches`);
      
      phoneNumberBatches.forEach((phoneBatch, index) => {
        const resource = new customResources.AwsCustomResource(this, `AssociatePhoneNumbers-${index}`, {
          onCreate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true 
            },
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onUpdate: {
            service: 'ChimeSDKVoice',
            action: 'associatePhoneNumbersWithVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
              ForceAssociate: true 
            },
            physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-associate-phones-batch-${index}`),
          },
          onDelete: {
            service: 'ChimeSDKVoice',
            action: 'disassociatePhoneNumbersFromVoiceConnector',
            parameters: {
              VoiceConnectorId: voiceConnectorId,
              E164PhoneNumbers: phoneBatch,
            },
            ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*|.*DoesNotExist.*',
          },
          role: chimeCustomResourceRole,
        });

        resource.node.addDependency(voiceConnector);
        phoneBatch.forEach(phoneNumber => {
          const clinicId = phoneNumberToClinicId.get(phoneNumber);
          if (clinicId) {
            const sipRule = clinicSipRules[clinicId];
            if (sipRule) {
              resource.node.addDependency(sipRule);
            }
          }
        });
        associatePhones.push(resource);
      });
    }

    // ========================================
    // 3. Lambda Functions
    // ========================================

    // Shared Chime SDK policy for meeting operations
    const chimeSdkPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:GetMeeting',
        'chime:ListAttendees',
        'chime:DeleteAttendee',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
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
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        CHIME_MEDIA_REGION: 'us-east-1',
      },
    });
    const startSessionLogGroup = new logs.LogGroup(this, 'StartSessionLogGroup', {
      logGroupName: `/aws/lambda/${startSessionFn.functionName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    new logs.MetricFilter(this, 'StartSessionErrorMetricFilter', {
      logGroup: startSessionLogGroup,
      metricNamespace: 'Chime',
      metricName: 'StartSessionErrors',
      filterPattern: logs.FilterPattern.anyTerm('ERROR', 'Error', 'Exception'),
      metricValue: '1',
    });
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
    this.callQueueTable.grantReadData(startSessionFn); 
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
        CHIME_MEDIA_REGION: 'us-east-1',
      },
    });
    stopSessionFn.addToRolePolicy(chimeSdkPolicy);
    this.agentPresenceTable.grantReadWriteData(stopSessionFn);
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
        SMA_ID_MAP: smaIdMapJson,
        VOICE_CONNECTOR_ID: voiceConnectorId,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    outboundCallFn.addToRolePolicy(cognitoPolicy);
    this.agentPresenceTable.grantReadWriteData(outboundCallFn);
    this.clinicsTable.grantReadData(outboundCallFn);
    this.callQueueTable.grantReadWriteData(outboundCallFn);
    outboundCallFn.addPermission('AdminApiInvokeOutboundCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    outboundCallFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:CreateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(transferCallFn);
    this.callQueueTable.grantReadWriteData(transferCallFn);
    transferCallFn.addToRolePolicy(chimeSdkPolicy);
    transferCallFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['chime:UpdateSipMediaApplicationCall'],
        resources: ['*'],
    }));
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(callAcceptedFn);
    this.callQueueTable.grantReadWriteData(callAcceptedFn);
    callAcceptedFn.addToRolePolicy(chimeSdkPolicy);
    callAcceptedFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['chime:UpdateSipMediaApplicationCall'],
        resources: ['*'],
    }));
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(callRejectedFn);
    this.callQueueTable.grantReadWriteData(callRejectedFn);
    callRejectedFn.addToRolePolicy(chimeSdkPolicy);
    callRejectedFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(callHungupFn);
    this.callQueueTable.grantReadWriteData(callHungupFn);
    callHungupFn.addToRolePolicy(chimeSdkPolicy); 
    callHungupFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: [`arn:aws:chime:${this.region}:${this.account}:sma/*`],
    }));
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
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(leaveCallFn);
    this.callQueueTable.grantReadWriteData(leaveCallFn);
    leaveCallFn.addToRolePolicy(chimeSdkPolicy); 
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(holdCallFn);
    this.callQueueTable.grantReadWriteData(holdCallFn);
    holdCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: ['*'],
    }));
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
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });
    this.agentPresenceTable.grantReadWriteData(resumeCallFn);
    this.callQueueTable.grantReadWriteData(resumeCallFn);
    resumeCallFn.addToRolePolicy(chimeSdkPolicy);
    resumeCallFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['chime:UpdateSipMediaApplicationCall'],
      resources: ['*'],
    }));
    resumeCallFn.addPermission('AdminApiInvokeResumeCall', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });

    // ========================================
    // 4. API Gateway Routes
    // ========================================
    
    // Routes are now handled by AdminStack to avoid circular dependencies.

    // ========================================
    // 5. Outputs
    // ========================================
    new CfnOutput(this, 'ClinicsTableName', {
      value: this.clinicsTable.tableName,
    });
    new CfnOutput(this, 'AgentPresenceTableName', {
      value: this.agentPresenceTable.tableName,
    });
    new CfnOutput(this, 'SipMediaApplicationIdMap', {
      value: smaIdMapJson,
    });
    
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
    


    // ========================================
    // 6. Heartbeat and Cleanup Monitor
    // ========================================

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
    
    this.agentPresenceTable.grantReadWriteData(heartbeatFn);
    
    heartbeatFn.addPermission('AdminApiInvokeHeartbeat', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
    });
    
    new CfnOutput(this, 'HeartbeatFnArn', {
      value: heartbeatFn.functionArn,
      exportName: `${this.stackName}-HeartbeatArn`,
    });
    
    const cleanupMonitorFn = new lambdaNode.NodejsFunction(this, 'CleanupMonitorFn', {
      functionName: `${this.stackName}-CleanupMonitor`,
      entry: path.join(__dirname, '..', '..', 'services', 'chime', 'cleanup-monitor.ts'),
      handler: 'handler',
      memorySize: 256,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: {
        AGENT_PRESENCE_TABLE_NAME: this.agentPresenceTable.tableName,
        CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
        CHIME_MEDIA_REGION: 'us-east-1',
      },
    });
    
    this.agentPresenceTable.grantReadWriteData(cleanupMonitorFn);
    this.callQueueTable.grantReadWriteData(cleanupMonitorFn);
    
    cleanupMonitorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['chime:DeleteMeeting', 'chime:ListMeetings'],
      resources: ['*'], 
    }));

    // Add Voice Connector outputs for reference
    new CfnOutput(this, 'VoiceConnectorId', {
      value: voiceConnectorId,
      description: 'Voice Connector ID - use this to associate phone numbers',
      exportName: `${this.stackName}-VoiceConnectorId`,
    });
    
    new CfnOutput(this, 'VoiceConnectorOutboundHostName', {
      value: voiceConnectorOutboundHost,
      description: 'Voice Connector Outbound Host - use this for SIP routing',
      exportName: `${this.stackName}-VoiceConnectorHost`,
    });
    
    const rule = new events.Rule(this, 'CleanupMonitorRule', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      description: 'Trigger cleanup monitor to handle orphaned resources and stale agent presence',
    });
    
    rule.addTarget(new targets.LambdaFunction(cleanupMonitorFn));
    
    new CfnOutput(this, 'CleanupMonitorFnArn', {
      value: cleanupMonitorFn.functionArn,
      exportName: `${this.stackName}-CleanupMonitorArn`,
    });
  }
}