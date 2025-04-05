#!/bin/bash

# Make all scripts executable
echo "Making all scripts executable..."
chmod +x *.sh

# Set up terminal colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}==== STARTING COMPREHENSIVE API TEST ====${NC}"

# Login
echo -e "\n${YELLOW}==== Authentication ====${NC}"
./login.sh
if [ $? -ne 0 ]; then
  echo -e "${RED}Login failed. Cannot continue tests.${NC}"
  exit 1
fi

# Plan Management
echo -e "\n${YELLOW}==== Plan Management ====${NC}"
echo -e "${GREEN}Creating plan...${NC}"
./create_plan.sh
echo -e "${GREEN}Listing plans...${NC}"
./list_plans.sh
echo -e "${GREEN}Getting plan details...${NC}"
./get_plan.sh
echo -e "${GREEN}Updating plan...${NC}"
./update_plan.sh

# Node Management
echo -e "\n${YELLOW}==== Node Management ====${NC}"
echo -e "${GREEN}Listing nodes...${NC}"
./list_nodes.sh
echo -e "${GREEN}Creating node...${NC}"
./create_node.sh
echo -e "${GREEN}Getting node details...${NC}"
./get_node.sh
echo -e "${GREEN}Updating node status...${NC}"
./update_node_status.sh

# Comments and Logs
echo -e "\n${YELLOW}==== Comments and Logs ====${NC}"
echo -e "${GREEN}Adding comment...${NC}"
./add_comment.sh
echo -e "${GREEN}Getting comments...${NC}"
./get_comments.sh
echo -e "${GREEN}Adding log entry...${NC}"
./add_log_entry.sh
echo -e "${GREEN}Getting logs...${NC}"
./get_logs.sh

# Artifacts
echo -e "\n${YELLOW}==== Artifacts ====${NC}"
echo -e "${GREEN}Adding artifact...${NC}"
./add_artifact.sh
echo -e "${GREEN}Getting artifacts...${NC}"
./get_artifacts.sh

# API Tokens
echo -e "\n${YELLOW}==== API Tokens ====${NC}"
echo -e "${GREEN}Creating API token...${NC}"
./create_api_token.sh
echo -e "${GREEN}Listing API tokens...${NC}"
./list_api_tokens.sh
echo -e "${GREEN}Revoking API token...${NC}"
./revoke_api_token.sh

echo -e "\n${GREEN}All tests completed successfully!${NC}"
