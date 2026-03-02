/**
 * Shared Types for Communications Stack
 *
 * Single source of truth for all interfaces and type aliases used across
 * ws-default, messaging-features-handlers, enhanced-messaging-handlers,
 * and rest-api-handler.
 */

// ── System modules ──────────────────────────────────────────────────────────
export const SYSTEM_MODULES = ['HR', 'Accounting', 'Operations', 'Finance', 'Marketing', 'Legal', 'IT'] as const;
export type SystemModule = typeof SYSTEM_MODULES[number];

// ── Task status / priority ──────────────────────────────────────────────────
export type TaskStatus = 'pending' | 'active' | 'in_progress' | 'completed' | 'rejected' | 'forwarded' | 'deleted';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

// ── Connection / sender ─────────────────────────────────────────────────────
export interface SenderInfo {
    connectionId: string;
    userID: string;
}

export type ConnectionRecord = SenderInfo & {
    deviceId?: string;
    client?: string;
};

// ── Team / group ────────────────────────────────────────────────────────────
export interface Team {
    teamID: string;
    ownerID: string;
    name: string;
    description?: string;
    members: string[];
    admins: string[];
    adminOnlyMessages?: boolean;
    groupImageUrl?: string;
    category?: SystemModule;
    createdAt: string;
    updatedAt: string;
}

// ── Forwarding ──────────────────────────────────────────────────────────────
export interface ForwardRecord {
    forwardID: string;
    fromUserID: string;
    toUserID: string;
    forwardedAt: string;
    message?: string;
    deadline?: string;
    requireAcceptance: boolean;
    status: 'pending' | 'accepted' | 'rejected';
    acceptedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
}

// ── Favor request (conversation) ────────────────────────────────────────────
export interface FavorRequest {
    favorRequestID: string;
    senderID: string;
    receiverID?: string;
    teamID?: string;

    title?: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    category?: SystemModule;
    tags?: string[];

    forwardingChain?: ForwardRecord[];
    currentAssigneeID?: string;
    requiresAcceptance?: boolean;

    completedAt?: string;
    completionNotes?: string;
    rejectionReason?: string;
    rejectedAt?: string;

    createdAt: string;
    updatedAt: string;
    userID: string;
    requestType: 'General' | 'Assign Task' | 'IT Ticket' | 'Ask a Favor' | 'Other';
    unreadCount: number;
    initialMessage: string;
    deadline?: string;
    isMainGroupChat?: boolean;

    lastMessage?: string;
    lastMessageAt?: string;
    lastMessageSenderID?: string;

    deletedBy?: string[];
    clearedAt?: Record<string, number>;

    isTask?: boolean;
    isForwarded?: boolean;
    participantKey?: string;
}

// ── File details ────────────────────────────────────────────────────────────
export interface FileDetails {
    fileName: string;
    fileType: string;
    fileSize: number;
}

// ── Message ─────────────────────────────────────────────────────────────────
export interface Mention {
    type: 'user' | 'channel' | 'everyone' | 'here';
    id?: string;
    displayName: string;
    startIndex: number;
    endIndex: number;
}

export interface Reaction {
    emoji: string;
    emojiCode: string;
    userIDs: string[];
    count: number;
    createdAt: string;
}

export interface MessageData {
    messageID?: string;
    favorRequestID: string;
    senderID: string;
    content: string;
    timestamp: number;
    type: 'text' | 'file' | 'system' | 'task' | 'poll' | 'voice' | 'gif' | 'sticker';
    fileKey?: string;
    fileDetails?: FileDetails;

    taskTitle?: string;
    taskDescription?: string;
    taskPriority?: string;
    taskDeadline?: string;
    taskCategory?: string;
    taskRequestType?: string;

    pollData?: {
        pollID: string;
        question: string;
        options: { optionID: string; text: string }[];
        isMultipleChoice: boolean;
        votes: { userID: string; optionID: string; votedAt: number }[];
        createdBy: string;
        createdAt: number;
        isClosed?: boolean;
    };

    parentMessageID?: string;
    mentions?: Mention[];
    reactions?: Reaction[];
    threadReplyCount?: number;
    threadParticipants?: string[];
    lastThreadReplyAt?: number;
    isEdited?: boolean;
    editedAt?: number;
    isDeleted?: boolean;
    deletedAt?: number;
    isPinned?: boolean;
    pinnedAt?: number;
    pinnedBy?: string;
}

