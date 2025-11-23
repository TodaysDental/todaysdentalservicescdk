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
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface ChimeStackProps extends StackProps {
  userPool: any;
  userPoolId: string;
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
  /**
   * Optional Kinesis stream ARN for sending Chime call analytics events
   */
  analyticsStreamArn?: string;
  /**
   * Enable call recording (default: true)
   */
  enableCallRecording?: boolean;
  /**
   * Recording retention period in days (default: 2555 days / ~7 years)
   */
  recordingRetentionDays?: number;
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
  public readonly locksTable: dynamodb.Table;
  public readonly agentPerformanceTable: dynamodb.Table;

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
      timeToLiveAttribute: 'ttl',
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


    // Call Queue table - V2 with corrected GSI types
    this.callQueueTable = new dynamodb.Table(this, 'CallQueueTable', {
      tableName: `${this.stackName}-CallQueueV2`,
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

    // GSI for querying by phoneNumber + clinicId (for history / callbacks)
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-clinicId-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by phoneNumber + queueEntryTime (for call history by time)
    // Using NUMBER type for efficient timestamp queries
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'phoneNumber-queueEntryTime-index',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queueEntryTime', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by pstnCallId (for recording metadata lookups)
    this.callQueueTable.addGlobalSecondaryIndex({
      indexName: 'pstnCallId-index',
      partitionKey: { name: 'pstnCallId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Locks table for distributed locking on call assignments
    this.locksTable = new dynamodb.Table(this, 'LocksTable', {
      tableName: `${this.stackName}-Locks`,
      partitionKey: { name: 'lockKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Agent Performance table - tracks agent metrics and performance
    this.agentPerformanceTable = new dynamodb.Table(this, 'AgentPerformanceTable', {
      tableName: `${this.stackName}-AgentPerformance`,
      partitionKey: { name: 'agentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'periodDate', type: dynamodb.AttributeType.STRING }, // Format: YYYY-MM-DD for daily aggregates
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Keep performance data for historical records
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streaming for real-time analytics
    });

    // GSI for querying by clinic and date
    this.agentPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-periodDate-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'periodDate', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by performance score
    this.agentPerformanceTable.addGlobalSecondaryIndex({
      indexName: 'clinicId-performanceScore-index',
      partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'performanceScore', type: dynamodb.AttributeType.NUMBER },
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        HOLD_MUSIC_BUCKET: '', // Will be updated after bucket creation
        CHIME_MEDIA_REGION: 'us-east-1', // Supported Chime SDK media region
        ANALYTICS_STREAM_ARN: props.analyticsStreamArn || '', // Analytics stream for call data
      },
    });

    // Grant DynamoDB permissions
    this.clinicsTable.grantReadData(smaHandler);
    this.agentPresenceTable.grantReadWriteData(smaHandler);
    this.callQueueTable.grantReadWriteData(smaHandler);
    this.locksTable.grantReadWriteData(smaHandler);

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

    // Grant Kinesis permissions for analytics (if stream is provided)
    if (props.analyticsStreamArn) {
      smaHandler.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kinesis:PutRecord',
          'kinesis:PutRecords',
        ],
        resources: [props.analyticsStreamArn],
      }));
    }

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

    // Allow the Amazon Chime Voice Connector service to stream audio prompts
    // directly from the bucket when executing PlayAudio actions.
    holdMusicBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowChimeVoiceConnectorAccess',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [holdMusicBucket.arnForObjects('*')],
    }));

    // Update the environment variable
    smaHandler.addEnvironment('HOLD_MUSIC_BUCKET', holdMusicBucket.bucketName);

    // Upload audio files from local assets directory
    new s3deploy.BucketDeployment(this, 'DeployHoldMusic', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'assets', 'audio'))
      ],
      destinationBucket: holdMusicBucket,
      prune: false,
      // CRITICAL: Set correct content type for Chime SMA compatibility
      // Chime SMA requires 'audio/wav' not 'audio/x-wav'
      contentType: 'audio/wav',
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
        const [network, prefix] = cidr.split('/');
        const prefixNumber = Number(prefix);

        // Require valid IPv4 CIDR format and mask of /27 or smaller (e.g., /27, /26, /25...)
        return (
          !network ||
          Number.isNaN(prefixNumber) ||
          prefixNumber < 1 ||
          prefixNumber > 27
        );
      });

      if (invalidCidrs.length > 0) {
        throw new Error(
          `voiceConnectorTerminationCidrs must contain CIDR blocks with a /27 or smaller prefix. Invalid entries: ${invalidCidrs.join(
            ', '
          )}`
        );
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
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        VOICE_CONNECTOR_ID: voiceConnectorId,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    outboundCallFn.addToRolePolicy(chimeSdkPolicy);
    outboundCallFn.addToRolePolicy(cognitoPolicy);
    this.agentPresenceTable.grantReadWriteData(outboundCallFn);
    this.clinicsTable.grantReadData(outboundCallFn);
    this.callQueueTable.grantReadWriteData(outboundCallFn);
    this.locksTable.grantReadWriteData(outboundCallFn);
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(transferCallFn);
    this.callQueueTable.grantReadWriteData(transferCallFn);
    this.locksTable.grantReadWriteData(transferCallFn);
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(callAcceptedFn);
    this.callQueueTable.grantReadWriteData(callAcceptedFn);
    this.locksTable.grantReadWriteData(callAcceptedFn);
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(callRejectedFn);
    this.callQueueTable.grantReadWriteData(callRejectedFn);
    this.locksTable.grantReadWriteData(callRejectedFn);
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
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(holdCallFn);
    this.callQueueTable.grantReadWriteData(holdCallFn);
    this.locksTable.grantReadWriteData(holdCallFn);
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
        LOCKS_TABLE_NAME: this.locksTable.tableName,
        SMA_ID_MAP: smaIdMapJson,
        CHIME_MEDIA_REGION: 'us-east-1',
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
      },
    });
    this.agentPresenceTable.grantReadWriteData(resumeCallFn);
    this.callQueueTable.grantReadWriteData(resumeCallFn);
    this.locksTable.grantReadWriteData(resumeCallFn);
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
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
        SMA_ID_MAP: smaIdMapJson,
        AWS_XRAY_TRACING_ENABLED: 'true',
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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

    // ========================================
    // 7. CALL RECORDING INFRASTRUCTURE
    // ========================================

    let recordingsBucket: s3.Bucket | undefined;
    let recordingsKey: kms.Key | undefined;
    let getRecordingFn: lambdaNode.NodejsFunction | undefined;

    if (props.enableCallRecording !== false) { // Default to enabled
      console.log('[ChimeStack] Setting up call recording infrastructure');

      // 1. KMS Key for encryption at rest (HIPAA compliance)
      recordingsKey = new kms.Key(this, 'RecordingsEncryptionKey', {
        description: 'Encryption key for call recordings',
        enableKeyRotation: true,
        removalPolicy: RemovalPolicy.RETAIN, // Keep keys even if stack is deleted
      });

      // Allow Chime to use the key
      recordingsKey.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowChimeToUseKey',
        principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey'
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account
          }
        }
      }));

      // FIXED: Allow Transcribe to decrypt recordings AND encrypt transcription output
      recordingsKey.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowTranscribeToUseKey',
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: [
          'kms:Decrypt',           // Read encrypted audio files
          'kms:GenerateDataKey',   // Encrypt transcription output  
          'kms:DescribeKey',       // Get key metadata
          'kms:CreateGrant'        // Allow Transcribe to create grants for encryption
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': [
              `s3.${this.region}.amazonaws.com`,
              `transcribe.${this.region}.amazonaws.com`
            ],
            'kms:CallerAccount': this.account
          }
        }
      }));

      // 2. S3 Bucket for storing recordings
      const retentionDays = props.recordingRetentionDays || 2555; // ~7 years (common compliance requirement)
      
      recordingsBucket = new s3.Bucket(this, 'CallRecordingsBucket', {
        bucketName: `${this.stackName.toLowerCase()}-recordings-${this.account}-${this.region}`,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: recordingsKey,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        versioned: true, // Protect against accidental deletion
        lifecycleRules: [
          {
            id: 'DeleteOldRecordings',
            enabled: true,
            expiration: Duration.days(retentionDays),
            noncurrentVersionExpiration: Duration.days(7), // Clean up old versions
          },
          {
            id: 'TransitionToGlacier',
            enabled: true,
            transitions: [
              {
                storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                transitionAfter: Duration.days(90),
              }
            ]
          }
        ],
        serverAccessLogsPrefix: 'access-logs/',
        objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
        removalPolicy: RemovalPolicy.RETAIN, // Never delete recordings accidentally
        autoDeleteObjects: false, // Extra safety - don't auto-delete
      });

      // Bucket policy to allow Chime to write recordings
      // Includes security conditions to prevent confused deputy problem
      recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowChimeVoiceConnectorToWriteRecordings',
        principals: [new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com')],
        actions: [
          's3:PutObject',
          's3:PutObjectAcl'
        ],
        resources: [recordingsBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:chime:*:${this.account}:sma/*`
          }
        }
      }));

      // FIXED: Allow AWS Transcribe to access bucket for transcription
      // Transcribe needs these permissions to read input files and write transcription results
      recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowTranscribeToAccessBucket',
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: [
          's3:GetBucketLocation',
          's3:ListBucket'
        ],
        resources: [recordingsBucket.bucketArn],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account
          }
        }
      }));

      recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowTranscribeToReadInputFiles',
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: [
          's3:GetObject'
        ],
        resources: [recordingsBucket.arnForObjects('recordings/*')],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account
          }
        }
      }));

      recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowTranscribeToWriteTranscriptions',
        principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
        actions: [
          's3:PutObject'
        ],
        resources: [recordingsBucket.arnForObjects('transcriptions/*')],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account
          }
        }
      }));

      // 3. DynamoDB table for recording metadata
      const recordingMetadataTable = new dynamodb.Table(this, 'RecordingMetadataTable', {
        tableName: `${this.stackName}-RecordingMetadata`,
        partitionKey: { name: 'recordingId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN, // Keep metadata
        pointInTimeRecovery: true,
        timeToLiveAttribute: 'ttl', // Auto-cleanup old metadata
      });

      // GSI: Query by callId
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'callId-index',
        partitionKey: { name: 'callId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // GSI: Query by clinic and date
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'clinicId-timestamp-index',
        partitionKey: { name: 'clinicId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // GSI: Query by transcription job name (for processing transcription completion)
      recordingMetadataTable.addGlobalSecondaryIndex({
        indexName: 'transcriptionJobName-index',
        partitionKey: { name: 'transcriptionJobName', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      // 4. Lambda to process new recordings
      const recordingProcessorFn = new lambdaNode.NodejsFunction(this, 'RecordingProcessorFn', {
        functionName: `${this.stackName}-RecordingProcessor`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-recording.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.minutes(5), // Allow time for transcription
        memorySize: 1024,
        environment: {
          RECORDING_METADATA_TABLE_NAME: recordingMetadataTable.tableName, // FIXED: Added _NAME suffix
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          RECORDINGS_BUCKET_NAME: recordingsBucket.bucketName, // FIXED: Added missing bucket name
          AUTO_TRANSCRIBE_RECORDINGS: 'true', // FIXED: Renamed from ENABLE_TRANSCRIPTION
          ENABLE_SENTIMENT_ANALYSIS: 'true',
        },
        logRetention: logs.RetentionDays.ONE_MONTH,
      });

      // Grant permissions
      // Grant read/write access - Lambda needs to read recordings and write transcription metadata
      recordingsBucket.grantReadWrite(recordingProcessorFn);
      recordingMetadataTable.grantWriteData(recordingProcessorFn);
      this.callQueueTable.grantReadWriteData(recordingProcessorFn);
      this.agentPerformanceTable.grantReadWriteData(recordingProcessorFn);
      // Grant encrypt/decrypt for KMS - needed for both reading recordings and writing transcriptions
      recordingsKey.grantEncryptDecrypt(recordingProcessorFn);

      // Grant Transcribe permissions
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'transcribe:TagResource' // FIXED: Required for tagging transcription jobs
        ],
        resources: ['*']
      }));

      // CRITICAL: Explicit S3 permissions for Transcribe output
      // Ensures Lambda can specify the S3 output location for Transcribe
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
          's3:GetObject',
          's3:GetBucketLocation',
          's3:ListBucket'
        ],
        resources: [
          recordingsBucket.bucketArn,
          recordingsBucket.arnForObjects('*')
        ]
      }));

      // Grant Comprehend permissions
      recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'comprehend:DetectSentiment',
          'comprehend:BatchDetectSentiment'
        ],
        resources: ['*']
      }));

      // Trigger Lambda on new recordings
      recordingsBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.LambdaDestination(recordingProcessorFn),
        { prefix: 'recordings/', suffix: '.wav' }
      );

      // 5. Update SMA Handler environment variables
      smaHandler.addEnvironment('RECORDINGS_BUCKET', recordingsBucket.bucketName);
      smaHandler.addEnvironment('ENABLE_CALL_RECORDING', 'true');
      recordingsBucket.grantWrite(smaHandler);
      recordingsKey.grantEncrypt(smaHandler);

      // 6. API Lambda for retrieving recordings
      getRecordingFn = new lambdaNode.NodejsFunction(this, 'GetRecordingFn', {
        functionName: `${this.stackName}-GetRecording`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-recording.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          RECORDINGS_BUCKET: recordingsBucket.bucketName,
          RECORDING_METADATA_TABLE: recordingMetadataTable.tableName,
          USER_POOL_ID: props.userPoolId,
          COGNITO_REGION: this.region,
        },
      });

      recordingsBucket.grantRead(getRecordingFn);
      recordingMetadataTable.grantReadData(getRecordingFn);
      recordingsKey.grantDecrypt(getRecordingFn);

      // 7. Lambda for getting agent performance reports
      const getAgentPerformanceFn = new lambdaNode.NodejsFunction(this, 'GetAgentPerformanceFn', {
        functionName: `${this.stackName}-GetAgentPerformance`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-agent-performance.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment: {
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          USER_POOL_ID: props.userPoolId,
          COGNITO_REGION: this.region,
        },
      });

      this.agentPerformanceTable.grantReadData(getAgentPerformanceFn);
      this.callQueueTable.grantReadData(getAgentPerformanceFn);

      getAgentPerformanceFn.addPermission('AdminApiInvokeGetAgentPerformance', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*`
      });

      // 8. Lambda for processing transcription completion and sentiment analysis
      const transcriptionCompleteFn = new lambdaNode.NodejsFunction(this, 'TranscriptionCompleteFn', {
        functionName: `${this.stackName}-TranscriptionComplete`,
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'process-transcription.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.minutes(2),
        memorySize: 1024,
        environment: {
          RECORDING_METADATA_TABLE_NAME: recordingMetadataTable.tableName,
          CALL_QUEUE_TABLE_NAME: this.callQueueTable.tableName,
          AGENT_PERFORMANCE_TABLE_NAME: this.agentPerformanceTable.tableName,
          RECORDINGS_BUCKET_NAME: recordingsBucket.bucketName,
        },
      });

      recordingsBucket.grantRead(transcriptionCompleteFn);
      recordingMetadataTable.grantReadWriteData(transcriptionCompleteFn);
      this.callQueueTable.grantReadWriteData(transcriptionCompleteFn);
      this.agentPerformanceTable.grantReadWriteData(transcriptionCompleteFn);
      recordingsKey.grantDecrypt(transcriptionCompleteFn);

      // Grant Comprehend permissions for sentiment analysis
      transcriptionCompleteFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'comprehend:DetectSentiment',
          'comprehend:BatchDetectSentiment'
        ],
        resources: ['*']
      }));

      // Trigger on transcription completion via EventBridge
      const transcriptionRule = new events.Rule(this, 'TranscriptionCompleteRule', {
        eventPattern: {
          source: ['aws.transcribe'],
          detailType: ['Transcribe Job State Change'],
          detail: {
            TranscriptionJobStatus: ['COMPLETED', 'FAILED']
          }
        },
      });

      transcriptionRule.addTarget(new targets.LambdaFunction(transcriptionCompleteFn));

      // Outputs
      new CfnOutput(this, 'RecordingsBucketName', {
        value: recordingsBucket.bucketName,
        description: 'S3 bucket for call recordings',
        exportName: `${this.stackName}-RecordingsBucket`,
      });

      new CfnOutput(this, 'RecordingMetadataTableName', {
        value: recordingMetadataTable.tableName,
        description: 'DynamoDB table for recording metadata',
        exportName: `${this.stackName}-RecordingMetadataTable`,
      });

      new CfnOutput(this, 'GetRecordingFnArn', {
        value: getRecordingFn.functionArn,
        exportName: `${this.stackName}-GetRecordingFnArn`,
      });

      new CfnOutput(this, 'GetAgentPerformanceFnArn', {
        value: getAgentPerformanceFn.functionArn,
        exportName: `${this.stackName}-GetAgentPerformanceFnArn`,
      });

      new CfnOutput(this, 'TranscriptionCompleteFnArn', {
        value: transcriptionCompleteFn.functionArn,
        exportName: `${this.stackName}-TranscriptionCompleteFnArn`,
      });

      new CfnOutput(this, 'AgentPerformanceTableName', {
        value: this.agentPerformanceTable.tableName,
        description: 'DynamoDB table for agent performance metrics',
        exportName: `${this.stackName}-AgentPerformanceTable`,
      });
    }

    // ========================================
    // 13. CloudWatch Alarms for Monitoring
    // ========================================

    // Helper function to create Lambda error alarms
    const createLambdaErrorAlarm = (fn: lambda.IFunction, fnNameDisplay: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${fnNameDisplay} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create Lambda throttle alarms
    const createLambdaThrottleAlarm = (fn: lambda.IFunction, fnNameDisplay: string) => {
      new cloudwatch.Alarm(this, `${fn.node.id}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${fnNameDisplay} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create Lambda duration alarms (p99)
    const createLambdaDurationAlarm = (fn: lambda.IFunction, fnNameDisplay: string, thresholdMs: number) => {
      new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: Duration.minutes(5),
        }),
        threshold: thresholdMs,
        evaluationPeriods: 2,
        alarmDescription: `Alert when ${fnNameDisplay} Lambda duration exceeds ${thresholdMs}ms (p99)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Helper function to create DynamoDB throttle alarms
    const createDynamoDBThrottleAlarm = (table: dynamodb.Table, tableName: string, operation: string) => {
      new cloudwatch.Alarm(this, `${table.node.id}${operation}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'UserErrors',
          dimensionsMap: { TableName: table.tableName, Operation: operation },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when ${tableName} ${operation} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // Create alarms for all Lambda functions
    createLambdaErrorAlarm(startSessionFn, 'StartSession');
    createLambdaThrottleAlarm(startSessionFn, 'StartSession');
    createLambdaDurationAlarm(startSessionFn, 'StartSession', 8000); // 10s timeout, 80% = 8s

    createLambdaErrorAlarm(stopSessionFn, 'StopSession');
    createLambdaThrottleAlarm(stopSessionFn, 'StopSession');
    createLambdaDurationAlarm(stopSessionFn, 'StopSession', 8000);

    createLambdaErrorAlarm(outboundCallFn, 'OutboundCall');
    createLambdaThrottleAlarm(outboundCallFn, 'OutboundCall');
    createLambdaDurationAlarm(outboundCallFn, 'OutboundCall', 9000); // Complex operation

    createLambdaErrorAlarm(transferCallFn, 'TransferCall');
    createLambdaThrottleAlarm(transferCallFn, 'TransferCall');
    createLambdaDurationAlarm(transferCallFn, 'TransferCall', 9000);

    createLambdaErrorAlarm(callAcceptedFn, 'CallAccepted');
    createLambdaThrottleAlarm(callAcceptedFn, 'CallAccepted');
    createLambdaDurationAlarm(callAcceptedFn, 'CallAccepted', 8000);

    createLambdaErrorAlarm(callRejectedFn, 'CallRejected');
    createLambdaThrottleAlarm(callRejectedFn, 'CallRejected');
    createLambdaDurationAlarm(callRejectedFn, 'CallRejected', 8000);

    createLambdaErrorAlarm(callHungupFn, 'CallHungup');
    createLambdaThrottleAlarm(callHungupFn, 'CallHungup');
    createLambdaDurationAlarm(callHungupFn, 'CallHungup', 8000);

    createLambdaErrorAlarm(leaveCallFn, 'LeaveCall');
    createLambdaThrottleAlarm(leaveCallFn, 'LeaveCall');
    createLambdaDurationAlarm(leaveCallFn, 'LeaveCall', 8000);

    createLambdaErrorAlarm(holdCallFn, 'HoldCall');
    createLambdaThrottleAlarm(holdCallFn, 'HoldCall');
    createLambdaDurationAlarm(holdCallFn, 'HoldCall', 8000);

    createLambdaErrorAlarm(resumeCallFn, 'ResumeCall');
    createLambdaThrottleAlarm(resumeCallFn, 'ResumeCall');
    createLambdaDurationAlarm(resumeCallFn, 'ResumeCall', 8000);

    createLambdaErrorAlarm(heartbeatFn, 'Heartbeat');
    createLambdaThrottleAlarm(heartbeatFn, 'Heartbeat');
    createLambdaDurationAlarm(heartbeatFn, 'Heartbeat', 8000);

    createLambdaErrorAlarm(cleanupMonitorFn, 'CleanupMonitor');
    createLambdaThrottleAlarm(cleanupMonitorFn, 'CleanupMonitor');
    createLambdaDurationAlarm(cleanupMonitorFn, 'CleanupMonitor', 25000); // 30s timeout, 25s threshold

    // Create alarms for DynamoDB tables - monitor for throttling
    createDynamoDBThrottleAlarm(this.clinicsTable, 'ClinicsTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.clinicsTable, 'ClinicsTable', 'Query');

    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'Query');
    createDynamoDBThrottleAlarm(this.agentPresenceTable, 'AgentPresenceTable', 'UpdateItem');

    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'Query');
    createDynamoDBThrottleAlarm(this.callQueueTable, 'CallQueueTable', 'UpdateItem');

    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'GetItem');
    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'PutItem');
    createDynamoDBThrottleAlarm(this.locksTable, 'LocksTable', 'UpdateItem');

    // Create composite alarm for critical operations
    const criticalFunctionErrorMetrics = [
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: outboundCallFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: transferCallFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: callAcceptedFn.functionName },
        statistic: 'Sum',
        period: Duration.minutes(1),
      }),
    ];

    new cloudwatch.Alarm(this, 'CriticalCallOperationsErrorAlarm', {
      metric: new cloudwatch.MathExpression({
        expression: 'm1 + m2 + m3',
        usingMetrics: {
          m1: criticalFunctionErrorMetrics[0],
          m2: criticalFunctionErrorMetrics[1],
          m3: criticalFunctionErrorMetrics[2],
        },
      }),
      threshold: 2,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when critical call operations (OutboundCall, TransferCall, CallAccepted) have combined errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
