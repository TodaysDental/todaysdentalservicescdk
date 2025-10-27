# Dental Chatbot Deployment Script (PowerShell)
# This script deploys the chatbot stack and runs initial data migration

param(
    [switch]$SkipMigration,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Dental Chatbot Deployment Script

Usage: .\deploy-chatbot.ps1 [options]

Options:
  -SkipMigration    Skip the data migration step
  -Help            Show this help message

Examples:
  .\deploy-chatbot.ps1                    # Deploy and prompt for migration
  .\deploy-chatbot.ps1 -SkipMigration     # Deploy without migration
"@
    exit 0
}

# Colors for output
function Write-Status {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param($Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param($Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

Write-Host "[Deploy] Starting Dental Chatbot Deployment..." -ForegroundColor Cyan

# Check prerequisites
Write-Status "Checking prerequisites..."

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Success "Node.js is installed: $nodeVersion"
} catch {
    Write-Error "Node.js is not installed. Please install Node.js 18.x or higher."
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Success "npm is installed: $npmVersion"
} catch {
    Write-Error "npm is not installed. Please install npm."
    exit 1
}

# Check AWS CLI
try {
    $awsVersion = aws --version
    Write-Success "AWS CLI is installed: $awsVersion"
} catch {
    Write-Error "AWS CLI is not installed. Please install and configure AWS CLI."
    exit 1
}

# Check CDK
try {
    $cdkVersion = cdk --version
    Write-Success "AWS CDK is installed: $cdkVersion"
} catch {
    Write-Error "AWS CDK is not installed. Please install with: npm install -g aws-cdk"
    exit 1
}

# Check AWS credentials
Write-Status "Checking AWS credentials..."
try {
    $callerIdentity = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Success "AWS credentials are configured for account: $($callerIdentity.Account)"
} catch {
    Write-Error "AWS credentials not configured. Please run 'aws configure'"
    exit 1
}

# Install dependencies
Write-Status "Installing dependencies..."
try {
    npm install
    Write-Success "Main dependencies installed!"
} catch {
    Write-Error "Failed to install dependencies!"
    exit 1
}

# Install common layer dependencies
Write-Status "Installing common layer dependencies..."
try {
    Push-Location "chatbot-layers\common"
    npm install
    Pop-Location
    Write-Success "Common layer dependencies installed!"
} catch {
    Write-Error "Failed to install common layer dependencies!"
    exit 1
}

# Build the project
Write-Status "Building the project..."
try {
    npm run build
    Write-Success "Project built successfully!"
} catch {
    Write-Error "Failed to build project!"
    exit 1
}

# Deploy the chatbot stack
Write-Status "Deploying the chatbot stack..."
Write-Host "This may take several minutes..." -ForegroundColor Yellow

try {
    cdk deploy TodaysDentalInsightsChatbotV2 --require-approval never
    Write-Success "Chatbot stack deployed successfully!"
} catch {
    Write-Error "Failed to deploy chatbot stack!"
    exit 1
}

# Get the API endpoints
Write-Status "Getting API endpoints..."
try {
    $restApiUrl = aws cloudformation describe-stacks `
        --stack-name TodaysDentalInsightsChatbotV2 `
        --query 'Stacks[0].Outputs[?OutputKey==`RestApiEndpoint`].OutputValue' `
        --output text

    $websocketApiUrl = aws cloudformation describe-stacks `
        --stack-name TodaysDentalInsightsChatbotV2 `
        --query 'Stacks[0].Outputs[?OutputKey==`WebSocketApiEndpoint`].OutputValue' `
        --output text

    Write-Success "Deployment completed successfully!"
    Write-Host ""
    Write-Host "[Info] API Endpoints:" -ForegroundColor Cyan
    Write-Host "   REST API: $restApiUrl" -ForegroundColor White
    Write-Host "   WebSocket API: $websocketApiUrl" -ForegroundColor White
    Write-Host ""
} catch {
    Write-Warning "Could not retrieve API endpoints. Check CloudFormation outputs manually."
}

# Run data migration
if (-not $SkipMigration) {
    Write-Warning "Would you like to run the data migration now? (y/n)"
    $response = Read-Host

    if ($response -match '^[Yy]$') {
        Write-Status "Data migration setup..."
        
        Write-Host "To run data migration, you need to:" -ForegroundColor Yellow
        Write-Host "1. Get a Cognito authentication token" -ForegroundColor White
        Write-Host "2. Make a POST request to: ${restApiUrl}migrate" -ForegroundColor White
        Write-Host "3. Include the token in Authorization header" -ForegroundColor White
        Write-Host ""
        Write-Host "Example PowerShell command:" -ForegroundColor Cyan
        $exampleCommand = @"
`$headers = @{
    'Authorization' = 'Bearer <your-cognito-token>'
    'Content-Type' = 'application/json'
}
`$body = @{
    type = 'all'
} | ConvertTo-Json

Invoke-RestMethod -Uri '${restApiUrl}migrate' -Method POST -Headers `$headers -Body `$body
"@
        Write-Host $exampleCommand -ForegroundColor White
        Write-Host ""
        Write-Warning "Please run the migration manually with proper authentication."
    } else {
        Write-Status "Skipping data migration. You can run it later."
    }
} else {
    Write-Status "Skipping data migration as requested."
}

Write-Host ""
Write-Success "[Success] Deployment completed!" 
Write-Host ""
Write-Host "[Next] Next Steps:" -ForegroundColor Cyan
Write-Host "1. Update your DNS to point api.todaysdentalinsights.com to the API Gateway (if using custom domain)" -ForegroundColor White
Write-Host "2. Run data migration to populate initial clinic data" -ForegroundColor White
Write-Host "3. Test WebSocket connection: wss://api.todaysdentalinsights.com?clinicId=dentistinnewbritain" -ForegroundColor White
Write-Host "4. Test REST API endpoints for CRUD operations" -ForegroundColor White
Write-Host ""
Write-Host "[Docs] Documentation: See CHATBOT_README.md for detailed usage instructions" -ForegroundColor Cyan
Write-Host ""
Write-Success "Happy chatting! [Robot]"
