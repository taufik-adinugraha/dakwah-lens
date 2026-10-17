import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EXERCISE_GUIDE_PARTS, EXERCISE_KEYS as UI_KEYS } from "@/components/exercises/guide";
import { WordKind } from "@/components/exercises/WordKind";
import type { QuizExerciseOf } from "@/content/quiz-schema";
import {
  availableExercises,
  buildAutoplaySequence,
  createAutoplayState,
  EXERCISE_KEYS,
  exerciseProgressId,
  OPENING_EXERCISES,
  PARTS_OF,
  questionNumbers,
  reduceAutoplay,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type NarrationManifest,
} from "@/lib/autoplay";
import { sequenceProblems } from "@/lib/autoplay/checks";
import { qacTags } from "@/lib/autoplay/curriculum";
import { composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { taughtAt } from "@/lib/curriculum";
import { getLexeme } from "@/lib/library";
import { lessonMapFor, lessonMapInput } from "@/lib/map-content";
import { quizAyah, quizFileProblems, quizFor } from "@/lib/quiz-content";
import { planOf } from "@/lib/quiz-plan";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence } from "./build";
import { narrationFor, SHARED_NARRATION } from "./manifests";
import { AUTOPLAY_TEXT_SETS } from "./texts";

// THE WARM-UP: "isim, fi'il, atau huruf?" (operator 2026-10-13: "i think it's better in every ayat
// we identify first each words fall into which category: ismu, fi'il or harf. it's kind of
// exercise, kind of warming up"; he approved: the learner guesses first, and the answer gives the
// visible sign). An exercise that OPENS every ayah lesson of a surah with a lesson map: after the
// map's steps, before the first word. It asks each PART of each word in order (a word of two
// parts, "dengan" + "nama", is two questions), with three buttons, and explains every answer
// with one sentence.
//
// Here: where its step stands in the lesson and that the lesson waits there; its lines against
// the quiz; the quiz file against the content; the exercise as drawn; and that the CI scripts and
// the Python mirror know it. How the questions are DERIVED (the QAC tag, its agreement with the
// lesson's `pos`, the signs an earlier lesson taught, the sentence built from the data) is the
// pipeline's: pipeline/quiz.py, test_validate_quiz.py.

// The exercise links nothing, but its shell reads the progress store through the app's hooks.
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push() {} }), Link: () => null }));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const LINES = narrationFor("al-fatihah")?.lines ?? {};
const WARMUP = "word-kind";
type Questions = QuizExerciseOf<"word-kind">["questions"];
const questionsOf = (slug: string, ayah: number): Questions => planOf(quizAyah(slug, ayah), WARMUP)?.questions ?? [];

describe("the warm-up is an exercise of its own, the first on the page and the one that opens the lesson", () => {
  it("one key, first in page order, in the engine, the exercises and the pipeline alike", () => {
    expect(EXERCISE_KEYS[0]).toBe(WARMUP);
    expect([...UI_KEYS]).toEqual([...EXERCISE_KEYS]);
    expect([...OPENING_EXERCISES]).toEqual([WARMUP]);
    expect([...PARTS_OF[WARMUP]]).toEqual(["options", "reveal", "next"]);
    expect([...EXERCISE_GUIDE_PARTS[WARMUP]]).toEqual([...PARTS_OF[WARMUP]]);
    expect(exerciseProgressId("al-fatihah/2", WARMUP)).toBe("al-fatihah/2/kind");
    const py = read("pipeline/quiz.py");
    expect(py).toContain(`WARMUP = "${WARMUP}"`);
    expect(py).toContain('EXERCISE_KEYS = (WARMUP, "tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory")');
    expect(py).toContain("OPENING_EXERCISES = (WARMUP,)");
    // Captions, prompts and messages in both languages.
    for (const locale of ["id", "en"] as const) {
      const t = AUTOPLAY_TEXT_SETS[locale].exercise[WARMUP];
      for (const k of ["intro", "options", "reveal", "next"] as const) expect(t[k], `${locale} ${k}`).toBeTruthy();
    }
    const keys = (m: typeof id) => Object.keys(m.Exercise).filter((k) => k.startsWith("kind_"));
    expect(keys(id)).toEqual(["kind_title", "kind_instruction", "kind_question_word", "kind_question_part", "kind_word", "kind_piece"]);
    expect(keys(en as typeof id)).toEqual(keys(id));
    // Every control is "klik", never "ketuk" (operator 2026-10-10).
    expect(JSON.stringify([id.Exercise, AUTOPLAY_TEXT_SETS.id.exercise[WARMUP]])).not.toMatch(/ketuk/i);
  });

  it("every ayah of a surah with a lesson map has it; a surah without one has none", () => {
    for (const s of SURAHS) {
      const mapped = lessonMapFor(s.slug) !== null;
      for (const a of s.ayat) {
        const keys = availableExercises(quizAyah(s.slug, a.ayah));
        expect(keys.includes(WARMUP), a.loc).toBe(mapped);
        if (mapped) expect(keys[0], a.loc).toBe(WARMUP);
      }
      expect(Object.keys(quizFor(s.slug)!.kinds), s.slug).toEqual(mapped ? ["isim", "fiil", "huruf"] : []);
    }
    expect(SURAHS.filter((s) => lessonMapFor(s.slug) !== null).map((s) => s.slug)).toEqual(["al-fatihah"]);
  });
});

