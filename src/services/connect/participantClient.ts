/**
 * Amazon Connect Participant Service API Client
 *
 * This client provides TypeScript utilities for integrating with the Connect Participant Service API
 * from frontend softphone applications. It handles authentication, request formatting, and response parsing.
 *
 * Note: For React integration, use the hooks from a React component that imports React.
 */

export interface ParticipantRequest {
  contactId: string;
  participantId?: string;
  participantToken?: string;
  connectionToken?: string;
  clinicId?: string;
  destinationNumber?: string;
  agentStatus?: string;
  action: ParticipantAction;
  eventData?: any;
}

export type ParticipantAction =
  | 'start_outbound_call'
  | 'accept_inbound_call'
  | 'reject_inbound_call'
  | 'create_connection'
  | 'disconnect'
  | 'update_agent_status'
  | 'get_contact_attributes'
  | 'update_contact_attributes'
  | 'get_agent_events';

export interface ParticipantResponse {
  success: boolean;
  message: string;
  contactId?: string;
  connectionToken?: string;
  webRTCConnection?: WebRTCConnection;
  attributes?: Record<string, string>;
  agentEvents?: any[];
  activeContacts?: any[];
  participantId?: string;
}

export interface WebRTCConnection {
  SignalingUrl: string;
  JoinToken: string;
  IceServers: IceServer[];
}

export interface IceServer {
  Urls: string[];
  Username: string;
  Password: string;
}

export interface ParticipantConfig {
  baseUrl: string;
  getAuthToken: () => Promise<string>;
  region?: string;
  timeout?: number;
}

/**
 * Connect Participant Service API Client
 */
export class ConnectParticipantClient {
  private config: ParticipantConfig;
  private authToken: string | null = null;

  constructor(config: ParticipantConfig) {
    this.config = {
      region: 'us-east-1',
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Start an outbound call
   */
  async startOutboundCall(clinicId: string, destinationNumber: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      clinicId,
      destinationNumber,
      action: 'start_outbound_call',
    });
  }

