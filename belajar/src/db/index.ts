import "server-only";

import postgres from "postgres";

/**
 * Learner-progress database `dakwah_belajar` — its OWN database and role in
 * the shared Postgres container, with no grants on the main `dakwah_lens` DB
 * (plan §7.4). Lazily connected so the app (and its static pages) work with
 * no DATABASE_URL at all, e.g. during `next build` in CI.
 */
let client: postgres.Sql | null = null;

export function db(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      max: 3, // tiny pool: one small container on a 1.9 GB VM
      idle_timeout: 30,
      connect_timeout: 5,
    });
  }
  return client;
}
