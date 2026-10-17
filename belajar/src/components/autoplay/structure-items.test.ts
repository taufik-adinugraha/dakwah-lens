import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StructureItemCard } from "@/components/lesson/StructureItemCard";
import { createAutoplayState, LINE_ID_RE, OPENING_EXERCISES, parseLineId, reduceAutoplay, type AutoplayEvent, type AutoplayState } from "@/lib/autoplay";
import { sequenceProblems } from "@/lib/autoplay/checks";
import { SURAHS } from "@/lib/content";
import { MAX_CAPTION } from "@/lib/lessonSteps";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence } from "./build";
import { stageMarks } from "./caption";
import { narrationFor } from "./manifests";

// THE SENTENCE STRUCTURE AS SEPARATE ITEMS (operator 2026-10-13: "can we make this kind of
// explanation in items: harfjar in one item, idhafah in next item etc, it's kind of confusing which
// for which in this paragraph"). Until then an ayah's structure was ONE narrated paragraph said
// over the whole ayah, every word lit. An ayah whose content has `structure.items` is now told
// item by item: one STEP per item ("structure:1" …), with one line, the item's words lit on the
// mushaf line and shown on the stage's card; "↺ Ulangi" replays that item. An ayah without items
// (the Mu'awwidzat) is told from its summary as before.
//
// Here: the steps and their lines against the content, the manifest's lines, what the stage marks
// and shows, and the replay. The pipeline's half (the lines are the authored `say` strings through
// the strict sanitiser, never split) is pipeline/test_validate_narration.py's.

const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const OTHERS = SURAHS.filter((s) => s.slug !== "al-fatihah");
const LINES = narrationFor("al-fatihah")?.lines ?? {};
type Seq = ReturnType<typeof stageSequence>;
type AyahOf = (typeof FATIHAH.ayat)[number];
const itemSteps = (ayah: AyahOf) => stageSequence(FATIHAH, ayah, "id").steps.filter((s) => s.kind === "structure");
/** What the engine's own check says about the structure steps of `seq` (its other rules need the
 *  lesson's whole context: lesson-map.test.ts, autoplay.test.ts). */
const told = (seq: Seq, ayah: Pick<AyahOf, "words" | "structure">) =>
  sequenceProblems(seq, { ayah, introduced: [], exercises: [], last: false }).filter((p) => /structure|item/.test(p) && !/comes before/.test(p));

