import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Lock, MessagesSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { issueCommentToken } from "@/lib/comment-token";
import { localeAwareFormatDateTime } from "@/lib/date-id";
import { CommentForm } from "./CommentForm";

type Palette = {
  bgLight: string;
  bgMid: string;
  bgDeep: string;
  accent: string;
  accentDeep: string;
  soft: string;
  quoteBg: string;
  quoteBorder: string;
};

const INITIAL_PAGE_SIZE = 10;

/**
 * Public discussion surface — anyone can write, regex+LLM moderation
 * runs server-side at submit. Listing is server-rendered so the first
 * 10 comments land in the initial HTML payload (good for SEO + cold
 * scans from a QR code).
 *
 * Pagination above 10 happens client-side via the /comments GET route;
 * the form mounts there too.
 */
export async function DiscussionSection({
  briefingSlug,
  locale,
  palette,
}: {
  briefingSlug: string;
  locale: string;
  palette: Palette;
}) {
  const t = await getTranslations("Discussion");

  // Admins + superadmins get an inline Delete button on every
  // comment + reply, so moderation doesn't require bouncing to
  // /admin/system/discussion for an obvious spam post sitting
  // right in front of them.
  const session = await auth();
  const viewerCanModerate =
    session?.user?.role === "admin" || session?.user?.role === "superadmin";

  // Top-level rows first, then a follow-up batch query for every
  // reply hanging off them. Replies render inline (no collapse) —
  // moderators wondering "where did this approved comment go?" would
  // otherwise miss replies hidden behind the toggle.
  const [topRows, [roomRow]] = await Promise.all([
    db
      .select({
        id: schema.mahasiswaComments.id,
        displayName: schema.mahasiswaComments.displayName,
        body: schema.mahasiswaComments.body,
        createdAt: schema.mahasiswaComments.createdAt,
        pinned: schema.mahasiswaComments.pinned,
        editedAt: schema.mahasiswaComments.editedAt,
      })
      .from(schema.mahasiswaComments)
      .where(
        and(
          eq(schema.mahasiswaComments.briefingSlug, briefingSlug),
          eq(schema.mahasiswaComments.status, "approved"),
          isNull(schema.mahasiswaComments.parentId),
        ),
      )
      .orderBy(
        desc(schema.mahasiswaComments.pinned),
        desc(schema.mahasiswaComments.createdAt),
      )
      .limit(INITIAL_PAGE_SIZE + 1),
    db
      .select({ mutedAt: schema.mahasiswaRoomSettings.mutedAt })
      .from(schema.mahasiswaRoomSettings)
      .where(eq(schema.mahasiswaRoomSettings.briefingSlug, briefingSlug))
      .limit(1),
  ]);

  const isMuted = !!roomRow?.mutedAt;
  const hasMore = topRows.length > INITIAL_PAGE_SIZE;
  const pageRows = topRows.slice(0, INITIAL_PAGE_SIZE);

  // Pull all approved replies for the visible top-level rows in one
  // round-trip, then group by parent. Empty when no rows on this page.
  const parentIds = pageRows.map((r) => r.id);
  const replyRows =
    parentIds.length === 0
      ? []
      : await db
          .select({
            id: schema.mahasiswaComments.id,
            parentId: schema.mahasiswaComments.parentId,
            displayName: schema.mahasiswaComments.displayName,
            body: schema.mahasiswaComments.body,
            createdAt: schema.mahasiswaComments.createdAt,
            editedAt: schema.mahasiswaComments.editedAt,
          })
          .from(schema.mahasiswaComments)
          .where(
            and(
              eq(schema.mahasiswaComments.status, "approved"),
              inArray(schema.mahasiswaComments.parentId, parentIds),
            ),
          )
          .orderBy(asc(schema.mahasiswaComments.createdAt));

  const repliesByParent = new Map<string, typeof replyRows>();
  for (const r of replyRows) {
    if (!r.parentId) continue;
    const list = repliesByParent.get(r.parentId) ?? [];
    list.push(r);
    repliesByParent.set(r.parentId, list);
  }

  const initialItems = pageRows.map((r) => {
    const childReplies = repliesByParent.get(r.id) ?? [];
    return {
      id: r.id,
      displayName: r.displayName,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      pinned: r.pinned,
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      replyCount: childReplies.length,
      replies: childReplies.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt ? c.editedAt.toISOString() : null,
      })),
    };
  });

  return (
    <section
      className="border-t print:hidden"
      style={{ borderColor: palette.soft + "60" }}
    >
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="mb-3 flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: palette.quoteBg, color: palette.accentDeep }}
          >
            <MessagesSquare className="h-4 w-4" />
          </span>
          <h2
            className="text-balance text-2xl font-extrabold tracking-tight sm:text-3xl"
            style={{ color: palette.accentDeep }}
          >
            {t("heading")}
          </h2>
        </div>

        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-[15px]">
          {t("invitation")}
        </p>
        {!isMuted && (
          <p className="mt-2 max-w-2xl text-pretty text-[12.5px] leading-relaxed text-slate-500">
            {t("moderation_note")}
          </p>
        )}

        {isMuted && (
          <div
            role="note"
            className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[13px] leading-relaxed text-amber-900"
          >
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("muted_note")}</p>
          </div>
        )}

        <div className="mt-7">
          <CommentForm
            briefingSlug={briefingSlug}
            submitToken={issueCommentToken(briefingSlug)}
            muted={isMuted}
            viewerCanModerate={viewerCanModerate}
            palette={{
              accent: palette.accent,
              accentDeep: palette.accentDeep,
              soft: palette.soft,
              quoteBg: palette.quoteBg,
            }}
            labels={{
              nameLabel: t("name_label"),
              namePlaceholder: t("name_placeholder"),
              bodyLabel: t("body_label"),
              bodyPlaceholder: t("body_placeholder"),
              submit: t("submit"),
              submitting: t("submitting"),
              successPublished: t("success_published"),
              successPending: t("success_pending"),
              errorInvalid: t("error_invalid"),
              errorRate: t("error_rate"),
              errorStale: t("error_stale"),
              errorForbidden: t("error_forbidden"),
              errorMuted: t("error_muted"),
              errorGeneric: t("error_generic"),
              loadMore: t("load_more"),
              loading: t("loading"),
              empty: t("empty"),
              pinned: t("pinned"),
              notifyLabel: t("notify_label"),
              notifyHint: t("notify_hint"),
              notifyPrivacy: t("notify_privacy"),
              emailPlaceholder: t("email_placeholder"),
              successNotify: t("success_notify"),
              edit: t("edit"),
              editSave: t("edit_save"),
              editSaving: t("edit_saving"),
              editCancel: t("edit_cancel"),
              editLabel: t("edit_label"),
              editWindowHint: t("edit_window_hint", { minutes: 15 }),
              editSuccess: t("edit_success"),
              editSuccessPending: t("edit_success_pending"),
              editErrorWindow: t("edit_error_window"),
              editErrorLimit: t("edit_error_limit"),
              editErrorForbidden: t("edit_error_forbidden"),
              reply: t("reply"),
              replyBodyPlaceholder: t("reply_body_placeholder"),
              replySend: t("reply_send"),
              replySending: t("reply_sending"),
              replyCancel: t("reply_cancel"),
              replyCountOne: t("reply_count_one"),
              replyCountMany: t("reply_count_many"),
              repliesShow: t("replies_show"),
              repliesHide: t("replies_hide"),
              repliesLoading: t("replies_loading"),
              repliesEmpty: t("replies_empty"),
              modDelete: t("mod_delete"),
              modDeleteConfirm: t("mod_delete_confirm"),
            }}
            initialItems={initialItems}
            initialHasMore={hasMore}
            locale={locale}
          />
        </div>
      </div>
    </section>
  );
}

export function formatCommentDate(iso: string, locale: string): string {
  return localeAwareFormatDateTime(new Date(iso), locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}
