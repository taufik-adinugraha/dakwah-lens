"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import type { Flash } from "@/lib/flash";

/**
 * One-shot toast notification rendered above the page chrome.
 *
 * The server reads the flash cookie via `popFlash()` in the locale
 * layout and passes the result here. We mount unconditionally (so the
 * component can react to a new flash on subsequent navigations) and
 * use a `serial` key derived from the message to retrigger the show
 * animation when the same toast fires twice in a row.
 *
 * Auto-dismisses after 5 seconds. A manual close (X button) dismisses
 * immediately. After dismissal the DOM stays mounted but invisible so
 * the next flash slides in cleanly.
 */
export function FlashToast({ initial }: { initial: Flash | null }) {
  const [flash, setFlash] = useState<Flash | null>(initial);
  const [visible, setVisible] = useState<boolean>(Boolean(initial));
  // `serial` increments whenever we receive a new flash from the server,
  // even if the message text is identical to the previous one. Without
  // it React would diff "same flash, no change" and skip the re-show
  // animation on a repeated action.
  const [serial, setSerial] = useState(0);

  // Sync server-provided flash → local state when it changes between
  // renders. The layout passes a fresh value after every navigation.
  useEffect(() => {
    if (initial) {
      setFlash(initial);
      setVisible(true);
      setSerial((s) => s + 1);
    }
  }, [initial]);

  // Auto-dismiss timer. Reset whenever `serial` ticks so a fresh flash
  // gets its full 5-second budget even if the previous one was halfway
  // through dismissal.
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(id);
  }, [serial, visible]);

  if (!flash) return null;

  const Icon =
    flash.kind === "success"
      ? CheckCircle2
      : flash.kind === "error"
        ? AlertCircle
        : Info;

  const toneClass =
    flash.kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : flash.kind === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-white text-slate-900";

  const iconClass =
    flash.kind === "success"
      ? "text-emerald-600"
      : flash.kind === "error"
        ? "text-rose-600"
        : "text-slate-500";

  return (
    <div
      // `aria-live=polite` so screen readers announce on appear without
      // interrupting current speech.
      aria-live="polite"
      role="status"
      className={
        "pointer-events-none fixed bottom-4 right-4 z-[70] transition-all duration-200 sm:bottom-6 sm:right-6 " +
        (visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0")
      }
    >
      <div
        className={
          "pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg " +
          toneClass
        }
      >
        <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + iconClass} />
        <p className="flex-1 text-sm font-medium leading-snug">
          {flash.message}
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-900/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
