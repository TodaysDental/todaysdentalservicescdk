# SAML Integration Setup Scripts

This directory contains automated scripts for setting up SAML 2.0 authentication integration between your Identity Provider (IdP), AWS Cognito, and Amazon Connect.

## Quick Start

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js (for TypeScript script) or PowerShell (for PowerShell script)
- Your SAML Identity Provider metadata URL or XML file

### Option 1: Using TypeScript Script (Recommended)

```bash
# 1. Set your SAML metadata URL
export SAML_METADATA_URL="https://your-idp.com/saml/metadata"

# 2. Set your User Pool ID (optional if already in environment)
export USER_POOL_ID="us-east-1_XXXXXXXXX"

# 3. Run the setup script
npm run ts-node deployment-scripts/setup-saml-integration.ts

# Or with command line arguments
npm run ts-node deployment-scripts/setup-saml-integration.ts --metadata-url "https://your-idp.com/saml/metadata" --user-pool-id "us-east-1_XXXXXXXXX"
```

### Option 2: Using PowerShell Script (Windows)

```powershell
# 1. Set your SAML metadata URL
$env:SAML_METADATA_URL = "https://your-idp.com/saml/metadata"

# 2. Set your User Pool ID
$env:USER_POOL_ID = "us-east-1_XXXXXXXXX"

# 3. Run the setup script
.\deployment-scripts\setup-saml-integration.ps1 -MetadataUrl "https://your-idp.com/saml/metadata"
```

### Option 3: Interactive Mode

```bash
# TypeScript (will prompt for all required information)
npm run ts-node deployment-scripts/setup-saml-integration.ts --interactive

# PowerShell (will prompt for all required information)
.\deployment-scripts\setup-saml-integration.ps1 -Interactive
```

## Script Options

### TypeScript Script Options

| Option | Description | Example |
|--------|-------------|---------|
| `--metadata-url` | URL to fetch SAML metadata from | `--metadata-url "https://idp.company.com/saml/metadata"` |
| `--metadata-file` | Path to SAML metadata XML file | `--metadata-file "./saml-metadata.xml"` |
| `--user-pool-id` | Cognito User Pool ID | `--user-pool-id "us-east-1_ABC123DEF"` |
| `--region` | AWS Region | `--region "us-west-2"` |
| `--provider-name` | SAML Provider name in Cognito | `--provider-name "CompanySAMLProvider"` |
| `--interactive` | Run in interactive mode (prompts for all values) | `--interactive` |
| `--validate-only` | Only validate existing configuration | `--validate-only` |

### PowerShell Script Options

| Option | Description | Example |
|--------|-------------|---------|
| `-MetadataUrl` | URL to fetch SAML metadata from | `-MetadataUrl "https://idp.company.com/saml/metadata"` |
| `-MetadataFile` | Path to SAML metadata XML file | `-MetadataFile ".\saml-metadata.xml"` |
| `-UserPoolId` | Cognito User Pool ID | `-UserPoolId "us-east-1_ABC123DEF"` |
| `-Region` | AWS Region | `-Region "us-west-2"` |
| `-ProviderName` | SAML Provider name in Cognito | `-ProviderName "CompanySAMLProvider"` |
| `-Interactive` | Run in interactive mode | `-Interactive` |
| `-ValidateOnly` | Only validate existing configuration | `-ValidateOnly` |

## What the Scripts Do

### 1. Prerequisites Validation
- ✅ Verifies User Pool exists and is accessible
- ✅ Checks Connect instance connectivity
- ✅ Validates AWS permissions

### 2. SAML Metadata Retrieval
- 📡 Fetches metadata from URL
- 📁 Reads metadata from XML file
- 🔍 Validates metadata format

### 3. Cognito Configuration
- ➕ Creates SAML Identity Provider in Cognito
- 🔄 Updates existing provider if it exists
- 📋 Configures attribute mapping
- 🔧 Updates User Pool Client to support SAML

### 4. Validation
- ✅ Verifies SAML provider creation
- ✅ Confirms User Pool Client configuration
- ✅ Tests connectivity

### 5. Next Steps Guidance
- 📝 Provides configuration URLs for your IdP
- 🧪 Suggests testing procedures
- 🛠️ Lists available API endpoints

## Identity Provider Configuration

After running the script, configure your IdP with these values:

### For Azure Active Directory
1. **Login URL**: `https://your-pool.auth.region.amazoncognito.com/login`
2. **ACS URL**: `https://your-pool.auth.region.amazoncognito.com/saml2/idpresponse`
3. **Entity ID**: Your User Pool ID (format: `us-east-1_XXXXXXXXX`)
4. **Claims Mapping**:
   - Email: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
   - Given Name: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`
   - Family Name: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`

### For Okta
1. **Single Sign-On URL**: `https://your-pool.auth.region.amazoncognito.com/saml2/idpresponse`
2. **Audience URI**: Your User Pool ID
3. **Attribute Statements**:
   - Email: `user.email`
   - First Name: `user.firstName`
   - Last Name: `user.lastName`

## Testing the Integration

### 1. Test SAML Login
```bash
# Using AWS CLI
aws cognito-idp initiate-auth \
  --auth-flow USER_SRP \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=temppassword
```

### 2. Check User Creation
```bash
# List Cognito users
aws cognito-idp list-users --user-pool-id YOUR_USER_POOL_ID

# List Connect users (if applicable)
aws connect list-users --instance-id YOUR_CONNECT_INSTANCE_ID
```

### 3. Use API Endpoints
```bash
# Get SAML configuration
curl -X GET "https://api.todaysdentalinsights.com/connect/saml-auth?action=get_saml_settings" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Register a SAML user
curl -X POST "https://api.todaysdentalinsights.com/connect/saml-auth" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_user",
    "samlEmail": "user@example.com",
    "samlGivenName": "John",
    "samlFamilyName": "Doe",
    "clinicIds": ["123", "456"],
    "role": "ADMIN"
  }'
```

## Troubleshooting

### Common Issues

1. **"ResourceNotFoundException"**
   - Verify User Pool ID is correct
   - Check AWS region matches

2. **"AccessDenied"**
   - Ensure AWS CLI has appropriate IAM permissions
   - Check if you're in the correct AWS account

3. **"Invalid SAML Response"**
   - Verify SAML metadata URL is accessible
   - Check IdP configuration matches Cognito requirements
   - Ensure clocks are synchronized

4. **"User not created in Connect"**
   - Check Connect instance permissions
   - Verify user has proper clinic assignments
   - Review CloudWatch logs

### Debug Commands

```bash
# Check Cognito User Pool
aws cognito-idp describe-user-pool --user-pool-id YOUR_USER_POOL_ID

# List Identity Providers
aws cognito-idp list-identity-providers --user-pool-id YOUR_USER_POOL_ID

# Check User Pool Client
aws cognito-idp describe-user-pool-client --user-pool-id YOUR_USER_POOL_ID --client-id YOUR_CLIENT_ID

# Test Connect connectivity
aws connect describe-instance --instance-id YOUR_CONNECT_INSTANCE_ID
```

## Required IAM Permissions

Your AWS user/role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:*",
        "connect:DescribeInstance",
        "connect:ListUsers"
      ],
      "Resource": "*"
    }
  ]
}
```

## Support

For issues with these scripts:
1. Check the error messages carefully
2. Verify all prerequisites are met
3. Test AWS connectivity first
4. Review CloudWatch logs for detailed errors

For SAML-specific issues:
1. Validate SAML metadata format
2. Check IdP configuration
3. Test with Cognito Hosted UI
4. Contact AWS Support for Cognito/Connect issues
