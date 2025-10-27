# PowerShell Testing Script for Notifications API
param(
    [string]$BaseUrl = "https://api.todaysdentalinsights.com",
    [string]$BearerToken = "eyJraWQiOiIzWkU5MDVmMWZVaHhZcWh1MTVVVm84ODJvQ1ZGenRCRmpzTUVcL2lRb1VOMD0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhNDM4NjQzOC1mMGMxLTcwMTItZTRmNS03ZTUxZWMxZmQ5Y2MiLCJjb2duaXRvOmdyb3VwcyI6WyJjbGluaWNfdG9kYXlzZGVudGFsY2F5Y2VfX1VTRVIiLCJjbGluaWNfY3JlZWtjcm9zc2luZ2RlbnRhbGNhcmVfX1VTRVIiLCJjbGluaWNfcGVhcmxhbmRkZW50YWxjYXJlX19VU0VSIiwiY2xpbmljX2RlbnRpc3RpbmdyZWVudmlsbGVfX1VTRVIiLCJjbGluaWNfcmVub2RlbnRhbGNhcmVhbmRvcnRob2RvbnRpY3NfX1VTRVIiLCJjbGluaWNfZGVudGlzdGluY2VudGVubmlhbF9fVVNFUiIsImNsaW5pY19sYXdyZW5jZXZpbGxlZGVudGlzdHJ5X19VU0VSIiwiY2xpbmljX2RlbnRpc3RpbnN0aWxsd2F0ZXJfX1VTRVIiLCJjbGluaWNfdG9kYXlzZGVudGFsd2VzdGNvbHVtYmlhX19VU0VSIiwiY2xpbmljX2RlbnRpc3RhdHNhbHVkYXBvaW50ZV9fVVNFUiIsImNsaW5pY19kZW50aXN0aW5uZXdicml0YWluX19VU0VSIiwiY2xpbmljX2RlbnRpc3RpbnBvd2VsbG9oaW9fX1VTRVIiLCJjbGluaWNfbWVhZG93c2RlbnRhbGNhcmVfX1VTRVIiLCJjbGluaWNfdGhlcmltZGVudGFsY2FyZV9fVVNFUiIsImNsaW5pY19kZW50aXN0aW5lZGdld2F0ZXJfX1VTRVIiLCJjbGluaWNfZGVudGlzdGlud2luc3Rvbi1zYWxlbV9fVVNFUiIsImNsaW5pY19kZW50aXN0aW5wZXJyeXNidXJnX19VU0VSIiwiY2xpbmljX3RvZGF5c2RlbnRhbGxleGluZ3Rvbl9fVVNFUiIsImNsaW5pY19kZW50aXN0aW5hdXN0aW5fX1VTRVIiLCJjbGluaWNfZGVudGlzdGludmVybm9uaGlsbHNfX1VTRVIiLCJjbGluaWNfZGVudGlzdGluYmxvb21pbmdkYWxlX19VU0VSIiwiY2xpbmljX3RvZGF5c2RlbnRhbGFsZXhhbmRyaWFfX1VTRVIiLCJjbGluaWNfZGVudGlzdGlubG91aXN2aWxsZV9fVVNFUiIsImNsaW5pY19kZW50aXN0aW5jb25jb3JkX19VU0VSIiwiY2xpbmljX3RvZGF5c2RlbnRhbGdyZWVudmlsbGVfX1VTRVIiLCJjbGluaWNfZGVudGlzdGluYm93aWVfX1VTRVIiLCJjbGluaWNfZGVudGlzdGlub3JlZ29ub2hfX1VTRVIiXSwiZW1haWxfdmVyaWZpZWQiOnRydWUsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0xX01QYXF5WVVjYyIsImNvZ25pdG86dXNlcm5hbWUiOiJhNDM4NjQzOC1mMGMxLTcwMTItZTRmNS03ZTUxZWMxZmQ5Y2MiLCJnaXZlbl9uYW1lIjoic3dhcmFqIiwib3JpZ2luX2p0aSI6IjkzNDcwMTE4LTRlMzQtNGJlOS1hNjY2LTU0YTExMWYyZTYwNyIsImF1ZCI6IjQwMjRjNG9iZjBuZTR1Z2I4ZGVnMWs2ZWd0IiwiZXZlbnRfaWQiOiI5ZDU3ODNmMi1hOTA1LTQ4NGEtYTJjOC05YzQ5OWFhYWQwZTIiLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTc2MDg2NzQyMCwiZXhwIjoxNzYwODcxMDIwLCJpYXQiOjE3NjA4Njc0MjEsImZhbWlseV9uYW1lIjoicGFyYW1hdGEiLCJqdGkiOiIwNzhkZDk5Ny01YmNlLTRjZTctOTU3Yy0xZDU3Yzk2NmYyMzUiLCJlbWFpbCI6InN3YXJhanBhcmFtYXRhQGdtYWlsLmNvbSJ9.TeQYheGExZF7kUYRfD9qp5foeyQWqmQioPq6rElbjllDMA_iPUszLPvPlw_HiW4uoVn6ubm8iKzLUKGoxNBdbPMvzemRWca-Djxss9NVq16_3Dz699JTaVktdlZ23qtcXxjIjMJ9dNZTXsuj-FCAV-1euuXKecS5NIAbrRdR50lLdbiB1uECzx7aT4OoYpP_kY2tkWZyXrrkYoUlkuHsOKpgS7W8E_ZXutxeR6BUx5Z6x9LTm-P4AQmQxGAgEM5Yzx7qJGp5NNJqVkW9E_UfVnMG7NF0Ucqp0hplq5cQmTxP0NK8uINmrnPUPzYqzRZA_12v_J3djvY_VX6D-HwWMA",  # Provide your token when running the script
    [switch]$SkipAuthTests = $false  # Skip tests that require authentication
)

