# Dockerfile v6
# Key fixes from v5:
# 1. Migrations compiled to dist/migrations/ — same dist tree as app
# 2. typeorm.config.ts compiled into dist/ alongside app
# 3. New migrations added to migrations/ folder are automatically picked up
#    on next build — no manual intervention needed
# 4. Path in typeorm.config.ts updated to match dist/migrations/

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
    --target ES2020 \
    --esModuleInterop true \
    --skipLibCheck true \
    --experimentalDecorators true \
    --emitDecoratorMetadata true

# Compile ALL migrations into dist/migrations/
# This ensures every .ts file in migrations/ gets compiled regardless of name
RUN mkdir -p dist/migrations && \
    npx tsc migrations/*.ts \
    --outDir dist/migrations \
    --module commonjs \
    --moduleResolution node \
    --target ES2020 \
    --esModuleInterop true \
    --skipLibCheck true \
    --experimentalDecorators true \
    --emitDecoratorMetadata true \
    2>/dev/null || true

# ── Stage 3: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nestjs -u 1001

# Production deps only
COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev && \
    npm cache clean --force

# Compiled app + migrations (everything in dist/)
COPY --from=builder /app/dist ./dist

# Config files needed at runtime
COPY --from=builder /app/nest-cli.json ./nest-cli.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Entrypoint
COPY docker/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-3000}/health/live || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/apps/api/main"]

# # v5 due to issue in migration entrypoint script where typeorm.config.js is not found at railway deployment.
# # Dockerfile  v5
# # Multi-stage build — keeps final image ~200MB
# # Runs migrations automatically before app starts on every deploy

# # ── Stage 1: deps ─────────────────────────────────────────────────────────────
# FROM node:20-alpine AS deps
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --frozen-lockfile

# # ── Stage 2: build ────────────────────────────────────────────────────────────
# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY --from=deps /app/node_modules ./node_modules
# COPY . .
# RUN npm run build api
# # Compile typeorm.config.ts separately (lives at repo root, not in nest build)
# RUN npx tsc typeorm.config.ts \
#     --outDir dist \
#     --module commonjs \
#     --moduleResolution node \
#     --target ES2020 \
#     --esModuleInterop true \
#     --skipLibCheck true \
#     --experimentalDecorators true \
#     --emitDecoratorMetadata true

# RUN npx tsc migrations/*.ts \
#     --outDir migrations \
#     --module commonjs \
#     --moduleResolution node \
#     --target ES2020 \
#     --esModuleInterop true \
#     --skipLibCheck true \
#     --experimentalDecorators true \
#     --emitDecoratorMetadata true \
#     2>/dev/null || true
# # ── Stage 3: production image ─────────────────────────────────────────────────
# FROM node:20-alpine AS runner
# WORKDIR /app

# RUN addgroup -g 1001 -S nodejs && \
#     adduser  -S nestjs -u 1001

# # Production deps
# COPY package*.json ./
# RUN npm ci --frozen-lockfile --omit=dev && \
#     npm cache clean --force

# # Compiled app
# COPY --from=builder /app/dist ./dist

# # Migrations
# COPY --from=builder /app/migrations ./migrations

# COPY --from=builder /app/nest-cli.json ./nest-cli.json
# COPY --from=builder /app/tsconfig.json ./tsconfig.json

# # Entrypoint script
# COPY docker/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# USER nestjs

# EXPOSE 3000

# HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
#     CMD wget -qO- http://localhost:${PORT:-3000}/health/live || exit 1

# ENTRYPOINT ["docker-entrypoint.sh"]
# CMD ["node", "dist/apps/api/main"]