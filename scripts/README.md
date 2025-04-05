# API Test Scripts

This directory contains shell scripts to test various endpoints of the agent-planner API.

## Prerequisites

- Bash shell
- curl
- Python (for JSON formatting)

## Getting Started

1. Make all scripts executable:
   ```
   chmod +x *.sh
   ```

2. Start with authentication:
   ```
   ./login.sh
   ```
   This will create a `token.txt` file that other scripts will use.

3. Run individual scripts as needed or run all tests:
   ```
   ./run_all_tests.sh
   ```

## Available Scripts

### Authentication
- `login.sh` - Log in with admin credentials and save the token

### Plan Management
- `create_plan.sh` - Create a new plan
- `list_plans.sh` - List all accessible plans
- `get_plan.sh` - Get details of a specific plan
- `update_plan.sh` - Update plan properties

### Node Management
- `list_nodes.sh` - List all nodes in a plan
- `create_node.sh` - Create a new node in a plan
- `get_node.sh` - Get details of a specific node
- `update_node_status.sh` - Update the status of a node

### Comments and Logs
- `add_comment.sh` - Add a comment to a node
- `get_comments.sh` - Get all comments for a node
- `add_log_entry.sh` - Add a log entry to a node
- `get_logs.sh` - Get all logs for a node

### Artifacts
- `add_artifact.sh` - Add an artifact to a node
- `get_artifacts.sh` - Get all artifacts for a node

### API Tokens
- `create_api_token.sh` - Create a new API token
- `list_api_tokens.sh` - List all API tokens
- `revoke_api_token.sh` - Revoke an API token

## Data Flow

The scripts create and use the following files to store IDs for subsequent operations:
- `token.txt` - Authentication token
- `plan_id.txt` - ID of the created plan
- `root_node_id.txt` - ID of the plan's root node
- `node_id.txt` - ID of the created node
- `comment_id.txt` - ID of the created comment
- `artifact_id.txt` - ID of the created artifact
- `api_token_id.txt` - ID of the created API token

## Running All Tests

To run all the tests in sequence:

```
./run_all_tests.sh
```

This will execute the scripts in a logical order, ensuring dependencies are satisfied.
