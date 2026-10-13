import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExampleCard } from "@/components/lesson/ExampleCard";
import { WordComposition } from "@/components/lesson/WordComposition";
import type { Ayah, SurahContent } from "@/content/schema";
import {
  audioAhead,
  claimsEnding,
  createAutoplayState,
  EXAMPLE_FAILED_HOLD_MS,
  EXAMPLE_LOAD_LIMIT_MS,
  EXAMPLE_WARM_DELAY_MS,
  exampleGivesUp,
  exampleReadMs,
  exampleToWarm,
  hasArabicScript,
  lessonExamples,
  lessonRuns,
  LOADING_SHOW_MS,
  LOADING_SLOW_MS,
  lookaheadAudio,
  MAX_EXAMPLES_PER_RULE,
  nextNarration,
  positionToSave,
  reduceAutoplay,
  restoreIndex,
  screenAwake,
  stageExamples,
  viewAutoplay,
  type Activity,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type ExampleBeat,
  type LessonExample,
} from "@/lib/autoplay";
import { exampleProblems, loadCheckInput, runAutoplayChecks, transitionProblem, type ExampleContext } from "@/lib/autoplay/checks";
import { composeFor } from "@/lib/compose-content";
import { STOP_NOTE } from "@/lib/composition";
import { SURAHS } from "@/lib/content";
import { hasWaqfNote, waqfDrop } from "@/lib/heard";
import { captionMs, PACES, type Pace } from "@/lib/lessonSteps";
import { conceptsIntroducedIn, LIBRARY } from "@/lib/library";

import { lessonExamplesFor, stageSequence } from "./build";
import { stageExample, stageFrame, stageMarks } from "./caption";
import { AUTOPLAY_TEXT_SETS, autoplayTexts } from "./texts";

// "In explanation, for example when explaining dhommah, kasrah, etc provide example + additional
// voice. e.g ismu (read by voice + show visual) when combined with harf jar, it becomes ismi (read
// by voice + visual). in principel, each explanation should be followed by examples (visual +
// voice)" — "not only for harakah, but also for all rules" (operator 2026-10-12; plan L20). The
// static pages got this with PR #100; here it is checked INSIDE the autoplay lesson, over the
// lessons the page ships: which beats (src/lib/autoplay/examples.ts), that each has its Arabic and
// a recording and is labelled by what is heard, and how the lesson plays them (machine.ts).

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const WALK_TIMEOUT_MS = 120_000;

const surah = (slug: string): SurahContent => {
  const s = SURAHS.find((x) => x.slug === slug);
  if (!s) throw new Error(`no ${slug}`);
  return s;
};
const FATIHAH = surah("al-fatihah");
const WORDS = new Map(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w] as const))));

type Lesson = { slug: string; ayah: Ayah; seq: AutoplaySequence; derived: ReturnType<typeof lessonExamplesFor>; ctx: ExampleContext };
const lessonOf = (s: SurahContent, a: Ayah, locale: "id" | "en" = "id"): Lesson => {
  const derived = lessonExamplesFor(s, a);
  return {
    slug: s.slug,
    ayah: a,
    seq: stageSequence(s, a, locale),
    derived,
    ctx: {
      ayah: a,
      introduced: conceptsIntroducedIn(a.loc),
      compose: composeFor(s.slug),
      derived,
      clips: LIBRARY.clips,
      wordAt: (loc) => WORDS.get(loc),
      texts: autoplayTexts(locale),
    },
  };
};
const fatihah = FATIHAH.ayat.map((a) => lessonOf(FATIHAH, a));
const every = SURAHS.flatMap((s) => s.ayat.map((a) => lessonOf(s, a)));
const beatsOf = (seq: AutoplaySequence) => seq.steps.flatMap((st) => (st.examples ?? []).map((b) => ({ step: st, beat: b })));
const exampleOf = (a: Activity | null): string | null => (a?.kind === "recite" && a.target !== "ayah" ? (a.example ?? null) : null);

/** What the stage answers to `s` when the lesson is left to run (ahead.test.ts `answer`). */
function answer(seq: AutoplaySequence, s: AutoplayState): AutoplayEvent | null {
  if (s.phase === "finished" || s.phase === "paused" || s.phase === "idle") return null;
  const a = s.activity;
  if (a?.kind === "narrate") return { type: "narration_end", token: a.token };
  if (a?.kind === "read" || a?.kind === "wait") return { type: "timer", token: a.token };
  if (a?.kind === "recite") return { type: "recite_end", token: a.token };
  if (s.phase === "waiting") return { type: "skip" };
  if (s.phase === "ready") return { type: "next" };
  return null;
}
const started = (seq: AutoplaySequence, pace: Pace, from?: number): AutoplayState =>
  reduceAutoplay(seq, createAutoplayState(seq, { pace }), { type: "start", pace, from, reason: from ? "restore" : "fresh" });
/** Every state from `s` until the lesson has finished (or `until` says stop: that state is last). */
function run(seq: AutoplaySequence, s: AutoplayState, until?: (s: AutoplayState) => boolean): AutoplayState[] {
  const states = [s];
  for (let i = 0; i < 6000 && !until?.(s); i++) {
    const e = answer(seq, s);
    if (!e) break;
    s = reduceAutoplay(seq, s, e);
    states.push(s);
  }
  return states;
}
/** The lesson played from its start until example beat `id` is being recited. */
function atBeat(seq: AutoplaySequence, id: string, pace: Pace = "biasa"): AutoplayState {
  const states = run(seq, started(seq, pace), (s) => exampleOf(s.activity) === id);
  const s = states[states.length - 1];
  if (exampleOf(s.activity) !== id) throw new Error(`${seq.lessonKey}: the lesson never recited example ${id}`);
  return s;
}

