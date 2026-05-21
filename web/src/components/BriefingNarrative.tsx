import ReactMarkdown, { type Components } from "react-markdown";

import type { DaleelRef } from "@/db/schema";
import { DaleelChips } from "./DaleelChips";

/**
 * Renders the AI-narrated weekly briefing.
 *
 * The LLM emits a 5-section markdown document (~1500-1800 words):
 *   1. Ringkasan Eksekutif / Executive Summary
 *   2. Numerik & Tren Pekan Ini / Numbers & Trends This Week
 *   3. Tema Utama & Pola Yang Muncul / Main Themes & Emerging Patterns
 *   4. Strategi per Surface Dakwah / Da'wah Surface Strategies
 *      — has ### sub-headings per surface (khutbah / kajian / kreator / pengajaran)
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
}: {
  text: string;
  daleelRefs: DaleelRef[] | null;
  /** Header label for the collapsible daleel chips section below the
   *  narrative. Locale-aware via translations from parent. */
  citedDaleelLabel: string;
  /** @deprecated — was the inline "Nasihah" badge label for the old short
   *  format. Kept in the prop signature so existing callers don't break;
   *  long-form output uses native H2 headings now. */
  nasihahLabel?: string;
}) {
  return (
    <div className="mt-5">
      <article className="text-pretty text-slate-800">
        <ReactMarkdown components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
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
