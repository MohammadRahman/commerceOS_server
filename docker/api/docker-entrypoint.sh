#!/bin/sh
# v2 fixes wrong migration path and adds --transaction each for better safety
set -e
echo "[entrypoint] NODE_ENV=${NODE_ENV:-production}"
echo "[entrypoint] Running database migrations..."

node node_modules/typeorm/cli.js migration:run \
  -d dist/typeorm.config.js \
  --transaction each

echo "[entrypoint] Migrations complete. Starting app..."
exec "$@"
# v1 has wrong migration path
# #!/bin/sh
# # docker/api/docker-entrypoint.sh
# # ─────────────────────────────────────────────────────────────────────────────
# # Runs TypeORM migrations before starting the NestJS app.
# # Ensures every deploy on Railway automatically applies pending migrations.
# #
# # On Railway: this runs inside your API container on every deploy.
# # If migrations fail, the container exits with code 1 → Railway marks deploy
# # as failed and does NOT switch traffic — your old version stays live.
# # ─────────────────────────────────────────────────────────────────────────────

# set -e

# echo "[entrypoint] NODE_ENV=${NODE_ENV:-production}"
# echo "[entrypoint] Running database migrations..."

# # Run TypeORM migrations using the compiled data-source
# # dist/libs/common/src/database/data-source.js is the compiled output
# node node_modules/typeorm/cli.js migration:run \
#   -d dist/typeorm.config.js

# echo "[entrypoint] Migrations complete. Starting app..."
# exec "$@"