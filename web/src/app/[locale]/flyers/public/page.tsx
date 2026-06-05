import type { Metadata } from "next";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { MonthPickerPager } from "@/components/MonthPickerPager";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import {
  monthRangeUtc,
  parseMonthParam,
  parsePageParam,
} from "@/lib/month-filter";

import { FlyerGrid } from "../FlyerGrid";

// 60s revalidation — gallery is anon-readable, gets traffic, and the
// underlying data only changes when users publish new flyers or a
// fresh weekly briefing lands. 1-min cache keeps the page snappy
// without serving very stale state.
export const revalidate = 60;

// 6 per page (was 30) so the gallery is browsable in shorter scroll
// chunks. With the typical 30-card "this week" default still rendering
// fully in one view via 5 segments × 6 variants, this matters most for
// archive (month-filtered) browsing.
const PAGE_SIZE = 6;

/**
 * Subset of /api/briefings/{slug}/flyer variants we surface in
 * the public gallery. Skips `poster` (Mahasiswa-only, A4 portrait —
 * doesn't fit the 1080×1080 share-tile model) and `genz-a`/`genz-b`
 * since they're already covered by the segment-specific briefings.
 *
 * UPDATE: actually include all 6 share variants so the gallery shows
 * the FULL share-pack the briefing pipeline produces.
 */
const SYSTEM_VARIANTS = [
  "general-a",
  "general-b",
  "genz-a",
  "genz-b",
  "sunnah-a",
  "sunnah-b",
] as const;

const VARIANT_LABEL: Record<(typeof SYSTEM_VARIANTS)[number], string> = {
  "general-a": "Khutbah",
  "general-b": "Aksi Sosial",
  "genz-a": "Hook Konten",
  "genz-b": "Refleksi Gen Z",
  "sunnah-a": "Ajakan Sunnah",
  "sunnah-b": "Doa Pekan Ini",
};

const SEGMENT_LABEL_ID: Record<string, string> = {
  all: "Umum",
  spiritual: "Spiritual & Akhlaq",
  family: "Keluarga",
  youth: "Pemuda",
  justice: "Keadilan",
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flyers/public">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "UserFlyers" });
  return { title: t("page_title_public") };
}

