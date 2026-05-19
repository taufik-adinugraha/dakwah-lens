import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  BookOpenCheck,
  Clock,
  Compass,
  Flame,
  Globe2,
  ScrollText,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  getBriefsThisWeek,
  getDailyInsights,
  getPulseSnapshot,
  getTopIssues,
  getTrendingCount24h,
  type DailyInsights as DailyInsightsData,
  type PulseSnapshot,
  type TopIssue,
} from "@/lib/dashboard-metrics";
import { formatPanggilan } from "@/lib/panggilan";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/dashboard">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  return { title: t("page_title") };
}

export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const t = await getTranslations("Dashboard");
  const tBriefs = await getTranslations("Briefs");

  // Indonesian context: addressing someone by their bare first name is too
  // direct. We fetch the profile + use the panggilan helper so the greeting
  // becomes e.g. "Assalamu'alaykum, Ust. Taufik" instead of "Hi Taufik."
  const [profileRow] = await db
    .select({ profile: schema.users.profile })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  const greetingName =
    formatPanggilan(profileRow?.profile ?? null, session.user.name) ||
    session.user.email?.split("@")[0] ||
    "";

  // Pending users get a stripped-down view — no briefs, no insights actions.
  if (session.user.status !== "approved") {
    return <PendingDashboard name={greetingName} t={t} />;
  }

  // Fetch everything in parallel — these are all independent queries.
  const [recentBriefs, pulse, trendingCount, briefsThisWeek, topIssues, insights] =
    await Promise.all([
      db
        .select({
          id: schema.briefs.id,
          topicTitle: schema.briefs.topicTitle,
          segment: schema.briefs.segment,
          tone: schema.briefs.tone,
          isPlaceholder: schema.briefs.isPlaceholder,
          createdAt: schema.briefs.createdAt,
        })
        .from(schema.briefs)
        .where(eq(schema.briefs.userId, session.user.id))
        .orderBy(desc(schema.briefs.createdAt))
        .limit(5),
      getPulseSnapshot(),
      getTrendingCount24h(),
      getBriefsThisWeek(session.user.id),
      getTopIssues(3),
      getDailyInsights(),
    ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <GreetingPulse
        name={greetingName}
        pulse={pulse}
        trendingCount={trendingCount}
        briefsThisWeek={briefsThisWeek}
        t={t}
      />
      <TopIssues issues={topIssues} t={t} />
      <DailyInsights insights={insights} t={t} />
      <RecentBriefs briefs={recentBriefs} t={t} tBriefs={tBriefs} locale={locale} />
      <QuickLinks t={t} />
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Dashboard">>>;
type TBriefs = Awaited<ReturnType<typeof getTranslations<"Briefs">>>;

function GreetingPulse({
  name,
  pulse,
  trendingCount,
  briefsThisWeek,
  t,
}: {
  name: string;
  pulse: PulseSnapshot;
  trendingCount: number;
  briefsThisWeek: number;
  t: T;
}) {
  // Pulse rendering — three states: real score, insufficient data, no movement.
  const hasScore = pulse.score !== null;
  const deltaSign =
    pulse.delta === null ? "flat" : pulse.delta > 0 ? "up" : pulse.delta < 0 ? "down" : "flat";

  return (
    <section className="grid gap-4 sm:grid-cols-[1.4fr_1fr] sm:gap-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-pretty text-sm leading-relaxed text-slate-500">
          {t("subtitle")}
        </p>
        <h1 className="mt-1 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("greeting", { name })}
        </h1>

        <div className="mt-5 flex items-end gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("pulse_label")}
            </p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums text-slate-900">
                {hasScore ? pulse.score!.toFixed(1) : "—"}
              </span>
              <span className="text-sm text-slate-400">/ 10</span>
            </p>
            {hasScore && pulse.delta !== null ? (
              <p
                className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  deltaSign === "up"
                    ? "bg-emerald-50 text-emerald-700"
                    : deltaSign === "down"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                <TrendingUp
                  className={`h-3 w-3 ${deltaSign === "down" ? "rotate-180" : deltaSign === "flat" ? "rotate-90" : ""}`}
                />
                {t(
                  deltaSign === "up"
                    ? "pulse_delta_up"
                    : deltaSign === "down"
                      ? "pulse_delta_down"
                      : "pulse_delta_flat",
                  deltaSign === "flat" ? {} : { delta: Math.abs(pulse.delta).toFixed(1) },
                )}
              </p>
            ) : (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {t("pulse_no_score")}
              </p>
            )}
          </div>
          <PulseSparkline points={pulse.sparkline} />
        </div>

        <p className="mt-4 text-pretty text-xs leading-relaxed text-slate-500">
          {t("pulse_explainer")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 sm:gap-4">
        <MiniStat
          tone="brand"
          icon={Flame}
          label={t("stat_trending_label")}
          value={trendingCount.toString()}
          hint={t("stat_trending_hint")}
        />
        <MiniStat
          tone="amber"
          icon={ScrollText}
          label={t("stat_briefs_this_week_label")}
          value={briefsThisWeek.toString()}
          hint={t("stat_briefs_this_week_hint")}
        />
      </div>
    </section>
  );
}

function PulseSparkline({ points }: { points: number[] }) {
  // No data → flat baseline rather than blanking. Keeps the visual rhythm.
  const safe = points.length > 0 ? points : [0, 0, 0, 0, 0, 0, 0];
  const w = 120;
  const h = 56;
  const max = Math.max(...safe);
  const min = Math.min(...safe);
  const range = Math.max(1, max - min);
  const step = w / Math.max(1, safe.length - 1);
  const path = safe
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${h - ((p - min) / range) * h}`)
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="ml-auto h-14 w-32 shrink-0"
      aria-hidden
    >
      <defs>
        <linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(16 185 129 / 0.35)" />
          <stop offset="100%" stopColor="rgb(16 185 129 / 0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#pulseFill)" />
      <path
        d={path}
        fill="none"
        stroke="rgb(16 185 129)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniStat({
  tone,
  icon: Icon,
  label,
  value,
  hint,
}: {
  tone: "brand" | "amber" | "emerald";
  icon: typeof Flame;
  label: string;
  value: string;
  hint: string;
}) {
  const tones = {
    brand: "from-brand-50 to-brand-100/40 text-brand-700",
    amber: "from-amber-50 to-amber-100/40 text-amber-700",
    emerald: "from-emerald-50 to-emerald-100/40 text-emerald-700",
  } as const;
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${tones[tone]} p-4 shadow-sm sm:p-5`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">
          {label}
        </p>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function TopIssues({ issues, t }: { issues: TopIssue[]; t: T }) {
  // Cycle through a fixed tone palette so cards stay visually consistent
  // whether the query returns 1, 2, or 3 results.
  const tones = [
    "from-brand-500 to-cyan-500",
    "from-emerald-500 to-emerald-600",
    "from-violet-500 to-rose-500",
  ];

  return (
    <section className="mt-10">
      <SectionHeader title={t("section_top_issues")} subtitle={t("section_top_issues_subtitle")} />

      {issues.length === 0 ? (
        <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <Flame className="h-5 w-5 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">
            {t("top_issues_empty_title")}
          </p>
          <p className="max-w-md text-[11px] leading-relaxed text-slate-500">
            {t("top_issues_empty_body")}
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {issues.map((i, idx) => (
            <article
              key={i.id}
              className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tones[idx % tones.length]} text-white shadow-sm`}
              >
                <Flame className="h-5 w-5" />
              </div>

              <h3 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                {i.title}
              </h3>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {i.platform}
                {i.keywords.length > 0 && (
                  <span className="text-slate-300"> · </span>
                )}
                {i.keywords.slice(0, 2).join(" · ")}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                <Stat
                  label={t("card_volume_label")}
                  value={formatCompactNumber(i.volume)}
                />
                <Stat
                  label={t("card_reach_label")}
                  value={i.reach > 0 ? formatCompactNumber(i.reach) : "—"}
                />
              </div>

              <div className="mt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("card_sentiment_label")}
                </p>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full">
                  <span className="bg-emerald-500" style={{ width: `${i.sentiment[0]}%` }} />
                  <span className="bg-slate-300" style={{ width: `${i.sentiment[1]}%` }} />
                  <span className="bg-amber-500" style={{ width: `${i.sentiment[2]}%` }} />
                </div>
              </div>

              <Link
                href={{
                  pathname: "/briefs/new",
                  query: { topic: i.title },
                }}
                className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("card_generate_button")}
                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compact thousands formatting — 12,400 → "12.4K", 2,100,000 → "2.1M". */
function formatCompactNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}

function DailyInsights({
  insights,
  t,
}: {
  insights: DailyInsightsData;
  t: T;
}) {
  type Card = {
    key: string;
    tone: "rose" | "brand" | "amber" | "emerald";
    icon: typeof TrendingUp;
    title: string;
    body: string;
  };
  const cards: Card[] = [];

  if (insights.sentiment) {
    const { thisWeekPos, deltaPp } = insights.sentiment;
    cards.push({
      key: "sentiment",
      tone: "rose",
      icon: TrendingUp,
      title: t("insight_sentiment_title"),
      body: t("insight_sentiment_body_tpl", {
        positive: thisWeekPos,
        deltaSign: deltaPp > 0 ? "+" : deltaPp < 0 ? "−" : "",
        deltaAbs: Math.abs(deltaPp),
      }),
    });
  }

  if (insights.emerging) {
    cards.push({
      key: "emerging",
      tone: "brand",
      icon: Compass,
      title: t("insight_emerging_title"),
      body: t("insight_emerging_body_tpl", {
        label: insights.emerging.label,
        volume: insights.emerging.volume,
      }),
    });
  }

  if (insights.topPlatform) {
    cards.push({
      key: "platform",
      tone: "amber",
      icon: Users,
      title: t("insight_platform_title"),
      body: t("insight_platform_body_tpl", {
        platform: insights.topPlatform.platform,
        share: insights.topPlatform.share,
      }),
    });
  }

  if (insights.daleelOpportunity) {
    cards.push({
      key: "daleel",
      tone: "emerald",
      icon: BookOpenCheck,
      title: t("insight_daleel_title"),
      body: t("insight_daleel_body_tpl", {
        category: insights.daleelOpportunity.category,
        count: insights.daleelOpportunity.nPosts,
      }),
    });
  }

  const toneClasses = {
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    brand: "bg-brand-50 text-brand-700 ring-brand-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  } as const;

  // Hide the section entirely when no insight has enough data — better than
  // 4 blank or mocked cards.
  if (cards.length === 0) return null;

  return (
    <section className="mt-12">
      <SectionHeader title={t("section_insights")} subtitle={t("section_insights_subtitle")} />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ key, tone, icon: Icon, title, body }) => (
          <div
            key={key}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${toneClasses[tone]}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <p className="mt-3 text-balance text-sm font-semibold text-slate-900">
              {title}
            </p>
            <p className="mt-1.5 text-pretty text-xs leading-relaxed text-slate-600">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentBriefs({
  briefs,
  t,
  tBriefs,
  locale,
}: {
  briefs: Array<{
    id: string;
    topicTitle: string;
    segment: string;
    tone: string;
    isPlaceholder: boolean;
    createdAt: Date;
  }>;
  t: T;
  tBriefs: TBriefs;
  locale: string;
}) {
  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-3">
        <SectionHeader
          title={t("section_recent_briefs")}
          subtitle={t("section_recent_briefs_subtitle")}
        />
        <Link
          href="/briefs"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
        >
          {t("recent_view_all")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {briefs.length === 0 ? (
        <Link
          href="/briefs/new"
          className="mt-5 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm transition hover:border-slate-300"
        >
          <Sparkles className="h-5 w-5 text-brand-600" />
          <p className="text-sm font-medium text-slate-700">{t("no_briefs_yet")}</p>
          <p className="text-[11px] text-slate-500">{tBriefs("list_create")}</p>
        </Link>
      ) : (
        <div className="mt-5 grid gap-2">
          {briefs.map((b) => (
            <Link
              key={b.id}
              href={`/briefs/${b.id}`}
              className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <ScrollText className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {b.topicTitle}
                  </p>
                  {b.isPlaceholder && process.env.NODE_ENV !== "production" && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                      placeholder
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {tBriefs(`segment_${b.segment}` as Parameters<typeof tBriefs>[0])}
                  <span className="text-slate-300"> · </span>
                  <span className="tabular-nums">
                    {new Date(b.createdAt).toLocaleDateString(
                      locale === "id" ? "id-ID" : "en-US",
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                  </span>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function QuickLinks({ t }: { t: T }) {
  const links = [
    { href: "/insights", label: t("quick_trends"), icon: Globe2 },
    { href: "/kitab", label: t("quick_kitab"), icon: BookOpenCheck },
    { href: "/briefs", label: t("quick_briefs"), icon: ScrollText },
  ] as const;

  return (
    <section className="mt-12 mb-6">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {t("section_quick")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Icon className="h-3.5 w-3.5 text-brand-600" />
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-balance text-lg font-semibold text-slate-900 sm:text-xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-500 sm:text-sm">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function PendingDashboard({ name, t }: { name: string; t: T }) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-16 text-center sm:py-24">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100">
        <Clock className="h-6 w-6" />
      </span>
      <h1 className="mt-5 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {t("greeting", { name })}
      </h1>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
        {t("pending_body")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/insights"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
        >
          <Globe2 className="h-4 w-4" />
          {t("pending_button_insights")}
        </Link>
        <Link
          href="/kitab"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300"
        >
          <BookOpenCheck className="h-4 w-4" />
          {t("pending_button_kitab")}
        </Link>
      </div>
    </section>
  );
}
