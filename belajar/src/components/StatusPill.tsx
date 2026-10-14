import { Check, Clock } from "lucide-react";
import type { ReactNode } from "react";

import { MixedText } from "@/components/library/MixedText";

/**
 * A status note on a hub card as a coloured pill (operator 2026-10-14: "write the subtitle/note
 * in colored pills"). Colour is never the only cue: a label pill carries its icon and its words
 * ("Tersedia sekarang", "Segera hadir"), the item pills the names. Both tones are the module's own
 * pair: `ok` the forest tint, `soon` the calm amber of the notices (the AI chip's). The text goes
 * through MixedText inside ONE span: in a flex pill each piece of it would otherwise be a flex item
 * of its own and lose its kept box (CI line breaks, 2026-10-14).
 */
export type PillTone = "ok" | "soon";

const TONE: Record<PillTone, string> = {
  ok: "border-forest bg-ok-bg text-forest",
  soon: "border-notice bg-notice-bg text-notice",
};

export function StatusPill({ tone, label = false, children }: { tone: PillTone; label?: boolean; children: string }) {
  const Icon = tone === "ok" ? Check : Clock;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full border-[1.5px] px-3 py-1 text-base ${
        label ? "font-semibold" : "font-medium"
      } ${TONE[tone]}`}
    >
      {label ? <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={3} /> : null}
      <span>
        <MixedText text={children} />
      </span>
    </span>
  );
}

/** A card's note: its label pill (when it has one) and then one pill per item, in a wrapping row. */
export function NoteRow({ tone, label, items }: { tone: PillTone; label?: string; items: readonly string[] }): ReactNode {
  return (
    <span data-note={tone} className="mt-3 flex flex-wrap items-center gap-2">
      {label ? (
        <StatusPill tone={tone} label>
          {label}
        </StatusPill>
      ) : null}
      {items.map((item) => (
        <StatusPill key={item} tone={tone}>
          {item}
        </StatusPill>
      ))}
    </span>
  );
}
