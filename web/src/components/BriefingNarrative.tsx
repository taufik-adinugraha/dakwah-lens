import ReactMarkdown, { type Components } from "react-markdown";
import {
  BarChart3,
  BookOpen,
  Compass,
  Flame,
  Quote,
  Sparkles,
} from "lucide-react";

import type { DaleelRef } from "@/db/schema";
import { BriefDeliverableCards } from "./BriefDeliverableCards";
import { BriefFlyerSection } from "./BriefFlyerSection";
import { DaleelChips } from "./DaleelChips";
import { MahasiswaPosterCard } from "./MahasiswaPosterCard";

/** Section 4 heading variants per language. Used to split the markdown
 *  body around the deliverable section so it renders as cards-and-modal
 *  instead of inline. Match is case-insensitive and tolerant of trailing
 *  punctuation but requires the exact phrase since the LLM is steered
 *  toward these exact section names by the prompt. */
const SECTION_4_HEADINGS_ID = ["strategi & aksi dakwah", "strategi dan aksi dakwah"];
const SECTION_4_HEADINGS_EN = ["da'wah strategies & actions", "dawah strategies & actions"];

/** The `## Pesan Flyer` / `## Flyer Messages` section is INPUT for the
 *  PNG flyer renderer (see `extractDedicatedFlyerMessage` in
 *  `flyer/content.ts`) — it should not also be rendered as plain
 *  markdown text in the briefing body, otherwise the same 4 messages
 *  show twice (once as PNGs via `BriefFlyerSection`, once as text
 *  below). Strip it before any rendering. Case-insensitive H2 match;
 *  the section runs to EOF (the prompt puts it last). */
function stripFlyerMessagesSection(md: string): string {
  const lines = md.split("\n");
  const heading = /^##\s+(?:pesan\s+flyer|flyer\s+messages)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) {
      return lines.slice(0, i).join("\n").replace(/\s+$/, "") + "\n";
    }
  }
  return md;
}

// NOTE: word-count annotations like `(2300-3200 kata)` / `(~80 kata)`
// are stripped at the data-access layer (`stripWordCountAnnotations`
// in @/lib/briefing-data) before the markdown ever reaches this
// component. We don't strip again here — single source of truth.

/**
 * Renders the AI-narrated weekly briefing.
 *
 * The LLM emits a 6-section markdown document (~1900-2300 words):
 *   1. Ringkasan Eksekutif / Executive Summary
 *   2. Numerik & Tren Pekan Ini / Numbers & Trends This Week
 *   3. Tema Utama & Pola Yang Muncul / Main Themes & Emerging Patterns
 *   4. Poin Kunci untuk Da'i Senior / Key Points for Senior Da'i
 *      — 4-6 bullets, each with **Masalah:** + **Aksi:**. Added
 *        2026-06-03 for readers who want bullets instead of prose.
 *   5. Strategi & Aksi Dakwah / Da'wah Strategies & Actions
 *      — has ### sub-headings per channel + audience + action:
 *        khutbah / kajian / pengajaran / kreator / Gen Z / aksi sosial
 *   6. Daleel & Sumber / Daleel & Sources
 *      — citations with > blockquote translation + 1-2 sentence context
 *
 * Replaced the 3-paragraph short-form renderer on 2026-05-21 after the
 * scenario-1 calibration test showed long-form names ~4× more specific
 * stories, identifies cross-topic patterns, and gives each da'wah surface
 * a distinct angle.
 *
 * Daleel chips render BELOW the markdown body as a supplemental
 * Arabic+modal interaction — the long-form's Section 5 already covers the
 * conceptual context per daleel, but the chips give users a way to read
 * the original Arabic + locale-switched translations.
 */
