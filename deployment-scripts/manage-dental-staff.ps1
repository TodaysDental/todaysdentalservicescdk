# PowerShell script to manage dental staff attributes in Cognito
# Usage: .\manage-dental-staff.ps1 <USER_POOL_ID> <command> [args...]

param(
    [Parameter(Mandatory=$true)]
    [string]$UserPoolId,
    
    [Parameter(Mandatory=$true)]
    [ValidateSet("list", "update", "sync")]
    [string]$Command,
    
    [Parameter(Mandatory=$false)]
    [string]$Email = "",
    
    [Parameter(Mandatory=$false)]
    [string]$HourlyPay = "",
    
    [Parameter(Mandatory=$false)]
    [string]$OpenDentalUserNum = ""
)

Write-Host "🦷 Managing Dental Staff Attributes in Cognito" -ForegroundColor Green
Write-Host "User Pool ID: $UserPoolId" -ForegroundColor Yellow
Write-Host "Command: $Command" -ForegroundColor Cyan

# Navigate to project root
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptPath

Push-Location $projectRoot

try {
    # Ensure TypeScript is compiled
    if (-not (Test-Path "dist/scripts/manage-dental-staff.js")) {
        Write-Host "📦 Compiling TypeScript..." -ForegroundColor Yellow
        npx tsc scripts/manage-dental-staff.ts --outDir dist --esModuleInterop --target ES2020 --module commonjs --skipLibCheck --resolveJsonModule
    }

    # Set environment variable
    $env:USER_POOL_ID = $UserPoolId

    if ($Command -eq "list") {
        Write-Host "📋 Listing all users with dental staff attributes..." -ForegroundColor Yellow
        node dist/scripts/manage-dental-staff.js $UserPoolId list
    }
    elseif ($Command -eq "update") {
        if (-not $Email -or -not $HourlyPay -or -not $OpenDentalUserNum) {
            Write-Host "❌ Error: update command requires Email, HourlyPay, and OpenDentalUserNum parameters" -ForegroundColor Red
            Write-Host "Usage: .\manage-dental-staff.ps1 <USER_POOL_ID> update -Email user@example.com -HourlyPay 25.50 -OpenDentalUserNum 123"
            exit 1
        }
        
        Write-Host "✏️ Updating user: $Email" -ForegroundColor Yellow
        Write-Host "   Hourly Pay: `$$HourlyPay" -ForegroundColor Gray
        Write-Host "   OpenDental UserNum: $OpenDentalUserNum" -ForegroundColor Gray
        
        node dist/scripts/manage-dental-staff.js $UserPoolId update $Email $HourlyPay $OpenDentalUserNum
    }
    elseif ($Command -eq "sync") {
        Write-Host "🔄 Syncing with OpenDental..." -ForegroundColor Yellow
        Write-Host "⚠️  Note: This requires OpenDental API integration - see script for implementation details" -ForegroundColor Orange
        node dist/scripts/manage-dental-staff.js $UserPoolId sync
    }
    else {
        Write-Host "❌ Unknown command: $Command" -ForegroundColor Red
        exit 1
    }

    Write-Host "✅ Command completed successfully!" -ForegroundColor Green
}
catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Verify user attributes in AWS Cognito console"
Write-Host "2. Test JWT tokens to see new claims (x_hourly_pay, x_od_usernum, etc.)"
Write-Host "3. Implement OpenDental API integration for automated sync"
