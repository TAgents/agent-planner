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

# Extract token from response
TOKEN=$(echo $RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
  echo "Login failed. Response:"
  echo $RESPONSE
  exit 1
else
  echo "Login successful!"
  echo "Token: $TOKEN"
  # Save token to a file for other scripts to use
  echo $TOKEN > ./token.txt
fi
