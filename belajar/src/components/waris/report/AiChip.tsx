import { Info } from "lucide-react";

/**
 * The waris status chip: "Dibantu AI · bukan fatwa" (operator decision 2026-10-09: no human
 * review, so the chip states what the material is instead of promising a review). A label, not a
 * control: icon + words, notice text on its own tint (5.91:1) with a solid notice border (≥3:1).
 * No hooks, so server pages (hub, track home) and the client report share it.
 */
export function AiChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-[1.5px] border-notice bg-notice-bg px-3 py-1 text-sm font-medium text-notice ${className ?? ""}`}
    >
      <Info className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
