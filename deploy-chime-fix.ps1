#!/usr/bin/env powershell
# Deploy script for Chime API fix

Write-Host "Deploying Chime API Fix..." -ForegroundColor Cyan
Write-Host ""

Write-Host "This script will:" -ForegroundColor Yellow
Write-Host "1. Deploy the updated Admin stack (if needed)"
Write-Host "2. Deploy the updated Chime stack with proper API integration"
Write-Host ""

# Check if AWS CLI is configured
Write-Host "Checking AWS credentials..." -ForegroundColor Yellow
aws sts get-caller-identity | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: AWS credentials not configured!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ AWS credentials configured" -ForegroundColor Green
Write-Host ""

# Build the project
Write-Host "Building the project..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build successful" -ForegroundColor Green
Write-Host ""

# Synthesize CDK
Write-Host "Synthesizing CDK..." -ForegroundColor Yellow
npx cdk synth
if ($LASTEXITCODE -ne 0) {
    Write-Host "CDK synth failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ CDK synth successful" -ForegroundColor Green
Write-Host ""

# Deploy Admin stack first (in case it needs updates)
Write-Host "Deploying Admin stack..." -ForegroundColor Yellow
npx cdk deploy TodaysDentalInsightsAdminV3 --require-approval never
if ($LASTEXITCODE -ne 0) {
    Write-Host "Admin stack deployment failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Admin stack deployed" -ForegroundColor Green
Write-Host ""

# Deploy Chime stack
Write-Host "Deploying Chime stack with API integration..." -ForegroundColor Yellow
npx cdk deploy TodaysDentalInsightsChimeV5 --require-approval never
if ($LASTEXITCODE -ne 0) {
    Write-Host "Chime stack deployment failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Chime stack deployed" -ForegroundColor Green
Write-Host ""

Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "The following endpoints should now be available:" -ForegroundColor Cyan
Write-Host "  - POST /admin/chime/start-session" -ForegroundColor White
Write-Host "  - POST /admin/chime/stop-session" -ForegroundColor White
Write-Host "  - POST /admin/chime/outbound-call" -ForegroundColor White
Write-Host "  - POST /admin/chime/transfer-call" -ForegroundColor White
Write-Host "  - POST /admin/chime/call-accepted" -ForegroundColor White
Write-Host "  - POST /admin/chime/call-rejected" -ForegroundColor White
Write-Host "  - POST /admin/chime/call-hungup" -ForegroundColor White
Write-Host ""
Write-Host "You can now test the API using ./simple-api-test.ps1" -ForegroundColor Yellow

