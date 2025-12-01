# Custom Auth Migration Summary

## Completed ✅

### Infrastructure (CDK)
1. **CoreStack** - Exported `jwtSecret` for use by other stacks
2. **ChimeStack** - Updated to use `jwtSecret` instead of `userPool`
   - All lambda environment variables updated to use `JWT_SECRET`
   - Removed Cognito policy statements
   - Added JWT secret grant permissions to all lambdas
3. **AnalyticsStack** - Updated interface to accept `jwtSecret`
4. **CommStack** - Updated to use `jwtSecret`
   - Removed `userPoolId` and `userPoolArn` dependencies
   - Updated ws-connect lambda to use custom auth
5. **infra.ts** - Updated all stack instantiations to pass `jwtSecret` from CoreStack

### Services
1. **auth-helper.ts** - Created shared auth utility with:
   - `verifyIdToken()` - Verifies JWT access tokens
   - `getUserId()` - Extracts user ID from payload
   - `isSuperAdmin()` - Checks super admin status
   - `getClinicsFromPayload()` - Gets clinic IDs (returns empty for non-admin, ['ALL'] for admins)

2. **ws-connect.ts** - Updated to use custom JWT verification

3. **start-session.ts** - Updated imports to use auth-helper

## Remaining Work 🔧

### Chime Service Lambdas (13 files)
All need Cognito JWT verification replaced with custom auth helper:

#### Pattern to Follow:
```typescript
// OLD:
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
const USER_POOL_ID = process.env.USER_POOL_ID;
// ... Cognito JWKS setup

// NEW:
import { verifyIdToken, getUserId, isSuperAdmin } from '../../shared/utils/auth-helper';
// No USER_POOL_ID or Cognito setup needed
```

#### Files to Update:
1. ✅ `start-session.ts` - Partially done (needs authorizedClinics logic completion)
2. `stop-session.ts`
3. `call-accepted.ts`
4. `call-rejected.ts`
5. `call-hungup.ts`
6. `transfer-call.ts`
7. `outbound-call.ts`
8. `hold-call.ts`
9. `resume-call.ts`
10. `leave-call.ts`
11. `heartbeat.ts`
12. `get-recording.ts`
13. `get-call-analytics.ts`
14. `get-detailed-call-analytics.ts`

### Important Notes:

#### Clinic Authorization
With custom auth, clinic roles must be fetched from DynamoDB **StaffClinicInfo** table instead of JWT claims:

```typescript
// For non-super-admins, fetch clinic roles:
if (!isSuperAdmin(payload)) {
  // Query StaffClinicInfo table by email (partition key)
  // Extract clinicId from each row to build authorizedClinics array
}
```

#### WebSocket Default Handler (ws-default.ts)
- Needs update to fetch user emails from **StaffUser** table instead of Cognito
- Already granted DynamoDB permissions in CDK

## Testing Checklist 📋

After completing migration:
- [ ] Test OTP login flow
- [ ] Test agent session start/stop
- [ ] Test call accept/reject/transfer
- [ ] Test WebSocket connections
- [ ] Test API endpoints with JWT tokens
- [ ] Verify super admin access to all clinics
- [ ] Verify regular users only see authorized clinics

## Key Changes Summary

### Authentication Flow
**Before:** Cognito User Pool → JWKS verification → Cognito claims
**After:** Custom JWT → HS256 verification → DynamoDB lookup for roles

### Token Type
**Before:** Cognito ID tokens (`token_use: "id"`)
**After:** Custom access tokens (`type: "access"`)

### User Identification
**Before:** Cognito UUID (`sub`)
**After:** Email address (`sub` or `email`)

### Clinic Authorization
**Before:** JWT claims (`x_clinics`, `x_rbc`, `cognito:groups`)
**After:** DynamoDB StaffClinicInfo table lookup (except super admins)

