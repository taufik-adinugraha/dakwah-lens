import type { ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Lexeme, Word } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { parseLoc } from "@/lib/library";
import { conceptHref, lexemeHref, wordAnchorId } from "@/lib/routes";

import { MixedText } from "../library/MixedText";
import { SharafPanel, type SharafLabels } from "../library/SharafPanel";
import { SourceList } from "../library/SourceList";
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
 */
export function WordCard({
  word,
  labels,
  lexeme,
  concepts = [],
  listen,
}: {
  word: Word;
  labels: WordCardLabels;
  /** The lemma's shared Kosakata entry (tashrif, i'lal), when present. */
  lexeme?: Lexeme;
  /** Concepts this word illustrates (Konsep library), resolved by the page. */
  concepts?: { id: string; title: string }[];
  /** Optional play control for this word (a labelled "Dengar" button),
   *  supplied by a client parent that owns the player; shown beside
   *  "Kata ke-N". The card itself has no audio. */
  listen?: ReactNode;
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
      <p className="mt-2 font-display text-lg font-medium text-ink">
        <span className="sr-only">{labels.meaning}: </span>
        <MixedText text={word.gloss} />
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{t("ending")}:</span>
        <CaseBadge state={word.case.state} sign={sign} />
      </div>

      <div className="mt-3 rounded-xl bg-paper-deep p-4">
        <p className="text-sm font-semibold text-ink">{whyHeading}</p>
        <p className="mt-1 text-pretty text-base text-ink">
          <MixedText text={word.why} />
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
                    <MixedText text={word.role} />
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
                    <MixedText text={word.wazn} />
                  </dd>
                </div>
              ) : null}
              {word.case.mahall ? (
                <div>
                  <dt className="text-sm font-semibold text-ink-muted">{t("mahall")}</dt>
                  <dd className="text-base text-ink">
                    {t("mahall_plain", { pos: mahallPos(word.case.mahall) })}
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
                      </Link>
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

            {lexeme ? <SharafPanel lexeme={lexeme} labels={labels.sharaf} /> : null}

            {word.ikhtilaf.length > 0 && (
              <details className="rounded-xl border border-hairline bg-white">
                <summary className="disclosure-row px-4 text-ink">
                  <span>{t("other_views_toggle", { n: word.ikhtilaf.length })}</span>
                  <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
                </summary>
                <ul className="space-y-3 px-4 pb-4 text-base text-ink-muted">
                  {word.ikhtilaf.map((x) => (
                    <li key={x.point}>
                      {/* The colon inside the text, so no line starts with it; the
                          " · " between the options stays with the option before it. */}
                      <span className="font-semibold text-ink">
                        <MixedText text={`${x.point}:`} />
                      </span>{" "}
                      <MixedText text={x.options.join(" · ")} />
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
