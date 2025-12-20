import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import clinicsData from '../../infrastructure/configs/clinics.json';

// DynamoDB setup
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// Environment variables
const INSURANCE_PLANS_TABLE = process.env.INSURANCE_PLANS_TABLE || 'InsurancePlans';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';
const CONSOLIDATED_SFTP_PASSWORD = process.env.CONSOLIDATED_SFTP_PASSWORD || '';

// Clinic credentials type
interface ClinicCreds {
  clinicId: string;
  clinicName: string;
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir: string;
}

// Build clinic credentials from imported clinic data
const CLINIC_CREDS: ClinicCreds[] = (clinicsData as any[]).map((c: any) => ({
  clinicId: String(c.clinicId),
  clinicName: String(c.clinicName || c.clinicId),
  developerKey: c.developerKey,
  customerKey: c.customerKey,
  sftpHost: CONSOLIDATED_SFTP_HOST,
  sftpPort: 22,
  sftpUsername: 'sftpuser',
  sftpPassword: CONSOLIDATED_SFTP_PASSWORD,
  sftpRemoteDir: 'QuerytemplateCSV',
}));

// The comprehensive insurance plan query
const INSURANCE_PLAN_QUERY = `/* OPENDENTAL – CATEGORY % + MAX/DED + DOWNGRADES + WAIT/FREQ/AGE + OTHER BENEFIT TYPES (PLAN LEVEL) */

SELECT
  c.CarrierName  AS Insurance_Name,
  isp.GroupName  AS Group_Name,
  isp.GroupNum   AS Group_Number,
  e.EmpName      AS Employer,
  fs.Description AS Fee_Schedule,
  isp.PlanNote   AS Plan_Note,

  /* ---------------- DOWNGRADES ---------------- */
  CASE isp.CodeSubstNone
    WHEN 0 THEN 'Yes (Downgrades Allowed)'
    WHEN 1 THEN 'No (No Downgrades)'
  END AS Downgrades,

  /* ---------------- MAXIMUMS ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 5
         AND b.CovCatNum = 0
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND b.TimePeriod IN (1,2)
         AND b.CoverageLevel = 1
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Annual_Max_Individual,

  MAX(CASE
        WHEN b.BenefitType = 5
         AND b.CovCatNum = 0
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND b.TimePeriod IN (1,2)
         AND b.CoverageLevel = 2
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Annual_Max_Family,

  /* ---------------- DEDUCTIBLES ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 2
         AND b.CovCatNum = 0
         AND b.TimePeriod IN (1,2)
         AND b.CoverageLevel = 1
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Deductible_Individual,

  MAX(CASE
        WHEN b.BenefitType = 2
         AND b.CovCatNum = 0
         AND b.TimePeriod IN (1,2)
         AND b.CoverageLevel = 2
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Deductible_Family,

  /* Optional: show deductible overrides specifically on preventive categories (often $0) */
  MAX(CASE
        WHEN b.BenefitType = 2
         AND b.CovCatNum <> 0
         AND (cat.Description LIKE '%Diagnostic%'
           OR cat.Description LIKE '%X-Ray%'
           OR cat.Description LIKE '%Routine Prevent%')
         AND b.TimePeriod IN (1,2)
         AND b.CoverageLevel IN (0,1,2)
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Deductible_On_Preventive_Override,

  /* =======================================================================
     CATEGORY PERCENTAGES (BenefitType = CoInsurance)
     ======================================================================= */

  /* ---------------- PREVENTIVE umbrella ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Diagnostic%'
         AND cat.Description NOT LIKE '%X-Ray%'
        THEN NULLIF(b.Percent,-1)
      END) AS Preventive_Diagnostics_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND (cat.Description LIKE '%X-Ray%'
           OR cat.Description LIKE '%Radiograph%'
           OR cat.Description LIKE '%Diag%XRay%')
        THEN NULLIF(b.Percent,-1)
      END) AS Preventive_XRays_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Routine Prevent%'
        THEN NULLIF(b.Percent,-1)
      END) AS Preventive_RoutinePreventive_Pct,

  /* ---------------- BASIC umbrella ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Restor%'
        THEN NULLIF(b.Percent,-1)
      END) AS Basic_Restorative_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Endo%'
        THEN NULLIF(b.Percent,-1)
      END) AS Basic_Endo_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Perio%'
        THEN NULLIF(b.Percent,-1)
      END) AS Basic_Perio_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Oral%'
        THEN NULLIF(b.Percent,-1)
      END) AS Basic_OralSurgery_Pct,

  /* ---------------- MAJOR umbrella ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Crown%'
        THEN NULLIF(b.Percent,-1)
      END) AS Major_Crowns_Pct,

  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Prosth%'
        THEN NULLIF(b.Percent,-1)
      END) AS Major_Prosthodontics_Pct,

  /* ---------------- ORTHO (common extras) ---------------- */
  MAX(CASE
        WHEN b.BenefitType = 1
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Ortho%'
        THEN NULLIF(b.Percent,-1)
      END) AS Ortho_Pct,

  MAX(CASE
        WHEN b.BenefitType = 5
         AND b.CodeNum = 0 AND b.CodeGroupNum = 0
         AND cat.Description LIKE '%Ortho%'
         AND b.TimePeriod = 3
        THEN NULLIF(b.MonetaryAmt,-1)
      END) AS Ortho_Lifetime_Max,

  /* ---------------- WAITING PERIODS (BenefitType=6) ---------------- */
  GROUP_CONCAT(DISTINCT
    CASE WHEN b.BenefitType = 6 THEN
      CONCAT(
        COALESCE(cat.Description,'General'),
        ': ',
        FLOOR(b.Quantity), ' ',
        CASE b.QuantityQualifier
          WHEN 4 THEN 'Years'
          WHEN 5 THEN 'Months'
          ELSE 'Period'
        END
      )
    END
    ORDER BY cat.Description
    SEPARATOR ' | '
  ) AS Waiting_Periods,

  /* ---------------- FREQUENCY LIMITS (BenefitType=5, NOT AgeLimit) ---------------- */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 5
       AND b.QuantityQualifier IN (1,3,4,5)
       AND (b.CodeGroupNum <> 0 OR b.CodeNum <> 0)
      THEN CONCAT(
        COALESCE(cg.GroupName, pc.ProcCode, 'Unknown'),
        ': ',
        CASE
          WHEN b.QuantityQualifier = 4 THEN CONCAT('Every ', FLOOR(b.Quantity), ' Year',  IF(FLOOR(b.Quantity)=1,'','s'))
          WHEN b.QuantityQualifier = 5 THEN CONCAT('Every ', FLOOR(b.Quantity), ' Month', IF(FLOOR(b.Quantity)=1,'','s'))
          WHEN b.QuantityQualifier = 1 THEN CONCAT(FLOOR(b.Quantity), ' services per ',
              CASE b.TimePeriod
                WHEN 1 THEN 'Service Year'
                WHEN 2 THEN 'Calendar Year'
                WHEN 3 THEN 'Lifetime'
                WHEN 5 THEN 'Last 12 Months'
                ELSE CONCAT('TimePeriod ', b.TimePeriod)
              END)
          WHEN b.QuantityQualifier = 3 THEN CONCAT(FLOOR(b.Quantity), ' visits per ',
              CASE b.TimePeriod
                WHEN 1 THEN 'Service Year'
                WHEN 2 THEN 'Calendar Year'
                WHEN 3 THEN 'Lifetime'
                WHEN 5 THEN 'Last 12 Months'
                ELSE CONCAT('TimePeriod ', b.TimePeriod)
              END)
        END,
        CASE b.TreatArea
          WHEN 0 THEN ''
          WHEN 1 THEN ' [Surf]'
          WHEN 2 THEN ' [Tooth]'
          WHEN 3 THEN ' [Mouth]'
          WHEN 4 THEN ' [Quad]'
          WHEN 5 THEN ' [Sextant]'
          WHEN 6 THEN ' [Arch]'
          WHEN 7 THEN ' [ToothRange]'
          ELSE ''
        END
      )
    END
    ORDER BY cg.GroupName, pc.ProcCode
    SEPARATOR ' | '
  ) AS Frequency_Limits,

  /* ---------------- AGE LIMITS (BenefitType=5, AgeLimit) ---------------- */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 5
       AND b.QuantityQualifier = 2
      THEN CONCAT(
        COALESCE(cg.GroupName, pc.ProcCode, cat.Description, 'General'),
        ': Age ≤ ', FLOOR(b.Quantity)
      )
    END
    ORDER BY cg.GroupName, pc.ProcCode, cat.Description
    SEPARATOR ' | '
  ) AS Age_Limits,

  /* =======================================================================
     ADD: OTHER BENEFIT CATEGORIES (what you were missing)
     ======================================================================= */

  /* Deductible overrides by category (ALL categories, not only preventive) */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 2
       AND b.CovCatNum <> 0
      THEN CONCAT(
        COALESCE(cat.Description,'Category'),
        ': $', ROUND(NULLIF(b.MonetaryAmt,-1),2),
        CASE b.CoverageLevel WHEN 1 THEN ' [Ind]' WHEN 2 THEN ' [Fam]' ELSE '' END,
        ' / ',
        CASE b.TimePeriod
          WHEN 0 THEN 'None'
          WHEN 1 THEN 'ServiceYear'
          WHEN 2 THEN 'CalendarYear'
          WHEN 3 THEN 'Lifetime'
          WHEN 5 THEN 'Last12Months'
          ELSE CONCAT('TP',b.TimePeriod)
        END
      )
    END
    ORDER BY cat.Description
    SEPARATOR ' | '
  ) AS Deductible_Overrides_By_Category,

  /* Coinsurance overrides by procedure OR codegroup (not category-level) */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 1
       AND (b.CodeNum <> 0 OR b.CodeGroupNum <> 0)
      THEN CONCAT(
        COALESCE(cg.GroupName, pc.ProcCode, 'Unknown'),
        ': ', NULLIF(b.Percent,-1), '%',
        CASE b.CoverageLevel WHEN 1 THEN ' [Ind]' WHEN 2 THEN ' [Fam]' ELSE '' END
      )
    END
    ORDER BY cg.GroupName, pc.ProcCode
    SEPARATOR ' | '
  ) AS Coinsurance_Overrides_By_CodeOrGroup,

  /* Copayments (BenefitType=3) */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 3
      THEN CONCAT(
        COALESCE(cat.Description,'General'),
        IF(pc.ProcCode IS NOT NULL, CONCAT(' / ', pc.ProcCode), ''),
        IF(cg.GroupName IS NOT NULL, CONCAT(' / ', cg.GroupName), ''),
        ': $', ROUND(NULLIF(b.MonetaryAmt,-1),2),
        CASE b.CoverageLevel WHEN 1 THEN ' [Ind]' WHEN 2 THEN ' [Fam]' ELSE '' END,
        CASE b.TimePeriod
          WHEN 0 THEN ''
          WHEN 1 THEN ' / ServiceYear'
          WHEN 2 THEN ' / CalendarYear'
          WHEN 3 THEN ' / Lifetime'
          WHEN 5 THEN ' / Last12Months'
          ELSE CONCAT(' / TP',b.TimePeriod)
        END
      )
    END
    ORDER BY cat.Description, pc.ProcCode, cg.GroupName
    SEPARATOR ' | '
  ) AS Copayments,

  /* Exclusions (BenefitType=4) */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 4
      THEN CONCAT(
        COALESCE(cat.Description,'General'),
        IF(pc.ProcCode IS NOT NULL, CONCAT(' / ', pc.ProcCode), ''),
        IF(cg.GroupName IS NOT NULL, CONCAT(' / ', cg.GroupName), '')
      )
    END
    ORDER BY cat.Description, pc.ProcCode, cg.GroupName
    SEPARATOR ' | '
  ) AS Exclusions,

  /* ActiveCoverage flags (BenefitType=0) */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 0
      THEN CONCAT(
        COALESCE(cat.Description,'General'),
        IF(pc.ProcCode IS NOT NULL, CONCAT(' / ', pc.ProcCode), ''),
        IF(cg.GroupName IS NOT NULL, CONCAT(' / ', cg.GroupName), '')
      )
    END
    ORDER BY cat.Description, pc.ProcCode, cg.GroupName
    SEPARATOR ' | '
  ) AS Active_Coverage_Flags,

  /* Other Limitations (BenefitType=5) excluding ones already shown as AnnualMax/OrthoMax/Frequency/Age */
  GROUP_CONCAT(DISTINCT
    CASE
      WHEN b.BenefitType = 5
       AND NOT (
         (b.CovCatNum=0 AND b.CodeNum=0 AND b.CodeGroupNum=0 AND b.TimePeriod IN (1,2) AND b.CoverageLevel IN (1,2))
         OR (cat.Description LIKE '%Ortho%' AND b.TimePeriod=3 AND b.CodeNum=0 AND b.CodeGroupNum=0)
         OR (b.QuantityQualifier=2)
         OR (b.QuantityQualifier IN (1,3,4,5) AND (b.CodeGroupNum<>0 OR b.CodeNum<>0))
       )
      THEN CONCAT(
        COALESCE(cat.Description,'General'),
        IF(pc.ProcCode IS NOT NULL, CONCAT(' / ', pc.ProcCode), ''),
        IF(cg.GroupName IS NOT NULL, CONCAT(' / ', cg.GroupName), ''),
        ': ',
        CASE
          WHEN NULLIF(b.MonetaryAmt,-1) IS NOT NULL THEN CONCAT('$', ROUND(b.MonetaryAmt,2))
          WHEN NULLIF(b.Percent,-1) IS NOT NULL THEN CONCAT(NULLIF(b.Percent,-1), '%')
          ELSE 'Limitation'
        END,
        CASE b.TimePeriod
          WHEN 0 THEN ''
          WHEN 1 THEN ' / ServiceYear'
          WHEN 2 THEN ' / CalendarYear'
          WHEN 3 THEN ' / Lifetime'
          WHEN 4 THEN ' / Years'
          WHEN 5 THEN ' / Last12Months'
          ELSE CONCAT(' / TP',b.TimePeriod)
        END,
        CASE b.CoverageLevel WHEN 1 THEN ' [Ind]' WHEN 2 THEN ' [Fam]' ELSE '' END
      )
    END
    ORDER BY cat.Description, pc.ProcCode, cg.GroupName
    SEPARATOR ' | '
  ) AS Other_Limitations,

  /* RAW benefit rows dump (close to the OpenDental "benefit info" format) */
  GROUP_CONCAT(DISTINCT
    CONCAT(
      COALESCE(cat.Description,'General'), ',',
      COALESCE(pc.ProcCode, CONCAT('CodeGroup:', cg.GroupName), '-'), ',',
      CASE b.BenefitType
        WHEN 0 THEN 'ActiveCoverage'
        WHEN 1 THEN 'CoInsurance'
        WHEN 2 THEN 'Deductible'
        WHEN 3 THEN 'CoPayment'
        WHEN 4 THEN 'Exclusions'
        WHEN 5 THEN 'Limitations'
        WHEN 6 THEN 'WaitingPeriod'
        ELSE CONCAT('Type',b.BenefitType)
      END, ',',
      IFNULL(NULLIF(b.Percent,-1),-1), ',',
      IFNULL(NULLIF(b.MonetaryAmt,-1),-1), ',',
      CASE b.TimePeriod
        WHEN 0 THEN 'None'
        WHEN 1 THEN 'ServiceYear'
        WHEN 2 THEN 'CalendarYear'
        WHEN 3 THEN 'Lifetime'
        WHEN 4 THEN 'Years'
        WHEN 5 THEN 'NumberInLast12Months'
        ELSE CONCAT('TP',b.TimePeriod)
      END, ',',
      CASE b.QuantityQualifier
        WHEN 0 THEN 'None'
        WHEN 1 THEN 'NumberOfServices'
        WHEN 2 THEN 'AgeLimit'
        WHEN 3 THEN 'Visits'
        WHEN 4 THEN 'Years'
        WHEN 5 THEN 'Months'
        ELSE CONCAT('QQ',b.QuantityQualifier)
      END, ',',
      IFNULL(b.Quantity,0), ',',
      CASE b.CoverageLevel
        WHEN 0 THEN 'None'
        WHEN 1 THEN 'Individual'
        WHEN 2 THEN 'Family'
        ELSE CONCAT('Level',b.CoverageLevel)
      END
    )
    ORDER BY b.BenefitType, cat.Description, pc.ProcCode, cg.GroupName
    SEPARATOR ' || '
  ) AS Benefit_Rows_Raw

FROM insplan isp
LEFT JOIN carrier   c  ON isp.CarrierNum  = c.CarrierNum
LEFT JOIN employer  e  ON isp.EmployerNum = e.EmployerNum
LEFT JOIN feesched  fs ON isp.FeeSched    = fs.FeeSchedNum

LEFT JOIN benefit b
  ON b.PlanNum = isp.PlanNum
 AND b.PatPlanNum = 0   /* plan-level only */

LEFT JOIN covcat        cat ON b.CovCatNum    = cat.CovCatNum
LEFT JOIN codegroup     cg  ON b.CodeGroupNum = cg.CodeGroupNum
LEFT JOIN procedurecode pc  ON b.CodeNum      = pc.CodeNum

GROUP BY isp.PlanNum
ORDER BY c.CarrierName, isp.GroupName;`;

