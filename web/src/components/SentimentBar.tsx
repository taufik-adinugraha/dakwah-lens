"use client";

/**
 * Three-segment sentiment bar (positive / neutral / concerned) shown
 * across the dashboard, /briefings, and topic detail modal.
 *
 * Two visual modes:
 *   - "compact" (default) — 8px bar with % labels below.
 *   - "detailed" — 12px bar with both count and % below.
 *
 * The bar itself also exposes a native `title` tooltip so hovering any
 * segment shows the raw breakdown — matches the always-visible numbers
 * but works on touch when the user long-presses.
 *
 * Was previously inlined JSX in 4 places with no labels, just colors —
 * users couldn't tell which color meant what. Centralising here also
 * means the colour scheme moves together if we restyle later.
 */
export function SentimentBar({
  sentiment,
  counts,
  size = "compact",
  showLegend = true,
  labels,
}: {
  /** Percentages [positive, neutral, concerned] — already 0-100. */
  sentiment: readonly [number, number, number];
  /** Raw counts, optional. Shown when present alongside the % in detailed mode. */
  counts?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  size?: "compact" | "detailed";
  showLegend?: boolean;
  /** Override the segment labels — defaults to English. */
  labels?: { positive: string; neutral: string; negative: string };
}) {
  const [pos, neu, neg] = sentiment;
  const segLabels = labels ?? {
    positive: "positive",
    neutral: "neutral",
    negative: "concerned",
  };
  const detailed = size === "detailed";
  const barHeight = detailed ? "h-3" : "h-2";

  const tooltip = [
    `${segLabels.positive}: ${pos}%${counts ? ` (${counts.positive})` : ""}`,
    `${segLabels.neutral}: ${neu}%${counts ? ` (${counts.neutral})` : ""}`,
    `${segLabels.negative}: ${neg}%${counts ? ` (${counts.negative})` : ""}`,
  ].join(" · ");

  return (
    <div>
      <div
        className={`flex ${barHeight} overflow-hidden rounded-full`}
        title={tooltip}
      >
        <span
          className="bg-emerald-500"
          style={{ width: `${pos}%` }}
          title={`${segLabels.positive}: ${pos}%${counts ? ` (${counts.positive})` : ""}`}
        />
        <span
          className="bg-slate-300"
          style={{ width: `${neu}%` }}
          title={`${segLabels.neutral}: ${neu}%${counts ? ` (${counts.neutral})` : ""}`}
        />
        <span
          className="bg-amber-500"
          style={{ width: `${neg}%` }}
          title={`${segLabels.negative}: ${neg}%${counts ? ` (${counts.negative})` : ""}`}
        />
      </div>
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-slate-500">
          <span>
            <span className="font-semibold text-emerald-700">{pos}%</span>{" "}
            {segLabels.positive}
            {detailed && counts && (
              <span className="text-slate-400"> · {counts.positive}</span>
            )}
          </span>
          <span>
            <span className="font-semibold text-slate-700">{neu}%</span>{" "}
            {segLabels.neutral}
            {detailed && counts && (
              <span className="text-slate-400"> · {counts.neutral}</span>
            )}
          </span>
          <span>
            <span className="font-semibold text-amber-700">{neg}%</span>{" "}
            {segLabels.negative}
            {detailed && counts && (
              <span className="text-slate-400"> · {counts.negative}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
