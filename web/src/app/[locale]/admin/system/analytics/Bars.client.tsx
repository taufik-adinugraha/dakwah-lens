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
 * Hourly traffic bars (last 24 hours). One bar per hour bucket; bucket
 * timestamp is already converted to Asia/Jakarta on the server so the
 * label reads in WIB regardless of viewer's timezone. Empty buckets
 * (no traffic that hour) still render as a 0-height column so the
 * x-axis stays evenly spaced.
 */
export function HourlyBars({
  rows,
}: {
  rows: Array<{ hour: string; hits: number; uniques: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.hits), 1);

  return (
    <div className="flex h-40 items-stretch gap-[3px]">
      {rows.map((r, i) => {
        const pct = (r.hits / max) * 100;
        const upct = (r.uniques / max) * 100;
        // `hour` is "YYYY-MM-DD HH:00" in WIB — show the hour part as the
        // axis label, plus the day-roll marker every 6 hours so the
        // 24-bar strip stays scannable.
        const d = new Date(r.hour.replace(" ", "T") + "+07:00");
        const hh = d.toLocaleString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Jakarta",
        });
        const dayLabel = d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "Asia/Jakarta",
        });
        const showHourLabel = i % 4 === 0 || i === rows.length - 1;
        const isActive = active === i;
        return (
          <div
            key={r.hour}
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
            <p className="mt-1 text-[9px] text-slate-500">
              {showHourLabel ? hh : ""}
            </p>
            {isActive && (
              <ChartTooltip>
                <p className="font-semibold text-white">
                  {dayLabel} · {hh} WIB
                </p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-300" />{" "}
                  Views:{" "}
                  <span className="tabular-nums">
                    {r.hits.toLocaleString()}
                  </span>
                </p>
                <p>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-700" />{" "}
                  Unique:{" "}
                  <span className="tabular-nums">
                    {r.uniques.toLocaleString()}
                  </span>
                </p>
              </ChartTooltip>
            )}
          </div>
        );
      })}
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
