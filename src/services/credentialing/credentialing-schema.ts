// services/credentialing/credentialing-schema.ts
// Shared schema definitions for credentialing system
// Used by both index.ts (main handler) and autofill-handler.ts

// ========================================
// SUBMISSION CHANNEL TYPES
// ========================================

export type SubmissionMode = 'PORTAL' | 'EMAIL' | 'HYBRID';

// ========================================
// CANONICAL FIELD SCHEMA (Dental Credentialing Master Checklist)
// ========================================

/**
 * Organized by credentialing category:
 * A) Identity and Legal
 * B) Licensure and Professional IDs
 * C) Professional History
 * D) Malpractice / Liability
 * E) Practice / Location
 * F) Portal / Workflow-specific
 */
export const CANONICAL_FIELDS = {
    // ----------------------------------------
    // A) IDENTITY AND LEGAL
    // ----------------------------------------
    identity: [
        'firstName', 'middleName', 'lastName', 'suffix', 'maidenName',
        'dateOfBirth', 'ssn', 'gender', 'birthCity', 'birthState', 'birthCountry',
        'citizenship', 'visaStatus', 'visaExpiry',
    ],
    contact: [
        'email', 'phone', 'cellPhone', 'fax',
        'homeAddress1', 'homeAddress2', 'homeCity', 'homeState', 'homeZip',
        'mailingAddress1', 'mailingAddress2', 'mailingCity', 'mailingState', 'mailingZip',
    ],
    legal: [
        'taxId', 'taxIdType', // SSN or EIN
        'ownershipType', 'ownerName', 'authorizedSignerName', 'authorizedSignerTitle',
    ],

    // ----------------------------------------
    // B) LICENSURE AND PROFESSIONAL IDS
    // ----------------------------------------
    license: [
        'stateLicenseNumber', 'stateLicenseState', 'stateLicenseIssueDate', 'stateLicenseExpiry', 'stateLicenseStatus',
        'specialtyLicenseNumber', 'specialtyLicenseState', 'specialtyLicenseExpiry',
        'deaNumber', 'deaState', 'deaExpiry', 'deaSchedules',
        'cdsNumber', 'cdsState', 'cdsExpiry', // Controlled Dangerous Substances (state-specific)
    ],
    professionalIds: [
        'npi', 'npiType', // Type 1 (individual) or Type 2 (organization)
        'caqhId', 'caqhUsername',
        'medicaidId', 'medicaidState',
        'medicareId', 'medicarePtan',
        'stateMedicaidId',
    ],

    // ----------------------------------------
    // C) PROFESSIONAL HISTORY
    // ----------------------------------------
    education: [
        'dentalSchoolName', 'dentalSchoolAddress', 'dentalSchoolCity', 'dentalSchoolState',
        'degreeType', 'graduationDate', 'graduationYear',
        'residencyProgram', 'residencyHospital', 'residencyStartDate', 'residencyEndDate',
        'specialtyTrainingProgram', 'specialtyTrainingDates',
        'internshipProgram', 'internshipDates',
    ],
    certifications: [
        'boardCertification', 'boardCertifyingBody', 'boardCertDate', 'boardCertExpiry', 'boardRecertDate',
        'additionalBoardCerts',
        'cprCertDate', 'cprExpiry', 'cprProvider',
        'blsCertDate', 'blsExpiry',
        'aclsCertDate', 'aclsExpiry',
        'palsCertDate', 'palsExpiry',
    ],
    workHistory: [
        'currentEmployer', 'currentEmployerAddress', 'currentEmployerPhone', 'currentEmployerStartDate',
        'previousEmployer1', 'previousEmployer1Address', 'previousEmployer1Dates', 'previousEmployer1Reason',
        'previousEmployer2', 'previousEmployer2Address', 'previousEmployer2Dates', 'previousEmployer2Reason',
        'previousEmployer3', 'previousEmployer3Address', 'previousEmployer3Dates', 'previousEmployer3Reason',
        'gapsExplanation', // Explanation for gaps in work history
    ],
    specialty: [
        'primarySpecialty', 'primarySpecialtyCode',
        'secondarySpecialty', 'secondarySpecialtyCode',
        'subspecialty', 'procedureFocus',
    ],

    // ----------------------------------------
    // D) MALPRACTICE / LIABILITY
    // ----------------------------------------
    malpractice: [
        'malpracticeInsurer', 'malpracticeInsurerAddress', 'malpracticeInsurerPhone',
        'malpracticePolicyNumber', 'malpracticePolicyType', // Claims-made vs Occurrence
        'malpracticeLimitPerClaim', 'malpracticeLimitAggregate',
        'malpracticeEffectiveDate', 'malpracticeExpiry',
        'tailCoverageRequired', 'tailCoveragePurchased',
        'premisesLiabilityInsurer', 'premisesLiabilityLimit', 'premisesLiabilityExpiry',
    ],
    claims: [
        'hasPendingClaims', 'pendingClaimsDescription',
        'hasSettledClaims', 'settledClaimsDescription',
        'hasDisciplinaryActions', 'disciplinaryActionsDescription',
        'hasLicenseRevocations', 'licenseRevocationsDescription',
        'hasCriminalHistory', 'criminalHistoryDescription',
        'hasHospitalPrivilegesDenied', 'hospitalPrivilegesDescription',
    ],

    // ----------------------------------------
    // E) PRACTICE / LOCATION
    // ----------------------------------------
    practice: [
        'practiceName', 'practiceType', // Solo, Group, Hospital, etc.
        'practiceNpi', 'practiceTaxId',
        'practiceLegalName', 'practiceDoingBusinessAs',
        'practiceAddress1', 'practiceAddress2', 'practiceCity', 'practiceState', 'practiceZip',
        'practicePhone', 'practiceFax', 'practiceEmail', 'practiceWebsite',
        'practiceBillingAddress1', 'practiceBillingCity', 'practiceBillingState', 'practiceBillingZip',
        'practiceCorrespondenceAddress1', 'practiceCorrespondenceCity', 'practiceCorrespondenceState', 'practiceCorrespondenceZip',
        'acceptingNewPatients', 'officeHours',
        'handicapAccessible', 'publicTransportAccess', 'parkingAvailable',
        'languagesSpoken',
    ],
    additionalLocations: [
        'location2Name', 'location2Address', 'location2City', 'location2State', 'location2Zip', 'location2Phone',
        'location3Name', 'location3Address', 'location3City', 'location3State', 'location3Zip', 'location3Phone',
    ],
    hospitalAffiliations: [
        'hospital1Name', 'hospital1Address', 'hospital1PrivilegeType', 'hospital1StartDate',
        'hospital2Name', 'hospital2Address', 'hospital2PrivilegeType', 'hospital2StartDate',
    ],

    // ----------------------------------------
    // F) PORTAL / WORKFLOW-SPECIFIC
    // ----------------------------------------
    portalSpecific: [
        'attestationDate', 'attestationSignature',
        'electronicSignatureDate',
        'credentialingContactName', 'credentialingContactEmail', 'credentialingContactPhone',
        'effectiveDate', 'recredentialingDueDate',
    ],
} as const;

