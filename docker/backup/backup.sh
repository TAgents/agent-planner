#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
RETENTION_DAYS=30

echo "[${TIMESTAMP}] Starting backup..."

# Main database
echo "Backing up main database..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h postgres -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip > "${BACKUP_DIR}/main_${TIMESTAMP}.sql.gz"

# FalkorDB (graph database — RDB dump via redis-cli)
echo "Backing up FalkorDB..."
if redis-cli -h falkordb BGSAVE 2>/dev/null; then
  sleep 2
  redis-cli -h falkordb --rdb "${BACKUP_DIR}/falkordb_${TIMESTAMP}.rdb" 2>/dev/null \
    && gzip "${BACKUP_DIR}/falkordb_${TIMESTAMP}.rdb" \
    && echo "FalkorDB backup complete." \
    || echo "Warning: FalkorDB backup failed (non-critical)."
else
  echo "FalkorDB not available, skipping."
fi

# Upload to GCS
if [ -n "${GCS_BUCKET:-}" ]; then
  echo "Uploading to gs://${GCS_BUCKET}/..."
  gsutil -m cp "${BACKUP_DIR}/main_${TIMESTAMP}.sql.gz" "gs://${GCS_BUCKET}/main_${TIMESTAMP}.sql.gz"
  # Upload FalkorDB backup if it exists
  if [ -f "${BACKUP_DIR}/falkordb_${TIMESTAMP}.rdb.gz" ]; then
    gsutil -m cp "${BACKUP_DIR}/falkordb_${TIMESTAMP}.rdb.gz" "gs://${GCS_BUCKET}/falkordb_${TIMESTAMP}.rdb.gz"
  fi
  echo "Upload complete."
else
  echo "GCS_BUCKET not set, skipping upload."
fi

# Cleanup old local backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "*.rdb.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date +%Y%m%d_%H%M%S)] Backup complete."
