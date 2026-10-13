import { ArrowDown, ArrowRight, Plus } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { type Clip, clipFor, clipKey } from "@/lib/clips";
import { hasWaqfNote } from "@/lib/heard";
import { letters, type PartsChange, type PreparedParts, soundAfterSign } from "@/lib/terms";

import { ClipButton } from "./ClipButton";
import { ClipNote, clipNoteId } from "./ClipNote";
import { MarkCircle } from "./MarkCircle";
import { MixedText } from "./MixedText";
import { TermText } from "./TermText";

export type WordPartsLabels = {
  /** "Bagian-bagian kata" (sr-only list label). */
  parts: string;
  /** Where a change is, from its place in the part: "Akhir ismu berubah", "Huruf pertama -hum
   *  berubah" (review 2026-10-10: never "the ending changes" for a first letter). */
  change: (c: PartsChange) => string;
  /** "tidak ditulis" (a letter of a part the word does not write) */
  notWritten: string;
  /** Under a voice button whose word ends its ayah: "Di akhir ayat imam berhenti (waqaf), …". */
  waqf: string;
  /** Under the voice of a tile played with the word before it: "Di tengah bacaan, alif di awal
   *  kata ini tidak dibaca: bersama kata sebelumnya terdengar “tabārakasmu”." */
  washal: (heard: string) => string;
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
 *
 * The imam's voice (operator 2026-10-12: "ismu (read by voice + show visual) when combined with
 * harf jar, it becomes ismi (read by voice + visual)"): a tile that is a whole word — the part's
 * bentuk dasar as an ayah writes it, ٱسْمُ of QS 55:78 — carries "▶ Dengarkan" with that word's
 * recitation, and so does the joined word (بِسْمِ, the ayah's own); a part that is only a piece of
 * a word (bi-, -hum) has none, since no imam recites it alone (pipeline/clips.py). `clips`:
 * library.json's (src/lib/clips.ts), played by the page's ClipPlayerProvider.
 *
 * What is HEARD (review 2026-10-12): ٱسْمُ cut alone from tabāraka-smu played "smu", because in
 * mid-recitation its hamzat washal is not read — the very thing step 3 of the diagram explains
 * ("Alif di awal ismu adalah hamzah washal: ia hanya dibaca bila bacaan dimulai dari kata itu").
 * Such a tile (library.json `washal`, derived by the build: its word starts with ٱ and is not its
 * ayah's first) plays the run with the word before it, its button names what is heard
 * ("tabārakasmu") and one line under it says so. A word that ends its ayah would get the waqf
 * line the example rows have (the build lets no base-form tile be one). `scope`: the page's
 * concept id, for the notes' ids.
 */
export function WordParts({
  data,
  labels,
  clips = {},
  scope = "parts",
}: {
  data: PreparedParts;
  labels: WordPartsLabels;
  clips?: Readonly<Record<string, Clip>>;
  scope?: string;
}) {
  const wordClip = clipFor(clips, data.loc);
  const here = `${scope}-parts-${data.loc}`;
  const wordWaqfId = hasWaqfNote(wordClip, data.word.ar) ? clipNoteId(here, "word") : undefined;
  return (
    <figure className="rounded-2xl border-[1.5px] border-teal-line bg-paper p-4 sm:p-6">
      <div role="group" aria-label={labels.parts} className="flex flex-col items-center gap-2">
        <div dir="rtl" className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
          {data.tiles.map((t, i) => (
            <Fragment key={i}>
              {i > 0 ? <Plus aria-hidden className="h-6 w-6 shrink-0 text-ink-soft" /> : null}
              <Tile
                ar={t.ar}
                dropped={t.dropped}
                translit={t.translit}
                notWritten={labels.notWritten}
                voice={tileVoice(clips, t, clipNoteId(here, `tile-${i + 1}`), labels)}
              >
                <TermText tokens={t.label} links={false} />
              </Tile>
            </Fragment>
          ))}
        </div>
        <ArrowDown aria-hidden className="h-7 w-7 shrink-0 text-forest" />
        <Tile
          ar={data.word.ar}
          translit={data.word.translit}
          result
          voice={
            wordClip ? (
              <>
                <ClipButton loc={data.loc} clip={wordClip} word={data.word.translit} noteId={wordWaqfId} className="justify-center" />
                {wordWaqfId ? <ClipNote id={wordWaqfId} kind="waqf" text={labels.waqf} icon={false} className={TILE_NOTE} /> : null}
              </>
            ) : null
          }
        />
      </div>
      <p className="mt-3 text-center text-base text-ink-muted">
        <span className="whitespace-nowrap">{data.tiles.map((t) => t.translit).join(" + ")}</span>{" "}
        <span className="whitespace-nowrap">→ {data.word.translit}</span>
      </p>

      {data.changes.map((c, i) => (
        <div key={i} className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-4">
          <span className="text-center text-base font-semibold text-ink">
            <MixedText text={`${labels.change(c)}:`} />
          </span>
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
              <TermText tokens={s} emphasis />
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** A note under a tile's button: left-aligned lines in the centred tile, never wider than a
 *  short paragraph (the tile grows with it, up to its row), at the size of the tile's label. */
const TILE_NOTE = "mt-2 max-w-[19rem] text-left text-sm";

/** The voice of a tile: its clip's button, or null for a part of a word (no clip). A tile with
 *  `washal` plays its run (the word before it + the word), is named by what is heard, and says so
 *  under the button. */
function tileVoice(
  clips: Readonly<Record<string, Clip>>,
  t: PreparedParts["tiles"][number],
  id: string,
  labels: WordPartsLabels,
): ReactNode {
  // Already a clip key (a word, or the run "55:78:1-2"): looked up as it is.
  const key = t.washal?.run ?? clipKey(t.q);
  const clip = key ? (clips[key] ?? null) : null;
  if (!clip || !key) return null;
  const washalId = t.washal ? `${id}-washal` : null;
  const waqfId = hasWaqfNote(clip, t.ar) ? `${id}-waqf` : null;
  const notes = [washalId, waqfId].filter(Boolean).join(" ");
  return (
    <>
      <ClipButton loc={key} clip={clip} word={t.washal?.heard ?? t.translit} noteId={notes || undefined} className="justify-center" />
      {t.washal && washalId ? <ClipNote id={washalId} kind="washal" text={labels.washal(t.washal.heard)} icon={false} className={TILE_NOTE} /> : null}
      {waqfId ? <ClipNote id={waqfId} kind="waqf" text={labels.waqf} icon={false} className={TILE_NOTE} /> : null}
    </>
  );
}

function Tile({
  ar,
  dropped = [],
  translit,
  result = false,
  notWritten,
  voice = null,
  children,
}: {
  ar: string;
  dropped?: number[];
  translit: string;
  result?: boolean;
  notWritten?: string;
  /** The imam's voice of the tile's word (ClipButton) and, when what is heard differs from what
   *  is written, the line that says so (ClipNote), under it. */
  voice?: ReactNode;
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
      {voice ? <div className="mt-2 mb-1 flex max-w-full flex-col items-center">{voice}</div> : null}
    </div>
  );
}

/** One side of a change: a vowel alone on its dotted circle with its name and sound, or (a
 *  letter change) the whole letter with its Latin name. The words are one MixedText (the term with
 *  its Arabic and the "·" after it kept together, the sound free to wrap), beside the circle while
 *  10rem is left for them there, else under it (flex-wrap, as on the Harakat page): one nowrap
 *  line, "sukun (سُكُون) · mati, tanpa vokal", was wider than a phone at Sangat besar and made the
 *  page scroll sideways (CI 2026-10-11, konsep dhamir and fiil-madhi). */
function ChangeMark({ c, side }: { c: PartsChange; side: "from" | "to" }) {
  const mark = side === "from" ? c.from : c.to;
  const term = side === "from" ? c.fromTerm : c.toTerm;
  // The sign on the circle IS the vowel: no Latin "a", "i", "u" after it (operator 2026-10-12:
  // "better not use 'a', 'i', 'u', but use harakat symbols"). A sound said in words stays, e.g.
  // sukun's "mati, tanpa vokal" — decided by the mark's term (terms.ts soundAfterSign).
  const sound = soundAfterSign(term, side === "from" ? c.fromSound : c.toSound);
  const name = side === "from" ? c.fromName : c.toName;
  const head = [c.kind === "letter" && name ? name : "", term ? `${term.latin}${term.ar ? ` (${term.ar})` : ""}` : ""]
    .filter(Boolean)
    .join(" ");
  const text = sound ? `${head}${head ? " " : ""}· ${sound}` : head;
  const arAt = term?.ar ? head.lastIndexOf(term.ar) : -1;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-2">
      <MarkCircle mark={mark} size="sm" letter={c.kind === "letter"} />
      <span className="min-w-[min(10rem,100%)] flex-1 text-base text-ink">
        <MixedText
          text={text}
          overlays={[
            ...(arAt >= 0 ? [{ from: arAt, to: arAt + term!.ar!.length, arabic: "text-forest" }] : []),
            ...(sound ? [{ from: text.length - sound.length - 2, to: text.length, wrap: (s: ReactNode) => <span className="text-ink-muted">{s}</span> }] : []),
          ]}
        />
      </span>
    </span>
  );
}
