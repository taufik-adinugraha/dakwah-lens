#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Belajar Al-Qur'an · module deploy (runs ON the VM as `deploy`).
#
# Invoked by .github/workflows/deploy-belajar.yml AFTER it has:
#   - built the image in CI and scp'd it to the VM, and
#   - taken /srv/dakwah-lens/.deploy.lock (shared with deploy/deploy.sh,
#     so the two deploys never run git resets or docker work at once) and
#     synced the repo to origin/main.
# This script must NOT take the lock itself (it would deadlock).
#
# Idempotent: re-running converges. Steps:
#   1. docker load the CI-built image
#   2. ensure the media dir (served by Caddy at /belajar/media/)
#   3. ensure the module's own database + role + env file
#   4. roll the container (migrations run at container start)
#   5. health probe
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR=/srv/dakwah-lens/repo
ENV_FILE=/srv/dakwah-lens/belajar.env
MEDIA_DIR=/srv/dakwah-lens/data/belajar-media
IMAGE_TAR="${1:-/tmp/belajar-image.tar.gz}"
PG_CONTAINER=dakwah-lens-postgres-1
COMPOSE="docker compose -f ${REPO_DIR}/deploy/belajar/docker-compose.yml"

say() { echo "[belajar-deploy $(date -u +%H:%M:%SZ)] $*"; }

# 1. Image ──────────────────────────────────────────────────────
say "▶ loading image from ${IMAGE_TAR}"
gunzip -c "$IMAGE_TAR" | docker load
rm -f "$IMAGE_TAR"

# 2. Media dir ──────────────────────────────────────────────────
# Owned by `deploy` (who owns /srv/dakwah-lens/data); world-readable so the
# host Caddy can serve it. The container never writes here.
mkdir -p "$MEDIA_DIR"
chmod 755 "$MEDIA_DIR"

# 3. Database + role + env file ─────────────────────────────────
# Own database `dakwah_belajar` and role `belajar` in the shared Postgres
# container (plan §7.4). The role gets no grants on the main database.
PG_SUPER="$(grep -E '^POSTGRES_USER=' "${REPO_DIR}/.env" | cut -d= -f2- | tr -d '"')"
if [[ -z "$PG_SUPER" ]]; then
  say "✗ POSTGRES_USER not found in ${REPO_DIR}/.env"; exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  say "▶ creating ${ENV_FILE} (new database password)"
  PW="$(openssl rand -hex 24)"
  ( umask 077
    cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=postgres://belajar:${PW}@postgres:5432/dakwah_belajar
BELAJAR_DB_PASSWORD=${PW}
MAIN_APP_INTERNAL_URL=http://web:3000
ENVEOF
  )
fi
PW="$(grep -E '^BELAJAR_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"

psql_super() {
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_SUPER" -d postgres "$@"
}

# Role: create, or re-sync its password to the env file (hex, no quoting).
psql_super -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'belajar') THEN
    CREATE ROLE belajar LOGIN PASSWORD '${PW}';
  ELSE
    ALTER ROLE belajar WITH LOGIN PASSWORD '${PW}';
  END IF;
END
\$\$;
SQL

if ! psql_super -tAc "SELECT 1 FROM pg_database WHERE datname = 'dakwah_belajar'" | grep -q 1; then
  say "▶ creating database dakwah_belajar"
  psql_super -q -c "CREATE DATABASE dakwah_belajar OWNER belajar"
  psql_super -q -c "REVOKE ALL ON DATABASE dakwah_belajar FROM PUBLIC"
fi

# 4. Roll ───────────────────────────────────────────────────────
# --remove-orphans is scoped to THIS project (dakwah-belajar) only.
say "▶ compose up"
$COMPOSE up -d --remove-orphans

# 5. Health ─────────────────────────────────────────────────────
say "▶ health probe"
for _ in $(seq 1 30); do
  if body="$(curl -fsS http://127.0.0.1:3200/belajar/api/health 2>/dev/null)"; then
    say "   healthy: ${body}"
    docker image prune -f >/dev/null || true
    exit 0
  fi
  sleep 2
done
say "✗ health probe failed — recent logs:"
$COMPOSE logs --tail 60 belajar-web || true
exit 1
