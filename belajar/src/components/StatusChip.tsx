import { Hourglass } from "lucide-react";

/**
 * A status, not a control. Material still awaiting ustadz review gets the
 * draft look (icon + words, readable amber on its own tint, 5.91:1, dashed
 * edge); reviewed material in the beta gets a quiet forest pill.
 */
export function StatusChip({ label, draft }: { label: string; draft: boolean }) {
  return draft ? (
    <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-dashed border-notice bg-notice-bg px-3 py-1 text-sm font-medium text-notice">
      <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-forest-tint px-3 py-1 text-sm font-semibold text-forest">
      {label}
    </span>
  );
}