export function BriefingNarrative({
  text,
  daleelRefs,
  adhkarRefs,
  citedDaleelLabel,
  briefBasePath,
  briefId,
  deliverableLabels,
  initialDeliverable,
  locale,
  posterLabels,
}: {
  text: string;
  daleelRefs: DaleelRef[] | null;
  /** Du'a / dzikir pool retrieved alongside the thematic daleel. The
   *  Sunnah-call (Pesan Flyer 5) + Du'a hero (Flyer 6) cite from this
   *  pool. Surfaced in the same "Dalil yang dirujuk" chip list as
   *  daleelRefs (de-duped by citation) so a reader can click any
   *  cited passage — thematic OR sunnah/du'a — from one place. */
  adhkarRefs?: DaleelRef[] | null;
  /** Header label for the collapsible daleel chips section below the
   *  narrative. Locale-aware via translations from parent. */
  citedDaleelLabel: string;
  /** Path of the brief detail route. When provided, Section 4 of the
   *  markdown is rendered as a card grid (BriefDeliverableCards) instead
   *  of inline scroll, with each ### h3 opening a focus modal. Omit on
   *  preview surfaces (e.g. /briefings hero) — there we want the plain
   *  inline render. */
  briefBasePath?: string;
  /** Brief slug (e.g. `2026-05-22-all`) — used to construct the
   *  per-deliverable flyer download URL. Required when `briefBasePath`
   *  is set. */
  briefId?: string;
  /** Localized strings for the card grid + modal toolbar. Required when
   *  `briefBasePath` is set. */
  deliverableLabels?: {
    open: string;
    copy: string;
    copied: string;
    download: string;
    print: string;
    flyer: string;
    visit: string;
    close: string;
  };
  /** Deep-link slug: opens the matching modal on mount. */
  initialDeliverable?:
    | "khutbah"
    | "kultum"
    | "kajian"
    | "kisah"
    | "home"
    | "content"
    | "genz"
    | "action"
    | null;
  /** Brief language; controls which Section 4 heading we look for. */
  locale?: string;
  /** Localized strings for the Mahasiswa bulletin-board poster card.
   *  Rendered between Section 4 cards and the share-flyer grid. */
  posterLabels?: {
    eyebrow: string;
    title: string;
    body: string;
    openLarge: string;
    download: string;
    downloadPdf: string;
    print: string;
    loading: string;
    close: string;
    show: string;
    hide: string;
  };
  /** @deprecated — was the inline "Nasihah" badge label for the old short
   *  format. Kept in the prop signature so existing callers don't break;
   *  long-form output uses native H2 headings now. */
  nasihahLabel?: string;
  // posterLabels is documented above; the trailing rest-of-shape closes here.
}) {
  // `## Pesan Flyer` is renderer input, not display content — see helper.
  const bodyForDisplay = stripFlyerMessagesSection(text);

  // Try to split out Section 4 only when caller provides cards UI hooks.
  // Otherwise render the whole markdown inline (existing behavior for
  // preview surfaces and back-compat).
  const split =
    briefBasePath && deliverableLabels
      ? splitSection4(bodyForDisplay, locale === "en")
      : null;

  return (
    <div className="mt-5">
      <article className="text-pretty text-slate-800">
        {split ? (
          <>
            <ReactMarkdown components={makeMarkdownComponents()}>
              {split.before}
            </ReactMarkdown>
            {split.section4 && (
              <>
                <ReactMarkdown components={makeMarkdownComponents()}>
                  {split.section4HeadingLine}
                </ReactMarkdown>
                <BriefDeliverableCards
                  section4Markdown={split.section4Body}
                  labels={deliverableLabels!}
                  briefBasePath={briefBasePath!}
                  initialDeliverable={initialDeliverable ?? null}
                />
                {/* Separator between the core deliverable cards and the
                    visual extras (Mahasiswa poster, share-ready flyers).
                    Both downstream blocks have their own eyebrow + title,
                    but without the dashed rule + spacing they bled into
                    the deliverable grid above and looked like more cards.
                    Audit 2026-05-26 P0 — visitors expecting a unified
                    "content kit" couldn't tell where it ended. */}
                {briefId && (posterLabels || true) && (
                  <hr
                    aria-hidden
                    className="my-10 border-t border-dashed border-slate-200"
                  />
                )}
                {briefId && posterLabels && (
                  <MahasiswaPosterCard
                    briefId={briefId}
                    locale={locale ?? "id"}
                    labels={posterLabels}
                  />
                )}
                {briefId && <BriefFlyerSection briefId={briefId} />}
              </>
            )}
            <ReactMarkdown components={makeMarkdownComponents()}>
              {split.after}
            </ReactMarkdown>
          </>
        ) : (
          <ReactMarkdown components={makeMarkdownComponents()}>
            {bodyForDisplay}
          </ReactMarkdown>
        )}
      </article>

      {((daleelRefs && daleelRefs.length > 0) ||
        (adhkarRefs && adhkarRefs.length > 0)) && (
        <DaleelChips
          refs={mergeRefs(daleelRefs, adhkarRefs)}
          mode="cards"
          headerLabel={citedDaleelLabel}
        />
      )}
    </div>
  );
}

