"use server";

import { and, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { classifyThemeGroup, GROUP_BY_SLUG } from "@/lib/dashboard-metrics";

import type { GroupPost } from "./GroupPostsFilter";
import { buildGroupScopeClause } from "./scope";

type Sentiment = "all" | "positive" | "neutral" | "negative";

export type LoadGroupPostsInput = {
  groupSlug: string;
  topicId: string | null;
  sentiment: Sentiment;
  offset: number;
  limit: number;
  locale: string;
};

export type LoadGroupPostsResult = {
  posts: GroupPost[];
  hasMore: boolean;
};

/** Hard ceiling per request — keeps a misbehaving client from
 *  pulling arbitrary slices of the table. */
const MAX_LIMIT = 50;
/** Stop paginating past 14d × ~peak-daily-volume — anything beyond
 *  that is almost certainly accidental. */
const MAX_OFFSET = 5000;

const SENTIMENTS = new Set<Sentiment>([
  "all",
  "positive",
  "neutral",
  "negative",
]);

export async function loadGroupPosts(
  input: LoadGroupPostsInput,
): Promise<LoadGroupPostsResult> {
  const group = GROUP_BY_SLUG[input.groupSlug];
  if (!group) return { posts: [], hasMore: false };

  const sentiment: Sentiment = SENTIMENTS.has(input.sentiment)
    ? input.sentiment
    : "all";
  const limit = Math.min(Math.max(1, Math.floor(input.limit)), MAX_LIMIT);
  const offset = Math.min(Math.max(0, Math.floor(input.offset)), MAX_OFFSET);

  const allTopics = await db
    .select({ id: schema.topics.id, label: schema.topics.label })
    .from(schema.topics);
  const groupTopicIds = allTopics
    .filter((t) => classifyThemeGroup(t.label) === group)
    .map((t) => t.id);

  const scopedClause = buildGroupScopeClause({
    group,
    groupTopicIds,
    topicFilter: input.topicId,
  });

  const sentimentClause =
    sentiment === "all"
      ? undefined
      : eq(schema.socialPosts.sentimentLabel, sentiment);

  // Fetch limit+1 so the client knows whether more pages exist
  // without a separate COUNT query.
  const rows = await db
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
        sentimentClause,
        sql`posted_at >= now() - interval '14 days'`,
      ),
    )
    .orderBy(desc(schema.socialPosts.postedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const dtf = new Intl.DateTimeFormat(input.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const posts: GroupPost[] = page.map((p) => ({
    id: p.id,
    text: p.text,
    author: p.author,
    url: p.url,
    platform: p.platform,
    postedAt: p.postedAt ? dtf.format(p.postedAt) : null,
    sentimentLabel: p.sentimentLabel,
  }));

  return { posts, hasMore };
}
