"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db";

const KINDS = ["kitab", "brief", "post"] as const;
type Kind = (typeof KINDS)[number];

const ToggleSchema = z.object({
  kind: z.enum(KINDS),
  ref_id: z.string().trim().min(1).max(512),
  payload: z.record(z.string(), z.unknown()).default({}),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Idempotent toggle: if the (user, kind, ref_id) bookmark already
 * exists, delete it (un-save). Otherwise insert (save). Returns the
 * resulting state so the client can flip its icon without refetching.
 *
 * `payload` is a snapshot of the saved item — arabic+translation+
 * citation for a kitab hit, summary fields for a brief, text snippet
 * for a post. Stored on the bookmark row itself so saved items still
 * render if the original source is later deleted.
 */
export async function toggleBookmark(
  input: z.infer<typeof ToggleSchema>,
): Promise<{ saved: boolean }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("not_authenticated");
  }
  const parsed = ToggleSchema.parse(input);

  const userId = session.user.id;
  const existing = await db
    .select({ id: schema.bookmarks.id })
    .from(schema.bookmarks)
    .where(
      and(
        eq(schema.bookmarks.userId, userId),
        eq(schema.bookmarks.kind, parsed.kind),
        eq(schema.bookmarks.refId, parsed.ref_id),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(schema.bookmarks)
      .where(eq(schema.bookmarks.id, existing[0]!.id));
    revalidatePath("/saved");
    return { saved: false };
  }

  await db.insert(schema.bookmarks).values({
    userId,
    kind: parsed.kind,
    refId: parsed.ref_id,
    payload: parsed.payload,
    note: parsed.note ?? null,
  });
  revalidatePath("/saved");
  return { saved: true };
}

/**
 * Check which of a batch of (kind, ref_id) pairs the current user has
 * saved. Single round-trip — the search results page calls this once
 * with all visible hits so each card knows whether to render as
 * "saved" or "not saved".
 *
 * Returns a Set-like { [ref_id]: true } for the items that ARE saved.
 * Anonymous users get an empty map.
 */
export async function getSavedFlags(
  kind: Kind,
  refIds: string[],
): Promise<Record<string, boolean>> {
  if (refIds.length === 0) return {};
  const session = await auth();
  if (!session?.user?.id) return {};

  const rows = await db
    .select({ refId: schema.bookmarks.refId })
    .from(schema.bookmarks)
    .where(
      and(
        eq(schema.bookmarks.userId, session.user.id),
        eq(schema.bookmarks.kind, kind),
      ),
    );
  const saved = new Set(rows.map((r) => r.refId));
  const result: Record<string, boolean> = {};
  for (const id of refIds) {
    if (saved.has(id)) result[id] = true;
  }
  return result;
}