function formatWibDate(d: Date): string {
  // YYYY-MM-DD in Asia/Jakarta — the same slug shape getBriefingBySlug
  // expects.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

export default async function PublicFlyersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/flyers/public">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("UserFlyers");
  const tBriefs = await getTranslations("Briefs");
  const session = await auth();
  const langParam = locale === "en" ? "en" : "id";
  const sp = await searchParams;
  const selectedMonth = parseMonthParam(sp.month);
  const page = parsePageParam(sp.page);

  // ── Months available for the picker dropdown ──────────────────
  // Union of months that have at least one briefing OR at least one
  // public user_flyer. WIB-anchored so a row at 2026-04-30 23:00 UTC
  // (= 2026-05-01 06:00 WIB) shows up under May, matching the user's
  // local-clock intuition.
  const monthRows = (await db.execute(sql`
    SELECT year, month FROM (
      SELECT DISTINCT
        EXTRACT(YEAR FROM (generated_at AT TIME ZONE 'Asia/Jakarta'))::int AS year,
        EXTRACT(MONTH FROM (generated_at AT TIME ZONE 'Asia/Jakarta'))::int AS month
      FROM insights_summaries
      UNION
      SELECT DISTINCT
        EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS year,
        EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS month
      FROM user_flyers
      WHERE visibility = 'public'
    ) months
    ORDER BY year DESC, month DESC
  `)) as unknown as Array<{ year: number; month: number }>;
  const monthsAvailable = monthRows.map((r) => ({
    year: Number(r.year),
    month: Number(r.month),
  }));

  // ── Briefings to render ───────────────────────────────────────
  // Default (no month selected): the most-recent briefing per segment
  // — keeps this-week's drop on top and caps cards at ~30. Picking a
  // month switches to archive mode and pulls every briefing within
  // that WIB month.
  let briefingRows: Array<{
    id: string;
    generated_at: Date;
    segment: string | null;
  }>;
  if (selectedMonth) {
    const { startUtc, endUtc } = monthRangeUtc(
      selectedMonth.year,
      selectedMonth.month,
    );
    briefingRows = (await db.execute(sql`
      SELECT id, generated_at, segment
      FROM insights_summaries
      WHERE generated_at >= ${startUtc.toISOString()}
        AND generated_at <  ${endUtc.toISOString()}
      ORDER BY generated_at DESC, segment NULLS FIRST
    `)) as unknown as Array<{
      id: string;
      generated_at: Date;
      segment: string | null;
    }>;
  } else {
    briefingRows = (await db.execute(sql`
      SELECT DISTINCT ON (segment) id, generated_at, segment
      FROM insights_summaries
      ORDER BY segment NULLS FIRST, generated_at DESC
    `)) as unknown as Array<{
      id: string;
      generated_at: Date;
      segment: string | null;
    }>;
  }

  const systemFlyers = briefingRows.flatMap((b) => {
    const generatedAt = new Date(b.generated_at);
    const dateStr = formatWibDate(generatedAt);
    const segmentKey = b.segment ?? "all";
    const slug = `${dateStr}-${segmentKey}`;
    const segLabel = SEGMENT_LABEL_ID[segmentKey] ?? segmentKey;
    return SYSTEM_VARIANTS.map((v) => ({
      id: `system:${b.id}:${v}`,
      headline: `${VARIANT_LABEL[v]} — ${segLabel}`,
      visibility: "public" as const,
      createdAt: generatedAt.toISOString(),
      kind: "system" as const,
      // Drives the gallery's Type + Topic filters. User flyers leave
      // these undefined (they have no fixed type/segment).
      typeLabel: VARIANT_LABEL[v],
      topicLabel: segLabel,
      pngUrl: `/api/briefings/${slug}/flyer?variant=${v}&lang=${langParam}`,
    }));
  });

  // ── User-published flyers ─────────────────────────────────────
  // Same scoping rule as briefings: by-month when a month is picked,
  // otherwise last 60 days (current behavior).
  const userFlyerWhere = selectedMonth
    ? (() => {
        const { startUtc, endUtc } = monthRangeUtc(
          selectedMonth.year,
          selectedMonth.month,
        );
        return and(
          eq(schema.userFlyers.visibility, "public"),
          gte(schema.userFlyers.createdAt, startUtc),
          lt(schema.userFlyers.createdAt, endUtc),
        )!;
      })()
    : and(
        eq(schema.userFlyers.visibility, "public"),
        sql`${schema.userFlyers.createdAt} >= now() - interval '60 days'`,
      )!;

  const userRows = await db
    .select({
      id: schema.userFlyers.id,
      headline: schema.userFlyers.headline,
      visibility: schema.userFlyers.visibility,
      createdAt: schema.userFlyers.createdAt,
    })
    .from(schema.userFlyers)
    .where(userFlyerWhere)
    .orderBy(desc(schema.userFlyers.createdAt))
    .limit(selectedMonth ? 240 : 60);

  const userFlyers = userRows.map((r) => ({
    id: r.id,
    headline: r.headline,
    visibility: r.visibility as "private" | "public",
    createdAt: r.createdAt.toISOString(),
    kind: "user" as const,
  }));

  // Merge + sort newest first, then paginate.
  const allFlyers = [...systemFlyers, ...userFlyers].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  const totalPages = Math.max(1, Math.ceil(allFlyers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageFlyers = allFlyers.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance text-2xl font-bold text-slate-900 sm:text-3xl">
            {t("page_title_public")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("subtitle_public")}
          </p>
        </div>
        {session?.user?.id && (
          <Link
            href="/flyers/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
          >
            <Sparkles className="h-4 w-4" />
            {t("cta_new_flyer")}
          </Link>
        )}
      </header>

      {monthsAvailable.length > 0 && (
        <MonthPickerPager
          baseHref="/flyers/public"
          monthsAvailable={monthsAvailable}
          selectedMonth={selectedMonth}
          page={safePage}
          totalPages={totalPages}
          locale={locale}
          labels={{
            monthLabel: tBriefs("filter_month_label"),
            // Default ("no month") view is this-week's drop only, not
            // every public flyer ever — so override the picker's
            // generic "All time" label to match.
            allTime: tBriefs("filter_latest_week"),
            pageOf: tBriefs("filter_page_of", {
              current: safePage,
              total: totalPages,
            }),
            prev: tBriefs("filter_prev"),
            next: tBriefs("filter_next"),
          }}
        />
      )}

      {pageFlyers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {t("empty_public_title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("empty_public_body")}
          </p>
        </div>
      ) : (
        <FlyerGrid
          flyers={pageFlyers}
          locale={locale}
          labels={{
            visibilityBadgePublic: t("visibility_badge_public"),
            visibilityBadgePrivate: t("visibility_badge_private"),
            badgeSystem: t("badge_system"),
            deleteButton: t("delete_button"),
            deleteConfirm: t("delete_confirm"),
            openLarge: t("result_open_large"),
            download: t("result_download"),
            filters: {
              source: t("filter_source"),
              type: t("filter_type"),
              topic: t("filter_topic"),
              month: t("filter_month"),
              all: t("filter_all"),
              sourceWeekly: t("filter_source_weekly"),
              sourceUser: t("filter_source_user"),
              empty: t("filter_empty"),
            },
          }}
        />
      )}
    </div>
  );
}
