#!/bin/bash
# Run from repo root
set -e

echo "📦 Installing monitoring packages..."

# Sentry — error tracking
npm install @sentry/node @sentry/profiling-node

# Prometheus metrics endpoint
npm install @willsoto/nestjs-prometheus prom-client

# Health checks (/health endpoint)
npm install @nestjs/terminus

# Pino already installed in security phase
# nestjs-pino pino-http pino-pretty

echo "✅ Monitoring packages installed"
echo ""
echo "Next steps:"
echo "  1. Copy sentry.ts          → apps/api/src/sentry.ts"
echo "  2. Add 'import ./sentry'   → first line of apps/api/src/main.ts"
echo "  3. Copy health.controller  → apps/api/src/modules/health/"
echo "  4. Add SENTRY_DSN to .env  (get from sentry.io → Project Settings → DSN)"
echo "  5. Start monitoring stack: docker compose -f docker-compose.monitoring.yml up -d"
echo "  6. Open Grafana:           http://localhost:3100  (admin/admin)"