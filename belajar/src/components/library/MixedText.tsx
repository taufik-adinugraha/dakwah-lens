import { Fragment, type ReactNode } from "react";

/** Arabic letters, harakat and presentation forms. */
const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
/** One Arabic run: Arabic words joined by spaces, dashes or the Arabic
 *  comma ("فَعِلَ–يَفْعَلُ", "ر ح م", "مِلْكًا، مَلْكًا"). */
const RUN = new RegExp(`[${AR}]+(?:[\\s\\u2013\\u060C-]+[${AR}]+)*`, "g");

/**
 * Latin prose with Arabic inside it (a bab name, a wazan with its note, a
 * dictionary entry in a citation). Each Arabic run is isolated (`bdi`, RTL)
 * and raised to the 24px floor for vocalised Arabic (senior-ux §3.1), with
 * Arabic line-height from `.arabic-inline` rather than the Latin one around
 * it. Renders content data as given — nothing is retyped.
 */
export function MixedText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${last}`}>{text.slice(last, at)}</Fragment>);
    out.push(
      <bdi key={`a${at}`} lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
        {m[0]}
      </bdi>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
