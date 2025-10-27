/**
 * WebRTC Integration Example for Connect Participant Service
 *
 * This example demonstrates how to integrate WebRTC with Amazon Connect
 * using the Participant Service API for building a voice softphone.
 *
 * Note: This is designed for frontend/browser environments where WebRTC APIs are available.
 * For Node.js environments, this would require additional WebRTC polyfills.
 */

import { ConnectParticipantClient, SoftphoneUtils, WebRTCConnection } from './participantClient';

// Browser-specific type declarations
declare global {
  interface Navigator {
    mediaDevices: MediaDevices;
  }

  interface MediaDevices {
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  }

  interface RTCPeerConnection {
    new (configuration?: RTCConfiguration): RTCPeerConnection;
    addTrack(track: MediaStreamTrack, stream: MediaStream): any;
    createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
    createAnswer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
    setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
    setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
    close(): void;
    ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => any) | null;
    onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => any) | null;
    onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null;
    connectionState: RTCPeerConnectionState;
  }

  const RTCPeerConnection: {
    prototype: RTCPeerConnection;
    new (configuration?: RTCConfiguration): RTCPeerConnection;
  };

  interface MediaStream {
    getTracks(): MediaStreamTrack[];
    getAudioTracks(): MediaStreamTrack[];
  }

  interface MediaStreamTrack {
    enabled: boolean;
    stop(): void;
  }

  interface DOMWebSocket {
    new (url: string, protocols?: string | string[]): DOMWebSocket;
    send(data: string): void;
    close(): void;
    onopen: ((this: DOMWebSocket, ev: Event) => any) | null;
    onmessage: ((this: DOMWebSocket, ev: MessageEvent) => any) | null;
    onerror: ((this: DOMWebSocket, ev: Event) => any) | null;
  }

  const DOMWebSocket: {
    prototype: DOMWebSocket;
    new (url: string, protocols?: string | string[]): DOMWebSocket;
  };

  interface RTCConfiguration {
    iceServers?: RTCIceServer[];
  }

  interface RTCIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
  }

  type RTCPeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

  interface RTCTrackEvent extends Event {
    streams: MediaStream[];
  }

  interface RTCPeerConnectionIceEvent extends Event {
    candidate: RTCIceCandidate | null;
  }

  interface RTCIceCandidate {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
  }

  interface RTCIceCandidateInit {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  }

  interface RTCSessionDescriptionInit {
    type: RTCSdpType;
    sdp?: string;
  }

  type RTCSdpType = 'offer' | 'answer';

  interface RTCOfferOptions {
    offerToReceiveAudio?: boolean;
    offerToReceiveVideo?: boolean;
  }

  interface MediaStreamConstraints {
    audio?: boolean | MediaTrackConstraints;
    video?: boolean | MediaTrackConstraints;
  }

  interface MediaTrackConstraints {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  }
}

export interface WebRTCCall {
  contactId: string;
  connectionToken: string;
  peerConnection: RTCPeerConnection;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  signalingSocket: DOMWebSocket | null;
  state: 'idle' | 'connecting' | 'connected' | 'ended';
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  signalingUrl: string;
  joinToken: string;
}

export class ConnectWebRTCClient {
  private client: ConnectParticipantClient;
  private currentCall: WebRTCCall | null = null;
  private onCallStateChange?: (state: WebRTCCall['state']) => void;
  private onRemoteStream?: (stream: MediaStream) => void;

  constructor(client: ConnectParticipantClient) {
    this.client = client;
  }

  /**
   * Set up event handlers
   */
  setEventHandlers(
    onCallStateChange?: (state: WebRTCCall['state']) => void,
    onRemoteStream?: (stream: MediaStream) => void
  ) {
    this.onCallStateChange = onCallStateChange;
    this.onRemoteStream = onRemoteStream;
  }

  /**
   * Start an outbound call with WebRTC
   */
  async startOutboundCall(
    clinicId: string,
    destinationNumber: string,
    participantId: string,
    agentStatus: 'Available' | 'Offline' | 'AfterCallWork' = 'Available'
  ): Promise<string> {
    try {
      // 1. Set agent status to available
      await SoftphoneUtils.updateAgentStatus(this.client, participantId, agentStatus);

      // 2. Start outbound call
      const contactId = await SoftphoneUtils.startOutboundCall(this.client, clinicId, destinationNumber);

      // 3. Wait for call to be connected (this would typically be handled via Connect events)
      // For now, we'll simulate waiting for the call to connect
      await this.waitForCallConnection(contactId);

      // 4. Create WebRTC connection
      await this.createWebRTCConnection(contactId, `participant-${participantId}`);

      return contactId;
    } catch (error) {
      console.error('Failed to start outbound call:', error);
      throw error;
    }
  }

