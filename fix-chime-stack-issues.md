# CloudFormation Chime Stack Recovery Plan

## Current State
- Stack: `TodaysDentalInsightsChimeV3` is in **ROLLBACK_FAILED** state
- 19+ custom resources failed to delete during rollback
- V3 SIP Media Application exists but SIP rules creation failed

## Root Causes Identified

### 1. Duplicate Phone Numbers
16 clinics using the same phone number: `+18032129321`
This violates SIP rule uniqueness requirements.

### 2. Custom Resource Not Responding
`PopulateClinicsTable` Lambda doesn't send CloudFormation responses.

### 3. SIP Rule Creation Logic Issues
The `cdk-amazon-chime-resources` constructs lack proper error handling.

## Recovery Steps

### STEP 1: Manual Stack Cleanup
```bash
# 1. Delete the failed stack manually
aws cloudformation delete-stack --stack-name TodaysDentalInsightsChimeV3 --region us-east-1

# 2. If delete fails, send manual success signals to stuck resources
# (See detailed instructions below)
```

### STEP 2: Fix Code Issues

#### A. Fix PopulateClinicsTable Lambda
- Add CloudFormation response handling
- Use cfn-response module

#### B. Fix Duplicate Phone Numbers
- Assign unique phone numbers to each clinic
- Or implement phone number sharing logic

#### C. Add Error Handling to SIP Rules
- Wrap SIP rule creation in try-catch
- Add proper CloudFormation responses

### STEP 3: Deploy Fixed Version
```bash
cdk deploy --all --require-approval never
```

## Detailed Recovery Commands

### Manual Resource Cleanup (if needed)
```bash
# Check CloudWatch logs for stuck custom resources
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/TodaysDentalInsightsChimeV3"

# Send manual success signal to PopulateClinicsTable
# (Requires ResponseURL from CloudWatch logs)
curl -X PUT -H "Content-Type: application/json" \
  -d '{"Status": "SUCCESS", "PhysicalResourceId": "manual-cleanup", "StackId": "STACK_ID", "RequestId": "REQUEST_ID", "LogicalResourceId": "PopulateClinicsTable"}' \
  "RESPONSE_URL_FROM_LOGS"
```

## Prevention for Future Deployments

1. **Validate Phone Numbers**: Ensure uniqueness before deployment
2. **Test Custom Resources**: Always include CloudFormation response handling
3. **Gradual Rollout**: Deploy SIP rules in batches to identify conflicts early
4. **Monitoring**: Set up CloudWatch alarms for custom resource failures

## Emergency Contact
If manual cleanup fails, contact AWS Support with:
- Stack name: `TodaysDentalInsightsChimeV3`
- Region: `us-east-1`
- Error details from this analysis