describe("the structure of an ayah, told item by item", () => {
  it("Al-Fatihah: one step per item, in the content's order, each with its one line and its words — 24 items on the seven ayat", () => {
    const counts: number[] = [];
    for (const a of FATIHAH.ayat) {
      const items = a.structure?.items ?? [];
      const steps = itemSteps(a);
      counts.push(items.length);
      expect(steps.map((s) => s.id), `ayah ${a.ayah}`).toEqual(items.map((_, i) => `structure:${i + 1}`));
      steps.forEach((st, i) => {
        const where = `ayah ${a.ayah} item ${i + 1}`;
        expect(st.lines, where).toEqual([`al-fatihah:${a.ayah}:structure:${i + 1}`]);
        expect(st.item, where).toEqual({ n: i + 1, of: items.length, words: items[i].words });
        // The line lights the words the item is about, and shows no word card.
        expect([st.cues[0].highlight, st.cues[0].focus], where).toEqual([items[i].words, null]);
        // No animation, no recitation, no example: a caption and the words.
        expect([st.frames, st.recite, st.examples, st.cues[0].frame], where).toEqual([undefined, undefined, undefined, null]);
      });
      // The one line of the summary is gone from an ayah told by its items.
      expect(stageSequence(FATIHAH, a, "id").steps.some((s) => s.id === "structure"), `ayah ${a.ayah}`).toBe(false);
      expect(told(stageSequence(FATIHAH, a, "id"), a), `ayah ${a.ayah}`).toEqual([]);
    }
    expect(counts).toEqual([4, 4, 2, 3, 3, 3, 5]);
  });

  it("the items come after the new concepts and before the exercises, one after another", () => {
    for (const a of FATIHAH.ayat) {
      const steps = stageSequence(FATIHAH, a, "id").steps;
      const kinds = steps.map((s) => s.kind);
      const first = kinds.indexOf("structure");
      const last = kinds.lastIndexOf("structure");
      expect(kinds.slice(first, last + 1).every((k) => k === "structure"), `ayah ${a.ayah}`).toBe(true);
      expect(Math.max(kinds.lastIndexOf("concept"), kinds.lastIndexOf("example")), `ayah ${a.ayah}`).toBeLessThan(first);
      // (the warm-up opens the lesson, before its words: types.ts OPENING_EXERCISES)
      const exercise = steps.findIndex((s) => s.kind === "exercise" && !OPENING_EXERCISES.includes(s.exercise!.key));
      if (exercise !== -1) expect(last, `ayah ${a.ayah}`).toBeLessThan(exercise);
    }
  });

  it("the manifest has exactly those lines: each lights its item's words, none is split, the first opens with the lead", () => {
    for (const a of FATIHAH.ayat) {
      const items = a.structure?.items ?? [];
      const ids = Object.keys(LINES).filter((k) => k.startsWith(`al-fatihah:${a.ayah}:structure`));
      expect(ids, `ayah ${a.ayah}`).toEqual(items.map((_, i) => `al-fatihah:${a.ayah}:structure:${i + 1}`));
      ids.forEach((k, i) => {
        expect(LINE_ID_RE.test(k), k).toBe(true);
        expect(parseLineId(k), k).toMatchObject({ kind: "ayah", ayah: a.ayah, part: `structure:${i + 1}`, split: null });
        expect(LINES[k].highlight, k).toEqual(items[i].words);
        expect(LINES[k].focus ?? null, k).toBeNull();
        expect(LINES[k].text.startsWith("Sekarang susunan kalimatnya. "), k).toBe(i === 0);
      });
    }
    // The grammar of the ids: an item's number, and a split letter only after a full id.
    expect(LINE_ID_RE.test("al-fatihah:1:structure:0")).toBe(false);
    expect(LINE_ID_RE.test("al-fatihah:1:structure:x1")).toBe(false);
    expect(parseLineId("al-ikhlas:1:structure:a")).toMatchObject({ part: "structure", split: "a" });
  });

  it("without narration (an English page, a surah not rendered) an item's caption is its own text, the first after the lead", () => {
    const a = FATIHAH.ayat[0];
    const en1 = stageSequence(FATIHAH, a, "en").steps.filter((s) => s.kind === "structure");
    const items = a.structure!.items!;
    expect(en1[0].cues[0].caption.startsWith("Now how its sentence is built. ")).toBe(true);
    // (its named words as their transliteration: "Kata {{1:1:1/ismi}} …" reads "Kata ismi …", 2026-10-17)
    expect(en1[1].cues[0].caption).toBe(items[1].say.replace("{{1:1:1/ismi}}", "ismi").replace("{{1:1:2}}", "Allāhi").replace(/\s+/g, " ").trim());
    // … and never a word in Arabic script (the engine's own captions carry none).
    for (const st of en1) expect(st.cues[0].caption).not.toMatch(/[؀-ۿ]/);
    // One short part at a time: an item is a sentence or two, not a paragraph.
    for (const x of FATIHAH.ayat) for (const st of itemSteps(x)) for (const part of st.cues[0].parts) expect(part.length, `${x.ayah} ${st.id}`).toBeLessThanOrEqual(MAX_CAPTION);
  });

  it("the Mu'awwidzat are told from their summary: one structure step, the whole ayah lit", () => {
    for (const s of OTHERS) {
      for (const a of s.ayat) {
        expect(a.structure?.items, `${s.slug} ${a.ayah}`).toBeUndefined();
        const steps = stageSequence(s, a, "id").steps.filter((x) => x.kind === "structure");
        expect(steps.map((x) => [x.id, x.item]), `${s.slug} ${a.ayah}`).toEqual([["structure", undefined]]);
        expect(steps[0].cues[0].highlight, `${s.slug} ${a.ayah}`).toEqual(a.words.map((_, i) => i + 1));
      }
    }
  });
});

