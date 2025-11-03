# SCRIPT-WIDE: Stop on any error. This makes try...catch work for AWS CLI.
$ErrorActionPreference = "Stop"

# Setup SIP Rules for Existing Phone Numbers
# This script reads phone numbers from clinics.json and creates SIP rules

# Configuration
$voiceConnectorId = "gfeubqc7d1j7jq4tjwj8ri" 
$smaId = "41074e0a-cf23-4949-a4d7-0f31f0d0b97a"
$region = "us-east-1"
$clinicsJsonPath = "..\src\infrastructure\configs\clinics.json"

# Read and parse clinics.json
Write-Host "Reading clinics.json..." -ForegroundColor Cyan
$clinicsJsonContent = Get-Content -Path $clinicsJsonPath -Raw
$clinicsJson = $clinicsJsonContent | ConvertFrom-Json
$clinicsWithPhones = $clinicsJson | Where-Object { $_.phoneNumber -and $_.phoneNumber -ne "" }

# Show summary of phone numbers found
$phoneNumbers = $clinicsWithPhones | ForEach-Object { $_.phoneNumber }
Write-Host "Found $($phoneNumbers.Count) phone numbers in clinics.json:" -ForegroundColor Green
$phoneNumbers | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

# Ask for confirmation
Write-Host "`nThis script will:" -ForegroundColor Yellow
Write-Host "1. Associate these numbers with Voice Connector ID: $voiceConnectorId" -ForegroundColor Yellow
Write-Host "2. Create SIP Rules pointing to SMA ID: $smaId" -ForegroundColor Yellow
$confirm = Read-Host "`nContinue? (y/N)"

if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Operation cancelled." -ForegroundColor Red
    exit
}

# Associate all numbers with Voice Connector
Write-Host "`nStep 1: Associating phone numbers with Voice Connector..." -ForegroundColor Cyan

# FIX: Use ConvertTo-Json to create proper JSON with quoted strings
$phoneNumbersJson = $phoneNumbers | ConvertTo-Json -Compress

Write-Host "Running: aws chime-sdk-voice associate-phone-numbers-with-voice-connector..."
try {
    aws chime-sdk-voice associate-phone-numbers-with-voice-connector `
        --voice-connector-id $voiceConnectorId `
        --e164-phone-numbers $phoneNumbersJson `
        --force-associate `
        --region $region | Out-Null
    
    Write-Host "✅ Successfully associated phone numbers with Voice Connector" -ForegroundColor Green
} catch {
    Write-Host "⚠️ FATAL Error associating phone numbers: $_" -ForegroundColor Red
    Write-Host "Exiting script. Please resolve the association error." -ForegroundColor Red
    exit 1
}

# Create SIP Rules for each phone number
Write-Host "`nStep 2: Creating SIP Rules for each phone number..." -ForegroundColor Cyan

$successCount = 0
$errorCount = 0

foreach ($clinic in $clinicsWithPhones) {
    $phoneNumber = $clinic.phoneNumber
    $clinicId = $clinic.clinicId
    
    # Sanitize clinic ID for rule name (replace non-alphanumeric with hyphens)
    $safeClinicId = $clinicId -replace '[^a-zA-Z0-9]', '-'
    
    # Create rule name (limited to 63 chars)
    $ruleName = "In-TDI-$safeClinicId"
    if ($ruleName.Length -gt 63) {
        $ruleName = $ruleName.Substring(0, 63)
    }
    
    Write-Host "Creating SIP Rule for $clinicId ($phoneNumber)..."
    
    # FIX: Create proper JSON object and convert to JSON string
    $targetAppsObject = @(
        @{
            SipMediaApplicationId = $smaId
            Priority = 1
            AwsRegion = $region
        }
    )
    $targetApps = $targetAppsObject | ConvertTo-Json -Compress -Depth 10
    
    try {
        aws chime-sdk-voice create-sip-rule `
            --name $ruleName `
            --trigger-type "ToPhoneNumber" `
            --trigger-value $phoneNumber `
            --target-applications $targetApps `
            --region $region | Out-Null
        
        Write-Host "  ✅ Created SIP Rule for $phoneNumber" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "  ⚠️ Error creating SIP Rule for $phoneNumber" -ForegroundColor Red
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
        $errorCount++
    }
}

# Summary
Write-Host "`n=================================================================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host "Successfully created: $successCount SIP Rules" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "Failed to create: $errorCount SIP Rules" -ForegroundColor Red
}

if ($errorCount -eq 0) {
    Write-Host "`nYour contact center is now set up for inbound calling!" -ForegroundColor Green
} else {
    Write-Host "`nYour contact center is NOT fully set up. Please fix the $errorCount error(s) above." -ForegroundColor Yellow
}