// Interface for insurance plan record
interface InsurancePlanRecord {
  pk: string; // clinicId#groupNumber
  sk: string; // insuranceName#groupName#employer
  clinicId: string;
  clinicName: string;
  insuranceName: string; // Always a string for GSI compatibility (uses 'UNKNOWN_CARRIER' if null)
  groupName: string | null;
  groupNumber: string | null;
  employer: string | null;
  feeSchedule: string | null;
  planNote: string | null;
  downgrades: string | null;
  annualMaxIndividual: number | null;
  annualMaxFamily: number | null;
  deductibleIndividual: number | null;
  deductibleFamily: number | null;
  deductibleOnPreventiveOverride: number | null;
  preventiveDiagnosticsPct: number | null;
  preventiveXRaysPct: number | null;
  preventiveRoutinePreventivePct: number | null;
  basicRestorativePct: number | null;
  basicEndoPct: number | null;
  basicPerioPct: number | null;
  basicOralSurgeryPct: number | null;
  majorCrownsPct: number | null;
  majorProsthodonticsPct: number | null;
  orthoPct: number | null;
  orthoLifetimeMax: number | null;
  waitingPeriods: string | null;
  frequencyLimits: string | null;
  ageLimits: string | null;
  // New comprehensive benefit fields
  deductibleOverridesByCategory: string | null;
  coinsuranceOverridesByCodeOrGroup: string | null;
  copayments: string | null;
  exclusions: string | null;
  activeCoverageFlags: string | null;
  otherLimitations: string | null;
  benefitRowsRaw: string | null;
  lastSyncAt: string;
  contentHash: string;
}

