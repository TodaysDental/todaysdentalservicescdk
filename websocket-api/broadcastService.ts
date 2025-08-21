import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

declare const process: any;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE!;
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT!;

interface BroadcastMessage {
  type: string;
  category: string;
  data: any;
  timestamp: number;
}

interface CallEvent {
  callId: string;
  clinicId: string;
  agentId?: string;
  agentName?: string;
  callType: 'INBOUND' | 'OUTBOUND';
  phoneNumber: string;
  eventType: 'CALL_START' | 'CALL_ANSWER' | 'CALL_END' | 'CALL_MISSED';
  timestamp: number;
  meetingId?: string;
  attendeeId?: string;
  duration?: number;
  waitTime?: number;
  recordingUrl?: string;
  transcriptUrl?: string;
}

interface AgentEvent {
  agentId: string;
  clinicId: string;
  agentName?: string;
  eventType: 'AGENT_LOGIN' | 'AGENT_LOGOUT' | 'AGENT_STATE_CHANGE' | 'AGENT_CALL_START' | 'AGENT_CALL_END';
  newState?: 'AVAILABLE' | 'BUSY' | 'BREAK' | 'OFFLINE';
  previousState?: 'AVAILABLE' | 'BUSY' | 'BREAK' | 'OFFLINE';
  callId?: string;
  timestamp: number;
}

interface StatisticsUpdate {
  clinicId: string;
  date: string;
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  answeredCalls: number;
  missedCalls: number;
  averageCallDuration: number;
  averageWaitTime: number;
  answerRate: number;
  timestamp: number;
}

export class ContactCenterBroadcastService {
  private apiGateway: ApiGatewayManagementApiClient;

  constructor() {
    this.apiGateway = new ApiGatewayManagementApiClient({
      endpoint: WEBSOCKET_API_ENDPOINT,
    });
  }

  // Broadcast call events to subscribed clients
  async broadcastCallEvent(callEvent: CallEvent, excludeConnectionId?: string): Promise<void> {
    const message: BroadcastMessage = {
      type: 'realTimeUpdate',
      category: 'callEvent',
      data: callEvent,
      timestamp: Date.now()
    };

    await this.broadcastToSubscribedConnections(
      callEvent.clinicId,
      ['calls'],
      message,
      excludeConnectionId
    );
  }

  // Broadcast agent events to subscribed clients
  async broadcastAgentEvent(agentEvent: AgentEvent, excludeConnectionId?: string): Promise<void> {
    const message: BroadcastMessage = {
      type: 'realTimeUpdate',
      category: 'agentEvent',
      data: agentEvent,
      timestamp: Date.now()
    };

    await this.broadcastToSubscribedConnections(
      agentEvent.clinicId,
      ['agents'],
      message,
      excludeConnectionId
    );
  }

  // Broadcast statistics updates to subscribed clients
  async broadcastStatisticsUpdate(statisticsUpdate: StatisticsUpdate, excludeConnectionId?: string): Promise<void> {
    const message: BroadcastMessage = {
      type: 'realTimeUpdate',
      category: 'statisticsUpdate',
      data: statisticsUpdate,
      timestamp: Date.now()
    };

    await this.broadcastToSubscribedConnections(
      statisticsUpdate.clinicId,
      ['statistics'],
      message,
      excludeConnectionId
    );
  }

  // Broadcast dashboard updates to subscribed clients
  async broadcastDashboardUpdate(clinicId: string, dashboardData: any, excludeConnectionId?: string): Promise<void> {
    const message: BroadcastMessage = {
      type: 'realTimeUpdate',
      category: 'dashboardUpdate',
      data: dashboardData,
      timestamp: Date.now()
    };

    await this.broadcastToSubscribedConnections(
      clinicId,
      ['dashboard'],
      message,
      excludeConnectionId
    );
  }

  // Broadcast queue updates to subscribed clients
  async broadcastQueueUpdate(clinicId: string, queueData: any, excludeConnectionId?: string): Promise<void> {
    const message: BroadcastMessage = {
      type: 'realTimeUpdate',
      category: 'queueUpdate',
      data: queueData,
      timestamp: Date.now()
    };

    await this.broadcastToSubscribedConnections(
      clinicId,
      ['queue'],
      message,
      excludeConnectionId
    );
  }

