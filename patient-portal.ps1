# PowerShell Testing Script for Patient Portal API
# This script tests login, authenticated endpoints, logout, and patient creation with extensive validation.

param(
    [string]$BaseUrl = "https://api.todaysdentalinsights.com/patientportal",
    [string]$ClinicId = "todaysdentalcayce",
    
    # --- Credentials for an EXISTING Test Patient (for login tests) ---
    [string]$ExistingPatientLName = "Smith",
    [string]$ExistingPatientBirthdate = "1990-01-15", # Format: YYYY-MM-DD

    # --- Details for the NEW Patient and Appointment Workflow ---
    [string]$NewPatientFName = "Jane",
    [string]$NewPatientLName = "TestFlow" + (Get-Random -Minimum 100 -Maximum 999), # Ensures uniqueness
    [string]$NewPatientBirthdate = "1995-11-30",
    [string]$NewPatientEmail = "jane.flow" + (Get-Random -Minimum 100 -Maximum 999) + "@test.com",
    [string]$TestProvNum = "1", # Provider number to check for available slots
    [string]$TestOpNum = "2"    # Operatory number
)

# --- Global variables for tracking test results ---
$Global:TestCount = 0
$Global:PassCount = 0
$Global:FailCount = 0
$Global:SessionToken = $null

$Headers = @{
    "Content-Type" = "application/json"
    "origin"       = "https://todaysdentalcayce.com" # Example origin
}

