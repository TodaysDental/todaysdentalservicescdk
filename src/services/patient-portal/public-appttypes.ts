import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors"; // Assuming this is in your shared utils

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

// The table name is passed from the CDK environment variables
const TABLE_NAME = process.env.APPTTYPES_TABLE_NAME || "";
// The partition key for the ApptTypes table is 'clinicId'
const PARTITION_KEY = "clinicId";

// Helper for uniform public responses
const createResponse = (statusCode: number, body: any, requestOrigin?: string): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      // Use the same CORS utility to ensure public access is correct
      ...buildCorsHeaders({}, requestOrigin), 
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("Request:", event.httpMethod, event.path, event.pathParameters);
  
  const requestOrigin = event.headers?.origin;

  try {
    if (event.httpMethod !== "GET") {
      return createResponse(405, { message: "Method Not Allowed" }, requestOrigin);
    }

    if (!event.pathParameters || !event.pathParameters.clinicId) {
      return createResponse(400, { message: "Missing required path parameter: clinicId" }, requestOrigin);
    }

    const clinicId = event.pathParameters.clinicId;

    if (!TABLE_NAME) {
      throw new Error("TABLE_NAME environment variable is not set.");
    }

    // Query all appointment types for the given clinicId
    const data = await dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": PARTITION_KEY },
        ExpressionAttributeValues: { ":pk": clinicId }
    }));

    return createResponse(200, { appointmentTypes: data.Items || [] }, requestOrigin);

  } catch (error: any) {
    console.error("Error", error);
    return createResponse(500, { message: "Internal Server Error", error: error.message }, requestOrigin);
  }
};