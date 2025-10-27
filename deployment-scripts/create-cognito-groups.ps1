# PowerShell script to create Cognito groups for all clinics
# Usage: .\create-cognito-groups.ps1 <USER_POOL_ID>

param(
    [Parameter(Mandatory=$true)]
    [string]$UserPoolId
)

Write-Host "Creating Cognito groups for all dental clinics..." -ForegroundColor Green
Write-Host "User Pool ID: $UserPoolId" -ForegroundColor Yellow

# Check if USER_POOL_ID environment variable is set, otherwise use parameter
$env:USER_POOL_ID = $UserPoolId

# Navigate to project root if not already there
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptPath

Push-Location $projectRoot

try {
    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        npm install
    }

    # Compile TypeScript if needed
    if (-not (Test-Path "dist/scripts")) {
        Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
        npx tsc
    }

    # Run the script
    Write-Host "Executing Cognito group creation..." -ForegroundColor Yellow
    node dist/scripts/create-cognito-groups.js $UserPoolId

    Write-Host "✅ Cognito group creation completed successfully!" -ForegroundColor Green
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
Write-Host "1. Verify groups were created in AWS Cognito console"
Write-Host "2. Test user assignment to groups"
Write-Host "3. Deploy updated cognito-triggers if needed"
