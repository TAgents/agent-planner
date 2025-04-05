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
  exit 1
else
  # Get plan ID from file
  PLAN_ID=$(cat ./plan_id.txt)
fi

# Check if root node ID file exists
if [ ! -f "./root_node_id.txt" ]; then
  echo "No root node ID found. Please run list_nodes.sh first."
  exit 1
else
  # Get root node ID from file
  PARENT_ID=$(cat ./root_node_id.txt)
fi

# Node details
NODE_TYPE="phase"
TITLE="Test Phase"
DESCRIPTION="This is a test phase node created via API"
STATUS="not_started"

# Create node request
echo "Creating new node in plan $PLAN_ID with parent $PARENT_ID..."
RESPONSE=$(curl -s -X POST "$API_URL/plans/$PLAN_ID/nodes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"parent_id\":\"$PARENT_ID\",\"node_type\":\"$NODE_TYPE\",\"title\":\"$TITLE\",\"description\":\"$DESCRIPTION\",\"status\":\"$STATUS\"}")

# Extract node ID from response
NODE_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)

if [ -z "$NODE_ID" ]; then
  echo "Node creation failed. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Node created successfully!"
  echo "Node ID: $NODE_ID"
  # Save node ID to a file for other scripts to use
  echo $NODE_ID > ./node_id.txt
  
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
fi
