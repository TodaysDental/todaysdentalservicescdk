# CloudFormation Chime Stack Recovery Script
# Run this script to clean up the failed stack and redeploy with fixes

Write-Host "🔥 Starting CloudFormation Chime Stack Recovery..." -ForegroundColor Yellow

# Step 1: Try to delete the failed stack
Write-Host "📋 Step 1: Attempting to delete failed stack..." -ForegroundColor Cyan
try {
    aws cloudformation delete-stack --stack-name TodaysDentalInsightsChimeV3 --region us-east-1
    Write-Host "✅ Delete command sent. Waiting for stack deletion..." -ForegroundColor Green
    
    # Wait for stack deletion (with timeout)
    $timeout = 300 # 5 minutes
    $elapsed = 0
    $interval = 30
    
    do {
        Start-Sleep $interval
        $elapsed += $interval
        $status = aws cloudformation describe-stacks --stack-name TodaysDentalInsightsChimeV3 --region us-east-1 --query 'Stacks[0].StackStatus' --output text 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✅ Stack successfully deleted!" -ForegroundColor Green
            break
        }
        
        Write-Host "⏳ Stack status: $status (elapsed: ${elapsed}s)" -ForegroundColor Yellow
        
        if ($status -eq "DELETE_FAILED") {
            Write-Host "❌ Stack deletion failed. Manual intervention required." -ForegroundColor Red
            Write-Host "🔧 Please check AWS Console and manually delete stuck resources." -ForegroundColor Yellow
            Write-Host "📊 Check CloudWatch logs: /aws/lambda/TodaysDentalInsightsChimeV3-PopulateTableFn" -ForegroundColor Cyan
            exit 1
        }
        
    } while ($elapsed -lt $timeout)
    
    if ($elapsed -ge $timeout) {
        Write-Host "⏰ Timeout waiting for stack deletion. Please check AWS Console." -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "❌ Error deleting stack: $_" -ForegroundColor Red
    Write-Host "🔧 You may need to manually delete the stack from AWS Console" -ForegroundColor Yellow
    exit 1
}

# Step 2: Build the project
Write-Host "📋 Step 2: Building project..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Build completed successfully!" -ForegroundColor Green

# Step 3: Synth CDK to verify templates
Write-Host "📋 Step 3: Synthesizing CDK templates..." -ForegroundColor Cyan
npx cdk synth
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ CDK Synth failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ CDK Synth completed successfully!" -ForegroundColor Green

# Step 4: Deploy with fixes
Write-Host "📋 Step 4: Deploying fixed Chime stack..." -ForegroundColor Cyan
Write-Host "🔧 This includes fixes for:" -ForegroundColor Yellow
Write-Host "   - PopulateClinicsTable CloudFormation responses" -ForegroundColor Yellow
Write-Host "   - Duplicate phone number handling" -ForegroundColor Yellow
Write-Host "   - Enhanced error handling" -ForegroundColor Yellow

npx cdk deploy TodaysDentalInsightsChimeV3 --require-approval never
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "📊 Check CloudWatch logs for details" -ForegroundColor Cyan
    exit 1
}

Write-Host "🎉 SUCCESS! Chime stack deployed successfully!" -ForegroundColor Green
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Verify SIP rules were created for unique phone numbers" -ForegroundColor White
Write-Host "   2. Check DynamoDB ClinicsTable population" -ForegroundColor White
Write-Host "   3. Test SIP Media Application functionality" -ForegroundColor White
Write-Host "   4. Assign unique phone numbers to remaining clinics" -ForegroundColor White

# Show which clinics got SIP rules
Write-Host "📞 Phone numbers with SIP rules created:" -ForegroundColor Cyan
aws chime-sdk-voice list-sip-rules --region us-east-1 --query 'SipRules[?contains(Name, `TodaysDentalInsightsChimeV3`)].{Name:Name,TriggerValue:TriggerValue}' --output table

Write-Host "✅ Recovery completed successfully!" -ForegroundColor Green
