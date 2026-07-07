"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";

import type { SentimentByPlatformRow } from "@/lib/dashboard-metrics";

export type SentimentByPlatformLabels = {
  cta: string;
  dialogTitle: string;
  dialogSubtitle: string;
  closeLabel: string;
  positive: string;
  neutral: string;
  negative: string;
  noData: string;
  platformMainstream: string;
};

export function SentimentByPlatformDialog({
  rows,
  labels,
}: {
  rows: SentimentByPlatformRow[];
  labels: SentimentByPlatformLabels;
}) {
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:border-hairline hover:bg-paper-deep"
      >
        {labels.cta}
        <ArrowUpRight className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sentiment-by-platform-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-hairline bg-white/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <h3
                  id="sentiment-by-platform-title"
                  className="text-balance text-lg font-bold text-ink sm:text-xl"
                >
                  {labels.dialogTitle}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  {labels.dialogSubtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={labels.closeLabel}
                className="rounded-full p-1.5 text-ink-faint transition hover:bg-paper-deep hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ul className="space-y-4 px-6 py-5">
              {rows.map((row) => (
                <PlatformRow key={row.platform} row={row} labels={labels} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function PlatformRow({
  row,
  labels,
}: {
  row: SentimentByPlatformRow;
  labels: SentimentByPlatformLabels;
}) {
  const displayName =
    row.platform === "mainstream" ? labels.platformMainstream : row.platform;

  return (
    <li className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold capitalize text-ink">
          {displayName}
        </p>
        <p className="text-xs tabular-nums text-ink-faint">
          {row.total.toLocaleString()}
        </p>
      </div>

      {row.total === 0 ? (
        <p className="mt-3 text-xs text-ink-faint">{labels.noData}</p>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-paper-deep">
            <div
              className="h-full bg-rose-500"
              style={{ width: `${row.negative.pct}%` }}
              title={`${labels.negative} ${row.negative.pct.toFixed(0)}%`}
            />
            <div
              className="h-full bg-slate-300"
              style={{ width: `${row.neutral.pct}%` }}
              title={`${labels.neutral} ${row.neutral.pct.toFixed(0)}%`}
            />
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${row.positive.pct}%` }}
              title={`${labels.positive} ${row.positive.pct.toFixed(0)}%`}
            />
          </div>
          <ul className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
            <PlatformStat
              dot="bg-emerald-500"
              label={labels.positive}
              count={row.positive.count}
              pct={row.positive.pct}
            />
            <PlatformStat
              dot="bg-slate-400"
              label={labels.neutral}
              count={row.neutral.count}
              pct={row.neutral.pct}
            />
            <PlatformStat
              dot="bg-rose-500"
              label={labels.negative}
              count={row.negative.count}
              pct={row.negative.pct}
            />
          </ul>
        </>
      )}
    </li>
  );
}

function PlatformStat({
  dot,
  label,
  count,
  pct,
}: {
  dot: string;
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <li className="rounded-lg bg-paper-deep px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-ink-muted">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-[10px] font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-0.5 tabular-nums text-ink">
        {count.toLocaleString()}
        <span className="ml-1 text-ink-faint">· {pct.toFixed(0)}%</span>
      </p>
    </li>
  );
}
