#!/usr/bin/env ts-node

/**
 * SAML Integration Setup Script
 *
 * This script automates the SAML 2.0 configuration process for:
 * - AWS Cognito User Pool SAML Identity Provider
 * - Amazon Connect Integration
 * - User Pool Client Configuration
 * - Testing and Validation
 *
 * Usage:
 *   npm run ts-node deployment-scripts/setup-saml-integration.ts --metadata-url "https://your-idp.com/saml/metadata"
 *   npm run ts-node deployment-scripts/setup-saml-integration.ts --metadata-file "path/to/metadata.xml"
 *   npm run ts-node deployment-scripts/setup-saml-integration.ts --interactive
 */

import * as AWS from 'aws-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as https from 'https';
import * as http from 'http';

interface SAMLSetupOptions {
  metadataUrl?: string;
  metadataFile?: string;
  metadataXml?: string;
  providerName?: string;
  userPoolId?: string;
  region?: string;
  interactive?: boolean;
  validateOnly?: boolean;
}

class SAMLSetup {
  private cognitoIdp: AWS.CognitoIdentityServiceProvider;
  private connect: AWS.Connect;
  private userPoolId: string;
  private region: string;
  private providerName: string;

  constructor(options: SAMLSetupOptions) {
    this.region = options.region || process.env.AWS_REGION || 'us-east-1';
    this.userPoolId = options.userPoolId || process.env.USER_POOL_ID || '';
    this.providerName = options.providerName || 'CognitoSAMLProvider';

    // Initialize AWS clients
    this.cognitoIdp = new AWS.CognitoIdentityServiceProvider({
      region: this.region,
      apiVersion: '2016-04-18'
    });

    this.connect = new AWS.Connect({
      region: this.region,
      apiVersion: '2017-08-08'
    });
  }

  async run(): Promise<void> {
    console.log('🔐 Starting SAML Integration Setup...\n');

    try {
      // Step 1: Validate prerequisites
      await this.validatePrerequisites();

      // Step 2: Get SAML metadata
      const metadataXml = await this.getSAMLMetadata();

      // Step 3: Configure Cognito SAML Provider
      await this.configureCognitoSAMLProvider(metadataXml);

      // Step 4: Update User Pool Client
      await this.updateUserPoolClient();

      // Step 5: Validate configuration
      await this.validateConfiguration();

      // Step 6: Provide next steps
      this.printNextSteps();

    } catch (error: any) {
      console.error('❌ SAML setup failed:', error.message);
      process.exit(1);
    }
  }

  private async validatePrerequisites(): Promise<void> {
    console.log('📋 Validating prerequisites...');

    if (!this.userPoolId) {
      throw new Error('USER_POOL_ID is required. Set it as environment variable or pass as --user-pool-id');
    }

    // Check if User Pool exists
    try {
      const userPool = await this.cognitoIdp.describeUserPool({ UserPoolId: this.userPoolId }).promise();
      console.log(`✅ User Pool found: ${userPool.UserPool?.Name} (${this.userPoolId})`);
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        throw new Error(`User Pool ${this.userPoolId} not found`);
      }
      throw error;
    }

    // Check Connect instance
    const connectInstanceId = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';
    try {
      await this.connect.describeInstance({ InstanceId: connectInstanceId }).promise();
      console.log(`✅ Connect instance found: ${connectInstanceId}`);
    } catch (error: any) {
      console.warn(`⚠️ Connect instance ${connectInstanceId} not accessible: ${error.message}`);
    }

