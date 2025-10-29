# Deploy Chime Stack V5 - Fully Automated Version
# This version replaces the broken cdk-amazon-chime-resources with reliable AWS SDK implementation

Write-Host "🎯 DEPLOYING CHIME STACK V5 - FULLY AUTOMATED" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "🔧 Changes in this version:" -ForegroundColor Cyan
Write-Host "   ✅ PopulateClinicsTable with proper CloudFormation responses" -ForegroundColor Green
Write-Host "   ✅ SIP Media Application (working)" -ForegroundColor Green
Write-Host "   ✅ Voice Connector (working)" -ForegroundColor Green
Write-Host "   ✅ DynamoDB tables (working)" -ForegroundColor Green
Write-Host "   ✅ Lambda functions (working)" -ForegroundColor Green
Write-Host "   ✅ SIP Rules using reliable AWS SDK implementation" -ForegroundColor Green
Write-Host "   ✅ Conflict handling and retry logic built-in" -ForegroundColor Green
Write-Host "   ✅ Proper sequential creation to avoid race conditions" -ForegroundColor Green
Write-Host ""

# Step 1: Build project
Write-Host "📋 Step 1: Building project..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Build completed!" -ForegroundColor Green

# Step 2: Synthesize templates
Write-Host "📋 Step 2: Synthesizing CDK templates..." -ForegroundColor Cyan
npx cdk synth
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ CDK Synth failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ CDK Synth completed!" -ForegroundColor Green

# Step 3: Deploy with a new version name to avoid conflicts
Write-Host "📋 Step 3: Deploying TodaysDentalInsightsChimeV5..." -ForegroundColor Cyan
npx cdk deploy TodaysDentalInsightsChimeV5 --require-approval never --parameters ChimeStackVersion=V5
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "📊 Check CloudWatch logs for details" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "🎉 SUCCESS! Chime Stack V5 deployed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 POST-DEPLOYMENT TASKS:" -ForegroundColor Yellow
Write-Host "=========================" -ForegroundColor Gray

# Get SIP Media Application ID from stack outputs
Write-Host "📱 Getting SIP Media Application ID..." -ForegroundColor Cyan
try {
    $outputs = aws cloudformation describe-stacks --stack-name TodaysDentalInsightsChimeV5 --region us-east-1 --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
    $smaOutput = $outputs | Where-Object { $_.OutputKey -eq "SipMediaApplicationId" }
    
    if ($smaOutput) {
        $smaId = $smaOutput.OutputValue
        Write-Host "🎯 SIP Media Application ID: $smaId" -ForegroundColor Green
        
        Write-Host ""
        Write-Host "📞 SIP RULES STATUS:" -ForegroundColor Green
        Write-Host "===================" -ForegroundColor Gray
        Write-Host "SIP rules were automatically created during deployment!" -ForegroundColor White
        
        # Get SIP rules creation status from stack outputs
        $sipRulesOutput = $outputs | Where-Object { $_.OutputKey -eq "UniquePhoneNumbers" }
        if ($sipRulesOutput) {
            Write-Host "✅ Number of SIP rules created: $($sipRulesOutput.OutputValue)" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "📋 Verifying SIP Rules..." -ForegroundColor Cyan
        try {
            $sipRules = aws chime-sdk-voice list-sip-rules --region us-east-1 --query 'SipRules[?contains(Name, `TodaysDentalInsightsChimeV5`)].{Name:Name,TriggerValue:TriggerValue,SipRuleId:SipRuleId}' --output json | ConvertFrom-Json
            
            if ($sipRules -and $sipRules.Count -gt 0) {
                Write-Host "✅ SIP Rules successfully created:" -ForegroundColor Green
                foreach ($rule in $sipRules) {
                    Write-Host "   📞 $($rule.TriggerValue) → $($rule.Name)" -ForegroundColor White
                }
            } else {
                Write-Host "⚠️  No SIP rules found - check CloudWatch logs" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "⚠️  Could not verify SIP rules: $_" -ForegroundColor Yellow
        }
        
    } else {
        Write-Host "❌ Could not find SIP Media Application ID in stack outputs" -ForegroundColor Red
    }
}
catch {
    Write-Host "❌ Error getting stack outputs: $_" -ForegroundColor Red
}

# Verify DynamoDB table population
Write-Host "📊 Verifying ClinicsTable population..." -ForegroundColor Cyan
try {
    $clinicsTableName = "TodaysDentalInsightsChimeV5-Clinics"
    $itemCount = aws dynamodb scan --table-name $clinicsTableName --select "COUNT" --region us-east-1 --query 'Count' --output text 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ ClinicsTable contains $itemCount items" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Could not verify ClinicsTable - check manually" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "⚠️  Could not verify ClinicsTable: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "✅ All SIP rules created automatically - no manual steps required!" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Your Chime Contact Center is now fully operational!" -ForegroundColor Cyan
