"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";

import { ShowMoreList } from "@/components/ShowMoreList";

/**
 * Story shape the platform page passes in. Mirrors PlatformInsights["topStories"]
 * from lib/briefing-data.ts — kept local so this client component doesn't
 * pull server-only imports.
 */
type PlatformStory = {
  id: string;
  text: string;
  author: string | null;
  url: string | null;
  sentimentLabel: string | null;
  sentimentScore: number | null;
  dawahOpportunity: number | null;
  themeGroup: string | null;
  postedAt: Date | string | null;
};

type SentimentFilter = "all" | "positive" | "neutral" | "negative";

/**
 * Sentiment-filterable top-stories list for /briefings/[platform].
 *
 * Wraps the EXISTING card markup from the platform page (author badge,
 * sentiment badge with score, dominant category, relevance %, truncated
 * text, open-source link) — the only addition is the filter chip row
 * above. Built as its own component (vs reusing FilterableTopPosts)
 * because the platform card surfaces dominant-category + sentiment-score
 * fields that the segment card doesn't, and consolidating them into one
 * component would force one surface to inherit the other's irrelevant
 * fields.
 *
 * Filter happens client-side over the prefetched list — no round-trip.
 */
export function PlatformStoriesFilter({
  stories,
  filterLabels,
  showMoreLabel,
  openOriginalLabel,
  emptyMessage,
  expandLabel,
  collapseLabel,
}: {
  stories: PlatformStory[];
  filterLabels: {
    all: string;
    positive: string;
    neutral: string;
    negative: string;
  };
  showMoreLabel: string;
  openOriginalLabel: string;
  emptyMessage: string;
  /** Toggle copy for the collapse/expand button — passed in so the page
   *  controls localization. The list is collapsed by default to keep
   *  initial render light even on platforms with 1000+ posts. */
  expandLabel: string;
  collapseLabel: string;
}) {
  const [filter, setFilter] = useState<SentimentFilter>("all");
  const [expanded, setExpanded] = useState(false);

  const counts: Record<SentimentFilter, number> = {
    all: stories.length,
    positive: stories.filter((s) => s.sentimentLabel === "positive").length,
    neutral: stories.filter((s) => s.sentimentLabel === "neutral").length,
    negative: stories.filter((s) => s.sentimentLabel === "negative").length,
  };

  const visible =
    filter === "all"
      ? stories
      : stories.filter((s) => s.sentimentLabel === filter);

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
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

      {/* Collapse toggle — list is hidden by default so the platform
          page paints fast even when topStories has ~1000 rows. */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? collapseLabel : expandLabel}
          <span className="tabular-nums text-slate-500">({visible.length})</span>
        </button>
      </div>

      {expanded && visible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : expanded ? (
        <div className="mt-6 grid gap-3">
          <ShowMoreList pageSize={8} moreLabel={showMoreLabel}>
            {visible.map((s) => {
              const sentTone =
                s.sentimentLabel === "positive"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                  : s.sentimentLabel === "negative"
                    ? "bg-amber-50 text-amber-700 ring-amber-100"
                    : "bg-slate-50 text-slate-700 ring-slate-200";
              return (
                <article
                  key={s.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {s.author && (
                      <span className="font-semibold text-slate-700">
                        @{s.author}
                      </span>
                    )}
                    {s.sentimentLabel && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${sentTone}`}
                      >
                        {s.sentimentLabel}
                        {typeof s.sentimentScore === "number"
                          ? ` · ${(s.sentimentScore * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    )}
                    {s.themeGroup && (
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-100">
                        {s.themeGroup}
                      </span>
                    )}
                    {typeof s.dawahOpportunity === "number" && (
                      <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                        relevance {(s.dawahOpportunity * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-800">
                    {s.text.length > 280 ? s.text.slice(0, 280) + "…" : s.text}
                  </p>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
                    >
                      {openOriginalLabel}
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </article>
              );
            })}
          </ShowMoreList>
        </div>
      ) : null}
    </>
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
  const toneInactive = {
    slate: "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
    emerald: "bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50",
    amber: "bg-white text-amber-700 ring-amber-200 hover:bg-amber-50",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
        active ? toneActive : toneInactive
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums text-[10px] ${active ? "text-white/80" : "text-slate-500"}`}
      >
        {count}
      </span>
    </button>
  );
}
