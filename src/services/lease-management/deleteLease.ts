import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Delete Lease Event:', JSON.stringify(event, null, 2));

  try {
    const clinicId = event.pathParameters?.clinicId;
    const leaseId = event.pathParameters?.leaseId;

    if (!clinicId || !leaseId) {
      return createResponse(400, { success: false, error: 'clinicId and leaseId are required' });
    }

    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;

    // Check if lease exists
    const existing = await docClient.send(new GetCommand({ TableName: LEASE_TABLE_NAME, Key: { PK, SK } }));
    if (!existing.Item) {
      return createResponse(404, { success: false, error: 'Lease not found' });
    }

    const softDelete = event.queryStringParameters?.soft === 'true';

    if (softDelete) {
      await docClient.send(new UpdateCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK, SK },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #deletedAt = :deletedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#deletedAt': 'deletedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'Deleted',
          ':updatedAt': new Date().toISOString(),
          ':deletedAt': new Date().toISOString()
        }
      }));
      return createResponse(200, { success: true, message: 'Lease soft deleted successfully' });
    } else {
      await docClient.send(new DeleteCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK, SK }
      }));
      return createResponse(200, { success: true, message: 'Lease deleted successfully' });
    }

  } catch (error: any) {
    console.error('Error deleting lease:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-clinic-id',
    },
    body: JSON.stringify(body),
  };
}