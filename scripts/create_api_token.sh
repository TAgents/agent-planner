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

# API token details
NAME="Test API Token"
PERMISSIONS='["read","write"]'

# Create API token request
echo "Creating new API token..."
RESPONSE=$(curl -s -X POST "$API_URL/tokens" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"$NAME\",\"permissions\":$PERMISSIONS}")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error creating API token. Response:"
  echo $RESPONSE
  exit 1
else
  echo "API token created successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
  
  # Extract and save API token ID
  TOKEN_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)
  if [ ! -z "$TOKEN_ID" ]; then
    echo $TOKEN_ID > ./api_token_id.txt
    echo "API token ID saved: $TOKEN_ID"
  fi
fi
