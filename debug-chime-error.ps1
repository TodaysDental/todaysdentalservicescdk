#!/usr/bin/env powershell
# Debug script to identify the Chime API 500 error

Write-Host "🔍 Debugging Chime API 500 Error" -ForegroundColor Cyan
Write-Host ""

# Check if CDK is available
Write-Host "1. Checking CDK availability..." -ForegroundColor Yellow
try {
    $cdkVersion = npx cdk --version
    Write-Host "✓ CDK Version: $cdkVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ CDK not available: $($_.Exception.Message)" -ForegroundColor Red
}

# List available stacks
Write-Host "`n2. Listing CDK stacks..." -ForegroundColor Yellow
try {
    $stacks = npx cdk list 2>&1
    Write-Host "Available stacks:" -ForegroundColor Green
    Write-Host $stacks
} catch {
    Write-Host "✗ Error listing stacks: $($_.Exception.Message)" -ForegroundColor Red
}

# Check AWS CLI configuration
Write-Host "`n3. Checking AWS CLI..." -ForegroundColor Yellow
try {
    $awsIdentity = aws sts get-caller-identity --output json 2>&1 | ConvertFrom-Json
    Write-Host "✓ AWS Account: $($awsIdentity.Account)" -ForegroundColor Green
    Write-Host "✓ AWS User/Role: $($awsIdentity.Arn)" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI error: $($_.Exception.Message)" -ForegroundColor Red
}

# Check deployed CloudFormation stacks
Write-Host "`n4. Checking CloudFormation stacks..." -ForegroundColor Yellow
try {
    $cfStacks = aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --output json 2>&1 | ConvertFrom-Json
    $relevantStacks = $cfStacks.StackSummaries | Where-Object { $_.StackName -like "*Chime*" -or $_.StackName -like "*Admin*" -or $_.StackName -like "*TodaysDental*" }
    
    if ($relevantStacks) {
        Write-Host "✓ Found relevant stacks:" -ForegroundColor Green
        foreach ($stack in $relevantStacks) {
            Write-Host "  - $($stack.StackName) ($($stack.StackStatus))" -ForegroundColor White
        }
    } else {
        Write-Host "⚠ No relevant stacks found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ CloudFormation error: $($_.Exception.Message)" -ForegroundColor Red
}

# Check Lambda functions
Write-Host "`n5. Checking Lambda functions..." -ForegroundColor Yellow
try {
    $lambdas = aws lambda list-functions --output json 2>&1 | ConvertFrom-Json
    $chimeLambdas = $lambdas.Functions | Where-Object { $_.FunctionName -like "*Start*" -or $_.FunctionName -like "*Chime*" }
    
    if ($chimeLambdas) {
        Write-Host "✓ Found Lambda functions:" -ForegroundColor Green
        foreach ($lambda in $chimeLambdas) {
            Write-Host "  - $($lambda.FunctionName) (Runtime: $($lambda.Runtime))" -ForegroundColor White
            
            # Check environment variables for start-session function
            if ($lambda.FunctionName -like "*Start*") {
                Write-Host "`n    Environment Variables:" -ForegroundColor Cyan
                try {
                    $config = aws lambda get-function-configuration --function-name $lambda.FunctionName --output json | ConvertFrom-Json
                    if ($config.Environment.Variables) {
                        foreach ($envVar in $config.Environment.Variables.PSObject.Properties) {
                            if ($envVar.Name -eq "AGENT_PRESENCE_TABLE_NAME" -or 
                                $envVar.Name -eq "USER_POOL_ID" -or 
                                $envVar.Name -eq "COGNITO_REGION") {
                                Write-Host "    ✓ $($envVar.Name): $($envVar.Value)" -ForegroundColor Green
                            } else {
                                Write-Host "    - $($envVar.Name): $($envVar.Value)" -ForegroundColor Gray
                            }
                        }
                    } else {
                        Write-Host "    ⚠ No environment variables found!" -ForegroundColor Yellow
                    }
                } catch {
                    Write-Host "    ✗ Error getting function config: $($_.Exception.Message)" -ForegroundColor Red
                }
            }
        }
    } else {
        Write-Host "⚠ No relevant Lambda functions found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Lambda functions error: $($_.Exception.Message)" -ForegroundColor Red
}

# Check recent CloudWatch logs
Write-Host "`n6. Checking recent CloudWatch logs..." -ForegroundColor Yellow
try {
    # Try to find the log group for start-session
    $logGroups = aws logs describe-log-groups --output json 2>&1 | ConvertFrom-Json
    $startSessionLogGroup = $logGroups.logGroups | Where-Object { $_.logGroupName -like "*Start*" -or $_.logGroupName -like "*start-session*" }
    
    if ($startSessionLogGroup) {
        Write-Host "✓ Found log group: $($startSessionLogGroup.logGroupName)" -ForegroundColor Green
        
        # Get recent logs (last 10 minutes)
        $endTime = [int64]((Get-Date).ToUniversalTime().Subtract([datetime]'1970-01-01T00:00:00Z')).TotalMilliseconds
        $startTime = $endTime - (10 * 60 * 1000) # 10 minutes ago
        
        Write-Host "  Getting recent log events..." -ForegroundColor Cyan
        $logEvents = aws logs filter-log-events --log-group-name $startSessionLogGroup.logGroupName --start-time $startTime --end-time $endTime --output json 2>&1 | ConvertFrom-Json
        
        if ($logEvents.events -and $logEvents.events.Count -gt 0) {
            Write-Host "  Recent log events:" -ForegroundColor Green
            $logEvents.events | Select-Object -Last 5 | ForEach-Object {
                $timestamp = [DateTimeOffset]::FromUnixTimeMilliseconds($_.timestamp).ToString("yyyy-MM-dd HH:mm:ss")
                Write-Host "    [$timestamp] $($_.message)" -ForegroundColor White
            }
        } else {
            Write-Host "  ⚠ No recent log events found" -ForegroundColor Yellow
        }
    } else {
        Write-Host "⚠ No start-session log group found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ CloudWatch logs error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🔍 Diagnosis complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps based on findings above:" -ForegroundColor Yellow
Write-Host "1. If stacks are missing -> Deploy with: npx cdk deploy --all" -ForegroundColor White
Write-Host "2. If Lambda missing env vars -> Check stack outputs and redeploy" -ForegroundColor White  
Write-Host "3. If logs show specific errors -> Address those errors" -ForegroundColor White
Write-Host "4. If JWT token expired -> Get new token from Cognito" -ForegroundColor White