Write-Host @"
Note: This script requires an ACCESS token (not an ID token) with proper clinic permissions.

Required Token Type:
- Must be an access token (token_use: "access")
- NOT an ID token (token_use: "id")

Required Permissions (one of these):
1. Staff Access:
   - CLINIC_dentistinnewbritain_STAFF group
   - CLINIC_dentistinnewbritain_ADMIN group

2. Global Access:
   - GLOBAL__SUPER_ADMIN group AND
   - CLINIC_dentistinnewbritain_ACCESS or similar clinic-specific access group

Note: The current clinic ID in use is 'dentistinnewbritain'
You can modify this in the script if testing with a different clinic.
"@ -ForegroundColor Yellow
Write-Host ''

$NotificationsEndpoint = "$BaseUrl/notifications/notifications"
$ClinicNotifyEndpoint = "$BaseUrl/notifications/clinic/dentistinnewbritain/notification"
$Headers = @{
    'Content-Type' = 'application/json'
    'accept' = 'application/json, text/plain, */*'
    'origin' = 'https://todaysdentalinsights.com'
    'dnt' = '1'
    'referer' = 'https://todaysdentalinsights.com/'
    'sec-ch-ua' = '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"'
    'sec-ch-ua-mobile' = '?1'
    'sec-ch-ua-platform' = 'Android'
    'user-agent' = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
}

if ($BearerToken) {
    $Headers['Authorization'] = "Bearer $BearerToken"
    $HasAuth = $true
} else {
    $HasAuth = $false
}

$AuthNote = if ($HasAuth) { 'WITH AUTHENTICATION' } else { 'WITHOUT AUTHENTICATION' }
Write-Host "🧪 Testing Notifications API Endpoints $AuthNote" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "GET Endpoint: $NotificationsEndpoint" -ForegroundColor Gray
Write-Host "POST Endpoint: $ClinicNotifyEndpoint" -ForegroundColor Gray
if ($HasAuth) {
    Write-Host 'Bearer Token: Provided ✅' -ForegroundColor Green
} else {
    Write-Host 'Bearer Token: NOT PROVIDED ❌' -ForegroundColor Red
    Write-Host 'Note: Most tests will fail without proper authentication' -ForegroundColor Yellow
}
Write-Host ''

# Helper function for JWT decoding
function ConvertFrom-JWT {
    param($Token)
    try {
        $TokenParts = $Token.Split('.')
        if ($TokenParts.Length -ne 3) { return $null }
        
        # Handle Base64Url encoding
        $Payload = $TokenParts[1].Replace('-', '+').Replace('_', '/')
        switch ($Payload.Length % 4) {
            0 { break }
            2 { $Payload += '==' }
            3 { $Payload += '=' }
        }
        
        return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    } catch {
        return $null
    }
}

