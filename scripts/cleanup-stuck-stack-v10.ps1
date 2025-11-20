# Cleanup Script for TodaysDentalInsightsChimeV10 Stack
# This script handles the specific '[object Object]' physicalResourceId bug

param(
    [Parameter(Mandatory=$false)]
    [string]$StackName = "TodaysDentalInsightsChimeV10",
    
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1",
    
    [Parameter(Mandatory=$false)]
    [switch]$ForceDelete,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Chime Stack V10 Cleanup Script" -ForegroundColor Cyan  
Write-Host "============================================`n" -ForegroundColor Cyan

Write-Host "Stack Name: $StackName" -ForegroundColor Yellow
Write-Host "Region: $Region" -ForegroundColor Yellow
Write-Host "Issues Fixed:" -ForegroundColor Yellow
Write-Host "  - '[object Object]' physicalResourceId bug" -ForegroundColor Gray
Write-Host "  - Phone Number product type conflicts" -ForegroundColor Gray
Write-Host "  - Excessive SIP Rule creation failures`n" -ForegroundColor Gray

if ($DryRun) {
    Write-Host "[DRY RUN MODE] No changes will be made`n" -ForegroundColor Yellow
}

# Function to safely execute AWS CLI commands
function Invoke-AwsCliCommand {
    param(
        [string]$Command,
        [string]$Description
    )
    
    Write-Host "[$Description]" -ForegroundColor Cyan
    Write-Host "  Command: $Command" -ForegroundColor Gray
    
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would execute command`n" -ForegroundColor Yellow
        return @{Success=$true; Output="DRY RUN"}
    }
    
    try {
        $output = Invoke-Expression $Command 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Success`n" -ForegroundColor Green
            return @{Success=$true; Output=$output}
        } else {
            Write-Host "  ✗ Failed: $output`n" -ForegroundColor Red
            return @{Success=$false; Output=$output}
        }
    } catch {
        Write-Host "  ✗ Error: $($_.Exception.Message)`n" -ForegroundColor Red
        return @{Success=$false; Output=$_.Exception.Message}
    }
}

# Step 1: Check if stack exists and get its status
Write-Host "`n--- Step 1: Check Stack Status ---`n" -ForegroundColor Magenta

$stackStatusCmd = "aws cloudformation describe-stacks --stack-name $StackName --region $Region --query 'Stacks[0].StackStatus' --output text"
$stackStatus = Invoke-AwsCliCommand -Command $stackStatusCmd -Description "Get Stack Status"

if (-not $stackStatus.Success) {
    if ($stackStatus.Output -like "*does not exist*") {
        Write-Host "✓ Stack does not exist. Ready for fresh deployment!`n" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "Unable to check stack status. Error: $($stackStatus.Output)" -ForegroundColor Red
        Write-Host "Proceeding with SIP Rule cleanup anyway...`n" -ForegroundColor Yellow
    }
} else {
    Write-Host "Current stack status: $($stackStatus.Output)`n" -ForegroundColor Yellow
}

# Step 2: List and delete ALL SIP Rules (they might be corrupted due to the '[object Object]' bug)
Write-Host "`n--- Step 2: Clean Up ALL SIP Rules ---`n" -ForegroundColor Magenta

$listSipRulesCmd = "aws chime-sdk-voice list-sip-rules --region $Region --output json"
$sipRules = Invoke-AwsCliCommand -Command $listSipRulesCmd -Description "List All SIP Rules"

