/**
 * RCS Get Messages Handler
 * 
 * Retrieves RCS message history for a clinic with pagination and filtering.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Get Messages Event:', JSON.stringify(event, null, 2));

  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const clinicId = event.pathParameters?.clinicId;
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing clinicId' }),
      };
    }

    // Query parameters
    const queryParams = event.queryStringParameters || {};
    const direction = queryParams.direction; // 'inbound', 'outbound', or undefined for all
    const limit = Math.min(parseInt(queryParams.limit || '50'), 100);
    const startKey = queryParams.startKey ? JSON.parse(decodeURIComponent(queryParams.startKey)) : undefined;
    const phoneNumber = queryParams.phone;
    const fromDate = queryParams.fromDate ? parseInt(queryParams.fromDate) : undefined;
    const toDate = queryParams.toDate ? parseInt(queryParams.toDate) : undefined;

    // Build query
    let keyConditionExpression = 'pk = :pk';
    const expressionAttributeValues: Record<string, any> = {
      ':pk': `CLINIC#${clinicId}`,
    };

    // Filter by message type prefix if direction specified
    if (direction === 'inbound') {
      keyConditionExpression += ' AND begins_with(sk, :skPrefix)';
      expressionAttributeValues[':skPrefix'] = 'MSG#';
    } else if (direction === 'outbound') {
      keyConditionExpression += ' AND begins_with(sk, :skPrefix)';
      expressionAttributeValues[':skPrefix'] = 'OUTBOUND#';
    }

    // Build filter expression (only for non-key attributes)
    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};

    if (phoneNumber) {
      // Search in both 'from' and 'to' fields
      filterExpressions.push('(#from = :phone OR #to = :phone)');
      expressionAttributeNames['#from'] = 'from';
      expressionAttributeNames['#to'] = 'to';
      expressionAttributeValues[':phone'] = phoneNumber;
    }

    if (fromDate) {
      filterExpressions.push('#timestamp >= :fromDate');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':fromDate'] = fromDate;
    }

    if (toDate) {
      filterExpressions.push('#timestamp <= :toDate');
      if (!expressionAttributeNames['#timestamp']) {
        expressionAttributeNames['#timestamp'] = 'timestamp';
      }
      expressionAttributeValues[':toDate'] = toDate;
    }

    // Filter by direction attribute to exclude STATUS records (can't filter on sk in FilterExpression)
    // STATUS records don't have a 'direction' attribute, so we check for its existence
    filterExpressions.push('attribute_exists(direction)');

    const queryCommand: any = {
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ScanIndexForward: false, // Most recent first
    };

    if (Object.keys(expressionAttributeNames).length > 0) {
      queryCommand.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (filterExpressions.length > 0) {
      queryCommand.FilterExpression = filterExpressions.join(' AND ');
    }

    if (startKey) {
      queryCommand.ExclusiveStartKey = startKey;
    }

    const result = await ddb.send(new QueryCommand(queryCommand));

    // Calculate summary statistics
    const messages = result.Items || [];
    const inboundCount = messages.filter(m => m.direction === 'inbound').length;
    const outboundCount = messages.filter(m => m.direction === 'outbound').length;
    const deliveredCount = messages.filter(m => m.status === 'delivered' || m.status === 'read').length;
    const failedCount = messages.filter(m => m.status === 'failed' || m.status === 'undelivered').length;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        messages,
        summary: {
          total: messages.length,
          inbound: inboundCount,
          outbound: outboundCount,
          delivered: deliveredCount,
          failed: failedCount,
        },
        pagination: {
          hasMore: !!result.LastEvaluatedKey,
          nextKey: result.LastEvaluatedKey
            ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
            : null,
        },
      }),
    };
  } catch (error) {
    console.error('Error fetching RCS messages:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to fetch messages' }),
    };
  }
};