// Flatten for listing and validation
export const CANONICAL_FIELDS_FLAT = [
    ...CANONICAL_FIELDS.identity,
    ...CANONICAL_FIELDS.contact,
    ...CANONICAL_FIELDS.legal,
    ...CANONICAL_FIELDS.license,
    ...CANONICAL_FIELDS.professionalIds,
    ...CANONICAL_FIELDS.education,
    ...CANONICAL_FIELDS.certifications,
    ...CANONICAL_FIELDS.workHistory,
    ...CANONICAL_FIELDS.specialty,
    ...CANONICAL_FIELDS.malpractice,
    ...CANONICAL_FIELDS.claims,
    ...CANONICAL_FIELDS.practice,
    ...CANONICAL_FIELDS.additionalLocations,
    ...CANONICAL_FIELDS.hospitalAffiliations,
    ...CANONICAL_FIELDS.portalSpecific,
];

// ========================================
// DOCUMENT TYPES (Dental Credentialing Master Checklist)
// ========================================

/**
 * Valid document types for credentialing.
 * These are the keys used to categorize documents.
 */
export const VALID_DOCUMENT_TYPES = [
    // A) Identity and Legal Documents
    'photoId', 'w9', 'ownershipDocs',
    // B) Licensure and Professional IDs
    'stateLicense', 'specialtyLicense', 'deaCertificate', 'cdsCertificate', 'npiConfirmation',
    // C) Professional History Documents
    'cv', 'diploma', 'transcript', 'boardCertification', 'residencyCertificate', 'cprCertification', 'aclsCertification',
    // D) Malpractice / Liability Documents
    'malpracticeInsurance', 'tailCoverage', 'claimsHistory', 'premisesLiability',
    // E) Practice / Location Documents
    'practiceLocations', 'taxIdConfirmation', 'facilityAccreditation', 'clinicLicense',
    // F) Portal / Workflow-specific
    'caqhAttestation', 'signaturePage', 'credentialingApplication', 'photo', 'references', 'supplementalDocs',
    // Legacy / catch-all
    'other',
] as const;

export type DocumentType = typeof VALID_DOCUMENT_TYPES[number];

/**
 * Document types mapped to common portal section labels.
 * Keys are internal document types, values are arrays of labels
 * that portals commonly use for that document section.
 */
