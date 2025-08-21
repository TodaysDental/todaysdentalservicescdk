// Enhanced SIP Media Application (SMA) Lambda handler
// Handles inbound calls with routing, queue management, hours checking, and IVR logic

import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
// eslint-disable-next-line @typescript-eslint/no-var-requires
declare const require: any;
const { ChimeSDKMeetingsClient, CreateAttendeeCommand } = require('@aws-sdk/client-chime-sdk-meetings');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const meetings = new (ChimeSDKMeetingsClient as any)({});

// Node globals shim for linter
declare const process: any;
const QUEUE_TABLE = process.env.VOICE_QUEUE_TABLE as string;
const AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE as string;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE as string;

type SmaAction = Record<string, any>;

export async function handler(event: any, _context: Context) {
	console.log('SMA Event:', JSON.stringify(event));

	const invType = event?.InvocationEventType;
	const callId = event?.CallDetails?.Participants?.[0]?.CallId;
	const callArguments = event?.CallDetails?.TransactionAttributes || {};

	if (invType === 'NEW_INBOUND_CALL') {
		return await handleInboundCall(event, callId);
	}

	if (invType === 'NEW_OUTBOUND_CALL') {
		return await handleOutboundCall(event, callId, callArguments);
	}

	if (invType === 'HANGUP') {
		return await handleHangup(event, callId);
	}

	if (invType === 'CALL_ANSWERED') {
		console.log('Call answered:', callId);
		return { schemaVersion: '1.0', actions: [] };
	}

	return { schemaVersion: '1.0', actions: [] };
}

async function handleInboundCall(event: any, callId: string) {
	try {
		const toNumber: string = String(event?.CallDetails?.TransactionAttributes?.toNumber || event?.CallDetails?.Participants?.find((p: any) => p.To)?.To?.PhoneNumber || '').replace(/[^0-9+]/g, '');
		const e164 = toNumber.startsWith('+') ? toNumber : (toNumber.length === 10 ? '+1' + toNumber : toNumber);
		
		console.log(`Inbound call to ${e164}, callId: ${callId}`);
		
		// Map number -> clinic
		const clinic = await ddb.send(new GetCommand({ TableName: QUEUE_TABLE, Key: { phoneNumber: e164 } }));
		const clinicId = clinic?.Item?.clinicId as string | undefined;
		
		if (!clinicId) {
			console.warn(`No clinic mapping found for ${e164}`);
			return speakAndHang('We could not route your call at this time. Please call back later. Goodbye.');
		}
		
		console.log(`Call routed to clinic: ${clinicId}`);
		
		// Check clinic hours
		const isOpen = await checkClinicHours(clinicId);
		if (!isOpen) {
			return playAfterHoursMessage(clinicId);
		}
		
		// Track call start event
		await trackCallEvent({
			callId,
			clinicId,
			callType: 'INBOUND',
			phoneNumber: e164,
			eventType: 'CALL_START',
			timestamp: Date.now()
		});
		
		// Direct ring to available agent
		return await routeToAgent(clinicId, callId);
		
	} catch (error) {
		console.error('Error handling inbound call:', error);
		return speakAndHang('We are experiencing technical difficulties. Please call back later. Goodbye.');
	}
}

