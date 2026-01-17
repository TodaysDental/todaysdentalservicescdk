/**
 * Amazon Connect + Lex AI Stack
 * 
 * Configures an existing Amazon Connect instance with:
 * - Lex V2 bot for voice AI conversations
 * - Lambda code hook that calls Bedrock Agent
 * - Analytics integration with AnalyticsStack (CallAnalyticsN1 + TranscriptBuffersV2)
 * - Disconnect flow for call finalization
 * 
 * This provides a fully serverless AI phone number path as an alternative to
 * Chime Voice Connector (which requires an SBC for direct inbound calls).
 */

import { Duration, Stack, StackProps, CfnOutput, Tags, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as customResources from 'aws-cdk-lib/custom-resources';

// ========================================================================
// PROPS
// ========================================================================

export interface ConnectLexAiStackProps extends StackProps {
  /**
   * Existing Amazon Connect instance ID.
   * Example: 0626aa86-d377-44c8-9311-84e4f230cc72
   */
  connectInstanceId: string;

  /**
   * Existing Amazon Connect instance ARN.
   * Example: arn:aws:connect:us-east-1:851620242036:instance/0626aa86-d377-44c8-9311-84e4f230cc72
   */
  connectInstanceArn: string;

  /**
   * Connect phone number to attach to the AI contact flow (E.164 format).
   * Example: +14439272295
   */
  connectAiPhoneNumber: string;

  /**
   * AI Agents table name for looking up Bedrock agent config.
   */
  agentsTableName: string;
  agentsTableArn: string;

  /**
   * Sessions table name for session management.
   */
  sessionsTableName: string;
  sessionsTableArn: string;

  /**
   * Shared CallAnalytics table from AnalyticsStack.
   */
  callAnalyticsTableName: string;
  callAnalyticsTableArn: string;

  /**
   * Transcript buffer table from AnalyticsStack.
   */
  transcriptBufferTableName: string;
  transcriptBufferTableArn: string;

  /**
   * AI phone numbers JSON mapping (aiPhoneNumber -> clinicId).
   */
  aiPhoneNumbersJson?: string;

  /**
   * Default clinic ID for unmapped phone numbers.
   */
  defaultClinicId?: string;

  /**
   * Hold music bucket name from ChimeStack (optional).
   * Used for playing thinking audio (keyboard sounds) during AI processing.
   */
  holdMusicBucketName?: string;

  /**
   * Hold music bucket ARN for IAM permissions (optional).
   * Must be provided with holdMusicBucketName for thinking audio to work.
   */
  holdMusicBucketArn?: string;

  /**
   * CloudFront URL for thinking audio file (optional).
   * Must be an HTTPS URL pointing to an MP3 file (not WAV).
   * Example: https://d1234567890.cloudfront.net/keyboard-typing.mp3
   * 
   * If not provided, a subtle verbal cue is used instead.
   */
  thinkingAudioUrl?: string;

  /**
   * Thinking audio mode:
   * - 'verbal': spoken filler only (recommended / reliable)
   * - 'audio': reserved (Amazon Polly SSML does not support <audio>; keep 'verbal' unless you have a non-Polly playback path)
   *
   * Defaults to 'verbal'.
   */
  thinkingAudioMode?: 'audio' | 'verbal';

  /**
   * For voice calls, if Lex returns a transcription confidence lower than this threshold,
   * the bot will ask the caller to repeat instead of sending the text to Bedrock.
   *
   * Range: 0.0 - 1.0. Default: 0.6
   */
  transcriptionConfidenceThreshold?: number;
}

// ========================================================================
// STACK
// ========================================================================

export class ConnectLexAiStack extends Stack {
  public readonly lexBedrockHookFn: lambda.IFunction;
  // Lex ASR-only capture hook (stores transcript into Lex session attrs for Connect to read)
  public readonly lexTranscriptCaptureFn: lambda.IFunction;
  public readonly connectFinalizerFn: lambda.IFunction;
  public readonly lexBotId: string;
  public readonly lexBotAliasId: string;
  public inboundFlowArn: string = '';
  public disconnectFlowArn: string = '';

  constructor(scope: Construct, id: string, props: ConnectLexAiStackProps) {
    super(scope, id, props);

    // ========================================
    // Stack-wide tagging
    // ========================================
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'ConnectLexAI',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([k, v]) => Tags.of(resource).add(k, v));
      if (extra) Object.entries(extra).forEach(([k, v]) => Tags.of(resource).add(k, v));
    };
    applyTags(this);

    // ========================================
    // 1. Lex Bedrock Hook Lambda
    // ========================================
    this.lexBedrockHookFn = new lambdaNode.NodejsFunction(this, 'LexBedrockHookFn', {
      functionName: `${this.stackName}-LexBedrockHook`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'lex-bedrock-hook.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        AGENTS_TABLE: props.agentsTableName,
        SESSIONS_TABLE: props.sessionsTableName,
        CALL_ANALYTICS_TABLE: props.callAnalyticsTableName,
        TRANSCRIPT_BUFFER_TABLE_NAME: props.transcriptBufferTableName,
        AI_PHONE_NUMBERS_JSON: props.aiPhoneNumbersJson || '{}',
        DEFAULT_CLINIC_ID: props.defaultClinicId || 'dentistingreenville',
        // Thinking audio configuration - plays keyboard sounds during AI processing
        HOLD_MUSIC_BUCKET: props.holdMusicBucketName || '',
        ENABLE_THINKING_AUDIO: 'true',
        // CloudFront URL for MP3 thinking audio (optional - if not set, uses verbal cue)
        THINKING_AUDIO_URL: props.thinkingAudioUrl || '',
        // Thinking audio mode: 'audio' = MP3 file, 'verbal' = spoken acknowledgment
        // NOTE: Amazon Polly SSML does NOT support <audio>, so 'verbal' is the safe default.
        THINKING_AUDIO_MODE: props.thinkingAudioMode || 'verbal',
        // If Lex ASR is low-confidence, ask the caller to repeat rather than risking an incorrect AI answer
        TRANSCRIPTION_CONFIDENCE_THRESHOLD: String(props.transcriptionConfidenceThreshold ?? 0.6),
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.lexBedrockHookFn, { Function: 'lex-bedrock-hook' });

    // Grant DynamoDB permissions
    this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [
        props.agentsTableArn,
        `${props.agentsTableArn}/index/*`,
      ],
    }));

    this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [props.sessionsTableArn],
    }));

    this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [
        props.callAnalyticsTableArn,
        `${props.callAnalyticsTableArn}/index/*`,
      ],
    }));

    this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [props.transcriptBufferTableArn],
    }));

    // Grant Bedrock Agent invocation permissions
    this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:InvokeModel',
      ],
      resources: ['*'], // Bedrock agents require wildcard
    }));

    // Grant S3 read access to hold music bucket for thinking audio
    // The keyboard typing sounds are played via SSML during AI processing
    if (props.holdMusicBucketArn) {
      this.lexBedrockHookFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [`${props.holdMusicBucketArn}/*`],
      }));
      console.log(`[ConnectLexAiStack] LexBedrockHookFn granted S3 read access for thinking audio`);
    }

    // Lex ASR-only transcript capture hook (fast; no Bedrock)
    this.lexTranscriptCaptureFn = new lambdaNode.NodejsFunction(this, 'LexTranscriptCaptureFn', {
      functionName: `${this.stackName}-LexTranscriptCapture`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'lex-transcript-capture-hook.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.lexTranscriptCaptureFn, { Function: 'lex-transcript-capture' });

    // ========================================
    // 2. Connect Call Finalizer Lambda
    // ========================================
    this.connectFinalizerFn = new lambdaNode.NodejsFunction(this, 'ConnectFinalizerFn', {
      functionName: `${this.stackName}-ConnectFinalizer`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connect-call-finalizer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        SESSIONS_TABLE: props.sessionsTableName,
        CALL_ANALYTICS_TABLE: props.callAnalyticsTableName,
        TRANSCRIPT_BUFFER_TABLE_NAME: props.transcriptBufferTableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(this.connectFinalizerFn, { Function: 'connect-finalizer' });

    // ========================================
    // 2b. Connect Direct AI Lambda (Bedrock Runtime)
    // ========================================
    // Invoked directly by the Connect contact flow (InvokeLambdaFunction) after Lex ASR,
    // while Connect handles the typing WAV prompt + response playback.
    const connectDirectLambda = new lambdaNode.NodejsFunction(this, 'ConnectDirectLambda', {
      functionName: `${this.stackName}-ConnectDirectLambda`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'connect-direct-lambda-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        SYSTEM_PROMPT: 'You are a helpful AI assistant on a phone call. Keep responses concise and natural for voice conversation.',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(connectDirectLambda, { Function: 'connect-direct-lambda' });

    // Grant Bedrock model invocation permissions
    connectDirectLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/*'],
    }));

    // Grant DynamoDB permissions
    this.connectFinalizerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [props.sessionsTableArn],
    }));

    this.connectFinalizerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
      resources: [
        props.callAnalyticsTableArn,
        `${props.callAnalyticsTableArn}/index/*`,
      ],
    }));

    this.connectFinalizerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:UpdateItem'],
      resources: [props.transcriptBufferTableArn],
    }));

    // Grant Connect permission to invoke finalizer Lambda
    const connectFinalizerPermission = this.connectFinalizerFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });

    // Grant Connect permission to invoke Lex hook Lambda (for contact flows)
    const lexHookConnectPermission = this.lexBedrockHookFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });

    // Grant Connect permission to invoke the direct AI Lambda
    connectDirectLambda.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });

    // ========================================
    // 3. Lex V2 Bot
    // ========================================
    const lexBotRole = new iam.Role(this, 'LexBotRole', {
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonLexFullAccess'),
      ],
    });

    // NOTE: Lex fulfillment updates are now VERBAL-ONLY (plain text).
    // The real keyboard typing WAV sound is played by the Connect contact flow
    // (via the typingOnce MessageParticipant block) AFTER Lex completes and BEFORE
    // the Connect InvokeLambdaFunction block. This provides a consistent single mechanism
    // for thinking audio instead of trying to do it in both Lex and Connect.

    // Create the Lex V2 bot
    // NOTE: Using 'DentalAiBotV3' to force CloudFormation to create a new bot
    // because intent updates don't propagate correctly on existing bots.
    const lexBot = new lex.CfnBot(this, 'DentalAiBotV3', {
      name: `${this.stackName}-DentalAIv3`,
      description: 'AI voice assistant for dental clinic after-hours calls',
      roleArn: lexBotRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      botLocales: [
        {
          localeId: 'en_US',
          nluConfidenceThreshold: 0.4,
          voiceSettings: {
            voiceId: 'Joanna',
            engine: 'neural',
          },
          intents: [
            // IMPORTANT:
            // Lex V2 requires at least one *custom* intent with a sample utterance.
            // If we only define AMAZON.FallbackIntent, the locale build fails and
            // Amazon Connect rejects contact flows referencing the bot.
            {
              name: 'GeneralIntent',
              description: 'General intent that routes all caller input to Bedrock',
              sampleUtterances: [
                { utterance: 'hello' },
                { utterance: 'hi' },
                { utterance: 'i need help' },
                { utterance: 'appointment' },
                { utterance: 'schedule an appointment' },
                { utterance: 'i have a question' },
              ],
              fulfillmentCodeHook: {
                enabled: true,
                // Keep conversation going after Lambda fulfillment
                postFulfillmentStatusSpecification: {
                  successNextStep: { dialogAction: { type: 'ElicitIntent' } },
                  failureNextStep: { dialogAction: { type: 'ElicitIntent' } },
                  timeoutNextStep: { dialogAction: { type: 'ElicitIntent' } },
                },
              },
              // Also ensure closing setting keeps session alive
              intentClosingSetting: {
                isActive: false, // Don't auto-close
              },
            },
            {
              name: 'FallbackIntent',
              description: 'Catch-all intent that routes to Bedrock',
              parentIntentSignature: 'AMAZON.FallbackIntent',
              fulfillmentCodeHook: {
                enabled: true,
                // Keep conversation going after Lambda fulfillment
                postFulfillmentStatusSpecification: {
                  successNextStep: { dialogAction: { type: 'ElicitIntent' } },
                  failureNextStep: { dialogAction: { type: 'ElicitIntent' } },
                  timeoutNextStep: { dialogAction: { type: 'ElicitIntent' } },
                },
              },
              intentClosingSetting: {
                isActive: false, // Don't auto-close
              },
            },
          ],
        },
      ],
      autoBuildBotLocales: true,
    });

    this.lexBotId = lexBot.attrId;

    // Grant Lex permission to invoke the hook Lambda
    this.lexBedrockHookFn.addPermission('LexInvoke', {
      principal: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      sourceArn: `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/*`,
    });

    // Grant Lex permission to invoke the transcript capture Lambda
    this.lexTranscriptCaptureFn.addPermission('LexInvoke', {
      principal: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      sourceArn: `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/*`,
    });

    // Create bot version (required for alias)
    const botVersion = new lex.CfnBotVersion(this, 'DentalAiBotVersion', {
      botId: lexBot.attrId,
      botVersionLocaleSpecification: [
        {
          localeId: 'en_US',
          botVersionLocaleDetails: {
            sourceBotVersion: 'DRAFT',
          },
        },
      ],
    });
    botVersion.addDependency(lexBot);

    // Create bot alias with Lambda code hook
    const botAlias = new lex.CfnBotAlias(this, 'DentalAiBotAlias', {
      botId: lexBot.attrId,
      botAliasName: 'prod',
      botVersion: botVersion.attrBotVersion,
      botAliasLocaleSettings: [
        {
          localeId: 'en_US',
          botAliasLocaleSetting: {
            enabled: true,
            codeHookSpecification: {
              lambdaCodeHook: {
                lambdaArn: this.lexTranscriptCaptureFn.functionArn,
                codeHookInterfaceVersion: '1.0',
              },
            },
          },
        },
      ],
    });
    botAlias.addDependency(botVersion);

    this.lexBotAliasId = botAlias.attrBotAliasId;

    // ========================================
    // 4. Connect Integration Association (Lex V2 bot)
    // ========================================
    // Associate the Lex V2 bot with the Connect instance
    // IMPORTANT: Using 'associateBot' for Lex V2 (not 'associateLexBot' which is for Lex V1)
    // Include bot ID in physical resource ID so updates trigger re-association
    const botAliasArnForConnect = `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/${botAlias.attrBotAliasId}`;
    
    const lexIntegration = new customResources.AwsCustomResource(this, 'ConnectLexIntegration', {
      onCreate: {
        service: 'Connect',
        action: 'associateBot',
        parameters: {
          InstanceId: props.connectInstanceId,
          LexV2Bot: {
            AliasArn: botAliasArnForConnect,
          },
        },
        // Use bot alias ARN in physical ID so bot changes trigger replacement
        physicalResourceId: customResources.PhysicalResourceId.of(`lex-integration-${lexBot.attrId}`),
      },
      onUpdate: {
        service: 'Connect',
        action: 'associateBot',
        parameters: {
          InstanceId: props.connectInstanceId,
          LexV2Bot: {
            AliasArn: botAliasArnForConnect,
          },
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`lex-integration-${lexBot.attrId}`),
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'connect:AssociateBot',
            'connect:DisassociateBot',
            'connect:ListBots',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lex:DescribeBot',
            'lex:DescribeBotAlias',
            'lex:CreateResourcePolicy',
            'lex:DeleteResourcePolicy',
            'lex:UpdateResourcePolicy',
            'lex:DescribeResourcePolicy',
          ],
          resources: [
            `arn:aws:lex:${this.region}:${this.account}:bot/${lexBot.attrId}`,
            `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/*`,
          ],
        }),
      ]),
    });
    lexIntegration.node.addDependency(botAlias);

    // ========================================
    // 5. Lambda Function Integrations for Connect
    // ========================================
    // Policy for Lambda integration custom resources
    const lambdaIntegrationPolicy = customResources.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'connect:AssociateLambdaFunction',
          'connect:DisassociateLambdaFunction',
          'connect:ListLambdaFunctions',
        ],
        resources: ['*'],
      }),
      // Connect's associateLambdaFunction internally verifies it can invoke the Lambda
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:GetFunction',
          'lambda:GetPolicy',
          'lambda:AddPermission',
          'lambda:RemovePermission',
        ],
        resources: [
          this.connectFinalizerFn.functionArn,
          this.lexBedrockHookFn.functionArn,
          connectDirectLambda.functionArn,
        ],
      }),
    ]);

    // Associate finalizer Lambda with Connect
    const finalizerIntegration = new customResources.AwsCustomResource(this, 'ConnectFinalizerIntegration', {
      onCreate: {
        service: 'Connect',
        action: 'associateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: this.connectFinalizerFn.functionArn,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-finalizer-integration`),
      },
      onDelete: {
        service: 'Connect',
        action: 'disassociateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: this.connectFinalizerFn.functionArn,
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
      },
      policy: lambdaIntegrationPolicy,
    });

    // CRITICAL: Ensure the Lambda permission is created before trying to associate
    finalizerIntegration.node.addDependency(this.connectFinalizerFn);

    // Associate Lex hook Lambda with Connect (for direct invocation from contact flows)
    const lexHookIntegration = new customResources.AwsCustomResource(this, 'ConnectLexHookIntegration', {
      onCreate: {
        service: 'Connect',
        action: 'associateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: this.lexBedrockHookFn.functionArn,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-lexhook-integration`),
      },
      onDelete: {
        service: 'Connect',
        action: 'disassociateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: this.lexBedrockHookFn.functionArn,
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
      },
      policy: lambdaIntegrationPolicy,
    });

    // CRITICAL: Ensure the Lambda permission is created before trying to associate
    lexHookIntegration.node.addDependency(this.lexBedrockHookFn);
    // Avoid parallel API calls to Connect
    lexHookIntegration.node.addDependency(finalizerIntegration);

    // Associate Connect direct AI Lambda with Connect (for InvokeLambdaFunction blocks)
    const connectDirectIntegration = new customResources.AwsCustomResource(this, 'ConnectDirectIntegration', {
      onCreate: {
        service: 'Connect',
        action: 'associateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: connectDirectLambda.functionArn,
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-connectdirect-integration`),
      },
      onDelete: {
        service: 'Connect',
        action: 'disassociateLambdaFunction',
        parameters: {
          InstanceId: props.connectInstanceId,
          FunctionArn: connectDirectLambda.functionArn,
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
      },
      policy: lambdaIntegrationPolicy,
    });

    // CRITICAL: Ensure the Lambda permission is created before trying to associate
    connectDirectIntegration.node.addDependency(connectDirectLambda);
    // Avoid parallel API calls to Connect
    connectDirectIntegration.node.addDependency(lexHookIntegration);

    // ========================================
    // 5b. Keyboard Sound Prompt for Thinking Audio
    // ========================================
    // Create S3 bucket for Connect prompts (audio files)
    // Note: Connect requires 8kHz 8-bit mono μ-law WAV, but will also accept PCM WAV
    const connectPromptsBucket = new s3.Bucket(this, 'ConnectPromptsBucket', {
      bucketName: `${this.stackName.toLowerCase()}-connect-prompts-${this.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Upload the keyboard sound WAV file to S3
    new s3deploy.BucketDeployment(this, 'DeployKeyboardSound', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'assets', 'audio'), {
          exclude: ['*.mp3'], // Only include WAV files (Connect requires WAV)
        }),
      ],
      destinationBucket: connectPromptsBucket,
      prune: false,
    });

    // Create Lambda function for keyboard prompt custom resource
    // This properly extracts PromptId from the PromptARN returned by Connect API
    const createKeyboardPromptFn = new lambdaNode.NodejsFunction(this, 'CreateKeyboardPromptFn', {
      functionName: `${this.stackName}-CreateKeyboardPrompt`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'create-keyboard-prompt-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(createKeyboardPromptFn, { Function: 'create-keyboard-prompt' });

    // Grant permissions for Connect and S3
    createKeyboardPromptFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:CreatePrompt',
        'connect:DeletePrompt',
        'connect:DescribePrompt',
        'connect:ListPrompts',
      ],
      resources: ['*'],
    }));

    createKeyboardPromptFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject', 's3:GetBucketLocation'],
      resources: [
        connectPromptsBucket.bucketArn,
        `${connectPromptsBucket.bucketArn}/*`,
      ],
    }));

    // Create custom resource provider
    const keyboardPromptProvider = new customResources.Provider(this, 'KeyboardPromptProvider', {
      onEventHandler: createKeyboardPromptFn,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create the keyboard prompt using the Lambda custom resource
    // This properly returns PromptId extracted from PromptARN
    const keyboardSoundPrompt = new CustomResource(this, 'KeyboardSoundPromptV2', {
      serviceToken: keyboardPromptProvider.serviceToken,
      properties: {
        InstanceId: props.connectInstanceId,
        PromptName: `${this.stackName}-KeyboardTyping`,
        Description: 'Keyboard typing sound for AI thinking indicator',
        S3Bucket: connectPromptsBucket.bucketName,
        S3Key: 'Computer-keyboard-short.wav',
        // Force update when bucket changes
        UpdateTrigger: connectPromptsBucket.bucketName,
      },
    });

    // Get the PromptId from the custom resource (properly extracted from ARN)
    const keyboardPromptId = keyboardSoundPrompt.getAttString('PromptId');

    // ========================================
    // 6. Contact Flows (Dynamic Creation)
    // ========================================

    // Lex bot ARN for the contact flow
    const lexBotAliasArn = `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/${botAlias.attrBotAliasId}`;

    // Amazon Connect Contact Flow JSON uses a specific format.
    // The flow language is documented at: https://docs.aws.amazon.com/connect/latest/adminguide/contact-flow-language.html
    
    // Disconnect Contact Flow - Invokes finalizer Lambda on call end
    // Note: This is a regular CONTACT_FLOW that gets called on disconnect events
    const disconnectFlowContent = {
      Version: '2019-10-30',
      StartAction: 'invoke-lambda-action',
      Metadata: {
        entryPointPosition: { x: 40, y: 40 },
        ActionMetadata: {
          'invoke-lambda-action': { position: { x: 160, y: 40 } },
          'disconnect-action': { position: { x: 400, y: 40 } },
        },
      },
      Actions: [
        {
          Identifier: 'invoke-lambda-action',
          Type: 'InvokeLambdaFunction',
          Parameters: {
            LambdaFunctionARN: this.connectFinalizerFn.functionArn,
            InvocationTimeLimitSeconds: '8',
          },
          Transitions: {
            NextAction: 'disconnect-action',
            Errors: [
              { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
            ],
          },
        },
        {
          Identifier: 'disconnect-action',
          Type: 'DisconnectParticipant',
          Parameters: {},
          Transitions: {},
        },
      ],
    };

    const disconnectFlow = new connect.CfnContactFlow(this, 'DisconnectFlow', {
      instanceArn: props.connectInstanceArn,
      name: `${this.stackName}-DisconnectFlow`,
      type: 'CONTACT_FLOW',
      content: JSON.stringify(disconnectFlowContent),
      description: 'Finalizes AI call analytics on disconnect',
    });
    disconnectFlow.node.addDependency(finalizerIntegration);

    // Inbound Contact Flow - Custom Resource Handler
    // ========================================
    // Use a Lambda-backed custom resource to create the contact flow with dynamic prompt ARN
    // This is necessary because the prompt ARN isn't known until deployment time,
    // and CloudFormation tokens don't resolve properly in contact flow JSON.
    const createContactFlowFn = new lambdaNode.NodejsFunction(this, 'CreateContactFlowFn', {
      functionName: `${this.stackName}-CreateContactFlow`,
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'create-contact-flow-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    applyTags(createContactFlowFn, { Function: 'create-contact-flow' });

    createContactFlowFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:CreateContactFlow',
        'connect:UpdateContactFlowContent',
        'connect:DescribeContactFlow',
        'connect:ListContactFlows',
        'connect:DeleteContactFlow',
      ],
      resources: ['*'],
    }));

    // Use Provider framework for cleaner custom resource handling
    const createContactFlowProvider = new customResources.Provider(this, 'CreateContactFlowProvider', {
      onEventHandler: createContactFlowFn,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create the inbound flow with the custom resource
    // NOTE: Using 'InboundAiFlowV2' as logical ID to avoid conflict with old CFN-based contact flow
    const inboundFlow = new CustomResource(this, 'InboundAiFlowV2', {
      serviceToken: createContactFlowProvider.serviceToken,
      properties: {
        InstanceId: props.connectInstanceId,
        FlowName: `${this.stackName}-InboundAiFlowV2`,
        FlowType: 'CONTACT_FLOW',
        Description: 'AI voice assistant using Lex and Bedrock with keyboard sound thinking indicator',
        LexBotAliasArn: lexBotAliasArn,
        // Use the existing LexBedrockHook (it supports Connect direct invocation and clinic mapping)
        // This avoids Bedrock on-demand model invocation constraints and reuses ai-agent routing.
        LambdaFunctionArn: this.lexBedrockHookFn.functionArn,
        // Pass the prompt ID from the custom resource (PlayPrompt expects ID, not ARN)
        KeyboardPromptId: keyboardPromptId,
        // Force update ONLY when dependencies actually change
        UpdateTrigger: `${lexBotAliasArn}|${this.lexBedrockHookFn.functionArn}|${keyboardPromptId}|v6`,
      },
    });
    inboundFlow.node.addDependency(disconnectFlow);
    inboundFlow.node.addDependency(lexIntegration);
    inboundFlow.node.addDependency(connectDirectIntegration);
    inboundFlow.node.addDependency(keyboardSoundPrompt);
    
    // Disconnect flow is set automatically via UpdateContactEventHooks in the inbound flow.

    // ========================================
    // 7. Associate Phone Number with Flow
    // ========================================
    // Step 1: Lookup the phone number ID using the E.164 number
    // The Connect API needs phone number ID/ARN, not the E.164 number
    const phoneNumberLookup = new customResources.AwsCustomResource(this, 'PhoneNumberLookup', {
      onCreate: {
        service: 'Connect',
        action: 'listPhoneNumbersV2',
        parameters: {
          TargetArn: props.connectInstanceArn,
          PhoneNumberTypes: ['DID', 'TOLL_FREE'],
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-phone-lookup`),
      },
      policy: customResources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['connect:ListPhoneNumbersV2'],
          resources: ['*'],
        }),
      ]),
    });

    // Step 2: Use a Lambda-backed custom resource to find and update the phone number
    // This is more reliable than trying to parse the lookup result in CloudFormation
    const phoneAssociationFn = new lambdaNode.NodejsFunction(this, 'PhoneAssociationFn', {
      functionName: `${this.stackName}-PhoneAssociation`,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      handler: 'handler',
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'phone-association-handler.ts'),
      environment: {
        CONNECT_INSTANCE_ARN: props.connectInstanceArn,
        PHONE_NUMBER: props.connectAiPhoneNumber,
        // Get the contact flow ARN from the custom resource
        CONTACT_FLOW_ARN: inboundFlow.getAttString('ContactFlowArn'),
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    phoneAssociationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:ListPhoneNumbersV2',
        'connect:UpdatePhoneNumber',
        'connect:DescribePhoneNumber',
        'connect:AssociatePhoneNumberContactFlow',
        'connect:DisassociatePhoneNumberContactFlow',
      ],
      resources: ['*'],
    }));

    // Use Provider framework for cleaner custom resource handling
    const phoneAssociationProvider = new customResources.Provider(this, 'PhoneAssociationProvider', {
      onEventHandler: phoneAssociationFn,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const phoneNumberAssociation = new CustomResource(this, 'PhoneNumberAssociation', {
      serviceToken: phoneAssociationProvider.serviceToken,
      properties: {
        InstanceArn: props.connectInstanceArn,
        PhoneNumber: props.connectAiPhoneNumber,
        ContactFlowArn: inboundFlow.getAttString('ContactFlowArn'),
        // Force update when flow changes
        FlowVersion: Date.now().toString(),
      },
    });
    phoneNumberAssociation.node.addDependency(inboundFlow);

    // Store flow ARNs for reference
    this.inboundFlowArn = inboundFlow.getAttString('ContactFlowArn');
    this.disconnectFlowArn = disconnectFlow.attrContactFlowArn;

    // ========================================
    // OUTPUTS
    // ========================================
    new CfnOutput(this, 'LexBotId', {
      value: this.lexBotId,
      description: 'Lex V2 Bot ID',
      exportName: `${this.stackName}-LexBotId`,
    });

    new CfnOutput(this, 'LexBotAliasId', {
      value: this.lexBotAliasId,
      description: 'Lex V2 Bot Alias ID',
      exportName: `${this.stackName}-LexBotAliasId`,
    });

    new CfnOutput(this, 'LexBedrockHookFnArn', {
      value: this.lexBedrockHookFn.functionArn,
      description: 'Lex Bedrock Hook Lambda ARN',
      exportName: `${this.stackName}-LexBedrockHookFnArn`,
    });

    new CfnOutput(this, 'ConnectFinalizerFnArn', {
      value: this.connectFinalizerFn.functionArn,
      description: 'Connect Call Finalizer Lambda ARN',
      exportName: `${this.stackName}-ConnectFinalizerFnArn`,
    });

    new CfnOutput(this, 'InboundFlowArn', {
      value: inboundFlow.getAttString('ContactFlowArn'),
      description: 'Inbound AI Contact Flow ARN',
      exportName: `${this.stackName}-InboundFlowArn`,
    });

    new CfnOutput(this, 'DisconnectFlowArn', {
      value: disconnectFlow.attrContactFlowArn,
      description: 'Disconnect Contact Flow ARN',
      exportName: `${this.stackName}-DisconnectFlowArn`,
    });

    new CfnOutput(this, 'AssociatedPhoneNumber', {
      value: props.connectAiPhoneNumber,
      description: 'Phone number associated with the AI contact flow',
      exportName: `${this.stackName}-AssociatedPhoneNumber`,
    });

    new CfnOutput(this, 'KeyboardSoundPromptId', {
      value: keyboardPromptId,
      description: 'Connect Prompt ID for keyboard typing sound (thinking indicator)',
      exportName: `${this.stackName}-KeyboardSoundPromptId`,
    });

    new CfnOutput(this, 'ConnectPromptsBucketName', {
      value: connectPromptsBucket.bucketName,
      description: 'S3 bucket containing Connect prompts (audio files)',
      exportName: `${this.stackName}-ConnectPromptsBucketName`,
    });

    new CfnOutput(this, 'DeploymentInfo', {
      value: `
DEPLOYMENT COMPLETE:
- Inbound AI Flow: ${this.stackName}-InboundAiFlowV2
- Disconnect Flow: ${this.stackName}-DisconnectFlow  
- Phone Number: ${props.connectAiPhoneNumber} (auto-associated)
- Lex Bot: ${lexBot.name} (alias: prod)
- Keyboard Sound: Plays during AI thinking

Then call ${props.connectAiPhoneNumber} to test the AI assistant!
      `.trim(),
      description: 'Deployment information',
    });
  }
}
