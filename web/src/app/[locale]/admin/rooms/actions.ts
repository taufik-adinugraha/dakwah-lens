"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { logAdminAction } from "@/lib/admin-log";
import { extractMahasiswaContent } from "@/lib/flyer/content";
import { getBriefingBySlug } from "@/lib/insights-data";
import { notifySubscribers } from "@/lib/notify-subscribers";

const ADMIN_DISPLAY_NAME = "Dakwah-Lens · Admin";
const ADMIN_REPLY_MAX = 1000;

/**
 * Server actions backing /admin/rooms.
 *
 * All actions require admin (or superadmin) role. Admin replies
 * bypass the public moderation pipeline — they're authored by a
 * trusted user, so we skip the regex blocklist + LLM screening and
 * land directly as `status='approved'`. The display name is a
 * reserved string the public form rejects (see comments/route.ts).
 */
async function assertAdmin(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  const role = session?.user?.role;
  if (!id) throw new Error("auth_required");
  if (role !== "admin" && role !== "superadmin") {
    throw new Error("forbidden");
  }
  return id;
}

/** Resolve the room slug from a FormData submission, validating
 *  the shape so an admin can't paste a malformed value into a
 *  query param. */
function resolveSlug(formData: FormData): string | null {
  const slug = String(formData.get("slug") ?? "");
  if (
    !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(all|family|youth|justice|spiritual)$/.test(
      slug,
    )
  ) {
    return null;
  }
  return slug;
}

/** Post an admin reply directly into the public thread. Bypasses
 *  the moderation pipeline since the author is trusted. */
export async function postAdminReply(formData: FormData): Promise<void> {
  const actorId = await assertAdmin();
  const slug = resolveSlug(formData);
  if (!slug) return;
  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 2 || body.length > ADMIN_REPLY_MAX) return;
  const pinned = String(formData.get("pinned") ?? "") === "1";

  await db.insert(schema.mahasiswaComments).values({
    briefingSlug: slug,
    displayName: ADMIN_DISPLAY_NAME,
    body,
    ipHash: null,
    uaHash: null,
    status: "approved",
    blockReason: null,
    pinned,
  });

  await logAdminAction({
    actorId,
    action: "room.admin_reply",
    targetType: "mahasiswa_room",
    targetId: slug,
    payload: { body_excerpt: body.slice(0, 120), pinned },
  });

  // Fire-and-forget email to opted-in participants. We don't await
  // (Resend latency would freeze the admin form) but we catch so the
  // server log shows failures.
  void notifyRoomSubscribers(slug, "admin_reply", body).catch((err) => {
    console.warn("[room] notifySubscribers admin_reply failed:", err);
  });

  revalidatePath("/admin/rooms");
  revalidatePath(`/m/${slug}`);
}

/**
 * One-click "let's continue this offline" invitation. Posts a
 * templated and pinned admin comment in the room. The template is
 * intentionally short + warm — invitation only, no commitment.
 */
export async function postOfflineInvite(formData: FormData): Promise<void> {
  const actorId = await assertAdmin();
  const slug = resolveSlug(formData);
  if (!slug) return;

  const body =
    "Diskusi ini menarik dan kami senang membacanya — yuk lanjut tatap muka. " +
    "Hubungi kami via /contact, kami senang ngobrol lebih panjang offline " +
    "(atau via video call kalau berbeda kota). ✦ Dakwah-Lens";

  await db.insert(schema.mahasiswaComments).values({
    briefingSlug: slug,
    displayName: ADMIN_DISPLAY_NAME,
    body,
    ipHash: null,
    uaHash: null,
    status: "approved",
    blockReason: null,
    pinned: true,
  });

  await logAdminAction({
    actorId,
    action: "room.offline_invite",
    targetType: "mahasiswa_room",
    targetId: slug,
  });

  void notifyRoomSubscribers(slug, "offline_invite", body).catch((err) => {
    console.warn("[room] notifySubscribers offline_invite failed:", err);
  });

  revalidatePath("/admin/rooms");
  revalidatePath(`/m/${slug}`);
}

/** Pull the poster question for the slug so the email subject/body
 *  can give recipients context. Best-effort — falls back to null. */
