import clsx from "clsx";
import { ArrowDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A word cut at the part a Level 0 card teaches or a question asks about, drawn as separate tiles with
 * the whole word under them: [كَ] + [مَا] ↓ [كَمَا]. The part's tile is marked by its fill, its edge and its
 * colour (globals.css mark-tile); data-path-mark is the hook scripts/ci/screenshots.mjs selects on.
 *
 * A part is not coloured inside its word. Amiri draws some neighbouring letters as one shape (كم, لم, the
 * lam and alif of ٱلْأَرْضِ), so a colour cut through the word turned the next letter's ink red or hid it
 * under the tint: كَمَا showed a red kaf, an alif and no mim, and six more examples lost a letter the same
 * way (operator 2026-11-05: "it should be kamaa but i dont see mim here", then لَمِنَ). On a tile of its own
 * a part is drawn alone and the word is drawn whole, each as the font shapes it. The pieces run right to
 * left as the word is written, so a prefix sits on the right of the row, as on the concept pages.
 */
export function PartTiles({ word }: { word: readonly [string, string, string] }) {
  const t = useTranslations("KosakataPath");
  const [before, part, after] = word;
  const pieces = [
    ...(before ? [{ ar: before, marked: false }] : []),
    { ar: part, marked: true },
    ...(after ? [{ ar: after, marked: false }] : []),
  ];
  return (
    <div data-path-part-word="" className="flex flex-col items-center gap-1">
      <div dir="rtl" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {pieces.map((p, i) => (
          // The "+" travels with the tile after it, so a wrap never leaves one at the end of a line.
          <div key={i} className="flex items-center gap-2">
            {i > 0 ? <Plus aria-hidden className="size-5 shrink-0 text-ink-soft" /> : null}
            <Tile ar={p.ar} marked={p.marked} label={p.marked ? t("part_marked") : null} />
          </div>
        ))}
      </div>
      <ArrowDown aria-hidden className="size-6 shrink-0 text-forest" />
      <Tile ar={before + part + after} large />
    </div>
  );
}

/** One box of Arabic with its border right around it, so it takes ar-clear (room for the marks). The
 *  marked one says so to a screen reader, which a fill and an edge cannot. */
function Tile({ ar, marked = false, large = false, label = null }: { ar: string; marked?: boolean; large?: boolean; label?: string | null }) {
  return (
    <div
      dir="ltr"
      data-path-mark={marked ? "" : undefined}
      className={clsx(
        "flex min-w-[4.5rem] max-w-full flex-col items-center rounded-xl px-4 py-0.5 text-center",
        marked ? "mark-tile border-2" : "border-[1.5px] border-teal-line bg-white text-ink",
      )}
    >
      <span lang="ar" dir="rtl" className={clsx("arabic-inline ar-clear whitespace-nowrap", large ? "text-ar-lg" : "text-ar-md")}>
        {ar}
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
