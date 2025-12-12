/**
 * Query Generator Lambda - Uses Bedrock Claude to generate SQL queries
 * 
 * This Lambda takes natural language requests about OpenDental data
 * and generates appropriate SQL queries using the OpenDental schema.
 * 
 * Model: Claude Sonnet 4.5 (via cross-region inference profile)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';
import * as path from 'path';
import { buildCorsHeaders } from '../../shared/utils/cors';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  // Claude Sonnet 4.5 requires cross-region inference profile (not direct model ID)
  MODEL_ID: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.2, // Lower temperature for more deterministic SQL output
};

// ========================================================================
// CLIENTS
// ========================================================================

const bedrockClient = new BedrockRuntimeClient({
  region: CONFIG.AWS_REGION,
  maxAttempts: 3,
});

// ========================================================================
// SCHEMA CACHE
// ========================================================================

interface TableColumn {
  name: string;
  type: string;
  summary?: string;
  fk?: string;
  enumeration?: {
    name: string;
    values: { value: number | string; name: string }[];
  };
}

interface TableSchema {
  name: string;
  summary: string;
  columns: TableColumn[];
}

interface SchemaCache {
  version: string;
  tables: TableSchema[];
  compactSchema: string;
}

// Schema is loaded once at cold start and cached for the Lambda lifetime
let schemaCache: SchemaCache | null = null;

// SQL Cheatsheet is loaded once at cold start and cached for the Lambda lifetime
let sqlCheatsheetCache: string | null = null;

// ========================================================================
// SCHEMA PROCESSING
// ========================================================================

/**
 * Load and parse the OpenDental schema from bundled file
 */
function loadSchema(): SchemaCache {
  // Return cached schema if already loaded
  if (schemaCache) {
    return schemaCache;
  }

  console.log('Loading schema from bundled file...');

  // Read schema from bundled file (same directory as this Lambda)
  const schemaPath = path.join(__dirname, 'schema.json');
  const schemaText = fs.readFileSync(schemaPath, 'utf-8');
  const rawSchema = JSON.parse(schemaText);
  
  const tables: TableSchema[] = [];

  // Parse the raw schema structure
  for (const table of rawSchema.database.table) {
    const columns: TableColumn[] = [];
    
    for (const col of table.column || []) {
      const column: TableColumn = {
        name: col.name,
        type: col.type,
        summary: col.summary,
      };

      if (col.fk) {
        column.fk = col.fk;
      }

      if (col.Enumeration) {
        // Handle both array and single object cases for EnumValue
        // (XML-to-JSON conversion sometimes produces a single object instead of an array)
        const enumValues = col.Enumeration.EnumValue;
        const enumArray = Array.isArray(enumValues) ? enumValues : (enumValues ? [enumValues] : []);
        
        column.enumeration = {
          name: col.Enumeration.name,
          values: enumArray.map((e: any) => ({
            value: e._ ?? e['#text'] ?? 0,
            name: e.name,
          })),
        };
      }

      columns.push(column);
    }

    tables.push({
      name: table.name,
      summary: table.summary || '',
      columns,
    });
  }

  // Create a compact schema representation for the prompt
  const compactSchema = generateCompactSchema(tables);

  schemaCache = {
    version: rawSchema.database.version,
    tables,
    compactSchema,
  };

  console.log(`Schema loaded: ${tables.length} tables, version ${rawSchema.database.version}`);
  
  return schemaCache;
}

/**
 * Generate a compact schema representation for Claude's context
 * Focus on key tables relevant to common dental practice queries
 */
function generateCompactSchema(tables: TableSchema[]): string {
  // Priority tables for dental practice queries
  const priorityTables = new Set([
    'appointment', 'patient', 'procedurelog', 'claimproc', 'claim',
    'payment', 'paysplit', 'adjustment', 'provider', 'operatory',
    'schedule', 'recall', 'treatplan', 'proctp', 'fee', 'feesched',
    'insplan', 'carrier', 'inssub', 'patplan', 'definition',
    'userod', 'employee', 'clockevent', 'commlog', 'rxpat',
    'document', 'sheet', 'referral', 'refattach', 'clinic'
  ]);

  const lines: string[] = [
    '# OpenDental Database Schema (Key Tables)',
    '',
  ];

  // First, add priority tables with full details
  for (const table of tables) {
    if (priorityTables.has(table.name.toLowerCase())) {
      lines.push(`## ${table.name}`);
      if (table.summary) {
        lines.push(`-- ${table.summary}`);
      }
      
      for (const col of table.columns) {
        let colLine = `  ${col.name} ${col.type}`;
        if (col.fk) {
          colLine += ` FK->${col.fk}`;
        }
        if (col.summary && col.summary !== '.') {
          colLine += ` -- ${col.summary.substring(0, 80)}`;
        }
        if (col.enumeration && col.enumeration.values.length > 0) {
          const enumVals = col.enumeration.values
            .slice(0, 5)
            .map(v => `${v.value}=${v.name}`)
            .join(', ');
          colLine += ` [${enumVals}${col.enumeration.values.length > 5 ? ', ...' : ''}]`;
        }
        lines.push(colLine);
      }
      lines.push('');
    }
  }

  // Add a summary of other tables
  lines.push('## Other Available Tables');
  const otherTables = tables
    .filter(t => !priorityTables.has(t.name.toLowerCase()))
    .map(t => t.name);
  
  // Group in chunks of 8 tables per line
  for (let i = 0; i < otherTables.length; i += 8) {
    lines.push(otherTables.slice(i, i + 8).join(', '));
  }

  return lines.join('\n');
}

/**
 * Find tables relevant to a specific query
 */
function findRelevantTables(query: string, tables: TableSchema[]): TableSchema[] {
  const queryLower = query.toLowerCase();
  const relevantTables: TableSchema[] = [];
  
  // Keywords that suggest certain tables
  const keywordTableMap: Record<string, string[]> = {
    'production': ['appointment', 'procedurelog', 'claimproc', 'fee'],
    'appointment': ['appointment', 'patient', 'provider', 'operatory', 'schedule'],
    'patient': ['patient', 'patplan', 'inssub', 'insplan'],
    'payment': ['payment', 'paysplit', 'patient', 'provider'],
    'claim': ['claim', 'claimproc', 'insplan', 'carrier', 'patient'],
    'insurance': ['insplan', 'inssub', 'carrier', 'patplan', 'claimproc'],
    'procedure': ['procedurelog', 'procedurecode', 'fee', 'appointment'],
    'schedule': ['schedule', 'appointment', 'provider', 'operatory'],
    'recall': ['recall', 'patient', 'recalltype'],
    'treatment': ['treatplan', 'proctp', 'patient', 'provider'],
    'writeoff': ['claimproc', 'procedurelog', 'insplan'],
    'revenue': ['payment', 'paysplit', 'procedurelog', 'adjustment'],
    'provider': ['provider', 'appointment', 'procedurelog', 'schedule'],
    'new patient': ['patient', 'appointment'],
    'adjustment': ['adjustment', 'patient', 'provider'],
    'hygiene': ['appointment', 'procedurelog', 'provider', 'recall'],
  };

  const neededTableNames = new Set<string>();

  for (const [keyword, tableNames] of Object.entries(keywordTableMap)) {
    if (queryLower.includes(keyword)) {
      tableNames.forEach(t => neededTableNames.add(t.toLowerCase()));
    }
  }

  // Always include core tables
  ['appointment', 'patient', 'procedurelog'].forEach(t => neededTableNames.add(t));

  for (const table of tables) {
    if (neededTableNames.has(table.name.toLowerCase())) {
      relevantTables.push(table);
    }
  }

  return relevantTables;
}

/**
 * Generate detailed schema for specific tables
 */
function generateDetailedSchema(tables: TableSchema[]): string {
  const lines: string[] = [];

  for (const table of tables) {
    lines.push(`## Table: ${table.name}`);
    if (table.summary) {
      lines.push(`Description: ${table.summary}`);
    }
    lines.push('Columns:');
    
    for (const col of table.columns) {
      let colLine = `  - ${col.name}: ${col.type}`;
      if (col.fk) {
        colLine += ` (FK -> ${col.fk})`;
      }
      if (col.summary && col.summary !== '.') {
        colLine += ` -- ${col.summary}`;
      }
      lines.push(colLine);

      if (col.enumeration && col.enumeration.values.length > 0) {
        lines.push(`    Enum ${col.enumeration.name}:`);
        for (const v of col.enumeration.values) {
          lines.push(`      ${v.value} = ${v.name}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ========================================================================
// SQL CHEATSHEET
// ========================================================================

/**
 * Load the SQL cheatsheet from bundled file and format it for the prompt
 */
function loadSqlCheatsheet(): string {
  // Return cached cheatsheet if already loaded
  if (sqlCheatsheetCache) {
    return sqlCheatsheetCache;
  }

  console.log('Loading SQL cheatsheet from bundled file...');

  try {
    const cheatsheetPath = path.join(__dirname, 'sqlcheatsheet.json');
    const cheatsheetText = fs.readFileSync(cheatsheetPath, 'utf-8');
    const rawCheatsheet = JSON.parse(cheatsheetText);

    // Format the cheatsheet into a readable reference for the prompt
    const lines: string[] = [
      '# MySQL Syntax Reference',
      '',
    ];

    const syntaxRef = rawCheatsheet.MySQL_Comprehensive_Syntax_Reference;
    if (syntaxRef) {
      for (const [sectionKey, sectionItems] of Object.entries(syntaxRef)) {
        // Format section name (e.g., "5_Core_Querying_Select_Variations" -> "Core Querying - Select Variations")
        const sectionName = sectionKey
          .replace(/^\d+_/, '')
          .replace(/_/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2');
        
        lines.push(`## ${sectionName}`);
        
        if (Array.isArray(sectionItems)) {
          for (const item of sectionItems as any[]) {
            lines.push(`### ${item.topic}`);
            lines.push(`Syntax: ${item.syntax}`);
            if (item.description) {
              lines.push(`Description: ${item.description}`);
            }
            lines.push(`Example: ${item.example}`);
            lines.push('');
          }
        }
      }
    }

    sqlCheatsheetCache = lines.join('\n');
    console.log('SQL cheatsheet loaded successfully');
    
    return sqlCheatsheetCache;
  } catch (error) {
    console.warn('Failed to load SQL cheatsheet:', error);
    return ''; // Return empty string if cheatsheet cannot be loaded
  }
}

// ========================================================================
// SYSTEM PROMPT TEMPLATE
// ========================================================================

/**
 * Generalized system prompt template with dynamic placeholders for schema and cheatsheet content.
 * The placeholders ${schemaContent} and ${cheatsheetContent} are replaced at runtime
 * with the actual content loaded from schema.json and sqlcheatsheet.json.
 */
const SYSTEM_PROMPT_TEMPLATE = `You are an expert SQL query generator specializing in the OpenDental practice management software database. Your task is to translate user requests into accurate, efficient, and production-ready MySQL queries.

**CRITICAL INSTRUCTIONS:**

1.  **Model Identity:** You are running on Claude Sonnet 4.5, Anthropic's best model for complex agentic coding.
2.  **Dialect:** Use only standard MySQL syntax.
3.  **Schema Use:** You MUST use the tables and columns provided in the <schema> block below. Never invent table or column names. The model should know about all tables and attributes provided by the OpenDental schema.
4.  **Output Format:** Your final output MUST be only the raw SQL query, enclosed within a single set of \`\`\`sql...\`\`\` markdown tags. Do not include any explanation or comments outside of the code block.
5.  **Date Variables:** For dynamic date filtering, use the placeholder variables \${startDate} and \${endDate} in the WHERE clause (e.g., WHERE ProcDate BETWEEN '\${startDate}' AND '\${endDate}').
6.  **Context:** Use the knowledge in the <mysql_cheatsheet> to ensure complex SQL is correctly formatted.

═══════════════════════════════════════════════════════════════════════════════
STANDARD TABLE ALIASES (USE THESE EXACTLY)
═══════════════════════════════════════════════════════════════════════════════
provider      → prov     | patient       → p      | procedurelog  → pl
claimproc     → cp       | adjustment    → a      | paysplit      → ps
appointment   → apt      | procedurecode → pc     | definition    → def

═══════════════════════════════════════════════════════════════════════════════
QUERY ROUTING LOGIC (DETERMINE GROUPING FIRST)
═══════════════════════════════════════════════════════════════════════════════

STEP 1: Identify the SUBJECT of the request:
┌─────────────────┬──────────────────────────────────────────────────────────┐
│ Subject         │ Action                                                   │
├─────────────────┼──────────────────────────────────────────────────────────┤
│ "by provider"   │ FROM provider prov, GROUP BY prov.ProvNum, prov.Abbr     │
│                 │ JOIN on ProvNum. SELECT prov.Abbr first.                 │
├─────────────────┼──────────────────────────────────────────────────────────┤
│ "by patient"    │ FROM patient p, GROUP BY p.PatNum                        │
│                 │ JOIN on PatNum. SELECT p.LName, p.FName first.           │
├─────────────────┼──────────────────────────────────────────────────────────┤
│ "by date/daily" │ GROUP BY the date column (pl.ProcDate, ps.DatePay, etc.) │
│                 │ Format dates with DATE_FORMAT if needed.                 │
├─────────────────┼──────────────────────────────────────────────────────────┤
│ "total/summary" │ No GROUP BY - return aggregate totals only               │
└─────────────────┴──────────────────────────────────────────────────────────┘

STEP 2: Identify the METRIC being requested (see Financial Formulas section).

═══════════════════════════════════════════════════════════════════════════════
OPEN DENTAL FINANCIAL FORMULAS (USE EXACTLY)
═══════════════════════════════════════════════════════════════════════════════

GROSS PRODUCTION:
  COALESCE(SUM(pl.ProcFee), 0)
  Filter: pl.ProcStatus = 2 (Complete procedures only)
  Date column: pl.ProcDate

ADJUSTMENTS:
  COALESCE(SUM(a.AdjAmt), 0)
  Note: Usually NEGATIVE values (discounts). We ADD them.
  Date column: a.AdjDate

WRITEOFFS (Insurance contractual):
  COALESCE(SUM(cp.WriteOff), 0)
  Filter: cp.Status IN (0, 1, 4) -- Estimate, Received, Supplemental
  Note: POSITIVE values. We SUBTRACT them.
  Date column: cp.ProcDate

NET PRODUCTION:
  (COALESCE(SUM(pl.ProcFee), 0) + COALESCE(SUM(a.AdjAmt), 0) - COALESCE(SUM(cp.WriteOff), 0))
  Requires LEFT JOINs to: procedurelog, adjustment, claimproc

PATIENT PAYMENTS:
  COALESCE(SUM(ps.SplitAmt), 0)
  Date column: ps.DatePay

INSURANCE PAYMENTS:
  COALESCE(SUM(cp.InsPayAmt), 0)
  Filter: cp.Status IN (1, 4) -- Received, Supplemental
  Date column: cp.DateCP

TOTAL INCOME/COLLECTIONS:
  (COALESCE(SUM(ps.SplitAmt), 0) + COALESCE(SUM(cp.InsPayAmt), 0))
  Requires LEFT JOINs to: paysplit, claimproc

═══════════════════════════════════════════════════════════════════════════════
STATUS CODES REFERENCE
═══════════════════════════════════════════════════════════════════════════════

procedurelog.ProcStatus:
  1 = Treatment Planned | 2 = Complete | 3 = Existing Current | 4 = Existing Other
  5 = Referred | 6 = Deleted | 7 = Condition

claimproc.Status:
  0 = Estimate | 1 = Received | 2 = Preauth | 4 = Supplemental | 5 = CapClaim
  6 = CapEstimate | 7 = CapComplete

appointment.AptStatus:
  1 = Scheduled | 2 = Complete | 3 = UnschedList | 4 = ASAP | 5 = Broken
  6 = Planned | 7 = PtNote | 8 = PtNoteCompleted

═══════════════════════════════════════════════════════════════════════════════
DATE HANDLING
═══════════════════════════════════════════════════════════════════════════════

ALWAYS use these placeholders: BETWEEN '\${startDate}' AND '\${endDate}'

Date columns by context:
• Production/Procedures: pl.ProcDate
• Adjustments: a.AdjDate  
• Writeoffs: cp.ProcDate
• Insurance payments: cp.DateCP
• Patient payments: ps.DatePay
• Appointments: apt.AptDateTime (use DATE(apt.AptDateTime) for date comparison)

═══════════════════════════════════════════════════════════════════════════════
FEW-SHOT EXAMPLES (FOLLOW THESE PATTERNS EXACTLY)
═══════════════════════════════════════════════════════════════════════════════

INPUT: "Net production by provider"
OUTPUT: 
\`\`\`sql
SELECT prov.ProvNum, prov.Abbr, (COALESCE(SUM(pl.ProcFee),0) + COALESCE(SUM(a.AdjAmt),0) - COALESCE(SUM(cp.WriteOff),0)) AS NetProduction FROM provider prov LEFT JOIN procedurelog pl ON prov.ProvNum = pl.ProvNum AND pl.ProcStatus = 2 AND pl.ProcDate BETWEEN '\${startDate}' AND '\${endDate}' LEFT JOIN adjustment a ON prov.ProvNum = a.ProvNum AND a.AdjDate BETWEEN '\${startDate}' AND '\${endDate}' LEFT JOIN claimproc cp ON prov.ProvNum = cp.ProvNum AND cp.Status IN (0,1,4) AND cp.ProcDate BETWEEN '\${startDate}' AND '\${endDate}' GROUP BY prov.ProvNum, prov.Abbr ORDER BY NetProduction DESC
\`\`\`

INPUT: "Collections by patient"
OUTPUT:
\`\`\`sql
SELECT p.PatNum, p.LName, p.FName, (COALESCE(SUM(ps.SplitAmt),0) + COALESCE(SUM(cp.InsPayAmt),0)) AS TotalCollections FROM patient p LEFT JOIN paysplit ps ON p.PatNum = ps.PatNum AND ps.DatePay BETWEEN '\${startDate}' AND '\${endDate}' LEFT JOIN claimproc cp ON p.PatNum = cp.PatNum AND cp.Status IN (1,4) AND cp.DateCP BETWEEN '\${startDate}' AND '\${endDate}' GROUP BY p.PatNum, p.LName, p.FName HAVING TotalCollections > 0 ORDER BY TotalCollections DESC
\`\`\`

INPUT: "Daily production summary"
OUTPUT:
\`\`\`sql
SELECT pl.ProcDate, COALESCE(SUM(pl.ProcFee),0) AS GrossProduction, COALESCE(SUM(a.AdjAmt),0) AS Adjustments, COALESCE(SUM(cp.WriteOff),0) AS Writeoffs, (COALESCE(SUM(pl.ProcFee),0) + COALESCE(SUM(a.AdjAmt),0) - COALESCE(SUM(cp.WriteOff),0)) AS NetProduction FROM procedurelog pl LEFT JOIN adjustment a ON pl.PatNum = a.PatNum AND a.AdjDate = pl.ProcDate LEFT JOIN claimproc cp ON pl.ProcNum = cp.ProcNum AND cp.Status IN (0,1,4) WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN '\${startDate}' AND '\${endDate}' GROUP BY pl.ProcDate ORDER BY pl.ProcDate
\`\`\`

INPUT: "Total production for the period"
OUTPUT:
\`\`\`sql
SELECT COALESCE(SUM(pl.ProcFee),0) AS GrossProduction, COALESCE(SUM(a.AdjAmt),0) AS Adjustments, COALESCE(SUM(cp.WriteOff),0) AS Writeoffs, (COALESCE(SUM(pl.ProcFee),0) + COALESCE(SUM(a.AdjAmt),0) - COALESCE(SUM(cp.WriteOff),0)) AS NetProduction FROM procedurelog pl LEFT JOIN adjustment a ON pl.PatNum = a.PatNum AND a.AdjDate BETWEEN '\${startDate}' AND '\${endDate}' LEFT JOIN claimproc cp ON pl.ProcNum = cp.ProcNum AND cp.Status IN (0,1,4) WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN '\${startDate}' AND '\${endDate}'
\`\`\`

INPUT: "Scheduled appointments by provider"
OUTPUT:
\`\`\`sql
SELECT prov.ProvNum, prov.Abbr, COUNT(apt.AptNum) AS AppointmentCount FROM provider prov LEFT JOIN appointment apt ON prov.ProvNum = apt.ProvNum AND apt.AptStatus = 1 AND DATE(apt.AptDateTime) BETWEEN '\${startDate}' AND '\${endDate}' GROUP BY prov.ProvNum, prov.Abbr ORDER BY AppointmentCount DESC
\`\`\`

═══════════════════════════════════════════════════════════════════════════════
COMMON PITFALLS (AVOID THESE)
═══════════════════════════════════════════════════════════════════════════════

✗ DON'T: Mix ProvNum and PatNum joins incorrectly
✓ DO: Match the join key to the grouping entity

✗ DON'T: Forget COALESCE for SUM operations  
✓ DO: Always wrap SUM with COALESCE(SUM(...), 0)

✗ DON'T: Use INNER JOIN for financial reports (excludes zeros)
✓ DO: Use LEFT JOIN to include providers/patients with no activity

✗ DON'T: Forget date filters on joined tables
✓ DO: Apply date range in JOIN condition for LEFT JOINs

✗ DON'T: Use claimproc without Status filter
✓ DO: Always filter cp.Status IN (0,1,4) for writeoffs, (1,4) for payments

<schema>
\${schemaContent}
</schema>

<mysql_cheatsheet>
\${cheatsheetContent}
</mysql_cheatsheet>
`;

/**
 * Build the complete system prompt by injecting schema and cheatsheet content
 * into the template placeholders.
 */
function buildSystemPrompt(schemaContent: string, cheatsheetContent: string): string {
  return SYSTEM_PROMPT_TEMPLATE
    .replace('${schemaContent}', schemaContent)
    .replace('${cheatsheetContent}', cheatsheetContent);
}

// ========================================================================
// EXAMPLE QUERIES
// ========================================================================

const EXAMPLE_QUERIES: { request: string; query: string }[] = [
  {
    request: "production report",
    query: `SELECT
        DATE(ap.AptDateTime) AS transDate,
        DAYNAME(ap.AptDateTime) AS weekDay,
        COALESCE(SUM(prod.grossProd), 0) AS scheduledProd,
        COALESCE(SUM(prod.writeoff), 0) AS writeoff,
        (COALESCE(SUM(prod.grossProd), 0) - COALESCE(SUM(prod.writeoff), 0)) AS netProdBefore,
        COUNT(DISTINCT CASE WHEN ap.IsNewPatient = 1 THEN ap.PatNum ELSE NULL END) as newPatients,
        COUNT(DISTINCT ap.PatNum) as totalPatients
      FROM appointment ap
      LEFT JOIN (
          SELECT
              pl.AptNum,
              SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) as grossProd,
              SUM(COALESCE(wo.TotalWriteOff, 0)) as writeoff
          FROM procedurelog pl
          LEFT JOIN (
              SELECT ProcNum, SUM(WriteOff) AS TotalWriteOff
              FROM claimproc WHERE Status IN (0, 1, 4)
              GROUP BY ProcNum
          ) AS wo ON pl.ProcNum = wo.ProcNum
          WHERE pl.ProcStatus = 2 AND pl.AptNum != 0
          GROUP BY pl.AptNum
      ) AS prod ON ap.AptNum = prod.AptNum
      WHERE ap.AptStatus = 2 -- Completed Appointments
        AND ap.AptDateTime BETWEEN '\${startDate}' AND DATE_ADD('\${endDate}', INTERVAL 1 DAY)
      GROUP BY DATE(ap.AptDateTime)
      ORDER BY transDate;`
  },
  {
    request: "daily collection report",
    query: `SELECT
        DATE(p.PayDate) AS paymentDate,
        DAYNAME(p.PayDate) AS dayOfWeek,
        COUNT(*) AS paymentCount,
        SUM(p.PayAmt) AS totalCollected,
        SUM(CASE WHEN p.PayType = 0 THEN p.PayAmt ELSE 0 END) AS cashPayments,
        SUM(CASE WHEN p.PayType = 1 THEN p.PayAmt ELSE 0 END) AS checkPayments,
        SUM(CASE WHEN p.PayType = 2 THEN p.PayAmt ELSE 0 END) AS cardPayments
      FROM payment p
      WHERE p.PayDate BETWEEN '\${startDate}' AND '\${endDate}'
      GROUP BY DATE(p.PayDate)
      ORDER BY paymentDate;`
  },
    {
      request: "Claims sent on a specific date with sent status",
      query: "SELECT * FROM claim WHERE DateSent ='2005-04-19' AND ClaimStatus='S'"
    },
    {
      request: "All treatment planned procedures, ordered by patient",
      query: "SELECT CONCAT( UPPER(SUBSTRING(p.LName, 1, 1)) ,SUBSTRING(p.LName, 2, LENGTH(p.LName)-1) ,',' ,IF( LENGTH(p.Preferred) > 0 ,CONCAT( ' \\'' ,UPPER(SUBSTRING(p.Preferred, 1, 1)) ,SUBSTRING(p.Preferred, 2, LENGTH(p.Preferred)-1) ,'\\' ' ) ,' ' ) ,UPPER(SUBSTRING(p.FName, 1, 1)) ,SUBSTRING(p.FName, 2, LENGTH(p.FName)-1) ,IF( LENGTH(p.MiddleI) > 0 ,CONCAT( ' ' ,UPPER(SUBSTRING(p.MiddleI, 1, 1)) ,SUBSTRING(p.MiddleI, 2, LENGTH(p.MiddleI)-1) ) ,'' ) ) AS 'Patient Name' ,p.PatNum AS 'Patient ID' ,pc.ProcCode ,(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS ProcFee ,pl.Surf ,pl.ToothNum FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum INNER JOIN patient p ON p.PatNum = pl.PatNum WHERE pl.ProcStatus=1 ORDER BY pl.PatNum"
    },
    {
      request: "Patients with birthdays in a specific date range",
      query: "SELECT LName,FName,Address,Address2,City,State,Zip,Birthdate FROM patient WHERE SUBSTRING(Birthdate,6,5) >= '10-06' AND SUBSTRING(Birthdate,6,5) <= '10-13' AND PatStatus=0 ORDER BY LName,FName"
    },
    {
      request: "Daily patient payments organized by chart number and date entry.",
      query: "SELECT payment.PayDate, payment.DateEntry, patient.ChartNumber, CONCAT(patient.LName,', ',patient.FName,' ',patient.MiddleI) AS plfname, payment.PayType,payment.CheckNum,payment.PayAmt FROM payment,patient WHERE payment.PatNum = patient.PatNum AND payment.PayAmt > 0 AND payment.DateEntry =CURDATE() ORDER BY payment.DateEntry, patient.ChartNumber"
    },
    {
      request: "Daily Insurance payments organized by chart number",
      query: "SET @CheckDate = '2024-03-29'; SELECT patient.ChartNumber ,CONCAT(patient.LName,', ',patient.FName,' ',patient.MiddleI) AS 'Name' ,claimpayment.CheckDate ,carrier.CarrierName ,claimpayment.CheckNum ,claimproc.ClaimNum ,SUM(claimproc.InsPayAmt) AS $Amt FROM claimpayment INNER JOIN claimproc ON claimproc.ClaimPaymentNum = claimpayment.ClaimPaymentNum AND claimproc.Status IN (1,4) INNER JOIN insplan ON claimproc.PlanNum = insplan.PlanNum INNER JOIN carrier ON carrier.CarrierNum = insplan.CarrierNum INNER JOIN patient ON claimproc.PatNum = patient.PatNum WHERE claimpayment.CheckDate = @CheckDate GROUP BY claimproc.ClaimNum"
    },
    {
      request: "Patient aging report with last payment date",
      query: "SELECT CONCAT(LName,', ',FName,' ',MiddleI) ,Bal_0_30,Bal_31_60,Bal_61_90,BalOver90 ,BalTotal,InsEst,BalTotal-InsEst AS $pat, DATE_FORMAT(MAX(paysplit.ProcDate),'%m/%d/%Y') AS lastPayment FROM patient LEFT JOIN paysplit ON paysplit.PatNum=patient.PatNum WHERE (patstatus != 2) AND (Bal_0_30 > '.005' OR Bal_31_60 > '.005' OR Bal_61_90 > '.005' OR BalOver90 > '.005' OR BalTotal < '-.005') GROUP BY patient.PatNum ORDER BY LName,FName"
    },
    {
      request: "Patient aging report with chart numbers",
      query: "SELECT ChartNumber,CONCAT(LName,', ',FName,' ',MiddleI) AS Patient ,Bal_0_30,Bal_31_60,Bal_61_90,BalOver90 ,BalTotal,InsEst,BalTotal-InsEst AS $pat FROM patient WHERE (patstatus != 2) AND (Bal_0_30 > '.005' OR Bal_31_60 > '.005' OR Bal_61_90 > '.005' OR BalOver90 > '.005' OR BalTotal < '-.005') ORDER BY LName,FName"
    },
    {
      request: "Daily procedures report which includes chart numbers",
      query: "SET @FromDate = '2022-01-01', @ToDate = '2022-01-31'; SELECT pl.ProcDate ,pa.ChartNumber ,CONCAT(pa.LName,', ',pa.FName,' ',pa.MiddleI) AS PatName ,pc.ProcCode ,pl.ToothNum ,pc.Descript ,pr.Abbr ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) - (CASE WHEN ISNULL(claimproc.WriteOff) THEN 0 ELSE (SUM(claimproc.WriteOff)) END) AS \"$Fee_\" FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pr ON pr.ProvNum = pl.ProvNum LEFT JOIN claimproc ON pl.ProcNum = claimproc.ProcNum AND claimproc.Status = 7 WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY pl.ProcNum ORDER BY pl.ProcDate,PatName"
    },
    {
      request: "Estimated balances for patients with an appointment on a specific day",
      query: "SET @AptDateTime ='2024-03-12'; SET @AsOf=CURDATE(); SET @PayPlanVersion=IFNULL((SELECT ValueString FROM preference WHERE prefName LIKE 'PayPlansVersion'),1); SELECT appointment.AptDateTime ,patient.LName ,patient.FName ,FORMAT(IFNULL(aging.PatBal,0),2) AS 'PatEstBalance' FROM appointment INNER JOIN patient ON appointment.PatNum = patient.PatNum LEFT JOIN ( SELECT D.PatNum ,ROUND(D.PatBal,2) AS 'PatBal' FROM ( SELECT p.PatNum ,p.LName ,p.FName ,SUM(B.PatBal) AS 'PatBal' FROM ( SELECT RawPatTrans.PatNum ,SUM(RawPatTrans.TranAmount) AS 'PatBal' FROM ( SELECT 'Fee' AS 'TranType' ,pl.PatNum AS 'PatNum' ,pl.ProcDate AS 'TranDate' ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS 'TranAmount' FROM procedurelog pl WHERE pl.ProcStatus = 2 UNION ALL SELECT 'Pay' AS 'TranType' ,ps.PatNum AS 'PatNum' ,ps.DatePay AS 'TranDate' ,(CASE WHEN @PayPlanVersion IN (1,3) THEN (CASE WHEN ps.PayPlanNum=0 THEN -ps.SplitAmt ELSE 0 END) ELSE -ps.SplitAmt END) AS 'TranAmount' FROM paysplit ps WHERE ps.SplitAmt!=0 UNION ALL SELECT 'Adj' AS 'TranType' ,a.PatNum AS 'PatNum' ,a.AdjDate AS 'TranDate' ,a.AdjAmt AS 'TranAmount' FROM adjustment a WHERE a.AdjAmt!=0 UNION ALL SELECT 'InsPay' AS 'TranType' ,cp.PatNum AS 'PatNum' ,cp.DateCp AS 'TranDate' ,(CASE WHEN cp.payplannum = 0 THEN -cp.InsPayAmt ELSE 0 END)-cp.Writeoff AS 'TranAmount' FROM claimproc cp WHERE cp.Status IN (1,4,5,7) UNION ALL SELECT 'PayPlan1' AS 'TranType' ,pp.PatNum AS 'PatNum' ,pp.PayPlanDate AS 'TranDate' ,-pp.CompletedAmt AS 'TranAmount' FROM payplan pp WHERE @PayPlanVersion = 1 AND pp.CompletedAmt!=0 UNION ALL SELECT 'PayPlan2' AS 'TranType' ,ppc.PatNum AS 'PatNum' ,ppc.ChargeDate AS 'TranDate' ,(CASE WHEN ppc.ChargeType != 0 THEN -ppc.Principal WHEN pplan.PlanNum = 0 THEN ppc.Principal + ppc.Interest ELSE 0 END) AS 'TranAmount' FROM payplancharge ppc LEFT JOIN payplan pplan ON pplan.PayPlanNum = ppc.PayPlanNum WHERE @PayPlanVersion = 2 AND ChargeDate <= @AsOf UNION ALL SELECT 'PayPlan3' AS 'TranType' ,ppc.PatNum AS 'PatNum' ,ppc.ChargeDate AS 'TranDate' ,-ppc.Principal AS 'TranAmount' FROM payplancharge ppc LEFT JOIN payplan pp ON pp.PayPlanNum = ppc.PayPlanNum WHERE ppc.ChargeDate <= @AsOf AND ppc.ChargeType = 1 AND @PayPlanVersion = 3 ) RawPatTrans WHERE TranDate <= @AsOf GROUP BY RawPatTrans.PatNum ) B LEFT JOIN ( SELECT cp.PatNum ,SUM(cp.InsPayEst) AS 'InsEst' ,SUM(cp.Writeoff) AS 'Writeoff' FROM claimproc cp WHERE cp.PatNum!=0 AND ((cp.Status = 0 AND cp.ProcDate<=@AsOf) OR (cp.Status = 1 AND cp.DateCP>@AsOf)) AND cp.ProcDate<=@ASOf GROUP BY cp.PatNum ) C ON C.PatNum = B.PatNum INNER JOIN patient p ON p.PatNum = B.PatNum GROUP BY p.PatNum )D )aging ON aging.PatNum = patient.PatNum WHERE appointment.AptDateTime BETWEEN @AptDateTime AND @AptDateTime + INTERVAL 1 DAY AND AptStatus != 6 AND AptStatus != 3"
    },
    {
      request: "Non-completed appointments with associated lab cases",
      query: "SELECT PatNum,AptDateTime,AptStatus FROM appointment a WHERE AptStatus!='2' AND (SELECT COUNT(*) FROM labcase c WHERE c.AptNum=a.AptNum)>0 ORDER BY AptDateTime"
    },
    {
      request: "OBSOLETE, if you need a query like this one, you must request it from us or compose it",
      query: "SELECT definition.ItemName,SUM(claimproc.FeeBilled) AS Production FROM definition,claimproc,insplan WHERE definition.Category=7 AND definition.DefNum=insplan.FeeSched AND insplan.PlanNum=claimproc.PlanNum AND claimproc.ProcDate >= '2005-04-01' AND claimproc.ProcDate < '2005-05-01' GROUP BY definition.DefNum ORDER BY definition.ItemOrder"
    },
    {
      request: "Treatment planned procedures showing patient, procedure code, and procedure fee",
      query: "SELECT pl.PatNum ,pc.ProcCode ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS \"$ProcFee_\" FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum WHERE pl.ProcStatus = 1 ORDER BY ProcFee DESC;"
    },
    {
      request: "Public Health Raw Population Data.  This query will not work on versions 7.8.1 or higher of Open Dental as the school table was removed.",
      query: "DROP TABLE IF EXISTS tempbroken; CREATE TEMPORARY TABLE tempbroken( PatNum mediumint unsigned NOT NULL, NumberBroken smallint NOT NULL, PRIMARY KEY (PatNum)); INSERT INTO tempbroken SELECT PatNum,COUNT(*) FROM adjustment WHERE AdjType=14 AND AdjDate >= '2005-09-01' AND AdjDate <='2005-09-30' GROUP BY PatNum; SELECT patient.PatNum,MIN(procedurelog.ProcDate) AS ProcDate, CONCAT(provider.LName,', ',provider.FName) as ProvName, County,county.CountyCode,GradeSchool,school.SchoolCode, GradeLevel,Birthdate,Race,Gender,Urgency,BillingType, patient.NextAptNum='-1' AS Done, tempbroken.NumberBroken FROM patient,provider LEFT JOIN procedurelog ON procedurelog.PatNum=patient.PatNum LEFT JOIN school ON patient.GradeSchool=school.SchoolName LEFT JOIN county ON patient.County=county.CountyName LEFT JOIN tempbroken ON tempbroken.PatNum=patient.PatNum WHERE (procedurelog.ProcStatus='2' AND procedurelog.ProvNum=provider.ProvNum AND procedurelog.ProcDate >='2005-09-01' AND procedurelog.ProcDate <='2005-09-30') OR tempbroken.NumberBroken>0 GROUP BY patient.PatNum ORDER By ProcDate; DROP TABLE IF EXISTS tempbroken;"
    },
    {
      request: "Daily Procedures: Grouped by Procedure Code. Like Internal",
      query: "SET @FromDate = '2020-04-01', @ToDate = '2020-04-20'; SELECT def.ItemName AS 'Category', pc.ProcCode AS 'Code', pc.Descript AS 'request', COUNT(*) AS 'Quantity', FORMAT(AVG(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)),2) AS '$AvgFee_', FORMAT(SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)),2) AS '$TotFee_' FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN definition def ON def.DefNum = pc.ProcCat WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY pc.ProcCode ORDER BY def.ItemOrder, pc.ProcCode;"
    },
    {
      request: "A list of all referrals you have received for a user specific date range.\r\nFor Versions 17.1 and greater. Please update your version accordingly.",
      query: "SET @FromDate='2018-01-01', @ToDate='2018-01-31'; SELECT referral.LName, referral.FName, COUNT(*) FROM referral INNER JOIN refattach ON referral.ReferralNum=refattach.ReferralNum AND refattach.RefType = 1 AND refattach.RefDate BETWEEN @FromDate AND @ToDate GROUP BY referral.ReferralNum"
    },
    {
      request: "For public health clinics, the production by Site (Gradeschool).",
      query: "SET @FromDate='2024-04-19', @ToDate='2024-04-21'; SELECT SUM(procedurelog.ProcFee) ,patient.SiteNum FROM procedurelog,patient WHERE procedurelog.PatNum = patient.PatNum AND procedurelog.ProcStatus = 2 AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY patient.SiteNum ORDER BY patient.SiteNum"
    },
    {
      request: "Patient count by grade school for procedures in date range",
      query: "SELECT patient.GradeSchool,COUNT(DISTINCT patient.PatNum) AS patients FROM patient,procedurelog WHERE patient.PatNum=procedurelog.PatNum AND procedurelog.ProcDate >= '2005-10-01' AND procedurelog.ProcDate < '2005-11-01' GROUP BY patient.GradeSchool"
    },
    {
      request: "Patient count by billing type excluding deleted patients",
      query: "SELECT BillingType,COUNT(*)FROM patient WHERE PatStatus != 4 GROUP BY BillingType"
    },
    {
      request: "New patients with first visit in date range",
      query: "SELECT * FROM patient WHERE DateFirstVisit >= '2005-10-01' AND DateFirstVisit < '2005-11-01' AND patient.patstatus = '0'"
    },
    {
      request: "List of referral sources, how many unique patients referred, and how much production from each source. Limited to Referred From referral sources for patients with a completed procedure in the specified date range. Similar to the internal Referral Analysis report.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SELECT GROUP_CONCAT(pcode.CodeNum) INTO @BrokenCodeNums FROM procedurecode pcode WHERE pcode.ProcCode IN ('D9986','D9987'); SELECT IF(dup.Num = 1, core.LName,'') AS 'Last Name' , IF(dup.Num = 1, core.FName,'') AS 'First Name' , IF(dup.Num = 1, core.Count,'') AS 'Count' , FORMAT(IF(dup.Num = 1,core.Production, SUM(core.Production)),2) AS 'Production' FROM ( SELECT r.ReferralNum , r.LName , r.FName , COUNT(DISTINCT rattach.PatNum) AS 'Count' , SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS 'Production' FROM referral r INNER JOIN ( SELECT ra.PatNum , ra.ReferralNum FROM refattach ra WHERE ra.RefType = 1 GROUP BY ra.PatNum, ra.ReferralNum ) rattach ON rattach.ReferralNum = r.ReferralNum INNER JOIN procedurelog pl ON pl.PatNum = rattach.PatNum AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 AND !FIND_IN_SET(pl.CodeNum, @BrokenCodeNums) GROUP BY r.ReferralNum ) core LEFT JOIN ( SELECT 1 AS 'Num' UNION ALL SELECT 2 ) dup ON TRUE GROUP BY IF(dup.Num = 1, CONCAT(dup.Num,'+', core.ReferralNum), dup.Num) ORDER BY dup.Num, core.Count DESC, core.LName, core.FName, core.ReferralNum"
    },
    {
      request: "Count of distinct patients with a procedure completed in the specified date range",
      query: "SET @FromDate = '2022-01-01', @ToDate = '2022-01-31'; SELECT COUNT(DISTINCT PatNum) FROM procedurelog pl WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate)"
    },
    {
      request: "Payment plans started in date range with first charge date",
      query: "SELECT patient.LName,patient.FName,MIN(payplancharge.ChargeDate) AS FirstCharge FROM payplancharge,patient WHERE payplancharge.Guarantor=patient.PatNum GROUP BY PayPlanNum HAVING FirstCharge >= '2006-03-01' AND FirstCharge < '2006-04-01'"
    },
    {
      request: "Payment plans with last charge in date range",
      query: "SELECT patient.LName,patient.FName,MAX(payplancharge.ChargeDate) AS LastCharge FROM payplancharge,patient WHERE payplancharge.Guarantor=patient.PatNum GROUP BY PayPlanNum HAVING LastCharge >= '2006-07-01' AND LastCharge < '2006-08-01'"
    },
    {
      request: "Payment plan charges in date range ordered by billing type and patient name",
      query: "SELECT LName,FName,BillingType,ChargeDate FROM payplancharge,patient WHERE payplancharge.Guarantor=patient.PatNum AND ChargeDate >= '2006-03-01' AND ChargeDate < '2006-04-01' ORDER BY BillingType,LName,FName"
    },
    {
      request: "A list of all subscribers who have a particular carrier. In the example, it's for Delta, but you can substitute your own search string between the %'s.",
      query: "SET @Carrier = '%Delta%'; SELECT c.CarrierName ,p.LName ,p.FName ,p.Address ,p.Address2 ,p.City ,p.State ,p.Zip FROM patient p INNER JOIN inssub iss ON iss.Subscriber = p.PatNum INNER JOIN insplan ip ON ip.PlanNum = iss.PlanNum INNER JOIN carrier c ON ip.CarrierNum = c.CarrierNum WHERE c.CarrierName LIKE @Carrier ORDER BY c.CarrierName"
    },
    {
      request: "A list of referrals during a specific date range.",
      query: "SET @FromDate='2016-04-19', @ToDate='2016-04-21'; SELECT patient.PatNum, patient.LName, patient.FName, patient.MiddleI, patient.Preferred, patient.Salutation, patient.Address, patient.Address2, patient.City, patient.State, patient.Zip , referral.LName AS RefLName, referral.FName AS RefFName, referral.MName AS RefMName, referral.Title AS RefTitle, referral.Address AS RefAddress, referral.Address2 AS RefAddress2, referral.City AS RefCity, referral.ST AS RefST, referral.Zip AS RefZip, referral.Specialty AS RefSpecialty FROM patient INNER JOIN refattach ON patient.PatNum=refattach.PatNum AND refattach.RefType = 1 AND refattach.RefDate BETWEEN @FromDate AND @ToDate INNER JOIN referral ON referral.ReferralNum=refattach.ReferralNum AND referral.NotPerson = '0' ORDER BY referral.Specialty, referral.LName, referral.FName"
    },
    {
      request: "Completed procedures without associated insurance claims",
      query: "SELECT procedurelog.PatNum, claimproc.ProcNum, procedurelog.ProcDate, procedurelog.ProcStatus, patient.LName, patient.FName, carrier.CarrierName, insplan.CarrierNum FROM procedurelog LEFT JOIN patient ON procedurelog.PatNum = patient.PatNum LEFT JOIN claimproc ON procedurelog.ProcNum = claimproc.ProcNum LEFT JOIN patplan ON patient.PatNum=patPlan.PatNum LEFT JOIN inssub ON patplan.InsSubNum=inssub.InsSubNum LEFT JOIN insplan ON inssub.PlanNum = insplan.PlanNum LEFT JOIN carrier ON insplan.CarrierNum = carrier.CarrierNum GROUP BY procedurelog.PatNum, claimproc.ProcNum, procedurelog.ProcDate, procedurelog.ProcStatus, patient.LName, patient.FName, carrier.CarrierName, insplan.CarrierNum HAVING claimproc.ProcNum IS NULL AND procedurelog.ProcStatus=2 ORDER BY procedurelog.ProcDate"
    },
    {
      request: "Payments on a specific date ordered by amount",
      query: "SELECT PayDate,PayType,PayAmt,CheckNum,BankBranch,PatNum FROM payment WHERE PayDate = '2006-02-23' ORDER BY PayAmt"
    },
    {
      request: "Patient payments in the specified date range by date and payment type, with totals",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-10-31'; SELECT IF(s1.Seq = 1, pay.PayDate, '') AS 'Paid On' , (CASE WHEN s1.Seq IN (1,3) THEN IFNULL(( SELECT def.ItemName FROM definition def WHERE def.DefNum = pay.PayType AND def.Category = 10 ), 'Income Transfer') WHEN s1.Seq IN (2,4) THEN '' ELSE 'Total' END) AS 'PayType' , IF(s1.Seq IN (2,4), '', FORMAT(CAST(SUM(pay.PayAmt) AS DECIMAL(14,2)),2)) AS 'Amt Paid' FROM payment pay LEFT JOIN seq_1_to_5 s1 ON TRUE WHERE pay.PayDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY (CASE WHEN s1.Seq = 1 THEN CONCAT(s1.Seq, '+', pay.PayDate, '|', pay.PayType) WHEN s1.Seq = 3 THEN CONCAT(s1.Seq, '+', pay.PayType) ELSE s1.Seq END) ORDER BY s1.Seq, pay.PayDate, `PayType`"
    },
    {
      request: "Pre-authorization claims not yet received",
      query: "SELECT * FROM claim WHERE ClaimType = 'PreAuth' AND ClaimStatus != 'R' ORDER BY DateService"
    },
    {
      request: "Insurance writeoffs for a specific provider in date range",
      query: "SELECT PatNum,ProvNum,PlanNum,WriteOff AS $Amt,DateCP,DateEntry FROM claimproc WHERE WriteOff >0 AND DateCP >= '2006-01-01' AND DateCP < '2006-04-01' AND ProvNum=1 ORDER BY DateCP"
    },
    {
      request: "Production by quarter and billing type for a specific year",
      query: "SELECT YEAR(procedurelog.ProcDate)AS \"Year\", QUARTER(procedurelog.ProcDate) AS \"Quarter\", definition.ItemName AS \"Billing Type\", SUM(procedurelog.ProcFee) AS \"$Production\" FROM procedurelog, patient, definition WHERE ProcStatus = 2 AND YEAR(procedurelog.ProcDate) = 2006 AND procedurelog.PatNum = patient.PatNum AND definition.DefNum = patient.BillingType GROUP BY QUARTER(procedurelog.ProcDate), patient.BillingType ORDER BY QUARTER(procedurelog.ProcDate), patient.BillingType"
    },
    {
      request: "List of families seen in the last three years - Useful for generating a list of patients for Christmas cards.",
      query: "SET @FromDate = CURDATE() - INTERVAL 3 YEAR; SET @ToDate = CURDATE(); SELECT g.LName,g.FName, g.Address, g.Address2, g.City, g.State, g.Zip FROM patient p INNER JOIN patient g ON p.Guarantor=g.PatNum INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE p.PatStatus=0 AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus=2 AND Length(g.Zip)>4 GROUP BY g.PatNum ORDER BY g.LName,g.FName"
    },
    {
      request: "A list of patients seen between two dates (based on procedures completed in date range).",
      query: "SET @FromDate='2017-01-01',@ToDate='2017-12-31'; SET @pos=0; SELECT @pos:=@pos+1 AS ' FROM( SELECT p.LName, p.FName, p.Address, p.Address2, p.City, p.State, p.Zip FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum AND pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate WHERE p.PatStatus=0 GROUP BY p.PatNum ORDER BY p.LName,p.FName ) A;"
    },
    {
      request: "A list of all guarantors of patients with an active status. This is another way of getting a Christmas card list without filtering out patients who have not been in for a while.",
      query: "SELECT g.PatNum ,g.LName ,g.FName ,g.Address ,g.Address2 ,g.City ,g.State ,g.Zip FROM patient p INNER JOIN patient g ON p.Guarantor = g.PatNum WHERE p.PatStatus=0 GROUP BY g.PatNum ORDER BY g.LName, g.FName;"
    },
    {
      request: "List and count of patients that were seen by you in a date range and their referrals",
      query: "SET @FromDate = '2018-01-01', @ToDate = '2018-01-05'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Row A.* FROM ( SELECT patient.PatNum, patient.lname, patient.fname, RefDate DateReferred, (CASE WHEN RefType = 0 THEN 'To' WHEN RefType = 1 THEN 'From' ELSE 'RefCustom' END) AS ReferredType, refattach.referralnum FROM patient INNER JOIN procedurelog ON procedurelog.PatNum = patient.PatNum AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN refattach ON refattach.PatNum = patient.PatNum INNER JOIN referral r ON refattach.ReferralNum = r.ReferralNum AND patient.patstatus = '0' GROUP BY patient.PatNum, r.ReferralNum, refattach.RefAttachNum ORDER BY ReferredType, r.LName, r.FName, patient.LName, patient.FName )A"
    },
    {
      request: "List of patients and their addresses who have not been seen since a certain date.",
      query: "SET @SinceDate='2023-01-01'; SELECT p.PatNum , p.PatStatus , p.Address , p.Address2 , p.City , p.State , p.Zip , DATE_FORMAT(MAX(pl.ProcDate), '%m/%d/%Y') AS 'Last Completed Procedure' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.procstatus = 2 GROUP BY pl.PatNum HAVING MAX(pl.ProcDate) < @SinceDate"
    },
    {
      request: "List of subscribers for a given carrier and groupnum. Note: This is a list of subscribers, not patients.  See 118 also.",
      query: "SET @CarrierName = '%Blue%', @GroupNum = '%%'; SELECT c.CarrierName ,p.PatNum FROM patient p INNER JOIN inssub ON inssub.Subscriber=p.PatNum INNER JOIN insplan ip ON ip.PlanNum=inssub.PlanNum INNER JOIN carrier c ON ip.CarrierNum=c.CarrierNum WHERE c.CarrierName LIKE @CarrierName AND ip.GroupNum LIKE @GroupNum ORDER BY c.CarrierName, ip.GroupNum,p.LName;"
    },
    {
      request: "Summary totals for all patient aging buckets and insurance estimates",
      query: "SELECT SUM(Bal_0_30) as 'Total 0-30', SUM(Bal_31_60) as 'Total 31-60', SUM(Bal_61_90) as 'Total 61-90', SUM(BalOver90) as 'Total BalOver90', SUM(BalTotal) as 'TOTAL of BALANCES', SUM(InsEst) as 'Total Ins. Est.', SUM(BalTotal-InsEst) AS 'Total Pat. Est.' FROM patient WHERE (patstatus != 2) AND (Bal_0_30 > '.005' OR Bal_31_60 > '.005' OR Bal_61_90 > '.005' OR BalOver90 > '.005' OR BalTotal < '-.005')"
    },
    {
      request: "Appointment history for one patient. Change the 581 to the appropriate PatNum before running.",
      query: "SET @PatNum = '22'; SELECT a.patnum ,a.AptStatus ,( SELECT pr.Abbr FROM provider pr WHERE pr.ProvNum = a.ProvNum ) AS \"Provider\" ,( SELECT prh.Abbr FROM provider prh WHERE prh.ProvNum = a.ProvHyg ) AS \"Hygienist\" ,DATE_FORMAT(a.AptDateTime, '%m-%d-%Y') AS 'Date' ,DATE_FORMAT(a.AptDateTime, '%l:%i %p') AS 'Time' ,CHAR_LENGTH(a.Pattern)*5 AS 'Min' ,ProcDescript AS 'Procedures' ,Note AS 'Notes' FROM appointment a WHERE a.PatNum = @PatNum"
    },
    {
      request: "Mailing information for guarantors of active patients where the guarantor is assigned to a specified clinic.",
      query: "SET @Clinics=''; SELECT g.LName ,COALESCE(cl.Abbr, 'Unassigned') AS 'Clinic' ,g.FName ,g.Address ,g.Address2 ,g.City ,g.State ,g.Zip FROM patient p INNER JOIN patient g ON g.PatNum = p.Guarantor LEFT JOIN clinic cl ON cl.ClinicNum = g.ClinicNum WHERE p.PatStatus=0 AND LENGTH(g.Zip) > 4 AND IF(LENGTH(@Clinics) = 0, TRUE, FIND_IN_SET(COALESCE(cl.Abbr, 'Unassigned'), @Clinics)) GROUP BY g.PatNum ORDER BY g.LName, g.FName;"
    },
    {
      request: "Daily deposits by payment type including insurance checks",
      query: "SET @date='2007-09-25'; SELECT definition.ItemName AS PaymentType, SUM(paysplit.SplitAmt) AS PaymentAmt FROM payment,definition,paysplit WHERE paysplit.DatePay=@date AND payment.PayNum=paysplit.PayNum AND definition.DefNum=payment.PayType GROUP BY payment.PayType UNION SELECT 'Ins Checks', SUM(claimproc.InsPayAmt) AS InsAmt FROM claimproc WHERE claimproc.DateCP=@date AND (claimproc.Status=1 OR claimproc.Status=4)"
    },
    {
      request: "Patient status patients whose first completed procedure is in the specified date range",
      query: "SET @FromDate='2024-01-01', @ToDate='2025-01-31'; SELECT GROUP_CONCAT(pc.CodeNum) INTO @Broken FROM procedurecode pc WHERE pc.ProcCode IN ('D9986', 'D9987'); SELECT p.PatNum AS 'Pat , p.LName , p.FName , p.Email , np.First AS 'FirstVisit' FROM patient p INNER JOIN ( SELECT plf.PatNum , MIN(plf.ProcDate) AS 'First' FROM procedurelog plf WHERE plf.ProcStatus = 2 AND !FIND_IN_SET(plf.CodeNum, @Broken) GROUP BY plf.PatNum ) np ON np.PatNum = p.PatNum AND np.First BETWEEN DATE(@FromDate) AND DATE(@ToDate) WHERE p.PatStatus = 0"
    },
    {
      request: "Patient contact info for patients not seen since a certain date. Excludes broken/missed codes.",
      query: "SET @Date='2025-01-01'; SELECT p.LName ,p.FName ,p.Address ,p.Address2 ,p.City ,p.State ,p.Zip ,p.HmPhone ,p.WirelessPhone ,p.WkPhone ,p.PatStatus ,p.AddrNote ,MAX(pl.ProcDate) AS 'LastVisit' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcStatus = 2 INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum AND pc.ProcCode NOT IN ('D9986','D9987') WHERE p.PatStatus != 4 GROUP BY pl.PatNum HAVING MAX(pl.ProcDate) < DATE(@Date) ORDER BY p.Address, p.Address2"
    },
    {
      request: "Treatment planned procedures in a specified code range, that are not in a scheduled appointment",
      query: "SET @CodeStart='D2000', @CodeEnd='D2399'; SELECT p.PatNum ,pc.ProcCode AS 'Code' ,pc.AbbrDesc AS 'request' ,pl.ToothNum ,DATE_FORMAT(pl.ProcDate,'%m-%d-%Y') AS 'Date' ,COALESCE(ap.AptStatus, '') AS 'AptStatus' ,pl.ProcFee * (pl.BaseUnits + pl.UnitQty) AS 'ProcFee' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 1 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(@CodeStart = '', TRUE, pc.ProcCode >= @CodeStart) AND IF(@CodeEnd = '', TRUE, pc.ProcCode <= @CodeEnd) LEFT JOIN appointment ap ON pl.AptNum = ap.AptNum WHERE (ISNULL(ap.AptNum) OR ap.AptStatus = 6 OR ap.AptStatus = 3) AND p.PatStatus = 0 ORDER BY ap.AptStatus, p.LName, p.FName ASC;"
    },
    {
      request: "Answers the question: during a given period, what is the production generated by different referral sources.",
      query: "SET @FromDate='2018-01-01', @ToDate='2018-01-05'; ( SELECT a.PatientName, a.FirstVisit, a.Referror, FORMAT(a.Fees, 2) AS Fees, FORMAT(a.Adjustments, 2) AS Adjustments, FORMAT(a.WriteOffs, 2) AS WriteOffs, FORMAT((a.Fees+a.Adjustments-a.Writeoffs), 2) AS NetProduction FROM( SELECT CONCAT(p.LName,', ',p.FName) AS PatientName, p.DateFirstVisit AS FirstVisit, CONCAT(r.LName,', ',r.FName) AS Referror, SUM(CASE WHEN RawPatTrans.TranType='Fee' THEN RawPatTrans.TranAmount ELSE 0 END) AS Fees, SUM(CASE WHEN RawPatTrans.TranType='Adj' THEN RawPatTrans.TranAmount ELSE 0 END) AS Adjustments, SUM(CASE WHEN RawPatTrans.TranType='Writeoff' THEN RawPatTrans.TranAmount ELSE 0 END) AS WriteOffs FROM ( SELECT 'Fee' AS TranType, pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate UNION ALL SELECT 'Adj' AS TranType, a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate UNION ALL SELECT 'Writeoff' AS TranType,cp.PatNum PatNum,cp.DateCp TranDate,cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (0,1,4) AND cp.ProcDate BETWEEN @FromDate AND @ToDate ) AS RawPatTrans INNER JOIN patient p ON p.PatNum=RawPatTrans.PatNum INNER JOIN refattach ra ON p.PatNum=ra.PatNum AND ra.RefType=1 AND ra.ItemOrder=( SELECT MIN(ra.ItemOrder) FROM refattach ra WHERE ra.RefType=1 AND ra.PatNum=p.PatNum GROUP BY p.PatNum ) INNER JOIN referral r ON r.ReferralNum=ra.ReferralNum GROUP BY p.PatNum ) a WHERE (a.Fees!=0 OR a.Adjustments!=0 OR a.Writeoffs!=0) ) UNION ALL ( SELECT CONCAT(' Totals: ',SUM(a.PatientName),' Patients') AS PatientName, a.FirstVisit, CONCAT(COUNT(DISTINCT a.Referror),' Referrors') AS 'Referror', FORMAT(SUM(a.Fees), 2) AS 'Fees', FORMAT(SUM(a.Adjustments), 2) AS 'Adjustments', FORMAT(SUM(a.WriteOffs), 2) AS 'WriteOffs', FORMAT((SUM(a.Fees)+SUM(a.Adjustments)-SUM(a.Writeoffs)), 2) AS NetProduction FROM( SELECT COUNT(DISTINCT p.PatNum) AS PatientName, CONCAT(DATEDIFF(@ToDate,@FromDate)+1,' Days') AS FirstVisit, r.ReferralNum AS Referror, SUM(CASE WHEN RawPatTrans.TranType='Fee' THEN RawPatTrans.TranAmount ELSE 0 END) AS Fees, SUM(CASE WHEN RawPatTrans.TranType='Adj' THEN RawPatTrans.TranAmount ELSE 0 END) AS Adjustments, SUM(CASE WHEN RawPatTrans.TranType='Writeoff' THEN RawPatTrans.TranAmount ELSE 0 END) AS WriteOffs FROM ( SELECT 'Fee' AS TranType, pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate UNION ALL SELECT 'Adj' AS TranType, a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate UNION ALL SELECT 'Writeoff' AS TranType,cp.PatNum PatNum,cp.DateCp TranDate,cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (0,1,4) AND cp.ProcDate BETWEEN @FromDate AND @ToDate ) AS RawPatTrans INNER JOIN patient p ON p.PatNum=RawPatTrans.PatNum INNER JOIN refattach ra ON p.PatNum=ra.PatNum AND ra.RefType=1 AND ra.ItemOrder=( SELECT MIN(ra.ItemOrder) FROM refattach ra WHERE ra.RefType=1 AND ra.PatNum=p.PatNum GROUP BY p.PatNum ) INNER JOIN referral r ON r.ReferralNum=ra.ReferralNum GROUP BY p.PatNum ) a WHERE (a.Fees!=0 OR a.Adjustments!=0 OR a.Writeoffs!=0) ) ORDER BY PatientName;"
    },
    {
      request: "Patients with statements sent in last 30 days and their due dates",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count',CONCAT(pat.LName, ', ', pat.FName) AS \"Patient\", DATE_FORMAT(MAX(DATE(s.DateSent)),'%m/%d/%Y') AS \"Last Stmt Date\", DATE_FORMAT(DATE(ADDDATE(MAX(DATE(s.DateSent)), INTERVAL 30 DAY)),'%m/%d/%Y') AS \"Due Date\" FROM patient pat, statement s WHERE s.PatNum = pat.PatNum AND DATE(s.DateSent) > DATE(ADDDATE(CURDATE(), INTERVAL -30 DAY)) AND s.Mode_ = 0 GROUP BY pat.PatNum ORDER BY \"Patient\";"
    },
    {
      request: "Production for date range with pay splits and tooth and surface",
      query: "SET @FromDate='2016-01-01',@ToDate='2016-01-31'; SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) AS Patient, pc.ProcCode, pl.ProcDate, pl.ProcFee, ps.splitamt, surf, toothnum FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum AND pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum LEFT JOIN paysplit ps ON pl.ProcNum=ps.ProcNum ORDER BY patient.LName, patient.FName ASC;"
    },
    {
      request: "Patient payments by procedure for date range",
      query: "SET @FromDate='2007-01-01' , @ToDate='2007-01-15'; SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) As Patient, pc.ProcCode, pl.ProcDate, pl.ProcFee, ps.SplitAmt FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum AND pl.ProcStatus != 6 INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN paysplit ps ON pl.ProcNum=ps.ProcNum WHERE pl.ProcDate >= @FromDate AND pl.ProcDate <=@ToDate ORDER BY patient.LName, patient.FName ASC;"
    },
    {
      request: "All insurance claimed procedures with UCR fee for date range, even if a different fee was used or sent",
      query: "SET @FromDate='2015-01-01' , @ToDate='2015-01-15'; SET @FeeSchedName='Standard'; SELECT c.PatNum, c.DateService, c.ProvTreat, pc.ProcCode, cp.InsPayEst, f.Amount AS '$UCR FEE' FROM claim c INNER JOIN claimproc cp ON c.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum=pl.ProcNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN fee f ON pc.CodeNum=f.CodeNum INNER JOIN feesched fs ON f.FeeSched=fs.FeeSchedNum AND fs.request LIKE @FeeSchedName WHERE DateService >= @FromDate AND DateService <=@ToDate ORDER BY c.DateService,c.PatNum,pc.ProcCode"
    },
    {
      request: "Returns all treatment planned procedures (summed by patient) for active patients without a scheduled OR planned apt, with phone nums - useful for those transitioning to planned appointments",
      query: "SELECT patient.PatNum , patient.hmphone , patient.wkphone , patient.wirelessphone , patient.Email , SUM( (pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) - COALESCE(( SELECT SUM(cpc.Writeoff) FROM claimproc cpc WHERE cpc.Status = 8 AND cpc.ProcNum = pl.ProcNum ),0) ) AS '$FeeSum' , CONCAT(patient.Address, ' ', patient.Address2) AS Address , patient.City , patient.State , patient.Zip FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND ProcStatus = 1 LEFT JOIN appointment ap ON patient.PatNum = ap.PatNum AND (ap.AptStatus = 1 OR ap.AptStatus = 6) WHERE ap.AptNum IS NULL AND patient.PatStatus = 0 GROUP BY patient.PatNum ORDER BY patient.LName, patient.FName ASC;"
    },
    {
      request: "Insurance payments received in a specified date range for the specified carrier.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @CarrierName='%%'; SELECT c.CarrierName ,cpay.CheckDate ,cl.DateService AS 'DateOfService' ,p.PatNum ,p.ChartNumber ,cpay.CheckNum ,SUM(cp.FeeBilled) AS '$Billed' ,SUM(cp.InsPayAmt) AS '$Amt' FROM claimpayment cpay INNER JOIN claimproc cp ON cp.ClaimPaymentNum = cpay.ClaimPaymentNum AND cp.Status IN(1,4) INNER JOIN claim cl ON cl.ClaimNum = cp.ClaimNum INNER JOIN insplan ip ON cp.PlanNum = ip.PlanNum INNER JOIN patient p ON cp.PatNum = p.PatNum INNER JOIN carrier c ON c.CarrierNum = ip.CarrierNum AND c.CarrierName LIKE @CarrierName WHERE cpay.CheckDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY cp.ClaimNum ORDER BY c.CarrierName, cpay.CheckDate, cl.DateService, p.LName, p.FName, p.PatNum, cl.ClaimNum;"
    },
    {
      request: "Lab cases with received date after sent date",
      query: "SELECT PatNum AS PatID,PatNum,request AS Laboratory,DateTimeSent,DateTimeRecd FROM labcase lc INNER JOIN laboratory l ON lc.LaboratoryNum=l.LaboratoryNum WHERE DateTimeRecd>DateTimeSent;"
    },
    {
      request: "Patient age, lifetime income, and treatment planned amounts",
      query: "SELECT PatNum, (CASE WHEN (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5))<120 THEN (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5)) ELSE 'NONE' END) AS 'Age', (SELECT SUM(SplitAmt) FROM paysplit WHERE paysplit.PatNum=patient.PatNum) AS '$Lifetime Income', (SELECT SUM(ProcFee) FROM procedurelog WHERE procedurelog.ProcStatus=1 AND procedurelog.PatNum=patient.PatNum) AS '$Treatment Planned' FROM patient ORDER BY LName;"
    },
    {
      request: "Treatment planned procedures with insurance status and referral source",
      query: "SELECT pl.PatNum,pc.ProcCode,pl.ProcFee, pl.Surf,pl.ToothNum,CASE WHEN (patient.HasIns='I') THEN 'Yes' ELSE 'No' END AS HasInsurance, CONCAT(tmpRef.LName, ', ', tmpRef.FName) AS \"Referror\" FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum AND pl.ProcStatus = 1 INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN (SELECT ItemOrder, refattach.ReferralNum, LName, FName, refattach.PatNum FROM refattach INNER JOIN referral ON refattach.ReferralNum =referral.ReferralNum) tmpRef ON patient.PatNum=tmpRef.PatNum AND tmpRef.ItemOrder = 1 ORDER BY patient.LName, patient.FName ASC;"
    },
    {
      request: "Procedures in a scheduled or ASAP appointment in the date range. Option to filter by specified code(s)",
      query: "SET @Codes =''; SET @StartDate='2023-04-01' , @EndDate='2023-04-30'; SET @Codes=(CASE WHEN @Codes='' THEN '^' ELSE CONCAT('^',REPLACE(@Codes,'|','$|^'),'$') END); SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) AS Patient, GROUP_CONCAT(pc.ProcCode) AS 'Codes', ap.AptDateTime, ap.AptStatus FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN appointment ap ON pl.AptNum=ap.AptNum AND ap.AptStatus IN (1,4) AND ProcCode REGEXP @Codes AND ap.AptDateTime BETWEEN @StartDate AND @EndDate + INTERVAL 1 DAY GROUP BY patient.PatNum, ap.AptNum ORDER BY aptstatus, patient.LName, patient.FName ASC;"
    },
    {
      request: "Patient and insurance payments in a date range by Payment Type",
      query: "SET @FromDate='2024-10-01', @ToDate='2024-10-07'; SELECT core.RowType ,core.PatID ,core.PatNum ,core.PaymentType ,core.DatePay ,core.PaymentAmt AS '$PaymentAmt' FROM( SELECT 'PatPay' AS 'RowType' , ps.PatNum AS 'PatID' , ps.PatNum , def.ItemName AS 'PaymentType' , ps.DatePay AS 'DatePay' , FORMAT(SUM(ps.SplitAmt),2) AS 'PaymentAmt' FROM paysplit ps INNER JOIN payment pay ON pay.PayNum = ps.PayNum INNER JOIN definition def ON def.DefNum = pay.PayType WHERE ps.DatePay BETWEEN @FromDate AND @ToDate GROUP BY pay.PayType, pay.PatNum, ps.DatePay UNION ALL SELECT 'InsPay' AS 'RowType' , cp.PatNum AS 'PatID' , cp.PatNum , IFNULL(d.ItemName,'Unfinalized') AS 'PaymentType' , cp.DateCP AS 'DatePay' , FORMAT(SUM(cp.InsPayAmt),2) AS 'PaymentAmt' FROM claimproc cp LEFT JOIN claimpayment cpa ON cpa.ClaimPaymentNum = cp.ClaimPaymentNum LEFT JOIN definition d ON d.DefNum = cpa.PayType WHERE cp.DateCP BETWEEN @FromDate AND @ToDate AND cp.Status IN(1,4) GROUP BY cp.PatNum, cp.DateCP, cpa.PayType ) core ORDER BY core.DatePay, core.PaymentType, core.RowType, core.PatID"
    },
    {
      request: "Active Patient count by age",
      query: "SELECT (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5)) AS 'Age', COUNT(DISTINCT p.PatNum) AS 'Patients' FROM patient p WHERE p.PatStatus=0 GROUP BY Age;"
    },
    {
      request: "- Possible duplicate accounts based on exact match first and last name.",
      query: "SET @CutOffDate = '2018-01-01'; SELECT p1.PatNum AS 'AcctNum', p1.LName, p1.Fname, p1.MiddleI, p1.Birthdate, p1.Preferred, p1.AddrNote, p1.PatStatus, COALESCE(NULLIF(p1.SecDateEntry,DATE('0001-01-01')),'Conv.') AS 'DateCreated', COALESCE(( SELECT MAX(pl.ProcDate) FROM procedurelog pl WHERE pl.ProcStatus = 2 AND pl.PatNum = p1.PatNum ),'None') AS 'Recent Proc', COALESCE(( SELECT MIN(ap.AptDateTime) FROM appointment ap WHERE ap.AptStatus = 1 AND ap.AptDateTime > CURDATE() AND ap.PatNum = p1.PatNum ),'None') AS 'Next Visit' FROM patient p1 INNER JOIN patient p2 ON p1.LName = p2.LName AND p1.FName = p2.FName AND p1.PatNum != p2.PatNum AND p2.patstatus != 4 WHERE p1.patstatus != 4 AND ((p1.SecDateEntry >= DATE(@CutOffDate)) OR (p2.SecDateEntry >= DATE(@CutOffDate))) GROUP BY p1.PatNum ORDER BY p1.LName, p1.FName, p1.MiddleI, p1.Birthdate, p1.PatNum;"
    },
    {
      request: "Active patients list who have seen a hygienist in date range",
      query: "SET @pos=0, @FromDate='2017-01-01' , @ToDate='2017-01-15'; SELECT @pos:=@pos+1 AS numberofpatients, A.* FROM ( SELECT pa.PatNum, MAX(ProcDate) AS 'Last Seen' FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 INNER JOIN provider pv ON pv.ProvNum = pl.ProvNum INNER JOIN definition d ON d.DefNum = pv.Specialty AND d.ItemName LIKE '%hyg%' WHERE pa.patstatus = '0' GROUP BY pa.PatNum ORDER BY pa.Lname )A;"
    },
    {
      request: "Count of Patient status patients who are active subscribers under each employer",
      query: "SET @Employers=''; SET @Carriers=''; SET @EmpReg = IF(LENGTH(@Employers) = 0, '^', REPLACE(@Employers,',','|')); SET @CarReg = IF(LENGTH(@Carriers) = 0, '^', REPLACE(@Carriers,',','|')); SELECT ca.CarrierName AS 'Carrier' , IFNULL(emp.EmpName,'Unknown') AS 'Employer' , COUNT(DISTINCT p.PatNum) AS 'ActiveSubscribers' FROM patient p INNER JOIN patplan pp ON pp.PatNum = p.PatNum INNER JOIN inssub ib ON pp.InsSubNum = ib.InsSubNum AND ib.Subscriber = p.PatNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum AND ca.CarrierName REGEXP @CarReg LEFT JOIN employer emp ON emp.EmployerNum = ip.EmployerNum WHERE p.PatStatus = 0 AND IFNULL(emp.EmpName,'Unknown') REGEXP @EmpReg GROUP BY ip.EmployerNum, ip.CarrierNum ORDER BY ca.CarrierName, IFNULL(emp.EmpName,'Unknown'), ca.CarrierNum, ip.EmployerNum"
    },
    {
      request: "New patients for date range with ref source and sum of first visit fees",
      query: "SET @FromDate='2020-10-01' , @ToDate='2020-10-31'; SELECT GROUP_CONCAT(pc.CodeNum) INTO @Broken FROM procedurecode pc WHERE pc.ProcCode IN ('D9986','D9987'); SELECT p.PatNum AS 'Pat ID' ,CONCAT( p.LName, ',', (CASE WHEN LENGTH(p.Preferred) > 0 THEN CONCAT(' \\'', p.Preferred,'\\'') ELSE '' END), ' ', p.FName, (CASE WHEN LENGTH(p.MiddleI) > 0 THEN CONCAT(' ', p.MiddleI) ELSE '' END) ) AS 'Patient' ,np.First AS 'FirstVisit' ,FORMAT(SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)),2) AS 'VisitFee' ,SUBSTRING_INDEX(ref.Refs,', ',1) AS 'Ref Last' ,SUBSTRING_INDEX(ref.Refs,', ',-1) AS 'Ref First' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN ( SELECT pl1.PatNum ,MIN(pl1.ProcDate) AS 'First' FROM procedurelog pl1 WHERE pl1.ProcStatus = 2 AND NOT FIND_IN_SET(pl1.CodeNum,@Broken) GROUP BY pl1.PatNum ) np ON np.PatNum = p.PatNum AND np.First = pl.ProcDate AND np.First BETWEEN @FromDate AND @ToDate INNER JOIN ( SELECT ra.PatNum ,SUBSTRING_INDEX( GROUP_CONCAT(DISTINCT r.LName,', ',r.FName ORDER BY ra.ItemOrder SEPARATOR '|') ,'|',1) AS 'Refs' FROM referral r INNER JOIN refattach ra ON r.ReferralNum = ra.ReferralNum AND ra.RefType = 1 GROUP BY ra.PatNum ) ref ON ref.PatNum = p.PatNum WHERE pl.ProcStatus = 2 GROUP BY p.PatNum ORDER BY p.LName"
    },
    {
      request: "Count of patients by Carrier with procedures \r\ncompleted in date range",
      query: "SET @FromDate='2010-01-01' , @ToDate='2010-01-31'; SELECT carrier.CarrierName, COUNT(DISTINCT claimproc.PatNum) AS 'Patients' FROM carrier INNER JOIN insplan ON carrier.CarrierNum=insplan.CarrierNum INNER JOIN claim ON insplan.PlanNum=claim.PlanNum INNER JOIN claimproc ON claim.ClaimNum=claimproc.ClaimNum INNER JOIN procedurelog ON claimproc.ProcNum=procedurelog.ProcNum INNER JOIN procedurecode ON procedurelog.CodeNum=procedurecode.CodeNum AND (procedurelog.ProcDate BETWEEN @FromDate AND @ToDate) AND ProcStatus=2 GROUP BY CarrierName ORDER BY CarrierName;"
    },
    {
      request: "Income by insurance carrier for date range",
      query: "SET @FromDate='2019-01-01' , @ToDate='2019-12-31'; SELECT CarrierName, SUM(CheckAmt) AS $Income FROM claimpayment WHERE CheckDate BETWEEN @FromDate AND @ToDate GROUP BY CarrierName;"
    },
    {
      request: "Carrier and patient list seen in date range",
      query: "SET @FromDate='2023-01-01', @ToDate='2023-02-01'; SET @pos=0; SELECT @pos:=@pos+1 AS COUNT ,display.CarrierName ,display.PatNum FROM ( SELECT carrier.CarrierName ,patient.PatNum FROM carrier INNER JOIN insplan ON insplan.CarrierNum=carrier.CarrierNum INNER JOIN claim ON insplan.PlanNum=claim.PlanNum INNER JOIN claimproc ON claimproc.ClaimNum=claim.ClaimNum INNER JOIN patient ON claimproc.PatNum=patient.PatNum INNER JOIN procedurelog pl ON claimproc.ProcNum = pl.ProcNum WHERE pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY patient.PatNum, CarrierName ORDER BY CarrierName, patient.LName, patient.FName, patient.PatNum ) display"
    },
    {
      request: "Count of active patients seen in a date range grouped by billing type",
      query: "SET @FromDate='2008-01-01', @ToDate='2008-12-31'; SELECT p.BillingType, COUNT(DISTINCT p.PatNum) AS 'COUNT' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 WHERE p.PatStatus = 0 GROUP BY p.BillingType"
    },
    {
      request: "Pre-authorizations received in the last 3 months",
      query: "SET @EndDate=CurDate(); SET @StartDate=(CurDate()- INTERVAL 3 MONTH); SELECT PatNum, DateSent, DateReceived, ClaimFee, InsPayEst, ClaimNote FROM claim WHERE claimtype='PreAuth' AND claimstatus='R' AND DateReceived>=@StartDate AND DateReceived<=@EndDate;"
    },
    {
      request: "Payment splits for a specific patient in date range",
      query: "SET @StartDate='2007-02-21'; SET @EndDate='2008-02-21'; SET @PatientNumber=6179; SELECT * FROM paysplit WHERE DatePay>=@StartDate AND DatePay<=@EndDate AND PatNum=@PatientNumber;"
    },
    {
      request: "New patients in date range with address and ref source. Patients will have multiple rows if they have multiple referrals",
      query: "SET @FromDate='2021-10-01' , @ToDate='2021-10-31'; SELECT p.PatNum, DATE_FORMAT(p.DateFirstVisit,'%m-%d-%Y') AS 'FirstVisit', CONCAT(p.Address, ' ', p.Address2) AS 'Address', p.City, p.State, p.Zip, COALESCE(r.LName, '') AS 'RefLName', COALESCE(r.FName, '') AS 'RefFName' FROM patient p LEFT JOIN refattach ra ON p.PatNum = ra.PatNum AND ra.RefType = 1 LEFT JOIN referral r ON r.ReferralNum = ra.ReferralNum WHERE p.DateFirstVisit BETWEEN @FromDate AND @ToDate ORDER BY p.LName, ra.ItemOrder"
    },
    {
      request: "New patients with scheduled appointments who have not received a welcome email",
      query: "SET @DateStart='2008-01-01' , @DateEnd='2008-01-31'; SELECT patient.PatNum FROM patient INNER JOIN patient pg ON patient.Guarantor=pg.PatNum INNER JOIN appointment ON patient.PatNum=appointment.PatNum AND aptstatus=1 AND aptdatetime>=@DateStart AND aptdatetime<=@DateEnd LEFT JOIN procedurelog ON patient.PatNum=procedurelog.PatNum AND ProcStatus=2 LEFT JOIN emailmessage e ON pg.PatNum=e.PatNum AND e.MsgDateTime>=DATE_SUB(curdate(), INTERVAL 45 DAY) AND e.Subject LIKE('%Welcome%') WHERE ISNULL(procedurelog.ProcDate) AND ISNULL(e.Subject);"
    },
    {
      request: "Active (status) patients with no scheduled apt who have not been in for a time period with the date of their last completed apt. - (From @daysIntervalStart days ago to @daysIntervalEnd days ago, change the interval currently 365 days: 1 year) This is useful for making a patient list before archiving patients, to call and try one last time.",
      query: "SET @daysIntervalStart=365, @daysIntervalEnd=0; SET @pos=0; SELECT @pos:=@pos+1 AS 'NumberOfPatients', a.PatNum, a.HmPhone, a.Address, a.City, a.State, a.Zip, a.LastApt, a.DaysSince FROM ( SELECT patient.PatNum, patient.HmPhone, patient.Address, patient.City, patient.State, patient.Zip, tmp2.AptDateTime AS LastApt, (TO_DAYS(CURDATE()) - TO_DAYS(tmp2.AptDateTime)) AS 'DaysSince' FROM patient INNER JOIN ( SELECT PatNum, MAX(AptDateTime) AS 'AptDateTime' FROM appointment WHERE AptStatus = 2 GROUP BY PatNum ) tmp2 ON patient.PatNum=tmp2.PatNum LEFT JOIN ( SELECT DISTINCT PatNum FROM appointment WHERE AptStatus = 1 ) tmp1 ON patient.PatNum=tmp1.PatNum WHERE tmp1.PatNum IS NULL AND (TO_DAYS(CURDATE()) - TO_DAYS(tmp2.AptDateTime)) NOT BETWEEN @daysIntervalEnd AND @daysIntervalStart AND patient.PatStatus = 0 GROUP BY tmp2.PatNum ORDER BY patient.LName, patient.FName ASC )a;"
    },
    {
      request: "Insurance claim procedures with UCR fee, InsEst and InsAmtPaid - Change date range as needed, does not distinguish between received claims, sent claims etc",
      query: "SET @StartDate = '2020-12-01' , @EndDate = '2023-12-31'; SET @UCRFeeSched = 'Standard'; SELECT claim.PatNum , DateService , ProvTreat , pc.ProcCode , CAST(cp.InsPayEst AS DECIMAL(14,2)) AS 'InsEstAmt' , CAST(f.Amount AS DECIMAL(14,2)) AS 'UCR FEE' , CAST(cp.inspayamt AS DECIMAL(14,2)) AS 'InsPayAmt' FROM claim INNER JOIN claimproc cp ON claim.ClaimNum = cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum = pl.ProcNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN fee f ON pc.CodeNum = f.CodeNum AND f.ProvNum = 0 AND f.ClinicNum = 0 INNER JOIN feesched fs ON f.FeeSched = fs.FeeSchedNum AND fs.request = @UCRFeeSched WHERE DateService BETWEEN @StartDate AND @EndDate ORDER BY claim.DateService, claim.ProvTreat, claim.ClaimNum, pc.ProcCode, pl.ProcNum"
    },
    {
      request: "Fees for treatment planned procedures on Patient status patients, showing how much is and is not scheduled",
      query: "SELECT (CASE WHEN !ISNULL(apt.AptNum) AND apt.AptStatus = 1 THEN 'TPd - Scheduled' WHEN ISNULL(apt.AptNum) OR apt.AptStatus IN (3,6) THEN 'TPd - Not Scheduled' END) AS 'ProcCondition' , FORMAT(CAST(SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS DECIMAL(14,2)),2) AS 'Fees' FROM procedurelog pl INNER JOIN patient p ON p.PatNum = pl.PatNum AND p.PatStatus = 0 LEFT JOIN appointment apt ON apt.AptNum = pl.AptNum WHERE pl.ProcStatus = 1 AND (ISNULL(apt.AptNum) OR apt.AptStatus IN (1,3,6) ) GROUP BY `ProcCondition` ORDER BY FIELD(`ProcCondition`,'TPd - Scheduled', 'TPd - Not SCheduled')"
    },
    {
      request: "Date Range limited: treatment planned and scheduled, treatment planned total, returns these two dollar amounts for all patients.  Caution: the results will change depending on how long after the period you run the query. The date range of the first number is applied to the appointment scheduled date, the date range for the second amount limits by what date the TP procedures were made.",
      query: "SET @FromDate='2016-01-01', @ToDate='2021-01-15'; SELECT 'TPd And Scheduled' AS ProcCondition ,FORMAT(SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)), 2) AS $TotalFees FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN appointment ap ON pl.AptNum=ap.AptNum AND pl.DateTP BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND AptStatus=1 UNION ALL SELECT 'Treatment Planned' AS ProcCondition ,FORMAT(SUM(ProcFee * (pl.BaseUnits + pl.UnitQty)), 2) AS $TotalFees FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum=ap.AptNum WHERE pl.DateTP BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND ( ISNULL(ap.aptnum) OR AptStatus=6 OR AptStatus=3 );"
    },
    {
      request: "Patients FROM city seen in date range, theoretically helpful for splitting practice",
      query: "SET @FromDate='2011-10-01', @ToDate='2011-10-31' ; SELECT DISTINCTROW patient.PatNum, patient.city FROM procedurelog INNER JOIN patient ON procedurelog.PatNum=patient.PatNum WHERE ProcStatus=2 AND ProcDate BETWEEN @FromDate AND @ToDate AND patient.City LIKE('%Port%')"
    },
    {
      request: "Scheduled appointments with insurance info",
      query: "SET @FromDate=\"2023-05-01\", @ToDate=\"2023-05-31\"; SET @Codes=\"\"; SET @Clinics=\"\"; SELECT patient.PatNum ,GROUP_CONCAT(DISTINCT pc.ProcCode) AS 'ProcCode' ,SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS \"$Fee_\" ,MIN(ap.AptDateTime) AS 'AptDateTime' ,COALESCE(GROUP_CONCAT(DISTINCT cl.Abbr), \"None\") AS 'Clinic' ,IFNULL((SELECT c.CarrierName FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum INNER JOIN carrier c ON ip.CarrierNum = c.CarrierNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 1 ), '') AS 'PriCarrier' ,IFNULL((SELECT ip.GroupName FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 1 ), '') AS 'PriGroupName' ,IFNULL((SELECT ip.GroupNum FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 1 ), '') AS 'PriGroupNum' ,IFNULL((SELECT c.CarrierName FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum INNER JOIN carrier c ON ip.CarrierNum = c.CarrierNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 2 ), '') AS 'SecCarrier' ,IFNULL((SELECT ip.GroupName FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 2 ), '') AS 'SecGroupName' ,IFNULL((SELECT ip.GroupNum FROM patplan pp INNER JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum INNER JOIN insplan ip ON iss.PlanNum = ip.PlanNum WHERE patient.PatNum = pp.PatNum AND pp.Ordinal = 2 ), '') AS 'SecGroupNum' FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@Codes) = 0, TRUE, FIND_IN_SET(pc.ProcCode, @Codes)) INNER JOIN appointment ap ON pl.AptNum = ap.AptNum AND ap.AptStatus = 1 AND ap.AptDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY LEFT JOIN clinic cl ON cl.ClinicNum = ap.ClinicNum WHERE IF(LENGTH(@Clinics) = 0, TRUE, FIND_IN_SET(IFNULL(cl.Abbr, 'None'), @Clinics)) GROUP BY patient.PatNum ORDER BY patient.LName, patient.FName"
    },
    {
      request: "Sum of patient and insurance payments for date range by patient, date, provider and payment type.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Providers=''; SET @PayType='%%'; SELECT p.PatNum ,main.PaymentType ,COALESCE(pv.Abbr, 'None') AS 'Provider' ,FORMAT(main.PaymentAmt, 2) AS '$PaymentAmt' FROM patient p INNER JOIN( SELECT ps.PatNum ,COALESCE(d.ItemName, 'Income Transfer') AS 'PaymentType' ,ps.ProvNum ,SUM(ps.SplitAmt) AS 'PaymentAmt' FROM payment pm INNER JOIN paysplit ps ON pm.PayNum = ps.PayNum AND ps.DatePay BETWEEN DATE(@FromDate) AND DATE(@ToDate) LEFT JOIN definition d ON d.DefNum = pm.PayType GROUP BY ps.PatNum, d.ItemName, ps.ProvNum UNION ALL SELECT claimproc.PatNum ,'Ins Checks' AS 'PaymentType' ,claimproc.ProvNum ,SUM(claimproc.InsPayAmt) AS 'PaymentAmt' FROM claimproc WHERE claimproc.DateCP BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND claimproc.Status IN (1,4) GROUP BY claimproc.PatNum, claimproc.ProvNum ) main ON main.PatNum = p.PatNum LEFT JOIN provider pv ON pv.ProvNum = main.ProvNum WHERE IF(LENGTH(@Providers) = 0, TRUE, FIND_IN_SET(pv.Abbr, @Providers)) AND main.PaymentType LIKE @PayType ORDER BY p.LName, p.FName;"
    },
    {
      request: "Adjustment totals and counts by type for date range",
      query: "SET @Start='2009-01-01' , @End='2009-12-31'; SELECT AdjType, SUM(AdjAmt), Count(AdjNum) AS AdjCount FROM adjustment WHERE AdjDate >=@Start AND AdjDate <=@End GROUP BY AdjType ORDER BY SUM(AdjAmt);"
    },
    {
      request: "Sum of payments made by carrier for procedures in a date range",
      query: "SET @FromDate='2024-01-01', @Todate='2024-01-31' ; SELECT carrier.CarrierName ,COUNT(DISTINCT claimproc.PatNum) AS 'Patients' ,SUM(claimproc.InsPayAmt) AS 'InsPaidTotal' FROM carrier INNER JOIN insplan ON carrier.CarrierNum=insplan.CarrierNum INNER JOIN claim ON insplan.PlanNum=claim.PlanNum INNER JOIN claimproc ON claim.ClaimNum=claimproc.ClaimNum INNER JOIN procedurelog ON claimproc.ProcNum=procedurelog.ProcNum INNER JOIN procedurecode ON procedurelog.CodeNum=procedurecode.CodeNum AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate AND ProcStatus=2 GROUP BY CarrierName ORDER BY CarrierName;"
    },
    {
      request: "Sum of payments made by carrier for procedures in a date range",
      query: "SET @FromDate='2011-01-01', @ToDate='2015-12-31' ; SELECT carrier.CarrierName, patient.Guarantor,SUM(claimproc.InsPayAmt) AS '$InsPayAmt_' FROM patient INNER JOIN claimproc ON claimproc.PatNum=patient.PatNum INNER JOIN insplan ON insplan.PlanNum=claimproc.PlanNum INNER JOIN carrier ON carrier.CarrierNum=insplan.CarrierNum WHERE patient.PatStatus=0 AND claimproc.ProcDate BETWEEN @FromDate AND @ToDate AND (claimproc.Status=1 OR claimproc.Status=4) GROUP BY patient.Guarantor, carrier.CarrierName ORDER BY carrier.CarrierName;"
    },
    {
      request: "Aging Report for Balance over 90 with no payment in last 30. Uses patient table aging, run aging prior to this; newer versions run aging automatically through the Open Dental service.",
      query: "SELECT CONCAT(g.LName,', ',g.FName,' ',g.MiddleI) AS Guarantor ,FORMAT(g.Bal_0_30, 2) AS 'Bal_0_30' ,FORMAT(g.Bal_31_60, 2) AS 'Bal_31_60' ,FORMAT(g.Bal_61_90, 2) AS 'Bal_61_90' ,FORMAT(g.BalOver90, 2) AS $BalOver90 ,FORMAT(g.BalTotal, 2) AS $BalanceTotal ,FORMAT(g.InsEst, 2) AS $InsEstimate ,FORMAT(g.BalTotal-g.InsEst, 2) AS $PatientPor ,DATE_FORMAT(MAX(paysplit.DatePay),'%m/%d/%Y') AS LastPayment FROM patient INNER JOIN patient g ON patient.Guarantor=g.PatNum LEFT JOIN paysplit ON paysplit.PatNum=patient.PatNum WHERE (patient.patstatus IN (0,1)) AND (g.BalOver90 > '.005') GROUP BY patient.Guarantor HAVING MAX(paysplit.DatePay)<(CURDATE()- INTERVAL 30 DAY) ORDER BY g.LName,g.FName;"
    },
    {
      request: "Locate insurance checks by check number",
      query: "SET @Check='%123%'; SELECT p.PatNum AS 'PatID', CONCAT(p.LName,', ',p.FName,' ',p.MiddleI) AS NAME, cpay.CheckDate, ca.CarrierName, cpay.CheckNum, cp.ClaimNum, FORMAT(SUM(cp.InsPayAmt),2) AS '$Amt_' FROM claimpayment cpay INNER JOIN claimproc cp ON cpay.ClaimPaymentNum = cp.ClaimPaymentNum AND cp.Status IN (1,4) INNER JOIN patient p ON cp.PatNum = p.PatNum INNER JOIN insplan ip ON cp.PlanNum = ip.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum WHERE cpay.CheckNum LIKE @Check GROUP BY cp.ClaimNum ORDER BY ca.CarrierName;"
    },
    {
      request: "Export active patient contact information to CSV file",
      query: "SELECT LName,FName,WkPhone,HmPhone,WirelessPhone FROM patient WHERE PatStatus=0 INTO OUTFILE \"c:\\\\TEMP\\\\patients.csv\" FIELDS TERMINATED BY ',';"
    },
    {
      request: "Insurance payments in the specified date range, optionally with the specified check amount and check number",
      query: "SET @FromDate='2024-01-01',@ToDate='2024-01-31'; SET @CheckAmount=''; SET @CheckNumber=''; SELECT cpay.CarrierName ,FORMAT(SUM(cp.InsPayAmt),2) AS 'ForPatient' ,FORMAT(cpay.CheckAmt,2) AS 'TotalCheck' ,cpay.CheckNum ,cpay.CheckDate ,cpay.Note ,cp.PatNum FROM claimpayment cpay LEFT JOIN claimproc cp ON cp.ClaimPaymentNum = cpay.ClaimPaymentNum AND cp.Status IN (1,4) WHERE cpay.CheckDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND IF(LENGTH(@CheckAmount) = 0,TRUE,cpay.CheckAmt = CAST(@CheckAmount AS DECIMAL(10,2))) AND IF(LENGTH(@CheckNumber) = 0,TRUE,cpay.CheckNum = @CheckNumber) GROUP BY cpay.ClaimPaymentNum, cp.PatNum ORDER BY cpay.CheckDate, cp.PatNum, cpay.CheckNum"
    },
    {
      request: "Find patients by insurance subscriber ID",
      query: "SET @SubscriberID=('%123%'); SELECT p.PatNum, iss.SubscriberID FROM patient p INNER JOIN patplan pp ON pp.PatNum=p.PatNum INNER JOIN inssub iss ON iss.InsSubNum=pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum=iss.PlanNum WHERE iss.SubscriberID LIKE @SubscriberID ORDER BY p.LName, p.FName;"
    },
    {
      request: "Procedures with notes for date range (completed procs) for specified proceudres",
      query: "SET @FromDate= '2023-07-01', @ToDate='2023-07-31'; SET @ProcCodes=''; SELECT pl.ProcDate ,pa.PatNum ,pc.ProcCode ,pl.ToothNum ,SUBSTRING_INDEX(GROUP_CONCAT(Note ORDER BY pn.EntryDateTime DESC SEPARATOR '+|+'), '+|+', 1) AS Note FROM patient pa INNER JOIN procedurelog pl ON pl.PatNum=pa.PatNum AND pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum AND IF(LENGTH(@ProcCodes)=0, TRUE, FIND_IN_SET(pc.ProcCode, @ProcCodes)) INNER JOIN provider pr ON pr.ProvNum=pl.ProvNum INNER JOIN procnote pn ON pl.ProcNum=pn.ProcNum GROUP BY pl.ProcNum ORDER BY pl.ProcDate,PatNum;"
    },
    {
      request: "Find insurance plans without assigned benefits",
      query: "SELECT PlanNum, SubScriber FROM inssub WHERE AssignBen=0;"
    },
    {
      request: "Treatment plans created in a date range with heading and notes",
      query: "SET @FromDate= '2008-01-01', @ToDate='2008-01-31'; SET @pos=0; SELECT @pos:=@pos+1 AS Number, PatNum, DateTP, Heading, Note FROM treatplan WHERE DateTP Between @FromDate AND @ToDate;"
    },
    {
      request: "Family balance report by patient and provider showing outstanding amounts",
      query: "DROP TABLE IF EXISTS tempfambal; CREATE TABLE tempfambal( FamBalNum INT NOT NULL AUTO_INCREMENT, PatNum INT NOT NULL, Guarantor INT NOT NULL, ProvNum INT NOT NULL, AmtBal DOUBLE NOT NULL, PRIMARY KEY (FamBalNum)); INSERT INTO tempfambal (PatNum,Guarantor,ProvNum,AmtBal) SELECT patient.PatNum,patient.Guarantor,procedurelog.ProvNum,SUM(ProcFee) FROM procedurelog,patient WHERE patient.PatNum=procedurelog.PatNum AND ProcStatus=2 GROUP BY patient.PatNum,ProvNum; INSERT INTO tempfambal (PatNum,Guarantor,ProvNum,AmtBal) SELECT patient.PatNum,patient.Guarantor,claimproc.ProvNum,-SUM(InsPayAmt)-SUM(Writeoff) FROM claimproc,patient WHERE patient.PatNum=claimproc.PatNum AND (STATUS=1 OR STATUS=4 OR STATUS=5) GROUP BY patient.PatNum,ProvNum; INSERT INTO tempfambal (PatNum,Guarantor,ProvNum,AmtBal) SELECT patient.PatNum,patient.Guarantor,adjustment.ProvNum,SUM(AdjAmt) FROM adjustment,patient WHERE patient.PatNum=adjustment.PatNum GROUP BY patient.PatNum,ProvNum; INSERT INTO tempfambal (PatNum,Guarantor,ProvNum,AmtBal) SELECT patient.PatNum,patient.Guarantor,paysplit.ProvNum,-SUM(SplitAmt) FROM paysplit,patient WHERE patient.PatNum=paysplit.PatNum AND paysplit.PayPlanNum = 0 GROUP BY patient.PatNum,ProvNum; INSERT INTO tempfambal (PatNum,Guarantor,ProvNum,AmtBal) SELECT patient.PatNum,patient.Guarantor,payplancharge.ProvNum,-(pp.CompletedAmt) FROM payplancharge, patient, payplan pp WHERE patient.PatNum=payplancharge.PatNum AND pp.PatNum = patient.PatNum AND pp.CompletedAmt!=0 GROUP BY patient.PatNum,payplancharge.ProvNum; SELECT tempfambal.Guarantor,tempfambal.PatNum,tempfambal.ProvNum,SUM(AmtBal) AS $AmtBal FROM tempfambal INNER JOIN patient guarantor ON guarantor.PatNum=tempfambal.Guarantor GROUP BY tempfambal.PatNum,tempfambal.ProvNum HAVING (SUM(AmtBal)>0.009 OR SUM(AmtBal)<(-0.009)) ORDER BY guarantor.LName, guarantor.FName,tempfambal.ProvNum; DROP TABLE IF EXISTS tempfambal;"
    },
    {
      request: "Commlog entries for Financial or Insurance types",
      query: "SELECT commlog.PatNum, Note, ItemName FROM commlog INNER JOIN definition ON commlog.CommType=definition.DefNum INNER JOIN patient ON commlog.PatNum=patient.PatNum WHERE ItemName Like 'Financial' OR ItemName Like 'Insurance' ORDER BY patient.LName, patient.FName"
    },
    {
      request: "New patients with Clinic and Referral source for date range",
      query: "SET @FromDate='2018-01-01' , @ToDate='2018-01-05'; SELECT p.PatNum, DATE_FORMAT(p.DateFirstVisit,'%m-%d-%Y') AS FirstVisit, c.request, r.LName as RefLName, r.FName as RefFName FROM patient p INNER JOIN procedurelog pl on pl.PatNum=p.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus=2 AND pl.ProcFee > 0 LEFT JOIN refattach ra ON p.PatNum=ra.PatNum LEFT JOIN referral r ON r.ReferralNum=ra.ReferralNum AND ra.RefType = 1 LEFT JOIN clinic c ON p.ClinicNum=c.ClinicNum WHERE p.DateFirstVisit BETWEEN @FromDate AND @ToDate AND p.PatStatus=0 GROUP BY p.PatNum ORDER BY c.request, p.LName;"
    },
    {
      request: "Count of patients seen in the date range by patient's assigned clinic. Excludes patients that don't have a completed procedure in the date range and those that have completed procedures with no fee.",
      query: "SET @FromDate='2008-01-01' , @ToDate='2008-01-31'; SELECT IFNULL(c.request,'None') AS 'Clinic', IFNULL(COUNT(DISTINCT p.PatNum),0) AS 'Patients' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum LEFT JOIN clinic c ON p.ClinicNum=c.ClinicNum WHERE p.DateFirstVisit BETWEEN @FromDate AND @ToDate AND p.PatStatus=0 AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus=2 AND pl.ProcFee > 0 GROUP BY c.request UNION ALL SELECT CONCAT('Total: ', @FromDate, ' to ', @ToDate) AS 'Clinic', ( SELECT COUNT(DISTINCT p.PatNum) FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE p.DateFirstVisit BETWEEN @FromDate AND @ToDate AND p.PatStatus=0 AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus=2 AND pl.ProcFee>0 ) AS 'Patients';"
    },
    {
      request: "List of patients with a completed procedure today.",
      query: "SELECT CONCAT(pa.LName,', ',pa.FName,' ',pa.MiddleI) AS PatName , CONCAT( pa.Address , IF(LENGTH(pa.Address2) > 0, ' ', '') , pa.Address2 , \" \" , pa.City , \", \" , pa.State , \" \" , pa.zip ) AS Address , pa.hmphone , pa.wkphone , pa.wirelessphone FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum AND pl.ProcStatus = 2 AND pl.ProcDate = CURDATE() GROUP BY PatName ORDER BY PatName"
    },
    {
      request: "New Patient count, insured and not insured over date range. Uses Date of First Visit. Also see #545 for breakdown by month over a long period.",
      query: "SET @FromDate='2022-06-01' , @ToDate='2022-06-30'; SELECT SUM(z.INSUREDCOUNT) AS InsuredCountByDate ,SUM(z.NOTINSUREDCOUNT) AS NotInsuredCountByDate FROM ( SELECT COUNT(DISTINCT PatNum) AS INSUREDCOUNT ,0 AS NOTINSUREDCOUNT FROM procedurelog WHERE PatNum IN ( SELECT a.PatNum FROM patient a INNER JOIN patplan b ON a.PatNum = b.PatNum AND b.Ordinal = 1 WHERE a.datefirstvisit BETWEEN @FromDate AND @ToDate ) UNION SELECT 0 AS INSUREDCOUNT ,COUNT(DISTINCT PatNum) AS NOTINSUREDCOUNT FROM procedurelog WHERE PatNum IN ( SELECT PatNum FROM patient WHERE PatNum NOT IN ( SELECT PatNum FROM patplan ) AND datefirstvisit BETWEEN @FromDate AND @ToDate ) ) z;"
    },
    {
      request: "Treatment planned procedures in date range with procedure code and description",
      query: "SET @FromDate='2008-01-01' , @ToDate='2008-01-31'; SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) As Patient, pc.ProcCode as 'Code', abbrdesc as 'request', DATE_FORMAT(pl.ProcDate,'%m-%d-%Y') AS 'Date', ProcFee FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum WHERE pl.ProcStatus=5 AND pl.ProcDate BETWEEN @FromDate AND @ToDate ORDER BY pl.ProcDate, patient.LName, patient.FName ASC;"
    },
    {
      request: "Patients without any documents or images",
      query: "SELECT p.PatNum FROM patient p LEFT JOIN document a ON p.PatNum=a.PatNum WHERE a.PatNum IS NULL;"
    },
    {
      request: "Patient document and image count",
      query: "SELECT document.PatNum, CONCAT(p.LName,', ',p.FName,' ',p.MiddleI) AS PatName, COUNT(document.PatNum) AS 'Images' FROM document LEFT JOIN patient p ON document.PatNum=p.PatNum GROUP BY document.PatNum ORDER BY p.LName, p.FName;"
    },
    {
      request: "Claims where insurance paid more than the procedure fee in date range",
      query: "SET @StartDate='2008-01-01' , @EndDate='2008-06-15'; SELECT claim.PatNum,DateService,pc.ProcCode,ProcFee,f.Amount as 'UCR FEE', SUM(cp.inspayamt) FROM claim INNER JOIN claimproc cp ON claim.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum=pl.ProcNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN fee f ON pc.CodeNum=f.CodeNum INNER JOIN definition d ON f.FeeSched=d.DefNum AND d.ItemName='Standard' WHERE DateService>=@StartDate AND DateService<=@EndDate AND (cp.Status=1 OR cp.Status=1) GROUP BY cp.ProcNum HAVING SUM(cp.InsPayAmt)>ProcFee;"
    },
    {
      request: "Claims overpaid by insurance with negative guarantor balance in date range",
      query: "SET @StartDate='2008-01-01' , @EndDate='2008-06-15'; SELECT claim.PatNum,DateService,pc.ProcCode,ProcFee,f.Amount as 'UCR FEE', SUM(cp.inspayamt), ga.BalTotal FROM claim INNER JOIN claimproc cp ON claim.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum=pl.ProcNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN patient pa ON pa.PatNum=pl.PatNum INNER JOIN patient ga ON pa.Guarantor=ga.PatNum INNER JOIN fee f ON pc.CodeNum=f.CodeNum INNER JOIN definition d ON f.FeeSched=d.DefNum AND d.ItemName='Standard' WHERE DateService>=@StartDate AND DateService<=@EndDate AND ga.BalTotal<0 AND (cp.Status=1 OR cp.Status=4) GROUP BY cp.ProcNum HAVING SUM(cp.InsPayEst)-ProcFee>.01;"
    },
    {
      request: "Sent claims where insurance estimate exceeds procedure fee in date range",
      query: "SET @StartDate='2008-01-01' , @EndDate='2008-06-15'; SELECT claim.PatNum,DateService,pc.ProcCode,ProcFee, SUM(cp.inspayest) FROM claim INNER JOIN claimproc cp ON claim.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum=pl.ProcNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum WHERE DateService>=@StartDate AND DateService<=@EndDate AND cp.Status=0 AND pl.ProcStatus=2 AND ClaimStatus='S' GROUP BY cp.ProcNum HAVING SUM(cp.InsPayEst)-ProcFee>.01"
    },
    {
      request: "Outstanding insurance claims by carrier",
      query: "SELECT cl.PatNum , cl.DateSent , ca.CarrierName , ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum = cl.PatNum INNER JOIN inssub ib ON cl.InsSubNum = ib.InsSubNum INNER JOIN insplan i ON i.PlanNum = ib.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = i.CarrierNum WHERE cl.ClaimStatus = 'S' ORDER BY ca.CarrierName, p.LName;"
    },
    {
      request: "Outstanding sent claims for a specific carrier name",
      query: "SET @Carrier='%Blue Cross%'; SELECT cl.PatNum,cl.DateSent,cl.DateService, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimStatus='S' AND ca.CarrierName LIKE @Carrier ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Guarantors of families where no payment has been made in 1 Month and they are over 90 days past due, \r\nperiod can be changed, you can use terms like 1 MONTH or 45 DAY for the interval",
      query: "SELECT g.PatNum AS 'Number',CONCAT(g.LName, \", \", g.FName) AS 'Name', g.BalOver90 AS '$FamBalOver90', DATE_FORMAT(MAX(ps.DatePay), '%m-%d-%Y') AS 'DateLastPay' , g.BalTotal AS '$FamBalTotal' FROM patient g INNER JOIN patient p ON p.Guarantor=g.PatNum LEFT JOIN paysplit ps ON ps.PatNum=p.PatNum WHERE g.BalOver90>1 GROUP BY g.PatNum HAVING MAX(ps.DatePay)<(CURDATE()-INTERVAL 1 MONTH) ORDER BY g.LName, g.FName;"
    },
    {
      request: "Writeoffs by date range with patient and provider details",
      query: "SET @Start='2008-04-01', @End='2008-04-30'; SELECT PatNum,ProvNum,PlanNum,WriteOff AS $Amt,DATE_FORMAT(ProcDate,'%m/%d/%Y') AS Proc_Date,DATE_FORMAT(DateEntry,'%m/%d/%Y') AS Entry_Date FROM claimproc WHERE (WriteOff >0) AND (ProcDate BETWEEN @Start AND @END) AND (Status=0 OR Status = 1 OR Status = 4) ORDER BY ProcDate;"
    },
    {
      request: "Total writeoffs sum for a date range",
      query: "SET @Start='2008-04-01', @End='2008-04-30'; SELECT SUM(WriteOff) AS '$TotalWriteoffs' FROM claimproc WHERE WriteOff >0 AND (ProcDate BETWEEN @Start AND @END) AND (Status=0 OR Status = 1 OR Status = 4) ORDER BY ProcDate"
    },
    {
      request: "Mailing list of guarantors of patients with a particular carrier and primary provider and have a completed appointment in the specified date range, unlike some others, returns the guarantors of all patients with plan, not the subscriber, also if you drop the plan it goes off the list",
      query: "SET @CarrierName='%%'; SET @Provider=''; SET @FromDate ='2024-12-01', @ToDate ='2024-12-12'; SELECT gu.Salutation ,gu.LName ,gu.FName ,gu.Address ,gu.Address2 ,gu.City ,gu.State ,gu.Zip ,gu.Email ,GROUP_CONCAT(pv.Abbr ORDER BY pv.Abbr) AS 'Provider' ,gu.Birthdate ,ib.DateEffective ,ca.CarrierName FROM patient p INNER JOIN provider pv ON pv.ProvNum = p.PriProv AND IF(LENGTH(@Provider) = 0,TRUE,FIND_IN_SET(pv.Abbr,@Provider)) INNER JOIN patplan pp ON pp.PatNum = p.PatNum INNER JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum AND ca.CarrierName LIKE @CarrierName INNER JOIN patient gu ON gu.PatNum = p.Guarantor WHERE p.PatNum IN ( SELECT ap.PatNum FROM appointment ap WHERE ap.AptStatus = 2 AND ap.AptDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY AND ap.PatNum = p.PatNum ) GROUP BY gu.PatNum, ca.CarrierName, ib.DateEffective ORDER BY ca.CarrierName, gu.LName;"
    },
    {
      request: "Completed procedures in the date range showing tooth surface",
      query: "SET @FromDate = '2016-04-19', @ToDate = '2016-04-21'; SELECT CONCAT(patient.LName, ', ',patient.FName, ' ', patient.MiddleI) AS Patient, pl.ProcDate, pv.Abbr, pc.ProcCode, pc.AbbrDesc, toothnum, surf, pl.ProcFee FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pv ON pl.ProvNum = pv.ProvNum WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate ORDER BY ProcDate,patient.LName, patient.FName ASC;"
    },
    {
      request: "Guarantor emails for active patients",
      query: "SELECT g.LName, g.FName, p.FName AS 'Patient', g.eMail FROM patient p INNER JOIN patient g ON p.Guarantor=g.PatNum WHERE p.PatStatus=0 AND g.EMail LIKE ('%@%') ORDER BY g.LName, g.FName;"
    },
    {
      request: "List of active patients referred to you or from you in date range.",
      query: "SET @FromDate='2018-01-01' , @ToDate='2018-01-05'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', A.* FROM ( SELECT p.PatNum, CONCAT(rf.LName , \", \", rf.FName) AS Referral, ra.RefType, DATE_FORMAT(ra.RefDate,'%m/%d/%Y') AS RefDate FROM patient p INNER JOIN refattach ra ON p.PatNum=ra.PatNum AND ra.RefDate BETWEEN @FromDate AND @ToDate INNER JOIN referral rf ON ra.ReferralNum=rf.ReferralNum AND p.PatStatus = '0' ) A ORDER BY A.Referral"
    },
    {
      request: "Count of active patients with each insurance plan (not subscribers).\r\nNOTE:will not sum to total patients as some patients may have no insurance some may have more than one",
      query: "SELECT carrier.CarrierName , COUNT(DISTINCT p.PatNum) AS 'Patients' FROM carrier INNER JOIN insplan ip ON carrier.CarrierNum=ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum=ip.PlanNum INNER JOIN patplan pp ON pp.InsSubNum=ib.InsSubNum INNER JOIN patient p ON pp.PatNum=p.PatNum WHERE p.PatStatus=0 GROUP BY CarrierName ORDER BY CarrierName;"
    },
    {
      request: "Counts procedures as recall where they match list",
      query: "SET @FromDate='2019-01-01' , @ToDate='2019-11-26'; SET @RecallCodes='D0120|D1120|D1110|D1203|D1204|D0270|D0272|D0273|D0274|D0330'; SET @RecallCodes=(CASE WHEN LENGTH(@RecallCodes)=0 THEN '^' ELSE CONCAT('^',REPLACE(@RecallCodes,'|','$|^'),'$') END); SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', rep.PatNum, rep.LastProcDate, rep.ProcCount, rep.RecallProcs, rep.RecallOnly FROM ( SELECT PatNum, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastProcDate', (COUNT(SetRecall)) AS 'ProcCount', SUM(SetRecall) AS 'RecallProcs', (CASE WHEN ((COUNT(SetRecall) -SUM(SetRecall))=0) THEN 'Yes' ELSE 'No' END) AS 'RecallOnly' FROM ( SELECT PatNum, ProcDate, ProcCode, ProcNum, (CASE WHEN ProcCode REGEXP @RecallCodes THEN 1 ELSE 0 END) AS 'SetRecall' FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum WHERE pl.ProcDate BETWEEN @FromDate AND @ToDate AND ProcStatus = 2 ) tmp GROUP BY PatNum ORDER BY RecallOnly, LastProcDate ) rep"
    },
    {
      request: "Commlog entries in the specified date range, for the specified commlog type.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Users=''; SET @CommlogType=''; SET @CommlogType=(CASE WHEN LENGTH(@CommlogType) = 0 THEN '^' ELSE CONCAT('^',REPLACE(REPLACE(@CommlogType,', ','$|^'), ',','$|^'),'$') END); SELECT uo.UserName AS 'User' ,c.PatNum ,c.CommDateTime ,d.ItemName AS 'CommlogType' ,c.Note AS 'CommlogNote' FROM commlog c INNER JOIN definition d ON c.CommType=d.DefNum AND d.ItemName REGEXP @CommlogType INNER JOIN patient p ON c.PatNum=p.PatNum INNER JOIN userod uo ON uo.UserNum = c.UserNum AND IF(LENGTH(@Users) = 0, TRUE, FIND_IN_SET(uo.UserName, @Users)) WHERE c.CommDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY ORDER BY p.LName, p.FName, p.PatNum, c.CommDateTime, c.CommlogNum, d.DefNum"
    },
    {
      request: "Hygiene Production For Time Period, with a total at the bottom.",
      query: "SET @FromDate='2022-12-01' , @ToDate='2022-12-31'; SELECT patient.PatNum, pl.ProcDate, pv.Abbr, pc.ProcCode, pc.AbbrDesc, (pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) - COALESCE(( SELECT SUM(cpc.Writeoff) FROM claimproc cpc WHERE cpc.Status IN(7, 8) AND cpc.ProcNum = pl.ProcNum ),0) AS '$ProcFee' FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pv ON pl.ProvNum = pv.ProvNum WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pc.IsHygiene = 1 ORDER BY pl.ProcDate, patient.LName, patient.FName ASC"
    },
    {
      request: "Gross production for procedures marked as Hygiene that were completed in the specified date range, by code and provider",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Providers=''; SELECT IF(s1.Seq = 1,pr.Abbr,'') AS 'Provider' ,IF(s1.Seq = 1,pc.ProcCode,'') AS 'Code' ,IF(s1.Seq = 1,pc.AbbrDesc,'') AS 'AbbrDesc' ,COUNT(DISTINCT pl.ProcNum) AS 'ProcCount' ,FORMAT(SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)),2) AS 'ProcFee' ,FORMAT(SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) / COUNT(DISTINCT pl.ProcNum),2) AS 'AvgFee' FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND pc.IsHygiene INNER JOIN provider pr ON pr.ProvNum = pl.ProvNum AND IF(LENGTH(@Providers) = 0,TRUE,FIND_IN_SET(pr.Abbr,@Providers)) LEFT JOIN seq_1_to_2 s1 ON TRUE WHERE pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 GROUP BY IF(s1.Seq = 1,CONCAT(s1.Seq,'+',pl.CodeNum,'|',pl.ProvNum),s1.Seq) ORDER BY s1.Seq, pc.ProcCode, pr.Abbr, pl.ProvNum, pl.CodeNum"
    },
    {
      request: "Active patients who never had specific recall procedures like exams or prophys",
      query: "SELECT patient.PatNum, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit', COUNT(procedurelog.ProcNum) AS ' FROM patient,procedurelog WHERE patient.PatNum NOT IN (SELECT DISTINCT p.PatNum FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum AND pc.ProcCode IN('D0120','D1110','D1204') WHERE pl.ProcStatus='2') AND procedurelog.PatNum=patient.PatNum AND procedurelog.ProcStatus=2 AND patient.PatStatus=0 GROUP BY procedurelog.PatNum ORDER BY patient.LName, patient.FName"
    },
    {
      request: "Count of Patients seen by each provider in date range",
      query: "SET @StartDate='2018-01-01', @EndDate='2018-01-31'; SELECT Abbr AS 'Provider', COUNT(DISTINCT patient.PatNum) AS 'Patients Seen' FROM patient INNER JOIN procedurelog ON procedurelog.PatNum = patient.PatNum AND procedurelog.ProcStatus = 2 AND procedurelog.ProcDate BETWEEN @StartDate AND @EndDate INNER JOIN provider ON procedurelog.ProvNum = provider.ProvNum WHERE patient.patstatus = 0 GROUP BY provider.Abbr ORDER BY provider.Abbr"
    },
    {
      request: "New patients mailing list based on first visit date range",
      query: "DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT DISTINCT PatNum, Guarantor FROM patient WHERE PatStatus=0; SET @pos=0, @FromDate='2008-07-01' , @ToDate='2008-07-31'; SELECT @pos:=@pos+1 as 'Count', LName, FName,DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit', Address, Address2, City, State, Zip FROM patient INNER JOIN tmp ON patient.PatNum=tmp.PatNum INNER JOIN procedurelog ON procedurelog.PatNum=patient.PatNum WHERE procedurelog.ProcStatus=2 AND DateFirstVisit BETWEEN @FromDate AND @ToDate GROUP BY tmp.Guarantor ORDER BY LName; DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "patients not seen since the specified date, with a procedure count.",
      query: "SET @NotSeenSinceDate =\"2021-02-28\"; SELECT patient.PatNum, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit', COUNT(procedurelog.ProcNum) AS ' FROM patient INNER JOIN procedurelog ON procedurelog.PatNum = patient.PatNum AND procedurelog.ProcStatus = 2 INNER JOIN procedurecode ON procedurecode.CodeNum = procedurelog.CodeNum AND procedurecode.ProcCode NOT IN (\"D9986\",\"D9987\") WHERE patient.PatStatus = 0 GROUP BY procedurelog.PatNum HAVING MAX(ProcDate) < @NotSeenSinceDate ORDER BY patient.LName, patient.FName"
    },
    {
      request: "Subscribers with insurance of specific employers, uses insurance employer(s) you should repeat the employer name if you only want one, many times employers are listed more than one way, like HP and Hewlett Packard",
      query: "SELECT EmpName AS 'Employer', PatNum, p.address, p.address2,p.city,p.state,p.zip FROM patient p INNER JOIN inssub iss ON iss.Subscriber=p.PatNum INNER JOIN insplan i ON i.PlanNum=iss.PlanNum INNER JOIN employer e ON i.EmployerNum=e.EmployerNum WHERE p.PatStatus=0 AND ((empname like ('%IBM%')) OR (empname like ('%Frijole Taco Stand%'))) ORDER By EmpName, p.lname;"
    },
    {
      request: "Active patients with no completed procedures",
      query: "SELECT p.PatNum FROM patient p LEFT JOIN procedurelog pl ON p.PatNum=pl.PatNum AND ProcStatus=2 WHERE (pl.PatNum IS NULL) AND p.PatStatus=0 ORDER BY LName;"
    },
    {
      request: "Outstanding sent claims over 30 days old excluding preauths",
      query: "SELECT cl.PatNum,cl.DateService,cl.DateSent, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimStatus='S' AND DateService<(CURDATE()-INTERVAL 30 DAY) AND ClaimType<>'PreAuth' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Preauths received in a specified date range where attached procedures are not scheduled",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SELECT pl.PatNum ,FORMAT(pl.ProcFee * (pl.BaseUnits+pl.UnitQty),2) AS 'ProcFee' ,pc.ProcCode ,pl.ProcStatus ,pl.ProcDate ,c.DateReceived ,ca.CarrierName ,IFNULL(ELT(a.AptStatus,'Scheduled','Complete','UnschedList','ASAP','Broken','Planned','PtNote','PtCompleted'),'No Appt') AS 'AptStatus' ,FORMAT(SUM(cp.InsPayEst),2) AS 'InsPayEst' FROM claim c INNER JOIN claimproc cp ON c.ClaimNum = cp.ClaimNum INNER JOIN insplan i ON cp.PlanNum = i.PlanNum INNER JOIN carrier ca ON i.CarrierNum = ca.CarrierNum INNER JOIN procedurelog pl ON cp.ProcNum = pl.ProcNum AND pl.ProcStatus = 1 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN appointment a ON a.AptNum = pl.AptNum WHERE c.DateReceived BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND c.ClaimType = 'PreAuth' AND c.ClaimStatus = 'R' AND (ISNULL(a.AptNum) OR a.AptStatus NOT IN (1,2)) GROUP BY pl.ProcNum, i.PlanNum;"
    },
    {
      request: "Completed procedures for a date range, limited to specific procedures",
      query: "SET @FromDate='2017-01-01' , @ToDate='2018-01-31'; SET @Codes='D0220,D0110,D1234' ; SET @Codes=(CASE WHEN LENGTH(@Codes)=0 THEN '^' ELSE CONCAT('^',REPLACE(@Codes,',','$|^'),'$') END); SELECT CONCAT(patient.LName, ', ',patient.FName, ' ', patient.MiddleI) AS Patient ,pl.ProcDate ,pv.Abbr ,pc.ProcCode ,pc.AbbrDesc ,ToothNum ,FORMAT(pl.ProcFee*(pl.UnitQty+pl.BaseUnits),2) AS ProcFee_ FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum AND pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND pc.ProcCode REGEXP @Codes INNER JOIN provider pv ON pl.ProvNum = pv.ProvNum ORDER BY ProcDate, patient.LName, patient.FName ASC;"
    },
    {
      request: "Returns all procedure notes entered in given range, including group notes",
      query: "SET @FromDate='2023-11-01' , @ToDate='2023-11-30'; SELECT procnotedates.PatNum , procnotedates.ProcDate , procnotedates.ProcCode , procnotedates.NoteEntered , pn.Note FROM ( SELECT pl.PatNum , ProcDate , MAX(pn.EntryDateTime) AS 'NoteEntered' , pc.ProcCode , pl.ProcNum , p.LName FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN procnote pn ON pl.ProcNum = pn.ProcNum INNER JOIN patient p ON pl.PatNum = p.PatNum WHERE pn.EntryDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY GROUP BY pn.ProcNum ) procnotedates INNER JOIN procnote pn ON procnotedates.ProcNum = pn.ProcNum AND pn.EntryDateTime = procnotedates.NoteEntered ORDER BY procnotedates.LName;"
    },
    {
      request: "New Patients in Date Range with Date of last visit and Procedure Count",
      query: "SET @FromDate='2022-06-01' , @ToDate='2022-06-30'; SELECT p.PatNum ,p.LName ,p.FName ,DATE_FORMAT(MAX(pl.ProcDate),'%m/%d/%Y') AS 'LastVisit' ,COUNT(pl.ProcNum) AS ' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum WHERE pl.ProcStatus = 2 AND p.PatStatus = 0 GROUP BY pl.PatNum HAVING MIN(pl.ProcDate) BETWEEN @FromDate AND @ToDate ORDER BY p.LName;"
    },
    {
      request: "Active patients with given insurance fee schedule",
      query: "SET @FeeSched = ''; SET @FeeSched = (CASE WHEN LENGTH(@FeeSched) = 0 THEN '^' ELSE CONCAT('^',REPLACE(@FeeSched,',','$|^'),'$') END); SELECT carrier.CarrierName, p.PatNum, feesched.request AS 'FeeSchedule' FROM carrier INNER JOIN insplan ip ON carrier.CarrierNum = ip.CarrierNum INNER JOIN inssub iss ON ip.PlanNum = iss.PlanNum INNER JOIN patplan pp ON iss.InsSubNum = pp.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum INNER JOIN feesched ON ip.FeeSched = feesched.FeeSchedNum WHERE p.PatStatus = 0 AND feesched.request REGEXP @FeeSched ORDER BY CarrierName;"
    },
    {
      request: "Check secondary claims received in date range for writeoff amounts",
      query: "SET @FromDate='2008-06-01' , @ToDate='2008-06-30'; SELECT cl.PatNum , WriteOff , cl.DateReceived , ca.CarrierName , ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum = cl.PatNum INNER JOIN insplan i ON i.PlanNum = cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimStatus = 'R' AND DateReceived BETWEEN @FromDate AND @ToDate AND ClaimType = 'S' ORDER BY cl.DateReceived;"
    },
    {
      request: "Patients with treatment planned procedures mailing list without scheduled appointments",
      query: "SELECT LName, FName, Address, Address2, City, State, Zip, SUM(ProcFee) FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum=ap.AptNum WHERE (isnull(ap.aptnum) OR AptStatus=6 OR AptStatus=3) AND ProcStatus=1 AND Length(Zip)>1 AND PatStatus=0 GROUP BY patient.PatNum ORDER BY patient.LName, patient.FName ASC;"
    },
    {
      request: "Patient recall information with billing type and email",
      query: "SELECT p.LName, p.FName, p.BirthDate, p.BillingType, p.Email, r.DateDue, d.ItemName AS 'RecallStatus' FROM patient p INNER JOIN recall r ON p.PatNum=r.PatNum LEFT JOIN definition d ON r.RecallStatus=d.DefNum"
    },
    {
      request: "Count of completed appointments in date range",
      query: "SET @Start ='2008-08-01', @End='2008-08-31'; SELECT Count(*) FROM appointment WHERE aptstatus=2 AND AptDateTime BETWEEN @Start AND @End+INTERVAL 1 DAY;"
    },
    {
      request: "Treatment planned procedures for patients with no scheduled apt with specified carrier",
      query: "SET @Carrier='%%'; SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) AS Patient ,pc.ProcCode AS 'Code' ,pc.abbrdesc AS 'request' ,pl.ToothNum ,DATE_FORMAT(pl.ProcDate,'%m-%d-%Y') AS 'Date' ,c.CarrierName ,pl.ProcFee * (pl.BaseUnits + pl.UnitQty) AS 'ProcFee' FROM carrier c INNER JOIN insplan ip ON c.CarrierNum = ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum = ip.PlanNum INNER JOIN patplan pp ON ib.InsSubNum = pp.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum = ap.AptNum WHERE ( ISNULL(ap.aptnum) OR AptStatus = 6 OR AptStatus = 3 ) AND ProcStatus = 1 AND c.CarrierName LIKE(@Carrier) ORDER BY aptstatus, p.LName, p.FName ASC;"
    },
    {
      request: "Treatment Planned procedures that were treatment planned in a specific date range and which provider treatment planned it",
      query: "SET @FromDate='2008-09-01' , @ToDate='2008-09-30'; SELECT pa.PatNum ,pc.ProcCode AS 'Code' ,pc.AbbrDesc AS 'request' ,pl.ToothNum ,DATE_FORMAT(pl.DateTP,'%m-%d-%Y') AS 'DateTP' ,pr.Abbr ,pl.ProcFee*(pl.BaseUnits+pl.UnitQty) AS '$ProcFee' FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pr ON pl.ProvNum = pr.ProvNum WHERE pl.ProcStatus = 1 AND pl.DateTP BETWEEN @FromDate AND @ToDate ORDER BY pl.DateTP,pa.LName, pa.FName ASC"
    },
    {
      request: "Patient list of Sum of the Fees of all Treatment planned and all scheduled procedures",
      query: "DROP TABLE IF EXISTS tmp1; CREATE TABLE tmp1 SELECT patient.PatNum, sum(ProcFee) AS '$Scheduled', 0 AS '$TP' FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN appointment ap ON pl.AptNum=ap.AptNum AND AptStatus=1 AND PatStatus=0 GROUP BY patient.PatNum; INSERT INTO tmp1(PatNum, $Scheduled, $TP) SELECT patient.PatNum, 0 AS '$Scheduled', sum(ProcFee) AS '$TP' FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum=ap.AptNum WHERE (isnull(ap.aptnum) OR AptStatus=6 OR AptStatus=3) AND PatStatus=0 GROUP BY patient.PatNum; SELECT PatNum, SUM($Scheduled), SUM($TP) FROM tmp1 GROUP BY PatNum HAVING SUM($TP)>0 ORDER BY SUM($TP) DESC; DROP TABLE IF EXISTS tmp1;"
    },
    {
      request: "Active patients who have had recall disabled",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', rep.PatNum AS 'Pat Num', rep.PatNum, rep.request, rep.DatePrevious FROM ( SELECT p.PatNum, DatePrevious, rt.request FROM patient p INNER JOIN recall r ON p.PatNum = r.PatNum INNER JOIN recalltype rt ON r.RecallTypeNum = rt.RecallTypeNum WHERE IsDisabled = 1 AND PatStatus = 0 ORDER BY p.LName, p.FName ) rep"
    },
    {
      request: "Treatment Planned procedures that match codes in list, for patients with no scheduled appts containing the specified codes",
      query: "SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) AS Patient, pc.ProcCode AS 'Code', pc.AbbrDesc AS 'request', pl.ToothNum, DATE_FORMAT(pl.ProcDate,'%m-%d-%Y') AS 'ProcDate', DATE_FORMAT(pl.DateTP,'%m-%d-%Y') AS 'DateTP', ap.AptStatus, (pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS ProcFee FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum=ap.AptNum WHERE ( ISNULL(ap.AptNum) OR ap.AptStatus=6 OR ap.AptStatus=3 ) AND pl.ProcStatus=1 AND patient.PatStatus=0 AND (pc.ProcCode IN('D0120','D0140','D0220')) ORDER BY ap.AptStatus, patient.LName, patient.FName ASC;"
    },
    {
      request: "Daily procedures call list",
      query: "SELECT pl.ProcDate, pa.PatNum, pc.AbbrDesc, pr.Abbr, pa.HmPhone, pa.WirelessPhone, pa.WkPhone FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum AND pl.ProcStatus = 2 AND pl.ProcDate = CURDATE() INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pr ON pr.ProvNum = pl.ProvNum ORDER BY pa.PatNum"
    },
    {
      request: "Insurance estimates and paid amounts of claims that were created in Date Range",
      query: "SET @FromDate='2024-09-01' , @ToDate='2024-09-30'; SELECT c.PatNum ,c.DateService ,c.ClaimStatus ,c.DateSent ,ca.CarrierName ,c.InsPayEst ,c.InsPayAmt FROM claim c INNER JOIN insplan i ON c.PlanNum = i.PlanNum INNER JOIN carrier ca ON i.CarrierNum = ca.CarrierNum INNER JOIN patient p ON c.PatNum = p.PatNum WHERE c.DateService BETWEEN @FromDate AND @ToDate GROUP BY c.ClaimNum ORDER BY p.LName, p.FName"
    },
    {
      request: "End of day call back list for completed procedures",
      query: "SET @AlwaysCurrentDay = 'Yes'; SET @FromDate='2020-01-01', @ToDate='2020-01-01'; SET @Procedures=''; SELECT pl.ProcDate, p.PatNum, p.HmPhone, p.WirelessPhone, p.WkPhone, GROUP_CONCAT(DISTINCT pr.Abbr) AS 'Provider', GROUP_CONCAT(DISTINCT pc.ProcCode) AS 'Code' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 2 AND IF(@AlwaysCurrentDay = \"Yes\", pl.ProcDate = CURDATE(), pl.ProcDate BETWEEN @FromDate AND @ToDate) INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@Procedures) = 0, TRUE, FIND_IN_SET(pc.ProcCode, @Procedures)) INNER JOIN provider pr ON pr.ProvNum = pl.ProvNum GROUP BY pl.ProcDate, pl.PatNum ORDER BY pl.ProcDate, p.LName, p.FName"
    },
    {
      request: "Patients who have given carrier with date of last treatment",
      query: "SET @Carrier='%Cigna%'; SET @SeenAfterDate='2020-03-15'; SELECT p.PatNum , DATE_FORMAT(MAX(ProcDate), '%m/%d/%Y') AS 'LastVisit' , COUNT(pl.ProcNum) AS ' , c.CarrierName FROM carrier c INNER JOIN insplan ip ON c.CarrierNum = ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum = ip.PlanNum INNER JOIN patplan pp ON ib.InsSubNum = pp.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum WHERE pl.ProcStatus = 2 AND p.PatStatus = 0 AND c.CarrierName LIKE(@Carrier) GROUP BY pl.PatNum HAVING MAX(ProcDate) > DATE(@SeenAfterDate) ORDER BY p.LName, p.FName, p.PatNum;"
    },
    {
      request: "Addresses (with insurance) of active patients with tp procs with no sched apt",
      query: "SELECT p.LName , p.FName , p.MiddleI , p.Address , p.Address2 , p.City , p.State , p.Zip FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND ProcStatus = 1 LEFT JOIN appointment ap ON p.PatNum = ap.PatNum AND ap.AptStatus IN(1,6) WHERE ap.AptNum IS NULL AND p.PatStatus = 0 AND LENGTH(p.ZIP) > 4 AND p.HasIns = 'I' GROUP BY p.PatNum ORDER BY p.LName, p.FName;"
    },
    {
      request: "Addresses of active patients  (with no insurance) with tp procs with no sched apt",
      query: "SELECT LName,FName, MiddleI,Address, Address2, City, State, Zip FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum AND ProcStatus=1 LEFT JOIN appointment ap ON patient.PatNum=ap.PatNum AND (ap.AptStatus=1 OR ap.AptStatus=6 ) WHERE ap.AptNum IS NULL AND patient.PatStatus=0 AND LENGTH(ZIP)>4 AND patient.HasIns<>'I' GROUP BY patient.PatNum ORDER BY LName, FName;"
    },
    {
      request: "Treatment Plans Master",
      query: "SELECT p.PatNum, tp.Heading, DATE_FORMAT(tp.DateTP,'%m-%d-%Y') AS \"DateTP\", SUM(pt.FeeAmt - pt.Discount) AS \"$Proposed\", ( SELECT SUM(pt1.FeeAmt) FROM proctp pt1 INNER JOIN procedurelog pl1 ON pt1.ProcNumOrig = pl1.ProcNum WHERE pt1.TreatPlanNum = tp.TreatPlanNum AND pl1.AptNum = nextVisit.AptNum GROUP BY pt1.TreatPlanNum ) AS '$NextVisit', ( SELECT SUM(pt1.FeeAmt - pt1.Discount) FROM proctp pt1 INNER JOIN procedurelog pl ON pt1.ProcNumOrig = pl.ProcNum WHERE pl.ProcStatus = 2 AND tp.TreatPlanNum = pt1.TreatPlanNum ) AS '$Done', procs.TP AS '$TotTP', procs.Comp AS '$DoneEver' FROM patient p INNER JOIN treatplan tp ON tp.PatNum = p.PatNum INNER JOIN proctp pt ON pt.TreatPlanNum = tp.TreatPlanNum LEFT JOIN ( SELECT pl1.PatNum ,SUM(IF(pl1.ProcStatus = 1,pl1.ProcFee * (pl1.UnitQty + pl1.BaseUnits),0)) AS \"TP\" ,SUM(IF(pl1.ProcStatus = 2,pl1.ProcFee * (pl1.UnitQty + pl1.BaseUnits),0)) AS \"Comp\" FROM procedurelog pl1 WHERE pl1.ProcStatus IN (1,2) GROUP BY pl1.PatNum ) procs ON procs.PatNum = p.PatNum LEFT JOIN ( SELECT a.PatNum ,MIN(a.AptDateTime) AS \"Date\" ,SUBSTRING_INDEX(GROUP_CONCAT(a.AptNum ORDER BY a.AptDateTime ASC SEPARATOR \"||\"),\"||\",1) AS \"AptNum\" FROM appointment a WHERE a.AptStatus = 1 AND a.AptDateTime > CURDATE() + INTERVAL 1 DAY GROUP BY a.PatNum ) nextVisit ON nextVisit.PatNum = p.PatNum WHERE p.PatStatus = 0 AND procs.TP > 0 GROUP BY tp.TreatPlanNum ORDER BY p.LName, tp.DateTP;"
    },
    {
      request: "Outstanding insurance claims by Date of Service, secondary claims ONLY",
      query: "SELECT cl.PatNum,cl.DateService,cl.DateSent, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimStatus='S' AND DateService<(CURDATE()-INTERVAL 30 DAY) AND ClaimType='S' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Balance and Fee for every procedure for a given patient (useful when entering procedure split payments)",
      query: "SET @PatNum=25; SELECT pl.ProcDate, ProcCode, ToothNum, pl.ProcFee*(pl.BaseUnits+pl.UnitQty) $ProcFee_, cp.DateCP, IFNULL(cp.InsPayAmt,0) AS $InsPaid_, IFNULL(cp.WriteOff,0) AS $InsWriteOff_, ps.DatePay, IFNULL(SUM(ps.SplitAmt),0) AS $PatPaid_, IF((pl.ProcFee*(pl.BaseUnits+pl.UnitQty))-(IFNULL(cp.InsPayAmt,0)+IFNULL(cp.WriteOff,0)+IFNULL(SUM(ps.SplitAmt),0)) = 0, '0.00', (pl.ProcFee*(pl.BaseUnits+pl.UnitQty))-(IFNULL(cp.InsPayAmt,0)+IFNULL(cp.WriteOff,0)+IFNULL(SUM(ps.SplitAmt),0)) ) AS $ProcBal_ FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN paysplit ps ON ps.ProcNum = pl.ProcNum LEFT JOIN ( SELECT cp.ProcNum, cp.DateCP, SUM(cp.InsPayAmt) InsPayAmt, SUM(cp.WriteOff) WriteOff FROM claimproc cp WHERE cp.PatNum = @PatNum GROUP BY cp.ProcNum ) cp ON cp.ProcNum = pl.ProcNum WHERE pl.ProcStatus = 2 AND pl.ProcFee > 0 AND pl.PatNum = @PatNum GROUP BY pl.ProcNum ORDER BY pl.ProcDate;"
    },
    {
      request: "Patients that have Service Year instead of Calendar Year insurance benefit",
      query: "SELECT p.PatNum, c.CarrierName, COUNT(*) AS 'NumServYearBens' FROM carrier c INNER JOIN insplan ip ON c.CarrierNum=ip.CarrierNum INNER JOIN inssub ib ON ip.PlanNum=ib.PlanNum INNER JOIN patplan pp ON ib.InsSubNum=pp.InsSubNum INNER JOIN patient p ON pp.PatNum=p.PatNum INNER JOIN benefit b ON ip.PlanNum=b.PlanNum WHERE p.PatStatus=0 AND b.TimePeriod=1 GROUP BY p.PatNum, c.CarrierName ORDER BY p.LName, p.FName, c.CarrierName;"
    },
    {
      request: "Count number of Active patients in each billing type.",
      query: "SELECT BillingType, COUNT(*) FROM patient WHERE PatStatus=0 GROUP BY BillingType;"
    },
    {
      request: "Production and Income for a particular patient (with adjustments, insurance income by inspay date and writeoffs)\r\nBy more narrow date range if desired, as is will return all income and production for patient",
      query: "SET @PatNum='2', @FromDate='' , @ToDate='2020-10-10'; SELECT display.PatNum ,ROUND(display.InsProcPay, 2) AS '$InsProcPay' ,ROUND(display.WriteOff, 2) AS '$WriteOff' ,ROUND(display.PatientPay, 2) AS '$PatientPay' ,ROUND(display.PatAdj, 2) AS '$PatAdj' ,ROUND((display.InsProcPay + display.PatientPay), 2) AS '$TotalPaid' ,ROUND(display.Production, 2) AS '$Production' FROM ( SELECT p.PatNum ,( SELECT SUM(InsPayAmt) FROM claim c WHERE c.PatNum=p.PatNum AND c.DateReceived BETWEEN @FromDate AND @ToDate ) AS 'InsProcPay' ,( SELECT SUM(Writeoff) FROM claim c WHERE c.PatNum=p.PatNum AND c.DateReceived BETWEEN @FromDate AND @ToDate ) AS 'WriteOff' ,( SELECT SUM(SplitAmt) FROM paysplit WHERE p.PatNum=paysplit.PatNum AND DatePay BETWEEN @FromDate AND @ToDate ) AS 'PatientPay' ,( SELECT SUM(AdjAmt) FROM adjustment WHERE p.PatNum=adjustment.PatNum AND adjdate BETWEEN @FromDate AND @ToDate ) AS 'PatAdj' ,SUM(pl.procfee * (pl.BaseUnits+pl.UnitQty)) AS 'Production' FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum AND pl.ProcStatus=2 WHERE p.PatNum=@PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY p.PatNum )display;"
    },
    {
      request: "List of Patient status patients with each insurance plan (not just subscribers). Includes only matching carriers, group names, and group numbers.",
      query: "SET @Carriers='Delta,United'; SET @GroupNames=''; SET @GroupNums=''; SET @Carriers = IF(LENGTH(@Carriers) = 0,'^',REPLACE(@Carriers,',','|')) , @GroupNames = IF(LENGTH(@GroupNames) = 0,'^',REPLACE(@GroupNames,',','|')) , @GroupNums = IF(LENGTH(@GroupNums) = 0,'^',REPLACE(@GroupNums,',','|')); SELECT c.CarrierName , ip.GroupName , ip.GroupNum , (CASE ip.PlanType WHEN 'c' THEN 'Capitation' WHEN 'p' THEN 'PPO Percentage' WHEN '' THEN 'Category Percentage' WHEN 'f' THEN 'Medicaid/Flat Copay' ELSE 'Unknown' END) AS 'PlanType' , p.PatNum , ib.SubscriberId FROM carrier c INNER JOIN insplan ip ON ip.CarrierNum = c.CarrierNum AND ip.GroupName REGEXP @GroupNames AND ip.GroupNum REGEXP @GroupNums INNER JOIN inssub ib ON ib.PlanNum = ip.PlanNum INNER JOIN patplan pp ON pp.InsSubNum = ib.InsSubNum INNER JOIN patient p ON p.PatNum = pp.PatNum AND p.PatStatus = 0 WHERE c.CarrierName REGEXP @Carriers GROUP BY pp.PatPlanNum ORDER BY ip.PlanType, c.CarrierName, ip.GroupName, p.LName, p.FName, pp.PatPlanNum, p.PatNum"
    },
    {
      request: "Returns all treatment planned procedures for active patients without a scheduled OR planned apt, who were last seen in a given date range\r\nwith phone numbers, useful for those transitioning to planned appointments (this differs FROM #56 largely in that it is date limited and lists out the treatment)",
      query: "SET @FromDate='2023-10-01' , @ToDate='2023-10-08'; SELECT tpprocs.PatName , LEFT(tpprocs.HmPhone,15) AS HmPhone , LEFT(tpprocs.WkPhone,21) AS WKPhone , LEFT(tpprocs.Wireless,15) AS Wireless , tpprocs.ProcCode , tpprocs.ProcFee AS '$Fee' , lastvisit.LastVisit FROM ( SELECT p.PatNum , CONCAT(p.LName, ', ',p.FName, ' ', p.MiddleI) AS PatName , p.HmPhone , p.WkPhone , p.WirelessPhone AS Wireless , pl.ProcFee*(pl.BaseUnits+pl.UnitQty) AS 'ProcFee' , pc.ProcCode FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 1 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN appointment ap ON p.PatNum = ap.PatNum AND ap.AptStatus IN(1, 6) WHERE ap.AptNum IS NULL AND p.PatStatus = 0 ) tpprocs INNER JOIN ( SELECT p.PatNum , DATE_FORMAT(MAX(pl.ProcDate), '%m/%d/%Y') AS 'LastVisit' , MAX(pl.ProcDate) AS 'DateLast' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcStatus = 2 WHERE p.PatStatus = 0 GROUP BY pl.PatNum ) lastvisit ON tpprocs.PatNum = lastvisit.PatNum WHERE lastvisit.DateLast BETWEEN @FromDate AND @ToDate ORDER BY tpprocs.PatName;"
    },
    {
      request: "New patients for a time span, defined more tightly. New patient is someone who comes in once for an exam with a specific code (in this case D0150, D0180) and has at least one completed charged procedures on a subsequent visit.  This is not a great criteria for new patients, as it requires a second visit and so should only be used on recent date ranges",
      query: "SET @FromDate='2008-03-01',@ToDate='2008-09-30'; SET @CompExamCodes='D0150,D0180'; SELECT p.PatNum , DATE_FORMAT(a.CompExamDate,'%m-%d-%Y') AS 'CompExamDate' , DATE_FORMAT(MIN(pl.ProcDate),'%m-%d-%Y') AS 'SecondVisit' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcStatus = 2 AND pl.ProcFee > 0 INNER JOIN ( SELECT pl.PatNum , MIN(pl.ProcDate) AS 'CompExamDate' FROM procedurelog pl INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum WHERE IF(LENGTH(@CompExamCodes), FIND_IN_SET(pc.ProcCode,@CompExamCodes), TRUE) GROUP BY pl.PatNum HAVING MIN(pl.ProcDate) BETWEEN @FromDate AND @ToDate ) a ON p.PatNum = a.PatNum AND a.CompExamDate < pl.ProcDate WHERE p.PatStatus = 0 GROUP BY p.PatNum ORDER BY a.CompExamDate, p.LName, p.FName, p.PatNum"
    },
    {
      request: "Received vs expected payment on received claims initially sent in the specified date range, per carrier",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Carrier='%%'; SELECT ca.CarrierName AS 'Carrier' ,SUM(cl.ClaimFee) AS '$TotalBilled' ,SUM(cl.InsPayEst) AS '$TotalEstPaid' ,SUM(cl.InsPayAmt) AS '$TotalPaid' ,SUM(cl.InsPayAmt) - SUM(cl.ClaimFee) AS '$BilledPaidDiff' FROM claim cl INNER JOIN insplan ip ON ip.PlanNum = cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum AND ca.CarrierName LIKE @Carrier WHERE cl.ClaimStatus = 'R' AND cl.DateSentOrig BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY ca.CarrierName ORDER BY ca.CarrierName, ip.CarrierNum"
    },
    {
      request: "Hold claims in date range with carrier details and payment estimates",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SELECT cl.PatNum ,cl.DateSent ,cl.DateService ,ca.CarrierName ,ca.Phone ,cl.ClaimStatus ,cl.InsPayEst ,cl.InsPayAmt FROM claim cl INNER JOIN patient p ON p.PatNum = cl.PatNum INNER JOIN insplan i ON i.PlanNum = cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = i.CarrierNum WHERE cl.ClaimStatus = 'H' AND cl.DateService BETWEEN DATE(@FromDate) AND DATE(@ToDate) ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Patients seen in date range year who have had non-diagnostic work (procedure codes not starting with D0)\r\nMailing list limits to one person per guarantor and to those who have zip codes",
      query: "SET @FromDate='2007-09-01' , @ToDate='2008-09-30'; SET @pos=0; DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT DISTINCT PatNum, Guarantor FROM patient WHERE PatStatus=0; SELECT @pos:=@pos+1 AS 'Count', LName, FName, Address, Address2, City, State, Zip FROM patient INNER JOIN tmp ON patient.PatNum=tmp.PatNum INNER JOIN procedurelog ON procedurelog.PatNum=patient.PatNum INNER JOIN procedurecode pc ON procedurelog.CodeNum=pc.CodeNum WHERE procedurelog.ProcStatus=2 AND ProcDate BETWEEN @FromDate AND @ToDate AND LENGTH(Zip)>4 AND ProcCode NOT LIKE ('D0%') GROUP BY tmp.Guarantor ORDER BY LName; DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "Active (by patient status) patients who have the specified insurance carrier",
      query: "SET @Carriers ='%%'; SELECT p.PatNum ,carrier.CarrierName FROM carrier INNER JOIN insplan ip ON carrier.CarrierNum = ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum = ip.PlanNum INNER JOIN patplan pp ON ib.InsSubNum = pp.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum AND p.PatStatus = 0 WHERE carrier.CarrierName LIKE @Carriers ORDER BY CarrierName, p.LName, p.FName, p.PatNum, pp.PatPlanNum;"
    },
    {
      request: "Lists all patients with billing type indicated and how much they have paid total, ever",
      query: "SET @BillingTypes = ''; SET @BillingTypes = (CASE WHEN LENGTH(@BillingTypes) = 0 THEN '^' ELSE CONCAT('^',REPLACE(@BillingTypes,',','$|^'),'$') END); SELECT p.PatNum, d.ItemName, SUM(SplitAmt) AS TotPayAmt, p.PatStatus FROM patient p INNER JOIN paysplit ps ON p.PatNum = ps.PatNum INNER JOIN definition d ON p.BillingType = d.DefNum WHERE d.ItemName REGEXP @BillingTypes GROUP BY p.PatNum ORDER BY p.LName,FName;"
    },
    {
      request: "Insurance Payments received in a given period, summed by carrier",
      query: "SET @FromDate='2021-01-01', @ToDate='2021-01-31' ; SELECT c.CarrierName AS 'Carrier' ,ROUND(SUM(cp.InsPayAmt),2) AS '$PaymentEntered' FROM insplan ip INNER JOIN carrier c ON c.CarrierNum=ip.CarrierNum INNER JOIN claimproc cp ON ip.PlanNum=cp.PlanNum WHERE cp.DateCP BETWEEN @FromDate AND @Todate AND cp.Status IN(1,4) GROUP BY c.CarrierName;"
    },
    {
      request: "Insurance Payments entered and Checks received in a given period, not summed by carrier, useful for finding discrepancies",
      query: "SET @FromDate='2008-01-01', @ToDate='2008-01-31' ; SELECT c.CarrierName,cp.PatNum, cp.InsPayAmt AS '$PaymentEntered', (SELECT SUM(cpy.CheckAmt) FROM claimpayment cpy WHERE cpy.CarrierName=c.CarrierName AND cpy.CheckDate BETWEEN @FromDate AND @Todate) AS '$CheckTotals' FROM insplan ip INNER JOIN carrier c ON c.CarrierNum=ip.CarrierNum INNER JOIN claimproc cp ON ip.PlanNum=cp.PlanNum WHERE (cp.DateCP BETWEEN @FromDate AND @Todate) AND (cp.Status=1 OR cp.Status=4) ORDER BY c.CarrierName;"
    },
    {
      request: "Last visit before given date for all active patients with phone numbers",
      query: "SET @BeforeDate='2016-01-02'; SELECT p.PatNum, WkPhone, HmPhone, WirelessPhone AS CellPhone, LastVisit.MaxProcDate AS DateLastVisit, @BeforeDate AS DateBefore FROM patient p INNER JOIN ( SELECT pl.PatNum, MAX(pl.ProcDate) AS MaxProcDate FROM procedurelog pl WHERE pl.ProcStatus=2 GROUP BY pl.PatNum HAVING MAX(pl.ProcDate)<=@BeforeDate ) LastVisit ON p.PatNum=LastVisit.PatNum WHERE PatStatus=0 GROUP BY p.PatNum ORDER BY p.LName,p.FName;"
    },
    {
      request: "Patients of specified age range and gender",
      query: "SET @Young='1', @Old='100'; SET @Gender='1'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', PatNum, (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5)) AS 'Age', (CASE WHEN Gender=0 THEN 'M' WHEN Gender=1 THEN 'F' ELSE 'U' END) AS 'Gender' FROM patient WHERE ((YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5))) BETWEEN @Young AND @Old AND Gender=@Gender AND PatStatus=0 ORDER BY LName, FName;"
    },
    {
      request: "Patients (in 'Patient' status) that have Service Year instead of Calendar Year insurance benefits",
      query: "SELECT p.PatNum , c.CarrierName , ip.MonthRenew FROM carrier c INNER JOIN insplan ip ON c.CarrierNum = ip.CarrierNum INNER JOIN inssub ib ON ip.PlanNum = ib.PlanNum INNER JOIN patplan pp ON ib.InsSubNum = pp.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum INNER JOIN benefit b ON ip.PlanNum = b.PlanNum WHERE p.PatStatus = 0 AND b.TimePeriod = 1 GROUP BY p.PatNum, ip.PlanNum ORDER BY ip.MonthRenew, p.LName, p.FName, c.CarrierName;"
    },
    {
      request: "Active Patients who have had a particular proc completed relative to Active patients who have had any proc completed\r\nwithin a given date range",
      query: "SET @CodeCompleted='D0120%'; SET @FromDate='2008-01-01', @ToDate='2008-12-31' ; SELECT (SELECT COUNT(DISTINCT p.PatNum) FROM procedurelog pl INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum INNER JOIN patient p ON p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 AND pc.ProcCode LIKE(@CodeCompleted) AND (ProcDate Between @FromDate AND @ToDate)) AS 'PatsCompParticProc', (SELECT COUNT(DISTINCT p.PatNum) FROM procedurelog pl INNER JOIN patient p ON p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 AND (ProcDate Between @FromDate AND @ToDate)) AS 'ActPatients', FORMAT(100*(SELECT (PatsCompParticProc / ActPatients)),1) AS '% with proc';"
    },
    {
      request: "Patient count by zip code, with at least 1 completed procedure (excludes broken/missed codes), \r\nlimits to count(zipcodes)>3 as outliers, can be changed to 0 to include all",
      query: "SELECT LEFT(Zip,5) AS ZipCode, COUNT(DISTINCT p.PatNum) AS 'Patients' FROM procedurelog pl INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum AND pc.ProcCode NOT IN ('D9986', 'D9987') INNER JOIN patient p ON p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 GROUP BY ZipCode HAVING patients>3;"
    },
    {
      request: "Patient count by city, with at least 1 completed procedure",
      query: "SELECT City, COUNT(DISTINCT p.PatNum) AS 'Patients' FROM procedurelog pl INNER JOIN patient p ON p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 GROUP BY City;"
    },
    {
      request: "Patients with no entry in the recall table",
      query: "SELECT PatNum FROM patient p WHERE p.PatNum NOT IN (SELECT PatNum FROM recall) AND p.PatStatus != 4"
    },
    {
      request: "Guarantors (heads of households) of patients with no ins, with address",
      query: "SELECT g.LName, g.FName, g.Address, g.Address2, g.City, g.Zip FROM patient p INNER JOIN patient g ON p.Guarantor=g.PatNum WHERE p.PatStatus=0 AND p.HasIns<>'I' GROUP BY g.PatNum;"
    },
    {
      request: "Patient contact information verification list for appointments on given date",
      query: "SET @Date='2008-09-29'; SELECT p.PatNum, CONCAT(p.Address, p.Address2, \" \", p.City, \", \", p.zip) AS Address, CONCAT(HmPhone, \" - \", WkPhone, \" - \",WirelessPhone) AS 'Phone Numbers', LEFT(CarrierName,15) AS 'Carrier (abbr)' FROM appointment a INNER JOIN patient p ON a.PatNum=p.PatNum LEFT JOIN patplan pp ON p.PatNum=pp.PatNum AND ORDINAL=1 LEFT JOIN inssub ib ON ib.InsSubNum=pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum=ib.PlanNum LEFT JOIN carrier c ON c.CarrierNum=ip.CarrierNum WHERE DATE(a.AptDateTime) LIKE @Date GROUP BY p.PatNum ORDER BY LName, FName;"
    },
    {
      request: "Production by assistant, ONLY COUNTS completed production in appointments!",
      query: "SET @FromDate='2017-01-01', @ToDate='2017-01-31' ; SELECT ProcDate, SUM(ProcFee*(pl.UnitQty+pl.BaseUnits)) AS $Production__, CONCAT(e.FName, ' ',e.LName) AS Assistant FROM procedurelog pl INNER JOIN appointment a ON a.AptNum=pl.AptNum INNER JOIN employee e ON a.Assistant=e.EmployeeNum WHERE ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 GROUP BY ProcDate, a.Assistant;"
    },
    {
      request: "Mailing list of guarantors of patients with a particular insplan seen since the set date, similar to 118 but also requires group number, returns the guarantors of all\r\npatients with plan, not the subscriber, also if you drop the plan it goes off the list",
      query: "SET @SinceDate ='2022-01-01'; SET @Carrier='%delta%'; SET @GroupNum='%%'; SELECT DISTINCTROW gu.LName ,gu.FName ,gu.Address ,gu.Address2 ,gu.City ,gu.State ,gu.zip ,ca.CarrierName ,ip.GroupNum FROM patient p INNER JOIN patplan pp ON pp.PatNum = p.PatNum INNER JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum INNER JOIN patient gu ON gu.PatNum = p.Guarantor INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum WHERE ca.CarrierName LIKE(@Carrier) AND ip.GroupNum LIKE(@GroupNum) GROUP BY pl.PatNum HAVING MAX(pl.ProcDate) > @SinceDate ORDER BY ca.CarrierName, gu.LName"
    },
    {
      request: "Scheduled treatment for date range with apt notes includes fee and patient portion",
      query: "SET @FromDate='2022-10-01' , @ToDate='2022-10-30'; SET @NewPatCodes = \"D0150\"; SET @RecallCodes = \"D0120,D1110,D0140\"; SET @ExcludedCodes = \"D0120,D1110,D0140,D0150\"; SET @NewProcCount = 0, @RecallProcCount = 0, @OtherProcCount = 0; SELECT IF(LENGTH(@NewPatCodes) != 0 AND FIND_IN_SET(core.ProcCode,@NewPatCodes),@NewProcCount:=@NewProcCount+1,0) AS \"NewPatCodes\" ,IF(LENGTH(@NewPatCodes) != 0 AND FIND_IN_SET(core.ProcCode,@RecallCodes),@RecallProcCount:=@RecallProcCount+1,0) AS \"RecallCodes\" ,IF(LENGTH(@NewPatCodes) != 0 AND !FIND_IN_SET(core.ProcCode,@ExcludedCodes),@OtherProcCount:=@OtherProcCount+1,0) AS \"NonExcludedCodes\" ,core.Provider ,core.PatNum ,core.AptDateTime ,core.ProcCode ,core.AbbrDesc ,core.Fee AS \"$Fee\" ,core.PatPort AS \"$PatPort\" ,core.AbrAptNote FROM ( SELECT CONCAT(pv.LName, ', ',pv.FName) AS Provider ,patient.PatNum ,pc.ProcCode ,LEFT(AbbrDesc,13) AS AbbrDesc ,LEFT(a.Note, 30) AS AbrAptNote ,a.AptDateTime ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS Fee ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) - SUM(IFNULL(cp.InsPayEst,0)) - SUM(IFNULL(cp.WriteOff,0)) AS PatPort FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN provider pv ON pv.ProvNum = pl.ProvNum INNER JOIN appointment a ON a.AptNum = pl.AptNum AND AptStatus = 1 LEFT JOIN claimproc cp ON cp.ProcNum = pl.ProcNum AND cp.Status = 6 WHERE a.AptDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY GROUP BY pl.ProcNum ORDER BY pv.LName,pv.FName,a.AptDateTime ) core"
    },
    {
      request: "New Patients with referral source, production diagnosed on first visit and total of payments for that day.",
      query: "SET @FromDate='2023-01-01' , @ToDate='2023-01-05'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', core.DateFirstVisit, core.PatNum, core.RefLName, core.RefFName, core.Diagnosed, core.Accepted AS 'FirstVisitPay', core.Gender, core.Position, core.Age, core.Zip FROM ( SELECT p.DateFirstVisit, p.PatNum, r.LName AS RefLName, r.FName AS RefFName, FORMAT(( SELECT SUM(pl.ProcFee) FROM procedurelog pl WHERE pl.PatNum=p.PatNum AND pl.DateTP=p.DateFirstVisit AND pl.ProcStatus!=6 ),2) AS 'Diagnosed' , FORMAT(( SELECT SUM(ps.SplitAmt) FROM paysplit ps WHERE ps.DatePay=p.DateFirstVisit AND ps.PatNum=p.PatNum ),2) AS 'Accepted', p.gender, p.Position, TIMESTAMPDIFF(YEAR,p.Birthdate,CURDATE()) AS 'Age', p.Zip FROM patient p LEFT JOIN refattach ra ON p.PatNum=ra.PatNum LEFT JOIN referral r ON r.ReferralNum=ra.ReferralNum AND ra.RefType = 1 WHERE p.PatStatus=0 AND p.DateFirstVisit BETWEEN @FromDate AND @ToDate ORDER BY p.DateFirstVisit, p.LName, p.FName ) core;"
    },
    {
      request: "Subscribers ordered by employer, lists active patients who are subscribers with insurance through each employer. Like 67, but lists each subscriber instead of count",
      query: "SELECT EmpName AS 'Employer' , PatNum FROM patient p INNER JOIN inssub iss ON iss.Subscriber=p.PatNum INNER JOIN insplan i ON i.PlanNum=iss.PlanNum INNER JOIN employer e ON i.EmployerNum=e.EmployerNum WHERE p.PatStatus IN (0,1) ORDER BY EmpName;"
    },
    {
      request: "Adjustments of non-zero amounts",
      query: "SET @FromDate='2008-10-01' , @ToDate='2008-10-31'; SELECT AdjDate, PatNum, AdjAmt, AdjType, AdjNote FROM adjustment WHERE AdjDate BETWEEN @FromDate AND @ToDate AND AdjAmt>0"
    },
    {
      request: "EMail Addresses of Active Patients",
      query: "SELECT LName, FName, EMail FROM patient WHERE LENGTH(EMail)>3 AND PatStatus=0 ORDER BY LName, FName;"
    },
    {
      request: "\"Patient\" status patients with procedures completed in the specified date range and an email address entered. Includes date last seen within the date range",
      query: "SET @FromDate = '2023-01-01', @ToDate = '2023-01-31'; SELECT p.PatNum ,p.EMail ,MAX(pl.ProcDate) AS 'LastSeen' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 WHERE p.Email LIKE \"%@%\" AND p.PatStatus = 0 GROUP BY pl.PatNum;"
    },
    {
      request: "Guarantors of patients not seen since a given date",
      query: "SET @CutoffDate='2017-10-28'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Cnt', DATE_FORMAT(MAX(tmp.LastSeen),'%m/%d/%Y') AS 'Last Seen', p.LName, p.FName, p.HmPhone, p.WirelessPhone, p.Address, p.Address2, p.City, p.State, p.Zip FROM patient p INNER JOIN ( SELECT p.Guarantor, MAX(pl.ProcDate) AS 'LastSeen' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE pl.ProcStatus = 2 AND p.PatStatus = 0 GROUP BY pl.PatNum HAVING MAX(pl.ProcDate) < @CutoffDate ) tmp ON p.PatNum = tmp.Guarantor WHERE LENGTH(ZIP) > 4 GROUP BY p.PatNum ORDER BY p.LName, p.FName"
    },
    {
      request: "TP Procs with date of treatment plan of patients with no scheduled appointment where date of TP >= given date Like #50 with date limitation",
      query: "SET @SinceDate='2012-01-13'; SET @ProceduresToExclude='D2393,D1110'; SET @ProceduresToExcludeUse=(CASE WHEN LENGTH(@ProceduresToExclude)=0 THEN '^' ELSE CONCAT('^',REPLACE(REPLACE(@ProceduresToExclude,', ','$|^'), ',','$|^'),'$') END); SELECT CONCAT(p.LName, ', ',p.FName, ' ', p.MiddleI) AS Patient ,pc.ProcCode AS 'Code' ,pc.AbbrDesc AS 'request' ,pl.ToothNum ,DATE_FORMAT(pl.ProcDate,'%m-%d-%Y') AS 'Date' ,ap.AptStatus ,(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS 'ProcFee' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum = ap.AptNum WHERE ( ISNULL(ap.aptnum) OR ap.AptStatus = 6 OR ap.AptStatus = 3 ) AND pl.DateTP >= @SinceDate AND pl.ProcStatus = 1 AND p.PatStatus = 0 AND IF(@ProceduresToExcludeUse = '^', TRUE, pc.ProcCode NOT REGEXP @ProceduresToExcludeUse) ORDER BY ap.aptstatus, p.LName, p.FName ASC;"
    },
    {
      request: "Patients with appointment in date range who had no procedure completed in the given interval prior to the scheduled appointment\r\nPossible useful to show patients who need an extra reminder in order to show up, not hugely practical (add address2 if you use that field)",
      query: "SET @pos=0, @StartDate='2008-11-13' , @EndDate='2008-12-13', @DaysSinceLastSeen=21; SELECT @pos:=@pos+1 AS 'Count', LName,FName, Address, City, State, Zip, ap.AptDateTime, (SELECT DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') FROM patient INNER JOIN procedurelog ON procedurelog.PatNum=patient.PatNum WHERE procedurelog.ProcStatus=2 AND patient.PatStatus=0 AND p.PatNum=patient.PatNum GROUP BY procedurelog.PatNum) AS LastVisit FROM patient p INNER JOIN appointment ap ON p.PatNum=ap.PatNum AND ap.AptStatus=1 WHERE (DATE(ap.AptDateTime) BETWEEN @StartDate AND @EndDate) AND ((SELECT MAX(ProcDate) FROM patient INNER JOIN procedurelog ON procedurelog.PatNum=patient.PatNum WHERE procedurelog.ProcStatus=2 AND patient.PatStatus=0 AND p.PatNum=patient.PatNum GROUP BY procedurelog.PatNum) < DATE_SUB(ap.AptDateTime, INTERVAL @DaysSinceLastSeen DAY)) ORDER BY aptstatus, p.LName, p.FName ASC;"
    },
    {
      request: "Referred out patients in a date range, with specialty and status.",
      query: "SET @StartDate='2017-01-01' , @EndDate='2018-01-05'; SET @pos=0; SELECT @pos:=@pos+1 AS 'RowCount', A.* FROM( SELECT p.PatNum AS PatID, p.LName AS PatLast, p.FName AS PatFirst, (CASE WHEN ra.RefToStatus=0 THEN 'None' WHEN ra.RefToStatus=1 THEN 'Declined' WHEN ra.RefToStatus=2 THEN 'Scheduled' WHEN ra.RefToStatus=3 THEN 'Consulted' WHEN ra.RefToStatus=4 THEN 'InTreatment' ELSE 'Complete' END) AS 'Status', r.LName AS RefLast, r.FName AS RefFirst, DATE_FORMAT(ra.RefDate,'%m/%d/%Y') AS RefDate, def.ItemName AS 'Specialty' FROM patient p INNER JOIN refattach ra ON ra.PatNum = p.PatNum AND ra.RefType = 0 AND ra.RefDate BETWEEN @StartDate AND @EndDate INNER JOIN referral r ON r.ReferralNum=ra.ReferralNum INNER JOIN definition def ON def.DefNum=r.Specialty WHERE p.PatStatus = 0 )A ORDER BY A.PatLast, A.PatFirst, A.RefDate;"
    },
    {
      request: "Mailing Info Active patients who have no email address for either themselves or guarantor",
      query: "SELECT p.LName, p.FName, p.Address, p.Address2, p.City, p.State, p.Zip FROM patient p WHERE p.PatStatus=0 AND LENGTH(p.Zip)>4 AND p.PatNum NOT IN(SELECT p.PatNum FROM patient p INNER JOIN patient g ON g.PatNum=p.Guarantor WHERE p.PatStatus=0 AND (p.Email LIKE '%@%' OR g.Email LIKE '%@%') ) ORDER BY p.LName, p.FName;"
    },
    {
      request: "Phone Numbers for Active patients who have no email address for either themselves or guarantor",
      query: "DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT DISTINCT Guarantor, Email FROM patient WHERE PatStatus =0 AND NOT (EMail LIKE ('%@%')); SELECT LName, FName, HmPhone, WirelessPhone AS 'Cell', WkPhone FROM patient, tmp WHERE patient.PatNum=tmp.Guarantor AND Length(ZIP)>4 ORDER BY LName; DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "Patients of given appointment confirmation status having appointments of a certain date range that have been completed or are scheduled",
      query: "SET @pos=0, @StartDate='2008-09-13' , @EndDate='2008-12-13', @ConfirmStat='%not%'; SELECT @pos:=@pos+1 AS 'Count', p.PatNum, AptStatus, DATE_FORMAT(AptDateTime, '%m/%d %l:%i %p ') AS AptSched, LEFT(HmPhone, 15) AS HmPhone, LEFT(WirelessPhone, 15) AS Cell, LEFT(WkPhone, 15) AS WkPhone, LEFT(Note, 20) AS 'AptNote(abr)' FROM appointment a INNER JOIN patient p ON a.PatNum=p.PatNum INNER JOIN definition d ON a.Confirmed=d.DefNum WHERE AptDateTime BETWEEN @StartDate AND @EndDate+INTERVAL 1 DAY AND d.ItemName LIKE(@ConfirmStat) AND AptStatus IN(1,2)"
    },
    {
      request: "Recall info for insured patients without a specific insurance carrier, excluding scheduled when specified, and are due for recall in the specified date range.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @ExcludedCarrier='%%'; SET @ExcludeSched=''; SELECT p.LName ,p.FName ,rt.request ,r.DateDue ,IFNULL(d.ItemName, '') AS 'RecallStatus' ,( SELECT DATE_FORMAT(MAX(pl.ProcDate),'%m/%d/%Y') FROM procedurelog pl WHERE pl.ProcStatus = 2 AND pl.PatNum=p.PatNum GROUP BY pl.PatNum ) AS 'LastVisit' ,IFNULL(nv.NextAppt, 'None') AS 'NextAppt' ,c.CarrierName FROM patient p INNER JOIN recall r ON p.PatNum = r.PatNum AND r.DateDue BETWEEN DATE(@FromDate) AND DATE(@ToDate) INNER JOIN recalltype rt ON rt.RecallTypeNum = r.RecallTypeNum INNER JOIN patplan pp ON pp.PatNum = p.PatNum INNER JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum INNER JOIN carrier c ON c.CarrierNum = ip.CarrierNum AND IF(@ExcludedCarrier='%%', TRUE, c.CarrierName NOT LIKE @ExcludedCarrier) LEFT JOIN definition d ON r.RecallStatus = d.DefNum LEFT JOIN( SELECT a.PatNum ,DATE_FORMAT(MIN(a.AptDateTime),'%m/%d/%Y') AS 'NextAppt' FROM appointment a WHERE a.AptStatus = 1 AND a.AptDateTime > CURDATE() + INTERVAL 1 DAY GROUP BY a.PatNum ) nv ON nv.PatNum = p.PatNum WHERE IF(@ExcludeSched = 'Yes', ISNULL(nv.PatNum), TRUE) ORDER BY p.LName, p.FName, r.DateDue, p.PatNum, r.RecallNum, pp.Ordinal, pp.PatPlanNum"
    },
    {
      request: "Patients seen in date range with age, zip and sum of fees for procs completed (apx production, neglects writeoffs)",
      query: "SET @FromDate='2021-01-19', @ToDate='2021-01-21'; SET @ProvList = ''; SET @pos=0 ,@ProvListUse=(CASE WHEN LENGTH(@ProvList)=0 THEN '^' ELSE CONCAT('^',REPLACE(REPLACE(@ProvList,', ','$|^'), ',','$|^'),'$') END); SELECT @pos:=@pos+1 AS 'Count' , display.PatNum AS 'PatID' , display.Name AS 'Patient Name' , display.Zip , display.Age , display.$Prod_ FROM( SELECT p.PatNum ,CONCAT( p.LName ,',' ,IF( LENGTH(p.Preferred) > 0 , CONCAT(' \\'', p.Preferred,'\\' ') , ' ' ) ,p.FName ,IF( LENGTH(p.MiddleI) > 0 , CONCAT(' ', p.MiddleI) , '' ) ) AS 'Name' ,p.Zip ,TIMESTAMPDIFF(YEAR,p.Birthdate,CURDATE()) AS 'Age' ,SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS $Prod_ FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 INNER JOIN provider plprov ON plprov.ProvNum = pl.ProvNum AND plprov.Abbr REGEXP @ProvListUse WHERE p.patstatus = 0 GROUP BY p.PatNum ORDER BY p.LName, p.FName )display;"
    },
    {
      request: "Aging with Outstanding Insurance Claim info and Patient Balances",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', p.PatNum AS PatID, p.PatNum, EstBalance AS '$Bal-', BalTotal AS '$Fam-', Bal_0_30 AS '$0-30-', Bal_31_60 AS '$31-60-', Bal_61_90 '$61-90-', BalOver90 AS '$+90-', (SELECT COUNT(*) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S') AND claim.ClaimType<>'PreAuth') AS ' (SELECT SUM(ClaimFee) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS '$Clms-', (SELECT SUM(InsPayEst) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS '$InsEst-' FROM patient p WHERE EstBalance<>0 OR BalTotal<>0 ORDER BY LName, FName;"
    },
    {
      request: "Aging with Outstanding Insurance Claim info and Family Balances, Summed by Guarantor",
      query: "SET @pos=0; DROP TABLE IF EXISTS tmp1; CREATE TABLE tmp1 SELECT p.PatNum, p.Guarantor, BalTotal , Bal_0_30, Bal_31_60, Bal_61_90, BalOver90, (SELECT COUNT(*) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S') AND claim.ClaimType<>'PreAuth') AS 'Claims', (SELECT SUM(ClaimFee) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS 'ClaimAmts', (SELECT SUM(InsPayEst) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS 'InsEst' FROM patient p WHERE EstBalance<>0 OR BalTotal<>0; SELECT @pos:=@pos+1 AS 'Count',tmp1.Guarantor, SUM(tmp1.BalTotal) AS '$Fam-', SUM(tmp1.Bal_0_30) AS '$0-30-', SUM(tmp1.Bal_31_60) AS '$31-60-', SUM(tmp1.Bal_61_90)AS '$61-90-', SUM(tmp1.BalOver90)AS '$+90-', SUM(tmp1.Claims) AS ' SUM(tmp1.ClaimAmts) AS '$Claims-', SUM(tmp1.InsEst) AS '$InsEst-' FROM tmp1 INNER JOIN patient p ON tmp1.Guarantor=p.PatNum GROUP BY tmp1.Guarantor ORDER BY p.LName, p.FName;"
    },
    {
      request: "Mailing List of Guarantors of Patients seen in date range \r\nwhere sum of fees for procedures completed (apx production, neglects writeoffs) \r\nfor family exceeds a specified amount",
      query: "SET @StartDate='2023-01-01', @EndDate='2023-12-31'; SET @ProdGreaterThan='400'; SELECT g.LName , g.FName , g.Address , g.Address2 , g.City , g.State , g.Zip , g.Email , SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS '$Prod-' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum INNER JOIN patient g ON g.PatNum=p.Guarantor AND p.patstatus = 0 AND pl.ProcDate BETWEEN @StartDate AND @EndDate AND pl.ProcStatus = 2 GROUP BY g.PatNum HAVING SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) > CAST(@ProdGreaterThan AS DECIMAL(12,2)) ORDER BY g.LName, g.FName, g.PatNum;"
    },
    {
      request: "Birthdate query for mailing including year",
      query: "SET @StartDate='1950-01-01', @EndDate='1990-02-28'; SELECT LName , FName , Address , Address2 , City , State , Zip , Birthdate FROM patient WHERE (Birthdate BETWEEN @StartDate AND @EndDate) AND PatStatus = 0 ORDER BY LName, FName"
    },
    {
      request: "Referred out patients by doctor, use large date range if none needed",
      query: "SET @StartDate='2020-01-01', @EndDate='2023-01-15'; SET @pos = 0; SELECT @pos := @pos + 1 AS 'Count' ,core.PatID ,core.PatLast ,core.PatFirst ,core.Status ,core.RefLast ,core.RefFirst ,core.Note FROM ( SELECT p.PatNum AS 'PatID' ,p.LName AS 'PatLast' ,p.FName AS 'PatFirst' ,(CASE WHEN ra.RefToStatus = 0 THEN 'None' WHEN ra.RefToStatus = 1 THEN 'Declined' WHEN ra.RefToStatus = 2 THEN 'Scheduled' WHEN ra.RefToStatus = 3 THEN 'Consulted' WHEN ra.RefToStatus = 4 THEN 'InTreatment' ELSE 'Complete' END) AS 'Status' ,r.LName AS 'RefLast' ,r.FName AS 'RefFirst' ,ra.Note FROM patient p INNER JOIN refattach ra ON ra.PatNum = p.PatNum AND ra.RefType = 0 AND ra.RefDate BETWEEN @StartDate AND @EndDate INNER JOIN referral r ON r.ReferralNum = ra.ReferralNum WHERE p.PatStatus = 0 GROUP BY p.PatNum, ra.RefAttachNum ORDER BY ra.RefDate ) core"
    },
    {
      request: "Patient count by age, with at least 1 completed procedure",
      query: "SELECT (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5)) AS 'Age', COUNT(DISTINCT p.PatNum) AS 'Patients' FROM procedurelog pl INNER JOIN patient p ON p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 GROUP BY Age;"
    },
    {
      request: "Aging report which only includes families who do NOT have a balance >90 days\r\nAND who have a positive balance (owe)",
      query: "SELECT PatNum,Bal_0_30,Bal_31_60,Bal_61_90, BalTotal AS $BalTot_,InsEst AS $InsEst_,BalTotal-InsEst AS $pat_ FROM patient WHERE PatStatus != 4 AND (Bal_0_30 > '.005' OR Bal_31_60 > '.005' OR Bal_61_90 > '.005') AND BalOver90 < '.005' ORDER BY LName,FName;"
    },
    {
      request: "Treatment planned non-diagnostic and non-preventive procedures without scheduled appointment with phone numbers",
      query: "SELECT patient.PatNum , patient.HmPhone , patient.WkPhone , patient.WirelessPhone , FORMAT(SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) ,2) AS '$FeeSum' FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum AND pl.ProcStatus=1 LEFT JOIN appointment ap ON patient.PatNum=ap.PatNum AND ap.AptStatus=1 WHERE ap.AptNum IS NULL AND patient.PatStatus=0 AND (NOT (pc.ProcCode LIKE('D0%'))) AND (NOT (pc.ProcCode LIKE('D1%'))) GROUP BY patient.PatNum HAVING SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) > 0 ORDER BY patient.LName, patient.FName ASC, patient.PatNum;"
    },
    {
      request: "Referred out patients for a specific ref source",
      query: "SET @StartDate = '2023-01-01', @EndDate = '2023-01-31'; SET @RefLName = '%%'; SET @pos = 0; SELECT @pos := @pos + 1 AS 'RowCount' ,core.PatID ,core.PatLast ,core.PatFirst ,core.Status ,core.RefLast ,core.RefFirst ,core.Note FROM ( SELECT p.PatNum AS 'PatID' ,p.LName AS 'PatLast' ,p.FName AS 'PatFirst' ,(CASE WHEN ra.RefToStatus=0 THEN 'None' WHEN ra.RefToStatus=1 THEN 'Declined' WHEN ra.RefToStatus=2 THEN 'Scheduled' WHEN ra.RefToStatus=3 THEN 'Consulted' WHEN ra.RefToStatus=4 THEN 'InTreatment' ELSE 'Complete' END) AS 'Status' ,r.LName AS 'RefLast' ,r.FName AS 'RefFirst' ,ra.Note FROM patient p INNER JOIN refattach ra ON ra.PatNum = p.PatNum INNER JOIN referral r ON r.ReferralNum = ra.ReferralNum AND ra.RefType = 0 AND ra.RefDate BETWEEN @StartDate AND @EndDate AND r.LName LIKE @RefLName WHERE p.PatStatus = 0 ORDER BY ra.RefDate ) core"
    },
    {
      request: "Day Summary, may also be used for date ranges",
      query: "SET @FromDate='2010-12-21' , @ToDate='2010-12-21'; SELECT DATE(pl.ProcDate) AS 'DateServ' ,p.PatNum, SUM(pl.procfee) AS '$Product', (SELECT SUM(InsPayEst) FROM claim c WHERE c.PatNum=p.PatNum AND (Date(c.DateService)=Date(pl.ProcDate))) AS '$InsEst_', (SELECT SUM(Writeoff) FROM claim c WHERE c.PatNum=p.PatNum AND (Date(c.DateService)=(Date(pl.ProcDate)))) AS '$PPO', (SELECT SUM(SplitAmt) FROM paysplit WHERE p.PatNum=paysplit.PatNum AND (Date(DatePay)=(Date(pl.ProcDate)))) AS '$PatPay', (SELECT SUM(AdjAmt) FROM adjustment WHERE p.PatNum=adjustment.PatNum AND (Date(AdjDate)=(Date(pl.ProcDate)))) AS '$PatAdj', (SELECT GROUP_CONCAT(DISTINCT ItemName) FROM paysplit INNER JOIN payment ON paysplit.PayNum=payment.PayNum INNER JOIN definition d ON payment.PayType=d.DefNum WHERE p.PatNum=paysplit.PatNum AND (Date(DatePay)=(Date(pl.ProcDate)))) AS 'HowPaid', p.EstBalance AS '$PatBal', p.EstBalance-(SELECT SUM(cp.InsPayEst+cp.WriteOff) FROM claimproc cp WHERE cp.status=0 AND cp.PatNum=p.PatNum) AS '$PatEst', (SELECT g.BalTotal FROM patient g WHERE p.Guarantor=g.PatNum) AS '$FamTotB',(SELECT g.BalTotal-g.InsEst FROM patient g WHERE p.Guarantor=g.PatNum) AS '$FamEstB' FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum AND pl.ProcStatus=2 WHERE pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY pl.ProcDate,p.PatNum ORDER BY pl.ProcDate,p.LName, p.FName;"
    },
    {
      request: "Day Summary, note that only payment associated with \r\nToday are returned and only if there was service Today, does not return insurance payments\r\n as payments are not received on service date and this is intended for day sheet use",
      query: "SELECT DATE(pl.ProcDate) AS 'DateServ' ,p.PatNum, SUM(pl.procfee) AS '$Product', (SELECT SUM(InsPayEst) FROM claim c WHERE c.PatNum=p.PatNum AND (Date(c.DateService)=Date(pl.ProcDate))) AS '$InsEst_', (SELECT SUM(Writeoff) FROM claim c WHERE c.PatNum=p.PatNum AND (Date(c.DateService)=(Date(pl.ProcDate)))) AS '$PPO', (SELECT SUM(SplitAmt) FROM paysplit WHERE p.PatNum=paysplit.PatNum AND (Date(DatePay)=(Date(pl.ProcDate)))) AS '$PatPay', (SELECT SUM(AdjAmt) FROM adjustment WHERE p.PatNum=adjustment.PatNum AND (Date(AdjDate)=(Date(pl.ProcDate)))) AS '$PatAdj', (SELECT GROUP_CONCAT(DISTINCT ItemName) FROM paysplit INNER JOIN payment ON paysplit.PayNum=payment.PayNum INNER JOIN definition d ON payment.PayType=d.DefNum WHERE p.PatNum=paysplit.PatNum AND (Date(DatePay)=(Date(pl.ProcDate)))) AS 'HowPaid', p.EstBalance AS '$PatBal', p.EstBalance-(SELECT SUM(cp.InsPayEst+cp.WriteOff) FROM claimproc cp WHERE cp.Status=0 AND cp.PatNum=p.PatNum) AS '$PatEst', (SELECT g.BalTotal FROM patient g WHERE p.Guarantor=g.PatNum) AS '$FamTotB',(SELECT g.BalTotal-g.InsEst FROM patient g WHERE p.Guarantor=g.PatNum) AS '$FamEstB' FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum AND pl.ProcStatus=2 WHERE pl.ProcDate =CURDATE() GROUP BY pl.ProcDate,p.PatNum ORDER BY pl.ProcDate,p.LName, p.FName;"
    },
    {
      request: "Scheduled appointments between the specified date and yesterday for a specified provider",
      query: "SET @AsOf='2024-01-01'; SET @Providers=''; SET @Provs=IF(LENGTH(@Providers) = 0, '^', REPLACE(@Providers, ',', '|')); SELECT a.PatNum , a.AptDateTime , a.Op , pr.Abbr AS 'Provider' , IFNULL(( SELECT hyg.Abbr FROM provider hyg WHERE hyg.ProvNum = a.ProvHyg ), '') AS 'Hygienist' FROM appointment a INNER JOIN provider pr ON a.ProvNum = pr.ProvNum AND pr.Abbr REGEXP @Provs WHERE a.AptStatus = 1 AND IF(LENGTH(@AsOf) = 0, a.AptDateTime <= CURDATE(), a.AptDateTime BETWEEN DATE(@AsOf) AND CURDATE()) ORDER BY a.AptDateTime, a.PatNum, a.AptNum;"
    },
    {
      request: "Patients who need followup-Patients with a procedure in a given list completed in date range but no other procedures on another date, \r\napts are counted by procedures summed by date, so it works even if you so not use appointments",
      query: "SET @FromDate='2008-12-01' , @ToDate='2008-12-30'; SELECT patient.PatNum, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit', COUNT(DISTINCT procedurelog.ProcDate) AS ' FROM patient,procedurelog WHERE patient.PatNum IN (SELECT DISTINCT p.PatNum FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum AND pc.ProcCode IN('D0120','D1110','D1204') WHERE pl.ProcStatus='2') AND procedurelog.PatNum=patient.PatNum AND procedurelog.ProcStatus=2 AND patient.PatStatus=0 GROUP BY procedurelog.PatNum HAVING (MIN(ProcDate) BETWEEN @FromDate AND @ToDate) AND COUNT(DISTINCT procedurelog.ProcDate)=1 ORDER BY patient.LName, patient.FName;"
    },
    {
      request: "List of all procedures of status 'Existing Current Provider' in date range",
      query: "SET @FromDate='2007-12-01' , @ToDate='2008-12-30'; SELECT p.PatNum, pc.ProcCode, pc.Descript,pl.ProcDate, pl.ProcFee FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum WHERE pl.ProcStatus=3 AND p.PatStatus=0 AND (pl.ProcDate BETWEEN @FromDate AND @ToDate) ORDER BY p.LName, p.FName, pl.ProcDate;"
    },
    {
      request: "List of all completed work with fee of $0 and with 'D Code' in date range with standard fee listed",
      query: "SET @FromDate='2007-12-01' , @ToDate='2008-12-30'; SELECT p.PatNum, pc.ProcCode, LEFT(pc.Descript, 35) AS 'request(first 35 chars)',pl.ProcDate, pl.ProcFee, fee.Amount AS $UCR FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum INNER JOIN provider pv ON pl.ProvNum=pv.ProvNum INNER JOIN fee ON fee.FeeSched=pv.FeeSched AND pc.CodeNum=fee.CodeNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 AND (pl.ProcDate BETWEEN @FromDate AND @ToDate) AND pl.ProcFee=0 AND pc.ProcCode LIKE ('D%') ORDER BY p.LName, p.FName, pl.ProcDate;"
    },
    {
      request: "List of active patients (status of Patient) with the total sum of procedure fees on completed procedures in the date range, also listing their referred from referral source(s), if they have any. Excludes patients who have no production on completed procedures in the date range.",
      query: "SET @FromDate='2024-10-01', @ToDate='2024-10-31'; SELECT p.PatNum , FORMAT(SUM(pl.ProcFee*(pl.BaseUnits+pl.UnitQty)),2) AS '$Treatment' , COALESCE( GROUP_CONCAT(DISTINCT IF( r.FName='' ,r.LName ,CONCAT(r.LName,', ',r.FName) ) ORDER BY ra.ItemOrder,ra.RefAttachNum SEPARATOR ' | ' ) ,'' ) AS 'Referral Source' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 LEFT JOIN refattach ra ON ra.PatNum = p.PatNum AND ra.RefType = 1 LEFT JOIN referral r ON r.ReferralNum = ra.ReferralNum WHERE p.PatStatus = 0 GROUP BY p.PatNum HAVING SUM(pl.ProcFee*(pl.BaseUnits+pl.UnitQty))>0 ORDER BY SUM(pl.ProcFee*(pl.BaseUnits+pl.UnitQty)) DESC,p.LName,p.FName,p.PatNum;"
    },
    {
      request: "Referrals 'To' of a given status and key word in referral attachment note",
      query: "SELECT ra.PatNum,RefDate, r.LName, r.FName,r.Telephone, LEFT(ra.Note,35) AS 'Note (first 30 chars)' FROM refattach ra INNER JOIN referral r ON r.ReferralNum=ra.ReferralNum WHERE ra.RefToStatus=2 AND ra.Note LIKE('%ray%') ORDER BY RefDate DESC;"
    },
    {
      request: "New Patients, Count per week for a given date range. Active patients only.",
      query: "SET @FromDate='2008-01-01', @ToDate='2008-12-31'; SELECT Year(DateFirstVisit) AS Year, WeekofYear(DateFirstVisit) AS Week, COUNT(DISTINCT patient.PatNum) AS 'New Patients' FROM patient, procedurelog WHERE procedurelog.PatNum = patient.PatNum AND patient.patstatus = '0' AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate AND procedurelog.ProcStatus=2 AND patient.DateFirstVisit >= @FromDate AND procedurelog.ProcFee > 0 GROUP BY WeekofYear(DateFirstVisit) ORDER BY patient.DateFirstVisit;"
    },
    {
      request: "Income by ref source for date range",
      query: "SET @FromDate = '2008-09-01', @ToDate = '2008-12-30'; DROP TABLE IF EXISTS insurance_pay; CREATE TEMPORARY TABLE insurance_pay( PatNum MEDIUMINT UNSIGNED NOT NULL, Payment DOUBLE NOT NULL, PRIMARY KEY (PatNum)); INSERT INTO insurance_pay SELECT clm.PatNum, SUM(clm.InsPayAmt) AS InsPaid FROM claimproc clm WHERE clm.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY clm.PatNum; DROP TABLE IF EXISTS planned_proc; CREATE TEMPORARY TABLE planned_proc (PatNum MEDIUMINT UNSIGNED NOT NULL, PlannedFee DOUBLE NOT NULL, PRIMARY KEY (PatNum)); INSERT INTO planned_proc SELECT plog.PatNum, SUM(plog.ProcFee) AS Planned_Fee FROM procedurelog plog WHERE plog.ProcStatus=1 AND plog.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY plog.PatNum; DROP TABLE IF EXISTS var_payments; CREATE TEMPORARY TABLE var_payments( PatNum MEDIUMINT UNSIGNED NOT NULL, PayAmt DOUBLE NOT NULL, PRIMARY KEY (PatNum)); INSERT INTO var_payments SELECT pay.PatNum , SUM( pay.PayAmt ) AS Total FROM payment pay WHERE pay.PayDate BETWEEN @FromDate AND @ToDate GROUP BY pay.PatNum; DROP TABLE IF EXISTS referred; CREATE TEMPORARY TABLE referred( PatNum MEDIUMINT UNSIGNED NOT NULL, RefSource VARCHAR(255)NOT NULL); INSERT INTO referred SELECT ra.PatNum, CASE WHEN NotPerson=1 THEN re.LName ELSE CONCAT( re.Fname, ' ', re.LName ) END AS Source FROM referral re, refattach ra WHERE re.ReferralNum = ra.ReferralNum AND ra.RefDate BETWEEN @FromDate AND @ToDate AND ra.IsFrom = 1 ; SELECT ref.RefSource AS Source, COUNT(DISTINCT ref.PatNum) AS HowMany, COALESCE(SUM(ins.Payment),0) AS \"Insurance Collected\", COALESCE(SUM(pay.PayAmt),0) AS \"Cash, CC, Checks, Financing\", COALESCE(COALESCE(SUM(ins.Payment),0) + COALESCE(SUM(payAmt),0)) AS \"Total Collected\", COALESCE(SUM(pln.PlannedFee),0) AS \"Treatment Planned\" FROM referred ref LEFT OUTER JOIN insurance_pay ins ON ref.PatNum = ins.PatNUm LEFT OUTER JOIN var_payments pay ON ref.PatNum = pay.PatNum LEFT OUTER JOIN planned_proc pln ON ref.PatNum = pln.PatNum GROUP BY ref.RefSource ORDER BY ref.RefSource; DROP TABLE IF EXISTS insurance_pay; DROP TABLE IF EXISTS var_payments; DROP TABLE IF EXISTS referred; DROP TABLE IF EXISTS planned_proc;"
    },
    {
      request: "Total production in Date Range for a list of specific procedure codes",
      query: "SET @FromDate='2017-01-01', @ToDate='2017-01-31'; SET @Codes = 'D0120|D1206|D1351|D2962|D4341|D4342|D4355|D6010|D7288|D8040|D8040.01|D9000|D9248|D9940|D9941|D9975|D9976|D9980|D9981'; SET @Codes=(CASE WHEN @Codes='' THEN '^' ELSE CONCAT('^',REPLACE(@Codes,'|','$|^'),'$') END); SELECT SUM(procedures.ProcFee*(procedures.UnitQty+procedures.BaseUnits)) AS Production, ProcCode FROM ( SELECT c.ProcCode, p.ProcFee, p.UnitQty, p.BaseUnits, p.ProcDate FROM procedurecode c INNER JOIN procedurelog p ON p.CodeNum=c.CodeNum AND p.ProcStatus=2 AND p.ProcDate BETWEEN @FromDate AND @ToDate WHERE c.ProcCode REGEXP @Codes ) AS procedures GROUP BY ProcCode;"
    },
    {
      request: "Production by carrier on completed procedures in a date range.",
      query: "SET @FromDate='2025-10-01', @ToDate='2025-10-31'; SELECT IF(s1.Seq = 1, core.Carrier, '') AS 'Carrier' , IF(s1.Seq = 1, core.Prod, SUM(core.Prod)) AS 'Production' , IF(s1.Seq = 1, core.InsPayEst, SUM(core.InsPayEst)) AS 'InsPayEst' , IF(s1.Seq = 1, core.Prod - core.InsPayEst, SUM(core.Prod) - SUM(core.InsPayEst)) AS 'PatPortion' FROM ( SELECT !ISNULL(ca.CarrierName) AS 'Order' , COALESCE(ca.CarrierName,'No Insurance') AS 'Carrier' , CAST(SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS DECIMAL(14,2)) AS 'Prod' , CAST(SUM(COALESCE(( SELECT SUM(cp.InsPayEst) FROM claimproc cp WHERE cp.ProcNum = pl.ProcNum AND cp.PlanNum = ip.PlanNum AND cp.Status IN (0,1,6) ),0)) AS DECIMAL(14,2)) AS 'InsPayEst' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 LEFT JOIN patplan pp ON pp.PatNum = p.PatNum LEFT JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = ib.PlanNum LEFT JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum WHERE (ISNULL(ca.CarrierName) OR pp.Ordinal = 1) GROUP BY COALESCE(ca.CarrierName, 'No Insurance') ORDER BY !ISNULL(ca.CarrierName), ca.CarrierName ) core LEFT JOIN seq_1_to_2 s1 ON TRUE GROUP BY IF(s1.Seq = 1, CONCAT(s1.Seq, '+', core.Carrier), s1.Seq) ORDER BY s1.Seq, core.Order, core.Carrier"
    },
    {
      request: "Sum of differences in fee billed and any given fee schedule for all procs completed in a date range for a given carrier, like medicaid",
      query: "SET @FromDate='2023-12-01' , @ToDate='2023-12-31'; SET @FeeSchedule = \"Standard\"; SET @Carrier = \"%Delta%\"; SELECT claim.PatNum , DateService , ProvTreat , pc.ProcCode , f.Amount AS '$UCRFee' , (pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS '$FeeCharged' , f.Amount - (pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS '$FeeDiff' , ca.CarrierName FROM claim INNER JOIN claimproc cp ON claim.ClaimNum = cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum = pl.ProcNum INNER JOIN insplan ip ON claim.PlanNum=ip.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum INNER JOIN fee f ON pc.CodeNum = f.CodeNum AND f.ProvNum = 0 AND f.ClinicNum = 0 INNER JOIN feesched fs ON f.FeeSched = fs.FeeSchedNum AND fs.request = @FeeSchedule WHERE DateService BETWEEN @FromDate AND @ToDate AND ca.CarrierName LIKE @Carrier ORDER BY claim.DateService, claim.ProvTreat, claim.ClaimNum, pc.ProcCode, pl.ProcNum"
    },
    {
      request: "Patient count by zipcode, for patients with the specified assigned clinic and completed procedures in the specified date range (excludes broken/missed codes). Excludes zipcodes with less than 3 patients",
      query: "SET @FromDate='2025-01-01' , @ToDate='2025-01-31'; SET @Clinics=''; SELECT GROUP_CONCAT(pc.CodeNum) INTO @Broken FROM procedurecode pc WHERE pc.ProcCode IN ('D9986','D9987'); SELECT LEFT(p.Zip, 5) AS 'Zipcode' ,COUNT(DISTINCT p.PatNum) AS 'Patients' FROM procedurelog pl INNER JOIN patient p ON p.PatNum = pl.PatNum AND p.PatStatus = 0 LEFT JOIN clinic c ON c.ClinicNum = p.ClinicNum WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND !FIND_IN_SET(pl.CodeNum, @Broken) AND IF(LENGTH(@Clinics) = 0, TRUE, FIND_IN_SET(IFNULL(c.Abbr, 'Unassigned'), @Clinics)) GROUP BY `Zipcode` HAVING `Patients` > 3 ORDER BY `ZipCode`"
    },
    {
      request: "Patients with NO previous date OR Calculated Date in Recall List\r\nand who HAD A PROCEDURE COMPLETED in given date range, not really needed after version 6.5",
      query: "SET @FromDate='2021-01-01', @ToDate='2021-01-31' , @pos=0; SELECT @pos:=@pos+1 AS 'Count',p.PatNum, LEFT(WkPhone,16) AS WkPhone, LEFT(HmPhone,16) AS HmPhone, LEFT(WirelessPhone,16) AS CellPhone, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 AND (pl.ProcDate BETWEEN @FromDate AND @ToDate) AND p.PatNum IN (SELECT PatNum FROM recall WHERE DateDueCalc = '0001-01-01' AND DatePrevious= '0001-01-01') GROUP BY pl.PatNum;"
    },
    {
      request: "Patients that don't have Previous date and Calculated Date in Recall List\r\nand HAD AN APPOINTMENT in date range, whether apt was completed or not",
      query: "SET @FromDate='2007-01-01', @ToDate='2009-01-31' , @pos=0; SELECT @pos:=@pos+1 as 'Count',p.PatNum, LEFT(WkPhone,16) AS WkPhone, LEFT(HmPhone,16) AS HmPhone, LEFT(WirelessPhone,16) AS CellPhone, DATE_FORMAT(MAX(AptDateTime),'%m/%d/%Y') AS 'LastVisit' FROM patient p INNER JOIN appointment a ON a.PatNum=p.PatNum WHERE p.PatStatus=0 AND (a.AptDateTime BETWEEN @FromDate AND @ToDate) AND p.PatNum NOT IN (SELECT PatNum FROM recall WHERE DateDueCalc = '0001-01-01' AND DatePrevious= '0001-01-01') GROUP BY a.PatNum;"
    },
    {
      request: "Procedures completed for patients of a given age range in a given date range with primary insurance carrier and fee",
      query: "SET @StartAge = 1, @EndAge = 12; SET @FromDate = '2020-01-01', @ToDate = '2020-01-31'; SELECT p.PatNum, pl.ProcNum, TIMESTAMPDIFF(YEAR,p.Birthdate,pl.ProcDate) AS 'AgeAtApt', (CASE WHEN ISNULL(carrier.CarrierName) THEN '*No Insurance' ELSE (carrier.CarrierName) END) AS 'PriCarrier', pc.ProcCode, pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS '$ProcFee', pl.ProcDate FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = ib.PlanNum LEFT JOIN carrier ON carrier.CarrierNum = ip.CarrierNum WHERE TIMESTAMPDIFF(YEAR,p.Birthdate,pl.ProcDate) BETWEEN @StartAge AND @EndAge ORDER BY p.LName, p.FName;"
    },
    {
      request: "Treatment planned procedures treatment planned in a specified date range for patients without a planned or scheduled appointment, excluding specified procedure codes",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @ExcludedCodes='D0150,D0120'; SELECT p.PatNum ,pl.DateTP ,pc.ProcCode ,pc.AbbrDesc ,FORMAT(pl.ProcFee * (pl.BaseUnits + pl.UnitQty),2) AS 'ProcFee' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 1 AND pl.DateTP BETWEEN DATE(@FromDate) AND DATE(@ToDate) INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@ExcludedCodes) = 0, TRUE, !FIND_IN_SET(pc.ProcCode, @ExcludedCodes)) LEFT JOIN appointment a ON a.PatNum = p.PatNum AND a.AptStatus IN (1,6) WHERE p.PatStatus = 0 AND ISNULL(a.PatNum) GROUP BY pl.ProcNum ORDER BY p.LName, p.FName, p.PatNum, pl.DateTP, pc.ProcCode ASC, pl.ProcNum;"
    },
    {
      request: "Treatment planned procedures for patients with neither planned nor scheduled apt,\r\nwhere code is in a user defined list with age and phone numbers \r\naddress can be added if needed, but will not fit on one page with phone numbers",
      query: "SET @CodeLike='D2%'; SELECT patient.PatNum, (YEAR(CURDATE())-YEAR(Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(Birthdate,5)) AS 'Age', pl.DateTP,pc.ProcCode,LEFT(WkPhone,16) AS WkPhone, LEFT(HmPhone,16) AS HmPhone, LEFT(WirelessPhone,16) AS CellPhone FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum AND ProcStatus=1 WHERE (SELECT COUNT(ap.PatNum) FROM appointment ap WHERE patient.PatNum=ap.PatNum AND (ap.AptStatus=1 OR ap.AptStatus=6 ))=0 AND patient.PatStatus=0 AND pc.ProcCode LIKE(@CodeLike) ORDER BY patient.LName, patient.FName, pl.DateTP, pc.ProcCode ASC;"
    },
    {
      request: "Procedures completed for day(or date range) with latest procedure note and tooth surface(s), and whether the note is signed",
      query: "DROP TABLE IF EXISTS tmp1; SET @FromDate='2010-03-22' , @ToDate='2010-03-30'; CREATE TABLE tmp1 SELECT Max(procnote.EntryDateTime) AS 'NoteEntered', procedurelog.ProcDate, provider.LName AS `Dr`, patient.PatNum, patient.LName, procedurelog.ToothNum, procedurelog.Surf, procedurelog.ProcNum, procedurecode.ProcCode, procedurecode.AbbrDesc FROM procedurelog Inner Join procedurecode ON procedurelog.CodeNum = procedurecode.CodeNum Inner Join provider ON provider.ProvNum = procedurelog.ProvNum Inner Join patient ON patient.PatNum = procedurelog.PatNum LEFT Join procnote ON procnote.ProcNum = procedurelog.ProcNum WHERE procedurelog.ProcDate BETWEEN @FromDate AND @ToDate AND procedurelog.ProcStatus = '2' GROUP BY procedurelog.ProcNum; SELECT ProcDate, Dr AS 'Dr.', tmp1.PatNum, ToothNum AS 'T (CASE WHEN NOT ISNULL(tmp1.NoteEntered) THEN (SELECT (CASE WHEN length(pn.Signature)>0 THEN 'Signed' ELSE 'No' END) AS 'Test' FROM procnote pn WHERE tmp1.ProcNum=pn.ProcNum AND pn.EntryDateTime=tmp1.NoteEntered) ELSE 'None' END) AS 'Signed', (CASE WHEN NOT ISNULL(tmp1.NoteEntered) THEN (SELECT pn.Note FROM procnote pn WHERE tmp1.ProcNum=pn.ProcNum AND pn.EntryDateTime=tmp1.NoteEntered) ELSE 'None' END) AS 'Note' FROM tmp1 ORDER BY `Dr.` ASC, LName ASC, ProcCode ASC; DROP TABLE IF EXISTS tmp1;"
    },
    {
      request: "Outstanding Preauths by Date of Sent",
      query: "SELECT cl.PatNum, p.PatNum AS 'RawPatNum',cl.DateSent, ca.CarrierName, ca.Phone, cl.ClaimFee FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimType='PreAuth' AND cl.ClaimStatus<>'R' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Annual production and income report For all providers",
      query: "DROP TABLE IF EXISTS t1,t2; SET @FromDate='2013-01-01' , @ToDate='2014-12-31'; CREATE TABLE t1( YEAR INT NOT NULL, MONTH INT NOT NULL, $Production DOUBLE NOT NULL, $Adjustments DOUBLE NOT NULL, $WriteOff DOUBLE NOT NULL, $TotProd DOUBLE NOT NULL, $PatIncome DOUBLE NOT NULL, $InsIncome DOUBLE NOT NULL, $TotIncome DOUBLE NOT NULL); INSERT INTO t1(MONTH,YEAR,$Production) SELECT MONTH(pl.ProcDate) AS 'Month', YEAR(pl.ProcDate) AS 'Year', SUM(pl.procfee) AS '$Production' FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY YEAR(pl.ProcDate),MONTH(pl.ProcDate); CREATE TABLE t2 SELECT MONTH(a.AdjDate) AS 'Month', YEAR(a.ProcDate) AS 'Year', SUM(a.AdjAmt) AS 'Adjustments' FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate GROUP BY YEAR(a.ProcDate),MONTH(a.AdjDate); UPDATE t1,t2 SET t1.$Adjustments=t2.Adjustments WHERE t1.Month=t2.Month AND t1.Year = t2.Year; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT MONTH(pp.DatePay) AS 'Month', YEAR(pp.DatePay) AS 'Year', SUM(pp.SplitAmt) AS 'PatIncome' FROM paysplit pp WHERE pp.DatePay BETWEEN @FromDate AND @ToDate GROUP BY YEAR(pp.DatePay),MONTH(pp.DatePay); UPDATE t1,t2 SET t1.$PatIncome=t2.PatIncome WHERE t1.Month=t2.Month AND t1.Year = t2.Year; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT MONTH(cp.DateCP) AS 'Month', YEAR(cp.DateCP) AS 'YEAR', SUM(cp.InsPayAmt) AS 'InsIncome', SUM(cp.WriteOff) AS 'WriteOff' FROM claim c INNER JOIN claimproc cp ON c.ClaimNum=cp.ClaimNum WHERE cp.DateCP BETWEEN @FromDate AND @ToDate GROUP BY YEAR(cp.DateCP),MONTH(cp.DateCP); UPDATE t1 LEFT JOIN t2 ON t1.Month=t2.Month AND t1.Year=t2.Year SET t1.$InsIncome=t2.InsIncome, t1.$WriteOff=-t2.WriteOff, t1.$TotProd=t1.$Production+t1.$Adjustments-IFNULL(t2.WriteOff,0), t1.$TotIncome=IFNULL(t2.InsIncome,0)+t1.$PatIncome; DROP TABLE IF EXISTS t2; SELECT * FROM t1 ORDER BY YEAR,MONTH; DROP TABLE IF EXISTS t1; DROP TABLE IF EXISTS t2;"
    },
    {
      request: "Annual production and income report as it would have been pre version 5.5 on a certain date for a given year\r\nFor designated providers",
      query: "DROP TABLE IF EXISTS t1,t2; SET @RunDate='2006-01-01', @FromDate='2005-01-01' , @ToDate='2005-12-31'; CREATE TABLE t1( Month int NOT NULL, $Production double NOT NULL, $Adjustments double NOT NULL, $WriteOff double NOT NULL, $TotProd double NOT NULL, $PatIncome double NOT NULL, $InsIncome double NOT NULL, $TotIncome double NOT NULL); INSERT INTO t1(Month,$Production) SELECT MONTH(pl.ProcDate) AS 'Month', SUM(pl.procfee) AS 'Production' FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND provnum IN (1) GROUP BY MONTH(pl.ProcDate); CREATE TABLE t2 SELECT MONTH(a.AdjDate) AS 'Month', SUM(a.AdjAmt) AS 'Adjustments' FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate AND provnum IN (1) GROUP BY MONTH(a.AdjDate); UPDATE t1,t2 SET t1.$Adjustments=t2.Adjustments WHERE t1.Month=t2.Month; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT MONTH(pp.DatePay) AS 'Month', SUM(pp.SplitAmt) AS 'PatIncome' FROM paysplit pp WHERE pp.DatePay BETWEEN @FromDate AND @ToDate AND provnum IN (1) GROUP BY MONTH(pp.DatePay); UPDATE t1,t2 SET t1.$PatIncome=t2.PatIncome WHERE t1.Month=t2.Month; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT MONTH(cp.ProcDate) AS 'Month', (CASE WHEN ISNULL(SUM(cp.InsPayAmt)) THEN 0 ELSE SUM(cp.InsPayAmt) END) AS 'InsIncome', (CASE WHEN ISNULL(SUM(cp.WriteOff)) THEN 0 ELSE SUM(cp.WriteOff) END) AS 'WriteOff' FROM claim c INNER JOIN claimproc cp ON c.ClaimNum=cp.ClaimNum WHERE cp.ProcDate BETWEEN @FromDate AND @ToDate AND cp.DateCP<@RunDate AND cp.provnum IN (1) GROUP BY MONTH(cp.ProcDate); UPDATE t1,t2 SET t1.$InsIncome=t2.InsIncome, t1.$WriteOff=-t2.WriteOff, t1.$TotProd=t1.$Production+t1.$Adjustments-t2.WriteOff, t1.$TotIncome=t2.InsIncome+t1.$PatIncome WHERE t1.Month=t2.Month; DROP TABLE IF EXISTS t2; SELECT * FROM t1; DROP TABLE IF EXISTS t1; DROP TABLE IF EXISTS t2;"
    },
    {
      request: "Aging with Outstanding Insurance Claim info and Family Balances, summed by\r\nguarantor, includes procedure date of oldest outstanding sent claim, last statement date and \r\nlast payment made, does not fit on one sheet",
      query: "SELECT a.Guarantor , FORMAT(IFNULL(SUM(a.BalTotal), 0), 2) AS 'Fam' , FORMAT(IFNULL(SUM(a.Bal_0_30), 0), 2) AS 'Bal_0_30' , FORMAT(IFNULL(SUM(a.Bal_31_60), 0), 2) AS 'Bal_31_60' , FORMAT(IFNULL(SUM(a.Bal_61_90), 0), 2) AS 'Bal_61_90' , FORMAT(IFNULL(SUM(a.BalOver90), 0), 2) AS 'BalOver90' , SUM(a.Claims) AS 'NumClaims' , FORMAT(IFNULL(SUM(a.ClaimAmts), 0), 2) AS 'ClaimAmts' , IFNULL(MIN(a.LastClaim), '') AS 'OldestCL' , IFNULL(MAX(a.LastPay), '') AS 'LastPay' , IFNULL(GREATEST(COALESCE(MAX(a.LastPatStmnt), '0001-01-01'), COALESCE(a.LastGuarStmnt, '0001-01-01')), '') AS 'LastStmnt' , IFNULL(pn.FamFinancial, '') AS 'FamFinancial' FROM ( SELECT p.PatNum , p.Guarantor , p.BalTotal , p.Bal_0_30 , p.Bal_31_60 , p.Bal_61_90 , p.BalOver90 , ( SELECT COUNT(DISTINCT claim.ClaimNum) FROM claim WHERE claim.PatNum = p.PatNum AND (claim.ClaimStatus = 'W' OR claim.ClaimStatus = 'S') AND claim.ClaimType <> 'PreAuth' ) AS 'Claims' ,( SELECT SUM(claim.ClaimFee) FROM claim WHERE claim.PatNum = p.PatNum AND (claim.ClaimStatus = 'W' OR claim.ClaimStatus = 'S') AND claim.ClaimType<>'PreAuth' ) AS 'ClaimAmts' , ( SELECT SUM(claim.InsPayEst) FROM claim WHERE claim.PatNum = p.PatNum AND (claim.ClaimStatus = 'W' OR claim.ClaimStatus = 'S') AND claim.ClaimType <> 'PreAuth' ) AS 'InsEst' , ( SELECT MIN(claim.DateService) FROM claim WHERE claim.PatNum = p.PatNum AND claim.ClaimStatus = 'S' AND claim.ClaimType <> 'PreAuth' ) AS 'LastClaim' , ( SELECT MAX(paysplit.DatePay) FROM paysplit WHERE paysplit.PatNum = p.PatNum ) AS 'LastPay' , ( SELECT MAX(statement.DateSent) FROM statement WHERE statement.PatNum = p.PatNum ) AS 'LastPatStmnt' , ( SELECT MAX(statement.DateSent) FROM statement WHERE statement.PatNum = p.Guarantor ) AS 'LastGuarStmnt' FROM patient p WHERE p.EstBalance > 0 OR p.BalTotal > 0 ) a INNER JOIN patient p ON a.Guarantor = p.PatNum INNER JOIN patientnote pn ON a.Guarantor = pn.PatNum GROUP BY a.Guarantor ORDER BY p.LName, p.FName"
    },
    {
      request: "Patients to Archive: Last visit X days ago for all active patients with balance  < given amount\r\nhelpful for archiving patients",
      query: "SET @BeforeDate = CURDATE()-INTERVAL 60 DAY; SET @Amount = 5; SELECT p.PatNum, DATE_FORMAT(MAX(pl.ProcDate),'%m/%d/%Y') AS 'LastVisit', g.BalTotal AS 'Family Balance' FROM patient p INNER JOIN patient g ON p.Guarantor = g.PatNum AND g.BalTotal < @Amount INNER JOIN procedurelog pl ON pl.PatNum = p.PatNum AND pl.ProcStatus = 2 LEFT JOIN adjustment adj ON adj.PatNum = p.PatNum WHERE p.PatStatus = 0 GROUP BY pl.PatNum HAVING MAX(pl.ProcDate) < @BeforeDate ORDER BY p.LName, p.FName;"
    },
    {
      request: "Patients with a specified insurance carrier who had a procedure\r\n\tcompleted in date range",
      query: "SET @FromDate = '2021-01-01', @ToDate = '2021-03-19'; SET @Carrier = '%Delta%'; SET @pos = 0; SELECT @pos := @pos + 1 AS \"Count\", core.CarrierName, core.Patient, core.PatNumber AS 'Pat FROM ( SELECT ca.CarrierName, CONCAT( p.LName, ',', (CASE WHEN LENGTH(p.Preferred) > 0 THEN CONCAT(' \\'', p.Preferred,'\\'') ELSE '' END), ' ', p.FName, (CASE WHEN LENGTH(p.MiddleI) > 0 THEN CONCAT(' ', p.MiddleI) ELSE '' END) ) AS 'Patient', CONCAT(\"PatNum:\", p.PatNum) AS 'PatNumber' FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN patplan pp ON p.PatNum = pp.PatNum INNER JOIN inssub ib ON pp.InsSubNum = ib.InsSubNum INNER JOIN insplan ip ON ib.PlanNum = ip.PlanNum INNER JOIN carrier ca ON ip.CarrierNum = ca.CarrierNum AND ca.CarrierName LIKE @Carrier GROUP BY p.PatNum, ca.CarrierNum ORDER BY p.LName, p.FName ) core"
    },
    {
      request: "Patients with a specified insurance seen in date range",
      query: "SET @Start='2023-05-01' , @End='2023-05-31'; SET @Carrier='%delta%', @BalanceGreaterThan=5; SELECT carrier.CarrierName ,patient.PatNum ,CAST(patient.EstBalance AS DECIMAL(14,2)) AS 'PatBalance' FROM carrier INNER JOIN insplan ON insplan.CarrierNum = carrier.CarrierNum INNER JOIN claim ON insplan.PlanNum = claim.PlanNum INNER JOIN claimproc ON claimproc.ClaimNum = claim.ClaimNum INNER JOIN patient ON claimproc.PatNum = patient.PatNum WHERE carrier.CarrierName LIKE(@Carrier) AND claimproc.ProcDate BETWEEN @Start AND @End AND patient.EstBalance > @BalanceGreaterThan GROUP BY patient.PatNum, CarrierName ORDER BY LName, FName"
    },
    {
      request: "Returns inactive, archived, deceased and nonpatients that have scheduled appointment with apt date and time\r\nLimits to appointments scheduled for Today or later",
      query: "SELECT p.PatNum, PatStatus, AptDateTime FROM patient p INNER JOIN appointment a ON p.PatNum=a.PatNum AND AptStatus=1 WHERE p.PatStatus<>0 AND AptDateTime>=CURDATE();"
    },
    {
      request: "Outstanding Claims by Date of Service with PatNum, Amount billed insurance, Amount billed patient and Date sent\r\nEdit Interval number if you want to change minimum time outstanding",
      query: "SELECT cl.PatNum ,p.PatNum AS 'RawPatNum' ,p.ChartNumber ,p.Birthdate ,iss.SubscriberID ,cl.DateService ,cl.DateSent ,ca.CarrierName ,ca.Phone ,cl.ClaimFee AS \"$ClaimFee_\" ,( SELECT SUM(ProcFee * (pl.BaseUnits + pl.UnitQty)) - SUM((CASE WHEN cp.Status IN (0,1,4) THEN cp.WriteOff ELSE COALESCE(NULLIF(cp.WriteOffEstOverride, -1), NULLIF(cp.WriteOffEst, -1), 0) END)) FROM procedurelog pl INNER JOIN claimproc cp ON pl.ProcNum=cp.ProcNum WHERE cp.ClaimNum=cl.ClaimNum ) AS '$PatBilled_' FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN inssub iss ON iss.InsSubNum = cl.InsSubNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimType<>'PreAuth' AND cl.ClaimStatus<>'R' AND DateService<(CURDATE()-INTERVAL 30 DAY) ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Claims of status 'Sent' or 'Received' with a date of service in the date range. Shows the amount billed to insurance and the amount billed to the patient.",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @ClaimStatus=''; SELECT IF(dup.Num = 1,core.PatNum,' ') AS 'PatNum' ,IF(dup.Num = 1,core.PatNum,' ') AS 'RawPatNum' ,IF(dup.Num = 1,core.DateService,' ') AS 'DateService' ,IF(dup.Num = 1,core.DateSent,' ') AS 'DateSent' ,IF(dup.Num = 1,SUBSTRING_INDEX(core.Carrier,'|',-1),' ') AS 'CarrierName' ,IF(dup.Num = 1,SUBSTRING_INDEX(core.Carrier,'|',1),' ') AS 'CarrierPhone' ,IF(dup.Num = 1,core.ClaimStatus,' ') AS 'ClaimStatus' ,IF(dup.Num = 1,core.ClaimFee,SUM(core.ClaimFee)) AS 'ClaimFee' ,IF(dup.Num = 1,core.ProcFee - core.Writeoff,SUM(core.ProcFee) - SUM(core.Writeoff)) AS 'PatBilled' FROM ( SELECT c.PatNum ,c.ClaimNum ,(CASE c.ClaimStatus WHEN 'R' THEN 'Received' WHEN 'S' THEN 'Sent' ELSE 'Why is this displaying' END) AS 'ClaimStatus' ,c.DateService ,c.DateSent ,c.ClaimFee ,( SELECT SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) FROM procedurelog pl INNER JOIN claimproc cp ON cp.ProcNum = pl.ProcNum AND cp.Status IN (0,1,4) WHERE cp.ClaimNum = c.ClaimNum ) AS 'ProcFee' ,c.WriteOff ,( SELECT CONCAT(ca.Phone,'|',ca.CarrierName) FROM carrier ca INNER JOIN insplan ip ON ip.CarrierNum = ca.CarrierNum WHERE ip.PlanNum = c.PlanNum ) AS 'Carrier' FROM claim c WHERE (CASE WHEN LENGTH(@ClaimStatus) = 0 THEN c.ClaimStatus IN ('S','R') WHEN !FIND_IN_SET(@ClaimStatus,('S,R')) THEN FALSE ELSE c.ClaimStatus = @ClaimStatus END) AND c.DateService BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND c.ClaimType != 'PreAuth' GROUP BY c.ClaimNum ) core LEFT JOIN ( SELECT 1 AS 'Num' UNION ALL SELECT 2 ) dup ON TRUE GROUP BY IF(dup.Num = 1,CONCAT(dup.Num,'+',core.ClaimNum),dup.Num) ORDER BY dup.Num, SUBSTRING_INDEX(core.Carrier,'|',-1), core.DateService, core.PatNum, core.ClaimNum"
    },
    {
      request: "List of patients with appointments for a date range (in future or past) with primary insurance carrier listed\r\nAlso lists sum of fees for day and insurance type",
      query: "SET @FromDate = '2022-01-01' , @ToDate = '2022-01-31'; SELECT p.PatNum ,a.AptDateTime ,COALESCE(carrier.CarrierName,'*No Insurance') AS 'PriCarrier' ,SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) AS '$Fees' ,(CASE WHEN ip.PlanType = '' THEN 'Category Percentage' WHEN ip.PlanType = 'p' THEN 'PPO' WHEN ip.PlanType = 'f' THEN 'FlatCopay' WHEN ip.PlanType = 'c' THEN 'Capitation' ELSE 'Unknown' END) AS \"PlanType\" FROM appointment a INNER JOIN procedurelog pl ON a.AptNum = pl.AptNum INNER JOIN patient p ON p.PatNum = a.PatNum LEFT JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub ON pp.InsSubNum = inssub.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = inssub.PlanNum LEFT JOIN carrier ON carrier.CarrierNum = ip.CarrierNum WHERE a.AptDateTime BETWEEN @FromDate AND @ToDate + INTERVAL 1 DAY AND a.AptStatus IN (1,2,4) GROUP BY a.AptNum ORDER BY a.AptDateTime;"
    },
    {
      request: "List of scheduled or completed appointments in a specified date range, with procedure fess and primary insurance information for the appointment's patient",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SELECT p.PatNum ,a.AptDateTime ,(CASE WHEN ISNULL(c.CarrierName) THEN '*No Insurance' ELSE (c.CarrierName) END) AS 'PriCarrier' ,FORMAT(SUM(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)), 2) AS '$Fees' ,(CASE WHEN ip.PlanType='' THEN 'Category Percentage' WHEN ip.PlanType='p' THEN 'PPO' WHEN ip.PlanType='f' THEN 'FlatCopay' WHEN ip.PlanType='c' THEN 'Capitation' WHEN ISNULL(pp.PatPlanNum) THEN '' ELSE 'Unknown' END) AS 'PlanType' ,IFNULL(iss.SubscriberID, '') AS 'SubscriberID' FROM appointment a INNER JOIN patient p ON p.PatNum = a.PatNum INNER JOIN procedurelog pl ON a.AptNum = pl.AptNum LEFT JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = iss.PlanNum LEFT JOIN carrier c ON c.CarrierNum = ip.CarrierNum WHERE a.AptDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY AND a.AptStatus IN (1,2,4) GROUP BY a.AptNum ORDER BY a.AptDateTime, a.AptNum;"
    },
    {
      request: "Lifetime income from new patients that started in date range.",
      query: "SET @FromDate='2021-01-01', @ToDate='2021-01-31'; SELECT GROUP_CONCAT(pc.CodeNum) INTO @Broken FROM procedurecode pc WHERE pc.ProcCode IN ('D9986','D9987'); SELECT IF(s1.Seq = 1, core.PatNum, ' ') AS 'PatNum' , IF(s1.Seq = 1, core.Address, '') AS 'Address' , IF(s1.Seq = 1, core.Address2, '') AS 'Address2' , IF(s1.Seq = 1, core.City, '') AS 'City' , IF(s1.Seq = 1, core.State, '') AS 'State' , IF(s1.Seq = 1, core.Zip, '') AS 'Zip' , IF(s1.Seq = 1, core.Age, '') AS 'Current Age' , IF(s1.Seq = 1, core.Vis1, '') AS 'First Visit' , FORMAT(IF(s1.Seq = 1, core.TxPlan, SUM(core.TxPlan)),2) AS 'Treatment Planned' , FORMAT(IF(s1.Seq = 1, core.Ins, SUM(core.Ins)),2) AS 'Ins Revenue' , FORMAT(IF(s1.Seq = 1, core.Pat, SUM(core.Pat)),2) AS 'Pat Revenue' FROM ( SELECT p.PatNum , p.Address , p.Address2 , p.City , p.State , p.Zip , IF(TIMESTAMPDIFF(YEAR, p.Birthdate, CURDATE()) < 120, TIMESTAMPDIFF(YEAR, p.Birthdate, CURDATE()), 'Unknown') AS 'Age' , IFNULL(NULLIF(LEAST( IFNULL(( SELECT DATE(MIN(a.AptDateTime)) FROM appointment a WHERE a.AptStatus IN (1,2) AND a.PatNum = p.PatNum ),'2999-12-31') , IFNULL(( SELECT MIN(pl.ProcDate) FROM procedurelog pl WHERE pl.ProcStatus = 2 AND !FIND_IN_SET(pl.CodeNum, @Broken) AND pl.PatNum = p.PatNum ),'2999-12-31') ),'2999-12-31'),'NOT SEEN') AS 'Vis1' , CAST(IFNULL(( SELECT SUM(pltp.ProcFee * (pltp.UnitQty + pltp.BaseUnits)) FROM procedurelog pltp WHERE pltp.ProcStatus = 1 AND pltp.PatNum = p.PatNum ),0) AS DECIMAL(14,2)) AS 'TxPlan' , CAST(IFNULL(( SELECT SUM(cp.InsPayAmt) FROM claimproc cp WHERE cp.Status IN (1,4) AND cp.PatNum = p.PatNum ),0) AS DECIMAL(14,2)) AS 'Ins' , CAST(IFNULL(( SELECT SUM(ps.SplitAmt) FROM paysplit ps WHERE ps.PatNum = p.PatNum ),0) AS DECIMAL(14,2)) AS 'Pat' FROM patient p WHERE p.PatStatus NOT IN (4,5) GROUP BY p.PatNum HAVING `Vis1` BETWEEN DATE(@FromDate) AND DATE(@ToDate) ORDER BY `Vis1`, p.LName, p.FName, p.PatNum ) core LEFT JOIN seq_1_to_2 s1 ON TRUE GROUP BY IF(s1.Seq = 1, CONCAT(s1.Seq, '+', core.PatNum), s1.Seq)"
    },
    {
      request: "Patient lifetime revenue and insurance revenue and TP'd procedure totals (also \r\nincludes PatNum and patient age, demographic marketing query) Like 59 but also shows insurance income associated with patient",
      query: "SELECT PatNum, (CASE WHEN TIMESTAMPDIFF(YEAR,Birthdate,CURDATE()) > 120 THEN 'Not Entered' ELSE TIMESTAMPDIFF(YEAR,Birthdate,CURDATE()) END) AS 'Age', COALESCE(( SELECT SUM(SplitAmt) FROM paysplit WHERE paysplit.PatNum = patient.PatNum ), 0) AS '$PatientPaySum', COALESCE(( SELECT SUM(InsPayAmt) FROM claim WHERE claim.PatNum = patient.PatNum ), 0) AS '$InsPaySum', COALESCE(( SELECT SUM(pl.ProcFee*(pl.BaseUnits+pl.UnitQty)) FROM procedurelog pl WHERE pl.ProcStatus = 1 AND pl.PatNum = patient.PatNum ), 0) AS '$Treatment Planned' FROM patient ORDER BY LName;"
    },
    {
      request: "Active Patients whose birthday is in a specified month listed with primary Insurance Carrier, Birthdate, Name and Address",
      query: "SET @BirthMonth =2; SELECT p.LName , p.FName , TIMESTAMPDIFF(YEAR,p.Birthdate,CURDATE()) AS 'Age' , p.Birthdate , p.Address , p.Address2 , p.City , p.State , p.Zip , LEFT(carrier.CarrierName,15) AS 'Ins Abbr' FROM carrier INNER JOIN insplan ip ON carrier.CarrierNum = ip.CarrierNum INNER JOIN inssub i ON i.PlanNum = ip.PlanNum INNER JOIN patplan pp ON pp.InsSubNum = i.InsSubNum AND pp.Ordinal = 1 INNER JOIN patient p ON pp.PatNum = p.PatNum AND p.PatStatus = 0 AND p.Birthdate != '0001-01-01' AND MONTH(p.Birthdate) = @BirthMonth ORDER BY DAY(p.Birthdate), CarrierName, p.LName, p.FName;"
    },
    {
      request: "Treatment planned work totalled by patient with annual ins max, ins used and name of carrier",
      query: "SELECT p.PatNum AS 'Pat p.LName, p.FName, annualmax.AnnualMax '$AnnualMax_', used.AmtUsed '$AmountUsed_', annualmax.AnnualMax-COALESCE(used.AmtUsed,0) '$AmtRemaining_', planned.AmtPlanned '$TreatmentPlan_', c.CarrierName FROM patient p INNER JOIN patplan ON p.PatNum=patplan.PatNum INNER JOIN inssub ON inssub.InsSubNum=patplan.InsSubNum INNER JOIN insplan ip ON ip.PlanNum=inssub.PlanNum INNER JOIN carrier c ON c.CarrierNum=ip.CarrierNum INNER JOIN ( SELECT benefit.PlanNum, MAX(benefit.MonetaryAmt) AS AnnualMax FROM benefit LEFT JOIN covcat ON covcat.CovCatNum = benefit.CovCatNum WHERE benefit.BenefitType = 5 AND benefit.TimePeriod = 2 AND (covcat.EbenefitCat=1 OR ISNULL(covcat.EbenefitCat)) AND benefit.MonetaryAmt > 0 GROUP BY benefit.PlanNum ) annualmax ON annualmax.PlanNum=inssub.PlanNum INNER JOIN ( SELECT patient.PatNum,SUM(pl.ProcFee) AS AmtPlanned FROM patient INNER JOIN ( SELECT PatNum,ProcFee FROM procedurelog WHERE ProcStatus=1 AND ProcFee!=0 ) pl ON patient.PatNum=pl.PatNum WHERE patient.PatStatus=0 GROUP BY patient.PatNum ) planned ON planned.PatNum=p.PatNum AND planned.AmtPlanned>0 LEFT JOIN ( SELECT patplan.PatPlanNum, SUM(claimproc.InsPayAmt) AS AmtUsed FROM claimproc INNER JOIN inssub ON claimproc.InsSubNum=inssub.InsSubNum INNER JOIN patplan ON inssub.InsSubNum=patplan.InsSubNum AND patplan.PatNum=claimproc.PatNum WHERE claimproc.Status IN (1, 3, 4) AND YEAR(claimproc.ProcDate)=YEAR(CURDATE()) AND claimproc.InsPayAmt!=0 GROUP BY patplan.PatPlanNum ) used ON used.PatPlanNum=patplan.PatPlanNum WHERE PatStatus=0 ORDER BY c.CarrierName;"
    },
    {
      request: "Aging report only including families that have any member of family with a particular carrier\r\nAlso includes # of open claims and the sum of the open claim amounts",
      query: "SET @pos=0, @CarrierString='%delta%'; DROP TABLE IF EXISTS tmp1; CREATE TABLE tmp1 SELECT p.PatNum, p.Guarantor, BalTotal , Bal_0_30, Bal_31_60, Bal_61_90, BalOver90, (SELECT COUNT(*) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S') AND claim.ClaimType<>'PreAuth') AS 'Claims', (SELECT SUM(ClaimFee) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS 'ClaimAmts', (SELECT SUM(InsPayEst) FROM claim WHERE claim.PatNum=p.PatNum AND (claim.ClaimStatus='W' OR claim.ClaimStatus='S')AND claim.ClaimType<>'PreAuth') AS 'InsEst', (SELECT COUNT(*) FROM patplan LEFT JOIN inssub ib ON ib.InsSubNum=patplan.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum=ib.PlanNum LEFT JOIN carrier c ON c.CarrierNum=ip.CarrierNum WHERE CarrierName LIKE (@CarrierString) AND p.PatNum=patplan.PatNum AND ordinal=1) AS PatPlanCount FROM patient p; SELECT @pos:=@pos+1 AS 'Count',tmp1.Guarantor, SUM(tmp1.BalTotal) AS '$Fam-', SUM(tmp1.Bal_0_30) AS '$0-30-', SUM(tmp1.Bal_31_60) AS '$31-60-', SUM(tmp1.Bal_61_90)AS '$61-90-', SUM(tmp1.BalOver90)AS '$+90-', SUM(tmp1.Claims) AS ' SUM(tmp1.ClaimAmts) AS '$Claims-', SUM(tmp1.PatPlanCount) AS 'PatPlansMatch' FROM tmp1 INNER JOIN patient p ON tmp1.Guarantor=p.PatNum WHERE p.BalTotal>0.009 GROUP BY tmp1.Guarantor HAVING SUM(tmp1.PatPlanCount)>0 ORDER BY p.LName, p.FName; DROP TABLE IF EXISTS tmp1;"
    },
    {
      request: "ALL Fee Schedules all procedures, arranged by category with fees\r\nusually you will have to export to spreadsheet to view, format in spreadsheet",
      query: "SET @FeeSched='%%'; SELECT fee.FeeSched, d.ItemName AS 'Category',pc.Descript,pc.ProcCode, fee.Amount FROM fee INNER JOIN feesched fs ON fee.FeeSched= fs.FeeSchedNum AND fs.request LIKE @FeeSched INNER JOIN procedurecode pc ON fee.CodeNum = pc.CodeNum INNER JOIN definition d ON d.DefNum = pc.ProcCat ORDER BY fs.request,Category, pc.ProcCode"
    },
    {
      request: "Production by patient, procedures completed today with primary insurance carrier listed\r\nAlso lists sum of fees for day and plan type, does not consider adjustments or writeoffs",
      query: "SET @FromDate='', @ToDate=''; SELECT IF(LENGTH(@FromDate) = 0, CURDATE(), DATE(@FromDate)), IF(LENGTH(@ToDate) = 0, CURDATE(), DATE(@ToDate)) INTO @FromDate, @ToDate; SELECT p.PatNum ,COALESCE(carrier.CarrierName,'*No Insurance') AS 'PriCarrier' ,SUM((pl.ProcFee * (pl.UnitQty + pl.BaseUnits))) AS '$Fees' ,(CASE ip.PlanType WHEN '' THEN 'Category Percentage' WHEN 'p' THEN IF(ip.CopayFeeSched > 0, IF((SELECT fs.FeeSchedType FROM feesched fs WHERE fs.FeeSchedNum = ip.CopayFeeSched) = 3, 'PPO Fixed Benefit', 'PPO Percentage'), 'PPO Percentage') WHEN 'f' THEN 'Medicaid/Flat CoPay' WHEN 'c' THEN 'Capitation' ELSE IF(ISNULL(pp.PatPlanNum), '', 'Unknown') END) AS 'PlanType' FROM procedurelog pl INNER JOIN patient p ON p.PatNum = pl.PatNum LEFT JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub ib ON pp.InsSubNum = ib.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = ib.PlanNum LEFT JOIN carrier ON carrier.CarrierNum = ip.CarrierNum WHERE pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 GROUP BY p.PatNum;"
    },
    {
      request: "Appointments that are broken for a date range, with note",
      query: "SET @FromDate='2009-01-01', @ToDate='2009-02-28' ; SELECT p.LName,p.FName, p.PatNum AS 'Pat FROM appointment a INNER JOIN patient p ON a.PatNum=p.PatNum WHERE DATE(a.AptDateTime) BETWEEN @FromDate AND @ToDate AND a.AptStatus=5 ORDER BY a.AptDateTime;"
    },
    {
      request: "Specified procedures completed in the specified date range with claims created for the specified carrier",
      query: "SET @FromDate = '2020-01-01', @ToDate = '2020-01-31'; SET @Carrier = '%delta%'; SET @ProcCodes = 'D3310,D3320,D3330'; SELECT ca.CarrierName, cp.PatNum, DATE_FORMAT(pl.ProcDate,'%m/%d/%Y') AS 'Service Date', pc.ProcCode, cp.InsPayAmt AS 'InsPaid', pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS 'Fee' FROM carrier ca INNER JOIN insplan ip ON ca.CarrierNum = ip.CarrierNum INNER JOIN claim c ON ip.PlanNum = c.PlanNum INNER JOIN claimproc cp ON c.ClaimNum = cp.ClaimNum INNER JOIN procedurelog pl ON cp.ProcNum = pl.ProcNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate AND pl.ProcStatus = 2 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@ProcCodes) = 0,TRUE,FIND_IN_SET(pc.ProcCode,@ProcCodes)) WHERE ca.CarrierName LIKE @Carrier ORDER BY CarrierName;"
    },
    {
      request: "Patients whose first visit is in the specified date range, or who have no first visit",
      query: "SET @FromDate='', @ToDate=''; SELECT GROUP_CONCAT(pc.CodeNum) INTO @Broken FROM procedurecode pc WHERE pc.ProcCode IN ('D9986','D9987'); SELECT p.PatNum , IFNULL(NULLIF(LEAST( IFNULL(( SELECT DATE(MIN(a.AptDateTime)) FROM appointment a WHERE a.AptStatus IN (1,2) AND a.PatNum = p.PatNum ),'2999-12-31') , IFNULL(( SELECT MIN(pl.ProcDate) FROM procedurelog pl WHERE pl.ProcStatus = 2 AND !FIND_IN_SET(pl.CodeNum, @Broken) AND pl.PatNum = p.PatNum ),'2999-12-31') ),'2999-12-31'),'NOT SEEN') AS 'First Visit' , IFNULL(( SELECT GROUP_CONCAT(IF(LENGTH(r.FName) = 0, r.LName, CONCAT(r.FName, ' ', r.LName)) ORDER BY ra.ItemOrder, ra.RefAttachNum, r.ReferralNum SEPARATOR ' | ') FROM referral r INNER JOIN refattach ra ON ra.ReferralNum = r.ReferralNum AND ra.RefType = 1 WHERE ra.PatNum = p.PatNum ),'') AS 'Referred By' , FORMAT(CAST(IFNULL(( SELECT SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) FROM procedurelog pl WHERE pl.ProcStatus = 2 AND pl.PatNum = p.PatNum ),0) AS DECIMAL(14,2)),2) AS 'Lifetime Gross Prod' , FORMAT(CAST(IFNULL(( SELECT SUM(pltp.ProcFee * (pltp.UnitQty + pltp.BaseUnits)) FROM procedurelog pltp INNER JOIN appointment atp ON atp.AptNum = pltp.AptNum AND atp.AptStatus = 1 WHERE pltp.ProcStatus = 1 AND pltp.PatNum = p.PatNum ),0) AS DECIMAL(14,2)),2) AS 'Scheduled Gross Prod' , IF(TIMESTAMPDIFF(YEAR, p.Birthdate, CURDATE()) < 120, TIMESTAMPDIFF(YEAR, p.Birthdate, CURDATE()), 'Unknown') AS 'Current Age' , p.PatStatus , p.Zip FROM patient p WHERE p.PatStatus NOT IN (4,5) GROUP BY p.PatNum HAVING IF(LENGTH(@FromDate) = 0 AND LENGTH(@ToDate) = 0, `First Visit` = 'NOT SEEN',`First Visit` BETWEEN DATE(@FromDate) AND DATE(@ToDate)) ORDER BY IF(`First Visit` = 'NOT SEEN', 1, 0), `First Visit`, p.LName, p.FName, p.PatNum"
    },
    {
      request: "Outstanding insurance total for DOS in a date range or older than 30 days, with insurance estimates, writeoffs, with carrier information. Does not include Pre-Auths.",
      query: "SET @FromDate='' , @ToDate=''; SELECT IF(LENGTH(@FromDate) = 0, '1900-01-01', DATE(@FromDate)), IF(LENGTH(@ToDate) = 0, CURDATE() - INTERVAL 30 DAY, DATE(@ToDate)) INTO @Fromdate, @ToDate; SELECT cl.PatNum , CAST(cl.ClaimFee AS DECIMAL(14,2)) AS 'ClaimFee' , cl.Writeoff AS'$WriteOff_' , cl.InsPayEst AS '$InsPayEst_' , cl.DateService , cl.DateSent , ca.CarrierName , ca.Phone AS 'CarrierPhone' FROM claim cl INNER JOIN patient p ON p.PatNum = cl.PatNum INNER JOIN insplan i ON i.PlanNum = cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = i.CarrierNum WHERE cl.ClaimStatus = 'S' AND cl.DateService BETWEEN @FromDate AND @ToDate AND cl.ClaimType != 'PreAuth' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Get questionaire results for export and analysis\r\nReplace term 'married' with desired search term or eliminate all between the %% to return all questions",
      query: "SELECT request, Answer, COUNT(Answer) FROM question WHERE request LIKE ('%married%') GROUP BY request, Answer"
    },
    {
      request: "Last visit before given date for all active patients with phone\r\nAlso shows last seen date for 1 specified provider",
      query: "SET @pos=0, @FromDate='2008-01-01'; SELECT @pos:=@pos+1 AS ' LEFT(HmPhone,16) AS HmPhone, LEFT(WirelessPhone,16) AS CellPhone, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVis-Any', (SELECT DATE_FORMAT(MAX(pl2.ProcDate),'%m/%d/%Y') FROM procedurelog pl2 WHERE pl2.ProcStatus=2 AND p.PatNum=pl2.PatNum AND pl2.ProvNum =4 ) AS 'LastVisit-Spec' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE (pl.ProcStatus=2) AND (p.PatStatus=0) AND (pl.ProcDate<=@FromDate) GROUP BY pl.PatNum ORDER BY p.LName, p.FName;"
    },
    {
      request: "Insurance plans for patients of a given carrier, with guarantor, social security number and birth date",
      query: "SET @Carrier='%delta%'; SELECT p.PatNum ,c.CarrierName ,p.SSN ,p.Birthdate FROM carrier c INNER JOIN insplan ip ON c.CarrierNum = ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum = ip.PlanNum INNER JOIN patplan pp ON pp.InsSubNum = ib.InsSubNum INNER JOIN patient p ON pp.PatNum = p.PatNum WHERE c.CarrierName LIKE(@Carrier) ORDER BY p.LName, p.FName;"
    },
    {
      request: "Claim count by insurance carrier for date range with sum of fees, estimates and paid amounts",
      query: "SET @FromDate='2009-01-01' , @ToDate='2009-01-31'; SELECT ca.CarrierName, ca.Phone, COUNT(cl.ClaimNum) AS ' FORMAT(100*(COUNT(cl.ClaimNum)/(SELECT COUNT(claim.ClaimNum) FROM claim WHERE DateService BETWEEN @FromDate AND @ToDate)),2) AS '%Claims', SUM(cl.ClaimFee) AS '$ClaimFees', SUM(cl.InsPayEst) AS '$InsPayEst', SUM(cl.InsPayAmt) AS '$InsPaidAmt' FROM claim cl INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimType<>'PreAuth' AND (cl.ClaimStatus='R' OR cl.ClaimStatus='S') AND (DateService BETWEEN @FromDate AND @ToDate) GROUP BY ca.CarrierName ORDER BY ca.CarrierName;"
    },
    {
      request: "List of specified procedures completed in the specified date range for patients with the specified insurance carrier(s), including uninsured",
      query: "SET @FromDate='2023-01-01', @ToDate='2023-01-31'; SET @CarrierName=''; SET @ProcCodes='D1310,D3320,D3330'; SET @Carriers = IF(LENGTH(@CarrierName) = 0,'^',REPLACE(@CarrierName,',','|')); SELECT p.PatNum ,pl.ProcDate ,pc.ProcCode ,carrier.CarrierName AS 'PriInsName' ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS 'ProcFee' ,( SELECT SUM(cp.InsPayEst) FROM claimproc cp WHERE cp.ProcNum = pl.ProcNum AND cp.Status IN (0,1,4) ) AS '$InsPayEst' ,( SELECT SUM(cp1.InsPayAmt) FROM claimproc cp1 WHERE cp1.ProcNum = pl.ProcNum AND cp1.Status IN (1,4) ) AS '$InsPaidAmt' FROM procedurelog pl INNER JOIN patient p ON p.PatNum = pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub iss ON pp.InsSubNum = iss.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = iss.PlanNum LEFT JOIN carrier ON carrier.CarrierNum = ip.CarrierNum WHERE pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 AND IF(LENGTH(@CarrierName) = 0,TRUE,carrier.CarrierName REGEXP @Carriers) AND IF(LENGTH(@ProcCodes) = 0,TRUE,FIND_IN_SET(pc.ProcCode,@ProcCodes)) GROUP BY pl.ProcNum ORDER BY pl.ProcDate, p.LName,p.FName;"
    },
    {
      request: "All referrals in date range, with additional referral information",
      query: "SET @FromDate='2018-01-01', @ToDate='2018-01-31'; SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', reftable.* FROM ( SELECT p.PatNum, rf.FName, rf.LName, rf.Address, rf.City, rf.St, rf.Zip, rf.Telephone, ra.RefType, rf.Specialty, DATE_FORMAT(ra.RefDate,'%m/%d/%Y') AS RefDate FROM patient p INNER JOIN refattach ra ON p.PatNum=ra.PatNum AND ra.RefDate BETWEEN @FromDate AND @ToDate INNER JOIN referral rf ON ra.ReferralNum=rf.ReferralNum ORDER BY rf.LName, rf.FName )reftable;"
    },
    {
      request: "Monthly production and income report counts insurance writeoffs by procedure date (PPO) For all providers",
      query: "DROP TABLE IF EXISTS t1,t2; SET @FromDate='2009-03-01' , @ToDate='2009-03-31'; CREATE TABLE t1( Day int NOT NULL, Date date, DayOfWeek varchar(10), $Production double NOT NULL DEFAULT 0, $Adjustments double NOT NULL DEFAULT 0, $WriteOffs double NOT NULL DEFAULT 0, $TotProduction double NOT NULL DEFAULT 0, $PatIncome double NOT NULL DEFAULT 0, $InsIncome double NOT NULL DEFAULT 0, $TotIncome double NOT NULL DEFAULT 0); INSERT INTO t1(Day) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24),(25),(26),(27),(28),(29),(30),(31); DELETE FROM t1 WHERE Day>DAY(LAST_DAY(@FromDate)); UPDATE t1 SET Date=STR_TO_DATE(CONCAT(MONTH(@FromDate), '/', Day, '/', YEAR(@FromDate)),'%c/%e/%Y'); UPDATE t1 SET DayOfWeek=DATE_FORMAT(Date, '%W'); CREATE TABLE t2 SELECT DAYOFMONTH(pl.ProcDate) AS 'Day', SUM(pl.procfee) AS 'Production' FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pl.ProcDate); UPDATE t1,t2 SET t1.$Production=t2.Production WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(a.AdjDate) AS 'Day', SUM(a.AdjAmt) AS 'Adjustments' FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(a.AdjDate); UPDATE t1,t2 SET t1.$Adjustments=t2.Adjustments WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(pp.DatePay) AS 'Day', SUM(pp.SplitAmt) AS 'PatIncome' FROM paysplit pp WHERE pp.DatePay BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pp.DatePay); UPDATE t1,t2 SET t1.$PatIncome=t2.PatIncome WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(cp.ProcDate) AS 'Day', SUM(cp.WriteOff) AS 'WriteOffs' FROM claimproc cp WHERE (cp.Status=1 OR cp.Status=4 OR cp.Status=0) AND cp.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(cp.ProcDate); UPDATE t1,t2 SET t1.$WriteOffs=-t2.WriteOffs WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(cpay.CheckDate) AS 'Day', SUM(cp.InsPayAmt) AS 'InsIncome' FROM claimproc cp INNER JOIN claimpayment cpay ON cpay.ClaimPaymentNum=cp.ClaimPaymentNum WHERE cpay.CheckDate BETWEEN @FromDate AND @ToDate AND cp.Status IN(1,4) GROUP BY DAYOFMONTH(cpay.CheckDate); UPDATE t1,t2 SET t1.$InsIncome=t2.InsIncome WHERE t1.Day=t2.Day; UPDATE t1 SET $TotProduction=$Production+$Adjustments+$WriteOffs, $TotIncome=$InsIncome+$PatIncome ; DROP TABLE IF EXISTS t2; ALTER TABLE t1 DROP Day; SELECT * FROM t1; DROP TABLE IF EXISTS t1;"
    },
    {
      request: "Phone numbers and status of patients in a given zipcode",
      query: "SET @ZipCode = \"%85747%\"; SELECT p.PatNum ,p.Zip ,LEFT(p.WkPhone, 15) AS \"WkPhone\" ,LEFT(p.WirelessPhone, 15) AS \"CellPhone\" ,LEFT(p.HmPhone, 15) AS \"HmPhone\" ,p.PatStatus FROM patient p WHERE p.Zip LIKE @ZipCode ORDER BY p.PatStatus, p.LName, p.FName;"
    },
    {
      request: "Very basic deposit query, returns date of deposit and amount in given date range\r\nChange date range as needed",
      query: "SET @FromDate='2009-02-01', @ToDate='2014-02-28'; SELECT DateDeposit, Amount FROM deposit WHERE DateDeposit BETWEEN @FromDate AND @ToDate ORDER BY DateDeposit"
    },
    {
      request: "New patient count by zip code\r\nwith total",
      query: "SET @NewSinceDate='2009-02-01'; SELECT ZIP, Count(ZIP) AS ' WHERE PatStatus=0 AND DateFirstVisit>=@NewSinceDate GROUP BY ZIP UNION SELECT 'Total', Count(ZIP) AS ' WHERE PatStatus=0 AND DateFirstVisit>=@NewSinceDate;"
    },
    {
      request: "Outstanding Preauth procedures by date of service for Preauths with the specified clinic attached",
      query: "SET @DaysOutstanding='30'; SET @Clinics=''; SELECT IFNULL(c.Abbr, 'Unassigned') AS 'Clinic' ,( SELECT CONCAT( p.LName ,',' ,IF(LENGTH(p.Preferred)>0,CONCAT(' \\'',p.Preferred,'\\''),'') ,' ' ,p.FName ,IF(LENGTH(p.MiddleI)>0,CONCAT(' ',p.MiddleI),'') ) FROM patient p WHERE p.PatNum = cl.PatNum ) AS 'PatientName' ,cl.PatNum AS 'Patient ,cl.DateSent ,( SELECT ca.CarrierName FROM carrier ca INNER JOIN insplan ip ON ip.CarrierNum = ca.CarrierNum WHERE ip.PlanNum = cl.PlanNum ) AS 'CarrierName' ,( SELECT ca.Phone FROM carrier ca INNER JOIN insplan ip ON ip.CarrierNum = ca.CarrierNum WHERE ip.PlanNum = cl.PlanNum ) AS 'CarrierPhone' ,pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS 'ProcFee' ,( SELECT pc.ProcCode FROM procedurecode pc WHERE pc.CodeNum = pl.CodeNum ) AS 'ProcCode' FROM claim cl INNER JOIN claimproc cp ON cp.ClaimNum = cl.ClaimNum INNER JOIN procedurelog pl ON pl.ProcNum = cp.ProcNum LEFT JOIN clinic c ON c.ClinicNum = cl.ClinicNum WHERE cl.ClaimType = 'PreAuth' AND cl.ClaimStatus = 'S' AND IF(LENGTH(@DaysOutstanding) = 0, TRUE, cl.DateSent < (CURDATE() - INTERVAL @DaysOutstanding DAY)) AND IF(LENGTH(@Clinics) = 0, TRUE, FIND_IN_SET(IFNULL(c.Abbr, 'Unassigned'), @Clinics)) ORDER BY cl.DateSent, `PatientName`, cl.PatNum, cl.ClaimNum, pl.ProcNum;"
    },
    {
      request: "Calculate current or historical accounts receivable, collectible, outstanding insurance estimates\r\nnote that when compared to an aging report, the ins estimate includes ins from accounts with both positive\r\nand negative balances",
      query: "SET @AsOf='2009-02-28'; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4; CREATE TABLE tmp1 (PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0); INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount FROM paysplit ps WHERE ps.PayPlanNum=0 ; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.status IN (1,4,5,7); INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount FROM payplan pp; CREATE TABLE tmp3 SELECT p.Guarantor,SUM(cp.InsPayEst) InsPayEst, (CASE WHEN ISNULL(SUM(cp.Writeoff)) THEN 0 ELSE SUM(cp.WriteOff) END) WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE ((cp.Status=0 AND cp.ProcDate<=@AsOf) OR (cp.Status IN(1,4) AND cp.DateCP>@AsOf AND cp.ProcDate<=@AsOf)) GROUP BY p.Guarantor; CREATE TABLE tmp2 SELECT Guarantor, SUM(TranAmount) AS 'FamBal' FROM patient INNER JOIN tmp1 ON tmp1.PatNum=Patient.PatNum WHERE TranDate<=@AsOf GROUP BY Guarantor; CREATE TABLE tmp4 SELECT 'AccountsReceivable' AS 'request', SUM(FamBal) '$Value' FROM tmp2 WHERE FamBal>0 UNION SELECT 'AccountsPayable' AS 'request', SUM(FamBal) '$Value' FROM tmp2 WHERE FamBal<0 UNION SELECT 'TotPracticeBalance' AS 'request', SUM(FamBal) '$Value' FROM tmp2 UNION SELECT 'TotInsPayEst' AS 'request', SUM(InsPayEst) '$Value' FROM tmp3 UNION SELECT 'TotWriteOffEst' AS 'request', SUM(WriteOff) '$Value' FROM tmp3 UNION SELECT 'TotPatPortEst' AS 'request', (SUM(tmp2.FamBal)-SUM(tmp3.InsPayEst)-SUM(tmp3.WriteOff)) AS '$Value' FROM tmp2 LEFT JOIN tmp3 ON tmp2.Guarantor=tmp3.Guarantor; SELECT * FROM tmp4; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4;"
    },
    {
      request: "Insurance (Estimates or Paid) for a month (by date of service)",
      query: "SET @FromDate='2009-03-01' , @ToDate='2009-03-31'; SELECT cl.PatNum,cl.InsPayEst,cl.InsPayAmt,cl.ClaimFee, cl.Writeoff AS '$Writeoff',cl.DateService,cl.DateSent, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE (cl.ClaimStatus='S' OR cl.ClaimStatus = 'R' OR cl.Claimstatus='W') AND (cl.DateService BETWEEN @FromDate AND @ToDate) AND ClaimType<>'PreAuth' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Estimated Writeoffs Outstanding",
      query: "SELECT cl.PatNum,cl.InsPayEst,cl.InsPayAmt,cl.ClaimFee, cl.Writeoff AS '$Writeoff',cl.DateService,cl.DateSent, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE (cl.ClaimStatus='S' OR cl.Claimstatus='W') AND ClaimType<>'PreAuth' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Patients with balances who do not have insurance (not family balance, patient balance)",
      query: "SELECT PatNum, EstBalance FROM patient p WHERE p.HasIns<>'I' AND p.EstBalance>0"
    },
    {
      request: "Count per doctor of incoming referrals in date range with last referral date.",
      query: "SET @FromDate='2017-01-01' , @ToDate='2017-12-31'; SELECT SUM(RefType) AS ' rf.FName, rf.LName, rf.Address, rf.City, rf.St, rf.Zip, DATE_FORMAT(MAX(ra.RefDate),'%m/%d/%Y') AS LastRefDate FROM refattach ra INNER JOIN referral rf ON ra.ReferralNum=rf.ReferralNum WHERE ra.RefType = 1 AND ra.RefDate BETWEEN @FromDate AND @ToDate GROUP BY rf.ReferralNum ORDER BY rf.LName, rf.FName;"
    },
    {
      request: "Incoming referrals with refdate for a doctor with a specific last name and (optional) first name",
      query: "SET @RefLName = '%%'; SET @RefFName = '%%'; SELECT rf.FName, rf.LName, DATE_FORMAT(ra.RefDate,'%m/%d/%Y') RefDate, ra.PatNum FROM refattach ra INNER JOIN referral rf ON ra.ReferralNum=rf.ReferralNum AND rf.LName LIKE @RefLName AND rf.FName LIKE @RefFName WHERE RefType = 1 ORDER BY rf.LName, rf.FName;"
    },
    {
      request: "Patients with prescriptions for a specific drug in given Date range",
      query: "SET @FromDate='2021-01-01' , @ToDate='2021-01-31'; SET @DrugName = '%Amoxicillin%'; SELECT PatNum, RxDate, Drug, Disp, Refills, ProvNum FROM rxpat WHERE drug LIKE @DrugName AND RxDate BETWEEN @FromDate AND @ToDate;"
    },
    {
      request: "Patient Refunds in Date Range",
      query: "SET @FromDate='2019-01-01' , @ToDate='2019-12-31'; SELECT ps.PatNum, p.PayDate, ps.SplitAmt, p.CheckNum, p.PayNote FROM paysplit ps INNER JOIN payment p ON ps.PayNum = p.PayNum AND p.PayType != 0 AND p.PayDate BETWEEN @FromDate AND @ToDate WHERE ps.SplitAmt < 0;"
    },
    {
      request: "Verification list for appointments on given date",
      query: "SET @Date='2009-04-28'; SELECT p.PatNum, c.Phone, GROUP_CONCAT(pc.AbbrDesc) AS ProceduresInApt, LEFT(CarrierName,15) AS 'Carrier (abbr)' FROM appointment a INNER JOIN patient p ON a.PatNum=p.PatNum LEFT JOIN patplan pp ON p.PatNum=pp.PatNum LEFT JOIN inssub ib ON ib.InsSubNum=pp.InsSubNum AND pp.ORDINAL=1 LEFT JOIN insplan ip ON ip.PlanNum=ib.PlanNum LEFT JOIN carrier c ON c.CarrierNum=ip.CarrierNum LEFT JOIN procedurelog pl ON pl.AptNum=a.AptNum LEFT JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum WHERE DATE(a.AptDateTime) LIKE @Date GROUP BY p.PatNum ORDER BY LName, FName;"
    },
    {
      request: "Number of procedures of each code completed in date range by provider with claims made to a specified insurance carrier. Broken down by Primary claim or not primary. Includes procedure count, average and total fees (for primary claims only), average and total amount paid by the carrier, and the average and total writeoff amount for that carrier.",
      query: "SET @FromDate='2023-09-01', @ToDate='2023-09-30'; SET @Carrier='%%'; SELECT procs.Prov , procs.CarrierName , procs.Pri AS 'Primary?' , procs.ProcCode , SUM(procs.Count) AS ' , COALESCE(CAST(SUM(procs.ProcFee)/SUM(procs.Count) AS DECIMAL(14,2)), '') AS 'FeeAvg' , COALESCE(CAST(SUM(procs.ProcFee) AS DECIMAL(14,2)), '') AS 'FeeTot' , CAST(SUM(procs.InsPayAmt)/SUM(procs.Count) AS DECIMAL(14,2)) AS 'CarrierPaidAvg' , CAST(SUM(procs.InsPayAmt) AS DECIMAL(14,2)) AS 'CarrierPaidTot' , CAST(SUM(procs.Writeoff)/SUM(procs.Count) AS DECIMAL(14,2)) AS 'CarrierWOAvg' , CAST(SUM(procs.Writeoff) AS DECIMAL(14,2)) AS 'CarrierWOTot' FROM ( SELECT provider.Abbr AS 'Prov' , carrier.CarrierName , IF(claim.ClaimType = 'P', 'X', '') AS 'Pri' , procedurecode.ProcCode , COUNT(DISTINCT procedurelog.ProcNum) AS 'Count' , IF(claim.ClaimType = 'P', procedurelog.ProcFee * (procedurelog.BaseUnits + procedurelog.UnitQty), NULL) AS 'ProcFee' , SUM(claimproc.InsPayAmt) AS 'InsPayAmt' , SUM(claimproc.WriteOff) AS 'Writeoff' FROM carrier INNER JOIN insplan ON carrier.CarrierNum = insplan.CarrierNum INNER JOIN claim ON insplan.PlanNum = claim.PlanNum AND claim.ClaimType != 'PreAuth' INNER JOIN claimproc ON claim.ClaimNum = claimproc.ClaimNum INNER JOIN procedurelog ON claimproc.ProcNum = procedurelog.ProcNum AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate AND ProcStatus = 2 INNER JOIN procedurecode ON procedurelog.CodeNum = procedurecode.CodeNum INNER JOIN provider ON procedurelog.ProvNum = provider.ProvNum WHERE carrier.CarrierName LIKE @Carrier GROUP BY procedurelog.ProcNum, carrier.CarrierName, claim.ClaimType ) procs GROUP BY procs.Prov, procs.CarrierName, procs.ProcCode, procs.Pri ORDER BY procs.Prov, procs.CarrierName, procs.ProcCode, procs.Pri DESC;"
    },
    {
      request: "Number of procedures of each code group (grouped by first two letters of proccode) \r\ncompleted with claims made to a specified insurance carrier in date range\r\nby provider, Count, ave fee, sum of fees, sum amount paid",
      query: "SET @FromDate='2008-03-01', @Todate='2009-02-28', @Carrier='%ryan%'; SELECT provider.Abbr AS 'Prov',carrier.CarrierName, LEFT(procedurecode.ProcCode,2) AS 'ProcGroup', COUNT(procedurelog.ProcNum) AS ' SUM(procedurelog.ProcFee) AS '$FeeTot', SUM(claimproc.InsPayAmt) AS '$InsPayTot',SUM(claimproc.InsPayAmt)/COUNT(procedurelog.ProcNum) AS '$InsPayAve' FROM carrier INNER JOIN insplan ON carrier.CarrierNum=insplan.CarrierNum INNER JOIN claim ON insplan.PlanNum=claim.PlanNum INNER JOIN claimproc ON claim.ClaimNum=claimproc.ClaimNum INNER JOIN procedurelog ON claimproc.ProcNum=procedurelog.ProcNum INNER JOIN procedurecode ON procedurelog.CodeNum=procedurecode.CodeNum INNER JOIN provider ON procedurelog.ProvNum=provider.ProvNum WHERE procedurelog.ProcDate >= @FromDate AND procedurelog.ProcDate < @ToDate AND ProcStatus=2 AND carrier.CarrierName LIKE(@Carrier) GROUP BY procedurelog.ProvNum, carrier.CarrierName, LEFT(procedurecode.ProcCode,2) ORDER BY provider.Abbr,carrier.CarrierName, ProcGroup;"
    },
    {
      request: "Labs received in the last 60 days with instructions, interval can be changed",
      query: "SELECT PatNum, l.request, DateTimeSent,DateTimeRecd, ProvNum,Instructions FROM labcase INNER JOIN laboratory l ON l.LaboratoryNum=labcase.LaboratoryNum WHERE DateTimeRecd >=curdate()-Interval 60 day"
    },
    {
      request: "Archived and Inactive patients with last seen date and completed procedure count",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', a.PatNum, a.LName, a.FName, a.LastVisit, a.ProcsTotal AS ' a.PatStatus FROM ( SELECT patient.PatNum, patient.LName, patient.FName, DATE_FORMAT(MAX(procedurelog.ProcDate),'%m/%d/%Y') AS 'LastVisit', COUNT(procedurelog.ProcNum) AS 'ProcsTotal', patient.PatStatus FROM patient INNER JOIN procedurelog ON procedurelog.PatNum=patient.PatNum WHERE procedurelog.ProcStatus=2 AND patient.PatStatus IN(2,3) GROUP BY procedurelog.PatNum ORDER BY LName ) a;"
    },
    {
      request: "Accounts Receivable WHERE payments have not been made in last X days (30 by default),\r\nsummed by guarantor, includes last statement date and \r\nlast payment made",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count', B.* FROM ( SELECT p.Guarantor, A.BalTotal, (SELECT MAX(DateSent) FROM statement WHERE statement.PatNum=p.PatNum) AS 'LastStatement', MAX(ps.DatePay) 'LastPay',pn.FamFinancial FROM ( SELECT p.Guarantor, p.BalTotal FROM patient p WHERE p.BalTotal>=0.01 ) A INNER JOIN patient p ON A.Guarantor=p.Guarantor LEFT JOIN paysplit ps ON ps.PatNum=p.PatNum LEFT JOIN patientnote pn ON p.Guarantor=pn.PatNum GROUP BY p.Guarantor HAVING (CURDATE()-INTERVAL 30 DAY > IFNULL(MAX(ps.DatePay),'1900-01-01') ) )B;"
    },
    {
      request: "Active patients with PatNum, Date of First Visit and Address",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS 'Count',A.* FROM ( SELECT PatNum AS 'Pat FROM patient WHERE PatStatus=0 ORDER BY LName,FName ) A;"
    },
    {
      request: "Treatment planned work that has not been saved to a treatment plan\r\nexcludes listed procedure code matches, like preventative work",
      query: "SET @FromDate='2009-05-01', @Todate='2009-05-31'; SELECT p.PatNum ,pl.DateTp ,pl.ToothNum ,pc.ProcCode ,pc.AbbrDesc ,(pl.ProcFee * (pl.BaseUnits + pl.UnitQty)) AS 'ProcFee' FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum AND pl.ProcStatus=1 INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum LEFT JOIN treatplan tp ON tp.PatNum=p.PatNum LEFT JOIN proctp pt ON pt.TreatPlanNum=tp.TreatPlanNum WHERE ISNULL(pt.TreatPlanNum) AND p.PatStatus=0 AND pl.DateTP BETWEEN @FromDate AND @ToDate AND pc.ProcCode NOT LIKE ('D1%') AND pc.ProcCode NOT LIKE('D0%') ORDER BY p.LName,p.FName,pl.DateTP,pl.ToothNum;"
    },
    {
      request: "Questionaire results for export and analysis, Frequency distribution of answers for specified question(s)\r\nReplace 'medical' with desired search term or eliminate to return all",
      query: "SELECT request, Answer, COUNT(Answer) FROM question WHERE request LIKE ('%medical%') GROUP BY request, Answer"
    },
    {
      request: "List of patients with appointments for a date range (in future or past) with primary insurance carrier listed\r\nAlso lists Fees, Insurance payment estimate and patient portion",
      query: "SET @FromDate='2017-04-01' , @ToDate='2017-04-03'; SELECT a.AptDateTime, p.PatNum, (CASE WHEN ISNULL(carrier.CarrierName) THEN '*No Insurance' ELSE (carrier.CarrierName) END) AS 'PriCarrier', SUM(pl.ProcFee) AS '$Fees', COALESCE(SUM(CASE WHEN cp.Status=1 OR cp.Status=4 THEN(cp.InsPayAmt) WHEN cp.Status=0 THEN (cp.InsPayEst) WHEN cp.Status=6 THEN (CASE WHEN cp.InsEstTotalOverride=-1 THEN(cp.InsEstTotal) ELSE (cp.InsEstTotalOverride)END) END),0) AS '$InsPayEst', COALESCE(SUM(CASE WHEN cp.Status=1 OR cp.Status=4 THEN (cp.WriteOff) ELSE(CASE WHEN cp.WriteOffEstOverride=-1 THEN (CASE WHEN cp.WriteOffEst=-1 THEN 0 ELSE cp.WriteOffEst END) ELSE (cp.WriteOffEstOverride)END) END),0) '$Writeoff', (SUM(pl.ProcFee)) -(COALESCE(SUM(CASE WHEN cp.Status=1 OR cp.Status=4 THEN(cp.WriteOff) ELSE(CASE WHEN cp.WriteOffEstOverride=-1 THEN (CASE WHEN cp.WriteOffEst=-1 THEN 0 ELSE cp.WriteOffEst END) ELSE (cp.WriteOffEstOverride)END) END),0)) -(COALESCE(SUM(CASE WHEN cp.Status=1 OR cp.Status=4 THEN(cp.InsPayAmt) WHEN cp.Status=0 THEN (cp.InsPayEst) WHEN cp.Status=6 THEN (CASE WHEN cp.InsEstTotalOverride=-1 THEN (cp.InsEstTotal) ELSE (cp.InsEstTotalOverride)END) END),0)) AS '$PatPorEst' FROM appointment a INNER JOIN patient p ON p.PatNum=a.PatNum INNER JOIN procedurelog pl ON a.AptNum=pl.AptNum AND a.AptDateTime BETWEEN @FromDate AND @ToDate+ INTERVAL 1 DAY AND a.AptStatus IN (1,2,4) LEFT JOIN patplan pp ON pp.PatNum=p.PatNum AND ORDINAL=1 LEFT JOIN inssub iss ON pp.InsSubNum=iss.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum=iss.PlanNum LEFT JOIN carrier ON carrier.CarrierNum=ip.CarrierNum LEFT JOIN claimproc cp ON cp.ProcNum=pl.ProcNum AND cp.Status IN (0,1,4,6) AND cp.PlanNum = ip.PlanNum GROUP BY a.AptNum ORDER BY a.AptDateTime;"
    },
    {
      request: "insurance claims representing service provided in a given time period for a given carrier with phone number, claim status, Ins Est and Ins Paid",
      query: "SET @FromDate='2009-01-01' , @ToDate='2009-03-31'; SET @Carrier='%Blue Cross%'; SELECT cl.PatNum,cl.DateService,cl.DateSent, LEFT(ca.CarrierName, 20) AS 'Carrier Abbr', ca.Phone, cl.ClaimStatus, cl.InsPayEst,InsPayAmt FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE (cl.ClaimStatus='R' OR cl.ClaimStatus='S') AND ca.CarrierName LIKE @Carrier AND (cl.DateService BETWEEN @FromDate AND @ToDate) ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Call back List for given procedures for given date range, uses guarantor home phone, other numbers can easily be added",
      query: "SET @FromDate = '2022-01-01' , @ToDate = '2022-01-12'; SET @ProcCodes = \"D2740,D7,D6010,D6245,D6740,BOTOX,D.F.\"; SET @Codes = (CASE WHEN LENGTH(@ProcCodes) = 0 THEN '^' ELSE REPLACE(@ProcCodes,',','|') END); SELECT IFNULL(ap.AptDateTime,'No Apt Attached') AS \"AptDateTime\" ,pa.PatNum ,LEFT(pc.Descript, 20) AS 'Procedure' ,pl.ToothNum AS 'Tooth' ,pl.Surf ,ga.HmPhone ,CONCAT(ga.LName, ', ', ga.FName) AS Guarantor FROM procedurelog pl INNER JOIN patient pa ON pl.PatNum = pa.PatNum INNER JOIN patient ga ON pa.Guarantor = ga.PatNum INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum LEFT JOIN appointment ap ON pl.AptNum = ap.AptNum WHERE pl.ProcStatus = 2 AND pc.ProcCode REGEXP @Codes AND pl.ProcDate BETWEEN @FromDate AND @ToDate ORDER BY AptDateTime ASC;"
    },
    {
      request: "Specified procedures representing service provided in a given time period for a given carrier with phone number, claim status, Ins Est and Ins Paid",
      query: "SET @FromDate='2018-01-01' , @ToDate='2018-12-31'; SET @Carrier='%%'; SET @ProcCode = '%%'; SELECT cl.PatNum, pc.ProcCode, DATE_FORMAT(cl.DateService,'%m/%d') AS 'SDate', cl.DateSent, LEFT(ca.CarrierName, 20) AS 'Carrier Abbr', ca.Phone, cl.ClaimType 'Type', cl.ClaimStatus 'Status', cp.InsPayEst, cp.InsPayAmt FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum INNER JOIN claimproc cp ON cl.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON pl.ProcNum=cp.ProcNum INNER JOIN procedurecode pc ON pc.CodeNum=pl.CodeNum WHERE (cl.ClaimStatus='R' OR cl.ClaimStatus='S') AND ca.CarrierName LIKE @Carrier AND (cl.DateService BETWEEN @FromDate AND @ToDate) AND pc.ProcCode LIKE @ProcCode ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Home and wireless Phone numbers of active, non and inactive patients, perhaps for uploading to your phone",
      query: "SELECT LName, FName, HmPhone, WirelessPhone FROM patient WHERE (HmPhone<>\"\" OR WirelessPhone<>\"\") AND PatStatus NOT IN(4,5,6) ORDER BY LName, FName"
    },
    {
      request: "Patient Mailing info with given carrier seen since given date",
      query: "Set @Carrier='%medicaid%', @SeenAfterDate='2007-12-31'; SELECT p.LName,p.FName,p.Address,p.Address2,p.City,p.State,p.zip, DATE_FORMAT(MAX(ProcDate),'%m/%d/%Y') AS 'LastVisit' FROM carrier c INNER JOIN insplan ip ON c.CarrierNum=ip.CarrierNum INNER JOIN inssub ib ON ib.PlanNum=ip.PlanNum INNER JOIN patplan pp ON ib.InsSubNum=pp.InsSubNum INNER JOIN patient p ON pp.PatNum=p.PatNum INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum WHERE pl.ProcStatus=2 AND p.PatStatus=0 AND c.CarrierName LIKE @Carrier GROUP BY pl.PatNum HAVING MAX(ProcDate)>@SeenAfterDate ORDER BY p.LName, p.FName;"
    },
    {
      request: "Aging report for no payment in last 30 days and shows days since last specified procedure",
      query: "DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT CONCAT(g.LName,', ',g.FName,' ',g.MiddleI) AS Guarantor ,g.Bal_0_30,g.Bal_31_60,g.Bal_61_90,g.BalOver90 ,g.BalTotal,g.InsEst,g.BalTotal-g.InsEst AS $PatPor, MAX(paysplit.DatePay) AS LastPayment, (SELECT MAX(pl.ProcDate) FROM procedurelog pl INNER JOIN procedurecode pc ON pc.CodeNum=pl.CodeNum WHERE pc.ProcCode ='M1112' AND pl.PatNum=patient.PatNum) AS 'LastAdjDate' FROM patient INNER JOIN patient g ON patient.Guarantor=g.PatNum LEFT JOIN paysplit ON paysplit.PatNum=patient.PatNum WHERE (patient.patstatus IN (0,1)) AND (g.BalOver90 > '.005') GROUP BY patient.Guarantor ORDER BY g.LName,g.FName; SELECT Guarantor ,Bal_0_30,Bal_31_60,Bal_61_90,BalOver90 ,BalTotal,InsEst, $PatPor, DATEDIFF(CURDATE(), LastAdjDate) AS 'DaysSince', DATE_FORMAT(LastPayment,'%m/%d/%Y') AS LastPayment FROM tmp WHERE DATE(LastPayment)<(CURDATE()- INTERVAL 30 DAY); DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "new patients with no complete procedures",
      query: "SET @FromDate='2023-01-01' , @ToDate='2023-01-31'; SELECT p.PatNum ,p.DateFirstVisit FROM patient p LEFT JOIN procedurelog pl ON pl.PatNum=p.PatNum AND pl.ProcStatus=2 WHERE p.DateFirstVisit BETWEEN @FromDate AND @ToDate GROUP BY p.PatNum HAVING COUNT(pl.ProcNum)<1;"
    },
    {
      request: "Insurance effective dates with carriername for active patients matching a carrier name criteria (specify all or part of carrier name)\r\nNote:  edit the CarrierName LIKE ('%Blue Cross%') section below with deired carrier name",
      query: "SELECT p.PatNum, c.CarrierName, ib.DateEffective, ib.DateTerm FROM patient p INNER JOIN patplan pp ON pp.PatNum=p.PatNum INNER JOIN inssub ib ON ib.InsSubNum=pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum=ib.PlanNum INNER JOIN carrier c ON ip.CarrierNum=c.CarrierNum WHERE p.PatStatus=0 AND CarrierName LIKE '%Blue Cross%';"
    },
    {
      request: "Broken Appointment Production for date range \r\n(Appointments can be moved to later in the day or another op, but do not delete the broken apt. Production is only accurate until you schedule those procedures to a new apt)",
      query: "SET @FromDate='2009-05-01' , @ToDate='2009-06-30'; SELECT a.PatNum , DATE_FORMAT(a.AptDateTime,'%m/%d/%Y') AS 'AptDate' , SUM(COALESCE(pl.ProcFee * (pl.UnitQty + pl.BaseUnits), 0) - COALESCE(( SELECT SUM(cpc.Writeoff) FROM claimproc cpc WHERE cpc.Status IN(7, 8) AND cpc.ProcNum = pl.ProcNum ),0)) AS '$Production' FROM appointment a LEFT JOIN procedurelog pl ON a.AptNum=pl.AptNum WHERE a.AptStatus=5 AND a.AptDateTime BETWEEN @FromDate AND @ToDate + INTERVAL 1 DAY GROUP BY a.AptNum ORDER BY a.AptDateTime"
    },
    {
      request: "End of Day report. Shows patients with transactions completed in the specified date range",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SELECT IF(s1.Seq = 1, core.PatNum, ' ') AS 'PatNum' , IF(s1.Seq = 1, core.Date, ' ') AS 'Date' , IF(s1.Seq = 1, IFNULL(ref.Refs,''), '') AS 'Referrer' , IF(s1.Seq = 1, IFNULL(apts.FirstComp, 'NOT SEEN'), '') AS 'FirstVisit' , IF(s1.Seq = 1, COALESCE(apts.NextSched, apts.Unsched, apts.Planned, 'NO APPTS'),'') AS 'NextScheduled' , FORMAT(CAST(SUM(core.Prod) AS DECIMAL(14,2)),2) AS 'Production' , FORMAT(CAST(SUM(core.Adj) AS DECIMAL(14,2)),2) AS 'Adjustments' , FORMAT(CAST(SUM(core.Wo) AS DECIMAL(14,2)),2) AS 'Writeoffs' , FORMAT(CAST(SUM(core.InsPay) AS DECIMAL(14,2)),2) AS 'InsPayments' , FORMAT(CAST(SUM(core.PatPay) AS DECIMAL(14,2)),2) AS 'PtPayments' FROM ( SELECT pl.PatNum , pl.ProcDate AS 'Date' , SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) - SUM(IFNULL(( SELECT SUM(cap.Writeoff) FROM claimproc cap WHERE cap.Status = 7 AND cap.ProcNum = pl.ProcNum ),0)) AS 'Prod' , 0 AS 'Adj' , 0 AS 'Wo' , 0 AS 'InsPay' , 0 AS 'PatPay' FROM procedurelog pl WHERE pl.ProcStatus = 2 AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY pl.PatNum, pl.ProcDate UNION ALL SELECT adj.PatNum , adj.AdjDate , 0 AS 'Prod' , SUM(adj.AdjAmt) AS 'Adj' , 0 AS 'Wo' , 0 AS 'InsPay' , 0 AS 'PatPay' FROM adjustment adj WHERE adj.AdjDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY adj.PatNum, adj.AdjDate UNION ALL SELECT cp.PatNum , cp.DateCP , 0 AS 'Proc' , 0 AS 'Adj' , SUM(cp.Writeoff) AS 'Wo' , SUM(cp.InsPayAmt) AS 'InsPay' , 0 AS 'PatPay' FROM claimproc cp WHERE cp.Status IN (1,4) AND cp.DateCP BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY cp.PatNum, cp.DateCP UNION ALL SELECT ps.PatNum , ps.DatePay , 0 AS 'Prod' , 0 AS 'Adj' , 0 AS 'Wo' , 0 AS 'InsPay' , SUM(ps.SplitAmt) AS 'PatPay' FROM paysplit ps WHERE ps.DatePay BETWEEN DATE(@FromDate) AND DATE(@ToDate) GROUP BY ps.PatNum, ps.DatePay ) core LEFT JOIN ( SELECT ra.PatNum , GROUP_CONCAT(IF(LENGTH(r.FName) = 0, '', CONCAT(r.FName, ' ')), r.LName ORDER BY ra.ItemOrder SEPARATOR ' | ') AS 'Refs' FROM refattach ra INNER JOIN referral r ON ra.ReferralNum = r.ReferralNum WHERE ra.RefType = 1 GROUP BY ra.PatNum ) ref ON ref.PatNum = core.PatNum LEFT JOIN ( SELECT a.PatNum , NULLIF(MIN(IF(a.AptStatus = 1 , a.AptDateTime, '9999-99-99 99:99:99')),'9999-99-99 99:99:99') AS 'NextSched' , NULLIF(MAX(IF(a.AptStatus = 2 , a.AptDateTime, '0001-01-01 00:00:00')),'0001-01-01 00:00:00') AS 'FirstComp' , IF(COUNT(DISTINCT IF(a.AptStatus = 3 , a.AptNum, NULL)) > 0, 'Unsched', NULL) AS 'Unsched' , IF(COUNT(DISTINCT IF(a.AptStatus = 6 , a.AptNum, NULL)) > 0, 'Planned', NULL) AS 'Planned' FROM appointment a WHERE a.AptStatus IN (1,2,3,6) GROUP BY a.PatNum ) apts ON apts.PatNum = core.PatNum LEFT JOIN seq_1_to_2 s1 ON TRUE GROUP BY IF(s1.Seq = 1, CONCAT(s1.Seq, '+', core.PatNum, '|', core.Date), s1.Seq) ORDER BY s1.Seq, core.Date, core.PatNum"
    },
    {
      request: "Incomplete procedure notes for date range with provider",
      query: "SET @FromDate= '2023-02-01', @ToDate='2023-02-14'; SELECT procedurelog.ProcDate ,procedurelog.ProvNum ,CONCAT(patient.LName,', ',patient.FName) AS 'PatientName' ,procedurecode.ProcCode ,procedurecode.AbbrDesc ,procedurelog.ToothNum ,LEFT(n1.Note, 30) AS 'First 30 characters of Note' FROM procedurelog INNER JOIN patient ON procedurelog.PatNum = patient.PatNum INNER JOIN procedurecode ON procedurelog.CodeNum = procedurecode.CodeNum INNER JOIN procnote n1 ON procedurelog.ProcNum = n1.ProcNum WHERE procedurelog.ProcStatus = 2 AND procedurelog.ProcDate BETWEEN @FromDate AND @ToDate AND (n1.Note LIKE '%\"\"%' OR n1.Note LIKE '\"%\"') AND n1.EntryDateTime = ( SELECT MAX(n2.EntryDateTime) FROM procnote n2 WHERE n1.ProcNum = n2.ProcNum ) ORDER BY procedurelog.ProvNum, procedurelog.ProcDate;"
    },
    {
      request: "List of patient status patients with no appointments in date range with the assigned clinic, includes phone numbers and address",
      query: "SET @FromDate='2025-01-01' , @ToDate='2025-01-31'; SET @Clinics=''; SELECT IFNULL(c.Abbr, 'Unassigned') AS 'Clinic' ,CONCAT(p.LName, ', ', p.FName, ' ', p.MiddleI) AS 'Patient' ,p.HmPhone ,p.WirelessPhone ,p.WkPhone ,CONCAT(p.Address, ' ', IF(LENGTH(p.Address2)=0, '', CONCAT(p.Address2, ' ')), IF(LENGTH(p.City)=0, '', CONCAT(p.City, ', ')), p.State, ' ', p.Zip) AS 'Address' FROM patient p LEFT JOIN appointment ap ON p.PatNum = ap.PatNum AND ap.AptDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY AND ap.AptStatus IN (1, 2) LEFT JOIN clinic c ON c.ClinicNum = p.ClinicNum WHERE ISNULL(ap.aptnum) AND p.PatStatus = 0 AND IF(LENGTH(@Clinics) = 0, TRUE, FIND_IN_SET(IFNULL(c.Abbr, 'Unassigned'), @Clinics)) ORDER BY c.ClinicNum, p.LName, p.FName, p.PatNum;"
    },
    {
      request: "Active patients who have specific codes in treatment plan status, with addresses\r\nSee #508 for a date range",
      query: "SET @ProcCodes=\"D2740,D2790\"; SELECT pc.ProcCode, p.LName, p.FName, p.Address, p.Address2, p.City, p.State, p.Zip FROM patient p INNER JOIN procedurelog pl ON p.PatNum = pl.PatNum AND pl.ProcStatus = 1 INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum WHERE p.PatStatus = 0 AND IF(LENGTH(@ProcCodes) = 0, TRUE, FIND_IN_SET(pc.ProcCode, @ProcCodes)) ORDER BY p.LName, p.FName"
    },
    {
      request: "Patients with date of first visit in given range, with referral source and additional entry for each out referral",
      query: "SET @FromDate='2018-01-01', @ToDate='2018-01-31'; SET @pos=0; SET SQL_BIG_SELECTS=1; SELECT @pos:=@pos+1 AS ' patfirst.* FROM ( SELECT p.PatNum, p.DateFirstVisit, CONCAT(rFROM.LName, \", \", rFROM.FName) AS ReferredFROM, CONCAT(rto.LName, \", \", rto.FName) AS ReferredTo FROM patient p LEFT JOIN refattach raFROM ON p.PatNum=raFROM.PatNum AND raFROM.RefType = 1 AND raFROM.ItemOrder=(SELECT MIN(rat.ItemOrder) FROM refattach rat WHERE rat.RefType = 1 AND p.PatNum=rat.PatNum) LEFT JOIN referral rFROM ON rFROM.ReferralNum=raFROM.ReferralNum LEFT JOIN refattach rato ON p.PatNum=rato.PatNum AND rato.RefType = 0 LEFT JOIN referral rto ON rto.ReferralNum=rato.ReferralNum WHERE DateFirstVisit BETWEEN @FromDate AND @ToDate ORDER BY DateFirstVisit, p.LName, p.FName )patfirst;"
    },
    {
      request: "Commlog entries for the day that have notes",
      query: "SELECT PatNum, CommDateTime,Note FROM commlog WHERE Date(CommDateTime)=CurDate() AND Length(Note)>1 ORDER BY Note, CommDateTime;"
    },
    {
      request: "Commlog entries for date range that have notes",
      query: "SET @FromDate='2009-06-01', @ToDate='2009-07-01'; SELECT PatNum, CommDateTime,Note FROM commlog WHERE Date(CommDateTime) BETWEEN @FromDate AND @ToDate AND Length(Note)>1 ORDER BY Note, CommDateTime;"
    },
    {
      request: "Commlog entries in a date range that contain a specified key word",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Note='%%'; SELECT c.PatNum ,c.CommDateTime ,c.Note FROM commlog c WHERE c.Note LIKE @Note AND LENGTH(Note)>1 AND c.CommDateTime BETWEEN DATE(@FromDate) AND DATE(@ToDate) + INTERVAL 1 DAY ORDER BY c.CommDateTime DESC, c.Note, c.CommlogNum;"
    },
    {
      request: "patients with no email and who referred them",
      query: "SET @pos=0; SELECT @pos:=@pos+1 AS ' patnoemail.* FROM ( SELECT p.PatNum, p.Email, CONCAT(rFROM.LName, \", \", rFROM.FName) AS ReferredFROM FROM patient p LEFT JOIN refattach raFROM ON p.PatNum=raFROM.PatNum AND raFROM.RefType = 1 AND raFROM.ItemOrder=( SELECT MIN(rat.ItemOrder) FROM refattach rat WHERE rat.RefType = 1 AND p.PatNum=rat.PatNum ) LEFT JOIN referral rFROM ON rFROM.ReferralNum=raFROM.ReferralNum WHERE p.Email NOT LIKE ('%@%') AND p.PatStatus IN(0,1) ORDER BY p.LName, p.FName )patnoemail;"
    },
    {
      request: "List of all patients with dual coverage, with guarantor and names of carriers",
      query: "SET @PriCarrier=''; SET @SecCarrier=''; SET @Car1 = IF(LENGTH(@PriCarrier) = 0, '^', REPLACE(@PriCarrier, ',', '|')) ,@Car2 = IF(LENGTH(@SecCarrier) = 0, '^', REPLACE(@SecCarrier, ',', '|')); SELECT p.Guarantor , p.PatNum , p.PatStatus , MAX(IF(pp.Ordinal = 1 , ca.CarrierName, NULL)) AS 'PriCar' , MAX(IF(pp.Ordinal = 2 , ca.CarrierName, NULL)) AS 'SecCar' FROM patient p INNER JOIN patplan pp ON pp.PatNum = p.PatNum AND pp.Ordinal IN (1,2) INNER JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum GROUP BY p.PatNum HAVING !ISNULL(`PriCar`) AND !ISNULL(`SecCar`) AND `PriCar` REGEXP @Car1 AND `SecCar` REGEXP @Car2"
    },
    {
      request: "Patients with values for a specified patient field name",
      query: "SET @FieldName='%%'; SELECT pf.PatNum ,( SELECT ELT(p.PatStatus + 1,'Patient','NonPatient','Inactive','Archived','Deleted','Deceased','Prospective') FROM patient p WHERE p.PatNum = pf.PatNum ) AS 'PatStatus' ,IFNULL(( SELECT MAX(a.AptDateTime) FROM appointment a WHERE a.AptStatus = 2 AND a.PatNum = pf.PatNum ),'') AS 'LastAppt' ,pf.FieldName ,pf.FieldValue FROM patfield pf WHERE pf.FieldName LIKE @FieldName GROUP BY pf.PatFieldNum ORDER BY pf.PatNum, pf.PatFieldNum;"
    },
    {
      request: "Summary of All Patient Field Def Entries, Grouped by fieldname and value",
      query: "SELECT COUNT(*), FieldName, FieldValue FROM patfield GROUP BY FieldName, FieldValue ORDER BY FieldName, FieldValue;"
    },
    {
      request: "Summary of Patient Field Def Entries, for field names matching given criteria, grouped by fieldname and value",
      query: "SET @FieldName = '%%'; SELECT COUNT(pf.PatFieldNum) AS Quantity, pf.FieldName, pf.FieldValue FROM patfield pf WHERE FieldName LIKE @FieldName GROUP BY FieldName, FieldValue ORDER BY FieldName, Quantity DESC;"
    },
    {
      request: "Mailing information with birthdate for \"Patient\" status patients with a completed procedure in the last 24 months whose birthday falls in date range",
      query: "SET @BDStart = '07-05', @BDEnd = '07-21'; SELECT p.LName ,p.FName ,DATE_FORMAT(MAX(pl.ProcDate), '%m/%d/%Y') AS 'LastSeen' ,p.Birthdate ,p.Address ,p.Address2 ,p.City ,p.State ,p.Zip FROM patient p LEFT JOIN procedurelog pl ON pl.PatNum = p.PatNum WHERE (SUBSTRING(p.BirthDate,6,5) >= @BDStart AND SUBSTRING(p.BirthDate,6,5) <= @BDEnd) AND pl.ProcDate > (CURDATE()-INTERVAL 24 MONTH) AND pl.ProcStatus = 2 AND p.PatStatus = 0 GROUP BY pl.PatNum;"
    },
    {
      request: "List of \"Patient\" and \"NonPatient\" status patients without a referral \"from\".",
      query: "SELECT patient.PatNum ,patient.LName ,patient.FName ,patient.HmPhone ,patient.WkPhone ,patient.WirelessPhone ,patient.Email FROM patient LEFT JOIN refattach ra ON patient.PatNum = ra.PatNum AND ra.RefType = 1 WHERE patient.PatStatus < 2 AND ISNULL(ra.PatNum) ORDER BY patient.LName, patient.FName;"
    },
    {
      request: "Show feeschedule for each patient, whether through primary insurance, patient level feesched or provider fee schedule",
      query: "SELECT p.PatNum, IFNULL(fs.request, IFNULL((SELECT fs1.request FROM feesched fs1 WHERE fs1.FeeSchedNum=p.FeeSched), (SELECT fs2.request FROM feesched fs2,provider WHERE p.PriProv=provider.ProvNum AND fs2.FeeSchedNum=provider.FeeSched) )) AS FeeSchedule FROM patient p LEFT JOIN patplan pp ON p.PatNum=pp.PatNum AND pp.Ordinal=1 LEFT JOIN inssub iss ON iss.InsSubNum=pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum=iss.PlanNum LEFT JOIN feesched fs ON ip.FeeSched=fs.FeeSchedNum WHERE p.PatStatus=0 ORDER BY p.LName,p.FName;"
    },
    {
      request: "Show count of active patients using each fee schedule whether through primary insurance, patient level feesched or provider fee schedule",
      query: "DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT p.PatNum, IFNULL(fs.request, IFNULL((SELECT fs1.request FROM feesched fs1 WHERE fs1.FeeSchedNum=p.FeeSched), (SELECT fs2.request FROM feesched fs2,provider WHERE p.PriProv=provider.ProvNum AND fs2.FeeSchedNum=provider.FeeSched) )) AS FeeSchedule FROM patient p LEFT JOIN patplan pp ON p.PatNum=pp.PatNum AND pp.Ordinal=1 LEFT JOIN inssub iss ON iss.InsSubNum=pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum=iss.PlanNum LEFT JOIN feesched fs ON ip.FeeSched=fs.FeeSchedNum WHERE p.PatStatus=0 ORDER BY p.LName, p.FName; SELECT FeeSchedule, COUNT(FeeSchedule) FROM tmp GROUP BY FeeSchedule ORDER BY FeeSchedule ASC; DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "Inactive and archived patients who had a particular insurance carrier and group number.",
      query: "SET @CarrierName=''; SET @GroupNum=''; SET @CarrierName=(CASE WHEN @CarrierName='' THEN '^' ELSE REPLACE(@CarrierName,',','|') END); SELECT p.PatNum ,p.PatStatus ,c.CarrierName ,ip.GroupNum ,ib.DateEffective ,ib.DateTerm ,CONCAT(p.HmPhone,' - ',p.WkPhone,' - ',p.WirelessPhone) AS 'Phone Hm-Wk-Cell' ,p.Address ,p.Address2 ,p.City ,p.State ,p.Zip FROM patient p INNER JOIN patplan pp ON pp.PatNum = p.PatNum INNER JOIN inssub ib ON ib.InsSubNum = pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum = ib.PlanNum AND IF(LENGTH(@GroupNum) = 0, TRUE, FIND_IN_SET(ip.GroupNum, @GroupNum)) INNER JOIN carrier c ON ip.CarrierNum = c.CarrierNum AND CarrierName REGEXP @CarrierName WHERE p.PatStatus IN (2,3) ORDER BY p.LName, p.FName, p.PatNum;"
    },
    {
      request: "Accounts Receivable and aging WHERE billing type is other than 'Standard' or other given billing type,\r\nsummed by guarantor, includes last statement date and last payment made",
      query: "SET @pos=0; DROP TABLE IF EXISTS tmp1; CREATE TABLE tmp1 SELECT p.PatNum, p.Guarantor, (SELECT MAX(DatePay) FROM paysplit WHERE paysplit.PatNum=p.PatNum) AS 'LastPay', (SELECT MAX(DateSent) FROM statement WHERE statement.PatNum=p.PatNum) AS 'LastStmnt' FROM patient p; SELECT @pos:=@pos+1 AS ' p.BalTotal AS '$Fam-',p.Bal_0_30,p.Bal_31_60,p.Bal_61_90, p.BalOver90, MAX(LastPay) AS 'LastPay', MAX(LastStmnt) AS 'LastStmnt',d.ItemName, pn.FamFinancial FROM tmp1 INNER JOIN patient p ON tmp1.Guarantor=p.PatNum INNER JOIN patientnote pn ON tmp1.Guarantor=pn.PatNum INNER JOIN definition d ON p.BillingType=d.DefNum WHERE d.ItemName NOT LIKE('%Standard%') AND p.BalTotal>=0.01 GROUP BY tmp1.Guarantor ORDER BY p.LName, p.FName; DROP TABLE IF EXISTS tmp1;"
    },
    {
      request: "Lists all guarantors of patients, and the family members of the guarantor who have the specified billing type with contact info.",
      query: "SET @BillingType ='%Insured%'; SELECT g.PatNum ,GROUP_CONCAT('PatNum:', p.PatNum ORDER BY p.PatNum SEPARATOR ', ') AS 'Patients' ,CONCAT(g.Address, ' ', g.Address2) AS 'Address' ,g.City ,LEFT(g.State,2) AS 'State' ,g.Zip ,CONCAT(\" \", LEFT(g.HmPhone,13), \"- \", LEFT(g.WkPhone,13), \"- \",LEFT(g.WirelessPhone,13)) AS 'Phone Hm-Wk-Cell' FROM patient p INNER JOIN patient g ON g.PatNum = p.Guarantor INNER JOIN definition d ON p.BillingType = d.DefNum WHERE d.ItemName LIKE @BillingType GROUP BY p.Guarantor ORDER BY g.LName, g.FName, g.PatNum;"
    },
    {
      request: "Appointments in date range for a given provider with appointment status, age, and procedures",
      query: "SET @ProvAbbr='%Doc%'; SET @FromDate='2022-01-01' , @ToDate='2022-01-31'; SELECT p.PatNum ,a.AptDateTime ,(CASE WHEN (YEAR(CURDATE())-YEAR(p.Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(p.Birthdate,5))<200 THEN(YEAR(CURDATE())-YEAR(p.Birthdate)) - (RIGHT(CURDATE(),5)<RIGHT(p.Birthdate,5)) ELSE 0 END) AS 'Age' ,GROUP_CONCAT(pc.AbbrDesc) AS ProceduresInApt ,op.OpName ,(CASE WHEN a.AptStatus=1 THEN 'Scheduled' WHEN a.AptStatus=2 THEN 'Complete' ELSE 'Broken' END) AS 'AptStatus' ,pv.Abbr FROM appointment a INNER JOIN patient p ON a.PatNum=p.PatNum INNER JOIN provider pv ON pv.ProvNum=a.ProvNum LEFT JOIN operatory op ON op.OperatoryNum=a.Op LEFT JOIN procedurelog pl ON pl.AptNum=a.AptNum LEFT JOIN procedurecode pc ON pc.CodeNum=pl.CodeNum WHERE a.AptDateTime BETWEEN @FromDate AND @ToDate + INTERVAL 1 DAY AND a.AptStatus IN(1,2,5) AND pv.Abbr LIKE(@ProvAbbr) GROUP BY a.AptNum ORDER BY a.AptDateTime"
    },
    {
      request: "Calculate Sum unpaid balances on procedures completed before given date. This is NOT quite like an aging report because we are considering only work completed before a given date but we account for all payments adjustments, writeoffs etc through current date\r\n-Assumes oldest procedures paid first",
      query: "SET @AsOf='2009-01-01'; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4; CREATE TABLE tmp1 (PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0); INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate<=@AsOf; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount FROM paysplit ps WHERE ps.PayPlanNum=0 ; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.status IN (1,4,5,7) AND cp.ProcDate<=@AsOf; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount FROM payplan pp; CREATE TABLE tmp3 SELECT p.Guarantor,SUM(cp.InsPayEst) AS InsPayEst, 0 AS WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE (cp.Status=0 AND cp.ProcDate<=@AsOf) GROUP BY p.Guarantor; INSERT INTO tmp3 SELECT p.Guarantor,0 AS InsPayEst, (CASE WHEN ISNULL(SUM(cp.Writeoff)) THEN 0 ELSE SUM(cp.WriteOff) END) AS WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE ((cp.Status=0 AND cp.ProcDate<=@AsOf) OR (cp.Status IN(1,4) AND cp.DateCP>@AsOf AND cp.ProcDate<=@AsOf)) GROUP BY p.Guarantor; CREATE TABLE tmp2 SELECT Guarantor, SUM(TranAmount) AS 'FamBal' FROM patient INNER JOIN tmp1 ON tmp1.PatNum=Patient.PatNum GROUP BY Guarantor; CREATE TABLE tmp4 SELECT 'SumUnpaidBalances' AS 'request', SUM(FamBal) '$Value' FROM tmp2 WHERE FamBal>0 UNION SELECT 'TotInsPayEst' AS 'request', SUM(InsPayEst) '$Value' FROM tmp3 UNION SELECT 'TotWriteOffEst' AS 'request', SUM(WriteOff) '$Value' FROM tmp3; SELECT * FROM tmp4; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4;"
    },
    {
      request: "Work treatment planned in a date range for specified procedure codes, and status (is it complete or TP) and whether accepted (scheduled or complete) or just TP and not accepted (not scheduled)",
      query: "SET @FromDate='2025-06-01' , @ToDate='2025-06-30'; SET @ProcCodes=''; SET @FromDate = IF(LENGTH(@FromDate) = 0 AND LENGTH(@ToDate) = 0, CURDATE(), @FromDate); SET @ToDate = IF(LENGTH(@FromDate) = 0 AND LENGTH(@ToDate) = 0, CURDATE(), @ToDate); SELECT pa.PatNum , pc.ProcCode AS 'Code' , pc.abbrdesc AS 'request' , pl.ToothNum , DATE_FORMAT(pl.DateTP, '%m-%d-%Y') AS 'DateTP' , ( SELECT pr.Abbr FROM provider pr WHERE pr.ProvNum = pl.ProvNum ) AS 'Provider' , pl.ProcFee * (pl.BaseUnits + pl.UnitQty) AS '$ProcFee' , (CASE WHEN pl.ProcStatus = 2 THEN 'Complete' WHEN pl.AptNum = 0 THEN 'TP' WHEN pl.ProcStatus = 1 THEN ( SELECT ELT(appointment.AptStatus, 'Scheduled','Scheduled','UnschedList','ASAP','Broken') FROM appointment WHERE appointment.AptNum = pl.AptNum ) ELSE 'Other' END) AS 'Status' FROM patient pa INNER JOIN procedurelog pl ON pa.PatNum = pl.PatNum AND pl.ProcStatus IN(1,2) AND pl.DateTP BETWEEN DATE(@FromDate) AND DATE(@ToDate) INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@ProcCodes) = 0,TRUE,FIND_IN_SET(pc.ProcCode,@ProcCodes)) ORDER BY pl.DateTP, pa.LName, pa.FName ASC, pa.PatNum, pl.ProcNum"
    },
    {
      request: "Procedures on received claims with zero payment",
      query: "SET @FromDate='2009-01-01' , @ToDate='2009-12-31'; SELECT p.PatNum, cl.DateService,pc.ProcCode, pl.ToothNum FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum INNER JOIN claimproc cp ON cl.ClaimNum=cp.ClaimNum INNER JOIN procedurelog pl ON pl.ProcNum=cp.ProcNum INNER JOIN procedurecode pc ON pc.CodeNum=pl.CodeNum WHERE (cl.ClaimStatus='R') AND (cl.DateService BETWEEN @FromDate AND @ToDate) GROUP BY pl.ProcNum HAVING SUM(cp.InsPayAmt)=0 ORDER BY cl.DateService,p.LName,p.FName;"
    },
    {
      request: "Production and Income for a particular patient (with adjustments, insurance income and writeoffs)\r\nAll by service date (which means the results change as new ins payments are received, except patient payments and adjustments, \r\nwhich is by payment date as there is not always a link between payment and procedure, note that this is in contrast to #162 which is by ledger date",
      query: "SET @PatNum='2836', @FromDate='2008-01-01' , @ToDate='2009-12-31'; SELECT p.PatNum, (SELECT SUM(InsPayAmt) FROM claimproc cp WHERE cp.PatNum=p.PatNum AND cp.Status IN(1,4,7) AND cp.ProcDate BETWEEN @FromDate AND @ToDate) AS '$InsProcPay', (SELECT SUM(Writeoff) FROM claimproc cp WHERE cp.PatNum=p.PatNum AND cp.Status IN(1,4,7) AND cp.ProcDate BETWEEN @FromDate AND @ToDate) AS '$WriteOff', (SELECT SUM(SplitAmt) FROM paysplit WHERE p.PatNum=paysplit.PatNum AND (DatePay BETWEEN @FromDate AND @ToDate)) AS '$PatientPay', (SELECT SUM(AdjAmt) FROM adjustment WHERE p.PatNum=adjustment.PatNum AND (adjdate BETWEEN @FromDate AND @ToDate)) AS '$PatAdj', SUM(pl.procfee) AS '$Production' FROM patient p INNER JOIN procedurelog pl ON p.PatNum=pl.PatNum AND pl.ProcStatus=2 WHERE p.PatNum=@PatNum AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY p.PatNum;"
    },
    {
      request: "List of patients with a given fee schedule, showing insurance information, ordered by carrier and then group name",
      query: "SET @FeeSched='%%'; SELECT p.PatNum, c.CarrierName, ip.GroupName, ip.GroupNum, COALESCE( fs.request, (SELECT fs1.request FROM feesched fs1 WHERE fs1.FeeSchedNum=p.FeeSched), (SELECT fs2.request FROM feesched fs2 INNER JOIN provider ON fs2.FeeSchedNum=provider.FeeSched WHERE p.PriProv=provider.ProvNum) ) AS 'FeeSchedule' FROM patient p LEFT JOIN patplan pp ON p.PatNum = pp.PatNum AND pp.Ordinal = 1 LEFT JOIN inssub iss ON iss.InsSubNum = pp.InsSubNum LEFT JOIN insplan ip ON ip.PlanNum = iss.PlanNum LEFT JOIN carrier c ON ip.CarrierNum = c.CarrierNum LEFT JOIN feesched fs ON ip.FeeSched = fs.FeeSchedNum WHERE p.PatStatus = 0 HAVING FeeSchedule LIKE @FeeSched ORDER BY CarrierName, GroupName, p.LName, p.FName;"
    },
    {
      request: "Treatment planned total for active patients with benefits remaining who have NO SCHEDULED appointments, calender year  benefits, general ins maximum only. Comment address lines if you do not need",
      query: "SELECT p.LName, p.FName, SUM(annualmax.AnnualMax) AS \"$AnnualMax\", SUM(used.AmtUsed) AS \"$AmountUsed\", (CASE WHEN ISNULL(SUM(used.AmtUsed)) THEN (SUM(annualmax.AnnualMax)) ELSE (SUM(annualmax.AnnualMax)-SUM(used.AmtUsed)) END) AS $AmtRemaining, planned.AmtPlanned AS \"$TreatPlanned\", p.Address, p.Address2, p.City, p.State, p.Zip FROM patient p INNER JOIN patplan ON p.PatNum=patplan.PatNum INNER JOIN inssub ON inssub.InsSubNum=patplan.InsSubNum INNER JOIN ( SELECT benefit.PlanNum, MAX(benefit.MonetaryAmt) AS AnnualMax FROM benefit LEFT JOIN covcat ON covcat.CovCatNum = benefit.CovCatNum WHERE benefit.BenefitType = 5 AND benefit.TimePeriod = 2 AND (covcat.EbenefitCat=1 OR ISNULL(covcat.EbenefitCat)) AND benefit.MonetaryAmt > 0 GROUP BY benefit.PlanNum ) annualmax ON annualmax.PlanNum=inssub.PlanNum INNER JOIN ( SELECT procedurelog.PatNum, SUM(procedurelog.ProcFee) AS AmtPlanned FROM procedurelog INNER JOIN patient ON patient.PatNum=procedurelog.PatNum AND patient.PatStatus=0 LEFT JOIN appointment a ON procedurelog.PatNum=a.PatNum AND a.AptStatus=1 WHERE procedurelog.ProcStatus = 1 AND ISNULL(a.AptNum) GROUP BY patient.PatNum ) planned ON planned.PatNum=p.PatNum LEFT JOIN ( SELECT patplan.PatPlanNum, SUM(IFNULL(claimproc.InsPayAmt,0)) AS AmtUsed FROM claimproc INNER JOIN inssub ON claimproc.InsSubNum=inssub.InsSubNum INNER JOIN patplan ON inssub.InsSubNum=patplan.InsSubNum AND patplan.PatNum=claimproc.PatNum WHERE claimproc.Status IN (1, 3, 4) AND YEAR(claimproc.ProcDate)=YEAR(CURDATE()) GROUP BY patplan.PatPlanNum ) used ON used.PatPlanNum=patplan.PatPlanNum WHERE planned.AmtPlanned>0 AND (CASE WHEN ISNULL(used.AmtUsed) THEN (annualmax.AnnualMax) ELSE (annualmax.AnnualMax-used.AmtUsed) END)>.01 AND p.PatStatus=0 GROUP BY p.PatNum ORDER BY p.LName, p.FName;"
    },
    {
      request: "Show count of active patients using each special 'Allowed' type fee schedule through primary insurance",
      query: "SELECT COALESCE(fs.request,'none') AS AllowedFeeSchedule,COUNT(DISTINCT p.PatNum) AS 'Count' FROM patient p LEFT JOIN patplan pp ON p.PatNum=pp.PatNum AND pp.Ordinal=1 LEFT JOIN inssub ib ON ib.InsSubNum=pp.InsSubNum LEFT JOIN insplan ip ON ib.PlanNum=ip.PlanNum LEFT JOIN feesched fs ON ip.AllowedFeeSched=fs.FeeSchedNum WHERE p.PatStatus=0 GROUP BY fs.request ORDER BY COALESCE(fs.request,'none') ASC;"
    },
    {
      request: "Returns information about procedures where the amount paid+writeoff is greater than fee charged patient",
      query: "SELECT procedurelog.PatNum,procedurecode.ProcCode,procedurelog.ProcDate,procedurelog.ProcFee,SUM(claimproc.InsPayAmt + claimproc.Writeoff) AS $PaidAndWriteoff FROM procedurelog LEFT JOIN claimproc ON procedurelog.ProcNum=claimproc.ProcNum LEFT JOIN procedurecode ON procedurelog.CodeNum=procedurecode.CodeNum WHERE procedurelog.ProcStatus=2 GROUP BY procedurelog.ProcNum HAVING procedurelog.ProcFee+.005 < SUM(claimproc.InsPayAmt + claimproc.Writeoff);"
    },
    {
      request: "Active Patients who HAVE had procedures completed with a specified provider but not in the past two years",
      query: "SET @Latest = (CURDATE() - INTERVAL 2 YEAR); DROP TABLE IF EXISTS tmp1; CREATE TABLE tmp1 SELECT p.PatNum FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum AND pl.ProcStatus=2 INNER JOIN provider ON pl.ProvNum=provider.ProvNum WHERE p.PatStatus=0 AND provider.Abbr='DOC1' AND pl.ProcDate >= @Latest GROUP BY p.PatNum; ALTER TABLE tmp1 ADD INDEX(PatNum); SELECT p.PatNum, Date_Format(MAX(procdate),'%m/%d/%Y') AS 'LastSeen', provider.Abbr AS 'Provider' FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum AND pl.ProcStatus=2 INNER JOIN provider ON pl.ProvNum=provider.ProvNum LEFT JOIN tmp1 ON p.PatNum=tmp1.PatNum WHERE p.PatStatus=0 AND provider.Abbr='DOC1' AND ISNULL(tmp1.PatNum) GROUP BY p.PatNum ; DROP TABLE IF EXISTS tmp1;"
    },
    {
      request: "Fees and details for completed procedures, for a week with user defined \r\nstarting date. Filtered by specific Primary carrier name, e.g. any starting with Medicaid.",
      query: "SET @FromDate = '2009-11-01'; SET @ToDate = @FromDate + INTERVAL 1 WEEK; SET @CarrierFilter = '%Medicaid%'; SELECT p.PatNum, pc.ProcCode, pl.ProcFee, pl.ProcDate, pl.ToothNum, pl.Surf, pc.Descript, pl.ProvNum, ca.CarrierName FROM patient p INNER JOIN procedurelog pl ON pl.PatNum=p.PatNum INNER JOIN procedurecode pc ON pl.CodeNum=pc.CodeNum INNER JOIN patplan pp ON pp.PatNum=p.PatNum AND pp.Ordinal=1 INNER JOIN inssub iss ON iss.InsSubNum=pp.InsSubNum INNER JOIN insplan ip ON ip.PlanNum=iss.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=ip.CarrierNum WHERE pl.ProcDate BETWEEN @FromDate AND @ToDate AND ca.CarrierName LIKE @CarrierFilter AND pl.ProcStatus=2;"
    },
    {
      request: "All non-zero family account balances, normally use aging report, this is for troubleshooting or automated reporting, can also edit to view transactions that comprise an aging report",
      query: "SET @AsOf='2010-03-23'; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmpTotals; CREATE TABLE tmp1 (TranType VARCHAR(10), PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Fee' AS TranType, pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Pay' AS TranType,ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount FROM paysplit ps WHERE ps.PayPlanNum=0 ; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Adj' AS TranType, a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'InsPay' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt TranAmount FROM claimproc cp WHERE cp.Status IN (1,4); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Writeoff' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (1,4); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Capitat' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (5,7); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'PayPlan' AS TranType,pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount FROM payplan pp; SELECT g.PatNum,SUM(TranAmount) AS $TranAmount FROM tmp1 INNER JOIN patient p ON p.PatNum=tmp1.PatNum INNER JOIN patient g ON g.PatNum=p.Guarantor WHERE TranDate<=@AsOf GROUP BY g.PatNum HAVING (SUM(TranAmount)>0.001 OR SUM(TranAmount)<-.001) ORDER BY g.LName, g.FName; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmpTotals;"
    },
    {
      request: "Active patients with scheduled or completed appointments described like \"%Prophy%\"\r\nwithin a date range, with a specifically named employer (of guarantor).\r\nGives name, guarantor's employer, appointment status, appt date, appt note",
      query: "SET @FromDate='2009-01-01', @ToDate='2009-12-31'; SET @Employer='%Cisco%'; SELECT p.LName, p.FName, emp.EmpName, ap.AptStatus, ap.AptDateTime, ap.Note FROM patient p INNER JOIN patient g ON p.Guarantor=g.PatNum INNER JOIN appointment ap ON ap.PatNum = p.PatNum INNER JOIN employer emp ON emp.EmployerNum=g.EmployerNum WHERE (ap.AptStatus=1 OR ap.AptStatus=2) AND p.PatStatus=0 AND ap.ProcDescript LIKE '%Prophy%' AND AptDateTime BETWEEN @FromDate AND @ToDate AND emp.EmpName LIKE @Employer;"
    },
    {
      request: "List of the specified completed procedures in the specified date range for the specified providers.",
      query: "SET @FromDate='2025-07-01', @ToDate='2025-07-16'; SET @Providers=''; SET @ProcCodes=''; SELECT CONCAT(patient.LName, ', ', patient.FName, ' ', patient.MiddleI) AS 'Patient' ,pc.ProcCode ,pl.ProcDate ,CAST(pl.ProcFee * (pl.UnitQty + pl.BaseUnits) AS DECIMAL(10,2)) AS 'ProcFee' ,pr.Abbr FROM patient INNER JOIN procedurelog pl ON patient.PatNum = pl.PatNum AND pl.ProcDate BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND pl.ProcStatus = 2 INNER JOIN procedurecode pc ON pl.CodeNum = pc.CodeNum AND IF(LENGTH(@ProcCodes) = 0,TRUE,FIND_IN_SET(pc.ProcCode,@ProcCodes)) INNER JOIN provider pr ON pr.ProvNum = pl.ProvNum AND IF(LENGTH(@Providers) = 0,TRUE,FIND_IN_SET(pr.Abbr,@Providers)) ORDER BY patient.LName, patient.FName, patient.PatNum, pr.Abbr, pr.ProvNum, pl.ProcNum;"
    },
    {
      request: "Completed procs in date range, with fees summed by patient",
      query: "SET @FromDate='2009-10-01' , @ToDate='2009-10-31'; SELECT CONCAT(LName, ', ',FName, ' ', MiddleI) As Patient, SUM(pl.ProcFee) AS ProcFee FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum LEFT JOIN paysplit ps ON pl.ProcNum=ps.ProcNum WHERE pl.ProcDate >=@FromDate AND pl.ProcDate <= @ToDate AND pl.ProcStatus=2 GROUP BY pl.PatNum;"
    },
    {
      request: "Referrers, along with the names of patients who they have referred, within a given date range.",
      query: "SET @FromDate = '2017-01-01'; SET @ToDate = '2018-01-31'; SET @ReferrerLName='%%'; SET @ReferrerFName='%%'; SELECT IF(rf.PatNum,'Yes','No') AS IsPatient, CONCAT(rf.LName,', ', rf.FName) AS Referrer, p.FName, p.LName, ra.RefDate FROM referral rf LEFT JOIN refattach ra ON ra.ReferralNum=rf.ReferralNum LEFT JOIN patient p ON ra.PatNum=p.PatNum WHERE ra.RefType = 1 AND rf.LName LIKE @ReferrerLName AND rf.FName LIKE @ReferrerFName AND ra.RefDate BETWEEN @FromDate AND @ToDate;"
    },
    {
      request: "List of Patients with more than one insurance",
      query: "SELECT PatNum, COUNT(*) 'Number of Plans' FROM patplan GROUP BY PatNum HAVING COUNT(*)>1;"
    },
    {
      request: "New patients for a time span, with billing type, email, phone, (new patient date based on completed procedure with fee>0)",
      query: "SET @FromDate='2015-01-01', @ToDate='2015-12-31'; SET @pos=0; SELECT @pos:=@pos+1 AS PatCount, A.* FROM (SELECT patient.PatNum, patient.email, patient.WirelessPhone, DATE_FORMAT(MIN(procedurelog.ProcDate),'%m-%d-%Y') AS FirstVisit, patient.BillingType FROM patient, procedurelog WHERE procedurelog.PatNum = patient.PatNum AND patient.patstatus = '0' AND procedurelog.ProcStatus=2 AND procedurelog.ProcFee > 0 GROUP BY patient.PatNum HAVING MIN(DATE(procedurelog.ProcDate)) BETWEEN @FromDate AND @ToDate ORDER BY MIN(DATE(procedurelog.ProcDate)) )A;"
    },
    {
      request: "Carrier Phone List for Printing, only includes carriers with active patients using them",
      query: "SELECT carrier.CarrierName, COUNT(DISTINCT p.PatNum) AS 'Patients', carrier.Phone FROM carrier INNER JOIN insplan ip ON carrier.CarrierNum=ip.CarrierNum INNER JOIN inssub ib ON ip.PlanNum=ib.PlanNum INNER JOIN patplan pp ON ib.InsSubNum=pp.InsSubNum INNER JOIN patient p ON pp.PatNum=p.PatNum WHERE p.PatStatus=0 GROUP BY CarrierName ORDER BY CarrierName;"
    },
    {
      request: "Outstanding insurance claims for date of service date range defined by user \r\n(this is different than the usual interval as it can cut off older claims if you want)",
      query: "SET @FromDate='2009-01-01' , @ToDate='2009-12-31'; SELECT cl.PatNum,cl.DateService,cl.DateSent, ca.CarrierName, ca.Phone FROM claim cl INNER JOIN patient p ON p.PatNum=cl.PatNum INNER JOIN insplan i ON i.PlanNum=cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum=i.CarrierNum WHERE cl.ClaimStatus='S' AND DateService>@FromDate AND DateService<@ToDate AND ClaimType<>'PreAuth' ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Show families with remaining debt FROM a previous set date\r\nassumes FIFO (first in first out)",
      query: "SET @AsOf='2008-06-30'; SET @ReportDate=CurDate(); DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmp5; CREATE TABLE tmp1 (PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0, TranType VARCHAR(10)); INSERT INTO tmp1 (PatNum,TranDate,TranAmount,TranType) SELECT pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount, 'Proc' FROM procedurelog pl WHERE pl.ProcStatus=2; INSERT INTO tmp1 (PatNum,TranDate,TranAmount,TranType) SELECT ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount, 'Pay' FROM paysplit ps WHERE ps.PayPlanNum=0 ; INSERT INTO tmp1 (PatNum,TranDate,TranAmount,TranType) SELECT a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount, 'Adj' FROM adjustment a; INSERT INTO tmp1 (PatNum,TranDate,TranAmount,TranType) SELECT cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount, 'InsPay' FROM claimproc cp WHERE cp.Status IN (1,4,5,7); INSERT INTO tmp1 (PatNum,TranDate,TranAmount,TranType) SELECT pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount,'PP' FROM payplan pp; CREATE TABLE tmp3 SELECT p.Guarantor,SUM(cp.InsPayEst) InsPayEst, (CASE WHEN ISNULL(SUM(cp.Writeoff)) THEN 0 ELSE SUM(cp.WriteOff) END) WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE ((cp.Status=0 AND cp.ProcDate<=@ReportDate) OR (cp.Status IN(1,4) AND cp.DateCP>@ReportDate AND cp.ProcDate<=@ReportDate)) GROUP BY p.Guarantor; CREATE TABLE tmp2 SELECT Guarantor, SUM(TranAmount) AS 'CurFamBal' FROM patient INNER JOIN tmp1 ON tmp1.PatNum=patient.PatNum WHERE TranDate<=@ReportDate GROUP BY Guarantor; CREATE TABLE tmp5 SELECT Guarantor, SUM(TranAmount) AS 'PaymentsMade' FROM patient INNER JOIN tmp1 ON tmp1.PatNum=patient.PatNum WHERE TranDate>@AsOf AND TranDate<=@ReportDate AND TranType IN('Proc','Adj') AND TranAmount>0 GROUP BY Guarantor; CREATE TABLE tmp4 SELECT tmp2.Guarantor, CurFamBal AS '$CurFamBal', WriteOff AS '$WriteOffEst',InsPayEst AS '$InsPayEst', (CurFamBal-IFNULL(WriteOff,0)-IFNULL(InsPayEst,0)) AS '$CurPatPortion', (CurFamBal-IFNULL(PaymentsMade,0)) AS '$BalLeftPreviousPeriod' FROM tmp2 LEFT JOIN tmp3 ON tmp2.Guarantor=tmp3.Guarantor LEFT JOIN tmp5 ON tmp2.Guarantor=tmp5.Guarantor WHERE (CurFamBal-IFNULL(PaymentsMade,0))>0.01; SELECT * FROM tmp4; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmp5;"
    },
    {
      request: "Insurance claim procedures with the UCR fee for the specified fee schedule, the estimated insurance payment amount, and the received insurance payment amount. Does not distinguish between received claims, sent claims etc.",
      query: "SET @FromDate='2024-04-01', @ToDate='2024-04-30'; SET @UCRFeeSchedule='Standard'; SELECT cl.PatNum , cl.DateService , cl.ProvTreat , pc.ProcCode , CAST(f.Amount AS DECIMAL(14,2)) AS 'UCR Fee' , CAST(cp.InsPayEst AS DECIMAL(14,2)) AS 'InsPayEst' , CAST(cp.InsPayAmt AS DECIMAL(14,2)) AS 'InsPayAmt' , car.CarrierName FROM claim cl INNER JOIN claimproc cp ON cp.ClaimNum = cl.ClaimNum INNER JOIN insplan ip ON ip.PlanNum = cl.PlanNum INNER JOIN carrier car ON car.CarrierNum= ip.CarrierNum INNER JOIN procedurelog pl ON pl.ProcNum = cp.ProcNum INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum INNER JOIN fee f ON f.CodeNum = pc.CodeNum AND f.ProvNum = 0 AND f.ClinicNum = 0 INNER JOIN feesched fs ON fs.FeeSchedNum = f.FeeSched AND fs.request = @UCRFeeSchedule WHERE cl.DateService BETWEEN DATE(@FromDate) AND DATE(@ToDate) ORDER BY cl.DateService,cl.ProvTreat,cl.ClaimNum,pc.ProcCode,cl.PatNum,pl.ProcNum"
    },
    {
      request: "Sum of appointment lengths for time period\r\nhelps measure utilization",
      query: "SET @StartDate='2011-04-01' , @EndDate='2011-04-07'; SELECT o.OpName, FORMAT(SUM(LENGTH(a.Pattern))/12,1) AS 'AptTime(hrs)', FORMAT(SUM(LENGTH(a.Pattern)-LENGTH(REPLACE(a.Pattern,'X','')))/12,1) AS 'ProvTime(hrs)' FROM appointment a INNER JOIN operatory o ON o.OperatoryNum=a.Op WHERE DATE(a.AptDateTime) BETWEEN @StartDate AND @EndDate AND (a.AptStatus=2 OR a.AptStatus=1) GROUP BY o.OpName;"
    },
    {
      request: "Monthly Production and Income Report with Insurance Income & Writeoffs by Date of Service\r\nCAUTION THIS IS an unusual report, read the title carefully",
      query: "DROP TABLE IF EXISTS t1,t2; SET @FromDate='2009-03-01' , @ToDate='2009-03-31'; CREATE TABLE t1( Day int NOT NULL, Date date, DayOfWeek varchar(10), $Production double NOT NULL DEFAULT 0, $Adjustments double NOT NULL DEFAULT 0, $WriteOffs double NOT NULL DEFAULT 0, $TotProduction double NOT NULL DEFAULT 0, $PatIncome double NOT NULL DEFAULT 0, $InsIncome double NOT NULL DEFAULT 0, $TotIncome double NOT NULL DEFAULT 0); INSERT INTO t1(Day) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24),(25),(26),(27),(28),(29),(30),(31); DELETE FROM t1 WHERE Day>DAY(LAST_DAY(@FromDate)); UPDATE t1 SET Date=STR_TO_DATE(CONCAT(MONTH(@FromDate), '/', Day, '/', YEAR(@FromDate)),'%c/%e/%Y'); UPDATE t1 SET DayOfWeek=DATE_FORMAT(Date, '%W'); CREATE TABLE t2 SELECT DAYOFMONTH(pl.ProcDate) AS 'Day', SUM(pl.procfee) AS 'Production' FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pl.ProcDate); UPDATE t1,t2 SET t1.$Production=t2.Production WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(a.AdjDate) AS 'Day', SUM(a.AdjAmt) AS 'Adjustments' FROM adjustment a WHERE a.AdjDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(a.AdjDate); UPDATE t1,t2 SET t1.$Adjustments=t2.Adjustments WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(pp.DatePay) AS 'Day', SUM(pp.SplitAmt) AS 'PatIncome' FROM paysplit pp WHERE pp.DatePay BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pp.DatePay); UPDATE t1,t2 SET t1.$PatIncome=t2.PatIncome WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(cp.ProcDate) AS 'Day', SUM(cp.WriteOff) AS 'WriteOffs' FROM claimproc cp WHERE (cp.Status=1 OR cp.Status=4 OR cp.Status=0) AND cp.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(cp.ProcDate); UPDATE t1,t2 SET t1.$WriteOffs=-t2.WriteOffs WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(cp.ProcDate) AS 'Day', SUM(cp.InsPayAmt) AS 'InsIncome' FROM claimproc cp WHERE (cp.Status=1 OR cp.Status=4) AND cp.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(cp.ProcDate); UPDATE t1,t2 SET t1.$InsIncome=t2.InsIncome WHERE t1.Day=t2.Day; UPDATE t1 SET $TotProduction=$Production+$Adjustments+$WriteOffs, $TotIncome=$InsIncome+$PatIncome ; DROP TABLE IF EXISTS t2; ALTER TABLE t1 DROP Day; SELECT * FROM t1; DROP TABLE IF EXISTS t1;"
    },
    {
      request: "Outstanding Insurance Claims (not preauths) for a given carrier",
      query: "SET @Carrier = '%DC%'; SELECT cl.PatNum, cl.DateSent, i.plannum, cl.claimfee, cl.inspayest FROM claim cl INNER JOIN patient p ON p.PatNum = cl.PatNum INNER JOIN insplan i ON i.PlanNum = cl.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = i.CarrierNum WHERE cl.ClaimStatus = 'S' AND ca.CarrierName LIKE @Carrier AND cl.ClaimType != 'PreAuth' GROUP BY cl.ClaimNum ORDER BY ca.CarrierName,p.LName;"
    },
    {
      request: "Payment Report like 169 except for date range, without providers listed, similar to Daily Payment Report",
      query: "SET @FromDate='2012-01-01', @ToDate='2012-01-31' ; DROP TABLE IF EXISTS tmp; CREATE TABLE tmp SELECT paysplit.PatNum, definition.ItemName AS PaymentType, payment.CheckNum, DATE(paysplit.DatePay) AS 'DatePay', SUM(paysplit.SplitAmt) AS $PaymentAmt FROM payment,definition,paysplit WHERE (paysplit.DatePay BETWEEN @FromDate AND @ToDate) AND payment.PayNum=paysplit.PayNum AND definition.DefNum=payment.PayType GROUP BY paysplit.PatNum, definition.ItemName UNION ALL SELECT PatNum, 'Ins Checks' as PaymentType, cpy.CheckNum, claimproc.DateCP AS 'DatePay', SUM(claimproc.InsPayAmt) AS $PaymentAmt FROM claimproc INNER JOIN claimpayment cpy ON cpy.ClaimPaymentNum=claimproc.ClaimPaymentNum WHERE claimproc.DateCP>=@FromDate AND claimproc.DateCP<=@ToDate AND (claimproc.Status=1 OR claimproc.Status=4) GROUP BY PatNum; SELECT tmp.PatNum, PaymentType, DatePay, $PaymentAmt FROM tmp, patient WHERE tmp.PatNum=patient.PatNum ORDER BY DatePay ASC, patient.LName; DROP TABLE IF EXISTS tmp;"
    },
    {
      request: "Sent or Received claims sent to a specified carrier with date of service in the specified date range",
      query: "SET @FromDate='2025-01-01', @ToDate='2025-01-31'; SET @Carriers=''; SET @Clinics=''; SET @Carrs = IF(LENGTH(@Carriers) = 0,'^',REPLACE(@Carriers,',','|')); SET @Clinics = (CASE WHEN LENGTH(@Clinics) = 0 THEN '^' ELSE CONCAT('^',REPLACE(@Clinics,',','$|^'),'$') END); SELECT ValueString INTO @EasyNoClinics FROM preference WHERE PrefName = 'EasyNoClinics'; SELECT c.PatNum AS 'Pat Num' ,c.PatNum ,IF(@EasyNoClinics,'',IFNULL(clin.Abbr,'Unassigned')) AS 'Clinic' ,c.DateService ,c.DateSent ,ca.CarrierName AS 'Carrier' ,ca.Phone AS 'Carrier Phone' ,IFNULL(( SELECT SUM(pl.ProcFee * (pl.UnitQty + pl.BaseUnits)) - SUM(cp.WriteOff) FROM procedurelog pl INNER JOIN claimproc cp ON pl.ProcNum = cp.ProcNum AND cp.Status IN (1,4,7) WHERE cp.ClaimNum = c.ClaimNum ),0) AS '$PatBilled_' FROM claim c INNER JOIN patient p ON p.PatNum = c.PatNum INNER JOIN insplan ip ON ip.PlanNum = c.PlanNum INNER JOIN carrier ca ON ca.CarrierNum = ip.CarrierNum AND ca.CarrierName REGEXP @Carrs LEFT JOIN clinic clin ON clin.ClinicNum = c.ClinicNum WHERE c.ClaimStatus IN ('S','R') AND c.ClaimType != 'PreAuth' AND c.DateService BETWEEN DATE(@FromDate) AND DATE(@ToDate) AND (CASE WHEN @EasyNoClinics = 0 THEN IFNULL(clin.Abbr,'Unassigned') REGEXP @Clinics ELSE TRUE END) GROUP BY c.ClaimNum ORDER BY ca.CarrierName, p.LName, p.FName, c.PatNum, c.DateService, c.ClaimNum"
    },
    {
      request: "Count of Hygiene Appointments and Distinct Hygiene Patients in Date Range, only a count",
      query: "SET @FromDate='2016-01-01' , @ToDate='2016-12-31'; SET @ProcCodesMarkedHyg=\"YES\"; SET @HygCodes='D1110|D1120'; SELECT COUNT(DISTINCT (CASE pl.AptNum WHEN 0 THEN NULL ELSE pl.AptNum END)) AS 'Hyg Apt Count' , COUNT(DISTINCT pl.PatNum) AS 'Hyg Pat Count' FROM patient INNER JOIN procedurelog pl ON patient.PatNum=pl.PatNum AND pl.ProcStatus = '2' AND pl.ProcDate BETWEEN @FromDate AND @ToDate INNER JOIN procedurecode pc ON pl.CodeNum= pc.CodeNum AND (CASE @ProcCodesMarkedHyg WHEN \"YES\" THEN pc.IsHygiene=1 ELSE pc.ProcCode REGEXP @HygCodes END)"
    },
    {
      request: "What amount of family balance is for work completed before a user provided date in the past\r\nGives OldDebtBalance and OldInsuranceEstimate and allows you to set paid thru date,\r\nalso shows current family balance and Insurance Estimate",
      query: "SET @AsOf='2010-02-01'; SET @PaidThru='2010-04-16'; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4; CREATE TABLE tmp1 (PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0); INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2 AND pl.ProcDate<=@AsOf; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount FROM paysplit ps WHERE ps.PayPlanNum=0 AND ps.ProcDate<=@PaidThru; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a WHERE a.AdjDate<=@PaidThru; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (1,4,5,7) AND cp.ProcDate<=@AsOf AND cp.DateCp<=@PaidThru; INSERT INTO tmp1 (PatNum,TranDate,TranAmount) SELECT pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount FROM payplan pp WHERE pp.PayPlanDate<=@PaidThru; CREATE TABLE tmp3 SELECT p.Guarantor,SUM(cp.InsPayEst) AS InsPayEst, 0 AS WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE (cp.Status=0 AND cp.ProcDate<=@AsOf) GROUP BY p.Guarantor; INSERT INTO tmp3 SELECT p.Guarantor,0 AS InsPayEst, (CASE WHEN ISNULL(SUM(cp.Writeoff)) THEN 0 ELSE SUM(cp.WriteOff) END) AS WriteOff FROM patient p INNER JOIN claimproc cp ON cp.PatNum=p.PatNum WHERE ((cp.Status=0 AND cp.ProcDate<=@AsOf) OR (cp.Status IN(1,4) AND cp.DateCP>@AsOf AND cp.ProcDate<=@AsOf)) GROUP BY p.Guarantor; CREATE TABLE tmp2 SELECT patient.Guarantor, SUM(tmp1.TranAmount) AS 'FamBal' FROM patient INNER JOIN tmp1 ON tmp1.PatNum=Patient.PatNum GROUP BY patient.Guarantor; CREATE TABLE tmp4 SELECT 'SumUnpaidBalances' AS 'request', SUM(FamBal) '$Value' FROM tmp2 WHERE FamBal>0 UNION ALL SELECT 'TotInsPayEst' AS 'request', SUM(InsPayEst) '$Value' FROM tmp3 UNION ALL SELECT 'TotWriteOffEst' AS 'request', SUM(WriteOff) '$Value' FROM tmp3; SELECT tmp2.Guarantor, p.PatNum AS GuarPatNum, tmp2.FamBal as '$OldDebtFamBal', p.BalTotal AS '$CurBalTotal', t3.InsPayEst+t3.WriteOff AS $OldInsPayEst, p.InsEst AS '$CurTotInsEst' FROM tmp2 LEFT JOIN (SELECT Guarantor,SUM(InsPayEst) AS InsPayEst, SUM(WriteOff) AS WriteOff FROM tmp3 GROUP BY Guarantor) t3 ON t3.Guarantor=tmp2.Guarantor LEFT JOIN patient p ON tmp2.Guarantor=p.PatNum WHERE tmp2.FamBal>.001 ORDER BY LName, FName; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4;"
    },
    {
      request: "Show all transactions that comprise an aging report",
      query: "SET @AsOf='2009-07-31'; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmpTotals; CREATE TABLE tmp1 (TranType VARCHAR(10), PatNum INT DEFAULT 0, TranDate DATE DEFAULT '0001-01-01', TranAmount DOUBLE DEFAULT 0); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Fee' AS TranType, pl.PatNum PatNum,pl.ProcDate TranDate,pl.ProcFee*(pl.UnitQty+pl.BaseUnits) TranAmount FROM procedurelog pl WHERE pl.ProcStatus=2; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Pay' AS TranType,ps.PatNum PatNum,ps.ProcDate TranDate,-ps.SplitAmt TranAmount FROM paysplit ps WHERE ps.PayPlanNum=0 ; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Adj' AS TranType, a.PatNum PatNum,a.AdjDate TranDate,a.AdjAmt TranAmount FROM adjustment a; INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'InsPay' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt TranAmount FROM claimproc cp WHERE cp.Status IN (1,4); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Writeoff' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (1,4); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'Capitat' AS TranType,cp.PatNum PatNum, cp.DateCp TranDate,-cp.InsPayAmt-cp.Writeoff TranAmount FROM claimproc cp WHERE cp.Status IN (5,7); INSERT INTO tmp1 (TranType,PatNum,TranDate,TranAmount) SELECT 'PayPlan' AS TranType,pp.PatNum PatNum, pp.PayPlanDate TranDate, -pp.CompletedAmt TranAmount FROM payplan pp; SELECT patient.Guarantor,TranType, TranDate, TranAmount AS $TranAmount FROM tmp1 INNER JOIN patient ON patient.PatNum=tmp1.PatNum INNER JOIN patient g ON patient.Guarantor = g.PatNum WHERE TranAmount<> 0 AND TranDate<=@AsOf ORDER BY g.LName, g.FName; DROP TABLE IF EXISTS tmp1, tmp2, tmp3, tmp4, tmpTotals;"
    },
    {
      request: "Ortho or other marked patient Monthly Production and Income",
      query: "DROP TABLE IF EXISTS t1,t2; SET @FromDate='2009-03-01' , @ToDate='2009-03-31'; CREATE TABLE t1( Day int NOT NULL, Date date, DayOfWeek varchar(10), $Production double NOT NULL DEFAULT 0, $Adjustments double NOT NULL DEFAULT 0, $WriteOffs double NOT NULL DEFAULT 0, $TotProduction double NOT NULL DEFAULT 0, $PatIncome double NOT NULL DEFAULT 0, $InsIncome double NOT NULL DEFAULT 0, $TotIncome double NOT NULL DEFAULT 0); INSERT INTO t1(Day) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24),(25),(26),(27),(28),(29),(30),(31); DELETE FROM t1 WHERE Day>DAY(LAST_DAY(@FromDate)); UPDATE t1 SET Date=STR_TO_DATE(CONCAT(MONTH(@FromDate), '/', Day, '/', YEAR(@FromDate)),'%c/%e/%Y'); UPDATE t1 SET DayOfWeek=DATE_FORMAT(Date, '%W'); CREATE TABLE t2 SELECT DAYOFMONTH(pl.ProcDate) AS 'Day', SUM(pl.procfee) AS 'Production' FROM procedurelog pl INNER JOIN patient p on p.PatNum=pl.PatNum WHERE pl.ProcStatus=2 AND p.LName LIKE '%Ortho%' AND pl.ProcDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pl.ProcDate); UPDATE t1,t2 SET t1.$Production=t2.Production WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(a.AdjDate) AS 'Day', SUM(a.AdjAmt) AS 'Adjustments' FROM adjustment a INNER JOIN patient p on a.PatNum=p.PatNum WHERE p.LName LIKE '%Ortho%' AND a.AdjDate BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(a.AdjDate); UPDATE t1,t2 SET t1.$Adjustments=t2.Adjustments WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(pp.DatePay) AS 'Day', SUM(pp.SplitAmt) AS 'PatIncome' FROM paysplit pp INNER JOIN patient p on pp.PatNum=p.PatNum WHERE p.LName LIKE '%Ortho%' AND pp.DatePay BETWEEN @FromDate AND @ToDate GROUP BY DAYOFMONTH(pp.DatePay); UPDATE t1,t2 SET t1.$PatIncome=t2.PatIncome WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; CREATE TABLE t2 SELECT DAYOFMONTH(cp.ProcDate) AS 'Day', SUM(cp.WriteOff) AS 'WriteOffs' FROM claimproc cp INNER JOIN patient p on p.PatNum=cp.PatNum WHERE p.LName LIKE '%Ortho%' AND cp.ProcDate BETWEEN @FromDate AND @ToDate AND cp.Status IN (1,4) GROUP BY DAYOFMONTH(cp.ProcDate); UPDATE t1,t2 SET t1.$WriteOffs=t2.WriteOffs WHERE t1.Day=t2.Day; DROP TABLE IF EXISTS t2; UPDATE t1 SET $TotProduction=$Production+$Adjustments-$WriteOffs, $TotIncome=$PatIncome+$InsIncome; SELECT * FROM t1; DROP TABLE IF EXISTS t1,t2;"}
    ]

    // ========================================================================
// HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);
  const httpMethod = event.httpMethod;

  console.log('Query Generator Request:', JSON.stringify({
    method: httpMethod,
    path: event.path,
    body: event.body?.substring(0, 500),
  }));

  try {
    // Handle OPTIONS for CORS preflight
    if (httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    if (httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { query, includeExamples = true } = body as { 
      query: string; 
      includeExamples?: boolean;
    };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing or invalid query parameter',
          message: 'Please provide a natural language query describing the SQL you need.',
        }),
      };
    }

    // Load schema (cached after first load)
    const schema = loadSchema();

    // Load raw schema and cheatsheet content for the system prompt
    const schemaPath = path.join(__dirname, 'schema.json');
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    
    const cheatsheetPath = path.join(__dirname, 'sqlcheatsheet.json');
    const cheatsheetContent = fs.existsSync(cheatsheetPath) 
      ? fs.readFileSync(cheatsheetPath, 'utf-8') 
      : '';

    // Find relevant tables for this query
    const relevantTables = findRelevantTables(query, schema.tables);
    const detailedSchema = generateDetailedSchema(relevantTables);

    // Build the prompt
    const messages: { role: string; content: string }[] = [];

    // Add example queries if requested
    if (includeExamples && EXAMPLE_QUERIES.length > 0) {
      // Find the most relevant example
      const queryLower = query.toLowerCase();
      const relevantExample = EXAMPLE_QUERIES.find(ex => 
        queryLower.includes('production') && ex.request.includes('production') ||
        queryLower.includes('collection') && ex.request.includes('collection')
      );

      if (relevantExample) {
        messages.push({
          role: 'user',
          content: `Example request: "${relevantExample.request}"`,
        });
        messages.push({
          role: 'assistant',
          content: relevantExample.query,
        });
      }
    }

    // Add the user's actual query
    messages.push({
      role: 'user',
      content: `Using the following OpenDental schema, generate a SQL query for this request:

Request: "${query.trim()}"

Relevant Schema:
${detailedSchema}

Additional Schema Reference:
${schema.compactSchema}

Generate the SQL query now:`,
    });

    // Call Bedrock - Build dynamic system prompt with schema and cheatsheet
    const systemPrompt = buildSystemPrompt(schemaContent, cheatsheetContent);
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: CONFIG.TEMPERATURE,
      system: systemPrompt,
      messages,
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    console.log('Invoking Bedrock with Claude Sonnet 4.5...');
    const startTime = Date.now();
    
    const response = await bedrockClient.send(command);
    const claudeResponse = JSON.parse(new TextDecoder().decode(response.body));

    const latencyMs = Date.now() - startTime;
    console.log(`Bedrock response received in ${latencyMs}ms`);

    // Extract the SQL query from the response
    let generatedQuery = '';
    if (claudeResponse.content && Array.isArray(claudeResponse.content)) {
      const textContent = claudeResponse.content.find((c: any) => c.type === 'text');
      if (textContent) {
        generatedQuery = textContent.text.trim();
      }
    }

    // Clean up the query (remove markdown code blocks if present)
    generatedQuery = generatedQuery
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Log for debugging
    console.log('Generated Query:', generatedQuery.substring(0, 500));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        query: generatedQuery,
        metadata: {
          model: CONFIG.MODEL_ID,
          latencyMs,
          schemaVersion: schema.version,
          relevantTables: relevantTables.map(t => t.name),
        },
      }),
    };

  } catch (error: any) {
    console.error('Query Generator Error:', error);

    const statusCode = error.statusCode || error.$metadata?.httpStatusCode || 500;
    
    return {
      statusCode,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Failed to generate query',
        message: error.message || 'An unexpected error occurred',
        ...(process.env.DEBUG_MODE === 'true' && { stack: error.stack }),
      }),
    };
  }
};