/**
 * Find Section 4 ("Strategi & Aksi Dakwah" / "Da'wah Strategies & Actions")
 * in the markdown and split into:
 *   - before: everything up to and including Section 3 + 5? actually up to but
 *     NOT including the Section 4 heading line.
 *   - section4HeadingLine: just the `## …` line (we still want it rendered
 *     as a normal h2 so the BriefTOC anchor remains intact).
 *   - section4Body: everything under Section 4 until the next `## ` heading.
 *   - after: everything from the next `## ` onward (Section 5).
 * Returns null if Section 4 isn't found — caller falls back to inline render.
 */
function splitSection4(
  text: string,
  isEnglish: boolean,
): {
  before: string;
  section4HeadingLine: string;
  section4Body: string;
  after: string;
  section4: boolean;
} | null {
  const lines = text.split("\n");
  const targets = isEnglish ? SECTION_4_HEADINGS_EN : SECTION_4_HEADINGS_ID;

  let s4Start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("## ")) continue;
    const headingText = lines[i]
      .replace(/^##\s+/, "")
      .replace(/\s*\(.*\)\s*$/, "") // strip optional "(NNN kata)" trailer
      .trim()
      .toLowerCase();
    if (targets.some((t) => headingText.startsWith(t))) {
      s4Start = i;
      break;
    }
  }
  if (s4Start === -1) return null;

  // Find next ## after s4Start.
  let s4End = lines.length;
  for (let i = s4Start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      s4End = i;
      break;
    }
  }

  return {
    before: lines.slice(0, s4Start).join("\n"),
    section4HeadingLine: lines[s4Start],
    section4Body: lines.slice(s4Start + 1, s4End).join("\n"),
    after: lines.slice(s4End).join("\n"),
    section4: true,
  };
}

/**
 * Per-section visual themes — each ## h2 in the briefing gets a unique
 * accent color + lucide icon, so the long-form doc scans as a sequence
 * of color-coded chapters rather than one continuous grey block.
 * Match is case-insensitive substring against the heading text — accepts
 * both Indonesian and English wording.
 */
