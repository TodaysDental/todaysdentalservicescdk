import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { buildCorsHeaders } from "../../shared/utils/cors";
import {
  getUserPermissions,
  hasModulePermission,
  getAllowedClinicIds,
  hasClinicAccess,
  PermissionType,
} from "../../shared/utils/permissions-helper";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "";
const PARTITION_KEY = process.env.PARTITION_KEY || "clinicId";
const SORT_KEY = process.env.SORT_KEY || "label"; // <-- CHANGED default to label

// Helper for uniform responses
const createResponse = (statusCode: number, body: any, requestOrigin?: string): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    ...buildCorsHeaders({}, requestOrigin),
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const MODULE_NAME = 'Operations';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

const validateItem = (item: any): string[] => {
    // 'label' is now effectively checked twice (as SK and here), which is fine.
    const requiredFields = ['label', 'value', 'duration', 'opNum'];
    const missingFields = requiredFields.filter(field => item[field] === undefined || item[field] === null || item[field] === '');
    return missingFields;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("Request:", event.httpMethod, event.path, event.queryStringParameters);

  const method = event.httpMethod;
  const pathParameters = event.pathParameters;
  const queryParameters = event.queryStringParameters;
  const requestOrigin = event.headers?.origin;

  // Handle OPTIONS request for CORS preflight
  if (method === 'OPTIONS') {
    return createResponse(204, '', requestOrigin);
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return createResponse(401, { error: 'Unauthorized - Invalid token' }, requestOrigin);
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

  try {
    switch (method) {
      case "GET": {
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
          return createResponse(400, { message: `Missing required query parameter: ${PARTITION_KEY}` }, requestOrigin);
        }
        const clinicId = queryParameters[PARTITION_KEY];

        if (!hasClinicAccess(allowedClinics, clinicId)) {
          return createResponse(403, { error: 'Forbidden: no access to this clinic' }, requestOrigin);
        }

        // Check if user has read permission for Operations module
        const canRead = hasModulePermission(
          userPerms.clinicRoles,
          MODULE_NAME,
          requiredPermission,
          userPerms.isSuperAdmin,
          userPerms.isGlobalSuperAdmin,
          clinicId
        );

        if (!canRead) {
          return createResponse(403, {
            error: `You do not have permission to read appointment types for this clinic`,
          }, requestOrigin);
        }

        if (pathParameters && pathParameters.id) {
          // CASE 1: GET by ID (Label) -> /New%20Patient?clinicId=123
          // IMPORTANT: Decode the label from the URL
          const labelId = decodeURIComponent(pathParameters.id);

          const data = await dynamo.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { 
                  [PARTITION_KEY]: clinicId, 
                  [SORT_KEY]: labelId // <-- String, not Number
              },
            })
          );
          return data.Item
            ? createResponse(200, data.Item, requestOrigin)
            : createResponse(404, { message: "Appointment type not found" }, requestOrigin);
        } else {
          // CASE 2: List ALL
          // We don't need manual filtering by label anymore because if they want a specific label, they should use GET /{id}
          const data = await dynamo.send(new QueryCommand({
              TableName: TABLE_NAME,
              KeyConditionExpression: "#pk = :pk",
              ExpressionAttributeNames: { "#pk": PARTITION_KEY },
              ExpressionAttributeValues: { ":pk": clinicId }
          }));

          return createResponse(200, { appointmentTypes: data.Items || [] }, requestOrigin);
        }
      }

      case "POST": {
        if (!event.body) return createResponse(400, { message: "Missing request body" }, requestOrigin);
        const item = JSON.parse(event.body);

        if (!item[PARTITION_KEY] || !item[SORT_KEY]) {
          return createResponse(400, { message: `Missing required Primary Keys: ${PARTITION_KEY} and ${SORT_KEY}` }, requestOrigin);
        }
        if (!hasClinicAccess(allowedClinics, item[PARTITION_KEY])) {
          return createResponse(403, { error: 'Forbidden: no access to this clinic' }, requestOrigin);
        }

        // Check if user has write permission for Operations module
        const canCreate = hasModulePermission(
          userPerms.clinicRoles,
          MODULE_NAME,
          requiredPermission,
          userPerms.isSuperAdmin,
          userPerms.isGlobalSuperAdmin,
          item[PARTITION_KEY]
        );

        if (!canCreate) {
          return createResponse(403, {
            error: `You do not have permission to create appointment types for this clinic`,
          }, requestOrigin);
        }
        
        const missingFields = validateItem(item);
        if (missingFields.length > 0) {
          return createResponse(400, { message: `Missing required schema fields: ${missingFields.join(', ')}` }, requestOrigin);
        }

        // Ensure correct types
        item[PARTITION_KEY] = String(item[PARTITION_KEY]);
        item[SORT_KEY] = String(item[SORT_KEY]);      // Label is string
        item['duration'] = Number(item['duration']);
        item['opNum'] = Number(item['opNum']);
        // We still might want AppointmentTypeNum as a regular field, ensure it's a number if present
        if (item['AppointmentTypeNum']) item['AppointmentTypeNum'] = Number(item['AppointmentTypeNum']);


        try {
            await dynamo.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: item,
                // Ensure uniqueness based on clinicId + label
                ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
                ExpressionAttributeNames: { 
                  "#pk": PARTITION_KEY,
                  "#sk": SORT_KEY
                }
            }));
            return createResponse(201, { message: "Item created", item }, requestOrigin);
        } catch (e: any) {
            if (e.name === 'ConditionalCheckFailedException') {
                return createResponse(409, { message: `Appointment type with this label already exists for this clinic.` }, requestOrigin);
            }
            throw e;
        }
      }

      case "PUT": {
        // PUT /New%20Patient?clinicId=123
        if (!event.body) return createResponse(400, { message: "Missing request body" }, requestOrigin);
        if (!pathParameters || !pathParameters.id) {
          return createResponse(400, { message: "Missing ID (label) in path for PUT" }, requestOrigin);
        }
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
          return createResponse(400, { message: `Missing required query parameter for PUT: ${PARTITION_KEY}` }, requestOrigin);
        }

        const putClinicId = queryParameters[PARTITION_KEY];
        if (!hasClinicAccess(allowedClinics, putClinicId)) {
          return createResponse(403, { error: 'Forbidden: no access to this clinic' }, requestOrigin);
        }

        // Check if user has put permission for Operations module
        const canUpdate = hasModulePermission(
          userPerms.clinicRoles,
          MODULE_NAME,
          requiredPermission,
          userPerms.isSuperAdmin,
          userPerms.isGlobalSuperAdmin,
          putClinicId
        );

        if (!canUpdate) {
          return createResponse(403, {
            error: `You do not have permission to update appointment types for this clinic`,
          }, requestOrigin);
        }

        const labelId = decodeURIComponent(pathParameters.id);
        const bodyItem = JSON.parse(event.body);
        
        // Force the keys from URL to overwrite body to ensure consistency
        const item = {
          ...bodyItem,
          [PARTITION_KEY]: queryParameters[PARTITION_KEY],
          [SORT_KEY]: labelId
        };

        const missingFields = validateItem(item);
        if (missingFields.length > 0) {
          return createResponse(400, { message: `Missing required schema fields: ${missingFields.join(', ')}` }, requestOrigin);
        }

        item[PARTITION_KEY] = String(item[PARTITION_KEY]);
        item[SORT_KEY] = String(item[SORT_KEY]);
        item['duration'] = Number(item['duration']);
        item['opNum'] = Number(item['opNum']);
        if (item['AppointmentTypeNum']) item['AppointmentTypeNum'] = Number(item['AppointmentTypeNum']);

        await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return createResponse(200, { message: "Item updated", item }, requestOrigin);
      }

      case "DELETE": {
        // DELETE /New%20Patient?clinicId=123
        if (!pathParameters || !pathParameters.id) {
          return createResponse(400, { message: "Missing ID (label) in path for DELETE" }, requestOrigin);
        }
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
          return createResponse(400, { message: `Missing required query parameter for DELETE: ${PARTITION_KEY}` }, requestOrigin);
        }

        const deleteClinicId = queryParameters[PARTITION_KEY];
        if (!hasClinicAccess(allowedClinics, deleteClinicId)) {
          return createResponse(403, { error: 'Forbidden: no access to this clinic' }, requestOrigin);
        }

        // Check if user has delete permission for Operations module
        const canDelete = hasModulePermission(
          userPerms.clinicRoles,
          MODULE_NAME,
          requiredPermission,
          userPerms.isSuperAdmin,
          userPerms.isGlobalSuperAdmin,
          deleteClinicId
        );

        if (!canDelete) {
          return createResponse(403, {
            error: `You do not have permission to delete appointment types for this clinic`,
          }, requestOrigin);
        }

        const labelToDelete = decodeURIComponent(pathParameters.id);

        await dynamo.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                [PARTITION_KEY]: queryParameters[PARTITION_KEY],
                [SORT_KEY]: labelToDelete // String
            },
          })
        );
        return createResponse(200, { message: `Item '${labelToDelete}' deleted` }, requestOrigin);
      }

      default:
        return createResponse(405, { message: `Unsupported method "${method}"` }, requestOrigin);
    }
  } catch (error: any) {
    console.error("Error", error);
    return createResponse(500, { message: "Internal Server Error", error: error.message }, requestOrigin);
  }
};
