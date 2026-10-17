import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WordCard } from "@/components/lesson/WordCard";
import { StepCard } from "@/components/library/StepCard";
import {
  ayahLessonId,
  curriculumProblems,
  deriveLesson,
  LESSON_ZERO,
  lessonAyah,
  lessonRanks,
  MAX_STEPS_PER_LESSON,
  qacTags,
  stepOccurs,
  taughtEarlier,
  taughtIn,
  type CurriculumFile,
} from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";
import { CURRICULUM, taughtAt, taughtBefore, taughtInZero, ZERO_HOST } from "@/lib/curriculum";
import { LIBRARY } from "@/lib/library";

import id from "../../../messages/id.json";

import { narrationFor } from "./manifests";

// THE BASIC CURRICULUM (operator-approved 2026-10-13, docs/belajar-research/kurikulum-dasar.md
// decisions 1–9; docs/belajar-plan.md L26): "we distribute the lessons into these ayats" — at most
// three new steps per lesson, in the teaching order lesson zero → Al-Fatihah → An-Nas → Al-Falaq →
// Al-Ikhlas → Ayat al-Kursi — "so the knowledge is accummulating and repeated" — "but separate new
// vs already knows concept, this is what new, this is what we've learnt so far".
//
// WHERE a topic is taught is ONE file's business now, content/curriculum.json (the pipeline's
// build_curriculum.py, from pipeline/authored/curriculum.json). Here: the app's twin of the
// derivation (src/lib/autoplay/curriculum.ts) against the built file on every lesson — Python and
// TypeScript must agree —, the table of Al-Fatihah pinned, what each ayah's lesson teaches, where
// a step occurs, and the two things a basic lesson no longer shows (decision 6): the wazan row of
// a word card, and a card for a next-level record.

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: (p: { href: unknown; className?: string; children?: ReactNode }) => createElement("a", { href: String(p.href), className: p.className }, p.children),
}));

const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const surah = (slug: string) => SURAHS.find((s) => s.slug === slug)!;
const lesson = (lid: string) => CURRICULUM.lessons.find((l) => l.id === lid)!;
const step = (sid: string) => CURRICULUM.steps.find((s) => s.id === sid)!;

/** Al-Fatihah, measured on 2026-10-13 (the same table as pipeline/test_validate_curriculum.py):
 *  ayah → [new, the learnt steps that occur here, later, lanjut]. */
const TABLE: Record<number, [string[], string[], string[], string[]]> = {
  1: [["majrur", "huruf-jar"], ["harakat", "kalimah"], ["alif-lam", "naat", "idhafah"], ["syibhul-jumlah"]],
  2: [["jumlah-ismiyyah", "marfu", "jamak-mudzakkar-salim"], ["harakat", "kalimah", "majrur", "huruf-jar"], ["alif-lam", "naat", "idhafah", "badal"], ["syibhul-jumlah", "wazan-dan-tashrif"]],
  3: [["alif-lam", "naat"], ["harakat", "kalimah", "majrur"], [], ["wazan-dan-tashrif"]],
  4: [["idhafah"], ["harakat", "kalimah", "majrur", "alif-lam", "naat"], [], ["wazan-dan-tashrif", "isim-fail"]],
  5: [["dhamir", "fiil-mudhari", "murab-mabni"], ["harakat", "kalimah", "marfu"], ["jumlah-filiyyah", "maful-bih", "athaf"], ["taqdim-maful", "bab-istifal", "ilal"]],
  6: [["jumlah-filiyyah", "maful-bih", "manshub"], ["harakat", "kalimah", "alif-lam", "naat", "dhamir"], ["fiil-amr"], ["isim-fail", "bab-istifal", "ilal"]],
  7: [
    ["isim-maushul", "fiil-madhi", "athaf"],
    ["harakat", "kalimah", "majrur", "huruf-jar", "jamak-mudzakkar-salim", "alif-lam", "idhafah", "dhamir", "murab-mabni", "jumlah-filiyyah", "manshub"],
    ["badal"],
    ["isim-fail", "bab-ifal", "isim-maful", "naib-fail"],
  ],
};
const LEARNT_BEFORE = [2, 4, 7, 9, 10, 13, 16];

