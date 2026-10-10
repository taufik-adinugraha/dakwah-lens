import { Info } from "lucide-react";

import { MixedText } from "./library/MixedText";

/**
 * A status, not a control. AI-prepared material gets the notice look
 * (icon + words, readable amber on its own tint, 5.91:1, dashed edge); there
 * is no human review step (operator, 2026-10-09). The label's " · " never
 * starts a line (MixedText, in one span: the chip is a flex row).
 */
export function StatusChip({ label, draft }: { label: string; draft: boolean }) {
  return draft ? (
    <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-dashed border-notice bg-notice-bg px-3 py-1 text-sm font-medium text-notice">
      <Info className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <MixedText text={label} />
      </span>
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-forest-tint px-3 py-1 text-sm font-semibold text-forest">
      <span>
        <MixedText text={label} />
      </span>
    </span>
  );
}
