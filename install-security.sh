#!/bin/bash
# Run from repo root
# Installs all packages needed for: helmet, rate limiting, Pino logging

set -e

echo "📦 Installing security + logging packages..."

# Helmet — HTTP security headers
npm install helmet

# Rate limiting — Redis-backed throttler
npm install @nestjs/throttler @nest-lab/throttler-storage-redis ioredis

# Pino — structured JSON logging (much faster than Winston)
npm install nestjs-pino pino-http
npm install -D pino-pretty  # dev-only pretty printer

# Class validator (should already be installed, just ensuring)
npm install class-validator class-transformer

echo "✅ Security packages installed"
echo ""
echo "Next steps:"
echo "  1. Copy main.ts           → apps/api/src/main.ts"
echo "  2. Copy throttler.module  → libs/common/src/throttler/throttler.module.ts"
echo "  3. Add AppThrottlerModule to api.module.ts imports"
echo "  4. Add @UseGuards(ThrottlerGuard) + @Throttle(THROTTLE_AUTH) to auth endpoints"
echo "  5. Run: npm run build && npm run start:dev"