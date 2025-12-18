# Lease Management API Documentation

## Overview
The Lease Management API provides comprehensive CRUD operations for managing dental clinic leases across 28 clinics. The system uses a flexible, schema-less approach with DynamoDB to accommodate varying lease structures and hidden charges.

## Base URL
```
https://your-api-gateway-url/prod
```

## Authentication
All endpoints require proper authentication headers.

## Data Structure

### Key Pattern
- **Partition Key (PK):** `CLINIC#{practiceId}` (e.g., `CLINIC#TD-001`)
- **Sort Key (SK):** `LEASE#{year}-{id}` (e.g., `LEASE#2024-001`)

### Flexible Schema
The lease management system supports a flexible schema that allows for:
- Additional fields at any level
- Dynamic hidden charges
- Variable document, asset, and event arrays
- Extensible property information

## API Endpoints

### 1. Create Lease
**POST** `/leases`

Creates a new lease record for a clinic.

#### Request Body
```json
{
  "propertyInformation": {
    "clinicName": "TD Cayce",
    "practiceId": "TD-001",
    "propertyId": "PROP-CAY-001",
    "address": "1234 Knox Abbott Dr",
    "addressLine2": "Suite 100",
    "city": "Cayce",
    "state": "SC",
    "zip": "29033",
    "propertyType": "Commercial Retail",
    "landlord": "Knox Properties LLC",
    "propertyManager": "ABC Property Management",
    "parkingSpaces": "50+"
  },
  "financialDetails": {
    "currentRentInclCAM": 8500.00,
    "baseRent": 7000.00,
    "baseRentPerSqFt": 18.00,
    "camCharges": 1200.00,
    "securityDeposit": 17000.00,
    "depositRefundable": true
  },
  "leaseTerms": {
    "originalLeaseDate": "2018-01-15",
    "startDate": "2023-01-01",
    "endDate": "2028-12-31",
    "termLength": "5 years",
    "leaseType": "Net Lease",
    "status": "Active",
    "sqft": 3200
  },
  "documents": [
    {
      "type": "Lease Agreement",
      "description": "Signed original lease",
      "fileUrl": "s3://dental-leases/td-cayce/lease-signed.pdf"
    }
  ],
  "assets": [
    {
      "type": "Equipment",
      "name": "Dental Chair Model X",
      "vendor": "Dental Depot",
      "purchaseDate": "2023-02-15",
      "cost": 15000.00
    }
  ],
  "events": [
    {
      "type": "Renewal Discussion",
      "date": "2027-06-01",
      "time": "10:00",
      "reminder": "1 month before",
      "description": "Meeting with landlord to discuss renewal terms"
    }
  ],
  "hiddenCharges": {
    "signageFee": 100.00,
    "trashPickup": 45.00,
    "marketingFund": 250.00,
    "snowRemoval": 75.00
  }
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "PK": "CLINIC#TD-001",
    "SK": "LEASE#2024-abc12345",
    "entityType": "Lease",
    "createdAt": "2024-12-18T12:00:00Z",
    "updatedAt": "2024-12-18T12:00:00Z",
    // ... rest of lease data
  },
  "message": "Lease created successfully"
}
```

### 2. Get Lease
**GET** `/leases/{practiceId}/{leaseId}`

Retrieves a specific lease by practice ID and lease ID.

#### Path Parameters
- `practiceId`: The practice identifier (e.g., "TD-001")
- `leaseId`: The lease identifier (e.g., "2024-abc12345")

#### Response
```json
{
  "success": true,
  "data": {
    "PK": "CLINIC#TD-001",
    "SK": "LEASE#2024-abc12345",
    // ... complete lease data
  },
  "message": "Lease retrieved successfully"
}
```

### 3. Update Lease
**PUT** `/leases/{practiceId}/{leaseId}`

Updates an existing lease with partial data.

#### Request Body (Partial Update)
```json
{
  "financialDetails": {
    "baseRent": 7500.00,
    "camCharges": 1300.00
  },
  "leaseTerms": {
    "status": "Renewed"
  },
  "hiddenCharges": {
    "newCharge": 150.00
  }
}
```

