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

# Check if plan ID file exists
if [ ! -f "./plan_id.txt" ]; then
  echo "No plan ID found. Please run create_plan.sh first or specify a plan ID as an argument."
  
  # Check if plan ID was provided as argument
  if [ -z "$1" ]; then
    exit 1
  else
    PLAN_ID=$1
  fi
else
  # Get plan ID from file
  PLAN_ID=$(cat ./plan_id.txt)
fi

# Plan update details
NEW_TITLE="Updated Test Plan"
NEW_DESCRIPTION="This plan has been updated via API"
NEW_STATUS="active"

# Update plan request
echo "Updating plan: $PLAN_ID..."
RESPONSE=$(curl -s -X PUT "$API_URL/plans/$PLAN_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\":\"$NEW_TITLE\",\"description\":\"$NEW_DESCRIPTION\",\"status\":\"$NEW_STATUS\"}")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error updating plan. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Plan updated successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
fi