async function notifyRoomSubscribers(
  slug: string,
  kind: "admin_reply" | "offline_invite",
  body: string,
): Promise<void> {
  let posterQuestion: string | null = null;
  try {
    const brief = await getBriefingBySlug(slug);
    if (brief) {
      const m = extractMahasiswaContent(brief.summaryMd);
      posterQuestion = m.question?.trim() || null;
    }
  } catch {
    /* extract is best-effort — keep going on parse failure */
  }
  await notifySubscribers({
    briefingSlug: slug,
    kind,
    bodyExcerpt: body.slice(0, 400),
    posterQuestion,
  });
}

/** Toggle pin status on a single comment. The public listing sorts
 *  pinned DESC, so pinning bumps to the top of the thread. */
export async function togglePinComment(formData: FormData): Promise<void> {
  const actorId = await assertAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({
      briefingSlug: schema.mahasiswaComments.briefingSlug,
      pinned: schema.mahasiswaComments.pinned,
    })
    .from(schema.mahasiswaComments)
    .where(eq(schema.mahasiswaComments.id, id))
    .limit(1);
  if (!row) return;

  await db
    .update(schema.mahasiswaComments)
    .set({ pinned: !row.pinned })
    .where(eq(schema.mahasiswaComments.id, id));

  await logAdminAction({
    actorId,
    action: row.pinned ? "comment.unpin" : "comment.pin",
    targetType: "mahasiswa_comment",
    targetId: id,
    payload: { slug: row.briefingSlug },
  });

  revalidatePath("/admin/rooms");
  revalidatePath(`/m/${row.briefingSlug}`);
}

/** Mute / unmute the entire room. Muted rooms keep existing
 *  comments visible but reject new public submissions (POST returns
 *  423 Locked). */
export async function toggleRoomMute(formData: FormData): Promise<void> {
  const actorId = await assertAdmin();
  const slug = resolveSlug(formData);
  if (!slug) return;
  const targetState = String(formData.get("target") ?? "");
  const muteReason = String(formData.get("mute_reason") ?? "")
    .trim()
    .slice(0, 120);

  // Upsert pattern — Postgres ON CONFLICT keeps this idempotent.
  if (targetState === "mute") {
    await db
      .insert(schema.mahasiswaRoomSettings)
      .values({
        briefingSlug: slug,
        mutedAt: new Date(),
        mutedByUserId: actorId,
        muteReason: muteReason || null,
      })
      .onConflictDoUpdate({
        target: schema.mahasiswaRoomSettings.briefingSlug,
        set: {
          mutedAt: new Date(),
          mutedByUserId: actorId,
          muteReason: muteReason || null,
          updatedAt: new Date(),
        },
      });
  } else {
    // unmute = NULL out the muted_at column. We keep the row so
    // the audit trail (muted_by_user_id, reason) survives.
    await db
      .update(schema.mahasiswaRoomSettings)
      .set({ mutedAt: null, updatedAt: new Date() })
      .where(eq(schema.mahasiswaRoomSettings.briefingSlug, slug));
  }

  await logAdminAction({
    actorId,
    action: targetState === "mute" ? "room.mute" : "room.unmute",
    targetType: "mahasiswa_room",
    targetId: slug,
    payload: muteReason ? { reason: muteReason } : undefined,
  });

  revalidatePath("/admin/rooms");
  revalidatePath(`/m/${slug}`);
}

/* ────────────────────────────────────────────────────────────
 * Data fetchers (called by the page)
 * ──────────────────────────────────────────────────────────── */

export type RoomOverview = {
  slug: string;
  segment: string | null;
  generatedAt: Date;
  totalApproved: number;
  totalBlocked: number;
  totalPinned: number;
  approved24h: number;
  blocked24h: number;
  approved7d: number;
  uniqueIps7d: number;
  lastActivityAt: Date | null;
  adminReplies: number;
  muted: boolean;
};

/**
 * Per-room aggregate roll-up. Joins every published briefing
 * against the comments table so rooms with zero engagement still
 * appear (admin needs to see "this article has no traffic" too).
 */
