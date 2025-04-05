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

# Artifact details
NAME="Test Artifact"
CONTENT_TYPE="text/markdown"
URL="https://example.com/artifact"
METADATA="{\"createdBy\":\"API Test Script\",\"version\":\"1.0\"}"

# Add artifact request
echo "Adding artifact to node $NODE_ID..."
RESPONSE=$(curl -s -X POST "$API_URL/plans/$PLAN_ID/nodes/$NODE_ID/artifacts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"$NAME\",\"content_type\":\"$CONTENT_TYPE\",\"url\":\"$URL\",\"metadata\":$METADATA}")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error adding artifact. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Artifact added successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
  
  # Extract and save artifact ID
  ARTIFACT_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)
  if [ ! -z "$ARTIFACT_ID" ]; then
    echo $ARTIFACT_ID > ./artifact_id.txt
    echo "Artifact ID saved: $ARTIFACT_ID"
  fi
fi
