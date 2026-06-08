import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

import {
  listPublicRoomOverviews,
  wibDateString,
} from "@/lib/discussions-data";
import { DiscussionsBoard } from "./DiscussionsBoard";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/discussions">): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Discussion");
  return {
    title: t("discussions_index_title"),
    description: t("discussions_index_subtitle"),
  };
}

export default async function DiscussionsPage({
  params,
}: PageProps<"/[locale]/discussions">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Discussion");

  const rooms = await listPublicRoomOverviews();

  // Normalise for the client component — Dates → ISO strings so React
  // can serialize, plus a precomputed WIB-date label for the week
  // filter group-by.
  const items = rooms.map((r) => ({
    slug: r.slug,
    segment: r.segment,
    generatedAt: r.generatedAt.toISOString(),
    weekKey: wibDateString(r.generatedAt),
    title: r.title,
    totalApproved: r.totalApproved,
    approved7d: r.approved7d,
    lastActivityAt: r.lastActivityAt
      ? r.lastActivityAt.toISOString()
      : null,
    muted: r.muted,
  }));

  return (
    <section className="relative isolate min-h-screen pt-12 pb-20 sm:pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute -top-20 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-200/40 opacity-50 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
            {t("discussions_index_title")}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("discussions_index_subtitle")}
          </p>
        </header>

        <div className="mt-10">
          <DiscussionsBoard
            initialItems={items}
            locale={locale}
            labels={{
              filterAll: t("discussions_filter_all"),
              filterMine: t("discussions_filter_mine"),
              filterActive: t("discussions_filter_active"),
              filterDormant: t("discussions_filter_dormant"),
              filterWeek: t("discussions_filter_week"),
              filterSegment: t("discussions_filter_segment"),
              segmentAll: t("discussions_segment_all"),
              statusActive: t("discussions_status_active"),
              statusDormant: t("discussions_status_dormant"),
              statusMuted: t("discussions_status_muted"),
              commentOne: t("discussions_comment_one"),
              commentMany: t("discussions_comment_many"),
              lastActivity: t("discussions_last_activity"),
              lastActivityNone: t("discussions_last_activity_none"),
              open: t("discussions_open"),
              empty: t("discussions_empty"),
              emptyMine: t("discussions_empty_mine"),
              myCountOne: t("discussions_my_count_one"),
              myCountMany: t("discussions_my_count_many"),
              clearFilters: t("discussions_clear_filters"),
            }}
          />
        </div>
      </div>
    </section>
  );
}
