# Belajar Al-Qur'an — module image (served at dakwah-lens.id/belajar).
# Built in GitHub Actions (never on the operator's laptop, never on the
# 1.9 GB prod VM) and shipped to the VM with `docker save | docker load`.
# Build context: the belajar/ directory.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The module is PUBLIC, i.e. indexable (operator, 2026-11-26: "publish belajar so google can see";
# plan L42, src/lib/flags.ts). This default is the one place that says so: CI builds this image once,
# smoke-tests that very image and ships it, so what is tested is what runs. The prerendered lesson
# pages read the flag HERE, at build time; the proxy, the sitemap and every page rendered per
# request read it at RUN time, so the runner stage below carries it too (without that line they
# would see it unset and answer `noindex` to everything). Do not pass --build-arg for the shipped
# image. BELAJAR_PUBLIC=false in belajar.env (then a container recreate) is the kill switch.
ARG BELAJAR_PUBLIC=true
ENV BELAJAR_PUBLIC=$BELAJAR_PUBLIC
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache tini
# The same flag as the builder's (an ARG is scoped to its stage): read at run time by the proxy, the
# sitemap and the pages rendered per request. `env_file`/`-e` in the compose file override it.
ARG BELAJAR_PUBLIC=true
ENV BELAJAR_PUBLIC=$BELAJAR_PUBLIC
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Share-card fonts (src/lib/og/card.tsx reads them from process.cwd()). Every card is drawn
# during `next build`; these keep a card drawable if one is ever rendered at request time.
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets
# The vocabulary list: read per request (src/lib/kosakata.ts), so the build cannot trace it.
COPY --from=builder --chown=nextjs:nodejs /app/content/kosakata ./content/kosakata
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
# migrate.mjs imports `postgres` from /app/node_modules, but Next/Turbopack
# BUNDLES that package into the server chunks — it is never traced into
# .next/standalone/node_modules (verified on the prod web image). Ship it
# explicitly; postgres@3 has zero dependencies, so the directory is enough.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations first (idempotent, one transaction each); the server only
# starts when they succeed.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
