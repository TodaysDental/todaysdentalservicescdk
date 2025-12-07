# Definition Entity - API Documentation

## Overview

The `definition` table is a critical system table used extensively throughout the dental software. Almost every table in the database links to the definition table via `DefNum`. The table stores categorized lists of items that are referenced by other parts of the system.

## Database Schema

```sql
CREATE TABLE definition (
  DefNum BIGINT(20) PRIMARY KEY AUTO_INCREMENT,
  Category TINYINT NOT NULL,              -- DefCat enum (0-55)
  ItemOrder SMALLINT NOT NULL DEFAULT 0,  -- Display order (0-indexed)
  ItemName VARCHAR(255) NOT NULL,         -- Common name
  ItemValue VARCHAR(255),                 -- Extra info (e.g., single letter codes)
  ItemColor INT(11),                      -- Optional color value
  IsHidden TINYINT NOT NULL DEFAULT 0,    -- Hide from lists but still referenceable
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (Category),
  INDEX idx_category_order (Category, ItemOrder),
  INDEX idx_category_hidden (Category, IsHidden),
  INDEX idx_itemname (ItemName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Definition Categories (DefCat Enum)

| Value | Category | Description |
|-------|----------|-------------|
| 0 | AccountColors | Colors to display in Account module |
| 1 | AdjTypes | Adjustment types |
| 2 | ApptConfirmed | Appointment confirmed types |
| 3 | ApptProcsQuickAdd | Procedure quick add list for appointments |
| 4 | BillingTypes | Billing types |
| 10 | PaymentTypes | Payment types |
| 11 | ProcCodeCats | Procedure code categories |
| 12 | ProgNoteColors | Progress note colors |
| 13 | RecallUnschedStatus | Recall, reactivation, unscheduled statuses |
| 16 | Diagnosis | Diagnosis types |
| 17 | AppointmentColors | Colors for Appointments module |
| 18 | ImageCats | Image categories (special ItemValue codes) |
| 20 | TxPriorities | Treatment plan priority names |
| 21 | MiscColors | Miscellaneous color options |
| 22 | ChartGraphicColors | Graphical tooth chart colors |
| 23 | ContactCategories | Contact list categories |
| 24 | LetterMergeCats | Letter Merge categories |
| 25 | BlockoutTypes | Schedule Blockout types |
| 26 | ProcButtonCats | Procedure button categories |
| 27 | CommLogTypes | Commlog entry types |
| 28 | SupplyCats | Supply categories |
| 29 | PaySplitUnearnedType | Unearned income types (accrual accounting) |
| 30 | Prognosis | Prognosis types |
| 31 | ClaimCustomTracking | Custom tracking statuses |
| 32 | InsurancePaymentType | Insurance payment types |
| 33 | TaskPriorities | Task priority categories |
| 34 | FeeColors | Fee override color categories |
| 35 | ProviderSpecialties | Provider specialties |
| 36 | ClaimPaymentTracking | Claim rejection reasons |
| 37 | AccountQuickCharge | Account quick charge lists |
| 38 | InsuranceVerificationStatus | Insurance verification statuses |
| 39 | Regions | Clinic regions |
| 40 | ClaimPaymentGroups | Claim payment groups |
| 41 | AutoNoteCats | Auto Note categories |
| 42 | WebSchedNewPatApptTypes | Web Sched new patient appointment types |
| 43 | ClaimErrorCode | Custom claim status error codes |
| 44 | ClinicSpecialty | Clinic specialties |
| 45 | JobPriorities | HQ job priorities |
| 46 | CarrierGroupNames | Carrier group names |
| 47 | PayPlanCategories | Payment plan categories |
| 48 | AutoDeposit | Auto deposit account associations |
| 49 | InsuranceFilingCodeGroup | Insurance filing code groups |
| 50 | TimeCardAdjTypes | Time card adjustment types (PTO, etc.) |
| 51 | WebSchedExistingApptTypes | Web Sched existing appointment types |
| 52 | CertificationCategories | Certification categories |
| 53 | EClipboardImageCapture | eClipboard check-in images |
| 54 | TaskCategories | Task categories |
| 55 | OperatoryTypes | Operatory types (informational) |

## API Endpoints

Base URL: `https://apig.todaysdentalinsights.com/dental-software`

