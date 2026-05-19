/**
 * Terms-update drift detection.
 *
 * When the admin bumps `TERMS_VERSION` in code and ships a deploy, this
 * helper — called on every superadmin page load — notices the drift
 * between the constant and the latest `terms_versions` row, inserts a
 * row + queues two pending follow-ups:
 *
 *   - `terms_email_blast` — send the notice email to approved users
 *   - `terms_banner_post` — post the 14-day in-app banner
 *
 * Both are surfaced on /admin/system/followups for the superadmin to
 * action manually. We don't auto-fire either: an accidental constant
 * bump shouldn't blast every user, and the banner copy needs a human
 * to write the "what changed" sentence.
 *
 * Idempotent: if a row for the current version already exists, this is
 * a no-op (one `select` query and we return).
 */

import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { TERMS_CHANGELOG, TERMS_UPDATED_AT, TERMS_VERSION } from "@/lib/terms-version";

export async function ensureTermsFollowups(): Promise<void> {
  // Fast path: latest row matches the current constant.
  const [latest] = await db
    .select({ version: schema.termsVersions.version })
    .from(schema.termsVersions)
    .orderBy(desc(schema.termsVersions.createdAt))
    .limit(1);

  if (latest?.version === TERMS_VERSION) return;

  // Defensive: even if `latest` is for a future version (shouldn't
  // happen, but) we still want to check we haven't already inserted
  // for this exact version on a parallel page load.
  const [existing] = await db
    .select({ id: schema.termsVersions.id })
    .from(schema.termsVersions)
    .where(eq(schema.termsVersions.version, TERMS_VERSION))
    .limit(1);

  if (existing) return;

  const [inserted] = await db
    .insert(schema.termsVersions)
    .values({
      version: TERMS_VERSION,
      updatedAt: TERMS_UPDATED_AT,
      changelog: TERMS_CHANGELOG || null,
    })
    .returning({ id: schema.termsVersions.id });

  if (!inserted) return;

  await db.insert(schema.adminFollowups).values([
    {
      kind: "terms_email_blast",
      relatedId: inserted.id,
      payload: { version: TERMS_VERSION, changelog: TERMS_CHANGELOG || null },
    },
    {
      kind: "terms_banner_post",
      relatedId: inserted.id,
      payload: { version: TERMS_VERSION, changelog: TERMS_CHANGELOG || null },
    },
  ]);
}

/** Count of pending follow-ups for the admin nav badge. */
export async function countPendingFollowups(): Promise<number> {
  const rows = await db
    .select({ id: schema.adminFollowups.id })
    .from(schema.adminFollowups)
    .where(eq(schema.adminFollowups.status, "pending"));
  return rows.length;
}