async function handleOutboundCall(event: any, callId: string, callArguments: any) {
	try {
		const meetingId = callArguments?.meetingId;
		const agentId = callArguments?.agentId;
		const clinicId = callArguments?.clinicId;

		if (!meetingId || !agentId) {
			console.error('Missing meeting or agent info for outbound call');
			return speakAndHang('We could not complete your call at this time.');
		}

		console.log(`Outbound call ${callId} - connecting to meeting ${meetingId} for agent ${agentId}`);

		// Create PSTN attendee to join agent meeting
		const attendee = await meetings.send(new (CreateAttendeeCommand as any)({ 
			MeetingId: meetingId, 
			ExternalUserId: `pstn-outbound-${callId}` 
		}));

		const joinToken = attendee?.Attendee?.JoinToken;
		if (!joinToken) {
			console.error('Failed to create attendee for outbound call');
			// Reset agent state on failure
			if (agentId) {
				await ddb.send(new UpdateCommand({
					TableName: AGENTS_TABLE,
					Key: { agentId },
					UpdateExpression: 'SET #s = :a, updatedAt = :t REMOVE activeCallId',
					ExpressionAttributeNames: { '#s': 'state' },
					ExpressionAttributeValues: { ':a': 'AVAILABLE', ':t': Date.now() },
				}));
			}
			return speakAndHang('We could not complete your call at this time.');
		}

		// Track outbound call start
		await trackCallEvent({
			callId,
			clinicId,
			agentId,
			callType: 'OUTBOUND',
			eventType: 'CALL_START',
			timestamp: Date.now(),
			meetingId
		});

		// Direct connection for outbound call
		const actions: SmaAction[] = [
			{
				Type: 'JoinChimeMeeting',
				Parameters: {
					JoinToken: joinToken,
					MeetingId: meetingId,
					CallId: callId
				}
			}
		];

		return { schemaVersion: '1.0', actions, transactionAttributes: { agentId, clinicId, callType: 'OUTBOUND' } };

	} catch (error) {
		console.error('Error handling outbound call:', error);
		return speakAndHang('We could not complete your call at this time.');
	}
}

async function handleHangup(event: any, callId: string) {
	try {
		console.log(`Call hangup: ${callId}`);
		
		// Get call details for tracking
		const transactionAttributes = event?.CallDetails?.TransactionAttributes || {};
		const agentId = transactionAttributes?.agentId;
		const clinicId = transactionAttributes?.clinicId;
		const callType = transactionAttributes?.callType || 'INBOUND';
		
		// Mark agent as available again if assigned
		if (agentId) {
			await ddb.send(new UpdateCommand({
				TableName: AGENTS_TABLE,
				Key: { agentId },
				UpdateExpression: 'SET #s = :a, updatedAt = :t REMOVE activeCallId',
				ExpressionAttributeNames: { '#s': 'state' },
				ExpressionAttributeValues: { ':a': 'AVAILABLE', ':t': Date.now() },
			}));
			console.log(`Agent ${agentId} marked as available`);
		}
		
		// Track call end event
		if (clinicId) {
			await trackCallEvent({
				callId,
				clinicId,
				agentId,
				callType,
				eventType: 'CALL_END',
				timestamp: Date.now()
			});
		}
		
		return { schemaVersion: '1.0', actions: [] };
	} catch (error) {
		console.error('Error handling hangup:', error);
		return { schemaVersion: '1.0', actions: [] };
	}
}

async function checkClinicHours(clinicId: string): Promise<boolean> {
	try {
		const now = new Date();
		const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
		const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight
		
		const hoursData = await ddb.send(new GetCommand({
			TableName: CLINIC_HOURS_TABLE,
			Key: { clinicId }
		}));
		
		if (!hoursData?.Item) {
			console.log(`No hours data found for clinic ${clinicId}, assuming open`);
			return true; // Default to open if no hours configured
		}
		
		const todayHours = hoursData.Item[`day${dayOfWeek}`]; // day0, day1, etc.
		if (!todayHours || !todayHours.isOpen) {
			console.log(`Clinic ${clinicId} is closed today`);
			return false;
		}
		
		const openTime = parseTimeString(todayHours.openTime);
		const closeTime = parseTimeString(todayHours.closeTime);
		
		const isOpen = currentTime >= openTime && currentTime <= closeTime;
		console.log(`Clinic ${clinicId} hours check: ${isOpen} (current: ${currentTime}, open: ${openTime}-${closeTime})`);
		
		return isOpen;
	} catch (error) {
		console.error('Error checking clinic hours:', error);
		return true; // Default to open on error
	}
}