describe("the curriculum file is what the lessons give (the app's twin of pipeline/curriculum.py)", () => {
  it("every ayah on disk is a lesson, and its lines and lists equal the derivation", () => {
    expect(ZERO_HOST?.slug).toBe("al-fatihah");
    expect(curriculumProblems(CURRICULUM, SURAHS, LIBRARY.concepts, true)).toEqual([]);
    let written = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const l = lesson(ayahLessonId(a.surah, a.ayah));
        expect(l, a.loc).toBeDefined();
        const derived = deriveLesson(CURRICULUM, a, LIBRARY.concepts)!;
        expect(l.map, a.loc).toEqual(derived.map);
        expect(l.lines, a.loc).toEqual(derived.lines);
        written++;
      }
    }
    // 7 + 4 + 5 + 6 ayat, and the lesson with no ayah, which has its page since 2026-10-13
    // (lesson zero: the harakat primer is played there); the nine segments of Ayat al-Kursi have none yet.
    expect(written).toBe(22);
    expect(CURRICULUM.lessons.filter((l) => l.map).length).toBe(23);
    // Lesson zero: its steps are new, nothing was learnt before it, nothing occurs in it (no
    // ayah, no word) — and its one "Konsep baru" line is the kalimah record's.
    const zero = lesson(LESSON_ZERO);
    expect([zero.steps, zero.map, zero.lines]).toEqual([
      ["harakat", "kalimah"],
      { new: ["harakat", "kalimah"], learnt: [], later: [], lanjut: [] },
      [{ line: "concept:kalimah-isim-fiil-huruf", step: "kalimah", words: [] }],
    ]);
    expect(ayahLessonId(1, 0)).toBe(LESSON_ZERO);
    expect(taughtInZero().map((x) => [x.id, x.whole, x.concept, x.words])).toEqual([["kalimah-isim-fiil-huruf", true, "kalimah-isim-fiil-huruf", []]]);
    // The examples the step lists for lesson zero (operator 2026-10-15: the narrator explains each; three
    // kinds of isim, a fi'il, a huruf), in that order, each one of the record's own, its note the
    // record's and its line the step's; and the slide said before the line.
    const kalimah = CURRICULUM.steps.find((s) => s.id === "kalimah")!;
    const record = LIBRARY.concepts.find((c) => c.id === "kalimah-isim-fiil-huruf")!;
    expect(taughtInZero()[0].examples).toEqual(
      kalimah.examples!.map((e) => ({ loc: e.loc, note: record.examples.find((x) => x.loc === e.loc)!.note, say: e.say })),
    );
    expect(kalimah.examples!.map((e) => e.loc)).toEqual(["1:7:1", "1:6:3", "1:5:1", "1:5:2", "1:7:8"]);
    expect(taughtInZero()[0].lead).toEqual(kalimah.lead);
    expect(kalimah.lead!.cards.map((c) => [c.lang, c.term?.id ?? null, c.word ?? null])).toEqual([["ar", "kalimah", null], ["id", "kalam", "kalimat"]]);
    // … and an ayah's lesson has neither (its examples are its own words).
    expect(taughtAt(FATIHAH.ayat[0]).every((x) => x.lead === null && x.examples.every((e) => e.say === undefined))).toBe(true);
    // Without a primer played there it has no page, and must have no lists.
    expect(curriculumProblems(CURRICULUM, SURAHS, LIBRARY.concepts, false).join("\n")).toContain("lesson 0 has derived lists and no page");
    expect(deriveLesson(CURRICULUM, { ...FATIHAH.ayat[0], surah: 99 }, LIBRARY.concepts)).toBeNull();
  });

  it("Al-Fatihah: the table of 2026-10-13 — new 2 / 3 / 2 / 1 / 3 / 3 / 3 (it was 5 / 3 / 1 / 1 / 8 / 2 / 6)", () => {
    FATIHAH.ayat.forEach((a, i) => {
      const m = lesson(`1:${a.ayah}`).map!;
      expect([m.new, m.learnt.filter((x) => x.here).map((x) => x.id), m.later, m.lanjut], a.loc).toEqual(TABLE[a.ayah]);
      expect(m.learnt.length, a.loc).toBe(LEARNT_BEFORE[i]);
      expect([lesson(`1:${a.ayah}`).before, lesson(`1:${a.ayah}`).after], a.loc).toEqual([LEARNT_BEFORE[i], LEARNT_BEFORE[i] + m.new.length]);
    });
    expect(FATIHAH.ayat.map((a) => lesson(`1:${a.ayah}`).steps.length)).toEqual([2, 3, 2, 1, 3, 3, 3]);
  });

  it("the totals of kurikulum-dasar.md E: 32 lessons, 36 steps, at most three per lesson, 18 next-level records", () => {
    expect(CURRICULUM.lessons).toHaveLength(32);
    expect(CURRICULUM.steps).toHaveLength(36);
    expect(CURRICULUM.lessons.filter((l) => l.steps.length === 0)).toHaveLength(10);
    expect(Math.max(...CURRICULUM.lessons.map((l) => l.steps.length))).toBe(MAX_STEPS_PER_LESSON);
    expect(CURRICULUM.lanjut).toHaveLength(18);
    expect(LIBRARY.concepts).toHaveLength(37);
    const perUnit = Object.fromEntries(CURRICULUM.units.map((u) => [u.id, CURRICULUM.lessons.filter((l) => l.unit === u.id).reduce((n, l) => n + l.steps.length, 0)]));
    expect(perUnit).toEqual({ pengantar: 2, "al-fatihah": 17, "an-nas": 4, "al-falaq": 2, "al-ikhlas": 3, "ayat-kursi": 8 });
    expect(CURRICULUM.lessons.at(-1)!.after).toBe(36);
    // Every record of the library is placed: a step's (whole or in parts), or next-level.
    const placed = new Set([...CURRICULUM.steps.flatMap((s) => (s.concept ? [s.concept] : [])), ...CURRICULUM.lanjut]);
    expect(LIBRARY.concepts.filter((c) => !placed.has(c.id)).map((c) => c.id)).toEqual([]);
    // All sharaf is next-level (decision 6).
    for (const c of LIBRARY.concepts.filter((x) => x.kind === "sharaf")) expect(CURRICULUM.lanjut, c.id).toContain(c.id);
  });

  it("earlier and later are places in the CURRICULUM's order: An-Nas before Al-Falaq before Al-Ikhlas", () => {
    const rank = lessonRanks(CURRICULUM);
    const order = ["0", "1:1", "1:7", "114:1", "114:6", "113:1", "113:5", "112:1", "112:4", "2:255/1", "2:255/9"].map((l) => rank.get(l)!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(lessonAyah("114:2")).toEqual({ surah: 114, ayah: 2 });
    expect(lessonAyah("0")).toBeNull();
    expect(lessonAyah("2:255/4")).toBeNull();
    // Fi'il amr is taught on qul in An-Nas (decision 3), badal at An-Nas 2 (decision 4): Al-Fatihah
    // sees them coming, and the surahs after An-Nas — earlier in the mushaf — repeat them.
    expect([step("fiil-amr").lesson, step("badal").lesson]).toEqual(["114:1", "114:2"]);
    expect(lesson("1:6").map!.later).toContain("fiil-amr");
    for (const lid of ["113:1", "112:1"]) expect(lesson(lid).map!.learnt, lid).toContainEqual({ id: "fiil-amr", here: true });
    expect(lesson("114:3").map!.learnt).toContainEqual({ id: "badal", here: true });
  });

  it("where a step occurs: an i'rab state, a QAC tag, every word, a record's tags, nowhere", () => {
    const [a1, a2, a3] = FATIHAH.ayat;
    expect(stepOccurs(step("majrur"), a1)).toEqual([1, 2, 3, 4]);
    expect(stepOccurs(step("marfu"), a1)).toEqual([]);
    expect(stepOccurs(step("marfu"), a2)).toEqual([1]);
    expect(stepOccurs(step("alif-lam"), a1)).toEqual([3, 4]);
    expect(stepOccurs(step("alif-lam"), a2)).toEqual([1, 4]); // not lillāhi: QAC has no DET there
    expect(stepOccurs(step("kalimah"), a3)).toEqual([1, 2]); // every word is one of the three kinds
    expect(stepOccurs(step("harakat"), a1)).toEqual([1, 2, 3, 4]); // a basics step: on every letter (2026-10-17)
    expect(stepOccurs(step("idhafah"), a1)).toEqual([1, 2]); // tagged, and the words of its structure group
    expect(stepOccurs(step("jamak-taksir"), a1)).toEqual([]); // no record, no rule: nowhere yet
    expect(qacTags(a3.words[0])).toEqual(["DET", "ADJ"]);
    expect(qacTags({ sources: [] })).toEqual([]);
    // kurikulum-dasar.md C: alif lam per ayah of Al-Fatihah 2, 2, 2, 1, 0, 2, 2; majrur 4, 3, 2, 3, 0, 0, 3.
    expect(FATIHAH.ayat.map((a) => stepOccurs(step("alif-lam"), a).length)).toEqual([2, 2, 2, 1, 0, 2, 2]);
    expect(FATIHAH.ayat.map((a) => stepOccurs(step("majrur"), a).length)).toEqual([4, 3, 2, 3, 0, 0, 3]);
  });

  it("a file that lies about the lessons is refused (planted faults)", () => {
    const fault = (fn: (f: CurriculumFile) => void) => {
      const f = structuredClone(CURRICULUM) as CurriculumFile;
      fn(f);
      return curriculumProblems(f, SURAHS, LIBRARY.concepts, true).join("\n");
    };
    const L = (f: CurriculumFile, lid: string) => f.lessons.find((l) => l.id === lid)!;
    const S = (f: CurriculumFile, sid: string) => f.steps.find((s) => s.id === sid)!;
    expect(fault((f) => L(f, "1:2").map!.new.reverse())).toContain("lesson 1:2: new");
    expect(fault((f) => L(f, "1:5").map!.learnt.splice(3, 1))).toContain("lesson 1:5: learnt");
    expect(fault((f) => (L(f, "1:1").map!.learnt[0].here = false))).toContain("lesson 1:1: learnt"); // the harakat: every ayah
    expect(fault((f) => L(f, "1:3").map!.later.push("idhafah"))).toContain("lesson 1:3: later");
    expect(fault((f) => L(f, "1:1").map!.lanjut.push("hal"))).toContain("lesson 1:1: lanjut");
    expect(fault((f) => (L(f, "1:1").lines![0].words = [1]))).toContain("lesson 1:1: lines are not what the lessons give");
    expect(fault((f) => delete L(f, "1:4").map)).toContain("lesson 1:4 has a page and no derived lists");
    expect(fault((f) => delete L(f, "0").map)).toContain("lesson 0 has a page and no derived lists");
    expect(fault((f) => (L(f, "0").map!.new = []))).toContain("lesson 0: new");
    expect(fault((f) => L(f, "0").map!.learnt.push({ id: "majrur", here: false }))).toContain("lesson 0: learnt");
    expect(fault((f) => (L(f, "0").lines = []))).toContain("lesson 0: lines are not what the lessons give");
    expect(fault((f) => (L(f, "2:255/1").map = { new: [], learnt: [], later: [], lanjut: [] }))).toContain("lesson 2:255/1 has derived lists and no page");
    expect(fault((f) => (L(f, "1:4").before = 8))).toContain("lesson 1:4: learnt before / after is 9 / 10");
    // a step moved: the lesson it left and the one it reached both stop adding up
    expect(fault((f) => (S(f, "naat").lesson = "1:1"))).toMatch(/step naat is not in teaching order|lesson 1:1: steps/);
    expect(fault((f) => (S(f, "alif-lam").lesson = "1:2"))).toContain("lesson 1:2 teaches 4 new steps, more than 3");
    expect(fault((f) => (S(f, "badal").lesson = "9:9"))).toContain("step badal is taught in 9:9, which is not a lesson");
    expect(fault((f) => (S(f, "majrur").line = "concept:tanda-irab"))).toContain("step majrur: its line is concept:majrur, not concept:tanda-irab");
    expect(fault((f) => (S(f, "naat").concept = "tidak-ada"))).toContain("step naat names the record tidak-ada");
    expect(fault((f) => f.lessons.splice(f.lessons.findIndex((l) => l.id === "114:3"), 1))).toContain("114:3 is an ayah with a lesson on disk and no lesson of the curriculum");
  });
});

