/**
 * Script to create an initial admin user in the StaffUser DynamoDB table
 * Run this script after deploying the CoreStack but before using the application
 * 
 * Usage:
 *   npx ts-node scripts/create-initial-admin-user.ts <email> [<givenName>] [<familyName>]
 * 
 * Example:
 *   npx ts-node scripts/create-initial-admin-user.ts admin@todaysdentalinsights.com Admin User
 * 
 * Note: No password required! Users will log in via OTP sent to their email.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

/**
 * Create an initial admin user (OTP-based, no password needed)
 */
async function createInitialAdminUser(
  email: string,
  givenName?: string,
  familyName?: string
) {
  console.log('Creating initial admin user...');
  console.log(`Email: ${email}`);

  // Check if user already exists
  const existingUser = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: email.toLowerCase() },
  }));

  if (existingUser.Item) {
    console.error('ERROR: User already exists with this email address');
    process.exit(1);
  }

  // Create the user (no password required for OTP authentication)
  const user = {
    email: email.toLowerCase(),
    givenName: givenName || 'Admin',
    familyName: familyName || 'User',
    clinicRoles: [], // Global admin has access to all clinics - no per-clinic roles needed
    isSuperAdmin: true,
    isGlobalSuperAdmin: true,
    isActive: true,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({
    TableName: STAFF_USER_TABLE,
    Item: user,
  }));

  console.log('✅ Successfully created initial admin user!');
  console.log(`Email: ${user.email}`);
  console.log(`Name: ${user.givenName} ${user.familyName}`);
  console.log(`Role: Global super admin (full access to all clinics)`);
  console.log(`\n🔐 Authentication: OTP/Passwordless`);
  console.log(`\nTo log in:`);
  console.log(`1. Go to the login page`);
  console.log(`2. Enter: ${user.email}`);
  console.log(`3. Check your email for a 6-digit code`);
  console.log(`4. Enter the code to complete login`);
  console.log(`\n📧 Make sure AWS SES is configured and the email address is verified!`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: npx ts-node scripts/create-initial-admin-user.ts <email> [<givenName>] [<familyName>]');
  console.error('Example: npx ts-node scripts/create-initial-admin-user.ts admin@todaysdentalinsights.com Admin User');
  console.error('\nNote: No password required! Users authenticate via OTP sent to email.');
  process.exit(1);
}

const [email, givenName, familyName] = args;

// Validate email
if (!email.includes('@')) {
  console.error('ERROR: Invalid email address');
  process.exit(1);
}

// Create the user
createInitialAdminUser(email, givenName, familyName)
  .then(() => {
    console.log('\n✨ Setup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('ERROR:', error);
    process.exit(1);
  });
