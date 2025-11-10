import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand, // Replaced Scan with Query for efficiency
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "";
const PARTITION_KEY = process.env.PARTITION_KEY || "clinicId";
const SORT_KEY = process.env.SORT_KEY || "AppointmentTypeNum";

// Helper for uniform responses
const createResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key,X-Amz-Security-Token"
    },
    body: JSON.stringify(body),
  };
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("Request:", event.httpMethod, event.path, event.queryStringParameters, event.body);
  const method = event.httpMethod;
  const pathParameters = event.pathParameters;
  const queryParameters = event.queryStringParameters;

  try {
    switch (method) {
      case "GET":
        // Require clinicId for ALL get operations for security/partitioning
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
           return createResponse(400, { message: `Missing required query parameter: ${PARTITION_KEY}` });
        }
        const clinicId = queryParameters[PARTITION_KEY];

        if (pathParameters && pathParameters.id) {
          // GET /appttypes/{id}?clinicId=... -> Get single item by PK + SK
          const data = await dynamo.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: {
                  [PARTITION_KEY]: clinicId,
                  [SORT_KEY]: Number(pathParameters.id)
              },
            })
          );
          return data.Item
            ? createResponse(200, data.Item)
            : createResponse(404, { message: "Appointment type not found" });
        } else {
          // GET /appttypes?clinicId=... -> Query all items for this clinic
          const data = await dynamo.send(new QueryCommand({
              TableName: TABLE_NAME,
              KeyConditionExpression: "#pk = :pk",
              ExpressionAttributeNames: {
                  "#pk": PARTITION_KEY
              },
              ExpressionAttributeValues: {
                  ":pk": clinicId
              }
          }));
          return createResponse(200, { appointmentTypes: data.Items || [] });
        }

      case "POST":
      case "PUT":
        // POST/PUT /appttypes - Body must contain both clinicId and AppointmentTypeNum
        if (!event.body) return createResponse(400, { message: "Missing request body" });
        const item = JSON.parse(event.body);

        // Validate Keys exist
        if (!item[PARTITION_KEY] || item[SORT_KEY] === undefined) {
             return createResponse(400, { message: `Missing required fields: ${PARTITION_KEY} and ${SORT_KEY}` });
        }

        // Enforce types
        item[PARTITION_KEY] = String(item[PARTITION_KEY]);
        item[SORT_KEY] = Number(item[SORT_KEY]);

        await dynamo.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
          })
        );
        return createResponse(200, { message: "Operation successful", item });

      case "DELETE":
        // DELETE /appttypes/{id}?clinicId=...
        if (!pathParameters || !pathParameters.id) {
          return createResponse(400, { message: "Missing ID in path for DELETE" });
        }
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
           return createResponse(400, { message: `Missing required query parameter for DELETE: ${PARTITION_KEY}` });
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
        return createResponse(200, { message: `Item deleted` });

      case "OPTIONS":
        return createResponse(200, {});

      default:
        return createResponse(405, { message: `Unsupported method "${method}"` });
    }
  } catch (error: any) {
    console.error("Error", error);
    return createResponse(500, { message: "Internal Server Error", error: error.message });
  }
};