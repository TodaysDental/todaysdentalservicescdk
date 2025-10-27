/**
 * Attribute-Based Routing (ABR) utilities for Amazon Connect
 *
 * This replaces the old power-set approach with a scalable solution:
 * - One queue per clinic
 * - One master routing profile for all agents
 * - Agent proficiencies/attributes determine routing
 */

/**
 * Generates a queue name for a single clinic (ABR approach)
 */
export function getQueueName(clinicId: string): string {
    return `q-${clinicId}`;
}

/**
 * Gets the master routing profile name (ABR approach)
 * All agents use this single routing profile
 */
export function getMasterRoutingProfileName(): string {
    return 'rp-MasterAgent';
}

/**
 * Gets the attribute name used for clinic-based routing
 */
export function getClinicAttributeName(): string {
    return 'clinic_id';
}

/**
 * Builds proficiency objects for agent attributes (ABR approach)
 */
export function buildProficiencies(clinicIds: string[]): Array<{
    AttributeName: string;
    AttributeValue: string;
    Level: number;
}> {
    return clinicIds.map(clinicId => ({
        AttributeName: getClinicAttributeName(),
        AttributeValue: clinicId,
        Level: 5 // Level doesn't matter for simple matching
    }));
}

/**
 * Determines if a user has access to a specific clinic (ABR approach)
 * This replaces the old determineRoutingProfile function
 */
export function userHasClinicAccess(userClinics: string[], targetClinicId: string): boolean {
    return userClinics.includes(targetClinicId);
}