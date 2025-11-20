import { 
  ChimeSDKMeetingsClient, 
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteMeetingCommand,
  DeleteAttendeeCommand
} from '@aws-sdk/client-chime-sdk-meetings';
import { 
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand,
  UpdateSipMediaApplicationCallCommand 
} from '@aws-sdk/client-chime-sdk-voice';
import { getChimeRateLimiters } from './rate-limiter';

export class ChimeSDKWrapper {
  private rateLimiters = getChimeRateLimiters();

  constructor(
    private meetingsClient: ChimeSDKMeetingsClient,
    private voiceClient: ChimeSDKVoiceClient
  ) {}

  async createMeeting(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.meetings.waitForToken(1, maxWaitMs);
    if (!acquired) {
      throw new Error('Rate limit exceeded for CreateMeeting');
    }

    try {
      return await this.meetingsClient.send(new CreateMeetingCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on CreateMeeting despite rate limiting');
        // CRITICAL FIX: Refund the token correctly (add 1 token back, not negative)
        this.rateLimiters.meetings['tokens'] = Math.min(
          this.rateLimiters.meetings['config'].maxTokens,
          this.rateLimiters.meetings['tokens'] + 1
        );
      }
      throw err;
    }
  }

  async createAttendee(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.attendees.waitForToken(1, maxWaitMs);
    if (!acquired) {
      throw new Error('Rate limit exceeded for CreateAttendee');
    }

    try {
      return await this.meetingsClient.send(new CreateAttendeeCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on CreateAttendee despite rate limiting');
        // CRITICAL FIX: Refund the token correctly
        this.rateLimiters.attendees['tokens'] = Math.min(
          this.rateLimiters.attendees['config'].maxTokens,
          this.rateLimiters.attendees['tokens'] + 1
        );
      }
      throw err;
    }
  }

  async deleteMeeting(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.meetings.waitForToken(1, maxWaitMs);
    if (!acquired) {
      console.warn('[ChimeSDKWrapper] Rate limit preventing DeleteMeeting - will retry later');
      return; // Non-critical, can be cleaned up later
    }

    try {
      return await this.meetingsClient.send(new DeleteMeetingCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on DeleteMeeting');
      }
      throw err;
    }
  }

  async deleteAttendee(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.attendees.waitForToken(1, maxWaitMs);
    if (!acquired) {
      console.warn('[ChimeSDKWrapper] Rate limit preventing DeleteAttendee - will retry later');
      return;
    }

    try {
      return await this.meetingsClient.send(new DeleteAttendeeCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on DeleteAttendee');
      }
      throw err;
    }
  }

  async createSipMediaApplicationCall(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.smaCalls.waitForToken(1, maxWaitMs);
    if (!acquired) {
      throw new Error('Rate limit exceeded for CreateSipMediaApplicationCall');
    }

    try {
      return await this.voiceClient.send(new CreateSipMediaApplicationCallCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on CreateSipMediaApplicationCall');
        // CRITICAL FIX: Refund the token correctly
        this.rateLimiters.smaCalls['tokens'] = Math.min(
          this.rateLimiters.smaCalls['config'].maxTokens,
          this.rateLimiters.smaCalls['tokens'] + 1
        );
      }
      throw err;
    }
  }

  async updateSipMediaApplicationCall(params: any, maxWaitMs: number = 5000) {
    const acquired = await this.rateLimiters.smaUpdates.waitForToken(1, maxWaitMs);
    if (!acquired) {
      throw new Error('Rate limit exceeded for UpdateSipMediaApplicationCall');
    }

    try {
      return await this.voiceClient.send(new UpdateSipMediaApplicationCallCommand(params));
    } catch (err: any) {
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        console.warn('[ChimeSDKWrapper] Throttled on UpdateSipMediaApplicationCall');
        // CRITICAL FIX: Refund the token correctly
        this.rateLimiters.smaUpdates['tokens'] = Math.min(
          this.rateLimiters.smaUpdates['config'].maxTokens,
          this.rateLimiters.smaUpdates['tokens'] + 1
        );
      }
      throw err;
    }
  }

  getMetrics() {
    return this.rateLimiters.getMetrics();
  }
}

// CRITICAL FIX: Store instances per region to support multi-region usage
const wrapperInstances: Map<string, ChimeSDKWrapper> = new Map();

export function getChimeSDKWrapper(region: string = 'us-east-1'): ChimeSDKWrapper {
  if (!wrapperInstances.has(region)) {
    const meetingsClient = new ChimeSDKMeetingsClient({ region });
    const voiceClient = new ChimeSDKVoiceClient({ region });
    wrapperInstances.set(region, new ChimeSDKWrapper(meetingsClient, voiceClient));
  }
  return wrapperInstances.get(region)!;
}
