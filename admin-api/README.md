## Admin API: Register Users with Clinic Roles and Global Super Admin

This Lambda registers users in Cognito and assigns them to clinic-role groups using the scheme `clinic_<clinicId>__<ROLE>`.

### Roles

- SUPER_ADMIN, ADMIN, PROVIDER, MARKETING, USER

### Environment

- `USER_POOL_ID` (required)
- `CORS_ORIGIN` (optional, for API Gateway)
- `COGNITO_REGION` (recommended, else falls back to `AWS_REGION`)

### Request

POST body example (clinic assignments):

```json
{
  "email": "jane@example.com",
  "givenName": "Jane",
  "familyName": "Doe",
  "clinics": [
    { "clinicId": "1", "role": "ADMIN" },
    { "clinicId": "3", "role": "PROVIDER" }
  ]
}
POST body example (create global super admin):

```json
{
  "email": "root@example.com",
  "givenName": "Root",
  "familyName": "User",
  "makeGlobalSuperAdmin": true
}
```

```

### Response

```json
{
  "success": true,
  "username": "jane@example.com",
  "groupsAssigned": [
    "clinic_1__ADMIN",
    "clinic_3__PROVIDER"
  ]
}
```

### Notes

- With the passwordless flow, users authenticate via email OTP. Ensure your User Pool Client supports `CUSTOM_AUTH` and the triggers in `cognito-triggers/` are attached.
- The `PreTokenGeneration` trigger adds compact claims. For global super admin, tokens include `x_is_super_admin=true` and `x_clinics=ALL`. Otherwise, tokens include `x_clinics` and `x_rbc`.
- Only logged-in global super admins can create another global super admin. Clinic admins/super admins can only assign roles within clinics they administer.