describe("its step in the lesson: after what the ayah brings, before the first word", () => {
  it("Al-Fatihah, both locales: intro, the imam's ayah, the map, the WARM-UP, the first word; every other exercise after the structure", () => {
    for (const a of FATIHAH.ayat) {
      for (const locale of ["id", "en"] as const) {
        const seq = stageSequence(FATIHAH, a, locale);
        const ids = seq.steps.map((s) => s.id);
        const where = `al-fatihah ${a.ayah} (${locale})`;
        const at = ids.indexOf("ex:word-kind");
        expect(at, where).toBeGreaterThan(1);
        expect(seq.steps.slice(2, at).every((s) => s.kind === "map"), where).toBe(true);
        expect(ids[at + 1], where).toBe("w1:recite");
        expect(seq.steps.filter((s) => s.kind === "exercise")[0].id, where).toBe("ex:word-kind");
        const lastTold = Math.max(...seq.steps.flatMap((s, i) => (s.kind === "structure" || s.kind === "concept" ? [i] : [])));
        for (const [i, s] of seq.steps.entries()) if (s.kind === "exercise" && s.id !== "ex:word-kind") expect(i, `${where} ${s.id}`).toBeGreaterThan(lastTold);
        // An exercise step like the others: its introduction, the prompt of each control, and the
        // explanation of each question (where the narration has the line: Indonesian).
        const spec = seq.steps[at].exercise!;
        expect([spec.key, spec.progressId, [...spec.parts]], where).toEqual([WARMUP, `al-fatihah/${a.ayah}/kind`, ["options", "reveal", "next"]]);
        expect(seq.steps[at].cues[spec.lead[0]].line, where).toBe(`al-fatihah:${a.ayah}:ex:word-kind:intro`);
        const qs = questionsOf("al-fatihah", a.ayah);
        if (locale === "id") {
          expect(Object.keys(spec.explain).map(Number), where).toEqual(qs.map((q) => q.n));
          for (const q of qs) expect(seq.steps[at].cues[spec.explain[q.n]!].line, where).toBe(`al-fatihah:${a.ayah}:ex:word-kind:${q.n}:why`);
        }
        // No word is recited, no animation plays: the exercise is what the stage shows.
        expect([seq.steps[at].recite, seq.steps[at].frames, seq.steps[at].examples], where).toEqual([undefined, undefined, undefined]);
      }
    }
  });

  const input = (a: (typeof FATIHAH.ayat)[number]) => ({
    slug: "al-fatihah",
    surahName: FATIHAH.name_id,
    ayahCount: FATIHAH.ayat.length,
    ayah: a,
    introduced: taughtAt(a),
    exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
    questions: questionNumbers(quizAyah("al-fatihah", a.ayah)),
    texts: AUTOPLAY_TEXT_SETS.id,
    narration: narrationFor("al-fatihah"),
    shared: SHARED_NARRATION,
    compose: composeInput("al-fatihah", a),
    map: lessonMapInput("al-fatihah", a.ayah),
  });
  const ctx = (a: (typeof FATIHAH.ayat)[number]) => ({
    ayah: a,
    last: a.ayah === FATIHAH.ayat.length,
    exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
    introduced: taughtAt(a),
    compose: composeInput("al-fatihah", a),
    map: lessonMapInput("al-fatihah", a.ayah),
  });

  it("the engine's own check holds it there: moved behind the words, or before the map, it is refused", () => {
    for (const a of FATIHAH.ayat) {
      const seq = buildAutoplaySequence(input(a));
      expect(sequenceProblems(seq, ctx(a)), a.loc).toEqual([]);
      const at = seq.steps.findIndex((s) => s.id === "ex:word-kind");
      const warm = seq.steps[at];
      const without = seq.steps.filter((_, i) => i !== at);
      // … after the first word's steps,
      const late = { ...seq, steps: [...without.slice(0, at + 2), warm, ...without.slice(at + 2)] };
      expect(sequenceProblems(late, ctx(a)).join("\n"), a.loc).toContain("the warm-up (ex:word-kind) is not the step right before the first word");
      // … before the lesson map,
      const early = { ...seq, steps: [...without.slice(0, 2), warm, ...without.slice(2)] };
      expect(sequenceProblems(early, ctx(a)).join("\n"), a.loc).toContain("the warm-up (ex:word-kind) is not the step right before the first word");
      // … or with the other exercises, at the end of the explanations.
      const firstLate = without.findIndex((s) => s.kind === "exercise");
      const end = firstLate === -1 ? without.findIndex((s) => s.id === "learned") : firstLate;
      const last = { ...seq, steps: [...without.slice(0, end), warm, ...without.slice(end)] };
      expect(sequenceProblems(last, ctx(a)).join("\n"), a.loc).toContain("is not the step right before the first word");
      // And a lesson that should have it and has not: the exercises differ from the page's.
      expect(sequenceProblems({ ...seq, steps: without }, ctx(a)).join("\n"), a.loc).toContain("exercise steps");
    }
  });

  it("an ordinary exercise is still refused before the words are explained", () => {
    const a = FATIHAH.ayat[1];
    const seq = buildAutoplaySequence(input(a));
    const tap = seq.steps.findIndex((s) => s.id === "ex:tap-word");
    const firstWord = seq.steps.findIndex((s) => s.id === "w1:recite");
    const steps = seq.steps.filter((_, i) => i !== tap);
    steps.splice(firstWord, 0, seq.steps[tap]);
    const problems = sequenceProblems({ ...seq, steps }, ctx(a)).join("\n");
    expect(problems).toContain("exercise comes before the words are explained");
    expect(problems).toContain("is not the step right before the first word");
  });

  const end = (s: AutoplayState): AutoplayEvent => {
    const a = s.activity!;
    return a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };
  };
  /** The lesson at its warm-up, the introduction and the first prompt through: waiting. */
  const waiting = (seq: AutoplaySequence) => {
    const at = seq.steps.findIndex((x) => x.id === "ex:word-kind");
    let s = reduceAutoplay(seq, createAutoplayState(seq, { pace: "biasa" }), { type: "start", pace: "biasa", from: at, reason: "continue" });
    s = reduceAutoplay(seq, s, { type: "exercise_guide", target: "exercise:word-kind:options" });
    for (let i = 0; i < 40 && s.phase !== "waiting"; i++) s = reduceAutoplay(seq, s, end(s));
    return { s, at };
  };

  it("the lesson WAITS there: no timer moves it on; “Lewati latihan” and the last answer do, to the first word", () => {
    for (const a of FATIHAH.ayat) {
      const seq = stageSequence(FATIHAH, a, "id");
      const start = waiting(seq);
      const at = start.at;
      let s = start.s;
      expect([s.phase, s.idx], a.loc).toEqual(["waiting", at]);
      expect(s.guides.map((g) => g.target), a.loc).toEqual(["exercise:word-kind:options"]);
      // Idle: reminders, never the next step.
      for (let i = 0; i < 600; i++) s = reduceAutoplay(seq, s, s.activity ? end(s) : { type: "idle_tick", ms: 1000 });
      expect(s.idx, a.loc).toBe(at);
      // "Lewati latihan": on to the first word, recited by the imam.
      const skipped = reduceAutoplay(seq, s, { type: "skip" });
      expect(seq.steps[skipped.idx].id, a.loc).toBe("w1:recite");
      // Every question answered, the exercise reports done: the same.
      s = waiting(seq).s;
      const qs = questionsOf("al-fatihah", a.ayah);
      s = reduceAutoplay(seq, s, { type: "answered", key: WARMUP, correct: true, question: qs.at(-1)!.n });
      s = reduceAutoplay(seq, s, { type: "exercise_done", key: WARMUP });
      for (let i = 0; i < 40 && s.idx === at; i++) s = reduceAutoplay(seq, s, end(s));
      expect(seq.steps[s.idx].id, a.loc).toBe("w1:recite");
    }
  });

  it("a right answer, and a shown one, are followed by THAT question's sentence (once its line is rendered: here every line has a file)", () => {
    const a = FATIHAH.ayat[1];
    const voice = { id: "v", name: "Uji", model: "eleven_v3" };
    const file = (k: number) => ({ url: `/belajar/media/narration/uji/${k}.mp3`, ms: 1500, sha256: "a".repeat(64) });
    const voiced = (m: NarrationManifest | null): NarrationManifest => ({ version: 1, voice, lines: Object.fromEntries(Object.entries(m?.lines ?? {}).map(([k, v], i) => [k, { ...v, audio: file(i), tokens: undefined }])) });
    const seq = buildAutoplaySequence({ ...input(a), narration: voiced(narrationFor("al-fatihah")), shared: voiced(SHARED_NARRATION) });
    const start = waiting(seq);
    const at = start.at;
    let s = start.s;
    // A wrong pick: silence (operator 2026-10-10: "give narration/voice only for the correct answer").
    s = reduceAutoplay(seq, s, { type: "answered", key: WARMUP, correct: false, question: 3 });
    expect(s.activity).toBeNull();
    const said = (from: AutoplayState) => {
      const out: string[] = [];
      let x = from;
      for (let i = 0; i < 12 && x.idx === at && x.activity; i++) {
        if (x.activity.kind === "narrate" && out.at(-1) !== x.activity.line) out.push(x.activity.line);
        if (x.activity.kind === "wait" && out.length === 2) break;
        x = reduceAutoplay(seq, x, end(x));
      }
      return out;
    };
    expect(said(reduceAutoplay(seq, s, { type: "answered", key: WARMUP, correct: true, question: 3 }))).toEqual(["shared:correct", "al-fatihah:2:ex:word-kind:3:why"]);
    expect(said(reduceAutoplay(seq, s, { type: "revealed", key: WARMUP, question: 2 }))).toEqual(["shared:revealed", "al-fatihah:2:ex:word-kind:2:why"]);
  });
});

