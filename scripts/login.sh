#!/bin/bash

# Configuration
API_URL="http://localhost:3000"
EMAIL="admin@example.com"
PASSWORD="password123"

# Login request
echo "Logging in with $EMAIL..."
RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
-H "Content-Type: application/json" \
-d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

# Extract access token from response (using jq if available, otherwise grep)
if command -v jq > /dev/null; then
  ACCESS_TOKEN=$(echo $RESPONSE | jq -r '.session.access_token // empty')
else
ACCESS_TOKEN=$(echo $RESPONSE | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//') 
fi

if [ -z "$ACCESS_TOKEN" ]; then
echo "Login failed. Response:"
echo $RESPONSE
exit 1
else
  echo "Login successful!"
  echo "Access Token: ${ACCESS_TOKEN:0:10}...[truncated]" # Show only beginning for security
  # Save token to a file for other scripts to use
  echo $ACCESS_TOKEN > ./token.txt
fi
