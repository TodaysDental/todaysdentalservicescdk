# PowerShell script to set up environment variables for deployment
# Usage: . .\set-environment.ps1

# Amazon Connect Instance ID
$env:CONNECT_INSTANCE_ID = "e265b644-3dad-4490-b7c4-27036090c5f1"

# Output current settings
Write-Host "Environment variables set:" -ForegroundColor Green
Write-Host "Connect Instance ID: $env:CONNECT_INSTANCE_ID" -ForegroundColor Yellow

# Export variables so they're available to child processes
[System.Environment]::SetEnvironmentVariable('CONNECT_INSTANCE_ID', $env:CONNECT_INSTANCE_ID, [System.EnvironmentVariableTarget]::Process)