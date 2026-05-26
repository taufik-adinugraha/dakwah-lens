"use client";

import { useEffect, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

import { toggleBookmark } from "@/app/[locale]/saved/actions";

/**
 * Generic save-toggle pill. Used on /kitab citations, /briefs, and
 * social-post listings. The `payload` snapshot is what gets persisted
 * — so a saved kitab still renders nicely even if the corpus is
 * re-embedded or removed.
 *
 * Optimistically flips local state. On any error (auth lapse, network),
 * reverts AND surfaces a small inline error so the user knows the save
 * didn't land (previously the failure was silent — the optimistic
 * revert flipped the icon back and the user had no idea why).
 *
 * Anonymous users get bounced to /login with a `?reason=bookmark` query
 * param so the login page can show a context line explaining the redirect.
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
  const [errored, setErrored] = useState(false);

  // Auto-dismiss the error after a couple seconds — same idea as the
  // "copied" flash on the share menu. Long enough for the user to
  // notice; short enough not to clutter the page.
  useEffect(() => {
    if (!errored) return;
    const t = setTimeout(() => setErrored(false), 3000);
    return () => clearTimeout(t);
  }, [errored]);

  function onClick() {
    if (!signedIn) {
      // Bounce to login with a return target + a reason hint so the
      // login page can explain why the user got redirected.
      window.location.href =
        "/login?reason=bookmark&callbackUrl=" +
        encodeURIComponent(window.location.pathname);
      return;
    }
    const next = !saved;
    setSaved(next); // optimistic
    setErrored(false);
    startTransition(async () => {
      try {
        const result = await toggleBookmark({ kind, ref_id: refId, payload });
        setSaved(result.saved);
      } catch {
        setSaved(!next); // revert
        setErrored(true);
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? "Remove bookmark" : "Save"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
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
      {errored && (
        <span
          role="status"
          aria-live="polite"
          className="text-[10px] font-medium text-rose-600"
        >
          Couldn&apos;t save — try again
        </span>
      )}
    </div>
  );
}
