import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { buildCorsHeaders } from "../utils/cors";

type StartBody = { email?: string };

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || "";
const idp = new CognitoIdentityProviderClient({ region: REGION });

export const handler = async (event: any) => {
  try {
    const body = parseBody(event.body) as StartBody;
    if (!body.email) {
      return httpErr(400, "email is required");
    }
    if (!USER_POOL_CLIENT_ID) {
      return httpErr(500, "USER_POOL_CLIENT_ID not configured");
    }

    const resp = await idp.send(new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: { USERNAME: body.email },
    }));

    return httpOk({
      delivery: "email",
      session: resp.Session,
      challengeName: resp.ChallengeName,
      challengeParameters: resp.ChallengeParameters,
    });
  } catch (err: any) {
    return httpErr(500, err?.message || "failed to start auth");
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


