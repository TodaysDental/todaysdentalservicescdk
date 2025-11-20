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
        // Add token back for retry
        await this.rateLimiters.meetings.acquire(-1);
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
        await this.rateLimiters.attendees.acquire(-1);
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
        await this.rateLimiters.smaCalls.acquire(-1);
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
        await this.rateLimiters.smaUpdates.acquire(-1);
      }
      throw err;
    }
  }

  getMetrics() {
    return this.rateLimiters.getMetrics();
  }
}

// Singleton instance
let wrapperInstance: ChimeSDKWrapper | null = null;

export function getChimeSDKWrapper(region: string = 'us-east-1'): ChimeSDKWrapper {
  if (!wrapperInstance) {
    const meetingsClient = new ChimeSDKMeetingsClient({ region });
    const voiceClient = new ChimeSDKVoiceClient({ region });
    wrapperInstance = new ChimeSDKWrapper(meetingsClient, voiceClient);
  }
  return wrapperInstance;
}
