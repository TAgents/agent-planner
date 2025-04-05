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

# List API tokens request
echo "Listing all API tokens..."
RESPONSE=$(curl -s -X GET "$API_URL/tokens" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error listing API tokens. Response:"
  echo $RESPONSE
  exit 1
else
  echo "API tokens retrieved successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
fi
