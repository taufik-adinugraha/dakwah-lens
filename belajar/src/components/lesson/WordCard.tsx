import type { Lexeme, Word } from "@/content/schema";
import { Link } from "@/i18n/navigation";

import { SharafPanel, type SharafLabels } from "../library/SharafPanel";
import { CaseBadge } from "./CaseBadge";
import { DraftChip } from "./DraftChip";

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
  draft: string;
};

/**
 * One word of an ayah: meaning, root, pattern, case (colour + shape) and the
 * ONE-sentence reason for its ending. Alternatives scholars hold sit behind a
 * collapsed "Pendapat lain" chip so beginners see one clear reading first
 * (plan §8). Every card lists its sources.
 */
export function WordCard({
  word,
  labels,
  lexeme,
  concepts = [],
}: {
  word: Word;
  labels: WordCardLabels;
  /** The lemma's shared Kosakata entry (tashrif, i'lal), when present. */
  lexeme?: Lexeme;
  /** Concepts this word illustrates (Konsep library), resolved by the page. */
  concepts?: { id: string; title: string }[];
}) {
  const id = `w-${word.loc.replaceAll(":", "-")}`;
  return (
    <article
      id={id}
      className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-faint">{word.loc}</p>
          <p className="mt-0.5 text-sm italic text-ink-muted">{word.translit}</p>
        </div>
        <p lang="ar" dir="rtl" className="quran shrink-0 text-3xl leading-[1.8] text-ink">
          {word.ar}
        </p>
      </div>

      <p className="mt-2 font-display text-lg font-medium leading-snug">
        <span className="sr-only">{labels.meaning}: </span>
        {word.gloss}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {word.role ? (
          <span className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-ink">
            <span className="sr-only">{labels.role}: </span>
            {word.role}
          </span>
        ) : null}
        <CaseBadge state={word.case.state} sign={word.case.sign} />
        {word.case.mahall ? (
          <span className="text-xs text-ink-muted">({word.case.mahall})</span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">{labels.root}</dt>
        <dd>
          {word.root ? (
            <span lang="ar" dir="rtl" className="quran text-lg leading-none">
              {word.root.join(" ")}
            </span>
          ) : (
            <span className="text-ink-faint">{labels.no_root}</span>
          )}
        </dd>
        {word.wazn ? (
          <>
            <dt className="text-ink-muted">{labels.wazn}</dt>
            <dd lang="ar" dir="rtl" className="quran text-left text-lg leading-none">
              {word.wazn}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3 rounded-xl bg-paper-deep p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {labels.why}
        </p>
        <p className="mt-1 text-pretty text-sm leading-relaxed">{word.why}</p>
      </div>

      {lexeme ? <SharafPanel lexeme={lexeme} labels={labels.sharaf} /> : null}

      {(concepts.length > 0 || lexeme) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          {concepts.length > 0 && <span className="text-ink-muted">{labels.concepts}:</span>}
          {concepts.map((c) => (
            <Link
              key={c.id}
              href={`/konsep/${c.id}`}
              className="rounded-full bg-forest-tint px-2 py-0.5 font-medium text-forest hover:bg-forest hover:text-paper"
            >
              {c.title}
            </Link>
          ))}
          {lexeme ? (
            <Link href={`/kosakata/${lexeme.id}`} className="ml-auto text-forest underline decoration-forest/30 underline-offset-2">
              {labels.lemma} →
            </Link>
          ) : null}
        </div>
      )}

      {word.ikhtilaf.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">
            {labels.other_views}
          </summary>
          <ul className="mt-2 space-y-1.5 text-ink-muted">
            {word.ikhtilaf.map((x) => (
              <li key={x.point}>
                <span className="font-medium text-ink">{x.point}:</span> {x.options.join(" · ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-auto pt-3">
        <p className="text-[11px] text-ink-faint">
          {labels.sources}:{" "}
          {word.sources
            .map((s) => (s.ref ? `${s.kitab} ${s.ref}` : s.kitab))
            .join(" · ")}
        </p>
        {word.status === "draft" ? <DraftChip label={labels.draft} /> : null}
      </div>
    </article>
  );
}
