$ErrorActionPreference = "Stop"

# 1. Read the secret from the JSON output produced by AWS CLI
$jsonContent = Get-Content -Raw secret.json | ConvertFrom-Json
$secret = $jsonContent.Secret

if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Error "Failed to extract JWT_SECRET from secret.json"
    exit 1
}

# 2. Set it in the environment for the CDK process
$env:JWT_SECRET = $secret

Write-Host "JWT_SECRET successfully injected into environment. Starting CDK deployment..."

# 3. Suppress AWS CLI Pager to avoid weird console locks and deploy specifically AdminN1
$env:AWS_PAGER = ""
npx cdk deploy TodaysDentalInsightsAdminN1 --require-approval never
