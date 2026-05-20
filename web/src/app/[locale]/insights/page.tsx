import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  ChevronRight,
  Eye,
  Info,
  Newspaper,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { getOverviewInsights } from "@/lib/insights-data";

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
  const overview = await getOverviewInsights();

  // Trending topics: BERTopic-discovered themes, top 5 by post count.
  // Empty until the nightly re-cluster has run (08:00 WIB).
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

      <section className="pb-16 sm:pb-20">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-3">
          {/* Trending — BERTopic-discovered themes, top 5 by post count.
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

      <PlatformsBreakdown t={t} />

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

function PlatformsBreakdown({ t }: { t: T }) {
  const platforms = [
    {
      key: "news",
      Icon: Newspaper,
      iconBg: "bg-slate-900",
      barColor: "bg-slate-500",
      volumePct: 1.5,
      href: "/insights/mainstream",
    },
    {
      key: "youtube",
      Icon: YouTubeIcon,
      iconBg: "bg-red-600",
      barColor: "bg-red-500",
      volumePct: 4.6,
      href: "/insights/youtube",
    },
    {
      key: "tiktok",
      Icon: TikTokIcon,
      iconBg: "bg-black",
      barColor: "bg-fuchsia-500",
      volumePct: 35.1,
      href: "/insights/tiktok",
    },
    {
      key: "x",
      Icon: XIcon,
      iconBg: "bg-black",
      barColor: "bg-zinc-700",
      volumePct: 26.6,
      href: "/insights/x",
    },
    {
      key: "instagram",
      Icon: InstagramIcon,
      iconBg: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
      barColor: "bg-rose-500",
      volumePct: 17.8,
      href: "/insights/instagram",
    },
    {
      key: "facebook",
      Icon: FacebookIcon,
      iconBg: "bg-[#1877F2]",
      barColor: "bg-blue-600",
      volumePct: 14.3,
      href: "/insights/facebook",
    },
  ] as const;

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
            {platforms.map((p) => (
              <span
                key={p.key}
                className={p.barColor}
                style={{ width: `${p.volumePct}%` }}
                title={`${p.key} · ${p.volumePct}%`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            {platforms.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 text-slate-600">
                <span className={`inline-block h-2 w-2 rounded-full ${p.barColor}`} />
                <span className="font-medium text-slate-700">
                  {t(`platform_${p.key}_name` as Parameters<typeof t>[0])}
                </span>
                <span className="text-slate-400">{p.volumePct}%</span>
              </span>
            ))}
          </div>
        </div>

        {/* Platform cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map(({ key, Icon, iconBg, href }) => {
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
                      {t(`platform_${key}_name` as Parameters<typeof t>[0])}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{t(`platform_${key}_volume` as Parameters<typeof t>[0])}</span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                        {t(`platform_${key}_trend` as Parameters<typeof t>[0])}
                      </span>
                    </div>
                  </div>
                  {href && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("platform_top_topic")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {t(`platform_${key}_topic` as Parameters<typeof t>[0])}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {t(`platform_${key}_tag` as Parameters<typeof t>[0])}
                  </p>
                </div>

                {href && (
                  <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 group-hover:text-brand-900">
                    {t("platform_view_breakdown")}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </p>
                )}
              </>
            );

            const cardClass = clsx(
              "group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition",
              href && "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
            );

            return href ? (
              <Link key={key} href={href} className={cardClass}>
                {inner}
              </Link>
            ) : (
              <article key={key} className={cardClass}>
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