describe("the engine's check holds the steps to the content's items (planted faults)", () => {
  const a = FATIHAH.ayat[0];
  const seq = stageSequence(FATIHAH, a, "id");
  const with_ = (change: (steps: Seq["steps"]) => Seq["steps"]): Seq => ({ ...seq, steps: change(seq.steps.map((s) => ({ ...s, cues: s.cues.map((c) => ({ ...c })) }))) });
  const at = (steps: Seq["steps"], sid: string) => steps.findIndex((s) => s.id === sid);

  it("an item left out, two items swapped, the one summary step beside them", () => {
    expect(told(seq, a)).toEqual([]);
    expect(told(with_((st) => st.filter((s) => s.id !== "structure:2")), a).join("\n")).toContain("are not the ayah's items, one step each, in order");
    const swapped = with_((st) => {
      const [i, j] = [at(st, "structure:1"), at(st, "structure:2")];
      [st[i], st[j]] = [st[j], st[i]];
      return st;
    });
    expect(told(swapped, a).join("\n")).toContain("are not the ayah's items, one step each, in order");
    const both = with_((st) => [...st.slice(0, at(st, "structure:1")), { ...st[at(st, "structure:1")], id: "structure", item: undefined }, ...st.slice(at(st, "structure:1"))]);
    expect(told(both, a).join("\n")).toContain("are not the ayah's items");
  });

  it("an item about other words than the content gives it, or lighting the whole ayah as the one line did", () => {
    const other = with_((st) => st.map((s) => (s.id === "structure:2" ? { ...s, item: { ...s.item!, words: [2, 3] } } : s)));
    expect(told(other, a).join("\n")).toContain("structure:2: is not about item 2 of 4 and its words [1,2]");
    const whole = with_((st) => st.map((s) => (s.id === "structure:2" ? { ...s, cues: [{ ...s.cues[0], highlight: [1, 2, 3, 4] }] } : s)));
    expect(told(whole, a).join("\n")).toContain("structure:2: its one line must light the item's words [1,2]");
    const card = with_((st) => st.map((s) => (s.id === "structure:3" ? { ...s, cues: [{ ...s.cues[0], focus: 2 }] } : s)));
    expect(told(card, a).join("\n")).toContain("structure:3: its one line must light the item's words [2,3,4] and show no word card");
  });

  it("an ayah told from its summary: one step, and no item on it; an ayah with items told from its summary is refused", () => {
    const ikhlas = SURAHS.find((s) => s.slug === "al-ikhlas")!;
    const plain = stageSequence(ikhlas, ikhlas.ayat[0], "id");
    expect(told(plain, ikhlas.ayat[0])).toEqual([]);
    const itemed = { ...plain, steps: plain.steps.map((s) => (s.id === "structure" ? { ...s, item: { n: 1, of: 1, words: [1] } } : s)) };
    expect(told(itemed, ikhlas.ayat[0]).join("\n")).toContain("an item on the step of a structure told from its summary");
    // The content says items; the sequence has the one summary step.
    const bare = { ...a, structure: { ...a.structure!, items: undefined } };
    const fromSummary = stageSequence(FATIHAH, bare, "id");
    expect(fromSummary.steps.filter((s) => s.kind === "structure").map((s) => s.id)).toEqual(["structure"]);
    expect(told(fromSummary, a).join("\n")).toContain("are not the ayah's items, one step each, in order");
  });
});

