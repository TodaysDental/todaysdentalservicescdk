# SIP Rules Management Guide

This document explains the SIP rule naming changes and how to manage them in your Today's Dental Insights CDK project.

## SIP Rule Naming Improvements

### 1. Outbound SIP Rule
- **Resource ID**: `${stackName.toLowerCase()}-outbound-rule`
- **Display Name**: `${stackName}-Outbound`
- Benefits:
  - Includes stack name for uniqueness
  - More consistent between creation and deletion
  - Clearer in AWS console

### 2. Inbound SIP Rules
- **Resource ID**: `${stackName.toLowerCase()}-inbound-${clinicIdSafe}-${phonePrefix}`
  - `clinicIdSafe`: Sanitized clinic ID (alphanumeric only)
  - `phonePrefix`: First 8 digits of the phone number
- **Display Name**: `${stackName}-${clinicId}-${phonePrefix}`
- Benefits:
  - Safer naming with sanitized inputs
  - Consistent pattern for all clinics
  - Shorter names for better readability
  - Avoids CloudFormation ID conflicts

## Using the Cleanup Script

The `cleanup-sip-rules.ps1` script helps manage your SIP rules:

1. **Display existing rules**:
   - Lists all SIP rules with their names, IDs, and triggers
   - Shows a count of found rules

2. **Safe deletion**:
   - Prompts for confirmation before deletion
   - Shows real-time progress with success/failure indicators
   - Provides summary statistics after completion

3. **Usage**:
   ```powershell
   .\cleanup-sip-rules.ps1
   ```

## Deployment Workflow

1. **Before deployment**:
   - Run `.\cleanup-sip-rules.ps1` to see existing rules
   - Confirm deletion of rules if needed

2. **Deploy the stack**:
   - Run `cdk deploy` to deploy with new naming pattern
   - The stack will create new SIP rules with the improved naming

3. **Verification**:
   - Check the AWS Console to verify the new rule names
   - Run the cleanup script again to see the new rules

## Troubleshooting

If you encounter "Could not find SIP Rule with Id" errors during stack deletion:

1. Run `.\cleanup-sip-rules.ps1` to manually delete all SIP rules
2. Delete the stack completely using `cdk destroy`
3. Redeploy using `cdk deploy`

This ensures a clean deployment without any resource conflicts.