describe("which examples a lesson plays (src/lib/autoplay/examples.ts)", () => {
  it("Al-Fatihah: every concept line has its example in this ayah, every bentuk dasar heard in the Qur'an its clip — 35 beats, the rest listed with a reason", () => {
    const rows = Object.fromEntries(fatihah.map((l) => [l.ayah.ayah, beatsOf(l.seq).map(({ step, beat }) => `${step.id} → ${beat.key}`)]));
    expect(rows[1]).toEqual([
      // "ismu (read by voice + show visual) … becomes ismi (read by voice + visual)": the base
      // form where the Qur'an has it, heard with the word before it (hamzat washal); the joined
      // word is the lesson's own, which the imam recites when its step opens (plan L24).
      "w1:compose → 55:78:1-2",
      "w2:compose → 112:2:1",
      "w3:compose → 20:5:1",
      "concept:kalimah-isim-fiil-huruf:ex → 1:1:1",
      "concept:tanda-irab:ex → 1:1:1",
      "concept:huruf-jar:ex → 1:1:1",
      "concept:idhafah:ex → 1:1:2",
      "concept:naat:ex → 1:1:3",
    ]);
    expect(rows[2]).toEqual(["w2:compose → 112:2:1", "w3:compose → 41:9:13", "concept:jumlah-ismiyyah:ex → 1:2:1", "concept:syibhul-jumlah:ex → 1:2:2", "concept:jamak-mudzakkar-salim:ex → 1:2:4"]);
    expect(rows[3]).toEqual(["concept:wazan-dan-tashrif:ex → 1:3:1"]);
    expect(rows[4]).toEqual(["w2:compose → 37:20:4", "concept:isim-fail:ex → 1:4:1"]);
    expect(rows[6]).toEqual(["concept:fiil-amr:ex → 1:6:1", "concept:maful-bih:ex → 1:6:1"]);
    // an‘ama: the Konsep diagram's place (plan L19: QS 5:23, a clean alignment), not QS 4:69.
    expect(rows[7].slice(0, 3)).toEqual(["w1:compose → 6:126:2", "w3:compose → 5:23:6", "w5:compose → 74:10:3"]);
    const all = fatihah.flatMap((l) => beatsOf(l.seq));
    expect(all.length).toBe(35);
    expect(all.filter((x) => x.beat.word !== null).length).toBe(26);
    expect(all.filter((x) => x.beat.clip !== null).length).toBe(9);
    // A concept introduced here: exactly one example step, right after its line.
    for (const l of fatihah) {
      for (const c of conceptsIntroducedIn(l.ayah.loc)) {
        const at = l.seq.steps.findIndex((s) => s.id === `concept:${c.id}`);
        const ex = l.seq.steps[at + 1];
        expect([ex.kind, ex.id, ex.examples?.[0]?.key, ex.cues.length], `${l.seq.lessonKey} ${c.id}`).toEqual(["example", `concept:${c.id}:ex`, c.examples[0].loc, 0]);
      }
    }
    // Without a beat of their own: listed, each with its reason (no hand list: the build's).
    const gaps = fatihah.flatMap((l) => l.derived.gaps.map((g) => `${l.ayah.ayah} ${g.step}: ${g.rule}`));
    expect(gaps).toEqual([
      "2 w1:compose: bentuk dasar al-ḥamdu",
      "4 w1:compose: bentuk dasar māliku",
      "5 w2:compose: bentuk dasar na‘budu",
      "5 w4:compose: bentuk dasar nasta‘īnu",
      "6 w2:compose: bentuk dasar aṣ-ṣirāṭu",
      "6 w3:compose: bentuk dasar al-mustaqīmu",
      "7 w6:compose: bentuk dasar al-magḍūbu",
    ]);
    for (const l of fatihah) for (const g of l.derived.gaps) expect(g.why.length, g.step).toBeGreaterThan(20);
  });

  // "When transation from word X to X+1, i think we dont need to recite the X, just directly to
  // X+1" (operator 2026-10-13, plan L24). Until then this test read "every composition ends with
  // the imam reciting the joined word", and a word WITHOUT a composition got a beat of its own
  // (rule (c): "w2:word", the word recited again after the line that explains its harakah).
  // The one exception (coordinator's decision, the same day): the ayah's LAST word is recited once
  // more after the last line of its composition — the line that says the imam stops on it and
  // what is not heard there; no next word follows it.
  it("the lesson's own word is recited once, when its step opens: no composition but that of the ayah's last word ends with it, and no beat repeats it after its own line", () => {
    const stops: string[] = [];
    for (const l of every) {
      const n = l.ayah.words.length;
      // The step that recites the last word again: its composition, where the content's last
      // frame of it carries the stop note (Al-Fatihah: all seven ayat; the Mu'awwidzat have no
      // compositions, and no last word's line there speaks of the stop: none).
      const unit = composeFor(l.slug)?.words[l.ayah.words[n - 1].loc];
      const stop = !!unit && unit.frames[unit.frames.length - 1].note === STOP_NOTE;
      if (stop) stops.push(`${l.seq.lessonKey}:w${n}`);
      // One step recites each word, its opening step — with compositions or without.
      expect(l.seq.steps.filter((st) => st.recite?.target === "word").map((st) => st.id), l.seq.lessonKey).toEqual([...l.ayah.words.map((_, i) => `w${i + 1}:recite`), ...(stop ? [`w${n}:compose`] : [])]);
      for (const st of l.seq.steps) {
        const where = `${l.seq.lessonKey} ${st.id}`;
        if (st.kind === "compose") expect(st.recite, where).toEqual(stop && st.word === n ? { target: "word", word: n } : undefined);
        if (st.kind === "explain") expect(st.examples, where).toBeUndefined();
        // Nor does a beat inside a composition recite the step's own word.
        if (st.kind === "compose") for (const b of st.examples ?? []) expect(b.word, `${where} ${b.id}`).not.toBe(st.word);
      }
    }
    // The Mu'awwidzat (no compositions yet): Al-Ikhlas 1 had the beats "w2:word" and "w3:word"
    // (huwa, Allāhu) and listed w4 (aḥadun: its tanwin is not heard at the ayah's end). Now its
    // beats are its concepts' examples alone, and no word's line is listed as lacking one.
    const ikhlas = lessonOf(surah("al-ikhlas"), surah("al-ikhlas").ayat[0]);
    expect(beatsOf(ikhlas.seq).map((x) => `${x.step.id} → ${x.beat.key}`)).toEqual(["concept:maqul-al-qaul:ex → 112:1:1", "concept:dhamir-syan:ex → 112:1:2", "concept:khabar-jumlah:ex → 112:1:2"]);
    expect(ikhlas.derived.gaps).toEqual([]);
    expect(stops).toEqual(["al-fatihah/1:w4", "al-fatihah/2:w4", "al-fatihah/3:w2", "al-fatihah/4:w3", "al-fatihah/5:w4", "al-fatihah/6:w3", "al-fatihah/7:w9"]);
    // What that line says is true of each of the seven: the pause drops its last harakah (heard.ts),
    // and its line — the composition's last, over its last frame — says the imam stops on it.
    for (const l of fatihah) {
      const last = l.ayah.words[l.ayah.words.length - 1];
      const unit = composeFor("al-fatihah")!.words[last.loc];
      expect([last.loc, waqfDrop(last.ar), unit.lines[unit.lines.length - 1].frame], last.translit).toEqual([last.loc, "harakat", unit.frames.length]);
      expect(unit.lines[unit.lines.length - 1].say, last.translit).toMatch(/^Ini kata terakhir (ayat|surah), dan imam berhenti padanya/);
      expect(unit.lines.filter((x) => x.frame === unit.frames.length).length, last.translit).toBe(1);
    }
    // … and the stop note stands nowhere else in the file.
    const noted = Object.entries(composeFor("al-fatihah")!.words).flatMap(([loc, u]) => u.frames.flatMap((f, i) => (f.note === STOP_NOTE ? [`${loc}#${i + 1}/${u.frames.length}`] : [])));
    expect(noted).toEqual(["1:1:4#3/3", "1:2:4#4/4", "1:3:2#3/3", "1:4:3#3/3", "1:5:4#3/3", "1:6:3#4/4", "1:7:9#4/4"]);
  });

  it("a second example, from elsewhere, only when the example here is about an ending the imam's stop drops", () => {
    expect(claimsEnding("bismi: kasrah, tanda jar, karena didahului bi-.", "kasrah")).toBe(true);
    expect(claimsEnding("al-ḥamdu: mubtada', berakhir dhammah.", "dhammah")).toBe(true);
    expect(claimsEnding("nasta‘īnu: pola nastaf‘ilu, bermakna memohon pertolongan.", "dhammah")).toBe(false);
    // a letter or a sukun is not a harakah the pause drops
    expect(claimsEnding("al-‘ālamīna: majrur dengan ya'.", "ya'")).toBe(false);
    expect(claimsEnding("mabni di atas sukun", "sukun")).toBe(false);
    // In the lessons today no first example is both ayah-final and about its last harakah: none.
    for (const l of every) expect(l.derived.examples.filter((e) => e.of === "concept" && e.id.endsWith(":2")), l.seq.lessonKey).toEqual([]);
    // The rule itself, on Al-Ikhlas 1 with a concept whose example here is the ayah's last word
    // (aḥadun: its dhammatain is not heard at the pause) and is about that ending.
    const a = surah("al-ikhlas").ayat[0];
    const lastWord = a.words[a.words.length - 1];
    const concept = (others: string[]) => ({
      id: "contoh",
      examples: [{ loc: lastWord.loc, note: `${lastWord.translit}: khabar, berakhir ${lastWord.case.sign}.` }, ...others.map((loc) => ({ loc, note: "contoh lain" }))],
    });
    const derive = (others: string[]) =>
      lessonExamples({ ayah: a, introduced: [concept(others)], compose: null, clips: LIBRARY.clips, wordAt: (loc) => WORDS.get(loc) });
    // another ayah's word that does not end its ayah: a clip of it
    const far = derive(["112:4:5", "112:4:4"]).examples.filter((e) => e.of === "concept");
    expect(far.map((e) => [e.id, e.key, e.word, e.waqf])).toEqual([
      ["concept:contoh:1", lastWord.loc, a.words.length, true],
      ["concept:contoh:2", "112:4:4", null, false],
    ]);
    expect(far[1].clip).toEqual(LIBRARY.clips["112:4:4"]);
    expect(far[1].clip?.last).toBeUndefined();
    // a word of this very ayah: the stage's own player, no clip
    const near = derive(["112:1:3"]).examples.filter((e) => e.of === "concept");
    expect([near[1].key, near[1].word, near[1].clip]).toEqual(["112:1:3", 3, null]);
    // only ayah-final examples elsewhere: none is added, and the lesson says why
    const none = derive(["112:4:5"]);
    expect(none.examples.filter((e) => e.of === "concept").length).toBe(1);
    expect(none.gaps.some((g) => g.step === "concept:contoh:ex" && /does not end its ayah/.test(g.why))).toBe(true);
    expect(MAX_EXAMPLES_PER_RULE).toBe(2);
  });

  it("the harakah an example is about is named beside it only when it is heard there", () => {
    const drawn = Object.assign({}, ...fatihah.map((l) => stageExamples(l.derived.examples))) as ReturnType<typeof stageExamples>;
    const named = Object.entries(drawn).filter(([, e]) => e.ending !== null).map(([id, e]) => `${id} ${e.ending}`);
    expect(named).toEqual([
      "concept:tanda-irab:1 kasrah",
      "concept:huruf-jar:1 kasrah",
      "concept:idhafah:1 kasrah",
      "concept:jumlah-ismiyyah:1 dhammah",
      "concept:murab-mabni:1 fathah",
      "concept:fiil-mudhari:1 dhammah",
    ]);
    // The rule on a word that ENDS its ayah (no lesson has such an example today): ar-raḥīmi,
    // the last word of Al-Fatihah 1, as the example of a rule about its kasrah — the imam stops
    // there, so the kasrah is not named as heard; the beat says the stop instead. The word before
    // it, with the same note: named.
    const a1 = FATIHAH.ayat[0];
    const about = (n: number) =>
      lessonExamples({
        ayah: a1,
        introduced: [{ id: "contoh", examples: [{ loc: a1.words[n - 1].loc, note: `${a1.words[n - 1].translit}: sifat, ikut majrur dengan kasrah.` }] }],
        compose: null,
        clips: LIBRARY.clips,
        wordAt: (loc) => WORDS.get(loc),
      }).examples.find((e) => e.of === "concept");
    expect([about(4)?.ending, about(4)?.waqf]).toEqual([null, true]);
    expect([about(3)?.ending, about(3)?.waqf]).toEqual(["kasrah", false]);
    // Every drawing is the content's own bytes, with its transliteration; a meaning where the content has one.
    for (const l of fatihah) {
      const marks = composeFor(l.slug)?.marks ?? {};
      for (const e of l.derived.examples) {
        expect(hasArabicScript(e.ar), e.id).toBe(true);
        expect(hasArabicScript(e.translit) || hasArabicScript(e.gloss ?? ""), e.id).toBe(false);
        if (e.ending) expect(marks[e.ending]?.sound, e.id).toBeTruthy();
        if (e.word !== null) expect([e.ar, e.translit, e.gloss], e.id).toEqual([l.ayah.words[e.word - 1].ar, l.ayah.words[e.word - 1].translit, l.ayah.words[e.word - 1].gloss]);
      }
    }
  });
});

