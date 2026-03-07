#!/bin/bash
# docker/backup/entrypoint.sh
# Used by dev docker-compose only.
# Railway runs backup.sh directly (CMD in Dockerfile.backup) — no entrypoint needed.

set -euo pipefail

SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"

echo "[backup] Starting backup service (dev mode)"
echo "[backup] Schedule: ${SCHEDULE}"
echo "[backup] DB: ${DATABASE_URL//:*@/:***@}"

# Run immediately on startup so you always have a fresh backup
echo "[backup] Running initial backup..."
/scripts/backup.sh || echo "[backup] ⚠️  Initial backup failed — will retry on schedule"

# Install crontab
echo "${SCHEDULE} /scripts/backup.sh >> /proc/1/fd/1 2>&1" | crontab -
echo "[backup] Cron installed. Running crond..."

# crond -f = foreground (keeps container alive)
crond -f -l 6