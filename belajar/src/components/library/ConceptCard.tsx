import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Concept } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { WORD_INFO } from "@/lib/content";
import { surahPublished } from "@/lib/features";
import { getBasic, parseLoc, partsFor, TERMS } from "@/lib/library";
import { ayahHref, conceptHref } from "@/lib/routes";
import { annotate, noteWithoutWord, type PartsChange, prepareParts, Scope, soundsOf, titleParts, type Token } from "@/lib/terms";

import { MixedText } from "./MixedText";
import { SourcesDisclosure } from "./SourceList";
import { Headword, HARAKAT_PAGE, TermText } from "./TermText";
import { WordParts } from "./WordParts";

export type ConceptLabels = {
  nahwu: string;
  sharaf: string;
  bridge: string;
  examples: string;
  more: string;
  sources: string;
};

/** Example rows shown before "Lihat N contoh lainnya" (idhafah has 22): less clutter. */
const EXAMPLES_SHOWN = 6;
/** Parts diagrams shown before "Lihat N kata lainnya" (huruf-jar has five). */
const PARTS_SHOWN = 2;
const SOUNDS = soundsOf(getBasic(HARAKAT_PAGE)?.signs ?? []);
const plain = (text: string): Token[] => [{ kind: "text", text }];

/**
 * One nahwu/sharaf idea, explained once and reused wherever it appears.
 * `compact`: the summary + a link (inside lessons); `page`: the concept's own page (h1, the
 * lesson stage's card and shadow, words explained by their parts, every example, Rujukan).
 *
 * Grammar terms and Qur'anic words show their Arabic at their first use in the card (or in the
 * page's `scope`), e.g. majrur and bismi with their Arabic in brackets; the title's terms form the Arabic
 * headword under it (operator 2026-10-10). Example rows show the word as the ayah writes it, its
 * transliteration and "yang artinya …", all from the lesson content (WORD_INFO), then the note.
 * No per-card AI chip (narration rule 12: the page footer carries the label).
 */
