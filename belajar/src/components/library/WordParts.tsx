import { ArrowDown, ArrowRight, Plus } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { letters, type PartsChange, type PreparedParts } from "@/lib/terms";

import { MarkCircle } from "./MarkCircle";
import { TermText } from "./TermText";

export type WordPartsLabels = {
  /** "Bagian-bagian kata" (sr-only list label). */
  parts: string;
  /** Where a change is, from its place in the part: "Akhir ismu berubah", "Huruf pertama -hum
   *  berubah" (review 2026-10-10: never "the ending changes" for a first letter). */
  change: (c: PartsChange) => string;
  /** "tidak ditulis" (a letter of a part the word does not write) */
  notWritten: string;
};

/**
 * A word explained by its parts (operator 2026-10-10, narration rule 14): [بِ] + [ٱسْمُ] → [بِسْمِ]
 * as calm STATIC tiles — the lesson stage's composition animation (a separate branch) can take
 * this component's place later; the data shape is the same. The parts run right to left, as the
 * word is written, so بِ sits on the right of the row exactly where it sits in بِسْمِ; the joined
 * word sits under them after a down arrow, so no "+" or arrow is ever left dangling at a line end
 * (rule 15). On a phone the parts stack, one per line with "+" between them. Letters the joined
 * word does not write (the alif of ٱسْمُ; the alif and lam of al- in لِلَّهِ) are shown faded; each
 * is an alif or the lam right after al-'s alif, so cutting them out of the tile changes no other
 * letter's shape. Each change is named by where it is, shown on dotted circles with its names and
 * sounds, then the steps (which give each part's meaning with "yang artinya").
 */
export function WordParts({ data, labels }: { data: PreparedParts; labels: WordPartsLabels }) {
  return (
    <figure className="rounded-2xl border-[1.5px] border-teal-line bg-paper p-4 sm:p-6">
      <div role="group" aria-label={labels.parts} className="flex flex-col items-center gap-2">
        <div dir="rtl" className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
          {data.tiles.map((t, i) => (
            <Fragment key={i}>
              {i > 0 ? <Plus aria-hidden className="h-6 w-6 shrink-0 text-ink-soft" /> : null}
              <Tile ar={t.ar} dropped={t.dropped} translit={t.translit} notWritten={labels.notWritten}>
                <TermText tokens={t.label} links={false} />
              </Tile>
            </Fragment>
          ))}
        </div>
        <ArrowDown aria-hidden className="h-7 w-7 shrink-0 text-forest" />
        <Tile ar={data.word.ar} translit={data.word.translit} result />
      </div>
      <p className="mt-3 text-center text-base text-ink-muted">
        <span className="whitespace-nowrap">{data.tiles.map((t) => t.translit).join(" + ")}</span>{" "}
        <span className="whitespace-nowrap">→ {data.word.translit}</span>
      </p>

      {data.changes.map((c, i) => (
        <div key={i} className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-4">
          <span className="text-center text-base font-semibold text-ink">{labels.change(c)}:</span>
          <span className="flex flex-col items-center gap-1 sm:flex-row sm:gap-3">
            <ChangeMark c={c} side="from" />
            <ArrowDown aria-hidden className="h-6 w-6 shrink-0 text-forest sm:hidden" />
            <ArrowRight aria-hidden className="hidden h-6 w-6 shrink-0 text-forest sm:block" />
            <ChangeMark c={c} side="to" />
          </span>
        </div>
      ))}

      <ol className="mt-5 max-w-prose space-y-2 text-pretty text-base text-ink">
        {data.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest-tint text-sm font-semibold text-forest">
              {i + 1}
            </span>
            <span>
              <TermText tokens={s} />
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Tile({
  ar,
  dropped = [],
  translit,
  result = false,
  notWritten,
  children,
}: {
  ar: string;
  dropped?: number[];
  translit: string;
  result?: boolean;
  notWritten?: string;
  children?: ReactNode;
}) {
  const ls = letters(ar);
  return (
    <div
      dir="ltr"
      className={`flex min-w-[6.5rem] max-w-full flex-col items-center rounded-xl bg-white px-4 py-2 text-center ${
        result ? "stage-card" : "border-[1.5px] border-teal-line"
      }`}
    >
      <span lang="ar" dir="rtl" className="quran text-ar-xl whitespace-nowrap text-ink">
        {dropped.length
          ? ls.map((l, j) =>
              dropped.includes(j + 1) ? (
                <span key={j} className="text-ink-soft opacity-50" title={notWritten}>
                  {l}
                </span>
              ) : (
                <Fragment key={j}>{l}</Fragment>
              ),
            )
          : ar}
      </span>
      <span className="text-base font-semibold text-ink">{translit}</span>
      {children ? <span className="text-sm text-ink-muted">{children}</span> : null}
      {dropped.length && notWritten ? <span className="sr-only">{notWritten}</span> : null}
    </div>
  );
}

/** One side of a change: a vowel alone on its dotted circle with its name and sound, or (a
 *  letter change) the whole letter with its Latin name. */
function ChangeMark({ c, side }: { c: PartsChange; side: "from" | "to" }) {
  const mark = side === "from" ? c.from : c.to;
  const term = side === "from" ? c.fromTerm : c.toTerm;
  const sound = side === "from" ? c.fromSound : c.toSound;
  const name = side === "from" ? c.fromName : c.toName;
  return (
    <span className="inline-flex items-center gap-2">
      <MarkCircle mark={mark} size="sm" letter={c.kind === "letter"} />
      <span className="whitespace-nowrap text-base text-ink">
        {c.kind === "letter" && name ? `${name}${term ? " " : ""}` : null}
        {term ? (
          <>
            {term.latin}
            {term.ar ? (
              <>
                {" ("}
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-forest">
                  {term.ar}
                </bdi>
                )
              </>
            ) : null}
          </>
        ) : null}
        {sound ? <span className="text-ink-muted"> · {sound}</span> : null}
      </span>
    </span>
  );
}
