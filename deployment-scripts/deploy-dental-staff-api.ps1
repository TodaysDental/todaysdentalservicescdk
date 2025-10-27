# PowerShell script to deploy the Dental Staff API
# Usage: .\deploy-dental-staff-api.ps1 <USER_POOL_ID> [OPENDENTAL_API_URL] [OPENDENTAL_API_KEY]

param(
    [Parameter(Mandatory=$true)]
    [string]$UserPoolId,
    
    [Parameter(Mandatory=$false)]
    [string]$OpenDentalApiUrl = "",
    
    [Parameter(Mandatory=$false)]
    [string]$OpenDentalApiKey = ""
)

Write-Host "🚀 Deploying Dental Staff Management API..." -ForegroundColor Green
Write-Host "User Pool ID: $UserPoolId" -ForegroundColor Yellow

# Navigate to project root
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptPath

Push-Location $projectRoot

# Source environment variables
Write-Host "🔧 Setting up environment variables..." -ForegroundColor Yellow
. "$scriptPath\set-environment.ps1"

try {
    # Check if required tools are installed
    Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow
    
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Node.js is not installed or not in PATH" -ForegroundColor Red
        exit 1
    }
    
    if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
        Write-Host "❌ npm is not installed or not in PATH" -ForegroundColor Red
        exit 1
    }

    if (-not (Get-Command "cdk" -ErrorAction SilentlyContinue)) {
        Write-Host "📦 Installing AWS CDK..." -ForegroundColor Yellow
        npm install -g aws-cdk
    }

    # Install dependencies
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install

    # Compile TypeScript
    Write-Host "🔨 Compiling TypeScript..." -ForegroundColor Yellow
    npx tsc

    # Bootstrap CDK if needed
    Write-Host "🏗️  Bootstrapping CDK (if needed)..." -ForegroundColor Yellow
    cdk bootstrap

    # Build the deployment context
    $contextArgs = @(
        "--context", "userPoolId=$UserPoolId"
    )
    
    if ($OpenDentalApiUrl) {
        $contextArgs += "--context", "openDentalApiUrl=$OpenDentalApiUrl"
    }
    
    if ($OpenDentalApiKey) {
        $contextArgs += "--context", "openDentalApiKey=$OpenDentalApiKey"
    }

    # Deploy the stack
    Write-Host "🚀 Deploying Dental Staff API Stack..." -ForegroundColor Yellow
    cdk deploy DentalStaffApiStack @contextArgs --require-approval never

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Deployment completed successfully!" -ForegroundColor Green
        
        # Get the API URL from CDK outputs (this would need to be implemented)
        Write-Host ""
        Write-Host "=== API Information ===" -ForegroundColor Cyan
        Write-Host "Check the AWS CloudFormation console for the API Gateway URL"
        Write-Host "Stack Name: DentalStaffApiStack"
        Write-Host ""
        
        Write-Host "=== Available Endpoints ===" -ForegroundColor Cyan
        Write-Host "GET    /dental-staff/users                           - List all users"
        Write-Host "GET    /dental-staff/users/{email}                   - Get specific user"
        Write-Host "PUT    /dental-staff/users/{email}/attributes        - Update user attributes"
        Write-Host "GET    /dental-staff/users/{email}/groups            - Get user groups"
        Write-Host "POST   /dental-staff/users/{email}/groups            - Add user to group"
        Write-Host "DELETE /dental-staff/users/{email}/groups/{group}    - Remove user from group"
        Write-Host "GET    /dental-staff/groups                          - List all groups"
        Write-Host "POST   /dental-staff/sync/opendental                 - Sync with OpenDental"
        Write-Host "GET    /dental-staff/sync/opendental/status          - Get sync status"
        Write-Host "POST   /dental-staff/sync/opendental/fetch           - Fetch from OpenDental"
        Write-Host "PUT    /dental-staff/sync/opendental/mapping         - Update clinic mapping"
        
    } else {
        Write-Host "❌ Deployment failed" -ForegroundColor Red
        exit 1
    }

catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Test the API endpoints using the documentation"
Write-Host "2. Set up your frontend to use the new API"
Write-Host "3. Configure OpenDental API integration"
Write-Host "4. Set up monitoring and alerts for the API"
