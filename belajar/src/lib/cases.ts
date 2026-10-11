import type { CaseState } from "@/content/schema";

export type CaseMeta = {
  /** Learner-facing name of the state (transliterated term). Its Arabic is the verified term
   *  table's (content/quiz `states`, "majrur (مَجْرُور)"), never typed here (the unvocalised copy
   *  this record once held was removed, quiz audit 2026-10-11). */
  label: string;
  /** Unicode fallback of the shape (plain-text contexts); the UI draws
   *  `CaseShape` (an SVG) instead, so ▲ and ▼ stay distinct at any size. */
  shape: string;
  /** Chip styling: case-colour tint background, INK text, case-colour border
   *  and ring colour. Consumers add the width (`border-[1.5px]`, `border-2`
   *  or `ring-*`), so one token set serves chips and Sortir bins alike. */
  className: string;
  /** The case colour as a CSS value, for SVG fills and inline styles. */
  color: string;
};

/**
 * Case display (plan §4.1; senior-ux §3.2): colour AND shape AND a text
 * label, so the meaning never rests on colour alone. The colour is graphic
 * only (shape fill + border); the label text is always ink, which keeps it
 * at 13.9–14.9:1 whatever the case. Shapes follow the gesture metaphor the
 * lessons teach: raf' rises (▲), nashb stands level (◆), jarr goes down (▼),
 * jazm is cut short (●), mabni is fixed (■).
 */
export const CASE_META: Record<CaseState, CaseMeta> = {
  marfu: {
    label: "marfū'",
    shape: "▲",
    className: "bg-case-raf/12 text-ink border-case-raf ring-case-raf",
    color: "var(--color-case-raf)",
  },
  manshub: {
    label: "manshūb",
    shape: "◆",
    className: "bg-case-nasb/12 text-ink border-case-nasb ring-case-nasb",
    color: "var(--color-case-nasb)",
  },
  majrur: {
    label: "majrūr",
    shape: "▼",
    className: "bg-case-jarr/12 text-ink border-case-jarr ring-case-jarr",
    color: "var(--color-case-jarr)",
  },
  majzum: {
    label: "majzūm",
    shape: "●",
    className: "bg-case-mabni/12 text-ink border-case-mabni ring-case-mabni",
    color: "var(--color-case-mabni)",
  },
  mabni: {
    label: "mabnī",
    shape: "■",
    className: "bg-case-mabni/12 text-ink border-case-mabni ring-case-mabni",
    color: "var(--color-case-mabni)",
  },
  none: {
    // Wording to be confirmed by the ustadz reviewer (senior-ux §3.9).
    label: "tanpa i'rab",
    shape: "○",
    className: "bg-paper-deep text-ink border-border-ui ring-border-ui",
    color: "var(--color-border-ui)",
  },
};

/** Each state's term in the verified table (library.terms.json id); "none" names i'rab. */
const STATE_TERM: Record<CaseState, string> = {
  marfu: "marfu",
  manshub: "manshub",
  majrur: "majrur",
  majzum: "majzum",
  mabni: "mabni",
  none: "irab",
};

/** A word card's case label as marked prose (2026-10-12: the term's Arabic beside it, "majrūr
 *  (مَجْرُور)"; its Arabic comes from the term table, never typed here). Without the markup it is
 *  CASE_META's label (cases.test: stripped, the same string). */
export function caseLabelMarked(state: CaseState): string {
  const label = CASE_META[state].label;
  if (state === "none") return label.replace("i'rab", `[[i'rab|${STATE_TERM.none}]]`);
  return `[[${label}|${STATE_TERM[state]}]]`;
}

/** "mahall nashb" → its position marked as the term ("[[nashab|nashab]]"), for the word card's
 *  "Kedudukannya …" line. */
const MAHALL_TERM: Record<string, string> = {
  nashb: "[[nashab|nashab]]",
  jarr: "[[jar|jar]]",
  "raf'": "[[rafa'|rafa]]",
  jazm: "[[jazm|jazm]]",
};
export function mahallMarked(mahall: string): string | null {
  return MAHALL_TERM[mahall.replace(/^mahall\s+/i, "").trim()] ?? null;
}

/** The four case states a beginner meets, in bin order. The quiz plan decides which of them a
 *  sort offers (content/quiz `bins`: the states taught so far); pipeline/quiz.py SORT_BINS
 *  mirrors this list. */
export const SORT_BINS: CaseState[] = ["marfu", "manshub", "majrur", "mabni"];
