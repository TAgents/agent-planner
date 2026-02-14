# AgentPlanner v2 — Production Deployment Guide

Single GCE VM running all services via Docker Compose.

## VM Sizing

- **Machine type:** e2-standard-2 (2 vCPU, 8 GB RAM)
- **Disk:** 50 GB SSD (pd-ssd)
- **OS:** Ubuntu 22.04 LTS
- **Region:** Choose closest to your users

## 1. Create GCE VM

```bash
gcloud compute instances create agentplanner \
  --machine-type=e2-standard-2 \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-ssd \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server \
  --zone=europe-north1-a

# Firewall rules
gcloud compute firewall-rules create allow-http --allow=tcp:80 --target-tags=http-server
gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server
```

## 2. VM Setup

SSH into the VM and run:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose plugin (included with Docker Engine)
docker compose version

# Clone repos
git clone <your-repo> ~/agent-planner
git clone <your-ui-repo> ~/agent-planner-ui
```

## 3. GCS Backup Bucket

```bash
gcloud storage buckets create gs://agentplanner-backups \
  --location=europe-north1 \
  --uniform-bucket-level-access

# Authenticate the VM (if using default service account, ensure Storage Admin role)
# Or use a service account key:
# gcloud auth activate-service-account --key-file=key.json
```

## 4. DNS Setup

Point your domain (e.g. `planner.example.com`) A record to the VM's external IP:

```bash
gcloud compute instances describe agentplanner --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

## 5. SSL with Certbot

First deploy without SSL (comment out the 443 server block in nginx.conf), then:

```bash
# Initial certificate
docker compose -f docker-compose.prod.yml run --rm certbot \
  certbot certonly --webroot -w /var/www/certbot \
  -d planner.example.com --agree-tos -m your@email.com

# Uncomment the 443 block in nginx.conf, then restart nginx
docker compose -f docker-compose.prod.yml restart nginx
```

## 6. Configure Environment

```bash
cp .env.production.example .env.production
# Edit .env.production with real values:
# - Generate passwords: openssl rand -hex 16
# - Generate JWT secret: openssl rand -hex 32
nano .env.production
```

## 7. First Deploy

```bash
cd ~/agent-planner

# Build and start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Check logs
docker compose -f docker-compose.prod.yml logs -f

# Get Hatchet client token (after hatchet is healthy):
# Visit http://VM_IP:8888 (temporarily expose if needed), create a token,
# add it to .env.production as HATCHET_CLIENT_TOKEN, then restart:
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## 8. Updating

```bash
cd ~/agent-planner
git pull
cd ~/agent-planner-ui
git pull
cd ~/agent-planner

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## 9. Monitoring

```bash
# Service status
docker compose -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker

# Resource usage
docker stats

# Health check
curl -s https://planner.example.com/api/health
```

## 10. Backup Verification

```bash
# Check backup logs
docker compose -f docker-compose.prod.yml logs backup

# List local backups
docker compose -f docker-compose.prod.yml exec backup ls -la /backups/

# List GCS backups
gsutil ls gs://agentplanner-backups/

# Test restore (on a separate instance!)
gunzip -c main_20260215.sql.gz | psql -U agentplanner -d agentplanner
```

## 11. Rollback

```bash
cd ~/agent-planner
git checkout <previous-commit>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Architecture

```
Internet → nginx (80/443)
              ├── /api/*  → api:3000
              ├── /api/ws → api:3000 (WebSocket)
              └── /*      → frontend:80 (static)

Internal network:
  api ──→ postgres (pgvector)
  api ──→ hatchet ──→ hatchet-postgres
  worker ──→ hatchet, api
  knowledge-worker ──→ postgres, hatchet
  backup ──→ postgres, hatchet-postgres → GCS
```
