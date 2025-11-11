import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand, // --- NEW: Import GetCommand
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.APPTTYPES_TABLE_NAME || "";
const PARTITION_KEY = "clinicId";
const SORT_KEY = "label"; // --- NEW: Define the Sort Key

// Helper for uniform public responses
const createResponse = (statusCode: number, body: any, requestOrigin?: string): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
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
    // --- NEW: Check for the 'label' parameter ---
    const label = event.pathParameters.label; 

    if (!TABLE_NAME) {
      throw new Error("TABLE_NAME environment variable is not set.");
    }

    // --- NEW: LOGIC TO HANDLE BOTH ROUTES ---
    if (label) {
      // --- CASE 1: GET ONE BY LABEL ---
      // The label from the URL will be URL-encoded (e.g., "New%20Patient")
      // We must decode it to match the DynamoDB key.
      const decodedLabel = decodeURIComponent(label);

      console.log(`Fetching single item for clinicId: ${clinicId}, label: ${decodedLabel}`);
      
      const data = await dynamo.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { 
              [PARTITION_KEY]: clinicId,
              [SORT_KEY]: decodedLabel // Use the decoded label as the Sort Key
          },
      }));

      if (!data.Item) {
        return createResponse(404, { message: "Appointment type not found" }, requestOrigin);
      }
      // Return the single item directly
      return createResponse(200, data.Item, requestOrigin);

    } else {
      // --- CASE 2: GET ALL FOR CLINIC (Existing Logic) ---
      console.log(`Fetching all items for clinicId: ${clinicId}`);

      const data = await dynamo.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": PARTITION_KEY },
          ExpressionAttributeValues: { ":pk": clinicId }
      }));

      // Return the array wrapped in an object
      return createResponse(200, { appointmentTypes: data.Items || [] }, requestOrigin);
    }

  } catch (error: any) {
    console.error("Error", error);
    return createResponse(500, { message: "Internal Server Error", error: error.message }, requestOrigin);
  }
};