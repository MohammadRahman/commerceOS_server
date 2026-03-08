# v5 due to issue in migration entrypoint script where typeorm.config.js is not found at railway deployment.
# Dockerfile  v5
# Multi-stage build — keeps final image ~200MB
# Runs migrations automatically before app starts on every deploy

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
RUN npm run build api
# Compile typeorm.config.ts separately (lives at repo root, not in nest build)
RUN npx tsc typeorm.config.ts \
    --outDir dist \
    --module commonjs \
    --moduleResolution node \
    --target ES2020 \
    --esModuleInterop true \
    --skipLibCheck true \
    --experimentalDecorators true \
    --emitDecoratorMetadata true

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nestjs -u 1001

# Production deps
COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev && \
    npm cache clean --force

# Compiled app
COPY --from=builder /app/dist ./dist

# Migrations
COPY --from=builder /app/migrations ./migrations

COPY --from=builder /app/nest-cli.json ./nest-cli.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Entrypoint script
COPY docker/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-3000}/health/live || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/apps/api/main"]
# # Dockerfile  v4
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
# COPY --from=builder /app/dist            ./dist

# # Migrations — applied by entrypoint before app starts
# COPY --from=builder /app/migrations      ./migrations

# # typeorm.config.ts compiles to dist/typeorm.config.js — already in dist/ above.
# # nest-cli needed for path resolution
# COPY --from=builder /app/nest-cli.json   ./nest-cli.json
# COPY --from=builder /app/tsconfig.json   ./tsconfig.json

# # Entrypoint script
# COPY docker/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# USER nestjs

# EXPOSE 3000

# HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
#     CMD wget -qO- http://localhost:${PORT:-3000}/health/live || exit 1

# ENTRYPOINT ["docker-entrypoint.sh"]
# CMD ["node", "dist/apps/api/main"]
# v1
# # Dockerfile
# # Multi-stage build — keeps final image small (~200MB vs ~1GB)
# # Builds the NestJS monorepo and runs only the API app

# # ── Stage 1: deps ─────────────────────────────────────────────────────────────
# # Install ALL dependencies (including devDeps needed for build)
# FROM node:20-alpine AS deps
# WORKDIR /app

# COPY package*.json ./
# RUN npm ci --frozen-lockfile

# # ── Stage 2: build ────────────────────────────────────────────────────────────
# FROM node:20-alpine AS builder
# WORKDIR /app

# # Copy deps from previous stage
# COPY --from=deps /app/node_modules ./node_modules

# # Copy source
# COPY . .

# # Build the API app (outputs to dist/apps/api)
# RUN npm run build api

# # ── Stage 3: production image ─────────────────────────────────────────────────
# FROM node:20-alpine AS runner
# WORKDIR /app

# # Security: run as non-root user
# RUN addgroup -g 1001 -S nodejs && \
#     adduser  -S nestjs -u 1001

# # Install only production dependencies
# COPY package*.json ./
# RUN npm ci --frozen-lockfile --omit=dev && \
#     npm cache clean --force

# # Copy compiled output from builder
# COPY --from=builder /app/dist ./dist

# # Copy migrations (needed for migration:run at startup)
# COPY --from=builder /app/migrations ./migrations
# COPY --from=builder /app/typeorm.config.js ./typeorm.config.js 2>/dev/null || true

# # Copy any other runtime assets
# COPY --from=builder /app/nest-cli.json ./nest-cli.json

# # Switch to non-root user
# USER nestjs

# # Railway sets PORT automatically
# EXPOSE 3000

# # Health check — Railway uses this to know when app is ready
# HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
#     CMD wget -qO- http://localhost:3000/health/live || exit 1

# # Start the API
# CMD ["node", "dist/apps/api/main"]