describe("an item on the stage", () => {
  const started = (ayah: (typeof FATIHAH.ayat)[number], stepId: string): { seq: ReturnType<typeof stageSequence>; s: AutoplayState; at: number } => {
    const seq = stageSequence(FATIHAH, ayah, "id");
    const at = seq.steps.findIndex((x) => x.id === stepId);
    const s = reduceAutoplay(seq, createAutoplayState(seq, { pace: "biasa" }), { type: "start", pace: "biasa", from: at, reason: "continue" });
    return { seq, s, at };
  };
  const end = (s: AutoplayState): AutoplayEvent => {
    const a = s.activity!;
    return a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };
  };

  it("the mushaf line marks the item's words while it is said — and the next item's when the lesson moves on by itself", () => {
    const a = FATIHAH.ayat[0];
    const items = a.structure!.items!;
    let { seq, s, at } = started(a, "structure:1");
    expect(s.idx).toBe(at);
    expect(stageMarks(seq, s)).toEqual({ marked: items[0].words, focus: null });
    // Through the item (its line, said or read, and the pause after a said line): the next item.
    for (let i = 0; i < 20 && s.idx === at; i++) s = reduceAutoplay(seq, s, end(s));
    expect(seq.steps[s.idx].id).toBe("structure:2");
    expect(stageMarks(seq, s)).toEqual({ marked: items[1].words, focus: null });
    ({ seq, s, at } = started(FATIHAH.ayat[6], "structure:4"));
    expect(stageMarks(seq, s)).toEqual({ marked: [5, 6, 7], focus: null });
  });

  it("“↺ Ulangi” replays the item it is on, from its start — not the whole structure", () => {
    const { seq, s, at } = started(FATIHAH.ayat[1], "structure:3");
    const first = s.activity!;
    const again = reduceAutoplay(seq, s, { type: "replay" });
    expect([again.idx, again.phase, again.part]).toEqual([at, "running", 0]);
    expect(again.activity?.kind).toBe(first.kind);
    expect(again.activity!.token).toBeGreaterThan(first.token);
    // "Tunggu saya" holds each item for its own "Lanjut".
    const held = reduceAutoplay(seq, createAutoplayState(seq, { pace: "tunggu" }), { type: "start", pace: "tunggu", from: at, reason: "continue" });
    const voiced = seq.steps[at].cues[0].audio.length > 0;
    if (!voiced) expect([held.idx, held.phase]).toEqual([at, "ready"]);
  });

  const MSG = { id, en } as const;
  const card = (locale: keyof typeof MSG, n: number, total: number, words: { index: number; ar: string; translit: string }[]) => {
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale,
      messages: MSG[locale],
      timeZone: "Asia/Jakarta",
      children: createElement(StructureItemCard, { n, total, words }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  it("the card shows the item's words — their Arabic from the content, transliteration and place — under “Susunan kalimat (n dari N)”", () => {
    for (const a of FATIHAH.ayat) {
      const items = a.structure!.items!;
      items.forEach((it, i) => {
        const words = it.words.map((w) => ({ index: w, ar: a.words[w - 1].ar, translit: a.words[w - 1].translit }));
        const html = card("id", i + 1, items.length, words);
        const where = `ayah ${a.ayah} item ${i + 1}`;
        expect(html, where).toContain(`data-autoplay="structure-item" data-item="${i + 1}"`);
        expect(text(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(html)![1]), where).toBe(`Susunan kalimat (${i + 1} dari ${items.length})`);
        const shown = [...html.matchAll(/<li data-item-word="(\d+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ index: Number(m[1]), inner: m[2] }));
        expect(shown.map((x) => x.index), where).toEqual(it.words);
        for (const x of shown) {
          const w = a.words[x.index - 1];
          // The word's bytes once, in a Qur'an-font element that is never cut; its place as the
          // narrator names it.
          expect(x.inner.split(w.ar).length - 1, where).toBe(1);
          expect(x.inner, where).toMatch(/<span lang="ar" dir="rtl" class="[^"]*\bquran\b[^"]*\bwhitespace-nowrap\b/);
          expect(text(x.inner), where).toContain(`Kata ke-${x.index}`);
        }
        // The ayah's reading order, right to left; nothing to click, nothing hidden from the eye.
        expect(html, where).toMatch(/<ul dir="rtl"/);
        expect(html, where).not.toMatch(/<button|<a |sr-only/);
        // No separator that could start a line (the count stands in brackets).
        expect(text(html), where).not.toMatch(/[·•—–]/);
      });
    }
    expect(text(card("en", 2, 4, [{ index: 1, ar: FATIHAH.ayat[0].words[0].ar, translit: "bismi" }]))).toContain("Sentence structure (2 of 4)");
  });

  it("at most four words on a card (the room a phone leaves): no item of Al-Fatihah is about more", () => {
    for (const a of FATIHAH.ayat) for (const it of a.structure!.items!) expect(it.words.length, `ayah ${a.ayah}`).toBeLessThanOrEqual(4);
  });
});

describe("a named word (pipeline validate_narration “named words”, operator 2026-10-17)", () => {
  it("its markup never reaches a caption: a caption-only line (an English page) shows its transliteration", () => {
    let named = 0;
    for (const s of SURAHS)
      for (const a of s.ayat)
        for (const locale of ["id", "en"]) {
          const seq = stageSequence(s, a, locale);
          for (const c of seq.steps.flatMap((st) => st.cues)) {
            expect(c.caption, `${s.slug}:${a.ayah} ${locale} ${c.line}`).not.toMatch(/\{\{|\}\}/);
            for (const p of c.parts) expect(p, c.line).not.toMatch(/\{\{|\}\}/);
          }
          if (s.slug === "al-fatihah" && a.ayah === 1 && locale === "en") {
            const item = seq.steps.find((st) => st.id === "structure:1")!.cues[0].caption;
            expect(item).toContain("yaitu bi yang artinya “dengan”, sehingga isim sesudahnya, yaitu ismi yang artinya “nama”");
            named++;
          }
        }
    expect(named).toBe(1);
  });
});
