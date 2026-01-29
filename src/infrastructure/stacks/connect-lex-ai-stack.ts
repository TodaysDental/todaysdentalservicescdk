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

import { ArnFormat, Duration, Stack, StackProps, CfnOutput, Tags, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
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

  /**
   * Enable async Lambda pattern for Bedrock invocation.
   * 
   * When true:
   * - Uses async Lambda invocation (up to 60s) instead of sync (8s limit)
   * - Plays continuous keyboard sounds while Bedrock processes
   * - Allows complex tool calls (patient search) to complete without timeout
   * 
   * When false (default):
   * - Uses sync Lambda with 7.2s timeout
   * - Single keyboard sound plays before Lambda
   * - May timeout on complex operations
   */
  useAsyncPattern?: boolean;

  /**
   * Maximum number of poll loops for async pattern (default 20 = ~40 seconds).
   * Each loop plays ~2 seconds of keyboard sounds.
   */
  asyncMaxPollLoops?: number;
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
      memorySize: 1024, // Increased from 512 for faster AI response times
      environment: {
        AGENTS_TABLE: props.agentsTableName,
        SESSIONS_TABLE: props.sessionsTableName,
        CALL_ANALYTICS_TABLE: props.callAnalyticsTableName,
        TRANSCRIPT_BUFFER_TABLE_NAME: props.transcriptBufferTableName,
        AI_PHONE_NUMBERS_JSON: props.aiPhoneNumbersJson || '{}',
        DEFAULT_CLINIC_ID: props.defaultClinicId || 'dentistingreenville',
        // Keep Bedrock comfortably under Connect's ~8s InvokeLambdaFunction hard limit
        CONNECT_BEDROCK_TIMEOUT_MS: '6500',
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

    // ========================================
    // 1b. Async Bedrock Pattern (Optional)
    // ========================================
    // When enabled, uses async Lambda invocation to overcome the 8-second limit.
    // This allows Bedrock agent tool calls (like patient search) to take 30+ seconds
    // while the caller hears continuous keyboard typing sounds.

    let asyncBedrockLambda: lambdaNode.NodejsFunction | undefined;
    let asyncResultsTable: dynamodb.Table | undefined;
    let asyncBedrockConnectPermission: lambda.CfnPermission | undefined;

    if (props.useAsyncPattern) {
      // DynamoDB table for storing async results
      asyncResultsTable = new dynamodb.Table(this, 'AsyncResultsTable', {
        tableName: `${this.stackName}-AsyncResults`,
        partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'ttl',
      });
      applyTags(asyncResultsTable, { Resource: 'async-results-table' });

      // IMPORTANT: Keep a stable, string-based function name so we can reference it in IAM
      // policies without creating a CFN circular dependency (Policy -> Ref Function -> Policy).
      const asyncBedrockFunctionName = `${this.stackName}-AsyncBedrock`;

      // Async Bedrock Lambda
      asyncBedrockLambda = new lambdaNode.NodejsFunction(this, 'AsyncBedrockLambda', {
        functionName: asyncBedrockFunctionName,
        entry: path.join(__dirname, '..', '..', 'services', 'connect', 'async-bedrock-handler.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(60), // Full 60 seconds for async processing
        memorySize: 1024,
        environment: {
          ASYNC_RESULTS_TABLE: asyncResultsTable.tableName,
          AGENTS_TABLE: props.agentsTableName,
          SESSIONS_TABLE: props.sessionsTableName,
          AI_PHONE_NUMBERS_JSON: props.aiPhoneNumbersJson || '{}',
          DEFAULT_CLINIC_ID: props.defaultClinicId || 'dentistingreenville',
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });
      applyTags(asyncBedrockLambda, { Function: 'async-bedrock' });

      // Grant DynamoDB permissions for async results
      asyncResultsTable.grantReadWriteData(asyncBedrockLambda);

      // Grant DynamoDB permissions for agent/session lookup
      asyncBedrockLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          props.agentsTableArn,
          `${props.agentsTableArn}/index/*`,
        ],
      }));

      asyncBedrockLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.sessionsTableArn],
      }));

      // Grant Bedrock Agent invocation permissions
      asyncBedrockLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeAgent',
          'bedrock:InvokeModel',
        ],
        resources: ['*'],
      }));

      // Allow the START path to invoke the worker invocation asynchronously (self-invocation).
      // IMPORTANT: Avoid referencing asyncBedrockLambda.functionArn here, which can create a CFN
      // circular dependency (Lambda -> RolePolicy -> Lambda). Use a static ARN string instead.
      const asyncBedrockLambdaInvokeArn = Stack.of(this).formatArn({
        service: 'lambda',
        resource: 'function',
        resourceName: asyncBedrockFunctionName,
        // Lambda ARNs are `...:function:NAME` (colon), not `...:function/NAME` (slash).
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });
      asyncBedrockLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          asyncBedrockLambdaInvokeArn,
          `${asyncBedrockLambdaInvokeArn}:*`,
        ],
      }));

      // Grant Connect permission to invoke async Lambda
      asyncBedrockLambda.addPermission('ConnectInvoke', {
        principal: new iam.ServicePrincipal('connect.amazonaws.com'),
        sourceArn: props.connectInstanceArn,
      });
      asyncBedrockConnectPermission = asyncBedrockLambda.node.findChild('ConnectInvoke') as lambda.CfnPermission;

      console.log(`[ConnectLexAiStack] Async pattern enabled with 60s timeout`);
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
    this.connectFinalizerFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });
    const connectFinalizerPermission = this.connectFinalizerFn.node.findChild('ConnectInvoke') as lambda.CfnPermission;

    // Grant Connect permission to invoke Lex hook Lambda (for contact flows)
    this.lexBedrockHookFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });
    const lexHookConnectPermission = this.lexBedrockHookFn.node.findChild('ConnectInvoke') as lambda.CfnPermission;

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
      onDelete: {
        service: 'Connect',
        action: 'disassociateBot',
        parameters: {
          InstanceId: props.connectInstanceId,
          LexV2Bot: {
            AliasArn: botAliasArnForConnect,
          },
        },
        ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
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
    finalizerIntegration.node.addDependency(connectFinalizerPermission);

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
    lexHookIntegration.node.addDependency(lexHookConnectPermission);
    // Avoid parallel API calls to Connect
    lexHookIntegration.node.addDependency(finalizerIntegration);

    // Associate async Bedrock Lambda with Connect (if async pattern enabled)
    let asyncLambdaIntegration: customResources.AwsCustomResource | undefined;
    if (asyncBedrockLambda) {
      asyncLambdaIntegration = new customResources.AwsCustomResource(this, 'AsyncLambdaIntegration', {
        onCreate: {
          service: 'Connect',
          action: 'associateLambdaFunction',
          parameters: {
            InstanceId: props.connectInstanceId,
            FunctionArn: asyncBedrockLambda.functionArn,
          },
          physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-async-integration`),
        },
        onDelete: {
          service: 'Connect',
          action: 'disassociateLambdaFunction',
          parameters: {
            InstanceId: props.connectInstanceId,
            FunctionArn: asyncBedrockLambda.functionArn,
          },
          ignoreErrorCodesMatching: '.*NotFound.*|.*ResourceNotFound.*',
        },
        policy: customResources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'connect:AssociateLambdaFunction',
              'connect:DisassociateLambdaFunction',
              'connect:ListLambdaFunctions',
            ],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'lambda:GetFunction',
              'lambda:GetPolicy',
              'lambda:AddPermission',
              'lambda:RemovePermission',
            ],
            resources: [asyncBedrockLambda.functionArn],
          }),
        ]),
      });

      // Ensure Connect can invoke the Lambda before associating it
      asyncLambdaIntegration.node.addDependency(asyncBedrockConnectPermission || asyncBedrockLambda);
      // Avoid parallel API calls to Connect
      asyncLambdaIntegration.node.addDependency(lexHookIntegration);
    }

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
    const deployKeyboardSound = new s3deploy.BucketDeployment(this, 'DeployKeyboardSound', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'assets', 'audio'), {
          exclude: ['*.mp3'], // Only include WAV files (Connect requires WAV)
        }),
      ],
      destinationBucket: connectPromptsBucket,
      prune: false,
    });

    // Deterministic trigger to update the prompt when the WAV bytes change
    const keyboardWavPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'assets',
      'audio',
      'Computer-keyboard-short.wav'
    );
    let keyboardWavHash = 'unknown';
    try {
      keyboardWavHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(keyboardWavPath))
        .digest('hex')
        .slice(0, 16);
    } catch (e) {
      console.warn('[ConnectLexAiStack] Could not hash keyboard WAV for update trigger:', e);
    }

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
        'connect:UpdatePrompt',
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
        // Force update when WAV bytes change (ensures Connect prompt refreshes)
        UpdateTrigger: keyboardWavHash,
      },
    });
    // Ensure the WAV is uploaded before Connect tries to create/update the prompt
    keyboardSoundPrompt.node.addDependency(deployKeyboardSound);

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
        // Used by UpdateContactEventHooks (CustomerRemaining) to run a disconnect flow for finalization
        DisconnectFlowArn: disconnectFlow.attrContactFlowArn,
        // Force update ONLY when dependencies actually change
        // Bump version when contact flow logic changes (forces custom resource update)
        UpdateTrigger: `${lexBotAliasArn}|${this.lexBedrockHookFn.functionArn}|${keyboardPromptId}|${disconnectFlow.attrContactFlowArn}|v8`,
      },
    });
    inboundFlow.node.addDependency(disconnectFlow);
    inboundFlow.node.addDependency(lexIntegration);
    inboundFlow.node.addDependency(lexHookIntegration);
    inboundFlow.node.addDependency(keyboardSoundPrompt);

    // ========================================
    // 6b. Async Contact Flow (Optional)
    // ========================================
    // When async pattern is enabled, create a second contact flow that:
    // - Starts async Lambda (returns immediately)
    // - Loops playing keyboard sounds while polling for result
    // - Speaks AI response when ready
    // This allows Bedrock to take 30+ seconds for complex tool calls.

    let asyncInboundFlow: CustomResource | undefined;

    if (props.useAsyncPattern && asyncBedrockLambda) {
      // Create the async contact flow handler
      const createAsyncContactFlowFn = new lambdaNode.NodejsFunction(this, 'CreateAsyncContactFlowFn', {
        functionName: `${this.stackName}-CreateAsyncContactFlow`,
        entry: path.join(__dirname, '..', '..', 'services', 'connect', 'create-async-contact-flow-handler.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.seconds(30),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });
      applyTags(createAsyncContactFlowFn, { Function: 'create-async-contact-flow' });

      createAsyncContactFlowFn.addToRolePolicy(new iam.PolicyStatement({
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

      const createAsyncContactFlowProvider = new customResources.Provider(this, 'CreateAsyncContactFlowProvider', {
        onEventHandler: createAsyncContactFlowFn,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      asyncInboundFlow = new CustomResource(this, 'AsyncInboundAiFlow', {
        serviceToken: createAsyncContactFlowProvider.serviceToken,
        properties: {
          InstanceId: props.connectInstanceId,
          FlowName: `${this.stackName}-AsyncInboundAiFlow`,
          FlowType: 'CONTACT_FLOW',
          Description: 'AI voice assistant with async pattern - continuous keyboard sounds during processing',
          LexBotAliasArn: lexBotAliasArn,
          AsyncLambdaArn: asyncBedrockLambda.functionArn,
          KeyboardPromptId: keyboardPromptId,
          DisconnectFlowArn: disconnectFlow.attrContactFlowArn,
          MaxPollLoops: String(props.asyncMaxPollLoops || 20),
          // Bump version when contact flow logic changes (forces custom resource update)
          UpdateTrigger: `${lexBotAliasArn}|${asyncBedrockLambda.functionArn}|${keyboardPromptId}|${disconnectFlow.attrContactFlowArn}|${props.asyncMaxPollLoops || 20}|v3`,
        },
      });
      asyncInboundFlow.node.addDependency(disconnectFlow);
      asyncInboundFlow.node.addDependency(lexIntegration);
      asyncInboundFlow.node.addDependency(asyncLambdaIntegration!);
      asyncInboundFlow.node.addDependency(keyboardSoundPrompt);

      console.log(`[ConnectLexAiStack] Async contact flow created with ${props.asyncMaxPollLoops || 20} max poll loops`);
    }

    // Determine which flow to use for phone number association
    const activeInboundFlow = props.useAsyncPattern && asyncInboundFlow ? asyncInboundFlow : inboundFlow;

    // Disconnect flow is set automatically via UpdateContactEventHooks in the inbound flow.

    // ========================================
    // 7. Associate Phone Number with Flow
    // ========================================
    // Use a Lambda-backed custom resource to find and update the phone number
    // This is more reliable than trying to parse the lookup result in CloudFormation
    const phoneAssociationFn = new lambdaNode.NodejsFunction(this, 'PhoneAssociationFn', {
      functionName: `${this.stackName}-PhoneAssociation`,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      handler: 'handler',
      entry: path.join(__dirname, '..', '..', 'services', 'connect', 'phone-association-handler.ts'),
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    phoneAssociationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:ListPhoneNumbersV2',
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
        ContactFlowArn: activeInboundFlow.getAttString('ContactFlowArn'),
      },
    });
    phoneNumberAssociation.node.addDependency(activeInboundFlow);

    // Store flow ARNs for reference
    this.inboundFlowArn = activeInboundFlow.getAttString('ContactFlowArn');
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
      value: activeInboundFlow.getAttString('ContactFlowArn'),
      description: 'Active Inbound AI Contact Flow ARN (sync or async based on useAsyncPattern)',
      exportName: `${this.stackName}-InboundFlowArn`,
    });

    new CfnOutput(this, 'DisconnectFlowArn', {
      value: disconnectFlow.attrContactFlowArn,
      description: 'Disconnect Contact Flow ARN',
      exportName: `${this.stackName}-DisconnectFlowArn`,
    });

    // Async pattern outputs
    if (props.useAsyncPattern && asyncBedrockLambda && asyncResultsTable) {
      new CfnOutput(this, 'AsyncBedrockLambdaArn', {
        value: asyncBedrockLambda.functionArn,
        description: 'Async Bedrock Lambda ARN (60s timeout for complex tool calls)',
        exportName: `${this.stackName}-AsyncBedrockLambdaArn`,
      });

      new CfnOutput(this, 'AsyncResultsTableName', {
        value: asyncResultsTable.tableName,
        description: 'DynamoDB table for async results polling',
        exportName: `${this.stackName}-AsyncResultsTableName`,
      });

      new CfnOutput(this, 'AsyncPatternEnabled', {
        value: 'true',
        description: 'Async pattern is enabled with continuous keyboard sounds',
      });
    }

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

    const asyncInfo = props.useAsyncPattern
      ? `
- Async Pattern: ENABLED (60s timeout, continuous keyboard sounds)
- Max Poll Loops: ${props.asyncMaxPollLoops || 20} (~${(props.asyncMaxPollLoops || 20) * 2}s max wait)`
      : `
- Async Pattern: DISABLED (7.2s sync timeout)`;

    new CfnOutput(this, 'DeploymentInfo', {
      value: `
DEPLOYMENT COMPLETE:
- Inbound AI Flow: ${props.useAsyncPattern ? `${this.stackName}-AsyncInboundAiFlow` : `${this.stackName}-InboundAiFlowV2`}
- Disconnect Flow: ${this.stackName}-DisconnectFlow  
- Phone Number: ${props.connectAiPhoneNumber} (auto-associated)
- Lex Bot: ${lexBot.name} (alias: prod)
- Keyboard Sound: Plays during AI thinking${asyncInfo}

Then call ${props.connectAiPhoneNumber} to test the AI assistant!
      `.trim(),
      description: 'Deployment information',
    });
  }
}
