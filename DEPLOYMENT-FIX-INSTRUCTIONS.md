# Quick Deployment Fix Instructions

## 🚨 Your Issue

Your CloudFormation stack deployment failed with `ROLLBACK_FAILED` due to:
1. **VoiceConnectorOrigination** trying to reference a non-existent `SipMediaApplication.Endpoints[0].Hostname` field
2. **SIP Rule deletion failure** during rollback

## ✅ What Was Fixed

1. **Removed VoiceConnectorOrigination Resource** - This was incorrectly configured and not needed for your architecture
2. **Fixed SIP Rule Physical Resource IDs** - Now uses actual API response IDs for reliable deletion
3. **Added cleanup script** - Helps recover from ROLLBACK_FAILED state

## 🛠️ Step-by-Step Recovery

### Step 1: Clean Up the Stuck Stack

**Option A: Using the PowerShell Script (Recommended)**

```powershell
cd D:\zswaraj\todaysdentalinsightscdk

# Dry run first to see what will happen
.\scripts\cleanup-stuck-stack.ps1 -DryRun

# Execute the cleanup
.\scripts\cleanup-stuck-stack.ps1 -ForceDelete
```

**Option B: Manual Cleanup via AWS CLI**

```powershell
# List existing SIP Rules
aws chime-sdk-voice list-sip-rules --region us-east-1 --output json

# Delete each SIP Rule (replace RULE_ID with actual IDs from above)
aws chime-sdk-voice delete-sip-rule --sip-rule-id RULE_ID --region us-east-1

# Delete the stuck CloudFormation stack
aws cloudformation delete-stack --stack-name TodaysDentalInsightsChimeV9 --region us-east-1

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name TodaysDentalInsightsChimeV9 --region us-east-1
```

