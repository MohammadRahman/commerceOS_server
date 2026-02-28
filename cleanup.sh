#!/bin/bash
# Run from repo root — cleans up stale infra copies and typo filenames

# 1. Fix the typo in docker-compose filename
if [ -f "ocker-compose.monitoring.yml" ]; then
    mv ocker-compose.monitoring.yml docker-compose.monitoring.yml
    echo "✅ Renamed ocker-compose.monitoring.yml → docker-compose.monitoring.yml"
fi

# 2. Remove the infra/ copies — they're already applied to the real locations
# Only do this after confirming the real files are correct
rm -rf infra/security
rm -rf infra/monitoring
rm -rf infra/database
echo "✅ Removed stale infra/ copies"

# 3. Install missing packages
npm install @nestjs/terminus
echo "✅ @nestjs/terminus installed"

echo ""
echo "Done. Now apply the 3 fixed files:"
echo "  main.ts             → apps/api/src/main.ts"
echo "  health.module.ts    → apps/api/src/modules/health/health.module.ts"
echo "  health.controller.ts → apps/api/src/modules/health/health.controller.ts"