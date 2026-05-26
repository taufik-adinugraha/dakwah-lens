"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Clock, Loader2 } from "lucide-react";

import type { DeployStatus } from "@/lib/deploy-status";

/**
 * Centered blocking overlay shown while a GitHub Actions deploy is
 * in flight. Polls /api/deploy-status on a smart cadence:
 *   - every 30s while idle (low cost, no rush)
 *   - every  5s while deploying (catch the finish quickly)
 *   - every 30s while failed (waiting for ops to clear / auto-clear)
 *
 * Behaviour:
 *   - During "deploying": full-viewport backdrop + centered modal,
 *     non-dismissible. Body scroll locked. All app interaction blocked.
 *   - During "failed": same overlay with rose accent + brief message;
 *     mounted client-side only, so SSR never paints it during a normal
 *     deploy.
 *   - During "idle": renders nothing.
 *
 * Persistence: there is NO close button on purpose. The overlay
 * disappears only when the webhook updates the DB to state="idle"
 * — i.e. when GitHub Actions reports the deploy succeeded — and the
 * next poll picks that up (≤5s lag).
 */
export function DeployOverlay({
  initialStatus,
}: {
  initialStatus: DeployStatus;
}) {
  const t = useTranslations("Deploy");
  const [status, setStatus] = useState<DeployStatus>(initialStatus);
  // Tick once per second so the elapsed-time chip updates live. Cheap
  // — a single setState per second only while the overlay is mounted,
  // i.e. only while a deploy is actually in flight.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (status.state === "idle") return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [status.state]);

  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch("/api/deploy-status", { cache: "no-store" });
        if (!r.ok) return;
        const next = (await r.json()) as DeployStatus;
        if (mounted) setStatus(next);
      } catch {
        // Network blip — silently keep current state. Next tick will retry.
      }
    };
    // Initial fetch after mount so SSR's snapshot doesn't lag behind a
    // deploy that started between RSC render and hydration.
    fetchStatus();
    const cadenceMs = status.state === "deploying" ? 5_000 : 30_000;
    const interval = window.setInterval(fetchStatus, cadenceMs);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [status.state]);

  // Body scroll lock while overlay is visible.
  useEffect(() => {
    if (status.state === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [status.state]);

  if (status.state === "idle") return null;

  const isFailed = status.state === "failed";
  const accent = isFailed
    ? "from-rose-500 to-rose-600"
    : "from-emerald-500 to-emerald-600";

  // Elapsed time since the deploy started. Skips render when
  // `startedAt` is missing or unparseable — same shape as the
  // commit-metadata block: only render when we have data.
  const startedMs = status.startedAt
    ? Date.parse(status.startedAt)
    : NaN;
  const elapsedSec = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((nowMs - startedMs) / 1000))
    : null;
  // mm:ss formatting reads cleanly in both Indonesian + English and
  // avoids "d" / "s" / "dtk" suffix ambiguity.
  const elapsedLabel =
    elapsedSec === null
      ? null
      : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      // pointer-events-auto on the overlay swallows clicks underneath.
      // z-50 keeps it above page chrome including the share/download
      // popovers (which use z-20-ish).
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-slate-200">
        {/* Top accent bar */}
        <div
          aria-hidden
          className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${accent}`}
        />

        {/* Icon */}
        <div className="flex justify-center">
          <span
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${accent} text-white shadow-md`}
          >
            {isFailed ? (
              <AlertCircle className="h-7 w-7" aria-hidden />
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
            )}
          </span>
        </div>

        {/* Title + body */}
        <h2 className="mt-5 text-balance text-center text-xl font-bold tracking-tight text-slate-900">
          {isFailed ? t("failed_title") : t("deploying_title")}
        </h2>
        <p className="mt-2 text-pretty text-center text-sm leading-relaxed text-slate-600">
          {isFailed ? t("failed_body") : t("deploying_body")}
        </p>

        {/* Live elapsed timer — ticks every second so the user can see
            progress at a glance. Only shown while deploy is in-flight
            and we know when it started. */}
        {!isFailed && elapsedLabel !== null && (
          <div className="mt-4 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tabular-nums text-emerald-800"
              aria-label={t("elapsed_label", { time: elapsedLabel })}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {t("elapsed_label", { time: elapsedLabel })}
            </span>
          </div>
        )}

        {/* Commit metadata (if provided) — small, muted; only render
            during in-flight deploy so the failure case stays terse. */}
        {!isFailed && (status.commitMessage || status.commitSha) && (
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
            {status.commitMessage && (
              <p className="line-clamp-2 text-xs font-medium text-slate-800">
                {status.commitMessage}
              </p>
            )}
            {status.commitSha && (
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {status.commitSha.slice(0, 8)}
              </p>
            )}
          </div>
        )}

        {/* Footnote — sets expectations: typically 2-3 min. */}
        <p className="mt-4 text-center text-xs text-slate-400">
          {t("auto_refresh_note")}
        </p>
      </div>
    </div>
  );
}
