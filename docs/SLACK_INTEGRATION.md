# Slack Integration Guide

AgentPlanner can send real-time notifications to Slack when agents request help, decisions are needed, or task statuses change.

## Setup

### 1. Connect Slack

1. Go to **Settings → Integrations** in AgentPlanner
2. Click **Connect Slack**
3. Authorize the AgentPlanner bot in your Slack workspace
4. Select a channel for notifications

### 2. Select a Channel

After connecting, pick the Slack channel where notifications should be posted. You can change this at any time from the Integrations settings page.

### 3. Test the Connection

Click **Send Test Message** to verify everything is working.

## What Gets Notified

| Event | Description |
|-------|-------------|
| Agent Request (Start) | 🚀 An agent was asked to start a task |
| Agent Request (Review) | 👀 An agent was asked to review work |
| Agent Request (Help) | 💡 An agent was asked for help |
| Agent Request (Continue) | ▶️ An agent was asked to continue |
| Decision Request | 🟡 A decision is needed from the plan owner |
| Blocking Decision | 🔴 An urgent blocking decision is needed |

## For Developers

### Environment Variables

To enable Slack OAuth on your own deployment:

```env
SLACK_CLIENT_ID=your_slack_app_client_id
SLACK_CLIENT_SECRET=your_slack_app_client_secret
SLACK_ENCRYPTION_KEY=random_32_char_key_for_token_encryption
```

### Creating a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app → "From scratch"
3. Add OAuth Scopes: `chat:write`, `channels:read`, `groups:read`
4. Set the redirect URL to: `https://your-api-domain/integrations/slack/callback`
5. Install the app to your workspace

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/integrations/slack/status` | Get connection status |
| GET | `/integrations/slack/install` | Get OAuth install URL |
| GET | `/integrations/slack/callback` | OAuth callback (automatic) |
| GET | `/integrations/slack/channels` | List available channels |
| PUT | `/integrations/slack/channel` | Set notification channel |
| DELETE | `/integrations/slack` | Disconnect Slack |
| POST | `/integrations/slack/test` | Send test message |

### Fallback: Polling Endpoint

If Slack is not configured, agents can still poll for pending requests using the existing API endpoints. The agent request and heartbeat APIs continue to work regardless of Slack configuration.

## Disconnecting

Go to **Settings → Integrations** and click **Disconnect** on the Slack card. This deactivates the integration but preserves the record. You can reconnect at any time.
