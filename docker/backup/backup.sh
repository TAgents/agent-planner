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

# Upload to GCS
if [ -n "${GCS_BUCKET:-}" ]; then
  echo "Uploading to gs://${GCS_BUCKET}/..."
  gsutil -m cp "${BACKUP_DIR}/main_${TIMESTAMP}.sql.gz" "gs://${GCS_BUCKET}/main_${TIMESTAMP}.sql.gz"
  echo "Upload complete."
else
  echo "GCS_BUCKET not set, skipping upload."
fi

# Cleanup old local backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date +%Y%m%d_%H%M%S)] Backup complete."
