"use client";

import { Clock, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_PREFIX = "dl_pending_dismissed:";

/** Subscribe to the `storage` event so dismissing in one tab also hides
 *  the banner in others. Idempotent — React will dedup. */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Client wrapper for the pending-approval banner. Visibility is driven by
 * a localStorage flag keyed on the user id — so an admin sign-in after a
 * member sign-out doesn't inherit the previous dismissal, and a fresh
 * browser still shows the banner once for each user.
 *
 * `useSyncExternalStore` is the idiomatic way to read mutable browser
 * state without tripping React 19's "no setState in effect" rule, and it
 * also avoids the hydration flash: server snapshot returns "show", the
 * client reconciles in the same render pass.
 */
export function PendingApprovalBannerClient({
  userId,
  title,
  body,
  closeLabel,
}: {
  userId: string;
  title: string;
  body: string;
  closeLabel: string;
}) {
  const storageKey = `${STORAGE_PREFIX}${userId}`;
  const getSnapshot = useCallback((): boolean => {
    try {
      return window.localStorage.getItem(storageKey) !== "1";
    } catch {
      // localStorage blocked (privacy mode, etc.) — show by default.
      return true;
    }
  }, [storageKey]);
  // Server render has no localStorage; default to "show" so SSR markup
  // matches the most common client outcome (first-time-seeing-it user).
  const visible = useSyncExternalStore(subscribe, getSnapshot, () => true);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, "1");
      // Manually dispatch so useSyncExternalStore re-reads in this tab.
      // (Native storage event only fires in OTHER tabs.)
      window.dispatchEvent(new Event("storage"));
    } catch {
      // best-effort — banner will reappear next page load
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative z-40 border-b border-amber-200 bg-amber-50 text-amber-900 print:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 sm:px-6">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1 text-pretty text-sm leading-relaxed">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-amber-800">{body}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={closeLabel}
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 hover:text-amber-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
