"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import {
  verifyAllYoutubeChannels,
  type VerifyAllYoutubeChannelsResult,
} from "../actions";

/**
 * "Verify All" bulk button + result summary.
 *
 * One click → server iterates every channel + hits YouTube channels.list
 * for each (~80 quota total for the current whitelist). On return, shows
 * a compact tally + lets admin scroll the per-row results inline. Page
 * is revalidated so the per-row badges update.
 */
export function VerifyAllBar({ totalChannels }: { totalChannels: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerifyAllYoutubeChannelsResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (
      !window.confirm(
        `Verify all ${totalChannels} channels? Costs ~${totalChannels} YouTube API quota units and takes ~15-30s.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await verifyAllYoutubeChannels();
        setResult(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "verify_all_failed");
      }
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Verify all channels against YouTube
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Only verified channels enter the ingest pipeline. Re-run after
          seeding or whenever channels migrate / get suspended.
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verifying {totalChannels}…
          </>
        ) : (
          <>
            <ShieldCheck className="h-3.5 w-3.5" />
            Verify all
          </>
        )}
      </button>

      {result && (
        <div className="w-full text-xs sm:w-auto">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {result.ok} ok
            </span>
            {result.private_ > 0 && (
              <span className="text-amber-700">{result.private_} private</span>
            )}
            {result.not_found > 0 && (
              <span className="text-rose-700">
                {result.not_found} not found
              </span>
            )}
            {result.api_error > 0 && (
              <span className="text-slate-500">
                {result.api_error} api error
              </span>
            )}
            <span className="text-slate-400">/ {result.total} total</span>
          </p>
        </div>
      )}
      {error && (
        <p className="text-xs text-rose-700">
          Verify-all failed: {error}
        </p>
      )}
    </div>
  );
}
