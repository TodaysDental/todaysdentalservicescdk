# Deployment Fix for Today's Dental Insights CDK

This guide explains how to fix the CloudFormation stack that's stuck in `UPDATE_ROLLBACK_COMPLETE` state with failed resource deletions.

## Problem

The CloudFormation stack is trying to delete SIP Rules that no longer exist, causing deployment failures. The error pattern is:

```
DELETE_FAILED | AWS::CloudFormation::CustomResource | SipRule-Inbound-*
Received response status [FAILED] from custom resource. Message returned: Could not find SIP Rule with Id 'inbound-sip-rule-*'
```

These errors occur because:
1. The physical resource IDs used in the custom resources don't match the actual SIP Rule IDs
2. SIP Rules have already been deleted manually or through the AWS console
3. CloudFormation is still trying to clean up resources based on outdated identifiers

## Solution

I've created two PowerShell scripts to help fix this issue:

### 1. `cleanup-sip-rules.ps1`

This script:
- Lists and deletes all existing SIP Rules in your AWS account
- Checks if the CloudFormation stack is in a failed state
- Offers to delete the failed stack if necessary

### 2. `cleanup-and-deploy.ps1`

This script:
- Performs the cleanup steps above
- Automatically deletes the stack if it's in a failed state
- Runs the CDK deployment command to redeploy the stack

## How to Run

1. Open PowerShell as Administrator
2. Navigate to your project directory
3. Run the combined script:

```powershell
.\cleanup-and-deploy.ps1
```

Or if you want to run the steps separately:

```powershell
.\cleanup-sip-rules.ps1
# Then manually run your CDK deploy
cdk deploy --require-approval never
```

## Important Notes

- These scripts will delete all SIP rules in your AWS account in the current region. If you have other SIP rules that should be preserved, modify the scripts accordingly.
- You'll need AWS PowerShell modules installed (the script will attempt to install them if missing)
- Make sure you have proper AWS credentials configured
- You may need to allow script execution: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## Code Improvements

The stack is getting stuck in this state because of how the custom resources handle SIP rule IDs. The code changes already made to fix this include:

1. Using static physical resource IDs instead of dynamic ones from responses
2. Improving error handling in custom resources
3. Adding more robust dependency management between resources
4. Batching resource creation/deletion to avoid overwhelming AWS service APIs

After running the cleanup and deployment, your stack should deploy successfully with these improvements.
