import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE ?? "";
const corsHeaders = buildCorsHeaders({ allowMethods: ["OPTIONS", "GET"] });

/**
 * Lists all active users from DynamoDB StaffUser table, primarily for selection in the "Favor Request" module.
 * This endpoint is secured by the JWT Authorizer but requires no special admin privileges.
 */
export const handler = async (event: APIGatewayProxyEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  if (!STAFF_USER_TABLE) {
    return httpErr(500, "STAFF_USER_TABLE not configured");
  }

  try {
    // Extract pagination token if present
    const nextToken = event.queryStringParameters?.nextToken;
    
    // Scan StaffUser table for active users
    const result = await ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      FilterExpression: "isActive = :active",
      ExpressionAttributeValues: {
        ":active": true,
      },
      ProjectionExpression: "email, givenName, familyName",
      Limit: 100,
      ...(nextToken && { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, 'base64').toString()) }),
    }));

    const directory = (result.Items || [])
      .map((user: any) => ({
        userID: user.email, // Use email as the unique identifier
        email: user.email || '',
        givenName: user.givenName || '',
        familyName: user.familyName || '',
      }))
      // Filter out users who might not have an email
      .filter(u => u.email);

    // Encode LastEvaluatedKey as base64 for pagination
    const responseNextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return httpOk({ 
      items: directory,
      nextToken: responseNextToken,
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
