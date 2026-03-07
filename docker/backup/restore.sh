#!/bin/bash
# docker/backup/restore.sh
# ─────────────────────────────────────────────────────────────────────────────
# Restore a backup created by backup.sh.
#
# Usage:
#   # Restore latest local backup:
#   ./restore.sh
#
#   # Restore specific local file:
#   ./restore.sh /backups/prod_20240315_020000.dump.gz
#
#   # Restore from B2 (downloads first):
#   RESTORE_FROM_CLOUD=true RESTORE_FILENAME=prod_20240315_020000.dump.gz ./restore.sh
#
# Required env:
#   DATABASE_URL          — target postgres connection string
#
# Required for cloud restore:
#   RESTORE_FROM_CLOUD=true
#   RESTORE_FILENAME      — exact filename in B2
#   B2_ACCOUNT_ID, B2_ACCOUNT_KEY, B2_BUCKET, B2_PATH
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

log()  { echo "[restore] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() { echo "[restore] ❌ ERROR: $*" >&2; exit 1; }

# ── Validate ──────────────────────────────────────────────────────────────────
[[ -z "${DATABASE_URL:-}" ]] && fail "DATABASE_URL is not set"

RESTORE_FROM_CLOUD="${RESTORE_FROM_CLOUD:-false}"
B2_PATH="${B2_PATH:-postgres}"
BACKUP_DIR="/backups"

# ── Determine file to restore ─────────────────────────────────────────────────
if [[ "${RESTORE_FROM_CLOUD}" == "true" ]]; then
  [[ -z "${RESTORE_FILENAME:-}" ]] && fail "RESTORE_FILENAME must be set for cloud restore"
  [[ -z "${B2_ACCOUNT_ID:-}" ]]   && fail "B2_ACCOUNT_ID is required"
  [[ -z "${B2_ACCOUNT_KEY:-}" ]]  && fail "B2_ACCOUNT_KEY is required"
  [[ -z "${B2_BUCKET:-}" ]]       && fail "B2_BUCKET is required"

  RESTORE_FILE="${BACKUP_DIR}/${RESTORE_FILENAME}"

  log "Downloading ${RESTORE_FILENAME} from B2..."
  export RCLONE_CONFIG_B2_TYPE=b2
  export RCLONE_CONFIG_B2_ACCOUNT="${B2_ACCOUNT_ID}"
  export RCLONE_CONFIG_B2_KEY="${B2_ACCOUNT_KEY}"

  rclone copy \
    "B2:${B2_BUCKET}/${B2_PATH}/${RESTORE_FILENAME}" \
    "${BACKUP_DIR}/" \
    --progress \
    || fail "Failed to download from B2"

  log "Download complete"

elif [[ -n "${1:-}" ]]; then
  RESTORE_FILE="$1"
else
  # Find the latest local backup
  RESTORE_FILE=$(ls -t "${BACKUP_DIR}"/*.dump.gz 2>/dev/null | head -1)
  [[ -z "${RESTORE_FILE}" ]] && fail "No backup files found in ${BACKUP_DIR}"
  log "No file specified — using latest: $(basename "${RESTORE_FILE}")"
fi

[[ ! -f "${RESTORE_FILE}" ]] && fail "Backup file not found: ${RESTORE_FILE}"

# ── Safety prompt ─────────────────────────────────────────────────────────────
log "⚠️  About to restore: $(basename "${RESTORE_FILE}")"
log "⚠️  Target: ${DATABASE_URL//:*@/:***@}"
log "⚠️  This will DROP and recreate the public schema. All existing data will be lost."

if [[ "${FORCE_RESTORE:-false}" != "true" ]]; then
  read -r -p "[restore] Type 'yes' to confirm: " confirm
  [[ "${confirm}" != "yes" ]] && { log "Aborted."; exit 0; }
fi

# ── Integrity check ───────────────────────────────────────────────────────────
log "Verifying backup integrity..."
gunzip -t "${RESTORE_FILE}" || fail "Backup file is corrupt"
log "Integrity OK"

# ── Drop + recreate schema ────────────────────────────────────────────────────
log "Dropping public schema..."
psql "${DATABASE_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  || fail "Failed to reset schema"

# ── Restore ───────────────────────────────────────────────────────────────────
log "Restoring..."
gunzip -c "${RESTORE_FILE}" \
  | pg_restore \
      --format=custom \
      --no-owner \
      --no-acl \
      --dbname="${DATABASE_URL}" \
      --verbose \
  || fail "pg_restore failed"

log "✅ Restore complete from: $(basename "${RESTORE_FILE}")"