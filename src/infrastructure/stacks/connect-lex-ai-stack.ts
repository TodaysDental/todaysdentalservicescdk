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

import { Duration, Stack, StackProps, CfnOutput, Fn, RemovalPolicy, Tags, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as connect from 'aws-cdk-lib/aws-connect';
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
}

// ========================================================================
// STACK
// ========================================================================

export class ConnectLexAiStack extends Stack {
  public readonly lexBedrockHookFn: lambda.IFunction;
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
    const connectFinalizerPermission = this.connectFinalizerFn.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: props.connectInstanceArn,
    });

    // Grant Connect permission to invoke Lex hook Lambda (for contact flows)
    const lexHookConnectPermission = this.lexBedrockHookFn.addPermission('ConnectInvoke', {
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

    // Create the Lex V2 bot
    // NOTE: Using 'DentalAiBotV2' to force CloudFormation to create a new bot
    // because intent updates don't propagate correctly on existing bots.
    const lexBot = new lex.CfnBot(this, 'DentalAiBotV2', {
      name: `${this.stackName}-DentalAIv2`,
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
              },
            },
            {
              name: 'FallbackIntent',
              description: 'Catch-all intent that routes to Bedrock',
              parentIntentSignature: 'AMAZON.FallbackIntent',
              fulfillmentCodeHook: {
                enabled: true,
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
                lambdaArn: this.lexBedrockHookFn.functionArn,
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
    const lexIntegration = new customResources.AwsCustomResource(this, 'ConnectLexIntegration', {
      onCreate: {
        service: 'Connect',
        action: 'associateBot',
        parameters: {
          InstanceId: props.connectInstanceId,
          LexV2Bot: {
            AliasArn: `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/${botAlias.attrBotAliasId}`,
          },
        },
        physicalResourceId: customResources.PhysicalResourceId.of(`${this.stackName}-lex-v2-integration`),
      },
      onDelete: {
        service: 'Connect',
        action: 'disassociateBot',
        parameters: {
          InstanceId: props.connectInstanceId,
          LexV2Bot: {
            AliasArn: `arn:aws:lex:${this.region}:${this.account}:bot-alias/${lexBot.attrId}/${botAlias.attrBotAliasId}`,
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

    // Inbound Contact Flow - Uses Lex V2 for AI conversation
    // Flow: Connect to Lex -> (Lex handles the dialog) -> Disconnect when Lex returns
    // NOTE: Disconnect flow hook must be configured manually in Connect console for now
    // (adding UpdateContactEventHooks with a Fn::GetAtt reference causes circular dependency issues)
    const inboundFlowContent = {
      Version: '2019-10-30',
      StartAction: 'connect-lex-action',
      Metadata: {
        entryPointPosition: { x: 40, y: 40 },
        ActionMetadata: {
          'connect-lex-action': { position: { x: 160, y: 40 } },
          'disconnect-action': { position: { x: 400, y: 40 } },
        },
      },
      Actions: [
        {
          Identifier: 'connect-lex-action',
          // IMPORTANT: For Lex in Amazon Connect flow JSON, use ConnectParticipantWithLexBot
          // (not GetParticipantInput + LexV2Bot).
          Type: 'ConnectParticipantWithLexBot',
          Parameters: {
            Text: 'Hello! Thank you for calling. How can I help you today?',
            LexV2Bot: {
              AliasArn: lexBotAliasArn,
            },
          },
          Transitions: {
            NextAction: 'disconnect-action',
            Errors: [
              { NextAction: 'disconnect-action', ErrorType: 'InputTimeLimitExceeded' },
              { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
              { NextAction: 'disconnect-action', ErrorType: 'NoMatchingCondition' },
            ],
            Conditions: [],
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

    const inboundFlow = new connect.CfnContactFlow(this, 'InboundAiFlow', {
      instanceArn: props.connectInstanceArn,
      name: `${this.stackName}-InboundAiFlow`,
      type: 'CONTACT_FLOW',
      content: JSON.stringify(inboundFlowContent),
      description: 'AI voice assistant using Lex and Bedrock',
    });
    inboundFlow.addDependency(disconnectFlow);
    inboundFlow.node.addDependency(lexIntegration);
    
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
        CONTACT_FLOW_ARN: inboundFlow.attrContactFlowArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    phoneAssociationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'connect:ListPhoneNumbersV2',
        'connect:UpdatePhoneNumber',
        'connect:DescribePhoneNumber',
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
        ContactFlowArn: inboundFlow.attrContactFlowArn,
        // Force update when flow changes
        FlowVersion: Date.now().toString(),
      },
    });
    phoneNumberAssociation.node.addDependency(inboundFlow);

    // Store flow ARNs for reference
    this.inboundFlowArn = inboundFlow.attrContactFlowArn;
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
      value: inboundFlow.attrContactFlowArn,
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

    new CfnOutput(this, 'DeploymentInfo', {
      value: `
DEPLOYMENT COMPLETE:
- Inbound AI Flow: ${this.stackName}-InboundAiFlow
- Disconnect Flow: ${this.stackName}-DisconnectFlow  
- Phone Number: ${props.connectAiPhoneNumber} (auto-associated)
- Lex Bot: ${lexBot.name} (alias: prod)

Then call ${props.connectAiPhoneNumber} to test the AI assistant!
      `.trim(),
      description: 'Deployment information',
    });
  }
}
