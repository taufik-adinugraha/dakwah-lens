import { Fragment, type ReactNode } from "react";

import { joinUnits, rtlRuns, textUnits, type Seg, type UnitPart } from "@/lib/textUnits";

/**
 * A style over a stretch of the text, [from, to) as offsets in it: TermText's term Arabic (forest)
 * and Qur'anic words (ink) and a harakah term's link, a transliteration set bold. Latin text inside
 * one is drawn by `wrap`; an Arabic run that starts inside one takes `arabic` as an extra class on
 * its `bdi`. Overlays only style: the pieces and their line breaks are those of the text alone.
 */
export type Overlay = { from: number; to: number; wrap?: (children: ReactNode) => ReactNode; arabic?: string };
type Overlays = readonly Overlay[];

/** Latin text at offset `at`, cut where a `wrap` overlay starts or ends. */
function latin(text: string, at: number, ov: Overlays): ReactNode {
  const wraps = ov.filter((o) => o.wrap && o.from < at + text.length && o.to > at);
  if (!wraps.length) return text;
  const cuts = [...new Set([0, text.length, ...wraps.flatMap((o) => [o.from - at, o.to - at])])]
    .filter((c) => c >= 0 && c <= text.length)
    .sort((a, b) => a - b);
  return cuts.slice(0, -1).map((c, k) => {
    const piece = text.slice(c, cuts[k + 1]);
    const o = wraps.find((w) => w.from <= at + c && w.to >= at + cuts[k + 1]);
    return <Fragment key={k}>{o?.wrap ? o.wrap(piece) : piece}</Fragment>;
  });
}

/** Where each of `lengths` starts, the first at `at`. */
function starts(lengths: readonly number[], at: number): number[] {
  const out: number[] = [];
  let pos = at;
  for (const n of lengths) {
    out.push(pos);
    pos += n;
  }
  return out;
}

/** One Arabic run: isolated (`bdi`, RTL) at the 24px floor. */
function Bdi({ text, tone }: { text: string; tone?: string }) {
  return (
    <bdi lang="ar" dir="rtl" className={`arabic-inline text-ar-sm${tone ? ` ${tone}` : ""}`}>
      {text}
    </bdi>
  );
}

/** A unit part, at offset `at`. An Arabic one: each run isolated, the « » or ( ) around it inside a
 *  right-to-left span with it (rtlRuns), and the part right-aligned (.lb-ar) — on one line it looks
 *  as before; wider than its line, it wraps right to left, its lines in reading order. */
function Part({ part, at, ov }: { part: UnitPart; at: number; ov: Overlays }) {
  if (!part.arabic)
    return (
      <span data-lb="part" className="lb-part">
        {latin(part.text, at, ov)}
      </span>
    );
  const runs = rtlRuns(part.text);
  const at0 = starts(runs.map((r) => (r.open?.length ?? 0) + r.text.length + (r.close?.length ?? 0)), at);
  return (
    <span data-lb="part" className="lb-part lb-ar">
      {runs.map((r, i) => {
        if (!r.arabic) return <Fragment key={i}>{latin(r.text, at0[i], ov)}</Fragment>;
        const pos = at0[i] + (r.open?.length ?? 0);
        const tone = ov.find((o) => o.arabic && o.from <= pos && pos < o.to)?.arabic;
        return r.open ? (
          <span key={i} dir="rtl">
            {r.open}
            <Bdi text={r.text} tone={tone} />
            {r.close}
          </span>
        ) : (
          <Bdi key={i} text={r.text} tone={tone} />
        );
      })}
    </span>
  );
}

/** parts[from..to] with the whitespace between them, each drawn by `draw` with its offset. */
function between(
  seg: Extract<Seg, { kind: "unit" }>,
  at0: readonly number[],
  from: number,
  to: number,
  draw: (p: UnitPart, at: number) => ReactNode,
) {
  return seg.parts.slice(from, to + 1).map((p, k) => (
    <Fragment key={from + k}>
      {k > 0 ? seg.gaps[from + k - 1] : null}
      {draw(p, at0[from + k])}
    </Fragment>
  ));
}

/** A unit at offset `at`: its seam (the Arabic and the words touching it) as a box of parts, inside
 *  the box of the whole term or gloss when it has more words ("huruf" + "jar (حَرْف جَرّ),"). Those
 *  outside words are Latin, drawn as running text (a hyphenated one glued). */
