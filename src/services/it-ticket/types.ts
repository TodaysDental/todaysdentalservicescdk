// ============================================
// IT Ticket System — Types & Interfaces
// ============================================

// --- Enums ---

export enum TicketType {
    BUG = 'BUG',
    FEATURE = 'FEATURE',
}

export enum TicketStatus {
    OPEN = 'OPEN',
    IN_PROGRESS = 'IN_PROGRESS',
    RESOLVED = 'RESOLVED',
    CLOSED = 'CLOSED',
    REOPENED = 'REOPENED',
}

export enum TicketPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

// Known modules — must match ModuleAssignees seed data
export const KNOWN_MODULES = [
    'HR',
    'Finance',
    'Marketing',
    'Dental Software',
    'Chime',
    'Admin',
    'Patient Portal',
    'Email',
    'Credentialing',
    'Insurance',
    'Lease Management',
    'Other',
] as const;

export type ModuleName = (typeof KNOWN_MODULES)[number];

// --- Media File ---

export interface MediaFile {
    fileId: string;
    fileName: string;
    s3Key: string;
    contentType: string;
    fileSize: number;
    uploadedAt: string; // ISO timestamp
}

export const ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/pdf',
];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES_PER_TICKET = 5;

// --- Ticket ---

export interface Ticket {
    ticketId: string;
    ticketType: TicketType;
    title: string;
    description: string;
    module: string;
    status: TicketStatus;
    priority: TicketPriority;
    reporterId: string;
    reporterName: string;
    reporterEmail: string;
    assigneeId: string;
    assigneeName: string;
    assigneeEmail?: string;
    clinicId?: string;
    deadline?: string; // ISO date string (YYYY-MM-DD) — required for BUG, optional for FEATURE
    mediaFiles?: MediaFile[];
    resolution?: string;
    resolvedAt?: string;
    resolvedBy?: string;
    resolvedByName?: string;
    resolvedByEmail?: string;
    assignmentType?: 'single' | 'group'; // Whether task was assigned to individual or group
    groupDetails?: {
        groupId: string;
        groupName: string;
        members: string[]; // list of member names or IDs
    };
    createdAt: string;
    updatedAt: string;
}

// --- Ticket Comment ---

export interface TicketComment {
    ticketId: string;
    commentId: string;
    authorId: string;
    authorName: string;
    content: string;
    isInternal?: boolean;
    createdAt: string;
}

// --- Module Assignee ---

export interface ModuleAssignee {
    module: string;
    assigneeId: string;
    assigneeName: string;
    assigneeEmail: string;
    backupAssigneeId?: string;
    backupAssigneeName?: string;
    updatedAt: string;
}

// --- Request Bodies ---

export interface CreateTicketRequest {
    ticketType: TicketType;
    title: string;
    description: string;
    module: string;
    priority?: TicketPriority;
    clinicId?: string;
    deadline?: string; // ISO date (YYYY-MM-DD) — required for BUG, optional for FEATURE
    // Optional reporter details — frontend can supply from localStorage
    // Falls back to JWT authorizer context if not provided
    reporterName?: string;
    reporterEmail?: string;
    reporterId?: string;
}

export interface UpdateTicketRequest {
    title?: string;
    description?: string;
    module?: string;
    priority?: TicketPriority;
    status?: TicketStatus;
    deadline?: string;
    assigneeId?: string;
    assigneeName?: string;
    assigneeEmail?: string;
}

export interface ResolveTicketRequest {
    resolution: string;
    // Optional: resolver details from frontend (overrides JWT context if provided)
    resolvedByName?: string;
    resolvedByEmail?: string;
    // Optional: assignment/group context
    assignmentType?: 'single' | 'group';
    groupDetails?: {
        groupId: string;
        groupName: string;
        members: string[];
    };
}

export interface AddCommentRequest {
    content: string;
    isInternal?: boolean;
}

export interface MediaUploadRequest {
    fileName: string;
    contentType: string;
    fileSize: number;
}

export interface MediaConfirmRequest {
    fileId: string;
    fileName: string;
    s3Key: string;
    contentType: string;
    fileSize: number;
}

export interface UpdateModuleAssigneeRequest {
    assigneeId: string;
    assigneeName: string;
    assigneeEmail: string;
    backupAssigneeId?: string;
    backupAssigneeName?: string;
}

// --- Filter / Sort ---

export const VALID_SORT_FIELDS = ['createdAt', 'updatedAt', 'priority', 'status', 'title', 'module'] as const;
export type SortField = (typeof VALID_SORT_FIELDS)[number];

export type SortOrder = 'asc' | 'desc';

export interface TicketFilters {
    status?: string[];
    module?: string[];
    ticketType?: TicketType;
    priority?: string[];
    assigneeId?: string;
    reporterId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    resolvedFrom?: string;
    resolvedTo?: string;
    hasMedia?: boolean;
    sortBy?: SortField;
    sortOrder?: SortOrder;
    limit?: number;
    lastKey?: string;
}

// --- Priority / Status ordering for custom sort ---

export const PRIORITY_ORDER: Record<string, number> = {
    [TicketPriority.CRITICAL]: 0,
    [TicketPriority.HIGH]: 1,
    [TicketPriority.MEDIUM]: 2,
    [TicketPriority.LOW]: 3,
};

export const STATUS_ORDER: Record<string, number> = {
    [TicketStatus.OPEN]: 0,
    [TicketStatus.IN_PROGRESS]: 1,
    [TicketStatus.REOPENED]: 2,
    [TicketStatus.RESOLVED]: 3,
    [TicketStatus.CLOSED]: 4,
};