describe("what an ayah's lesson teaches as “Konsep baru” (taughtAt: what conceptsIntroducedIn was)", () => {
  it("Al-Fatihah: the curriculum's steps, in order — a whole record, or a step's own text", () => {
    expect(FATIHAH.ayat.map((a) => taughtAt(a).map((t) => t.id))).toEqual([
      ["majrur", "huruf-jar"],
      ["jumlah-ismiyyah", "marfu", "jamak-mudzakkar-salim"],
      ["alif-lam", "naat"],
      ["idhafah"],
      ["dhamir", "fiil-mudhari", "murab-mabni"],
      ["jumlah-filiyyah", "maful-bih", "manshub"],
      ["isim-maushul", "fiil-madhi", "athaf"],
    ]);
    const [majrur, hurufJar] = taughtAt(FATIHAH.ayat[0]);
    // A part of the i'rab record: its own text, its own sources, and the record's page to link.
    expect(majrur).toMatchObject({ id: "majrur", step: "majrur", whole: false, concept: "tanda-irab", title: "Majrur, dan tandanya: kasrah", words: [1, 2, 3, 4] });
    expect(majrur.marked?.title).toBe("[[Majrur|majrur]], dan tandanya: [[kasrah|kasrah]]");
    expect(majrur.sources.length).toBeGreaterThan(0);
    // … and its example is a word of the ayah in that state, about its ending (its sign).
    expect(majrur.examples[0]).toEqual({ loc: "1:1:1", note: "kasrah" });
    // A whole record: its own title and summary, the id its line always had.
    const record = LIBRARY.concepts.find((c) => c.id === "huruf-jar")!;
    expect(hurufJar).toMatchObject({ id: "huruf-jar", whole: true, concept: "huruf-jar", title: record.title, summary: record.summary, marked: null, words: [1] });
    expect(hurufJar.examples[0].loc).toBe("1:1:1");
    // A step with no record: nothing to link.
    const alifLam = taughtAt(FATIHAH.ayat[2])[0];
    expect(alifLam).toMatchObject({ id: "alif-lam", whole: false, concept: null, words: [1, 2] });
    expect(alifLam.examples.map((e) => e.loc)).toEqual(["1:3:1", "1:3:2"]);
  });

  it("a record moved to another ayah brings its example IN that ayah to the front", () => {
    // Na't: first example 1:1:3 (ar-raḥmāni of ayah 1), taught in ayah 3 (decision 1).
    const naat = taughtAt(FATIHAH.ayat[2]).find((t) => t.id === "naat")!;
    expect(LIBRARY.concepts.find((c) => c.id === "naat")!.examples[0].loc).toBe("1:1:3");
    expect(naat.examples[0].loc).toBe("1:3:1");
    expect(taughtAt(FATIHAH.ayat[3])[0].examples[0].loc).toMatch(/^1:4:/); // idhafah, taught in ayah 4
    expect(taughtAt(FATIHAH.ayat[6]).find((t) => t.id === "athaf")!.examples[0].loc).toBe("1:7:8");
    // Every record example is kept, each once.
    const all = LIBRARY.concepts.find((c) => c.id === "naat")!.examples.map((e) => e.loc);
    expect([...naat.examples.map((e) => e.loc)].sort()).toEqual([...all].sort());
    // Jumlah fi'liyyah is taught in ayah 6; its first example is na‘budu of ayah 5, and ihdinā
    // (1:6:1) is tagged with it since 2026-10-13: its line lights that word and shows it first.
    const jf = taughtAt(FATIHAH.ayat[5]).find((t) => t.id === "jumlah-filiyyah")!;
    expect(LIBRARY.concepts.find((c) => c.id === "jumlah-filiyyah")!.examples[0].loc).toBe("1:5:2");
    expect(jf.words).toEqual([1]);
    expect(jf.examples[0].loc).toBe("1:6:1");
    // PLANTED: the same step where no word of the ayah is tagged with it and the record has no
    // example there (what ayah 6 was until then). Its line lights no word, and its first example
    // is not a word of the ayah — which the lesson then lists as a rule without a beat.
    const six = FATIHAH.ayat[5];
    const bare = { ...six, words: six.words.map((w) => ({ ...w, concepts: (w.concepts ?? []).filter((c) => c !== "jumlah-filiyyah") })) };
    const file = {
      ...CURRICULUM,
      lessons: CURRICULUM.lessons.map((l) => (l.id === "1:6" ? { ...l, lines: (l.lines ?? []).map((x) => (x.step === "jumlah-filiyyah" ? { ...x, words: [] } : x)) } : l)),
    };
    const records = LIBRARY.concepts.map((c) => (c.id === "jumlah-filiyyah" ? { ...c, examples: c.examples.filter((e) => !e.loc.startsWith("1:6:")) } : c));
    const gap = taughtIn(file, records, bare).find((t) => t.id === "jumlah-filiyyah")!;
    expect(gap.words).toEqual([]);
    expect(gap.examples[0].loc).toBe("1:5:2");
  });

  it("the other surahs follow mechanically: fi'il amr and badal in An-Nas, nothing where the curriculum teaches nothing", () => {
    expect(surah("an-nas").ayat.map((a) => taughtAt(a).map((t) => t.id))).toEqual([["fiil-amr"], ["badal"], [], [], [], []]);
    expect(surah("al-falaq").ayat.map((a) => taughtAt(a).map((t) => t.id))).toEqual([[], [], [], [], []]);
    // Al-Ikhlas 3: the lam record whole (its line keeps the record's id); majzum, a part of i'rab,
    // has no text yet, so it has no line.
    expect(surah("al-ikhlas").ayat.map((a) => taughtAt(a).map((t) => t.id))).toEqual([[], [], ["jazm-lam"], ["kana-wa-akhawatuha"]]);
    expect(taughtAt(surah("al-ikhlas").ayat[2])[0].step).toBe("nafi-lam");
    // No next-level record is taught anywhere, and no lesson teaches more than three.
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const got = taughtAt(a);
        expect(got.length, a.loc).toBeLessThanOrEqual(MAX_STEPS_PER_LESSON);
        for (const t of got) expect(CURRICULUM.lanjut, `${a.loc} ${t.id}`).not.toContain(t.concept && t.whole ? t.concept : "");
      }
    }
    // The three kinds of word are taught in lesson zero, the lesson with no ayah (lesson-zero.test.ts),
    // so no ayah has that line; the same function over raw JSON gives the same.
    for (const s of SURAHS) for (const a of s.ayat) expect(taughtAt(a).map((t) => t.id), a.loc).not.toContain("kalimah-isim-fiil-huruf");
    expect(taughtIn(CURRICULUM, LIBRARY.concepts, FATIHAH.ayat[0])).toEqual(taughtAt(FATIHAH.ayat[0]));
  });

  it("the narration's concept lines are the curriculum's, in every surah", () => {
    for (const s of SURAHS) {
      const lines = Object.keys(narrationFor(s.slug)!.lines);
      for (const a of s.ayat) {
        const base = `${s.slug}:${a.ayah}:concept:`;
        const said = [...new Set(lines.filter((l) => l.startsWith(base)).map((l) => l.slice(base.length).replace(/:[a-z]$/, "")))];
        expect(said, a.loc).toEqual(taughtAt(a).map((t) => t.id));
      }
    }
  });
});

