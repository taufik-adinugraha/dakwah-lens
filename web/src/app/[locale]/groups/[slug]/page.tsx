import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

// Revalidate every 5 minutes. The group landing queries social_posts
// scoped to topics in this THEME_GROUP — the underlying counts roll
// forward on the recluster cadence (mainstream+YT daily 04:00 WIB).
// No auth() in the path so per-user caching keys don't apply.
export const revalidate = 300;

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ArrowRight, Compass, Layers, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  classifyThemeGroup,
  GROUP_BY_SLUG,
  LAINNYA_GROUP,
} from "@/lib/dashboard-metrics";
import { briefingSlug, getLatestBriefing } from "@/lib/briefing-data";
import { I18nText } from "@/components/I18nText";
import { GroupPostsFilter, type GroupPost } from "./GroupPostsFilter";

/**
 * Lightweight landing for one of the 14 THEME_GROUPS.
 *
 * Surfaces what's discussable about a group when the auto-pipeline
 * hasn't generated a full Gemini Pro briefing for it this week
 * (only the top-5 groups by 7d post volume get auto-briefings).
 * Reader sees:
 *   - the group's topics (Gemini-discovered, classified into this
 *     group via the THEME_GROUPS regex)
 *   - up to 25 recent posts pulled from those topics
 *   - a link to the full briefing if one DOES happen to exist
 *
 * No LLM call here — pure SQL over existing tables. Cheap.
 */

type PageParams = { locale: string; slug: string };
type PageSearchParams = { topic?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const group = GROUP_BY_SLUG[slug];
  if (!group) return { title: "Group not found" };
  const t = await getTranslations({ locale, namespace: "Briefing" });
  return { title: t("group_page_title", { group }) };
}

