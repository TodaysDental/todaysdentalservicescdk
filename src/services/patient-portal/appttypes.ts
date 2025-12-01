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
import { SYSTEM_MODULES } from "../../shared/types/user";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "";
const PARTITION_KEY = process.env.PARTITION_KEY || "clinicId";
const SORT_KEY = process.env.SORT_KEY || "label"; // <-- CHANGED default to label

// Helper for uniform responses
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

/**
 * Get user's clinic roles and permissions from custom authorizer
 */
const getUserPermissions = (event: APIGatewayProxyEvent) => {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = JSON.parse(authorizer.clinicRoles || '[]');
    const isSuperAdmin = authorizer.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === 'true';
    const email = authorizer.email || '';

    return {
      email,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin,
    };
  } catch (err) {
    console.error('Failed to parse user permissions:', err);
    return null;
  }
};

/**
 * Check if user has admin role (Admin, SuperAdmin, or Global Super Admin)
 */
const isAdminUser = (
  clinicRoles: any[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean => {
  // Check flags first
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }

  // Check if user has Admin or SuperAdmin role at any clinic
  for (const cr of clinicRoles) {
    if (cr.role === 'Admin' || cr.role === 'SuperAdmin' || cr.role === 'Global super admin') {
      return true;
    }
  }

  return false;
};

/**
 * Check if user has specific permission for Operations module at ANY clinic
 */
const hasModulePermission = (
  clinicRoles: any[],
  permission: 'read' | 'write' | 'put' | 'delete',
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): boolean => {
  // Admin, SuperAdmin, and Global Super Admin have all permissions for all modules
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for Operations module at any clinic (or specific clinic)
  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    const moduleAccess = cr.moduleAccess?.find((ma: any) => ma.module === 'Operations');
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
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
    return createResponse(200, { message: 'CORS preflight response' }, requestOrigin);
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return createResponse(401, { error: 'Unauthorized - Invalid token' }, requestOrigin);
  }

  try {
    switch (method) {
      case "GET": {
        if (!queryParameters || !queryParameters[PARTITION_KEY]) {
          return createResponse(400, { message: `Missing required query parameter: ${PARTITION_KEY}` }, requestOrigin);
        }
        const clinicId = queryParameters[PARTITION_KEY];

        // Check if user has read permission for Operations module
        const canRead = hasModulePermission(
          userPerms.clinicRoles,
          'read',
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

        // Check if user has write permission for Operations module
        const canCreate = hasModulePermission(
          userPerms.clinicRoles,
          'write',
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

        // Check if user has put permission for Operations module
        const canUpdate = hasModulePermission(
          userPerms.clinicRoles,
          'put',
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

        // Check if user has delete permission for Operations module
        const canDelete = hasModulePermission(
          userPerms.clinicRoles,
          'delete',
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