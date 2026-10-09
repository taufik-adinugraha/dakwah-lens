// Apply belajar/migrations/*.sql in name order, each exactly once, each in
// its own transaction. Runs at container start, before `node server.js`
// (Dockerfile CMD). Deliberately tiny — no ORM or drizzle-kit in the runtime
// image. Exits 0 without DATABASE_URL so a DB-less container still serves
// the static lesson pages.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set — skipping");
  process.exit(0);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql`CREATE TABLE IF NOT EXISTS _belajar_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set(
    (await sql`SELECT name FROM _belajar_migrations`).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const body = await readFile(path.join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _belajar_migrations (name) VALUES (${name})`;
    });
    console.log(`[migrate] applied ${name}`);
  }
  console.log(`[migrate] up to date (${files.length} migrations)`);
} catch (err) {
  console.error("[migrate] FAILED:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