// Helper to create a content hash for change detection
function createContentHash(row: Record<string, string>): string {
  const sortedEntries = Object.entries(row).sort(([a], [b]) => a.localeCompare(b));
  const content = sortedEntries.map(([k, v]) => `${k}:${v || ''}`).join('|');
  // Simple hash using base64 encoding of a portion of the content
  return Buffer.from(content).toString('base64').slice(0, 32);
}

// Helper to parse numeric values
function parseNumber(value: string | null | undefined): number | null {
  if (!value || value.trim() === '' || value === 'NULL') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

// Helper to clean string values - also strips surrounding quotes
function cleanString(value: string | null | undefined): string | null {
  if (!value || value.trim() === '' || value === 'NULL') return null;
  let cleaned = value.trim();
  // Remove surrounding quotes if present (CSV parsing artifact)
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Also handle escaped quotes
  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");
  return cleaned.trim() || null;
}

// Convert a CSV row to an InsurancePlanRecord
function rowToRecord(row: Record<string, string>, clinicId: string, clinicName: string): InsurancePlanRecord {
  const insuranceName = cleanString(row['Insurance_Name']);
  const groupName = cleanString(row['Group_Name']);
  const groupNumber = cleanString(row['Group_Number']);
  const employer = cleanString(row['Employer']);
  
  // Create unique keys - use employer as part of key to handle duplicates
  // pk: clinicId#groupNumber (or UNKNOWN if null)
  // sk: insuranceName#groupName#employer (to ensure uniqueness)
  const pk = `${clinicId}#${groupNumber || 'UNKNOWN'}`;
  const sk = `${insuranceName || 'UNKNOWN'}#${groupName || 'UNKNOWN'}#${employer || 'UNKNOWN'}`;
  
  // IMPORTANT: insuranceName MUST be a string for the GSI to work
  // Use a placeholder if null, otherwise DynamoDB will reject the write
  const insuranceNameForGsi = insuranceName || 'UNKNOWN_CARRIER';
  
  return {
    pk,
    sk,
    clinicId,
    clinicName,
    // Use the GSI-safe value for insuranceName
    insuranceName: insuranceNameForGsi,
    groupName,
    groupNumber,
    employer,
    feeSchedule: cleanString(row['Fee_Schedule']),
    planNote: cleanString(row['Plan_Note']),
    downgrades: cleanString(row['Downgrades']),
    annualMaxIndividual: parseNumber(row['Annual_Max_Individual']),
    annualMaxFamily: parseNumber(row['Annual_Max_Family']),
    deductibleIndividual: parseNumber(row['Deductible_Individual']),
    deductibleFamily: parseNumber(row['Deductible_Family']),
    deductibleOnPreventiveOverride: parseNumber(row['Deductible_On_Preventive_Override']),
    preventiveDiagnosticsPct: parseNumber(row['Preventive_Diagnostics_Pct']),
    preventiveXRaysPct: parseNumber(row['Preventive_XRays_Pct']),
    preventiveRoutinePreventivePct: parseNumber(row['Preventive_RoutinePreventive_Pct']),
    basicRestorativePct: parseNumber(row['Basic_Restorative_Pct']),
    basicEndoPct: parseNumber(row['Basic_Endo_Pct']),
    basicPerioPct: parseNumber(row['Basic_Perio_Pct']),
    basicOralSurgeryPct: parseNumber(row['Basic_OralSurgery_Pct']),
    majorCrownsPct: parseNumber(row['Major_Crowns_Pct']),
    majorProsthodonticsPct: parseNumber(row['Major_Prosthodontics_Pct']),
    orthoPct: parseNumber(row['Ortho_Pct']),
    orthoLifetimeMax: parseNumber(row['Ortho_Lifetime_Max']),
    waitingPeriods: cleanString(row['Waiting_Periods']),
    frequencyLimits: cleanString(row['Frequency_Limits']),
    ageLimits: cleanString(row['Age_Limits']),
    // New comprehensive benefit fields
    deductibleOverridesByCategory: cleanString(row['Deductible_Overrides_By_Category']),
    coinsuranceOverridesByCodeOrGroup: cleanString(row['Coinsurance_Overrides_By_CodeOrGroup']),
    copayments: cleanString(row['Copayments']),
    exclusions: cleanString(row['Exclusions']),
    activeCoverageFlags: cleanString(row['Active_Coverage_Flags']),
    otherLimitations: cleanString(row['Other_Limitations']),
    benefitRowsRaw: cleanString(row['Benefit_Rows_Raw']),
    lastSyncAt: new Date().toISOString(),
    contentHash: createContentHash(row),
  };
}

// HTTP request helper
async function httpRequest(
  opts: { hostname: string; path: string; method: string; headers?: Record<string, string> },
  body?: string
): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...opts.headers };
    if (body) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: opts.method,
        headers: requestHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number = 3, baseDelayMs: number = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Download specific CSV file from SFTP