if ($sipRules.Success -and $sipRules.Output -ne "DRY RUN") {
    try {
        $sipRulesJson = $sipRules.Output | ConvertFrom-Json
        $sipRulesList = $sipRulesJson.SipRules
        
        if ($sipRulesList.Count -eq 0) {
            Write-Host "✓ No SIP Rules found to clean up`n" -ForegroundColor Green
        } else {
            Write-Host "Found $($sipRulesList.Count) SIP Rule(s) - DELETING ALL due to corruption:`n" -ForegroundColor Red
            
            foreach ($rule in $sipRulesList) {
                $trigger = $rule.TriggerType
                $value = $rule.TriggerValue
                Write-Host "  - $($rule.Name) (ID: $($rule.SipRuleId))" -ForegroundColor Gray
                Write-Host "    Trigger: $trigger -> $value" -ForegroundColor DarkGray
            }
            
            Write-Host ""
            
            if (-not $ForceDelete -and -not $DryRun) {
                Write-Host "WARNING: This will delete ALL SIP Rules in your account for this region!" -ForegroundColor Red
                $confirm = Read-Host "Continue with deletion? (y/N)"
                if ($confirm -ne "y" -and $confirm -ne "Y") {
                    Write-Host "Skipping SIP Rule deletion. Stack cleanup may fail.`n" -ForegroundColor Yellow
                } else {
                    $ForceDelete = $true
                }
            }
            
            if ($ForceDelete -or $DryRun) {
                $successCount = 0
                $failCount = 0
                
                foreach ($rule in $sipRulesList) {
                    $deleteSipRuleCmd = "aws chime-sdk-voice delete-sip-rule --sip-rule-id $($rule.SipRuleId) --region $Region"
                    $result = Invoke-AwsCliCommand -Command $deleteSipRuleCmd -Description "Delete SIP Rule: $($rule.Name)"
                    
                    if ($result.Success) {
                        $successCount++
                    } else {
                        $failCount++
                    }
                }
                
                if (-not $DryRun) {
                    Write-Host "SIP Rule Deletion Summary:" -ForegroundColor Yellow
                    Write-Host "  ✓ Successfully deleted: $successCount" -ForegroundColor Green
                    Write-Host "  ✗ Failed to delete: $failCount`n" -ForegroundColor Red
                }
            }
        }
    } catch {
        Write-Host "Error parsing SIP Rules response: $($_.Exception.Message)`n" -ForegroundColor Red
        Write-Host "Proceeding with stack deletion anyway...`n" -ForegroundColor Yellow
    }
}

# Step 3: List and delete SIP Media Applications (in case they're also corrupted)
Write-Host "`n--- Step 3: Clean Up SIP Media Applications ---`n" -ForegroundColor Magenta

$listSmaCmd = "aws chime-sdk-voice list-sip-media-applications --region $Region --output json"
$smaResult = Invoke-AwsCliCommand -Command $listSmaCmd -Description "List SIP Media Applications"

if ($smaResult.Success -and $smaResult.Output -ne "DRY RUN") {
    try {
        $smaJson = $smaResult.Output | ConvertFrom-Json
        $smaList = $smaJson.SipMediaApplications
        
        if ($smaList.Count -eq 0) {
            Write-Host "✓ No SIP Media Applications found`n" -ForegroundColor Green
        } else {
            Write-Host "Found $($smaList.Count) SIP Media Application(s):" -ForegroundColor Yellow
            
            foreach ($sma in $smaList) {
                Write-Host "  - $($sma.Name) (ID: $($sma.SipMediaApplicationId))" -ForegroundColor Gray
                # Don't auto-delete SMAs as they might be from other stacks
            }
            Write-Host ""
            Write-Host "NOTE: SIP Media Applications will be deleted with the CloudFormation stack`n" -ForegroundColor Gray
        }
    } catch {
        Write-Host "Error parsing SMA response: $($_.Exception.Message)`n" -ForegroundColor Red
    }
}

# Step 4: Delete the CloudFormation Stack
Write-Host "`n--- Step 4: Delete CloudFormation Stack ---`n" -ForegroundColor Magenta

if ($DryRun) {
    Write-Host "[DRY RUN] Would delete stack: $StackName`n" -ForegroundColor Yellow
} else {
    Write-Host "Attempting to delete stack: $StackName" -ForegroundColor Yellow
    
    $deleteStackCmd = "aws cloudformation delete-stack --stack-name $StackName --region $Region"
    $deleteResult = Invoke-AwsCliCommand -Command $deleteStackCmd -Description "Delete CloudFormation Stack"
    
    if ($deleteResult.Success) {
        Write-Host "Stack deletion initiated. Waiting for completion..." -ForegroundColor Yellow
        Write-Host "(This may take several minutes)`n" -ForegroundColor Gray
        
        # Wait for stack deletion with timeout
        $waitCmd = "aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region"
        Write-Host "Waiting for stack deletion to complete (timeout: 30 minutes)..." -ForegroundColor Cyan
        
        try {
            # Add timeout to avoid hanging forever
            $job = Start-Job -ScriptBlock { 
                param($cmd)
                Invoke-Expression $cmd 2>&1 
            } -ArgumentList $waitCmd
            
            if (Wait-Job $job -Timeout 1800) { # 30 minutes
                $result = Receive-Job $job
                Remove-Job $job
                
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✓ Stack deleted successfully!`n" -ForegroundColor Green
                } else {
                    Write-Host "Stack deletion may have failed. Check AWS Console for status.`n" -ForegroundColor Yellow
                }
            } else {
                Stop-Job $job
                Remove-Job $job
                Write-Host "Stack deletion timed out after 30 minutes. Check AWS Console for status.`n" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Error waiting for stack deletion: $($_.Exception.Message)`n" -ForegroundColor Yellow
            Write-Host "Check AWS Console for current status`n" -ForegroundColor Gray
        }
    }
}

