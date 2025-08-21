#!/bin/bash

# Script to upload audio files for the multi-agent ring system
# Run this after deploying the CDK stack

# Get bucket name from CDK output
AUDIO_BUCKET=$(aws cloudformation describe-stacks --stack-name TodaysDentalInsightsBackendV2 --query "Stacks[0].Outputs[?OutputKey=='AudioAssetsBucketName'].OutputValue" --output text)

if [ -z "$AUDIO_BUCKET" ]; then
    echo "❌ Could not find audio assets bucket. Make sure the stack is deployed."
    exit 1
fi

echo "📦 Uploading audio files to bucket: $AUDIO_BUCKET"

# Create directories in S3
aws s3api put-object --bucket $AUDIO_BUCKET --key messages/ --content-length 0
aws s3api put-object --bucket $AUDIO_BUCKET --key music/ --content-length 0
aws s3api put-object --bucket $AUDIO_BUCKET --key voicemails/ --content-length 0
aws s3api put-object --bucket $AUDIO_BUCKET --key ringtones/ --content-length 0

# Upload message files
echo "🔊 Uploading message audio files..."

# You can either record these or use text-to-speech services
# For now, let's create placeholder files that you can replace

# Create sample message files using text-to-speech (requires festival or similar)
# Or download from a TTS service like Amazon Polly

# Sample commands (uncomment and modify as needed):
# aws polly synthesize-speech --output-format mp3 --voice-id Joanna --text "All agents are currently busy. Please hold while we connect you." all-agents-busy.mp3
# aws s3 cp all-agents-busy.mp3 s3://$AUDIO_BUCKET/messages/all-agents-busy.wav

# For now, let's create a simple upload script template:
cat > temp_upload_messages.txt << EOF
# Replace these with actual audio files:

# Required message files:
messages/all-agents-busy.wav - "All agents are currently busy"
messages/please-leave-message.wav - "Please leave a message after the tone"
messages/thank-you-goodbye.wav - "Thank you for calling. Goodbye"
messages/connecting-please-wait.wav - "Connecting you to an agent, please wait"
messages/system-error.wav - "We're sorry, there was a system error"

# Required music files:
music/gentle-hold-music.wav - Gentle hold music loop
music/phone-ring.wav - Phone ring sound for browser

# Directory structure:
voicemails/{clinicId}/ - Voicemail recordings will be stored here
ringtones/ - Agent notification sounds
EOF

echo "📋 Audio files needed (see temp_upload_messages.txt):"
cat temp_upload_messages.txt

echo ""
echo "🎵 Sample upload commands:"
echo "# Upload a message file:"
echo "aws s3 cp your-audio-file.wav s3://$AUDIO_BUCKET/messages/all-agents-busy.wav"
echo ""
echo "# Upload hold music:"
echo "aws s3 cp your-hold-music.wav s3://$AUDIO_BUCKET/music/gentle-hold-music.wav"
echo ""
echo "# Set proper content type for audio files:"
echo "aws s3 cp your-file.wav s3://$AUDIO_BUCKET/messages/ --content-type audio/wav"
echo ""

echo "✅ Audio assets bucket ready: $AUDIO_BUCKET"
echo "📁 Upload your audio files using the commands above"

# Clean up
rm temp_upload_messages.txt
