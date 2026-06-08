/**
 * Per-theme-group visual palette for the 14 da'wah theme groups + the
 * neutral "all" fallback.
 *
 * Used by surfaces that show a card-per-briefing or card-per-discussion:
 *   - /discussions board (DiscussionsBoard)
 *   - /m/[id] other-rooms strip (OtherRoomsSection)
 *
 * Keyed by the canonical raw label from `THEME_GROUPS` in
 * dashboard-metrics.ts (mirrors `theme_groups.py` server-side). When a
 * card carries the raw `theme_group` value ("Hukum & Keadilan",
 * "Teknologi & AI", …) this map gives Tailwind class fragments for the
 * card frame, chip, and CTA text — all named the same way so callers
 * can swap freely between display surfaces.
 *
 * Why a flat string→tone map (not generated): Tailwind's JIT can only
 * see class names it can statically scan. Inline template literals
 * like `bg-${color}-100` get tree-shaken away and render unstyled. So
 * each tone is spelled out explicitly here.
 *
 * When adding a new theme group: mirror it both here and in
 * `api/src/api/services/theme_groups.py` + `dashboard-metrics.ts`.
 */
export type ThemeGroupTone = {
  /** Card outer ring/border. */
  cardBorder: string;
  /** Card background gradient (subtle, content readability). */
  cardBg: string;
  /** Chip background + ring (the small theme-group badge on each card). */
  chipBg: string;
  /** Chip text color (high contrast on chipBg). */
  chipText: string;
  /** Optional "Open / Buka" CTA text color (matches card identity). */
  openText: string;
  /** Display label shown on the chip — UPPER + spaced for the tag style. */
  label: string;
};

/** Neutral fallback for cards whose `theme_group` is null or unknown. */
const NEUTRAL: ThemeGroupTone = {
  cardBorder: "border-slate-200",
  cardBg: "bg-gradient-to-br from-slate-50/40 via-white to-white",
  chipBg: "bg-slate-100 ring-1 ring-slate-200",
  chipText: "text-slate-700",
  openText: "text-slate-700 group-hover:text-slate-900",
  label: "SEMUA",
};

/** Keyed by canonical raw label from THEME_GROUPS. Order matches the
 *  canonical 14-group reading order so a dropdown can iterate this
 *  map and present them consistently. */
