# PowerShell Testing Script for Callback API
# This script tests the POST endpoint for callback creation

param(
    [string]$BaseUrl = "https://api.todaysdentalinsights.com",
    [string]$ClinicId = "todaysdentalcayce"
)

$Endpoint = "$BaseUrl/callback/$ClinicId"
$Headers = @{
    "Content-Type" = "application/json"
    "origin" = "https://todaysdentalcayce.com"
}

Write-Host "🧪 Testing Callback API POST Endpoint" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Endpoint: $Endpoint" -ForegroundColor Gray
Write-Host ""

# Test 1: Valid callback request with required fields only
Write-Host "Test 1: Valid callback with required fields only" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "name": "John Doe",
        "phone": "1234567890"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Success (201 expected)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Valid callback request with all optional fields
Write-Host "Test 2: Valid callback with all fields" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "name": "Jane Smith",
        "phone": "+15551234567",
        "email": "jane.smith@example.com",
        "message": "I would like to schedule a cleaning appointment",
        "source": "website"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Success (201 expected)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

# Test 3: Missing name field (should fail)
Write-Host "Test 3: Missing name field (should fail)" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "phone": "1234567890"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Unexpected success" -ForegroundColor Red
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

# Test 4: Missing phone field (should fail)
Write-Host "Test 4: Missing phone field (should fail)" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "name": "John Doe"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Unexpected success" -ForegroundColor Red
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

# Test 5: Invalid phone number format (should fail)
Write-Host "Test 5: Invalid phone number format (should fail)" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "name": "John Doe",
        "phone": "123"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Unexpected success" -ForegroundColor Red
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

# Test 6: Invalid email format (should fail)
Write-Host "Test 6: Invalid email format (should fail)" -ForegroundColor Yellow
try {
    $Response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $Headers -Body '{
        "name": "John Doe",
        "phone": "1234567890",
        "email": "invalid-email"
    }' -ContentType "application/json"

    Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
    Write-Host "Status: Unexpected success" -ForegroundColor Red
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

Write-Host ""

Write-Host "✅ Callback API Testing Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Expected Results:" -ForegroundColor Cyan
Write-Host "✅ Tests 1 & 2: Should return 201 (Created) - successful callback creation"
Write-Host "❌ Tests 3 & 4: Should return 400 (Bad Request) - missing required fields"
Write-Host "❌ Test 5: Should return 400 (Bad Request) - invalid phone format"
Write-Host "❌ Test 6: Should return 400 (Bad Request) - invalid email format"
