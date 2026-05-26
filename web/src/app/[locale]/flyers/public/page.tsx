import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";

import { FlyerGrid } from "../FlyerGrid";

// 60s revalidation — gallery is anon-readable, gets traffic, and the
// underlying data only changes when users publish new flyers or a
// fresh weekly briefing lands. 1-min cache keeps the page snappy
// without serving very stale state.
export const revalidate = 60;

/**
 * Subset of /api/insights-brief/{slug}/flyer variants we surface in
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
}: PageProps<"/[locale]/flyers/public">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("UserFlyers");
  const session = await auth();
  const langParam = locale === "en" ? "en" : "id";

  // ── Pull system flyers from the last 60 days of briefings ──────
  // Each briefing → 6 system flyer cards (one per share variant).
  // Capped at 12 briefings (= 72 cards) so this surface scales when
  // the corpus grows; sorted newest first.
  //
  // The 60-day cutoff is computed in SQL (`now() - interval '60 days'`)
  // rather than via `Date.now()` in the component body — the latter
  // trips React 19's "impure call during render" lint and pushes
  // non-determinism into the route.
  const briefingRows = await db
    .select({
      id: schema.insightsSummaries.id,
      generatedAt: schema.insightsSummaries.generatedAt,
      segment: schema.insightsSummaries.segment,
    })
    .from(schema.insightsSummaries)
    .where(sql`generated_at >= now() - interval '60 days'`)
    .orderBy(desc(schema.insightsSummaries.generatedAt))
    .limit(12);

  const systemFlyers = briefingRows.flatMap((b) => {
    const dateStr = formatWibDate(b.generatedAt);
    const segmentKey = b.segment ?? "all";
    const slug = `${dateStr}-${segmentKey}`;
    const segLabel = SEGMENT_LABEL_ID[segmentKey] ?? segmentKey;
    return SYSTEM_VARIANTS.map((v) => ({
      id: `system:${b.id}:${v}`,
      headline: `${VARIANT_LABEL[v]} — ${segLabel}`,
      visibility: "public" as const,
      createdAt: b.generatedAt.toISOString(),
      kind: "system" as const,
      pngUrl: `/api/insights-brief/${slug}/flyer?variant=${v}&lang=${langParam}`,
    }));
  });

  // ── Pull user-published flyers (last 60 days; future-proof, the
  // page paginates so the cap stays low). ──────────────────────
  const userRows = await db
    .select({
      id: schema.userFlyers.id,
      headline: schema.userFlyers.headline,
      visibility: schema.userFlyers.visibility,
      createdAt: schema.userFlyers.createdAt,
    })
    .from(schema.userFlyers)
    .where(
      and(
        eq(schema.userFlyers.visibility, "public"),
        sql`${schema.userFlyers.createdAt} >= now() - interval '60 days'`,
      ),
    )
    .orderBy(desc(schema.userFlyers.createdAt))
    .limit(60);

  const userFlyers = userRows.map((r) => ({
    id: r.id,
    headline: r.headline,
    visibility: r.visibility as "private" | "public",
    createdAt: r.createdAt.toISOString(),
    kind: "user" as const,
  }));

  // Merge + sort newest first.
  const flyers = [...systemFlyers, ...userFlyers].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
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

      {flyers.length === 0 ? (
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
          flyers={flyers}
          labels={{
            visibilityBadgePublic: t("visibility_badge_public"),
            visibilityBadgePrivate: t("visibility_badge_private"),
            badgeSystem: t("badge_system"),
            deleteButton: t("delete_button"),
            deleteConfirm: t("delete_confirm"),
            openLarge: t("result_open_large"),
            download: t("result_download"),
          }}
        />
      )}
    </div>
  );
}