  /**
   * Handle an incoming call
   */
  async handleInboundCall(
    contactId: string,
    participantId: string,
    clinicId?: string
  ): Promise<void> {
    try {
      this.updateCallState('connecting');

      // Accept the inbound call
      const result = await SoftphoneUtils.acceptInboundCall(this.client, contactId, participantId, clinicId);

      // Create WebRTC connection for the accepted call
      await this.createWebRTCConnection(contactId, `participant-${participantId}`);

      console.log(`Inbound call ${contactId} accepted by ${participantId}`);
    } catch (error) {
      console.error('Failed to handle inbound call:', error);
      this.updateCallState('ended');
      throw error;
    }
  }

  /**
   * Reject an incoming call
   */
  async rejectInboundCall(
    contactId: string,
    participantId: string,
    clinicId?: string
  ): Promise<void> {
    try {
      await SoftphoneUtils.rejectInboundCall(this.client, contactId, participantId, clinicId);
      console.log(`Inbound call ${contactId} rejected by ${participantId}`);
    } catch (error) {
      console.error('Failed to reject inbound call:', error);
      throw error;
    }
  }

  /**
   * Set up inbound call polling
   */
  startInboundCallPolling(
    participantId: string,
    onIncomingCall: (contact: any) => void
  ): Promise<() => void> {
    return SoftphoneUtils.pollForInboundCalls(this.client, participantId, onIncomingCall);
  }


  /**
   * Create WebRTC connection for an active call
   */
  private async createWebRTCConnection(contactId: string, participantToken: string): Promise<void> {
    try {
      this.updateCallState('connecting');

      // Get WebRTC connection details from Participant Service
      const { connectionToken, webRTCConnection } = await SoftphoneUtils.createWebRTCConnection(
        this.client,
        contactId,
        participantToken
      );

      // Initialize WebRTC with the provided connection details
      await this.initializeWebRTC({
        iceServers: webRTCConnection.IceServers.map(server => ({
          urls: server.Urls,
          username: server.Username,
          credential: server.Password,
        })),
        signalingUrl: webRTCConnection.SignalingUrl,
        joinToken: webRTCConnection.JoinToken,
      });

      this.currentCall = {
        contactId,
        connectionToken,
        peerConnection: this.currentCall?.peerConnection || new RTCPeerConnection({
          iceServers: webRTCConnection.IceServers.map(server => ({
            urls: server.Urls,
            username: server.Username,
            credential: server.Password,
          })),
        }),
        localStream: null,
        remoteStream: null,
        signalingSocket: null,
        state: 'connecting',
      };

      this.updateCallState('connected');
    } catch (error) {
      console.error('Failed to create WebRTC connection:', error);
      this.updateCallState('ended');
      throw error;
    }
  }

  /**
   * Initialize WebRTC peer connection and signaling
   */
  private async initializeWebRTC(config: WebRTCConfig): Promise<void> {
    try {
      // Create peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers: config.iceServers,
      });

