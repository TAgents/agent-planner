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

# Check if API token ID file exists
if [ ! -f "./api_token_id.txt" ]; then
  echo "No API token ID found. Please run create_api_token.sh first or specify a token ID as an argument."
  
  # Check if token ID was provided as argument
  if [ -z "$1" ]; then
    exit 1
  else
    TOKEN_ID=$1
  fi
else
  # Get API token ID from file
  TOKEN_ID=$(cat ./api_token_id.txt)
fi

# Revoke API token request
echo "Revoking API token: $TOKEN_ID..."
RESPONSE=$(curl -s -X DELETE "$API_URL/tokens/$TOKEN_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

# Check if the response is empty (successful deletion returns 204 No Content)
if [ -z "$RESPONSE" ]; then
  echo "API token revoked successfully."
else
  echo "Error revoking API token. Response:"
  echo $RESPONSE
  exit 1
fi
