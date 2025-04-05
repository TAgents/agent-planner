#!/bin/bash

# Configuration
API_URL="http://localhost:3000"

# Check if token file exists
if [ ! -f "./token.txt" ]; then
  echo "No authentication token found. Please run login.sh first."
  exit 1
fi

# Get token from file
TOKEN=$(cat ./token.txt)

# Plan details
TITLE="Test Plan"
DESCRIPTION="This is a test plan created via API"

# Create plan request
echo "Creating new plan: $TITLE..."
RESPONSE=$(curl -s -X POST "$API_URL/plans" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\":\"$TITLE\",\"description\":\"$DESCRIPTION\",\"status\":\"draft\"}")

# Extract plan ID from response
PLAN_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)

if [ -z "$PLAN_ID" ]; then
  echo "Plan creation failed. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Plan created successfully!"
  echo "Plan ID: $PLAN_ID"
  # Save plan ID to a file for other scripts to use
  echo $PLAN_ID > ./plan_id.txt
fi
