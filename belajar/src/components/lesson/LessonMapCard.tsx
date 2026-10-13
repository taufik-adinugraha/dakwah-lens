"use client";

import clsx from "clsx";
import { BookOpen, Check, Clock, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { MixedText } from "@/components/library/MixedText";
import type { LessonMapInput, LessonMapItem } from "@/lib/autoplay";

/** Which of the lesson map's two cards: what the ayah brings ("map", after the imam's recitation)
 *  or what it taught ("learned", before the recap). */
export type LessonMapCardKind = "map" | "learned";

/** From this many concepts in one group the card takes the stage's full width (three columns of
 *  names on a desktop), else the width of a few names. */
const WIDE_FROM = 5;

/**
 * The LESSON MAP's card, in the word card's slot (operator 2026-10-13, plan L23: "at the
 * beginning of the ayat, better to inform what concept we will learn in this ayat, also explain
 * maybe we skip some concept and will visit later in next ayat … so at the beginning we inform what
 * will be learnt, in the end recap what we've learnt"; "if some concept already done in previous
 * ayat, we say we repeat what we've learnt before").
 *
 * "map": up to three groups, each under its own heading — "Baru di ayat ini" (the concepts this
 * ayah introduces, in the order of its "Konsep baru" lines), "Mengulang" (on this ayah's words,
 * taught earlier: each with the ayah that taught it) and "Nanti" (on its words too, taught later:
 * each with the ayah that will teach it — and what an ayah shows without explaining that is no
 * concept of the library, with a line saying what is left open: "Marfu’ (مَرْفُوع) di ayat 2 /
 * mengapa bentuk dasar berakhir dhammah (ضَمَّة)", operator 2026-10-13). A group with nothing in it
 * is not drawn.
 * "learned": the new concepts again, each with a tick, under "Sudah dipelajari".
 * The narrator names a few of them; the card lists every one (content/map, by the pipeline: the
 * names are the ones the "Konsep baru: …" captions use, never retyped here).
 *
 * Senior-friendly like the rest of the stage: every name at 18px with its Arabic at the 24px
 * floor, a heading and an icon per group (never colour alone), no chips, nothing that scrolls
 * sideways. The groups stack; inside a group the names stand one per row on a phone, two per row
 * from a 36rem container and three from 56rem (a container query: the columns collapse again as
 * the text size grows), so a long list stays short on a wide screen. Names go through MixedText:
 * a term never leaves its Arabic, and a name wider than its column wraps in the flow. The ayah a
 * concept belongs to is its own short piece ("dari ayat 1"), which moves to the next row whole:
 * no row starts with a separator. On a phone the room above the caption panel holds about one
 * group (CI 2026-10-13, 390×844: the card of ayat 2 covered the mushaf line and its "Mengulang"
 * and "Nanti" groups lay under the panel): there the new concepts are listed in full and the two
 * other groups show their heading with a count ("Mengulang · 4 hal"), their names being what the
 * narrator says and the caption shows; from sm up every name is listed. The names stay in the
 * page for a screen reader either way. Nothing here is spoken.
 */
export function LessonMapCard({ map, kind }: { map: LessonMapInput; kind: LessonMapCardKind }) {
  const t = useTranslations("Guided");
  /** Where a repeated / postponed concept is taught: "dari ayat 1" / "di ayat 7", or with its
   *  surah when that is another one ("dari QS 1:6"). */
  const where = (it: LessonMapItem, group: "review" | "later") =>
    it.surah === map.surah ? t(`map_${group}_ayah`, { n: it.ayah }) : t(`map_${group}_surah`, { surah: it.surah, ayah: it.ayah });
  const longest = kind === "learned" ? map.new.length : Math.max(map.new.length, map.review.length, map.later.length);
  const none = <li className="text-lg text-ink">{t("map_none")}</li>;
  return (
    <section
      data-autoplay="lesson-map"
      data-map={kind}
      aria-label={t(kind === "learned" ? "map_learned_label" : "map_label")}
      className={clsx(
        "@container mx-auto space-y-3 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-3 sm:px-5 sm:py-4",
        longest >= WIDE_FROM ? "max-w-5xl" : "max-w-3xl",
      )}
    >
      {kind === "learned" ? (
        <Group group="learned" icon={<Check aria-hidden className="h-5 w-5 shrink-0" strokeWidth={3} />} title={t("map_learned")}>
          {map.new.length
            ? map.new.map((it) => <Item key={it.id} item={it} mark={<Check aria-hidden className="h-5 w-5 shrink-0 translate-y-[0.25em] text-forest" strokeWidth={3} />} />)
            : none}
        </Group>
      ) : (
        <>
          <Group group="new" icon={<BookOpen aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_new")}>
            {map.new.length ? map.new.map((it) => <Item key={it.id} item={it} />) : none}
          </Group>
          {map.review.length ? (
            <Group group="review" icon={<RotateCcw aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_review")} count={t("map_count", { n: map.review.length })}>
              {map.review.map((it) => (
                <Item key={it.id} item={it} where={where(it, "review")} />
              ))}
            </Group>
          ) : null}
          {map.later.length ? (
            <Group group="later" icon={<Clock aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_later")} count={t("map_count", { n: map.later.length })}>
              {map.later.map((it) => (
                <Item key={it.id} item={it} where={where(it, "later")} />
              ))}
            </Group>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One group: its heading (an icon and the words, forest) and its names, in columns where the
 *  card is wide enough for them. With `count` (the repeated and the postponed groups), a phone
 *  shows the heading and that count and keeps the names for sm and up (see the card's comment);
 *  the count is not part of the heading's text, so the heading reads the same on every screen.
 *  Heading and count are one row that never wraps: no line starts with the "·". */
function Group({ group, icon, title, count, children }: { group: string; icon: ReactNode; title: string; count?: string; children: ReactNode }) {
  return (
    <div data-map-group={group} className="min-w-0">
      <div className="flex items-baseline gap-x-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-forest">
          {icon}
          <span>{title}</span>
        </h3>
        {count ? (
          <span data-map-count className="text-base whitespace-nowrap text-ink-muted sm:hidden">
            · {count}
          </span>
        ) : null}
      </div>
      <ul className={clsx("mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 @xl:grid-cols-2 @4xl:grid-cols-3", count && "max-sm:sr-only")}>{children}</ul>
    </div>
  );
}

/** One concept: a mark (a dot, or the closing card's tick), its name as the captions show it, and
 *  where it is taught when that is another ayah. */
function Item({ item, where, mark }: { item: LessonMapItem; where?: string; mark?: ReactNode }) {
  return (
    // On the text's first baseline (a row with Arabic is taller than a Latin one): the mark sits
    // beside the name's first line however the name wraps.
    <li data-map-item={item.id} data-map-ayah={`${item.surah}:${item.ayah}`} className="flex min-w-0 items-baseline gap-2.5 text-lg text-ink">
      {mark ?? <span aria-hidden className="h-1.5 w-1.5 shrink-0 -translate-y-[0.3em] rounded-full bg-forest" />}
      {/* One flex child around the text: MixedText's pieces are inline boxes of this span. */}
      <span className="min-w-0 flex-1">
        <MixedText text={item.name} />
        {where ? (
          <>
            {" "}
            <span data-map-where className="text-base whitespace-nowrap text-ink-muted">
              {where}
            </span>
          </>
        ) : null}
        {/* What is left unexplained here (an authored later item), on a row of its own. */}
        {item.note ? (
          <>
            {" "}
            <span data-map-note className="block text-base text-ink-muted">
              <MixedText text={item.note} />
            </span>
          </>
        ) : null}
      </span>
    </li>
  );
}