    console.log('✅ Prerequisites validated\n');
  }

  private async getSAMLMetadata(): Promise<string> {
    console.log('📄 Retrieving SAML metadata...');

    if (process.env.SAML_METADATA_XML) {
      console.log('✅ Using SAML metadata from environment variable');
      return process.env.SAML_METADATA_XML;
    }

    const args = process.argv.slice(2);
    const metadataUrl = args.find(arg => arg.startsWith('--metadata-url='))?.split('=')[1];
    const metadataFile = args.find(arg => arg.startsWith('--metadata-file='))?.split('=')[1];

    if (metadataUrl) {
      console.log(`📡 Fetching metadata from URL: ${metadataUrl}`);
      return await this.fetchMetadataFromUrl(metadataUrl);
    }

    if (metadataFile) {
      console.log(`📁 Reading metadata from file: ${metadataFile}`);
      return await this.readMetadataFromFile(metadataFile);
    }

    // Interactive mode
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const url = await this.question(rl, 'Enter your SAML metadata URL: ');
    if (url) {
      return await this.fetchMetadataFromUrl(url);
    }

    const file = await this.question(rl, 'Enter path to SAML metadata file: ');
    if (file) {
      return await this.readMetadataFromFile(file);
    }

    throw new Error('No SAML metadata provided');
  }

  private async fetchMetadataFromUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;

      client.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (!data.includes('EntityDescriptor')) {
            reject(new Error('Response does not appear to be valid SAML metadata'));
            return;
          }
          resolve(data);
        });
      }).on('error', reject);
    });
  }

  private async readMetadataFromFile(filePath: string): Promise<string> {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes('EntityDescriptor')) {
      throw new Error('File does not appear to be valid SAML metadata');
    }

    return content;
  }

  private async configureCognitoSAMLProvider(metadataXml: string): Promise<void> {
    console.log('⚙️ Configuring Cognito SAML Identity Provider...');

    try {
      // Check if provider already exists
      const existingProviders = await this.cognitoIdp.listIdentityProviders({
        UserPoolId: this.userPoolId
      }).promise();

      const samlProvider = existingProviders.IdentityProviders?.find(
        p => p.ProviderName === this.providerName
      );

      if (samlProvider) {
        console.log(`🔄 Updating existing SAML provider: ${this.providerName}`);
        await this.cognitoIdp.updateIdentityProvider({
          UserPoolId: this.userPoolId,
          ProviderName: this.providerName,
          ProviderDetails: {
            MetadataURL: '', // We're providing metadata content directly
            MetadataFile: Buffer.from(metadataXml).toString('base64')
          },
          AttributeMapping: {
            email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
            family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
            'cognito:username': 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
          }
        }).promise();
      } else {
        console.log(`➕ Creating new SAML provider: ${this.providerName}`);
        await this.cognitoIdp.createIdentityProvider({
          UserPoolId: this.userPoolId,
          ProviderName: this.providerName,
          ProviderType: 'SAML',
          ProviderDetails: {
            MetadataURL: '', // We're providing metadata content directly
            MetadataFile: Buffer.from(metadataXml).toString('base64')
          },
          AttributeMapping: {
            email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
            family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
            'cognito:username': 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
          }
        }).promise();
      }

      console.log(`✅ SAML provider ${this.providerName} configured successfully`);
    } catch (error: any) {
      console.error('❌ Failed to configure SAML provider:', error.message);
      throw error;
    }
  }

  private async updateUserPoolClient(): Promise<void> {
    console.log('🔧 Updating User Pool Client...');

    try {
      // Get current client configuration
      const clients = await this.cognitoIdp.listUserPoolClients({
        UserPoolId: this.userPoolId
      }).promise();

      const client = clients.UserPoolClients?.[0];
      if (!client) {
        throw new Error('No User Pool Client found');
      }

      // Update client to include SAML provider
      await this.cognitoIdp.updateUserPoolClient({
        UserPoolId: this.userPoolId,
        ClientId: client.ClientId!,
        SupportedIdentityProviders: ['COGNITO', this.providerName],
        ExplicitAuthFlows: [
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_USER_PASSWORD_AUTH',
          'ALLOW_ADMIN_USER_PASSWORD_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH'
        ]
      }).promise();

      console.log(`✅ User Pool Client updated to support SAML authentication`);
    } catch (error: any) {
      console.error('❌ Failed to update User Pool Client:', error.message);
      throw error;
    }
  }

  private async validateConfiguration(): Promise<void> {
    console.log('🔍 Validating SAML configuration...');

    try {
      // Check SAML provider
      const providers = await this.cognitoIdp.listIdentityProviders({
        UserPoolId: this.userPoolId
      }).promise();

      const samlProvider = providers.IdentityProviders?.find(
        p => p.ProviderName === this.providerName
      );

      if (!samlProvider) {
        throw new Error(`SAML provider ${this.providerName} not found`);
      }

      // Check User Pool Client
      const clients = await this.cognitoIdp.listUserPoolClients({
        UserPoolId: this.userPoolId
      }).promise();

      const client = clients.UserPoolClients?.[0];
      if (!client) {
        throw new Error('No User Pool Client found');
      }

      const hasSAML = client.SupportedIdentityProviders?.includes(this.providerName);
      if (!hasSAML) {
        throw new Error(`User Pool Client does not support ${this.providerName}`);
      }

      console.log('✅ SAML configuration validated successfully');
      console.log(`   - Provider: ${this.providerName}`);
      console.log(`   - Client supports: ${client.SupportedIdentityProviders?.join(', ')}`);
      console.log(`   - Login URL: https://${this.userPoolId.split('_')[0]}.auth.${this.region}.amazoncognito.com/login`);

    } catch (error: any) {
      console.error('❌ Configuration validation failed:', error.message);
      throw error;
    }
  }

  private printNextSteps(): void {
    console.log('\n🎉 SAML setup completed successfully!');
    console.log('\n📝 Next Steps:');
    console.log('1. 📱 Configure your Identity Provider (IdP):');
    console.log(`   - Login URL: https://${this.userPoolId.split('_')[0]}.auth.${this.region}.amazoncognito.com/login`);
    console.log(`   - ACS URL: https://${this.userPoolId.split('_')[0]}.auth.${this.region}.amazoncognito.com/saml2/idpresponse`);
    console.log(`   - Entity ID: ${this.userPoolId}`);
    console.log('   - Attribute mapping:');
    console.log('     * Email: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress');
    console.log('     * Given Name: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname');
    console.log('     * Family Name: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname');

    console.log('\n2. 🧪 Test the integration:');
    console.log('   - Try logging in with a SAML user');
    console.log('   - Verify user is created in Cognito');
    console.log('   - Check Connect user creation');

    console.log('\n3. 🛠️ Use the API endpoints:');
    console.log('   - POST /connect/saml-auth?action=register_user (register SAML users)');
    console.log('   - GET /connect/saml-auth?action=get_saml_settings (get configuration)');
    console.log('   - POST /admin/saml-users (admin user management)');

    console.log('\n4. 📊 Monitor and troubleshoot:');
    console.log('   - Check CloudWatch logs for Lambda functions');
    console.log('   - Monitor Cognito User Pool metrics');
    console.log('   - Review Connect instance logs');
  }

  private question(rl: readline.Interface, query: string): Promise<string | null> {
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        resolve(answer.trim() || null);
      });
    });
  }
}

// CLI argument parsing
function parseArgs(): SAMLSetupOptions {
  const args = process.argv.slice(2);
  const options: SAMLSetupOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--metadata-url=')) {
      options.metadataUrl = arg.split('=')[1];
    } else if (arg.startsWith('--metadata-file=')) {
      options.metadataFile = arg.split('=')[1];
    } else if (arg.startsWith('--user-pool-id=')) {
      options.userPoolId = arg.split('=')[1];
    } else if (arg.startsWith('--region=')) {
      options.region = arg.split('=')[1];
    } else if (arg.startsWith('--provider-name=')) {
      options.providerName = arg.split('=')[1];
    } else if (arg === '--interactive') {
      options.interactive = true;
    } else if (arg === '--validate-only') {
      options.validateOnly = true;
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  // Set AWS region
  if (options.region) {
    process.env.AWS_REGION = options.region;
  }

  const setup = new SAMLSetup(options);
  await setup.run();
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Setup cancelled by user');
  process.exit(0);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('Setup failed:', error.message);
    process.exit(1);
  });
}

export { SAMLSetup, SAMLSetupOptions };
