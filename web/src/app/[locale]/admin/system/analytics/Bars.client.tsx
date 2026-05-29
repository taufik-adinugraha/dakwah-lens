"use client";

import { useState } from "react";

/**
 * Daily-traffic + briefs-per-day bar charts with hover tooltips.
 *
 * Layout note (matches the prior server-rendered version): outer flex
 * is `h-40 items-stretch` so each column receives the full row height.
 * Each column has `relative` so the absolute tooltip anchors above its
 * own bar. Active state is per-chart so two charts on the page can each
 * show their own tooltip independently.
 *
 * Tooltip placement: above the bar by default, flips below when the
 * active column is in the top portion of the chart (so the popover
 * doesn't hide the bar itself on shorter columns).
 */
export function DailyBars({
  rows,
}: {
  rows: Array<{ day: string; hits: number; uniques: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.hits), 1);

  return (
    <div className="flex h-40 items-stretch gap-1.5">
      {rows.map((r, i) => {
        const pct = (r.hits / max) * 100;
        const upct = (r.uniques / max) * 100;
        const day = new Date(r.day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const isActive = active === i;
        return (
          <div
            key={r.day}
            className="relative flex flex-1 flex-col items-center"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
          >
            <div className="flex w-full flex-1 flex-col-reverse">
              <div
                className={`w-full rounded-sm transition-colors ${isActive ? "bg-brand-300" : "bg-brand-200"}`}
                style={{ height: `${pct}%` }}
              />
              <div
                className={`-mb-px w-full rounded-sm opacity-90 transition-colors ${isActive ? "bg-brand-700" : "bg-brand-600"}`}
                style={{ height: `${upct}%` }}
              />
            </div>
            <p className="mt-1 text-[9px] text-slate-500">{day}</p>
            {isActive && (
              <ChartTooltip>
                <p className="font-semibold text-white">{day}</p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-300" />{" "}
                  Views: <span className="tabular-nums">{r.hits.toLocaleString()}</span>
                </p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-700" />{" "}
                  Unique: <span className="tabular-nums">{r.uniques.toLocaleString()}</span>
                </p>
              </ChartTooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Hourly traffic line chart (last 24 hours). Two SVG polylines with
 * a circle at each data point — one for views (brand-300), one for
 * uniques (brand-700). Replaced the prior vertical-bar version
 * (2026-05-24) because a line chart reads as a continuous trend
 * across the 24h window, where bars made every empty bucket visually
 * heavy. Hover hit area is a full-height invisible column per data
 * point so the tooltip stays easy to trigger.
 *
 * `hour` arrives as "YYYY-MM-DD HH:00" in WIB; we render the HH:00
 * label every 4 buckets so the x-axis stays scannable.
 *
 * 2026-05-29: the data-point dots used to be drawn INSIDE the
 * `preserveAspectRatio="none"` SVG, which stretched them horizontally
 * into flat ovals (the chart's aspect ratio is ~10:1). Dots are now
 * rendered as absolutely-positioned CSS spans in a sibling overlay,
 * so they stay perfectly round regardless of container width.
 * Legend added at the same time.
 */
export function HourlyBars({
  rows,
}: {
  rows: Array<{ hour: string; hits: number; uniques: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => Math.max(r.hits, r.uniques)), 1);

  // SVG viewBox: 100 units wide × 100 units tall. The actual visual
  // size comes from the parent's `h-40` (~160px) plus 100% width;
  // SVG `preserveAspectRatio="none"` lets the chart stretch to fill.
  const n = rows.length;
  const xAt = (i: number) =>
    n <= 1 ? 50 : (i / (n - 1)) * 100;
  const yAt = (v: number) => 100 - (v / max) * 100;

  // Build the polyline `points` strings once per metric — avoids
  // joining 24 strings inside the JSX.
  const hitsPoints = rows
    .map((r, i) => `${xAt(i).toFixed(2)},${yAt(r.hits).toFixed(2)}`)
    .join(" ");
  const uniquesPoints = rows
    .map((r, i) => `${xAt(i).toFixed(2)},${yAt(r.uniques).toFixed(2)}`)
    .join(" ");

  // x-axis labels — every 4 buckets + the last one.
  const labelIdx = rows.flatMap((_r, i) =>
    i % 4 === 0 || i === n - 1 ? [i] : [],
  );

  return (
    <div className="relative">
      {/* Legend — color swatch + label + one-line definition so a
          first-time reader knows what each metric means. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600"
        aria-hidden
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-300" />
          <span className="font-semibold text-slate-800">Views</span>
          <span className="text-slate-500">total page-loads (reloads count)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-700" />
          <span className="font-semibold text-slate-800">Uniques</span>
          <span className="text-slate-500">distinct anonymous sessions</span>
        </span>
      </div>

      {/* Chart surface — fixed height, polylines stretch to fill,
          dot overlay sits on top of the SVG in CSS-pixel space so the
          dots stay round. */}
      <div className="relative h-40 w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-label="Hourly traffic — last 24 hours"
        >
          {/* Faint horizontal gridlines at 25 / 50 / 75 %. */}
          {[25, 50, 75].map((y) => (
            <line
              key={y}
              x1={0}
              x2={100}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={0.15}
              className="text-slate-200"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Views line (brand-300) */}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            className="text-brand-300"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            points={hitsPoints}
          />
          {/* Uniques line (brand-700) */}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            className="text-brand-700"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            points={uniquesPoints}
          />

          {/* Invisible hover columns — full-height slices wider than
              the gap between points so the cursor doesn't have to
              land on the dot itself. */}
          {rows.map((r, i) => {
            const x = xAt(i);
            return (
              <rect
                key={`hit-${r.hour}`}
                x={x - 50 / Math.max(n - 1, 1)}
                y={0}
                width={100 / Math.max(n - 1, 1)}
                height={100}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() =>
                  setActive((cur) => (cur === i ? null : cur))
                }
              />
            );
          })}
        </svg>

        {/* Round dot overlay — CSS-positioned absolutes so they don't
            inherit the SVG's non-uniform aspect-ratio scaling. */}
        <div className="pointer-events-none absolute inset-0">
          {rows.map((r, i) => {
            const isActive = active === i;
            const sizeCls = isActive ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
            return (
              <span key={r.hour}>
                <span
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-300 ring-2 ring-white transition-[width,height] ${sizeCls}`}
                  style={{ left: `${xAt(i)}%`, top: `${yAt(r.hits)}%` }}
                />
                <span
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-700 ring-2 ring-white transition-[width,height] ${sizeCls}`}
                  style={{ left: `${xAt(i)}%`, top: `${yAt(r.uniques)}%` }}
                />
              </span>
            );
          })}
        </div>
      </div>

      {/* x-axis labels — laid out as an absolutely-positioned strip
          so percentages match the SVG x-coordinates exactly. */}
      <div className="relative mt-1 h-3">
        {labelIdx.map((i) => {
          const d = new Date(rows[i].hour.replace(" ", "T") + "+07:00");
          const hh = d.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Jakarta",
          });
          return (
            <p
              key={rows[i].hour}
              className="absolute -translate-x-1/2 text-[9px] text-slate-500"
              style={{ left: `${xAt(i)}%` }}
            >
              {hh}
            </p>
          );
        })}
      </div>

      {/* Tooltip — rendered outside the SVG so it can use the rich
          ChartTooltip popover (which positions itself relative to a
          % offset). */}
      {active !== null && (
        <div
          className="pointer-events-none absolute -top-2 left-0 right-0 h-full"
          aria-hidden
        >
          <div
            className="absolute -top-2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-snug text-slate-200 shadow-lg ring-1 ring-slate-800"
            style={{ left: `${xAt(active)}%` }}
          >
            <div className="space-y-0.5">
              <p className="font-semibold text-white">
                {new Date(
                  rows[active].hour.replace(" ", "T") + "+07:00",
                ).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "Asia/Jakarta",
                })}{" "}
                WIB
              </p>
              <p>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-300" />{" "}
                Views:{" "}
                <span className="tabular-nums">
                  {rows[active].hits.toLocaleString()}
                </span>
              </p>
              <p>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-700" />{" "}
                Unique:{" "}
                <span className="tabular-nums">
                  {rows[active].uniques.toLocaleString()}
                </span>
              </p>
            </div>
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
          </div>
        </div>
      )}
    </div>
  );
}

export function BriefBars({
  rows,
}: {
  rows: Array<{ day: string; briefs: number; creators: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.briefs), 1);

  return (
    <div className="flex h-40 items-stretch gap-1.5">
      {rows.map((r, i) => {
        const pct = (r.briefs / max) * 100;
        const cpct = (r.creators / max) * 100;
        const day = new Date(r.day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const isActive = active === i;
        return (
          <div
            key={r.day}
            className="relative flex flex-1 flex-col items-center"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
          >
            <div className="flex w-full flex-1 flex-col-reverse">
              <div
                className={`w-full rounded-sm transition-colors ${isActive ? "bg-emerald-300" : "bg-emerald-200"}`}
                style={{ height: `${pct}%` }}
              />
              <div
                className={`-mb-px w-full rounded-sm opacity-90 transition-colors ${isActive ? "bg-emerald-700" : "bg-emerald-600"}`}
                style={{ height: `${cpct}%` }}
              />
            </div>
            <p className="mt-1 text-[9px] text-slate-500">{day}</p>
            {isActive && (
              <ChartTooltip>
                <p className="font-semibold text-white">{day}</p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />{" "}
                  Briefs: <span className="tabular-nums">{r.briefs.toLocaleString()}</span>
                </p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-700" />{" "}
                  Creators: <span className="tabular-nums">{r.creators.toLocaleString()}</span>
                </p>
              </ChartTooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Floating tooltip card. Positioned just above the column with a small
 * pointer triangle below. `pointer-events-none` so the cursor moving
 * over the tooltip doesn't accidentally leave the column and dismiss.
 *
 * When `leftPct` is provided, the tooltip positions itself horizontally
 * by percentage instead of `left-1/2`. Used by `StackedBar` to anchor
 * over the active segment's center.
 */
function ChartTooltip({
  children,
  leftPct,
}: {
  children: React.ReactNode;
  leftPct?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-snug text-slate-200 shadow-lg ring-1 ring-slate-800"
      style={{ left: leftPct !== undefined ? `${leftPct}%` : "50%" }}
    >
      <div className="space-y-0.5">{children}</div>
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
    </div>
  );
}

/**
 * Horizontal stacked-bar with one tooltip per segment. Used for the
 * region + locale traffic splits.
 *
 * Why two divs: the bar itself stays `overflow-hidden` for the rounded
 * corners; the tooltip sits in a sibling layer with full overflow so
 * its popover can extend above the 12px-tall bar without being clipped.
 * The active segment's center is precomputed from cumulative widths so
 * the tooltip arrow points at the right place regardless of segment
 * order or size.
 */
/**
 * Pure helper — kept OUTSIDE the React component so the `cumulative +=`
 * prefix-sum doesn't trip the react-hooks/immutability lint rule (which
 * forbids reassigning a closed-over variable inside a `.map()` callback
 * at the component top level).
 */
function positionSegments(
  segments: Array<{ key: string; label: string; color: string; value: number }>,
  total: number,
): Array<{
  key: string;
  label: string;
  color: string;
  value: number;
  pct: number;
  center: number;
}> {
  const out: Array<{
    key: string;
    label: string;
    color: string;
    value: number;
    pct: number;
    center: number;
  }> = [];
  let cumulative = 0;
  for (const s of segments) {
    const pct = total > 0 ? (s.value / total) * 100 : 0;
    const center = cumulative + pct / 2;
    cumulative += pct;
    out.push({ ...s, pct, center });
  }
  return out;
}

export function StackedBar({
  segments,
  total,
  formatValue = (v) => v.toLocaleString(),
}: {
  segments: Array<{ key: string; label: string; color: string; value: number }>;
  total: number;
  formatValue?: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);

  // Precompute the horizontal-center position of each segment so the
  // tooltip arrow lines up with where the cursor is, not where the
  // segment's box-origin happens to land.
  const positioned = positionSegments(segments, total);

  return (
    <div className="relative">
      <div className="flex h-3 overflow-hidden rounded-full">
        {positioned.map((s, i) => (
          <span
            key={s.key}
            className={`${s.color} ${active === i ? "brightness-90" : ""} transition-[filter]`}
            style={{ width: `${s.pct}%` }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() =>
              setActive((cur) => (cur === i ? null : cur))
            }
          />
        ))}
      </div>
      {active !== null && (
        <ChartTooltip leftPct={positioned[active].center}>
          <p className="font-semibold text-white">
            {positioned[active].label}
          </p>
          <p className="tabular-nums">
            {formatValue(positioned[active].value)}{" "}
            <span className="text-slate-400">
              · {positioned[active].pct.toFixed(1)}%
            </span>
          </p>
        </ChartTooltip>
      )}
    </div>
  );
}
