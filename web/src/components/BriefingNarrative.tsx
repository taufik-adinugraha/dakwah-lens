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

/** Section 4 heading variants per language. Used to split the markdown
 *  body around the deliverable section so it renders as cards-and-modal
 *  instead of inline. Match is case-insensitive and tolerant of trailing
 *  punctuation but requires the exact phrase since the LLM is steered
 *  toward these exact section names by the prompt. */
const SECTION_4_HEADINGS_ID = ["strategi & aksi dakwah", "strategi dan aksi dakwah"];
const SECTION_4_HEADINGS_EN = ["da'wah strategies & actions", "dawah strategies & actions"];

/**
 * Renders the AI-narrated weekly briefing.
 *
 * The LLM emits a 5-section markdown document (~1700-2000 words):
 *   1. Ringkasan Eksekutif / Executive Summary
 *   2. Numerik & Tren Pekan Ini / Numbers & Trends This Week
 *   3. Tema Utama & Pola Yang Muncul / Main Themes & Emerging Patterns
 *   4. Strategi & Aksi Dakwah / Da'wah Strategies & Actions
 *      — has ### sub-headings per channel + audience + action:
 *        khutbah / kajian / pengajaran / kreator / Gen Z / aksi sosial
 *   5. Daleel & Sumber / Daleel & Sources
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
  citedDaleelLabel,
  briefBasePath,
  briefId,
  deliverableLabels,
  initialDeliverable,
  locale,
}: {
  text: string;
  daleelRefs: DaleelRef[] | null;
  /** Header label for the collapsible daleel chips section below the
   *  narrative. Locale-aware via translations from parent. */
  citedDaleelLabel: string;
  /** Path of the brief detail route. When provided, Section 4 of the
   *  markdown is rendered as a card grid (BriefDeliverableCards) instead
   *  of inline scroll, with each ### h3 opening a focus modal. Omit on
   *  preview surfaces (e.g. /insights hero) — there we want the plain
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
    close: string;
  };
  /** Deep-link slug: opens the matching modal on mount. */
  initialDeliverable?:
    | "khutbah"
    | "kajian"
    | "home"
    | "content"
    | "genz"
    | "action"
    | null;
  /** Brief language; controls which Section 4 heading we look for. */
  locale?: string;
  /** @deprecated — was the inline "Nasihah" badge label for the old short
   *  format. Kept in the prop signature so existing callers don't break;
   *  long-form output uses native H2 headings now. */
  nasihahLabel?: string;
}) {
  // Try to split out Section 4 only when caller provides cards UI hooks.
  // Otherwise render the whole markdown inline (existing behavior for
  // preview surfaces and back-compat).
  const split =
    briefBasePath && deliverableLabels
      ? splitSection4(text, locale === "en")
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
                  briefId={briefId!}
                  initialDeliverable={initialDeliverable ?? null}
                />
                {briefId && <BriefFlyerSection briefId={briefId} />}
              </>
            )}
            <ReactMarkdown components={makeMarkdownComponents()}>
              {split.after}
            </ReactMarkdown>
          </>
        ) : (
          <ReactMarkdown components={makeMarkdownComponents()}>
            {text}
          </ReactMarkdown>
        )}
      </article>

      {daleelRefs && daleelRefs.length > 0 && (
        <DaleelChips
          refs={daleelRefs}
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
 * Heuristic — does this paragraph look like Arabic du'a / dhikr text?
 *
 * Triggers on EITHER:
 *   - Native Arabic script (U+0600-U+06FF range, ≥10 chars) — what
 *     khutbah blocks contain since the 2026-05-23 prompt switch from
 *     Latin transliteration to actual Arabic with harakat.
 *   - Latin transliteration (legacy briefs pre-2026-05-23 still have
 *     "Allāhumma ighfir lil mu'minīna..." prose).
 *
 * False positives are cheap (paragraph just gets the serif/Amiri
 * treatment). False negatives mean the du'a renders as normal prose.
 */
function looksLikeArabicTransliteration(text: string): boolean {
  // Native Arabic-script detection — anything in the Arabic Unicode
  // blocks beyond a token threshold. Counts the full Arabic + Arabic
  // Supplement + Arabic Extended-A ranges so harakat marks register.
  const arabicChars = text.match(/[؀-ۿݐ-ݿࢠ-ࣿ]/g);
  if (arabicChars && arabicChars.length >= 10) return true;

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
