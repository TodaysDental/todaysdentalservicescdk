import { CognitoIdentityProviderClient, CreateGroupCommand, ListGroupsCommand } from "@aws-sdk/client-cognito-identity-provider";
import { clinics } from '../src/infrastructure/configs/clinics';

const cognitoClient = new CognitoIdentityProviderClient({});

// Define the 5 dental roles
const DENTAL_ROLES = [
  { key: 'DOCTOR', displayName: 'Doctor' },
  { key: 'HYGIENIST', displayName: 'Hygienist' },
  { key: 'DENTAL_ASSISTANT', displayName: 'Dental Assistant' },
  { key: 'TREATMENT_COORDINATOR', displayName: 'Treatment Coordinator' },
  { key: 'PATIENT_COORDINATOR', displayName: 'Patient Coordinator' }
];

// Voice system also needs USER groups for clinic access
const VOICE_USER_GROUP = { key: 'USER', displayName: 'Voice Agent' };

export async function createCognitoGroupsForAllClinics(userPoolId: string) {
  console.log(`Creating Cognito groups for ${clinics.length} clinics...`);
  
  // First, list existing groups to avoid duplicates
  const existingGroups = new Set<string>();
  try {
    const listResponse = await cognitoClient.send(new ListGroupsCommand({
      UserPoolId: userPoolId,
      Limit: 60 // Max allowed by AWS
    }));
    
    listResponse.Groups?.forEach(group => {
      if (group.GroupName) {
        existingGroups.add(group.GroupName);
      }
    });
    
    console.log(`Found ${existingGroups.size} existing groups`);
  } catch (error) {
    console.warn('Could not list existing groups:', error);
  }

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Create groups for each clinic
  for (const clinic of clinics) {
    const clinicId = clinic.clinicId;
    console.log(`\nProcessing clinic: ${clinicId} (${clinic.clinicName})`);

    // Create role-based groups (DOCTOR, HYGIENIST, etc.)
    for (const role of DENTAL_ROLES) {
      const groupName = `clinic_${clinicId}__${role.key}`;

      if (existingGroups.has(groupName)) {
        console.log(`  ✓ Group already exists: ${groupName}`);
        skippedCount++;
        continue;
      }

      try {
        await cognitoClient.send(new CreateGroupCommand({
          UserPoolId: userPoolId,
          GroupName: groupName,
          Description: `${role.displayName} role for ${clinic.clinicName}`,
          Precedence: getPrecedenceForRole(role.key)
        }));

        console.log(`  ✓ Created: ${groupName}`);
        createdCount++;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`  ✗ Failed to create ${groupName}:`, error);
        errorCount++;
      }
    }

    // Create USER group for voice system access
    const userGroupName = `clinic_${clinicId}_USER`;

    if (existingGroups.has(userGroupName)) {
      console.log(`  ✓ Group already exists: ${userGroupName}`);
      skippedCount++;
      continue;
    }

    try {
      await cognitoClient.send(new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: userGroupName,
        Description: `Voice agent access for ${clinic.clinicName}`,
        Precedence: 99 // Lower precedence than role-based groups
      }));

      console.log(`  ✓ Created: ${userGroupName}`);
      createdCount++;

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`  ✗ Failed to create ${userGroupName}:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Total clinics processed: ${clinics.length}`);
  console.log(`Groups created: ${createdCount}`);
  console.log(`Groups skipped (already exist): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Expected total groups: ${clinics.length * (DENTAL_ROLES.length + 1)} (including USER groups)`);
}

function getPrecedenceForRole(roleKey: string): number {
  // Lower numbers = higher precedence
  switch (roleKey) {
    case 'DOCTOR': return 10;
    case 'HYGIENIST': return 20;
    case 'TREATMENT_COORDINATOR': return 30;
    case 'DENTAL_ASSISTANT': return 40;
    case 'PATIENT_COORDINATOR': return 50;
    case 'USER': return 99; // Voice agents have lowest precedence
    default: return 99;
  }
}

// CLI usage
if (require.main === module) {
  const userPoolId = process.env.USER_POOL_ID || process.argv[2];
  
  if (!userPoolId) {
    console.error('Usage: ts-node create-cognito-groups.ts <USER_POOL_ID>');
    console.error('   or: USER_POOL_ID=us-east-1_abc123 ts-node create-cognito-groups.ts');
    process.exit(1);
  }
  
  createCognitoGroupsForAllClinics(userPoolId)
    .then(() => {
      console.log('\n✅ Cognito group creation completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed to create Cognito groups:', error);
      process.exit(1);
    });
}
