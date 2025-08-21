import { CognitoIdentityProviderClient, RespondToAuthChallengeCommand } from "@aws-sdk/client-cognito-identity-provider";
import { buildCorsHeaders } from "../utils/cors";

type VerifyBody = { email?: string; otp?: string; session?: string };

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || "";
const idp = new CognitoIdentityProviderClient({ region: REGION });

export const handler = async (event: any) => {
  try {
    const body = parseBody(event.body) as VerifyBody;
    if (!body.email) return httpErr(400, "email is required");
    if (!body.otp) return httpErr(400, "otp is required");
    if (!USER_POOL_CLIENT_ID) return httpErr(500, "USER_POOL_CLIENT_ID not configured");
    if (!body.session) return httpErr(400, "session is required");

    const resp = await idp.send(new RespondToAuthChallengeCommand({
      ClientId: USER_POOL_CLIENT_ID,
      ChallengeName: "CUSTOM_CHALLENGE",
      ChallengeResponses: { USERNAME: body.email, ANSWER: body.otp },
      Session: body.session,
    }));

    const result = resp.AuthenticationResult || {};
    if (!result.IdToken) {
      // Challenge not completed yet or tokens not issued; return challenge context for debugging
      return httpOk({
        challengeName: resp.ChallengeName,
        challengeParameters: resp.ChallengeParameters,
        message: 'Tokens not issued yet. Ensure correct OTP and unexpired session.'
      });
    }
    return httpOk({
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn,
      tokenType: result.TokenType,
    });
  } catch (err: any) {
    return httpErr(401, err?.message || "invalid code");
  }
};

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function httpOk(data: Record<string, any>) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: false, message }) };
}


