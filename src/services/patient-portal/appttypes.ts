import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "";
const PRIMARY_KEY = process.env.PRIMARY_KEY || "AppointmentTypeNum";

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
  console.log("Request:", event.httpMethod, event.path, event.body);
  const method = event.httpMethod;
  const pathParameters = event.pathParameters;

  try {
    switch (method) {
      case "GET":
        if (pathParameters && pathParameters.id) {
          // GET /patient-portal-appttypes/{id}
          const data = await dynamo.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { [PRIMARY_KEY]: Number(pathParameters.id) },
            })
          );
          return data.Item
            ? createResponse(200, data.Item)
            : createResponse(404, { message: "Appointment type not found" });
        } else {
          // GET /patient-portal-appttypes
          const data = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
          return createResponse(200, { appointmentTypes: data.Items || [] });
        }

      case "POST":
      case "PUT":
        // POST /patient-portal-appttypes
        if (!event.body) return createResponse(400, { message: "Missing request body" });
        const item = JSON.parse(event.body);

        // Validate Primary Key exists
        if (item[PRIMARY_KEY] === undefined || item[PRIMARY_KEY] === null) {
             return createResponse(400, { message: `Missing required field: ${PRIMARY_KEY}` });
        }

        // Enforce Primary Key as Number to match DynamoDB schema
        item[PRIMARY_KEY] = Number(item[PRIMARY_KEY]);

        // DynamoDB will automatically store all other fields (value, label, duration, opNum)
        await dynamo.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
          })
        );
        return createResponse(200, { message: "Operation successful", item });

      case "DELETE":
        // DELETE /patient-portal-appttypes/{id}
        if (!pathParameters || !pathParameters.id) {
          return createResponse(400, { message: "Missing ID in path for DELETE" });
        }
        await dynamo.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { [PRIMARY_KEY]: Number(pathParameters.id) },
          })
        );
        return createResponse(200, { message: `Item ${pathParameters.id} deleted` });

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