# Helper function for error handling
function Write-ErrorDetails {
    param($ErrorRecord)
    Write-Host "Error: $($ErrorRecord.Exception.Message)" -ForegroundColor Red
    if ($ErrorRecord.Exception.Response) {
        $StatusCode = $ErrorRecord.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $StatusCode" -ForegroundColor Red
        
        # Try to get response content
        try {
            $Reader = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream())
            $ResponseContent = $Reader.ReadToEnd()
            Write-Host "Response Content: $ResponseContent" -ForegroundColor Red
            $Reader.Close()
        } catch {}

        if ($StatusCode -eq 401) {
            Write-Host 'Expected: Requires authentication' -ForegroundColor Yellow
            Write-Host 'Debug: Verify Authentication:' -ForegroundColor Yellow
            Write-Host "Authorization header present: $($Headers.ContainsKey('Authorization'))" -ForegroundColor Yellow
            Write-Host "Response Headers:" -ForegroundColor Yellow
            try { $ErrorRecord.Exception.Response.Headers | ConvertTo-Json | Write-Host -ForegroundColor Yellow } catch {}
            
            $TokenClaims = ConvertFrom-JWT $BearerToken
            if ($TokenClaims) {
                Write-Host 'Token Claims:' -ForegroundColor Yellow
                Write-Host ($TokenClaims | ConvertTo-Json) -ForegroundColor Yellow
                if ($TokenClaims.exp) {
                    $ExpiryTime = [DateTimeOffset]::FromUnixTimeSeconds($TokenClaims.exp).LocalDateTime
                    Write-Host "Token Expiry: $ExpiryTime" -ForegroundColor Yellow
                }
            }
        } elseif ($StatusCode -eq 403) {
            Write-Host 'Expected: Requires proper clinic access/groups' -ForegroundColor Yellow
            Write-Host 'Debug: Token Information:' -ForegroundColor Yellow
            
            $TokenClaims = ConvertFrom-JWT $BearerToken
            if ($TokenClaims) {
                $Groups = $TokenClaims.'cognito:groups'
                Write-Host "`nCurrent Groups:" -ForegroundColor Yellow
                Write-Host ($Groups -join "`n") -ForegroundColor Yellow
                
                Write-Host "`nMissing Required Access:" -ForegroundColor Red
                if ($Groups -contains 'GLOBAL__SUPER_ADMIN') {
                    Write-Host "You have GLOBAL__SUPER_ADMIN but need additional clinic access:" -ForegroundColor Yellow
                    Write-Host "- CLINIC_dentistinnewbritain_ACCESS" -ForegroundColor Yellow
                } else {
                    Write-Host "Need one of these group memberships:" -ForegroundColor Yellow
                    Write-Host "- CLINIC_dentistinnewbritain_STAFF" -ForegroundColor Yellow
                    Write-Host "- CLINIC_dentistinnewbritain_ADMIN" -ForegroundColor Yellow
                    Write-Host "- GLOBAL__SUPER_ADMIN + CLINIC_dentistinnewbritain_ACCESS" -ForegroundColor Yellow
                }
                
                Write-Host "`nToken Details:" -ForegroundColor Gray
                Write-Host "Username: $($TokenClaims.username)" -ForegroundColor Gray
                if ($TokenClaims.exp) {
                    $ExpiryTime = [DateTimeOffset]::FromUnixTimeSeconds($TokenClaims.exp).LocalDateTime
                    Write-Host "Expires: $ExpiryTime" -ForegroundColor Gray
                }
            }
        }
    }
}

Write-Host '📥 Testing GET /notifications/notifications Endpoint' -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

# Test 1: Valid GET request with required PatNum parameter only
Write-Host '[Test 1] Valid GET request with PatNum only' -ForegroundColor Yellow
try {
    $Url = "${NotificationsEndpoint}?PatNum=100792"
    Write-Host "Request URL: $Url" -ForegroundColor Gray

    if (-not $HasAuth) {
        Write-Host 'Skipping test - requires authentication' -ForegroundColor Yellow
    } else {
        $Response = Invoke-RestMethod -Uri $Url -Method Get -Headers $Headers
        Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
        Write-Host '✅ Status: Success (200)' -ForegroundColor Green
    }
} catch {
    Write-ErrorDetails $_
}

Write-Host ''

# Test 2: Valid GET request with both PatNum and email parameters
Write-Host '[Test 2] Valid GET request with PatNum and email' -ForegroundColor Yellow
try {
    $Url = "${NotificationsEndpoint}?PatNum=100792&email=todaysdentalpartners@gmail.com"
    Write-Host "Request URL: $Url" -ForegroundColor Gray

    if (-not $HasAuth) {
        Write-Host 'Skipping test - requires authentication' -ForegroundColor Yellow
    } else {
        $Response = Invoke-RestMethod -Uri $Url -Method Get -Headers $Headers
        Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
        Write-Host '✅ Status: Success (200)' -ForegroundColor Green
    }
} catch {
    Write-ErrorDetails $_
}