async function routeToAgent(clinicId: string, callId: string) {
	try {
		// Find available agent
		const found = await ddb.send(new QueryCommand({
			TableName: AGENTS_TABLE,
			IndexName: 'ClinicStateIndex',
			KeyConditionExpression: 'clinicId = :c AND #s = :a',
			ExpressionAttributeValues: { ':c': clinicId, ':a': 'AVAILABLE' },
			ExpressionAttributeNames: { '#s': 'state' },
			Limit: 1,
		}));
		
		const agent = found.Items && found.Items[0];
		if (!agent || !agent.meetingId) {
			console.log(`No available agents for clinic ${clinicId}`);
			return playNoAgentsMessage(clinicId);
		}
		
		console.log(`Direct routing call ${callId} to agent ${agent.agentId}`);
		
		// Mark agent BUSY
		await ddb.send(new UpdateCommand({
			TableName: AGENTS_TABLE,
			Key: { agentId: agent.agentId },
			UpdateExpression: 'SET #s = :b, updatedAt = :t, activeCallId = :c',
			ExpressionAttributeNames: { '#s': 'state' },
			ExpressionAttributeValues: { ':b': 'BUSY', ':t': Date.now(), ':c': callId },
		}));
		
		// Create PSTN attendee to join agent meeting
		const attendee = await meetings.send(new (CreateAttendeeCommand as any)({ 
			MeetingId: agent.meetingId, 
			ExternalUserId: `pstn-${callId}` 
		}));
		
		const joinToken = attendee?.Attendee?.JoinToken;
		if (!joinToken) {
			console.error('Failed to create attendee for agent meeting');
			// Reset agent state on failure
			await ddb.send(new UpdateCommand({
				TableName: AGENTS_TABLE,
				Key: { agentId: agent.agentId },
				UpdateExpression: 'SET #s = :a, updatedAt = :t REMOVE activeCallId',
				ExpressionAttributeNames: { '#s': 'state' },
				ExpressionAttributeValues: { ':a': 'AVAILABLE', ':t': Date.now() },
			}));
			return speakAndHang('We could not connect your call at this time. Please call back later.');
		}
		
		// Track call answer event
		await trackCallEvent({
			callId,
			clinicId,
			agentId: agent.agentId,
			agentName: agent.agentName,
			callType: 'INBOUND',
			eventType: 'CALL_ANSWER',
			timestamp: Date.now(),
			meetingId: agent.meetingId
		});

		// Direct connection without hold message
		const actions: SmaAction[] = [
			{
				Type: 'JoinChimeMeeting',
				Parameters: {
					JoinToken: joinToken,
					MeetingId: agent.meetingId,
					CallId: callId
				}
			}
		];
		
		return { schemaVersion: '1.0', actions, transactionAttributes: { agentId: agent.agentId, clinicId } };
		
	} catch (error) {
		console.error('Error routing to agent:', error);
		return speakAndHang('We are experiencing technical difficulties. Please call back later. Goodbye.');
	}
}

function playAfterHoursMessage(clinicId: string) {
	return speakAndHang('Thank you for calling. Our office is currently closed. Please call back during our business hours or visit our website to schedule an appointment online. Goodbye.');
}

function playNoAgentsMessage(clinicId: string) {
	return speakAndHang('Thank you for calling. All our staff are currently assisting other patients. Please call back in a few minutes or visit our website to schedule an appointment online. Thank you. Goodbye.');
}

function parseTimeString(timeStr: string): number {
	// Parse time string like "09:00" to minutes since midnight
	const [hours, minutes] = timeStr.split(':').map(Number);
	return hours * 60 + minutes;
}

function speakAndHang(text: string) {
	const actions: SmaAction[] = [
		{ Type: 'Speak', Parameters: { Engine: 'neural', LanguageCode: 'en-US', Text: text, VoiceId: 'Joanna' } },
	];
	return { schemaVersion: '1.0', actions };
}

// Call tracking function to send events to the call center tracking API
async function trackCallEvent(callEvent: {
	callId: string;
	clinicId: string;
	agentId?: string;
	agentName?: string;
	callType: 'INBOUND' | 'OUTBOUND';
	phoneNumber?: string;
	eventType: 'CALL_START' | 'CALL_ANSWER' | 'CALL_END' | 'CALL_MISSED';
	timestamp: number;
	meetingId?: string;
	attendeeId?: string;
	duration?: number;
	waitTime?: number;
}): Promise<void> {
	try {
		// Call the call tracking API endpoint
		const response = await fetch('https://api.todaysdentalinsights.com/call-center/track', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(callEvent)
		});
		
		if (!response.ok) {
			console.warn(`Failed to track call event: ${response.status}`);
		} else {
			console.log(`Call event tracked: ${callEvent.eventType} for call ${callEvent.callId}`);
		}
	} catch (error) {
		console.error('Error tracking call event:', error);
		// Don't throw - call tracking failures shouldn't break the SMA flow
	}
}