  // Generic method to broadcast system notifications
  async broadcastSystemNotification(
    message: string, 
    level: 'info' | 'warning' | 'error' = 'info',
    clinicIds?: string[], 
    excludeConnectionId?: string
  ): Promise<void> {
    const broadcastMessage: BroadcastMessage = {
      type: 'systemNotification',
      category: 'notification',
      data: {
        message,
        level,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    };

    if (clinicIds && clinicIds.length > 0) {
      // Broadcast to specific clinics
      for (const clinicId of clinicIds) {
        await this.broadcastToSubscribedConnections(
          clinicId,
          ['notifications'],
          broadcastMessage,
          excludeConnectionId
        );
      }
    } else {
      // Broadcast to all connections
      await this.broadcastToAllConnections(broadcastMessage, excludeConnectionId);
    }
  }

  // Send message to a specific connection
  async sendToConnection(connectionId: string, data: any): Promise<void> {
    try {
      await this.apiGateway.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(data),
      }));

    } catch (error: any) {
      console.error('Failed to send message to connection:', error);
      
      // If connection is stale, remove it
      if (error.statusCode === 410) {
        try {
          await ddb.send(new DeleteCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
          }));
          console.log(`Removed stale connection: ${connectionId}`);
        } catch (deleteError) {
          console.error('Failed to remove stale connection:', deleteError);
        }
      }
      throw error;
    }
  }

  // Broadcast to all connections subscribed to specific clinic and topics
  private async broadcastToSubscribedConnections(
    clinicId: string,
    requiredTopics: string[],
    message: BroadcastMessage,
    excludeConnectionId?: string
  ): Promise<void> {
    try {
      // Get all connections subscribed to real-time updates
      const response = await ddb.send(new ScanCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
        FilterExpression: 'attribute_exists(realTimeSubscriptions)'
      }));

      const connections = response.Items || [];
      const promises = connections
        .filter(conn => {
          if (conn.connectionId === excludeConnectionId) return false;
          
          const subscriptions = conn.realTimeSubscriptions;
          if (!subscriptions) return false;
          
          const subscribedClinics = subscriptions.clinicIds || [];
          const subscribedTopics = subscriptions.topics || [];
          
          // Check if connection is subscribed to the clinic
          const hasClinicAccess = subscribedClinics.includes(clinicId);
          
          // Check if connection is subscribed to any of the required topics
          const hasTopicAccess = requiredTopics.some(topic => subscribedTopics.includes(topic));
          
          return hasClinicAccess && hasTopicAccess;
        })
        .map(conn => this.sendToConnection(conn.connectionId, message));

      await Promise.allSettled(promises);

    } catch (error) {
      console.error('Failed to broadcast to subscribed connections:', error);
      throw error;
    }
  }

  // Broadcast to all connections
  private async broadcastToAllConnections(message: BroadcastMessage, excludeConnectionId?: string): Promise<void> {
    try {
      const response = await ddb.send(new ScanCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
      }));

      const connections = response.Items || [];
      const promises = connections
        .filter(conn => conn.connectionId !== excludeConnectionId)
        .map(conn => this.sendToConnection(conn.connectionId, message));

      await Promise.allSettled(promises);

    } catch (error) {
      console.error('Failed to broadcast to all connections:', error);
      throw error;
    }
  }

  // Broadcast to all connections in specific clinics
  async broadcastToClinicConnections(
    clinicIds: string[],
    message: BroadcastMessage,
    excludeConnectionId?: string
  ): Promise<void> {
    try {
      const response = await ddb.send(new ScanCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
      }));

      const connections = response.Items || [];
      const promises = connections
        .filter(conn => {
          if (conn.connectionId === excludeConnectionId) return false;
          
          // Check if connection belongs to one of the target clinics
          const userClinics = conn.clinics || [];
          return clinicIds.some(clinicId => userClinics.includes(clinicId));
        })
        .map(conn => this.sendToConnection(conn.connectionId, message));

      await Promise.allSettled(promises);

    } catch (error) {
      console.error('Failed to broadcast to clinic connections:', error);
      throw error;
    }
  }
}

// Export singleton instance for easy use
export const broadcastService = new ContactCenterBroadcastService();

// Export individual functions for Lambda handlers
export async function broadcastCallEvent(callEvent: CallEvent, excludeConnectionId?: string): Promise<void> {
  return broadcastService.broadcastCallEvent(callEvent, excludeConnectionId);
}

export async function broadcastAgentEvent(agentEvent: AgentEvent, excludeConnectionId?: string): Promise<void> {
  return broadcastService.broadcastAgentEvent(agentEvent, excludeConnectionId);
}

export async function broadcastStatisticsUpdate(statisticsUpdate: StatisticsUpdate, excludeConnectionId?: string): Promise<void> {
  return broadcastService.broadcastStatisticsUpdate(statisticsUpdate, excludeConnectionId);
}

export async function broadcastDashboardUpdate(clinicId: string, dashboardData: any, excludeConnectionId?: string): Promise<void> {
  return broadcastService.broadcastDashboardUpdate(clinicId, dashboardData, excludeConnectionId);
}

export async function broadcastQueueUpdate(clinicId: string, queueData: any, excludeConnectionId?: string): Promise<void> {
  return broadcastService.broadcastQueueUpdate(clinicId, queueData, excludeConnectionId);
}

export async function broadcastSystemNotification(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  clinicIds?: string[],
  excludeConnectionId?: string
): Promise<void> {
  return broadcastService.broadcastSystemNotification(message, level, clinicIds, excludeConnectionId);
}
