import type { CaseState } from "@/content/schema";
import { CASE_META } from "@/lib/cases";

/** Case shown with colour AND a shape glyph (never colour alone). */
export function CaseBadge({ state, sign }: { state: CaseState; sign?: string }) {
  const m = CASE_META[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${m.className}`}
    >
      <span aria-hidden>{m.shape}</span>
      {m.label}
      {sign && sign !== "—" ? <span className="font-normal">· {sign}</span> : null}
    </span>
  );
}
