import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';

export const handler = async (event: DynamoDBStreamEvent) => {
  console.log('Hours sync event received for Chime SDK voice system');
  
  for (const rec of event.Records) {
    if (rec.eventName !== 'INSERT' && rec.eventName !== 'MODIFY') continue;
    const newImage = rec.dynamodb?.NewImage;
    if (!newImage) continue;
    const item: any = unmarshall(newImage as Record<string, any>);
    const clinicId: string = String(item.clinicId || '');
    if (!clinicId) continue;

    try {
      console.log(`Processing hours update for clinic: ${clinicId}`);
      
      // Validate and normalize hours data for Chime SDK system
      const normalizedHours = normalizeHoursData(item);
      
      // Update the hours record with normalized data and metadata
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { clinicId },
        UpdateExpression: 'SET normalizedHours = :hours, lastSync = :sync, chimeVoiceEnabled = :enabled',
        ExpressionAttributeValues: { 
          ':hours': normalizedHours, 
          ':sync': Date.now(),
          ':enabled': true
        },
      }));

      console.log(`Successfully synced hours for clinic ${clinicId} with Chime SDK voice system`);
      
    } catch (error) {
      console.error(`Error syncing hours for clinic ${clinicId}:`, error);
      // Continue processing other records even if one fails
    }
  }
  return { ok: true };
};

function normalizeHoursData(item: any): any {
  // Normalize hours data for Chime SDK voice system
  // Expected format: item.days = { mon: [{start:"09:00", end:"17:00"}], tue: [...] ... }
  const days = item.days || {};
  const timeZone = String(item.timeZone || item.timezone || 'America/New_York');
  
  // Convert to normalized format for SMA handler
  const normalizedDays: any = {};
  
  // Map day names to numeric indices (0 = Sunday, 1 = Monday, etc.)
  const dayMap: Record<string, number> = { 
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 
  };
  
  for (const [dayKey, dayIndex] of Object.entries(dayMap)) {
    const ranges: Array<{ start: string; end: string }> = (days as any)[dayKey] || [];
    
    if (ranges.length === 0) {
      // Day is closed
      normalizedDays[`day${dayIndex}`] = {
        isOpen: false,
        openTime: null,
        closeTime: null
      };
    } else {
      // Use first range for simplicity (most clinics have single open/close times)
      const firstRange = ranges[0];
      normalizedDays[`day${dayIndex}`] = {
        isOpen: true,
        openTime: firstRange.start || '09:00',
        closeTime: firstRange.end || '17:00'
      };
    }
  }
  
  return {
    timeZone,
    days: normalizedDays,
    lastUpdated: Date.now(),
    // Include raw data for reference
    originalDays: days
  };
}


