"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { TopicDetailModal, type TopicDetail } from "./TopicDetailModal";

/**
 * Trending-topics rows on /briefings — each row is a clickable button
 * that opens the same TopicDetailModal used by the dashboard.
 *
 * Visual: background bar width = post_count / max(post_count). The bar
 * was already there (added today as visual contrast); this component
 * adds:
 *   - whole row is a button with hover state
 *   - chevron icon appears on hover to signal "click for detail"
 *   - on click → modal with sample posts, top outlets, sentiment
 *
 * Data is preloaded by the page (no lazy fetch on click) — the parent
 * passes the full TopicDetail[] so opening is instant.
 */
export function TrendingTopicsList({
  topics,
  countLabel,
}: {
  topics: TopicDetail[];
  /** Localised "posts" suffix shown after the count. Defaults to "posts". */
  countLabel?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? topics.find((t) => t.id === activeId) ?? null : null;

  if (topics.length === 0) return null;

  const maxCount = Math.max(...topics.map((t) => t.volume), 1);
  const label = countLabel ?? "posts";

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
        {topics.map((t, i) => {
          const pct = (t.volume / maxCount) * 100;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              title={`${t.volume} ${label} · ${t.reach} ${t.reach === 1 ? "source" : "sources"} · click for detail`}
              className={`group relative grid w-full grid-cols-[1fr_auto_20px] items-center gap-3 px-3 py-2.5 text-left transition hover:bg-paper-deep ${i > 0 ? "border-t border-hairline" : ""}`}
            >
              {/* Background bar — sits behind the row contents, width
                  proportional to post_count vs max. Slightly darker on
                  hover so the affordance reads. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 bg-brand-50 transition group-hover:bg-brand-100"
                style={{ width: `${pct}%` }}
              />
              <div className="relative min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  <span className="mr-1.5 tabular-nums text-ink-faint">
                    {i + 1}.
                  </span>
                  {t.title}
                </p>
                <p className="truncate text-xs text-ink-faint">
                  {t.keywords.slice(0, 4).join(" · ") || t.platform}
                </p>
              </div>
              <span className="relative whitespace-nowrap text-xs font-semibold tabular-nums text-ink-muted">
                {t.volume.toLocaleString()}{" "}
                <span className="font-normal text-ink-faint">{label}</span>
              </span>
              <ChevronRight className="relative h-4 w-4 shrink-0 text-ink-faint/60 transition group-hover:translate-x-0.5 group-hover:text-ink-faint" />
            </button>
          );
        })}
      </div>

      {active && (
        <TopicDetailModal
          topic={active}
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}
