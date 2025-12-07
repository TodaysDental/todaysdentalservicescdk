/**
 * Call Notes Lambda Handler
 * 
 * Provides CRUD operations for call notes. Agents can add, read, update, and delete
 * notes associated with active or completed calls.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';

const ddb = getDynamoDBClient();

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Constants for note validation
const MAX_NOTE_LENGTH = 5000;
const MAX_NOTES_PER_CALL = 50;

// Note types for categorization
type NoteType = 'general' | 'followup' | 'important' | 'medical' | 'billing' | 'callback';

interface CallNote {
    noteId: string;
    callId: string;
    agentId: string;
    agentName?: string;
    content: string;
    noteType: NoteType;
    createdAt: string;
    updatedAt: string;
    isPrivate: boolean;
}

// Sanitize note content
function sanitizeNoteContent(content: string): { sanitized?: string; error?: string } {
    if (!content || typeof content !== 'string') {
        return { error: 'Note content is required' };
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return { error: 'Note content cannot be empty' };
    }

    if (trimmed.length > MAX_NOTE_LENGTH) {
        return { error: `Note content exceeds maximum length of ${MAX_NOTE_LENGTH} characters` };
    }

    // Remove potentially dangerous characters but allow most text
    const sanitized = trimmed
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .slice(0, MAX_NOTE_LENGTH);

    return { sanitized };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[call-notes] Function invoked', {
        httpMethod: event.httpMethod,
        path: event.path,
        requestId: event.requestContext?.requestId,
    });

    const corsHeaders = buildCorsHeaders({ allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        // 1. Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-notes] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const agentId = getUserIdFromJwt(verifyResult.payload!);
        if (!agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        // Get call ID from path or body
        const pathParams = event.pathParameters || {};
        const callId = pathParams.callId || (event.body ? JSON.parse(event.body).callId : null);
        
        if (!callId && event.httpMethod !== 'GET') {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'callId is required' }) };
        }

        // Route to appropriate handler based on HTTP method
        switch (event.httpMethod) {
            case 'GET':
                return await getNotes(event, agentId, callId, corsHeaders, verifyResult.payload!);
            case 'POST':
                return await createNote(event, agentId, callId, corsHeaders, verifyResult.payload!);
            case 'PUT':
                return await updateNote(event, agentId, callId, corsHeaders, verifyResult.payload!);
            case 'DELETE':
                return await deleteNote(event, agentId, callId, corsHeaders, verifyResult.payload!);
            default:
                return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ message: 'Method not allowed' }) };
        }

    } catch (err: any) {
        console.error('[call-notes] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error', error: err?.message }),
        };
    }
};

async function getNotes(
    event: APIGatewayProxyEvent,
    agentId: string,
    callId: string | null,
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    // If no callId provided, get notes from agent's current call
    let targetCallId = callId;
    
    if (!targetCallId) {
        const { Item: agentPresence } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
        }));
        
        if (!agentPresence?.currentCallId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'No active call and no callId provided' }) };
        }
        targetCallId = agentPresence.currentCallId;
    }

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': targetCallId }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify clinic authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Get notes from call record, filtering private notes if not owner
    const notes: CallNote[] = callRecord.notes || [];
    const filteredNotes = notes.filter(note => 
        !note.isPrivate || note.agentId === agentId
    );

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            callId: targetCallId,
            notes: filteredNotes,
            totalNotes: filteredNotes.length
        }),
    };
}

async function createNote(
    event: APIGatewayProxyEvent,
    agentId: string,
    callId: string,
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}') as {
        callId: string;
        content: string;
        noteType?: NoteType;
        isPrivate?: boolean;
    };

    // Validate and sanitize content
    const { sanitized, error } = sanitizeNoteContent(body.content);
    if (error) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: error }) };
    }

    // Validate note type
    const validNoteTypes: NoteType[] = ['general', 'followup', 'important', 'medical', 'billing', 'callback'];
    const noteType: NoteType = validNoteTypes.includes(body.noteType as NoteType) ? body.noteType as NoteType : 'general';

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify clinic authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Check notes limit
    const existingNotes: CallNote[] = callRecord.notes || [];
    if (existingNotes.length >= MAX_NOTES_PER_CALL) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: `Maximum of ${MAX_NOTES_PER_CALL} notes per call reached` }) };
    }

    // Create new note
    const now = new Date().toISOString();
    const newNote: CallNote = {
        noteId: randomUUID(),
        callId: callId,
        agentId: agentId,
        content: sanitized!,
        noteType: noteType,
        createdAt: now,
        updatedAt: now,
        isPrivate: body.isPrivate || false
    };

    // Add note to call record
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET notes = list_append(if_not_exists(notes, :empty), :newNote), lastNoteAt = :now, hasNotes = :true',
        ExpressionAttributeValues: {
            ':empty': [],
            ':newNote': [newNote],
            ':now': now,
            ':true': true
        }
    }));

    console.log('[call-notes] Note created', { callId, noteId: newNote.noteId, agentId });

    return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Note created',
            note: newNote
        }),
    };
}

async function updateNote(
    event: APIGatewayProxyEvent,
    agentId: string,
    callId: string,
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}') as {
        callId: string;
        noteId: string;
        content?: string;
        noteType?: NoteType;
        isPrivate?: boolean;
    };

    if (!body.noteId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'noteId is required' }) };
    }

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify clinic authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Find and update the note
    const notes: CallNote[] = callRecord.notes || [];
    const noteIndex = notes.findIndex(n => n.noteId === body.noteId);

    if (noteIndex === -1) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Note not found' }) };
    }

    const existingNote = notes[noteIndex];

    // Only the note creator can update it
    if (existingNote.agentId !== agentId) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'You can only update your own notes' }) };
    }

    // Validate content if provided
    if (body.content !== undefined) {
        const { sanitized, error } = sanitizeNoteContent(body.content);
        if (error) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: error }) };
        }
        existingNote.content = sanitized!;
    }

    // Update other fields if provided
    if (body.noteType !== undefined) {
        const validNoteTypes: NoteType[] = ['general', 'followup', 'important', 'medical', 'billing', 'callback'];
        if (validNoteTypes.includes(body.noteType)) {
            existingNote.noteType = body.noteType;
        }
    }

    if (body.isPrivate !== undefined) {
        existingNote.isPrivate = body.isPrivate;
    }

    existingNote.updatedAt = new Date().toISOString();
    notes[noteIndex] = existingNote;

    // Update call record with modified notes
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET notes = :notes, lastNoteAt = :now',
        ExpressionAttributeValues: {
            ':notes': notes,
            ':now': new Date().toISOString()
        }
    }));

    console.log('[call-notes] Note updated', { callId, noteId: body.noteId, agentId });

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Note updated',
            note: existingNote
        }),
    };
}

async function deleteNote(
    event: APIGatewayProxyEvent,
    agentId: string,
    callId: string,
    corsHeaders: Record<string, string>,
    payload: any
): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}') as {
        callId: string;
        noteId: string;
    };

    if (!body.noteId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'noteId is required' }) };
    }

    // Get call record
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));

    if (!callRecords || callRecords.length === 0) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
    }

    const callRecord = callRecords[0];

    // Verify clinic authorization
    const authzCheck = checkClinicAuthorization(payload as any, callRecord.clinicId);
    if (!authzCheck.authorized) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: authzCheck.reason }) };
    }

    // Find the note
    const notes: CallNote[] = callRecord.notes || [];
    const noteIndex = notes.findIndex(n => n.noteId === body.noteId);

    if (noteIndex === -1) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Note not found' }) };
    }

    const noteToDelete = notes[noteIndex];

    // Only the note creator can delete it
    if (noteToDelete.agentId !== agentId) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'You can only delete your own notes' }) };
    }

    // Remove the note
    notes.splice(noteIndex, 1);

    // Update call record
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET notes = :notes, hasNotes = :hasNotes',
        ExpressionAttributeValues: {
            ':notes': notes,
            ':hasNotes': notes.length > 0
        }
    }));

    console.log('[call-notes] Note deleted', { callId, noteId: body.noteId, agentId });

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            message: 'Note deleted',
            noteId: body.noteId
        }),
    };
}