All endpoints require JWT authentication via `Authorization` header.

### List All Definitions

```http
GET /definitions?category={category}&includeHidden={true|false}
```

**Query Parameters:**
- `category` (optional): Filter by DefCat enum value (0-55)
- `includeHidden` (optional): Include hidden items (default: false)

**Example:**
```bash
# Get all payment types (category 10)
GET /definitions?category=10

# Get all definitions including hidden ones
GET /definitions?includeHidden=true
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "DefNum": 1,
      "Category": 10,
      "ItemOrder": 0,
      "ItemName": "Cash",
      "ItemValue": null,
      "ItemColor": null,
      "IsHidden": false
    },
    {
      "DefNum": 2,
      "Category": 10,
      "ItemOrder": 1,
      "ItemName": "Check",
      "ItemValue": null,
      "ItemColor": null,
      "IsHidden": false
    }
  ]
}
```

### Get Specific Definition

```http
GET /definitions/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "DefNum": 1,
    "Category": 10,
    "ItemOrder": 0,
    "ItemName": "Cash",
    "ItemValue": null,
    "ItemColor": null,
    "IsHidden": false
  }
}
```

### Create Definition

```http
POST /definitions
Content-Type: application/json

{
  "Category": 10,
  "ItemOrder": 5,
  "ItemName": "Credit Card",
  "ItemValue": "CC",
  "ItemColor": 16777215,
  "IsHidden": false
}
```

**Required Fields:**
- `Category` - DefCat enum value (0-255)
- `ItemOrder` - Display order (integer)
- `ItemName` - Name (cannot be blank)

**Optional Fields:**
- `ItemValue` - Additional info
- `ItemColor` - Integer color value
- `IsHidden` - Boolean (default: false)

**Response:**
```json
{
  "success": true,
  "message": "Definition created successfully",
  "data": {
    "DefNum": 15,
    "Category": 10,
    "ItemOrder": 5,
    "ItemName": "Credit Card",
    "ItemValue": "CC",
    "ItemColor": 16777215,
    "IsHidden": false
  }
}
```

### Update Definition

```http
PUT /definitions/{id}
Content-Type: application/json

{
  "ItemOrder": 6,
  "IsHidden": true
}
```

**All fields are optional**. Only provided fields will be updated.

**Response:**
```json
{
  "success": true,
  "message": "Definition updated successfully",
  "data": {
    "DefNum": 15,
    "Category": 10,
    "ItemOrder": 6,
    "ItemName": "Credit Card",
    "ItemValue": "CC",
    "ItemColor": 16777215,
    "IsHidden": true
  }
}
```

### Delete Definition

```http
DELETE /definitions/{id}
```

**⚠️ WARNING:** This operation should be used with extreme caution! Definitions are referenced extensively throughout the system. Consider using `IsHidden=true` for soft deletion instead.

**Response (Success):**
```json
{
  "success": true,
  "message": "Definition deleted successfully. Warning: This may affect other tables that reference this definition."
}
```

**Response (Foreign Key Constraint):**
```json
{
  "success": false,
  "error": "Cannot delete definition: it is referenced by other records. Consider setting IsHidden=true instead."
}
```

## Field Details

### ItemValue Usage

The `ItemValue` field serves different purposes depending on the category:

- **ImageCats (18)**: Single letter codes (X, M, F, L, P, S, T, R, E, A, C, B, U, Y, N)
  - X = Show in Chart Module
  - M = Show Thumbnails
  - F = Show in Patient Forms
  - L = Show in Patient Portal
  - P = Show in Patient Pictures
  - S = Statements
  - T = Graphical Tooth Charts
  - R = Treatment Plans
  - E = Expanded
  - A = Payment Plans
  - C = Claim Attachments
  - B = Lab Cases
  - U = Autosave Forms
  - Y = Task Attachments
  - N = Claim Responses

