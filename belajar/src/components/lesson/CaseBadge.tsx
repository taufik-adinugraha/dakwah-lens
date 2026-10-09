import type { CaseState } from "@/content/schema";
import { CASE_META } from "@/lib/cases";

/**
 * The case's gesture shape as an SVG at 1em, filled with the case colour
 * (shape vs its chip tint is 4.17–7.20:1). A Unicode glyph at chip size was
 * ~8px tall, so ▲ and ▼ differed only by orientation; a drawn shape stays
 * legible at every text size. Decorative: the label beside it carries the
 * meaning, so it is hidden from assistive tech.
 */
export function CaseShape({ state, className }: { state: CaseState; className?: string }) {
  const color = CASE_META[state].color;
  const cls = `inline-block h-[1em] w-[1em] shrink-0 ${className ?? ""}`;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cls}>
      {state === "marfu" && <polygon points="8,1.5 15,14 1,14" style={{ fill: color }} />}
      {state === "manshub" && <polygon points="8,0.5 15.5,8 8,15.5 0.5,8" style={{ fill: color }} />}
      {state === "majrur" && <polygon points="1,2 15,2 8,14.5" style={{ fill: color }} />}
      {state === "majzum" && <circle cx="8" cy="8" r="6.5" style={{ fill: color }} />}
      {state === "mabni" && <rect x="1.75" y="1.75" width="12.5" height="12.5" style={{ fill: color }} />}
      {state === "none" && (
        <circle cx="8" cy="8" r="5.75" style={{ fill: "none", stroke: color, strokeWidth: 1.5 }} />
      )}
    </svg>
  );
}

/**
 * Case chip: case-colour tint, ink label, 1.5px case-colour border, shape
 * then label then sign — never colour alone (WCAG 1.4.1).
 */
export function CaseBadge({ state, sign }: { state: CaseState; sign?: string }) {
  const m = CASE_META[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-[1.5px] px-3 py-1 text-sm font-semibold ${m.className}`}
    >
      <CaseShape state={state} />
      {m.label}
      {sign && sign !== "—" ? <span className="font-normal">· {sign}</span> : null}
    </span>
  );
}