async function downloadSpecificCsvOnce(opts: {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
  filename: string;
}): Promise<string> {
  const { host, port, username, password, remoteDir, filename } = opts;
  const conn = new SSH2Client();

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SFTP connection timeout'));
    }, 30000);

    conn
      .on('ready', () => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          // Wait for file to be available
          setTimeout(() => {
            const filePath = `${remoteDir}/${filename}`;
            console.log(`Downloading file: ${filePath}`);

            sftp.stat(filePath, (statErr: any) => {
              if (statErr) {
                console.warn(`File not found: ${filePath}, searching for pattern...`);
                sftp.readdir(remoteDir, (err2: any, list: any[]) => {
                  if (err2) {
                    clearTimeout(timeout);
                    conn.end();
                    reject(err2);
                    return;
                  }

                  const pattern = filename.split('_').slice(0, 2).join('_');
                  const matchingFiles = list.filter(
                    (f: any) => String(f.filename).includes(pattern) && String(f.filename).endsWith('.csv')
                  );

                  if (matchingFiles.length === 0) {
                    clearTimeout(timeout);
                    conn.end();
                    reject(new Error(`No matching CSV files found for pattern: ${pattern}`));
                    return;
                  }

                  const latest = matchingFiles.sort((a: any, b: any) => b.attrs.mtime - a.attrs.mtime)[0];
                  const actualPath = `${remoteDir}/${latest.filename}`;
                  console.log(`Using fallback file: ${latest.filename}`);
                  readCsvFile(sftp, actualPath, timeout, conn, resolve, reject);
                });
                return;
              }

              readCsvFile(sftp, filePath, timeout, conn, resolve, reject);
            });
          }, 3000);
        });
      })
      .on('error', (e: any) => {
        clearTimeout(timeout);
        reject(e);
      })
      .connect({ host, port, username, password, readyTimeout: 15000 });
  });
}

