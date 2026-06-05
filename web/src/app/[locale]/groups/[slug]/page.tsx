import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

// Revalidate every 5 minutes. The group landing queries social_posts
// scoped to topics in this THEME_GROUP — the underlying counts roll
// forward on the recluster cadence (mainstream+YT daily 04:00 WIB).
// No auth() in the path so per-user caching keys don't apply.
export const revalidate = 300;

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ArrowLeft, ArrowRight, Compass, Layers } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  classifyThemeGroup,
  GROUP_BY_SLUG,
  LAINNYA_GROUP,
} from "@/lib/dashboard-metrics";
import { briefingSlug, getLatestBriefing } from "@/lib/briefing-data";
import { I18nText } from "@/components/I18nText";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const group = GROUP_BY_SLUG[slug];
  if (!group) return { title: "Group not found" };
  const t = await getTranslations({ locale, namespace: "Insights" });
  return { title: t("group_page_title", { group }) };
}

export default async function GroupLandingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const group = GROUP_BY_SLUG[slug];
  if (!group) notFound();

  const t = await getTranslations("Insights");

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
        idClause,
        sql`posted_at >= now() - interval '14 days'`,
      ),
    )
    .orderBy(desc(schema.socialPosts.postedAt))
    .limit(25);

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

  return (
    <section className="pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Link
          href="/briefings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("brief_back_to_insights")}
        </Link>

        <header className="mt-4 border-b border-slate-200 pb-6">
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
              {sortedTopics.map((topic) => (
                <li key={topic.id}>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent posts in this group. */}
        <section className="mt-10">
          <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
            {t("group_posts_title")}
          </h2>
          {recentPosts.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
              {t("group_posts_empty")}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {recentPosts.map((p) => {
                const first =
                  (p.text || "")
                    .split("\n")
                    .map((s) => s.trim())
                    .find((s) => s.length > 0) ?? "";
                return (
                  <li key={p.id}>
                    <a
                      href={p.url ?? "#"}
                      target={p.url ? "_blank" : undefined}
                      rel={p.url ? "noopener noreferrer" : undefined}
                      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md"
                    >
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                        {p.platform.slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm leading-relaxed text-slate-800">
                          {first.slice(0, 220)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          {p.author && <span>{p.author}</span>}
                          {p.postedAt && (
                            <span>
                              {p.postedAt.toLocaleDateString(locale, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                timeZone: "Asia/Jakarta",
                              })}
                            </span>
                          )}
                          {p.sentimentLabel && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-600">
                              {p.sentimentLabel}
                            </span>
                          )}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
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

// Pre-generate every group landing page at build time so the first
// hit is hot. With 14 slugs × 2 locales = 28 pages, this is well
// inside the prerender budget.
export async function generateStaticParams() {
  return Object.keys(GROUP_BY_SLUG).flatMap((slug) =>
    ["id", "en"].map((locale) => ({ locale, slug })),
  );
}