- **ApptProcsQuickAdd (3)**: Procedure codes with optional tooth numbers
  - Example: `D1023,D1024`
  - Example with tooth: `D1151#8,D0220#15`

### ItemColor

The `ItemColor` field stores an integer representation of RGB colors. To convert:

```typescript
// RGB to Integer
const rgbToInt = (r: number, g: number, b: number) => {
  return (r << 16) | (g << 8) | b;
};

// Integer to RGB
const intToRgb = (color: number) => {
  return {
    r: (color >> 16) & 0xFF,
    g: (color >> 8) & 0xFF,
    b: color & 0xFF
  };
};

// Example: White = 16777215
// intToRgb(16777215) => { r: 255, g: 255, b: 255 }
```

### IsHidden

When `IsHidden=true`:
- Item doesn't show in UI lists by default
- Item can still be referenced by other tables
- Preferred method for "deleting" definitions that are in use

## Best Practices

### 1. Always Query by Category

For performance and clarity:
```bash
# Good - Filtered by category
GET /definitions?category=10

# Bad - Gets all 1000+ definitions
GET /definitions
```

### 2. Use Soft Delete

Instead of DELETE, use UPDATE to hide:
```bash
# Preferred
PUT /definitions/15
{"IsHidden": true}

# Avoid (can break references)
DELETE /definitions/15
```

### 3. Maintain ItemOrder

Keep ItemOrder values sequential for proper UI display:
```json
[
  {"ItemOrder": 0, "ItemName": "First"},
  {"ItemOrder": 1, "ItemName": "Second"},
  {"ItemOrder": 2, "ItemName": "Third"}
]
```

### 4. Check References Before Delete

Before hard-deleting a definition, verify it's not referenced:
```sql
-- Example: Check if PaymentType is used
SELECT COUNT(*) FROM payment WHERE PayType = ?
```

## Common Use Cases

### Get All Payment Types

```bash
curl -X GET "https://apig.todaysdentalinsights.com/dental-software/definitions?category=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get All Appointment Colors (Not Hidden)

```bash
curl -X GET "https://apig.todaysdentalinsights.com/dental-software/definitions?category=17&includeHidden=false" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Add a New Billing Type

```bash
curl -X POST "https://apig.todaysdentalinsights.com/dental-software/definitions" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "Category": 4,
    "ItemOrder": 10,
    "ItemName": "Insurance - PPO"
  }'
```

### Hide an Obsolete Definition

```bash
curl -X PUT "https://apig.todaysdentalinsights.com/dental-software/definitions/123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"IsHidden": true}'
```

## Error Handling

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 404 | Definition not found |
| 409 | Conflict (foreign key constraint) |
| 500 | Internal Server Error |

## TypeScript Type Definitions

```typescript
enum DefCat {
  AccountColors = 0,
  AdjTypes = 1,
  // ... (56 total categories)
  OperatoryTypes = 55,
}

interface Definition {
  DefNum: number;
  Category: DefCat;
  ItemOrder: number;
  ItemName: string;
  ItemValue?: string;
  ItemColor?: number;
  IsHidden: boolean;
}
```

## Performance Considerations

- **Indexing**: Queries by category are optimized with composite index
- **Caching**: Consider caching definitions in memory (loaded ahead of time)
- **Query Filtering**: Always filter by category when possible
- **Hidden Items**: Exclude hidden items by default to reduce result size

## Related Tables

The definition table is referenced by:
- Patient records (Billing Type, etc.)
- Appointments (Confirmed Type, Colors)
- Procedures (Categories, Buttons)
- Claims (Custom Tracking, Payment Types)
- Tasks (Priorities, Categories)
- Images (Categories)
- And many more...

---

**Created**: December 7, 2025  
**Version**: 1.0.0

