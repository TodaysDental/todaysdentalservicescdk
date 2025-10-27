# PowerShell script to migrate Connect users from old schema to ABR schema
# Run this script to migrate existing Connect user data

Write-Host "🚀 Starting Connect users migration to ABR schema..." -ForegroundColor Green

try {
    # Check if Node.js is available
    $nodeVersion = & node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js is not installed or not in PATH"
    }

    Write-Host "📊 Node.js found: $nodeVersion" -ForegroundColor Yellow

    # Run the migration script
    Write-Host "🔄 Running migration script..." -ForegroundColor Yellow

    & node $PSScriptRoot/migrate-connect-users-abr.ts

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }

} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
