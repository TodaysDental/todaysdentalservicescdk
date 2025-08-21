#!/bin/bash

# Script to create audio files for the multi-agent ring system using AWS Polly
# This generates professional-sounding voice messages

set -e

echo "🎵 Creating audio files for multi-agent ring system..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is required but not installed."
    exit 1
fi

# Create temporary directory for audio files
mkdir -p temp_audio
cd temp_audio

echo "📢 Generating voice messages using AWS Polly..."

# Function to create audio file using Polly
create_audio_file() {
    local text="$1"
    local filename="$2"
    local voice="${3:-Joanna}"
    
    echo "🗣️  Creating: $filename"
    echo "   Text: $text"
    
    aws polly synthesize-speech \
        --output-format mp3 \
        --voice-id "$voice" \
        --text "$text" \
        --text-type "text" \
        "${filename}.mp3"
    
    # Convert MP3 to WAV for better compatibility
    if command -v ffmpeg &> /dev/null; then
        ffmpeg -i "${filename}.mp3" -acodec pcm_s16le -ar 16000 "${filename}.wav" -y -loglevel quiet
        rm "${filename}.mp3"
        echo "   ✅ Created: ${filename}.wav"
    else
        echo "   ⚠️  ffmpeg not found, keeping MP3 format: ${filename}.mp3"
    fi
}

# Generate all required message files
echo ""
echo "🎭 Creating message files..."

create_audio_file \
    "All agents are currently busy. Please hold while we connect you to the next available agent." \
    "all-agents-busy" \
    "Joanna"

create_audio_file \
    "Please leave a detailed message after the tone, and we'll get back to you as soon as possible." \
    "please-leave-message" \
    "Joanna"

create_audio_file \
    "Thank you for calling Today's Dental Insights. We're connecting you to an agent, please wait." \
    "connecting-please-wait" \
    "Joanna"

create_audio_file \
    "Thank you for calling Today's Dental Insights. Goodbye." \
    "thank-you-goodbye" \
    "Joanna"

create_audio_file \
    "We're sorry, there was a system error. Please try calling again later." \
    "system-error" \
    "Joanna"

# Create a simple hold music file (you might want to replace this with actual music)
echo ""
echo "🎶 Creating hold music..."

create_audio_file \
    "Please continue to hold. Your call is important to us. Please continue to hold. Your call is important to us." \
    "gentle-hold-music" \
    "Matthew"

# Create ringtone for frontend
echo ""
echo "📱 Creating ringtone..."

create_audio_file \
    "Ring ring. Ring ring. Ring ring." \
    "phone-ring" \
    "Amy"

echo ""
echo "📁 Audio files created in temp_audio/ directory:"
ls -la

echo ""
echo "📤 Upload commands:"
echo ""

# Get bucket name from CDK stack
AUDIO_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name TodaysDentalInsightsBackendV2 \
    --query "Stacks[0].Outputs[?OutputKey=='AudioAssetsBucketName'].OutputValue" \
    --output text 2>/dev/null || echo "YOUR_AUDIO_BUCKET_NAME")

if [ "$AUDIO_BUCKET" = "YOUR_AUDIO_BUCKET_NAME" ]; then
    echo "⚠️  Could not auto-detect audio bucket. Replace YOUR_AUDIO_BUCKET_NAME with actual bucket name."
    echo ""
fi

echo "# Upload message files:"
for file in all-agents-busy please-leave-message connecting-please-wait thank-you-goodbye system-error; do
    if [ -f "${file}.wav" ]; then
        echo "aws s3 cp ${file}.wav s3://${AUDIO_BUCKET}/messages/${file}.wav --content-type audio/wav"
    elif [ -f "${file}.mp3" ]; then
        echo "aws s3 cp ${file}.mp3 s3://${AUDIO_BUCKET}/messages/${file}.wav --content-type audio/mpeg"
    fi
done

echo ""
echo "# Upload music files:"
for file in gentle-hold-music; do
    if [ -f "${file}.wav" ]; then
        echo "aws s3 cp ${file}.wav s3://${AUDIO_BUCKET}/music/${file}.wav --content-type audio/wav"
    elif [ -f "${file}.mp3" ]; then
        echo "aws s3 cp ${file}.mp3 s3://${AUDIO_BUCKET}/music/${file}.wav --content-type audio/mpeg"
    fi
done

echo ""
echo "# Copy to frontend public directory:"
if [ -f "phone-ring.wav" ]; then
    echo "cp phone-ring.wav ../TodaysDentalInsightsFrontend/public/sounds/phone-ring.wav"
elif [ -f "phone-ring.mp3" ]; then
    echo "cp phone-ring.mp3 ../TodaysDentalInsightsFrontend/public/sounds/phone-ring.mp3"
fi

echo ""
echo "🎯 Quick upload script:"
cat > upload_all.sh << 'EOF'
#!/bin/bash
# Auto-generated upload script

AUDIO_BUCKET="REPLACE_WITH_YOUR_BUCKET_NAME"

echo "📤 Uploading all audio files to S3..."

# Upload message files
for file in all-agents-busy please-leave-message connecting-please-wait thank-you-goodbye system-error; do
    if [ -f "${file}.wav" ]; then
        aws s3 cp "${file}.wav" "s3://${AUDIO_BUCKET}/messages/${file}.wav" --content-type audio/wav
    elif [ -f "${file}.mp3" ]; then
        aws s3 cp "${file}.mp3" "s3://${AUDIO_BUCKET}/messages/${file}.wav" --content-type audio/mpeg
    fi
done

# Upload music files
for file in gentle-hold-music; do
    if [ -f "${file}.wav" ]; then
        aws s3 cp "${file}.wav" "s3://${AUDIO_BUCKET}/music/${file}.wav" --content-type audio/wav
    elif [ -f "${file}.mp3" ]; then
        aws s3 cp "${file}.mp3" "s3://${AUDIO_BUCKET}/music/${file}.wav" --content-type audio/mpeg
    fi
done

echo "✅ All audio files uploaded!"
EOF

chmod +x upload_all.sh

echo ""
echo "✅ Audio files generation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Review the generated audio files"
echo "2. Update AUDIO_BUCKET in upload_all.sh"
echo "3. Run: ./upload_all.sh"
echo "4. Copy phone-ring file to frontend public/sounds/ directory"
echo ""
echo "💡 To regenerate with different voice:"
echo "   ./create-audio-files.sh"