const SECTION_THEMES: Array<{
  match: RegExp;
  icon: typeof Sparkles;
  /** Tailwind classes for the icon container chip. */
  iconClass: string;
  /** Tailwind border-bottom class for the heading rule. */
  ruleClass: string;
  /** Tailwind background tint for blockquotes inside this section. */
  quoteBg: string;
  /** Tailwind border-left color for blockquotes inside this section. */
  quoteBorder: string;
}> = [
  {
    match: /ringkasan eksekutif|executive summary/i,
    icon: Sparkles,
    iconClass: "bg-emerald-100 text-emerald-700",
    ruleClass: "border-emerald-300",
    quoteBg: "bg-emerald-50/60",
    quoteBorder: "border-emerald-300",
  },
  {
    match: /numerik|numbers & trends|trends?/i,
    icon: BarChart3,
    iconClass: "bg-blue-100 text-blue-700",
    ruleClass: "border-blue-300",
    quoteBg: "bg-blue-50/60",
    quoteBorder: "border-blue-300",
  },
  {
    match: /tema utama|main themes/i,
    icon: Flame,
    iconClass: "bg-amber-100 text-amber-700",
    ruleClass: "border-amber-300",
    quoteBg: "bg-amber-50/60",
    quoteBorder: "border-amber-300",
  },
  {
    match: /strategi & aksi|strategies & actions/i,
    icon: Compass,
    iconClass: "bg-rose-100 text-rose-700",
    ruleClass: "border-rose-300",
    quoteBg: "bg-rose-50/60",
    quoteBorder: "border-rose-300",
  },
  {
    match: /daleel & sumber|daleel & sources/i,
    icon: BookOpen,
    iconClass: "bg-teal-100 text-teal-700",
    ruleClass: "border-teal-300",
    quoteBg: "bg-teal-50/60",
    quoteBorder: "border-teal-300",
  },
];

const DEFAULT_THEME = {
  icon: Sparkles,
  iconClass: "bg-slate-100 text-slate-700",
  ruleClass: "border-slate-300",
  quoteBg: "bg-slate-50/60",
  quoteBorder: "border-slate-300",
};

function themeForHeading(text: string) {
  for (const t of SECTION_THEMES) {
    if (t.match.test(text)) return t;
  }
  return DEFAULT_THEME;
}

/**
 * Heuristic — does this paragraph look like Arabic du'a / dhikr text
 * that deserves the centered Amiri "du'a card" treatment?
 *
 * Triggers when the paragraph is PREDOMINANTLY Arabic, not just when
 * it contains an inline citation. The earlier ≥10-char threshold (false
 * positive 2026-06-06) was boxing Indonesian prose paragraphs that
 * quoted one ayat inline — making khutbah body paragraphs render as
 * a stack of green du'a cards instead of flowing text.
 *
 * The two true-positive cases are:
 *   - Native Arabic-only blocks (khutbah opening hamdalah, closing
 *     du'a, ayat block in Section 5 "Dalil & Sumber") — Arabic should
 *     dominate the paragraph's non-whitespace characters.
 *   - Latin transliteration (legacy briefs pre-2026-05-23) — still
 *     allowed via the strong-token / diacritic-density path below.
 *
 * False positives are cheap (paragraph gets serif/Amiri); false
 * negatives mean a du'a renders as normal prose. Optimised for the
 * inline-citation-in-prose case.
 */
function looksLikeArabicTransliteration(text: string): boolean {
  // Native Arabic-script ratio test. Boxing requires Arabic to
  // dominate the paragraph — not just be present alongside Indonesian
  // prose. Threshold (40% of non-whitespace chars) calibrated against
  // sample khutbah body paragraphs whose Arabic inline-citation share
  // sits at 5-20%, vs pure ayat/du'a blocks at 80-100%.
  const arabicChars = text.match(/[؀-ۿݐ-ݿࢠ-ࣿ]/g);
  if (arabicChars && arabicChars.length >= 20) {
    const nonWhitespace = text.replace(/\s/g, "").length || 1;
    if (arabicChars.length / nonWhitespace >= 0.4) return true;
  }

  if (text.length < 40) return false;
  // Strong tokens that almost guarantee a Latin-transliterated du'a.
  const strongTokens = /(allahumma|al[\s-]?ḥamdu|inna [aA]llaha|rabbana|subḥāna|wa[\s-]?ṣalli|allāhumma)/i;
  if (strongTokens.test(text)) return true;
  // Density check on long-vowel/diacritic marks for the legacy path.
  const marks = text.match(/[āīūṣḍḥṭẓʿʾ]/g);
  if (!marks) return false;
  return marks.length / text.length >= 0.02;
}