Write-Host ''

# Test 3: Missing PatNum parameter (should fail with 400)
Write-Host '[Test 3] Missing PatNum parameter (should fail)' -ForegroundColor Yellow
try {
    $Url = "${NotificationsEndpoint}?email=todaysdentalpartners@gmail.com"
    Write-Host "Request URL: $Url" -ForegroundColor Gray

    if (-not $HasAuth) {
        Write-Host 'Skipping test - requires authentication' -ForegroundColor Yellow
    } else {
        $Response = Invoke-RestMethod -Uri $Url -Method Get -Headers $Headers
        Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
        Write-Host '❌ Status: Unexpected success (expected 400)' -ForegroundColor Red
    }
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) {
        Write-Host '✅ Status: Expected 400 - Missing required PatNum parameter' -ForegroundColor Green
    } else {
        Write-ErrorDetails $_
    }
}

Write-Host ''

# Test POST endpoints
Write-Host '📤 Testing POST /clinic/{clinicId}/notification endpoints' -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

function Test-NotificationPost {
    param(
        [Parameter(Mandatory=$true)]
        [string]$TestName,
        
        [Parameter(Mandatory=$true)]
        [hashtable]$Payload,
        
        [Parameter(Mandatory=$false)]
        [string]$ExpectedError
    )
    
    Write-Host "[$TestName]" -ForegroundColor Yellow
    
    if (-not $HasAuth) {
        Write-Host 'Skipping test - requires authentication' -ForegroundColor Yellow
        return
    }
    
    try {
        $Body = $Payload | ConvertTo-Json
        Write-Host "Request URL: $ClinicNotifyEndpoint" -ForegroundColor Gray
        Write-Host "Request Body: $Body" -ForegroundColor Gray
        
        # Ensure Content-Type is set for POST
        $PostHeaders = $Headers.Clone()
        $PostHeaders['Content-Type'] = 'application/json'
        
        $Response = Invoke-RestMethod -Uri $ClinicNotifyEndpoint -Method Post -Headers $PostHeaders -Body $Body
        
        if ($ExpectedError) {
            Write-Host "❌ Test failed: Expected error '$ExpectedError' but request succeeded" -ForegroundColor Red
        } else {
            Write-Host "Response: $($Response | ConvertTo-Json -Depth 3)"
            Write-Host '✅ Status: Success (200)' -ForegroundColor Green
        }
    } catch {
        if ($ExpectedError -and $_.Exception.Response.StatusCode.value__ -eq $ExpectedError) {
            Write-Host "✅ Expected error received: $ExpectedError" -ForegroundColor Green
        } else {
            Write-ErrorDetails $_
        }
    }
    Write-Host ''
}

# Test 4: Valid notification with all required fields
$ValidPayload = @{
    Email = 'todaysdentalpartners@gmail.com'
    FName = 'Sunil'
    LName = 'Eamani'
    PatNum = "100792"  # Changed to string to match schema
    clinicId = 'dentistinnewbritain'
    notificationTypes = @('EMAIL')
    templateMessage = 'Dentipal'
    toEmail = 'todaysdentalpartners@gmail.com'
}
Test-NotificationPost -TestName "Valid POST request with all required fields" -Payload $ValidPayload

# Test 5: Missing required fields
$InvalidPayload = @{
    Email = 'todaysdentalpartners@gmail.com'
    clinicId = 'dentistinnewbritain'
}
Test-NotificationPost -TestName "POST request with missing required fields" -Payload $InvalidPayload -ExpectedError 400

# Test 6: Invalid notification type
$InvalidTypePayload = $ValidPayload.Clone()
$InvalidTypePayload.notificationTypes = @('INVALID_TYPE')
Test-NotificationPost -TestName "POST request with invalid notification type" -Payload $InvalidTypePayload -ExpectedError 400

# Test 7: Invalid email format
$InvalidEmailPayload = $ValidPayload.Clone()
$InvalidEmailPayload.Email = 'invalid-email'
Test-NotificationPost -TestName "POST request with invalid email format" -Payload $InvalidEmailPayload -ExpectedError 400

Write-Host ''
Write-Host '✅ Testing Complete!' -ForegroundColor Green
Write-Host ''
Write-Host 'Usage Examples:' -ForegroundColor Cyan
Write-Host '.\test-notifications-api.ps1 -BearerToken ''your-jwt-token''' -ForegroundColor Yellow
Write-Host '.\test-notifications-api.ps1 # Test without token' -ForegroundColor Yellow