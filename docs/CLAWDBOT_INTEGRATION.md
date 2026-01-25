# Clawdbot Integration Plan

## Overview

This document outlines the integration strategy for connecting [Clawdbot](https://github.com/clawdbot/clawdbot) with the Agent Planner system, enabling users to create, manage, and collaborate on plans through various messaging platforms (Telegram, Discord, Slack, WhatsApp, etc.).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Messaging Platforms                              │
│  (Telegram, Discord, Slack, WhatsApp, Teams, Signal, etc.)              │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Clawdbot Gateway                                   │
│                    ws://127.0.0.1:18789                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                 Agent Planner Skill                              │    │
│  │  - Plan Commands Handler                                         │    │
│  │  - WebSocket Client (real-time sync)                             │    │
│  │  - API Client (REST operations)                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────────────────┐
│   Agent Planner REST API    │  │   Agent Planner WebSocket Server        │
│   https://api.example.com   │  │   wss://api.example.com/ws/collaborate  │
│                             │  │                                          │
│   - POST /plans             │  │   - Real-time plan updates               │
│   - GET /plans              │  │   - Node status changes                  │
│   - POST /plans/:id/nodes   │  │   - Collaboration events                 │
│   - PUT /nodes/:id          │  │   - Presence tracking                    │
│   - GET /plans/:id/progress │  │                                          │
└─────────────────────────────┘  └─────────────────────────────────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       PostgreSQL (Supabase)                              │
│   plans, plan_nodes, plan_comments, plan_node_logs, etc.                │
└─────────────────────────────────────────────────────────────────────────┘
```

## Integration Components

### 1. Clawdbot Skill Module

A skill is a modular extension for Clawdbot. We'll create an `agent-planner` skill that:

- Connects to the Agent Planner API using API key authentication
- Maintains a WebSocket connection for real-time updates
- Handles natural language commands from users
- Sends plan notifications to messaging channels

**Skill Location:** `~/.clawdbot/skills/agent-planner/`

### 2. Authentication

The integration uses **API Key Tokens** for programmatic access:

1. User generates an API token in Agent Planner UI
2. Token is configured in clawdbot skill settings
3. All API requests include `Authorization: Bearer <token>` header
4. WebSocket connections authenticate via token query parameter

### 3. Command Interface

Users interact with plans through natural language or slash commands:

| Command | Description | Example |
|---------|-------------|---------|
| `/plan create` | Create a new plan | `/plan create "Website Redesign"` |
| `/plan list` | List all plans | `/plan list` |
| `/plan show` | Show plan details | `/plan show #plan-123` |
| `/plan add task` | Add task to plan | `/plan add task "Design homepage" to #plan-123` |
| `/plan add phase` | Add phase to plan | `/plan add phase "Development" to #plan-123` |
| `/plan status` | Update node status | `/plan status #task-456 completed` |
| `/plan progress` | Show plan progress | `/plan progress #plan-123` |
| `/plan assign` | Assign user to task | `/plan assign @user to #task-456` |
| `/plan comment` | Add comment to node | `/plan comment #task-456 "Started implementation"` |
| `/plan log` | Add activity log | `/plan log #task-456 "Completed API integration"` |
| `/plan search` | Search across plans | `/plan search "authentication"` |
| `/plan subscribe` | Subscribe to updates | `/plan subscribe #plan-123` |
| `/plan help` | Show help | `/plan help` |

### 4. Natural Language Support

The skill also supports natural language queries powered by Claude:

- "Create a plan for building a mobile app"
- "What's the progress on the website redesign?"
- "Add a task to deploy to production"
- "Show me all my active plans"
- "Mark the authentication task as complete"

### 5. Real-time Notifications

When subscribed to a plan, users receive notifications for:

- New tasks/phases added
- Status changes (in_progress, completed, blocked)
- Comments and activity logs
- Assignment changes
- Collaborator additions

## Implementation Files

### Skill Structure

```
~/.clawdbot/skills/agent-planner/
├── manifest.json           # Skill metadata and configuration
├── index.js                # Main skill entry point
├── lib/
│   ├── api-client.js       # REST API client
│   ├── ws-client.js        # WebSocket client for real-time
│   ├── command-parser.js   # Parse user commands
│   └── formatter.js        # Format responses for messaging
├── commands/
│   ├── create.js           # Create plan command
│   ├── list.js             # List plans command
│   ├── show.js             # Show plan details
│   ├── add.js              # Add node (task/phase/milestone)
│   ├── status.js           # Update status
│   ├── assign.js           # Assign users
│   ├── comment.js          # Add comments
│   ├── log.js              # Add activity logs
│   ├── progress.js         # Show progress
│   ├── search.js           # Search plans
│   └── subscribe.js        # Subscribe to updates
└── config.schema.json      # Configuration schema
```

### API Client Features

```javascript
// Core operations
client.plans.create({ title, description, status })
client.plans.list({ status, limit, page })
client.plans.get(planId)
client.plans.update(planId, { title, description, status })
client.plans.delete(planId)
client.plans.getProgress(planId)

// Node operations
client.nodes.create(planId, { title, node_type, parent_id, ... })
client.nodes.update(nodeId, { title, status, ... })
client.nodes.delete(nodeId)
client.nodes.move(nodeId, { new_parent_id, new_order })

// Collaboration
client.nodes.assign(nodeId, userId)
client.nodes.comment(nodeId, { content, comment_type: 'agent' })
client.nodes.log(nodeId, { content, log_type, tags })

// Search
client.search.query({ q, type, status, ... })
```

### WebSocket Events

The skill listens to and broadcasts these events:

**Incoming (from Agent Planner):**
- `plan:updated` - Plan metadata changed
- `node:created` - New node added
- `node:updated` - Node status/content changed
- `node:deleted` - Node removed
- `comment:added` - New comment on node
- `log:added` - New activity log
- `user:assigned` - User assigned to node

**Outgoing (to Agent Planner):**
- `subscribe:plan` - Subscribe to plan updates
- `unsubscribe:plan` - Unsubscribe from plan
- `typing:start` - User is typing a comment
- `presence:update` - Update user presence

## Configuration

### Clawdbot Skill Configuration

```json
{
  "skills": {
    "agent-planner": {
      "enabled": true,
      "api_url": "https://api.agentplanner.example.com",
      "ws_url": "wss://api.agentplanner.example.com/ws/collaborate",
      "api_token": "${AGENT_PLANNER_TOKEN}",
      "default_channel": "#planning",
      "notification_settings": {
        "on_task_created": true,
        "on_status_change": true,
        "on_comment": true,
        "on_assignment": true
      }
    }
  }
}
```

### Environment Variables

```bash
AGENT_PLANNER_API_URL=https://api.agentplanner.example.com
AGENT_PLANNER_TOKEN=your-64-character-api-token
AGENT_PLANNER_WS_URL=wss://api.agentplanner.example.com/ws/collaborate
```

## Agent Planner API Additions

### Webhook Endpoint (Optional)

For platforms that prefer webhooks over WebSocket:

```
POST /webhooks/clawdbot
```

Receives events and forwards them to clawdbot gateway.

### Bot User Type

Plans can be created by bot users with `user_type: 'bot'`:

```javascript
{
  id: "clawdbot-user-uuid",
  email: "clawdbot@system.local",
  user_type: "bot",
  display_name: "Clawdbot",
  metadata: {
    bot_type: "clawdbot",
    platform: "telegram"  // or discord, slack, etc.
  }
}
```

## Usage Examples

### Creating a Plan via Telegram

```
User: /plan create "Q1 Product Launch"

Clawdbot: Created plan "Q1 Product Launch"
          ID: #plan-abc123
          Status: draft

          Add tasks with:
          /plan add task "Task name" to #plan-abc123
```

### Adding Tasks and Phases

```
User: /plan add phase "Research" to #plan-abc123

Clawdbot: Added phase "Research" to Q1 Product Launch
          Phase ID: #phase-def456

User: /plan add task "Competitor analysis" to #phase-def456

Clawdbot: Added task "Competitor analysis" to Research
          Task ID: #task-ghi789
          Status: not_started
```

### Checking Progress

```
User: /plan progress #plan-abc123

Clawdbot: Q1 Product Launch Progress
          ████████░░░░░░░░░░░░ 40%

          ✅ Completed: 4 tasks
          🔄 In Progress: 2 tasks
          ⏳ Not Started: 4 tasks
          🚫 Blocked: 0 tasks
```

### Natural Language Interaction

```
User: What's the status of our website redesign project?

Clawdbot: Website Redesign (#plan-xyz789) is 65% complete.

          Current phase: Development
          - ✅ Homepage design (completed)
          - ✅ Component library (completed)
          - 🔄 API integration (in_progress, assigned to @john)
          - ⏳ Testing (not_started)

          Next milestone: Beta launch (due in 5 days)
```

### Receiving Notifications

```
Clawdbot: [Plan Update] Website Redesign

          @john completed "API integration"
          Progress: 65% → 75%

          Next task: Testing (not_started)
```

## Security Considerations

1. **API Token Security**: Store tokens securely in environment variables
2. **Permission Scoping**: Create tokens with minimal required permissions
3. **Rate Limiting**: Respect API rate limits (configured in skill)
4. **Audit Logging**: All clawdbot actions logged with `comment_type: 'agent'`
5. **Channel Restrictions**: Limit plan access to specific channels/users

## Implementation Phases

### Phase 1: Core Integration
- [ ] Create skill manifest and basic structure
- [ ] Implement API client with authentication
- [ ] Add basic commands (create, list, show)
- [ ] Test with single messaging platform

### Phase 2: Full Command Set
- [ ] Implement all plan commands
- [ ] Add node operations (add, update, delete)
- [ ] Implement status updates and progress tracking
- [ ] Add search functionality

### Phase 3: Real-time Features
- [ ] WebSocket client implementation
- [ ] Subscription management
- [ ] Real-time notifications
- [ ] Presence tracking

### Phase 4: Advanced Features
- [ ] Natural language processing
- [ ] Multi-platform support
- [ ] Webhook fallback for platforms without WebSocket
- [ ] Analytics and usage tracking

## Related Resources

- [Agent Planner API Documentation](/docs/API.md)
- [WebSocket Event Schema](/src/websocket/message-schema.js)
- [Authentication Guide](/docs/AUTHENTICATION.md)
- [Clawdbot Skills Guide](https://github.com/clawdbot/clawdbot/docs/skills.md)
