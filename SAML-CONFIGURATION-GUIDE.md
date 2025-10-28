# SAML 2.0 Configuration Guide for Today's Dental Insights

This guide provides comprehensive instructions for setting up SAML 2.0 authentication with AWS Cognito and Amazon Connect integration.

## Overview

Your system is already architected to support SAML 2.0 authentication for both:
- **AWS Management Console/API access** via Cognito User Pool
- **Amazon Connect access** via federated identity

The infrastructure includes:
- ✅ Cognito User Pool with SAML Identity Provider
- ✅ Connect Integration with SAML user creation
- ✅ API endpoints for SAML user management
- ✅ Group-based access control
- ✅ Attribute-Based Routing (ABR) for Connect

## Prerequisites

- AWS Account with appropriate permissions
- Identity Provider (IdP) that supports SAML 2.0 (Azure AD, Okta, Active Directory, etc.)
- Access to AWS Cognito Console
- Access to Amazon Connect Console

## Quick Setup (Automated)

### 1. Environment Configuration

Set your SAML metadata URL as an environment variable or CDK context:

```bash
# Option 1: Environment Variable
export SAML_METADATA_URL="https://your-idp.com/saml/metadata"

# Option 2: CDK Context (in cdk.json or command line)
cdk deploy -c samlMetadataUrl="https://your-idp.com/saml/metadata"
```

### 2. Deploy Updated Infrastructure

```bash
# Deploy with SAML configuration
npm run build
cdk deploy TodaysDentalInsightsAuthV3 TodaysDentalInsightsCoreV2
```

### 3. Configure Identity Provider in Cognito Console

1. Go to AWS Cognito Console
2. Select your User Pool (TodaysDentalInsightsCoreV2-UserPool)
3. Navigate to **Sign-in experience** → **Authentication providers**
4. Click **Add identity provider**
5. Select **SAML**
6. Configure the provider:
   - **Provider name**: `CognitoSAMLProvider`
   - **Metadata document source**: URL
   - **Metadata document URL**: Your IdP's SAML metadata URL
   - **Attribute mapping**:
     - Email: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
     - Given name: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`
     - Family name: `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`

### 4. Update User Pool Client

1. In Cognito Console, go to **App clients**
2. Select your client
3. Under **Authentication settings**, ensure:
   - ☑️ Enable **CognitoSAMLProvider**
   - ☑️ Enable **Cognito User Pool** (for fallback)

## Manual Setup (Step-by-Step)

### Step 1: Configure Your Identity Provider

#### For Azure Active Directory:

1. **Create Enterprise Application**
   - Go to Azure Portal → Enterprise applications
   - Click **New application** → **Create your own application**
   - Name: `Today's Dental Insights`
   - Select **Integrate any other application**

2. **Configure SAML**
   - Go to **Single sign-on** → **SAML**
   - Download **Certificate (Base64)**
   - Copy **Login URL** and **Azure AD Identifier**

3. **Add Claims**
   - Edit **Attributes & Claims**
   - Add claims for:
     - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` → `user.mail`
     - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` → `user.givenname`
     - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` → `user.surname`
     - `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` → `user.groups`

#### For Okta:

1. **Create Application**
   - Go to Okta Admin → Applications → **Add Application**
   - Select **SAML 2.0** → **Create**

2. **Configure SAML Settings**
   - **Single sign on URL**: `https://todaysdentalinsights.auth.us-east-1.amazoncognito.com/saml2/idpresponse`
   - **Audience URI**: Your Cognito User Pool ID (format: `us-east-1_XXXXXXXXX`)
   - **Attribute Statements**:
     - Email: `user.email`
     - Given name: `user.firstName`
     - Family name: `user.lastName`

### Step 2: Update AWS Cognito

1. **Add SAML Provider**
   ```bash
   # Get your User Pool details
   aws cognito-idp describe-user-pool --user-pool-id YOUR_USER_POOL_ID

   # Create SAML Identity Provider
   aws cognito-idp create-identity-provider \
     --user-pool-id YOUR_USER_POOL_ID \
     --provider-name CognitoSAMLProvider \
     --provider-type SAML \
     --provider-details MetadataURL=https://your-idp.com/saml/metadata
   ```