describe("a word card: a concept an earlier lesson taught, and no wazan at the basic level", () => {
  it("taughtBefore: the whole record's step, or the part of i'rab this word shows — earlier lessons only", () => {
    const w = (loc: string) => {
      const [s, a, n] = loc.split(":").map(Number);
      const ayah = SURAHS.find((x) => x.surah === s)!.ayat.find((x) => x.ayah === a)!;
      return [ayah, ayah.words[n - 1]] as const;
    };
    const at = (loc: string, record: string) => taughtBefore(...w(loc), record);
    expect(at("1:4:1", "naat")).toEqual({ step: "naat", surah: 1, ayah: 3 });
    expect(at("1:2:3", "naat")).toBeNull(); // taught LATER (ayah 3): the lesson postpones it
    expect(at("1:3:1", "naat")).toBeNull(); // taught in this very lesson
    // The i'rab record arrives in parts: a majrur word of ayah 2 was taught in ayah 1, its marfu'
    // word is this lesson's own step.
    expect(at("1:2:4", "tanda-irab")).toEqual({ step: "majrur", surah: 1, ayah: 1 });
    expect(at("1:2:1", "tanda-irab")).toBeNull();
    expect(at("1:6:2", "tanda-irab")).toBeNull(); // manshub: this lesson's
    // A next-level record is never "already learnt".
    expect(at("1:3:1", "wazan-dan-tashrif")).toBeNull();
    // A step of the lesson with no ayah was learnt in lesson zero ("sudah dipelajari di
    // Pengantar", main session 2026-10-13): no ayah to name, so `zero` — from the first ayah on,
    // in every surah, and only while lesson zero is written (the built file carries its lists).
    const kalimah = CURRICULUM.steps.find((s) => s.concept === "kalimah-isim-fiil-huruf")!;
    expect(kalimah.lesson).toBe("0");
    expect(at("1:5:2", "kalimah-isim-fiil-huruf")).toEqual({ step: kalimah.id, zero: true });
    expect(at("1:1:1", "kalimah-isim-fiil-huruf")).toEqual({ step: kalimah.id, zero: true });
    expect(at("114:1:1", "kalimah-isim-fiil-huruf")).toEqual({ step: kalimah.id, zero: true });
    const unwritten = { ...CURRICULUM, lessons: CURRICULUM.lessons.map((l) => (l.id === "0" ? { ...l, map: undefined, lines: undefined } : l)) };
    expect(taughtEarlier(unwritten, ...w("1:5:2"), "kalimah-isim-fiil-huruf")).toBeNull();
    // Across surahs, in the curriculum's order: An-Nas repeats Al-Fatihah, Al-Falaq repeats An-Nas.
    expect(at("114:1:2", "fiil-mudhari")).toEqual({ step: "fiil-mudhari", surah: 1, ayah: 5 });
    expect(at("113:1:1", "fiil-amr")).toEqual({ step: "fiil-amr", surah: 114, ayah: 1 });
    expect(taughtEarlier(CURRICULUM, { surah: 99, ayah: 1 }, w("1:1:1")[1], "naat")).toBeNull();
  });

  const intl = (children: ReactNode) => {
    const props: ComponentProps<typeof NextIntlClientProvider> = { locale: "id", messages: id, timeZone: "Asia/Jakarta", children };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
  };
  const labels = { ...id.Word, sharaf: { heading: id.Word.sharaf_heading, forms_note: id.Word.sharaf_forms_note, ilal: id.Word.ilal, ilal_from: id.Word.ilal_from, ilal_to: id.Word.ilal_to } };

  it("no wazan row in a basic lesson (decision 6); the row stays in the code for the next level", () => {
    const word = FATIHAH.ayat[2].words[0]; // ar-raḥmāni: wazn فَعْلان
    expect(word.wazn).toBeTruthy();
    const basic = intl(createElement(WordCard, { word, labels }));
    expect(basic).not.toContain("data-word-wazan");
    expect(basic).not.toContain(id.Word.wazn);
    const next = intl(createElement(WordCard, { word, labels, wazan: true }));
    expect(next).toContain("data-word-wazan");
    expect(next).toContain(id.Word.wazn);
    expect(next).toContain(word.wazn!);
  });

  it("a step's own text has the card of a record: its title with its Arabic, its sources, and the record it is a part of", () => {
    const [majrur] = taughtAt(FATIHAH.ayat[0]);
    const card = (t: typeof majrur) => intl(createElement(StepCard, { taught: t, labels: { more: id.Concept.more, sources: id.Word.sources } }));
    const html = card(majrur);
    expect(html).toContain('data-step-card="majrur"');
    expect(html.replace(/<[^>]+>/g, "")).toContain("Majrur, dan tandanya: kasrah");
    // The terms' Arabic comes from the library's table (the headword under the title), never typed.
    const ar = new Map(LIBRARY.terms.map((t) => [t.id, t.ar]));
    expect(html).toContain(ar.get("majrur")!);
    expect(html).toContain(ar.get("kasrah")!);
    expect(html).toContain(`${id.Word.sources} (${majrur.sources.length})`);
    for (const s of majrur.sources) expect(html).toContain(s.url);
    // A part of the i'rab record links to that record's page; alif lam has no record, so no link.
    expect(html).toMatch(/href="[^"]*konsep\/tanda-irab"/);
    expect(html).toContain(id.Concept.more);
    const alifLam = card(taughtAt(FATIHAH.ayat[2])[0]);
    expect(alifLam).not.toContain(id.Concept.more);
    expect(alifLam).not.toMatch(/href="[^"]*konsep\//);
    expect(alifLam).toContain(ar.get("marifah")!);
  });
});
