#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Belajar Al-Qur'an · module deploy (runs ON the VM as `deploy`).
#
#   flock -w 1800 /srv/dakwah-lens/.deploy.lock \
#     bash <release-dir>/deploy.sh <release-dir>
#
# Invoked by .github/workflows/deploy-belajar.yml, which built the image in
# CI and shipped a release dir (image tarball + this script + compose file)
# to /srv/dakwah-lens/belajar/incoming-<sha>/. The workflow holds the VM
# deploy lock (shared with deploy.yml, rollback.yml and the weekly
# base-image refresh); this script must NOT take it again.
#
# It never touches /srv/dakwah-lens/repo: that checkout belongs to the main
# stack (deploy.sh, rollback, the weekly refresh build from it). It only
# READS POSTGRES_USER from the repo's .env.
#
# Idempotent. Steps:
#   1. docker load the CI-built image
#   2. install the compose file as /srv/dakwah-lens/belajar/current/
#   3. ensure the media dir (served by Caddy at /belajar/media/)
#   4. ensure the module's own database + role + env file
#   5. roll the container (migrations run at container start)
#   6. health probe; clean up the release dir
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

RELEASE_DIR="${1:?usage: deploy.sh <release-dir>}"
BASE=/srv/dakwah-lens/belajar
CURRENT="${BASE}/current"
ENV_FILE=/srv/dakwah-lens/belajar.env
MEDIA_DIR=/srv/dakwah-lens/data/belajar-media
MAIN_ENV=/srv/dakwah-lens/repo/.env
PG_CONTAINER=dakwah-lens-postgres-1

say() { echo "[belajar-deploy $(date -u +%H:%M:%SZ)] $*"; }

# 1. Image ──────────────────────────────────────────────────────
say "▶ loading image"
gunzip -c "${RELEASE_DIR}/belajar-image.tar.gz" | docker load

# 2. Compose file ───────────────────────────────────────────────
mkdir -p "$CURRENT"
install -m 644 "${RELEASE_DIR}/docker-compose.yml" "${CURRENT}/docker-compose.yml"
install -m 755 "${RELEASE_DIR}/deploy.sh" "${CURRENT}/deploy.sh"
COMPOSE="docker compose -f ${CURRENT}/docker-compose.yml"

# 3. Media dir ──────────────────────────────────────────────────
# Owned by `deploy` (who owns /srv/dakwah-lens/data); world-readable so the
# host Caddy can serve it. The container never writes here.
mkdir -p "$MEDIA_DIR"
chmod 755 "$MEDIA_DIR"

# 4. Database + role + env file ─────────────────────────────────
PG_SUPER="$(grep -E '^POSTGRES_USER=' "$MAIN_ENV" | cut -d= -f2- | tr -d '"')"
if [[ -z "$PG_SUPER" ]]; then
  say "✗ POSTGRES_USER not found in ${MAIN_ENV}"; exit 1
fi

# psql quietly; never echo statement context (it could carry the password).
psql_super() {
  docker exec -i "$PG_CONTAINER" psql -q -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -v SHOW_CONTEXT=never -U "$PG_SUPER" -d postgres "$@"
}

ROLE_EXISTS="$(psql_super -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'belajar'" || true)"

if [[ ! -f "$ENV_FILE" || "$ROLE_EXISTS" != "1" ]]; then
  # (Re)create the credential: a fresh install, or the env file was lost.
  say "▶ setting the belajar role's credential"
  PW="$(openssl rand -hex 24)"
  ( umask 077
    cat > "${ENV_FILE}.tmp" <<ENVEOF
DATABASE_URL=postgres://belajar:${PW}@postgres:5432/dakwah_belajar
MAIN_APP_INTERNAL_URL=http://web:3000
ENVEOF
  )
  # Password goes over stdin, never argv; terse errors never echo it.
  psql_super <<SQL
\set VERBOSITY terse
\set SHOW_CONTEXT never
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'belajar') THEN
    CREATE ROLE belajar LOGIN CONNECTION LIMIT 10 PASSWORD '${PW}';
  ELSE
    ALTER ROLE belajar WITH LOGIN CONNECTION LIMIT 10 PASSWORD '${PW}';
  END IF;
END
\$\$;
SQL
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
fi

if [[ "$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname = 'dakwah_belajar'")" != "1" ]]; then
  say "▶ creating database dakwah_belajar"
  psql_super -c "CREATE DATABASE dakwah_belajar OWNER belajar"
fi

# Isolation (plan §7.4): the module's role can reach its own database only.
# Postgres grants PUBLIC CONNECT + TEMP on every database by default; revoke
# that on all of them. The only other login role is the main stack's
# superuser, which ignores grants, so the main app is unaffected.
# Idempotent; re-applied each deploy in case a database is added.
psql_super <<'SQL'
DO $$
DECLARE d text;
BEGIN
  FOR d IN SELECT datname FROM pg_database WHERE NOT datistemplate LOOP
    EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', d);
  END LOOP;
END
$$;
GRANT CONNECT ON DATABASE dakwah_belajar TO belajar;
SQL

# 5. Roll ───────────────────────────────────────────────────────
# --remove-orphans is scoped to THIS compose project (dakwah-belajar) only.
say "▶ compose up"
$COMPOSE up -d --remove-orphans

# 6. Health ─────────────────────────────────────────────────────
say "▶ health probe"
for _ in $(seq 1 30); do
  if body="$(curl -fsS http://127.0.0.1:3200/belajar/api/health 2>/dev/null)"; then
    say "   healthy: ${body}"
    rm -rf "$RELEASE_DIR"
    docker image prune -f >/dev/null || true
    exit 0
  fi
  sleep 2
done
say "✗ health probe failed — recent logs:"
$COMPOSE logs --tail 60 belajar-web || true
exit 1