describe("every beat has its Arabic and a recording, and says what is heard (checks.ts exampleProblems)", () => {
  it("every lesson the page ships, Indonesian and English: no problem", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        for (const locale of ["id", "en"] as const) {
          const l = lessonOf(s, a, locale);
          expect({ lesson: `${l.seq.lessonKey} ${locale}`, problems: exampleProblems(l.seq, l.ctx) }).toEqual({ lesson: `${l.seq.lessonKey} ${locale}`, problems: [] });
        }
      }
    }
  });

  it("heard: an ayah's last word says the imam stops; a bentuk dasar is never one; ismu is played with the word before it", () => {
    let waqf = 0;
    for (const l of every) {
      for (const { beat } of beatsOf(l.seq)) {
        const d = l.derived.examples.find((e) => e.id === beat.id);
        if (!d) throw new Error(beat.id);
        const last = beat.word !== null ? beat.word === l.ayah.words.length : beat.clip?.last === true;
        expect(d.waqf, beat.id).toBe(hasWaqfNote(last ? { last: true } : null, d.ar));
        expect(beat.caption.includes(l.ctx.texts.example.waqf), beat.id).toBe(d.waqf);
        if (last) expect(waqfDrop(d.ar), beat.id).not.toBe("other");
        if (beat.of !== "concept") expect(last, beat.id).toBe(false);
        if (d.waqf) waqf++;
      }
    }
    // al-‘ālamīna (1:2:4), nasta‘īnu twice (1:5:4) in Al-Fatihah; yūlad (112:3:4) drops nothing.
    expect(fatihah.flatMap((l) => l.derived.examples.filter((e) => e.waqf).map((e) => e.id))).toEqual(["concept:jamak-mudzakkar-salim:1", "concept:bab-istifal:1", "concept:ilal:1"]);
    expect(waqf).toBe(3);
    const ismu = beatsOf(fatihah[0].seq).find((x) => x.beat.id === "w1:base:2")?.beat;
    expect([ismu?.key, ismu?.word, ismu?.frame, ismu?.clip]).toEqual(["55:78:1-2", null, 2, LIBRARY.clips["55:78:1-2"]]);
    expect(ismu?.caption).toBe("Contoh: ismu, di QS 55:78. Bersama kata sebelumnya terdengar “tabārakasmu”, karena alif di awalnya tidak dibaca.");
    // The clips the lesson and the Konsep pages both play are one and the same cut.
    for (const l of fatihah) {
      for (const { beat } of beatsOf(l.seq)) if (beat.clip && LIBRARY.clips[beat.key]) expect(beat.clip, beat.id).toEqual(LIBRARY.clips[beat.key]);
    }
  });

  it("captions are plain on-screen words in both languages: no Arabic script, no ALL CAPS, never “ketuk”, short", () => {
    for (const [locale, texts] of Object.entries(AUTOPLAY_TEXT_SETS)) {
      const t = texts.example;
      const all = [t.word({ n: 1, translit: "bismi" }), t.other({ translit: "aḥadun", surah: 112, ayah: 1 }), t.base({ translit: "ismu", surah: 55, ayah: 78 }), t.waqf, t.washal({ heard: "tabārakasmu" })];
      for (const c of all) {
        expect(hasArabicScript(c), `${locale}: ${c}`).toBe(false);
        expect(c, locale).not.toMatch(/\b[A-Z]{3,}\b/);
        expect(c.toLowerCase(), locale).not.toMatch(/ketuk|\btap\b/);
        expect(c.length, `${locale}: ${c}`).toBeLessThanOrEqual(110);
      }
    }
    expect(AUTOPLAY_TEXT_SETS.id.example.word({ n: 1, translit: "bismi" })).toBe("Contoh: kata ke-1, bismi.");
    expect(AUTOPLAY_TEXT_SETS.id.example.base({ translit: "rabbu", surah: 41, ayah: 9 })).toBe("Contoh: rabbu, di QS 41:9.");
    expect(AUTOPLAY_TEXT_SETS.en.example.word({ n: 1, translit: "bismi" })).toBe("Example: word 1, bismi.");
    const msgs = { id: JSON.parse(read("messages/id.json")).Guided, en: JSON.parse(read("messages/en.json")).Guided } as Record<string, Record<string, string>>;
    expect([msgs.id.example_tag, msgs.en.example_tag]).toEqual(["Contoh", "Example"]);
    for (const m of Object.values(msgs)) for (const k of ["example_tag", "example_place", "example_ending", "example_failed"]) expect(m[k], k).toBeTruthy();
    for (const l of [...fatihah, ...FATIHAH.ayat.map((a) => lessonOf(FATIHAH, a, "en"))]) {
      for (const { beat } of beatsOf(l.seq)) {
        expect(hasArabicScript(beat.caption), beat.id).toBe(false);
        for (const p of beat.parts) expect(p.length, beat.id).toBeLessThanOrEqual(180);
      }
    }
  });

  // Planted faults: each must be caught (the unmutated lesson has none, above).
  const faults: [string, number, (l: Lesson) => void, RegExp][] = [
    // Coverage, each rule on its own: the content's list is emptied too, so that only the rule
    // "every explanation has its example" can catch it.
    ["a concept line with no example after it", 1, (l) => {
      l.seq.steps.splice(l.seq.steps.findIndex((s) => s.id === "concept:huruf-jar:ex"), 1);
      forget(l, "concept:huruf-jar:1");
    }, /concept:huruf-jar: its line is followed by no example/],
    ["an example the content gives that no step plays", 1, (l) => void l.seq.steps.splice(l.seq.steps.findIndex((s) => s.id === "concept:huruf-jar:ex"), 1), /example concept:huruf-jar:1: the content gives it, and no step plays it/],
    ["an example step that does not follow its concept's line", 1, (l) => {
      const i = l.seq.steps.findIndex((s) => s.id === "concept:huruf-jar:ex");
      const [st] = l.seq.steps.splice(i, 1);
      l.seq.steps.splice(i + 1, 0, st);
    }, /does not follow its concept's line/],
    ["a concept's first example that is not its example in this ayah", 1, (l) => {
      for (const x of [beat(l, "concept:idhafah:1"), example(l, "concept:idhafah:1")]) {
        x.key = "1:1:3";
        x.word = 3;
      }
      const w = l.ayah.words[2];
      Object.assign(example(l, "concept:idhafah:1"), { ar: w.ar, translit: w.translit });
      setCaption(beat(l, "concept:idhafah:1"), l.ctx.texts.example.word({ n: 3, translit: w.translit }));
    }, /concept:idhafah: its first example is not the concept's example in this ayah \(1:1:2\)/],
    ["a beat that is not the example the content gives", 1, (l) => void (beat(l, "concept:idhafah:1").word = 3), /differs from the example the content gives/],
    ["a bentuk dasar shown without the imam's voice and without a reason", 1, (l) => {
      step(l, "w1:compose").examples = [];
      forget(l, "w1:base:2");
    }, /w1:compose: base frame\(s\) 2 have neither the imam's voice of the bentuk dasar nor a reason/],
    // Plan L24 (2026-10-13): this fault used to be the opposite one, "a word whose harakah its line
    // explains, with neither its recitation nor a reason". A word is now recited once, when its
    // step opens: a beat that recites it again after its own line is the fault.
    ["a word's own line followed by a beat that recites the word again (a lesson without compositions)", -1, (l) => void (step(l, "w2").examples = [beat(l, "concept:dhamir-syan:1")]), /w2: a explain step has example beats/],
    ["a base example played before its base frame's line", 1, (l) => void (beat(l, "w1:base:2").after = 0), /does not come after the last line of its base frame/],
    ["a base example on a frame that is not a base frame", 1, (l) => {
      const b = beat(l, "w1:base:2");
      b.frame = 3;
      b.after = 4;
    }, /differs from the example the content gives/],
    // (the lesson's own list shifted with it: only "the clip the content gives for this key" can tell)
    ["a clip shifted by 10 ms", 1, (l) => {
      const clip = { ...LIBRARY.clips["55:78:1-2"], start: 40 };
      beat(l, "w1:base:2").clip = clip;
      example(l, "w1:base:2").clip = clip;
    }, /w1:base:2: its clip is not the one the content gives for 55:78:1-2/],
    ["a second example whose clip is not the Konsep page's", -2, (l) => {
      const clip = { ...beat(l, "concept:contoh:2").clip!, end: beat(l, "concept:contoh:2").clip!.end + 10 };
      beat(l, "concept:contoh:2").clip = clip;
      example(l, "concept:contoh:2").clip = clip;
    }, /concept:contoh:2: its clip is not the one the content gives for 112:4:4/],
    ["a clip of another host", 1, (l) => {
      const clip = { ...LIBRARY.clips["55:78:1-2"], url: "https://example.org/055078.mp3" };
      beat(l, "w1:base:2").clip = clip;
      example(l, "w1:base:2").clip = clip;
    }, /is not \[start, end\) of an EveryAyah file/],
    ["a beat with a word and a clip", 1, (l) => void (beat(l, "concept:naat:1").clip = LIBRARY.clips["1:1:3"]), /exactly one of a word of this ayah and a clip/],
    ["a beat with neither", 1, (l) => void (beat(l, "concept:naat:1").word = null), /exactly one of a word of this ayah and a clip/],
    // The ayah's recitation: one, the imam's (plan L21; until 2026-10-13 the first of two).
    ["this ayah's word without a timing in the ayah's recitation", 1, (l) => {
      l.ctx = { ...l.ctx, ayah: { ...l.ayah, recitation: l.ayah.recitation.map((r) => ({ ...r, segments: r.segments.filter(([w]) => w !== 2) })) } };
    }, /Alafasy_128kbps has no timing for word 2/],
    ["Arabic that is not the content's bytes", 1, (l) => void (example(l, "concept:naat:1").ar = l.ayah.words[0].ar), /is not the content's bytes/],
    ["Arabic script in a caption", 1, (l) => void setCaption(beat(l, "concept:naat:1"), `Contoh: ${l.ayah.words[2].ar}, ar-raḥmāni.`), /carries Arabic script/],
    ["a caption that does not name its example", 1, (l) => void setCaption(beat(l, "concept:naat:1"), "Contoh: kata ke-3."), /does not name the example/],
    ["an ayah-final example that does not say the imam stops", 2, (l) => void setCaption(beat(l, "concept:jamak-mudzakkar-salim:1"), "Contoh: kata ke-4, al-‘ālamīna."), /does not say so/],
    ["a waqf note on a word that does not end its ayah", 1, (l) => {
      const b = beat(l, "concept:naat:1");
      setCaption(b, `${b.caption} ${l.ctx.texts.example.waqf}`);
    }, /which is not so here/],
    ["a bentuk dasar voiced on an ayah's last word", 4, (l) => {
      const clip = { ...beat(l, "w2:base:1").clip!, last: true };
      beat(l, "w2:base:1").clip = clip;
      example(l, "w2:base:1").clip = clip;
    }, /ends its ayah, so the ending it is there for is not heard/],
    ["a run played without saying what is heard", 1, (l) => void setCaption(beat(l, "w1:base:2"), "Contoh: ismu, di QS 55:78."), /does not say what is heard/],
    ["a hamzat-washal form played alone, labelled as a run", 1, (l) => {
      beat(l, "w1:base:2").key = "55:78:2";
      example(l, "w1:base:2").key = "55:78:2";
    }, /says what a run sounds like, but plays one word/],
    ["three examples after one concept", 1, (l) => {
      const st = step(l, "concept:naat:ex");
      st.examples = [st.examples![0], { ...st.examples![0], id: "concept:naat:2" }, { ...st.examples![0], id: "concept:naat:3" }];
    }, /3 example beats after one rule \(at most 2\)/],
    ["the same beat twice", 1, (l) => {
      const st = step(l, "concept:naat:ex");
      st.examples = [st.examples![0], st.examples![0]];
    }, /the id is used twice/],
    // (until plan L24 the opposite: "a composition that does not end with the joined word")
    ["a composition that ends with the imam reciting its word again", 1, (l) => void (step(l, "w1:compose").recite = { target: "word", word: 1 }), /w1:compose: ends with the imam reciting its word again/],
    ["a rule listed without its reason", 2, (l) => void (l.ctx = { ...l.ctx, derived: { ...l.derived, gaps: l.derived.gaps.map((g) => ({ ...g, why: " " })) } }), /must say which and why/],
    ["an example beat on a step that explains nothing", 1, (l) => void (step(l, "recap").examples = [beat(l, "concept:naat:1")]), /a recap step has example beats/],
  ];
  const step = (l: Lesson, id: string) => {
    const st = l.seq.steps.find((s) => s.id === id);
    if (!st) throw new Error(`no step ${id}`);
    return st;
  };
  const beat = (l: Lesson, id: string): ExampleBeat => {
    const b = l.seq.steps.flatMap((s) => s.examples ?? []).find((x) => x.id === id);
    if (!b) throw new Error(`no beat ${id}`);
    return b;
  };
  const example = (l: Lesson, id: string): LessonExample => {
    const e = l.derived.examples.find((x) => x.id === id);
    if (!e) throw new Error(`no example ${id}`);
    return e;
  };
  const setCaption = (b: ExampleBeat, caption: string) => {
    b.caption = caption;
    b.parts = [caption];
  };
  /** Takes an example out of what the content gives (the lesson's own list), in place. */
  const forget = (l: Lesson, id: string) => void l.derived.examples.splice(l.derived.examples.findIndex((e) => e.id === id), 1);
  /** Al-Ikhlas 1 with one made-up concept whose example here is the ayah's last word and is
   *  about its ending: the lesson then adds a second example, a clip of 112:4:4. */
  const withSecondExample = (): Lesson => {
    const s = surah("al-ikhlas");
    const a = s.ayat[0];
    const end = a.words[a.words.length - 1];
    const made = { id: "contoh", examples: [{ loc: end.loc, note: `${end.translit}: khabar, berakhir ${end.case.sign}.` }, { loc: "112:4:4", note: "contoh lain" }] };
    const introduced = [...conceptsIntroducedIn(a.loc), made];
    const derived = lessonExamples({ ayah: a, introduced, compose: null, clips: LIBRARY.clips, wordAt: (loc) => WORDS.get(loc) });
    const base = lessonOf(s, a);
    const seq = structuredClone(base.seq);
    const texts = base.ctx.texts.example;
    const beats = derived.examples
      .filter((e) => e.step === "concept:contoh:ex")
      .map((e): ExampleBeat => {
        const lead = e.word !== null ? texts.word({ n: e.word, translit: e.translit }) : texts.other({ translit: e.translit, surah: e.place.surah, ayah: e.place.ayah });
        const caption = e.waqf ? `${lead} ${texts.waqf}` : lead;
        return { id: e.id, of: e.of, after: -1, key: e.key, word: e.word, clip: e.clip, frame: null, caption, parts: [caption] };
      });
    const at = seq.steps.findIndex((x) => x.kind === "structure");
    const line = { ...seq.steps.find((x) => x.kind === "concept")!, id: "concept:contoh" };
    seq.steps.splice(at, 0, line, { id: "concept:contoh:ex", kind: "example", cues: [], lines: [], caption: beats[0].caption, guides: [], examples: beats });
    return { ...base, seq, derived, ctx: { ...base.ctx, introduced, derived } };
  };
  it.each(faults)("planted fault: %s", (_name, ayah, plant, expected) => {
    // ayah -1: Al-Ikhlas 1, a lesson whose words have no composition; -2: the same with a
    // concept that takes a second example from another ayah.
    const fresh = ayah === -2 ? withSecondExample() : ayah === -1 ? lessonOf(surah("al-ikhlas"), surah("al-ikhlas").ayat[0]) : lessonOf(FATIHAH, FATIHAH.ayat[ayah - 1]);
    // A copy to mutate (the page's own sequence is never touched).
    const l: Lesson = { ...fresh, seq: structuredClone(fresh.seq), derived: structuredClone(fresh.derived) };
    l.ctx = { ...fresh.ctx, derived: l.derived };
    expect(exampleProblems(l.seq, l.ctx)).toEqual([]);
    plant(l);
    const problems = exampleProblems(l.seq, l.ctx);
    expect(problems.some((p) => expected.test(p)), `${problems.join(" | ") || "no problem found"}`).toBe(true);
  });
});

// "Why there is rather long pause when reciting verses word by word? loading issue?" — "when
// transation from word X to X+1, i think we dont need to recite the X, just directly to X+1"
// (operator 2026-10-13, plan L24), over the lessons the page ships.
describe("the lesson's own word is recited once, and its step does not wait for a caption the narrator makes needless", () => {
  /** The imam's recitations of the lesson itself, in order (no example beat): "step=word" / "step=ayah", with each one's minimum. */
  const recited = (seq: AutoplaySequence, pace: Pace) => {
    const out: { what: string; minMs: number; idx: number }[] = [];
    let token = -1;
    for (const s of run(seq, started(seq, pace))) {
      const a = s.activity;
      if (a?.kind !== "recite" || a.token === token) continue;
      token = a.token;
      if (a.target === "ayah") out.push({ what: `${seq.steps[s.idx].id}=ayah`, minMs: a.minMs, idx: s.idx });
      else if (a.target === "word" && a.example === undefined) out.push({ what: `${seq.steps[s.idx].id}=${a.word}`, minMs: a.minMs, idx: s.idx });
    }
    return out;
  };

  it(
    "every lesson, every pace, both languages: the whole ayah (its step and the recap), each word at its opening step — once, twice in Pelan — and only an Al-Fatihah ayah's last word once more, after its composition",
    () => {
      let lessons = 0;
      for (const s of SURAHS) {
        for (const a of s.ayat) {
          for (const locale of ["id", "en"] as const) {
            const l = lessonOf(s, a, locale);
            for (const pace of PACES) {
              const times = pace === "pelan" ? 2 : 1;
              const n = a.words.length;
              const again = s.slug === "al-fatihah" ? Array.from({ length: times }, () => `w${n}:compose=${n}`) : [];
              const want = ["recite=ayah", ...a.words.flatMap((_, i) => Array.from({ length: times }, () => `w${i + 1}:recite=${i + 1}`)), ...again, "recap=ayah"];
              expect(recited(l.seq, pace).map((r) => r.what), `${l.seq.lessonKey} ${locale} ${pace}`).toEqual(want);
            }
            lessons++;
          }
        }
      }
      expect(lessons).toBe(44);
    },
    WALK_TIMEOUT_MS,
  );

  it("every composition (29 words): its last line is said over its last frame — the joined word — which stays to the end of the step; 22 end there, the 7 of an ayah's last word go on to the imam reciting it, that line still the caption", () => {
    const ends = { line: 0, imam: 0 };
    for (const l of fatihah) {
      for (const pace of ["biasa", "pelan"] as const) {
        const states = run(l.seq, started(l.seq, pace));
        for (const st of l.seq.steps.filter((x) => x.kind === "compose")) {
          const where = `${l.seq.lessonKey} ${st.id} ${pace}`;
          const idx = l.seq.steps.indexOf(st);
          const on = states.filter((x) => x.idx === idx);
          const lastLine = st.lines[st.lines.length - 1];
          const saying = on.filter((x) => x.activity?.kind === "narrate" && x.activity.line === lastLine);
          expect(saying.length, where).toBeGreaterThan(0);
          for (const x of saying) expect([stageFrame(l.seq, x)?.frame, stageFrame(l.seq, x)?.recited], where).toEqual([st.frames, false]);
          // What the step does after that line (its pause included): nothing, or the imam.
          const after = on.slice(on.indexOf(saying[saying.length - 1]) + 1);
          const imam = after.filter((x) => x.activity?.kind === "recite");
          const stop = st.word === l.ayah.words.length;
          expect(st.recite !== undefined, where).toBe(stop);
          if (!stop) {
            expect(after.map((x) => x.activity?.kind), where).toEqual(["wait"]);
            expect([stageFrame(l.seq, after[0])?.frame, stageFrame(l.seq, after[0])?.recited], where).toEqual([st.frames, false]);
            if (pace === "biasa") ends.line++;
          } else {
            // His word, as long as it lasts (no reading time: no new caption), "Pelan" twice
            // with the gap; the joined word "recited", its word marked, the stop line still on screen.
            expect(after.map((x) => x.activity?.kind), where).toEqual(pace === "pelan" ? ["wait", "recite", "wait", "recite", "wait"] : ["wait", "recite", "wait"]);
            for (const x of imam) {
              expect(x.activity, where).toMatchObject({ kind: "recite", target: "word", word: st.word, minMs: 0 });
              expect(viewAutoplay(l.seq, x).caption.line, where).toBe(lastLine);
            }
            for (const x of after.slice(1)) {
              expect([stageFrame(l.seq, x)?.frame, stageFrame(l.seq, x)?.recited, stageMarks(l.seq, x)], where).toEqual([st.frames, true, { marked: [st.word], focus: st.word }]);
            }
            if (pace === "biasa") ends.imam++;
          }
          // The step's last moment: the joined word and its card's word still there, no example.
          const end = on[on.length - 1];
          expect([end.activity?.kind, stageFrame(l.seq, end)?.frame, stageMarks(l.seq, end).focus, stageExample(l.seq, end)], where).toEqual(["wait", st.frames, st.word, null]);
          // … and what follows is not the imam saying this word (again).
          const next = states[states.indexOf(end) + 1];
          expect(next.idx, where).toBe(idx + 1);
          expect(next.activity?.kind === "recite" && next.activity.target === "word" && next.activity.word === st.word, where).toBe(false);
        }
      }
    }
    expect(ends).toEqual({ line: 22, imam: 7 });
  });

  it("narrated (Al-Fatihah, Indonesian): no word waits for its caption, at any pace; the whole ayah's recitations are as they were", () => {
    for (const l of fatihah) {
      for (const pace of PACES) {
        for (const r of recited(l.seq, pace)) expect([r.what, r.minMs], `${l.seq.lessonKey} ${pace}`).toEqual([r.what, 0]);
      }
    }
  });

  it("caption-only (the English pages; the Mu'awwidzat, whose own lines have no voice yet): the first hearing keeps its caption's reading time", () => {
    const captionOnly = [...FATIHAH.ayat.map((a) => lessonOf(FATIHAH, a, "en")), ...every.filter((l) => l.slug !== "al-fatihah")];
    expect(captionOnly.length).toBe(7 + 15);
    // The Mu'awwidzat's shared lines have a voice all the same: what decides is the word's own line.
    expect(every.filter((l) => l.slug !== "al-fatihah").every((l) => l.seq.hasAudio)).toBe(true);
    for (const l of captionOnly) {
      for (const pace of ["biasa", "pelan"] as const) {
        const seen = new Set<number>();
        for (const r of recited(l.seq, pace)) {
          if (r.what.endsWith("=ayah")) continue;
          // An ayah's last word once more after its composition (Al-Fatihah in English): no new
          // caption appears — the line that says the imam stops on it stays, and was just read
          // for its reading time — so nothing more is waited for.
          if (l.seq.steps[r.idx].kind === "compose") {
            expect([r.what, r.minMs], `${l.seq.lessonKey} ${pace}`).toEqual([r.what, 0]);
            continue;
          }
          const first = !seen.has(r.idx);
          seen.add(r.idx);
          const caption = l.seq.steps[r.idx].caption;
          // (the second hearing of "Pelan" never had a hold)
          expect([r.what, r.minMs], `${l.seq.lessonKey} ${pace}`).toEqual([r.what, first ? captionMs(caption, pace) : 0]);
          if (first) expect(r.minMs, r.what).toBeGreaterThanOrEqual(pace === "pelan" ? 6000 : 5000);
        }
      }
      // "Tunggu saya" waits for Lanjut instead, as before.
      for (const r of recited(l.seq, "tunggu")) expect(r.minMs, `${l.seq.lessonKey} tunggu ${r.what}`).toBe(0);
    }
  });
});

describe("how the lesson plays an example beat (machine.ts)", () => {
  it(
    "every Al-Fatihah lesson, every pace: each beat is recited once (twice in Pelan), by the imam alone, after the line it follows",
    () => {
      for (const l of fatihah) {
        for (const pace of PACES) {
          const where = `${l.seq.lessonKey} ${pace}`;
          const states = run(l.seq, started(l.seq, pace));
          expect(states[states.length - 1].phase, where).toBe("finished");
          const recited: string[] = [];
          let token = -1;
          states.forEach((s, k) => {
            const id = exampleOf(s.activity);
            if (id === null || s.activity?.token === token) return;
            token = s.activity!.token;
            recited.push(id);
            const st = l.seq.steps[s.idx];
            const b = (st.examples ?? []).find((x) => x.id === id);
            const at = `${where} #${k} ${st.id} ${id}`;
            if (!b) throw new Error(`${at}: not a beat of this step`);
            // ONE activity, the imam's: never the narrator over him, never two recordings.
            const a = s.activity!;
            if (a.kind !== "recite" || a.target === "ayah") throw new Error(at);
            expect(a.target === "clip" ? [a.clip, a.key] : [a.word, null], at).toEqual(b.word !== null ? [b.word, null] : [b.clip, b.key]);
            expect(s.phase, at).toBe("running");
            // Its caption is on screen, and it is no narration line.
            const v = viewAutoplay(l.seq, s);
            expect([v.caption.parts, v.caption.line], at).toEqual([b.parts, null]);
            // The line it follows was said just before (an example step opens with its beat).
            const act = s.plan[s.at];
            const again = act.t === "example" && act.again === true;
            const before = s.plan.slice(0, s.at).flatMap((x) => (x.t === "say" && "c" in x.ref ? [x.ref.c] : []));
            expect(before.at(-1) ?? -1, at).toBe(b.after);
            // At least its caption's reading time — the reading alone, 10 characters a second
            // at Biasa and 6 at Pelan (plan L24; until 2026-10-13 captionMs, a 2.5–3 s settle
            // more and never under 5 s: this line read "≥ 5000"). "Tunggu saya" waits for Lanjut
            // instead, and the second hearing of "Pelan" adds none.
            if (pace === "tunggu" || again) expect(a.minMs, at).toBe(0);
            else {
              expect(a.minMs, at).toBe(Math.round((b.caption.length / (pace === "pelan" ? 6 : 10)) * 1000));
              expect(a.minMs, at).toBe(exampleReadMs(b.caption, pace));
              expect(a.minMs, at).toBeGreaterThanOrEqual(2300);
            }
            // The screen stays on (the lesson runs), and nothing of it is narration to fetch ahead.
            expect([lessonRuns(s), screenAwake(s)], at).toEqual([true, "on"]);
            for (const u of [...lookaheadAudio(l.seq, s), ...audioAhead(l.seq, s, 3).flat().map((f) => f.url), nextNarration(l.seq, s) ?? ""]) {
              expect(u.includes("everyayah"), `${at}: ${u}`).toBe(false);
            }
          });
          const want = beatsOf(l.seq).flatMap(({ beat: b }) => (pace === "pelan" ? [b.id, b.id] : [b.id]));
          expect(recited, where).toEqual(want);
        }
      }
    },
    WALK_TIMEOUT_MS,
  );

  it("the narration look-ahead never lists an example's recording, at any moment of any lesson", () => {
    const clips = new Set(every.flatMap((l) => beatsOf(l.seq).flatMap(({ beat: b }) => (b.clip ? [b.clip.url] : []))));
    expect(clips.size).toBeGreaterThan(5);
    let lists = 0;
    for (const l of fatihah) {
      for (const s of run(l.seq, started(l.seq, "biasa"))) {
        for (const u of lookaheadAudio(l.seq, s)) {
          expect(clips.has(u) || !u.startsWith("/belajar/media/narration/"), `${l.seq.lessonKey} ${u}`).toBe(false);
          lists++;
        }
      }
    }
    expect(lists).toBeGreaterThan(500);
  });

  it("reachable by ‹ Sebelumnya / Berikutnya › and replayed by ↺ Ulangi langkah ini; pause and resume play it from its start", () => {
    for (const l of fatihah) {
      for (const { step: st, beat: b } of beatsOf(l.seq)) {
        const idx = l.seq.steps.indexOf(st);
        const where = `${l.seq.lessonKey} ${b.id}`;
        const plays = (s: AutoplayState) => run(l.seq, s, (x) => exampleOf(x.activity) === b.id || x.idx !== idx).some((x) => exampleOf(x.activity) === b.id);
        // Berikutnya › from the step before, ‹ Sebelumnya from the step after: on its step, and it plays.
        const before = reduceAutoplay(l.seq, started(l.seq, "biasa", idx - 1), { type: "next" });
        expect([before.idx, plays(before)], `${where}: Berikutnya`).toEqual([idx, true]);
        const after = reduceAutoplay(l.seq, started(l.seq, "biasa", idx + 1), { type: "prev" });
        expect([after.idx, plays(after)], `${where}: Sebelumnya`).toEqual([idx, true]);
        // While it is recited: ↺ starts the step over, and the beat comes again.
        const playing = atBeat(l.seq, b.id);
        const again = reduceAutoplay(l.seq, playing, { type: "replay" });
        expect([again.idx, again.at, again.phase, plays(again)], `${where}: Ulangi`).toEqual([idx, 0, "running", true]);
        expect(exampleOf(again.activity) === b.id && again.activity?.token === playing.activity?.token, where).toBe(false);
        // Jeda stops it (nothing plays); Lanjutkan says "Kita lanjutkan." and recites it again.
        const paused = reduceAutoplay(l.seq, playing, { type: "pause" });
        expect([paused.phase, paused.activity], `${where}: Jeda`).toEqual(["paused", null]);
        const resumed = reduceAutoplay(l.seq, paused, { type: "resume" });
        expect([resumed.phase, plays(resumed)], `${where}: Lanjutkan`).toEqual(["running", true]);
        // A step entered while paused shows its example before anything plays (an example step).
        if (st.kind === "example") {
          const shown = reduceAutoplay(l.seq, reduceAutoplay(l.seq, started(l.seq, "biasa", idx - 1), { type: "pause" }), { type: "next" });
          expect([shown.phase, stageExample(l.seq, shown)?.beat.id, stageExample(l.seq, shown)?.reciting], where).toEqual(["paused", st.examples![0].id, false]);
        }
      }
    }
  });

  it("the remembered step: a concept's example step is saved by its id and resumed from", () => {
    const l = fatihah[0];
    const idx = l.seq.steps.findIndex((s) => s.id === "concept:huruf-jar:ex");
    const s = atBeat(l.seq, "concept:huruf-jar:1");
    expect(s.idx).toBe(idx);
    const saved = positionToSave(l.seq, s);
    expect(saved).toBe(JSON.stringify({ v: 1, step: "concept:huruf-jar:ex" }));
    expect(restoreIndex(l.seq, saved ?? null)).toBe(idx);
    // "Lanjutkan dari langkah N": the resume line, then the example.
    const resumed = started(l.seq, "biasa", idx);
    expect(resumed.activity?.kind).toBe(l.seq.shared.resume.audio.length ? "narrate" : "read");
    expect(run(l.seq, resumed, (x) => x.idx !== idx).some((x) => exampleOf(x.activity) === "concept:huruf-jar:1")).toBe(true);
  });

  it("“Tunggu saya”: after the example the lesson waits for Lanjut, like after every explanation", () => {
    const l = fatihah[0];
    const s = atBeat(l.seq, "concept:naat:1", "tunggu");
    const done = reduceAutoplay(l.seq, reduceAutoplay(l.seq, s, { type: "recite_end", token: s.activity!.token }), { type: "timer", token: s.token + 1 });
    expect([done.phase, done.idx, viewAutoplay(l.seq, done).showLanjut]).toEqual(["ready", s.idx, true]);
    // The example stays on screen while it waits.
    expect(stageExample(l.seq, done)?.beat.id).toBe("concept:naat:1");
    expect(reduceAutoplay(l.seq, done, { type: "next" }).idx).toBe(s.idx + 1);
  });

  it(
    "never a dead stop: a recording that cannot be played is shown a moment, then the lesson goes on — at every beat, every pace",
    () => {
      for (const l of fatihah) {
        for (const pace of PACES) {
          for (const { step: st, beat: b } of beatsOf(l.seq)) {
            const where = `${l.seq.lessonKey} ${pace} ${b.id}`;
            const playing = atBeat(l.seq, b.id, pace);
            const failed = reduceAutoplay(l.seq, playing, { type: "recite_error", token: playing.activity!.token });
            // Not paused, no "Bacaan imam belum bisa diputar": the example with its caption, a short hold.
            expect([failed.phase, failed.error, failed.idx], where).toEqual(["running", null, playing.idx]);
            expect(failed.activity, where).toEqual({ kind: "wait", token: failed.token, ms: EXAMPLE_FAILED_HOLD_MS });
            expect(stageExample(l.seq, failed), where).toEqual({ beat: b, reciting: false, failed: true });
            expect(viewAutoplay(l.seq, failed).caption.parts, where).toEqual(b.parts);
            expect(screenAwake(failed), where).toBe("on");
            // On by itself to the end; the beat is not tried again in this pass (Pelan's second hearing is dropped).
            const rest = run(l.seq, failed);
            expect(rest[rest.length - 1].phase, where).toBe("finished");
            expect(rest.filter((x) => x.idx === playing.idx && exampleOf(x.activity) === b.id), where).toEqual([]);
            // ↺ tries it again.
            const retry = reduceAutoplay(l.seq, failed, { type: "replay" });
            expect(run(l.seq, retry, (x) => x.idx !== playing.idx).some((x) => exampleOf(x.activity) === b.id), where).toBe(true);
            // (the ayah's own recitation failing still pauses the lesson: wake test, ahead.test.ts)
            expect(st.examples?.includes(b), where).toBe(true);
          }
        }
      }
    },
    WALK_TIMEOUT_MS,
  );

  it("the engine's own guard (checks.ts transitionProblem) tells a dead stop from a skipped example", () => {
    const l = fatihah[0];
    for (const id of ["w1:base:2", "concept:naat:1"]) {
      const playing = atBeat(l.seq, id);
      const e: AutoplayEvent = { type: "recite_error", token: playing.activity!.token };
      const good = reduceAutoplay(l.seq, playing, e);
      expect(transitionProblem(l.seq, playing, e, good), id).toBeNull();
      // What the lesson does when its OWN recitation fails — wrong for an example.
      const stopped: AutoplayState = { ...playing, phase: "paused", pausedFrom: "running", activity: null, resumeRecite: false, error: "recite" };
      expect(transitionProblem(l.seq, playing, e, stopped), id).toBe("an example beat that could not be played stopped the lesson");
      // Moved on at once, the example never shown without its sound.
      const skipped = reduceAutoplay(l.seq, good, { type: "timer", token: good.activity!.token });
      expect(transitionProblem(l.seq, playing, e, skipped), id).toBe("a failed example beat is not shown for its hold");
    }
    // … and the ayah's own recitation failing must still pause the lesson.
    const own = run(l.seq, started(l.seq, "biasa"), (s) => s.activity?.kind === "recite").at(-1)!;
    const e: AutoplayEvent = { type: "recite_error", token: own.activity!.token };
    expect(transitionProblem(l.seq, own, e, reduceAutoplay(l.seq, own, e))).toBeNull();
    expect(transitionProblem(l.seq, own, e, { ...own, activity: null, phase: "paused", pausedFrom: "running" })).toBe("a failed recitation of the lesson's own did not pause it");
  });

  it("gives up on a recording that does not sound in time — after the loading status has shown, before the “still loading” advice", () => {
    expect(EXAMPLE_LOAD_LIMIT_MS).toBeGreaterThan(LOADING_SHOW_MS + 2000);
    expect(EXAMPLE_LOAD_LIMIT_MS).toBeLessThan(LOADING_SLOW_MS);
    expect(EXAMPLE_FAILED_HOLD_MS).toBeGreaterThanOrEqual(2000);
    expect(EXAMPLE_FAILED_HOLD_MS).toBeLessThanOrEqual(5000);
    const silent = { heard: false, flowing: false };
    expect(exampleGivesUp(EXAMPLE_LOAD_LIMIT_MS, silent)).toBe(true);
    expect(exampleGivesUp(EXAMPLE_LOAD_LIMIT_MS - 1, silent)).toBe(false);
    // a long clip still sounding (ad-ḍāllīna holds its madd 5.7 s), or one already heard: never cut
    expect(exampleGivesUp(EXAMPLE_LOAD_LIMIT_MS, { heard: false, flowing: true })).toBe(false);
    expect(exampleGivesUp(EXAMPLE_LOAD_LIMIT_MS + 5000, { heard: true, flowing: false })).toBe(false);
  });
});

describe("what the stage shows during a beat (caption.ts)", () => {
  it("a concept's example: its card instead of the word card, its word marked on the mushaf line — also in the pause after it", () => {
    const l = fatihah[0];
    const s = atBeat(l.seq, "concept:idhafah:1");
    expect(stageExample(l.seq, s)).toMatchObject({ reciting: true, failed: false, beat: { id: "concept:idhafah:1", word: 2 } });
    expect(stageMarks(l.seq, s)).toEqual({ marked: [2], focus: null });
    expect(stageFrame(l.seq, s)).toBeNull();
    const settle = reduceAutoplay(l.seq, s, { type: "recite_end", token: s.activity!.token });
    expect(settle.activity?.kind).toBe("wait");
    expect(stageExample(l.seq, settle)).toMatchObject({ reciting: false, beat: { id: "concept:idhafah:1" } });
    expect(stageMarks(l.seq, settle)).toEqual({ marked: [2], focus: null });
    // The concept's own line before it shows no example.
    const line = reduceAutoplay(l.seq, started(l.seq, "biasa", s.idx - 1), { type: "replay" });
    expect(stageExample(l.seq, line)).toBeNull();
  });

  it("a bentuk dasar: the composition stays on its base frame while the imam recites the base form, and in the pause after", () => {
    const l = fatihah[0];
    const s = atBeat(l.seq, "w1:base:2");
    expect(stageFrame(l.seq, s)).toEqual({ step: "compose", word: 1, frame: 2, recited: false });
    expect(stageExample(l.seq, s)).toMatchObject({ reciting: true, beat: { id: "w1:base:2", key: "55:78:1-2" } });
    expect(stageMarks(l.seq, s).marked).toEqual([1]);
    const settle = reduceAutoplay(l.seq, s, { type: "recite_end", token: s.activity!.token });
    expect([stageFrame(l.seq, settle)?.frame, stageExample(l.seq, settle)?.reciting]).toEqual([2, false]);
    // … then the change frame's line (dhammah → kasrah), and no example on screen.
    const next = reduceAutoplay(l.seq, settle, { type: "timer", token: settle.activity!.token });
    expect([stageFrame(l.seq, next)?.frame, stageExample(l.seq, next)]).toEqual([3, null]);
    // Pelan: the frame holds through the gap and the second hearing; resumed after a pause too.
    const slow = atBeat(l.seq, "w1:base:2", "pelan");
    const gap = reduceAutoplay(l.seq, slow, { type: "recite_end", token: slow.activity!.token });
    expect([gap.activity?.kind, stageFrame(l.seq, gap)?.frame, stageExample(l.seq, gap)?.beat.id]).toEqual(["wait", 2, "w1:base:2"]);
    const resumed = reduceAutoplay(l.seq, reduceAutoplay(l.seq, s, { type: "pause" }), { type: "resume" });
    expect(stageFrame(l.seq, resumed)?.frame).toBe(2);
    // The joined word is no longer recited at the end of the step (plan L24; until 2026-10-13 the
    // next recitation of a word was word 1 again, over the last frame, "recited"): the step ends
    // on its last frame with its last line, and the next word the imam says is word 2.
    const rest = run(l.seq, next, (x) => x.activity?.kind === "recite" && x.activity.target === "word" && x.activity.example === undefined);
    const opening = rest[rest.length - 1];
    expect([l.seq.steps[opening.idx].id, opening.activity?.kind === "recite" && opening.activity.target === "word" ? opening.activity.word : null]).toEqual(["w2:recite", 2]);
    const ending = rest.filter((x) => x.idx === s.idx).at(-1);
    expect([ending?.activity?.kind, ending && stageFrame(l.seq, ending)?.frame, ending && stageFrame(l.seq, ending)?.recited, ending && stageExample(l.seq, ending)]).toEqual(["wait", 5, false, null]);
  });

  // Until 2026-10-13 this test was "a word's own recitation after its line (a word without a
  // composition): the word card stays" — the beat "w2:word". Plan L24 took that second recitation
  // away: the line is followed by the next word's opening step.
  it("a word without a composition (Al-Ikhlas 1): after its line the lesson goes straight to the next word — no beat, nothing recited in between", () => {
    const s0 = surah("al-ikhlas");
    const l = lessonOf(s0, s0.ayat[0]);
    const idx = l.seq.steps.findIndex((x) => x.id === "w2");
    expect(l.seq.steps[idx].kind).toBe("explain");
    const states = run(l.seq, started(l.seq, "biasa", idx), (x) => x.idx !== idx);
    const here = states.filter((x) => x.idx === idx);
    expect(here.length).toBeGreaterThan(2);
    expect(here.some((x) => x.activity?.kind === "recite")).toBe(false);
    expect(here.every((x) => stageExample(l.seq, x) === null)).toBe(true);
    const next = states[states.length - 1];
    expect([l.seq.steps[next.idx].id, next.activity?.kind, stageMarks(l.seq, next)]).toEqual(["w3:recite", "recite", { marked: [3], focus: 3 }]);
  });
});

describe("what the stage draws for a beat (ExampleCard, WordComposition)", () => {
  const MSG = { id: JSON.parse(read("messages/id.json")), en: JSON.parse(read("messages/en.json")) } as Record<string, Record<string, Record<string, string>>>;
  const intl = (locale: "id" | "en", el: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale, messages: MSG[locale], timeZone: "Asia/Jakarta" } as ComponentProps<typeof NextIntlClientProvider>, el),
    );
  const marks = composeFor("al-fatihah")!.marks;
  const count = (html: string, part: string) => html.split(part).length - 1;
  /** The markup's visible text (a glued word such as "orang-orang" sits in a span of its own). */
  const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

  it("a concept's example card, every one in Al-Fatihah, in both languages: “Contoh”, where the word stands, its bytes once, its transliteration and meaning", () => {
    let cards = 0;
    for (const l of fatihah) {
      const drawn = stageExamples(l.derived.examples);
      for (const { beat } of beatsOf(l.seq)) {
        if (beat.of !== "concept") continue;
        const e = drawn[beat.id];
        for (const locale of ["id", "en"] as const) {
          for (const state of ["reciting", "shown", "failed"] as const) {
            const html = intl(locale, createElement(ExampleCard, { id: beat.id, example: e, state, marks }));
            const where = `${beat.id} ${locale} ${state}`;
            expect(html, where).toContain(`data-autoplay="example"`);
            expect(html, where).toContain(`data-example="${beat.id}"`);
            expect(html, where).toContain(`data-example-state="${state}"`);
            expect(html, where).toContain(`data-clip="${beat.key}"`);
            const text = textOf(html);
            expect(text, where).toContain(MSG[locale].Guided.example_tag);
            expect(text, where).toContain(MSG[locale].Guided.word_n.replace("{n}", String(beat.word)));
            // The word exactly as the content has it, once, as Arabic in the mushaf face.
            expect(count(html, e.ar), where).toBe(1);
            expect(html, where).toMatch(new RegExp(`<p lang="ar" dir="rtl" class="quran[^"]*">${e.ar}</p>`));
            expect(text, where).toContain(e.translit);
            expect(text, where).toContain(MSG[locale].Guided.card_meaning.replace("{gloss}", e.gloss ?? ""));
            // The harakah it is about, in words with its sound — only where the content says so.
            expect(html.includes("data-example-ending"), where).toBe(e.ending !== null);
            if (e.ending) {
              expect(html, where).toContain(`data-example-ending="${e.ending}"`);
              expect(text, where).toContain(`${MSG[locale].Guided.example_ending} ${marks[e.ending].display}`);
              expect(text, where).toContain(MSG[locale].Compose.sound.replace("{v}", marks[e.ending].sound ?? ""));
            }
            // Nothing in it is a button or a link: one focused card, no new control on the stage.
            expect(html, where).not.toMatch(/<button|<a /);
          }
        }
        cards++;
      }
    }
    expect(cards).toBe(26);
  });

  it("an example from another ayah says where it stands instead of a word number", () => {
    const word = WORDS.get("112:4:4");
    if (!word) throw new Error("no 112:4:4");
    const example = { of: "concept" as const, key: "112:4:4", word: null, translit: word.translit, gloss: word.gloss, place: { surah: 112, ayah: 4 }, ar: word.ar, ending: null, waqf: false, washal: null };
    const html = intl("id", createElement(ExampleCard, { id: "concept:contoh:2", example, state: "reciting", marks: null }));
    expect(html).toContain("QS 112:4");
    expect(html).not.toContain("Kata ke-");
    expect(count(html, word.ar)).toBe(1);
  });

  it("a bentuk dasar: on its base frame the ringed tile is filled while the imam recites it, and only then; nothing is added to the figure", () => {
    const unit = composeFor("al-fatihah")!.words["1:1:1"];
    const draw = (example: { id: string; key: string; state: "reciting" | "failed" | "shown" } | null, frame = 2) =>
      intl("id", createElement(WordComposition, { unit, kind: "compose", frame, recited: false, marks, word: 1, stepKey: "w1:compose", example }));
    const plain = draw(null);
    const reciting = draw({ id: "w1:base:2", key: "55:78:1-2", state: "reciting" });
    const shown = draw({ id: "w1:base:2", key: "55:78:1-2", state: "shown" });
    const failed = draw({ id: "w1:base:2", key: "55:78:1-2", state: "failed" });
    expect(plain).not.toContain("data-example");
    for (const [html, state] of [[reciting, "reciting"], [shown, "shown"], [failed, "failed"]] as const) {
      expect(html).toContain(`data-example="w1:base:2"`);
      expect(html).toContain(`data-example-state="${state}"`);
      expect(html).toContain(`data-clip="55:78:1-2"`);
      expect(html).toContain(`data-compose-stage="base"`);
    }
    // The filled tile (the recited look: forest, paper text): exactly one, the ringed ismu.
    const filled = (html: string) => count(html, "border-forest bg-forest text-paper");
    expect([filled(plain), filled(reciting), filled(shown), filled(failed)]).toEqual([0, 1, 0, 0]);
    // Same elements, same text: the figure does not grow for the example (its caption is in the panel).
    // (its attributes, its fill and the screen reader's sentence apart)
    const body = (html: string) =>
      html
        .replace(/ data-(example|example-state|clip)="[^"]*"/g, "")
        .replace(/ class="[^"]*"/g, "")
        .replace(/<figcaption>[\s\S]*?<\/figcaption>/, "");
    expect(body(shown)).toBe(body(plain));
    expect(body(reciting)).toBe(body(plain));
    // A screen reader is told while he recites it.
    expect(reciting).toContain(MSG.id.Compose.recited);
    expect(shown).not.toContain(MSG.id.Compose.recited);
    // On another frame of the same word the example changes nothing.
    expect(filled(draw({ id: "w1:base:2", key: "55:78:1-2", state: "reciting" }, 3))).toBe(0);
    // Word 1 is not its ayah's last word: its joined word is never "recited" (plan L24), on no
    // frame a filled tile or the mark the browser check looks for.
    for (let k = 1; k <= unit.frames.length; k++) expect([k, filled(draw(null, k)), draw(null, k).includes("data-recited")]).toEqual([k, 0, false]);
    // Word 4, the ayah's last: its last frame while the imam recites it once more — the one tile
    // filled, the mark set, a screen reader told.
    const last = composeFor("al-fatihah")!.words["1:1:4"];
    const recitedLast = intl("id", createElement(WordComposition, { unit: last, kind: "compose", frame: last.frames.length, recited: true, marks, word: 4, stepKey: "w4:compose" }));
    expect([filled(recitedLast), recitedLast.includes('data-recited="true"'), recitedLast.includes(MSG.id.Compose.recited)]).toEqual([1, true, true]);
  });
});

