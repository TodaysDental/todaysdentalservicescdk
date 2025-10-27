"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoDentalStaffManager = void 0;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const cognitoClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({});
class CognitoDentalStaffManager {
    constructor(userPoolId) {
        this.userPoolId = userPoolId;
    }
    /**
     * Update a Cognito user's dental staff attributes
     */
    async updateUserAttributes(username, attributes) {
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
            await cognitoClient.send(new client_cognito_identity_provider_1.AdminUpdateUserAttributesCommand({
                UserPoolId: this.userPoolId,
                Username: username,
                UserAttributes: userAttributes
            }));
            console.log(`✓ Updated attributes for user: ${username}`);
        }
        catch (error) {
            console.error(`✗ Failed to update user ${username}:`, error);
            throw error;
        }
    }
    /**
     * Get a user's current attributes
     */
    async getUserAttributes(username) {
        try {
            const response = await cognitoClient.send(new client_cognito_identity_provider_1.AdminGetUserCommand({
                UserPoolId: this.userPoolId,
                Username: username
            }));
            const attributes = {};
            response.UserAttributes?.forEach(attr => {
                if (attr.Name && attr.Value) {
                    attributes[attr.Name] = attr.Value;
                }
            });
            return attributes;
        }
        catch (error) {
            console.error(`Failed to get user ${username}:`, error);
            throw error;
        }
    }
    /**
     * Sync OpenDental users with Cognito user attributes
     */
    async syncWithOpenDental(openDentalUsers, hourlyPayRates = {}) {
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
                const attributes = {
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
            }
            catch (error) {
                if (error.name === 'UserNotFoundException') {
                    console.log(`👤 Cognito user not found for: ${odUser.emailAddress}`);
                    notFound++;
                }
                else {
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
    async syncUserClinicGroups(username, clinicNum) {
        // You would implement logic here to map OpenDental ClinicNum to your clinic IDs
        // and ensure the user is in the appropriate clinic groups
        console.log(`🏥 Syncing clinic groups for ${username}, ClinicNum: ${clinicNum}`);
    }
    /**
     * List all users with their dental staff attributes
     */
    async listUsersWithAttributes() {
        try {
            const response = await cognitoClient.send(new client_cognito_identity_provider_1.ListUsersCommand({
                UserPoolId: this.userPoolId,
                Limit: 60
            }));
            console.log(`\n📋 Users in pool (${response.Users?.length || 0}):`);
            console.log('='.repeat(80));
            for (const user of response.Users || []) {
                const username = user.Username || 'unknown';
                const attributes = {};
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
        }
        catch (error) {
            console.error('Failed to list users:', error);
        }
    }
}
exports.CognitoDentalStaffManager = CognitoDentalStaffManager;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlLWRlbnRhbC1zdGFmZi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1hbmFnZS1kZW50YWwtc3RhZmYudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsZ0dBUW1EO0FBRW5ELE1BQU0sYUFBYSxHQUFHLElBQUksZ0VBQTZCLENBQUMsRUFBRSxDQUFDLENBQUM7QUEyQjVELE1BQWEseUJBQXlCO0lBQ3BDLFlBQW9CLFVBQWtCO1FBQWxCLGVBQVUsR0FBVixVQUFVLENBQVE7SUFBRyxDQUFDO0lBRTFDOztPQUVHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFFBQWdCLEVBQUUsVUFBaUM7UUFDNUUsTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBRTFCLElBQUksVUFBVSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3pCLGNBQWMsQ0FBQyxJQUFJLENBQUM7Z0JBQ2xCLElBQUksRUFBRSxtQkFBbUI7Z0JBQ3pCLEtBQUssRUFBRSxVQUFVLENBQUMsU0FBUzthQUM1QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxVQUFVLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNqQyxjQUFjLENBQUMsSUFBSSxDQUFDO2dCQUNsQixJQUFJLEVBQUUsMkJBQTJCO2dCQUNqQyxLQUFLLEVBQUUsVUFBVSxDQUFDLGlCQUFpQjthQUNwQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxVQUFVLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUNsQyxjQUFjLENBQUMsSUFBSSxDQUFDO2dCQUNsQixJQUFJLEVBQUUsNEJBQTRCO2dCQUNsQyxLQUFLLEVBQUUsVUFBVSxDQUFDLGtCQUFrQjthQUNyQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDM0IsY0FBYyxDQUFDLElBQUksQ0FBQztnQkFDbEIsSUFBSSxFQUFFLHFCQUFxQjtnQkFDM0IsS0FBSyxFQUFFLFVBQVUsQ0FBQyxX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R0FBRyxDQUFDLGlGQUFpRixDQUFDLENBQUM7WUFDL0YsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNoQixNQUFNO1FBRVI7WUFDRSxPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQzdDLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0NBQXdDLENBQUMsQ0FBQztZQUN4RCxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BCLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgXHJcbiAgQ29nbml0b0lkZW50aXR5UHJvdmlkZXJDbGllbnQsIFxyXG4gIEFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXNDb21tYW5kLFxyXG4gIEFkbWluR2V0VXNlckNvbW1hbmQsXHJcbiAgTGlzdFVzZXJzQ29tbWFuZCxcclxuICBBZG1pbkxpc3RHcm91cHNGb3JVc2VyQ29tbWFuZCxcclxuICBBZG1pbkFkZFVzZXJUb0dyb3VwQ29tbWFuZCxcclxuICBBZG1pblJlbW92ZVVzZXJGcm9tR3JvdXBDb21tYW5kXHJcbn0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC1jb2duaXRvLWlkZW50aXR5LXByb3ZpZGVyXCI7XHJcblxyXG5jb25zdCBjb2duaXRvQ2xpZW50ID0gbmV3IENvZ25pdG9JZGVudGl0eVByb3ZpZGVyQ2xpZW50KHt9KTtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgT3BlbkRlbnRhbFVzZXIge1xyXG4gIFVzZXJOdW06IG51bWJlcjtcclxuICBVc2VyTmFtZTogc3RyaW5nO1xyXG4gIHVzZXJHcm91cE51bXM6IG51bWJlcltdO1xyXG4gIEVtcGxveWVlTnVtOiBudW1iZXI7XHJcbiAgZW1wbG95ZWVOYW1lOiBzdHJpbmc7XHJcbiAgQ2xpbmljTnVtOiBudW1iZXI7XHJcbiAgUHJvdmlkZXJOdW06IG51bWJlcjtcclxuICBwcm92aWRlck5hbWU6IHN0cmluZztcclxuICBlbWFpbEFkZHJlc3M6IHN0cmluZztcclxuICBJc0hpZGRlbjogc3RyaW5nO1xyXG4gIFVzZXJOdW1DRU1UOiBudW1iZXI7XHJcbiAgSXNQYXNzd29yZFJlc2V0UmVxdWlyZWQ6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBEZW50YWxTdGFmZkF0dHJpYnV0ZXMge1xyXG4gIGVtYWlsOiBzdHJpbmc7XHJcbiAgaG91cmx5UGF5Pzogc3RyaW5nO1xyXG4gIG9wZW5EZW50YWxVc2VyTnVtPzogc3RyaW5nO1xyXG4gIG9wZW5EZW50YWxVc2VyTmFtZT86IHN0cmluZztcclxuICBlbXBsb3llZU51bT86IHN0cmluZztcclxuICBwcm92aWRlck51bT86IHN0cmluZztcclxuICBjbGluaWNOdW0/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBDb2duaXRvRGVudGFsU3RhZmZNYW5hZ2VyIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHVzZXJQb29sSWQ6IHN0cmluZykge31cclxuXHJcbiAgLyoqXHJcbiAgICogVXBkYXRlIGEgQ29nbml0byB1c2VyJ3MgZGVudGFsIHN0YWZmIGF0dHJpYnV0ZXNcclxuICAgKi9cclxuICBhc3luYyB1cGRhdGVVc2VyQXR0cmlidXRlcyh1c2VybmFtZTogc3RyaW5nLCBhdHRyaWJ1dGVzOiBEZW50YWxTdGFmZkF0dHJpYnV0ZXMpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHVzZXJBdHRyaWJ1dGVzID0gW107XHJcblxyXG4gICAgaWYgKGF0dHJpYnV0ZXMuaG91cmx5UGF5KSB7XHJcbiAgICAgIHVzZXJBdHRyaWJ1dGVzLnB1c2goe1xyXG4gICAgICAgIE5hbWU6ICdjdXN0b206aG91cmx5X3BheScsXHJcbiAgICAgICAgVmFsdWU6IGF0dHJpYnV0ZXMuaG91cmx5UGF5XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChhdHRyaWJ1dGVzLm9wZW5EZW50YWxVc2VyTnVtKSB7XHJcbiAgICAgIHVzZXJBdHRyaWJ1dGVzLnB1c2goe1xyXG4gICAgICAgIE5hbWU6ICdjdXN0b206b3BlbmRlbnRhbF91c2VybnVtJyxcclxuICAgICAgICBWYWx1ZTogYXR0cmlidXRlcy5vcGVuRGVudGFsVXNlck51bVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYXR0cmlidXRlcy5vcGVuRGVudGFsVXNlck5hbWUpIHtcclxuICAgICAgdXNlckF0dHJpYnV0ZXMucHVzaCh7XHJcbiAgICAgICAgTmFtZTogJ2N1c3RvbTpvcGVuZGVudGFsX3VzZXJuYW1lJyxcclxuICAgICAgICBWYWx1ZTogYXR0cmlidXRlcy5vcGVuRGVudGFsVXNlck5hbWVcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGF0dHJpYnV0ZXMuZW1wbG95ZWVOdW0pIHtcclxuICAgICAgdXNlckF0dHJpYnV0ZXMucHVzaCh7XHJcbiAgICAgICAgTmFtZTogJ2N1c3RvbTplbXBsb3llZV9udW0nLFxyXG4gICAgICAgIFZhbHVlOiBhdHRyaWJ1dGVzLmVtcGxveWVlTnVtXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChhdHRyaWJ1dGVzLnByb3ZpZGVyTnVtKSB7XHJcbiAgICAgIHVzZXJBdHRyaWJ1dGVzLnB1c2goe1xyXG4gICAgICAgIE5hbWU6ICdjdXN0b206cHJvdmlkZXJfbnVtJyxcclxuICAgICAgICBWYWx1ZTogYXR0cmlidXRlcy5wcm92aWRlck51bVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYXR0cmlidXRlcy5jbGluaWNOdW0pIHtcclxuICAgICAgdXNlckF0dHJpYnV0ZXMucHVzaCh7XHJcbiAgICAgICAgTmFtZTogJ2N1c3RvbTpjbGluaWNfbnVtJyxcclxuICAgICAgICBWYWx1ZTogYXR0cmlidXRlcy5jbGluaWNOdW1cclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHVzZXJBdHRyaWJ1dGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgTm8gYXR0cmlidXRlcyB0byB1cGRhdGUgZm9yIHVzZXI6ICR7dXNlcm5hbWV9YCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBjb2duaXRvQ2xpZW50LnNlbmQobmV3IEFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXNDb21tYW5kKHtcclxuICAgICAgICBVc2VyUG9vbElkOiB0aGlzLnVzZXJQb29sSWQsXHJcbiAgICAgICAgVXNlcm5hbWU6IHVzZXJuYW1lLFxyXG4gICAgICAgIFVzZXJBdHRyaWJ1dGVzOiB1c2VyQXR0cmlidXRlc1xyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyTIFVwZGF0ZWQgYXR0cmlidXRlcyBmb3IgdXNlcjogJHt1c2VybmFtZX1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKclyBGYWlsZWQgdG8gdXBkYXRlIHVzZXIgJHt1c2VybmFtZX06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCBhIHVzZXIncyBjdXJyZW50IGF0dHJpYnV0ZXNcclxuICAgKi9cclxuICBhc3luYyBnZXRVc2VyQXR0cmlidXRlcyh1c2VybmFtZTogc3RyaW5nKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNvZ25pdG9DbGllbnQuc2VuZChuZXcgQWRtaW5HZXRVc2VyQ29tbWFuZCh7XHJcbiAgICAgICAgVXNlclBvb2xJZDogdGhpcy51c2VyUG9vbElkLFxyXG4gICAgICAgIFVzZXJuYW1lOiB1c2VybmFtZVxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XHJcbiAgICAgIHJlc3BvbnNlLlVzZXJBdHRyaWJ1dGVzPy5mb3JFYWNoKGF0dHIgPT4ge1xyXG4gICAgICAgIGlmIChhdHRyLk5hbWUgJiYgYXR0ci5WYWx1ZSkge1xyXG4gICAgICAgICAgYXR0cmlidXRlc1thdHRyLk5hbWVdID0gYXR0ci5WYWx1ZTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXM7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZ2V0IHVzZXIgJHt1c2VybmFtZX06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFN5bmMgT3BlbkRlbnRhbCB1c2VycyB3aXRoIENvZ25pdG8gdXNlciBhdHRyaWJ1dGVzXHJcbiAgICovXHJcbiAgYXN5bmMgc3luY1dpdGhPcGVuRGVudGFsKFxyXG4gICAgb3BlbkRlbnRhbFVzZXJzOiBPcGVuRGVudGFsVXNlcltdLCBcclxuICAgIGhvdXJseVBheVJhdGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cclxuICApOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5SEIFN5bmNpbmcgJHtvcGVuRGVudGFsVXNlcnMubGVuZ3RofSBPcGVuRGVudGFsIHVzZXJzIHdpdGggQ29nbml0by4uLmApO1xyXG5cclxuICAgIGxldCB1cGRhdGVkID0gMDtcclxuICAgIGxldCBlcnJvcnMgPSAwO1xyXG4gICAgbGV0IG5vdEZvdW5kID0gMDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG9kVXNlciBvZiBvcGVuRGVudGFsVXNlcnMpIHtcclxuICAgICAgaWYgKG9kVXNlci5Jc0hpZGRlbiA9PT0gXCJ0cnVlXCIpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4o+t77iPICBTa2lwcGluZyBoaWRkZW4gdXNlcjogJHtvZFVzZXIuVXNlck5hbWV9YCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICghb2RVc2VyLmVtYWlsQWRkcmVzcykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDij63vuI8gIFNraXBwaW5nIHVzZXIgd2l0aG91dCBlbWFpbDogJHtvZFVzZXIuVXNlck5hbWV9YCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gVHJ5IHRvIGZpbmQgdGhlIENvZ25pdG8gdXNlciBieSBlbWFpbFxyXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IERlbnRhbFN0YWZmQXR0cmlidXRlcyA9IHtcclxuICAgICAgICAgIGVtYWlsOiBvZFVzZXIuZW1haWxBZGRyZXNzLFxyXG4gICAgICAgICAgb3BlbkRlbnRhbFVzZXJOdW06IG9kVXNlci5Vc2VyTnVtLnRvU3RyaW5nKCksXHJcbiAgICAgICAgICBvcGVuRGVudGFsVXNlck5hbWU6IG9kVXNlci5Vc2VyTmFtZSxcclxuICAgICAgICAgIGVtcGxveWVlTnVtOiBvZFVzZXIuRW1wbG95ZWVOdW0udG9TdHJpbmcoKSxcclxuICAgICAgICAgIHByb3ZpZGVyTnVtOiBvZFVzZXIuUHJvdmlkZXJOdW0udG9TdHJpbmcoKSxcclxuICAgICAgICAgIGNsaW5pY051bTogb2RVc2VyLkNsaW5pY051bS50b1N0cmluZygpXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gQWRkIGhvdXJseSBwYXkgaWYgcHJvdmlkZWRcclxuICAgICAgICBjb25zdCBwYXlLZXkgPSBvZFVzZXIuZW1haWxBZGRyZXNzLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgaWYgKGhvdXJseVBheVJhdGVzW3BheUtleV0pIHtcclxuICAgICAgICAgIGF0dHJpYnV0ZXMuaG91cmx5UGF5ID0gaG91cmx5UGF5UmF0ZXNbcGF5S2V5XTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlVXNlckF0dHJpYnV0ZXMob2RVc2VyLmVtYWlsQWRkcmVzcywgYXR0cmlidXRlcyk7XHJcbiAgICAgICAgdXBkYXRlZCsrO1xyXG5cclxuICAgICAgICAvLyBBbHNvIHN5bmMgdGhlaXIgY2xpbmljIGdyb3VwcyBiYXNlZCBvbiBDbGluaWNOdW1cclxuICAgICAgICBhd2FpdCB0aGlzLnN5bmNVc2VyQ2xpbmljR3JvdXBzKG9kVXNlci5lbWFpbEFkZHJlc3MsIG9kVXNlci5DbGluaWNOdW0pO1xyXG5cclxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgIGlmIChlcnJvci5uYW1lID09PSAnVXNlck5vdEZvdW5kRXhjZXB0aW9uJykge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYPCfkaQgQ29nbml0byB1c2VyIG5vdCBmb3VuZCBmb3I6ICR7b2RVc2VyLmVtYWlsQWRkcmVzc31gKTtcclxuICAgICAgICAgIG5vdEZvdW5kKys7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKclyBFcnJvciBzeW5jaW5nIHVzZXIgJHtvZFVzZXIuZW1haWxBZGRyZXNzfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICBlcnJvcnMrKztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgXFxuPT09IFN5bmMgU3VtbWFyeSA9PT1gKTtcclxuICAgIGNvbnNvbGUubG9nKGBVc2VycyB1cGRhdGVkOiAke3VwZGF0ZWR9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhgVXNlcnMgbm90IGZvdW5kIGluIENvZ25pdG86ICR7bm90Rm91bmR9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhgRXJyb3JzOiAke2Vycm9yc31gKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFN5bmMgdXNlcidzIGNsaW5pYyBncm91cHMgYmFzZWQgb24gdGhlaXIgT3BlbkRlbnRhbCBDbGluaWNOdW1cclxuICAgKi9cclxuICBhc3luYyBzeW5jVXNlckNsaW5pY0dyb3Vwcyh1c2VybmFtZTogc3RyaW5nLCBjbGluaWNOdW06IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgLy8gWW91IHdvdWxkIGltcGxlbWVudCBsb2dpYyBoZXJlIHRvIG1hcCBPcGVuRGVudGFsIENsaW5pY051bSB0byB5b3VyIGNsaW5pYyBJRHNcclxuICAgIC8vIGFuZCBlbnN1cmUgdGhlIHVzZXIgaXMgaW4gdGhlIGFwcHJvcHJpYXRlIGNsaW5pYyBncm91cHNcclxuICAgIGNvbnNvbGUubG9nKGDwn4+lIFN5bmNpbmcgY2xpbmljIGdyb3VwcyBmb3IgJHt1c2VybmFtZX0sIENsaW5pY051bTogJHtjbGluaWNOdW19YCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBMaXN0IGFsbCB1c2VycyB3aXRoIHRoZWlyIGRlbnRhbCBzdGFmZiBhdHRyaWJ1dGVzXHJcbiAgICovXHJcbiAgYXN5bmMgbGlzdFVzZXJzV2l0aEF0dHJpYnV0ZXMoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNvZ25pdG9DbGllbnQuc2VuZChuZXcgTGlzdFVzZXJzQ29tbWFuZCh7XHJcbiAgICAgICAgVXNlclBvb2xJZDogdGhpcy51c2VyUG9vbElkLFxyXG4gICAgICAgIExpbWl0OiA2MFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgXFxu8J+TiyBVc2VycyBpbiBwb29sICgke3Jlc3BvbnNlLlVzZXJzPy5sZW5ndGggfHwgMH0pOmApO1xyXG4gICAgICBjb25zb2xlLmxvZygnPScucmVwZWF0KDgwKSk7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IHVzZXIgb2YgcmVzcG9uc2UuVXNlcnMgfHwgW10pIHtcclxuICAgICAgICBjb25zdCB1c2VybmFtZSA9IHVzZXIuVXNlcm5hbWUgfHwgJ3Vua25vd24nO1xyXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcclxuICAgICAgICBcclxuICAgICAgICB1c2VyLkF0dHJpYnV0ZXM/LmZvckVhY2goYXR0ciA9PiB7XHJcbiAgICAgICAgICBpZiAoYXR0ci5OYW1lICYmIGF0dHIuVmFsdWUpIHtcclxuICAgICAgICAgICAgYXR0cmlidXRlc1thdHRyLk5hbWVdID0gYXR0ci5WYWx1ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfkaQgVXNlcjogJHt1c2VybmFtZX1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICAgRW1haWw6ICR7YXR0cmlidXRlcy5lbWFpbCB8fCAnTi9BJ31gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICAgSG91cmx5IFBheTogJCR7YXR0cmlidXRlc1snY3VzdG9tOmhvdXJseV9wYXknXSB8fCAnTm90IHNldCd9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYCAgIE9wZW5EZW50YWwgVXNlck51bTogJHthdHRyaWJ1dGVzWydjdXN0b206b3BlbmRlbnRhbF91c2VybnVtJ10gfHwgJ05vdCBzZXQnfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgICBPcGVuRGVudGFsIFVzZXJuYW1lOiAke2F0dHJpYnV0ZXNbJ2N1c3RvbTpvcGVuZGVudGFsX3VzZXJuYW1lJ10gfHwgJ05vdCBzZXQnfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgICBFbXBsb3llZSBOdW06ICR7YXR0cmlidXRlc1snY3VzdG9tOmVtcGxveWVlX251bSddIHx8ICdOb3Qgc2V0J31gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICAgUHJvdmlkZXIgTnVtOiAke2F0dHJpYnV0ZXNbJ2N1c3RvbTpwcm92aWRlcl9udW0nXSB8fCAnTm90IHNldCd9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYCAgIENsaW5pYyBOdW06ICR7YXR0cmlidXRlc1snY3VzdG9tOmNsaW5pY19udW0nXSB8fCAnTm90IHNldCd9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJycpO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbGlzdCB1c2VyczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBDTEkgdXNhZ2VcclxuaWYgKHJlcXVpcmUubWFpbiA9PT0gbW9kdWxlKSB7XHJcbiAgY29uc3QgdXNlclBvb2xJZCA9IHByb2Nlc3MuZW52LlVTRVJfUE9PTF9JRCB8fCBwcm9jZXNzLmFyZ3ZbMl07XHJcbiAgY29uc3QgY29tbWFuZCA9IHByb2Nlc3MuYXJndlszXTtcclxuICBcclxuICBpZiAoIXVzZXJQb29sSWQpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1VzYWdlOiB0cy1ub2RlIG1hbmFnZS1kZW50YWwtc3RhZmYudHMgPFVTRVJfUE9PTF9JRD4gPGNvbW1hbmQ+Jyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCdDb21tYW5kczonKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJyAgbGlzdCAtIExpc3QgYWxsIHVzZXJzIHdpdGggdGhlaXIgYXR0cmlidXRlcycpO1xyXG4gICAgY29uc29sZS5lcnJvcignICBzeW5jIC0gU3luYyB3aXRoIE9wZW5EZW50YWwgKHJlcXVpcmVzIE9wZW5EZW50YWwgZGF0YSknKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJyAgdXBkYXRlIDxlbWFpbD4gPGhvdXJseVBheT4gPG9kVXNlck51bT4gLSBVcGRhdGUgc3BlY2lmaWMgdXNlcicpO1xyXG4gICAgcHJvY2Vzcy5leGl0KDEpO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgbWFuYWdlciA9IG5ldyBDb2duaXRvRGVudGFsU3RhZmZNYW5hZ2VyKHVzZXJQb29sSWQpO1xyXG5cclxuICBzd2l0Y2ggKGNvbW1hbmQpIHtcclxuICAgIGNhc2UgJ2xpc3QnOlxyXG4gICAgICBtYW5hZ2VyLmxpc3RVc2Vyc1dpdGhBdHRyaWJ1dGVzKClcclxuICAgICAgICAudGhlbigoKSA9PiBwcm9jZXNzLmV4aXQoMCkpXHJcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xyXG4gICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICBicmVhaztcclxuXHJcbiAgICBjYXNlICd1cGRhdGUnOlxyXG4gICAgICBjb25zdCBlbWFpbCA9IHByb2Nlc3MuYXJndls0XTtcclxuICAgICAgY29uc3QgaG91cmx5UGF5ID0gcHJvY2Vzcy5hcmd2WzVdO1xyXG4gICAgICBjb25zdCBvZFVzZXJOdW0gPSBwcm9jZXNzLmFyZ3ZbNl07XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWVtYWlsIHx8ICFob3VybHlQYXkgfHwgIW9kVXNlck51bSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1VzYWdlOiB1cGRhdGUgPGVtYWlsPiA8aG91cmx5UGF5PiA8b2RVc2VyTnVtPicpO1xyXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbWFuYWdlci51cGRhdGVVc2VyQXR0cmlidXRlcyhlbWFpbCwge1xyXG4gICAgICAgIGVtYWlsLFxyXG4gICAgICAgIGhvdXJseVBheSxcclxuICAgICAgICBvcGVuRGVudGFsVXNlck51bTogb2RVc2VyTnVtXHJcbiAgICAgIH0pXHJcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ+KchSBVc2VyIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICAgICAgfSlcclxuICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byB1cGRhdGUgdXNlcjonLCBlcnJvcik7XHJcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIGJyZWFrO1xyXG5cclxuICAgIGNhc2UgJ3N5bmMnOlxyXG4gICAgICBjb25zb2xlLmxvZygnU3luYyBjb21tYW5kIHJlcXVpcmVzIE9wZW5EZW50YWwgZGF0YSAtIGltcGxlbWVudCB5b3VyIE9wZW5EZW50YWwgQVBJIGNhbGwgaGVyZScpO1xyXG4gICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICAgIGJyZWFrO1xyXG5cclxuICAgIGRlZmF1bHQ6XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYFVua25vd24gY29tbWFuZDogJHtjb21tYW5kfWApO1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgY29tbWFuZHM6IGxpc3QsIHN5bmMsIHVwZGF0ZScpO1xyXG4gICAgICBwcm9jZXNzLmV4aXQoMSk7XHJcbiAgfVxyXG59XHJcblxyXG4iXX0=