#### Response
```json
{
  "success": true,
  "data": {
    // ... updated lease data
  },
  "message": "Lease updated successfully"
}
```

### 4. Delete Lease
**DELETE** `/leases/{practiceId}/{leaseId}`

Deletes a lease (supports both soft and hard delete).

#### Query Parameters
- `soft`: Set to "true" for soft delete (default: false)

#### Soft Delete Example
```
DELETE /leases/TD-001/2024-abc12345?soft=true
```

#### Response
```json
{
  "success": true,
  "message": "Lease deleted successfully"
}
```

### 5. List Leases
**GET** `/leases`

Retrieves a list of leases with optional filtering.

#### Query Parameters
- `practiceId`: Filter by specific practice ID
- `status`: Filter by lease status (Active, Expired, etc.)
- `limit`: Maximum number of results (default: 50)
- `lastEvaluatedKey`: For pagination
- `includeDeleted`: Include soft-deleted leases (default: false)

#### Examples
```
GET /leases?practiceId=TD-001
GET /leases?status=Active&limit=20
GET /leases?includeDeleted=true
```

#### Response
```json
{
  "success": true,
  "data": [
    {
      "PK": "CLINIC#TD-001",
      "SK": "LEASE#2024-abc12345",
      // ... lease data
    }
  ],
  "message": "Retrieved 5 leases",
  "hasMore": false,
  "lastEvaluatedKey": null
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error description",
  "message": "Detailed error message"
}
```

### Common HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `404`: Not Found
- `409`: Conflict (duplicate)
- `500`: Internal Server Error

## Data Validation

### Required Fields
- `propertyInformation.practiceId`: Must be provided
- `propertyInformation.clinicName`: Must be provided
- `propertyInformation.address`: Must be provided
- `propertyInformation.city`: Must be provided
- `propertyInformation.state`: Must be provided
- `propertyInformation.zip`: Must be provided
- `propertyInformation.landlord`: Must be provided
- `financialDetails.baseRent`: Must be provided
- `financialDetails.securityDeposit`: Must be provided
- `leaseTerms.startDate`: Must be provided
- `leaseTerms.endDate`: Must be provided
- `leaseTerms.status`: Must be provided

### Flexible Fields
The system supports additional fields at any level:
- Custom property information fields
- Additional financial details
- Extended lease terms
- Custom hidden charges
- Additional document/asset/event properties

## Auto-Generated Fields

The system automatically generates:
- `PK` and `SK` keys
- `entityType`: Always set to "Lease"
- `createdAt` and `updatedAt` timestamps
- `documentId`, `assetId`, `eventId` if not provided
- `uploadedAt` for documents if not provided

## Global Secondary Index (GSI)

### StatusIndex
- **Partition Key**: `status`
- **Sort Key**: `endDate`
- **Use Case**: Query leases by status and sort by end date

## Best Practices

1. **Flexible Schema**: Take advantage of the schema-less design to add custom fields as needed
2. **Pagination**: Use the `limit` and `lastEvaluatedKey` parameters for large result sets
3. **Soft Delete**: Use soft delete for audit trails and data recovery
4. **Status Management**: Keep lease status updated for accurate reporting
5. **Document Management**: Store file URLs in S3 and reference them in the documents array
6. **Hidden Charges**: Use the flexible hiddenCharges object for clinic-specific fees

## Example Use Cases

### Adding a New Clinic Lease
```bash
curl -X POST https://api-url/leases \
  -H "Content-Type: application/json" \
  -d @new-lease.json
```

### Updating Rent Information
```bash
curl -X PUT https://api-url/leases/TD-001/2024-abc12345 \
  -H "Content-Type: application/json" \
  -d '{"financialDetails": {"baseRent": 8000.00}}'
```

### Getting All Active Leases
```bash
curl "https://api-url/leases?status=Active"
```

### Soft Deleting a Lease
```bash
curl -X DELETE "https://api-url/leases/TD-001/2024-abc12345?soft=true"
```