      // Get local media stream (browser-only API)
      const localStream = await (globalThis as any).navigator?.mediaDevices?.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // Add local stream to peer connection
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        peerConnection.addTrack(track, localStream);
      });

      this.currentCall = {
        contactId: this.currentCall?.contactId || '',
        connectionToken: this.currentCall?.connectionToken || '',
        peerConnection,
        localStream,
        remoteStream: null,
        signalingSocket: null,
        state: 'connecting',
      };

      // Handle remote stream
      peerConnection.ontrack = (event: RTCTrackEvent) => {
        const remoteStream = event.streams[0];
        this.currentCall!.remoteStream = remoteStream;
        this.onRemoteStream?.(remoteStream);
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          this.updateCallState('connected');
        } else if (peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'failed' ||
                   peerConnection.connectionState === 'closed') {
          this.updateCallState('ended');
        }
      };

      // Connect to signaling server
      const signalingSocket = new DOMWebSocket(config.signalingUrl);
      signalingSocket.onopen = () => {
        console.log('Signaling connection established');
        signalingSocket.send(JSON.stringify({
          type: 'join',
          joinToken: config.joinToken,
        }));
      };

      signalingSocket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleSignalingMessage(message, peerConnection);
        } catch (error) {
          console.error('Error handling signaling message:', error);
        }
      };

      signalingSocket.onerror = (error) => {
        console.error('Signaling socket error:', error);
        this.updateCallState('ended');
      };

      this.currentCall.signalingSocket = signalingSocket;

      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Send offer through signaling
      signalingSocket.send(JSON.stringify({
        type: 'offer',
        sdp: offer.sdp,
      }));

    } catch (error) {
      console.error('Failed to initialize WebRTC:', error);
      this.updateCallState('ended');
      throw error;
    }
  }

  /**
   * Handle WebRTC signaling messages
   */
  private async handleSignalingMessage(
    message: any,
    peerConnection: RTCPeerConnection
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'offer':
          await peerConnection.setRemoteDescription({
            type: 'offer',
            sdp: message.sdp,
          });

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          // Send answer through signaling
          this.currentCall?.signalingSocket?.send(JSON.stringify({
            type: 'answer',
            sdp: answer.sdp,
          }));
          break;

        case 'answer':
          await peerConnection.setRemoteDescription({
            type: 'answer',
            sdp: message.sdp,
          });
          break;

        case 'ice-candidate':
          if (message.candidate) {
            await peerConnection.addIceCandidate({
              candidate: message.candidate,
              sdpMid: message.sdpMid,
              sdpMLineIndex: message.sdpMLineIndex,
            });
          }
          break;

        case 'call-connected':
          console.log('Call connected successfully');
          this.updateCallState('connected');
          break;

        case 'call-ended':
          console.log('Call ended');
          this.updateCallState('ended');
          break;

        default:
          console.log('Unknown signaling message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling signaling message:', error);
    }
  }

  /**
   * Send ICE candidates through signaling
   */
  private setupICECandidates(peerConnection: RTCPeerConnection): void {
    peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && this.currentCall?.signalingSocket) {
        this.currentCall.signalingSocket.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }));
      }
    };
  }

  /**
   * Wait for call to be connected (simplified implementation)
   */
  private async waitForCallConnection(contactId: string): Promise<void> {
    // In a real implementation, you would listen to Connect events via EventBridge or Kinesis
    // For this example, we'll simulate waiting
    return new Promise((resolve) => {
      setTimeout(resolve, 2000); // Simulate 2 second wait
    });
  }

  /**
   * End the current call
   */
  async endCall(): Promise<void> {
    try {
      if (this.currentCall) {
        // Close WebRTC connection
        if (this.currentCall.peerConnection) {
          this.currentCall.peerConnection.close();
        }

        // Close signaling connection
        if (this.currentCall.signalingSocket) {
          this.currentCall.signalingSocket.close();
        }

        // Stop local media tracks
        if (this.currentCall.localStream) {
          this.currentCall.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        }

        // Disconnect via Participant Service
        if (this.currentCall.connectionToken) {
          await SoftphoneUtils.hangUpCall(
            this.client,
            this.currentCall.contactId,
            this.currentCall.connectionToken
          );
        }

        this.currentCall = null;
        this.updateCallState('ended');
      }
    } catch (error) {
      console.error('Failed to end call:', error);
      throw error;
    }
  }

  /**
   * Mute/unmute microphone
   */
  async toggleMute(): Promise<void> {
    if (this.currentCall?.localStream) {
      const audioTracks = this.currentCall.localStream.getAudioTracks();
      audioTracks.forEach((track: MediaStreamTrack) => {
        track.enabled = !track.enabled;
      });
    }
  }

  /**
   * Hold/unhold call
   */
  async toggleHold(): Promise<void> {
    if (this.currentCall?.connectionToken) {
      await SoftphoneUtils.updateCallAttributes(this.client, this.currentCall.contactId, {
        callStatus: 'hold',
        holdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Update call state and notify listeners
   */
  private updateCallState(state: WebRTCCall['state']): void {
    if (this.currentCall) {
      this.currentCall.state = state;
    }
    this.onCallStateChange?.(state);
  }

  /**
   * Get current call state
   */
  getCallState(): WebRTCCall['state'] {
    return this.currentCall?.state || 'idle';
  }

  /**
   * Get current call info
   */
  getCallInfo() {
    return this.currentCall;
  }
}

/**
 * React hook for Connect WebRTC integration
 */
export function useConnectWebRTC(client: ConnectParticipantClient) {
  const [callState, setCallState] = useState<WebRTCCall['state']>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const webRTCClientRef = useRef<ConnectWebRTCClient | null>(null);

  useEffect(() => {
    if (!webRTCClientRef.current) {
      webRTCClientRef.current = new ConnectWebRTCClient(client);

      // Set up event handlers
      webRTCClientRef.current.setEventHandlers(
        (state: WebRTCCall['state']) => setCallState(state),
        (stream: MediaStream) => setRemoteStream(stream)
      );
    }

    return () => {
      // Cleanup on unmount
      webRTCClientRef.current?.endCall();
    };
  }, [client]);

  return {
    callState,
    remoteStream,
    startCall: (clinicId: string, phoneNumber: string, participantId: string) =>
      webRTCClientRef.current?.startOutboundCall(clinicId, phoneNumber, participantId),
    handleInboundCall: (contactId: string, participantId: string, clinicId?: string) =>
      webRTCClientRef.current?.handleInboundCall(contactId, participantId, clinicId),
    rejectInboundCall: (contactId: string, participantId: string, clinicId?: string) =>
      webRTCClientRef.current?.rejectInboundCall(contactId, participantId, clinicId),
    startInboundCallPolling: async (participantId: string, onIncomingCall: (contact: any) => void) =>
      await webRTCClientRef.current?.startInboundCallPolling(participantId, onIncomingCall),
    endCall: () => webRTCClientRef.current?.endCall(),
    toggleMute: () => webRTCClientRef.current?.toggleMute(),
    toggleHold: () => webRTCClientRef.current?.toggleHold(),
    callInfo: webRTCClientRef.current?.getCallInfo() || null,
  };
}

// React integration - this is designed for frontend use
// For backend compilation, this section would be in a separate frontend package
interface ReactHooks {
  useState: any;
  useEffect: any;
  useRef: any;
}

// React hooks would be imported in frontend environment like this:
// import { useState, useEffect, useRef } from 'react';

// For backend compilation, these are stubbed with proper typing
const useState = <T>(initialValue: T): [T, (value: T) => void] => [initialValue, () => {}];
const useEffect = (callback: () => void, deps?: any[]): void => {};
const useRef = <T>(initialValue: T): { current: T } => ({ current: initialValue });

/**
 * Example React component integration:
 *
 * ```typescript
 * import { useConnectWebRTC } from './WebRTCIntegrationExample';
 * import { ConnectParticipantClient } from './participantClient';
 *
 * const SoftphoneComponent = () => {
 *   const client = new ConnectParticipantClient({
 *     baseUrl: 'https://api.todaysdentalinsights.com',
 *     getAuthToken: async () => getCognitoToken(),
 *   });
 *
 *   const {
 *     callState,
 *     remoteStream,
 *     startCall,
 *     handleInboundCall,
 *     rejectInboundCall,
 *     startInboundCallPolling,
 *     endCall,
 *     toggleMute,
 *   } = useConnectWebRTC(client);
 *
 *   const [incomingCalls, setIncomingCalls] = useState<any[]>([]);
 *
 *   // Set up inbound call polling
 *   useEffect(() => {
 *     const setupPolling = async () => {
 *       const stopPolling = await startInboundCallPolling('agent-123', (contact) => {
 *         setIncomingCalls(prev => [...prev, contact]);
 *         showIncomingCallNotification(contact);
 *       });
 *
 *       return stopPolling;
 *     };
 *
 *     let cleanup: (() => void) | undefined;
 *
 *     setupPolling().then((stop) => {
 *       cleanup = stop;
 *     });
 *
 *     return () => {
 *       if (cleanup) cleanup();
 *     };
 *   }, []);
 *
 *   const handleStartCall = async () => {
 *     try {
 *       await startCall('dentistinnewbritain', '+15551234567', 'agent-123');
 *     } catch (error) {
 *       console.error('Failed to start call:', error);
 *     }
 *   };
 *
 *   const handleAcceptCall = async (contact: any) => {
 *     try {
 *       await handleInboundCall(contact.contactId, 'agent-123', contact.clinicId);
 *       setIncomingCalls(prev => prev.filter(c => c.contactId !== contact.contactId));
 *     } catch (error) {
 *       console.error('Failed to accept call:', error);
 *     }
 *   };
 *
 *   const handleRejectCall = async (contact: any) => {
 *     try {
 *       await rejectInboundCall(contact.contactId, 'agent-123', contact.clinicId);
 *       setIncomingCalls(prev => prev.filter(c => c.contactId !== contact.contactId));
 *     } catch (error) {
 *       console.error('Failed to reject call:', error);
 *     }
 *   };
 *
 *   return (
 *     <div className="softphone">
 *       <div>Call State: {callState}</div>
 *       <button onClick={handleStartCall} disabled={callState !== 'idle'}>
 *         Start Call
 *       </button>
 *       <button onClick={endCall} disabled={callState === 'idle'}>
 *         End Call
 *       </button>
 *       <button onClick={toggleMute} disabled={callState !== 'connected'}>
 *         Mute
 *       </button>
 *       {remoteStream && (
 *         <audio
 *           ref={(audio) => {
 *             if (audio && remoteStream) {
 *               audio.srcObject = remoteStream;
 *             }
 *           }}
 *           autoPlay
 *         />
 *       )}
 *     </div>
 *   );
 * };
 * ```
 */
