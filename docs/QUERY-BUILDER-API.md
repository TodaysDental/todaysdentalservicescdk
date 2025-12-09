# Open Dental Query Builder API Documentation

This document describes how to build a frontend query builder that integrates with the Open Dental proxy API to execute SQL queries against the Open Dental database.

## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Authentication](#authentication)
3. [Query Execution Flow](#query-execution-flow)
4. [Building a Query Builder UI](#building-a-query-builder-ui)
5. [Schema Reference](#schema-reference)
6. [Query Templates](#query-templates)
7. [Security Considerations](#security-considerations)

---

## API Endpoints

### Base URL

```
https://{api-gateway-id}.execute-api.{region}.amazonaws.com/{stage}/opendental/{clinicId}
```

### 1. Short Query (PUT) - For Small Result Sets

**Endpoint:** `PUT /opendental/{clinicId}/queries/ShortQuery`

Returns up to 100 rows directly as JSON. Use for quick lookups and paginated results.

**Request:**
```json
{
  "SqlCommand": "SELECT PatNum, LName, FName, Email FROM patient WHERE PatStatus = 0 LIMIT 100"
}
```

**Query Parameters:**
- `Offset` (optional): For pagination. Example: `?Offset=100` for page 2

**Response (200 OK):**
```json
[
  {
    "PatNum": 1,
    "LName": "Smith",
    "FName": "John",
    "Email": "john.smith@email.com"
  },
  {
    "PatNum": 2,
    "LName": "Johnson",
    "FName": "Jane",
    "Email": "jane.j@email.com"
  }
]
```

**Error Responses:**
- `400 Bad Request` - SQL syntax error
- `401 Unauthorized` - Query is not read-only or uses non-temporary tables
- `403 Forbidden` - No access to this clinic

---

### 2. Long Query (POST) - For Large Result Sets

**Endpoint:** `POST /opendental/{clinicId}/queries`

Executes query via Open Dental API, writes results to SFTP, reads CSV, and returns as JSON. Use for queries that may return more than 100 rows.

**Request:**
```json
{
  "SqlCommand": "SELECT * FROM appointment WHERE AptDateTime >= '2024-01-01'"
}
```

**Response (200 OK):**
```json
[
  {
    "AptNum": 1234,
    "PatNum": 567,
    "AptDateTime": "2024-01-15T09:00:00",
    "AptStatus": 1,
    "ProcDescript": "Cleaning, Exam"
  }
]
```

**Response (No Results):**
```json
{
  "message": "No results returned from query"
}
```

---

## Authentication

All requests require a valid JWT token in the Authorization header:

```http
Authorization: Bearer {jwt-token}
```

The token must include:
- User's clinic access permissions
- Module permissions for "Operations" with appropriate read/write access

### Permission Requirements

| Endpoint | HTTP Method | Required Permission |
|----------|-------------|---------------------|
| `/queries/ShortQuery` | PUT | Operations: `read` or `put` |
| `/queries` | POST | Operations: `write` |

---

## Query Execution Flow

### Frontend Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. User builds query visually or writes SQL                    │
│  2. Validate query is SELECT-only (client-side)                 │
│  3. Determine which endpoint to use:                            │
│     - Has LIMIT ≤ 100? → PUT /queries/ShortQuery                │
│     - Large result set? → POST /queries                          │
│  4. Send request with auth token                                │
│  5. Display results in table                                    │
│  6. Support export to CSV/JSON                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (openDentalProxy.ts)                 │
├─────────────────────────────────────────────────────────────────┤
│  1. Validate JWT token and permissions                          │
│  2. Check clinic access                                         │
│  3. For POST: Send to Open Dental API with SFTP config          │
│  4. Wait for results, download CSV from SFTP                    │
│  5. Parse CSV to JSON and return                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OPEN DENTAL API                              │
├─────────────────────────────────────────────────────────────────┤
│  - Executes SQL against Open Dental database                    │
│  - Only SELECT queries allowed                                  │
│  - Results written to SFTP (for POST)                           │
│  - Returns JSON directly (for PUT ShortQuery)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Choosing the Right Endpoint

```javascript
function chooseEndpoint(sql) {
  const hasLimit = /LIMIT\s+(\d+)/i.exec(sql);
  const limit = hasLimit ? parseInt(hasLimit[1]) : null;
  
  if (limit && limit <= 100) {
    return 'PUT /queries/ShortQuery';  // Fast, direct JSON
  }
  return 'POST /queries';  // For larger results
}
```

---

## Building a Query Builder UI

### Recommended Components

#### 1. Table Selector
- Dropdown or searchable list of available tables
- Show table description on hover/select
- Common tables: `patient`, `appointment`, `provider`, `procedurelog`, `recall`, `claim`

#### 2. Column Picker
- Checkbox list of columns for selected table(s)
- Show column type (varchar, int, date, etc.)
- Indicate primary keys (PK) and foreign keys (FK)
- "Select All" / "Deselect All" buttons

#### 3. Join Builder
- Add/remove joins between tables
- Select join type: INNER, LEFT, RIGHT
- Auto-suggest joins based on foreign key relationships
- Show ON clause visually

#### 4. WHERE Condition Builder
- Add multiple conditions
- Condition row: `[Table] [Column] [Operator] [Value]`
- Operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IN`, `IS NULL`, `IS NOT NULL`, `BETWEEN`
- Logical connectors: AND / OR
- Support for grouped conditions (parentheses)

#### 5. ORDER BY Builder
- Add sort columns
- Direction toggle: ASC / DESC
- Drag to reorder

#### 6. LIMIT / OFFSET Controls
- Numeric inputs for pagination
- Sensible defaults (e.g., LIMIT 100)

#### 7. SQL Preview Panel
- Show generated SQL in real-time
- Syntax highlighting recommended
- Copy to clipboard button

#### 8. SQL Editor Mode (Advanced)
- Raw SQL textarea for power users
- Toggle between visual and SQL modes
- Validate before execution

#### 9. Results Table
- Column headers from query
- Sortable columns (client-side)
- Search/filter box
- Pagination
- Export buttons: CSV, JSON, Excel
- Row count and execution time display

---

## Schema Reference

### Core Tables for Query Builder

Below are the most commonly queried tables. Include these in your table selector:

#### patient
Primary patient demographics table.

| Column | Type | Description |
|--------|------|-------------|
| PatNum | bigint | Primary key |
| LName | varchar(100) | Last name |
| FName | varchar(100) | First name |
| Birthdate | date | Date of birth |
| PatStatus | tinyint | 0=Patient, 1=NonPatient, 2=Inactive, 3=Archived |
| Gender | tinyint | 0=Male, 1=Female, 2=Unknown |
| Email | varchar(100) | Email address |
| HmPhone | varchar(30) | Home phone |
| WirelessPhone | varchar(30) | Cell phone |
| Address, City, State, Zip | varchar | Address fields |
| PriProv | bigint | FK → provider.ProvNum |
| ClinicNum | bigint | FK → clinic.ClinicNum |
| Guarantor | bigint | FK → patient.PatNum (head of household) |
| BalTotal | double | Total balance |

#### appointment
Scheduled and completed appointments.

| Column | Type | Description |
|--------|------|-------------|
| AptNum | bigint | Primary key |
| PatNum | bigint | FK → patient.PatNum |
| AptStatus | tinyint | 1=Scheduled, 2=Complete, 3=UnschedList, 5=Broken, 6=Planned |
| AptDateTime | datetime | Appointment date/time |
| ProvNum | bigint | FK → provider.ProvNum |
| ProvHyg | bigint | FK → provider.ProvNum (hygienist) |
| Op | bigint | FK → operatory.OperatoryNum |
| ClinicNum | bigint | FK → clinic.ClinicNum |
| ProcDescript | text | Procedure description |
| Note | text | Appointment note |
| IsNewPatient | tinyint | Is new patient appointment |
| Confirmed | bigint | FK → definition.DefNum |

#### provider
Dentists, hygienists, and staff.

| Column | Type | Description |
|--------|------|-------------|
| ProvNum | bigint | Primary key |
| Abbr | varchar(5) | Short abbreviation |
| LName | varchar(100) | Last name |
| FName | varchar(100) | First name |
| IsSecondary | tinyint | Is hygienist |
| IsHidden | tinyint | Is hidden from lists |
| Specialty | bigint | FK → definition.DefNum |

#### procedurelog
Completed and treatment planned procedures.

| Column | Type | Description |
|--------|------|-------------|
| ProcNum | bigint | Primary key |
| PatNum | bigint | FK → patient.PatNum |
| AptNum | bigint | FK → appointment.AptNum |
| CodeNum | bigint | FK → procedurecode.CodeNum |
| ProcDate | date | Procedure date |
| ProcFee | double | Fee charged |
| ProcStatus | tinyint | 1=TP, 2=Complete, 3=EC, 4=EO |
| ProvNum | bigint | FK → provider.ProvNum |
| ClinicNum | bigint | FK → clinic.ClinicNum |
| ToothNum | varchar(10) | Tooth number |
| Surf | varchar(10) | Surface(s) |

#### procedurecode
ADA procedure code definitions.

| Column | Type | Description |
|--------|------|-------------|
| CodeNum | bigint | Primary key |
| ProcCode | varchar(15) | Code (e.g., D0120) |
| Descript | varchar(255) | Description |
| AbbrDesc | varchar(50) | Abbreviated description |

#### recall
Patient recall/recare schedules.

| Column | Type | Description |
|--------|------|-------------|
| RecallNum | bigint | Primary key |
| PatNum | bigint | FK → patient.PatNum |
| DateDue | date | Due date |
| DatePrevious | date | Previous visit date |
| RecallInterval | int | Interval in months |
| IsDisabled | tinyint | Is recall disabled |
| RecallTypeNum | bigint | FK → recalltype.RecallTypeNum |

#### clinic
Practice locations.

| Column | Type | Description |
|--------|------|-------------|
| ClinicNum | bigint | Primary key |
| Description | varchar(255) | Clinic name |
| Abbr | varchar(50) | Abbreviation |
| Address, City, State, Zip, Phone | varchar | Contact info |

#### Additional Tables

Also consider including:
- `operatory` - Treatment rooms
- `schedule` - Provider schedules
- `payment` - Patient payments
- `adjustment` - Account adjustments
- `claim` - Insurance claims
- `insplan` - Insurance plans
- `inssub` - Insurance subscribers
- `patplan` - Patient-plan links
- `carrier` - Insurance carriers
- `clockevent` - Time clock entries
- `employee` - Employee records
- `commlog` - Communication log
- `definition` - System definitions

### Common Foreign Key Relationships

Use these for auto-suggesting JOINs:

```
appointment.PatNum → patient.PatNum
appointment.ProvNum → provider.ProvNum
appointment.ClinicNum → clinic.ClinicNum
appointment.Op → operatory.OperatoryNum
procedurelog.PatNum → patient.PatNum
procedurelog.CodeNum → procedurecode.CodeNum
procedurelog.ProvNum → provider.ProvNum
recall.PatNum → patient.PatNum
payment.PatNum → patient.PatNum
claim.PatNum → patient.PatNum
claim.PlanNum → insplan.PlanNum
patplan.PatNum → patient.PatNum
patplan.InsSubNum → inssub.InsSubNum
inssub.PlanNum → insplan.PlanNum
insplan.CarrierNum → carrier.CarrierNum
```

---

## Query Templates

Provide these pre-built queries for common use cases:

### Active Patients
```sql
SELECT PatNum, LName, FName, Email, WirelessPhone, HmPhone
FROM patient
WHERE PatStatus = 0
ORDER BY LName, FName
LIMIT 100
```

### Today's Appointments
```sql
SELECT 
  a.AptDateTime,
  p.LName,
  p.FName,
  pr.Abbr AS Provider,
  a.ProcDescript,
  a.AptStatus
FROM appointment a
INNER JOIN patient p ON a.PatNum = p.PatNum
LEFT JOIN provider pr ON a.ProvNum = pr.ProvNum
WHERE DATE(a.AptDateTime) = CURDATE()
ORDER BY a.AptDateTime
```

### Recalls Due This Month
```sql
SELECT 
  p.PatNum,
  p.LName,
  p.FName,
  p.WirelessPhone,
  r.DateDue
FROM recall r
INNER JOIN patient p ON r.PatNum = p.PatNum
WHERE r.DateDue <= LAST_DAY(CURDATE())
  AND r.DateDue >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
  AND r.IsDisabled = 0
  AND p.PatStatus = 0
ORDER BY r.DateDue
```

### Production by Provider (Date Range)
```sql
SELECT 
  pr.Abbr AS Provider,
  pr.LName,
  pr.FName,
  SUM(pl.ProcFee) AS TotalProduction,
  COUNT(pl.ProcNum) AS ProcedureCount
FROM procedurelog pl
INNER JOIN provider pr ON pl.ProvNum = pr.ProvNum
WHERE pl.ProcStatus = 2
  AND pl.ProcDate BETWEEN '2024-01-01' AND '2024-12-31'
GROUP BY pr.ProvNum, pr.Abbr, pr.LName, pr.FName
ORDER BY TotalProduction DESC
```

### Patients with Insurance
```sql
SELECT 
  p.PatNum,
  p.LName,
  p.FName,
  c.CarrierName,
  isub.SubscriberID,
  ip.GroupNum
FROM patient p
LEFT JOIN patplan pp ON p.PatNum = pp.PatNum
LEFT JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum
LEFT JOIN insplan ip ON isub.PlanNum = ip.PlanNum
LEFT JOIN carrier c ON ip.CarrierNum = c.CarrierNum
WHERE pp.Ordinal = 1
  AND p.PatStatus = 0
ORDER BY p.LName, p.FName
```

### New Patients This Month
```sql
SELECT 
  PatNum,
  LName,
  FName,
  Birthdate,
  DateFirstVisit,
  Email,
  WirelessPhone
FROM patient
WHERE DateFirstVisit >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
  AND PatStatus = 0
ORDER BY DateFirstVisit DESC
```

---

## Security Considerations

### Client-Side Validation

Before sending a query, validate on the frontend:

```javascript
function validateQuery(sql) {
  const normalized = sql.trim().toUpperCase();
  
  // Must start with SELECT
  if (!normalized.startsWith('SELECT')) {
    return { valid: false, error: 'Query must start with SELECT' };
  }
  
  // Block dangerous keywords
  const forbidden = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
    'TRUNCATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
    'INTO OUTFILE', 'INTO DUMPFILE'
  ];
  
  for (const keyword of forbidden) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(sql)) {
      return { valid: false, error: `Forbidden keyword: ${keyword}` };
    }
  }
  
  return { valid: true };
}
```

### Server-Side Enforcement

The backend (`openDentalProxy.ts`) already enforces:
- JWT authentication required
- Clinic access validation
- Module permission checks
- Open Dental API only allows read-only queries (returns 401 for non-SELECT)

### Best Practices

1. **Always use LIMIT** - Prevent accidental full table scans
2. **Parameterize dates** - Use date pickers, not raw text input
3. **Escape user input** - Escape quotes in value fields
4. **Log queries** - Track who runs what queries (audit trail)
5. **Rate limiting** - Consider limiting queries per user per minute
6. **Timeout handling** - Set reasonable timeouts (30s recommended)

---

## Example Frontend Implementation

### Technology Recommendations

- **React/Vue/Angular** - Any modern framework works
- **TypeScript** - Strongly recommended for type safety
- **TanStack Table** - Excellent for results display
- **Monaco Editor** - For SQL editor mode
- **react-query/SWR** - For API state management

### API Service Example

```typescript
interface QueryResult {
  success: boolean;
  data?: Record<string, unknown>[];
  error?: string;
  rowCount?: number;
}

async function executeQuery(
  sql: string,
  clinicId: string,
  authToken: string
): Promise<QueryResult> {
  // Validate first
  const validation = validateQuery(sql);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  // Choose endpoint
  const hasLimit = /LIMIT\s+(\d+)/i.exec(sql);
  const limit = hasLimit ? parseInt(hasLimit[1]) : null;
  const usePut = limit && limit <= 100;
  
  const url = usePut
    ? `/opendental/${clinicId}/queries/ShortQuery`
    : `/opendental/${clinicId}/queries`;
  
  const response = await fetch(url, {
    method: usePut ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ SqlCommand: sql }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    return { success: false, error: error.error || response.statusText };
  }
  
  const data = await response.json();
  return {
    success: true,
    data: Array.isArray(data) ? data : [],
    rowCount: Array.isArray(data) ? data.length : 0,
  };
}
```

### SQL Generation Example

```typescript
interface QueryConfig {
  table: string;
  columns: string[];
  joins: Array<{
    type: 'INNER' | 'LEFT' | 'RIGHT';
    table: string;
    on: string;
  }>;
  where: Array<{
    column: string;
    operator: string;
    value: string;
  }>;
  orderBy: Array<{
    column: string;
    direction: 'ASC' | 'DESC';
  }>;
  limit: number;
}

function buildQuery(config: QueryConfig): string {
  const parts: string[] = [];
  
  // SELECT
  const cols = config.columns.length > 0 
    ? config.columns.join(', ') 
    : '*';
  parts.push(`SELECT ${cols}`);
  
  // FROM
  parts.push(`FROM ${config.table}`);
  
  // JOINs
  for (const join of config.joins) {
    parts.push(`${join.type} JOIN ${join.table} ON ${join.on}`);
  }
  
  // WHERE
  if (config.where.length > 0) {
    const conditions = config.where
      .map((w, i) => {
        const prefix = i === 0 ? 'WHERE' : 'AND';
        return `${prefix} ${w.column} ${w.operator} ${w.value}`;
      })
      .join('\n');
    parts.push(conditions);
  }
  
  // ORDER BY
  if (config.orderBy.length > 0) {
    const orders = config.orderBy
      .map(o => `${o.column} ${o.direction}`)
      .join(', ');
    parts.push(`ORDER BY ${orders}`);
  }
  
  // LIMIT
  if (config.limit) {
    parts.push(`LIMIT ${config.limit}`);
  }
  
  return parts.join('\n');
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| 400 Bad Request | SQL syntax error | Check SQL syntax, show error to user |
| 401 Unauthorized | Invalid token or non-SELECT query | Re-authenticate or fix query |
| 403 Forbidden | No clinic access | User lacks permission for this clinic |
| 500 Internal Error | SFTP or server issue | Retry, check backend logs |
| Timeout | Query too slow | Add indexes hint, reduce scope |

### User-Friendly Messages

```typescript
function getErrorMessage(status: number, error: string): string {
  switch (status) {
    case 400:
      return `Query syntax error: ${error}`;
    case 401:
      return 'Only SELECT queries are allowed. Modify your query and try again.';
    case 403:
      return 'You do not have access to this clinic.';
    case 500:
      return 'Server error. Please try again later.';
    default:
      return error || 'An unexpected error occurred.';
  }
}
```

---

## Conclusion

The Open Dental Query Builder frontend should:

1. ✅ Provide visual query building (tables, columns, joins, conditions)
2. ✅ Support raw SQL editing for advanced users
3. ✅ Validate queries client-side before sending
4. ✅ Choose appropriate API endpoint based on query
5. ✅ Display results in a sortable, filterable table
6. ✅ Support CSV/JSON export
7. ✅ Include pre-built query templates
8. ✅ Handle errors gracefully with helpful messages

Refer to the schema reference in `dentalsofwareschema.md` for complete table and column definitions.