export const DOCUMENT_TYPE_SECTIONS: Record<string, string[]> = {
    // A) Identity and Legal Documents
    photoId: [
        'Government-issued ID', 'Photo ID', 'Driver\'s License', 'Passport',
        'State ID', 'Identity Document', 'ID Upload'
    ],
    w9: [
        'W-9', 'W9', 'Tax Form', 'Request for Taxpayer Identification',
        'W-9 Tax Form', 'IRS Form W-9'
    ],
    ownershipDocs: [
        'Ownership Documents', 'Authorized Signer', 'Business Documents',
        'Corporate Documents', 'Entity Documentation'
    ],

    // B) Licensure and Professional IDs
    stateLicense: [
        'State License', 'Dental License', 'Professional License',
        'License Upload', 'License Copy', 'State Dental License'
    ],
    specialtyLicense: [
        'Specialty License', 'Specialty Permit', 'Specialty Certificate',
        'Advanced Specialty License'
    ],
    deaCertificate: [
        'DEA Certificate', 'DEA License', 'DEA Registration',
        'Drug Enforcement Administration', 'DEA Upload'
    ],
    cdsCertificate: [
        'CDS Certificate', 'Controlled Substances Certificate',
        'State CDS License', 'Controlled Dangerous Substances'
    ],
    npiConfirmation: [
        'NPI Confirmation', 'NPI Letter', 'NPPES Confirmation',
        'NPI Documentation', 'National Provider Identifier'
    ],

    // C) Professional History Documents
    cv: [
        'CV', 'Curriculum Vitae', 'Resume', 'Work History',
        'Professional Resume', 'Career History'
    ],
    diploma: [
        'Diploma', 'Degree Certificate', 'DDS Certificate', 'DMD Certificate',
        'Dental Degree', 'Education Certificate', 'Dental School Diploma'
    ],
    transcript: [
        'Transcript', 'Academic Record', 'Official Transcript',
        'School Transcript'
    ],
    boardCertification: [
        'Board Certification', 'Specialty Certification', 'Board Certificate',
        'American Board Certification', 'Specialty Board Cert'
    ],
    residencyCertificate: [
        'Residency Certificate', 'Residency Completion', 'Training Certificate',
        'Postgraduate Training'
    ],
    cprCertification: [
        'CPR Certification', 'BLS Certification', 'Basic Life Support',
        'CPR Card', 'BLS Card', 'CPR/BLS Certificate'
    ],
    aclsCertification: [
        'ACLS Certification', 'Advanced Cardiac Life Support', 'ACLS Card'
    ],

    // D) Malpractice / Liability Documents
    malpracticeInsurance: [
        'Malpractice Insurance', 'COI', 'Certificate of Insurance',
        'Liability Insurance', 'Professional Liability', 'Malpractice COI',
        'Insurance Declaration', 'Insurance Face Sheet'
    ],
    tailCoverage: [
        'Tail Coverage', 'Extended Reporting Period', 'ERP Coverage',
        'Tail Insurance'
    ],
    claimsHistory: [
        'Claims History', 'Malpractice Claims', 'Claims Explanation',
        'Insurance Claims Report', 'Loss Run Report'
    ],
    premisesLiability: [
        'Premises Liability', 'General Liability', 'Commercial Liability',
        'Premises Insurance'
    ],

    // E) Practice / Location Documents
    practiceLocations: [
        'Practice Locations', 'Location List', 'Practice Sites',
        'Service Locations'
    ],
    taxIdConfirmation: [
        'Tax ID Confirmation', 'EIN Letter', 'Tax ID Letter',
        'IRS EIN Confirmation', 'CP 575'
    ],
    facilityAccreditation: [
        'Facility Accreditation', 'AAAHC Accreditation', 'Accreditation Certificate',
        'Facility Certificate'
    ],
    clinicLicense: [
        'Clinic License', 'Facility License', 'Business License',
        'Health Facility License'
    ],

    // F) Portal / Workflow-specific
    caqhAttestation: [
        'CAQH Attestation', 'CAQH Profile', 'CAQH Completion',
        'ProView Attestation'
    ],
    signaturePage: [
        'Signature Page', 'Provider Signature', 'Authorized Signature',
        'Signed Application', 'Electronic Signature'
    ],
    credentialingApplication: [
        'Credentialing Application', 'Application Form', 'Enrollment Application',
        'Provider Application'
    ],
    photo: [
        'Provider Photo', 'Headshot', 'Profile Photo', 'Professional Photo'
    ],
    references: [
        'References', 'Professional References', 'Peer References',
        'Reference Letters'
    ],
    supplementalDocs: [
        'Supplemental Documents', 'Additional Documents', 'Supporting Documents',
        'Other Documents'
    ],
    other: [
        'Other', 'Miscellaneous', 'Additional'
    ],
};

// ========================================
// VALIDATION HELPERS
// ========================================

/**
 * Validates if a document type is valid.
 * Returns the type if valid, 'other' if not (for backward compatibility)
 */
export function validateDocumentType(type: string): DocumentType {
    if (VALID_DOCUMENT_TYPES.includes(type as DocumentType)) {
        return type as DocumentType;
    }
    return 'other';
}

/**
 * Finds the upload section hint for a document type.
 * Used to suggest where to upload a document in a portal.
 */
export function findUploadSection(documentType: string): string | undefined {
    const sections = DOCUMENT_TYPE_SECTIONS[documentType];
    if (sections && sections.length > 0) {
        return sections[0];
    }
    // Fuzzy match
    for (const [docType, sectionLabels] of Object.entries(DOCUMENT_TYPE_SECTIONS)) {
        if (docType === documentType || documentType.toLowerCase().includes(docType.toLowerCase())) {
            return sectionLabels[0];
        }
    }
    return undefined;
}
