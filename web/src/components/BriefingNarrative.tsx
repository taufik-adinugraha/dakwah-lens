import { Quote, Sparkles } from "lucide-react";

import type { DaleelRef } from "@/db/schema";
import { DaleelChips } from "./DaleelChips";

/**
 * Pretty-prints the AI-narrated weekly briefing.
 *
 * The LLM produces 3 paragraphs (separated by blank lines):
 *   1. Penjelasan — numbers + named stories driving the week
 *   2. Nasihah — practical Islamic counsel
 *   3. Daleel — citation lines (one per line, starting with "QS." or "HR.")
 *
 * Rendering tricks:
 *   - Paragraph 1: percentages get bold + color tint; quoted strings
 *     get italicised so the LLM-named stories pop.
 *   - Paragraph 2: left-border accent + small "Nasihah" label so it reads
 *     like counsel, not data.
 *   - Paragraph 3: text lines are dropped — the same citations render as
 *     proper cards via <DaleelChips mode="cards"/>, which is also where
 *     the click-to-expand modal lives.
 *
 * If the LLM doesn't follow the 3-paragraph spec (older rows, or it
 * decides to skip), we fall back to rendering the raw text — never
 * worse than before.
 */
export function BriefingNarrative({
  text,
  daleelRefs,
  nasihahLabel,
  citedDaleelLabel,
}: {
  text: string;
  daleelRefs: DaleelRef[] | null;
  /** "Nasihah" badge text — locale-aware via translations from parent. */
  nasihahLabel: string;
  /** "Cited daleel · click to read in full" header. */
  citedDaleelLabel: string;
}) {
  const paragraphs = text.trim().split(/\n\s*\n/).filter(Boolean);
  // Last paragraph that consists ONLY of daleel-shaped lines (QS./HR.)
  // is the daleel paragraph. Anything else is narrative.
  const isDaleelLine = (line: string) =>
    /^\s*(QS\.|HR\.)\s/i.test(line);
  const isDaleelParagraph = (p: string) =>
    p
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .every(isDaleelLine);

  const narrativeParagraphs = paragraphs.filter((p) => !isDaleelParagraph(p));
  // Paragraph 1 — context; Paragraph 2 — nasihah.
  const [context, nasihah, ...rest] = narrativeParagraphs;

  return (
    <div className="mt-5 space-y-4 text-pretty text-base leading-relaxed text-slate-800 sm:text-lg">
      {context && <ContextParagraph text={context} />}

      {nasihah && (
        <NasihahParagraph text={nasihah} label={nasihahLabel} />
      )}

      {/* Any extra paragraphs the LLM might emit (rare) — render plain
          so we don't truncate content. */}
      {rest.map((p, i) => (
        <p key={`extra-${i}`} className="whitespace-pre-line">
          {p}
        </p>
      ))}

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

/* ───────── Paragraph 1 — Penjelasan ───────── */

function ContextParagraph({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-line">{highlightContext(text)}</p>
  );
}

/**
 * Highlight numbers + quoted phrases at render time.
 *
 * Why regex post-processing instead of asking the LLM to emit
 * markdown: PRD §12 keeps the LLM output to plain text (no
 * markdown/HTML the model could exploit). The patterns we want to
 * highlight (percentages, quoted strings) are mechanical and safe to
 * extract here. Tones are sentiment-aware where the percentage is
 * obviously attached to "positif"/"negatif"/"netral" — otherwise
 * a default slate.
 */
function highlightContext(text: string): React.ReactNode[] {
  // Tokenise on: percentage numbers, quoted strings (curly or straight).
  // Keep the matched groups so we can wrap them.
  const tokens = text.split(
    /(\d+(?:[.,]\d+)?\s*%|"[^"]+"|"[^"]+"|'[^']+')/g,
  );
  return tokens.map((tok, i) => {
    if (!tok) return tok;
    // Percentages — tone by adjacent sentiment word in surrounding context.
    if (/^\d+(?:[.,]\d+)?\s*%$/.test(tok)) {
      const lookback = text.slice(Math.max(0, text.indexOf(tok) - 40), text.indexOf(tok)).toLowerCase();
      let toneClass = "text-slate-900";
      if (/\bpositif|positive\b/.test(lookback)) {
        toneClass = "text-emerald-700";
      } else if (/\bnegatif|negative|concerned|negative\b/.test(lookback)) {
        toneClass = "text-amber-700";
      } else if (/\bnetral|neutral\b/.test(lookback)) {
        toneClass = "text-slate-700";
      }
      return (
        <strong key={i} className={`font-semibold tabular-nums ${toneClass}`}>
          {tok}
        </strong>
      );
    }
    // Quoted strings — give them italic + subtle weight so LLM-named
    // stories stand apart from the prose.
    if (/^["'"][^"'"]+["'"]$/.test(tok)) {
      return (
        <em key={i} className="font-medium not-italic text-slate-900">
          {tok}
        </em>
      );
    }
    return tok;
  });
}

/* ───────── Paragraph 2 — Nasihah ───────── */

function NasihahParagraph({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  return (
    <div className="relative rounded-r-xl border-l-2 border-emerald-300 bg-emerald-50/40 py-3 pl-4 pr-3">
      <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-100/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
        <Sparkles className="h-2.5 w-2.5" />
        {label}
      </div>
      <p className="whitespace-pre-line text-pretty leading-relaxed text-slate-800">
        {text}
      </p>
    </div>
  );
}

// Re-export Quote so consumers (if any) can use it; currently used only
// internally if we want to render a quote glyph somewhere.
export { Quote };
