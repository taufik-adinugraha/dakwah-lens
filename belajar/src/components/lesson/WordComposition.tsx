"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";

import { MixedText } from "@/components/library/MixedText";
import type { ComposeChip, ComposeFile, ComposeForm, ComposeFrame, ComposeMark, Composition, Primer } from "@/content/compose-schema";

import { MarkGlyph } from "./MarkGlyph";

/** What the stage needs to draw the animations of one ayah (content bytes,
 *  passed from the page; the autoplay sequence itself carries no Arabic). */
export type StageCompose = {
  marks: ComposeFile["marks"];
  primer: Primer | null;
  /** By word number (1-based) in this ayah. */
  words: Record<number, Composition>;
};

const VOWEL: ReadonlySet<ComposeMark> = new Set(["fathah", "kasrah", "dhammah", "fathatain", "kasratain", "dhammatain"]);

/**
 * The animation in the word card's slot (operator 2026-10-10, narration rule
 * 14): a word explained by its parts — [بِ] + [ٱسْمُ] → the dhammah becomes
 * kasrah (u → i) → written together → the alif drops → [بِسْمِ] — or the
 * harakat primer (each mark on a dotted circle, its sound, an example from
 * the ayah). One FRAME at a time, the one the line on screen is said over
 * (caption.ts stageFrame); the imam then recites the joined word over the
 * last frame ("recited": the tile filled forest, as the mushaf's active word).
 *
 * Arabic is never split, coloured or moved in pieces (joining across styled
 * spans breaks the letters' shapes): every string is one whole form or one
 * whole piece cut by the pipeline (content/compose, validator-checked), in
 * its own isolated RTL run. A change is shown by fading one whole form into
 * the next in the same grid cell (nothing reflows), with the pieces it is
 * about beside it (مُ → مِ) and their marks and sounds in words (dhammah →
 * kasrah · u → i) — never colour alone. Each frame plays its own short
 * transition when it appears (≤ 1.5 s, CSS only); with reduced motion the
 * frames simply swap (every transition lives inside
 * prefers-reduced-motion: no-preference, globals.css "compose-").
 *
 * Its height follows the content, and does not jump from frame to frame:
 * every frame of the word is laid out, invisibly, in the same grid cell as
 * the frame on screen ([data-compose-ghost], globals.css), so the figure is
 * as tall as the word's tallest frame at the learner's text size and phone
 * width, and nothing is ever clipped (CI measures it at all three text
 * sizes, phone and desktop). Chips, notes and tiles wrap — never inside a
 * term ("kasrah (كَسْرَة)") or an Arabic run. The figure has a plain
 * Indonesian description for screen readers (transliteration, no Arabic);
 * the drawing itself is aria-hidden.
 */
export function WordComposition({
  unit,
  kind,
  frame,
  recited,
  marks,
  word,
  stepKey,
}: {
  unit: Composition | Primer;
  kind: "compose" | "primer";
  /** 1-based. */
  frame: number;
  recited: boolean;
  marks: ComposeFile["marks"];
  /** The word number (compose), for the label above the frames (from sm). */
  word: number | null;
  /** Remounts the frame (its transition plays) when the step or frame changes. */
  stepKey: string;
}) {
  const t = useTranslations("Compose");
  const fr = unit.frames[Math.min(Math.max(frame, 1), unit.frames.length) - 1];
  const form = (n: string | undefined) => (n ? unit.forms[n] : undefined);
  const markText = (m: ComposeMark | null | undefined) => (m ? (marks[m]?.display ?? m) : "");
  const sound = (m: ComposeMark | null | undefined) => (m ? marks[m]?.sound : null);
  const describe = describeFrame(fr, unit.forms, kind, word, t, markText, sound, recited);
  const draw = (f: ComposeFrame, live: boolean) =>
    kind === "primer" ? (
      <PrimerFrame fr={f} form={form} marks={marks} t={t} />
    ) : (
      <WordFrame fr={f} form={form} recited={live && recited} markText={markText} sound={sound} t={t} />
    );
  const LAYER = "col-start-1 row-start-1 flex min-w-0 flex-col items-center justify-center gap-1 sm:gap-2";
  return (
    <figure
      data-autoplay="composition"
      data-guide="word-card"
      data-compose-kind={kind}
      data-compose-stage={fr.stage}
      data-compose-frame={frame}
      data-compose-word={word ?? undefined}
      data-recited={recited ? "true" : undefined}
      className="mx-auto flex max-w-xl flex-col rounded-2xl border-[1.5px] border-forest bg-forest-tint px-3 py-2 sm:min-h-56 sm:px-5 sm:py-3"
    >
      <figcaption className="sr-only">{describe}</figcaption>
      {word !== null ? (
        <p aria-hidden className="hidden text-base leading-tight font-semibold text-forest sm:block">
          {t("word_n", { n: word })}
        </p>
      ) : null}
      <div className="grid flex-1">
        {/* The word's other frames, laid out but never shown: they hold the
            figure at its tallest frame's height (no jump, no clip). */}
        {unit.frames.map((f, i) =>
          f === fr ? null : (
            <div key={`ghost-${i}`} aria-hidden data-compose-ghost className={LAYER}>
              {draw(f, false)}
            </div>
          ),
        )}
        <div key={`${stepKey}:${frame}`} aria-hidden data-compose-layer className={LAYER}>
          {draw(fr, true)}
        </div>
      </div>
    </figure>
  );
}