function readCsvFile(
  sftp: any,
  filePath: string,
  timeout: NodeJS.Timeout,
  conn: any,
  resolve: (value: string) => void,
  reject: (reason: any) => void
) {
  const readStream = sftp.createReadStream(filePath);
  let csvContent = '';
  readStream.on('data', (chunk: any) => {
    csvContent += chunk.toString();
  });
  readStream.on('end', () => {
    clearTimeout(timeout);
    conn.end();
    resolve(csvContent);
  });
  readStream.on('error', (e: any) => {
    clearTimeout(timeout);
    conn.end();
    reject(e);
  });
}

async function downloadSpecificCsv(opts: {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
  filename: string;
}): Promise<string> {
  return retryWithBackoff(() => downloadSpecificCsvOnce(opts), 3, 2000);
}

// Run OpenDental query for a clinic
async function runOpenDentalQuery(creds: ClinicCreds): Promise<Record<string, string>[]> {
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = creds.sftpRemoteDir.replace(/^\/+|\/+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8);
  const csvFilename = `insplan_${creds.clinicId}_${timestamp}_${uniqueId}.csv`;
  const sftpAddress = `${creds.sftpHost}/${remoteDir}/${csvFilename}`;

  const headers = {
    Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
    'Content-Type': 'application/json',
  };

  const body = JSON.stringify({
    SqlCommand: INSURANCE_PLAN_QUERY,
    SftpAddress: sftpAddress,
    SftpUsername: creds.sftpUsername,
    SftpPassword: creds.sftpPassword,
    SftpPort: creds.sftpPort,
    IsAsync: 'false',
  });

  console.log(`[${creds.clinicId}] Running insurance plan query, results to: ${csvFilename}`);

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);

  if (apiResp.statusCode !== 201) {
    console.error(`[${creds.clinicId}] OpenDental API failed with status ${apiResp.statusCode}: ${apiResp.body}`);
    return [];
  }

  // Download the CSV file
  const csvData = await downloadSpecificCsv({
    host: creds.sftpHost,
    port: creds.sftpPort,
    username: creds.sftpUsername,
    password: creds.sftpPassword,
    remoteDir: remoteDir,
    filename: csvFilename,
  });

  if (csvData.trim() === 'OK' || csvData.trim() === '') {
    console.log(`[${creds.clinicId}] No insurance plans returned`);
    return [];
  }

  try {
    const records = parseCsv(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      quote: false,
      relax_column_count: true,
    });
    return Array.isArray(records) ? records : [];
  } catch (parseError: any) {
    console.error(`[${creds.clinicId}] Failed to parse CSV: ${parseError.message}`);
    return [];
  }
}

