import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Eye,
  Info,
  Newspaper,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { DigestOptInPrompt } from "@/components/DigestOptInPrompt";
import { InsightsHeadlinePills } from "@/components/InsightsHeadlinePills";
import {
  getLatestInsightsSummary,
  getOverviewInsights,
  type LatestInsightsSummary,
} from "@/lib/insights-data";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/insights">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Insights" });
  return { title: t("page_title") };
}

export default async function InsightsPage({
  params,
}: PageProps<"/[locale]/insights">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Insights");
  // Live aggregation over `social_posts`. Returns null when the pipeline
  // hasn't ingested anything yet — page renders an honest empty state
  // instead of inventing numbers.
  const [overview, summary, session] = await Promise.all([
    getOverviewInsights(),
    getLatestInsightsSummary(),
    auth(),
  ]);

  // Show the weekly-digest opt-in prompt only for signed-in users
  // who haven't already opted in. Anonymous visitors get nothing
  // (they need a verified email first).
  let showDigestPrompt = false;
  if (session?.user?.id) {
    const [row] = await db
      .select({ optedIn: schema.users.emailDigestOptIn })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    showDigestPrompt = !row?.optedIn;
  }

  // Trending topics: Gemini-discovered themes, top 5 by post count.
  // Empty until the nightly re-cluster has run (04:00 WIB).
  const trendingRows = overview?.trendingTopics ?? [];

  // Top dominant da'wah categories, color-cycled for visual variety.
  const CATEGORY_TONES = [
    "bg-brand-500",
    "bg-emerald-500",
    "bg-cyan-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-violet-500",
  ];
  const categories = (overview?.dominantCategories ?? [])
    .slice(0, 6)
    .map((c, i) => ({
      label: localizeCategory(t, c.category),
      volume: c.posts,
      tone: CATEGORY_TONES[i % CATEGORY_TONES.length],
    }));
  const catMax = categories.length
    ? Math.max(...categories.map((c) => c.volume))
    : 1;

  // Sentiment percentages — guarded against divide-by-zero pre-ingest.
  const mix = overview?.sentimentMix ?? {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const sentimentTotal = mix.positive + mix.neutral + mix.negative;
  const sentimentPct = {
    positive: sentimentTotal ? (mix.positive / sentimentTotal) * 100 : 0,
    neutral: sentimentTotal ? (mix.neutral / sentimentTotal) * 100 : 0,
    negative: sentimentTotal ? (mix.negative / sentimentTotal) * 100 : 0,
  };

  const totalPosts = overview?.totalPosts ?? 0;

  return (
    <>
      <section className="relative isolate overflow-hidden pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute inset-0 grid-bg opacity-50" />
          <div className="absolute -top-20 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand-200 opacity-50 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
            <Eye className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h1 className="mt-6 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("subtitle")}
          </p>
        </div>
      </section>

      {summary && <ExecutiveBriefing summary={summary} t={t} locale={locale} />}

      {showDigestPrompt && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <DigestOptInPrompt
            title={t("digest_prompt_title")}
            body={t("digest_prompt_body")}
            yesLabel={t("digest_prompt_yes")}
            noLabel={t("digest_prompt_no")}
          />
        </div>
      )}

      {/* Audience-segment chips. Each links to /insights/segment/X
          for a filtered view (e.g. "just family + youth chatter"). */}
      <section className="pb-2 pt-2">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t("segments_chip_label")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { focus: "spiritual", label: t("segment_spiritual_title"), tone: "bg-emerald-50 text-emerald-800 ring-emerald-100" },
                { focus: "family", label: t("segment_family_title"), tone: "bg-rose-50 text-rose-800 ring-rose-100" },
                { focus: "youth", label: t("segment_youth_title"), tone: "bg-cyan-50 text-cyan-800 ring-cyan-100" },
                { focus: "justice", label: t("segment_justice_title"), tone: "bg-amber-50 text-amber-800 ring-amber-100" },
              ] as const
            ).map((s) => (
              <Link
                key={s.focus}
                href={`/insights/segment/${s.focus}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition hover:-translate-y-0.5 hover:shadow-sm ${s.tone}`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-16 sm:pb-20">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-3">
          {/* Trending — Gemini-discovered themes, top 5 by post count.
              Empty until the nightly re-cluster has populated `topics`. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                {t("section_trending")}
              </h2>
              <TrendingUp className="h-4 w-4 text-brand-600" />
            </div>
            {trendingRows.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-xs text-slate-500">
                {t("how_coverage_posts_empty")}
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                {trendingRows.map((r, i) => (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-slate-100" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {r.label}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {r.keywords.slice(0, 4).join(" · ") || r.platform}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-slate-600">
                      {r.postCount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sentiment + categories */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
              {t("section_sentiment")}
            </h2>
            {sentimentTotal === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
                {t("how_coverage_posts_empty")}
              </div>
            ) : (
              <>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                  <span
                    className="bg-emerald-500"
                    style={{ width: `${sentimentPct.positive}%` }}
                  />
                  <span
                    className="bg-slate-300"
                    style={{ width: `${sentimentPct.neutral}%` }}
                  />
                  <span
                    className="bg-amber-500"
                    style={{ width: `${sentimentPct.negative}%` }}
                  />
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <SentimentRow
                    color="bg-emerald-500"
                    pct={`${Math.round(sentimentPct.positive)}%`}
                    label={t("live_sentiment_positive")}
                  />
                  <SentimentRow
                    color="bg-slate-300"
                    pct={`${Math.round(sentimentPct.neutral)}%`}
                    label={t("live_sentiment_neutral")}
                  />
                  <SentimentRow
                    color="bg-amber-500"
                    pct={`${Math.round(sentimentPct.negative)}%`}
                    label={t("live_sentiment_concerned")}
                  />
                </div>
              </>
            )}

            <h3 className="mt-6 text-balance text-base font-semibold text-slate-900 sm:text-lg">
              {t("section_categories")}
            </h3>
            {categories.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
                {t("how_coverage_posts_empty")}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {categories.map((c) => (
                  <div key={c.label} className="text-xs">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                      <span>{c.label}</span>
                      <span className="tabular-nums">
                        {c.volume.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${c.tone}`}
                        style={{ width: `${(c.volume / catMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {totalPosts > 0 && (
              <p className="mt-4 text-[10px] text-slate-400">
                {totalPosts.toLocaleString()} posts ingested
              </p>
            )}
          </div>
        </div>

      </section>

      <PlatformsBreakdown
        t={t}
        breakdown={overview?.platformBreakdown ?? []}
      />

      <section className="pb-20 sm:pb-28">
        {process.env.NODE_ENV !== "production" && (
          <p className="mx-auto mb-12 flex max-w-3xl items-center justify-center gap-1.5 px-4 text-center text-xs text-slate-500 sm:px-6">
            <Info className="h-3.5 w-3.5" />
            {t("data_note")}
          </p>
        )}

        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
            >
              <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
              <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Free forever
            </span>
            <h2 className="mt-6 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
              {t("cta_title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
              {t("cta_body")}
            </p>
            <Link
              href="/login"
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
            >
              {t("cta_button")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Insights">>>;

/* ────────────────────────────────────────────────────────────────
 * Executive briefing hero — daily AI-narrated summary + pill row.
 *
 * Data lives in `insights_summaries`, written by a Celery beat task
 * at 04:30 WIB after topic discovery. UI is intentionally large +
 * narrative-first; the existing widgets below act as supporting
 * detail for anyone who wants to drill in.
 * ──────────────────────────────────────────────────────────────── */
function ExecutiveBriefing({
  summary,
  t,
  locale,
}: {
  summary: LatestInsightsSummary;
  t: T;
  locale: string;
}) {
  const stats = summary.headlineStats ?? {};

  // Format the generation time as an absolute date — Next.js's
  // react-hooks purity rule rejects `Date.now()` in server components.
  // Absolute timestamp is also more accessible / less ambiguous than
  // "X hours ago" for users in different timezones.
  const generatedLabel = new Date(summary.generatedAt).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="pb-12 pt-2 sm:pb-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-emerald-50/30 to-brand-50/30 p-6 shadow-sm sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-12 h-44 w-44 rounded-full bg-emerald-200 opacity-30 blur-3xl"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {t("exec_briefing_label")}
            </span>
            <p className="text-[11px] text-slate-500">
              {t("exec_briefing_generated", { when: generatedLabel })}
            </p>
          </div>

          <p className="mt-5 whitespace-pre-line text-pretty text-base leading-relaxed text-slate-800 sm:text-lg">
            {summary.summaryMd}
          </p>

          {/* Retrieved daleel chips. The narrative may reference these
              inline (per PRD §12, citations must come from the kitab
              corpus — the LLM was forbidden from inventing them).
              Each chip links back to the kitab passage. */}
          {summary.daleelRefs && summary.daleelRefs.length > 0 && (
            <DaleelChips refs={summary.daleelRefs} t={t} />
          )}

          <InsightsHeadlinePills
            stats={stats}
            locale={locale}
            t={(key) => t(key as Parameters<typeof t>[0])}
            localizeCategory={(cat) => localizeCategory(t, cat)}
          />

          <p className="mt-5 text-[10px] text-slate-400">
            {t("exec_briefing_model_credit", { model: summary.model })}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the daleel passages the LLM was permitted to cite for this
 * briefing, as a horizontal chip strip beneath the narrative. Each
 * chip shows corpus + citation; clicking deep-links into /kitab with
 * the citation as the search query so the user can read it in full.
 *
 * Rendered as a chip strip rather than a vertical list so it stays
 * visually subordinate to the narrative — the AI's text is the
 * primary read; the daleel is provenance the user can verify.
 */
function DaleelChips({
  refs,
  t,
}: {
  refs: NonNullable<LatestInsightsSummary["daleelRefs"]>;
  t: T;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/60 p-3 sm:p-4">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        <BookOpen className="h-3 w-3" />
        {t("exec_daleel_label")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {refs.map((ref) => (
          <Link
            key={ref.ref_id}
            href={{
              pathname: "/kitab",
              query: { q: ref.citation, kitab: ref.corpus },
            }}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
            title={ref.translation_id || ref.translation_en || ""}
          >
            <span className="font-semibold uppercase tracking-wider text-emerald-700 text-[9px]">
              {ref.corpus.replace(/_/g, " ")}
            </span>
            <span className="truncate font-medium">{ref.citation}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// HeadlinePill moved to @/components/InsightsHeadlinePills for reuse on
// /insights/segment/[focus]. ExecutiveBriefing now imports InsightsHeadlinePills.

// Visual config per platform. Wired from real DB data (post counts,
// top topic, top category) — no hardcoded percentages anymore.
const PLATFORM_VISUALS: Record<
  string,
  {
    key: string;
    Icon: React.ComponentType<{ className?: string }>;
    iconBg: string;
    barColor: string;
    href: string;
  }
> = {
  mainstream: {
    key: "news",
    Icon: Newspaper,
    iconBg: "bg-slate-900",
    barColor: "bg-slate-500",
    href: "/insights/mainstream",
  },
  youtube: {
    key: "youtube",
    Icon: YouTubeIcon,
    iconBg: "bg-red-600",
    barColor: "bg-red-500",
    href: "/insights/youtube",
  },
  tiktok: {
    key: "tiktok",
    Icon: TikTokIcon,
    iconBg: "bg-black",
    barColor: "bg-fuchsia-500",
    href: "/insights/tiktok",
  },
  x: {
    key: "x",
    Icon: XIcon,
    iconBg: "bg-black",
    barColor: "bg-zinc-700",
    href: "/insights/x",
  },
  instagram: {
    key: "instagram",
    Icon: InstagramIcon,
    iconBg: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
    barColor: "bg-rose-500",
    href: "/insights/instagram",
  },
  facebook: {
    key: "facebook",
    Icon: FacebookIcon,
    iconBg: "bg-[#1877F2]",
    barColor: "bg-blue-600",
    href: "/insights/facebook",
  },
};

const PLATFORM_ORDER = ["mainstream", "youtube", "tiktok", "x", "instagram", "facebook"];

function PlatformsBreakdown({
  t,
  breakdown,
}: {
  t: T;
  breakdown: Array<{
    platform: string;
    posts: number;
    topTopic: { label: string; keywords: string[] } | null;
    topCategory: string | null;
  }>;
}) {
  // Map DB rows by platform name + compute share %.
  const byPlatform = new Map(breakdown.map((b) => [b.platform, b]));
  const totalPosts = breakdown.reduce((s, b) => s + b.posts, 0) || 1;

  // Render in fixed order so the layout is stable across days. Platforms
  // with zero posts still render (greyed) so visitors see the full surface
  // even before all sources are active.
  const rows = PLATFORM_ORDER.map((platform) => {
    const visual = PLATFORM_VISUALS[platform];
    const data = byPlatform.get(platform);
    const posts = data?.posts ?? 0;
    const sharePct = (posts / totalPosts) * 100;
    return {
      platform,
      visual,
      posts,
      sharePct,
      topTopic: data?.topTopic ?? null,
      topCategory: data?.topCategory ?? null,
    };
  });

  if (totalPosts <= 1 && breakdown.length === 0) {
    // No data at all — show a single empty state instead of greyed cards.
    return (
      <section className="pb-16 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("section_platforms")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
              {t("section_platforms_subtitle")}
            </p>
          </div>
          <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            {t("how_coverage_posts_empty")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-16 sm:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_platforms")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_platforms_subtitle")}
          </p>
        </div>

        {/* Source mix bar */}
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("section_source_mix")}
          </p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full">
            {rows.map((r) =>
              r.sharePct > 0 ? (
                <span
                  key={r.platform}
                  className={r.visual.barColor}
                  style={{ width: `${r.sharePct}%` }}
                  title={`${r.visual.key} · ${r.sharePct.toFixed(1)}%`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            {rows.map((r) => (
              <span
                key={r.platform}
                className={`inline-flex items-center gap-1.5 ${r.posts === 0 ? "text-slate-400" : "text-slate-600"}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${r.visual.barColor}`} />
                <span className="font-medium text-slate-700">
                  {t(`platform_${r.visual.key}_name` as Parameters<typeof t>[0])}
                </span>
                <span className="tabular-nums">
                  {r.posts === 0 ? "—" : `${r.sharePct.toFixed(1)}%`}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Platform cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const { visual, posts, topTopic, topCategory } = r;
            const { Icon, iconBg, href } = visual;
            const hasData = posts > 0;
            const categoryLabel = topCategory
              ? t(`dawah_category_${topCategory}` as Parameters<typeof t>[0])
              : null;
            const inner = (
              <>
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${iconBg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {t(`platform_${visual.key}_name` as Parameters<typeof t>[0])}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="tabular-nums">
                        {hasData
                          ? `${posts.toLocaleString()} posts`
                          : t("how_coverage_posts_empty")}
                      </span>
                      {hasData && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                          {r.sharePct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {hasData && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                  )}
                </div>

                {hasData && (
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {t("platform_top_topic")}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {topTopic?.label ?? t("platform_top_topic_pending")}
                    </p>
                    {(topTopic?.keywords.length || categoryLabel) && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {topTopic?.keywords.slice(0, 3).join(" · ") || categoryLabel}
                      </p>
                    )}
                  </div>
                )}

                {hasData && (
                  <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 group-hover:text-brand-900">
                    {t("platform_view_breakdown")}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </p>
                )}
              </>
            );

            const cardClass = clsx(
              "group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition",
              hasData && "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
              !hasData && "opacity-60",
            );

            return hasData ? (
              <Link key={visual.key} href={href} className={cardClass}>
                {inner}
              </Link>
            ) : (
              <article key={visual.key} className={cardClass}>
                {inner}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.16a8.16 8.16 0 0 0 4.77 1.52V6.23a4.85 4.85 0 0 1-1.84-.54z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.849.07 3.255.148 4.771 1.691 4.919 4.919.058 1.265.069 1.644.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.849.07-3.205 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function SentimentRow({
  color,
  pct,
  label,
}: {
  color: string;
  pct: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="font-semibold tabular-nums text-slate-700">{pct}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

function localizeCategory(t: T, category: string): string {
  return t(`dawah_category_${category}` as Parameters<typeof t>[0]);
}
