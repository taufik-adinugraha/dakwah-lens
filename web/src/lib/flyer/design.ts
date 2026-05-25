/**
 * Design tokens for the shareable briefing flyer (1080×1080 PNG).
 *
 * Single source of truth for colors per deliverable kind / segment so
 * the flyer matches the on-screen card UI (BriefDeliverableCards) and
 * the brief-body section accents (BriefingNarrative).
 *
 * The flyer is rendered via `ImageResponse` (next/og under the hood ->
 * Satori). Satori supports a SUBSET of CSS: flexbox layouts work, but
 * Tailwind classes do NOT — every style must be inline `style={{ ... }}`.
 * That's why these tokens are raw hex strings, not class names.
 */

export type DeliverableSlug =
  | "khutbah"
  | "kajian"
  | "home"
  | "content"
  | "genz"
  | "action";

export type SegmentSlug =
  | "all"
  | "spiritual"
  | "family"
  | "youth"
  | "justice";

/** Per-deliverable palette. Mirrors KIND_ICON_TONE / KIND_TONE in
 *  BriefDeliverableCards.tsx so the flyer reads as a continuation of
 *  the card the user clicked. */
export const DELIVERABLE_PALETTE: Record<
  DeliverableSlug,
  {
    bgGradient: [string, string]; // top-left → bottom-right
    accent: string; // headline + border
    accentSoft: string; // pull-quote bg
    chipBg: string;
    chipText: string;
    label: { id: string; en: string };
  }
> = {
  khutbah: {
    bgGradient: ["#ecfdf5", "#d1fae5"],
    accent: "#047857",
    accentSoft: "#a7f3d0",
    chipBg: "#047857",
    chipText: "#ecfdf5",
    label: { id: "Khutbah Jumat", en: "Friday Khutbah" },
  },
  kajian: {
    bgGradient: ["#fff1f2", "#ffe4e6"],
    accent: "#9f1239",
    accentSoft: "#fecdd3",
    chipBg: "#9f1239",
    chipText: "#fff1f2",
    label: {
      id: "Kajian Ibu-ibu",
      en: "Women's Kajian",
    },
  },
  home: {
    bgGradient: ["#fffbeb", "#fef3c7"],
    accent: "#92400e",
    accentSoft: "#fde68a",
    chipBg: "#92400e",
    chipText: "#fffbeb",
    label: {
      id: "Pengajaran di Rumah",
      en: "Teaching at Home",
    },
  },
  content: {
    bgGradient: ["#f0f9ff", "#e0f2fe"],
    accent: "#0369a1",
    accentSoft: "#bae6fd",
    chipBg: "#0369a1",
    chipText: "#f0f9ff",
    label: {
      id: "Kreator Konten Digital",
      en: "Digital Content Creator",
    },
  },
  genz: {
    bgGradient: ["#f5f3ff", "#ede9fe"],
    accent: "#6d28d9",
    accentSoft: "#ddd6fe",
    chipBg: "#6d28d9",
    chipText: "#f5f3ff",
    label: { id: "Pendekatan Gen Z", en: "Reaching Gen Z" },
  },
  action: {
    bgGradient: ["#f0fdfa", "#ccfbf1"],
    accent: "#0f766e",
    accentSoft: "#99f6e4",
    chipBg: "#0f766e",
    chipText: "#f0fdfa",
    label: { id: "Aksi Sosial", en: "Social Action" },
  },
};

/** Per-segment palette for the MAIN brief flyer (no specific deliverable).
 *  Tones picked so each segment is visually distinct + the "overall-view"
 *  flyer uses the emerald brand color. */
export const SEGMENT_PALETTE: Record<
  SegmentSlug,
  {
    bgGradient: [string, string];
    accent: string;
    accentSoft: string;
    chipBg: string;
    chipText: string;
    label: { id: string; en: string };
  }
> = {
  all: {
    bgGradient: ["#ecfdf5", "#d1fae5"],
    accent: "#047857",
    accentSoft: "#a7f3d0",
    chipBg: "#047857",
    chipText: "#ecfdf5",
    label: {
      id: "Briefing Pekan Ini",
      en: "This Week's Briefing",
    },
  },
  spiritual: {
    bgGradient: ["#ecfdf5", "#d1fae5"],
    accent: "#047857",
    accentSoft: "#a7f3d0",
    chipBg: "#047857",
    chipText: "#ecfdf5",
    label: { id: "Segmen Spiritual", en: "Spiritual Segment" },
  },
  family: {
    bgGradient: ["#fffbeb", "#fef3c7"],
    accent: "#92400e",
    accentSoft: "#fde68a",
    chipBg: "#92400e",
    chipText: "#fffbeb",
    label: { id: "Segmen Keluarga", en: "Family Segment" },
  },
  youth: {
    bgGradient: ["#f5f3ff", "#ede9fe"],
    accent: "#6d28d9",
    accentSoft: "#ddd6fe",
    chipBg: "#6d28d9",
    chipText: "#f5f3ff",
    label: { id: "Segmen Pemuda", en: "Youth Segment" },
  },
  justice: {
    bgGradient: ["#fff1f2", "#ffe4e6"],
    accent: "#9f1239",
    accentSoft: "#fecdd3",
    chipBg: "#9f1239",
    chipText: "#fff1f2",
    label: { id: "Segmen Keadilan", en: "Justice Segment" },
  },
};

/** Canvas size — Instagram feed square. */
export const FLYER_WIDTH = 1080;
export const FLYER_HEIGHT = 1080;