export async function listRoomOverviews(): Promise<RoomOverview[]> {
  await assertAdmin();
  // Single SQL with conditional aggregates keeps it to one round-trip.
  type Row = {
    slug: string;
    segment: string | null;
    generated_at: Date | string;
    total_approved: number;
    total_blocked: number;
    total_pinned: number;
    approved_24h: number;
    blocked_24h: number;
    approved_7d: number;
    unique_ips_7d: number | null;
    last_activity_at: Date | string | null;
    admin_replies: number;
    muted: boolean;
  };
  const rows = (await db.execute(sql`
    SELECT
      to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
        || '-' || COALESCE(i.segment, 'all')      AS slug,
      i.segment                                    AS segment,
      i.generated_at                               AS generated_at,
      COALESCE(SUM(CASE WHEN c.status = 'approved'                    THEN 1 ELSE 0 END), 0)::int  AS total_approved,
      COALESCE(SUM(CASE WHEN c.status = 'blocked'                     THEN 1 ELSE 0 END), 0)::int  AS total_blocked,
      COALESCE(SUM(CASE WHEN c.pinned                                  THEN 1 ELSE 0 END), 0)::int  AS total_pinned,
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.created_at >= now() - interval '24 hours' THEN 1 ELSE 0 END), 0)::int AS approved_24h,
      COALESCE(SUM(CASE WHEN c.status = 'blocked'  AND c.created_at >= now() - interval '24 hours' THEN 1 ELSE 0 END), 0)::int AS blocked_24h,
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.created_at >= now() - interval '7 days'   THEN 1 ELSE 0 END), 0)::int AS approved_7d,
      COUNT(DISTINCT c.ip_hash) FILTER (WHERE c.created_at >= now() - interval '7 days' AND c.ip_hash IS NOT NULL)::int       AS unique_ips_7d,
      MAX(CASE WHEN c.status = 'approved' THEN c.created_at END)                                                                 AS last_activity_at,
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.display_name = ${ADMIN_DISPLAY_NAME} THEN 1 ELSE 0 END), 0)::int        AS admin_replies,
      (r.muted_at IS NOT NULL)                                                                                                    AS muted
    FROM insights_summaries i
    LEFT JOIN mahasiswa_comments c
      ON c.briefing_slug =
         to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
           || '-' || COALESCE(i.segment, 'all')
    LEFT JOIN mahasiswa_room_settings r
      ON r.briefing_slug =
         to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
           || '-' || COALESCE(i.segment, 'all')
    WHERE i.generated_at >= now() - interval '90 days'
    GROUP BY i.generated_at, i.segment, r.muted_at
    ORDER BY MAX(CASE WHEN c.status = 'approved' THEN c.created_at END) DESC NULLS LAST,
             i.generated_at DESC
    LIMIT 120
  `)) as unknown as Row[];

  return rows.map((r) => ({
    slug: r.slug,
    segment: r.segment,
    generatedAt:
      r.generated_at instanceof Date ? r.generated_at : new Date(r.generated_at),
    totalApproved: r.total_approved,
    totalBlocked: r.total_blocked,
    totalPinned: r.total_pinned,
    approved24h: r.approved_24h,
    blocked24h: r.blocked_24h,
    approved7d: r.approved_7d,
    uniqueIps7d: r.unique_ips_7d ?? 0,
    lastActivityAt: r.last_activity_at
      ? r.last_activity_at instanceof Date
        ? r.last_activity_at
        : new Date(r.last_activity_at)
      : null,
    adminReplies: r.admin_replies,
    muted: r.muted,
  }));
}

/** Most-recent N approved comments for a single room — used to
 *  preview the conversation in a collapsible per the page. */
export async function listRecentRoomComments(slug: string, limit = 5) {
  await assertAdmin();
  return db
    .select({
      id: schema.mahasiswaComments.id,
      displayName: schema.mahasiswaComments.displayName,
      body: schema.mahasiswaComments.body,
      createdAt: schema.mahasiswaComments.createdAt,
      pinned: schema.mahasiswaComments.pinned,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.briefingSlug, slug),
        eq(schema.mahasiswaComments.status, "approved"),
      ),
    )
    .orderBy(
      sql`${schema.mahasiswaComments.pinned} DESC, ${schema.mahasiswaComments.createdAt} DESC`,
    )
    .limit(limit);
}
