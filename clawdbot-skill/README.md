# Agent Planner Skill for Clawdbot

Manage your plans through any messaging platform using [Clawdbot](https://github.com/clawdbot/clawdbot).

## Features

- Create and manage plans via Telegram, Discord, Slack, WhatsApp, and more
- Add tasks, phases, and milestones with simple commands
- Track progress and update statuses
- Get real-time notifications on plan changes
- Natural language support for common operations

## Installation

### Via Clawdbot CLI

```bash
clawdbot skills install @agent-planner/clawdbot-skill
```

### Manual Installation

```bash
# Clone or copy to skills directory
cp -r clawdbot-skill ~/.clawdbot/skills/agent-planner

# Install dependencies
cd ~/.clawdbot/skills/agent-planner
npm install
```

## Configuration

1. Generate an API token in Agent Planner settings
2. Configure the skill:

```bash
clawdbot config set skills.agent-planner.api_url "https://api.agentplanner.app"
clawdbot config set skills.agent-planner.api_token "your-token-here"
```

Or edit `~/.clawdbot/clawdbot.json`:

```json
{
  "skills": {
    "agent-planner": {
      "enabled": true,
      "api_url": "https://api.agentplanner.app",
      "api_token": "${AGENT_PLANNER_TOKEN}",
      "ws_url": "wss://api.agentplanner.app/ws/collaborate",
      "notifications": {
        "on_task_created": true,
        "on_status_change": true,
        "on_comment": true,
        "on_assignment": true
      }
    }
  }
}
```

## Commands

### Plan Management

| Command | Description |
|---------|-------------|
| `/plan create "Title"` | Create a new plan |
| `/plan list [status]` | List your plans |
| `/plan show <id>` | Show plan details |
| `/plan progress <id>` | Show plan progress |
| `/plan delete <id>` | Delete a plan |
| `/plan subscribe <id>` | Subscribe to updates |
| `/plan unsubscribe <id>` | Unsubscribe from updates |

### Task Management

| Command | Description |
|---------|-------------|
| `/task add "Title" to <parent>` | Add a task |
| `/task status <id> <status>` | Update task status |
| `/task assign <id> @user` | Assign user to task |
| `/task comment <id> "Message"` | Add a comment |
| `/task log <id> "Message"` | Add activity log |

**Valid statuses:** `not_started`, `in_progress`, `completed`, `blocked`

### Phase Management

| Command | Description |
|---------|-------------|
| `/phase add "Title" to <plan>` | Add a phase |
| `/phase list <plan>` | List phases in plan |

### Milestone Management

| Command | Description |
|---------|-------------|
| `/milestone add "Title" to <parent>` | Add a milestone |
| `/milestone list <plan>` | List milestones |

## Natural Language

The skill also understands natural language:

- "Create a plan for building a mobile app"
- "What's the progress on the website redesign?"
- "Add a task to deploy to production"
- "Show me all my active plans"
- "Mark the authentication task as complete"

## Examples

### Creating a Project Plan

```
User: /plan create "Website Redesign"
Bot: Created plan "Website Redesign"
     ID: #plan-abc12345
     Status: draft

User: /phase add "Design" to #plan-abc12345
Bot: Added phase "Design" to Website Redesign
     Phase ID: #phase-def67890

User: /task add "Create wireframes" to #phase-def67890
Bot: Added task "Create wireframes" to Design
     Task ID: #task-ghi11111
     Status: not_started
```

### Tracking Progress

```
User: /plan progress #plan-abc12345
Bot: Website Redesign Progress
     ████████░░░░░░░░░░░░ 40%

     Completed: 4 tasks
     In Progress: 2 tasks
     Not Started: 4 tasks
```

### Updating Status

```
User: /task status #task-ghi11111 completed
Bot: Updated "Create wireframes"
     Status: completed
```

## Real-time Notifications

When subscribed to a plan, you'll receive notifications for:

- New tasks and phases added
- Status changes
- Comments and activity logs
- User assignments

Subscribe with: `/plan subscribe #plan-abc12345`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_PLANNER_API_URL` | API base URL |
| `AGENT_PLANNER_TOKEN` | Authentication token |
| `AGENT_PLANNER_WS_URL` | WebSocket URL for real-time updates |

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint
```

## License

MIT
