import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { getCdkCorsConfig, getCorsErrorHeaders } from '../../shared/utils/cors';

export interface AdminStackProps extends StackProps {
  staffUserTableName: string;
  clinicHoursTableName: string;
  staffClinicInfoTableName?: string;
  agentPresenceTableName?: string;
  agentActiveTableName?: string;
  jwtSecretValue?: string;
  /** GlobalSecrets DynamoDB table name for retrieving secrets */
  globalSecretsTableName?: string;
  /** ClinicConfig DynamoDB table name for clinic configuration */
  clinicConfigTableName?: string;
  /** KMS key ARN for decrypting secrets */
  secretsEncryptionKeyArn?: string;
  // ** NEW: Input for the Communications Module (Favor Requests Table Name) **
  favorsTableName: string;
  // ** NEW: Teams table for group favor requests **
  teamsTableName?: string;
  // ** NEW: Analytics Table Name **
  analyticsTableName?: string;
  // ** NEW: Additional table names for detailed analytics **
  callQueueTableName?: string;
  recordingMetadataTableName?: string;
  chatHistoryTableName?: string;
  clinicsTableName?: string;
  recordingsBucketName?: string;
  // ** NEW: TranscriptBuffers table for LexAI/Voice AI transcripts **
  transcriptBufferTableName?: string;
  // Optional ARNs for Chime lambdas (imported from Chime stack to avoid
  // two-way construct references). When provided, Admin stack will add API
  // routes that integrate with these functions.
  agentActiveFnArn?: string;
  agentInactiveFnArn?: string;
  outboundCallFnArn?: string;
  transferCallFnArn?: string;
  callAcceptedFnArn?: string;
  callAcceptedV2FnArn?: string;
  callRejectedV2FnArn?: string;
  callHungupV2FnArn?: string;
  callRejectedFnArn?: string;
  callHungupFnArn?: string;
  leaveCallFnArn?: string;
  holdCallFnArn?: string;
  resumeCallFnArn?: string;
  // ** NEW: Add Call, DTMF, Notes, Conference **
  addCallFnArn?: string;
  sendDtmfFnArn?: string;
  callNotesFnArn?: string;
  conferenceCallFnArn?: string;
  // ** NEW: Join Call Operations **
  joinQueuedCallFnArn?: string;
  joinActiveCallFnArn?: string;
  getJoinableCallsFnArn?: string;
  // ** NEW: Online Agents **
  getOnlineAgentsFnArn?: string;
  // ** NEW: Call Recording **
  getRecordingFnArn?: string;
  /** Custom domain name token from CoreStack — creates implicit dependency so domain exists first */
  apiDomainName?: string;
}

export class AdminStack extends Stack {
  public readonly registerFnV3: lambdaNode.NodejsFunction;
  public readonly meFn: lambdaNode.NodejsFunction;
  public readonly usersFn: lambdaNode.NodejsFunction;
  public readonly directoryLookupFn: lambdaNode.NodejsFunction;
  public readonly listRequestsFn: lambdaNode.NodejsFunction; // ** NEW: Request List Lambda Property **
  public readonly mePresenceFn?: lambdaNode.NodejsFunction;
  public readonly getAnalyticsFn?: lambdaNode.NodejsFunction; // ** NEW: Analytics Query Lambda **
  public readonly getDetailedAnalyticsFn?: lambdaNode.NodejsFunction; // ** NEW: Detailed Analytics Lambda **
  public readonly getCallCenterDashboardFn?: lambdaNode.NodejsFunction; // ** NEW: Call Center Dashboard Lambda **
  // ...existing code...
  public readonly api: apigw.RestApi;
  public readonly authorizer: apigw.RequestAuthorizer;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    // Apply stack-wide tags for cost allocation and discovery
    const baseTags: Record<string, string> = {
      Stack: Stack.of(this).stackName,
      Service: 'Admin',
      ManagedBy: 'cdk',
    };
    const applyTags = (resource: Construct, extra?: Record<string, string>) => {
      Object.entries(baseTags).forEach(([key, value]) => Tags.of(resource).add(key, value));
      if (extra) {
        Object.entries(extra).forEach(([key, value]) => Tags.of(resource).add(key, value));
      }
    };
    applyTags(this);

    // Helper functions for alarms
    const createLambdaErrorAlarm = (fn: lambda.IFunction, displayName: string) => {
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
        alarmDescription: `Alert when ${displayName} Lambda has errors`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaThrottleAlarm = (fn: lambda.IFunction, displayName: string) => {
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
        alarmDescription: `Alert when ${displayName} Lambda is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createLambdaDurationAlarm = (fn: lambda.IFunction, displayName: string, thresholdMs: number) => {
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
        alarmDescription: `Alert when ${displayName} Lambda p99 duration exceeds ${thresholdMs}ms (~80% of timeout)`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    const createDynamoThrottleAlarm = (tableName: string, idSuffix: string) => {
      new cloudwatch.Alarm(this, `${idSuffix}ThrottleAlarm`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: tableName },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: `Alert when DynamoDB table ${tableName} is throttled`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    };

    // ========================================
    // API GATEWAY SETUP
    // ========================================

    const corsConfig = getCdkCorsConfig();

    this.api = new apigw.RestApi(this, 'AdminApi', {
      restApiName: 'AdminApi',
      description: 'Admin service API',
      defaultCorsPreflightOptions: {
        allowOrigins: corsConfig.allowOrigins,
        allowHeaders: corsConfig.allowHeaders,
        allowMethods: corsConfig.allowMethods,
        allowCredentials: true,
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

    // Import the authorizer function ARN from CoreStack's export
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArnN1');
    const authorizerFn = lambda.Function.fromFunctionArn(this, 'ImportedAuthorizerFn', authorizerFunctionArn);

    // Create authorizer for this stack's API
    this.authorizer = new apigw.RequestAuthorizer(this, 'AdminAuthorizer', {
      handler: authorizerFn,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // Grant API Gateway permission to invoke the authorizer Lambda
    // The authorizer sourceArn pattern is different from regular API method invocations
    // Authorizer invocations use: arn:aws:execute-api:region:account:api-id/authorizers/*
    new lambda.CfnPermission(this, 'AuthorizerInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunctionArn,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/authorizers/*`,
    });

