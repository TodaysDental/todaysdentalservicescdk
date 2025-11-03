#!/usr/bin/env pwsh
# CORS Fix Deployment Script
# This script deploys the CORS fixes for the Chime Contact Center API

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "CORS Fix Deployment for Chime Stack" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the correct directory
if (-not (Test-Path "cdk.json")) {
    Write-Host "Error: cdk.json not found. Please run this script from the todaysdentalinsightscdk directory." -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Build failed. Please fix TypeScript errors and try again." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build successful" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Deploying Chime Stack..." -ForegroundColor Yellow
Write-Host "This will update the following:" -ForegroundColor Gray
Write-Host "  - Fix CORS OPTIONS handler to properly echo requesting origin" -ForegroundColor Gray
Write-Host "  - Add proxy:true to all Lambda integrations" -ForegroundColor Gray
Write-Host "  - Deploy 3 new endpoints: call-accepted, call-rejected, call-hungup" -ForegroundColor Gray
Write-Host ""

cdk deploy TodaysDentalInsightsChimeV5 --require-approval never
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Deployment failed." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Deployment successful" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Test the CORS fix by making a request from https://todaysdentalinsights.com" -ForegroundColor White
Write-Host "2. Verify OPTIONS preflight returns 200 with correct CORS headers" -ForegroundColor White
Write-Host "3. If everything works, deploy the frontend changes" -ForegroundColor White
Write-Host ""

Write-Host "API Endpoints now available:" -ForegroundColor Yellow
Write-Host "  ✓ POST /admin/chime/start-session" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/stop-session" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/outbound-call" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/transfer-call" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/call-accepted" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/call-rejected" -ForegroundColor Green
Write-Host "  ✓ POST /admin/chime/call-hungup" -ForegroundColor Green
Write-Host ""

Write-Host "For detailed information, see CORS-FIX-DEPLOYMENT.md" -ForegroundColor Cyan






