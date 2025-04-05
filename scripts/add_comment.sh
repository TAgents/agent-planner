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

# Comment details
CONTENT="This is a test comment added via API"
COMMENT_TYPE="human"

# Add comment request
echo "Adding comment to node $NODE_ID..."
RESPONSE=$(curl -s -X POST "$API_URL/plans/$PLAN_ID/nodes/$NODE_ID/comments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"content\":\"$CONTENT\",\"comment_type\":\"$COMMENT_TYPE\"}")

# Check for errors
if [[ $RESPONSE == *"error"* ]]; then
  echo "Error adding comment. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Comment added successfully:"
  # Pretty print the JSON
  echo $RESPONSE | python -m json.tool
  
  # Extract and save comment ID
  COMMENT_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//' | head -1)
  if [ ! -z "$COMMENT_ID" ]; then
    echo $COMMENT_ID > ./comment_id.txt
    echo "Comment ID saved: $COMMENT_ID"
  fi
fi
