#!/usr/bin/env bash
set -euo pipefail

# ─── Pre-Deploy Migration Script ───────────────────────────────────
# Backs up the production database and runs pending migrations.
#
# Usage:
#   LOCAL (against local docker postgres):
#     ./scripts/pre-deploy-migrate.sh --local
#
#   PRODUCTION (SSHes to GCE VM):
#     ./scripts/pre-deploy-migrate.sh --prod
#
#   DRY RUN (show what would happen, no changes):
#     ./scripts/pre-deploy-migrate.sh --prod --dry-run
# ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_ROOT/backups"

# GCE VM config
GCP_PROJECT="ta-agent-planner"
GCP_ZONE="europe-north1-a"
VM_NAME="agentplanner-vm"
REMOTE_DIR="/opt/talkingagents/agent-planner"
COMPOSE_FILE="docker-compose.prod.yml"

# Local config
LOCAL_CONTAINER="agent-planner-postgres-1"
LOCAL_DB_USER="agentplanner"
LOCAL_DB_NAME="agentplanner"

MODE=""
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --local) MODE="local" ;;
    --prod)  MODE="prod" ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "Usage: $0 --local|--prod [--dry-run]"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ─── Helper: run SQL on the target database ────────────────────────

run_sql() {
  local sql="$1"
  if [ "$MODE" = "local" ]; then
    docker exec "$LOCAL_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -c "$sql" 2>&1
  else
    gcloud compute ssh "$VM_NAME" \
      --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
      --command="cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE exec -T postgres psql -U agentplanner -d agentplanner -c \"$sql\"" 2>&1
  fi
}

# ─── Step 1: Backup ────────────────────────────────────────────────

echo "═══ Step 1: Backup database ═══"
BACKUP_FILE="$BACKUP_DIR/pre_migrate_${MODE}_${TIMESTAMP}.sql.gz"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would backup to: $BACKUP_FILE"
else
  echo "Backing up to: $BACKUP_FILE"
  if [ "$MODE" = "local" ]; then
    docker exec "$LOCAL_CONTAINER" pg_dump -U "$LOCAL_DB_USER" "$LOCAL_DB_NAME" | gzip > "$BACKUP_FILE"
  else
    gcloud compute ssh "$VM_NAME" \
      --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
      --command="cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE exec -T postgres pg_dump -U agentplanner agentplanner" \
      | gzip > "$BACKUP_FILE"
  fi
  echo "Backup complete: $(ls -lh "$BACKUP_FILE" | awk '{print $5}')"
fi

# ─── Step 2: Seed schema_migrations if needed ──────────────────────

echo ""
echo "═══ Step 2: Check migration tracker ═══"

HAS_TRACKER=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'schema_migrations');" | grep -o '[tf]' | head -1)

if [ "$HAS_TRACKER" = "t" ]; then
  echo "schema_migrations table exists, checking applied migrations..."
  run_sql "SELECT name FROM schema_migrations ORDER BY name;"
else
  echo "No schema_migrations table found — database was set up with db:push."
  echo "Seeding tracker with already-applied migrations..."

  # Detect which migrations are already applied by checking table/column existence
  SEED_SQL="CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());"

  # 0000: base tables — always applied if DB exists
  SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0000_silent_dakota_north.sql') ON CONFLICT DO NOTHING;"

  # 0001: knowledge_entries.embedding column
  HAS_KE=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'knowledge_entries');" | grep -o '[tf]' | head -1)
  if [ "$HAS_KE" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0001_knowledge_vector.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0002: unique constraint on plan_nodes
  HAS_UNQ=$(run_sql "SELECT EXISTS (SELECT FROM pg_constraint WHERE conname = 'plan_nodes_unique_title_per_parent');" | grep -o '[tf]' | head -1)
  if [ "$HAS_UNQ" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0002_unique_node_title_per_parent.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0003: task_mode column + node_dependencies table
  HAS_TM=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'plan_nodes' AND column_name = 'task_mode');" | grep -o '[tf]' | head -1)
  if [ "$HAS_TM" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0003_task_mode_and_dependencies.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0004: organizations + organization_id on plans
  HAS_ORG=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'organization_id');" | grep -o '[tf]' | head -1)
  if [ "$HAS_ORG" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0004_add_missing_organization_id.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0005: knowledge_entries dropped
  if [ "$HAS_KE" = "f" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0005_drop_knowledge_entries.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0006: is_admin on users
  HAS_ADMIN=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_admin');" | grep -o '[tf]' | head -1)
  if [ "$HAS_ADMIN" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0006_add_user_is_admin.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0007: target_goal_id on node_dependencies
  HAS_TGI=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'node_dependencies' AND column_name = 'target_goal_id');" | grep -o '[tf]' | head -1)
  if [ "$HAS_TGI" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0007_goal_dependency_targets.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0008: goal_links table exists (v2 goals schema)
  HAS_GL=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'goal_links');" | grep -o '[tf]' | head -1)
  if [ "$HAS_GL" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0008_goals_schema_v2.sql') ON CONFLICT DO NOTHING;"
  fi

  # 0009: node_claims table
  HAS_NC=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'node_claims');" | grep -o '[tf]' | head -1)
  if [ "$HAS_NC" = "t" ]; then
    SEED_SQL="$SEED_SQL INSERT INTO schema_migrations (name) VALUES ('0009_add_node_claims.sql') ON CONFLICT DO NOTHING;"
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would run seed SQL:"
    echo "$SEED_SQL" | tr ';' '\n'
  else
    run_sql "$SEED_SQL"
    echo "Seeded. Current state:"
    run_sql "SELECT name FROM schema_migrations ORDER BY name;"
  fi
fi

# ─── Step 3: Run migrations ───────────────────────────────────────

echo ""
echo "═══ Step 3: Run pending migrations ═══"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would run: node scripts/run-migrations.mjs"
  echo "Pending migrations can be checked against schema_migrations table."
else
  if [ "$MODE" = "local" ]; then
    cd "$PROJECT_ROOT"
    DATABASE_URL="postgresql://${LOCAL_DB_USER}:localdevpassword@127.0.0.1:5433/${LOCAL_DB_NAME}" node scripts/run-migrations.mjs
  else
    # Copy migration files to VM, then run
    echo "Syncing migration files to VM..."
    gcloud compute scp --recurse \
      "$PROJECT_ROOT/migrations" "$PROJECT_ROOT/scripts/run-migrations.mjs" \
      "$VM_NAME:$REMOTE_DIR/migrations/" \
      --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap 2>&1

    gcloud compute ssh "$VM_NAME" \
      --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
      --command="cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE exec -T api node scripts/run-migrations.mjs" 2>&1
  fi
fi

# ─── Step 4: Verify ───────────────────────────────────────────────

echo ""
echo "═══ Step 4: Verify ═══"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would verify tables and migration state."
else
  echo "Applied migrations:"
  run_sql "SELECT name, applied_at FROM schema_migrations ORDER BY name;"
  echo ""
  echo "Tables:"
  run_sql "\dt"
fi

echo ""
echo "═══ Done ═══"