# --- Revamped Helper Function ---
function Test-Endpoint {
    param(
        [string]$TestName,
        [string]$Endpoint,
        [string]$Method,
        [hashtable]$Headers,
        [string]$Body = $null,
        [boolean]$ShouldSucceed,
        [int]$ExpectedSuccessCode = 200,
        [int]$ExpectedFailCode = 400
    )

    $Global:TestCount++
    Write-Host "➡️  Testing: $TestName" -ForegroundColor Yellow
    
    $result = [PSCustomObject]@{
        Success = $false
        Response = $null
    }

    try {
        $params = @{
            Uri         = $Endpoint
            Method      = $Method
            Headers     = $Headers
            ContentType = "application/json"
        }
        if ($Body) { $params.Body = $Body }

        $Response = Invoke-RestMethod @params
        $result.Response = $Response

        if ($ShouldSucceed) {
            Write-Host "✅  PASS: Test succeeded as expected (Code: $ExpectedSuccessCode)." -ForegroundColor Green
            $Global:PassCount++
            $result.Success = $true
        } else {
            Write-Host "❌  FAIL: Test succeeded but was expected to fail." -ForegroundColor Red
            $Global:FailCount++
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if (-not $ShouldSucceed -and ($statusCode -eq $ExpectedFailCode -or ($ExpectedFailCode -eq 404 -and $statusCode -eq 404))) {
            Write-Host "✅  PASS: Test failed as expected (Code: $statusCode)." -ForegroundColor Green
            $Global:PassCount++
            $result.Success = $true
        } else {
            Write-Host "❌  FAIL: Test failed unexpectedly. Status Code: $statusCode" -ForegroundColor Red
            Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
            $Global:FailCount++
        }
    }
    Write-Host ""
    return $result
}

#################################################################################
## Workflow 1: Existing Patient Session Management
#################################################################################
Write-Host "🧪 Workflow 1: Testing Session for an EXISTING Patient" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1.1: Failed Login (Incorrect Credentials)
$failedLoginEndpoint = "$BaseUrl/$ClinicId/patients/simple?LName=NonExistent&Birthdate=2000-01-01"
Test-Endpoint -TestName "Login with non-existent patient" -Endpoint $failedLoginEndpoint -Method 'Get' -Headers $Headers -ShouldSucceed $false -ExpectedFailCode 404

# 1.2: Successful Login
$loginEndpoint = "$BaseUrl/$ClinicId/patients/simple?LName=$ExistingPatientLName&Birthdate=$ExistingPatientBirthdate"
$loginResult = Test-Endpoint -TestName "Login with existing patient" -Endpoint $loginEndpoint -Method 'Get' -Headers $Headers -ShouldSucceed $true
if ($loginResult.Success -and $loginResult.Response.token) {
    $Global:SessionToken = $loginResult.Response.token
}

# 1.3 & 1.4: Access Protected Endpoints (Authenticated)
if ($Global:SessionToken) {
    $authHeaders = $Headers.Clone(); $authHeaders.Add("Authorization", "Bearer $($Global:SessionToken)")
    Test-Endpoint -TestName "Get appointments with valid token" -Endpoint "$BaseUrl/$ClinicId/appointments" -Method 'Get' -Headers $authHeaders -ShouldSucceed $true
    Test-Endpoint -TestName "Get treatment plans with valid token" -Endpoint "$BaseUrl/$ClinicId/treatmentplans" -Method 'Get' -Headers $authHeaders -ShouldSucceed $true
}

# 1.5: Logout
if ($Global:SessionToken) {
    Test-Endpoint -TestName "Logout the existing patient" -Endpoint "$BaseUrl/$ClinicId/logout" -Method 'Post' -Headers $authHeaders -Body "{}" -ShouldSucceed $true
}

# 1.6: Attempt to use the invalidated token (Should Fail)
if ($Global:SessionToken) {
    Test-Endpoint -TestName "Attempt to use invalidated token" -Endpoint "$BaseUrl/$ClinicId/appointments" -Method 'Get' -Headers $authHeaders -ShouldSucceed $false -ExpectedFailCode 401
}


#################################################################################
## Workflow 2: New Patient Creation - Validation Tests
#################################################################################
Write-Host "🧪 Workflow 2: Testing Validation for NEW Patient Creation (POST /patients)" -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

# 2.1: SUCCESS Case
$validBody = @{ FName = "Valid"; LName = "Patient" + (Get-Random); Birthdate = "1985-05-20"; Address = "123 Way"; City = "Testville"; State = "TS"; Zip = "500081"; WirelessPhone = "9876543210"; Email = "valid" + (Get-Random) + "@test.com" } | ConvertTo-Json
Test-Endpoint -TestName "Create patient with all valid fields" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body $validBody -ShouldSucceed $true

# 2.2 - 2.9: FAIL Cases for missing or invalid fields
$baseInvalidBody = $validBody | ConvertFrom-Json
$testBody = $baseInvalidBody | Select-Object *; $testBody.PSObject.Properties.Remove('FName'); Test-Endpoint -TestName "FAIL on missing First Name" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.PSObject.Properties.Remove('LName'); Test-Endpoint -TestName "FAIL on missing Last Name" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.PSObject.Properties.Remove('State'); Test-Endpoint -TestName "FAIL on missing State" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.PSObject.Properties.Remove('Zip'); Test-Endpoint -TestName "FAIL on missing Zip" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.PSObject.Properties.Remove('WirelessPhone'); Test-Endpoint -TestName "FAIL on missing Phone" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.Birthdate = "20-05-1985"; Test-Endpoint -TestName "FAIL on invalid Birthdate format" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false
$testBody = $baseInvalidBody | Select-Object *; $testBody.Email = "invalid-email"; Test-Endpoint -TestName "FAIL on invalid Email format" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body ($testBody | ConvertTo-Json) -ShouldSucceed $false

# 2.10: FAIL on creating a duplicate patient
Test-Endpoint -TestName "FAIL on creating a duplicate patient" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body $validBody -ShouldSucceed $false


#################################################################################
## Workflow 3: End-to-End - Create Patient, Book & Cancel Appointment
#################################################################################
Write-Host "🧪 Workflow 3: End-to-End Test for NEW Patient and Appointment" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# --- Step 3.1: Create the New Patient ---
$newPatientBody = @{ FName = $NewPatientFName; LName = $NewPatientLName; Birthdate = $NewPatientBirthdate; Address = "456 New Beginnings Ave"; City = "Workflow City"; State = "WF"; Zip = "12345"; WirelessPhone = "5551234567"; Email = $NewPatientEmail } | ConvertTo-Json
$creationResult = Test-Endpoint -TestName "Create a new patient for the workflow" -Endpoint "$BaseUrl/$ClinicId/patients" -Method 'Post' -Headers $Headers -Body $newPatientBody -ShouldSucceed $true
$newPatNum = $creationResult.Response.PatNum

if ($creationResult.Success) {
    # --- Step 3.2: Log in as the New Patient ---
    $newLoginResult = Test-Endpoint -TestName "Log in as the newly created patient" -Endpoint "$BaseUrl/$ClinicId/patients/simple?LName=$NewPatientLName&Birthdate=$NewPatientBirthdate" -Method 'Get' -Headers $Headers -ShouldSucceed $true
    
    if ($newLoginResult.Success) {
        $newPatientToken = $newLoginResult.Response.token
        $newAuthHeaders = $Headers.Clone(); $newAuthHeaders.Add("Authorization", "Bearer $newPatientToken")

        # --- Step 3.3: Find Available Appointment Slots ---
        $futureDate = (Get-Date).AddDays(7).ToString("yyyy-MM-dd")
        $slotsResult = Test-Endpoint -TestName "Find available appointment slots" -Endpoint "$BaseUrl/$ClinicId/appointments/slots?Date=$futureDate&ProvNum=$TestProvNum" -Method 'Get' -Headers $newAuthHeaders -ShouldSucceed $true
        
        if ($slotsResult.Success -and $slotsResult.Response.Count -gt 0) {
            $firstSlot = $slotsResult.Response[0]
            Write-Host "   -> Found available slot: $($firstSlot.StartDateTime)" -ForegroundColor White

            # --- Step 3.4: Book the Appointment ---
            $bookingBody = @{ PatNum = $newPatNum; AptDateTime = $firstSlot.StartDateTime; ProvNum = $firstSlot.ProvNum; Op = $firstSlot.Op; Pattern = $firstSlot.Pattern; Note = "Booked via PowerShell E2E Test" } | ConvertTo-Json
            $bookingResult = Test-Endpoint -TestName "Book the first available slot" -Endpoint "$BaseUrl/$ClinicId/appointments" -Method 'Post' -Headers $newAuthHeaders -Body $bookingBody -ShouldSucceed $true
            $bookedAptNum = $bookingResult.Response.AptNum
            
            # --- Step 3.5: NEW! Cancel the Appointment ---
            if ($bookingResult.Success) {
                $cancellationBody = @{ PatNum = $newPatNum; AptNum = $bookedAptNum; aptStatus = "Broken"; reason = "Cancelled by E2E test" } | ConvertTo-Json
                Test-Endpoint -TestName "Cancel the newly created appointment" -Endpoint "$BaseUrl/$ClinicId/appointments/$bookedAptNum/break" -Method 'Put' -Headers $newAuthHeaders -Body $cancellationBody -ShouldSucceed $true
            }
        } else {
             Write-Host "   -> SKIPPING Appointment Booking/Cancellation: No available slots found." -ForegroundColor Gray
        }
        
        # --- Step 3.6: Logout ---
        Test-Endpoint -TestName "Logout the new patient" -Endpoint "$BaseUrl/$ClinicId/logout" -Method 'Post' -Headers $newAuthHeaders -Body "{}" -ShouldSucceed $true
    }
} else {
    Write-Host "   -> SKIPPING Workflow 3: Failed to create the initial patient." -ForegroundColor Red
}

#################################################################################
## Final Test Summary
#################################################################################
Write-Host "📊 Test Run Summary" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host "Total Tests Run: $Global:TestCount"
Write-Host "Tests Passed: $Global:PassCount" -ForegroundColor Green
Write-Host "Tests Failed: $Global:FailCount" -ForegroundColor Red
Write-Host ""

if ($Global:FailCount -eq 0) {
    Write-Host "All tests passed successfully!" -ForegroundColor Green
} else {
    Write-Host "Some tests failed. Please review the output above." -ForegroundColor Red
}