**Option C: AWS Console (If CLI doesn't work)**

1. Go to [AWS Console - Chime SDK Voice](https://console.aws.amazon.com/chime-sdk/home?region=us-east-1)
2. Manually delete all SIP Rules
3. Go to [CloudFormation Console](https://console.aws.amazon.com/cloudformation/home?region=us-east-1)
4. Select your stack `TodaysDentalInsightsChimeV9`
5. Click **Delete**
6. If it fails, click **Stack actions** → **Delete stack** → Check **"Retain resources"**
7. Manually delete any remaining Chime resources

### Step 2: Verify Cleanup

```powershell
# Verify stack is gone
aws cloudformation describe-stacks --stack-name TodaysDentalInsightsChimeV9 --region us-east-1
# Should return: "Stack with id TodaysDentalInsightsChimeV9 does not exist"

# Verify SIP Rules are gone
aws chime-sdk-voice list-sip-rules --region us-east-1
# Should return empty list
```

### Step 3: Synthesize the Updated Stack

```powershell
cd D:\zswaraj\todaysdentalinsightscdk

# Check for TypeScript/CDK errors
cdk synth TodaysDentalInsightsChimeV9
```

**If you see errors**, check that:
- `src/infrastructure/stacks/chime-stack.ts` has the VoiceConnectorOrigination resource removed (lines 224-276)
- SIP Rule physicalResourceIds are updated to use `fromResponse('SipRule.SipRuleId')`

### Step 4: Deploy the Fixed Stack

```powershell
# Deploy with a new stack name (recommended for first time after fix)
cdk deploy TodaysDentalInsightsChimeV10

# OR deploy with same name if you're confident
cdk deploy TodaysDentalInsightsChimeV9
```

### Step 5: Verify Deployment

```powershell
# Check stack status
aws cloudformation describe-stacks --stack-name TodaysDentalInsightsChimeV9 --region us-east-1 --query "Stacks[0].StackStatus"
# Should show: CREATE_COMPLETE or UPDATE_COMPLETE

# List created resources
aws chime-sdk-voice list-sip-media-applications --region us-east-1
aws chime-sdk-voice list-voice-connectors --region us-east-1
aws chime-sdk-voice list-sip-rules --region us-east-1
```

## 📊 What Changed in the Code

### File: `src/infrastructure/stacks/chime-stack.ts`

**REMOVED (Lines 224-276):**
```typescript
// ❌ This entire block was removed
const vcOrigination = new customResources.AwsCustomResource(this, 'VoiceConnectorOrigination', {
  // ... trying to use non-existent Hostname field
});
```

**REPLACED WITH (Lines 224-233):**
```typescript
// ✅ Explanatory comment about why it's not needed
// NOTE: Voice Connector Origination is NOT needed for this architecture
// - Inbound calls are routed via SIP Rules
// - Outbound calls use Voice Connector's default outbound routing
```

**UPDATED (Outbound SIP Rule - Lines 321-360):**
```typescript
// OLD:
physicalResourceId: customResources.PhysicalResourceId.of(outboundRuleId),

// NEW:
physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
```

**UPDATED (Inbound SIP Rules - Lines 362-434):**
```typescript
// OLD:
physicalResourceId: customResources.PhysicalResourceId.of(resourceId),

// NEW:
physicalResourceId: customResources.PhysicalResourceId.fromResponse('SipRule.SipRuleId'),
```

## ✅ Expected Results

After successful deployment, you should see:

```
✅  TodaysDentalInsightsChimeV9

Outputs:
TodaysDentalInsightsChimeV9.ClinicsTableName = TodaysDentalInsightsChimeV9-Clinics
TodaysDentalInsightsChimeV9.AgentPresenceTableName = TodaysDentalInsightsChimeV9-AgentPresence
TodaysDentalInsightsChimeV9.SipMediaApplicationId = abc123...
TodaysDentalInsightsChimeV9.VoiceConnectorId = xyz789...
TodaysDentalInsightsChimeV9.VoiceConnectorOutboundHostName = abcdefgh.voiceconnector.chime.aws

Stack ARN:
arn:aws:cloudformation:us-east-1:851620242036:stack/TodaysDentalInsightsChimeV9/...
```

## 🚀 Next Steps After Successful Deployment

### 1. Provision Phone Numbers

```bash
cd scripts

# Use the automated script
npx ts-node provision-phone-numbers.ts \
  --voice-connector-id <from-stack-output> \
  --sma-id <from-stack-output> \
  --clinics-table <from-stack-output> \
  --clinics clinic1,clinic2 \
  --area-codes 800,415 \
  --region us-east-1
```

Or see `PHONE-NUMBER-PROVISIONING-GUIDE.md` for manual provisioning.

### 2. Test Outbound Calls

```bash
# Agent goes online
curl -X POST https://your-api.com/chime/start-session \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"activeClinicIds": ["clinic1"]}'

# Make outbound call
curl -X POST https://your-api.com/chime/outbound-call \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"toPhoneNumber": "+14155551234", "fromClinicId": "clinic1"}'
```

### 3. Test Inbound Calls (After Provisioning)

Simply dial one of your provisioned phone numbers from a real phone.

## 🆘 Troubleshooting

### "Cleanup script fails"
- Run with `-DryRun` first to see what it would do
- Manually delete resources from AWS Console
- Contact AWS Support if stack is truly stuck

### "Deployment still fails"
- Check `cdk synth` output for TypeScript errors
- Verify you pulled the latest code changes
- Check CloudWatch Logs for custom resource errors

### "SIP Rules still won't delete"
- They might be associated with phone numbers
- Disassociate phone numbers first, then delete SIP Rules

### "Need help understanding the fix"
- Read `VOICE-CONNECTOR-ORIGINATION-FIX.md` for detailed explanation
- Read `CHIME-SMA-FIXES-SUMMARY.md` for overall architecture

## 📝 Summary

| Problem | Solution |
|---------|----------|
| **VoiceConnectorOrigination CREATE_FAILED** | Removed - not needed for this architecture |
| **SIP Rule DELETE_FAILED during rollback** | Fixed physicalResourceId to use API response |
| **Stack stuck in ROLLBACK_FAILED** | Cleanup script to manually delete resources |
| **Deployment fails repeatedly** | New code fixes both creation and deletion issues |

## 📞 Quick Reference Commands

```powershell
# Check if stack exists
aws cloudformation describe-stacks --stack-name TodaysDentalInsightsChimeV9 --region us-east-1

# List SIP Rules
aws chime-sdk-voice list-sip-rules --region us-east-1

# Delete SIP Rule
aws chime-sdk-voice delete-sip-rule --sip-rule-id RULE_ID --region us-east-1

# Delete stack
aws cloudformation delete-stack --stack-name TodaysDentalInsightsChimeV9 --region us-east-1

# Deploy fixed stack
cdk deploy TodaysDentalInsightsChimeV9

# Synthesize first to check
cdk synth TodaysDentalInsightsChimeV9
```

## ✨ You're Ready!

After following these steps, your Chime stack should deploy successfully without any `ROLLBACK_FAILED` errors. The architecture is now correct and all resources will be properly created and deleted.

**Good luck! 🎉**




