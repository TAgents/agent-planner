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
  echo "No plan ID found. Please run create_plan.sh first."
  exit 1
else
  # Get plan ID from file
  PLAN_ID=$(cat ./plan_id.txt)
fi

# Check if node ID file exists
if [ ! -f "./node_id.txt" ]; then
  echo "No node ID found. Please run create_node.sh first."
  exit 1
else
  # Get node ID from file
  NODE_ID=$(cat ./node_id.txt)
fi

# Get logs request
echo "Getting logs for node: $NODE_ID in plan $PLAN_ID..."
RESPONSE=$(curl -s -X GET "$API_URL/plans/$PLAN_ID/nodes/$NODE_ID/logs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error getting logs. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Logs retrieved successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
fi
