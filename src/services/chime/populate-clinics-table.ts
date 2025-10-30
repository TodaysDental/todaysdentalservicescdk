import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import clinicsData from '../../infrastructure/configs/clinics.json';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;

// CloudFormation Custom Resource Response interface
interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: any;
}

// Send response to CloudFormation
async function sendResponse(event: CloudFormationCustomResourceEvent, status: 'SUCCESS' | 'FAILED', data?: any, error?: string) {
  console.log('[populate-clinics] Preparing CloudFormation response', {
    status,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
    hasError: !!error,
    dataKeys: data ? Object.keys(data) : []
  });
  
  const responseBody = JSON.stringify({
    Status: status,
    Reason: error || `See CloudWatch Log Stream: ${process.env.AWS_LAMBDA_LOG_STREAM_NAME}`,
    PhysicalResourceId: event.PhysicalResourceId || 'PopulateClinicsTable',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data || {}
  });

  console.log('[populate-clinics] Sending response to CloudFormation', {
    responseUrl: event.ResponseURL,
    bodyLength: responseBody.length,
    status
  });

  try {
    const startTime = Date.now();
    const response = await fetch(event.ResponseURL, {
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length.toString()
      },
      body: responseBody
    });
    const duration = Date.now() - startTime;

    console.log('[populate-clinics] CloudFormation response sent successfully', {
      status: response.status,
      statusText: response.statusText,
      duration: `${duration}ms`,
      contentType: response.headers.get('content-type')
    });
    return response;
  } catch (error: any) {
    const errorDetails = {
      message: error?.message,
      code: error?.name || error?.code,
      stack: error?.stack
    };
    console.error('[populate-clinics] Error sending response to CloudFormation:', errorDetails);
    throw error;
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<any> => {
  // Log function invocation with request metadata
  console.log('[populate-clinics] Function invoked', {
    requestType: event.RequestType,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
    resourceType: event.ResourceType,
    stackId: event.StackId?.split('/')[1], // Just the stack name
    timestamp: new Date().toISOString()
  });
  
  console.log('[populate-clinics] Full event details:', JSON.stringify(event, null, 2));

  try {
    if (!CLINICS_TABLE_NAME) {
      console.error('[populate-clinics] Missing required environment variable: CLINICS_TABLE_NAME');
      throw new Error('CLINICS_TABLE_NAME environment variable is required');
    }
    
    console.log('[populate-clinics] Environment validated', {
      tableName: CLINICS_TABLE_NAME,
      region: process.env.AWS_REGION
    });

    // Handle different CloudFormation request types
    if (event.RequestType === 'Delete') {
      console.log('[populate-clinics] Processing DELETE request - no cleanup needed for DynamoDB data');
      await sendResponse(event, 'SUCCESS', { message: 'Delete completed successfully' });
      return;
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log('[populate-clinics] Processing CREATE/UPDATE request');
      
      // Process items in batches of 25 (DynamoDB BatchWrite limit)
      const batches = [];
      
      console.log('[populate-clinics] Loading clinics data', {
        totalClinicsInConfig: clinicsData.length
      });
      
      const items = clinicsData
        .filter(clinic => clinic.phoneNumber && clinic.clinicId)
        .map(clinic => ({
          PutRequest: {
            Item: {
              ...clinic
            }
          }
        }));
      
      const filteredOut = clinicsData.length - items.length;
      console.log('[populate-clinics] Clinics data processed', {
        totalClinics: clinicsData.length,
        validClinics: items.length,
        filteredOut,
        filterCriteria: 'phoneNumber and clinicId required'
      });

      console.log(`[populate-clinics] Processing ${items.length} clinic items in batches of 25`);

      const batchSize = 25;
      const totalBatches = Math.ceil(items.length / batchSize);
      console.log('[populate-clinics] Preparing batch operations', {
        totalItems: items.length,
        batchSize,
        totalBatches
      });
      
      for (let i = 0; i < items.length; i += batchSize) {
        const batchNumber = Math.floor(i / batchSize) + 1;
        const batch = items.slice(i, i + batchSize);
        
        console.log('[populate-clinics] Processing batch', {
          batchNumber,
          totalBatches,
          itemsInBatch: batch.length,
          startIndex: i,
          endIndex: Math.min(i + batchSize - 1, items.length - 1)
        });
        
        batches.push(
          ddb.send(new BatchWriteCommand({
            RequestItems: {
              [CLINICS_TABLE_NAME]: batch
            }
          }))
        );
      }

      console.log('[populate-clinics] Executing all batch operations concurrently');
      const batchStartTime = Date.now();
      await Promise.all(batches);
      const batchDuration = Date.now() - batchStartTime;
      
      console.log('[populate-clinics] All batches completed successfully', {
        totalItems: items.length,
        totalBatches,
        duration: `${batchDuration}ms`,
        averageTimePerBatch: `${Math.round(batchDuration / totalBatches)}ms`
      });
      
      await sendResponse(event, 'SUCCESS', { 
        itemsProcessed: items.length,
        totalBatches,
        duration: batchDuration,
        message: `Successfully populated ${items.length} clinic items in ${totalBatches} batches` 
      });
    }

  } catch (error: any) {
    const errorContext = {
      message: error?.message,
      code: error?.name || error?.code,
      stack: error?.stack,
      requestType: event.RequestType,
      requestId: event.RequestId,
      timestamp: new Date().toISOString()
    };
    console.error('[populate-clinics] Error processing request:', errorContext);
    
    await sendResponse(event, 'FAILED', {
      error: error?.message,
      code: error?.name || error?.code
    }, error instanceof Error ? error.message : 'Unknown error occurred');
    throw error;
  }
};