function Unit({ seg, at, ov }: { seg: Extract<Seg, { kind: "unit" }>; at: number; ov: Overlays }) {
  const [from, to] = seg.seam;
  const last = seg.parts.length - 1;
  const at0 = starts(seg.parts.map((p, k) => p.text.length + (seg.gaps[k] ?? "").length), at);
  const seam = between(seg, at0, from, to, (p, a) => <Part part={p} at={a} ov={ov} />);
  if (from === 0 && to === last)
    return (
      <span data-lb="unit" className="lb-unit">
        {seam}
      </span>
    );
  return (
    <span data-lb="unit" className="lb-unit">
      {from > 0 ? (
        <>
          {between(seg, at0, 0, from - 1, (p, a) => (
            <Pieces text={p.text} at={a} ov={ov} />
          ))}
          {seg.gaps[from - 1]}
        </>
      ) : null}
      <span data-lb="unit" className="lb-unit">
        {seam}
      </span>
      {to < last ? (
        <>
          {seg.gaps[to]}
          {between(seg, at0, to + 1, last, (p, a) => (
            <Pieces text={p.text} at={a} ov={ov} />
          ))}
        </>
      ) : null}
    </span>
  );
}

/** What textUnits cut `text` (at offset `at` of the whole) into, drawn. */
function Pieces({ text, at = 0, ov = [] }: { text: string; at?: number; ov?: Overlays }) {
  const segs = textUnits(text);
  const at0 = starts(segs.map((s) => joinUnits([s]).length), at);
  return (
    <>
      {segs.map((s, i) => {
        const here = at0[i];
        return s.kind === "text" ? (
          <Fragment key={i}>{latin(s.text, here, ov)}</Fragment>
        ) : s.kind === "glue" ? (
          <span key={i} data-lb="glue" className="lb-glue">
            {latin(s.text, here, ov)}
          </span>
        ) : (
          <Unit key={i} seg={s} at={here} ov={ov} />
        );
      })}
    </>
  );
}

/**
 * Latin prose with Arabic inside it (a bab name, a wazn with its note, a
 * dictionary entry in a citation). Each Arabic run is isolated (`bdi`, RTL)
 * and raised to the 24px floor for vocalised Arabic (senior-ux §3.1), with
 * Arabic line-height from `.arabic-inline` rather than the Latin one around
 * it. Renders content data as given — nothing is retyped.
 *
 * Line breaks (operator, 2026-10-10: "make sure the line break is clean and
 * easy to read, sometime i see wrong line break especially for arabic
 * words"): the text is cut by textUnits — a term stays with its Arabic
 * ("huruf jar (حَرْف جَرّ),", its seam "jar (حَرْف جَرّ)," a box inside), a
 * hyphenated word is never cut ("Al-Fatihah"), no line starts with "·" or
 * "—" — and each piece is an inline-block (globals.css .lb-*) that moves to
 * the next line whole. One wider than its line is laid out in the
 * paragraph's flow instead (src/lib/lineFit.ts), breaking only between its
 * pieces. The DOM text is the input byte for byte. Inside a flex container,
 * wrap it in one <span>: every piece would otherwise become a flex item of
 * its own.
 *
 * `overlays` style stretches of the text without changing where it breaks
 * (TermText draws the Konsep library's marked prose this way, 2026-10-11:
 * styled spans of their own put a break opportunity next to every term,
 * "keduanya ( ⏎ mudhaf", "waswasa– ⏎ yuwaswisu", "al- ⏎ qaul").
 */
export function MixedText({ text, overlays }: { text: string; overlays?: readonly Overlay[] }) {
  return <Pieces text={text} ov={overlays} />;
}

/**
 * Inline content kept together the same way, for markup MixedText cannot
 * build from one string: a Qur'anic word in its own face with the
 * transliteration after it, a label with its Arabic value. It moves to the
 * next line whole; wider than its line, it is laid out in the paragraph's
 * flow and breaks at its spaces (src/lib/lineFit.ts).
 */
export function KeepTogether({ children }: { children: ReactNode }) {
  return (
    <span data-lb="glue" className="lb-glue">
      {children}
    </span>
  );
}
