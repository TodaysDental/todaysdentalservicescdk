import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

interface ClinicRoutingCustomResourceProps {
    connectInstanceId: string;
    configTableName: string;
    hoursOfOperationId: string;
    outboundNumberId?: string;
    outboundFlowId?: string;
    chatbotQuickConnectId?: string;
}

export class ClinicRoutingCustomResource extends Construct {
    constructor(scope: Construct, id: string, props: ClinicRoutingCustomResourceProps) {
        super(scope, id);

        // Create Lambda function for the custom resource using NodejsFunction with CommonJS
        const onEventHandler = new lambdaNode.NodejsFunction(this, 'ClinicRoutingHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, 'custom-resource', 'index.ts'),
            handler: 'handler',
            timeout: Duration.minutes(5),
            memorySize: 256,
            bundling: {
                target: 'node18',
                minify: false,
                sourceMap: true,
                externalModules: ['@aws-sdk/*'],
                nodeModules: [
                    '@aws-sdk/client-connect',
                    '@aws-sdk/client-dynamodb',
                    '@aws-sdk/lib-dynamodb',
                ],
            },
            environment: {
                CONNECT_INSTANCE_ID: props.connectInstanceId,
                CONNECT_CONFIG_TABLE: props.configTableName,
                CONNECT_HOURS_OF_OPERATION_ID: props.hoursOfOperationId,
                CONNECT_OUTBOUND_NUMBER_ID: props.outboundNumberId || '',
                CONNECT_OUTBOUND_FLOW_ID: props.outboundFlowId || '',
                CONNECT_CHATBOT_QUICK_CONNECT_ID: props.chatbotQuickConnectId || ''
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
            description: 'Custom Resource handler for setting up Connect clinic routing'
        });

        // Add required permissions
        onEventHandler.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'connect:CreateQueue',
                'connect:ListQueues',
                'connect:DeleteQueue',
                'connect:GetQueue',
                'connect:CreateRoutingProfile',
                'connect:ListRoutingProfiles',
                'connect:CreateQuickConnect',
                'connect:ListQuickConnects',
                'connect:ListSecurityProfiles',
                'connect:AssociateRoutingProfileQueues',
                'connect:DisassociateRoutingProfileQueues',
                'connect:UpdateRoutingProfileQueues',
                'connect:ListRoutingProfileQueues'
            ],
            resources: [
                `arn:aws:connect:*:*:instance/${props.connectInstanceId}/*`,
                `arn:aws:connect:*:*:instance/${props.connectInstanceId}`
            ]
        }));

        // Add DynamoDB permissions
        onEventHandler.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query'
            ],
            resources: [`arn:aws:dynamodb:*:*:table/${props.configTableName}`]
        }));

        // Create the custom resource provider
        const provider = new cr.Provider(this, 'Provider', {
            onEventHandler,
            logRetention: logs.RetentionDays.ONE_WEEK
        });

        // Create the custom resource
        new CustomResource(this, 'Resource', {
            serviceToken: provider.serviceToken,
            properties: {
                // Add a timestamp to force update on each deployment
                timestamp: new Date().toISOString()
            }
        });
    }
}