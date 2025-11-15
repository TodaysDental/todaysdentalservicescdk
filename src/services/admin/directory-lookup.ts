import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors";

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID ?? "";
const corsHeaders = buildCorsHeaders({ allowMethods: ["OPTIONS", "GET"] });

/**
 * Lists all users from Cognito, primarily for selection in the "Favor Request" module.
 * This endpoint is secured by the Cognito Authorizer but requires no special admin privileges.
 */
export const handler = async (event: APIGatewayProxyEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  if (!USER_POOL_ID) {
    return httpErr(500, "USER_POOL_ID not configured");
  }

  try {
    // 1. Implement client-specified limit with max/min constraints
    // Max 50 users (the user-friendly limit, which is less than the Cognito max of 60)
    const limit = Math.max(1, Math.min(50, Number(event.queryStringParameters?.limit || 25)));
    
    // 2. Extract pagination token if present
    const paginationToken = event.queryStringParameters?.nextToken;

    // 3. Prepare command inputs
    const commandInput = {
        UserPoolId: USER_POOL_ID,
        Limit: limit,
        // Pass the token if it exists to fetch the next page
        ...(paginationToken && { PaginationToken: paginationToken }) 
    };

    const listResp = await cognito.send(new ListUsersCommand(commandInput));

    const directory = (listResp.Users || [])
        .map((u: UserType) => {
            const attrs: Record<string, string> = Object.fromEntries((u.Attributes || []).map((a: any) => [a.Name, a.Value]));
            return {
                userID: String(u.Username),
                email: attrs['email'] || '',
                givenName: attrs['given_name'] || '',
                familyName: attrs['family_name'] || '',
            };
        })
        // Filter out users who might not have an email or are incomplete
        .filter(u => u.email);

    return httpOk({ 
        items: directory,
        // Return the token for the client to request the next page, or undefined if done
        nextToken: listResp.PaginationToken || undefined 
    });
  } catch (err: any) {
    console.error("Error listing users:", err);
    return httpErr(500, err?.message || "internal error");
  }
};

function httpOk(data: Record<string, any>) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ success: false, message }) };
}