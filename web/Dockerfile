# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────
# Dakwah-Lens web (Next.js 16) — production image.
#
# Three stages:
#   1) deps    → install node_modules only. Layer cached on package.json
#                changes, so code-only edits skip this step entirely.
#                Sets PUPPETEER_SKIP_DOWNLOAD=true so the puppeteer
#                postinstall hook doesn't pull its bundled Chromium —
#                we install one from apt in the runner instead.
#   2) builder → run `next build`. Produces .next/standalone with the
#                trimmed Node runtime, .next/static with hashed assets,
#                and copies messages/ + public/ for the runner.
#   3) runner  → node:22-bookworm-slim + chromium installed via apt.
#                Runs `node server.js` as a non-root user. Bookworm
#                (not alpine) because Puppeteer needs glibc Chromium.
#
# Build context: this Dockerfile assumes the build is invoked from the
# repo root, so paths like `web/...` are relative to that root. The
# production compose file sets `context: .` and `dockerfile: web/Dockerfile`
# to make that explicit.
# ─────────────────────────────────────────────────────────────────

# Node 22 is the current LTS and matches what we use locally. Alpine is
# fine for the build stages because we skip the puppeteer chromium
# download — node_modules just needs the JS sources, not a runtime
# Chromium binary.
FROM node:22-alpine AS deps
WORKDIR /app
# Skip puppeteer's bundled Chromium download — the runner image
# installs system Chromium via apt, which we point puppeteer at via
# PUPPETEER_EXECUTABLE_PATH at runtime.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Runner: Debian-based so we can install a glibc Chromium + the runtime
# libs it needs. Smaller than installing all the libs on alpine, more
# reliable than puppeteer-on-alpine which has historical compatibility
# issues with the bundled Chromium binary.
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Chromium + the minimum set of fonts the flyer renderer needs:
#   - chromium: the browser binary itself
#   - fonts-noto: covers Latin + Arabic + emoji fallback at render time
#     (the flyer-renderer ALSO loads Inter + Amiri from Google Fonts via
#     the Tailwind doc, but having Noto as a fallback prevents tofu if
#     the CDN ever fails)
#   - ca-certificates: needed for HTTPS to Google Fonts during render
#   - tini: tiny init that reaps the Chromium zombie processes
#     puppeteer spawns; without it, long-running containers accumulate
#     zombies until the kernel runs out of PIDs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto \
      fonts-noto-color-emoji \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Reuse the bookworm-slim `node` user (uid 1000) — same convention as
# before, just on Debian instead of Alpine.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid 1001 --create-home nextjs

# Standalone output is self-contained — Next bundles its server + the
# subset of node_modules it needs. We don't copy node_modules wholesale,
# so puppeteer's ~80MB of JS is only included if Next's tracer sees it
# referenced (which it does, since the flyer routes import it).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
