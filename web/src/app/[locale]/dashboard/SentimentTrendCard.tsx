"use client";

/**
 * 30-day sentiment trend card with:
 *   - hover tooltip showing pos%/neg%/total per day
 *   - "view by platform" button opening a dialog with one mini-chart per
 *     product-supported platform
 *
 * Client component because hover + dialog open/close are stateful. The
 * heavy lifting (SQL roll-up across platform + day) stays server-side in
 * `getSentimentTrend30d`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";

import type { SentimentTrend30d, SentimentTrendPoint } from "@/lib/dashboard-metrics";

export type SentimentTrendLabels = {
  title: string;
  subtitle: string;
  legendNegative: string;
  legendPositive: string;
  viewByPlatformCta: string;
  dialogTitle: string;
  dialogSubtitle: string;
  closeLabel: string;
  noDataPlatform: string;
  platformMainstream: string;
  /** "{n} klasifikasi" — count of classified posts that day */
  tooltipClassifiedTpl: string;
};

export function SentimentTrendCard({
  data,
  labels,
}: {
  data: SentimentTrend30d;
  labels: SentimentTrendLabels;
}) {
  const { overall, byPlatform } = data;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (overall.length < 3) return null;

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">
            {labels.title}
          </h2>
          <p className="mt-1 text-pretty text-sm leading-relaxed text-slate-600">
            {labels.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          {labels.viewByPlatformCta}
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <Legend labels={labels} />
        <TrendChart
          points={overall}
          height={140}
          ariaLabel={labels.title}
          tooltipClassifiedTpl={labels.tooltipClassifiedTpl}
          legendPositive={labels.legendPositive}
          legendNegative={labels.legendNegative}
        />
        <DateRangeAxis points={overall} />
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sentiment-trend-by-platform-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <h3
                  id="sentiment-trend-by-platform-title"
                  className="text-balance text-lg font-bold text-slate-900 sm:text-xl"
                >
                  {labels.dialogTitle}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {labels.dialogSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={labels.closeLabel}
                className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ul className="space-y-4 px-6 py-5">
              {byPlatform.map(({ platform, points }) => (
                <PlatformTrendRow
                  key={platform}
                  platform={platform}
                  points={points}
                  labels={labels}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({ labels }: { labels: SentimentTrendLabels }) {
  return (
    <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
        {labels.legendNegative}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
        {labels.legendPositive}
      </span>
    </div>
  );
}

function DateRangeAxis({ points }: { points: SentimentTrendPoint[] }) {
  if (points.length === 0) return null;
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return (
    <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
      <span>{fmt(points[0].day)}</span>
      <span>{fmt(points[points.length - 1].day)}</span>
    </div>
  );
}

function PlatformTrendRow({
  platform,
  points,
  labels,
}: {
  platform: string;
  points: SentimentTrendPoint[];
  labels: SentimentTrendLabels;
}) {
  const displayName =
    platform === "mainstream" ? labels.platformMainstream : platform;
  const hasData = points.length >= 3;

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold capitalize text-slate-900">
          {displayName}
        </p>
      </div>
      {hasData ? (
        <div className="mt-3">
          <TrendChart
            points={points}
            height={90}
            ariaLabel={`${labels.title} — ${displayName}`}
            tooltipClassifiedTpl={labels.tooltipClassifiedTpl}
            legendPositive={labels.legendPositive}
            legendNegative={labels.legendNegative}
            compact
          />
          <DateRangeAxis points={points} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">{labels.noDataPlatform}</p>
      )}
    </li>
  );
}

/**
 * Inline SVG line chart with pointer-based hover tooltip.
 *
 * Coordinate system is fixed (600×height viewBox, preserveAspectRatio=none)
 * so we can map a client X offset back to a point index by snapping to
 * the nearest tick.
 */
function TrendChart({
  points,
  height,
  ariaLabel,
  tooltipClassifiedTpl,
  legendPositive,
  legendNegative,
  compact = false,
}: {
  points: SentimentTrendPoint[];
  height: number;
  ariaLabel: string;
  tooltipClassifiedTpl: string;
  legendPositive: string;
  legendNegative: string;
  compact?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const w = 600;
  const h = height;
  const padX = 8;
  const padY = 16;
  const max = 100;
  const stepX = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;

  const { posPath, negPath } = useMemo(() => {
    const build = (key: "negPct" | "posPct") =>
      points
        .map((p, i) => {
          const x = padX + stepX * i;
          const y = padY + ((max - p[key]) / max) * (h - padY * 2);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    return { posPath: build("posPct"), negPath: build("negPct") };
  }, [points, stepX, h]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = e.clientX - rect.left;
    const svgX = (relX / rect.width) * w;
    const idx = Math.round((svgX - padX) / Math.max(1, stepX));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hovered = hoverIdx == null ? null : points[hoverIdx];
  const hoverX = hoverIdx == null ? 0 : padX + stepX * hoverIdx;

  // Convert SVG-space x (0..600) into a percentage so the HTML tooltip
  // can sit on top of the SVG without depending on the chart's pixel width.
  const hoverPct = (hoverX / w) * 100;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerMove={onMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className={compact ? "h-20 w-full" : "h-32 w-full"}
        aria-label={ariaLabel}
      >
        {/* baseline grid at 25/50/75 % */}
        {[25, 50, 75].map((pct) => {
          const y = padY + ((max - pct) / max) * (h - padY * 2);
          return (
            <line
              key={pct}
              x1={padX}
              x2={w - padX}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="2 4"
            />
          );
        })}
        <path d={posPath} fill="none" stroke="#10b981" strokeWidth="2" />
        <path d={negPath} fill="none" stroke="#f43f5e" strokeWidth="2" />
        {points.map((p, i) => {
          const x = padX + stepX * i;
          const yPos = padY + ((max - p.posPct) / max) * (h - padY * 2);
          const yNeg = padY + ((max - p.negPct) / max) * (h - padY * 2);
          const active = i === hoverIdx;
          return (
            <g key={p.day}>
              <circle
                cx={x}
                cy={yPos}
                r={active ? 4 : 2.5}
                fill="#10b981"
              />
              <circle
                cx={x}
                cy={yNeg}
                r={active ? 4 : 2.5}
                fill="#f43f5e"
              />
            </g>
          );
        })}
        {hoverIdx != null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padY}
            y2={h - padY}
            stroke="#94a3b8"
            strokeDasharray="2 3"
          />
        )}
      </svg>

      {hovered && (
        <HoverTooltip
          point={hovered}
          xPct={hoverPct}
          legendPositive={legendPositive}
          legendNegative={legendNegative}
          tooltipClassifiedTpl={tooltipClassifiedTpl}
        />
      )}
    </div>
  );
}

function HoverTooltip({
  point,
  xPct,
  legendPositive,
  legendNegative,
  tooltipClassifiedTpl,
}: {
  point: SentimentTrendPoint;
  xPct: number;
  legendPositive: string;
  legendNegative: string;
  tooltipClassifiedTpl: string;
}) {
  // Flip the anchor when the hover is past the midpoint, so the tooltip
  // doesn't clip off the right edge of the card.
  const anchorRight = xPct > 65;
  const positionStyle: React.CSSProperties = anchorRight
    ? { right: `${100 - xPct}%` }
    : { left: `${xPct}%` };

  const dateLabel = new Date(point.day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const classified = tooltipClassifiedTpl.replace(
    "{n}",
    point.total.toLocaleString(),
  );

  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-y-1 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] leading-tight shadow-lg backdrop-blur"
      style={{
        ...positionStyle,
        transform: anchorRight
          ? "translate(0.5rem, -0.25rem)"
          : "translate(-50%, -0.25rem)",
      }}
    >
      <p className="font-semibold text-slate-900">{dateLabel}</p>
      <p className="mt-0.5 tabular-nums text-emerald-700">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
        {legendPositive}: {point.posPct.toFixed(0)}%
      </p>
      <p className="tabular-nums text-rose-700">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />
        {legendNegative}: {point.negPct.toFixed(0)}%
      </p>
      <p className="mt-0.5 text-slate-500">{classified}</p>
    </div>
  );
}
