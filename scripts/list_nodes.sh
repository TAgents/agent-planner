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

# List nodes request
echo "Listing all nodes for plan: $PLAN_ID..."
RESPONSE=$(curl -s -X GET "$API_URL/plans/$PLAN_ID/nodes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error getting nodes. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Nodes retrieved successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
  
  # Extract and save root node ID for later use
  ROOT_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)
  if [ ! -z "$ROOT_ID" ]; then
    echo $ROOT_ID > ./root_node_id.txt
    echo "Root node ID saved: $ROOT_ID"
  fi
fi
