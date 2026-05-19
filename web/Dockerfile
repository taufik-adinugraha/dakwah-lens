# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────
# Dakwah-Lens web (Next.js 16) — production image.
#
# Three stages:
#   1) deps    → install node_modules only. Layer cached on package.json
#                changes, so code-only edits skip this step entirely.
#   2) builder → run `next build`. Produces .next/standalone with the
#                trimmed Node runtime, .next/static with hashed assets,
#                and copies messages/ + public/ for the runner.
#   3) runner  → minimal node:alpine + the standalone server. Runs
#                `node server.js` as a non-root user. No build tools, no
#                dev deps — the final image lands around 150 MB.
#
# Build context: this Dockerfile assumes the build is invoked from the
# repo root, so paths like `web/...` are relative to that root. The
# production compose file sets `context: .` and `dockerfile: web/Dockerfile`
# to make that explicit.
# ─────────────────────────────────────────────────────────────────

# Node 22 is the current LTS and matches what we use locally.
FROM node:22-alpine AS deps
WORKDIR /app
# Copy lockfiles first so npm install layer cache invalidates only when
# they change — code edits shouldn't trigger a fresh deps install.
COPY web/package.json web/package-lock.json ./
# `npm ci` instead of `npm install` enforces the lockfile and refuses to
# silently mutate it — exactly what we want in a deterministic build.
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
# Pull the already-installed node_modules from deps. Saves ~30s rebuilds.
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
# Production-only env vars baked at build time. Anything that needs to
# differ between deploys (API keys, secrets) must NOT be hard-coded here
# — those are runtime env vars wired in by docker-compose.prod.yml.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Run as a non-root user — `node:alpine` ships with a `node` user (uid 1000)
# that we just reuse. Anything written at runtime (Next cache, etc.) sits
# under /app which is `node`-owned.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
# Only the standalone server output and the static assets — no
# build artifacts, no source, no dev deps. This is what makes the image
# small.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
# `hostname: "0.0.0.0"` forces Next to bind to all interfaces inside the
# container; Docker's port mapping then exposes it to localhost on the
# host, where Caddy reverse-proxies.
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
