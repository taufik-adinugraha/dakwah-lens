"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Line chart for the host-metrics dashboard.
 *
 * Drawn as SVG so we can keep it dependency-free and SSR-friendly,
 * but hover state lives in client React — pointing at any X position
 * shows a vertical guide line, a circle on the line, and a tooltip
 * with the timestamp + value.
 *
 * Y-axis: 5 tick labels (min, p25, mid, p75, max) drawn at the left.
 * X-axis: 4 time tick labels at the bottom (first, ~33%, ~66%, last).
 */
export function InfraChart({
  title,
  hint,
  points,
  suffix,
  accent,
  locale,
}: {
  title: string;
  hint?: string;
  points: Array<{ t: string; v: number }>;
  suffix: string;
  accent: "brand" | "emerald" | "amber";
  locale: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const { minV, maxV, w, h, pad, stepX, polyline, gridY } = useMemo(() => {
    const w = 600;
    const h = 200;
    const pad = { top: 12, right: 16, bottom: 28, left: 44 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const values = points.map((p) => p.v);
    const minV = values.length ? Math.min(...values) : 0;
    const maxV = values.length ? Math.max(...values, minV + 1) : 1;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const polyline = points
      .map((p, i) => {
        const x = pad.left + i * stepX;
        const y = pad.top + innerH - ((p.v - minV) / (maxV - minV || 1)) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    // 5 evenly-spaced Y ticks.
    const gridY = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
      y: pad.top + innerH - frac * innerH,
      value: minV + frac * (maxV - minV),
    }));
    return { minV, maxV, w, h, pad, stepX, polyline, gridY };
  }, [points]);

  const strokeClass = {
    brand: "stroke-brand-500 fill-brand-500",
    emerald: "stroke-emerald-500 fill-emerald-500",
    amber: "stroke-amber-500 fill-amber-500",
  }[accent];

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = w / rect.width;
    const xInSvg = (e.clientX - rect.left) * scaleX;
    const innerX = xInSvg - pad.left;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(innerX / stepX)));
    const p = points[idx]!;
    const px = pad.left + idx * stepX;
    const innerH = h - pad.top - pad.bottom;
    const py = pad.top + innerH - ((p.v - minV) / (maxV - minV || 1)) * innerH;
    setHover({ idx, x: px, y: py });
  };

  const last = points[points.length - 1]?.v ?? 0;
  const hoverPoint = hover ? points[hover.idx] : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs tabular-nums text-slate-500">
          {hint ?? `${last.toFixed(1)}${suffix}`}
        </span>
      </div>
      {points.length < 2 ? (
        <p className="py-8 text-center text-xs text-slate-500">
          Need ≥2 points to draw — wait a minute.
        </p>
      ) : (
        <div className="relative mt-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            className="block h-56 w-full"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Y grid lines + labels */}
            {gridY.map((g, i) => (
              <g key={i}>
                <line
                  x1={pad.left}
                  x2={w - pad.right}
                  y1={g.y}
                  y2={g.y}
                  className="stroke-slate-100"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 6}
                  y={g.y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] tabular-nums"
                >
                  {g.value.toFixed(g.value < 10 ? 1 : 0)}
                  {suffix}
                </text>
              </g>
            ))}

            {/* X axis time labels (4 ticks: 0, 33%, 66%, 100%) */}
            {[0, 0.33, 0.66, 1].map((frac, i) => {
              const idx = Math.round(frac * (points.length - 1));
              const p = points[idx]!;
              const innerW = w - pad.left - pad.right;
              const x = pad.left + frac * innerW;
              return (
                <text
                  key={i}
                  x={x}
                  y={h - 8}
                  textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"}
                  className="fill-slate-400 text-[10px]"
                >
                  {formatTime(p.t, locale, points)}
                </text>
              );
            })}

            {/* Line */}
            <polyline
              points={polyline}
              fill="none"
              strokeWidth={1.5}
              className={strokeClass}
            />

            {/* Hover marker */}
            {hover && (
              <>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={pad.top}
                  y2={h - pad.bottom}
                  className="stroke-slate-300"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={hover.x}
                  cy={hover.y}
                  r={4}
                  className={strokeClass}
                  strokeWidth={2}
                  fill="white"
                />
              </>
            )}
          </svg>

          {/* Tooltip (HTML overlay, positioned in % of viewBox so it scales) */}
          {hoverPoint && hover && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-md"
              style={{
                left: `${(hover.x / w) * 100}%`,
                top: `${(hover.y / h) * 100}%`,
                transform: "translate(-50%, calc(-100% - 8px))",
              }}
            >
              <p className="font-semibold text-slate-900 tabular-nums">
                {hoverPoint.v.toFixed(1)}{suffix}
              </p>
              <p className="text-[10px] text-slate-500">
                {formatTooltip(hoverPoint.t, locale)}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>
          min {minV.toFixed(1)}{suffix}
        </span>
        <span>
          max {maxV.toFixed(1)}{suffix}
        </span>
      </div>
    </div>
  );
}

function formatTime(
  iso: string,
  locale: string,
  points: Array<{ t: string }>,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const first = new Date(points[0]!.t);
  const last = new Date(points[points.length - 1]!.t);
  const spanMs = last.getTime() - first.getTime();
  const spanHours = spanMs / (1000 * 60 * 60);
  if (spanHours <= 36) {
    // 24h range — show HH:MM
    return d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  // 7d / 30d — show date
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatTooltip(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
