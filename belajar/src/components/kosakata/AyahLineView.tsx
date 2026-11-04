import { MixedText } from "@/components/library/MixedText";
import type { AyahLine } from "@/lib/kosakata-path-core";

/** An ayah with the word marked. The text is verbatim Tanzil: the mark is a colour, nothing is cut or changed. */
export function AyahText({ line }: { line: AyahLine }) {
  return (
    <p lang="ar" dir="rtl" data-path-ayah={line.loc} className="quran ar-clear text-ar-md text-ink sm:text-ar-lg">
      {line.tokens.map((token, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          {line.hi.includes(i) ? <span data-path-mark="" className="word-mark">{token}</span> : token}
        </span>
      ))}
    </p>
  );
}

/** Its translation, verbatim, with its footnotes, as the lesson pages and the ayah popup show one. */
export function AyahTranslation({ line, reference, source }: { line: AyahLine; reference: string; source: string }) {
  return (
    <figure className="mt-3">
      <blockquote className="text-pretty text-base text-ink">
        <MixedText text={`“${line.text}”`} />
      </blockquote>
      {line.footnotes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {line.footnotes.map((f) => (
            <li key={f}>
              <MixedText text={f} />
            </li>
          ))}
        </ul>
      ) : null}
      <figcaption className="mt-2 text-xs text-ink-soft">
        <MixedText text={`${reference}. ${source}`} />
      </figcaption>
    </figure>
  );
}
