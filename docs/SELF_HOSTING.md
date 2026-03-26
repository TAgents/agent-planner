# Self-Hosting AgentPlanner

This guide covers everything you need to run AgentPlanner on your own server — from a quick local test to a production deployment with HTTPS, backups, and automatic renewal.

> **Don't want to self-host?** Sign up at [agentplanner.io](https://agentplanner.io) — no setup required.

---

## Contents

1. [Requirements](#requirements)
2. [Quick Start (Local / Dev)](#quick-start-local--dev)
3. [Production Deployment (HTTPS)](#production-deployment-https)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Backups](#backups)
6. [Upgrades](#upgrades)
7. [Migrating from Cloud to Self-Hosted](#migrating-from-cloud-to-self-hosted)
8. [Troubleshooting](#troubleshooting)

---

## Requirements

### Hardware (minimum)

| | Dev / Test | Production |
|---|---|---|
| **CPU** | 2 cores | 2+ cores |
| **RAM** | 4 GB | 4 GB (8 GB recommended with knowledge graph) |
| **Disk** | 10 GB | 20 GB+ |

### Software

- **Docker 24+** and **Docker Compose v2** (`docker compose` not `docker-compose`)
- A domain name pointed at your server (production only)
- An **OpenAI API key** — required for the knowledge graph (Graphiti). Without it, the core planning features still work but knowledge graph indexing is disabled.

### Ports used

| Port | Service |
|---|---|
| `80` | HTTP (redirects to HTTPS in production) |
| `443` | HTTPS (production) |
| `3000` | API (dev only — not exposed in production) |
| `3001` | Frontend (dev only) |
| `5433` | PostgreSQL (dev only) |

---

## Quick Start (Local / Dev)

The fastest way to get AgentPlanner running locally:

```bash
# 1. Clone
git clone https://github.com/TAgents/agent-planner.git
cd agent-planner

# 2. Configure environment
cp .env.example .env
# Open .env and at minimum set:
#   JWT_SECRET=<any random string for local use>
#   OPENAI_API_KEY=<your key>  ← only needed for knowledge graph

# 3. Start everything
docker compose --profile core up -d

# 4. Run migrations (first time only)
docker compose exec api npm run db:init

# 5. Verify
curl http://localhost:3000/health
```

The API is available at `http://localhost:3000`.

> **Note:** The frontend container expects the UI repo at `../agent-planner-ui`.
> If you only need the API, omit the frontend by editing the compose file.

### Clone the UI too (optional)

```bash
cd ..
git clone https://github.com/TAgents/agent-planner-ui.git
cd agent-planner
docker compose --profile core up -d  # now includes frontend at :3001
```

---

## Production Deployment (HTTPS)

### Step 1 — Clone and configure

```bash
git clone https://github.com/TAgents/agent-planner.git
git clone https://github.com/TAgents/agent-planner-ui.git
git clone https://github.com/TAgents/agent-planner-mcp.git

cd agent-planner
cp .env.production.example .env.production
```

Edit `.env.production` and fill in all required values:

```env
DOMAIN=planner.example.com          # your actual domain

POSTGRES_USER=agentplanner
POSTGRES_PASSWORD=<strong random password>
POSTGRES_DB=agentplanner

JWT_SECRET=<run: openssl rand -hex 32>
OPENAI_API_KEY=<your OpenAI key>
```

### Step 2 — Configure Nginx

The nginx config is at `docker/nginx/nginx.conf`. Update the domain in the SSL certificate paths (two occurrences):

```nginx
ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;
```

Replace `YOUR_DOMAIN` with your actual domain (e.g. `planner.example.com`).

### Step 3 — Bootstrap SSL (first time only)

Nginx won't start without existing certificates, and Certbot needs a running HTTP server to issue them. We solve this with a temporary self-signed cert:

```bash
# Create a temporary self-signed cert so nginx can start
mkdir -p docker/certbot/conf/live/$DOMAIN
openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
  -keyout docker/certbot/conf/live/$DOMAIN/privkey.pem \
  -out docker/certbot/conf/live/$DOMAIN/fullchain.pem \
  -subj "/CN=localhost"

# Map the certbot volume to this directory
# Start only nginx (HTTP) so certbot can validate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx
```

Now issue the real certificate:

```bash
# Issue certificate via certbot
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d $DOMAIN \
  --email your@email.com \
  --agree-tos \
  --no-eff-email

# Reload nginx to pick up the real cert
docker compose -f docker-compose.prod.yml --env-file .env.production exec nginx nginx -s reload
```

### Step 4 — Start all services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### Step 5 — Run migrations

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api npm run db:init
```

### Step 6 — Verify

```bash
# Health check
curl https://your-domain.com/api/health

# Check all containers are running
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

SSL certificates auto-renew — the certbot container runs a renewal check every 12 hours and nginx reloads every 6 hours to pick up new certs.

---

## Environment Variables Reference

### Required

| Variable | Description |
|---|---|
| `DOMAIN` | Your domain name (production) |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password — **use a strong password in production** |
| `POSTGRES_DB` | PostgreSQL database name |
| `JWT_SECRET` | Secret key for JWT signing — **generate with `openssl rand -hex 32`** |
| `OPENAI_API_KEY` | Required for knowledge graph (Graphiti). Without it, knowledge indexing is disabled |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API server port |
| `FRONTEND_URL` | `http://localhost:3001` | Frontend origin (for CORS) |
| `GRAPHITI_INTERNAL_URL` | `http://graphiti:8000` | Internal Graphiti service URL |
| `ANTHROPIC_API_KEY` | — | For AI reasoning features |
| `SLACK_BOT_TOKEN` | — | Slack notifications integration |
| `GCS_BACKUP_BUCKET` | — | Google Cloud Storage bucket for backups |

### Dev-only

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PORT` | `5433` | Host port for PostgreSQL (dev) |
| `API_PORT` | `3000` | Host port for API (dev) |
| `FRONTEND_PORT` | `3001` | Host port for frontend (dev) |

---

## Backups

### Automatic backups (production)

The `backup` service in `docker-compose.prod.yml` runs daily at 2am UTC. It backs up:
- PostgreSQL database (compressed SQL dump)
- FalkorDB graph data (RDB snapshot)

**With Google Cloud Storage:**

Set `GCS_BACKUP_BUCKET` in `.env.production`:
```env
GCS_BACKUP_BUCKET=my-agentplanner-backups
```

You'll also need to mount a service account key — or run on a GCE VM with the right IAM role. Without GCS configured, backups are kept locally in the `backup-data` Docker volume (30-day retention).

**Without GCS (local only):**

Leave `GCS_BACKUP_BUCKET` empty. Backups accumulate in the Docker volume. To copy them out:

```bash
# Copy latest backup to host
docker compose -f docker-compose.prod.yml exec backup \
  ls -lt /backups/ | head -5

docker cp $(docker compose -f docker-compose.prod.yml ps -q backup):/backups/main_TIMESTAMP.sql.gz ./
```

### Manual backup

```bash
# Backup now
docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup.sh

# Or directly with pg_dump
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U agentplanner agentplanner | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Restore from backup

```bash
# Stop the API first to prevent writes
docker compose -f docker-compose.prod.yml stop api

# Restore
gunzip -c backup_YYYYMMDD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U agentplanner agentplanner

# Start again
docker compose -f docker-compose.prod.yml start api
```

---

## Upgrades

Upgrading is a pull + rebuild. Migrations run automatically on container start.

```bash
cd agent-planner

# 1. Pull latest
git pull origin main
cd ../agent-planner-ui && git pull origin main && cd ../agent-planner
cd ../agent-planner-mcp && git pull origin main && cd ../agent-planner

# 2. Rebuild and restart (zero-downtime for stateless services)
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --build --no-deps api frontend mcp

# 3. Migrations run automatically on api startup (scripts/run-migrations.mjs)
# Watch logs to confirm:
docker compose -f docker-compose.prod.yml logs -f api --tail=50
```

> **Always read the [CHANGELOG](../CHANGELOG.md) before upgrading** — breaking changes and migration notes are listed there.

### Rollback

```bash
# Roll back to a specific commit
git checkout <commit-hash>
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --build --no-deps api
```

---

## Migrating from Cloud to Self-Hosted

There is no automated export tool yet. The recommended path:

1. **Export your data** — use the API to read your plans, nodes, and knowledge episodes and save them as JSON.
2. **Set up self-hosted** — follow this guide through Step 6.
3. **Re-import** — use the API to recreate plans and nodes. Knowledge episodes can be re-added via `POST /api/knowledge/episodes`.

A one-click export/import feature is planned for a future release.

---

## Troubleshooting

### `docker compose` command not found

You need Docker Compose v2 (bundled with Docker Desktop, or install the plugin):

```bash
# Check version
docker compose version  # should be v2.x

# On Linux, install plugin if missing
apt install docker-compose-plugin
```

### API not starting — "Cannot connect to database"

The API waits for postgres to be healthy, but if it keeps failing:

```bash
# Check postgres logs
docker compose logs postgres

# Manually test connection
docker compose exec postgres pg_isready -U agentplanner
```

### SSL cert not found (nginx exits immediately)

Make sure you ran the bootstrap step (Step 3 above). The cert paths must exist before nginx starts.

```bash
# Confirm cert exists
ls docker/certbot/conf/live/YOUR_DOMAIN/
```

### Certbot rate limits

Let's Encrypt allows ~5 certificates per domain per week. If you've hit limits during testing, use the `--staging` flag:

```bash
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d $DOMAIN \
  --staging   # ← remove this for the real cert
```

### Knowledge graph not working

Check if Graphiti started successfully:

```bash
docker compose logs graphiti | tail -20

# Graphiti requires OpenAI — verify the key is set
docker compose exec api env | grep OPENAI
```

### Out of disk space

```bash
# See which volumes are largest
docker system df -v

# Clean up unused images / stopped containers
docker system prune

# Check backup volume
docker compose exec backup du -sh /backups/
```

### Reset everything (⚠️ destructive)

```bash
docker compose -f docker-compose.prod.yml down -v  # -v removes volumes too
```

---

## Getting Help

- **GitHub Issues:** [github.com/TAgents/agent-planner/issues](https://github.com/TAgents/agent-planner/issues)
- **Cloud version:** [agentplanner.io](https://agentplanner.io) — managed, no ops required
- **Docs:** [docs/](.) folder in this repo