  /**
   * Accept an inbound call
   */
  async acceptInboundCall(contactId: string, participantId: string, clinicId?: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      participantId,
      clinicId,
      action: 'accept_inbound_call',
    });
  }

  /**
   * Reject an inbound call
   */
  async rejectInboundCall(contactId: string, participantId: string, clinicId?: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      participantId,
      clinicId,
      action: 'reject_inbound_call',
    });
  }

  /**
   * Create a participant connection for WebRTC
   */
  async createConnection(contactId: string, participantToken: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      participantToken,
      action: 'create_connection',
    });
  }

  /**
   * Disconnect a participant from the contact
   */
  async disconnect(contactId: string, connectionToken: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      connectionToken,
      action: 'disconnect',
    });
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(participantId: string, status: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      participantId,
      agentStatus: status,
      action: 'update_agent_status',
    });
  }

  /**
   * Get contact attributes
   */
  async getContactAttributes(contactId: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      action: 'get_contact_attributes',
    });
  }

  /**
   * Update contact attributes
   */
  async updateContactAttributes(contactId: string, attributes: Record<string, string>): Promise<ParticipantResponse> {
    return this.makeRequest({
      contactId,
      eventData: attributes,
      action: 'update_contact_attributes',
    });
  }

  /**
   * Get agent events and active contacts
   */
  async getAgentEvents(participantId: string): Promise<ParticipantResponse> {
    return this.makeRequest({
      participantId,
      action: 'get_agent_events',
    });
  }

  /**
   * Make authenticated request to the Participant Service API
   */
  private async makeRequest(request: Partial<ParticipantRequest>): Promise<ParticipantResponse> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Authentication token not available');
    }

    const response = await fetch(`${this.config.baseUrl}/connect/participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' })) as { message: string };
      throw new Error(`API Error ${response.status}: ${errorData.message}`);
    }

    return response.json() as Promise<ParticipantResponse>;
  }

  /**
   * Get authentication token, refreshing if necessary
   */
  private async getAuthToken(): Promise<string> {
    if (!this.authToken) {
      this.authToken = await this.config.getAuthToken();
    }
    return this.authToken;
  }

  /**
   * Clear cached authentication token (useful after logout)
   */
  clearAuthToken(): void {
    this.authToken = null;
  }
}

/**
 * React hook for using the Connect Participant Client
 *
 * Usage in a React component:
 *
 * ```typescript
 * import { useState, useEffect } from 'react';
 * import { ConnectParticipantClient } from './participantClient';
 *
 * export function useConnectParticipant(config: ParticipantConfig) {
 *   const [client] = useState(() => new ConnectParticipantClient(config));
 *
 *   useEffect(() => {
 *     // Update auth token when it changes
 *     const updateAuthToken = async () => {
 *       try {
 *         const token = await config.getAuthToken();
 *         if (token !== client.authToken) {
 *           client.authToken = token;
 *         }
 *       } catch (error) {
 *         console.error('Failed to update auth token:', error);
 *       }
 *     };
 *
 *     updateAuthToken();
 *   }, [config.getAuthToken, client]);
 *
 *   return client;
 * }
 * ```
 */

/**
 * Utility functions for softphone integration
 */
export class SoftphoneUtils {
  /**
   * Create WebRTC connection for voice calls
   */
  static async createWebRTCConnection(
    client: ConnectParticipantClient,
    contactId: string,
    participantToken: string
  ): Promise<{ connectionToken: string; webRTCConnection: WebRTCConnection }> {
    const response = await client.createConnection(contactId, participantToken);

    if (!response.success || !response.connectionToken || !response.webRTCConnection) {
      throw new Error('Failed to create WebRTC connection: ' + response.message);
    }

    return {
      connectionToken: response.connectionToken,
      webRTCConnection: response.webRTCConnection,
    };
  }

  /**
   * Start an outbound call
   */
  static async startOutboundCall(
    client: ConnectParticipantClient,
    clinicId: string,
    destinationNumber: string
  ): Promise<string> {
    const response = await client.startOutboundCall(clinicId, destinationNumber);

    if (!response.success || !response.contactId) {
      throw new Error('Failed to start outbound call: ' + response.message);
    }

    return response.contactId;
  }

  /**
   * Update agent status (Available, Offline, etc.)
   */
  static async updateAgentStatus(
    client: ConnectParticipantClient,
    participantId: string,
    status: 'Available' | 'Offline' | 'AfterCallWork'
  ): Promise<void> {
    const response = await client.updateAgentStatus(participantId, status);

    if (!response.success) {
      throw new Error('Failed to update agent status: ' + response.message);
    }
  }

  /**
   * Hang up the call
   */
  static async hangUpCall(
    client: ConnectParticipantClient,
    contactId: string,
    connectionToken: string
  ): Promise<void> {
    const response = await client.disconnect(contactId, connectionToken);

    if (!response.success) {
      throw new Error('Failed to disconnect call: ' + response.message);
    }
  }

  /**
   * Update call attributes (for call context)
   */
  static async updateCallAttributes(
    client: ConnectParticipantClient,
    contactId: string,
    attributes: Record<string, string>
  ): Promise<void> {
    const response = await client.updateContactAttributes(contactId, attributes);

    if (!response.success) {
      throw new Error('Failed to update call attributes: ' + response.message);
    }
  }

  /**
   * Get call information
   */
  static async getCallInfo(
    client: ConnectParticipantClient,
    contactId: string
  ): Promise<Record<string, string>> {
    const response = await client.getContactAttributes(contactId);

    if (!response.success || !response.attributes) {
      throw new Error('Failed to get call info: ' + response.message);
    }

    return response.attributes;
  }

  /**
   * Accept an inbound call
   */
  static async acceptInboundCall(
    client: ConnectParticipantClient,
    contactId: string,
    participantId: string,
    clinicId?: string
  ): Promise<{ contactId: string; participantId: string }> {
    const response = await client.acceptInboundCall(contactId, participantId, clinicId);

    if (!response.success || !response.contactId || !response.participantId) {
      throw new Error('Failed to accept inbound call: ' + response.message);
    }

    return {
      contactId: response.contactId,
      participantId: response.participantId,
    };
  }

  /**
   * Reject an inbound call
   */
  static async rejectInboundCall(
    client: ConnectParticipantClient,
    contactId: string,
    participantId: string,
    clinicId?: string
  ): Promise<{ contactId: string; participantId: string }> {
    const response = await client.rejectInboundCall(contactId, participantId, clinicId);

    if (!response.success || !response.contactId || !response.participantId) {
      throw new Error('Failed to reject inbound call: ' + response.message);
    }

    return {
      contactId: response.contactId,
      participantId: response.participantId,
    };
  }

  /**
   * Get agent events and active contacts (for polling inbound calls)
   */
  static async getAgentEvents(
    client: ConnectParticipantClient,
    participantId: string
  ): Promise<{ agentEvents: any[]; activeContacts: any[] }> {
    const response = await client.getAgentEvents(participantId);

    if (!response.success) {
      throw new Error('Failed to get agent events: ' + response.message);
    }

    return {
      agentEvents: response.agentEvents || [],
      activeContacts: response.activeContacts || [],
    };
  }

  /**
   * Poll for inbound calls (simplified implementation)
   */
  static async pollForInboundCalls(
    client: ConnectParticipantClient,
    participantId: string,
    onIncomingCall: (contact: any) => void,
    pollInterval: number = 3000
  ): Promise<() => void> {
    let isActive = true;

    const pollEvents = async () => {
      if (!isActive) return;

      try {
        const { activeContacts } = await this.getAgentEvents(client, participantId);

        // Check for new inbound calls
        const inboundCalls = activeContacts.filter(
          (contact: any) => contact.routingType === 'inbound_call' && contact.status === 'initiated'
        );

        inboundCalls.forEach((contact: any) => {
          onIncomingCall(contact);
        });

      } catch (error) {
        console.error('Failed to poll for inbound calls:', error);
      }

      if (isActive) {
        setTimeout(pollEvents, pollInterval);
      }
    };

    // Start polling
    pollEvents();

    // Return cleanup function
    return () => {
      isActive = false;
    };
  }
}

// React hooks are imported at the top level

/**
 * Example usage in a React component for voice softphone:
 *
 * ```typescript
 * import { ConnectParticipantClient, SoftphoneUtils } from './participantClient';
 *
 * const VoiceSoftphone = () => {
 *   const client = useConnectParticipant({
 *     baseUrl: 'https://api.todaysdentalinsights.com',
 *     getAuthToken: async () => {
 *       // Get token from your auth system
 *       return await getCognitoToken();
 *     },
 *   });
 *
 *   const handleStartCall = async (phoneNumber: string) => {
 *     try {
 *       // 1. Start outbound call
 *       const contactId = await SoftphoneUtils.startOutboundCall(client, 'dentistinnewbritain', phoneNumber);
 *
 *       // 2. Set agent status to available
 *       await SoftphoneUtils.updateAgentStatus(client, 'agent-123', 'Available');
 *
 *       // 3. Create WebRTC connection (when call is connected)
 *       const { connectionToken, webRTCConnection } = await SoftphoneUtils.createWebRTCConnection(
 *         client,
 *         contactId,
 *         'participant-token-456'
 *       );
 *
 *       // 4. Initialize WebRTC client with connection details
 *       initializeWebRTC(webRTCConnection);
 *
 *     } catch (error) {
 *       console.error('Failed to start call:', error);
 *     }
 *   };
 *
 *   const handleEndCall = async () => {
 *     try {
 *       await SoftphoneUtils.hangUpCall(client, contactId, connectionToken);
 *       await SoftphoneUtils.updateAgentStatus(client, 'agent-123', 'AfterCallWork');
 *     } catch (error) {
 *       console.error('Failed to end call:', error);
 *     }
 *   };
 *
 *   // Handle inbound calls
 *   const handleAcceptInboundCall = async (contact: any) => {
 *     try {
 *       // Accept the inbound call
 *       const result = await SoftphoneUtils.acceptInboundCall(
 *         client,
 *         contact.contactId,
 *         'agent-123',
 *         contact.clinicId
 *       );
 *
 *       // Create WebRTC connection for the accepted call
 *       const { connectionToken, webRTCConnection } = await SoftphoneUtils.createWebRTCConnection(
 *         client,
 *         contact.contactId,
 *         'participant-agent-123'
 *       );
 *
 *       // Initialize WebRTC for the call
 *       initializeWebRTC(webRTCConnection);
 *
 *     } catch (error) {
 *       console.error('Failed to accept inbound call:', error);
 *     }
 *   };
 *
 *   const handleRejectInboundCall = async (contact: any) => {
 *     try {
 *       await SoftphoneUtils.rejectInboundCall(
 *         client,
 *         contact.contactId,
 *         'agent-123',
 *         contact.clinicId
 *       );
 *     } catch (error) {
 *       console.error('Failed to reject inbound call:', error);
 *     }
 *   };
 *
 *   // Poll for inbound calls
 *   useEffect(() => {
 *     const stopPolling = SoftphoneUtils.pollForInboundCalls(
 *       client,
 *       'agent-123',
 *       (contact) => {
 *         console.log('Incoming call:', contact);
 *         // Show notification or update UI state
 *       }
 *     );
 *
 *     return stopPolling;
 *   }, []);
 *
 *   return (
 *     // Your softphone UI with inbound call handling
 *   );
 * };
 * ```
 */
