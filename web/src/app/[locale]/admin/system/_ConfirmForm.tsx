"use client";

import type { FormEvent, ReactNode } from "react";

/**
 * Drop-in replacement for `<form action={serverAction}>` that pops a
 * native `window.confirm()` before the submit goes through. Used for
 * irreversible admin actions (deletes, dismissals) — keeps the JSX
 * inside identical to the non-guarded form so each caller just swaps
 * the wrapper tag.
 *
 * native confirm() is intentional: no modal library, no global state,
 * no extra bundle. The interruption is enough to prevent fat-finger
 * mistakes on rare destructive actions.
 */
export function ConfirmForm({
  action,
  confirmMessage,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!window.confirm(confirmMessage)) {
      e.preventDefault();
    }
  }
  return (
    <form action={action} onSubmit={onSubmit} className={className}>
      {children}
    </form>
  );
}
