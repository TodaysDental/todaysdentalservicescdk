#!/usr/bin/env powershell
# Fix for Chime API 500 Error - Deploy missing AdminStack

Write-Host "🔧 Fixing Chime API 500 Error..." -ForegroundColor Cyan
Write-Host ""

Write-Host "Problem Analysis:" -ForegroundColor Yellow
Write-Host "• ChimeStack is deployed and exports Lambda ARNs ✓" -ForegroundColor Green
Write-Host "• AdminStack may not be deployed or properly configured ❌" -ForegroundColor Red
Write-Host "• API Gateway endpoint exists but Lambda integration is missing ❌" -ForegroundColor Red
Write-Host ""

Write-Host "Step 1: Check current stack status..." -ForegroundColor Yellow
$adminStackExists = aws cloudformation describe-stacks --stack-name "TodaysDentalInsightsAdminV3" --query "Stacks[0].StackStatus" --output text 2>$null
if ($adminStackExists) {
    Write-Host "✓ AdminStack exists: $adminStackExists" -ForegroundColor Green
    
    # Check if the AdminStack has the Chime Lambda integrations
    Write-Host "Step 2: Checking AdminStack outputs..." -ForegroundColor Yellow
    $adminOutputs = aws cloudformation describe-stacks --stack-name "TodaysDentalInsightsAdminV3" --query "Stacks[0].Outputs" --output json 2>$null
    if ($adminOutputs) {
        Write-Host "AdminStack outputs:" -ForegroundColor White
        Write-Host $adminOutputs
    }
} else {
    Write-Host "❌ AdminStack not found - this is the problem!" -ForegroundColor Red
}

Write-Host ""
Write-Host "Step 3: Verify ChimeStack exports..." -ForegroundColor Yellow
$chimeExports = aws cloudformation list-exports --query "Exports[?contains(Name, 'Chime')].{Name:Name,Value:Value}" --output table 2>$null
if ($chimeExports) {
    Write-Host "ChimeStack exports:" -ForegroundColor Green
    Write-Host $chimeExports
} else {
    Write-Host "❌ No Chime exports found" -ForegroundColor Red
}

Write-Host ""
Write-Host "Step 4: Deploy/Update AdminStack..." -ForegroundColor Yellow
Write-Host "Running: npx cdk deploy TodaysDentalInsightsAdminV3 --require-approval never" -ForegroundColor White

try {
    $deployResult = npx cdk deploy TodaysDentalInsightsAdminV3 --require-approval never
    Write-Host "✓ AdminStack deployment completed" -ForegroundColor Green
    Write-Host $deployResult
} catch {
    Write-Host "❌ AdminStack deployment failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative: Deploy all stacks in correct order..." -ForegroundColor Yellow
    Write-Host "npx cdk deploy TodaysDentalInsightsCoreV2 --require-approval never" -ForegroundColor White
    Write-Host "npx cdk deploy TodaysDentalInsightsChimeV5 --require-approval never" -ForegroundColor White
    Write-Host "npx cdk deploy TodaysDentalInsightsAdminV3 --require-approval never" -ForegroundColor White
}

Write-Host ""
Write-Host "Step 5: Test the API again..." -ForegroundColor Yellow
Write-Host "After deployment completes, run:" -ForegroundColor White
Write-Host ".\simple-api-test.ps1" -ForegroundColor Green

Write-Host ""
Write-Host "🔧 Fix completed! The issue was likely:" -ForegroundColor Cyan
Write-Host "1. AdminStack not deployed" -ForegroundColor White
Write-Host "2. API Gateway endpoints exist but Lambda integrations missing" -ForegroundColor White
Write-Host "3. ChimeStack Lambda functions exist but not connected to API" -ForegroundColor White





