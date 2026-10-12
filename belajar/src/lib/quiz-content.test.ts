/**
 * The quizzes as the page ships them (content/quiz, src/lib/quiz-content.ts). The guard that every
 * question was TAUGHT before it is asked runs in the pipeline (validate_quiz.py and its planted
 * faults, CI verify job); here: every lesson surah has its quiz, the loader refuses a broken one,
 * the stage plays the explanation of every Al-Fatihah question's answer, and the labels carry the
 * term table's Arabic (operator 2026-10-10, narration rule 16).
 */
import { describe, expect, it } from "vitest";

import { stageSequence } from "@/components/autoplay/build";

import { SURAHS } from "./content";
import { getLexeme, LIBRARY, TERMS } from "./library";
import { QUIZ_SLUGS, quizAyah, quizFileProblems, quizFor } from "./quiz-content";
import { planOf } from "./quiz-plan";
import { annotate, lessonLookup, Scope, termDisplay } from "./terms";

const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;

describe("quizzes (content/quiz)", () => {
  it("one per lesson surah, every reference resolving", () => {
    expect([...QUIZ_SLUGS].sort()).toEqual(SURAHS.map((s) => s.slug).sort());
    for (const s of SURAHS) expect(quizFileProblems(quizFor(s.slug)!, s, getLexeme)).toEqual([]);
    expect(quizFor("al-fatihah")?.authored).toBe(true);
  });

  it("refuses a question on an untimed word, an answer not first, a word outside its bins", () => {
    const q = structuredClone(quizFor("al-fatihah")!);
    const a2 = q.ayat.find((a) => a.ayah === 2)!;
    const tap = planOf(a2, "tap-word")!;
    tap.questions[0].word = 9;
    const role = planOf(a2, "label-role")!;
    role.questions[0].options.reverse();
    const sort = planOf(a2, "sort-case")!;
    sort.bins = ["manshub", "majrur"];
    const problems = quizFileProblems(q, fatihah, getLexeme).join("\n");
    expect(problems).toContain("tap-word q1: word 9 is not a word of the ayah");
    expect(problems).toContain("label-role q1: the first option is not the answer's (1:2:1)");
    expect(problems).toContain("sort-case q1: marfu is not a bin");
  });

  it("Al-Fatihah: the stage says the explanation of every question's answer (Indonesian page)", () => {
    for (const a of fatihah.ayat) {
      const seq = stageSequence(fatihah, a, "id");
      const quiz = quizAyah("al-fatihah", a.ayah);
      for (const ex of quiz.exercises) {
        const step = seq.steps.find((s) => s.exercise?.key === ex.key);
        expect(step, `${a.loc} ${ex.key}`).toBeDefined();
        const explain = step!.exercise!.explain;
        expect(Object.keys(explain).map(Number), `${a.loc} ${ex.key}`).toEqual(ex.questions.map((q) => q.n));
        for (const q of ex.questions) {
          const cue = step!.cues[explain[q.n]!];
          expect(cue.line).toBe(`al-fatihah:${a.ayah}:ex:${ex.key}:${q.n}:why`);
          expect(cue.spoken?.length ?? 0).toBeGreaterThan(10);
        }
      }
      // The English page has no narration: "Correct." only, no explanation cue.
      for (const st of stageSequence(fatihah, a, "en").steps) if (st.exercise) expect(st.exercise.explain).toEqual({});
    }
  });

  it("labels show the verified term table's Arabic", () => {
    const ar = new Map(LIBRARY.terms.map((t) => [t.id, t.ar]));
    const q = quizFor("al-fatihah")!;
    for (const st of ["marfu", "manshub", "majrur", "mabni"]) expect(q.states[st]).toContain(ar.get(st)!);
    expect(q.labels["fi'il mudhari'"]).toContain(ar.get("fiil-mudhari")!);
    // Ayah 2 sorts into the two states taught by then: marfu' (at its first word) and majrur.
    expect(planOf(quizAyah("al-fatihah", 2), "sort-case")?.bins).toEqual(["marfu", "majrur"]);
    expect(planOf(quizAyah("al-fatihah", 1), "sort-case")).toBeNull();
    expect(planOf(quizAyah("al-fatihah", 4), "wazn-factory")).toBeNull();
  });
});

// The quiz text is built in Python (pipeline/quiz.py annotate_marked), a word card's by
// src/lib/terms.ts: two renderers of one marked text. Review 2026-10-12: the rule that keeps a
// term Latin inside a bracketed phrase reached the card only, and the quiz still read
// "rafa' (رَفْع, mahall, مَحَلّ raf')". Wherever the quiz shows a word's reason or role, it must
// be the string the card shows.
describe("the quiz and the word card show one text", () => {
  it("every reason or role the Al-Fatihah quiz takes from a word is what the card renders", () => {
    const strings: string[] = [];
    const walk = (o: unknown): void => {
      if (typeof o === "string") strings.push(o);
      else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    walk(quizFor("al-fatihah"));
    const lookup = lessonLookup(TERMS, fatihah);
    const inQuiz = new Set(strings);
    // A reason or role the quiz shows is the card's rendering, character for character. Counted,
    // not matched one by one (a quiz string and its plain text differ by the Arabic itself): 43 of
    // the 58 reasons and roles are quiz text today, and a renderer that drifts drops the count.
    let shared = 0;
    for (const a of fatihah.ayat) {
      for (const w of a.words) {
        for (const marked of [w.marked?.why, w.marked?.role]) {
          if (marked && inQuiz.has(termDisplay(annotate(marked, new Scope(false), lookup)).text)) shared++;
        }
      }
    }
    // Exactly today's count: three drifting strings (40) was the defect. A change to the quiz or
    // the words that moves it is updated here knowingly.
    expect(shared).toBe(43);
    expect(strings.join("\n")).not.toMatch(/mahall, \p{Script=Arabic}+ raf'/u);
  });
});
