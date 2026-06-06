import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";

import { schema } from "@/db";
import { LAINNYA_GROUP } from "@/lib/dashboard-metrics";

/**
 * Builds the `social_posts` WHERE clause that defines "posts in this
 * group". Shared between the page server component (initial render)
 * and the load-more server action so they stay in sync.
 *
 * Hybrid match — same as the briefing pipeline:
 *   - Primary: `theme_group = $group` (Gemini-judged at ingest)
 *   - Fallback: `theme_group IS NULL AND topic_id ∈ groupTopicIds`
 *               (legacy chain for pre-2026-06-03 rows)
 * For the Lainnya group ALSO catches truly un-classified rows
 * (both theme_group and topic_id NULL).
 *
 * If `topicFilter` is set AND in the group's topic set, scope
 * collapses to that single topic — overrides the hybrid match.
 */
export function buildGroupScopeClause({
  group,
  groupTopicIds,
  topicFilter,
}: {
  group: string;
  groupTopicIds: string[];
  topicFilter: string | null;
}): SQL {
  if (topicFilter && groupTopicIds.includes(topicFilter)) {
    return eq(schema.socialPosts.topicId, topicFilter);
  }
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
  return branches.length > 1 ? or(...branches)! : branches[0];
}
