import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  BookOpenCheck,
  Bookmark,
  Clock,
  Compass,
  Flame,
  Globe2,
  MessageSquare,
  ScrollText,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import { CoverageBreakdown } from "@/components/CoverageBreakdown";
import { I18nText } from "@/components/I18nText";
import { TopIssueCards } from "@/components/TopIssueCards";
import {
  getActiveDiscussionRooms,
  getBriefsThisWeek,
  getDailyInsights,
  getKitSegments,
  getPlatformDistribution7d,
  getPulseSnapshot,
  getRecentSaved,
  getRisingVideos,
  getSentimentDistribution7d,
  getSentimentTrend7d,
  getTopIssues,
  getTopicDistribution7d,
  getTrendingCount24h,
  type ActiveRoom,
  type DailyInsights as DailyInsightsData,
  type PlatformBucket,
  type PulseSnapshot,
  type RisingVideo,
  type SavedItem,
  type SentimentBreakdown,
  type SentimentTrendPoint,
  type TopIssue,
  type TopicBucket,
} from "@/lib/dashboard-metrics";
import { formatPanggilan } from "@/lib/panggilan";
import { hashVisitorToken, readVisitorToken } from "@/lib/visitor-cookie";
import { DashboardTabs } from "./DashboardTabs";
import { KitTabs } from "./KitTabs";

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
  // Pulled from the Insights namespace so the segment names in the
  // Kit tab strip match /insights/segment/[focus] verbatim.
  const tInsights = await getTranslations("Insights");

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

  // Brief generation is admin-only while the feature is experimental
  // (2026-05-23). Non-admin approved users see the dashboard WITHOUT
  // the brief-related sections — their own brief list is empty anyway
  // since they can't create one.
  const canCreateBriefs =
    session.user.role === "admin" || session.user.role === "superadmin";

  // Fetch everything in parallel — these are all independent queries.
  // Briefs queries are skipped entirely for non-admin so we don't burn
  // round-trips fetching a list they won't see.
  // Identify the visitor for the "active discussion rooms" card.
  // Comments are anonymous-by-design (visitor_token_hash, not userId),
  // so we read the same cookie the comment API stamps on first post.
  // Returning null when the cookie is missing → the section silently
  // hides for users who haven't commented anywhere yet.
  const visitorToken = await readVisitorToken();
  const visitorHash = visitorToken ? hashVisitorToken(visitorToken) : null;

  const [
    recentBriefs,
    pulse,
    trendingCount,
    briefsThisWeek,
    topIssues,
    insights,
    risingVideos,
    kitSegments,
    savedItems,
    sentimentTrend,
    activeRooms,
    platformDist,
    sentimentDist,
    topicDist,
  ] = await Promise.all([
    canCreateBriefs
      ? db
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
          .limit(5)
      : Promise.resolve([]),
    getPulseSnapshot(),
    getTrendingCount24h(),
    canCreateBriefs
      ? getBriefsThisWeek(session.user.id)
      : Promise.resolve(0),
    getTopIssues(3),
    getDailyInsights(),
    getRisingVideos(5),
    getKitSegments(),
    getRecentSaved(session.user.id),
    getSentimentTrend7d(),
    getActiveDiscussionRooms(visitorHash, 14, 6),
    getPlatformDistribution7d(),
    getSentimentDistribution7d(),
    getTopicDistribution7d(10),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <DashboardHeader name={greetingName} t={t} />
      <DashboardTabs
        labels={{
          kit: t("tab_kit_title"),
          kit_subtitle: t("tab_kit_subtitle"),
          data: t("tab_data_title"),
          data_subtitle: t("tab_data_subtitle"),
        }}
        kit={
          <div className="space-y-8">
            <KitTabs
              segments={kitSegments}
              locale={locale}
              labels={{
                // Canonical labels — same keys /insights/segment/[focus]
                // uses for its hero ("Spiritual & Akhlaq", etc.). Keeps
                // segment names consistent across surfaces.
                segments: {
                  all: tInsights("brief_scope_all"),
                  spiritual: tInsights("segment_spiritual_title"),
                  family: tInsights("segment_family_title"),
                  youth: tInsights("segment_youth_title"),
                  justice: tInsights("segment_justice_title"),
                },
                sections: {
                  ringkasan: t("kit_section_ringkasan"),
                  numerik: t("kit_section_numerik"),
                  tema: t("kit_section_tema"),
                  strategi: t("kit_section_strategi"),
                  dalil: t("kit_section_dalil"),
                },
                empty: t("kit_tabs_empty"),
                // Reuses the exact same i18n keys the briefings page uses
                // so the kit cards / poster / flyer carry identical
                // copy on both surfaces.
                deliverable: {
                  open: tInsights("brief_deliverable_open"),
                  copy: tInsights("brief_deliverable_copy"),
                  copied: tInsights("brief_deliverable_copied"),
                  download: tInsights("brief_deliverable_download"),
                  print: tInsights("brief_deliverable_print"),
                  flyer: tInsights("brief_deliverable_flyer"),
                  visit: tInsights("brief_deliverable_visit"),
                  close: tInsights("brief_deliverable_close"),
                },
                poster: {
                  eyebrow: tInsights("brief_poster_section_eyebrow"),
                  title: tInsights("brief_poster_section_title"),
                  body: tInsights("brief_poster_section_body"),
                  openLarge: tInsights("brief_poster_open_large"),
                  download: tInsights("brief_poster_download"),
                  downloadPdf: tInsights("brief_poster_download_pdf"),
                  print: tInsights("brief_poster_print"),
                  loading: tInsights("brief_poster_loading"),
                  close: tInsights("brief_poster_close"),
                },
              }}
            />
            <ActiveRoomsCard rooms={activeRooms} t={t} />
            <SavedItemsCard items={savedItems} t={t} />
            {canCreateBriefs && (
              <RecentBriefs
                briefs={recentBriefs}
                t={t}
                tBriefs={tBriefs}
                locale={locale}
              />
            )}
            {canCreateBriefs && (
              <BriefsStatTile briefsThisWeek={briefsThisWeek} t={t} />
            )}
          </div>
        }
        data={
          <div className="space-y-8">
            <DataPulseHero
              pulse={pulse}
              trendingCount={trendingCount}
              t={t}
            />
            <SentimentTrendChart points={sentimentTrend} t={t} />
            <CoverageBreakdown
              platforms={platformDist}
              sentiment={sentimentDist}
              topics={topicDist}
              labels={{
                sectionTitle: t("section_coverage_title"),
                sectionSubtitle: t("section_coverage_subtitle"),
                platformsTitle: t("coverage_platforms_title"),
                postsSuffix: t("coverage_posts_7d"),
                platformMainstream: t("coverage_platform_mainstream"),
                sentimentTitle: t("coverage_sentiment_title"),
                classifiedSuffix: t("coverage_classified_7d"),
                sentimentPositive: t("sentiment_positive"),
                sentimentNeutral: t("sentiment_neutral"),
                sentimentNegative: t("sentiment_negative"),
                unlabelledTpl: t("coverage_unlabelled", { n: "{n}" }),
                topicsTitle: t("coverage_topics_title"),
                topicsCountSuffix: t("coverage_topics_count_suffix"),
              }}
            />
            <TopIssues
              issues={topIssues}
              t={t}
              canCreateBriefs={canCreateBriefs}
            />
            <DailyInsights insights={insights} t={t} />
            <RisingVideosCard videos={risingVideos} t={t} />
          </div>
        }
      />
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Dashboard">>>;
type TBriefs = Awaited<ReturnType<typeof getTranslations<"Briefs">>>;

function DashboardHeader({ name, t }: { name: string; t: T }) {
  // Slim greeting strip above the tabs — keeps the personal hello
  // intact but drops the heavy stat tiles that used to live here.
  // Stats now belong inside their respective tabs where they make
  // editorial sense (pulse → Data, briefs-this-week → Kit).
  //
  // The explainer uses next-intl's `t.rich` so the <strong> tags in
  // the message file render as real DOM bold instead of literal text.
  // I18nText only strips `*…*` markers, not HTML.
  return (
    <header className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-5 shadow-sm sm:p-6">
      <p className="text-pretty text-xs font-medium uppercase tracking-wider text-slate-500">
        {t("subtitle")}
      </p>
      <h1 className="mt-1.5 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {t("greeting", { name })}
      </h1>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">
        {t.rich("dashboard_header_explainer", {
          strong: (chunks) => (
            <strong className="font-semibold text-slate-900">{chunks}</strong>
          ),
        })}
      </p>
    </header>
  );
}

// ── KIT TAB ──────────────────────────────────────────────────────


function SavedItemsCard({ items, t }: { items: SavedItem[]; t: T }) {
  if (items.length === 0) {
    return (
      <section>
        <SectionHeader
          title={t("section_saved_title")}
          subtitle={t("section_saved_subtitle")}
        />
        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-6 text-center text-sm text-slate-500">
          {t("saved_empty")}
        </div>
      </section>
    );
  }

  const kindIcon = {
    kitab: BookOpenCheck,
    brief: ScrollText,
    post: Sparkles,
  };

  return (
    <section>
      <SectionHeader
        title={t("section_saved_title")}
        subtitle={t("section_saved_subtitle")}
        action={
          <Link
            href="/saved"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
          >
            {t("saved_view_all")} <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {items.map((item) => {
          const Icon = kindIcon[item.kind] ?? Bookmark;
          const title =
            (item.payload?.title as string) ||
            (item.payload?.citation as string) ||
            item.refId;
          const subtitle =
            (item.payload?.corpus as string) ||
            (item.payload?.segment as string) ||
            t(`saved_kind_${item.kind}` as Parameters<T>[0]);
          const href =
            item.kind === "brief"
              ? `/insights/brief/${item.refId}`
              : item.kind === "kitab"
                ? `/kitab/${item.refId}`
                : "/saved";
          return (
            <li key={item.id} className="p-3 sm:p-4">
              <Link
                href={href}
                className="flex items-start gap-3 text-left hover:text-emerald-700"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {title}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {subtitle}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BriefsStatTile({
  briefsThisWeek,
  t,
}: {
  briefsThisWeek: number;
  t: T;
}) {
  return (
    <MiniStat
      tone="amber"
      icon={ScrollText}
      label={t("stat_briefs_this_week_label")}
      value={briefsThisWeek.toString()}
      hint={t("stat_briefs_this_week_hint")}
      href={briefsThisWeek > 0 ? "/briefs" : "/briefs/new"}
    />
  );
}

function ActiveRoomsCard({
  rooms,
  t,
}: {
  rooms: ActiveRoom[];
  t: T;
}) {
  // Hide the entire section when the visitor hasn't commented in any
  // room in the window. Empty-state copy would just create noise on
  // the dashboard for users who don't participate in discussions.
  if (rooms.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={t("section_active_rooms_title")}
        subtitle={t("section_active_rooms_subtitle")}
      />
      <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {rooms.map((room) => {
          const d = room.daysSinceLast;
          const lastLabel =
            d === 0
              ? t("active_rooms_today")
              : t("active_rooms_days_ago", { n: d });
          return (
            <li key={room.briefingSlug} className="p-3 sm:p-4">
              <Link
                href={`/m/${room.briefingSlug}`}
                className="group flex items-start gap-3 text-left hover:text-emerald-700"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                    {room.title ?? room.briefingSlug}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {t("active_rooms_my_comments", { n: room.myCommentCount })}
                    {" · "}
                    {t("active_rooms_total_comments", {
                      n: room.totalApprovedCount,
                    })}
                    {" · "}
                    {lastLabel}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── DATA TAB ─────────────────────────────────────────────────────

function DataPulseHero({
  pulse,
  trendingCount,
  t,
}: {
  pulse: PulseSnapshot;
  trendingCount: number;
  t: T;
}) {
  const hasScore = pulse.score !== null;
  const deltaSign =
    pulse.delta === null
      ? "flat"
      : pulse.delta > 0
        ? "up"
        : pulse.delta < 0
          ? "down"
          : "flat";

  return (
    <section className="grid gap-3 sm:grid-cols-[1.4fr_1fr] sm:gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <TrendingUp className="h-3.5 w-3.5" />
          </span>
          <I18nText
            text={t("pulse_label")}
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          />
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div>
            <p className="flex items-baseline gap-2">
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
                  deltaSign === "flat"
                    ? {}
                    : { delta: Math.abs(pulse.delta).toFixed(1) },
                )}
              </p>
            ) : (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {t(hasScore ? "pulse_no_comparison" : "pulse_no_score")}
              </p>
            )}
          </div>
          <PulseSparkline points={pulse.sparkline} />
        </div>
        <I18nText
          text={t("pulse_explainer")}
          className="mt-4 block text-pretty text-xs leading-relaxed text-slate-500"
        />
      </div>
      <MiniStat
        tone="brand"
        icon={Flame}
        label={t("stat_trending_label")}
        value={trendingCount.toString()}
        hint={t("stat_trending_hint")}
        href="/insights/explore#trending"
      />
    </section>
  );
}

function SentimentTrendChart({
  points,
  t,
}: {
  points: SentimentTrendPoint[];
  t: T;
}) {
  // Need 3+ data points for the line to be meaningful
  if (points.length < 3) {
    return null;
  }
  const w = 600;
  const h = 110;
  const padX = 8;
  const padY = 16;
  const max = 100;
  const stepX = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;

  const buildPath = (key: "negPct" | "posPct") =>
    points
      .map((p, i) => {
        const x = padX + stepX * i;
        const y = padY + ((max - p[key]) / max) * (h - padY * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const negPath = buildPath("negPct");
  const posPath = buildPath("posPct");

  return (
    <section>
      <SectionHeader
        title={t("section_sentiment_trend_title")}
        subtitle={t("section_sentiment_trend_subtitle")}
      />
      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-2 flex items-center gap-4 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
            {t("sentiment_legend_negative")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            {t("sentiment_legend_positive")}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-28 w-full"
          aria-label={t("section_sentiment_trend_title")}
        >
          {/* baseline grid at 25/50/75 % */}
          {[25, 50, 75].map((pct) => {
            const y = padY + ((max - pct) / max) * (h - padY * 2);
            return (
              <line
                key={pct}
                x1={padX}
                x2={w - padX}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="2 4"
              />
            );
          })}
          <path d={posPath} fill="none" stroke="#10b981" strokeWidth="2" />
          <path d={negPath} fill="none" stroke="#f43f5e" strokeWidth="2" />
          {points.map((p, i) => {
            const x = padX + stepX * i;
            const yPos =
              padY + ((max - p.posPct) / max) * (h - padY * 2);
            const yNeg =
              padY + ((max - p.negPct) / max) * (h - padY * 2);
            return (
              <g key={p.day}>
                <circle cx={x} cy={yPos} r={2.5} fill="#10b981" />
                <circle cx={x} cy={yNeg} r={2.5} fill="#f43f5e" />
              </g>
            );
          })}
        </svg>
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
          <span>
            {new Date(points[0].day).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <span>
            {new Date(points[points.length - 1].day).toLocaleDateString(
              undefined,
              { month: "short", day: "numeric" },
            )}
          </span>
        </div>
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
  href,
}: {
  tone: "brand" | "amber" | "emerald";
  icon: typeof Flame;
  label: string;
  value: string;
  hint: string;
  /** When provided, the tile becomes a clickable Link routing into the
   *  detail surface (e.g. /insights for the trending count tile). */
  href?: string;
}) {
  const tones = {
    brand: "from-brand-50 to-brand-100/40 text-brand-700",
    amber: "from-amber-50 to-amber-100/40 text-amber-700",
    emerald: "from-emerald-50 to-emerald-100/40 text-emerald-700",
  } as const;
  const baseClass = `block rounded-2xl border border-slate-200 bg-gradient-to-br ${tones[tone]} p-4 shadow-sm sm:p-5`;
  const interactiveClass = href
    ? " transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    : "";

  const inner = (
    <>
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
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${baseClass}${interactiveClass}`}>
        {inner}
      </Link>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}


function TopIssues({
  issues,
  t,
  canCreateBriefs,
}: {
  issues: TopIssue[];
  t: T;
  canCreateBriefs: boolean;
}) {
  return (
    <section className="mt-10">
      <SectionHeader title={t("section_top_issues")} subtitle={t("section_top_issues_subtitle")} />

      {issues.length === 0 ? (
        <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <Flame className="h-5 w-5 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">
            {t("top_issues_empty_title")}
          </p>
          <I18nText
            text={t("top_issues_empty_body")}
            className="block max-w-md text-[11px] leading-relaxed text-slate-500"
          />
        </div>
      ) : (
        <TopIssueCards
          issues={issues}
          generateBriefLabel={t("card_generate_button")}
          volumeLabel={t("card_volume_label")}
          reachLabel={t("card_reach_label")}
          sentimentLabel={t("card_sentiment_label")}
          canCreateBriefs={canCreateBriefs}
        />
      )}
    </section>
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
    /** When set, the card becomes a Link to this destination. */
    href?: string;
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
      // Drill into the full sentiment view on /insights/explore.
      href: "/insights/explore#sentiment",
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
      // Open the trending topics list — the emerging topic is in there.
      href: "/insights/explore#trending",
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
      // Direct link to that platform's drilldown.
      href: `/insights/${insights.topPlatform.platform}`,
    });
  }

  if (insights.daleelOpportunity) {
    // Map the dominant category to the segment page that covers it.
    const SEGMENT_BY_CATEGORY: Record<string, string> = {
      aqidah: "spiritual",
      akhlaq: "spiritual",
      family: "family",
      health: "family",
      youth: "youth",
      education: "youth",
      social_justice: "justice",
      economic_ethics: "justice",
      muamalah: "justice",
    };
    const segment =
      SEGMENT_BY_CATEGORY[insights.daleelOpportunity.category] ?? null;
    cards.push({
      key: "daleel",
      tone: "emerald",
      icon: BookOpenCheck,
      title: t("insight_daleel_title"),
      body: t("insight_daleel_body_tpl", {
        category: insights.daleelOpportunity.category,
        count: insights.daleelOpportunity.nPosts,
      }),
      href: segment
        ? `/insights/segment/${segment}?from=dashboard`
        : "/insights",
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
      <SectionHeader
        title={t("section_insights")}
        subtitle={t("section_insights_subtitle", { count: cards.length })}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ key, tone, icon: Icon, title, body, href }) => {
          const inner = (
            <>
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
            </>
          );
          const baseClass =
            "flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
          if (href) {
            return (
              <Link
                key={key}
                href={href}
                className={`${baseClass} transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md`}
              >
                {inner}
              </Link>
            );
          }
          return (
            <div key={key} className={baseClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RisingVideosCard({
  videos,
  t,
}: {
  videos: RisingVideo[];
  t: T;
}) {
  // Hide entirely until the time-series table has 2+ days of data
  // (otherwise the section is just "no data yet" noise on every load).
  // The query already guards minBaseline; we just don't render a card
  // for an empty list at all.
  if (videos.length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <SectionHeader
        title={t("section_rising_videos")}
        subtitle={t("section_rising_videos_subtitle")}
      />
      <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {videos.map((v) => (
          <li key={v.postId} className="flex items-start gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xs font-bold text-rose-700 tabular-nums">
              +{Math.round(v.deltaPct)}%
            </div>
            <div className="min-w-0 flex-1">
              {v.url ? (
                <a
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-semibold text-slate-900 hover:text-rose-700"
                >
                  {v.title}
                </a>
              ) : (
                <p className="truncate text-sm font-semibold text-slate-900">
                  {v.title}
                </p>
              )}
              <p className="mt-0.5 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{v.channel}</span>
                {" · "}
                {formatCompactInt(v.viewsNow)} views ·{" "}
                <span className="text-emerald-700">
                  +{formatCompactInt(v.delta)}
                </span>{" "}
                vs 24h ago
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatCompactInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
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
                      {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        timeZone: "Asia/Jakarta",
                      },
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


function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-balance text-lg font-semibold text-slate-900 sm:text-xl">
          <I18nText text={title} />
        </h2>
        {subtitle && (
          <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-500 sm:text-sm">
            <I18nText text={subtitle} />
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
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
