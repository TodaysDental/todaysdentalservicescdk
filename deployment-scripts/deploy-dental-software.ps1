# Dental Software Stack Deployment Script
# This script prepares and deploys the Dental Software Stack

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Dental Software Stack Deployment" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install MySQL Layer Dependencies
Write-Host "[Step 1/4] Installing MySQL layer dependencies..." -ForegroundColor Yellow
$mysqlLayerPath = "src\shared\layers\mysql-layer"

if (Test-Path $mysqlLayerPath) {
    Push-Location $mysqlLayerPath
    
    # Create nodejs directory structure required by Lambda layers
    if (-not (Test-Path "nodejs")) {
        New-Item -ItemType Directory -Path "nodejs" -Force | Out-Null
    }
    
    # Install dependencies into nodejs directory
    Write-Host "Installing mysql2 package..." -ForegroundColor Gray
    npm install --prefix nodejs
    
    Pop-Location
    Write-Host "✓ MySQL layer dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ MySQL layer directory not found: $mysqlLayerPath" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Check Environment Variables
Write-Host "[Step 2/4] Checking environment variables..." -ForegroundColor Yellow

$jwtSecret = $env:JWT_SECRET
if ([string]::IsNullOrWhiteSpace($jwtSecret)) {
    Write-Host "✗ JWT_SECRET environment variable is not set" -ForegroundColor Red
    Write-Host "  Please set it using: `$env:JWT_SECRET='your-secret-key'" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "✓ JWT_SECRET is configured" -ForegroundColor Green
}

$awsRegion = $env:AWS_REGION
if ([string]::IsNullOrWhiteSpace($awsRegion)) {
    Write-Host "⚠ AWS_REGION not set, using default" -ForegroundColor Yellow
    $env:AWS_REGION = "us-east-1"
} else {
    Write-Host "✓ AWS_REGION: $awsRegion" -ForegroundColor Green
}

Write-Host ""

# Step 3: Build TypeScript
Write-Host "[Step 3/4] Building TypeScript..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Build completed successfully" -ForegroundColor Green
Write-Host ""

# Step 4: Deploy Stack
Write-Host "[Step 4/4] Deploying Dental Software Stack..." -ForegroundColor Yellow
Write-Host "This will create:" -ForegroundColor Gray
Write-Host "  - VPC with public, private, and isolated subnets" -ForegroundColor Gray
Write-Host "  - RDS MySQL database (db.t3.micro)" -ForegroundColor Gray
Write-Host "  - S3 bucket for clinic data" -ForegroundColor Gray
Write-Host "  - Lambda functions for CRUD operations" -ForegroundColor Gray
Write-Host "  - API Gateway with custom domain" -ForegroundColor Gray
Write-Host ""

$confirmation = Read-Host "Continue with deployment? (y/n)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "Deployment cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Deploying stack (this may take 10-15 minutes)..." -ForegroundColor Cyan

cdk deploy TodaysDentalInsightsDentalSoftwareN1 --require-approval never

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=====================================" -ForegroundColor Green
    Write-Host "✓ Deployment Successful!" -ForegroundColor Green
    Write-Host "=====================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "1. Initialize the database by calling:" -ForegroundColor White
    Write-Host "   POST https://apig.todaysdentalinsights.com/dental-software/init-database" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Test the API endpoints:" -ForegroundColor White
    Write-Host "   GET  https://apig.todaysdentalinsights.com/dental-software/clinics" -ForegroundColor Gray
    Write-Host "   POST https://apig.todaysdentalinsights.com/dental-software/clinics" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. See full documentation in:" -ForegroundColor White
    Write-Host "   docs\DENTAL-SOFTWARE-STACK.md" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "✗ Deployment failed" -ForegroundColor Red
    Write-Host "Check the error messages above for details" -ForegroundColor Yellow
    exit 1
}

