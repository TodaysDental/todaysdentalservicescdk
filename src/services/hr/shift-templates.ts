/**
 * Shift Templates Service
 * 
 * Provides shift template management including:
 * - Template CRUD operations
 * - Apply templates to create shifts
 * - Weekly schedule patterns
 * 
 * @module shift-templates
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize DynamoDB client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const SHIFT_TEMPLATES_TABLE = process.env.SHIFT_TEMPLATES_TABLE || 'HrShiftTemplates';

// Types
export interface ShiftTemplateEntry {
    dayOfWeek: number; // 0-6 (Sunday-Saturday)
    staffRole: string;
    startTime: string; // HH:MM format
    endTime: string;   // HH:MM format
    notes?: string;
}

export interface ShiftTemplateRecord {
    pk: string; // `TEMPLATE#${clinicId}`
    sk: string; // `${templateId}`
    templateId: string;
    name: string;
    description?: string;
    clinicId: string;
    shifts: ShiftTemplateEntry[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    isActive: boolean;
}

/**
 * Create a new shift template
 */
export async function createTemplate(params: {
    name: string;
    description?: string;
    clinicId: string;
    shifts: ShiftTemplateEntry[];
    createdBy: string;
}): Promise<ShiftTemplateRecord> {
    const templateId = uuidv4();
    const now = new Date().toISOString();

    const record: ShiftTemplateRecord = {
        pk: `TEMPLATE#${params.clinicId}`,
        sk: templateId,
        templateId,
        name: params.name,
        description: params.description,
        clinicId: params.clinicId,
        shifts: params.shifts,
        createdBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
        isActive: true,
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_TEMPLATES_TABLE,
        Item: record,
    }));

    return record;
}

/**
 * Get a shift template by ID
 */
export async function getTemplate(clinicId: string, templateId: string): Promise<ShiftTemplateRecord | null> {
    const { Item } = await ddb.send(new GetCommand({
        TableName: SHIFT_TEMPLATES_TABLE,
        Key: {
            pk: `TEMPLATE#${clinicId}`,
            sk: templateId,
        },
    }));

    return (Item as ShiftTemplateRecord) || null;
}

/**
 * Get all templates for a clinic
 */
export async function getTemplates(clinicId: string): Promise<ShiftTemplateRecord[]> {
    const { Items } = await ddb.send(new QueryCommand({
        TableName: SHIFT_TEMPLATES_TABLE,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'isActive = :active',
        ExpressionAttributeValues: {
            ':pk': `TEMPLATE#${clinicId}`,
            ':active': true,
        },
    }));

    return (Items || []) as ShiftTemplateRecord[];
}

/**
 * Update a shift template
 */
export async function updateTemplate(
    clinicId: string,
    templateId: string,
    updates: Partial<Pick<ShiftTemplateRecord, 'name' | 'description' | 'shifts'>>
): Promise<ShiftTemplateRecord | null> {
    const existing = await getTemplate(clinicId, templateId);
    if (!existing) return null;

    const updated: ShiftTemplateRecord = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: SHIFT_TEMPLATES_TABLE,
        Item: updated,
    }));

    return updated;
}

/**
 * Delete (soft) a shift template
 */
export async function deleteTemplate(clinicId: string, templateId: string): Promise<boolean> {
    const existing = await getTemplate(clinicId, templateId);
    if (!existing) return false;

    // Soft delete
    existing.isActive = false;
    existing.updatedAt = new Date().toISOString();

    await ddb.send(new PutCommand({
        TableName: SHIFT_TEMPLATES_TABLE,
        Item: existing,
    }));

    return true;
}

/**
 * Apply a template to generate shifts for a week
 */
export async function applyTemplate(params: {
    templateId: string;
    clinicId: string;
    weekStartDate: string; // ISO date string (should be a Monday)
    staffAssignments: { role: string; staffId: string; staffName?: string }[];
}): Promise<{
    shifts: {
        staffId: string;
        staffName?: string;
        role: string;
        startTime: string;
        endTime: string;
        dayOfWeek: number;
        date: string;
    }[];
}> {
    const template = await getTemplate(params.clinicId, params.templateId);
    if (!template) {
        throw new Error('Template not found');
    }

    const weekStart = new Date(params.weekStartDate);
    const shifts: {
        staffId: string;
        staffName?: string;
        role: string;
        startTime: string;
        endTime: string;
        dayOfWeek: number;
        date: string;
    }[] = [];

    for (const templateShift of template.shifts) {
        // Find staff assignments for this role
        const staffForRole = params.staffAssignments.filter(
            a => a.role.toLowerCase() === templateShift.staffRole.toLowerCase()
        );

        for (const staff of staffForRole) {
            // Calculate the date for this day of week
            const shiftDate = new Date(weekStart);
            shiftDate.setDate(weekStart.getDate() + templateShift.dayOfWeek);
            const dateStr = shiftDate.toISOString().split('T')[0];

            // Create full datetime strings
            const startTime = `${dateStr}T${templateShift.startTime}:00`;
            const endTime = `${dateStr}T${templateShift.endTime}:00`;

            shifts.push({
                staffId: staff.staffId,
                staffName: staff.staffName,
                role: templateShift.staffRole,
                startTime,
                endTime,
                dayOfWeek: templateShift.dayOfWeek,
                date: dateStr,
            });
        }
    }

    return { shifts };
}

/**
 * Generate a template from an existing week's schedule
 */
export async function generateTemplateFromWeek(params: {
    name: string;
    description?: string;
    clinicId: string;
    shifts: {
        role: string;
        startTime: string; // ISO datetime
        endTime: string;   // ISO datetime
    }[];
    createdBy: string;
}): Promise<ShiftTemplateRecord> {
    // Convert shifts to template entries
    const templateShifts: ShiftTemplateEntry[] = params.shifts.map(shift => {
        const startDate = new Date(shift.startTime);
        const endDate = new Date(shift.endTime);

        return {
            dayOfWeek: startDate.getDay(),
            staffRole: shift.role,
            startTime: `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
            endTime: `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`,
        };
    });

    return createTemplate({
        name: params.name,
        description: params.description,
        clinicId: params.clinicId,
        shifts: templateShifts,
        createdBy: params.createdBy,
    });
}

export default {
    createTemplate,
    getTemplate,
    getTemplates,
    updateTemplate,
    deleteTemplate,
    applyTemplate,
    generateTemplateFromWeek,
};