export function ConceptCard({
  concept,
  labels,
  surahs,
  wordAr,
  compact = false,
  page = false,
  scope,
}: {
  concept: Concept;
  labels: ConceptLabels;
  /** Surah number → slug + name (examples may come from any lesson surah). */
  surahs: Record<number, { slug: string; name: string }>;
  /** Arabic of each example word, keyed by loc (resolved by the page; WORD_INFO when it has it). */
  wordAr: Record<string, string>;
  compact?: boolean;
  /** The concept's own page: h1, stage card, parts diagrams. */
  page?: boolean;
  /** First-use scope shared with the rest of the page (a new one per card by default). */
  scope?: Scope;
}) {
  const t = useTranslations("Concept");
  const sc = scope ?? new Scope();
  const mk = concept.marked;
  // Annotated in reading order, so "first use" is the first one the reader meets.
  const title = mk ? titleParts(mk.title, sc, TERMS, SOUNDS) : { tokens: plain(concept.title), head: [] };
  const summary = mk ? annotate(mk.summary, sc, TERMS) : plain(concept.summary);
  const explanation = compact ? [] : (mk?.explanation ?? concept.explanation).map((p) => (mk ? annotate(p, sc, TERMS) : plain(p)));
  const parts = page
    ? partsFor(concept.id).flatMap((p) => {
        const w = WORD_INFO[p.loc];
        return w ? [prepareParts(p, w, sc, TERMS, SOUNDS)] : [];
      })
    : [];
  const bridge = concept.bridge ? (mk?.bridge ? annotate(mk.bridge, sc, TERMS) : plain(concept.bridge)) : null;
  const examples = compact
    ? []
    : concept.examples.flatMap((ex, i) => {
        const { surah, ayah, word } = parseLoc(ex.loc);
        const s = surahs[surah];
        // An example from a surah with no lesson yet has nowhere to link.
        if (!s) return [];
        const info = WORD_INFO[ex.loc];
        const ar = info?.ar ?? wordAr[ex.loc];
        sc.shown.add(`q:${ex.loc}`); // the row shows the word in Arabic itself
        const raw = mk?.notes[i] ?? ex.note;
        const note = mk ? annotate(info ? noteWithoutWord(raw, info.translit) : raw, sc, TERMS) : plain(ex.note);
        return [{ ex, s, ayah, word, info, ar, note }];
      });

  const partsLabels = {
    parts: t("parts_heading"),
    notWritten: t("parts_not_written"),
    change: (c: PartsChange) =>
      c.where === "end"
        ? t("parts_change_end", { part: c.part })
        : c.where === "first"
          ? t("parts_change_first", { part: c.part })
          : c.where === "only"
            ? t("parts_change_only", { part: c.part })
            : t("parts_change_nth", { part: c.part, n: c.n }),
  };

  const Title = page ? "h1" : "h3";
  const kind = concept.kind === "nahwu" ? labels.nahwu : labels.sharaf;

  return (
    <article
      className={
        // Compact, in a lesson's "Pelajari lebih dalam" row (a @container): narrow padding while
        // that row is under 16rem (from Besar up on a phone), so its words fit (CI 2026-10-11).
        page ? "stage-card p-5 sm:p-8" : "flex h-full flex-col rounded-2xl border border-hairline bg-white p-3 @3xs:p-5"
      }
    >
      {page ? <p className="text-sm font-semibold text-forest">{kind}</p> : null}
      <Title
        className={
          page
            ? "mt-1 text-balance font-display text-3xl font-medium text-ink sm:text-4xl"
            : "font-display text-xl font-medium text-ink"
        }
      >
        <TermText tokens={title.tokens} />
      </Title>
      <Headword head={title.head} className={page ? "mt-2 text-ar-lg" : "mt-1 text-ar-sm"} />
      <p className={`max-w-prose text-pretty text-ink ${page ? "mt-4 text-lg" : "mt-2 text-base"}`}>
        <TermText tokens={summary} />
      </p>

      {explanation.length > 0 && (
        <div className="mt-5 max-w-prose space-y-4 text-pretty text-base text-ink">
          {explanation.map((p, i) => (
            <p key={i}>
              <TermText tokens={p} />
            </p>
          ))}
        </div>
      )}

      {parts.length > 0 && (
        <section className="mt-8" aria-labelledby={`parts-${concept.id}`}>
          <h2 id={`parts-${concept.id}`} className="font-display text-2xl font-medium text-ink">
            <MixedText text={t("parts_heading")} />
          </h2>
          <div className="mt-3 space-y-5">
            {parts.slice(0, PARTS_SHOWN).map((p) => (
              <WordParts key={p.loc} data={p} labels={partsLabels} />
            ))}
          </div>
          {parts.length > PARTS_SHOWN && (
            <details className="mt-3 border-t border-hairline">
              <summary className="disclosure-row text-forest">
                <span>{t("parts_more", { n: parts.length - PARTS_SHOWN })}</span>
                <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0" />
              </summary>
              <div className="space-y-5 pb-2">
                {parts.slice(PARTS_SHOWN).map((p) => (
                  <WordParts key={p.loc} data={p} labels={partsLabels} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {bridge && (
        <p className={`mt-6 max-w-prose rounded-xl bg-paper-deep text-base text-ink ${page ? "p-4" : "px-2 py-3 @3xs:p-4"}`}>
          <span className="font-semibold">{labels.bridge}:</span> <TermText tokens={bridge} />
        </p>
      )}

      {examples.length > 0 && (
        <section className="mt-8" aria-labelledby={`examples-${concept.id}`}>
          <h2 id={`examples-${concept.id}`} className={page ? "font-display text-2xl font-medium text-ink" : "text-sm font-semibold text-ink"}>
            {labels.examples}
          </h2>
          <ul className="mt-2">
            {examples.slice(0, EXAMPLES_SHOWN).map((r) => (
              <ExampleRow key={r.ex.loc} row={r} meaning={t("meaning")} locLabel={t("example_loc", { surah: r.s.name, ayah: r.ayah, word: r.word })} />
            ))}
          </ul>
          {examples.length > EXAMPLES_SHOWN && (
            <details className="border-t border-hairline">
              <summary className="disclosure-row text-forest">
                <span>{t("more_examples", { n: examples.length - EXAMPLES_SHOWN })}</span>
                <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0" />
              </summary>
              <ul>
                {examples.slice(EXAMPLES_SHOWN).map((r) => (
                  <ExampleRow key={r.ex.loc} row={r} meaning={t("meaning")} locLabel={t("example_loc", { surah: r.s.name, ayah: r.ayah, word: r.word })} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <div className="mt-auto pt-3">
        {compact ? (
          <Link href={conceptHref(concept.id)} className="chip-link">
            {labels.more}
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        ) : (
          <SourcesDisclosure sources={concept.sources} label={labels.sources} className="mt-4" />
        )}
      </div>
    </article>
  );
}

function ExampleRow({
  row,
  meaning,
  locLabel,
}: {
  row: {
    ex: { loc: string };
    s: { slug: string };
    ayah: number;
    info?: { translit: string; gloss: string };
    ar?: string;
    note: Token[];
  };
  meaning: string;
  locLabel: string;
}) {
  const { s } = row;
  return (
    <li className="border-t border-hairline py-4 first:border-t-0">
      <p className="flex flex-wrap items-baseline gap-x-3">
        {row.ar ? (
          <span lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
            {row.ar}
          </span>
        ) : null}
        {row.info ? (
          // One text through MixedText (rule 15, CI 2026-10-11): "orang-orang" and "aḍ-ḍāllīna"
          // are never cut, the comma stays on the word and the quote on the gloss; the
          // transliteration is set bold as an overlay.
          <span className="text-base text-ink">
            <MixedText
              text={`${row.info.translit}, ${meaning} “${row.info.gloss}”`}
              overlays={[{ from: 0, to: row.info.translit.length, wrap: (w) => <span className="font-semibold">{w}</span> }]}
            />
          </span>
        ) : null}
      </p>
      <p className="mt-1 max-w-prose text-pretty text-base text-ink">
        <TermText tokens={row.note} />
      </p>
      {/* A surah not published yet (BELAJAR_SURAHS, operator 2026-10-10) has no lesson to open:
          its place is plain text. The page awaits visibleSurahs() first. */}
      {surahPublished(s.slug) ? (
        <Link href={ayahHref(s.slug, row.ayah, row.ex.loc)} className="chip-link mt-2">
          {locLabel}
        </Link>
      ) : (
        <span className="mt-2 block text-sm font-medium text-ink-muted">{locLabel}</span>
      )}
    </li>
  );
}
