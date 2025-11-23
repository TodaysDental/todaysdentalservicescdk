# AWS Transcribe S3 Access Fix

## Problem
AWS Transcribe was failing with the error:
```
BadRequestException: The specified S3 bucket can't be accessed. Make sure you have write permission on the bucket and try your request again.
```

This occurred when the recording processor Lambda tried to start transcription jobs for call recordings.

## Root Cause
The issue had multiple contributing factors:

1. **Insufficient Lambda Permissions**: The recording processor Lambda only had READ access to the S3 bucket, but AWS Transcribe needs the Lambda to have WRITE permissions to validate that the output location is accessible.

2. **Missing KMS Grant Permission**: The KMS key policy didn't include the `kms:CreateGrant` action, which AWS Transcribe needs to create grants for encryption operations.

3. **Overly Broad Bucket Policies**: The S3 bucket policies for Transcribe were too broad (allowing access to all objects) and lacked proper security conditions, which could cause AWS to reject them during validation.

## Solution
Made the following changes to `src/infrastructure/stacks/chime-stack.ts`:

### 1. Upgraded Lambda S3 Permissions (Line ~1421)
**Before:**
```typescript
recordingsBucket.grantRead(recordingProcessorFn);
recordingsKey.grantDecrypt(recordingProcessorFn);
```

**After:**
```typescript
recordingsBucket.grantReadWrite(recordingProcessorFn);
recordingsKey.grantEncryptDecrypt(recordingProcessorFn);
```

### 2. Added Explicit S3 Policy for Lambda (Line ~1435)
Added explicit IAM policy to Lambda role ensuring it can:
- Read recordings from S3
- Write transcription outputs to S3
- List bucket contents
- Get bucket location (required by Transcribe for validation)

```typescript
recordingProcessorFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    's3:PutObject',
    's3:PutObjectAcl',
    's3:GetObject',
    's3:GetBucketLocation',
    's3:ListBucket'
  ],
  resources: [
    recordingsBucket.bucketArn,
    recordingsBucket.arnForObjects('*')
  ]
}));
```

### 3. Split Transcribe Bucket Policies (Line ~1358)
Separated broad bucket policy into specific policies with proper security conditions:

- **Bucket-level access**: List and get location
- **Read recordings**: Access to `recordings/*` only
- **Write transcriptions**: Access to `transcriptions/*` only

All policies now include:
```typescript
conditions: {
  StringEquals: {
    'aws:SourceAccount': this.account
  }
}
```

### 4. Enhanced KMS Key Policy (Line ~1288)
Added:
- `kms:CreateGrant` action (required by Transcribe)
- ViaService condition to restrict key usage
- CallerAccount condition for security

```typescript
conditions: {
  StringEquals: {
    'kms:ViaService': [
      `s3.${this.region}.amazonaws.com`,
      `transcribe.${this.region}.amazonaws.com`
    ],
    'kms:CallerAccount': this.account
  }
}
```

## Security Improvements
- Added proper AWS account conditions to prevent confused deputy attacks
- Restricted Transcribe S3 access to specific prefixes (recordings/* and transcriptions/*)
- Added KMS ViaService conditions to ensure key is only used through S3/Transcribe services
- Maintained least-privilege access patterns

## Deployment
To apply these fixes:

```bash
npm run build
cdk deploy TodaysDentalInsightsChimeV23Stack
```

## Testing
After deployment, test by:
1. Making a test call that gets recorded
2. Checking CloudWatch Logs for the RecordingProcessor Lambda
3. Verifying transcription job starts successfully in AWS Transcribe console
4. Confirming transcription output appears in S3 under `transcriptions/` prefix

## Related Files Modified
- `src/infrastructure/stacks/chime-stack.ts`

## AWS Services Involved
- AWS Lambda (Recording Processor)
- Amazon S3 (Call Recordings Bucket)
- AWS Transcribe (Speech-to-Text)
- AWS KMS (Encryption)
- AWS IAM (Permissions)

