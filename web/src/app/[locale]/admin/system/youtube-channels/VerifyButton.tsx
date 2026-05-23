"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";

import {
  verifyYoutubeChannel,
  type VerifyYoutubeChannelResult,
} from "../actions";

/**
 * Per-channel "Verify" button.
 *
 * Calls the verifyYoutubeChannel server action which hits YouTube's
 * channels.list endpoint (1 quota) and flips the row's `verified`
 * flag based on the outcome. On return, displays a brief inline
 * result so the admin can spot wrong-channel matches (the YT-reported
 * title shown alongside the curated DB name).
 */
export function VerifyButton({
  id,
  initialVerified,
  curatedName,
}: {
  id: string;
  initialVerified: boolean;
  curatedName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VerifyYoutubeChannelResult | null>(null);
  // Local mirror of the server-side verified state so we re-render
  // immediately after action returns, without waiting for revalidatePath
  // to ferry the new value back through the layout.
  const [verified, setVerified] = useState(initialVerified);

  function onClick() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      try {
        const r = await verifyYoutubeChannel(fd);
        setResult(r);
        if (r.verifiedNow === true) setVerified(true);
        if (r.verifiedNow === false) setVerified(false);
      } catch (e) {
        setResult({
          channelId: id,
          title: null,
          outcome: "api_error",
          subscriberCount: null,
          videoCount: null,
          customUrl: null,
          detail: e instanceof Error ? e.message : "verify_failed",
          curatedName,
          verifiedNow: null,
        });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Re-check this channel against the YouTube API"
        className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-semibold transition ${
          verified
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-amber-50 text-amber-700 hover:bg-amber-100"
        } disabled:cursor-wait disabled:opacity-60`}
      >
        {pending ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Verifying…
          </>
        ) : verified ? (
          <>
            <ShieldCheck className="h-3 w-3" />
            Verified
          </>
        ) : (
          <>
            <ShieldAlert className="h-3 w-3" />
            Verify
          </>
        )}
      </button>
      {result && <VerifyResultLine result={result} curatedName={curatedName} />}
    </div>
  );
}

function VerifyResultLine({
  result,
  curatedName,
}: {
  result: VerifyYoutubeChannelResult;
  curatedName: string;
}) {
  const titleMatches =
    result.title &&
    curatedName.toLowerCase().includes(result.title.toLowerCase().slice(0, 8));

  if (result.outcome === "ok") {
    return (
      <div className="max-w-[220px] text-right text-[10px] leading-tight">
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
          <CheckCircle2 className="h-2.5 w-2.5" />
          {result.title ?? "ok"}
        </span>
        {!titleMatches && (
          <p className="mt-0.5 text-amber-700">
            ⚠ YT title doesn&apos;t look like the curated name — double-check
          </p>
        )}
        {result.subscriberCount != null && (
          <p className="mt-0.5 text-slate-500 tabular-nums">
            {result.subscriberCount.toLocaleString()} subs ·{" "}
            {result.videoCount?.toLocaleString() ?? "?"} vids
          </p>
        )}
      </div>
    );
  }

  if (result.outcome === "private") {
    return (
      <p className="max-w-[220px] text-right text-[10px] leading-tight text-amber-700">
        Channel is private / restricted — unverified
      </p>
    );
  }

  if (result.outcome === "not_found" || result.outcome === "deleted") {
    return (
      <p className="max-w-[220px] text-right text-[10px] leading-tight text-rose-700">
        Channel not found on YT — unverified
      </p>
    );
  }

  return (
    <p className="max-w-[220px] text-right text-[10px] leading-tight text-slate-500">
      API error: {result.detail ?? "unknown"}
    </p>
  );
}
