import type { ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Lexeme, Word } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { caseLabelMarked, mahallMarked } from "@/lib/cases";
import { parseLoc } from "@/lib/library";
import { conceptHref, lexemeHref, wordAnchorId } from "@/lib/routes";
import { annotate, type Lookup, markedTokens, Scope, type Token } from "@/lib/terms";

import { MixedText } from "../library/MixedText";
import { SharafPanel, sharafTokens, type SharafLabels } from "../library/SharafPanel";
import { SourceList } from "../library/SourceList";
import { Prose } from "../library/TermText";
import { CaseBadge } from "./CaseBadge";

export type WordCardLabels = {
  role: string;
  concepts: string;
  lemma: string;
  sharaf: SharafLabels;
  meaning: string;
  root: string;
  wazn: string;
  why: string;
  other_views: string;
  sources: string;
  no_root: string;
};

/** Signs that are harakat ("dibaca kasrah") vs letters ("memakai huruf
 *  ya'"); anything longer ("dibuangnya huruf 'illah") gets the plain
 *  heading so it never reads as a broken sentence. */
const HARAKAT = new Set(["dhammah", "fathah", "kasrah", "sukun", "dhammatain", "fathatain", "kasratain"]);
const LETTERS = new Set(["ya'", "wawu", "waw", "alif", "nun"]);

/** "mahall nashb" → "nashab": the position in the spelling the lessons use. */
const MAHALL_POS: Record<string, string> = {
  nashb: "nashab",
  jarr: "jar",
  "raf'": "rafa'",
  jazm: "jazm",
};
function mahallPos(mahall: string): string {
  const key = mahall.replace(/^mahall\s+/i, "").trim();
  return MAHALL_POS[key] ?? key;
}

/**
 * One word of an ayah, simplified for older learners (senior-ux §3.6).
 * Collapsed by default to what a beginner needs: the word, how to say it,
 * what it means, how it ends and the ONE-sentence reason why. Everything
 * else — role, root, wazan, kedudukan, concepts, sharaf, other scholars'
 * views and the full Rujukan list — sits behind one labelled tap that shows
 * the source count, so every citation stays one tap away (AGENTS.md).
 *
 * Arabic with every term and Qur'anic word (operator 2026-10-12, on ‘alaihim's card: "better to
 * write the arabic words, not only the transliteration"): a word of a marked lesson
 * (`word.marked`, pipeline/build_surah.py) draws its prose from the marked twins, each term and
 * Qur'anic word, part or letter with its Arabic at its FIRST use on the card — the card is one
 * scope, read top to bottom: the case chip ("majrūr (مَجْرُور) · kasrah (كَسْرَة)"), the reason, the
 * details. The word itself is shown large at the top, so its own name is not repeated. No harakah
 * reminders on a card (less clutter): the chip right above the reason names the sign in Arabic.
 * Concept chips carry their Arabic headword, as the Konsep page's related chips do.
 */