2. **Update User Pool Client**
   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id YOUR_USER_POOL_ID \
     --client-id YOUR_CLIENT_ID \
     --supported-identity-providers COGNITO CognitoSAMLProvider
   ```

### Step 3: Configure Amazon Connect SAML

Your Connect instance is already configured to work with SAML authentication. Users will be automatically created in Connect when they first authenticate via SAML.

## Testing the Integration

### 1. Test SAML Login

1. **Initiate SAML Authentication**
   ```bash
   # Use the SAML login URL from your Cognito Hosted UI
   # Format: https://todaysdentalinsights.auth.us-east-1.amazoncognito.com/login?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REDIRECT_URI
   ```

2. **Verify User Creation**
   ```bash
   # Check if user was created in Cognito
   aws cognito-idp admin-list-users --user-pool-id YOUR_USER_POOL_ID --filter "email=\"test@example.com\""

   # Check if user was created in Connect
   aws connect list-users --instance-id YOUR_CONNECT_INSTANCE_ID
   ```

### 2. Test Connect Access

1. **Get Federation Token**
   ```bash
   # This should work automatically with SAML authentication
   aws connect get-federation-token --instance-id YOUR_CONNECT_INSTANCE_ID
   ```

2. **Verify User Groups**
   - Check AWS Cognito Console for user groups
   - Verify Connect user has proper routing profile and hierarchy

## API Endpoints for SAML Management

### Admin API (Super Admin Only)

```bash
# Register a SAML user
POST /admin/saml-users
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "action": "register",
  "samlEmail": "user@example.com",
  "samlGivenName": "John",
  "samlFamilyName": "Doe",
  "samlGroups": ["clinic_123_admin", "clinic_456_user"],
  "clinicIds": ["123", "456"],
  "role": "ADMIN"
}

# Sync user clinics and permissions
POST /admin/saml-users
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "action": "sync",
  "samlEmail": "user@example.com",
  "samlGroups": ["clinic_123_admin"],
  "clinicIds": ["123"],
  "role": "ADMIN"
}

# Get user details
GET /admin/saml-users/{email}
Authorization: Bearer <JWT_TOKEN>
```

### Connect API (Authenticated Users)

```bash
# Get user clinics and Connect details
GET /connect/saml-auth?action=get_user_clinics&email=user@example.com
Authorization: Bearer <JWT_TOKEN>
```

## Troubleshooting

### Common Issues

1. **"Invalid SAML Response"**
   - Verify SAML metadata URL is accessible
   - Check IdP configuration matches Cognito expectations
   - Ensure clocks are synchronized between IdP and AWS

2. **"User not found in Connect"**
   - First SAML login creates Connect user automatically
   - Check Connect instance permissions
   - Verify user has proper clinic assignments

3. **"Access denied to clinic"**
   - Check user groups in Cognito
   - Verify clinic IDs match configuration
   - Ensure Attribute-Based Routing is configured

### Debug Commands

```bash
# Check Cognito user groups
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username user@example.com

# Check Connect user details
aws connect describe-user \
  --instance-id YOUR_CONNECT_INSTANCE_ID \
  --user-id CONNECT_USER_ID

# Check Connect routing profile
aws connect describe-routing-profile \
  --instance-id YOUR_CONNECT_INSTANCE_ID \
  --routing-profile-id ROUTING_PROFILE_ID
```

## Security Considerations

1. **Least Privilege**: Users only get access to their assigned clinics
2. **Group Management**: All permissions are managed through Cognito groups
3. **Audit Logging**: All SAML operations are logged in DynamoDB
4. **Session Management**: JWT tokens have appropriate expiration times

## Support

For issues or questions:
1. Check CloudWatch logs for Lambda functions
2. Verify Cognito User Pool settings
3. Test with AWS Cognito Hosted UI first
4. Contact AWS Support for Connect-specific issues

## Architecture Diagram

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SAML IdP      │    │   AWS Cognito   │    │  Amazon Connect │
│ (Azure AD/Okta) │───▶│   User Pool     │───▶│   Instance      │
│                 │    │                 │    │                 │
│ - Users         │    │ - Authentication│    │ - Users         │
│ - Groups        │    │ - Groups        │    │ - Queues        │
│ - Attributes    │    │ - Tokens        │    │ - Routing       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Your App      │
                       │ - Web Console   │
                       │ - Connect CCP   │
                       │ - Mobile App    │
                       └─────────────────┘
```

## Next Steps

1. **Configure your IdP** with the settings above
2. **Test with a single user** before bulk operations
3. **Set up monitoring** for SAML authentication flows
4. **Plan user migration** strategy if moving from existing auth