    // ========================================
    // CLINIC COSTS (import table from ClinicCostStack)
    // ========================================
    // The ClinicCostStack owns and seeds this table — we import it here rather than
    // creating a duplicate empty table.
    const clinicCostTable = dynamodb.Table.fromTableName(
      this,
      'ClinicCostOfOperationTableImport',
      'TodaysDentalInsightsClinicCostN1-ClinicCostOfOperation'
    );

    const clinicCostCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicCostCrudFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'costCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        CLINIC_COST_TABLE: clinicCostTable.tableName,
        CORS_ORIGIN: corsConfig.allowOrigins[0] || '*',
      },
    });
    applyTags(clinicCostCrudFn, { Function: 'clinic-costs-crud' });
    clinicCostTable.grantReadWriteData(clinicCostCrudFn);

    // ========================================
    // CLINIC DAILY BUDGETS (import table from ClinicBudgetStack)
    // ========================================
    // The ClinicBudgetStack owns and seeds this table — we import it here rather than
    // creating a duplicate empty table.
    const clinicBudgetTable = dynamodb.Table.fromTableName(
      this,
      'ClinicDailyBudgetTableImport',
      'TodaysDentalInsightsClinicBudgetN1-ClinicDailyBudget'
    );

    const clinicBudgetCrudFn = new lambdaNode.NodejsFunction(this, 'ClinicBudgetCrudFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'clinic', 'budgetCrud.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        CLINIC_BUDGET_TABLE: clinicBudgetTable.tableName,
        CORS_ORIGIN: corsConfig.allowOrigins[0] || '*',
      },
    });
    applyTags(clinicBudgetCrudFn, { Function: 'clinic-budgets-crud' });
    clinicBudgetTable.grantReadWriteData(clinicBudgetCrudFn);


    // ========================================
    // LAMBDA FUNCTIONS
    // ========================================

    // Admin API Lambda (register)
    this.registerFnV3 = new lambdaNode.NodejsFunction(this, 'AdminRegisterFnV3', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'register.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        JWT_SECRET: props.jwtSecretValue ?? '',
        // Secrets tables for dynamic credential retrieval (cPanel credentials now from GlobalSecrets)
        GLOBAL_SECRETS_TABLE: props.globalSecretsTableName || 'TodaysDentalInsights-GlobalSecrets',
        CLINIC_CONFIG_TABLE: props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig',
      },
    });
    applyTags(this.registerFnV3, { Function: 'register' });

    // Grant permissions to DynamoDB tables
    const staffUserTable = dynamodb.Table.fromTableName(this, 'StaffUserTable', props.staffUserTableName);
    applyTags(staffUserTable, { Table: 'staff-user' });
    staffUserTable.grantReadWriteData(this.registerFnV3);

    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTable = dynamodb.Table.fromTableName(this, 'StaffClinicInfoTableImport', props.staffClinicInfoTableName);
      applyTags(staffClinicInfoTable, { Table: 'staff-clinic-info' });
      staffClinicInfoTable.grantReadWriteData(this.registerFnV3);
    }



    // Admin Users API Lambda
    this.usersFn = new lambdaNode.NodejsFunction(this, 'AdminUsersFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'users.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20', minify: true },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
        CORS_ORIGIN: 'https://todaysdentalinsights.com',
        JWT_SECRET: props.jwtSecretValue ?? '',
      },
    });
    applyTags(this.usersFn, { Function: 'users' });

    // Grant permissions to DynamoDB tables
    staffUserTable.grantReadWriteData(this.usersFn);

    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTable2 = dynamodb.Table.fromTableName(this, 'StaffClinicInfoTableImport2', props.staffClinicInfoTableName);
      applyTags(staffClinicInfoTable2, { Table: 'staff-clinic-info' });
      staffClinicInfoTable2.grantReadWriteData(this.usersFn);
    }
    if (props.staffClinicInfoTableName) {
      this.usersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',        // For reading existing StaffClinicInfo records
          'dynamodb:PutItem',        // For writing/upserting StaffClinicInfo records
          'dynamodb:UpdateItem',     // For partial updates
          'dynamodb:DeleteItem',     // For deleteStaffInfoFromDynamoDB
          'dynamodb:Query',          // For getStaffInfoFromDynamoDB
          'dynamodb:BatchWriteItem'  // For syncStaffInfoInDynamoDB and deleteStaffInfoFromDynamoDB
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }

    // *** Directory Lookup Lambda for general user selection ***
    this.directoryLookupFn = new lambdaNode.NodejsFunction(this, 'DirectoryLookupFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'directory-lookup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        STAFF_USER_TABLE: props.staffUserTableName,
      },
    });
    applyTags(this.directoryLookupFn, { Function: 'directory-lookup' });

    // Grant read permissions to StaffUser table for directory lookup
    staffUserTable.grantReadData(this.directoryLookupFn);

    // ** NEW: List Active Requests Lambda Deployment **
    this.listRequestsFn = new lambdaNode.NodejsFunction(this, 'ListRequestsFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'list-requests.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(15), // Increased timeout for group request lookups
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        // USER_POOL_ID removed - using JWT-based authentication now
        FAVORS_TABLE_NAME: props.favorsTableName, // Pass the table name
        TEAMS_TABLE_NAME: props.teamsTableName || '', // Pass the teams table name for group requests
      },
    });
    applyTags(this.listRequestsFn, { Function: 'list-requests' });

    // Grant permission to query the Favors Table via GSIs for sent/received/team lookups
    this.listRequestsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}`,
        // GSIs used by list-requests.ts
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/UserIndex`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/SenderIndex`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/ReceiverIndex`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.favorsTableName}/index/TeamIndex`,
      ],
    }));

    // Grant permission to scan the Teams Table for member lookups (if configured)
    if (props.teamsTableName) {
      this.listRequestsFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:Scan'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.teamsTableName}`,
        ],
      }));
    }



    // If StaffClinicInfo table is provided, grant the register lambda read/write permissions
    if (props.staffClinicInfoTableName) {
      this.registerFnV3.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:Query',
          'dynamodb:BatchWriteItem'
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffClinicInfoTableName}`],
      }));
    }


    // ...existing code...




    // Me API Lambda
    const frontendDomain = this.node.tryGetContext('frontendDomain') ?? process.env.FRONTEND_DOMAIN ?? 'https://todaysdentalinsights.com';

    this.meFn = new lambdaNode.NodejsFunction(this, 'MeFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'me.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        FRONTEND_DOMAIN: String(frontendDomain),
        // USER_POOL_ID removed - using JWT-based authentication now
        CLINIC_HOURS_TABLE: props.clinicHoursTableName,
        STAFF_USER_TABLE: props.staffUserTableName,
        STAFF_CLINIC_INFO_TABLE: props.staffClinicInfoTableName ?? '',
      },
    });
    applyTags(this.meFn, { Function: 'me' });

    // Grant read permissions to StaffUser table for me API
    staffUserTable.grantReadData(this.meFn);

    // Grant read permissions to StaffClinicInfo table if configured
    if (props.staffClinicInfoTableName) {
      const staffClinicInfoTableMe = dynamodb.Table.fromTableName(this, 'StaffClinicInfoTableMe', props.staffClinicInfoTableName);
      staffClinicInfoTableMe.grantReadData(this.meFn);
    }

    // MePresence lambda owned by Admin stack. It will read AGENT_PRESENCE_TABLE_NAME
    // from its environment. infra.ts will set this env var to the proper table name.
    this.mePresenceFn = new lambdaNode.NodejsFunction(this, 'MePresenceFn', {
      entry: path.join(__dirname, '..', '..', 'services', 'admin', 'presence.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
      environment: {
        AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName ?? '',
        JWT_SECRET: props.jwtSecretValue ?? '',
      },
    });
    applyTags(this.mePresenceFn, { Function: 'presence' });

    // Grant read permissions to the AgentPresence table if provided
    if (props.agentPresenceTableName) {
      this.mePresenceFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}`],
      }));
    }

    // (Agent presence endpoint is wired from the Chime stack to avoid cross-stack cycles)

    // ========================================
    // SECRETS TABLES PERMISSIONS
    // ========================================
    // Grant read access to secrets tables for dynamic credential retrieval
    if (props.globalSecretsTableName) {
      const secretsReadPolicy = new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.globalSecretsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicConfigTableName || 'TodaysDentalInsights-ClinicConfig'}`,
        ],
      });

      // Register function needs cPanel credentials for creating email accounts
      this.registerFnV3.addToRolePolicy(secretsReadPolicy);
      this.usersFn.addToRolePolicy(secretsReadPolicy);
    }

    // Grant KMS decryption for secrets encryption key
    if (props.secretsEncryptionKeyArn) {
      const kmsDecryptPolicy = new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [props.secretsEncryptionKeyArn],
      });

      this.registerFnV3.addToRolePolicy(kmsDecryptPolicy);
      this.usersFn.addToRolePolicy(kmsDecryptPolicy);
    }

    // ** NEW: Analytics Query Lambda **
    if (props.analyticsTableName) {
      this.getAnalyticsFn = new lambdaNode.NodejsFunction(this, 'GetAnalyticsFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-call-analytics.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 256,
        timeout: Duration.seconds(30),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
          CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName,
          CALL_QUEUE_TABLE_NAME: props.callQueueTableName || '',
          AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName || '',
          STAFF_USER_TABLE: props.staffUserTableName || '',
          // Optional: allow /analytics/call/{callId} to hydrate transcripts from TranscriptBuffersV2
          TRANSCRIPT_BUFFER_TABLE_NAME: props.transcriptBufferTableName || '',
          // Optional: allow /analytics/call/{callId} to hydrate transcripts & sentiment from RecordingMetadata
          RECORDING_METADATA_TABLE_NAME: props.recordingMetadataTableName || '',
          AWS_REGION_OVERRIDE: Stack.of(this).region,
        },
      });
      applyTags(this.getAnalyticsFn, { Function: 'get-analytics' });

      // Grant read permissions to the analytics table
      this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:BatchGetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}/index/*`,
        ],
      }));

      // Grant read permissions to call queue table for queue endpoint
      if (props.callQueueTableName) {
        this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}/index/*`,
          ],
        }));
      }

      // Grant read permissions to agent presence table for rankings
      if (props.agentPresenceTableName) {
        this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:BatchGetItem'],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}/index/*`,
          ],
        }));
      }

      // Grant read permissions to staff user table for agent names
      if (props.staffUserTableName) {
        this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem'],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.staffUserTableName}`,
          ],
        }));
      }

      // Grant read permission to TranscriptBuffers table (for transcript hydration)
      if (props.transcriptBufferTableName) {
        this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.transcriptBufferTableName}`,
          ],
        }));
      }

      // Grant read permission to RecordingMetadata table (for transcript & sentiment hydration)
      if (props.recordingMetadataTableName) {
        this.getAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}/index/*`,
          ],
        }));
      }
    }

    // ** NEW: Detailed Analytics Lambda **
    if (props.callQueueTableName && props.recordingMetadataTableName) {
      this.getDetailedAnalyticsFn = new lambdaNode.NodejsFunction(this, 'GetDetailedAnalyticsFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-detailed-call-analytics.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: Duration.seconds(30),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
          CALL_QUEUE_TABLE_NAME: props.callQueueTableName,
          RECORDING_METADATA_TABLE_NAME: props.recordingMetadataTableName,
          CHAT_HISTORY_TABLE_NAME: props.chatHistoryTableName || '',
          CLINICS_TABLE_NAME: props.clinicsTableName || '',
          RECORDINGS_BUCKET_NAME: props.recordingsBucketName || '',
          // CRITICAL: Pass CallAnalytics table for LexAI/Voice AI call lookup
          CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName || '',
          // CRITICAL: Pass TranscriptBuffers table for LexAI/Voice AI transcripts
          TRANSCRIPT_BUFFER_TABLE_NAME: props.transcriptBufferTableName || '',
          AWS_REGION_OVERRIDE: Stack.of(this).region,
        },
      });
      applyTags(this.getDetailedAnalyticsFn, { Function: 'get-detailed-analytics' });

      // Grant read permissions to all required tables
      const tableResources: string[] = [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.recordingMetadataTableName}/index/*`,
      ];

      if (props.chatHistoryTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.chatHistoryTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.chatHistoryTableName}/index/*`
        );
      }

      if (props.clinicsTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicsTableName}`
        );
      }

      // CRITICAL: Add CallAnalytics table for LexAI/Voice AI call lookup
      if (props.analyticsTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}/index/*`
        );
      }

      // CRITICAL: Add TranscriptBuffers table for LexAI/Voice AI transcripts
      if (props.transcriptBufferTableName) {
        tableResources.push(
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.transcriptBufferTableName}`
        );
      }

      this.getDetailedAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: tableResources,
      }));

      // Grant S3 read permissions if bucket is provided
      if (props.recordingsBucketName) {
        this.getDetailedAnalyticsFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [`arn:aws:s3:::${props.recordingsBucketName}/*`],
        }));
      }
    }

    // ** NEW: Call Center Dashboard Lambda **
    // Provides unified dashboard metrics for call center operations
    if (props.analyticsTableName && props.callQueueTableName && props.agentPresenceTableName) {
      this.getCallCenterDashboardFn = new lambdaNode.NodejsFunction(this, 'GetCallCenterDashboardFn', {
        entry: path.join(__dirname, '..', '..', 'services', 'chime', 'get-call-center-dashboard.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 256,
        timeout: Duration.seconds(30),
        bundling: { format: lambdaNode.OutputFormat.ESM, target: 'node20' },
        environment: {
          CALL_ANALYTICS_TABLE_NAME: props.analyticsTableName,
          CALL_QUEUE_TABLE_NAME: props.callQueueTableName,
          AGENT_PRESENCE_TABLE_NAME: props.agentPresenceTableName,
          AGENT_ACTIVE_TABLE_NAME: props.agentActiveTableName || '',
          AWS_REGION_OVERRIDE: Stack.of(this).region,
        },
      });
      applyTags(this.getCallCenterDashboardFn, { Function: 'get-call-center-dashboard' });

      // Grant read permissions to all required tables
      this.getCallCenterDashboardFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
        resources: [
          // Call Analytics table
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.analyticsTableName}/index/*`,
          // Call Queue table
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.callQueueTableName}/index/*`,
          // Agent Presence table
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentPresenceTableName}/index/*`,
          // Agent Active table
          ...(props.agentActiveTableName ? [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentActiveTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.agentActiveTableName}/index/*`,
          ] : []),
        ],
      }));
    }

    // Note: User roles are now stored in DynamoDB StaffUser table, not Cognito groups

    // Grant read access to tables for me API
    this.meFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.clinicHoursTableName}`,
      ],
    }));

    // ========================================
    // CloudWatch Alarms (Lambda + DynamoDB)
    // ========================================
    const lambdaAlarmTargets: Array<{ fn: lambda.IFunction; name: string; durationMs: number }> = [
      { fn: this.registerFnV3, name: 'register', durationMs: Duration.seconds(24).toMilliseconds() },
      { fn: this.usersFn, name: 'users', durationMs: Duration.seconds(24).toMilliseconds() },
      { fn: this.directoryLookupFn, name: 'directory-lookup', durationMs: Duration.seconds(8).toMilliseconds() },
      { fn: this.listRequestsFn, name: 'list-requests', durationMs: Duration.seconds(12).toMilliseconds() },
      { fn: this.meFn, name: 'me', durationMs: Duration.seconds(8).toMilliseconds() },
    ];

    if (this.mePresenceFn) lambdaAlarmTargets.push({ fn: this.mePresenceFn, name: 'presence', durationMs: Duration.seconds(8).toMilliseconds() });
    if (this.getAnalyticsFn) lambdaAlarmTargets.push({ fn: this.getAnalyticsFn, name: 'get-analytics', durationMs: Duration.seconds(24).toMilliseconds() });
    if (this.getDetailedAnalyticsFn) lambdaAlarmTargets.push({ fn: this.getDetailedAnalyticsFn, name: 'get-detailed-analytics', durationMs: Duration.seconds(24).toMilliseconds() });
    if (this.getCallCenterDashboardFn) lambdaAlarmTargets.push({ fn: this.getCallCenterDashboardFn, name: 'get-call-center-dashboard', durationMs: Duration.seconds(24).toMilliseconds() });

    lambdaAlarmTargets.forEach(({ fn, name, durationMs }) => {
      createLambdaErrorAlarm(fn, name);
      createLambdaThrottleAlarm(fn, name);
      createLambdaDurationAlarm(fn, name, durationMs);
    });

    // DynamoDB throttle alarms for imported tables
    createDynamoThrottleAlarm(props.staffUserTableName, 'StaffUserTable');
    if (props.staffClinicInfoTableName) createDynamoThrottleAlarm(props.staffClinicInfoTableName, 'StaffClinicInfoTable');
    createDynamoThrottleAlarm(props.favorsTableName, 'FavorsTable');
    if (props.teamsTableName) createDynamoThrottleAlarm(props.teamsTableName, 'TeamsTable');
    createDynamoThrottleAlarm(props.clinicHoursTableName, 'ClinicHoursTable');
    if (props.analyticsTableName) createDynamoThrottleAlarm(props.analyticsTableName, 'AnalyticsTable');
    if (props.callQueueTableName) createDynamoThrottleAlarm(props.callQueueTableName, 'CallQueueTable');
    if (props.recordingMetadataTableName) createDynamoThrottleAlarm(props.recordingMetadataTableName, 'RecordingMetadataTable');
    if (props.chatHistoryTableName) createDynamoThrottleAlarm(props.chatHistoryTableName, 'ChatHistoryTable');
    if (props.clinicsTableName) createDynamoThrottleAlarm(props.clinicsTableName, 'ClinicsTable');

    // ========================================
    // DOMAIN MAPPING
    // ========================================

    // Map to custom domain with service-specific base path
    new apigw.CfnBasePathMapping(this, 'AdminApiBasePathMapping', {
      domainName: props.apiDomainName ?? 'api.todaysdentalservices.com',
      basePath: 'admin',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    // ========================================
    // API ROUTES
    // ========================================

    // Map to custom domain with clinic-cost base path
    new apigw.CfnBasePathMapping(this, 'ClinicCostBasePathMapping', {
      domainName: props.apiDomainName ?? 'api.todaysdentalservices.com',
      basePath: 'clinic-cost',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    const clinicCostsRes = this.api.root.addResource('clinic-costs');
    const proxyIntegration = new apigw.LambdaIntegration(clinicCostCrudFn);

    clinicCostsRes.addMethod('GET', proxyIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    const clinicCostNameRes = clinicCostsRes.addResource('{clinicName}');
    clinicCostNameRes.addMethod('GET', proxyIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    clinicCostNameRes.addMethod('PUT', proxyIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // Map to custom domain with clinic-budget base path
    new apigw.CfnBasePathMapping(this, 'ClinicBudgetBasePathMapping', {
      domainName: props.apiDomainName ?? 'api.todaysdentalservices.com',
      basePath: 'clinic-budget',
      restApiId: this.api.restApiId,
      stage: this.api.deploymentStage.stageName,
    });

    const clinicBudgetsRes = this.api.root.addResource('clinic-budgets');
    const budgetIntegration = new apigw.LambdaIntegration(clinicBudgetCrudFn);

    clinicBudgetsRes.addMethod('GET', budgetIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    const clinicBudgetNameRes = clinicBudgetsRes.addResource('{clinicName}');
    clinicBudgetNameRes.addMethod('GET', budgetIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    clinicBudgetNameRes.addMethod('PUT', budgetIntegration, {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // User management routes
    const registerRes = this.api.root.addResource('register');
    registerRes.addMethod('POST', new apigw.LambdaIntegration(this.registerFnV3), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // Users management routes
    const usersRes = this.api.root.addResource('users');
    const usernameRes = usersRes.addResource('{username}');
    usernameRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usernameRes.addMethod('PUT', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usernameRes.addMethod('DELETE', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });
    usersRes.addMethod('GET', new apigw.LambdaIntegration(this.usersFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
    });

    // *** Directory Lookup Route for any authenticated user ***
    const directoryRes = this.api.root.addResource('directory');
    directoryRes.addMethod('GET', new apigw.LambdaIntegration(this.directoryLookupFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // ** NEW: List Requests Route (For the "Mini-Slack" sidebar) **
    const requestsRes = this.api.root.addResource('requests');
    requestsRes.addMethod('GET', new apigw.LambdaIntegration(this.listRequestsFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // Me API routes
    const meRes = this.api.root.addResource('me');
    const meClinicsRes = meRes.addResource('clinics');
    meClinicsRes.addMethod('GET', new apigw.LambdaIntegration(this.meFn), {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.CUSTOM,
      methodResponses: [{ statusCode: '200' }],
    });

    // GET /me/presence - returns AgentPresenceTable item for the authenticated agent
    if (this.mePresenceFn) {
      const mePresenceRes = meRes.addResource('presence');
      mePresenceRes.addMethod('GET', new apigw.LambdaIntegration(this.mePresenceFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
    }

    // ** NEW: Analytics Routes **
    if (this.getAnalyticsFn) {
      const analyticsRes = this.api.root.addResource('analytics');

      // GET /analytics/call/{callId}
      const callRes = analyticsRes.addResource('call');
      const callIdRes = callRes.addResource('{callId}');
      callIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/clinic/{clinicId}
      const clinicRes = analyticsRes.addResource('clinic');
      const clinicIdRes = clinicRes.addResource('{clinicId}');
      clinicIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/agent/{agentId}
      const agentRes = analyticsRes.addResource('agent');
      const agentIdRes = agentRes.addResource('{agentId}');
      agentIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/summary
      const summaryRes = analyticsRes.addResource('summary');
      summaryRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/rankings?clinicId={clinicId} - Agent rankings/leaderboard
      const rankingsRes = analyticsRes.addResource('rankings');
      rankingsRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/queue?clinicId={clinicId} - Get all calls in queue
      const queueRes = analyticsRes.addResource('queue');
      queueRes.addMethod('GET', new apigw.LambdaIntegration(this.getAnalyticsFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });

      // GET /analytics/detailed/{callId} - Comprehensive analytics with history, insights, and transcript
      if (this.getDetailedAnalyticsFn) {
        const detailedRes = analyticsRes.addResource('detailed');
        const detailedCallIdRes = detailedRes.addResource('{callId}');
        detailedCallIdRes.addMethod('GET', new apigw.LambdaIntegration(this.getDetailedAnalyticsFn), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
          methodResponses: [{ statusCode: '200' }],
        });
      }

      // GET /analytics/dashboard?clinicId={clinicId} - Unified call center dashboard metrics
      if (this.getCallCenterDashboardFn) {
        const dashboardRes = analyticsRes.addResource('dashboard');
        dashboardRes.addMethod('GET', new apigw.LambdaIntegration(this.getCallCenterDashboardFn), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
          methodResponses: [{ statusCode: '200' }],
        });
      }
    }

    // If Chime lambdas are provided by ARN (exported from Chime stack), import
    // them here and wire API Gateway routes to the imported functions. This
    // avoids passing the Admin API object into the Chime stack which would
    // create a circular dependency.
    if (props.outboundCallFnArn || props.transferCallFnArn ||
      props.agentActiveFnArn || props.agentInactiveFnArn ||
      props.callAcceptedFnArn || props.callAcceptedV2FnArn || props.callRejectedV2FnArn || props.callHungupV2FnArn ||
      props.callRejectedFnArn || props.callHungupFnArn || props.leaveCallFnArn ||
      props.holdCallFnArn || props.resumeCallFnArn ||
      props.addCallFnArn || props.sendDtmfFnArn || props.callNotesFnArn || props.conferenceCallFnArn) {
      const chimeApiRoot = this.api.root.getResource('chime') ?? this.api.root.addResource('chime');

      // Agent Active / Inactive (push-first availability toggle)
      if (props.agentActiveFnArn || props.agentInactiveFnArn) {
        const agentRes = chimeApiRoot.addResource('agent');

        if (props.agentActiveFnArn) {
          const importedAgentActive = lambda.Function.fromFunctionArn(this, 'ImportedAgentActiveFn', props.agentActiveFnArn);
          importedAgentActive.addPermission('ApiGatewayInvokeAgentActive', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: this.api.arnForExecuteApi('*', '/chime/agent/active', '*')
          });

          const agentActiveRes = agentRes.addResource('active');
          agentActiveRes.addMethod('POST', new apigw.LambdaIntegration(importedAgentActive, { proxy: true }), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
          });
        }

        if (props.agentInactiveFnArn) {
          const importedAgentInactive = lambda.Function.fromFunctionArn(this, 'ImportedAgentInactiveFn', props.agentInactiveFnArn);
          importedAgentInactive.addPermission('ApiGatewayInvokeAgentInactive', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: this.api.arnForExecuteApi('*', '/chime/agent/inactive', '*')
          });

          const agentInactiveRes = agentRes.addResource('inactive');
          agentInactiveRes.addMethod('POST', new apigw.LambdaIntegration(importedAgentInactive, { proxy: true }), {
            authorizer: this.authorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
          });
        }
      }

      if (props.outboundCallFnArn) {
        const importedOutbound = lambda.Function.fromFunctionArn(this, 'ImportedOutboundCallFn', props.outboundCallFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedOutbound.addPermission('ApiGatewayInvokeOutboundCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/outbound-call', '*')
        });

        const outboundCallRes = chimeApiRoot.addResource('outbound-call');
        outboundCallRes.addMethod('POST', new apigw.LambdaIntegration(importedOutbound, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.transferCallFnArn) {
        const importedTransfer = lambda.Function.fromFunctionArn(this, 'ImportedTransferCallFn', props.transferCallFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedTransfer.addPermission('ApiGatewayInvokeTransferCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/transfer-call', '*')
        });

        const transferCallRes = chimeApiRoot.addResource('transfer-call');
        transferCallRes.addMethod('POST', new apigw.LambdaIntegration(importedTransfer, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callAcceptedFnArn) {
        const importedCallAccepted = lambda.Function.fromFunctionArn(this, 'ImportedCallAcceptedFn', props.callAcceptedFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallAccepted.addPermission('ApiGatewayInvokeCallAccepted', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-accepted', '*')
        });

        const callAcceptedRes = chimeApiRoot.addResource('call-accepted');
        callAcceptedRes.addMethod('POST', new apigw.LambdaIntegration(importedCallAccepted, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callAcceptedV2FnArn) {
        const importedCallAcceptedV2 = lambda.Function.fromFunctionArn(this, 'ImportedCallAcceptedV2Fn', props.callAcceptedV2FnArn);

        importedCallAcceptedV2.addPermission('ApiGatewayInvokeCallAcceptedV2', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-accepted-v2', '*')
        });

        const callAcceptedV2Res = chimeApiRoot.addResource('call-accepted-v2');
        callAcceptedV2Res.addMethod('POST', new apigw.LambdaIntegration(importedCallAcceptedV2, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callRejectedV2FnArn) {
        const importedCallRejectedV2 = lambda.Function.fromFunctionArn(this, 'ImportedCallRejectedV2Fn', props.callRejectedV2FnArn);

        importedCallRejectedV2.addPermission('ApiGatewayInvokeCallRejectedV2', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-rejected-v2', '*')
        });

        const callRejectedV2Res = chimeApiRoot.addResource('call-rejected-v2');
        callRejectedV2Res.addMethod('POST', new apigw.LambdaIntegration(importedCallRejectedV2, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callHungupV2FnArn) {
        const importedCallHungupV2 = lambda.Function.fromFunctionArn(this, 'ImportedCallHungupV2Fn', props.callHungupV2FnArn);

        importedCallHungupV2.addPermission('ApiGatewayInvokeCallHungupV2', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-hungup-v2', '*')
        });

        const callHungupV2Res = chimeApiRoot.addResource('call-hungup-v2');
        callHungupV2Res.addMethod('POST', new apigw.LambdaIntegration(importedCallHungupV2, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callRejectedFnArn) {
        const importedCallRejected = lambda.Function.fromFunctionArn(this, 'ImportedCallRejectedFn', props.callRejectedFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallRejected.addPermission('ApiGatewayInvokeCallRejected', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-rejected', '*')
        });

        const callRejectedRes = chimeApiRoot.addResource('call-rejected');
        callRejectedRes.addMethod('POST', new apigw.LambdaIntegration(importedCallRejected, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.callHungupFnArn) {
        const importedCallHungup = lambda.Function.fromFunctionArn(this, 'ImportedCallHungupFn', props.callHungupFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedCallHungup.addPermission('ApiGatewayInvokeCallHungup', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-hungup', '*')
        });

        const callHungupRes = chimeApiRoot.addResource('call-hungup');
        callHungupRes.addMethod('POST', new apigw.LambdaIntegration(importedCallHungup, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.leaveCallFnArn) {
        const importedLeaveCall = lambda.Function.fromFunctionArn(this, 'ImportedLeaveCallFn', props.leaveCallFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedLeaveCall.addPermission('ApiGatewayInvokeLeaveCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/leave-call', '*')
        });

        const leaveCallRes = chimeApiRoot.addResource('leave-call');
        leaveCallRes.addMethod('POST', new apigw.LambdaIntegration(importedLeaveCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.holdCallFnArn) {
        const importedHoldCall = lambda.Function.fromFunctionArn(this, 'ImportedHoldCallFn', props.holdCallFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedHoldCall.addPermission('ApiGatewayInvokeHoldCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/hold-call', '*')
        });

        const holdCallRes = chimeApiRoot.addResource('hold-call');
        holdCallRes.addMethod('POST', new apigw.LambdaIntegration(importedHoldCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      if (props.resumeCallFnArn) {
        const importedResumeCall = lambda.Function.fromFunctionArn(this, 'ImportedResumeCallFn', props.resumeCallFnArn);

        // Add API Gateway permission - use wildcard to account for base path mapping
        importedResumeCall.addPermission('ApiGatewayInvokeResumeCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/resume-call', '*')
        });

        const resumeCallRes = chimeApiRoot.addResource('resume-call');
        resumeCallRes.addMethod('POST', new apigw.LambdaIntegration(importedResumeCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // Add Call route (POST /chime/add-call)
      if (props.addCallFnArn) {
        const importedAddCall = lambda.Function.fromFunctionArn(
          this,
          'ImportedAddCallFn',
          props.addCallFnArn
        );

        importedAddCall.addPermission('ApiGatewayInvokeAddCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/add-call', '*')
        });

        const addCallRes = chimeApiRoot.addResource('add-call');
        addCallRes.addMethod('POST', new apigw.LambdaIntegration(importedAddCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // Send DTMF route (POST /chime/send-dtmf)
      if (props.sendDtmfFnArn) {
        const importedSendDtmf = lambda.Function.fromFunctionArn(
          this,
          'ImportedSendDtmfFn',
          props.sendDtmfFnArn
        );

        importedSendDtmf.addPermission('ApiGatewayInvokeSendDtmf', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/send-dtmf', '*')
        });

        const sendDtmfRes = chimeApiRoot.addResource('send-dtmf');
        sendDtmfRes.addMethod('POST', new apigw.LambdaIntegration(importedSendDtmf, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // Call Notes routes (GET, POST, PUT, DELETE /chime/call-notes)
      if (props.callNotesFnArn) {
        const importedCallNotes = lambda.Function.fromFunctionArn(
          this,
          'ImportedCallNotesFn',
          props.callNotesFnArn
        );

        importedCallNotes.addPermission('ApiGatewayInvokeCallNotes', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-notes', '*')
        });
        importedCallNotes.addPermission('ApiGatewayInvokeCallNotesWithId', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/call-notes/*', '*')
        });

        const callNotesRes = chimeApiRoot.addResource('call-notes');
        // GET all notes for current call
        callNotesRes.addMethod('GET', new apigw.LambdaIntegration(importedCallNotes, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
        // POST create new note
        callNotesRes.addMethod('POST', new apigw.LambdaIntegration(importedCallNotes, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
        // PUT update note
        callNotesRes.addMethod('PUT', new apigw.LambdaIntegration(importedCallNotes, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
        // DELETE note
        callNotesRes.addMethod('DELETE', new apigw.LambdaIntegration(importedCallNotes, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        // Notes with call ID path parameter
        const callNotesWithIdRes = callNotesRes.addResource('{callId}');
        callNotesWithIdRes.addMethod('GET', new apigw.LambdaIntegration(importedCallNotes, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // Conference Call route (POST /chime/conference-call)
      if (props.conferenceCallFnArn) {
        const importedConferenceCall = lambda.Function.fromFunctionArn(
          this,
          'ImportedConferenceCallFn',
          props.conferenceCallFnArn
        );

        importedConferenceCall.addPermission('ApiGatewayInvokeConferenceCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/chime/conference-call', '*')
        });

        const conferenceCallRes = chimeApiRoot.addResource('conference-call');
        conferenceCallRes.addMethod('POST', new apigw.LambdaIntegration(importedConferenceCall, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }
    }

    // ========================================
    // CALL CENTER JOIN OPERATIONS (Queue & Active Calls)
    // ========================================
    if (props.joinQueuedCallFnArn || props.joinActiveCallFnArn || props.getJoinableCallsFnArn) {
      const callCenterRoot = this.api.root.getResource('call-center') ?? this.api.root.addResource('call-center');

      // POST /call-center/join-queued-call - Manual call pickup from queue
      if (props.joinQueuedCallFnArn) {
        const importedJoinQueued = lambda.Function.fromFunctionArn(
          this,
          'ImportedJoinQueuedCallFn',
          props.joinQueuedCallFnArn
        );

        importedJoinQueued.addPermission('ApiGatewayInvokeJoinQueuedCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/call-center/join-queued-call', '*')
        });

        const joinQueuedRes = callCenterRoot.addResource('join-queued-call');
        joinQueuedRes.addMethod('POST', new apigw.LambdaIntegration(importedJoinQueued, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // POST /call-center/join-active-call - Supervisor monitoring/barge-in
      if (props.joinActiveCallFnArn) {
        const importedJoinActive = lambda.Function.fromFunctionArn(
          this,
          'ImportedJoinActiveCallFn',
          props.joinActiveCallFnArn
        );

        importedJoinActive.addPermission('ApiGatewayInvokeJoinActiveCall', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/call-center/join-active-call', '*')
        });

        const joinActiveRes = callCenterRoot.addResource('join-active-call');
        joinActiveRes.addMethod('POST', new apigw.LambdaIntegration(importedJoinActive, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }

      // GET /call-center/get-joinable-calls - List queued & active calls
      if (props.getJoinableCallsFnArn) {
        const importedGetJoinable = lambda.Function.fromFunctionArn(
          this,
          'ImportedGetJoinableCallsFn',
          props.getJoinableCallsFnArn
        );

        importedGetJoinable.addPermission('ApiGatewayInvokeGetJoinableCalls', {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          sourceArn: this.api.arnForExecuteApi('*', '/call-center/get-joinable-calls', '*')
        });

        const getJoinableRes = callCenterRoot.addResource('get-joinable-calls');
        getJoinableRes.addMethod('GET', new apigw.LambdaIntegration(importedGetJoinable, { proxy: true }), {
          authorizer: this.authorizer,
          authorizationType: apigw.AuthorizationType.CUSTOM,
        });
      }
    }

    // ========================================
    // ONLINE AGENTS API ROUTE
    // ========================================

    if (props.getOnlineAgentsFnArn) {
      const importedGetOnlineAgents = lambda.Function.fromFunctionArn(
        this,
        'ImportedGetOnlineAgentsFn',
        props.getOnlineAgentsFnArn
      );

      importedGetOnlineAgents.addPermission('ApiGatewayInvokeGetOnlineAgents', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: this.api.arnForExecuteApi('*', '/agents/online', '*'),
      });

      // GET /agents/online?clinicId=xxx
      const agentsRes = this.api.root.getResource('agents') ?? this.api.root.addResource('agents');
      const onlineRes = agentsRes.addResource('online');
      onlineRes.addMethod('GET', new apigw.LambdaIntegration(importedGetOnlineAgents, { proxy: true }), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }],
      });
    }

    // ========================================
    // RECORDING API ROUTES (if enabled in Chime stack)
    // ========================================

    if (props.getRecordingFnArn) {
      const getRecordingFn = lambda.Function.fromFunctionArn(
        this,
        'ImportedGetRecordingFn',
        props.getRecordingFnArn
      );

      // Add API Gateway permission
      getRecordingFn.addPermission('ApiGatewayInvokeGetRecording', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: this.api.arnForExecuteApi('*', '/recordings/*', '*')
      });

      const recordingsRes = this.api.root.addResource('recordings');

      // GET /recordings/{recordingId}
      const recordingIdRes = recordingsRes.addResource('{recordingId}');
      recordingIdRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      // GET /recordings/call/{callId}
      const callRecordingsRes = recordingsRes.addResource('call');
      const callIdRecordingRes = callRecordingsRes.addResource('{callId}');
      callIdRecordingRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      // GET /recordings/clinic/{clinicId}
      const clinicRecordingsRes = recordingsRes.addResource('clinic');
      const clinicIdRecordingRes = clinicRecordingsRes.addResource('{clinicId}');
      clinicIdRecordingRes.addMethod('GET', new apigw.LambdaIntegration(getRecordingFn), {
        authorizer: this.authorizer,
        authorizationType: apigw.AuthorizationType.CUSTOM,
        methodResponses: [{ statusCode: '200' }]
      });

      new CfnOutput(this, 'RecordingsApiUrl', {
        value: 'https://api.todaysdentalservices.com/admin/recordings',
        description: 'Recordings API URL',
        exportName: `${Stack.of(this).stackName}-RecordingsApiUrl`
      });
    }

    // ========================================
    // OUTPUTS
    // ========================================

    new CfnOutput(this, 'AdminApiUrl', {
      value: 'https://api.todaysdentalservices.com/admin/',
      description: 'Admin API Gateway URL',
      exportName: `${Stack.of(this).stackName}-AdminApiUrl`,
    });

    new CfnOutput(this, 'AdminApiId', {
      value: this.api.restApiId,
      description: 'Admin API Gateway ID',
      exportName: `${Stack.of(this).stackName}-AdminApiId`,
    });

    new CfnOutput(this, 'DirectoryApiUrl', {
      value: 'https://api.todaysdentalservices.com/admin/directory',
      description: 'User Directory Lookup API URL',
      exportName: `${Stack.of(this).stackName}-DirectoryApiUrl`,
    });

    new CfnOutput(this, 'RequestsApiUrl', {
      value: 'https://api.todaysdentalservices.com/admin/requests',
      description: 'Active Favor Requests List API URL',
      exportName: `${Stack.of(this).stackName}-RequestsApiUrl`,
    });
  }
}
