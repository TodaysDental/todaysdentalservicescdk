/**
 * Setup script for Chime SDK Voice resources
 * 
 * Since Chime SDK Voice resources are not available as CloudFormation resources,
 * this script creates them programmatically using the AWS SDK.
 * 
 * Run this after deploying the CDK stack to create the necessary Chime resources.
 */

import { ChimeSDKVoiceClient, CreateSipMediaApplicationCommand, CreateVoiceConnectorCommand, CreateSipRuleCommand, PutVoiceConnectorTerminationCommand } from '@aws-sdk/client-chime-sdk-voice';
import { CloudFormationClient, UpdateStackCommand } from '@aws-sdk/client-cloudformation';
import clinicsData from '../clinic-config/clinics.json';

interface Clinic {
  clinicId: string;
  phoneNumber: string;
  clinicName: string; // Actual property name in clinics.json
}

const STACK_NAME = 'TodaysDentalInsightsBackendV2';
const REGION = 'us-east-1';

const chimeClient = new ChimeSDKVoiceClient({ region: REGION });
const cfnClient = new CloudFormationClient({ region: REGION });

async function setupChimeResources() {
  console.log('🚀 Setting up Chime SDK Voice resources...');

  try {
    // 1. Create SIP Media Application
    console.log('📱 Creating SIP Media Application...');
    const smaResult = await chimeClient.send(new CreateSipMediaApplicationCommand({
      Name: `${STACK_NAME}-SMA`,
      AwsRegion: REGION,
      Endpoints: [
        {
          LambdaArn: process.env['CHIME_SMA_HANDLER_ARN'] || 'REPLACE_WITH_LAMBDA_ARN_FROM_CDK_OUTPUT',
        },
      ],
    }));
    console.log('✅ SIP Media Application created:', smaResult.SipMediaApplication?.SipMediaApplicationId);

    // 2. Create Voice Connector
    console.log('🔗 Creating Voice Connector...');
    const vcResult = await chimeClient.send(new CreateVoiceConnectorCommand({
      Name: `${STACK_NAME}-VC`,
      AwsRegion: REGION,
      RequireEncryption: true,
    }));
    console.log('✅ Voice Connector created:', vcResult.VoiceConnector?.VoiceConnectorId);

    // 3. Configure Voice Connector Termination
    console.log('🔧 Configuring Voice Connector Termination...');
    await chimeClient.send(new PutVoiceConnectorTerminationCommand({
      VoiceConnectorId: vcResult.VoiceConnector!.VoiceConnectorId,
      Termination: {
        CidrAllowedList: ['0.0.0.0/27'], // More restrictive CIDR range as required by Chime SDK
        CallingRegions: ['US'],
        Disabled: false,
      },
    }));
    console.log('✅ Voice Connector Termination configured');

    // 4. Create SIP Rules for each clinic
    console.log('📞 Creating SIP Rules for clinics...');
    for (const clinic of clinicsData as Clinic[]) {
      const sipRuleResult = await chimeClient.send(new CreateSipRuleCommand({
        Name: `${STACK_NAME}-SIP-Rule-${clinic.clinicId}`,
        TriggerType: 'ToPhoneNumber',
        TriggerValue: clinic.phoneNumber,
        Disabled: false,
        TargetApplications: [
          {
            AwsRegion: REGION,
            Priority: 1,
            SipMediaApplicationId: smaResult.SipMediaApplication!.SipMediaApplicationId,
          },
        ],
      }));
      console.log(`✅ SIP Rule created for clinic ${clinic.clinicId} (${clinic.clinicName}):`, sipRuleResult.SipRule?.SipRuleId);
    }

    // 5. Output the resource IDs for manual environment variable updates
    console.log('\n🎉 Chime SDK Voice resources created successfully!');
    console.log('\n📋 Please update the following environment variables in your Lambda functions:');
    console.log(`SIP_MEDIA_APPLICATION_ID=${smaResult.SipMediaApplication?.SipMediaApplicationId}`);
    console.log(`CHIME_VOICE_CONNECTOR_ID=${vcResult.VoiceConnector?.VoiceConnectorId}`);
    
    console.log('\n💡 You can update these in the AWS Lambda console or re-deploy the CDK stack with these values.');

  } catch (error) {
    console.error('❌ Error setting up Chime resources:', error);
    throw error;
  }
}

// Run the setup if this file is executed directly
if (typeof require !== 'undefined' && require.main === module) {
  setupChimeResources().catch(console.error);
}

export { setupChimeResources };
