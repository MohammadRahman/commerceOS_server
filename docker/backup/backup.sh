#!/bin/bash
# docker/backup/backup.sh
# ─────────────────────────────────────────────────────────────────────────────
# pg_dump → gzip → save locally → upload to B2 → prune old backups
#
# Required env:
#   DATABASE_URL          — postgres connection string (Railway injects this)
#
# Optional env:
#   BACKUP_ENV            — label prefix in filename (dev/prod), default: unknown
#   BACKUP_RETAIN_DAYS    — local retention in days, default: 7
#   BACKUP_LOCAL_ONLY     — "true" = skip cloud upload, default: false
#   B2_ACCOUNT_ID         — Backblaze B2 account ID
#   B2_ACCOUNT_KEY        — Backblaze B2 application key
#   B2_BUCKET             — B2 bucket name (e.g. my-app-backups)
#   B2_PATH               — subfolder in bucket, default: postgres
#   B2_ENDPOINT           — override for S3/R2, e.g. https://s3.us-east-1.amazonaws.com
#   NOTIFY_WEBHOOK_URL    — optional Slack/Discord webhook for success/failure alerts
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_ENV="${BACKUP_ENV:-unknown}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"
LOCAL_ONLY="${BACKUP_LOCAL_ONLY:-false}"
B2_PATH="${B2_PATH:-postgres}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_ENV}_${TIMESTAMP}.dump.gz"
BACKUP_DIR="/backups"
BACKUP_FILE="${BACKUP_DIR}/${FILENAME}"

# ── Logging helpers ───────────────────────────────────────────────────────────
log()  { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() { echo "[backup] ❌ ERROR: $*" >&2; notify_failure "$*"; exit 1; }

notify_success() {
  [[ -z "${NOTIFY_WEBHOOK_URL:-}" ]] && return
  curl -sf -X POST "${NOTIFY_WEBHOOK_URL}" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"✅ *[${BACKUP_ENV}] DB backup succeeded* — \`${FILENAME}\` ($(du -sh "${BACKUP_FILE}" | cut -f1))\"}" \
    || true
}

notify_failure() {
  [[ -z "${NOTIFY_WEBHOOK_URL:-}" ]] && return
  curl -sf -X POST "${NOTIFY_WEBHOOK_URL}" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"❌ *[${BACKUP_ENV}] DB backup FAILED* — ${1:-unknown error}\"}" \
    || true
}

# ── Validate env ──────────────────────────────────────────────────────────────
[[ -z "${DATABASE_URL:-}" ]] && fail "DATABASE_URL is not set"

if [[ "${LOCAL_ONLY}" != "true" ]]; then
  [[ -z "${B2_ACCOUNT_ID:-}" ]]  && fail "B2_ACCOUNT_ID is not set (required for cloud upload)"
  [[ -z "${B2_ACCOUNT_KEY:-}" ]] && fail "B2_ACCOUNT_KEY is not set (required for cloud upload)"
  [[ -z "${B2_BUCKET:-}" ]]      && fail "B2_BUCKET is not set (required for cloud upload)"
fi

# ── Step 1: pg_dump ───────────────────────────────────────────────────────────
log "Starting backup → ${FILENAME}"
log "Source: ${DATABASE_URL//:*@/:***@}"  # mask password in logs

mkdir -p "${BACKUP_DIR}"

# --format=custom: compressed binary format, best for pg_restore
# --no-owner:      skip ownership (avoids issues when restoring to different user)
# --no-acl:        skip grants (same reason)
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --compress=0 \
  "${DATABASE_URL}" \
  | gzip -9 > "${BACKUP_FILE}" \
  || fail "pg_dump failed"

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
log "Dump complete — size: ${BACKUP_SIZE}"

# ── Step 2: verify the dump is not empty/corrupt ──────────────────────────────
FILESIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}")
if [[ "${FILESIZE}" -lt 1024 ]]; then
  fail "Backup file is suspiciously small (${FILESIZE} bytes) — aborting"
fi

# Quick integrity check — list contents without extracting
gunzip -t "${BACKUP_FILE}" || fail "gzip integrity check failed"
log "Integrity check passed"

# ── Step 3: upload to Backblaze B2 ───────────────────────────────────────────
if [[ "${LOCAL_ONLY}" == "true" ]]; then
  log "BACKUP_LOCAL_ONLY=true — skipping cloud upload"
else
  log "Uploading to B2 bucket: ${B2_BUCKET}/${B2_PATH}/"

  # Configure rclone via env vars — no config file needed
  export RCLONE_CONFIG_B2_TYPE=b2
  export RCLONE_CONFIG_B2_ACCOUNT="${B2_ACCOUNT_ID}"
  export RCLONE_CONFIG_B2_KEY="${B2_ACCOUNT_KEY}"

  # Support S3/R2 override
  if [[ -n "${B2_ENDPOINT:-}" ]]; then
    export RCLONE_CONFIG_B2_TYPE=s3
    export RCLONE_CONFIG_B2_PROVIDER=Other
    export RCLONE_CONFIG_B2_ENDPOINT="${B2_ENDPOINT}"
    export RCLONE_CONFIG_B2_ACCESS_KEY_ID="${B2_ACCOUNT_ID}"
    export RCLONE_CONFIG_B2_SECRET_ACCESS_KEY="${B2_ACCOUNT_KEY}"
  fi

  rclone copy \
    "${BACKUP_FILE}" \
    "B2:${B2_BUCKET}/${B2_PATH}/" \
    --progress \
    --retries 3 \
    --low-level-retries 5 \
    || fail "rclone upload failed"

  log "Upload complete → B2:${B2_BUCKET}/${B2_PATH}/${FILENAME}"

  # Prune old backups from cloud (keep last N days)
  log "Pruning cloud backups older than ${RETAIN_DAYS} days..."
  rclone delete \
    "B2:${B2_BUCKET}/${B2_PATH}/" \
    --min-age "${RETAIN_DAYS}d" \
    --include "${BACKUP_ENV}_*.dump.gz" \
    || log "⚠️  Cloud prune failed (non-fatal)"
fi

# ── Step 4: prune old local backups ──────────────────────────────────────────
log "Pruning local backups older than ${RETAIN_DAYS} days..."
find "${BACKUP_DIR}" \
  -name "${BACKUP_ENV}_*.dump.gz" \
  -mtime "+${RETAIN_DAYS}" \
  -delete \
  && log "Local prune complete" \
  || log "⚠️  Local prune failed (non-fatal)"

# List remaining local backups
log "Local backups retained:"
ls -lh "${BACKUP_DIR}/${BACKUP_ENV}_"*.dump.gz 2>/dev/null || log "(none)"

# ── Done ──────────────────────────────────────────────────────────────────────
log "✅ Backup complete — ${FILENAME} (${BACKUP_SIZE})"
notify_success