export function WordCard({
  word,
  labels,
  lexeme,
  concepts = [],
  listen,
  lookup,
}: {
  word: Word;
  labels: WordCardLabels;
  /** The lemma's shared Kosakata entry (tashrif, i'lal), when present. */
  lexeme?: Lexeme;
  /** Concepts this word illustrates (Konsep library), resolved by the page, with the Arabic
   *  headword of each title — and, for a concept an earlier ayah already taught, `taught`: the
   *  short line shown under its chip, "sudah dipelajari di ayat 1" (the lesson map, plan L23;
   *  only in a surah that has one). Text only: nothing here is spoken. */
  concepts?: { id: string; title: string; head?: string | null; taught?: string | null }[];
  /** Optional play control for this word (a labelled "Dengar" button),
   *  supplied by a client parent that owns the player; shown beside
   *  "Kata ke-N". The card itself has no audio. */
  listen?: ReactNode;
  /** Terms and the lesson's Qur'anic bytes (src/lib/terms.ts lessonLookup): with it, a marked
   *  word draws its Arabic. */
  lookup?: Lookup;
}) {
  const t = useTranslations("Word");
  const id = wordAnchorId(word.loc);
  const n = parseLoc(word.loc).word;
  const sign = word.case.sign;
  const whyHeading = HARAKAT.has(sign)
    ? t("why_sign", { sign })
    : LETTERS.has(sign)
      ? t("why_letter", { sign })
      : labels.why;
  const sourceCount = `${labels.sources} (${word.sources.length})`;

  // The card's prose in reading order, each field's tokens annotated in ONE scope (first use).
  const mk = lookup ? word.marked : undefined;
  const sc = new Scope(false);
  sc.shown.add(`q:${word.loc}`); // the word itself is shown above, as the ayah writes it
  const tok = (marked: string | undefined) => (lookup ? markedTokens(marked, sc, lookup) : null);
  const badge = mk && lookup
    ? {
        label: annotate(caseLabelMarked(word.case.state), sc, lookup),
        sign: sign !== "—" ? markedTokens(mk.sign, sc, lookup) : null,
      }
    : null;
  const why = tok(mk?.why);
  const role = word.role ? tok(mk?.role) : null;
  const wazn = word.wazn ? tok(mk?.wazn) : null;
  const mahall = word.case.mahall ? mahallMarked(word.case.mahall) : null;
  const mahallText = word.case.mahall
    ? mk && lookup && mahall
      ? { tokens: annotate(t("mahall_plain", { pos: mahall }), sc, lookup), plain: "" }
      : { tokens: null as Token[] | null, plain: t("mahall_plain", { pos: mahallPos(word.case.mahall) }) }
    : null;
  const sharaf = lexeme && mk && lookup ? sharafTokens(lexeme, sc, lookup) : null;
  const ikhtilaf = word.ikhtilaf.map((x, i) => {
    const y = mk?.ikhtilaf[i];
    return { point: tok(y ? `${y.point}:` : undefined), options: x.options.map((_, j) => tok(y?.options[j])) };
  });

  return (
    <article id={id} className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-muted">{t("word_n", { n })}</p>
        {listen ?? null}
      </div>

      <p lang="ar" dir="rtl" className="quran mt-1 text-ar-lg text-ink">
        {word.ar}
      </p>
      <p className="text-sm text-ink-muted">{word.translit}</p>
      {/* The meaning bold in forest (operator 2026-10-11: "use bold text or different color to
          highlight the meanings"; 8.3:1 on white). */}
      <p data-emph="meaning" className="mt-2 font-display text-lg font-semibold text-forest">
        <span className="sr-only">{labels.meaning}: </span>
        <MixedText text={word.gloss} />
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{t("ending")}:</span>
        {badge ? (
          <CaseBadge state={word.case.state} labelTokens={badge.label} signTokens={badge.sign} />
        ) : (
          <CaseBadge state={word.case.state} sign={sign} />
        )}
      </div>

      <div className="mt-3 rounded-xl bg-paper-deep p-4">
        <p className="text-sm font-semibold text-ink">{whyHeading}</p>
        <p className="mt-1 text-pretty text-base text-ink">
          <Prose tokens={why} plain={word.why} emphasis />
        </p>
      </div>

      <div className="mt-auto pt-3">

        <details className="group/word mt-3">
          <summary className="disclosure-row rounded-xl border-[1.5px] border-border-ui bg-white px-4 text-ink hover:border-forest">
            <span className="flex flex-col py-2">
              <span className="group-open/word:hidden">{t("details_toggle")}</span>
              <span className="hidden group-open/word:inline">{t("details_close")}</span>
              {/* Own line: on a phone a trailing " · Rujukan (7)" wrapped with
                  the dot stranded at the end of the first line. */}
              <span className="text-sm font-normal text-ink-muted">{sourceCount}</span>
            </span>
            <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
          </summary>

          <div className="mt-4 space-y-5">
            <dl className="space-y-3">
              {word.role ? (
                <div>
                  <dt className="text-sm font-semibold text-ink-muted">{labels.role}</dt>
                  <dd className="text-base text-ink">
                    <Prose tokens={role} plain={word.role} emphasis="meaning" />
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-sm font-semibold text-ink-muted">{labels.root}</dt>
                <dd className="text-base text-ink">
                  {word.root ? (
                    <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
                      {word.root.join(" ")}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">{labels.no_root}</span>
                  )}
                </dd>
              </div>
              {word.wazn ? (
                <div>
                  <dt className="text-sm font-semibold text-ink-muted">{labels.wazn}</dt>
                  <dd className="text-base text-ink">
                    <Prose tokens={wazn} plain={word.wazn} />
                  </dd>
                </div>
              ) : null}
              {mahallText ? (
                <div>
                  <dt className="text-sm font-semibold text-ink-muted">{t("mahall")}</dt>
                  <dd className="text-base text-ink">
                    {mahallText.tokens ? <Prose tokens={mahallText.tokens} plain="" /> : mahallText.plain}
                  </dd>
                </div>
              ) : null}
            </dl>

            {(concepts.length > 0 || lexeme) && (
              <div>
                {concepts.length > 0 && (
                  <p className="text-sm font-semibold text-ink-muted">{labels.concepts}</p>
                )}
                <ul className="mt-2 flex flex-wrap gap-2">
                  {concepts.map((c) => (
                    <li key={c.id}>
                      <Link href={conceptHref(c.id)} className="chip-link">
                        <span>
                          <MixedText text={c.title} />
                        </span>
                        {c.head ? (
                          <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-forest">
                            {c.head}
                          </bdi>
                        ) : null}
                      </Link>
                      {/* Under its chip, in the flow: it wraps with the column, never beside the chip. */}
                      {c.taught ? (
                        <p data-concept-taught={c.id} className="mt-1 px-4 text-sm text-ink-muted">
                          {c.taught}
                        </p>
                      ) : null}
                    </li>
                  ))}
                  {lexeme ? (
                    <li>
                      <Link href={lexemeHref(lexeme.id)} className="chip-link">
                        {labels.lemma}
                        <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </div>
            )}

            {lexeme ? <SharafPanel lexeme={lexeme} labels={labels.sharaf} tokens={sharaf} /> : null}

            {word.ikhtilaf.length > 0 && (
              // Narrower sides while the word grid (a @container) is narrow: inside the card, inside
              // "Materi lengkap", the 202px left at Sangat besar on a phone is narrower than
              // "membolehkannya," (rule 15, 2026-10-11: the column holds the word, nothing cuts it).
              <details className="rounded-xl border border-hairline bg-white">
                <summary className="disclosure-row px-3 text-ink @2xs:px-4">
                  <span>{t("other_views_toggle", { n: word.ikhtilaf.length })}</span>
                  <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
                </summary>
                <ul className="space-y-3 px-3 pb-4 text-base text-ink-muted @2xs:px-4">
                  {word.ikhtilaf.map((x, i) => (
                    <li key={x.point}>
                      {/* The colon inside the text, so no line starts with it; each option
                          on its own line (rule 15, 2026-10-11: a " · " join could start a line
                          at Sangat besar, and a list is easier to read). */}
                      <span className="font-semibold text-ink">
                        <Prose tokens={ikhtilaf[i].point} plain={`${x.point}:`} emphasis="meaning" />
                      </span>
                      {/* No indent: at Sangat besar on a phone the column is already the width of
                          its longest word ("membolehkannya,"). */}
                      <ul className="mt-1 space-y-1">
                        {x.options.map((o, j) => (
                          <li key={o}>
                            {/* A scholars' reading glosses what it reads (“aku memulai”): the
                                meaning forest, as in the explanation above (plan L22). */}
                            <Prose tokens={ikhtilaf[i].options[j]} plain={o} emphasis="meaning" />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div>
              <p className="text-sm font-semibold text-ink">{sourceCount}</p>
              <div className="mt-1">
                <SourceList sources={word.sources} />
              </div>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}