describe("its lines: the introduction, and one sentence per question — the one the screen shows", () => {
  it("the manifest has exactly the lines of the quiz, before the first word's, each one line", () => {
    const ids = Object.keys(LINES);
    for (const a of FATIHAH.ayat) {
      const qs = questionsOf("al-fatihah", a.ayah);
      const want = [`al-fatihah:${a.ayah}:ex:word-kind:intro`, ...qs.map((q) => `al-fatihah:${a.ayah}:ex:word-kind:${q.n}:why`)];
      const have = ids.filter((k) => k.startsWith(`al-fatihah:${a.ayah}:ex:word-kind:`));
      expect(have, a.loc).toEqual(want);
      // In the file where the lesson says them: after the map's lines, before the first word's.
      const at = ids.indexOf(want[0]);
      expect(ids[at - 1], a.loc).toMatch(new RegExp(`^al-fatihah:${a.ayah}:map:`));
      expect(ids[at + want.length], a.loc).toBe(`al-fatihah:${a.ayah}:w1`);
      // The introduction lights the whole ayah (the exercise is about its words); an explanation
      // lights nothing: the exercise shows the word.
      expect([LINES[want[0]].highlight, LINES[want[0]].focus], a.loc).toEqual([[0], null]);
      for (const k of want.slice(1)) expect([LINES[k].highlight, LINES[k].focus], k).toEqual([[], null]);
    }
    expect(ids.filter((k) => k.includes(":ex:word-kind:")).length).toBe(7 + 37);
    // The prompt of its three buttons is a shared line, like every exercise's.
    expect(Object.keys(SHARED_NARRATION?.lines ?? {}).filter((k) => k.includes("word-kind"))).toEqual(["shared:ex:word-kind:options", "shared:ex:word-kind:reveal", "shared:ex:word-kind:next"]);
  });

  it("what the narrator says of a question is what the screen shows after its answer", () => {
    const fold = (s: string) => s.replace(/[’‘]/g, "'").replace(/ \((?:\p{Script=Arabic}|\p{M}|\s)+\)/gu, "");
    for (const a of FATIHAH.ayat) {
      for (const q of questionsOf("al-fatihah", a.ayah)) {
        const line = LINES[`al-fatihah:${a.ayah}:ex:word-kind:${q.n}:why`];
        const where = `${a.loc} q${q.n}`;
        // The same words (each shows a term's Arabic by its own table: the caption the dictionary's).
        expect(fold(line.display ?? ""), where).toBe(fold(q.why));
        // A part is named by its place, then (where the content names it) by itself with its
        // meaning, "Kata keempat, yaitu <Arabic> (ar-raḥīmi), yang artinya “…”," — never by a
        // Qur'anic word in the prose; then its kind and WHICH class of the kind it is (operator
        // 2026-10-17: "directly show which one"), never the kind's general definition; one
        // sentence, or two with a sign.
        expect(q.why, where).toMatch(q.of > 1 ? /^Bagian (pertama|kedua|ketiga) kata \S+?(?:,| adalah )/ : /^Kata \S+?(?:,| adalah )/);
        expect(q.why, where).toMatch(/ adalah (?:isim|fi'il|huruf) \((?:\p{Script=Arabic}|\p{M})+\)(?:, karena ia [a-z ]+)?\./u);
        expect(q.why.includes(`, karena ia ${q.class}.`), where).toBe(!!q.class);
        expect(q.why, where).not.toContain("nama benda, orang, atau sifat");
        expect(line.text, where).not.toMatch(/[a-z]+[āīūḥṣḍṭẓżġ‘]/i);
        expect((q.why.match(/\. /g) ?? []).length, where).toBe(q.signs.length ? 1 : 0);
        expect(/Tandanya: /.test(q.why), where).toBe(q.signs.length > 0);
      }
    }
  });

  it("the three kinds are said from the dictionary, “huruf” included (its word-class sense, where the warm-up names it)", () => {
    const intro = LINES["al-fatihah:1:ex:word-kind:intro"];
    expect(intro.display).toContain("isim (اِسْم), fi’il (فِعْل), atau huruf (حَرْف)");
    expect(intro.text).toContain("اِسْم, فِعْل, atau حَرْف");
    expect(LINES["al-fatihah:1:ex:word-kind:1:why"].display).toMatch(/^Bagian pertama kata pertama, yaitu \S+ \(bi\), yang artinya “dengan”, adalah huruf \(حَرْف\), karena ia kata tugas\.$/);
    expect(LINES["al-fatihah:1:ex:word-kind:1:why"].text).toBe("Bagian pertama kata pertama, yaitu bi, yang artinya dengan, adalah حَرْف, karena ia kata tugas.");
    // … and nowhere else did "huruf" become the term: a letter is still a letter.
    // (the kasrah's definition over the bare letter since 2026-10-15: "Contohnya huruf ba'" over ب;
    // the letter shown alone, without its Latin name, since 2026-10-17)
    expect(LINES["al-fatihah:0:primer:5"].display).toContain("Contohnya huruf ب ini");
    expect(SHARED_NARRATION?.lines["shared:ex:word-kind:options"].display).toBe("Pilih jenisnya: isim (اِسْم), fi’il (فِعْل), atau huruf (حَرْف).");
  });
});

describe("the quiz file against the content", () => {
  const q = quizFor("al-fatihah")!;
  const withWarm = (fn: (qs: Questions) => Questions) => ({
    ...q,
    ayat: q.ayat.map((a) => (a.ayah !== 1 ? a : { ...a, exercises: a.exercises.map((ex) => (ex.key === WARMUP ? { ...ex, questions: fn(ex.questions) } : ex)) })),
  });
  const problems = (file: typeof q) => quizFileProblems(file, FATIHAH, getLexeme).join("\n");

  it("every part of every word once, in order; a word's parts are the word as the lesson writes it", () => {
    expect(problems(q)).toBe("");
    let total = 0;
    for (const a of FATIHAH.ayat) {
      const qs = questionsOf("al-fatihah", a.ayah);
      total += qs.length;
      a.words.forEach((w, i) => {
        const parts = qs.filter((x) => x.word === i + 1);
        expect(parts.map((x) => x.part), w.loc).toEqual(parts.map((_, k) => k + 1));
        expect(parts.every((x) => x.of === parts.length), w.loc).toBe(true);
        expect(parts.map((x) => x.ar).join(""), w.loc).toBe(w.ar);
        // As many parts as the lesson's own word class has ("huruf jar + isim": two), which is
        // the QAC segments without the article.
        expect(parts.length, w.loc).toBe(w.pos.split(" + ").length);
        expect(parts.length, w.loc).toBe(qacTags(w).filter((t) => t !== "DET").length);
      });
    }
    expect(total).toBe(37);
  });

  it("a part left out, a word left out, parts that are not the word, an answer without its label: refused when the content loads", () => {
    expect(problems(withWarm((qs) => qs.filter((x) => x.n !== 2)))).toContain("al-fatihah 1 word-kind: the 1 part(s) of word 1 are not the word 1:1:1");
    expect(problems(withWarm((qs) => qs.filter((x) => x.word !== 3)))).toContain("every part of each of the 4 words is asked once, in order");
    expect(problems(withWarm((qs) => [qs[1], qs[0], ...qs.slice(2)]))).toContain("every part of each of the 4 words is asked once, in order");
    expect(problems(withWarm((qs) => qs.map((x) => (x.n === 3 ? { ...x, ar: FATIHAH.ayat[0].words[2].ar } : x))))).toContain("the 1 part(s) of word 2 are not the word 1:1:2");
    expect(problems({ ...q, kinds: { isim: q.kinds.isim, fiil: q.kinds.fiil } })).toContain("no label for the kind huruf");
  });
});

describe("the exercise as drawn", () => {
  const MSG = { id, en } as const;
  const draw = (locale: keyof typeof MSG, ayah: number) => {
    const a = FATIHAH.ayat[ayah - 1];
    const quiz = quizAyah("al-fatihah", ayah);
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale,
      messages: MSG[locale],
      timeZone: "Asia/Jakarta",
      children: createElement(WordKind, { id: `al-fatihah/${ayah}/kind`, words: a.words, questions: questionsOf("al-fatihah", ayah), kinds: quiz.kinds }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  it("the first question of Al-Fatihah 1: the word cut into its two parts, the first in the thick frame, and three answers with their Arabic", () => {
    const html = draw("id", 1);
    const [first, second] = questionsOf("al-fatihah", 1);
    expect(html).toContain('data-kind-word="1" data-kind-part="1"');
    // Each part ONE whole piece of the lesson's bytes, in its own isolated right-to-left run.
    const pieces = [...html.matchAll(/<span lang="ar" dir="rtl" data-kind-piece="(\d)"( data-asked="true")? class="([^"]*)">([^<]*)<\/span>/g)].map((m) => ({ part: Number(m[1]), asked: !!m[2], cls: m[3], ar: m[4] }));
    expect(pieces.map((p) => [p.part, p.asked, p.ar])).toEqual([
      [1, true, first.ar],
      [2, false, second.ar],
    ]);
    expect(pieces.map((p) => p.ar).join("")).toBe(FATIHAH.ayat[0].words[0].ar);
    for (const p of pieces) expect(p.cls).toMatch(/\bquran\b.*\bwhitespace-nowrap\b/);
    // Never colour alone: the one asked has the thick frame, and the question names it by number.
    expect(pieces[0].cls).toContain("border-[3px] border-forest");
    expect(pieces[1].cls).toContain("border-dashed");
    expect(text(html)).toContain("Bagian 1 kata ini: isim, fi'il, atau huruf?");
    expect(text(html)).toContain("Bagian 1");
    expect(text(html)).toContain("Bagian 2");
    // The word's place, transliteration and meaning, as the other exercises show a word.
    expect(text(html)).toContain(`Kata ke-1 · ${FATIHAH.ayat[0].words[0].translit} · ${FATIHAH.ayat[0].words[0].gloss}`);
    expect(html).toMatch(/<ul dir="rtl"/);
    // Three buttons, in the order the lessons name the kinds, each with its Arabic term.
    const options = [...html.matchAll(/<button type="button" data-option="([a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => [m[1], text(m[2].replace(/<[^>]+>/g, ""))]);
    expect(options).toEqual([
      ["isim", "Isim (اِسْم)"],
      ["fiil", "Fi'il (فِعْل)"],
      ["huruf", "Huruf (حَرْف)"],
    ]);
    expect(text(html)).toContain("Soal 1 dari 5");
    // Nothing is answered yet: no explanation on screen, and nothing that gives the answer away.
    expect(html).not.toContain(first.why);
    expect(text(html)).not.toContain("kata tugas");
  });

  it("a word of one part: the word itself in the frame, and the question says “Kata ini”", () => {
    const html = draw("id", 3);
    const pieces = [...html.matchAll(/data-kind-piece="(\d)"( data-asked="true")?[^>]*>([^<]*)<\/span>/g)].map((m) => [Number(m[1]), !!m[2], m[3]]);
    expect(pieces).toEqual([[1, true, FATIHAH.ayat[2].words[0].ar]]);
    expect(text(html)).toContain("Kata ini isim, fi'il, atau huruf?");
    expect(text(html)).not.toMatch(/Bagian \d/);
    expect(text(draw("en", 3))).toContain("Is this word an isim, a fi'il, or a huruf?");
  });

  it("standalone on the lesson page too, first in “Latihan”; in the stage through GuidedExercise", () => {
    const page = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    expect(page).toContain('const kindPlan = planOf(quiz, "word-kind");');
    expect(page.indexOf("{kindPlan && <WordKind id={`${key}/kind`}")).toBeGreaterThan(-1);
    expect(page.indexOf("{kindPlan && <WordKind")).toBeLessThan(page.indexOf("{tapPlan && <TapWord"));
    const guided = read("src/components/autoplay/GuidedExercise.tsx");
    expect(guided).toContain('case "word-kind": {');
    expect(guided).toContain('"word-kind": "kind_title"');
    // No Arabic is typed in the component: every byte comes from content/quiz.
    expect(read("src/components/exercises/WordKind.tsx").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")).not.toMatch(/\p{Script=Arabic}/u);
  });
});

describe("the CI scripts know it", () => {
  it("a walk to a step by its name passes the warm-up: “Berikutnya ›” is “Lewati latihan” there", () => {
    // toStep (screenshots.mjs) and the per-step sweep (linebreaks.mjs) both press the one button
    // the stage marks data-autoplay="next", which is the skip button on an exercise step.
    const stage = read("src/components/lesson/LessonStage.tsx");
    expect(stage).toMatch(/data-autoplay="next"\s+data-guide=\{view\.showSkip \? "skip" : undefined\}\s+onClick=\{actions\.forward\}/);
    const shots = read("scripts/ci/screenshots.mjs");
    expect(shots).toMatch(/async function toStep\(page, vp, id\) \{[\s\S]{0,400}?const next = page\.locator\('\[data-autoplay="next"\]'\);/);
    // … and no check names a step by a count of clicks from the start past the map.
    expect(shots).not.toMatch(/toStep\(page, vp, "w1:recite"\)/);
    // The warm-up has its own browser check, run on both viewports.
    expect(shots).toContain("async function wordKindChecks(page, vp, index) {");
    expect(shots).toContain("await wordKindChecks(page, vp, narration);");
    expect(shots).toContain('[data-exercise="word-kind"]');
    // The line-break sweep answers every exercise it meets once, by the key its controls carry
    // (data-guide="exercise:<key>:<part>"): the warm-up's step and its feedback are measured at
    // the three text sizes like the others'.
    const lines = read("scripts/ci/linebreaks.mjs");
    expect(lines).toContain('page.locator(`${STAGE} [data-guide^="exercise:"]`)');
    expect(lines).toContain('const options = part("options").locator("button");');
    expect(read("src/components/exercises/WordKind.tsx")).toContain('<ul data-guide={mark("options")}');
  });
});
