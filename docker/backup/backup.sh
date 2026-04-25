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

# Neo4j (graph database — Cypher export via APOC over HTTP)
# The neo4j service mounts ${BACKUP_DIR} so apoc.export writes land here directly.
echo "Backing up Neo4j..."
NEO4J_DUMP_NAME="neo4j_${TIMESTAMP}.cypher"
NEO4J_AUTH_HEADER=$(printf 'neo4j:%s' "${NEO4J_PASSWORD:-}" | base64)
if curl -sf -u "neo4j:${NEO4J_PASSWORD:-}" \
     -H "Content-Type: application/json" \
     -X POST "http://neo4j:7474/db/neo4j/tx/commit" \
     -d "{\"statements\":[{\"statement\":\"CALL apoc.export.cypher.all('${NEO4J_DUMP_NAME}', {format:'plain'})\"}]}" \
     > /dev/null 2>&1; then
  if [ -f "${BACKUP_DIR}/${NEO4J_DUMP_NAME}" ]; then
    gzip "${BACKUP_DIR}/${NEO4J_DUMP_NAME}" \
      && echo "Neo4j backup complete." \
      || echo "Warning: Neo4j gzip failed (non-critical)."
  else
    echo "Warning: Neo4j export ran but file not found (non-critical)."
  fi
else
  echo "Neo4j not available, skipping."
fi

# Upload to GCS
if [ -n "${GCS_BUCKET:-}" ]; then
  echo "Uploading to gs://${GCS_BUCKET}/..."
  gsutil -m cp "${BACKUP_DIR}/main_${TIMESTAMP}.sql.gz" "gs://${GCS_BUCKET}/main_${TIMESTAMP}.sql.gz"
  # Upload Neo4j backup if it exists
  if [ -f "${BACKUP_DIR}/${NEO4J_DUMP_NAME}.gz" ]; then
    gsutil -m cp "${BACKUP_DIR}/${NEO4J_DUMP_NAME}.gz" "gs://${GCS_BUCKET}/${NEO4J_DUMP_NAME}.gz"
  fi
  echo "Upload complete."
else
  echo "GCS_BUCKET not set, skipping upload."
fi

# Cleanup old local backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "*.cypher.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date +%Y%m%d_%H%M%S)] Backup complete."
