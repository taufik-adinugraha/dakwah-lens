import type { LatestBriefing } from "@/lib/briefing-data";

/**
 * Pill row that lives beneath the AI-narrated executive briefing.
 *
 * Used on both:
 *   - /briefings — the overall-view hero
 *   - /briefings/segment/[focus] — the per-segment hero
 *
 * Shared between the two because the underlying `headline_stats`
 * JSONB shape is the same; only the source row differs (segment NULL
 * vs segment = focus). Keeps the visual consistent and avoids the
 * code-drift that comes from duplicating the JSX in two places.
 */
type HeadlineStats = LatestBriefing["headlineStats"];

type Locale = string;

type CategoryLabelFn = (categoryKey: string) => string;

type StringFn = (key: string) => string;

export function InsightsHeadlinePills({
  stats,
  locale,
  t,
  localizeCategory,
}: {
  stats: HeadlineStats;
  locale: Locale;
  /** Translator that resolves keys from the `Insights` namespace. */
  t: StringFn;
  /** Translator from a category key (`family`, `muamalah`, …) to the
   *  localized display name. Caller injects this because the `Kitab` /
   *  category namespace varies between consumer pages. */
  localizeCategory: CategoryLabelFn;
}) {
  const sentiment = stats.sentiment ?? {};
  const topCategory = stats.top_categories?.[0];
  const topTopic = stats.top_topics?.[0];
  const totals = stats.totals ?? {};

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Mood pill (sentiment % negative + delta vs baseline). */}
      {sentiment.current_pct_negative !== undefined && (
        <HeadlinePill
          label={t("exec_pill_concerned")}
          value={`${Math.round(sentiment.current_pct_negative)}%`}
          delta={
            sentiment.delta_pp_negative != null
              ? `${sentiment.delta_pp_negative >= 0 ? "+" : ""}${sentiment.delta_pp_negative.toFixed(1)}pp`
              : null
          }
          deltaIsBad={(sentiment.delta_pp_negative ?? 0) > 0}
          accent={
            (sentiment.current_pct_negative ?? 0) > 30 ? "amber" : "slate"
          }
        />
      )}

      {/* Top category pill. On segment pages this surfaces which of the
       *  segment's sub-categories dominates (family vs health, muamalah
       *  vs social_justice). On the overall-view page it's the dominant
       *  of all 9 dakwah categories. */}
      {topCategory && (
        <HeadlinePill
          label={t("exec_pill_top_category")}
          value={localizeCategory(topCategory.category)}
          hint={`${Math.round(topCategory.share_pct)}% share`}
          delta={
            topCategory.delta_pp != null
              ? `${topCategory.delta_pp >= 0 ? "+" : ""}${topCategory.delta_pp.toFixed(1)}pp`
              : null
          }
          deltaIsBad={false}
          accent="brand"
        />
      )}

      {/* Top topic pill — the topic with the highest post_count in this
       *  scope. Segment scope filters this via top_categories alignment. */}
      {topTopic && (
        <HeadlinePill
          label={t("exec_pill_top_topic")}
          value={topTopic.label}
          hint={`${topTopic.post_count.toLocaleString(locale)} posts · ${topTopic.platform}`}
          delta={null}
          deltaIsBad={false}
          accent="emerald"
        />
      )}

      {/* Volume pill. */}
      {totals.posts_7d !== undefined && (
        <HeadlinePill
          label={t("exec_pill_volume")}
          value={(totals.posts_7d ?? 0).toLocaleString(locale)}
          hint={t("exec_pill_volume_hint")}
          delta={
            totals.delta_pct != null
              ? `${totals.delta_pct >= 0 ? "+" : ""}${totals.delta_pct.toFixed(0)}%`
              : null
          }
          deltaIsBad={false}
          accent="slate"
        />
      )}
    </div>
  );
}

export function HeadlinePill({
  label,
  value,
  hint,
  delta,
  deltaIsBad,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  delta: string | null;
  deltaIsBad: boolean;
  accent: "brand" | "emerald" | "amber" | "slate";
}) {
  const accentBg = {
    brand: "bg-brand-50/70 ring-brand-100",
    emerald: "bg-emerald-50/70 ring-emerald-100",
    amber: "bg-amber-50/70 ring-amber-100",
    slate: "bg-white ring-slate-200",
  }[accent];

  return (
    <div className={`rounded-xl p-3 ring-1 ${accentBg}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="truncate text-base font-bold text-slate-900 sm:text-lg">
          {value}
        </p>
        {delta && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
              deltaIsBad
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {delta}
          </span>
        )}
      </div>
      {hint && (
        <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}
