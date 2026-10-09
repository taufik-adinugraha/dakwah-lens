import type { CaseState } from "@/content/schema";

/**
 * Case display (plan §4.1): colour AND shape, so the meaning never rests on
 * colour alone. Shapes follow the gesture metaphor taught in the lessons:
 * raf' rises (▲), nasb stands level (◆), jarr goes down (▼), mabni is fixed
 * (■).
 */
export const CASE_META: Record<
  CaseState,
  { label: string; arabic: string; shape: string; className: string }
> = {
  marfu: {
    label: "marfū'",
    arabic: "مرفوع",
    shape: "▲",
    className: "bg-case-raf/10 text-case-raf ring-case-raf/30",
  },
  manshub: {
    label: "manshūb",
    arabic: "منصوب",
    shape: "◆",
    className: "bg-case-nasb/10 text-case-nasb ring-case-nasb/30",
  },
  majrur: {
    label: "majrūr",
    arabic: "مجرور",
    shape: "▼",
    className: "bg-case-jarr/10 text-case-jarr ring-case-jarr/30",
  },
  majzum: {
    label: "majzūm",
    arabic: "مجزوم",
    shape: "●",
    className: "bg-case-mabni/10 text-case-mabni ring-case-mabni/30",
  },
  mabni: {
    label: "mabnī",
    arabic: "مبني",
    shape: "■",
    className: "bg-case-mabni/10 text-case-mabni ring-case-mabni/30",
  },
  none: {
    label: "—",
    arabic: "",
    shape: "○",
    className: "bg-paper-deep text-ink-muted ring-hairline",
  },
};

/** Bins used by the Sortir Akhiran exercise (the four a beginner meets). */
export const SORT_BINS: CaseState[] = ["marfu", "manshub", "majrur", "mabni"];