export default async function GroupLandingPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale, slug } = await params;
  const { topic: topicFilterRaw } = await searchParams;
  setRequestLocale(locale);

  const group = GROUP_BY_SLUG[slug];
  if (!group) notFound();

  const t = await getTranslations("Briefing");

  // 1. Resolve which topics belong to this group. The regex lives in
  //    application code (dashboard-metrics.ts THEME_GROUPS), not SQL,
  //    so we SELECT every topic and bucket in JS. At ~50-200 topics
  //    site-wide this is well under any meaningful budget.
  const allTopics = await db
    .select({
      id: schema.topics.id,
      label: schema.topics.label,
      keywords: schema.topics.keywords,
      postCount: schema.topics.postCount,
    })
    .from(schema.topics);
  const groupTopics = allTopics.filter(
    (t) => classifyThemeGroup(t.label) === group,
  );
  const groupTopicIds = groupTopics.map((t) => t.id);

  // 2. Recent posts in this group (last 14d, capped at 25). Hybrid
  //    predicate matching the briefing pipeline:
  //      - Primary: `theme_group = $group` (Gemini-judged at ingest)
  //      - Fallback: `theme_group IS NULL AND topic_id ∈ groupTopics`
  //                  (legacy chain for pre-2026-06-03 rows)
  //    For the Lainnya group ALSO catches truly un-classified rows
  //    (both theme_group and topic_id NULL) — those land on the
  //    Lainnya page so the reader can browse them too.
  const isLainnya = group === LAINNYA_GROUP;
  const themeMatch = eq(schema.socialPosts.themeGroup, group);
  const legacyTopicMatch =
    groupTopicIds.length > 0
      ? and(
          isNull(schema.socialPosts.themeGroup),
          inArray(schema.socialPosts.topicId, groupTopicIds),
        )!
      : null;
  const lainnyaNullMatch = isLainnya
    ? and(
        isNull(schema.socialPosts.themeGroup),
        isNull(schema.socialPosts.topicId),
      )!
    : null;
  const branches = [themeMatch, legacyTopicMatch, lainnyaNullMatch].filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );
  const idClause = branches.length > 1 ? or(...branches)! : branches[0];

  // Optional topic-filter (from ?topic=<uuid>). When the param matches
  // one of this group's topic IDs, every query below scopes to that
  // single topic — posts list, sentiment aggregate, the active-topic
  // banner. Anything else (missing, malformed, out-of-group) falls
  // back to the full group-scope query.
  const topicFilter =
    topicFilterRaw && groupTopicIds.includes(topicFilterRaw)
      ? topicFilterRaw
      : null;
  const activeTopic = topicFilter
    ? (groupTopics.find((t) => t.id === topicFilter) ?? null)
    : null;
  const scopedClause = topicFilter
    ? eq(schema.socialPosts.topicId, topicFilter)
    : idClause;

  const recentPosts = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      platform: schema.socialPosts.platform,
      postedAt: schema.socialPosts.postedAt,
      sentimentLabel: schema.socialPosts.sentimentLabel,
    })
    .from(schema.socialPosts)
    .where(
      and(
        scopedClause,
        sql`posted_at >= now() - interval '14 days'`,
      ),
    )
    .orderBy(desc(schema.socialPosts.postedAt))
    .limit(25);

  // Sentiment aggregate over the same 14d window + same scope. Groups
  // NULL/unknown labels into the "other" bucket so the bar totals
  // match the count shown in the subtitle.
  const sentimentRows = await db
    .select({
      label: schema.socialPosts.sentimentLabel,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(schema.socialPosts)
    .where(
      and(
        scopedClause,
        sql`posted_at >= now() - interval '14 days'`,
      ),
    )
    .groupBy(schema.socialPosts.sentimentLabel);
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  for (const r of sentimentRows) {
    const k = r.label;
    if (k === "positive" || k === "neutral" || k === "negative") {
      sentimentCounts[k] = Number(r.n);
    }
  }
  const sentimentTotal =
    sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.negative;

  // 3. Recompute per-topic 7-day counts (the topics.post_count column
  //    is cross-platform lifetime). Cheaper than per-topic queries:
  //    one aggregate over the same id-set.
  //
  //    NB on the SQL: Drizzle interpolates a JS array as a comma-
  //    separated parameter sequence — `($1, $2, $3)` — which is a
  //    TUPLE, not an array. `ANY ((..)::uuid[])` then fails because
  //    you can't cast a tuple to uuid[]. We instead use drizzle's
  //    `inArray` predicate inside a normal `db.select` query, which
  //    emits `topic_id IN ($1, $2, ...)` correctly.
  type CountRow = { topicId: string; posts: number };
  let topicCounts: CountRow[] = [];
  if (groupTopicIds.length > 0) {
    const rows = await db
      .select({
        topicId: schema.socialPosts.topicId,
        posts: sql<number>`COUNT(*)::int`,
      })
      .from(schema.socialPosts)
      .where(
        and(
          inArray(schema.socialPosts.topicId, groupTopicIds),
          sql`posted_at >= now() - interval '7 days'`,
        ),
      )
      .groupBy(schema.socialPosts.topicId);
    topicCounts = rows.map((r) => ({
      topicId: String(r.topicId),
      posts: Number(r.posts),
    }));
  }
  const countByTopicId = new Map(
    (Array.isArray(topicCounts) ? topicCounts : []).map((r) => [
      r.topicId,
      Number(r.posts),
    ]),
  );

  // 4. Optional: if this group DID get a briefing this week, surface a
  //    CTA banner so the reader doesn't miss it.
  const latestBriefing = await getLatestBriefing(group);
  const briefingHref = latestBriefing
    ? `/briefings/${briefingSlug(latestBriefing.generatedAt, latestBriefing.themeGroup)}`
    : null;

  const sortedTopics = [...groupTopics]
    .map((topic) => ({
      ...topic,
      postCount7d: countByTopicId.get(topic.id) ?? 0,
    }))
    .sort((a, b) => b.postCount7d - a.postCount7d);

  // Pre-format dates server-side so the client component doesn't
  // need to import next-intl + a Locale to render them.
  const dtf = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const postsForClient: GroupPost[] = recentPosts.map((p) => ({
    id: p.id,
    text: p.text,
    author: p.author,
    url: p.url,
    platform: p.platform,
    postedAt: p.postedAt ? dtf.format(p.postedAt) : null,
    sentimentLabel: p.sentimentLabel,
  }));

  return (
    <section className="pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="border-b border-slate-200 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
              <Compass className="h-3 w-3" />
              {t("group_eyebrow")}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
              {group}
            </span>
          </div>
          <h1 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {group}
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600">
            <I18nText
              text={t("group_page_intro", {
                group,
                topics: groupTopics.length,
              })}
            />
          </p>
        </header>

        {briefingHref && (
          <Link
            href={briefingHref}
            className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-md"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                {t("group_briefing_available_title")}
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                {t("group_briefing_available_body")}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-center rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
              {t("hub_card_cta")}
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        )}

        {/* Topics in this group. */}
        <section className="mt-8">
          <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
            {t("group_topics_title")}
          </h2>
          {sortedTopics.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
              {t("group_topics_empty")}
            </p>
          ) : (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {sortedTopics.map((topic) => {
                const isActive = topicFilter === topic.id;
                return (
                  <li key={topic.id}>
                    <Link
                      href={`/groups/${slug}?topic=${topic.id}`}
                      className={`block rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        isActive
                          ? "border-emerald-500 ring-2 ring-emerald-100"
                          : "border-slate-200 hover:border-slate-900"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {topic.label}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t("group_topic_count", {
                          count: topic.postCount7d,
                        })}
                      </p>
                      {topic.keywords && topic.keywords.length > 0 && (
                        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                          {topic.keywords.slice(0, 5).join(" · ")}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Sentiment composition (14d window, scoped to active topic
            if one is selected). Stacked horizontal bar + count
            legend. Hidden when the group has zero labelled posts. */}
        <section className="mt-10">
          <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
            {t("group_sentiment_title")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {activeTopic
              ? t("group_sentiment_subtitle_topic_tpl", {
                  count: sentimentTotal,
                  topic: activeTopic.label,
                })
              : t("group_sentiment_subtitle_tpl", { count: sentimentTotal })}
          </p>
          {sentimentTotal === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
              {t("group_sentiment_empty")}
            </p>
          ) : (
            <>
              <div
                className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={t("group_sentiment_title")}
              >
                {sentimentCounts.positive > 0 && (
                  <div
                    className="bg-emerald-500"
                    style={{
                      width: `${(sentimentCounts.positive / sentimentTotal) * 100}%`,
                    }}
                  />
                )}
                {sentimentCounts.neutral > 0 && (
                  <div
                    className="bg-slate-400"
                    style={{
                      width: `${(sentimentCounts.neutral / sentimentTotal) * 100}%`,
                    }}
                  />
                )}
                {sentimentCounts.negative > 0 && (
                  <div
                    className="bg-amber-500"
                    style={{
                      width: `${(sentimentCounts.negative / sentimentTotal) * 100}%`,
                    }}
                  />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <SentimentLegend
                  swatch="bg-emerald-500"
                  label={t("coverage_sentiment_positive")}
                  count={sentimentCounts.positive}
                  total={sentimentTotal}
                />
                <SentimentLegend
                  swatch="bg-slate-400"
                  label={t("coverage_sentiment_neutral")}
                  count={sentimentCounts.neutral}
                  total={sentimentTotal}
                />
                <SentimentLegend
                  swatch="bg-amber-500"
                  label={t("coverage_sentiment_negative")}
                  count={sentimentCounts.negative}
                  total={sentimentTotal}
                />
              </div>
            </>
          )}
        </section>

        {/* Recent posts in this group — filterable by sentiment.
            When a topic filter is active, shows a banner with a
            clear-filter button. */}
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {t("group_posts_title")}
            </h2>
            {activeTopic && (
              <Link
                href={`/groups/${slug}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-900"
              >
                <X className="h-3.5 w-3.5" />
                {t("group_topic_filter_clear")}
              </Link>
            )}
          </div>
          {activeTopic && (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
              {t("group_topic_filter_active_tpl", { topic: activeTopic.label })}
            </p>
          )}
          <GroupPostsFilter
            posts={postsForClient}
            emptyMessage={t("group_posts_empty")}
            filterLabels={{
              all: t("filter_all"),
              positive: t("filter_positive"),
              neutral: t("filter_neutral"),
              negative: t("filter_negative"),
            }}
          />
        </section>

        {/* Encourage on-demand briefing via the topic-pick brief flow. */}
        <section className="mt-12">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/70 to-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">
              {t("group_brief_cta_title")}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {t("group_brief_cta_body")}
            </p>
            <Link
              href="/briefs/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              {t("group_brief_cta_button")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}

function SentimentLegend({
  swatch,
  label,
  count,
  total,
}: {
  swatch: string;
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatch}`} />
      <span className="font-medium">{label}</span>
      <span className="tabular-nums text-slate-500">
        {count.toLocaleString()} · {pct}%
      </span>
    </span>
  );
}

// Pre-generate every group landing page at build time so the first
// hit is hot. With 14 slugs × 2 locales = 28 pages, this is well
// inside the prerender budget.
export async function generateStaticParams() {
  return Object.keys(GROUP_BY_SLUG).flatMap((slug) =>
    ["id", "en"].map((locale) => ({ locale, slug })),
  );
}
