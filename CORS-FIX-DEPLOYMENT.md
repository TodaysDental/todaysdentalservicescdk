# CORS Fix Deployment Guide

## Issues Fixed

### 1. Frontend API Path Issue
**Problem:** Frontend was calling `/chime/start-session` instead of `/admin/chime/start-session`
**Solution:** Updated all Chime API routes in `TodaysDentalInsightsFrontend/src/call-center/constants.ts` to include the `/admin` prefix.

### 2. Backend CORS Configuration Issues
**Problem:** API Gateway CORS preflight (OPTIONS) was not properly configured for custom domain with base path mapping.
**Solutions:**
- Created new utility function `getCorsOptionsIntegrationParams()` in `cors.ts` to centralize CORS configuration for API Gateway mock integrations
- Updated `chime-stack.ts` to use the centralized CORS utilities instead of hardcoded values
- Added explicit `proxy: true` to all Lambda integrations to ensure Lambda responses include CORS headers
- Now all CORS configuration comes from the shared `cors.ts` utility, ensuring consistency

### 3. Missing Endpoints
**Problem:** Three Lambda functions existed but weren't wired up in the infrastructure:
- `call-accepted.ts`
- `call-rejected.ts`
- `call-hungup.ts`

**Solution:** Added all three Lambda functions to `chime-stack.ts` with proper CORS configuration.

## Files Changed

### Frontend
- `TodaysDentalInsightsFrontend/src/call-center/constants.ts`
  - Added `/admin` prefix to all chime API routes

### Backend
- `todaysdentalinsightscdk/src/shared/utils/cors.ts`
  - Added new utility function `getCorsOptionsIntegrationParams()` for API Gateway mock integrations
  - Centralizes CORS configuration to ensure consistency across all endpoints
  
- `todaysdentalinsightscdk/src/infrastructure/stacks/chime-stack.ts`
  - Updated to use centralized CORS utilities from `cors.ts`
  - Added `proxy: true` to all Lambda integrations
  - Added three new endpoints: call-accepted, call-rejected, call-hungup

## Deployment Steps

### 1. Deploy Backend Changes
```powershell
cd todaysdentalinsightscdk
npm run build
cdk deploy TodaysDentalInsightsChimeV5 --require-approval never
```

### 2. Test the Deployment
After deployment, test the CORS by:
1. Opening browser DevTools Network tab
2. Making a request from `https://todaysdentalinsights.com` to `https://api.todaysdentalinsights.com/admin/chime/start-session`
3. Verify OPTIONS preflight returns 200 with correct CORS headers:
   - `Access-Control-Allow-Origin: https://todaysdentalinsights.com`
   - `Access-Control-Allow-Methods: POST,OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type,Authorization,X-Requested-With,Referer`
   - `Access-Control-Allow-Credentials: true`

### 3. Deploy Frontend Changes
After backend is deployed and tested:
```powershell
cd TodaysDentalInsightsFrontend
npm run build
# Deploy to your hosting (S3/CloudFront)
```

## Expected Behavior

After deployment:
- ✅ OPTIONS preflight requests return 200 with proper CORS headers
- ✅ POST requests to `/admin/chime/*` endpoints work correctly
- ✅ Browser no longer blocks requests due to CORS errors
- ✅ All 7 chime endpoints are available:
  - `/admin/chime/start-session`
  - `/admin/chime/stop-session`
  - `/admin/chime/outbound-call`
  - `/admin/chime/transfer-call`
  - `/admin/chime/call-accepted`
  - `/admin/chime/call-rejected`
  - `/admin/chime/call-hungup`

## Rollback Plan

If issues occur:
1. Revert frontend changes: `git checkout HEAD -- TodaysDentalInsightsFrontend/src/call-center/constants.ts`
2. Revert backend changes: `git checkout HEAD -- todaysdentalinsightscdk/src/infrastructure/stacks/chime-stack.ts`
3. Redeploy: `cd todaysdentalinsightscdk && cdk deploy TodaysDentalInsightsChimeV5`

## Technical Details

### Centralized CORS Configuration
All CORS configuration now comes from `src/shared/utils/cors.ts`:
- `ALLOWED_ORIGINS_LIST` - Centralized list of allowed origins from clinics config
- `getCorsOptionsIntegrationParams()` - New utility for API Gateway OPTIONS mock integrations
- `buildCorsHeaders()` - Used by Lambda functions for runtime CORS headers
- `getCdkCorsConfig()` - Used for API Gateway default CORS preflight
- `getCorsErrorHeaders()` - Used for API Gateway error responses (4XX, 5XX)

This ensures consistency and makes it easy to update CORS policies in one place.

### Why `method.request.header.Origin` Works
API Gateway's mock integration can echo back request headers in responses. By using `method.request.header.Origin`, we dynamically return the requesting origin (e.g., `https://todaysdentalinsights.com`) rather than a hardcoded value. This is more flexible and works with multiple allowed origins.

### Why `proxy: true` is Important
When `proxy: true` is set on Lambda integrations:
- Lambda receives the full request (headers, body, query params)
- Lambda must return a properly formatted API Gateway response with statusCode, headers, and body
- CORS headers set by Lambda are passed through to the client
- This is essential for dynamic CORS handling based on request origin

### Benefits of Centralized Utilities
1. **Single Source of Truth**: All allowed origins come from `clinics.json`
2. **Consistency**: Same CORS config across all stacks and endpoints
3. **Maintainability**: Update CORS policy in one place instead of many
4. **Type Safety**: TypeScript ensures correct usage of CORS utilities

