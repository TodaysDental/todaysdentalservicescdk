#!/bin/bash

# Dental Chatbot Deployment Script
# This script deploys the chatbot stack and runs initial data migration

set -e

echo "🚀 Starting Dental Chatbot Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
print_status "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18.x or higher."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm."
    exit 1
fi

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install and configure AWS CLI."
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please install with: npm install -g aws-cdk"
    exit 1
fi

print_success "All prerequisites are installed!"

# Check AWS credentials
print_status "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured. Please run 'aws configure'"
    exit 1
fi

print_success "AWS credentials are configured!"

# Install dependencies
print_status "Installing dependencies..."
npm install

# Install common layer dependencies
print_status "Installing common layer dependencies..."
cd chatbot-layers/common
npm install
cd ../..

print_success "Dependencies installed!"

# Build the project
print_status "Building the project..."
npm run build

print_success "Project built successfully!"

# Deploy the chatbot stack
print_status "Deploying the chatbot stack..."
echo "This may take several minutes..."

cdk deploy TodaysDentalInsightsChatbotV2 --require-approval never

if [ $? -eq 0 ]; then
    print_success "Chatbot stack deployed successfully!"
else
    print_error "Failed to deploy chatbot stack!"
    exit 1
fi

# Get the API endpoints
print_status "Getting API endpoints..."
REST_API_URL=$(aws cloudformation describe-stacks \
    --stack-name TodaysDentalInsightsChatbotV2 \
    --query 'Stacks[0].Outputs[?OutputKey==`RestApiEndpoint`].OutputValue' \
    --output text)

WEBSOCKET_API_URL=$(aws cloudformation describe-stacks \
    --stack-name TodaysDentalInsightsChatbotV2 \
    --query 'Stacks[0].Outputs[?OutputKey==`WebSocketApiEndpoint`].OutputValue' \
    --output text)

print_success "Deployment completed successfully!"
echo ""
echo "📋 API Endpoints:"
echo "   REST API: $REST_API_URL"
echo "   WebSocket API: $WEBSOCKET_API_URL"
echo ""

# Run data migration
print_warning "Would you like to run the data migration now? (y/n)"
read -r response

if [[ "$response" =~ ^[Yy]$ ]]; then
    print_status "Running data migration..."
    
    # Note: In a real deployment, you would need a Cognito token for authentication
    # This is a placeholder for the migration command
    echo "To run data migration, you need to:"
    echo "1. Get a Cognito authentication token"
    echo "2. Make a POST request to: ${REST_API_URL}migrate"
    echo "3. Include the token in Authorization header"
    echo ""
    echo "Example curl command:"
    echo "curl -X POST ${REST_API_URL}migrate \\"
    echo "  -H \"Authorization: Bearer <your-cognito-token>\" \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{\"type\": \"all\"}'"
    echo ""
    print_warning "Please run the migration manually with proper authentication."
else
    print_status "Skipping data migration. You can run it later."
fi

echo ""
print_success "🎉 Deployment completed!"
echo ""
echo "📖 Next Steps:"
echo "1. Update your DNS to point api.todaysdentalinsights.com to the API Gateway (if using custom domain)"
echo "2. Run data migration to populate initial clinic data"
echo "3. Test WebSocket connection: wss://api.todaysdentalinsights.com?clinicId=dentistinnewbritain"
echo "4. Test REST API endpoints for CRUD operations"
echo ""
echo "📚 Documentation: See CHATBOT_README.md for detailed usage instructions"
echo ""
print_success "Happy chatting! 🤖"
