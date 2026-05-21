"use client";

import { useState } from "react";

import { ShowMoreList } from "./ShowMoreList";

export type FilterableTopPost = {
  id: string;
  text: string | null;
  author: string | null;
  platform: string;
  url: string | null;
  sentimentLabel: string | null;
  dawahRelevance: number | null;
  dawahOpportunity: number | null;
  postedAt: Date | string | null;
};

type SentimentFilter = "all" | "positive" | "neutral" | "negative";

/**
 * Top-posts list with inline sentiment filter chips. Filters happen
 * client-side over the prefetched list (server already returns up to 50
 * sorted by opportunity) — no round-trip, no URL gymnastics. Empty-state
 * messaging adjusts per active filter so users know they're not looking
 * at a broken page.
 */
export function FilterableTopPosts({
  posts,
  locale,
  openSourceLabel,
  emptyMessage,
  showMoreLabel,
  /** Heading rendered above the filter row. */
  title,
  filterLabels,
}: {
  posts: FilterableTopPost[];
  locale: string;
  openSourceLabel: string;
  emptyMessage: string;
  showMoreLabel: string;
  title: string;
  filterLabels: {
    all: string;
    positive: string;
    neutral: string;
    negative: string;
  };
}) {
  const [filter, setFilter] = useState<SentimentFilter>("all");

  // Precompute counts so chips show "(N)" — gives users a sense of
  // distribution before they click.
  const counts: Record<SentimentFilter, number> = {
    all: posts.length,
    positive: posts.filter((p) => p.sentimentLabel === "positive").length,
    neutral: posts.filter((p) => p.sentimentLabel === "neutral").length,
    negative: posts.filter((p) => p.sentimentLabel === "negative").length,
  };

  const visible =
    filter === "all"
      ? posts
      : posts.filter((p) => p.sentimentLabel === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label={filterLabels.all}
            count={counts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
            tone="slate"
          />
          <FilterChip
            label={filterLabels.positive}
            count={counts.positive}
            active={filter === "positive"}
            onClick={() => setFilter("positive")}
            tone="emerald"
          />
          <FilterChip
            label={filterLabels.neutral}
            count={counts.neutral}
            active={filter === "neutral"}
            onClick={() => setFilter("neutral")}
            tone="slate"
          />
          <FilterChip
            label={filterLabels.negative}
            count={counts.negative}
            active={filter === "negative"}
            onClick={() => setFilter("negative")}
            tone="amber"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
          {filter === "all"
            ? emptyMessage
            : `No ${filterLabels[filter].toLowerCase()} posts in this segment.`}
        </div>
      ) : (
        <div className="space-y-3">
          <ShowMoreList pageSize={8} moreLabel={showMoreLabel}>
            {visible.map((p) => (
              <article
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-semibold uppercase tracking-wider text-slate-700">
                    {p.platform}
                  </span>
                  {p.author && <span>@{p.author}</span>}
                  {p.sentimentLabel && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ${
                        p.sentimentLabel === "positive"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                          : p.sentimentLabel === "negative"
                            ? "bg-amber-50 text-amber-800 ring-amber-100"
                            : "bg-slate-50 text-slate-600 ring-slate-100"
                      }`}
                    >
                      {p.sentimentLabel}
                    </span>
                  )}
                  {(p.dawahOpportunity ?? p.dawahRelevance) !== null &&
                    (p.dawahOpportunity ?? p.dawahRelevance) !== undefined && (
                      <span className="tabular-nums">
                        {((p.dawahOpportunity ?? p.dawahRelevance ?? 0) * 100).toFixed(0)}
                        % relevance
                      </span>
                    )}
                  {p.postedAt && (
                    <span className="text-slate-400">
                      {new Date(p.postedAt).toLocaleDateString(locale)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-800">
                  {(p.text ?? "").slice(0, 360)}
                  {(p.text ?? "").length > 360 ? "…" : ""}
                </p>
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[11px] font-medium text-brand-700 hover:underline"
                  >
                    {openSourceLabel} ↗
                  </a>
                )}
              </article>
            ))}
          </ShowMoreList>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: "slate" | "emerald" | "amber";
}) {
  const toneActive = {
    slate: "bg-slate-900 text-white ring-slate-900",
    emerald: "bg-emerald-600 text-white ring-emerald-600",
    amber: "bg-amber-600 text-white ring-amber-600",
  }[tone];
  const toneIdle = {
    slate: "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
    emerald: "bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50",
    amber: "bg-white text-amber-800 ring-amber-200 hover:bg-amber-50",
  }[tone];
  const disabled = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? toneActive : toneIdle}`}
    >
      {label}
      <span
        className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}
      >
        {count}
      </span>
    </button>
  );
}
