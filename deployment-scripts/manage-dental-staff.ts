import { 
  CognitoIdentityProviderClient, 
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand
} from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({});

export interface OpenDentalUser {
  UserNum: number;
  UserName: string;
  userGroupNums: number[];
  EmployeeNum: number;
  employeeName: string;
  ClinicNum: number;
  ProviderNum: number;
  providerName: string;
  emailAddress: string;
  IsHidden: string;
  UserNumCEMT: number;
  IsPasswordResetRequired: string;
}

export interface DentalStaffAttributes {
  email: string;
  hourlyPay?: string;
  openDentalUserNum?: string;
  openDentalUserName?: string;
  employeeNum?: string;
  providerNum?: string;
  clinicNum?: string;
}

export class CognitoDentalStaffManager {
  constructor(private userPoolId: string) {}

  /**
   * Update a Cognito user's dental staff attributes
   */
  async updateUserAttributes(username: string, attributes: DentalStaffAttributes): Promise<void> {
    const userAttributes = [];

    if (attributes.hourlyPay) {
      userAttributes.push({
        Name: 'custom:hourly_pay',
        Value: attributes.hourlyPay
      });
    }

    if (attributes.openDentalUserNum) {
      userAttributes.push({
        Name: 'custom:opendental_usernum',
        Value: attributes.openDentalUserNum
      });
    }

    if (attributes.openDentalUserName) {
      userAttributes.push({
        Name: 'custom:opendental_username',
        Value: attributes.openDentalUserName
      });
    }

    if (attributes.employeeNum) {
      userAttributes.push({
        Name: 'custom:employee_num',
        Value: attributes.employeeNum
      });
    }

    if (attributes.providerNum) {
      userAttributes.push({
        Name: 'custom:provider_num',
        Value: attributes.providerNum
      });
    }

    if (attributes.clinicNum) {
      userAttributes.push({
        Name: 'custom:clinic_num',
        Value: attributes.clinicNum
      });
    }

    if (userAttributes.length === 0) {
      console.log(`No attributes to update for user: ${username}`);
      return;
    }

    try {
      await cognitoClient.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        UserAttributes: userAttributes
      }));

      console.log(`✓ Updated attributes for user: ${username}`);
    } catch (error) {
      console.error(`✗ Failed to update user ${username}:`, error);
      throw error;
    }
  }

  /**
   * Get a user's current attributes
   */
  async getUserAttributes(username: string): Promise<Record<string, string>> {
    try {
      const response = await cognitoClient.send(new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username
      }));

      const attributes: Record<string, string> = {};
      response.UserAttributes?.forEach(attr => {
        if (attr.Name && attr.Value) {
          attributes[attr.Name] = attr.Value;
        }
      });

      return attributes;
    } catch (error) {
      console.error(`Failed to get user ${username}:`, error);
      throw error;
    }
  }

  /**
   * Sync OpenDental users with Cognito user attributes
   */
  async syncWithOpenDental(
    openDentalUsers: OpenDentalUser[], 
    hourlyPayRates: Record<string, string> = {}
  ): Promise<void> {
    console.log(`🔄 Syncing ${openDentalUsers.length} OpenDental users with Cognito...`);

    let updated = 0;
    let errors = 0;
    let notFound = 0;

    for (const odUser of openDentalUsers) {
      if (odUser.IsHidden === "true") {
        console.log(`⏭️  Skipping hidden user: ${odUser.UserName}`);
        continue;
      }

      if (!odUser.emailAddress) {
        console.log(`⏭️  Skipping user without email: ${odUser.UserName}`);
        continue;
      }

      try {
        // Try to find the Cognito user by email
        const attributes: DentalStaffAttributes = {
          email: odUser.emailAddress,
          openDentalUserNum: odUser.UserNum.toString(),
          openDentalUserName: odUser.UserName,
          employeeNum: odUser.EmployeeNum.toString(),
          providerNum: odUser.ProviderNum.toString(),
          clinicNum: odUser.ClinicNum.toString()
        };

        // Add hourly pay if provided
        const payKey = odUser.emailAddress.toLowerCase();
        if (hourlyPayRates[payKey]) {
          attributes.hourlyPay = hourlyPayRates[payKey];
        }

        await this.updateUserAttributes(odUser.emailAddress, attributes);
        updated++;

        // Also sync their clinic groups based on ClinicNum
        await this.syncUserClinicGroups(odUser.emailAddress, odUser.ClinicNum);

      } catch (error: any) {
        if (error.name === 'UserNotFoundException') {
          console.log(`👤 Cognito user not found for: ${odUser.emailAddress}`);
          notFound++;
        } else {
          console.error(`✗ Error syncing user ${odUser.emailAddress}:`, error);
          errors++;
        }
      }
    }

    console.log(`\n=== Sync Summary ===`);
    console.log(`Users updated: ${updated}`);
    console.log(`Users not found in Cognito: ${notFound}`);
    console.log(`Errors: ${errors}`);
  }

  /**
   * Sync user's clinic groups based on their OpenDental ClinicNum
   */
  async syncUserClinicGroups(username: string, clinicNum: number): Promise<void> {
    try {
      // Map OpenDental ClinicNum to clinic IDs (you'll need to maintain this mapping)
      // This is a placeholder - you need to implement the actual mapping logic
      const clinicMapping: Record<number, string> = {
        // Add your OpenDental ClinicNum to clinicId mappings here
        // Example: 1: 'todaysdentalcayce', 2: 'dentistinnewbritain', etc.
      };

      const clinicId = clinicMapping[clinicNum];

      if (!clinicId) {
        console.log(`🏥 No clinic mapping found for ClinicNum ${clinicNum}, skipping group sync`);
        return;
      }

      console.log(`🏥 Syncing clinic groups for ${username}, ClinicNum: ${clinicNum} -> ${clinicId}`);

      // Get current groups for user
      const currentGroups = await cognitoClient.send(new AdminListGroupsForUserCommand({
        UserPoolId: this.userPoolId,
        Username: username
      }));

      const currentGroupNames = new Set(currentGroups.Groups?.map(g => g.GroupName) || []);

      // Target groups for this user
      const targetGroups = [
        `clinic_${clinicId}_USER`,  // Voice agent access
        `clinic_${clinicId}__PATIENT_COORDINATOR`, // Default role for voice agents
      ];

      // Add user to target groups
      for (const groupName of targetGroups) {
        if (!currentGroupNames.has(groupName)) {
          try {
            await cognitoClient.send(new AdminAddUserToGroupCommand({
              UserPoolId: this.userPoolId,
              Username: username,
              GroupName: groupName
            }));
            console.log(`  ✓ Added to group: ${groupName}`);
          } catch (error) {
            console.error(`  ✗ Failed to add to group ${groupName}:`, error);
          }
        } else {
          console.log(`  ✓ Already in group: ${groupName}`);
        }
      }

      // Remove user from other clinic groups (optional - only if you want strict one-clinic-per-user)
      for (const groupName of currentGroupNames) {
        if (groupName.startsWith('clinic_') && !targetGroups.includes(groupName)) {
          // Check if this is a different clinic's group
          const clinicMatch = groupName.match(/^clinic_(.+?)(__|_)USER$/);
          if (clinicMatch && clinicMatch[1] !== clinicId) {
            try {
              await cognitoClient.send(new AdminRemoveUserFromGroupCommand({
                UserPoolId: this.userPoolId,
                Username: username,
                GroupName: groupName
              }));
              console.log(`  ✓ Removed from old clinic group: ${groupName}`);
            } catch (error) {
              console.error(`  ✗ Failed to remove from group ${groupName}:`, error);
            }
          }
        }
      }

    } catch (error) {
      console.error(`✗ Failed to sync clinic groups for ${username}:`, error);
      throw error;
    }
  }

  /**
   * List all users with their dental staff attributes
   */
  async listUsersWithAttributes(): Promise<void> {
    try {
      const response = await cognitoClient.send(new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Limit: 60
      }));

      console.log(`\n📋 Users in pool (${response.Users?.length || 0}):`);
      console.log('='.repeat(80));

      for (const user of response.Users || []) {
        const username = user.Username || 'unknown';
        const attributes: Record<string, string> = {};
        
        user.Attributes?.forEach(attr => {
          if (attr.Name && attr.Value) {
            attributes[attr.Name] = attr.Value;
          }
        });

        console.log(`👤 User: ${username}`);
        console.log(`   Email: ${attributes.email || 'N/A'}`);
        console.log(`   Hourly Pay: $${attributes['custom:hourly_pay'] || 'Not set'}`);
        console.log(`   OpenDental UserNum: ${attributes['custom:opendental_usernum'] || 'Not set'}`);
        console.log(`   OpenDental Username: ${attributes['custom:opendental_username'] || 'Not set'}`);
        console.log(`   Employee Num: ${attributes['custom:employee_num'] || 'Not set'}`);
        console.log(`   Provider Num: ${attributes['custom:provider_num'] || 'Not set'}`);
        console.log(`   Clinic Num: ${attributes['custom:clinic_num'] || 'Not set'}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to list users:', error);
    }
  }
}

// CLI usage
if (require.main === module) {
  const userPoolId = process.env.USER_POOL_ID || process.argv[2];
  const command = process.argv[3];
  
  if (!userPoolId) {
    console.error('Usage: ts-node manage-dental-staff.ts <USER_POOL_ID> <command>');
    console.error('Commands:');
    console.error('  list - List all users with their attributes');
    console.error('  sync - Sync with OpenDental (requires OpenDental data)');
    console.error('  update <email> <hourlyPay> <odUserNum> - Update specific user');
    process.exit(1);
  }

  const manager = new CognitoDentalStaffManager(userPoolId);

  switch (command) {
    case 'list':
      manager.listUsersWithAttributes()
        .then(() => process.exit(0))
        .catch(error => {
          console.error(error);
          process.exit(1);
        });
      break;

    case 'update':
      const email = process.argv[4];
      const hourlyPay = process.argv[5];
      const odUserNum = process.argv[6];
      
      if (!email || !hourlyPay || !odUserNum) {
        console.error('Usage: update <email> <hourlyPay> <odUserNum>');
        process.exit(1);
      }

      manager.updateUserAttributes(email, {
        email,
        hourlyPay,
        openDentalUserNum: odUserNum
      })
        .then(() => {
          console.log('✅ User updated successfully');
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Failed to update user:', error);
          process.exit(1);
        });
      break;

    case 'sync':
      console.log('Sync command requires OpenDental data - implement your OpenDental API call here');
      process.exit(0);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: list, sync, update');
      process.exit(1);
  }
}

