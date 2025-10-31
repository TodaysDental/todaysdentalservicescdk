#!/usr/bin/env powershell
# Deploy AdminStack to fix Chime API 500 error

Write-Host "🚀 Deploying AdminStack to fix Chime API..." -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Ensure dependencies are deployed..." -ForegroundColor Yellow
Write-Host "Deploying CoreStack first..." -ForegroundColor White
npx cdk deploy TodaysDentalInsightsCoreV2 --require-approval never

Write-Host ""
Write-Host "Step 2: Ensure ChimeStack is deployed and exporting ARNs..." -ForegroundColor Yellow
npx cdk deploy TodaysDentalInsightsChimeV5 --require-approval never

Write-Host ""
Write-Host "Step 3: Deploy AdminStack (this creates the API Gateway integration)..." -ForegroundColor Yellow
npx cdk deploy TodaysDentalInsightsAdminV3 --require-approval never

Write-Host ""
Write-Host "✅ Deployment complete! Test the API with:" -ForegroundColor Green
Write-Host ".\simple-api-test.ps1" -ForegroundColor White

Write-Host ""
Write-Host "📋 What this fixed:" -ForegroundColor Cyan
Write-Host "• ChimeStack Lambda functions exist but weren't connected to API Gateway" -ForegroundColor White
Write-Host "• AdminStack creates the /admin/chime/* API endpoints" -ForegroundColor White
Write-Host "• AdminStack imports Lambda ARNs from ChimeStack and creates integrations" -ForegroundColor White



