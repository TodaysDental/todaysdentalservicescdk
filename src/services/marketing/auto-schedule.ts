import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
  ayrshareSetAutoSchedule,
  ayrshareGetAutoSchedule,
  ayrshareDeleteAutoSchedule,
} from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = await buildCorsHeadersAsync({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] }, event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /auto-schedule/set - Create or update auto-schedule
    // ---------------------------------------------------------
    if (path.includes('/set') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicId, title, schedule, days, timezone } = body;

      if (!clinicId || !title || !schedule) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'clinicId, title, and schedule are required'
          })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Convert schedule times to ISO 8601 format if needed
      const times = schedule.map((time: string) => {
        // If it's just HH:MM, convert to full date-time
        if (/^\d{2}:\d{2}$/.test(time)) {
          const today = new Date();
          const [hours, minutes] = time.split(':');
          today.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          return today.toISOString();
        }
        return time;
      });

      // Call Ayrshare API
      const result = await ayrshareSetAutoSchedule(
        API_KEY,
        profileRes.Item.ayrshareProfileKey,
        { scheduleDate: times, scheduleTime: times, title }
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          schedule: {
            title,
            times: schedule,
            days: days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            timezone: timezone || 'America/New_York'
          },
          message: 'Auto-schedule created successfully',
          ayrshareResponse: result
        })
      };
    }

    // ---------------------------------------------------------
    // GET /auto-schedule/list - List all schedules for a clinic
    // ---------------------------------------------------------
    if (path.includes('/list') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;

      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId is required' })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Get schedules from Ayrshare
      const result = await ayrshareGetAutoSchedule(API_KEY, profileRes.Item.ayrshareProfileKey);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          schedules: result.schedules || result || []
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /auto-schedule - Delete a schedule
    // ---------------------------------------------------------
    if (path.endsWith('/auto-schedule') && method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { clinicId, title } = body;

      if (!clinicId || !title) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'clinicId and title are required'
          })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Delete schedule from Ayrshare
      const result = await ayrshareDeleteAutoSchedule(
        API_KEY,
        profileRes.Item.ayrshareProfileKey,
        title
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Auto-schedule '${title}' deleted successfully`,
          ayrshareResponse: result
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Auto-Schedule Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: err.message,
        code: 'AUTO_SCHEDULE_ERROR'
      })
    };
  }
};
