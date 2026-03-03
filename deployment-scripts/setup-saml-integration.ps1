# SAML Integration Setup Script for PowerShell
#
# This script automates the SAML 2.0 configuration process for:
# - AWS Cognito User Pool SAML Identity Provider
# - Amazon Connect Integration
# - User Pool Client Configuration
# - Testing and Validation
#
# Usage:
#   .\setup-saml-integration.ps1 -MetadataUrl "https://your-idp.com/saml/metadata"
#   .\setup-saml-integration.ps1 -MetadataFile "path/to/metadata.xml"
#   .\setup-saml-integration.ps1 -Interactive
#

param(
    [string]$MetadataUrl,
    [string]$MetadataFile,
    [string]$UserPoolId,
    [string]$Region = "us-east-1",
    [string]$ProviderName = "CognitoSAMLProvider",
    [switch]$Interactive,
    [switch]$ValidateOnly
)

# Set AWS region
$env:AWS_REGION = $Region

# Import AWS PowerShell modules if not already loaded
if (-not (Get-Module -Name AWSPowerShell.NetCore)) {
    Import-Module AWSPowerShell.NetCore
}

function Write-Step {
    param([string]$Message)
    Write-Host "📋 $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Read-UserInput {
    param([string]$Prompt)
    Write-Host $Prompt -ForegroundColor Yellow -NoNewline
    return Read-Host
}

function Test-Prerequisites {
    Write-Step "Validating prerequisites..."

    if (-not $UserPoolId) {
        $UserPoolId = $env:USER_POOL_ID
        if (-not $UserPoolId) {
            $UserPoolId = Read-UserInput "Enter User Pool ID: "
        }
    }

    if (-not $UserPoolId) {
        throw "USER_POOL_ID is required"
    }

    try {
        $userPool = Get-CGIPUserPool -UserPoolId $UserPoolId -ErrorAction Stop
        Write-Success "User Pool found: $($userPool.Name) ($UserPoolId)"
    }
    catch {
        throw "User Pool $UserPoolId not found: $_"
    }

    # Check Connect instance
    $connectInstanceId = $env:CONNECT_INSTANCE_ID
    if (-not $connectInstanceId) {
        $connectInstanceId = "147f641d-ae2f-4d9f-8126-5ac2ff0c26f4"
    }

    try {
        $connectInstance = Get-CONNInstance -InstanceId $connectInstanceId -ErrorAction Stop
        Write-Success "Connect instance found: $connectInstanceId"
    }
    catch {
        Write-Warning "Connect instance $connectInstanceId not accessible: $_"
    }

    Write-Success "Prerequisites validated"
    return $UserPoolId
}

function Get-SAMLMetadata {
    Write-Step "Retrieving SAML metadata..."

    if ($env:SAML_METADATA_XML) {
        Write-Success "Using SAML metadata from environment variable"
        return $env:SAML_METADATA_XML
    }

    if ($MetadataUrl) {
        Write-Host "📡 Fetching metadata from URL: $MetadataUrl" -ForegroundColor Cyan
        return Get-SAMLMetadataFromUrl -Url $MetadataUrl
    }

    if ($MetadataFile) {
        Write-Host "📁 Reading metadata from file: $MetadataFile" -ForegroundColor Cyan
        return Get-SAMLMetadataFromFile -FilePath $MetadataFile
    }

    if ($Interactive) {
        $url = Read-UserInput "Enter your SAML metadata URL: "
        if ($url) {
            return Get-SAMLMetadataFromUrl -Url $url
        }

        $file = Read-UserInput "Enter path to SAML metadata file: "
        if ($file) {
            return Get-SAMLMetadataFromFile -FilePath $file
        }
    }

    throw "No SAML metadata provided"
}

function Get-SAMLMetadataFromUrl {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing
        if ($response.StatusCode -ne 200) {
            throw "HTTP $($response.StatusCode): $($response.StatusDescription)"
        }

        $content = $response.Content
        if (-not $content.Contains("EntityDescriptor")) {
            throw "Response does not appear to be valid SAML metadata"
        }

        return $content
    }
    catch {
        throw "Failed to fetch metadata from URL: $_"
    }
}

function Get-SAMLMetadataFromFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        throw "File not found: $FilePath"
    }

    $content = Get-Content $FilePath -Raw
    if (-not $content.Contains("EntityDescriptor")) {
        throw "File does not appear to be valid SAML metadata"
    }

    return $content
}

