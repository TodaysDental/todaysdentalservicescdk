# Cleanup Script for Stuck CloudFormation Stack
# This script helps clean up resources when a stack is in ROLLBACK_FAILED state

param(
    [Parameter(Mandatory=$false)]
    [string]$StackName = "TodaysDentalInsightsChimeV9",
    
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1",
    
    [Parameter(Mandatory=$false)]
    [switch]$ForceDelete,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Chime Stack Cleanup Script" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

Write-Host "Stack Name: $StackName" -ForegroundColor Yellow
Write-Host "Region: $Region`n" -ForegroundColor Yellow

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
        Write-Host "✓ Stack does not exist. Nothing to clean up!`n" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "Unable to check stack status. Error: $($stackStatus.Output)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Current stack status: $($stackStatus.Output)`n" -ForegroundColor Yellow

# Step 2: List and delete SIP Rules
Write-Host "`n--- Step 2: Clean Up SIP Rules ---`n" -ForegroundColor Magenta

$listSipRulesCmd = "aws chime-sdk-voice list-sip-rules --region $Region --output json"
$sipRules = Invoke-AwsCliCommand -Command $listSipRulesCmd -Description "List SIP Rules"

if ($sipRules.Success -and $sipRules.Output -ne "DRY RUN") {
    try {
        $sipRulesJson = $sipRules.Output | ConvertFrom-Json
        $sipRulesList = $sipRulesJson.SipRules
        
        if ($sipRulesList.Count -eq 0) {
            Write-Host "No SIP Rules found`n" -ForegroundColor Green
        } else {
            Write-Host "Found $($sipRulesList.Count) SIP Rule(s):`n" -ForegroundColor Yellow
            
            foreach ($rule in $sipRulesList) {
                Write-Host "  - $($rule.Name) (ID: $($rule.SipRuleId), Type: $($rule.TriggerType))" -ForegroundColor Gray
            }
            
            Write-Host ""
            
            if (-not $ForceDelete) {
                $confirm = Read-Host "Delete all SIP Rules? (y/N)"
                if ($confirm -ne "y" -and $confirm -ne "Y") {
                    Write-Host "Skipping SIP Rule deletion`n" -ForegroundColor Yellow
                    $ForceDelete = $false
                } else {
                    $ForceDelete = $true
                }
            }
            
            if ($ForceDelete -or $DryRun) {
                foreach ($rule in $sipRulesList) {
                    $deleteSipRuleCmd = "aws chime-sdk-voice delete-sip-rule --sip-rule-id $($rule.SipRuleId) --region $Region"
                    $result = Invoke-AwsCliCommand -Command $deleteSipRuleCmd -Description "Delete SIP Rule: $($rule.Name)"
                }
            }
        }
    } catch {
        Write-Host "Error parsing SIP Rules response: $($_.Exception.Message)`n" -ForegroundColor Red
    }
}

# Step 3: Delete the CloudFormation Stack
Write-Host "`n--- Step 3: Delete CloudFormation Stack ---`n" -ForegroundColor Magenta

if ($DryRun) {
    Write-Host "[DRY RUN] Would delete stack: $StackName`n" -ForegroundColor Yellow
} else {
    Write-Host "Attempting to delete stack: $StackName" -ForegroundColor Yellow
    
    $deleteStackCmd = "aws cloudformation delete-stack --stack-name $StackName --region $Region"
    $deleteResult = Invoke-AwsCliCommand -Command $deleteStackCmd -Description "Delete CloudFormation Stack"
    
    if ($deleteResult.Success) {
        Write-Host "Stack deletion initiated. Waiting for completion..." -ForegroundColor Yellow
        Write-Host "(This may take several minutes)`n" -ForegroundColor Gray
        
        # Wait for stack deletion
        $waitCmd = "aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region"
        Write-Host "Waiting for stack deletion to complete..." -ForegroundColor Cyan
        
        try {
            Invoke-Expression $waitCmd 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ Stack deleted successfully!`n" -ForegroundColor Green
            } else {
                Write-Host "Stack deletion may have failed or timed out. Check AWS Console for status.`n" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Error waiting for stack deletion: $($_.Exception.Message)`n" -ForegroundColor Yellow
            Write-Host "Check AWS Console for current status`n" -ForegroundColor Gray
        }
    }
}

# Step 4: Verify cleanup
Write-Host "`n--- Step 4: Verify Cleanup ---`n" -ForegroundColor Magenta

if (-not $DryRun) {
    # Check if stack still exists
    $verifyStackCmd = "aws cloudformation describe-stacks --stack-name $StackName --region $Region --query 'Stacks[0].StackStatus' --output text"
    $verifyResult = Invoke-Expression $verifyStackCmd 2>&1
    
    if ($LASTEXITCODE -ne 0 -and $verifyResult -like "*does not exist*") {
        Write-Host "✓ Stack successfully deleted`n" -ForegroundColor Green
    } else {
        Write-Host "⚠ Stack still exists with status: $verifyResult" -ForegroundColor Yellow
        Write-Host "  You may need to manually delete the stack from AWS Console`n" -ForegroundColor Gray
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
                Write-Host "⚠ $($rulesJson.SipRules.Count) SIP Rule(s) still exist`n" -ForegroundColor Yellow
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
    Write-Host "  2. Run 'cdk deploy TodaysDentalInsightsChimeV9' to redeploy" -ForegroundColor Gray
    Write-Host "  3. Refer to VOICE-CONNECTOR-ORIGINATION-FIX.md for details`n" -ForegroundColor Gray
}

Write-Host "For manual cleanup, see AWS Console:" -ForegroundColor Yellow
Write-Host "  - CloudFormation: https://console.aws.amazon.com/cloudformation/home?region=$Region" -ForegroundColor Gray
Write-Host "  - Chime SDK Voice: https://console.aws.amazon.com/chime-sdk/home?region=$Region`n" -ForegroundColor Gray














