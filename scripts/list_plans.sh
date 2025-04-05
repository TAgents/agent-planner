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

# List plans request
echo "Listing all plans..."
RESPONSE=$(curl -s -X GET "$API_URL/plans" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

# Check if the response is empty
if [[ $RESPONSE == "[]" ]]; then
  echo "No plans found."
else
  echo "Plans retrieved successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
fi
