# AWS Chime Phone Number Provisioning Guide

## Overview

This guide explains how to provision phone numbers for your AWS Chime SIP Media Application contact center. Without phone numbers, your system can only make **outbound calls**. To receive **inbound calls**, you must:

1. Provision phone numbers via AWS Chime SDK Voice
2. Associate them with your Voice Connector
3. Create SIP Rules to route calls to your SMA
4. Update your ClinicsTable with the phone numbers

## Prerequisites

- AWS CLI configured with appropriate credentials
- The following stack outputs from your deployment:
  - `VoiceConnectorId`
  - `SipMediaApplicationId`
  - `ClinicsTableName`

## Step 1: Search for Available Phone Numbers

```bash
# Search for toll-free numbers in the US
aws chime-sdk-voice search-available-phone-numbers \
  --area-code 800 \
  --country US \
  --phone-number-type "TollFree" \
  --max-results 5

# Search for local numbers in a specific area code
aws chime-sdk-voice search-available-phone-numbers \
  --area-code 415 \
  --city "San Francisco" \
  --state CA \
  --country US \
  --phone-number-type "Local" \
  --max-results 5
```

## Step 2: Order Phone Numbers

```bash
# Order a phone number (replace with actual E.164 number from search results)
aws chime-sdk-voice create-phone-number-order \
  --product-type "SipMediaApplicationDialIn" \
  --e164-phone-numbers "+18005551234" "+14155551234"
```

Check order status:
```bash
aws chime-sdk-voice get-phone-number-order \
  --phone-number-order-id <order-id-from-previous-command>
```

## Step 3: Associate Phone Numbers with Voice Connector

```bash
# Get your Voice Connector ID from stack outputs
export VOICE_CONNECTOR_ID="<your-voice-connector-id>"

# Associate each phone number
aws chime-sdk-voice associate-phone-numbers-with-voice-connector \
  --voice-connector-id $VOICE_CONNECTOR_ID \
  --e164-phone-numbers "+18005551234" "+14155551234"
```

## Step 4: Create Inbound SIP Rules

For each phone number, create a SIP Rule that routes inbound calls to your SMA:

```bash
# Get your SMA ID from stack outputs
export SMA_ID="<your-sip-media-application-id>"
export AWS_REGION="us-east-1"  # Your deployed region

# Create SIP Rule for each phone number
aws chime-sdk-voice create-sip-rule \
  --name "InboundRule-Clinic1-8005551234" \
  --trigger-type "ToPhoneNumber" \
  --trigger-value "+18005551234" \
  --target-applications "SipMediaApplicationId=$SMA_ID,Priority=1,AwsRegion=$AWS_REGION"

aws chime-sdk-voice create-sip-rule \
  --name "InboundRule-Clinic2-4155551234" \
  --trigger-type "ToPhoneNumber" \
  --trigger-value "+14155551234" \
  --target-applications "SipMediaApplicationId=$SMA_ID,Priority=1,AwsRegion=$AWS_REGION"
```

## Step 5: Update ClinicsTable with Phone Numbers

Each clinic needs to know its assigned phone number for outbound calling:

```bash
# Get your Clinics table name from stack outputs
export CLINICS_TABLE="<your-clinics-table-name>"

# Update clinic with phone number
aws dynamodb update-item \
  --table-name $CLINICS_TABLE \
  --key '{"clinicId": {"S": "dentistinperrysburg"}}' \
  --update-expression "SET phoneNumber = :phone" \
  --expression-attribute-values '{":phone": {"S": "+18005551234"}}'

aws dynamodb update-item \
  --table-name $CLINICS_TABLE \
  --key '{"clinicId": {"S": "sfdentalcare"}}' \
  --update-expression "SET phoneNumber = :phone" \
  --expression-attribute-values '{":phone": {"S": "+14155551234"}}'
```

## Step 6: Verify Configuration

### Test Inbound Calls
1. Dial one of your provisioned numbers
2. Check CloudWatch Logs for your SMA Lambda (`/aws/lambda/<StackName>-SmaHandler`)
3. Verify you see `NEW_INBOUND_CALL` events

### Test Outbound Calls
1. Ensure an agent is online (called `/chime/start-session`)
2. Make an outbound call via `/chime/outbound-call`
3. Verify the call uses the clinic's `phoneNumber` as Caller ID

## Architecture Flow

### Inbound Call Flow
```
Customer Dials Number
    ↓
AWS Chime PSTN Network
    ↓
Voice Connector (associated with number)
    ↓
SIP Rule (ToPhoneNumber trigger)
    ↓
SIP Media Application Lambda
    ↓ NEW_INBOUND_CALL event
Your SMA Handler (inbound-router.ts)
    ↓
Creates Meeting → Notifies Agents → Agent Accepts → Call Connected
```

### Outbound Call Flow
```
Agent Clicks "Call Customer"
    ↓
Frontend calls /chime/outbound-call API
    ↓
Lambda calls CreateSipMediaApplicationCall
    ↓
SIP Media Application places PSTN call
    ↓ NEW_OUTBOUND_CALL event
Your SMA Handler (inbound-router.ts)
    ↓
Joins Customer to Agent's Meeting → Call Connected
```

## Troubleshooting

### "No agents available" even though agents are online
- Check that agents' `activeClinicIds` in AgentPresenceTable includes the clinic being called
- Verify agents have `status: 'Online'` in the presence table
- Check CloudWatch Logs for the SMA Handler

### Inbound calls not routing to SMA
- Verify SIP Rule exists with correct `ToPhoneNumber` trigger
- Check phone number is associated with Voice Connector:
  ```bash
  aws chime-sdk-voice list-phone-numbers \
    --filter-name voice-connector-id \
    --filter-value $VOICE_CONNECTOR_ID
  ```
- Ensure SMA Lambda has proper permissions

### Outbound calls failing
- Verify clinic has `phoneNumber` field in ClinicsTable
- Check that phone number is associated with Voice Connector
- Ensure outbound SIP Rule exists (created by stack)

### Audio issues / No audio on calls
- ✅ Fixed: Customer PSTN leg now properly joins meeting via `JoinChimeMeeting` action
- Verify agent's browser has microphone permissions
- Check Chime SDK Meeting region matches your SMA region (us-east-1)

## Cost Considerations

- **Phone number rental**: ~$1/month per number (Local), ~$2/month (Toll-free)
- **Inbound minutes**: ~$0.00085/minute (Local), ~$0.012/minute (Toll-free)
- **Outbound minutes**: ~$0.00085-0.02/minute depending on destination
- **Meeting usage**: Included in Chime SDK Meetings pricing

See: https://aws.amazon.com/chime/pricing/

## Additional Resources

- [AWS Chime SDK Voice Developer Guide](https://docs.aws.amazon.com/chime-sdk/latest/dg/voice.html)
- [SIP Media Application Events](https://docs.aws.amazon.com/chime-sdk/latest/dg/invoke-sip-media-application.html)
- [Phone Number Management API](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_Operations_Amazon_Chime_SDK_Voice.html)

## Automated Provisioning Script

For a more automated approach, see `scripts/provision-phone-numbers.ts` which can:
- Search and order numbers in bulk
- Auto-associate with Voice Connector
- Create SIP Rules
- Update ClinicsTable

Run with:
```bash
cd scripts
npx ts-node provision-phone-numbers.ts --clinics clinic1,clinic2 --area-codes 800,415
```

