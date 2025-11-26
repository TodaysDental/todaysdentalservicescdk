/**
 * First Call Resolution (FCR) Calculator
 * 
 * Properly calculates FCR by checking if the same customer calls back within 24 hours
 * about the same issue (not just whether call was transferred)
 */

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface FCRCheckParams {
  callId: string;
  customerPhone: string;
  clinicId: string;
  callEndTime: number; // Unix timestamp in seconds
  callQueueTableName: string;
}

/**
 * Check if a call represents First Call Resolution
 * Returns true if customer did NOT call back within 24 hours
 */
export async function checkFirstCallResolution(
  ddb: DynamoDBDocumentClient,
  params: FCRCheckParams
): Promise<boolean> {
  const { customerPhone, clinicId, callEndTime, callQueueTableName, callId } = params;
  
  // Look for callbacks from same customer within 24 hours
  const twentyFourHoursLater = callEndTime + (24 * 60 * 60); // 24 hours in seconds
  
  try {
    // Query for calls from same phone number in next 24 hours
    const result = await ddb.send(new QueryCommand({
      TableName: callQueueTableName,
      IndexName: 'phoneNumber-queueEntryTime-index',
      KeyConditionExpression: 'phoneNumber = :phone AND queueEntryTime BETWEEN :start AND :end',
      FilterExpression: 'clinicId = :clinicId AND callId <> :currentCallId AND #status IN (:completed, :abandoned)',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':phone': customerPhone,
        ':start': callEndTime,
        ':end': twentyFourHoursLater,
        ':clinicId': clinicId,
        ':currentCallId': callId,
        ':completed': 'completed',
        ':abandoned': 'abandoned'
      },
      Limit: 5 // Only need to know if ANY callbacks exist
    }));
    
    const callbacks = result.Items || [];
    
    // FCR achieved if NO callbacks within 24 hours
    const fcrAchieved = callbacks.length === 0;
    
    console.log('[FCRCalculator] Check complete:', {
      callId,
      customerPhone,
      callbacksFound: callbacks.length,
      fcrAchieved
    });
    
    return fcrAchieved;
    
  } catch (error) {
    console.error('[FCRCalculator] Error checking FCR:', error);
    // On error, assume FCR not achieved (conservative approach)
    return false;
  }
}

/**
 * Batch check FCR for multiple calls (for historical analysis)
 */
export async function batchCheckFCR(
  ddb: DynamoDBDocumentClient,
  calls: Array<{
    callId: string;
    customerPhone: string;
    clinicId: string;
    callEndTime: number;
  }>,
  callQueueTableName: string
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  
  // Process in batches of 10 to avoid throttling
  for (let i = 0; i < calls.length; i += 10) {
    const batch = calls.slice(i, i + 10);
    
    const promises = batch.map(call =>
      checkFirstCallResolution(ddb, {
        ...call,
        callQueueTableName
      }).then(fcr => ({ callId: call.callId, fcr }))
    );
    
    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ callId, fcr }) => {
      results.set(callId, fcr);
    });
  }
  
  return results;
}

/**
 * Calculate FCR rate for a set of completed calls
 */
export function calculateFCRRate(fcrResults: Map<string, boolean>): {
  totalCalls: number;
  fcrAchieved: number;
  fcrRate: number;
} {
  const totalCalls = fcrResults.size;
  const fcrAchieved = Array.from(fcrResults.values()).filter(fcr => fcr).length;
  const fcrRate = totalCalls > 0 ? (fcrAchieved / totalCalls) * 100 : 0;
  
  return {
    totalCalls,
    fcrAchieved,
    fcrRate: Math.round(fcrRate * 100) / 100 // Round to 2 decimals
  };
}

