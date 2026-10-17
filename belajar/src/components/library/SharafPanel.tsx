import { ChevronDown } from "lucide-react";

import type { Lexeme } from "@/content/schema";
import { arTall } from "@/lib/arabicInk";
import { type Lookup, markedTokens, type Scope, type Token } from "@/lib/terms";

import { MixedText } from "./MixedText";
import { Prose } from "./TermText";

export type SharafLabels = {
  heading: string;
  forms_note: string;
  ilal: string;
  ilal_from: string;
  ilal_to: string;
};

/** The panel's marked prose (library.json lexicon `marked`, 2026-10-12): the bab, each form label,
 *  each i'lal rule, annotated in the caller's scope in reading order (a word card's, a Kosakata
 *  page's). null without a marked twin: the plain text as before. */
export type SharafTokens = { bab: Token[] | null; labels: (Token[] | null)[]; ilal: (Token[] | null)[] };

export function sharafTokens(lexeme: Lexeme, scope: Scope, lookup: Lookup): SharafTokens | null {
  const mk = lexeme.marked;
  if (!mk) return null;
  return {
    bab: lexeme.tashrif ? markedTokens(mk.bab, scope, lookup) : null,
    labels: (lexeme.tashrif?.forms ?? []).map((_, i) => markedTokens(mk.labels[i], scope, lookup)),
    ilal: lexeme.ilal.map((_, i) => markedTokens(mk.ilal[i], scope, lookup)),
  };
}

/**
 * Sharaf for a word's lemma: the tashrif row (Amtsilah at-Tashrifiyyah
 * order) and how the written form came about (i'lal). These are
 * MORPHOLOGICAL forms, not Qur'anic text — rendered in a plain Arabic face
 * (`.arabic-inline`), never mushaf-styled, and labelled as such (plan §4.7).
 * A nested disclosure: collapsed inside a word card, open by default on the
 * Kosakata page where it is the main content. With `tokens`, its terms and
 * Qur'anic words carry their Arabic (the bab's "bab (بَاب)", "fi'il madhi
 * (فِعْل مَاضٍ)", the i'lal rule's nasta‘īnu).
 */
export function SharafPanel({
  lexeme,
  labels,
  defaultOpen = false,
  tokens = null,
}: {
  lexeme: Lexeme;
  labels: SharafLabels;
  defaultOpen?: boolean;
  tokens?: SharafTokens | null;
}) {
  if (!lexeme.tashrif && lexeme.ilal.length === 0) return null;
  return (
    <details open={defaultOpen} className="mt-3 rounded-xl border border-hairline bg-white">
      <summary className="disclosure-row px-4 text-ink">
        <span>
          <MixedText text={labels.heading} />
        </span>
        <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
      </summary>
      <div className="space-y-5 px-4 pb-4">
        {lexeme.tashrif && (
          <div>
            <p className="text-sm text-ink-muted">
              <Prose tokens={tokens?.bab ?? null} plain={lexeme.tashrif.bab} />
            </p>
            <table className="mt-2 w-full text-left">
              <tbody>
                {lexeme.tashrif.forms.map((f, i) => (
                  <tr key={f.label} className="border-t border-hairline first:border-t-0">
                    <th scope="row" className="py-2 pr-3 text-left text-sm font-normal text-ink-muted">
                      <Prose tokens={tokens?.labels[i] ?? null} plain={f.label} />
                    </th>
                    <td lang="ar" dir="rtl" className="arabic-inline py-1 text-right text-ar-sm text-ink">
                      {f.ar}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-ink-muted">
              <MixedText text={labels.forms_note} />
            </p>
          </div>
        )}
        {lexeme.ilal.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-ink">{labels.ilal}</p>
            <ul className="mt-2 space-y-4">
              {lexeme.ilal.map((x, i) => (
                <li key={`${x.from}-${x.to}`}>
                  {/* Two groups that wrap as wholes: "asal <form> →" and "menjadi
                      <form>", so the arrow never starts a row and a label never
                      sits a row away from its form (line breaks, 2026-10-10). */}
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
                    <span className="inline-flex items-baseline gap-x-2">
                      <span>{labels.ilal_from}</span>
                      <bdi lang="ar" dir="rtl" className={`arabic-inline text-ar-sm text-ink ${arTall(x.from)}`}>
                        {x.from}
                      </bdi>
                      <span aria-hidden="true">→</span>
                    </span>
                    <span className="inline-flex items-baseline gap-x-2">
                      <span>{labels.ilal_to}</span>
                      <bdi lang="ar" dir="rtl" className={`arabic-inline text-ar-sm text-ink ${arTall(x.to)}`}>
                        {x.to}
                      </bdi>
                    </span>
                  </p>
                  <p className="mt-1 text-pretty text-base text-ink-muted">
                    <Prose tokens={tokens?.ilal[i] ?? null} plain={x.rule} emphasis="meaning" />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
