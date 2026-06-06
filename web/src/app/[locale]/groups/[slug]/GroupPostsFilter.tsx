"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { loadGroupPosts } from "./actions";

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
type FilterCounts = Record<SentimentFilter, number>;

/**
 * Sentiment-filterable, paginated posts list for /groups/[slug].
 *
 * The parent (server) renders the first PAGE_SIZE rows; this client
 * component manages "Muat lebih banyak" + sentiment filter switches
 * via the loadGroupPosts server action. Filter chip totals come from
 * server-side aggregates over the full 14d window — they don't drift
 * as the user paginates.
 */
export function GroupPostsFilter({
  initialPosts,
  initialHasMore,
  groupSlug,
  topicId,
  locale,
  pageSize,
  filterCounts,
  emptyMessage,
  filterLabels,
  loadMoreLabel,
  loadingLabel,
  endLabel,
  errorLabel,
}: {
  initialPosts: GroupPost[];
  initialHasMore: boolean;
  groupSlug: string;
  topicId: string | null;
  locale: string;
  pageSize: number;
  filterCounts: FilterCounts;
  emptyMessage: string;
  filterLabels: {
    all: string;
    positive: string;
    neutral: string;
    negative: string;
  };
  loadMoreLabel: string;
  loadingLabel: string;
  endLabel: string;
  errorLabel: string;
}) {
  const [filter, setFilter] = useState<SentimentFilter>("all");
  const [posts, setPosts] = useState<GroupPost[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Cancel-on-rerun: ignore in-flight responses if the user kicks off
  // a newer fetch (e.g. mashes filter chips). React Transitions don't
  // auto-cancel, so we track a generation counter.
  const reqGen = useRef(0);

  const changeFilter = useCallback(
    (next: SentimentFilter) => {
      if (next === filter || isPending) return;
      setFilter(next);
      setError(null);
      const gen = ++reqGen.current;
      startTransition(async () => {
        try {
          const res = await loadGroupPosts({
            groupSlug,
            topicId,
            sentiment: next,
            offset: 0,
            limit: pageSize,
            locale,
          });
          if (gen !== reqGen.current) return;
          setPosts(res.posts);
          setHasMore(res.hasMore);
        } catch {
          if (gen !== reqGen.current) return;
          setError(errorLabel);
        }
      });
    },
    [filter, isPending, groupSlug, topicId, pageSize, locale, errorLabel],
  );

  const loadMore = useCallback(() => {
    if (isPending || !hasMore) return;
    setError(null);
    const gen = ++reqGen.current;
    const offset = posts.length;
    startTransition(async () => {
      try {
        const res = await loadGroupPosts({
          groupSlug,
          topicId,
          sentiment: filter,
          offset,
          limit: pageSize,
          locale,
        });
        if (gen !== reqGen.current) return;
        setPosts((cur) => [...cur, ...res.posts]);
        setHasMore(res.hasMore);
      } catch {
        if (gen !== reqGen.current) return;
        setError(errorLabel);
      }
    });
  }, [
    isPending,
    hasMore,
    posts.length,
    groupSlug,
    topicId,
    filter,
    pageSize,
    locale,
    errorLabel,
  ]);

  // Note: topic-filter changes (?topic=…) are handled by the parent
  // passing a `key={topicFilter}` so React remounts this component
  // with fresh initial state — no useEffect reset needed here.

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <FilterChip
          label={filterLabels.all}
          count={filterCounts.all}
          active={filter === "all"}
          onClick={() => changeFilter("all")}
          tone="slate"
        />
        <FilterChip
          label={filterLabels.positive}
          count={filterCounts.positive}
          active={filter === "positive"}
          onClick={() => changeFilter("positive")}
          tone="emerald"
        />
        <FilterChip
          label={filterLabels.neutral}
          count={filterCounts.neutral}
          active={filter === "neutral"}
          onClick={() => changeFilter("neutral")}
          tone="slate"
        />
        <FilterChip
          label={filterLabels.negative}
          count={filterCounts.negative}
          active={filter === "negative"}
          onClick={() => changeFilter("negative")}
          tone="amber"
        />
      </div>

      {posts.length === 0 && !isPending ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {posts.map((p) => {
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

          <div className="mt-5 flex flex-col items-center gap-2">
            {hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? loadingLabel : loadMoreLabel}
              </button>
            ) : posts.length > 0 ? (
              <span className="text-[11px] text-slate-500">{endLabel}</span>
            ) : null}
            {error && (
              <p className="text-[11px] text-amber-700" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
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