// Batch write to DynamoDB (25 items max per batch)
async function batchWriteRecords(records: InsurancePlanRecord[]): Promise<void> {
  const BATCH_SIZE = 25;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const putRequests = batch.map((record) => ({
      PutRequest: {
        Item: record,
      },
    }));

    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [INSURANCE_PLANS_TABLE]: putRequests,
        },
      })
    );

    console.log(`Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)`);
  }
}

// Get existing records for a clinic to detect changes
async function getExistingRecords(clinicId: string): Promise<Map<string, InsurancePlanRecord>> {
  const existingMap = new Map<string, InsurancePlanRecord>();

  let lastKey: Record<string, any> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: INSURANCE_PLANS_TABLE,
        FilterExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items || []) {
      const record = item as InsurancePlanRecord;
      existingMap.set(`${record.pk}#${record.sk}`, record);
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return existingMap;
}

// Delete stale records that no longer exist in the source
async function deleteStaleRecords(clinicId: string, currentKeys: Set<string>, existingRecords: Map<string, InsurancePlanRecord>): Promise<number> {
  let deletedCount = 0;

  for (const [key, record] of existingRecords) {
    if (!currentKeys.has(key)) {
      await doc.send(
        new DeleteCommand({
          TableName: INSURANCE_PLANS_TABLE,
          Key: {
            pk: record.pk,
            sk: record.sk,
          },
        })
      );
      deletedCount++;
    }
  }

  return deletedCount;
}

