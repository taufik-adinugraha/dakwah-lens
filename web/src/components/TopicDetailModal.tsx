"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Flame,
  Newspaper,
  Sparkles,
  X,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SentimentBar } from "./SentimentBar";

export type TopicDetail = {
  id: string;
  title: string;
  platform: string;
  keywords: string[];
  volume: number;
  reach: number;
  sentiment: readonly [number, number, number];
  sentimentCounts: { positive: number; neutral: number; negative: number };
  samplePosts: Array<{
    id: string;
    text: string;
    author: string | null;
    url: string | null;
    sentimentLabel: string | null;
    opportunity: number | null;
    postedAt: Date | string | null;
  }>;
  topOutlets: Array<{ name: string; count: number }>;
};

export function TopicDetailModal({
  topic,
  onClose,
  generateBriefLabel = "Generate brief",
  closeLabel = "Close",
}: {
  topic: TopicDetail;
  onClose: () => void;
  generateBriefLabel?: string;
  closeLabel?: string;
}) {
  // Close on Esc + lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const maxOutlet = Math.max(...topic.topOutlets.map((o) => o.count), 1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-detail-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-cyan-500 text-white shadow-sm">
                <Flame className="h-3.5 w-3.5" />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {topic.platform}
              </p>
            </div>
            <h3
              id="topic-detail-title"
              className="mt-2 text-balance text-lg font-bold text-slate-900 sm:text-xl"
            >
              {topic.title}
            </h3>
            {topic.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topic.keywords.slice(0, 6).map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Volume + Reach with explanatory hints */}
          <section className="grid grid-cols-2 gap-3">
            <Metric
              label="Volume"
              value={topic.volume.toLocaleString()}
              hint="Total posts in this topic (last 7 days)"
            />
            <Metric
              label="Reach"
              value={topic.reach > 0 ? topic.reach.toLocaleString() : "—"}
              hint={
                topic.platform === "mainstream"
                  ? "Distinct outlets covering it"
                  : "Distinct accounts covering it"
              }
            />
          </section>

          {/* Sentiment with raw counts */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Sentiment breakdown
            </p>
            <SentimentBar
              sentiment={topic.sentiment}
              counts={topic.sentimentCounts}
              size="detailed"
            />
          </section>

          {/* Top outlets covering the topic */}
          {topic.topOutlets.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Top outlets covering this topic
              </p>
              <ul className="space-y-1.5">
                {topic.topOutlets.map((o) => {
                  const pct = (o.count / maxOutlet) * 100;
                  return (
                    <li
                      key={o.name}
                      className="grid grid-cols-[140px_1fr_auto] items-center gap-3"
                    >
                      <span className="truncate text-xs font-medium text-slate-800">
                        {o.name}
                      </span>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full bg-brand-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-slate-600">
                        {o.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Sample posts in this topic */}
          {topic.samplePosts.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Top posts in this topic
              </p>
              <ul className="space-y-2">
                {topic.samplePosts.map((p) => {
                  const headline =
                    (p.text || "").split("\n", 1)[0].trim() || p.text;
                  const sentToneClass =
                    p.sentimentLabel === "positive"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : p.sentimentLabel === "negative"
                        ? "bg-amber-50 text-amber-800 ring-amber-100"
                        : "bg-slate-50 text-slate-600 ring-slate-100";
                  return (
                    <li
                      key={p.id}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <Newspaper className="h-3 w-3 shrink-0" />
                        {p.author && (
                          <span className="font-semibold text-slate-700">
                            {p.author}
                          </span>
                        )}
                        {p.sentimentLabel && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${sentToneClass}`}
                          >
                            {p.sentimentLabel}
                          </span>
                        )}
                        {typeof p.opportunity === "number" && (
                          <span className="text-[10px] tabular-nums text-slate-400">
                            relevance {(p.opportunity * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-800">
                        {headline}
                      </p>
                      {p.url && (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
                        >
                          Open source
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Sticky footer with the CTA */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-6 py-3 backdrop-blur">
          <p className="text-[11px] text-slate-500">
            Showing top {topic.samplePosts.length} of {topic.volume} posts in last 7 days
          </p>
          <Link
            href={{
              pathname: "/briefs/new",
              query: { topic: topic.title },
            }}
            className="group inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generateBriefLabel}
            <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        {hint}
      </p>
    </div>
  );
}
