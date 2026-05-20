# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────
# Dakwah-Lens api (FastAPI + Celery) — production image.
#
# One image, three workloads:
#   - `api`    → uvicorn (FastAPI)        — internal HTTP
#   - `worker` → celery worker            — async tasks
#   - `beat`   → celery beat              — scheduler
# docker-compose.prod.yml selects which one via `command:` override.
#
# Heavy deps (torch, transformers, sentence-transformers, bertopic)
# install in a separate cached layer, isolated from the source copy
# so code-only edits don't re-pull ~2 GB of ML wheels. PyTorch from
# PyPI on linux/x86_64 ships CPU-only by default — we never want
# CUDA on this 4 GB VM.
# ─────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS builder
WORKDIR /app

# Build-time tools needed for some wheels that compile native bits
# (cryptography fallback, sentencepiece on older platforms, etc.).
# We strip them out before the final image so they don't bloat runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# uv from Astral — replaces pip/poetry; ~10x faster resolver. Pinned
# version so reproducible across rebuilds.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# Install dependencies BEFORE copying source. uv reads
# pyproject.toml + uv.lock from the workdir.
COPY api/pyproject.toml api/uv.lock ./
# `--frozen` enforces the lockfile (matches `npm ci` semantics).
# Project itself isn't installed yet — `--no-install-project` skips that
# step so we can copy source separately and cache the dep layer.
#
# BuildKit cache mount persists uv's wheel cache across rebuilds (lives
# on the Docker daemon, survives layer invalidation). When pyproject
# changes, this RUN re-executes but uv finds existing wheels in cache
# — only NEW wheels download. Saves ~2-3 min on most deploys; on first
# build (cold daemon) it's the same as before.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Now copy the source and re-run sync to install the project itself.
# Project install is fast (no wheel download — it's just a metadata bind).
COPY api/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ─── Runtime image ──────────────────────────────────────────────
FROM python:3.12-slim AS runner
WORKDIR /app

# Minimal runtime deps. tini = PID-1-correct init for Docker. libpq is
# required by psycopg2-binary's runtime linker; everything else came
# pre-installed in python:slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini libpq5 \
 && rm -rf /var/lib/apt/lists/*

# Non-root user. Celery + uvicorn don't need root and we want defense
# in depth.
RUN groupadd -r app --gid 1001 \
 && useradd -r -u 1001 -g app -d /app -s /usr/sbin/nologin app

# Pull the populated virtualenv and source from the builder. uv installs
# into `.venv/` by default; we make that the active interpreter.
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
# Force Python to NOT byte-compile .pyc files at runtime — small image,
# easier to debug. The byte-compile step at build time already happened.
ENV PYTHONDONTWRITEBYTECODE=1

USER app
EXPOSE 8000

# tini reaps zombies and forwards SIGTERM cleanly to whatever the actual
# process is. Compose overrides CMD per-service (uvicorn / celery worker
# / celery beat) so this is just a sane default.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