// Process a single clinic
async function processClinic(creds: ClinicCreds): Promise<{ added: number; updated: number; deleted: number; unchanged: number }> {
  const stats = { added: 0, updated: 0, deleted: 0, unchanged: 0 };

  try {
    // Run the query
    const rows = await runOpenDentalQuery(creds);
    console.log(`[${creds.clinicId}] Retrieved ${rows.length} insurance plans`);

    if (rows.length === 0) {
      return stats;
    }

    // Get existing records
    const existingRecords = await getExistingRecords(creds.clinicId);

    // Convert rows to records and track changes
    // Use a Map to deduplicate by key (last one wins if duplicates exist)
    const recordsByKey = new Map<string, InsurancePlanRecord>();
    const currentKeys = new Set<string>();

    for (const row of rows) {
      const record = rowToRecord(row, creds.clinicId, creds.clinicName);
      const key = `${record.pk}#${record.sk}`;
      
      // Deduplicate: if we already have this key, keep the one with more data
      if (recordsByKey.has(key)) {
        const existing = recordsByKey.get(key)!;
        // Keep the one with more non-null fields
        const existingNonNull = Object.values(existing).filter(v => v !== null).length;
        const recordNonNull = Object.values(record).filter(v => v !== null).length;
        if (recordNonNull <= existingNonNull) {
          continue; // Skip this duplicate, keep the existing one
        }
      }
      
      recordsByKey.set(key, record);
      currentKeys.add(key);
    }

    // Now process deduplicated records
    const newRecords: InsurancePlanRecord[] = [];
    for (const [key, record] of recordsByKey) {
      const existing = existingRecords.get(key);
      if (!existing) {
        // New record
        newRecords.push(record);
        stats.added++;
      } else if (existing.contentHash !== record.contentHash) {
        // Changed record
        newRecords.push(record);
        stats.updated++;
      } else {
        // Unchanged
        stats.unchanged++;
      }
    }

    // Write new/updated records
    if (newRecords.length > 0) {
      await batchWriteRecords(newRecords);
    }

    // Delete stale records
    stats.deleted = await deleteStaleRecords(creds.clinicId, currentKeys, existingRecords);

    console.log(
      `[${creds.clinicId}] Sync complete: ${stats.added} added, ${stats.updated} updated, ${stats.deleted} deleted, ${stats.unchanged} unchanged`
    );
  } catch (error: any) {
    console.error(`[${creds.clinicId}] Error processing clinic: ${error.message}`);
  }

  return stats;
}

