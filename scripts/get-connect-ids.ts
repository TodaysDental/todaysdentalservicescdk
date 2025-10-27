import { ConnectClient, ListSecurityProfilesCommand, ListRoutingProfilesCommand } from '@aws-sdk/client-connect';

const CONNECT_INSTANCE_ID = 'e265b644-3dad-4490-b7c4-27036090c5f1';

async function getConnectProfiles() {
    const connect = new ConnectClient({ region: 'us-east-1' });

    try {
        // Get Security Profiles
        const securityProfiles = await connect.send(new ListSecurityProfilesCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            MaxResults: 100
        }));

        console.log('\nSecurity Profiles:');
        console.log('------------------');
        securityProfiles.SecurityProfileSummaryList?.forEach(profile => {
            console.log(`Name: ${profile.Name}`);
            console.log(`ID: ${profile.Id}`);
            console.log('------------------');
        });

        // Get Routing Profiles
        const routingProfiles = await connect.send(new ListRoutingProfilesCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            MaxResults: 100
        }));

        console.log('\nRouting Profiles:');
        console.log('------------------');
        routingProfiles.RoutingProfileSummaryList?.forEach(profile => {
            console.log(`Name: ${profile.Name}`);
            console.log(`ID: ${profile.Id}`);
            console.log('------------------');
        });

    } catch (error: any) {
        console.error('Error fetching profiles:', error.message);
    }
}

getConnectProfiles();