export const THEME_GROUP_PALETTE: Readonly<Record<string, ThemeGroupTone>> = Object.freeze({
  all: NEUTRAL,

  "Hukum & Keadilan": {
    cardBorder: "border-teal-200",
    cardBg: "bg-gradient-to-br from-teal-50/60 via-white to-white",
    chipBg: "bg-teal-100 ring-1 ring-teal-200",
    chipText: "text-teal-800",
    openText: "text-teal-700 group-hover:text-teal-900",
    label: "HUKUM & KEADILAN",
  },
  "Sosial & Keluarga": {
    cardBorder: "border-rose-200",
    cardBg: "bg-gradient-to-br from-rose-50/60 via-white to-white",
    chipBg: "bg-rose-100 ring-1 ring-rose-200",
    chipText: "text-rose-800",
    openText: "text-rose-700 group-hover:text-rose-900",
    label: "SOSIAL & KELUARGA",
  },
  "Ekonomi & Bisnis": {
    cardBorder: "border-amber-200",
    cardBg: "bg-gradient-to-br from-amber-50/60 via-white to-white",
    chipBg: "bg-amber-100 ring-1 ring-amber-200",
    chipText: "text-amber-800",
    openText: "text-amber-700 group-hover:text-amber-900",
    label: "EKONOMI & BISNIS",
  },
  "Aqidah & Ibadah": {
    cardBorder: "border-emerald-200",
    cardBg: "bg-gradient-to-br from-emerald-50/60 via-white to-white",
    chipBg: "bg-emerald-100 ring-1 ring-emerald-200",
    chipText: "text-emerald-800",
    openText: "text-emerald-700 group-hover:text-emerald-900",
    label: "AQIDAH & IBADAH",
  },
  "Kesehatan & Kehidupan": {
    cardBorder: "border-sky-200",
    cardBg: "bg-gradient-to-br from-sky-50/60 via-white to-white",
    chipBg: "bg-sky-100 ring-1 ring-sky-200",
    chipText: "text-sky-800",
    openText: "text-sky-700 group-hover:text-sky-900",
    label: "KESEHATAN & KEHIDUPAN",
  },
  "Pendidikan & SDM": {
    cardBorder: "border-indigo-200",
    cardBg: "bg-gradient-to-br from-indigo-50/60 via-white to-white",
    chipBg: "bg-indigo-100 ring-1 ring-indigo-200",
    chipText: "text-indigo-800",
    openText: "text-indigo-700 group-hover:text-indigo-900",
    label: "PENDIDIKAN & SDM",
  },
  "Lingkungan & Bencana": {
    cardBorder: "border-green-200",
    cardBg: "bg-gradient-to-br from-green-50/60 via-white to-white",
    chipBg: "bg-green-100 ring-1 ring-green-200",
    chipText: "text-green-800",
    openText: "text-green-700 group-hover:text-green-900",
    label: "LINGKUNGAN & BENCANA",
  },
  "Pemerintahan & Kebijakan": {
    cardBorder: "border-slate-300",
    cardBg: "bg-gradient-to-br from-slate-100/60 via-white to-white",
    chipBg: "bg-slate-200 ring-1 ring-slate-300",
    chipText: "text-slate-800",
    openText: "text-slate-700 group-hover:text-slate-900",
    label: "PEMERINTAHAN & KEBIJAKAN",
  },
  "Patologi Sosial Digital": {
    cardBorder: "border-fuchsia-200",
    cardBg: "bg-gradient-to-br from-fuchsia-50/60 via-white to-white",
    chipBg: "bg-fuchsia-100 ring-1 ring-fuchsia-200",
    chipText: "text-fuchsia-800",
    openText: "text-fuchsia-700 group-hover:text-fuchsia-900",
    label: "PATOLOGI SOSIAL DIGITAL",
  },
  "Teknologi & AI": {
    cardBorder: "border-cyan-200",
    cardBg: "bg-gradient-to-br from-cyan-50/60 via-white to-white",
    chipBg: "bg-cyan-100 ring-1 ring-cyan-200",
    chipText: "text-cyan-800",
    openText: "text-cyan-700 group-hover:text-cyan-900",
    label: "TEKNOLOGI & AI",
  },
  "Pekerja & Pertanian Rakyat": {
    cardBorder: "border-lime-200",
    cardBg: "bg-gradient-to-br from-lime-50/60 via-white to-white",
    chipBg: "bg-lime-100 ring-1 ring-lime-200",
    chipText: "text-lime-800",
    openText: "text-lime-700 group-hover:text-lime-900",
    label: "PEKERJA & PERTANIAN RAKYAT",
  },
  "Konflik & Geopolitik": {
    cardBorder: "border-red-200",
    cardBg: "bg-gradient-to-br from-red-50/60 via-white to-white",
    chipBg: "bg-red-100 ring-1 ring-red-200",
    chipText: "text-red-800",
    openText: "text-red-700 group-hover:text-red-900",
    label: "KONFLIK & GEOPOLITIK",
  },
  "Inspirasi & Kisah Pribadi": {
    cardBorder: "border-violet-200",
    cardBg: "bg-gradient-to-br from-violet-50/60 via-white to-white",
    chipBg: "bg-violet-100 ring-1 ring-violet-200",
    chipText: "text-violet-800",
    openText: "text-violet-700 group-hover:text-violet-900",
    label: "INSPIRASI & KISAH PRIBADI",
  },
  "Toleransi & Lintas-Iman": {
    cardBorder: "border-orange-200",
    cardBg: "bg-gradient-to-br from-orange-50/60 via-white to-white",
    chipBg: "bg-orange-100 ring-1 ring-orange-200",
    chipText: "text-orange-800",
    openText: "text-orange-700 group-hover:text-orange-900",
    label: "TOLERANSI & LINTAS-IMAN",
  },
});

/** Lookup with neutral fallback. Pass a raw `theme_group` value
 *  ("Hukum & Keadilan") OR null/undefined to get the neutral palette. */
export function paletteFor(themeGroup: string | null | undefined): ThemeGroupTone {
  if (!themeGroup) return NEUTRAL;
  return THEME_GROUP_PALETTE[themeGroup] ?? NEUTRAL;
}
