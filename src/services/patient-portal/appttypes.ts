import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
// Assuming this is the correct path to your new CORS utility file
import { buildCorsHeaders } from "../../shared/utils/cors";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "";
const PARTITION_KEY = process.env.PARTITION_KEY || "clinicId";
const SORT_KEY = process.env.SORT_KEY || "AppointmentTypeNum";

// Helper for uniform responses
const createResponse = (statusCode: number, body: any, requestOrigin?: string): APIGatewayProxyResult => {
  return {
    statusCode,
    // Use the buildCorsHeaders function to create dynamic headers
    headers: {
      ...buildCorsHeaders({}, requestOrigin),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("Request:", event.httpMethod, event.path, event.queryStringParameters);
  
  const method = event.httpMethod;
  const pathParameters = event.pathParameters;
  const queryParameters = event.queryStringParameters;
  const requestOrigin = event.headers?.origin; // Get the origin from the request

  try {
    switch (method) {
      case "GET":
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
            return createResponse(400, { message: `Missing required query parameter: ${PARTITION_KEY}` }, requestOrigin);
        }
        const clinicId = queryParameters[PARTITION_KEY];

        if (pathParameters && pathParameters.id) {
          // GET /{id}?clinicId=XXX
          const data = await dynamo.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { [PARTITION_KEY]: clinicId, [SORT_KEY]: Number(pathParameters.id) },
            })
          );
          return data.Item
            ? createResponse(200, data.Item, requestOrigin)
            : createResponse(404, { message: "Appointment type not found" }, requestOrigin);
        } else {
          // GET /?clinicId=XXX
          const data = await dynamo.send(new QueryCommand({
              TableName: TABLE_NAME,
              KeyConditionExpression: "#pk = :pk",
              ExpressionAttributeNames: { "#pk": PARTITION_KEY },
              ExpressionAttributeValues: { ":pk": clinicId }
          }));
          return createResponse(200, { appointmentTypes: data.Items || [] }, requestOrigin);
        }

      case "POST":
      case "PUT":
        if (!event.body) return createResponse(400, { message: "Missing request body" }, requestOrigin);
        const item = JSON.parse(event.body);

        if (!item[PARTITION_KEY] || item[SORT_KEY] === undefined) {
             return createResponse(400, { message: `Missing required Primary Keys: ${PARTITION_KEY} and ${SORT_KEY}` }, requestOrigin);
        }

        const requiredFields = ['AptName', 'AptNum', 'ProviderName', 'ProviderNum', 'OpNum', 'OpName'];
        const missingFields = requiredFields.filter(field => item[field] === undefined || item[field] === null || item[field] === '');

        if (missingFields.length > 0) {
            return createResponse(400, { message: `Missing required schema fields: ${missingFields.join(', ')}` }, requestOrigin);
        }

        item[PARTITION_KEY] = String(item[PARTITION_KEY]);
        item[SORT_KEY] = Number(item[SORT_KEY]);
        item['AptNum'] = Number(item['AptNum']);
        item['ProviderNum'] = Number(item['ProviderNum']);
        item['OpNum'] = Number(item['OpNum']);

        await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return createResponse(200, { message: "Operation successful", item }, requestOrigin);

      case "DELETE":
        if (!pathParameters || !pathParameters.id) {
          return createResponse(400, { message: "Missing ID in path for DELETE" }, requestOrigin);
        }
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
            return createResponse(400, { message: `Missing required query parameter for DELETE: ${PARTITION_KEY}` }, requestOrigin);
        }

        await dynamo.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                [PARTITION_KEY]: queryParameters[PARTITION_KEY],
                [SORT_KEY]: Number(pathParameters.id)
            },
          })
        );
        return createResponse(200, { message: `Item ${pathParameters.id} deleted` }, requestOrigin);

      case "OPTIONS":
        // Handle preflight OPTIONS request
        return createResponse(200, {}, requestOrigin);

      default:
        return createResponse(405, { message: `Unsupported method "${method}"` }, requestOrigin);
    }
  } catch (error: any) {
    console.error("Error", error);
    return createResponse(500, { message: "Internal Server Error", error: error.message }, requestOrigin);
  }
};