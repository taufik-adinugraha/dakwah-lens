"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

import { toggleBookmark } from "@/app/[locale]/saved/actions";

/**
 * Generic save-toggle pill. Used on /kitab citations, /briefs, and
 * social-post listings. The `payload` snapshot is what gets persisted
 * — so a saved kitab still renders nicely even if the corpus is
 * re-embedded or removed.
 *
 * Optimistically flips local state. On any error (auth lapse, network),
 * reverts. Anonymous users get bounced to /login by the action; we
 * surface that via a friendly toast-less catch.
 */
export function BookmarkButton({
  kind,
  refId,
  payload,
  initialSaved,
  signedIn,
}: {
  kind: "kitab" | "brief" | "post";
  refId: string;
  payload: Record<string, unknown>;
  initialSaved: boolean;
  signedIn: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!signedIn) {
      // Bounce to login with a return target — same UX as the rest of
      // the public-side gates.
      window.location.href =
        "/login?callbackUrl=" + encodeURIComponent(window.location.pathname);
      return;
    }
    const next = !saved;
    setSaved(next); // optimistic
    startTransition(async () => {
      try {
        const result = await toggleBookmark({ kind, ref_id: refId, payload });
        setSaved(result.saved);
      } catch {
        setSaved(!next); // revert
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove bookmark" : "Save"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
        saved
          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {saved ? (
        <BookmarkCheck className="h-3 w-3" />
      ) : (
        <Bookmark className="h-3 w-3" />
      )}
      {saved ? "Saved" : "Save"}
    </button>
  );
}
