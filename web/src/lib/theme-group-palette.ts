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
  cardBorder: "border-hairline",
  cardBg: "bg-white",
  chipBg: "bg-paper-deep ring-1 ring-hairline",
  chipText: "text-ink-muted",
  openText: "text-forest group-hover:text-forest-hover",
  label: "SEMUA",
};

/** 2026-07 redesign: the old per-group rainbow (teal/rose/amber/…
 *  gradient cards) was collapsed to ONE serene tone — paper/ink with a
 *  forest hover. The map + labels survive so consumers and dropdown
 *  iteration keep working; only the class values changed.
 *
 *  Keyed by canonical raw label from THEME_GROUPS. Order matches the
 *  canonical 14-group reading order so a dropdown can iterate this
 *  map and present them consistently. */
export const THEME_GROUP_PALETTE: Readonly<Record<string, ThemeGroupTone>> = Object.freeze({
  all: NEUTRAL,

  "Hukum & Keadilan": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "HUKUM & KEADILAN",
  },
  "Sosial & Keluarga": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "SOSIAL & KELUARGA",
  },
  "Ekonomi & Bisnis": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "EKONOMI & BISNIS",
  },
  "Aqidah & Ibadah": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "AQIDAH & IBADAH",
  },
  "Kesehatan & Kehidupan": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "KESEHATAN & KEHIDUPAN",
  },
  "Pendidikan & SDM": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "PENDIDIKAN & SDM",
  },
  "Lingkungan & Bencana": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "LINGKUNGAN & BENCANA",
  },
  "Pemerintahan & Kebijakan": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "PEMERINTAHAN & KEBIJAKAN",
  },
  "Patologi Sosial Digital": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "PATOLOGI SOSIAL DIGITAL",
  },
  "Teknologi & AI": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "TEKNOLOGI & AI",
  },
  "Pekerja & Pertanian Rakyat": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "PEKERJA & PERTANIAN RAKYAT",
  },
  "Konflik & Geopolitik": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "KONFLIK & GEOPOLITIK",
  },
  "Inspirasi & Kisah Pribadi": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "INSPIRASI & KISAH PRIBADI",
  },
  "Toleransi & Lintas-Iman": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "TOLERANSI & LINTAS-IMAN",
  },

  // 15th track — Islamic-calendar occasions (Asyura, Maulid, Ramadan,
  // Hajj season, etc.). Distinct gold tone signals "this isn't a
  // weekly news theme — it's an event-driven briefing tied to the
  // Hijri calendar." See:
  //   - api/src/api/catalogs/hijri_occasions.yaml (catalog)
  //   - api/src/api/services/occasion_catalog.py (loader)
  //   - api/src/api/services/briefing.py (OCCASION_SYSTEM_PROMPT_ID)
  "Acara Kalender Islam": {
    cardBorder: "border-hairline",
    cardBg: "bg-white",
    chipBg: "bg-paper-deep ring-1 ring-hairline",
    chipText: "text-ink-muted",
    openText: "text-forest group-hover:text-forest-hover",
    label: "ACARA KALENDER ISLAM",
  },
});

/** Lookup with neutral fallback. Pass a raw `theme_group` value
 *  ("Hukum & Keadilan") OR null/undefined to get the neutral palette. */
export function paletteFor(themeGroup: string | null | undefined): ThemeGroupTone {
  if (!themeGroup) return NEUTRAL;
  return THEME_GROUP_PALETTE[themeGroup] ?? NEUTRAL;
}
