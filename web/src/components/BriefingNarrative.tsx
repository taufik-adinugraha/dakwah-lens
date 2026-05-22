import ReactMarkdown, { type Components } from "react-markdown";

import type { DaleelRef } from "@/db/schema";
import { BriefDeliverableCards } from "./BriefDeliverableCards";
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
  /** Localized strings for the card grid + modal toolbar. Required when
   *  `briefBasePath` is set. */
  deliverableLabels?: {
    open: string;
    copy: string;
    copied: string;
    download: string;
    print: string;
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
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>
              {split.before}
            </ReactMarkdown>
            {split.section4 && (
              <>
                <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                  {split.section4HeadingLine}
                </ReactMarkdown>
                <BriefDeliverableCards
                  section4Markdown={split.section4Body}
                  labels={deliverableLabels!}
                  briefBasePath={briefBasePath!}
                  initialDeliverable={initialDeliverable ?? null}
                />
              </>
            )}
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>
              {split.after}
            </ReactMarkdown>
          </>
        ) : (
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
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
 * Tailwind-class overrides per markdown element. Tuned for the briefing
 * card aesthetic — section headings use emerald accents to match the
 * existing /insights briefing card chrome; blockquotes get a left rule
 * to read as inline citation context.
 */
const MARKDOWN_COMPONENTS: Components = {
  h2: ({ children }) => (
    <h2 className="mt-7 mb-2 border-b border-emerald-100 pb-1.5 text-balance text-lg font-bold tracking-tight text-slate-900 first:mt-0 sm:text-xl">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-1 text-balance text-sm font-semibold uppercase tracking-wider text-emerald-700 sm:text-[15px]">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mt-2 text-pretty leading-relaxed text-slate-700">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-emerald-300 bg-emerald-50/40 py-2 pl-4 pr-3 text-slate-700">
      {children}
    </blockquote>
  ),
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
  hr: () => <hr className="my-5 border-slate-200" />,
};
