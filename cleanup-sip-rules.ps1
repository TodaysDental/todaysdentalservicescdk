# PowerShell script to delete existing SIP rules and allow for clean redeployment
# Install AWS PowerShell modules if needed
if (-not (Get-Module -ListAvailable -Name AWSPowerShell)) {
    Write-Host "Installing AWS PowerShell module..."
    Install-Module -Name AWSPowerShell -Force -AllowClobber
}

Import-Module AWSPowerShell

# Set AWS region to match your deployment
$region = "us-east-1"  # Change to your region if different
Set-DefaultAWSRegion -Region $region

# List all SIP rules
Write-Host "Listing existing SIP rules..." -ForegroundColor Cyan
$allSipRules = Get-CHMVoiceSipRuleList -MaxResults 100

if ($allSipRules) {
    $totalRules = $allSipRules.Count
    Write-Host "Found $totalRules SIP rules." -ForegroundColor Green
    
    # Display the rules
    Write-Host "`nExisting SIP Rules:" -ForegroundColor Cyan
    $allSipRules | ForEach-Object {
        Write-Host "- $($_.Name) (ID: $($_.SipRuleId), Trigger: $($_.TriggerType)=$($_.TriggerValue))"
    }
    
    $confirmation = Read-Host "`nDo you want to delete all SIP rules? (y/n)"
    
    if ($confirmation -eq "y") {
        Write-Host "`nDeleting all SIP rules..." -ForegroundColor Yellow
        $deleted = 0
        $failed = 0
        
        # Delete each SIP rule
        foreach ($rule in $allSipRules) {
            $ruleId = $rule.SipRuleId
            $ruleName = $rule.Name
            
            try {
                Write-Host "Deleting SIP rule: $ruleName (ID: $ruleId)..." -NoNewline
                Remove-CHMVoiceSipRule -SipRuleId $ruleId -Force
                Write-Host " SUCCESS" -ForegroundColor Green
                $deleted++
            }
            catch {
                Write-Host " FAILED" -ForegroundColor Red
                Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
                $failed++
            }
        }
        
        Write-Host "`nSIP rule cleanup completed." -ForegroundColor Green
        Write-Host "Successfully deleted: $deleted rules" -ForegroundColor Green
        if ($failed -gt 0) {
            Write-Host "Failed to delete: $failed rules" -ForegroundColor Red
        }
    } else {
        Write-Host "Operation cancelled by user." -ForegroundColor Yellow
    }
} else {
    Write-Host "No SIP rules found." -ForegroundColor Yellow
}

Write-Host "`nReady to deploy your stack with the renamed SIP rules!" -ForegroundColor Cyan
Write-Host "Run: cdk deploy"
