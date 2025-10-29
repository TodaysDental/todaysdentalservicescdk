import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    const claims = (event.requestContext as any)?.authorizer?.claims || {};
    const sub = claims.sub || claims['sub'] || '';

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
