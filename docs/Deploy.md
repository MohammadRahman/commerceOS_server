# Deployment Guide — Railway + GitHub Actions

## Overview

```
Push to main
    ↓
GitHub Actions CI (lint + typecheck + tests + build)
    ↓
Run DB migrations against production Postgres
    ↓
Deploy API   →  Railway (api service)
Deploy Worker → Railway (worker service)
```

---

## Step 1 — Copy files to repo

```
Dockerfile              → repo root
Dockerfile.worker       → repo root
.dockerignore           → repo root
railway.toml            → repo root
.github/workflows/ci.yml     → .github/workflows/
.github/workflows/deploy.yml → .github/workflows/
```

---

## Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → New Project
2. **Add Postgres** — click `+ New` → Database → PostgreSQL
3. **Add Redis** — click `+ New` → Database → Redis
4. **Add API service** — click `+ New` → Empty Service → name it `api`
5. **Add Worker service** — click `+ New` → Empty Service → name it `worker`

---

## Step 3 — Get Railway token

Railway Dashboard → Account Settings → Tokens → Create Token

Copy the token — you'll need it in Step 5.

---

## Step 4 — Set environment variables in Railway

For the **api** service, add these variables (Railway Dashboard → api → Variables):

```
NODE_ENV=production
CORS_ORIGINS=https://your-frontend-domain.com

# These are auto-injected by Railway when you add Postgres/Redis addons:
# POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, POSTGRES_USERNAME, POSTGRES_PASSWORD
# REDIS_HOST, REDIS_PORT

# Copy from your .env — DO NOT commit these to git
JWT_ACCESS_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
META_APP_SECRET=your-meta-secret
SENTRY_DSN=your-sentry-dsn
APP_VERSION=1.0.0
POSTGRES_SYNCHRONIZE=false
```

For the **worker** service, add the same Postgres + Redis variables.

---

## Step 5 — Add GitHub Secrets

GitHub repo → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Secret              | Value                       |
| ------------------- | --------------------------- |
| `RAILWAY_TOKEN`     | Token from Step 3           |
| `POSTGRES_HOST`     | From Railway Postgres addon |
| `POSTGRES_PORT`     | From Railway Postgres addon |
| `POSTGRES_DATABASE` | From Railway Postgres addon |
| `POSTGRES_USERNAME` | From Railway Postgres addon |
| `POSTGRES_PASSWORD` | From Railway Postgres addon |

To get the Postgres values: Railway → your project → Postgres addon → Connect tab.

---

## Step 6 — First deploy

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Deploy manually for the first time
railway up --service api --dockerfile Dockerfile
railway up --service worker --dockerfile Dockerfile.worker

# Run migrations against production DB
POSTGRES_HOST=xxx POSTGRES_PASSWORD=xxx ... npm run migration:run
```

After first manual deploy, everything is automatic — push to `main` triggers the full pipeline.

---

## Step 7 — Verify

```bash
# Check API is running
curl https://your-api.railway.app/health/live

# Check all health indicators
curl https://your-api.railway.app/health
```

---

## How the pipeline works

| Event              | What happens                                         |
| ------------------ | ---------------------------------------------------- |
| Open a PR          | CI runs: lint + typecheck + tests + build            |
| Merge to main      | CI → migrations → deploy API + worker in parallel    |
| Deploy fails       | Railway rolls back to previous version automatically |
| Health check fails | Railway restarts container (up to 3 times)           |

---

## Costs (Railway)

| Resource       | Cost               |
| -------------- | ------------------ |
| API service    | ~$5/mo (512MB RAM) |
| Worker service | ~$3/mo (256MB RAM) |
| Postgres       | ~$5/mo (1GB)       |
| Redis          | ~$3/mo             |
| **Total**      | **~$16/mo**        |

Free tier gives $5 credit/mo — enough to test before going live.
