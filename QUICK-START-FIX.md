# 🚀 Quick Start: Fix Your ROLLBACK_FAILED Issue

## ⏱️ 3-Step Fix (15 minutes)

Your CloudFormation stack is stuck because of a code bug. Follow these 3 steps to fix it:

---

## Step 1: Clean Up (5 min)

### Option A: PowerShell Script (Easiest)
```powershell
cd D:\zswaraj\todaysdentalinsightscdk
.\scripts\cleanup-stuck-stack.ps1 -ForceDelete
```

### Option B: Manual Commands
```powershell
# Delete SIP Rules
aws chime-sdk-voice list-sip-rules --region us-east-1
# Copy each SipRuleId from the output, then:
aws chime-sdk-voice delete-sip-rule --sip-rule-id PASTE_ID_HERE --region us-east-1

# Delete the stuck stack
aws cloudformation delete-stack --stack-name TodaysDentalInsightsChimeV9 --region us-east-1

# Wait for it to finish
aws cloudformation wait stack-delete-complete --stack-name TodaysDentalInsightsChimeV9 --region us-east-1
```

---

## Step 2: Deploy Fixed Code (5 min)

```powershell
cd D:\zswaraj\todaysdentalinsightscdk

# Check for errors first
cdk synth TodaysDentalInsightsChimeV9

# Deploy
cdk deploy TodaysDentalInsightsChimeV9
```

**Expected Output:**
```
✅  TodaysDentalInsightsChimeV9

Outputs:
TodaysDentalInsightsChimeV9.SipMediaApplicationId = abc123...
TodaysDentalInsightsChimeV9.VoiceConnectorId = xyz789...

Stack ARN:
arn:aws:cloudformation:us-east-1:851620242036:stack/TodaysDentalInsightsChimeV9/...
```

---

## Step 3: Verify (5 min)

```powershell
# Verify stack is healthy
aws cloudformation describe-stacks \
  --stack-name TodaysDentalInsightsChimeV9 \
  --region us-east-1 \
  --query "Stacks[0].StackStatus" \
  --output text

# Should output: CREATE_COMPLETE
```

```powershell
# Verify Chime resources exist
aws chime-sdk-voice list-sip-media-applications --region us-east-1
aws chime-sdk-voice list-voice-connectors --region us-east-1
aws chime-sdk-voice list-sip-rules --region us-east-1
```

---

## ✅ Done!

Your stack is now deployed successfully. The bug has been fixed.

---

## 🔍 What Was Fixed?

**Problem**: The code tried to use a field `SipMediaApplication.Endpoints[0].Hostname` that doesn't exist in the AWS API.

**Solution**: Removed the problematic `VoiceConnectorOrigination` resource (it wasn't needed anyway).

**Files Changed**:
- `src/infrastructure/stacks/chime-stack.ts` - Removed lines 224-276

---

## 📚 Want More Details?

| Document | Purpose | Read if... |
|----------|---------|------------|
| `DEPLOYMENT-FIX-INSTRUCTIONS.md` | Step-by-step guide | You want detailed explanations |
| `VOICE-CONNECTOR-ORIGINATION-FIX.md` | Technical deep dive | You want to understand WHY |
| `ROLLBACK-FAILED-FIX-SUMMARY.md` | Complete summary | You want the full story |
| `scripts/cleanup-stuck-stack.ps1` | Cleanup automation | You have multiple stuck stacks |

---

## 🆘 Troubleshooting

### "Cleanup script not found"
Make sure you're in the project root directory:
```powershell
cd D:\zswaraj\todaysdentalinsightscdk
```

### "AWS CLI command not found"
Install AWS CLI: https://aws.amazon.com/cli/

### "Access denied"
Configure AWS credentials:
```powershell
aws configure
```

### "Stack still fails to deploy"
Check CDK synth output for errors:
```powershell
cdk synth TodaysDentalInsightsChimeV9 2>&1 | more
```

### "I need help"
1. Read `DEPLOYMENT-FIX-INSTRUCTIONS.md`
2. Check CloudWatch Logs: `/aws/lambda/TodaysDentalInsightsChimeV9-*`
3. Check CloudFormation Events in AWS Console

---

## 🎯 Next Steps (After Deployment Succeeds)

1. **Provision Phone Numbers** (Required for inbound calls)
   - See: `PHONE-NUMBER-PROVISIONING-GUIDE.md`
   - Or run: `scripts/provision-phone-numbers.ts`

2. **Test Outbound Calls**
   - See: `OUTBOUND-CALL-TEST-CHECKLIST.md`

3. **Update Agent Frontend**
   - Implement call notification polling
   - See: `CHIME-SMA-FIXES-SUMMARY.md`

---

## 🎉 Success!

Your Chime stack is now working correctly. All deployment issues are resolved.

**Questions?** Check the documentation files listed above or AWS CloudFormation console.




