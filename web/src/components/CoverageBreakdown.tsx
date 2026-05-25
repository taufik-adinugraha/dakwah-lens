import type {
  PlatformBucket,
  SentimentBreakdown,
  SentimentByPlatformRow,
  TopicBucket,
  TopicByPlatformGroup,
} from "@/lib/dashboard-metrics";
import {
  SentimentByPlatformDialog,
  type SentimentByPlatformLabels,
} from "./SentimentByPlatformDialog";
import {
  TopicsByPlatformDialog,
  type TopicsByPlatformLabels,
} from "./TopicsByPlatformDialog";

/**
 * Three coverage breakdowns rendered side-by-side under one section
 * header. Shared between the logged-in dashboard's Data tab and the
 * public `/insights/explore` page — both surfaces want to answer
 * "who's talking, how do they feel, what are they talking about?"
 * with identical UX. Labels are passed in via the `labels` prop so
 * each call site can supply its own i18n namespace (Dashboard vs
 * Insights) without the component knowing.
 *
 * Layout: 1-column on mobile, 3-column on `md`. Each card hides
 * silently when its slice is empty so the row doesn't render
 * three "no data" placeholders on a fresh install.
 */

export type CoverageLabels = {
  sectionTitle: string;
  sectionSubtitle: string;
  platformsTitle: string;
  postsSuffix: string;
  /** Plain-language replacement for the `mainstream` platform key
   *  ("RSS arus utama" / "Mainstream RSS"). Other platform values
   *  render as-is. */
  platformMainstream: string;
  sentimentTitle: string;
  classifiedSuffix: string;
  sentimentPositive: string;
  sentimentNeutral: string;
  sentimentNegative: string;
  unlabelledTpl: string; // contains `{n}`
  sentimentByPlatform: SentimentByPlatformLabels;
  topicsTitle: string;
  topicsCountSuffix: string;
  topicsByPlatform: TopicsByPlatformLabels;
};

export function CoverageBreakdown({
  platforms,
  sentiment,
  sentimentByPlatform,
  topics,
  topicsByPlatform,
  labels,
}: {
  platforms: PlatformBucket[];
  sentiment: SentimentBreakdown;
  sentimentByPlatform: SentimentByPlatformRow[];
  topics: TopicBucket[];
  topicsByPlatform: TopicByPlatformGroup[];
  labels: CoverageLabels;
}) {
  if (
    platforms.length === 0 &&
    sentiment.total === 0 &&
    topics.length === 0
  ) {
    return null;
  }

  return (
    <section>
      <h2 className="text-balance text-lg font-semibold text-slate-900 sm:text-xl">
        {labels.sectionTitle}
      </h2>
      <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-500 sm:text-sm">
        {labels.sectionSubtitle}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <PlatformCard data={platforms} labels={labels} />
        <SentimentCard
          data={sentiment}
          byPlatform={sentimentByPlatform}
          labels={labels}
        />
        <TopicsCard
          data={topics}
          byPlatform={topicsByPlatform}
          labels={labels}
        />
      </div>
    </section>
  );
}

function PlatformCard({
  data,
  labels,
}: {
  data: PlatformBucket[];
  labels: CoverageLabels;
}) {
  const total = data.reduce((s, b) => s + b.count, 0);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {labels.platformsTitle}
      </p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
        {total.toLocaleString()}
        <span className="ml-1 text-xs font-medium text-slate-400">
          {labels.postsSuffix}
        </span>
      </p>
      {data.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">—</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.map((p) => (
            <li key={p.platform}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium capitalize text-slate-700">
                  {p.platform === "mainstream"
                    ? labels.platformMainstream
                    : p.platform}
                </span>
                <span className="tabular-nums text-slate-500">
                  {p.count.toLocaleString()} · {p.pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(p.pct, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SentimentCard({
  data,
  byPlatform,
  labels,
}: {
  data: SentimentBreakdown;
  byPlatform: SentimentByPlatformRow[];
  labels: CoverageLabels;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {labels.sentimentTitle}
      </p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
        {data.total.toLocaleString()}
        <span className="ml-1 text-xs font-medium text-slate-400">
          {labels.classifiedSuffix}
        </span>
      </p>
      {data.total === 0 ? (
        <p className="mt-3 text-xs text-slate-400">—</p>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-rose-500"
              style={{ width: `${data.negative.pct}%` }}
              title={`${labels.sentimentNegative} ${data.negative.pct.toFixed(0)}%`}
            />
            <div
              className="h-full bg-slate-300"
              style={{ width: `${data.neutral.pct}%` }}
              title={`${labels.sentimentNeutral} ${data.neutral.pct.toFixed(0)}%`}
            />
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${data.positive.pct}%` }}
              title={`${labels.sentimentPositive} ${data.positive.pct.toFixed(0)}%`}
            />
          </div>
          <ul className="mt-3 space-y-1 text-[11px]">
            <SentimentRow
              dot="bg-emerald-500"
              label={labels.sentimentPositive}
              count={data.positive.count}
              pct={data.positive.pct}
            />
            <SentimentRow
              dot="bg-slate-400"
              label={labels.sentimentNeutral}
              count={data.neutral.count}
              pct={data.neutral.pct}
            />
            <SentimentRow
              dot="bg-rose-500"
              label={labels.sentimentNegative}
              count={data.negative.count}
              pct={data.negative.pct}
            />
          </ul>
          {data.unlabelled > 0 && (
            <p className="mt-2 text-[10px] text-slate-400">
              {labels.unlabelledTpl.replace(
                "{n}",
                data.unlabelled.toLocaleString(),
              )}
            </p>
          )}
          <SentimentByPlatformDialog
            rows={byPlatform}
            labels={labels.sentimentByPlatform}
          />
        </>
      )}
    </div>
  );
}

function SentimentRow({
  dot,
  label,
  count,
  pct,
}: {
  dot: string;
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <li className="flex items-center justify-between">
      <span className="inline-flex items-center gap-1.5 text-slate-700">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="tabular-nums text-slate-500">
        {count.toLocaleString()} · {pct.toFixed(0)}%
      </span>
    </li>
  );
}

function TopicsCard({
  data,
  byPlatform,
  labels,
}: {
  data: TopicBucket[];
  byPlatform: TopicByPlatformGroup[];
  labels: CoverageLabels;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {labels.topicsTitle}
      </p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums text-slate-900">
          {data.length}
          <span className="ml-1 text-xs font-medium text-slate-400">
            {labels.topicsCountSuffix}
          </span>
        </p>
        <TopicsByPlatformDialog
          groups={byPlatform}
          labels={labels.topicsByPlatform}
        />
      </div>
      {data.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">—</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.map((topic) => (
            <li key={topic.id}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-medium text-slate-700">
                  {topic.label}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {topic.count}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(topic.pct, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
