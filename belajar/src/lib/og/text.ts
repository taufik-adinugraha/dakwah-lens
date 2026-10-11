import type { Ayah, SurahContent } from "@/content/schema";

/**
 * The words on a share card (lib/og/card.tsx), built from messages ("Og") and lesson content,
 * apart from the drawing so tests can check every card the build draws.
 *
 * LATIN ONLY, never Arabic script: next/og (satori) does not shape Arabic, so letters come out
 * unjoined and/or in reverse order, and a misdrawn ayah is the one thing this module must never
 * publish. The lesson card carries the ayah's transliteration and its Indonesian translation,
 * both from content, unchanged except that footnote markers are dropped (the card has no
 * footnotes). src/lib/og/og.test.ts fails on any Arabic letter in any card and on any character
 * the card fonts cannot draw (satori would otherwise fetch a fallback font from the network).
 */
export type CardText = {
  /** Next to the logo, under the "Dakwah-Lens" wordmark. */
  eyebrow: string;
  title: string;
  /** The ayah's word-by-word transliteration (lesson cards only). */
  translit?: string;
  /** The translation excerpt in quotes (lesson cards), or one line about the page. */
  body: string;
  /** Who the translation is by (lesson cards only). */
  source?: string;
  /** The module's AI label (AGENTS.md), on every card: it travels without the page footer. */
  disclaimer: string;
};

/** A next-intl translator for the "Og" namespace (or a test stand-in). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Translation excerpt: footnote markers ("pembalasan.[1]") dropped; long ones cut at a word. */
export function translationExcerpt(text: string, max = 170): string {
  const clean = text
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** The ayah's transliteration, word by word, as the lesson shows it. */
export function translitLine(a: Ayah): string {
  return a.words.map((w) => w.translit).join(" ");
}

export function hubCard(t: Translate): CardText {
  return { eyebrow: t("module"), title: t("track"), body: t("hub_body"), disclaimer: t("disclaimer") };
}

export function trackCard(t: Translate): CardText {
  return { eyebrow: t("module"), title: t("track"), body: t("track_body"), disclaimer: t("disclaimer") };
}

export function lessonCard(t: Translate, s: SurahContent, a: Ayah): CardText {
  return {
    eyebrow: t("track"),
    title: t("lesson_title", { surah: s.name_id, n: a.ayah }),
    translit: translitLine(a),
    body: `“${translationExcerpt(a.translation.text)}”`,
    source: a.translation.source_label,
    disclaimer: t("disclaimer"),
  };
}