type T = ReturnType<typeof useTranslations>;

/** One whole Arabic string, isolated RTL in the Amiri face, never broken.
 *  Inside the figure its line height is the strip's (globals.css: 1.6 for
 *  pieces and terms, 1.8 for a `tile`'s whole form). */
function Ar({ text, className, quran = false, tile = false }: { text: string; className?: string; quran?: boolean; tile?: boolean }) {
  return (
    <bdi lang="ar" dir="rtl" className={clsx(quran ? "quran" : "arabic-inline", tile && "compose-ar", "whitespace-nowrap", className)}>
      {text}
    </bdi>
  );
}

/** A dictionary term's display form ("kasrah (كَسْرَة)") that never breaks inside. */
const Term = ({ text }: { text: string }) => (
  <span className="whitespace-nowrap">
    <MixedText text={text} />
  </span>
);

function Tile({
  f,
  before,
  tag,
  ring,
  recited,
  quran,
}: {
  f: ComposeForm;
  /** The form this tile changes from (shown first, then faded into `f`). */
  before?: ComposeForm;
  tag?: ReactNode;
  ring?: boolean;
  recited?: boolean;
  quran?: boolean;
}) {
  return (
    <div
      data-compose-tile
      className={clsx(
        "relative flex min-w-[5.5rem] flex-col items-center rounded-xl border-2 px-2 pt-0.5 pb-1 motion-safe:transition-colors motion-safe:duration-300 sm:min-w-[8rem] sm:px-4",
        // The recited tile is filled forest (the mushaf's active word); white
        // only otherwise — both are background-color utilities, and in one
        // class list the later one in the stylesheet (bg-white) would win.
        recited ? "border-forest bg-forest text-paper" : clsx("bg-white", ring ? "border-forest ring-4 ring-forest/25" : "border-hairline"),
      )}
    >
      <span className={clsx("text-sm leading-tight whitespace-nowrap", recited ? "text-paper" : "text-ink-muted")}>{tag ?? f.label ?? " "}</span>
      <span className="grid place-items-center">
        {before ? (
          <span data-compose-before className="col-start-1 row-start-1">
            <Ar text={before.ar} tile className="text-ar-md sm:text-ar-xl" />
          </span>
        ) : null}
        <span data-compose-after={before ? "" : undefined} className="col-start-1 row-start-1">
          <Ar text={f.ar} quran={quran} tile className={clsx("text-ar-md sm:text-ar-xl", recited ? "text-paper" : "text-ink")} />
        </span>
      </span>
      <span className="grid text-base leading-tight whitespace-nowrap">
        {before ? (
          <span data-compose-before className={clsx("col-start-1 row-start-1 text-center", recited ? "text-paper" : "text-ink")}>
            {before.translit}
          </span>
        ) : null}
        <span data-compose-after={before ? "" : undefined} className={clsx("col-start-1 row-start-1 text-center font-medium", recited ? "text-paper" : "text-ink")}>
          {f.translit}
          {f.gloss ? <span className={clsx("hidden font-normal sm:inline", recited ? "text-paper" : "text-ink-muted")}> · “{f.gloss}”</span> : null}
        </span>
      </span>
    </div>
  );
}

