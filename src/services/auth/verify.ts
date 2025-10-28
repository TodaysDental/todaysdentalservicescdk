
import { CognitoIdentityProviderClient, RespondToAuthChallengeCommand } from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

type VerifyBody = { email?: string; otp?: string; session?: string };

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || "";
const SAML_LOGS_TABLE = process.env.SAML_LOGS_TABLE || "";

const idp = new CognitoIdentityProviderClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));


export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = parseBody(event.body) as VerifyBody;
    if (!body.email) return httpErr(400, "email is required", event);
    if (!body.otp) return httpErr(400, "otp is required", event);
    if (!USER_POOL_CLIENT_ID) return httpErr(500, "USER_POOL_CLIENT_ID not configured", event);
    if (!body.session) return httpErr(400, "session is required", event);

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
      }, event);
    }


    return httpOk({
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn,
      tokenType: result.TokenType,
    }, event);
  } catch (err: any) {
    return httpErr(401, err?.message || "invalid code", event);
  }
};

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function httpOk(data: Record<string, any>, event: APIGatewayProxyEvent) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin), body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string, event: APIGatewayProxyEvent) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin), body: JSON.stringify({ success: false, message }) };
}


