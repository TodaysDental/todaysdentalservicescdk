#!/usr/bin/env powershell
# Script to get a fresh JWT token from Cognito

# Your Cognito User Pool configuration
$UserPoolId = "us-east-1_MPaqyYUcc"  # From your JWT token
$ClientId = "4024c4obf0ne4ugb8deg1k6egt"    # From your JWT token  
$Username = "dentistinperrysburg@gmail.com"  # From your JWT token
$Region = "us-east-1"

Write-Host "Getting fresh JWT token from Cognito..." -ForegroundColor Cyan

# Prompt for password securely
$Password = Read-Host "Enter password for $Username" -AsSecureString
$PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))

try {
    # Initiate auth
    $authResponse = aws cognito-idp initiate-auth `
        --region $Region `
        --auth-flow ALLOW_USER_PASSWORD_AUTH `
        --client-id $ClientId `
        --auth-parameters "USERNAME=$Username,PASSWORD=$PlainPassword" `
        --output json | ConvertFrom-Json

    if ($authResponse.AuthenticationResult) {
        $IdToken = $authResponse.AuthenticationResult.IdToken
        Write-Host "✓ Successfully obtained fresh JWT token!" -ForegroundColor Green
        Write-Host ""
        Write-Host "New IdToken:" -ForegroundColor Yellow
        Write-Host $IdToken
        Write-Host ""
        Write-Host "Update your simple-api-test.ps1 with this new token." -ForegroundColor Cyan
        
        # Optionally save to file
        $IdToken | Out-File -FilePath "fresh-token.txt" -Encoding UTF8
        Write-Host "✓ Token also saved to fresh-token.txt" -ForegroundColor Green
    } else {
        Write-Host "✗ Authentication failed. Response:" -ForegroundColor Red
        Write-Host ($authResponse | ConvertTo-Json -Depth 5)
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Clear password from memory
$PlainPassword = $null


