#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Dakwah-Lens · production deploy script.
#
# Triggered by GitHub Actions (`.github/workflows/deploy.yml`) via SSH:
#   ssh deploy@dakwah-lens.id 'bash /srv/dakwah-lens/repo/deploy/deploy.sh'
#
# Safe to re-run: every step is idempotent. On failure, the running
# stack stays up — we only swap containers once the new build + DB
# migrations succeed.
#
# Stages:
#   1. Sync source            (git fetch + reset to origin/main)
#   2. Build images           (web + api, cached layers)
#   3. Start data services    (postgres, qdrant, redis)
#   4. Run Alembic migrations (on the api image; aborts the deploy
#      if any migration fails)
#   5. Roll the app services  (web, api, worker, beat) — Docker does
#      this in-place, briefly serving the old then the new
#   6. Prune dangling images  (frees disk from build artifacts)
#   7. Health probe           (curl localhost:3000 and :8000)
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR=/srv/dakwah-lens/repo
COMPOSE="docker compose --env-file ${REPO_DIR}/.env -f ${REPO_DIR}/docker-compose.prod.yml"
LOG_TAG="[deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

say() { echo "$LOG_TAG $*"; }

cd "$REPO_DIR"

# 1. Source sync ──────────────────────────────────────────────
say "▶ git sync"
# `--ff-only` would refuse a force-push from main — we want to mirror
# whatever main is. `fetch` + `reset --hard` is the right idiom here:
# the VM doesn't author commits, it just deploys what's on origin/main.
git fetch --quiet origin main
git reset --hard origin/main
say "   at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

# 1.5 Sync Caddy config ────────────────────────────────────────
# Caddyfile lives in deploy/ inside the repo so a fresh-VM provision
# automatically gets the right routing. We use `install` (not cp) and
# whitelist this exact invocation in /etc/sudoers.d/deploy so the
# deploy user can write to /etc/caddy/ without full sudo.
if ! cmp -s "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile 2>/dev/null; then
  say "▶ caddy: applying updated Caddyfile + reload"
  sudo install -m 644 -o root -g root "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
else
  say "   caddy config unchanged"
fi

# 2. Build images ─────────────────────────────────────────────
say "▶ docker build (this may take 3–8 min on first run)"
# Build WITHOUT --pull. Refreshing base images (node:22-alpine,
# python:3.12-slim) over the VM's slow Docker Hub egress was adding
# 5–10 min to every deploy. Instead, `deploy/refresh-base-images.sh`
# pulls + rebuilds weekly via cron — security patches still land, just
# on a separate cadence from app deploys. Run that script manually
# after deploying a Dockerfile change that bumps a base-image tag.
#
# Build ALL services — worker and beat reuse api/Dockerfile but
# compose tags each service's image separately. If we built only web+api
# the worker image would stale-out and silently run old code after
# `up -d` reused the existing image. (We learned this the hard way:
# scraper fixes landed in api but worker kept the asyncio loop bug.)
$COMPOSE build web api worker beat

# 3. Bring up data services so step 4 has something to migrate against ──
say "▶ starting postgres/qdrant/redis (idempotent if already up)"
$COMPOSE up -d postgres qdrant redis

# Wait for Postgres to be ready before migrating. Compose's healthcheck
# is reliable but `depends_on: condition: service_healthy` only fires
# when starting dependents — we're skipping straight to migrations so
# the explicit wait makes the timing deterministic.
say "▶ waiting for postgres"
for i in {1..30}; do
  if $COMPOSE exec -T postgres pg_isready -U "$(grep ^POSTGRES_USER "$REPO_DIR/.env" | cut -d= -f2)" -q; then
    say "   postgres ready"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    say "   postgres failed to become ready — aborting"
    exit 1
  fi
done

# 4. Migrations ───────────────────────────────────────────────
# `--rm` so the migration container doesn't linger as a stopped artifact.
# The api image already has `alembic` installed (it's in pyproject deps)
# and `/app` is the workdir, where `alembic.ini` lives. If a migration
# raises, alembic exits non-zero and `set -e` aborts the script before
# we touch app containers — the old version keeps serving.
say "▶ alembic upgrade head"
$COMPOSE run --rm api alembic upgrade head

# 5. Roll the app services ────────────────────────────────────
say "▶ rolling web/api/worker/beat"
# `--remove-orphans` cleans up containers from services that were
# renamed or removed in the compose file — keeps the running set
# matching declared set without us having to remember.
$COMPOSE up -d --remove-orphans web api worker beat

# 6. Prune ─────────────────────────────────────────────────────
# Only dangling images (no tag, replaced by newer build). Keeps disk
# usage bounded — without this, every deploy leaves the previous
# version's layers behind. `-f` skips the prompt.
say "▶ pruning dangling images"
docker image prune -f >/dev/null

# 7. Health probe ─────────────────────────────────────────────
say "▶ health checks"
sleep 6
WEB_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || echo "fail")
API_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health || echo "fail")
say "   web=$WEB_STATUS  api=$API_STATUS"
if [[ "$WEB_STATUS" != "200" && "$WEB_STATUS" != "307" ]]; then
  say "   ⚠ web health probe non-2xx — check 'docker compose logs web'"
fi
if [[ "$API_STATUS" != "200" ]]; then
  say "   ⚠ api health probe non-2xx — check 'docker compose logs api'"
fi

say "✓ deploy finished"
