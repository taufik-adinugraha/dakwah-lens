"use client";

import { useState } from "react";
import {
  ArrowRight,
  Flame,
  Sparkles,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { I18nText } from "./I18nText";
import { SentimentBar } from "./SentimentBar";
import { TopicDetailModal, type TopicDetail } from "./TopicDetailModal";

const TONES = [
  "from-brand-500 to-cyan-500",
  "from-emerald-500 to-emerald-600",
  "from-violet-500 to-rose-500",
];

/**
 * Top-issues grid on the dashboard. Each card is fully clickable —
 * opens a TopicDetailModal with sample posts, top outlets, and
 * sentiment counts. The "Generate brief" CTA inside the card stays
 * functional via stopPropagation so it doesn't also open the modal.
 *
 * Was a server-rendered grid with no interaction beyond the brief link;
 * now lifted to a client component so the same data can drive both the
 * preview cards AND the detail modal without re-fetching.
 */
export function TopIssueCards({
  issues,
  generateBriefLabel,
  volumeLabel,
  reachLabel,
  sentimentLabel,
  canCreateBriefs = false,
}: {
  issues: TopicDetail[];
  generateBriefLabel: string;
  volumeLabel: string;
  reachLabel: string;
  sentimentLabel: string;
  /** Brief generation is admin-only while the feature is experimental
   *  (2026-05-23). When false the per-card "Generate brief" CTA is
   *  hidden — the card itself still opens the detail modal. */
  canCreateBriefs?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? issues.find((i) => i.id === activeId) ?? null : null;

  return (
    <>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {issues.map((i, idx) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActiveId(i.id)}
            className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          >
            <div
              className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${TONES[idx % TONES.length]} text-white shadow-sm`}
            >
              <Flame className="h-5 w-5" />
            </div>

            <h3 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
              {i.title}
            </h3>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              {i.platform}
              {i.keywords.length > 0 && (
                <span className="text-slate-300"> · </span>
              )}
              {i.keywords.slice(0, 2).join(" · ")}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label={volumeLabel} value={formatCompactNumber(i.volume)} />
              <Stat
                label={reachLabel}
                value={i.reach > 0 ? formatCompactNumber(i.reach) : "—"}
              />
            </div>

            <div className="mt-4">
              <I18nText
                text={sentimentLabel}
                className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              />
              <div className="mt-1.5">
                <SentimentBar
                  sentiment={i.sentiment}
                  counts={i.sentimentCounts}
                  size="compact"
                />
              </div>
            </div>

            {/* CTA — admin-only while brief generation is experimental.
                Non-admin viewers still get the clickable card → detail
                modal flow. */}
            {canCreateBriefs && (
              <Link
                href={{ pathname: "/briefs/new", query: { topic: i.title } }}
                onClick={(e) => e.stopPropagation()}
                className="mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generateBriefLabel}
                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
              </Link>
            )}
          </button>
        ))}
      </div>

      {active && (
        <TopicDetailModal
          topic={active}
          onClose={() => setActiveId(null)}
          generateBriefLabel={generateBriefLabel}
          canCreateBriefs={canCreateBriefs}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}

function formatCompactNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
