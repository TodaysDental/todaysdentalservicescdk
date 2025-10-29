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
  const responseBody = JSON.stringify({
    Status: status,
    Reason: error || `See CloudWatch Log Stream: ${process.env.AWS_LAMBDA_LOG_STREAM_NAME}`,
    PhysicalResourceId: event.PhysicalResourceId || 'PopulateClinicsTable',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data || {}
  });

  console.log('Sending response to CloudFormation:', responseBody);

  try {
    const response = await fetch(event.ResponseURL, {
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length.toString()
      },
      body: responseBody
    });

    console.log('CloudFormation response status:', response.status);
    return response;
  } catch (error) {
    console.error('Error sending response to CloudFormation:', error);
    throw error;
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    if (!CLINICS_TABLE_NAME) {
      throw new Error('CLINICS_TABLE_NAME environment variable is required');
    }

    // Handle different CloudFormation request types
    if (event.RequestType === 'Delete') {
      console.log('Delete request - no action needed for DynamoDB data');
      await sendResponse(event, 'SUCCESS', { message: 'Delete completed successfully' });
      return;
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      // Process items in batches of 25 (DynamoDB BatchWrite limit)
      const batches = [];
      const items = clinicsData
        .filter(clinic => clinic.phoneNumber && clinic.clinicId)
        .map(clinic => ({
          PutRequest: {
            Item: {
              ...clinic
            }
          }
        }));

      console.log(`Processing ${items.length} clinic items in batches`);

      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        batches.push(
          ddb.send(new BatchWriteCommand({
            RequestItems: {
              [CLINICS_TABLE_NAME]: batch
            }
          }))
        );
      }

      await Promise.all(batches);
      
      console.log(`Successfully populated ${items.length} items`);
      await sendResponse(event, 'SUCCESS', { 
        itemsProcessed: items.length,
        message: `Successfully populated ${items.length} clinic items` 
      });
    }

  } catch (error) {
    console.error('Error processing request:', error);
    await sendResponse(event, 'FAILED', {}, error instanceof Error ? error.message : 'Unknown error occurred');
    throw error;
  }
};