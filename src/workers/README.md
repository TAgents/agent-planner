# Hatchet PoC — Messaging Adapters

Proof of concept for event-driven messaging adapter fan-out via Hatchet.

## Prerequisites

```bash
# Start Postgres + Hatchet
docker compose up -d

# Wait for Hatchet to be ready (~30s)
docker compose logs -f hatchet  # Look for "ready" message
```

## Get Hatchet API Token

1. Open http://localhost:8888 (Hatchet dashboard)
2. Go to Settings → API Tokens → Generate
3. Set the token:

```bash
export HATCHET_CLIENT_TOKEN="<your-token>"
```

## Run the PoC

```bash
# Terminal 1: Start the adapter workers
node --experimental-modules src/workers/poc-adapter.js

# Terminal 2: Trigger a test event
node --experimental-modules src/workers/poc-trigger.js
```

## What to expect

When you trigger an event:
1. **Console adapter** logs the request to stdout
2. **Webhook adapter** POSTs to httpbin.org (echo service)
3. **Response handler** processes the simulated agent reply

All three fire from a single `agent:request:created` event — this is the fan-out pattern we'll use for Slack, Discord, OpenClaw, etc.

## Architecture

```
Event: agent:request:created
  ├── console-adapter  (logs to stdout)
  ├── webhook-adapter  (POSTs to URL)
  └── [future: slack-adapter, discord-adapter, openclaw-adapter]

Event: agent:response:received
  └── agent-response-handler (updates DB record)
```
