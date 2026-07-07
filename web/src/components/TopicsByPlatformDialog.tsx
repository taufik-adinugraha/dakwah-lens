"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";

import type { TopicByPlatformGroup } from "@/lib/dashboard-metrics";

export type TopicsByPlatformLabels = {
  cta: string;
  dialogTitle: string;
  dialogSubtitle: string;
  closeLabel: string;
  noData: string;
  platformMainstream: string;
};

export function TopicsByPlatformDialog({
  groups,
  labels,
}: {
  groups: TopicByPlatformGroup[];
  labels: TopicsByPlatformLabels;
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
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:border-hairline hover:bg-paper-deep"
      >
        {labels.cta}
        <ArrowUpRight className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="topics-by-platform-title"
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
                  id="topics-by-platform-title"
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
              {groups.map((g) => (
                <PlatformGroup key={g.platform} group={g} labels={labels} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function PlatformGroup({
  group,
  labels,
}: {
  group: TopicByPlatformGroup;
  labels: TopicsByPlatformLabels;
}) {
  const displayName =
    group.platform === "mainstream"
      ? labels.platformMainstream
      : group.platform;
  const totalPosts = group.topics.reduce((s, t) => s + t.count, 0);

  return (
    <li className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold capitalize text-ink">
          {displayName}
        </p>
        {totalPosts > 0 && (
          <p className="text-xs tabular-nums text-ink-faint">
            {totalPosts.toLocaleString()}
          </p>
        )}
      </div>

      {group.topics.length === 0 ? (
        <p className="mt-3 text-xs text-ink-faint">{labels.noData}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {group.topics.map((t) => (
            <li key={t.id}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-ink-muted">
                  {t.label}
                </span>
                <span className="shrink-0 tabular-nums text-ink-faint">
                  {t.count}
                  <span className="ml-1 text-ink-faint">
                    · {t.pct.toFixed(0)}%
                  </span>
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-paper-deep">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(t.pct, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
