# PowerShell script to delete existing SIP rules and then redeploy the CDK stack
# Install AWS PowerShell modules if needed
if (-not (Get-Module -ListAvailable -Name AWSPowerShell)) {
    Write-Host "Installing AWS PowerShell module..."
    Install-Module -Name AWSPowerShell -Force -AllowClobber
}

Import-Module AWSPowerShell

# Set AWS region to match your deployment
$region = "us-east-1"  # Change to your region if different
Set-DefaultAWSRegion -Region $region

# STEP 1: Delete all existing SIP Rules
Write-Host "Step 1: Deleting existing SIP rules..." -ForegroundColor Cyan
$allSipRules = Get-CHMVoiceSipRuleList -MaxResults 100

if ($allSipRules) {
    Write-Host "Found $($allSipRules.Count) SIP rules. Deleting all of them..."
    
    # Delete each SIP rule
    foreach ($rule in $allSipRules) {
        $ruleId = $rule.SipRuleId
        $ruleName = $rule.Name
        
        try {
            Write-Host "Deleting SIP rule: $ruleName (ID: $ruleId)..."
            Remove-CHMVoiceSipRule -SipRuleId $ruleId -Force
            Write-Host "Successfully deleted SIP rule: $ruleName" -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to delete SIP rule: $ruleName - $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    Write-Host "SIP rule cleanup completed."
} else {
    Write-Host "No SIP rules found." -ForegroundColor Yellow
}

# STEP 2: Check if the stack is in ROLLBACK_COMPLETE state and delete it if necessary
$stackName = "TodaysDentalInsightsChimeV5"  # Change to your stack name if different

Write-Host "Step 2: Checking CloudFormation stack status..." -ForegroundColor Cyan
$stack = Get-CFNStack -StackName $stackName -ErrorAction SilentlyContinue

if ($stack) {
    Write-Host "Stack is in $($stack.StackStatus) state."
    
    if ($stack.StackStatus -eq "UPDATE_ROLLBACK_COMPLETE" -or 
        $stack.StackStatus -like "*FAILED" -or 
        $stack.StackStatus -eq "ROLLBACK_COMPLETE") {
        
        Write-Host "Stack is in a state that requires deletion before redeployment."
        Write-Host "Deleting stack $stackName..."
        
        try {
            Remove-CFNStack -StackName $stackName -Force
            
            # Wait for stack deletion
            Write-Host "Waiting for stack deletion to complete..."
            while ($true) {
                try {
                    $currentStack = Get-CFNStack -StackName $stackName -ErrorAction Stop
                    if ($currentStack.StackStatus -eq "DELETE_IN_PROGRESS") {
                        Write-Host "." -NoNewline
                        Start-Sleep -Seconds 10
                    } else {
                        Write-Host "Stack deletion status: $($currentStack.StackStatus)"
                        break
                    }
                } catch {
                    Write-Host "`nStack deleted successfully."
                    break
                }
            }
        } catch {
            Write-Host "Failed to delete stack: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Please try manual deletion through AWS Console and rerun this script."
            exit 1
        }
    } else {
        Write-Host "Stack is in a valid state for deployment."
    }
} else {
    Write-Host "Stack not found or already deleted."
}

# STEP 3: Deploy with CDK
Write-Host "Step 3: Deploying with CDK..." -ForegroundColor Cyan

# Change directory to your project root (if needed)
Set-Location D:\zswaraj\todaysdentalinsightscdk

# Run the CDK deployment
try {
    Write-Host "Running: cdk deploy --require-approval never"
    cdk deploy --require-approval never
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "CDK deployment completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "CDK deployment failed with exit code $LASTEXITCODE" -ForegroundColor Red
    }
} catch {
    Write-Host "Error during CDK deployment: $($_.Exception.Message)" -ForegroundColor Red
}
