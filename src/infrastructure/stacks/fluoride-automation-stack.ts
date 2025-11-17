import { Stack, StackProps, Duration, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';

export interface FluorideAutomationStackProps extends StackProps {
  userPool: any;
}

export class FluorideAutomationStack extends Stack {
  constructor(scope: Construct, id: string, props: FluorideAutomationStackProps) {
    super(scope, id, props);

    // Import the consolidated transfer server details from OpenDental stack
    const consolidatedTransferServerEndpoint = Fn.importValue('TodaysDentalInsightsOpenDentalV2-ConsolidatedTransferServerEndpoint');
    
    // Lambda for fluoride automation
    const fluorideAutomationFn = new lambdaNode.NodejsFunction(this, 'FluorideAutomationFn', {
      functionName: `${this.stackName}-FluorideAutomation`,
      entry: path.join(__dirname, '..', '..', 'services', 'opendental', 'fluoride-automation.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15), // Allow up to 15 minutes to process all clinics
      memorySize: 2048, // Allocate more memory for multiple HTTP requests
      environment: {
        // Add information about the SFTP server for debugging purposes
        CONSOLIDATED_SFTP_HOST: consolidatedTransferServerEndpoint,
        CONSOLIDATED_SFTP_USERNAME: 'sftpuser', // Fixed username for Open Dental queries
        CONSOLIDATED_SFTP_PASSWORD: 'Clinic2020',
      },
      bundling: {
        externalModules: [], // Include all dependencies in the bundle
        // Copy the clinics.json file to the bundle
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // Copy clinics.json file to the Lambda bundle
            const clinicsJsonSource = path.join(inputDir, 'src', 'infrastructure', 'configs', 'clinics.json');
            const clinicsJsonDest = path.join(outputDir, 'clinics.json');
            
            // Use 'copy' on Windows, 'cp' on other platforms
            const isWindows = process.platform === 'win32';
            const copyCommand = isWindows ? 
              `copy "${clinicsJsonSource.replace(/\//g, '\\')}" "${clinicsJsonDest.replace(/\//g, '\\')}"` : 
              `cp ${clinicsJsonSource} ${clinicsJsonDest}`;
            
            return [copyCommand];
          },
        },
      },
    });

    // Add permissions to access the S3 bucket used for OpenDental SFTP
    // This allows the function to verify files if needed
    fluorideAutomationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket'
      ],
      resources: [
        'arn:aws:s3:::todaysdentalinsights-consolidated-sftp-v2',
        'arn:aws:s3:::todaysdentalinsights-consolidated-sftp-v2/sftp-home/*'
      ]
    }));

    // Add CloudWatch Logs permissions
    fluorideAutomationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: ['*']
    }));

    // Create CloudWatch Event Rule to trigger Lambda every hour
    const rule = new events.Rule(this, 'HourlyFluorideAutomationRule', {
      schedule: events.Schedule.rate(Duration.hours(12)),
      description: 'Trigger fluoride automation to add missing D1206 procedures and create claims',
    });
    
    // Add Lambda as target for the CloudWatch Event Rule
    rule.addTarget(new targets.LambdaFunction(fluorideAutomationFn));
  }
}
