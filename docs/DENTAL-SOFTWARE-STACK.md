# Dental Software Stack

## Overview

The Dental Software Stack provides a complete backend infrastructure for managing clinic data using:

- **Amazon RDS MySQL**: Relational database for storing clinic information
- **Amazon S3**: Object storage for clinic-related files and documents
- **AWS Lambda**: Serverless functions for CRUD operations
- **Amazon VPC**: Private network for secure database access
- **API Gateway**: RESTful API with custom domain and JWT authentication

## Architecture

### Components

1. **VPC Configuration**
   - 2 Availability Zones for high availability
   - Public, Private, and Isolated subnets
   - NAT Gateway for Lambda internet access
   - Security groups for Lambda and RDS

2. **RDS MySQL Database**
   - MySQL 8.0.35
   - Instance: db.t3.micro (upgrade for production)
   - 20GB storage with auto-scaling up to 100GB
   - 7-day automated backups
   - Encryption at rest
   - Private subnet deployment

3. **S3 Bucket**
   - Versioning enabled
   - Encryption at rest (S3-managed)
   - Public access blocked
   - 90-day lifecycle for old versions
   - CORS configured for web access

4. **Lambda Functions**
   - GET /clinics - List all clinics
   - GET /clinics/{id} - Get specific clinic
   - POST /clinics - Create new clinic
   - PUT /clinics/{id} - Update clinic
   - DELETE /clinics/{id} - Delete clinic

## Clinic Schema

The clinic table stores the following information:

| Field | Type | Description |
|-------|------|-------------|
| ClinicNum | bigint(20) | Primary key (auto-increment) |
| Description | varchar(255) | Required clinic name/description |
| Address | varchar(255) | First line of address |
| Address2 | varchar(255) | Second line of address |
| City | varchar(255) | City |
| State | varchar(255) | 2-character state code (US) |
| Zip | varchar(255) | Zip code |
| Phone | varchar(255) | 10 digits, no punctuation |
| BankNumber | varchar(255) | Account number for deposits |

## Deployment

### Prerequisites

1. Install dependencies for MySQL layer:

```powershell
cd src\shared\layers\mysql-layer
npm install
cd ..\..\..\..
```

2. Ensure JWT_SECRET environment variable is set
3. Ensure AWS credentials are configured

### Deploy the Stack

```powershell
npm run deploy TodaysDentalInsightsDentalSoftwareN1
```

Or deploy all stacks:

```powershell
npm run deploy --all
```

## API Endpoints

Base URL: `https://apig.todaysdentalinsights.com/dental-software`

All endpoints require JWT authentication via `Authorization` header.

### List All Clinics

```
GET /clinics
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ClinicNum": 1,
      "Description": "Main Street Dental",
      "Address": "123 Main St",
      "City": "Springfield",
      "State": "IL",
      "Zip": "62701",
      "Phone": "2175551234",
      "BankNumber": "ACC123456"
    }
  ]
}
```

### Get Specific Clinic

```
GET /clinics/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ClinicNum": 1,
    "Description": "Main Street Dental",
    "Address": "123 Main St",
    "City": "Springfield",
    "State": "IL",
    "Zip": "62701",
    "Phone": "2175551234",
    "BankNumber": "ACC123456"
  }
}
```

### Create Clinic

```
POST /clinics
Content-Type: application/json

{
  "Description": "Downtown Dental",
  "Address": "456 Oak Ave",
  "City": "Chicago",
  "State": "IL",
  "Zip": "60601",
  "Phone": "3125559876",
  "BankNumber": "ACC789012"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Clinic created successfully",
  "data": {
    "ClinicNum": 2,
    "Description": "Downtown Dental",
    ...
  }
}
```

### Update Clinic

```
PUT /clinics/{id}
Content-Type: application/json

{
  "Phone": "3125551111",
  "BankNumber": "ACC999999"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Clinic updated successfully",
  "data": {
    "ClinicNum": 2,
    "Description": "Downtown Dental",
    "Phone": "3125551111",
    "BankNumber": "ACC999999",
    ...
  }
}
```

### Delete Clinic

```
DELETE /clinics/{id}
```

**Response:**
```json
{
  "success": true,
  "message": "Clinic deleted successfully"
}
```

## Database Initialization

The clinic table will be automatically created on first Lambda invocation. Alternatively, you can manually initialize it:

```sql
CREATE TABLE IF NOT EXISTS clinic (
  ClinicNum BIGINT(20) AUTO_INCREMENT PRIMARY KEY,
  Description VARCHAR(255) NOT NULL,
  Address VARCHAR(255),
  Address2 VARCHAR(255),
  City VARCHAR(255),
  State VARCHAR(255),
  Zip VARCHAR(255),
  Phone VARCHAR(255),
  BankNumber VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_description (Description),
  INDEX idx_city (City),
  INDEX idx_state (State)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Security

- **Database Credentials**: Stored in AWS Secrets Manager
- **Network Isolation**: RDS in isolated subnet, Lambda in private subnet
- **Authentication**: JWT-based via custom Lambda authorizer
- **Encryption**: Database and S3 encryption at rest
- **HTTPS**: All API calls over TLS 1.2+

## Environment Variables

Lambda functions use the following environment variables (automatically configured):

- `DB_HOST`: RDS endpoint address
- `DB_PORT`: RDS port (3306)
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name (dental_software)
- `CLINIC_BUCKET`: S3 bucket name
- `CORS_ORIGIN`: Allowed CORS origin

## Monitoring

- CloudWatch Logs for all Lambda functions
- API Gateway metrics and logging enabled
- RDS CloudWatch metrics for database performance

## Cost Optimization

Current configuration uses:
- Single NAT Gateway
- db.t3.micro instance
- Single AZ deployment

For production:
- Consider Multi-AZ for RDS
- Upgrade instance type based on load
- Monitor and adjust Lambda memory/timeout

## Troubleshooting

### Lambda can't connect to RDS

1. Check security group rules allow Lambda → RDS on port 3306
2. Verify Lambda is in correct subnets (PRIVATE_WITH_EGRESS)
3. Check VPC endpoint configuration for Secrets Manager

### Database credentials error

1. Verify secret exists in Secrets Manager
2. Check Lambda has permissions to read secret
3. Verify secret JSON format matches expected structure

### CORS errors

1. Ensure origin is in allowed origins list
2. Check API Gateway CORS configuration
3. Verify preflight OPTIONS requests are working

## Future Enhancements

- [ ] Database migration scripts
- [ ] Automated database backup to S3
- [ ] Read replicas for scaling
- [ ] Connection pooling for Lambda
- [ ] GraphQL API option
- [ ] Audit logging to S3
- [ ] Data encryption at field level

