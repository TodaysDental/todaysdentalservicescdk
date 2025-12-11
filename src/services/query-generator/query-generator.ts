/**
 * Query Generator Lambda - Uses Bedrock Claude to generate SQL queries
 * 
 * This Lambda takes natural language requests about OpenDental data
 * and generates appropriate SQL queries using the OpenDental schema.
 * 
 * Model: Claude 3 Sonnet v1 (anthropic.claude-3-sonnet-20240229-v1:0)
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
  MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
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
        column.enumeration = {
          name: col.Enumeration.name,
          values: (col.Enumeration.EnumValue || []).map((e: any) => ({
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
// SYSTEM PROMPT
// ========================================================================

const SYSTEM_PROMPT = `You are an expert SQL query generator for OpenDental dental practice management software.
Your task is to generate MySQL-compatible SQL queries based on natural language requests.

IMPORTANT RULES:
1. Generate ONLY valid MySQL SQL queries
2. Use proper JOIN syntax (LEFT JOIN, INNER JOIN as appropriate)
3. Always alias tables for clarity
4. Include comments explaining complex parts of the query
5. Handle NULLs appropriately with COALESCE when needed
6. Use proper date/time functions for MySQL (DATE(), DAYNAME(), DATE_ADD(), etc.)
7. For date range queries, use placeholders like '\${startDate}' and '\${endDate}'
8. Always consider data integrity - use proper WHERE clauses
9. Optimize for readability and performance
10. Return ONLY the SQL query, no additional explanation

COMMON PATTERNS:
- Appointment status: 0=None, 1=Scheduled, 2=Complete, 3=Broken, 4=Planned, 5=PtNote, 6=PtNoteCompleted
- ProcStatus: 1=TP (Treatment Planned), 2=C (Complete), 3=EC (Existing Current), 4=EO (Existing Other), 5=R (Referred), 6=D (Deleted), 7=Cn (Condition)
- ClaimProc Status: 0=Estimate, 1=NotReceived, 2=Received, 4=Supplemental

COMMON QUERIES:
- Production reports typically need: appointment, procedurelog, claimproc tables
- Patient counts: COUNT(DISTINCT PatNum)
- New patients: IsNewPatient = 1 on appointment
- Writeoffs come from claimproc table with specific status values

When generating a query:
1. Analyze the request to understand what data is needed
2. Identify the relevant tables from the schema
3. Determine proper JOINs and conditions
4. Write a clean, well-formatted SQL query`;

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
  }
];

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

    // Call Bedrock
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: CONFIG.TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages,
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    console.log('Invoking Bedrock with Claude 3 Sonnet...');
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
