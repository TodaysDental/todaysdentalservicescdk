# Test Script for Dental Software API
# This script tests the Clinic CRUD operations

param(
    [Parameter(Mandatory=$true)]
    [string]$JwtToken,
    
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "https://apig.todaysdentalinsights.com/dental-software"
)

$headers = @{
    "Authorization" = "Bearer $JwtToken"
    "Content-Type" = "application/json"
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Dental Software API Test Suite" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Initialize Database
Write-Host "[Test 1/6] Initializing database..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/init-database" -Method Post -Headers $headers
    if ($response.success) {
        Write-Host "✓ Database initialized: $($response.message)" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: Create Clinic
Write-Host "[Test 2/6] Creating new clinic..." -ForegroundColor Yellow
$newClinic = @{
    Description = "Test Dental Clinic"
    Address = "123 Test Street"
    Address2 = "Suite 100"
    City = "Springfield"
    State = "IL"
    Zip = "62701"
    Phone = "2175551234"
    BankNumber = "TEST123456"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/clinics" -Method Post -Headers $headers -Body $newClinic
    if ($response.success) {
        $clinicId = $response.data.ClinicNum
        Write-Host "✓ Clinic created with ID: $clinicId" -ForegroundColor Green
        Write-Host "  Description: $($response.data.Description)" -ForegroundColor Gray
    } else {
        Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 3: Get All Clinics
Write-Host "[Test 3/6] Fetching all clinics..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/clinics" -Method Get -Headers $headers
    if ($response.success) {
        $count = $response.data.Count
        Write-Host "✓ Found $count clinic(s)" -ForegroundColor Green
        foreach ($clinic in $response.data) {
            Write-Host "  - [$($clinic.ClinicNum)] $($clinic.Description)" -ForegroundColor Gray
        }
    } else {
        Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 4: Get Specific Clinic
Write-Host "[Test 4/6] Fetching clinic by ID ($clinicId)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/clinics/$clinicId" -Method Get -Headers $headers
    if ($response.success) {
        Write-Host "✓ Retrieved clinic details" -ForegroundColor Green
        Write-Host "  Description: $($response.data.Description)" -ForegroundColor Gray
        Write-Host "  Address: $($response.data.Address)" -ForegroundColor Gray
        Write-Host "  City: $($response.data.City), $($response.data.State) $($response.data.Zip)" -ForegroundColor Gray
    } else {
        Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 5: Update Clinic
Write-Host "[Test 5/6] Updating clinic..." -ForegroundColor Yellow
$updateData = @{
    Phone = "2175559999"
    BankNumber = "UPDATED999"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/clinics/$clinicId" -Method Put -Headers $headers -Body $updateData
    if ($response.success) {
        Write-Host "✓ Clinic updated successfully" -ForegroundColor Green
        Write-Host "  New Phone: $($response.data.Phone)" -ForegroundColor Gray
        Write-Host "  New Bank Number: $($response.data.BankNumber)" -ForegroundColor Gray
    } else {
        Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 6: Delete Clinic
Write-Host "[Test 6/6] Deleting clinic..." -ForegroundColor Yellow
$confirmation = Read-Host "Delete test clinic ID $clinicId? (y/n)"
if ($confirmation -eq 'y' -or $confirmation -eq 'Y') {
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/clinics/$clinicId" -Method Delete -Headers $headers
        if ($response.success) {
            Write-Host "✓ Clinic deleted successfully" -ForegroundColor Green
        } else {
            Write-Host "✗ Failed: $($response.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⊘ Deletion skipped" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Test Suite Complete" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