const Plus = () => (
  <span data-compose-plus aria-hidden className="px-0.5 text-2xl font-semibold text-forest sm:px-1 sm:text-3xl">
    +
  </span>
);

/** The pieces a frame is about (cut by the pipeline), and what happens to them in words. A chip
 *  wraps between its parts on a narrow screen — the pieces, each mark's term, the sounds — but
 *  never inside one: a term keeps its Arabic ("kasrah (كَسْرَة)"), an arrow its target. */
function Chips({ chips, markText, sound, t }: { chips: ComposeChip[]; markText: (m: ComposeMark | null | undefined) => string; sound: (m: ComposeMark | null | undefined) => string | null | undefined; t: T }) {
  return (
    <div data-compose-after className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-ink">
      {chips.map((c, i) => {
        const [m0, m1] = c.marks ?? [null, null];
        const vowel = (m: ComposeMark | null) => !!m && VOWEL.has(m);
        const what = c.silent
          ? t("silent")
          : c.to === ""
            ? t("dropped")
            : m0 === "sukun" && m1 === null
              ? t("silent")
              : m0 === null && m1 === "shaddah"
                ? t("doubled")
                : m1 === "sukun" && !vowel(m0)
                  ? t("no_vowel")
                  : vowel(m0) && (vowel(m1) || m1 === "sukun")
                    ? null
                    : "";
        return (
          <span key={i} className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Ar text={c.from} className="rounded-md border border-forest/40 bg-white px-1.5 text-ar-sm" />
              {c.to !== "" && !c.silent && c.to !== c.from ? (
                <>
                  <span aria-hidden className="text-forest">→</span>
                  <Ar text={c.to} className="rounded-md border border-forest bg-white px-1.5 text-ar-sm" />
                </>
              ) : null}
            </span>
            {what === null ? (
              <>
                <Term text={markText(m0)} />
                <span className="whitespace-nowrap">
                  <span aria-hidden>→ </span>
                  {m1 === "sukun" ? t("no_vowel") : <Term text={markText(m1)} />}
                </span>
                <span className="font-semibold whitespace-nowrap text-forest">
                  · {sound(m0)} → {m1 === "sukun" ? "–" : sound(m1)}
                </span>
              </>
            ) : what ? (
              <span className="whitespace-nowrap">{what}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function WordFrame({
  fr,
  form,
  recited,
  markText,
  sound,
  t,
}: {
  fr: ComposeFrame;
  form: (n: string | undefined) => ComposeForm | undefined;
  recited: boolean;
  markText: (m: ComposeMark | null | undefined) => string;
  sound: (m: ComposeMark | null | undefined) => string | null | undefined;
  t: T;
}) {
  const tiles = fr.tiles.map((n) => [n, form(n)] as const).filter((x): x is readonly [string, ComposeForm] => !!x[1]);
  const lastMark = (f: ComposeForm | undefined) => {
    if (!f) return null;
    const c = [...f.ar].reverse().find((ch) => "ًٌٍَُِ".includes(ch));
    return c ? ({ "َ": "fathah", "ُ": "dhammah", "ِ": "kasrah", "ً": "fathatain", "ٌ": "dhammatain", "ٍ": "kasratain" } as const)[c as "َ"] : null;
  };
  const chips = fr.chips?.length ? <Chips chips={fr.chips} markText={markText} sound={sound} t={t} /> : null;
  // On a phone a join's or drop's note repeats what its chips say ("tidak dibaca", "dibaca
  // dobel"; the narration says it too): it is left out there, so the figure stays above the panel.
  const note = fr.note ? (
    <p className={clsx("max-w-full text-center text-sm text-pretty text-ink-muted", chips && (fr.stage === "join" || fr.stage === "drop") && "hidden sm:block")}>
      {fr.note}
    </p>
  ) : null;

  if (fr.stage === "join" && Array.isArray(fr.from)) {
    const parts = fr.from.map((n) => form(n)).filter((x): x is ComposeForm => !!x);
    const joined = tiles[0]?.[1];
    return (
      <>
        <div className="flex min-h-6 max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {note}
          {chips}
        </div>
        <div className="grid max-w-full place-items-center">
          <div data-compose-before data-compose-row dir="rtl" className="col-start-1 row-start-1 flex flex-wrap items-center justify-center gap-2">
            {parts.map((p, i) => (
              <Fragment key={i}>
                {i > 0 ? <Plus /> : null}
                <Tile f={p} />
              </Fragment>
            ))}
          </div>
          {joined ? (
            <div data-compose-after className="col-start-1 row-start-1 flex flex-col items-center">
              <Tile f={joined} tag={parts.map((p) => p.translit).join(" + ")} recited={recited} />
            </div>
          ) : null}
        </div>
      </>
    );
  }

  const fromForm = typeof fr.from === "string" ? form(fr.from) : undefined;
  const isChange = fr.stage === "change" || fr.stage === "drop";
  return (
    <>
      <div className="flex min-h-6 max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {fr.stage === "base" && fr.focus ? (
          <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-sm text-ink">
            <span className="rounded-full bg-forest px-2 py-px font-semibold whitespace-nowrap text-paper">{t("base_tag")}</span>
            <Term text={markText(lastMark(form(fr.focus)))} />
            <span className="font-semibold whitespace-nowrap text-forest">· {t("sound", { v: sound(lastMark(form(fr.focus))) ?? "" })}</span>
          </span>
        ) : null}
        {chips}
        {note}
      </div>
      <div dir="rtl" className="flex max-w-full flex-wrap items-end justify-center gap-2">
        {tiles.map(([n, f], i) => (
          <Fragment key={n}>
            {i > 0 && fr.stage !== "whole" ? <Plus /> : null}
            <Tile
              f={f}
              before={isChange && (fr.to ?? fr.tiles[0]) === n ? fromForm : undefined}
              tag={fr.cause === n ? <span className="font-semibold text-forest">{t("cause_tag")}</span> : undefined}
              ring={fr.focus === n || (isChange && (fr.to ?? fr.tiles[0]) === n)}
              recited={recited && tiles.length === 1}
              quran={i === tiles.length - 1 && tiles.length === 1 && (fr.stage === "drop" || fr.stage === "whole" || recited)}
            />
          </Fragment>
        ))}
      </div>
    </>
  );
}

function PrimerFrame({
  fr,
  form,
  marks,
  t,
}: {
  fr: ComposeFrame;
  form: (n: string | undefined) => ComposeForm | undefined;
  marks: ComposeFile["marks"];
  t: T;
}) {
  const ms = fr.marks ?? [];
  const examples = fr.tiles.map((n) => form(n)).filter((x): x is ComposeForm => !!x);
  const name = (m: ComposeMark) => {
    const d = marks[m]?.display ?? m;
    const i = d.indexOf(" (");
    return i > 0 ? { latin: d.slice(0, i), ar: d.slice(i + 2, -1) } : { latin: d, ar: null };
  };
  const what = (m: ComposeMark) => (marks[m]?.sound ? t("sound", { v: marks[m]!.sound! }) : m === "sukun" ? t("no_vowel") : t("doubled"));
  return (
    <div className="flex max-w-full flex-wrap items-stretch justify-center gap-3 sm:gap-6">
      {ms.map((m, i) => {
        const n = name(m);
        const ex = fr.stage === "mark" ? (ms.length === examples.length ? [examples[i]] : i === 0 ? examples : []) : [];
        return (
          <div key={m} className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            <div className="flex flex-col items-center">
              <MarkGlyph mark={m} className="h-12 w-11 sm:h-20 sm:w-18" />
              <span className="text-sm leading-tight font-semibold whitespace-nowrap text-ink">{n.latin}</span>
              {n.ar ? <Ar text={n.ar} className="text-ar-sm" /> : null}
              <span className="text-sm leading-tight font-semibold whitespace-nowrap text-forest">{what(m)}</span>
            </div>
            {ex.map((e, k) => (
              <div key={k} className="flex flex-col items-center rounded-xl border-2 border-hairline bg-white px-3 pb-1">
                <Ar text={e.ar} tile className="text-ar-lg sm:text-ar-xl" />
                <span className="text-sm leading-tight text-ink-muted">{e.label}</span>
                <span className="text-base leading-tight font-medium text-ink">{e.translit}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The frame in plain Indonesian for a screen reader (no Arabic script): what the frame shows,
 *  and for a change the before and after forms, the marks and sounds, and what causes it. */
function describeFrame(
  fr: ComposeFrame,
  forms: Record<string, ComposeForm>,
  kind: "compose" | "primer",
  word: number | null,
  t: T,
  markText: (m: ComposeMark | null | undefined) => string,
  sound: (m: ComposeMark | null | undefined) => string | null | undefined,
  recited: boolean,
): string {
  const strip = (s: string) => s.replace(/\s*\([^)]*[؀-ۿ][^)]*\)/g, "").trim();
  const f = (n: string) => forms[n];
  const one = (n: string) => {
    const x = f(n);
    return x ? [x.translit, x.label, x.gloss ? `“${x.gloss}”` : null].filter(Boolean).join(", ") : n;
  };
  const marks = (c: ComposeChip) => {
    const [m0, m1] = c.marks ?? [null, null];
    if (c.silent || (m0 === "sukun" && m1 === null)) return t("silent");
    if (c.to === "") return t("dropped");
    if (m0 === null && m1 === "shaddah") return t("doubled");
    if (m1 === "sukun") return m0 ? `${strip(markText(m0))} → ${t("no_vowel")}` : t("no_vowel");
    return m0 && m1 ? `${strip(markText(m0))} → ${strip(markText(m1))}, ${t("sound", { v: `${sound(m0)} → ${sound(m1)}` })}` : "";
  };
  if (kind === "primer") {
    const ms = (fr.marks ?? []).map((m) => strip(markText(m))).join(", ");
    const ex = fr.tiles.map((n) => `${f(n)?.translit ?? n} (${f(n)?.label ?? ""})`).join(", ");
    return t("aria_primer", { marks: ms, examples: ex || "—" });
  }
  const head = word !== null ? t("word_n", { n: word }) : "";
  const tr = (n: string | undefined) => (n ? (f(n)?.translit ?? n) : "");
  const chips = (fr.chips ?? []).map(marks).filter(Boolean).join("; ");
  let body: string;
  if ((fr.stage === "change" || fr.stage === "drop") && typeof fr.from === "string") {
    const to = fr.to ?? fr.tiles[0];
    body = `${tr(fr.from)} → ${tr(to)}${chips ? ` (${chips})` : ""}${fr.cause ? `, ${t("cause_tag")}: ${one(fr.cause)}` : ""}`;
  } else if (fr.stage === "join" && Array.isArray(fr.from)) {
    body = `${fr.from.map(tr).join(" + ")} → ${tr(fr.tiles[0])}${chips ? ` (${chips})` : ""}`;
  } else if (fr.stage === "base" && fr.focus) {
    const m = [...(f(fr.focus)?.ar ?? "")].reverse().find((ch) => "ًٌٍَُِ".includes(ch));
    const mark = m ? ({ "َ": "fathah", "ُ": "dhammah", "ِ": "kasrah", "ً": "fathatain", "ٌ": "dhammatain", "ٍ": "kasratain" } as const)[m as "َ"] : null;
    body = `${fr.tiles.map(one).join(" + ")}${mark ? ` (${strip(markText(mark))}, ${t("sound", { v: sound(mark) ?? "" })})` : ""}`;
  } else {
    body = fr.tiles.map(one).join(" + ");
  }
  return `${head}: ${t(`stage_${fr.stage}`)}. ${body}${fr.note ? ` (${fr.note})` : ""}${recited ? `. ${t("recited")}` : ""}`;
}
