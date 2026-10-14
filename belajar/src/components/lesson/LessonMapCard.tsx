"use client";

import clsx from "clsx";
import { BookOpen, Check, Clock, GraduationCap, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { MixedText } from "@/components/library/MixedText";
import { MAP_HERE_FULL, MAP_LATER_FULL, mapHere, mapLatinName, mapTotal, type LessonMapInput, type LessonMapItem, type MapGroup } from "@/lib/autoplay";

/** Which card of the lesson map: one group of the opening — what is new, what has been learnt so
 *  far, what comes later (with the next-level topics) — or the closing ("learned"). */
export type LessonMapCardGroup = MapGroup | "learned";

/** From this many names in one list of rows the card takes the stage's full width (three columns
 *  of names on a desktop), else the width of a few names. */
const WIDE_FROM = 5;

/**
 * The LESSON MAP's card, in the word card's slot (operator 2026-10-13, plan L23: "at the
 * beginning of the ayat, better to inform what concept we will learn in this ayat, also explain
 * maybe we skip some concept and will visit later in next ayat … so at the beginning we inform what
 * will be learnt, in the end recap what we've learnt"; and, with the basic curriculum, plan L26:
 * "so the knowledge is accummulating and repeated" — "but separate new vs already knows concept,
 * this is what new, this is what we've learnt so far").
 *
 * ONE GROUP AT A TIME, in step with the narrator (each group is a step of the lesson, with its
 * own line): new and already-learnt are never on screen together.
 *   "new"      "Baru di ayat ini": the steps this ayah's lesson teaches, in the order of its
 *              "Konsep baru" lines (at most three), each with its Arabic.
 *   "learnt"   "Sudah kita pelajari (16 hal)": the WHOLE list so far, with its count. First the
 *              ones that come up again in this ayah, under "Kita temui lagi di ayat ini (n)" —
 *              up to MAP_HERE_FULL of them one per row, with their Arabic and a repeat mark (never
 *              colour alone), more as one flowing line of their names; then the others, muted,
 *              under "Tidak ada di ayat ini (n)": on a phone that line with its count is all of
 *              them, from sm up their names follow it.
 *   "later"    "Nanti": the steps this ayah shows and a later lesson teaches, each with its ayah
 *              (up to MAP_LATER_FULL of them one per row, more as one flowing line) — and "Tingkat
 *              lanjut (n hal)": the next-level topics on this ayah, with the line that says they
 *              are not taught at this level; their names, muted, from sm up (the narrator gives
 *              their count only).
 *   "learned"  the closing: the new steps again, each with a tick, and the running total.
 * A group with nothing in it is not drawn.
 *
 * THE ROOM IS SMALL ON A PHONE, measured in CI at 390×844 (base branch, 2026-10-13): the card's
 * slot starts at about y=199 and the caption panel's top is at about y=469–484 while a map line is
 * on the caption — about 270px at the normal text size, less at Besar and Sangat besar; one
 * heading with three names, one of them on two rows, is about 265px. So each group is built to
 * that: at most three rows of names with their Arabic, and whatever is longer is a flowing line of
 * Latin names (their Arabic was shown when each was new, and is in the caption for the ones the
 * narrator names). Until 2026-10-13 one card held three groups and, on a phone, hid the names of
 * two of them.
 *
 * What a phone does not show takes no box there (display none below sm) — never a visually
 * hidden 1px box, whose text the line-break check still measures, every word of it "into a 0px
 * line". And no separator can start a line: a count stands in brackets beside its heading, as
 * one piece that does not wrap, and a name in a flowing line carries its own comma.
 *
 * The names are the pipeline's (content/map: a step is called what its "Konsep baru: …" caption
 * opens with), never retyped here. Senior-friendly like the rest of the stage: every name at 18px
 * with its Arabic at the 24px floor, a heading and an icon per group, no chips, nothing that
 * scrolls sideways. Names go through MixedText: a term never leaves its Arabic, and a name wider
 * than its column wraps in the flow. Rows stand one per row on a phone, two per row from a 36rem
 * container and three from 56rem (a container query: the columns collapse again as the text size
 * grows). Nothing here is spoken.
 */
export function LessonMapCard({ map, group }: { map: LessonMapInput; group: LessonMapCardGroup }) {
  const t = useTranslations("Guided");
  /** Where a postponed step is taught: "di ayat 4", with its surah when that is another one
   *  ("di QS 114:1"), nothing for a lesson that is no whole ayah. */
  const where = (it: LessonMapInput["later"][number]) =>
    it.surah === null || it.ayah === null ? undefined : it.surah === map.surah ? t("map_later_ayah", { n: it.ayah }) : t("map_later_surah", { surah: it.surah, ayah: it.ayah });
  const here = mapHere(map);
  const rest = map.learnt.filter((x) => !x.here);
  const rows = group === "learnt" ? (here.length > MAP_HERE_FULL ? 0 : here.length) : group === "later" ? (map.later.length > MAP_LATER_FULL ? 0 : map.later.length) : map.new.length;
  const none = <li className="text-lg text-ink">{t("map_none")}</li>;
  return (
    <section
      data-autoplay="lesson-map"
      data-map={group}
      aria-label={t(group === "learned" ? "map_learned_label" : "map_label")}
      className={clsx(
        "@container mx-auto space-y-2 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-3 sm:space-y-3 sm:px-5 sm:py-4",
        rows >= WIDE_FROM ? "max-w-5xl" : "max-w-3xl",
      )}
    >
      {group === "new" ? (
        <Group group="new" icon={<BookOpen aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_new")}>
          <List>{map.new.length ? map.new.map((it) => <Item key={it.id} item={it} />) : none}</List>
        </Group>
      ) : group === "learnt" ? (
        <Group group="learnt" icon={<Check aria-hidden className="h-5 w-5 shrink-0" strokeWidth={3} />} title={t("map_learnt")} count={t("map_count", { n: map.learnt.length })}>
          {here.length ? (
            <>
              <p data-map-sub="here" className="mt-1 text-base font-semibold text-ink">
                {t("map_here", { n: here.length })}
              </p>
              {here.length <= MAP_HERE_FULL ? (
                <List>
                  {here.map((it) => (
                    <Item key={it.id} item={it} here mark={<RotateCcw aria-hidden className="h-4 w-4 shrink-0 translate-y-[0.15em] text-forest" strokeWidth={2.5} />} />
                  ))}
                </List>
              ) : (
                <Flow items={here.map((it) => ({ id: it.id, text: mapLatinName(it.name) }))} here className="text-lg text-ink" />
              )}
            </>
          ) : (
            <p data-map-sub="here" className="mt-1 text-lg text-ink">
              {t("map_here_none")}
            </p>
          )}
          {rest.length ? (
            <>
              {/* On a phone this one line, with its count, stands for all of them. */}
              <p data-map-sub="rest" className="mt-1 text-base text-ink-muted sm:mt-2 sm:font-semibold">
                {t("map_rest", { n: rest.length })}
              </p>
              <Flow items={rest.map((it) => ({ id: it.id, text: mapLatinName(it.name) }))} here={false} fromSm className="text-base text-ink-muted" />
            </>
          ) : null}
        </Group>
      ) : group === "later" ? (
        <>
          {map.later.length ? (
            <Group group="later" icon={<Clock aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_later")}>
              {map.later.length <= MAP_LATER_FULL ? (
                <List>
                  {map.later.map((it) => (
                    <Item key={it.id} item={it} where={where(it)} />
                  ))}
                </List>
              ) : (
                <Flow items={map.later.map((it) => ({ id: it.id, text: [mapLatinName(it.name), where(it)].filter(Boolean).join(" ") }))} className="text-lg text-ink" />
              )}
            </Group>
          ) : null}
          {map.lanjut.length ? (
            <Group group="lanjut" icon={<GraduationCap aria-hidden className="h-5 w-5 shrink-0" />} title={t("map_lanjut")} count={t("map_count", { n: map.lanjut.length })} muted>
              {/* Their names from sm up; on a phone the count beside the heading (what the narrator
                  says of them, too) and the line below. */}
              <ul data-map-names className="mt-1 space-y-0.5 max-sm:hidden">
                {map.lanjut.map((it) => (
                  <li key={it.id} data-map-item={it.id} className="text-base text-ink-muted">
                    <MixedText text={it.name} />
                  </li>
                ))}
              </ul>
              <p data-map-note className="mt-0.5 text-base text-ink-muted">
                {t("map_lanjut_note")}
              </p>
            </Group>
          ) : null}
        </>
      ) : (
        <Group group="learned" icon={<Check aria-hidden className="h-5 w-5 shrink-0" strokeWidth={3} />} title={t("map_learned")}>
          <List>
            {map.new.length
              ? map.new.map((it) => <Item key={it.id} item={it} mark={<Check aria-hidden className="h-5 w-5 shrink-0 translate-y-[0.25em] text-forest" strokeWidth={3} />} />)
              : none}
          </List>
          {/* The running total (decision 9: "the closing says what was new in this lesson and how
              much has been learnt in total"). */}
          <p data-map-total className="mt-1 text-base font-semibold text-ink">
            {t("map_total", { n: mapTotal(map) })}
          </p>
        </Group>
      )}
    </section>
  );
}

/** One group: its heading (an icon and the words, forest; muted for the next level) and what it
 *  lists. `count` stands in brackets beside the heading: one piece that does not wrap, on a row
 *  that does not wrap either — no line can start with a separator, because there is none. */
function Group({ group, icon, title, count, muted = false, children }: { group: string; icon: ReactNode; title: string; count?: string; muted?: boolean; children: ReactNode }) {
  return (
    <div data-map-group={group} className="min-w-0">
      <div className="flex items-baseline gap-x-2">
        <h3 className={clsx("flex items-center gap-2 text-base font-semibold", muted ? "text-ink-muted" : "text-forest")}>
          {icon}
          <span>{title}</span>
        </h3>
        {count ? (
          <span data-map-count className="shrink-0 text-base whitespace-nowrap text-ink-muted">
            ({count})
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Names one per row, in columns where the card is wide enough for them. */
function List({ children }: { children: ReactNode }) {
  return <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 @xl:grid-cols-2 @4xl:grid-cols-3">{children}</ul>;
}

/** One step: a mark (a dot, the repeat mark of a step that comes up again, or the closing card's
 *  tick), its name as the captions show it, and where it is taught when that is another ayah. */
function Item({ item, where, mark, here }: { item: LessonMapItem; where?: string; mark?: ReactNode; here?: boolean }) {
  return (
    // On the text's first baseline (a row with Arabic is taller than a Latin one): the mark sits
    // beside the name's first line however the name wraps.
    <li data-map-item={item.id} data-map-here={here === undefined ? undefined : String(here)} className="flex min-w-0 items-baseline gap-2.5 text-lg text-ink">
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
      </span>
    </li>
  );
}

/** Many names as ONE flowing line: each a list item that carries its own comma, so nothing starts
 *  a line with a separator. `here`: the learnt group's mark of a step that comes up again in this
 *  ayah (the others: false). `fromSm`: not drawn on a phone (display none: no box to measure). */
function Flow({ items, here, fromSm = false, className }: { items: readonly { id: string; text: string }[]; here?: boolean; fromSm?: boolean; className: string }) {
  return (
    <ul data-map-flow className={clsx("mt-0.5 flex flex-wrap gap-x-1.5", fromSm && "max-sm:hidden", className)}>
      {items.map((it, i) => (
        <li key={it.id} data-map-item={it.id} data-map-here={here === undefined ? undefined : String(here)}>
          <MixedText text={`${it.text}${i < items.length - 1 ? "," : ""}`} />
        </li>
      ))}
    </ul>
  );
}
