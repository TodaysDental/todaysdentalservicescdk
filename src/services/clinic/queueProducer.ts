import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
// Note: Clinic data is fetched from DynamoDB at runtime via ClinicHours table

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const sqs = new SQSClient({});

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE || process.env.SCHEDULER || 'SCHEDULER';
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';
const SCHEDULER_QUEUE_URL = process.env.SCHEDULER_QUEUE_URL || '';

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; week: number };

function nowUtc(): Date { return new Date(); }

function getLocalParts(d: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = fmt.formatToParts(d).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {} as any);
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const week = weekNumberLocal(year, month, day, timeZone);
  return { year, month, day, hour, minute, week };
}

function weekNumberLocal(year: number, month: number, day: number, timeZone: string): number {
  // Compute ISO-like week number based on local date components
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isDueLocal(schedule: any, now: Date, timeZone: string, lastRunAtIso?: string): boolean {
  const freq = String(schedule.frequency || 'daily').toLowerCase();
  const time = String(schedule.time || '').trim();
  const lastRunAt = lastRunAtIso ? new Date(lastRunAtIso) : undefined;

  // Only run once per minute per clinic
  if (lastRunAt && Math.abs(now.getTime() - lastRunAt.getTime()) < 55_000) return false;

  const nowL = getLocalParts(now, timeZone);
  const lastL = lastRunAt ? getLocalParts(lastRunAt, timeZone) : undefined;

  // For "once" frequency schedules: if already run, never run again
  if (freq === 'once' && lastRunAt) {
    console.log(`[isDueLocal] Skipping "once" schedule ${schedule.id} - already ran at ${lastRunAtIso}`);
    return false;
  }

  // Check the "date" field for "once" schedules (format: DD-MM-YYYY)
  // This ensures the schedule only runs on the specified date
  const scheduleDate = String(schedule.date || '').trim();
  if (freq === 'once' && scheduleDate) {
    const dateParts = scheduleDate.split('-').map((x: string) => parseInt(x, 10));
    if (dateParts.length === 3) {
      // Format is DD-MM-YYYY
      const [schedDay, schedMonth, schedYear] = dateParts;
      const scheduledDateKey = schedYear * 10000 + schedMonth * 100 + schedDay;
      const todayKey = nowL.year * 10000 + nowL.month * 100 + nowL.day;
      
      if (todayKey !== scheduledDateKey) {
        // Not the scheduled date - don't run
        // Also skip if the date has passed (schedule is stale)
        if (todayKey > scheduledDateKey) {
          console.log(`[isDueLocal] Skipping "once" schedule ${schedule.id} - scheduled date ${scheduleDate} has passed`);
        }
        return false;
      }
    }
  }

  // Date window filtering (inclusive), based on local date
  const startDate = String(schedule.startDate || schedule.start_date || '').trim(); // YYYY-MM-DD
  const endDate = String(schedule.endDate || schedule.end_date || '').trim(); // YYYY-MM-DD
  if (startDate) {
    const sParts = startDate.split('-').map((x: string) => parseInt(x, 10));
    if (sParts.length === 3) {
      const sKey = sParts[0] * 10000 + sParts[1] * 100 + sParts[2];
      const todayKey = nowL.year * 10000 + nowL.month * 100 + nowL.day;
      if (todayKey < sKey) return false;
    }
  }
  if (endDate) {
    const eParts = endDate.split('-').map((x: string) => parseInt(x, 10));
    if (eParts.length === 3) {
      const eKey = eParts[0] * 10000 + eParts[1] * 100 + eParts[2];
      const todayKey = nowL.year * 10000 + nowL.month * 100 + nowL.day;
      if (todayKey > eKey) return false;
    }
  }

  if (!time) {
    return shouldRunByFrequencyLocal(freq, nowL, lastL, startDate);
  }
  const [hh, mm] = time.split(':').map((s: string) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
  
  // Use a 2-minute window to account for producer running every 2 minutes
  // e.g., if schedule is 3:05, match at 3:04, 3:05, or 3:06
  const isHourMatch = nowL.hour === hh;
  const minuteDiff = Math.abs(nowL.minute - mm);
  const isWithinWindow = minuteDiff <= 1 || minuteDiff >= 59; // Handle hour wraparound (e.g., 00 vs 59)
  const isNow = isHourMatch && isWithinWindow;
  
  if (!isNow) return false;
  return shouldRunByFrequencyLocal(freq, nowL, lastL, startDate);
}

function shouldRunByFrequencyLocal(freq: string, nowL: LocalParts, lastL?: LocalParts, startDate?: string): boolean {
  if (!lastL) return true;
  switch (freq) {
    case 'hourly': return nowL.hour !== lastL.hour || nowL.day !== lastL.day || nowL.month !== lastL.month || nowL.year !== lastL.year;
    case 'daily': return nowL.day !== lastL.day || nowL.month !== lastL.month || nowL.year !== lastL.year;
    case 'weekly': {
      const anchorDow = startDate ? dayOfWeekFromYmd(startDate, 'UTC') : undefined; // 0=Sun..6=Sat, use UTC day-of-week for anchor
      if (anchorDow !== undefined) {
        const nowDow = dayOfWeekLocal(nowL);
        const lastDow = lastL ? dayOfWeekLocal(lastL) : -1;
        const isAnchorToday = nowDow === anchorDow;
        const crossedWeek = nowL.week !== (lastL?.week ?? -1) || nowL.year !== (lastL?.year ?? -1);
        return isAnchorToday && crossedWeek;
      }
      return nowL.week !== lastL.week || nowL.year !== lastL.year;
    }
    case 'monthly': {
      const anchorDom = startDate ? parseInt(startDate.split('-')[2], 10) : undefined;
      const isAnchorToday = anchorDom ? nowL.day === anchorDom : false;
      const crossedMonth = nowL.month !== lastL.month || nowL.year !== lastL.year;
      return isAnchorToday && crossedMonth;
    }
    case 'once':
      // "once" schedules should NEVER run again once they've already run
      // If lastL exists, the schedule has already been executed
      return false;
    default: return true;
  }
}

function dayOfWeekFromYmd(ymd: string, tz: string): number | undefined {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
  if (!m) return undefined;
  const date = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return date.getUTCDay();
}

function dayOfWeekLocal(parts: LocalParts): number {
  // Compute day-of-week from date parts via Date UTC; DST boundaries won't affect DOW
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCDay();
}

const tzCache: Record<string, string> = {};
async function getClinicTimeZone(clinicId: string): Promise<string> {
  if (!clinicId) return 'America/New_York';
  if (tzCache[clinicId]) return tzCache[clinicId];
  try {
    const resp = await doc.send(new GetCommand({ TableName: CLINIC_HOURS_TABLE, Key: { clinicId } }));
    const item: any = resp.Item || {};
    const tz = String(item.timeZone || item.timezone || 'America/New_York');
    tzCache[clinicId] = tz;
    return tz;
  } catch {
    return 'America/New_York';
  }
}

interface ScheduleTask {
  scheduleId: string;
  clinicId: string;
  queryTemplate: string;
  templateMessage: string;
  notificationTypes: string[];
  timeZone: string;
  enqueuedAt: string;
}

async function enqueueScheduleTask(task: ScheduleTask): Promise<void> {
  if (!SCHEDULER_QUEUE_URL) {
    console.warn('SCHEDULER_QUEUE_URL not configured, skipping enqueue');
    return;
  }

  await sqs.send(new SendMessageCommand({
    QueueUrl: SCHEDULER_QUEUE_URL,
    MessageBody: JSON.stringify(task),
    MessageAttributes: {
      ScheduleId: { StringValue: task.scheduleId, DataType: 'String' },
      ClinicId: { StringValue: task.clinicId, DataType: 'String' },
      TimeZone: { StringValue: task.timeZone, DataType: 'String' },
    },
  }));
}

export const handler = async () => {
  const now = nowUtc();
  console.log(`Queue producer running at ${now.toISOString()}`);
  
  const scan = await doc.send(new ScanCommand({ TableName: SCHEDULES_TABLE }));
  const schedules = (scan.Items || []) as any[];
  
  let enqueuedCount = 0;
  let skippedCount = 0;

  for (const sched of schedules) {
    try {
      const clinicIds: string[] = Array.isArray(sched.clinicIds) && sched.clinicIds.length > 0 
        ? sched.clinicIds 
        : (sched.clinicId ? [sched.clinicId] : []);
      
      if (clinicIds.length === 0) {
        skippedCount++;
        continue;
      }

      const queryName = String(sched.queryTemplate || '').trim();
      const templateName = String(sched.templateMessage || '').trim();
      
      if (!queryName || !templateName) {
        skippedCount++;
        continue;
      }

      for (const clinicId of clinicIds) {
        const timeZone = await getClinicTimeZone(clinicId);
        const lastRunByClinic: Record<string, string> = sched.last_run_by_clinic || {};
        const lastRunForThisClinic = lastRunByClinic[clinicId] || sched.last_run_at;
        
        if (!isDueLocal(sched, now, timeZone, lastRunForThisClinic)) {
          skippedCount++;
          continue;
        }

        // Enqueue the schedule task for this clinic
        const task: ScheduleTask = {
          scheduleId: sched.id,
          clinicId,
          queryTemplate: queryName,
          templateMessage: templateName,
          notificationTypes: Array.isArray(sched.notificationTypes) ? sched.notificationTypes : [],
          timeZone,
          enqueuedAt: now.toISOString(),
        };

        await enqueueScheduleTask(task);
        enqueuedCount++;
        
        console.log(`Enqueued schedule task: ${sched.id} for clinic ${clinicId} (${timeZone})`);
      }
    } catch (error) {
      console.error(`Error processing schedule ${sched.id}:`, error);
      skippedCount++;
    }
  }

  console.log(`Queue producer completed: ${enqueuedCount} tasks enqueued, ${skippedCount} skipped`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      enqueuedCount,
      skippedCount,
      processedAt: now.toISOString(),
    }),
  };
};