describe("the example clip fetched ahead (warm.ts exampleToWarm)", () => {
  it("only while the lesson runs, only the clip the current step is about to play, never with Save-Data", () => {
    const l = fatihah[0];
    const ismu = LIBRARY.clips["55:78:1-2"].url;
    const idx = l.seq.steps.findIndex((s) => s.id === "w1:compose");
    // A page only looked at; a step without a clip; this ayah's own word as the example.
    expect(exampleToWarm(l.seq, createAutoplayState(l.seq))).toBeNull();
    expect(exampleToWarm(l.seq, started(l.seq, "biasa"))).toBeNull();
    expect(exampleToWarm(l.seq, atBeat(l.seq, "concept:naat:1"))).toBeNull();
    // The step begins: its clip is asked for while the narrator says the lines before it …
    const entered = reduceAutoplay(l.seq, started(l.seq, "biasa", idx - 1), { type: "next" });
    expect([entered.idx, entered.activity?.kind === "recite"]).toEqual([idx, false]);
    expect(exampleToWarm(l.seq, entered)).toBe(ismu);
    // … not when the browser asks to save data (it loads when its beat plays), not while paused.
    expect(exampleToWarm(l.seq, entered, { saveData: true })).toBeNull();
    expect(exampleToWarm(l.seq, entered, { effectiveType: "2g" })).toBeNull();
    expect(exampleToWarm(l.seq, reduceAutoplay(l.seq, entered, { type: "pause" }))).toBeNull();
    // The runner asks only once the step has wanted it for a moment: stepping through the lesson
    // with "Berikutnya ›" (a click or two a second) fetches nothing, a step that plays does —
    // well before its base frame (the lines before it last 10 s and more).
    expect(EXAMPLE_WARM_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(EXAMPLE_WARM_DELAY_MS).toBeLessThanOrEqual(3000);
    // Played: nothing more to fetch for this step. Failed: not asked for again.
    const playing = atBeat(l.seq, "w1:base:2");
    expect(exampleToWarm(l.seq, playing)).toBe(ismu);
    expect(exampleToWarm(l.seq, reduceAutoplay(l.seq, playing, { type: "recite_end", token: playing.activity!.token }))).toBeNull();
    expect(exampleToWarm(l.seq, reduceAutoplay(l.seq, playing, { type: "recite_error", token: playing.activity!.token }))).toBeNull();
  });

  it("over every Al-Fatihah lesson: never a recording but the current step's own clip, and every clip is asked for before its beat", () => {
    for (const l of fatihah) {
      const asked = new Set<string>();
      for (const s of run(l.seq, started(l.seq, "biasa"))) {
        const url = exampleToWarm(l.seq, s);
        const own = (l.seq.steps[s.idx].examples ?? []).flatMap((b) => (b.clip ? [b.clip.url] : []));
        if (url !== null) {
          expect(own, `${l.seq.lessonKey} ${l.seq.steps[s.idx].id}`).toContain(url);
          asked.add(url);
        }
        const a = s.activity;
        if (a?.kind === "recite" && a.target === "clip") expect(asked.has(a.clip.url), `${l.seq.lessonKey} ${a.key}`).toBe(true);
        // Never this ayah's own recording (the stage's player warms that), never narration.
        if (url !== null) expect(l.ayah.recitation.some((r) => r.url === url) || url.startsWith("/belajar/"), url).toBe(false);
      }
    }
  });
});

describe("what the beats add to a lesson", () => {
  const { input } = loadCheckInput((rel) => {
    try {
      return read(join("content", rel));
    } catch {
      return null;
    }
  });
  it(
    // Until 2026-10-13 a beat lasted its caption's captionMs (a 2.5 s settle for the eyes, never
    // under 5 s): 5.8 s for a one-line card, 240 s in all — "about four minutes to a lesson of
    // about seventy; no ayah more than 75 s". Plan L24: the reading alone (timing.ts exampleReadMs).
    "Al-Fatihah: 35 beats add about two and a half minutes to a lesson of about sixty-five; no ayah more than 45 s",
    () => {
      const report = runAutoplayChecks({ ...input, property: { streams: 0, length: 0 } });
      expect(report.errors).toEqual([]);
      const rows = Object.entries(report.stats.examples).filter(([k]) => k.startsWith("al-fatihah/"));
      expect(rows.map(([k, r]) => [k, r.beats.length])).toEqual([
        ["al-fatihah/1", 8],
        ["al-fatihah/2", 5],
        ["al-fatihah/3", 1],
        ["al-fatihah/4", 2],
        ["al-fatihah/5", 8],
        ["al-fatihah/6", 2],
        ["al-fatihah/7", 9],
      ]);
      for (const [k, r] of rows) {
        // Every beat: its caption's reading time (2.3 s for the shortest, 23 characters) and the
        // pause after the imam (0.8 s) — a one-line card about 3.5 s, where it was 5.8 s.
        expect(r.addedMs.biasa, k).toBeGreaterThan(r.beats.length * 3000);
        expect(r.addedMs.biasa, k).toBeLessThan(45_000);
        expect(r.addedMs.pelan, k).toBeGreaterThan(r.addedMs.biasa);
        // On average under 6 s (ayah 5, with two waqf notes of 97 characters: 5.2 s).
        expect(r.addedMs.biasa / r.beats.length, k).toBeLessThan(6_000);
      }
      const total = rows.reduce((n, [, r]) => n + r.addedMs.biasa, 0);
      expect(total).toBeGreaterThan(120_000);
      expect(total).toBeLessThan(180_000);
      expect(total / 60_000 / report.stats.minutes["al-fatihah"].biasa).toBeLessThan(0.05);
    },
    WALK_TIMEOUT_MS,
  );

  it("the CI browser check waits as long as the lesson gives up (scripts/ci/screenshots.mjs)", () => {
    const ci = read("scripts/ci/screenshots.mjs");
    expect(ci).toContain(`const EXAMPLE_LOAD_LIMIT_MS = ${EXAMPLE_LOAD_LIMIT_MS};`);
    expect(ci).toContain(`const EXAMPLE_FAILED_HOLD_MS = ${EXAMPLE_FAILED_HOLD_MS};`);
  });
});
