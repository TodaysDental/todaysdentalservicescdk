#!/bin/bash

# Deployment script for the enhanced callback system
echo "🚀 Deploying enhanced callback system..."

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "❌ AWS CDK is not installed. Please install it first:"
    echo "npm install -g aws-cdk"
    exit 1
fi

# Check if we're in the correct directory
if [ ! -f "cdk.json" ]; then
    echo "❌ Not in CDK project directory. Please cd to the CDK project root."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building the project..."
npm run build

# Bootstrap CDK if needed (only run once per account/region)
echo "🏗️  Bootstrapping CDK (if not already done)..."
cdk bootstrap

# Deploy the main stack first
echo "🚀 Deploying main API and Cognito stack..."
cdk deploy TodaysDentalInsightsBackendV2 --require-approval never

# Deploy the callback stack
echo "📞 Deploying dedicated callback stack..."
cdk deploy CallbackStack --require-approval never

echo "✅ Deployment complete!"
echo ""
echo "📋 Summary of changes:"
echo "• Created dedicated CallbackStack for better organization"
echo "• Enhanced callback Lambda with POST (create) support"
echo "• Added admin endpoints for bulk operations"
echo "• Improved API endpoints with proper HTTP methods"
echo "• Updated frontend to use new /callback/{clinicId} endpoints"
echo ""
echo "🔗 New API endpoints:"
echo "• GET /callback/{clinicId} - List callbacks (requires auth)"
echo "• POST /callback/{clinicId} - Create callback (public endpoint)"
echo "• PUT /callback/{clinicId} - Update callback (requires auth)"
echo "• GET /admin/callbacks?clinicId={id} - Admin list (super admin only)"
echo "• POST /admin/callbacks/bulk - Bulk operations (super admin only)"
echo ""
echo "🎯 Next steps:"
echo "1. Update any external websites to use POST /callback/{clinicId} for new requests"
echo "2. Test the admin dashboard callback functionality"
echo "3. Verify callback notifications are working correctly"