function Set-CognitoSAMLProvider {
    param(
        [string]$UserPoolId,
        [string]$ProviderName,
        [string]$MetadataXml
    )

    Write-Step "Configuring Cognito SAML Identity Provider..."

    try {
        # Check if provider already exists
        $existingProviders = Get-CGIPIdentityProviderList -UserPoolId $UserPoolId

        $samlProvider = $existingProviders.IdentityProviders | Where-Object {
            $_.ProviderName -eq $ProviderName
        }

        $metadataBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($MetadataXml))

        if ($samlProvider) {
            Write-Host "🔄 Updating existing SAML provider: $ProviderName" -ForegroundColor Cyan
            Update-CGIPIdentityProvider -UserPoolId $UserPoolId `
                -ProviderName $ProviderName `
                -ProviderDetail_MetadataFile $metadataBase64 `
                -AttributeMapping @{
                    "email" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
                    "given_name" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
                    "family_name" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
                    "cognito:username" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
                } -ErrorAction Stop
        }
        else {
            Write-Host "➕ Creating new SAML provider: $ProviderName" -ForegroundColor Cyan
            New-CGIPIdentityProvider -UserPoolId $UserPoolId `
                -ProviderName $ProviderName `
                -ProviderType "SAML" `
                -ProviderDetail_MetadataFile $metadataBase64 `
                -AttributeMapping @{
                    "email" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
                    "given_name" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
                    "family_name" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
                    "cognito:username" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
                } -ErrorAction Stop
        }

        Write-Success "SAML provider $ProviderName configured successfully"
    }
    catch {
        Write-Error "Failed to configure SAML provider: $_"
        throw
    }
}

function Update-UserPoolClient {
    param([string]$UserPoolId)

    Write-Step "Updating User Pool Client..."

    try {
        # Get current client configuration
        $clients = Get-CGIPUserPoolClientList -UserPoolId $UserPoolId
        $client = $clients.UserPoolClients[0]

        if (-not $client) {
            throw "No User Pool Client found"
        }

        # Update client to include SAML provider
        Update-CGIPUserPoolClient -UserPoolId $UserPoolId `
            -ClientId $client.ClientId `
            -SupportedIdentityProvider "COGNITO", $ProviderName `
            -ExplicitAuthFlow "ALLOW_USER_SRP_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH" `
            -ErrorAction Stop

        Write-Success "User Pool Client updated to support SAML authentication"
    }
    catch {
        Write-Error "Failed to update User Pool Client: $_"
        throw
    }
}

function Test-Configuration {
    param([string]$UserPoolId)

    Write-Step "Validating SAML configuration..."

    try {
        # Check SAML provider
        $providers = Get-CGIPIdentityProviderList -UserPoolId $UserPoolId

        $samlProvider = $providers.IdentityProviders | Where-Object {
            $_.ProviderName -eq $ProviderName
        }

        if (-not $samlProvider) {
            throw "SAML provider $ProviderName not found"
        }

        # Check User Pool Client
        $clients = Get-CGIPUserPoolClientList -UserPoolId $UserPoolId
        $client = $clients.UserPoolClients[0]

        if (-not $client) {
            throw "No User Pool Client found"
        }

        $hasSAML = $client.SupportedIdentityProviders -contains $ProviderName
        if (-not $hasSAML) {
            throw "User Pool Client does not support $ProviderName"
        }

        Write-Success "SAML configuration validated successfully"
        Write-Host "   - Provider: $ProviderName" -ForegroundColor Green
        Write-Host "   - Client supports: $($client.SupportedIdentityProviders -join ', ')" -ForegroundColor Green
        Write-Host "   - Login URL: https://$($UserPoolId.Split('_')[0]).auth.$Region.amazoncognito.com/login" -ForegroundColor Green

    }
    catch {
        Write-Error "Configuration validation failed: $_"
        throw
    }
}

function Show-NextSteps {
    param([string]$UserPoolId)

    Write-Host ""
    Write-Host "🎉 SAML setup completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Next Steps:" -ForegroundColor Cyan
    Write-Host "1. 📱 Configure your Identity Provider (IdP):" -ForegroundColor Yellow
    Write-Host "   - Login URL: https://$($UserPoolId.Split('_')[0]).auth.$Region.amazoncognito.com/login" -ForegroundColor White
    Write-Host "   - ACS URL: https://$($UserPoolId.Split('_')[0]).auth.$Region.amazoncognito.com/saml2/idpresponse" -ForegroundColor White
    Write-Host "   - Entity ID: $UserPoolId" -ForegroundColor White
    Write-Host "   - Attribute mapping:" -ForegroundColor White
    Write-Host "     * Email: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" -ForegroundColor White
    Write-Host "     * Given Name: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname" -ForegroundColor White
    Write-Host "     * Family Name: http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname" -ForegroundColor White

    Write-Host ""
    Write-Host "2. 🧪 Test the integration:" -ForegroundColor Yellow
    Write-Host "   - Try logging in with a SAML user" -ForegroundColor White
    Write-Host "   - Verify user is created in Cognito" -ForegroundColor White
    Write-Host "   - Check Connect user creation" -ForegroundColor White

    Write-Host ""
    Write-Host "3. 🛠️ Use the API endpoints:" -ForegroundColor Yellow
    Write-Host "   - POST /connect/saml-auth?action=register_user (register SAML users)" -ForegroundColor White
    Write-Host "   - GET /connect/saml-auth?action=get_saml_settings (get configuration)" -ForegroundColor White
    Write-Host "   - POST /admin/saml-users (admin user management)" -ForegroundColor White

    Write-Host ""
    Write-Host "4. 📊 Monitor and troubleshoot:" -ForegroundColor Yellow
    Write-Host "   - Check CloudWatch logs for Lambda functions" -ForegroundColor White
    Write-Host "   - Monitor Cognito User Pool metrics" -ForegroundColor White
    Write-Host "   - Review Connect instance logs" -ForegroundColor White
}

# Main execution
try {
    Write-Host "🔐 Starting SAML Integration Setup..." -ForegroundColor Green
    Write-Host ""

    # Validate prerequisites
    $UserPoolId = Test-Prerequisites

    # Get SAML metadata
    $metadataXml = Get-SAMLMetadata

    # Configure Cognito SAML Provider
    Set-CognitoSAMLProvider -UserPoolId $UserPoolId -ProviderName $ProviderName -MetadataXml $metadataXml

    # Update User Pool Client
    Update-UserPoolClient -UserPoolId $UserPoolId

    # Validate configuration
    Test-Configuration -UserPoolId $UserPoolId

    # Show next steps
    Show-NextSteps -UserPoolId $UserPoolId

    Write-Host ""
    Write-Success "SAML integration setup completed successfully!"
}
catch {
    Write-Error "SAML setup failed: $_"
    exit 1
}
