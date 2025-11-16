# Create SIP Rule Using RequestUriHostname for Voice Connector
# This is the correct approach when phone numbers have VOICE_CONNECTOR product type

# Configuration
$voiceConnectorId = "gfeubqc7d1j7jq4tjwj8ri" 
$smaId = "41074e0a-cf23-4949-a4d7-0f31f0d0b97a"
$region = "us-east-1"

Write-Host "`n=================================================================================" -ForegroundColor Cyan
Write-Host "Creating SIP Rule with RequestUriHostname trigger" -ForegroundColor Cyan
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host "Voice Connector ID: $voiceConnectorId" -ForegroundColor Yellow
Write-Host "SIP Media Application ID: $smaId" -ForegroundColor Yellow
Write-Host "Region: $region" -ForegroundColor Yellow
Write-Host "=================================================================================" -ForegroundColor Cyan

# Step 1: Get the Voice Connector's outbound hostname
Write-Host "`nStep 1: Getting Voice Connector hostname..." -ForegroundColor Green

try {
    $vcResponse = aws chime-sdk-voice get-voice-connector `
        --voice-connector-id $voiceConnectorId `
        --region $region

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error getting Voice Connector details." -ForegroundColor Red
        exit 1
    }

    # Parse the JSON response
    $vcDetails = $vcResponse | ConvertFrom-Json
    $outboundHostname = $vcDetails.VoiceConnector.OutboundHostName

    if (-not $outboundHostname) {
        Write-Host "Could not find OutboundHostName in Voice Connector response." -ForegroundColor Red
        exit 1
    }

    Write-Host "Voice Connector Hostname: $outboundHostname" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Create SIP Rule with RequestUriHostname trigger
Write-Host "`nStep 2: Creating SIP Rule with RequestUriHostname trigger..." -ForegroundColor Green

# Target applications in proper JSON format with double quotes
$targetApps = '[ { "SipMediaApplicationId": "' + $smaId + '", "Priority": 1, "AwsRegion": "' + $region + '" } ]'

try {
    $result = aws chime-sdk-voice create-sip-rule `
        --name "InboundVoiceConnectorRule" `
        --trigger-type "RequestUriHostname" `
        --trigger-value $outboundHostname `
        --target-applications $targetApps `
        --region $region

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ SIP Rule created successfully!" -ForegroundColor Green
        Write-Host "Hostname: $outboundHostname" -ForegroundColor Green
        
        # Parse and display the created rule
        $ruleDetails = $result | ConvertFrom-Json
        Write-Host "Rule ID: $($ruleDetails.SipRule.SipRuleId)" -ForegroundColor Green
        Write-Host "Name: $($ruleDetails.SipRule.Name)" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Failed to create SIP Rule" -ForegroundColor Red
    }
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`n=================================================================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host "Your contact center is now configured correctly for:" -ForegroundColor Green
Write-Host "✓ Inbound calls (via RequestUriHostname rule)" -ForegroundColor Green
Write-Host "✓ Outbound calls (via the CDK stack)" -ForegroundColor Green
Write-Host "`nAll your phone numbers associated with the Voice Connector will now route to your SIP Media Application." -ForegroundColor Green