// ── Meeting ─────────────────────────────────────────────────────────────────
export interface Meeting {
    meetingID: string;
    conversationID: string;
    title?: string;
    description: string;
    startTime: string;
    endTime?: string;
    location?: string;
    meetingLink?: string;
    organizerID: string;
    participants: string[];
    status: 'scheduled' | 'completed' | 'cancelled';
    reminder?: {
        enabled: boolean;
        minutesBefore: number;
    };
    createdAt: string;
    updatedAt: string;
}

// ── Pinned message ──────────────────────────────────────────────────────────
export interface PinnedMessage {
    pinID: string;
    messageID: string;
    favorRequestID: string;
    pinnedBy: string;
    pinnedAt: string;
    expiresAt?: string;
    messagePreview: string;
    messageType?: 'text' | 'file' | 'voice' | 'gif' | 'sticker' | 'meeting';
    senderID: string;
}

// ── Bookmark ────────────────────────────────────────────────────────────────
export interface Bookmark {
    bookmarkID: string;
    userID: string;
    type: 'message' | 'file' | 'task' | 'link';
    referenceID: string;
    favorRequestID?: string;
    title: string;
    preview?: string;
    note?: string;
    createdAt: string;
    tags?: string[];
}

// ── Presence ────────────────────────────────────────────────────────────────
export interface UserPresence {
    userID: string;
    status: 'online' | 'away' | 'dnd' | 'offline';
    lastSeen: string;
    customStatus?: {
        emoji: string;
        text: string;
        expiresAt?: string;
    };
}

// ── Scheduled message ───────────────────────────────────────────────────────
export interface ScheduledMessage {
    scheduledMessageID: string;
    favorRequestID: string;
    senderID: string;
    content: string;
    scheduledFor: string;
    type: 'text' | 'file';
    fileKey?: string;
    status: 'scheduled' | 'sent' | 'cancelled' | 'failed';
    createdAt: string;
    sentAt?: string;
}

// ── Channel ─────────────────────────────────────────────────────────────────
export interface Channel {
    channelID: string;
    name: string;
    description?: string;
    topic?: string;
    type: 'public' | 'private';
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    memberCount: number;
    members: string[];
    pinnedMessages?: string[];
    isArchived: boolean;
    archivedAt?: string;
    archivedBy?: string;
    lastActivityAt?: string;
}

// ── Calling ─────────────────────────────────────────────────────────────────
export type CallType = 'voice' | 'video';
export type CallStatus = 'initiating' | 'ringing' | 'connected' | 'ended' | 'missed' | 'declined' | 'busy';
export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Call {
    callID: string;
    favorRequestID: string;
    callerID: string;
    callerName: string;
    callType: CallType;
    participantIDs: string[];
    status: CallStatus;
    startedAt?: string;
    endedAt?: string;
    duration?: number;
    meetingToken?: string;
    meetingId?: string;
}

export interface ReadReceipt {
    userID: string;
    readAt: number;
}

export interface ConversationSettings {
    favorRequestID: string;
    userID: string;
    muted: boolean;
    muteUntil?: string;
    notifyOnMentionsOnly: boolean;
    customNotificationSound?: string;
    pinned: boolean;
    archived: boolean;
    notificationPreference: 'all' | 'mentions' | 'none';
    autoDeleteAfterDays?: number;
}

export interface VoiceMessage {
    duration: number;
    waveformData?: number[];
    playbackUrl?: string;
}

export interface GifMedia {
    id: string;
    title: string;
    url: string;
    previewUrl: string;
    width: number;
    height: number;
    source: 'giphy' | 'tenor';
}

export interface StickerPack {
    packID: string;
    name: string;
    description?: string;
    thumbnailUrl: string;
    stickerCount: number;
    category: 'emoji' | 'reactions' | 'animals' | 'food' | 'activities' | 'custom';
    isDefault: boolean;
    createdAt: string;
}

export interface Sticker {
    stickerID: string;
    packID: string;
    url: string;
    thumbnailUrl?: string;
    altText: string;
    keywords: string[];
    width: number;
    height: number;
}

export interface LinkPreview {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    fetchedAt: string;
}

// ── Handler context (passed to all domain handlers) ─────────────────────────
export interface HandlerContext {
    senderID: string;
    connectionId: string;
    apiGwManagement: import('@aws-sdk/client-apigatewaymanagementapi').ApiGatewayManagementApiClient;
}
