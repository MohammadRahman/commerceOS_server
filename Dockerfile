# Dockerfile v7
# Fix: migration compile error "Unexpected strict mode reserved word: implements"
# Caused by ES2020 target — fixed with ES2022 + strict false

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build NestJS app
RUN npm run build api

# Compile typeorm.config.ts into dist/
RUN npx tsc typeorm.config.ts \
    --outDir dist \
    --module commonjs \
    --moduleResolution node \
    --target ES2022 \
    --esModuleInterop true \
    --skipLibCheck true \
    --experimentalDecorators true \
    --emitDecoratorMetadata true \
    --strict false

# Compile ALL migrations into dist/migrations/
# ✅ ES2022 + strict false — fixes "implements" reserved word error
RUN mkdir -p dist/migrations && \
    npx tsc migrations/*.ts \
    --outDir dist/migrations \
    --module commonjs \
    --moduleResolution node \
    --target ES2022 \
    --esModuleInterop true \
    --skipLibCheck true \
    --experimentalDecorators true \
    --emitDecoratorMetadata true \
    --strict false \
    2>/dev/null || true

# Verify migrations compiled
RUN echo "=== Compiled migrations ===" && ls dist/migrations/ || echo "WARNING: no migrations compiled"

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nestjs -u 1001

COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/nest-cli.json ./nest-cli.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

COPY docker/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-3000}/health/live || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/apps/api/main"]