import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { verifyIdToken, getUserId } from '../../shared/utils/auth-helper';

const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Use JWT-based authentication
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    
    if (!verifyResult.ok) {
      return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ error: verifyResult.message }) };
    }

    const sub = getUserId(verifyResult.payload!);

    if (!sub) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized: missing sub claim' }) };
    }

    const tableName = process.env.AGENT_PRESENCE_TABLE_NAME;
    if (!tableName) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration: AGENT_PRESENCE_TABLE_NAME not set' }) };
    }

    const getCmd = new GetCommand({
      TableName: tableName,
      Key: { agentId: sub },
    });

    const result = await docClient.send(getCmd as any);
    const item = (result as any)?.Item || null;

    if (!item) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Presence record not found' }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ presence: item }),
    };
  } catch (err: any) {
    console.error('Error fetching presence:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err?.message || 'Internal Server Error' }) };
  }
};
