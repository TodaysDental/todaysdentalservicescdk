#!/bin/bash

# Bash script to migrate Connect users from old schema to ABR schema
# Run this script to migrate existing Connect user data

echo "🚀 Starting Connect users migration to ABR schema..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed or not in PATH"
    exit 1
fi

echo "📊 Node.js found: $(node --version)"

# Run the migration script
echo "🔄 Running migration script..."
node $(dirname "$0")/migrate-connect-users-abr.ts

if [ $? -eq 0 ]; then
    echo "✅ Migration completed successfully!"
else
    echo "❌ Migration failed with exit code: $?"
    exit $?
fi
