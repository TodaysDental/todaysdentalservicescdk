## Cognito Trigger Lambdas for Passwordless Email OTP Login (Node.js 22)

This folder provides a single Lambda handler (Node.js 22) that implements passwordless login with email OTP using Cognito Custom Authentication. It supports these triggers:

- PreAuthentication
- PostAuthentication
- PreTokenGeneration (Authentication)
- DefineAuthChallenge / CreateAuthChallenge / VerifyAuthChallengeResponse (OTP-based custom auth)
- CustomMessage (optional)

### Files

- `index.js`: Multi-trigger handler.
- `package.json`: Node 22 Lambda package with AWS SDK v3 dependency (Cognito + SESv2).

### Setup

1. Zip and deploy to Lambda or use your CI/CD. Ensure runtime is Node.js 22.x.
2. Configure the same Lambda for the Cognito User Pool triggers: `DefineAuthChallenge`, `CreateAuthChallenge`, `VerifyAuthChallengeResponse`. Optionally attach `PreAuthentication`, `PreTokenGeneration`, `CustomMessage`.
3. Set environment variables:
   - `ALLOWED_EMAIL_DOMAINS`: Comma-separated list of allowed email domains (e.g., `example.com,example.org`).
   - `FROM_EMAIL` (required for email OTP): Verified SES email address to send codes from.
   - `SES_REGION` (optional): SES region if different from Lambda region.
   - `APP_NAME` (optional): Used in email subject/body.
   - `OTP_LENGTH` (optional): Default `6`.
   - `CODE_TTL_SECONDS` (optional): Default `300` seconds.
   - `MAX_CHALLENGE_ATTEMPTS` (optional): Default `3` attempts per auth flow.

### IAM

Grant the Lambda permission to send email with SES and (optionally) update user attributes:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:ListGroupsForUser"
      ],
      "Resource": [
        "arn:aws:cognito-idp:<region>:<account-id>:userpool/<user-pool-id>",
        "*"  
      ]
    }
  ]
}
```

### Notes

- The Custom Auth challenge handlers generate, email, and verify a one-time code. No passwords.
- PreAuthentication can still be used for extra checks (email domain allowlist, etc.).
- PreTokenGeneration injects custom claims into the ID token.

### Client flow (frontend)

Use AWS SDK v3 Cognito Identity Provider. Example pseudocode:

```javascript
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: "<REGION>" });
const clientId = "<USER_POOL_CLIENT_ID>"; // Enable CUSTOM_AUTH on this client

// 1) User submits email
await client.send(new InitiateAuthCommand({
  AuthFlow: "CUSTOM_AUTH",
  ClientId: clientId,
  AuthParameters: { USERNAME: email },
}));
// Lambda sends OTP email

// 2) User enters OTP
const resp = await client.send(new RespondToAuthChallengeCommand({
  ClientId: clientId,
  ChallengeName: "CUSTOM_CHALLENGE",
  ChallengeResponses: { USERNAME: email, ANSWER: otp },
}));

// If success, resp contains tokens in AuthenticationResult
```


