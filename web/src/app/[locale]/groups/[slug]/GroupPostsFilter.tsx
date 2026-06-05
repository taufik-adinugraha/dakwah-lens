"use client";

import { useState } from "react";

export type GroupPost = {
  id: string;
  text: string;
  author: string | null;
  url: string | null;
  platform: string;
  /** Pre-formatted, locale-aware date string from the server. */
  postedAt: string | null;
  sentimentLabel: string | null;
};

type SentimentFilter = "all" | "positive" | "neutral" | "negative";

/**
 * Sentiment-filterable posts list for /groups/[slug].
 *
 * Mirrors the chip-filter pattern from PlatformStoriesFilter on
 * /radar/[platform], but tuned for the smaller group-page card
 * (no expand toggle, no opportunity-score column — just text +
 * author + date + sentiment chip).
 *
 * The parent (server) pre-formats `postedAt` as a locale-aware
 * string so this component doesn't need to import next-intl.
 */
export function GroupPostsFilter({
  posts,
  emptyMessage,
  filterLabels,
}: {
  posts: GroupPost[];
  emptyMessage: string;
  filterLabels: {
    all: string;
    positive: string;
    neutral: string;
    negative: string;
  };
}) {
  const [filter, setFilter] = useState<SentimentFilter>("all");

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
    <>
      <div className="mt-4 flex flex-wrap gap-2">
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

      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((p) => {
            const first =
              (p.text || "")
                .split("\n")
                .map((s) => s.trim())
                .find((s) => s.length > 0) ?? "";
            const sentTone =
              p.sentimentLabel === "positive"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : p.sentimentLabel === "negative"
                  ? "bg-amber-50 text-amber-700 ring-amber-100"
                  : "bg-slate-50 text-slate-700 ring-slate-200";
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
                      {p.postedAt && <span>{p.postedAt}</span>}
                      {p.sentimentLabel && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1 ${sentTone}`}
                        >
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
