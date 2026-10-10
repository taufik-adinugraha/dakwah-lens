import { Fragment, type ReactNode } from "react";

import { rtlRuns, textUnits, type Seg, type UnitPart } from "@/lib/textUnits";

/** One Arabic run: isolated (`bdi`, RTL) at the 24px floor. */
function Bdi({ text }: { text: string }) {
  return (
    <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
      {text}
    </bdi>
  );
}

/** A unit part. An Arabic one: each run isolated, the « » or ( ) around it inside a right-to-left
 *  span with it (rtlRuns), and the part right-aligned (.lb-ar) — on one line it looks as before;
 *  wider than its line, it wraps right to left, its lines in reading order. */
function Part({ part }: { part: UnitPart }) {
  if (!part.arabic)
    return (
      <span data-lb="part" className="lb-part">
        {part.text}
      </span>
    );
  return (
    <span data-lb="part" className="lb-part lb-ar">
      {rtlRuns(part.text).map((r, i) =>
        !r.arabic ? (
          <Fragment key={i}>{r.text}</Fragment>
        ) : r.open ? (
          <span key={i} dir="rtl">
            {r.open}
            <Bdi text={r.text} />
            {r.close}
          </span>
        ) : (
          <Bdi key={i} text={r.text} />
        ),
      )}
    </span>
  );
}

/** parts[from..to] with the whitespace between them, each drawn by `draw`. */
function between(seg: Extract<Seg, { kind: "unit" }>, from: number, to: number, draw: (p: UnitPart) => ReactNode) {
  return seg.parts.slice(from, to + 1).map((p, k) => (
    <Fragment key={from + k}>
      {k > 0 ? seg.gaps[from + k - 1] : null}
      {draw(p)}
    </Fragment>
  ));
}

/** A unit: its seam (the Arabic and the words touching it) as a box of parts, inside the box of
 *  the whole term or gloss when it has more words ("huruf" + "jar (حَرْف جَرّ),"). Those outside
 *  words are Latin, drawn as running text (a hyphenated one glued). */
function Unit({ seg }: { seg: Extract<Seg, { kind: "unit" }> }) {
  const [from, to] = seg.seam;
  const last = seg.parts.length - 1;
  const seam = between(seg, from, to, (p) => <Part part={p} />);
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
          {between(seg, 0, from - 1, (p) => (
            <Pieces text={p.text} />
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
          {between(seg, to + 1, last, (p) => (
            <Pieces text={p.text} />
          ))}
        </>
      ) : null}
    </span>
  );
}

/** What textUnits cut `text` into, drawn. */
function Pieces({ text }: { text: string }) {
  return (
    <>
      {textUnits(text).map((s, i) =>
        s.kind === "text" ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : s.kind === "glue" ? (
          <span key={i} data-lb="glue" className="lb-glue">
            {s.text}
          </span>
        ) : (
          <Unit key={i} seg={s} />
        ),
      )}
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
 */
export function MixedText({ text }: { text: string }) {
  return <Pieces text={text} />;
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
