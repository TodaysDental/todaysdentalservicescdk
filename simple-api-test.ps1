#!/usr/bin/env powershell
# Simple API Test for Chime endpoints

$IdToken = "eyJraWQiOiIzWkU5MDVmMWZVaHhZcWh1MTVVVm84ODJvQ1ZGenRCRmpzTUVcL2lRb1VOMD0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhNDE4MDQ0OC03MDgxLTcwODgtYTFmMi03ZGNjYmQyYTdmZjMiLCJjb2duaXRvOmdyb3VwcyI6WyJjbGluaWNfZGVudGlzdGlucGVycnlzYnVyZ19fQURNSU4iXSwiZW1haWxfdmVyaWZpZWQiOnRydWUsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0xX01QYXF5WVVjYyIsImNvZ25pdG86dXNlcm5hbWUiOiJhNDE4MDQ0OC03MDgxLTcwODgtYTFmMi03ZGNjYmQyYTdmZjMiLCJnaXZlbl9uYW1lIjoicGVycnlzYnVyZyIsIm9yaWdpbl9qdGkiOiJhNTI2ZmNiYi0xM2JlLTQxZjUtODg0ZS04OWUxZGUwMGQ5ZmYiLCJhdWQiOiI0MDI0YzRvYmYwbmU0dWdiOGRlZzFrNmVndCIsImV2ZW50X2lkIjoiNTM2Yjg5YzYtMmQ5My00ODQzLTg4NTAtZGE4NGI4NjcyZTlkIiwidG9rZW5fdXNlIjoiaWQiLCJhdXRoX3RpbWUiOjE3NjE3NjAzOTksImV4cCI6MTc2MTc2Mzk5OSwiaWF0IjoxNzYxNzYwMzk5LCJmYW1pbHlfbmFtZSI6IkNsaW5pYyIsImp0aSI6IjQyNmZhMWVlLWNmYzgtNGM5NC1hMzEwLWRlMGJjMTg3M2U5MCIsImVtYWlsIjoiZGVudGlzdGlucGVycnlzYnVyZ0BnbWFpbC5jb20ifQ.SIZbW8RA4-7KQtn3hM7E89c9c4Dwtc8oIkOXassi9c4IyteC_sEwnkBuwXUoz3g4FXijKO05_uMlU-bIMrURvTsY2uR-I3RXby3QOu3EvOG3YmtzvNBksdELJ6wse6EYAWDbTeFuwoc20JSqcBsPRSzx3CkKoZ7YQyE-JSxSsjfAPW0lTj-NCJH8ZAsXXj0oRkK_e08Xv41o1D99IU_l1a74_zy__RyQS53rNQJpBKgX9N6oEKt9qOjkFactA-ngJuecxpmfxuTnUosqT1wvK8q5GP0bYU_ua-QlWw-d2oM_d5S6d63WhRMsXa9QzUTPatpu6opoc4NP2cXrP2z-fw"
$ApiBase = "https://api.todaysdentalinsights.com"
$Origin = "https://todaysdentalinsights.com"

Write-Host "Testing Chime API..." -ForegroundColor Cyan
Write-Host ""

# Test OPTIONS preflight
Write-Host "1. Testing OPTIONS preflight..." -ForegroundColor Yellow
try {
    $response = curl.exe -X OPTIONS `
        "$ApiBase/admin/chime/start-session" `
        -H "Origin: $Origin" `
        -H "Access-Control-Request-Method: POST" `
        -H "Access-Control-Request-Headers: authorization,content-type" `
        -i -s

    Write-Host "OPTIONS Response:" -ForegroundColor Green
    Write-Host $response
    Write-Host ""
} catch {
    Write-Host "OPTIONS failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test POST request
Write-Host "2. Testing POST /admin/chime/start-session..." -ForegroundColor Yellow
$body = '{"activeClinicIds":["dentistinperrysburg"]}'

try {
    $response = curl.exe -X POST `
        "$ApiBase/admin/chime/start-session" `
        -H "Authorization: Bearer $IdToken" `
        -H "Content-Type: application/json" `
        -H "Origin: $Origin" `
        -d $body `
        -i -s

    Write-Host "POST Response:" -ForegroundColor Green
    Write-Host $response
    Write-Host ""
} catch {
    Write-Host "POST failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test with PowerShell Invoke-RestMethod for better error handling
Write-Host "3. Testing with PowerShell Invoke-RestMethod..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $IdToken"
    "Content-Type" = "application/json"
    "Origin" = $Origin
}

$bodyObj = @{
    activeClinicIds = @("dentistinperrysburg")
}

try {
    $response = Invoke-RestMethod -Uri "$ApiBase/admin/chime/start-session" -Method POST -Headers $headers -Body ($bodyObj | ConvertTo-Json) -ErrorAction Stop
    Write-Host "Success! Response:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response body: $responseBody" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Test completed!" -ForegroundColor Cyan

