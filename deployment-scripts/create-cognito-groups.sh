#!/bin/bash

# Bash script to create Cognito groups for all clinics
# Usage: ./create-cognito-groups.sh <USER_POOL_ID>

if [ -z "$1" ]; then
    echo "Usage: $0 <USER_POOL_ID>"
    echo "Example: $0 us-east-1_abc123"
    exit 1
fi

USER_POOL_ID=$1

echo "🚀 Creating Cognito groups for all dental clinics..."
echo "User Pool ID: $USER_POOL_ID"

# Set environment variable
export USER_POOL_ID=$USER_POOL_ID

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Compile TypeScript if needed
if [ ! -d "dist/scripts" ]; then
    echo "🔨 Compiling TypeScript..."
    npx tsc
fi

# Run the script
echo "🏃 Executing Cognito group creation..."
node dist/scripts/create-cognito-groups.js $USER_POOL_ID

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Cognito group creation completed successfully!"
    echo ""
    echo "=== Next Steps ==="
    echo "1. Verify groups were created in AWS Cognito console"
    echo "2. Test user assignment to groups"
    echo "3. Deploy updated cognito-triggers if needed"
else
    echo "❌ Script execution failed"
    exit 1
fi
