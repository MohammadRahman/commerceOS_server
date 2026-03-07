# Backup Setup Runbook

## Why you were losing data

**Dev:** Postgres was running in Docker with an **anonymous volume** (or no volume).
`docker-compose down` destroys anonymous volumes. Named volumes survive.
Fixed by `docker-compose.yml` → `postgres_dev_data` named volume.

**Prod:** Railway Postgres data is persistent, but you had no offsite backup.
A bad migration or accidental DELETE would be unrecoverable.
Fixed by the backup Railway service below.

---

## Architecture

```
DEV                                    PROD (Railway)
───────────────────────────────        ────────────────────────────────────
postgres container                     Railway Postgres plugin
  └── named volume: postgres_dev_data    └── managed storage (persistent)
                                               │
backup container (docker-compose)      backup service (separate Railway service)
  └── ./backups/dev/ on your machine     └── runs backup.sh on cron schedule
                                               │
                                         Backblaze B2
                                           └── prod_YYYYMMDD_HHMMSS.dump.gz
                                               (30 days retained)
```

---

## Dev setup

```bash
# 1. Start everything (postgres data now persists across restarts)
docker-compose up -d

# 2. Run migrations
npm run migration:run:dev

# 3. Verify backup ran on startup
docker logs app_backup_dev
# → should show "✅ Backup complete"

# 4. Check backup file was created
ls ./backups/dev/
# → dev_20240315_020000.dump.gz
```

**From now on:** `docker-compose down` is safe. Data lives in the named volume.
Only `docker-compose down -v` will wipe it (and you'd have to type -v explicitly).

---

## Prod setup (Railway)

### Step 1: Create a Backblaze B2 bucket

1. Sign up at https://backblaze.com (free tier: 10GB storage, 1GB/day egress)
2. Create a bucket: `your-app-backups` (private, not public)
3. Create an application key with access to that bucket only
4. Note: Account ID, Application Key, Bucket Name

### Step 2: Add backup service to Railway

1. In Railway dashboard → your project → **New Service** → **GitHub Repo**
2. Same repo as your API, but set **Dockerfile Path** → `Dockerfile.backup`
3. Set **Start Command** → `/scripts/backup.sh` (runs once, then exits)
4. Set **Cron Schedule** → `0 2 * * *` (2am UTC daily)
5. Add environment variables:

| Variable             | Value                                            |
| -------------------- | ------------------------------------------------ |
| `DATABASE_URL`       | `${{Postgres.DATABASE_URL}}` (Railway reference) |
| `BACKUP_ENV`         | `prod`                                           |
| `BACKUP_RETAIN_DAYS` | `30`                                             |
| `BACKUP_LOCAL_ONLY`  | `false`                                          |
| `B2_ACCOUNT_ID`      | your B2 account ID                               |
| `B2_ACCOUNT_KEY`     | your B2 application key                          |
| `B2_BUCKET`          | your bucket name                                 |
| `B2_PATH`            | `postgres/prod`                                  |
| `NOTIFY_WEBHOOK_URL` | your Slack/Discord webhook (optional)            |

### Step 3: Test immediately

Trigger the backup service manually once to verify it works before relying on the schedule.

---

## Restoring a backup

### Dev — restore latest local backup

```bash
# From inside the backup container:
docker exec -it app_backup_dev /scripts/restore.sh

# Or specify a file:
docker exec -it app_backup_dev /scripts/restore.sh /backups/dev_20240315_020000.dump.gz
```

### Prod — restore from B2

```bash
# Run the backup container locally pointed at your prod DB:
docker run --rm \
  -e DATABASE_URL="your_prod_database_url" \
  -e RESTORE_FROM_CLOUD=true \
  -e RESTORE_FILENAME="prod_20240315_020000.dump.gz" \
  -e B2_ACCOUNT_ID="your_id" \
  -e B2_ACCOUNT_KEY="your_key" \
  -e B2_BUCKET="your-bucket" \
  -e FORCE_RESTORE=true \
  -v ./backups:/backups \
  your-backup-image \
  /scripts/restore.sh
```

---

## Migration safety on Railway deploys

`docker-entrypoint.sh` runs `migration:run` before the app starts on every deploy.

**What this means:**

- Migrations run → app starts → Railway switches traffic ✅
- Migrations fail → container exits with code 1 → Railway aborts deploy → old version stays live ✅
- Never need to manually run migrations on Railway ✅

**Deploy order on Railway:** Railway deploys your new container, runs migrations,
health check passes (`/health/live`), then routes traffic. Old container stays
alive until health check passes — zero downtime.

---

## Backup retention policy

| Environment | Local retention                   | Cloud retention   |
| ----------- | --------------------------------- | ----------------- |
| Dev         | 7 days (./backups/dev/)           | None (local only) |
| Prod        | N/A (no local storage on Railway) | 30 days in B2     |

Old backups are pruned automatically at the end of each backup run.

---

## Monitoring

Set `NOTIFY_WEBHOOK_URL` to a Slack or Discord webhook URL.
You'll get a message after every backup — success or failure.

Slack webhook format: `https://hooks.slack.com/services/T.../B.../...`
Discord webhook format: `https://discord.com/api/webhooks/.../...`
