"use client";

import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

/** Frame for one exercise: title, instruction, a calm "done" state. No
 *  hearts, timers, or sound effects (plan §4.7). */
export function ExerciseShell({
  title,
  instruction,
  done,
  doneLabel,
  children,
}: {
  title: string;
  instruction: string;
  done: boolean;
  doneLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-medium">{title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{instruction}</p>
        </div>
        {done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-forest-tint px-2.5 py-1 text-xs font-semibold text-forest">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {doneLabel}
          </span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Feedback line that always NAMES THE RULE, not just right/wrong (retrieval
 *  with explanatory feedback ≈ 2× the effect of bare retrieval). */
export function Feedback({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`mt-3 rounded-xl px-3 py-2 text-sm leading-relaxed ${
        ok ? "bg-forest-tint text-forest" : "bg-paper-deep text-ink"
      }`}
    >
      {children}
    </p>
  );
}
