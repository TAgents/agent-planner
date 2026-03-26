# Slack Integration

AgentPlanner can notify you in Slack when AI agents need your attention — decisions that need input, blocked tasks, or requests for help.

---

## How it works

Notifications flow through an adapter pipeline:

```
Event (agent action / decision) → notifications.v2.js → adapter registry → SlackAdapter → your channel
```

The integration is **per-user** — each user connects their own Slack workspace. Tokens are stored encrypted (AES-256-GCM).

### What triggers a notification

| Event | Description |
|-------|-------------|
| 🚨 `decision.requested.blocking` | Agent is stuck and can't proceed — highest priority |
| 🤔 `decision.requested` | Agent needs a human decision |
| 🚀 `task.start_requested` | Human requested agent to start a task |
| 🔍 `task.review_requested` | Agent submitted work for review |
| 🆘 `task.help_requested` | Agent needs guidance |
| ▶️ `task.continue_requested` | Agent asked to resume |
| 🚫 `task.blocked` | A task became blocked |

---

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**
2. Under **OAuth & Permissions → Scopes → Bot Token Scopes**, add:
   - `chat:write`
   - `channels:read`
   - `groups:read`
3. Under **OAuth & Permissions → Redirect URLs**, add:
   ```
   https://your-domain.com/api/integrations/slack/callback
   ```
   *(replace with your actual API base URL)*
4. Go to **Basic Information → App Credentials** — copy **Client ID** and **Client Secret**

### 2. Configure environment variables

```env
# Required for Slack OAuth
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret
SLACK_ENCRYPTION_KEY=<run: openssl rand -hex 32>

# Required for correct link generation in messages
APP_URL=https://your-domain.com           # frontend URL (plan/task links)
API_BASE_URL=https://your-domain.com/api  # API URL (OAuth callback)
```

> **Dev note:** `SLACK_ENCRYPTION_KEY` falls back to `JWT_SECRET` in development. Set it explicitly in production.

### 3. Connect in AgentPlanner

1. Open **Settings → Integrations**
2. Click **Connect Slack**
3. Authorize the AgentPlanner bot in your workspace
4. Select a notification channel from the dropdown
5. Click **Test** to send a test message

---

## API Endpoints

All endpoints require authentication (`Authorization: Bearer <token>`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/integrations/slack/status` | Check connection status |
| `GET` | `/integrations/slack/install` | Get OAuth install URL |
| `GET` | `/integrations/slack/callback` | OAuth callback (auto — don't call directly) |
| `GET` | `/integrations/slack/channels` | List available channels |
| `PUT` | `/integrations/slack/channel` | Set notification channel |
| `DELETE` | `/integrations/slack` | Disconnect |
| `POST` | `/integrations/slack/test` | Send test message |

---

## Self-Hosting Notes

If you're self-hosting, you'll need to create your own Slack app (the cloud version's app won't work for a different domain).

The redirect URL in your Slack app settings must match `API_BASE_URL + /integrations/slack/callback` exactly.

---

## Troubleshooting

**"Slack integration not configured"** — `SLACK_CLIENT_ID` is missing from your environment. Restart the server after adding it.

**Test message sends but real notifications don't arrive** — Check that the notification events are actually being triggered (look at API logs). Also confirm `APP_URL` is set so links generate correctly.

**OAuth redirect fails** — The redirect URL in your Slack app settings doesn't match `API_BASE_URL`. Must be an exact match.

**Messages send but links don't work** — `APP_URL` env var isn't set or is wrong. It should be your frontend base URL (e.g. `https://agentplanner.io`).
