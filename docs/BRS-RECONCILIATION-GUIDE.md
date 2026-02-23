# Bank Reconciliation Statement (BRS) — Professional Guide

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Data Sources](#3-data-sources)
4. [Payment Modes & Gateway Flow](#4-payment-modes--gateway-flow)
5. [Matching Engine — Multi-Pass Strategy](#5-matching-engine--multi-pass-strategy)
6. [Processing Fees & Net Amount Matching](#6-processing-fees--net-amount-matching)
7. [Batch Settlement Matching](#7-batch-settlement-matching)
8. [Payment Mode–Specific Strategies](#8-payment-modespecific-strategies)
9. [Reconciliation Status Lifecycle](#9-reconciliation-status-lifecycle)
10. [Keyword Filtering System](#10-keyword-filtering-system)
11. [API Reference](#11-api-reference)
12. [Troubleshooting Low Match Rates](#12-troubleshooting-low-match-rates)

---

## 1. Overview

### What is BRS?

A **Bank Reconciliation Statement (BRS)** is a financial tool used to verify that
the cash recorded in a company's books (OpenDental practice management) matches the
actual cash received in the bank (Odoo / uploaded bank statements).

### Why BRS Matters for Dental Clinics

Dental clinics collect payments through multiple channels:
- **In-office**: Credit cards, debit cards, cheques, cash
- **Online**: Patient portals, payment links
- **Third-party financing**: Cherry, Sunbit, CareCredit
- **Insurance**: ACH/EFT deposits

Each channel has different:
- **Processing timelines** (instant → 7 days)
- **Fee structures** (0% → 15% merchant discount)
- **Settlement patterns** (individual → daily batch → weekly lump sum)
- **Reference formats** (transaction IDs, UTR numbers, cheque numbers)

Our BRS system automates reconciliation across all these channels.

### System Goal

> **Match every payment recorded in OpenDental to its corresponding bank deposit,
> accounting for processing fees, settlement delays, and batch groupings.**

Target: **≥50% automatic match rate**, with detailed reasons for unmatched items
to enable quick manual resolution.

---

## 2. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     RECONCILIATION FLOW                         │
│                                                                 │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │  OpenDental   │         │  Odoo ERP /   │                    │
│  │  (Payments)   │         │  Bank Files   │                    │
│  └──────┬───────┘         └──────┬───────┘                     │
│         │                         │                             │
│         ▼                         ▼                             │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │ fetchODPay-   │         │ fetchBankRows │                    │
│  │ ments()       │         │ ForMode()     │                    │
│  └──────┬───────┘         └──────┬───────┘                     │
│         │                         │                             │
│         │  filterPayments-        │  BANK_ROW_FILTER_           │
│         │  ByMode()               │  KEYWORDS{}                 │
│         │                         │                             │
│         ▼                         ▼                             │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │ OpenDental    │         │ Bank          │                    │
│  │ PaymentRows[] │         │ StatementRows │                    │
│  │               │         │ []            │                    │
│  └──────┬───────┘         └──────┬───────┘                     │
│         │                         │                             │
│         └──────────┬──────────────┘                             │
│                    ▼                                            │
│         ┌──────────────────┐                                    │
│         │  MATCHING ENGINE  │                                   │
│         │  (9-Pass Strategy)│                                   │
│         └────────┬─────────┘                                    │
│                  ▼                                              │
│         ┌──────────────────┐                                    │
│         │ ReconciliationRow │                                   │
│         │ results[]         │                                   │
│         └────────┬─────────┘                                    │
│                  ▼                                              │
│         ┌──────────────────┐                                    │
│         │  DynamoDB         │                                   │
│         │  (Persist)        │                                   │
│         └──────────────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer         | Technology              | Purpose                           |
|---------------|-------------------------|-----------------------------------|
| Frontend      | React + Jotai + TanStack| BRS UI with payment mode selector |
| API Gateway   | AWS API Gateway         | REST endpoints                    |
| Backend       | AWS Lambda (Node.js/TS) | Business logic + matching         |
| Practice Mgmt | OpenDental API          | Payment records (source of truth) |
| Accounting    | Odoo ERP (XML-RPC)      | Bank statement lines              |
| Storage       | DynamoDB                | Reports, reconciliations, configs |
| File Storage  | S3                      | Uploaded bank statement files     |

---

## 3. Data Sources

### 3.1 OpenDental (OD) — "Book Side"

OpenDental is the practice management software where front-desk staff records
every patient payment. A payment record contains:

| Field       | Description                              | Example                           |
|-------------|------------------------------------------|-----------------------------------|
| `PayNum`    | Unique payment ID (auto-generated)       | `98234`                           |
| `PatNum`    | Patient number                           | `5012`                            |
| `PayDate`   | Date payment was received                | `2026-01-15`                      |
| `PayAmt`    | Payment amount ($)                       | `350.00`                          |
| `PayType`   | Payment type ID (clinic-configured)      | `69` (mapped to "Credit Card")    |
| `PayNote`   | Free-text note (staff enters gateway ref)| `Trans ID: TXN-887234`            |
| `CheckNum`  | Cheque number (for cheque payments)      | `10542`                           |

**How we query**: `GET /payments?DateEntry={startDate}` from OpenDental FHIR API

### 3.2 Odoo ERP — "Bank Side"

Odoo contains the actual bank statement lines imported from the bank feed or
manually entered by the accounting team.

| Field         | Description                    | Example                         |
|---------------|--------------------------------|---------------------------------|
| `id`          | Odoo record ID                 | `4521`                          |
| `date`        | Transaction date               | `2026-01-16`                    |
| `payment_ref` | Payment reference              | `MERCHANT DEPOSIT`              |
| `ref`         | General reference              | `BATCH-20260115`                |
| `name`        | Statement line label           | `POS SETTLEMENT - DDA DEPOSIT`  |
| `narration`   | Additional notes/memo          | `PayConnect daily batch`        |
| `amount`      | Transaction amount (+credit)   | `3247.50`                       |

**How we query**: Odoo XML-RPC `search_read` on `account.bank.statement.line`

### 3.3 Third-Party APIs — Gateway-Specific

| Gateway      | API Source         | Data Returned                    |
|--------------|--------------------|----------------------------------|
| Cherry       | Cherry REST API    | Transaction ID, amount, date     |
| Sunbit       | (Future) Sunbit API| Financing amount, settlement date|
| CareCredit   | (Future) Synchrony | Merchant discount, settlement    |

---

## 4. Payment Modes & Gateway Flow

### How Money Flows from Patient to Bank

Each payment mode has a distinct path from patient's payment to the clinic's bank account:

```
CREDIT CARD FLOW:
Patient pays $100 → Card Terminal → Payment Processor (2.9% fee)
→ Batch Settlement ($97.10) → Bank Deposit (1-3 days later)

CHERRY / SUNBIT FLOW:
Patient finances $2000 → Financing Company (8-15% merchant discount)
→ Clinic receives $1700-$1840 → Bank Deposit (3-7 days later)

EFT / ACH FLOW:
Insurance pays $500 → Wire Transfer (UTR# generated)
→ Bank Deposit (1-3 business days) → Amount matches exactly

CHEQUE FLOW:
Patient writes cheque #10542 for $200 → Clinic deposits
→ Bank clears cheque (3-7 business days) → Amount matches exactly
```

### Payment Mode Matrix

| Mode           | Fee Type          | Fee Range    | Settlement    | Reference Source     | Batch? |
|----------------|-------------------|-------------|---------------|----------------------|--------|
| CREDIT_CARD    | % + flat          | 1.5-3.5% + $0.10-0.30 | 1-3 days | PayNote (Trans ID)   | ✅ Yes |
| PAYCONNECT     | % + flat          | 2.5-3.5% + $0.20-0.30 | 1-3 days | PayNote (Trans ID)   | ✅ Yes |
| AUTHORIZE_NET  | % + flat          | 2.5-3.5% + $0.25-0.35 | 1-3 days | PayNote (Trans ID)   | ✅ Yes |
| CHERRY         | Merchant discount | 6-12%       | 3-7 days      | PayNote (Cherry ref) | ❌ No  |
| SUNBIT         | Merchant discount | 8-15%       | 3-5 days      | PayNote (Sunbit ref) | ❌ No  |
| CARE_CREDIT    | Merchant discount | 5-14%       | 3-5 days      | PayNote (CC ref)     | ❌ No  |
| EFT            | None              | 0%          | 1-3 days      | PayNote (UTR#)       | ❌ No  |
| ACH            | None / minimal    | 0%          | 1-3 days      | PayNote (Trace#)     | ❌ No  |
| CHEQUE         | None              | 0%          | 3-7 days      | CheckNum field       | ❌ No  |

---

## 5. Matching Engine — Multi-Pass Strategy

The matching engine uses a **9-pass progressive relaxation** strategy. Higher passes
are less strict but still produce useful matches:

### Pass Execution Order

```
PASS 1   ← Highest confidence (exact ref + exact amount)
PASS 1b  ← Partial/secondary key + exact amount
PASS 1c  ← Reference found inside bank description
PASS 2   ← Amount + Date match (gross OR net after fees)
PASS 2b  ← Reference + Net amount (fee-adjusted)
PASS 2c  ← BATCH SETTLEMENT (groups of OD → single bank deposit)
PASS 3   ← Amount-only match (no date, no reference)
PASS 3b  ← Net-amount-only match (fee-adjusted, no ref/date)
PASS 4   ← Unmatched OD rows (with diagnostic reasons)
PASS 5   ← Unmatched bank rows (with diagnostic reasons)
```

### Pass Details

#### PASS 1: Exact Reference + Amount Match
**Confidence: ★★★★★ (Highest)**
**Status: MATCHED**

Compares the normalized reference key from OpenDental with bank reference.
Both amounts must match within $0.01 tolerance.

```
Example:
  OD:   PayNote="Trans ID: TXN-887234"  →  Key: "TXN887234"
  Bank: ref="TXN-887234 SETTLEMENT"     →  Key: "TXN887234"
  Amount: $350.00 ↔ $350.00  →  ✅ MATCH
```

#### PASS 1b: Secondary Key + Amount Match
**Confidence: ★★★★ (High)**
**Status: MATCHED**

Uses partial/secondary matching keys (e.g., last 4-6 digits of a reference).
Useful when banks truncate references.

```
Example:
  OD:   PayNote="UTR: NEFT2026011587234678"  →  SecKey: "234678"
  Bank: ref="87234678"                        →  SecKey: "234678"
  Amount: $500.00 ↔ $500.00  →  ✅ MATCH
```

#### PASS 1c: Reference in Description Match
**Confidence: ★★★★ (High)**
**Status: MATCHED**

Searches for the OD reference within the full bank description text
(which includes payment_ref, ref, name, and narration combined).

#### PASS 2: Amount + Date Match (Gross or Net)
**Confidence: ★★★ (Medium)**
**Status: MATCHED**

When no reference matches, tries matching by amount and date proximity.
For gateways with processing fees, also tries net-amount matching:

```
Example (Gross):
  OD:   $200.00 on 2026-01-15
  Bank: $200.00 on 2026-01-16 (within 3-day tolerance)
  →  ✅ MATCH (amount + date)

Example (Net — after 2.9% + $0.30 fee):
  OD:   $200.00 on 2026-01-15
  Bank: $193.90 on 2026-01-16
  Expected net: $200 × (1 - 0.029) - $0.30 = $193.90
  →  ✅ MATCH (net amount + date, fee: $6.10 / 3.05%)
```

#### PASS 2b: Reference + Net Amount Match
**Confidence: ★★★ (Medium)**
**Status: MATCHED**

Same as Pass 1 but with fee-adjusted amounts. For gateways that deduct
processing fees before depositing.

#### PASS 2c: Batch Settlement Match ⭐ (Key for Card Payments)
**Confidence: ★★★ (Medium)**
**Status: MATCHED**

**This is the most important pass for credit card reconciliation.**

Card processors batch multiple individual card payments into a single
daily deposit. The engine:

1. Takes each unmatched bank deposit (largest first)
2. Finds all unmatched OD payments within a 3-day date window
3. Tries multiple accumulation strategies:
   - **(a)** Sum ALL candidates → does it match? (gross)
   - **(b)** Sum ALL candidates → after fees → does it match? (net)
   - **(c)** Greedy accumulation: add payments one by one (sorted by
     date proximity) until the running sum matches the bank deposit
   - **(d)** Greedy net accumulation: same but with fee deduction

```
Example:
  OD payments on Jan 15:
    $150.00 (Patient A)
    $300.00 (Patient B)
    $275.00 (Patient C)
    $125.00 (Patient D)
    Total: $850.00

  Bank deposit on Jan 16:
    $825.25 (MERCHANT DEPOSIT)

  Expected net at 2.9% fee: $850 × 0.971 = $825.35
  Actual: $825.25 (within tolerance)
  →  ✅ BATCH MATCH (4 payments, fee: $24.75 / 2.91%)
```

#### PASS 3: Amount-Only Match
**Confidence: ★★ (Low)**
**Status: PARTIAL**

Matches by amount alone — no reference or date constraint.
Marked as PARTIAL because it needs manual verification.

#### PASS 3b: Net-Amount-Only Match
**Confidence: ★★ (Low)**
**Status: PARTIAL**

Same as Pass 3 but checks if the bank amount could be the OD amount
minus processing fees. Also marked PARTIAL.

#### PASS 4: Unmatched OD Rows
**Status: UNMATCHED**

All remaining OpenDental payments that couldn't be matched.
Each row includes a diagnostic reason explaining why:
- "No remaining bank transactions to match against"
- "Key not found in bank data. Closest: $XXX, diff: $YY"
- "No reference found in OpenDental payment"

#### PASS 5: Unmatched Bank Rows
**Status: UNMATCHED**

All remaining bank deposits that couldn't be matched to any OD payment.
These may represent:
- Payments from a different module
- Insurance deposits not yet entered in OD
- Bank fees or interest
- Deposits from another clinic

---

## 6. Processing Fees & Net Amount Matching

### Why Net Amount Matching?

When a patient pays $100 via credit card, the clinic doesn't receive $100.
The payment processor deducts a fee:

```
Patient pays:          $100.00 (recorded in OpenDental)
Processor fee (2.9%):  -  $2.90
Per-transaction fee:   -  $0.30
────────────────────────────────
Bank deposit:          $ 96.80 (appears in bank statement)
```

Without net-amount matching, the engine would mark this as **UNMATCHED**
because $100.00 ≠ $96.80.

### Fee Rate Configuration by Gateway

Each payment mode strategy defines its fee structure:

```typescript
// Credit Card
hasProcessingFees(): true
getFeeRateRange(): { min: 0.015, max: 0.035 }    // 1.5% - 3.5%
getFlatFeeRange(): { min: 0.10, max: 0.30 }       // $0.10 - $0.30

// Cherry (Financing)
hasProcessingFees(): true
getFeeRateRange(): { min: 0.06, max: 0.12 }       // 6% - 12%
getFlatFeeRange(): { min: 0, max: 0 }              // No flat fee

// EFT (Wire Transfer)
hasProcessingFees(): false                          // No fees
```

### Net Amount Matching Algorithm

```
Input: grossExpected, bankReceived, feeRateMin, feeRateMax, flatFeeMin, flatFeeMax

actualFee = grossExpected - bankReceived
feePercent = (actualFee / grossExpected) × 100

minExpectedFee = (grossExpected × feeRateMin) + flatFeeMin
maxExpectedFee = (grossExpected × feeRateMax) + flatFeeMax

If actualFee is within [minExpectedFee, maxExpectedFee] (±1% tolerance):
  → MATCH (fee deduction is within expected range)
Else:
  → NO MATCH
```

---

## 7. Batch Settlement Matching

### What is Batch Settlement?

Credit card processors don't send individual deposits for each card swipe.
Instead, they:

1. **Collect** all card transactions throughout the day
2. **Calculate** the total minus processing fees
3. **Deposit** a single lump sum into the clinic's bank account
4. This deposit appears 1-3 business days after the transaction date

### How Our System Handles Batch Settlements

```
STEP 1: Identify candidate bank deposits
  - Sort unmatched bank rows by amount (largest first)
  - Larger deposits are more likely to be batch settlements

STEP 2: For each bank deposit, find candidate OD payments
  - Filter unmatched OD payments within batch date window (3 days)
  - These are payments that could have been part of this batch

STEP 3: Try matching strategies (in order)
  a) ALL candidates gross sum → bank amount?
  b) ALL candidates net sum (after fees) → bank amount?
  c) Greedy accumulation: add OD payments (closest date first)
     until running sum matches bank amount
  d) Greedy net accumulation: same, but with fee adjustment

STEP 4: If match found
  - Mark ALL accumulated OD payments as MATCHED
  - Mark the bank deposit as MATCHED
  - Record batch details (# of payments, date range, patients)
```

### Batch Date Window

| Gateway        | Window | Reason                                    |
|----------------|--------|-------------------------------------------|
| Credit Card    | 3 days | Same-day + 1-3 day settlement delay       |
| PayConnect     | 3 days | Same-day + 1-3 day settlement delay       |
| Authorize.Net  | 3 days | Same-day + 1-3 day settlement delay       |

---

## 8. Payment Mode–Specific Strategies

### Strategy Pattern

Each payment mode has a dedicated matching strategy class that extends
`BaseMatchingStrategy`. The strategy defines:

```typescript
class XxxMatchingStrategy extends BaseMatchingStrategy {
  // How to extract the matching key from OD payment
  getODMatchingKey(row): string

  // How to extract the matching key from bank row
  getBankMatchingKey(row): string

  // Partial/fallback key extraction
  getODSecondaryKey(row): string
  getBankSecondaryKey(row): string

  // Date tolerance for amount+date matching
  getDateToleranceDays(): number

  // Fee structure
  hasProcessingFees(): boolean
  getFeeRateRange(): { min, max }
  getFlatFeeRange(): { min, max }

  // Batch settlement support
  supportsBatchSettlement(): boolean
  getBatchDateWindowDays(): number
}
```

### Strategy Comparison Matrix

| Strategy       | OD Key Source          | Bank Key Source     | Date Tol. | Fees? | Batch? |
|----------------|------------------------|---------------------|-----------|-------|--------|
| EFT            | UTR from PayNote       | UTR from ref/desc   | 5 days    | ❌     | ❌     |
| ACH            | Trace from PayNote     | Trace from ref/desc | 3 days    | ❌     | ❌     |
| Cheque         | CheckNum field         | Cheque# from ref    | 7 days    | ❌     | ❌     |
| Credit Card    | Trans ID from PayNote  | Trans ID from ref   | 3 days    | ✅     | ✅     |
| PayConnect     | Trans ID from PayNote  | Trans ID from ref   | 3 days    | ✅     | ✅     |
| Authorize.Net  | Trans ID from PayNote  | Trans ID from ref   | 3 days    | ✅     | ✅     |
| Cherry         | Cherry ref from PayNote| Cherry txn ID       | 5 days    | ✅     | ❌     |
| Sunbit         | Sunbit ref from PayNote| Sunbit ref          | 5 days    | ✅     | ❌     |
| CareCredit     | CC ref from PayNote    | Synchrony ref       | 5 days    | ✅     | ❌     |

---

## 9. Reconciliation Status Lifecycle

```
                    ┌──────────┐
                    │  DRAFT   │  ← Auto-generated by matching engine
                    └────┬─────┘
                         │
                    Manual review
                         │
                    ┌────▼─────┐
                    │ APPROVED │  ← Manager/admin approves
                    └──────────┘
```

### Row-Level Statuses

| Status      | Emoji | Meaning                                 | Action Required         |
|-------------|-------|-----------------------------------------|-------------------------|
| `MATCHED`   | ✅     | Confidently matched (Pass 1-2c)         | None — auto-verified    |
| `PARTIAL`   | ⚠️     | Likely match but needs verification     | Manual review required  |
| `UNMATCHED` | ❌     | No match found                          | Investigate & resolve   |

---

## 10. Keyword Filtering System

### Why Keywords?

When fetching bank transactions from Odoo, we get ALL transactions for the clinic
(rent, payroll, supplies, patient payments, everything). We need to filter so that:

- **Credit Card reconciliation** only sees card-related deposits
- **Cherry reconciliation** only sees Cherry deposits
- **EFT reconciliation** only sees wire transfers

### Bank Row Filter Keywords

Used to filter Odoo bank statement lines before matching:

| Mode           | Keywords Searched in bank ref/name/narration                                    |
|----------------|---------------------------------------------------------------------------------|
| CREDIT_CARD    | visa, mastercard, amex, discover, card, merchant, merchant deposit, pos,        |
|                | settlement, batch, dda deposit, card services, worldpay, fiserv, elavon,       |
|                | first data, global payments, heartland, square, stripe, clover                  |
| PAYCONNECT     | payconnect, pay connect, dentalxchange, merchant, settlement, batch, dda deposit|
| AUTHORIZE_NET  | authorize, auth.net, authorizenet, merchant, settlement, batch, dda deposit     |
| EFT            | wire, neft, rtgs, imps, transfer, eft, utr                                     |
| ACH            | ach, direct deposit, zelle, clearing house, autopay, nacha                      |
| CHEQUE         | check, cheque, chq, chk, money order, cashier                                  |
| CHERRY         | cherry, cherry payment, cherry financial                                        |
| SUNBIT         | sunbit, sunbit payment                                                          |
| CARE_CREDIT    | carecredit, care credit, synchrony, synchrony bank                              |

### OpenDental PayNote Keywords

Used as fallback when PayType matching fails — searches the PayNote field:

| Mode           | Keywords in PayNote                                |
|----------------|----------------------------------------------------|
| CHERRY         | cherry                                             |
| SUNBIT         | sunbit                                             |
| CARE_CREDIT    | carecredit, care credit, synchrony                 |
| EFT            | eft, wire, transfer, neft, rtgs, utr               |
| ACH            | ach, direct deposit, zelle, clearing house          |

### Fallback Strategy

```
1. Filter by keywords → Found matches? → Use filtered rows
2. No matches + Card mode? → Use ALL credit (positive) transactions
3. No matches + Non-card mode? → Return 0 rows (don't pollute)
```

---

## 11. API Reference

### Endpoints

| Method | Path                                          | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/brs/opendental-payments`                    | Fetch OD payments for date range     |
| GET    | `/brs/odoo-bank-transactions`                 | Fetch Odoo bank lines for date range |
| POST   | `/brs/reconciliation`                         | Generate new reconciliation          |
| GET    | `/brs/reconciliation/{id}`                    | Get reconciliation by ID             |
| POST   | `/brs/reconciliation/{id}/approve`            | Approve a reconciliation             |
| POST   | `/brs/bank-statements/upload-url`             | Get presigned URL for bank file      |
| GET    | `/brs/bank-statements`                        | List bank statement files            |
| GET    | `/brs/column-config`                          | Get column display configuration     |
| PUT    | `/brs/column-config`                          | Update column display configuration  |
| GET    | `/brs/payment-modes`                          | List available payment modes         |
| GET    | `/brs/cherry/transactions`                    | Fetch Cherry API transactions        |

### Generate Reconciliation Request

```json
POST /brs/reconciliation
{
  "clinicId": "clinic-abc123",
  "paymentMode": "CREDIT_CARD",
  "dateStart": "2026-01-01",
  "dateEnd": "2026-01-31",
  "bankStatementId": "optional-uploaded-file-id"
}
```

### Reconciliation Response

```json
{
  "reconciliation": {
    "reconciliationId": "uuid",
    "clinicId": "clinic-abc123",
    "paymentMode": "CREDIT_CARD",
    "status": "DRAFT",
    "dateStart": "2026-01-01",
    "dateEnd": "2026-01-31",
    "rows": [
      {
        "rowId": "match-uuid",
        "referenceId": "TXN-887234",
        "expectedAmount": 350.00,
        "receivedAmount": 339.85,
        "status": "MATCHED",
        "difference": -10.15,
        "reason": "✅ Net-amount match: OD $350.00 → Bank $339.85. Fee: $10.15 (2.9%).",
        "openDentalRowId": "od-98234",
        "bankRowId": "odoo-4521",
        "patientName": "Smith, John"
      },
      {
        "rowId": "batch-uuid",
        "referenceId": "BATCH-2026-01-15 (12 txns)",
        "expectedAmount": 4250.00,
        "receivedAmount": 4126.75,
        "status": "MATCHED",
        "difference": -123.25,
        "reason": "✅ Batch settlement (net): 12 OD payments totaling $4,250.00 → Net: $4,126.75. Fees: $123.25 (2.9%).",
        "openDentalRowId": "od-001,od-002,...,od-012",
        "bankRowId": "odoo-4522",
        "patientName": "Batch (12 patients)"
      }
    ],
    "createdAt": "2026-01-31T10:30:00Z"
  }
}
```

---

## 12. Troubleshooting Low Match Rates

### Common Causes & Solutions

| Symptom                                | Cause                                           | Solution                                                               |
|----------------------------------------|-------------------------------------------------|------------------------------------------------------------------------|
| 0% match rate                          | No bank transactions fetched from Odoo          | Check `odooCompanyId` in clinic config                                 |
| Very low match (< 10%)                 | Bank keyword filter too restrictive              | Check Odoo descriptions; add new keywords to `BANK_ROW_FILTER_KEYWORDS`|
| Many "Amount-only partial" matches     | No reference in OD PayNote                       | Train staff to enter transaction IDs in PayNote                        |
| Batch not matching                     | Date window too narrow                           | Increase `getBatchDateWindowDays()` in strategy class                  |
| Net amount not matching                | Fee range too narrow                             | Adjust `getFeeRateRange()` based on actual processor agreement         |
| All OD payments UNMATCHED, bank empty  | Wrong payment mode selected                      | Verify PayType IDs match the selected mode                             |
| Duplicated bank rows across modes      | Multiple modes share same bank keyword           | Refine keywords to be more specific                                    |

### Diagnostic Logging

The system logs detailed information at each step:

```
[Reconciliation] Fetching OpenDental payments for clinic-abc, mode=CREDIT_CARD, range=2026-01-01 to 2026-01-31
[Accounting] OpenDental returned 142 total payments since 2026-01-01
[Accounting] 128 payments within date range
[Accounting] After PayType filter: 95 payments match CREDIT_CARD
[Reconciliation][CREDIT_CARD] Got 230 Odoo bank transactions
[Reconciliation][CREDIT_CARD] After keyword filtering: 22/230 transactions
[Reconciliation] Running CREDIT_CARD matching: 95 OD rows vs 22 bank rows
[Reconciliation] Matching complete: 117 result rows
```

### OpenDental PayNote Best Practices

Front-desk staff should enter gateway references in PayNote for best matching:

| Payment Mode | What to Enter in PayNote                     |
|--------------|----------------------------------------------|
| Credit Card  | Transaction/Auth ID from terminal receipt    |
| PayConnect   | PayConnect auto-fills this (Trans ID: XXX)   |
| EFT          | UTR number (e.g., "UTR: NEFT2026011587234") |
| ACH          | ACH trace number or confirmation code        |
| Cherry       | Cherry transaction ID (e.g., "CHERRY-12345") |
| Sunbit       | Sunbit reference number                      |
| Cheque       | Use CheckNum field (not PayNote)             |

---

## Files Reference

| File                                          | Purpose                                    |
|-----------------------------------------------|-------------------------------------------|
| `src/services/accounting/index.ts`            | Main handler, data fetching, filtering    |
| `src/services/accounting/matching/index.ts`   | Matching engine, all strategy classes     |
| `src/services/accounting/types.ts`            | TypeScript type definitions               |
| `src/services/accounting/utils/`              | Utility functions (Odoo client, etc.)     |
| `src/infrastructure/stacks/accounting-stack.ts`| CDK stack definition                      |

---

*Document generated: February 2026*
*System version: BRS v2.0 (Multi-pass matching with batch settlement)*