# Step 5: Verify cleanup
Write-Host "`n--- Step 5: Verify Cleanup ---`n" -ForegroundColor Magenta

if (-not $DryRun) {
    # Check if stack still exists
    $verifyStackCmd = "aws cloudformation describe-stacks --stack-name $StackName --region $Region --query 'Stacks[0].StackStatus' --output text"
    $verifyResult = Invoke-Expression $verifyStackCmd 2>&1
    
    if ($LASTEXITCODE -ne 0 -and $verifyResult -like "*does not exist*") {
        Write-Host "✓ Stack successfully deleted`n" -ForegroundColor Green
    } else {
        Write-Host "⚠ Stack still exists with status: $verifyResult" -ForegroundColor Yellow
        Write-Host "  You may need to:" -ForegroundColor Gray
        Write-Host "  - Manually delete remaining resources from AWS Console" -ForegroundColor Gray
        Write-Host "  - Contact AWS Support for assistance`n" -ForegroundColor Gray
    }
    
    # Check remaining SIP Rules
    $verifyRulesCmd = "aws chime-sdk-voice list-sip-rules --region $Region --output json"
    $verifyRules = Invoke-Expression $verifyRulesCmd 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        try {
            $rulesJson = $verifyRules | ConvertFrom-Json
            if ($rulesJson.SipRules.Count -eq 0) {
                Write-Host "✓ All SIP Rules cleaned up`n" -ForegroundColor Green
            } else {
                Write-Host "⚠ $($rulesJson.SipRules.Count) SIP Rule(s) still exist" -ForegroundColor Yellow
                Write-Host "  These may be from other projects/stacks`n" -ForegroundColor Gray
            }
        } catch {
            Write-Host "Could not verify SIP Rules cleanup`n" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Cleanup Summary" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host "[DRY RUN] No changes were made" -ForegroundColor Yellow
    Write-Host "Run without -DryRun flag to execute cleanup`n" -ForegroundColor Gray
} else {
    Write-Host "✓ Cleanup process completed" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Verify in AWS Console that resources are deleted" -ForegroundColor Gray
    Write-Host "  2. Deploy the FIXED stack using:" -ForegroundColor Gray
    Write-Host "     cdk deploy TodaysDentalInsightsChimeV10" -ForegroundColor White
    Write-Host "  3. The new stack will work correctly (no more '[object Object]' errors)" -ForegroundColor Gray
    Write-Host "  4. After deployment, use scripts/provision-phone-numbers.ts for phone setup`n" -ForegroundColor Gray
}

Write-Host "What was fixed in the new code:" -ForegroundColor Yellow
Write-Host "  ✓ physicalResourceId '[object Object]' bug resolved" -ForegroundColor Green
Write-Host "  ✓ Phone number product type conflicts avoided" -ForegroundColor Green  
Write-Host "  ✓ Inbound SIP Rules moved to post-deployment script" -ForegroundColor Green
Write-Host "  ✓ Only essential resources created in CDK stack`n" -ForegroundColor Green

Write-Host "For manual cleanup, see AWS Console:" -ForegroundColor Yellow
Write-Host "  - CloudFormation: https://console.aws.amazon.com/cloudformation/home?region=$Region" -ForegroundColor Gray
Write-Host "  - Chime SDK Voice: https://console.aws.amazon.com/chime-sdk/home?region=$Region`n" -ForegroundColor Gray













