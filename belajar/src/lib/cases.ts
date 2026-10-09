import type { CaseState } from "@/content/schema";

export type CaseMeta = {
  /** Learner-facing name of the state (transliterated term). */
  label: string;
  arabic: string;
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
    arabic: "مرفوع",
    shape: "▲",
    className: "bg-case-raf/12 text-ink border-case-raf ring-case-raf",
    color: "var(--color-case-raf)",
  },
  manshub: {
    label: "manshūb",
    arabic: "منصوب",
    shape: "◆",
    className: "bg-case-nasb/12 text-ink border-case-nasb ring-case-nasb",
    color: "var(--color-case-nasb)",
  },
  majrur: {
    label: "majrūr",
    arabic: "مجرور",
    shape: "▼",
    className: "bg-case-jarr/12 text-ink border-case-jarr ring-case-jarr",
    color: "var(--color-case-jarr)",
  },
  majzum: {
    label: "majzūm",
    arabic: "مجزوم",
    shape: "●",
    className: "bg-case-mabni/12 text-ink border-case-mabni ring-case-mabni",
    color: "var(--color-case-mabni)",
  },
  mabni: {
    label: "mabnī",
    arabic: "مبني",
    shape: "■",
    className: "bg-case-mabni/12 text-ink border-case-mabni ring-case-mabni",
    color: "var(--color-case-mabni)",
  },
  none: {
    // Wording to be confirmed by the ustadz reviewer (senior-ux §3.9).
    label: "tanpa i'rab",
    arabic: "",
    shape: "○",
    className: "bg-paper-deep text-ink border-border-ui ring-border-ui",
    color: "var(--color-border-ui)",
  },
};

/** Bins used by the Sortir Akhiran exercise (the four a beginner meets). */
export const SORT_BINS: CaseState[] = ["marfu", "manshub", "majrur", "mabni"];
