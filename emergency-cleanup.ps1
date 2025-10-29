# Emergency CloudFormation Stack Cleanup Script
# Handles multiple failed Chime stacks (V3, V4) and stuck resources

param(
    [switch]$DryRun = $false,
    [switch]$ForceDelete = $false
)

Write-Host "🚨 EMERGENCY CLOUDFORMATION CLEANUP SCRIPT" -ForegroundColor Red
Write-Host "=============================================" -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "🔍 DRY RUN MODE - No actual changes will be made" -ForegroundColor Cyan
}

# List of potentially stuck stacks
$stacks = @(
    "TodaysDentalInsightsChimeV3",
    "TodaysDentalInsightsChimeV4"
)

foreach ($stackName in $stacks) {
    Write-Host ""
    Write-Host "📋 Processing stack: $stackName" -ForegroundColor Yellow
    Write-Host "=================================" -ForegroundColor Gray
    
    # Check stack status
    try {
        $stackInfo = aws cloudformation describe-stacks --stack-name $stackName --region us-east-1 --query 'Stacks[0]' --output json 2>$null | ConvertFrom-Json
        
        if ($LASTEXITCODE -eq 0 -and $stackInfo) {
            $status = $stackInfo.StackStatus
            Write-Host "📊 Current status: $status" -ForegroundColor Cyan
            
            switch ($status) {
                "ROLLBACK_FAILED" {
                    Write-Host "🔥 Stack is in ROLLBACK_FAILED state - requires manual intervention" -ForegroundColor Red
                    
                    if ($ForceDelete) {
                        Write-Host "💀 Attempting force delete..." -ForegroundColor Magenta
                        if (-not $DryRun) {
                            aws cloudformation delete-stack --stack-name $stackName --region us-east-1
                            Write-Host "✅ Force delete command sent" -ForegroundColor Green
                        } else {
                            Write-Host "🔍 DRY RUN: Would execute force delete" -ForegroundColor Cyan
                        }
                    } else {
                        Write-Host "⚠️  Use -ForceDelete switch to attempt deletion" -ForegroundColor Yellow
                        
                        # Show stuck resources
                        Write-Host "🔍 Analyzing stuck resources..." -ForegroundColor Cyan
                        $events = aws cloudformation describe-stack-events --stack-name $stackName --region us-east-1 --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].{Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason}' --output table 2>$null
                        if ($events) {
                            Write-Host "❌ Failed to delete resources:" -ForegroundColor Red
                            Write-Host $events
                        }
                    }
                }
                
                "DELETE_IN_PROGRESS" {
                    Write-Host "⏳ Stack deletion in progress..." -ForegroundColor Yellow
                }
                
                "DELETE_COMPLETE" {
                    Write-Host "✅ Stack already deleted" -ForegroundColor Green
                }
                
                default {
                    Write-Host "📊 Stack status: $status" -ForegroundColor White
                    if ($ForceDelete) {
                        Write-Host "💀 Attempting delete..." -ForegroundColor Magenta
                        if (-not $DryRun) {
                            aws cloudformation delete-stack --stack-name $stackName --region us-east-1
                            Write-Host "✅ Delete command sent" -ForegroundColor Green
                        } else {
                            Write-Host "🔍 DRY RUN: Would execute delete" -ForegroundColor Cyan
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Host "❓ Stack $stackName not found or error occurred: $_" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "🧹 CLEANUP EXISTING CHIME RESOURCES" -ForegroundColor Yellow
Write-Host "====================================" -ForegroundColor Gray

# List existing SIP Media Applications
Write-Host "📱 Checking existing SIP Media Applications..." -ForegroundColor Cyan
try {
    $smas = aws chime-sdk-voice list-sip-media-applications --region us-east-1 --output json | ConvertFrom-Json
    if ($smas.SipMediaApplications) {
        foreach ($sma in $smas.SipMediaApplications) {
            if ($sma.Name -like "*TodaysDentalInsights*") {
                Write-Host "🎯 Found SMA: $($sma.Name) (ID: $($sma.SipMediaApplicationId))" -ForegroundColor White
                
                if ($ForceDelete) {
                    Write-Host "💀 Deleting SMA: $($sma.SipMediaApplicationId)" -ForegroundColor Magenta
                    if (-not $DryRun) {
                        aws chime-sdk-voice delete-sip-media-application --sip-media-application-id $sma.SipMediaApplicationId --region us-east-1
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "✅ SMA deleted successfully" -ForegroundColor Green
                        } else {
                            Write-Host "❌ Failed to delete SMA" -ForegroundColor Red
                        }
                    } else {
                        Write-Host "🔍 DRY RUN: Would delete SMA" -ForegroundColor Cyan
                    }
                }
            }
        }
    } else {
        Write-Host "✅ No SIP Media Applications found" -ForegroundColor Green
    }
}
catch {
    Write-Host "❌ Error checking SIP Media Applications: $_" -ForegroundColor Red
}

# List existing SIP Rules
Write-Host ""
Write-Host "📞 Checking existing SIP Rules..." -ForegroundColor Cyan
try {
    $sipRules = aws chime-sdk-voice list-sip-rules --region us-east-1 --output json 2>$null | ConvertFrom-Json
    if ($sipRules.SipRules) {
        foreach ($rule in $sipRules.SipRules) {
            if ($rule.Name -like "*TodaysDentalInsights*") {
                Write-Host "📋 Found SIP Rule: $($rule.Name) (ID: $($rule.SipRuleId))" -ForegroundColor White
                
                if ($ForceDelete) {
                    Write-Host "💀 Deleting SIP Rule: $($rule.SipRuleId)" -ForegroundColor Magenta
                    if (-not $DryRun) {
                        aws chime-sdk-voice delete-sip-rule --sip-rule-id $rule.SipRuleId --region us-east-1
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "✅ SIP Rule deleted successfully" -ForegroundColor Green
                        } else {
                            Write-Host "❌ Failed to delete SIP Rule" -ForegroundColor Red
                        }
                    } else {
                        Write-Host "🔍 DRY RUN: Would delete SIP Rule" -ForegroundColor Cyan
                    }
                }
            }
        }
    } else {
        Write-Host "✅ No SIP Rules found" -ForegroundColor Green
    }
}
catch {
    Write-Host "❌ Error checking SIP Rules: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "📊 SUMMARY AND NEXT STEPS" -ForegroundColor Yellow
Write-Host "=========================" -ForegroundColor Gray

if ($DryRun) {
    Write-Host "🔍 This was a DRY RUN - no changes were made" -ForegroundColor Cyan
    Write-Host "💡 Run with -ForceDelete switch to actually delete resources" -ForegroundColor Yellow
} elseif ($ForceDelete) {
    Write-Host "💀 Cleanup operations completed" -ForegroundColor Green
    Write-Host "⏳ Wait 5-10 minutes, then deploy the fixed stack:" -ForegroundColor Cyan
    Write-Host "   npx cdk deploy TodaysDentalInsightsChimeV5 --require-approval never" -ForegroundColor White
} else {
    Write-Host "ℹ️  Run this script with options:" -ForegroundColor Cyan
    Write-Host "   .\emergency-cleanup.ps1 -DryRun          # Check what would be deleted" -ForegroundColor White
    Write-Host "   .\emergency-cleanup.ps1 -ForceDelete     # Actually delete resources" -ForegroundColor White
}

Write-Host ""
Write-Host "🚨 MANUAL STEPS IF AUTOMATED CLEANUP FAILS:" -ForegroundColor Red
Write-Host "1. Go to AWS CloudFormation Console" -ForegroundColor White
Write-Host "2. Find stuck stacks and manually delete them" -ForegroundColor White
Write-Host "3. Go to AWS Chime SDK Console" -ForegroundColor White
Write-Host "4. Delete any remaining SIP rules and applications" -ForegroundColor White
Write-Host "5. Then deploy the fixed stack" -ForegroundColor White
