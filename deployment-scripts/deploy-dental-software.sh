#!/bin/bash

# Dental Software Stack Deployment Script
# This script prepares and deploys the Dental Software Stack

set -e

echo "====================================="
echo "Dental Software Stack Deployment"
echo "====================================="
echo ""

# Step 1: Install MySQL Layer Dependencies
echo "[Step 1/4] Installing MySQL layer dependencies..."
MYSQL_LAYER_PATH="src/shared/layers/mysql-layer"

if [ -d "$MYSQL_LAYER_PATH" ]; then
    cd "$MYSQL_LAYER_PATH"
    
    # Create nodejs directory structure required by Lambda layers
    mkdir -p nodejs
    
    # Install dependencies into nodejs directory
    echo "Installing mysql2 package..."
    npm install --prefix nodejs
    
    cd -
    echo "✓ MySQL layer dependencies installed"
else
    echo "✗ MySQL layer directory not found: $MYSQL_LAYER_PATH"
    exit 1
fi

echo ""

# Step 2: Check Environment Variables
echo "[Step 2/4] Checking environment variables..."

if [ -z "$JWT_SECRET" ]; then
    echo "✗ JWT_SECRET environment variable is not set"
    echo "  Please set it using: export JWT_SECRET='your-secret-key'"
    exit 1
else
    echo "✓ JWT_SECRET is configured"
fi

if [ -z "$AWS_REGION" ]; then
    echo "⚠ AWS_REGION not set, using default"
    export AWS_REGION="us-east-1"
else
    echo "✓ AWS_REGION: $AWS_REGION"
fi

echo ""

# Step 3: Build TypeScript
echo "[Step 3/4] Building TypeScript..."
npm run build

echo "✓ Build completed successfully"
echo ""

# Step 4: Deploy Stack
echo "[Step 4/4] Deploying Dental Software Stack..."
echo "This will create:"
echo "  - VPC with public, private, and isolated subnets"
echo "  - RDS MySQL database (db.t3.micro)"
echo "  - S3 bucket for clinic data"
echo "  - Lambda functions for CRUD operations"
echo "  - API Gateway with custom domain"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

echo ""
echo "Deploying stack (this may take 10-15 minutes)..."

cdk deploy TodaysDentalInsightsDentalSoftwareN1 --require-approval never

echo ""
echo "====================================="
echo "✓ Deployment Successful!"
echo "====================================="
echo ""
echo "Next Steps:"
echo "1. Initialize the database by calling:"
echo "   POST https://apig.todaysdentalinsights.com/dental-software/init-database"
echo ""
echo "2. Test the API endpoints:"
echo "   GET  https://apig.todaysdentalinsights.com/dental-software/clinics"
echo "   POST https://apig.todaysdentalinsights.com/dental-software/clinics"
echo ""
echo "3. See full documentation in:"
echo "   docs/DENTAL-SOFTWARE-STACK.md"
echo ""