// Lambda handler
export const handler = async (event: any): Promise<any> => {
  const startTime = new Date();
  console.log('=== Starting Insurance Plan Sync ===');
  console.log(`Execution started at: ${startTime.toISOString()}`);

  const totalStats = { added: 0, updated: 0, deleted: 0, unchanged: 0, errors: 0 };
  let processedClinics = 0;

  // Process clinics sequentially to avoid SFTP connection limits
  for (const creds of CLINIC_CREDS) {
    try {
      const stats = await processClinic(creds);
      totalStats.added += stats.added;
      totalStats.updated += stats.updated;
      totalStats.deleted += stats.deleted;
      totalStats.unchanged += stats.unchanged;
      processedClinics++;
    } catch (error: any) {
      console.error(`Failed to process clinic ${creds.clinicId}: ${error.message}`);
      totalStats.errors++;
    }
  }

  const endTime = new Date();
  const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;

  console.log('\n=== Insurance Plan Sync Summary ===');
  console.log(`Total clinics: ${CLINIC_CREDS.length}`);
  console.log(`Successfully processed: ${processedClinics}`);
  console.log(`Errors: ${totalStats.errors}`);
  console.log(`Records added: ${totalStats.added}`);
  console.log(`Records updated: ${totalStats.updated}`);
  console.log(`Records deleted: ${totalStats.deleted}`);
  console.log(`Records unchanged: ${totalStats.unchanged}`);
  console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Insurance plan sync completed for ${processedClinics} clinics`,
      statistics: totalStats,
      executionTime: `${executionTime.toFixed(2)} seconds`,
      timestamp: endTime.toISOString(),
    }),
  };
};
