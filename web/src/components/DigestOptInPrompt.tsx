"use client";

import { useState, useTransition } from "react";
import { Mail, X } from "lucide-react";

import { setDigestOptIn } from "@/app/[locale]/digest/actions";

/**
 * Small inline prompt on /briefings — "Get this each Thursday in your
 * inbox?". Hidden once the user opts in or dismisses (localStorage).
 *
 * We only render this for signed-in users who haven't already opted in;
 * the parent decides whether to render at all.
 */
export function DigestOptInPrompt({
  title,
  body,
  yesLabel,
  noLabel,
}: {
  title: string;
  body: string;
  yesLabel: string;
  noLabel: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem("dl_digest_prompt_dismissed", "1");
    } catch {
      // Best-effort — fine if storage is unavailable.
    }
  }

  function optIn() {
    startTransition(async () => {
      try {
        await setDigestOptIn(true);
        setHidden(true);
      } catch {
        // Action failed — leave the prompt up so the user can retry.
      }
    });
  }

  if (hidden) return null;

  return (
    <div className="mx-auto mt-4 flex max-w-6xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:px-6">
      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-emerald-800">
          {body}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={optIn}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
          >
            {yesLabel}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            {noLabel}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
