"use client";

import type { FormEvent } from "react";

/**
 * Form-based action button with a native `confirm()` guard. Wraps the
 * same `action={serverAction}` pattern the other admin buttons use,
 * but intercepts the submit on the client to show a confirmation
 * dialog first. Falls back to a normal submit if the user confirms;
 * cancels if they don't.
 *
 * Used for destructive admin actions like "Remove user" — the rest
 * of the admin buttons (approve / block / promote / etc.) don't need
 * a confirm because they're reversible. Removal is not, so we ask.
 */
export function ConfirmFormButton({
  action,
  userId,
  label,
  confirmMessage,
  tone,
}: {
  action: (formData: FormData) => Promise<void>;
  userId: string;
  label: string;
  confirmMessage: string;
  tone: "rose";
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // confirm() is the simplest possible UX for a rarely-used
    // destructive admin action — no need to pull in a modal library
    // for this one button.
    if (!window.confirm(confirmMessage)) {
      e.preventDefault();
    }
  }

  const cls =
    tone === "rose"
      ? "border-rose-300 bg-rose-100 text-rose-800 hover:bg-rose-200"
      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100";

  return (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold transition ${cls}`}
      >
        {label}
      </button>
    </form>
  );
}
