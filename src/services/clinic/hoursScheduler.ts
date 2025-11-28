import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import { APIGatewayProxyResult } from 'aws-lambda';

// Environment variables configured in clinic-hours-stack.ts
const TABLE_NAME = process.env.CLINIC_HOURS_TABLE!;
const SCHEDULES_API_URL = process.env.SCHEDULES_API_URL!;
const ALL_CLINIC_IDS = process.env.ALL_CLINIC_IDS?.split(',').map(id => id.trim()).filter(id => id.length > 0) || [];

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Interface for the DynamoDB item (ClinicHoursTable structure)
// NOTE: This interface definition MUST match the structure used in hoursCrud.ts
interface ClinicHoursItem {
  clinicId: string;
  monday?: { open: string; close: string; closed?: boolean };
  tuesday?: { open: string; close: string; closed?: boolean };
  wednesday?: { open: string; close: string; closed?: boolean };
  thursday?: { open: string; close: string; closed?: boolean };
  friday?: { open: string; close: string; closed?: boolean };
  saturday?: { open: string; close: string; closed?: boolean };
  sunday?: { open: string; close: string; closed?: boolean };
  timeZone: string;
  updatedAt: number;
  updatedBy: string;
}

// Interface for the raw schedule blocks from the Open Dental API
interface ScheduleBlock {
    ScheduleNum: string;
    SchedDate: string; // e.g., "2025-11-29"
    StartTime: string; // e.g., "07:00:00"
    StopTime: string;  // e.g., "15:00:00"
    // ... other fields like SchedType, operatories, etc.
    [key: string]: any;
}


/**
 * Calculates the date for Monday (day 1) and Saturday (day 6) of the current week.
 * Dates are returned in YYYY-MM-DD format.
 */
const getCurrentWeekBounds = () => {
    const today = new Date();
    // getDay() returns 0 for Sunday, 1 for Monday, ..., 6 for Saturday
    const dayOfWeek = today.getDay(); 
    
    // Calculate difference to shift to Monday (day 1)
    // If today is Sunday (0), we need to go back 6 days to last Monday.
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; 
    
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5); // Monday + 5 days = Saturday

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    return {
        dateStart: formatDate(monday),
        dateEnd: formatDate(saturday),
    };
};

/**
 * Transforms an array of schedule blocks for a single day into a single operating hour object.
 * It finds the absolute earliest StartTime and the absolute latest StopTime.
 */
function deriveDailyHours(dailyScheduleBlocks: ScheduleBlock[], date: string): { dayName: string; hours?: { open: string; close: string; closed?: boolean } } {
    let minOpenTime: string | null = null;
    let maxCloseTime: string | null = null;
    
    // Calculate the day name from the date string (e.g., "2025-11-29" -> "saturday")
    // Note: JS Date constructor handles YYYY-MM-DD format reliably.
    const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' }).toLowerCase();

    for (const block of dailyScheduleBlocks) {
        // Only process blocks that define time boundaries (skip empty or invalid times)
        const startTime = block.StartTime;
        const stopTime = block.StopTime;

        if (!startTime || !stopTime) continue;

        // Find the absolute earliest start time
        if (minOpenTime === null || startTime < minOpenTime) {
            minOpenTime = startTime;
        }

        // Find the absolute latest stop time
        if (maxCloseTime === null || stopTime > maxCloseTime) {
            maxCloseTime = stopTime;
        }
    }

    if (minOpenTime && maxCloseTime) {
        // Format to HH:MM (slice off seconds)
        return {
            dayName,
            hours: {
                open: minOpenTime.substring(0, 5),
                close: maxCloseTime.substring(0, 5),
                closed: false,
            },
        };
    } else {
        // FIX: Provide 'open' and 'close' keys to satisfy the hoursCrud.ts interface.
        return { 
            dayName, 
            hours: { 
                open: '', 
                close: '', 
                closed: true 
            } 
        };
    }
}


export const handler = async (): Promise<APIGatewayProxyResult> => {
    console.log(`Starting hourly clinic hours update for ${ALL_CLINIC_IDS.length} clinics.`);
    const { dateStart, dateEnd } = getCurrentWeekBounds();
    console.log(`Fetching schedules from ${dateStart} (Monday) to ${dateEnd} (Saturday)`);

    if (ALL_CLINIC_IDS.length === 0) {
        console.warn("No clinic IDs configured. Exiting.");
        return { statusCode: 200, body: JSON.stringify({ message: "No clinics to process." }) };
    }
    
    // Days to process (Monday to Saturday) for explicit closure if data is missing
    const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const closedHoursDefault = { open: '', close: '', closed: true };

    for (const clinicId of ALL_CLINIC_IDS) {
        if (!clinicId) continue;
        
        try {
            console.log(`Processing clinic: ${clinicId}`);

            // 1. Construct the API URL using the requested date range
            const schedulesUrl = `${SCHEDULES_API_URL}/${clinicId}?dateStart=${dateStart}&dateEnd=${dateEnd}`;
            
            // NOTE: Add proper authentication headers (Authorization, API Key, etc.) here
            const response = await axios.get(schedulesUrl);
            
            // Assuming the full week's schedule data is the array in the response body's 'items' property
            const fullWeekScheduleData: ScheduleBlock[] = response.data.items || response.data || []; 

            // 3. Initialize the DynamoDB item with metadata and ALL days explicitly closed
            let finalHoursItem: ClinicHoursItem = {
                clinicId,
                updatedAt: Date.now(),
                updatedBy: 'AutomatedScheduler',
                timeZone: 'America/New_York', // Default timezone, should be fetched from clinic config if possible
            };
            
            // Explicitly set all target days to closed initially (handles the empty array case)
            daysOfWeek.forEach(day => {
                (finalHoursItem as any)[day] = closedHoursDefault;
            });
            
            
            if (fullWeekScheduleData.length === 0) {
                console.log(`API returned empty schedule array for ${clinicId}. Saving all days as closed.`);
                // The item is already set to closed, so we can skip grouping and derivation
            } else {
                
                // 2. Group the schedule blocks by date
                const dailyGroupedData = fullWeekScheduleData.reduce((acc, block) => {
                    const dateKey = block.SchedDate;
                    if (!acc[dateKey]) acc[dateKey] = [];
                    acc[dateKey].push(block);
                    return acc;
                }, {} as Record<string, ScheduleBlock[]>);


                // 4. Override the 'closed' status for days that actually have schedules
                for (const date of Object.keys(dailyGroupedData)) {
                    const dailyBlocks = dailyGroupedData[date];
                    const { dayName, hours } = deriveDailyHours(dailyBlocks, date);
                    
                    // Add the derived hours to the final item, overwriting the 'closed' default
                    if (hours) {
                        (finalHoursItem as any)[dayName] = hours;
                    }
                }
            }
            
            // 5. Write Directly to DynamoDB (PutCommand performs a full overwrite)
            await ddb.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: finalHoursItem,
            }));

            console.log(`Successfully updated clinic hours for ${clinicId} from ${dateStart} to ${dateEnd}`);

        } catch (error: any) {
            // Use exponential backoff internally for the axios call, but log and continue here
            console.error(`Failed to update clinic hours for ${clinicId}. Error:`, error.message);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Clinic hours update process finished. Checked ${ALL_CLINIC_IDS.length} clinics.` }),
    };
};