function childrenToString(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in (children as object)
  ) {
    return childrenToString(
      (children as { props: { children?: React.ReactNode } }).props.children,
    );
  }
  return "";
}

/**
 * Tailwind-class overrides per markdown element. The MARKDOWN_COMPONENTS
 * factory takes a "current section theme" ref so blockquotes can pick up
 * the active section's color. h2 mutates the theme as the doc unfolds.
 */
function makeMarkdownComponents(): Components {
  // Mutable theme tracked across the markdown render. ReactMarkdown
  // renders elements in document order so this is safe — h2 sets the
  // theme, subsequent elements read it. Resets at the next h2.
  const themeRef = { current: DEFAULT_THEME as ReturnType<typeof themeForHeading> };

  return {
    h2: ({ children }) => {
      const text = childrenToString(children);
      const theme = themeForHeading(text);
      themeRef.current = theme;
      const Icon = theme.icon;
      return (
        <h2
          className={`mt-8 mb-3 flex items-center gap-2.5 border-b-2 pb-2 text-balance text-lg font-bold tracking-tight text-slate-900 first:mt-0 sm:text-xl ${theme.ruleClass}`}
        >
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${theme.iconClass}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex-1">{children}</span>
        </h2>
      );
    },
    h3: ({ children }) => (
      <h3 className="mt-5 mb-1 text-balance text-sm font-semibold uppercase tracking-wider text-slate-700 sm:text-[15px]">
        {children}
      </h3>
    ),
    p: ({ children }) => {
      const text = childrenToString(children);
      if (looksLikeArabicTransliteration(text)) {
        // Native Arabic gets RTL + bigger Amiri so the harakat are
        // legible; Latin transliteration uses the same card but LTR
        // and smaller. Detection via the same Arabic Unicode test
        // we used in `looksLikeArabicTransliteration`.
        const hasNativeArabic = /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(text);
        return (
          <p
            dir={hasNativeArabic ? "rtl" : "ltr"}
            className={`my-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/60 px-5 py-4 text-center font-amiri leading-[2] text-emerald-950 shadow-sm sm:px-7 ${
              hasNativeArabic
                ? "text-[20px] sm:text-[22px]"
                : "text-[15px] sm:text-base"
            }`}
          >
            {children}
          </p>
        );
      }
      return (
        <p className="mt-2 text-pretty leading-relaxed text-slate-700">
          {children}
        </p>
      );
    },
    ul: ({ children }) => (
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => {
      const t = themeRef.current;
      return (
        <blockquote
          className={`relative my-3 rounded-xl border-l-4 ${t.quoteBorder} ${t.quoteBg} px-5 py-3 pl-12 text-slate-700`}
        >
          <Quote
            className={`absolute left-3 top-3 h-5 w-5 ${t.iconClass.replace(/bg-\S+\s*/, "").replace("-100", "-500")} opacity-50`}
            aria-hidden
          />
          {children}
        </blockquote>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold text-slate-900">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-900"
      >
        {children}
      </a>
    ),
    hr: () => (
      <hr className="my-6 border-0 border-t border-dashed border-slate-300" />
    ),
  };
}

/** Merge the thematic daleel pool + the adhkar (du'a / sunnah) pool
 *  into a single chip list for "Dalil yang dirujuk · klik untuk
 *  membaca". De-duped by citation (case-insensitive, punctuation-
 *  tolerant) so an entry that happens to land in both pools shows up
 *  once — thematic pool wins ordering. Stable ordering: thematic
 *  entries first in their original sequence, then adhkar entries
 *  that didn't already appear. */
function mergeRefs(
  daleel: DaleelRef[] | null | undefined,
  adhkar: DaleelRef[] | null | undefined,
): DaleelRef[] {
  const out: DaleelRef[] = [];
  const seen = new Set<string>();
  const key = (r: DaleelRef) =>
    r.citation.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+/g, "").trim();
  for (const r of daleel ?? []) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  for (const r of adhkar ?? []) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
