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
# Build-time: lesson pages are prerendered, so the public/noindex flag is
# baked in at build (plan §7.6). Flipping it is a redeploy.
ARG BELAJAR_PUBLIC=false
ENV BELAJAR_PUBLIC=$BELAJAR_PUBLIC
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache tini
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
