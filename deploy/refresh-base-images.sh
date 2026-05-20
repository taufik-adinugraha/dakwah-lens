#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Weekly base-image refresh.
#
# `deploy.sh` builds WITHOUT `--pull` to keep app deploys fast (~5–10 min
# saved per run). This script pulls the latest tagged base images
# (`node:22-alpine`, `python:3.12-slim`, postgres/redis/qdrant) and
# rebuilds the app images on top, so security patches still land.
#
# Wire it up on the VM as a weekly cron — e.g. /etc/cron.weekly/:
#
#   sudo ln -s /srv/dakwah-lens/repo/deploy/refresh-base-images.sh \
#              /etc/cron.weekly/dakwah-lens-refresh
#   sudo chmod +x /srv/dakwah-lens/repo/deploy/refresh-base-images.sh
#
# Or invoke ad-hoc after bumping a Dockerfile base tag:
#
#   ssh dakwah '/srv/dakwah-lens/repo/deploy/refresh-base-images.sh'
#
# Same idempotency guarantees as deploy.sh — re-running is safe.
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR=/srv/dakwah-lens/repo
COMPOSE="docker compose --env-file ${REPO_DIR}/.env -f ${REPO_DIR}/docker-compose.prod.yml"
LOG_TAG="[refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

say() { echo "$LOG_TAG $*"; }

cd "$REPO_DIR"

# 1. Pull base images for the app services. `--pull` on `compose build`
# resolves each Dockerfile's FROM line against the registry, downloading
# new layers when upstream rebuilt (security patches typically ship as a
# new minor of the same tag).
say "▶ pulling latest base images + rebuilding app images"
$COMPOSE build --pull web api worker beat

# 2. Pull the standalone data-service images too. These don't go through
# `compose build` because we don't ship a Dockerfile for them — we use
# the official upstream image directly.
say "▶ pulling postgres/qdrant/redis"
$COMPOSE pull postgres qdrant redis

# 3. Roll any service whose image just changed. `up -d` is a no-op for
# unchanged images, so this only restarts what actually needs restarting.
say "▶ rolling stale containers"
$COMPOSE up -d --remove-orphans

# 4. Reclaim disk from the now-dangling previous-version layers.
say "▶ pruning dangling images"
docker image prune -f >/dev/null

say "✓ base-image refresh finished"
