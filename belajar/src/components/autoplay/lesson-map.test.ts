import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LessonMapCard, type LessonMapCardGroup } from "@/components/lesson/LessonMapCard";
import { WordCard } from "@/components/lesson/WordCard";
import {
  availableExercises,
  buildAutoplaySequence,
  createAutoplayState,
  hasArabicScript,
  lessonMapInputOf,
  lessonMapProblems,
  LINE_ID_RE,
  MAP_ARABIC_GLOSS,
  MAP_GROUPS,
  MAP_HERE_FULL,
  MAP_LATER_FULL,
  mapHere,
  mapLatinName,
  mapOpening,
  mapTotal,
  parseLineId,
  reduceAutoplay,
  type AutoplayEvent,
  type LessonMapFile,
  type LessonMapInput,
  type NarrationManifest,
} from "@/lib/autoplay";
import { loadCheckInput, sequenceProblems } from "@/lib/autoplay/checks";
import { composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { CURRICULUM, taughtAt } from "@/lib/curriculum";
import { captionSpans } from "@/lib/emphasis";
import { lessonMapFor, lessonMapInput, MAPPED_SLUGS } from "@/lib/map-content";
import { quizAyah } from "@/lib/quiz-content";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence } from "./build";
import { captionText, karaokeParts, stageCaption } from "./caption";
import { narrationFor } from "./manifests";
import { AUTOPLAY_TEXT_SETS } from "./texts";

// THE LESSON MAP, version 2 (operator 2026-10-13, docs/belajar-plan.md L23: "at the beginning of
// the ayat, better to inform what concept we will learn in this ayat, also explain maybe we skip
// some concept and will visit later in next ayat … so at the beginning we inform what will be
// learnt, in the end recap what we've learnt" — and, with the basic curriculum, L26: "so the
// knowledge is accummulating and repeated"; "but separate new vs already knows concept, this is
// what new, this is what we've learnt so far").
//
// What is new, learnt so far, taught later and next-level in an ayah is the CURRICULUM's
// (curriculum.test.ts holds content/curriculum.json to the lessons); content/map/<slug>.json
// carries those lists for a surah that is switched on, each step with its name. Here: the file
// held to the curriculum, the names (the ones the "Konsep baru: …" captions use), the steps of the
// autoplay sequence — ONE PER GROUP, in step with the narrator —, the per-surah switch, and the
// card, one group at a time. That a browser DRAWS the cards is checked in CI
// (scripts/ci/screenshots.mjs lessonMapChecks).

// The word card links its concepts through the app's Link; no router is mounted in a unit test.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: (p: { href: unknown; className?: string; children?: ReactNode }) => createElement("a", { href: String(p.href), className: p.className }, p.children),
}));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const FILE = lessonMapFor("al-fatihah")!;
const OPENING = MAP_GROUPS.map((g) => `map:${g}`);

/** Al-Fatihah, measured on 2026-10-13 (the same table as pipeline/test_validate_map.py and
 *  curriculum.test.ts): ayah → [new, the learnt steps that occur here, later, lanjut]. */
const TABLE: Record<number, [string[], string[], string[], string[]]> = {
  1: [["majrur", "huruf-jar"], ["kalimah"], ["alif-lam", "naat", "idhafah"], ["syibhul-jumlah"]],
  2: [["jumlah-ismiyyah", "marfu", "jamak-mudzakkar-salim"], ["kalimah", "majrur", "huruf-jar"], ["alif-lam", "naat", "idhafah", "badal"], ["syibhul-jumlah", "wazan-dan-tashrif"]],
  3: [["alif-lam", "naat"], ["kalimah", "majrur"], [], ["wazan-dan-tashrif"]],
  4: [["idhafah"], ["kalimah", "majrur", "alif-lam", "naat"], [], ["wazan-dan-tashrif", "isim-fail"]],
  5: [["dhamir", "fiil-mudhari", "murab-mabni"], ["kalimah", "marfu"], ["jumlah-filiyyah", "maful-bih", "athaf"], ["taqdim-maful", "bab-istifal", "ilal"]],
  6: [["jumlah-filiyyah", "maful-bih", "manshub"], ["kalimah", "alif-lam", "naat", "dhamir"], ["fiil-amr"], ["isim-fail", "bab-istifal", "ilal"]],
  7: [
    ["isim-maushul", "fiil-madhi", "athaf"],
    ["kalimah", "majrur", "huruf-jar", "jamak-mudzakkar-salim", "alif-lam", "idhafah", "dhamir", "murab-mabni", "jumlah-filiyyah", "manshub"],
    ["badal"],
    ["isim-fail", "bab-ifal", "isim-maful", "naib-fail"],
  ],
};
const LEARNT_BEFORE = [2, 4, 7, 9, 10, 13, 16];
const asTable = (file: LessonMapFile) =>
  Object.fromEntries(file.ayat.map((a) => [a.ayah, [a.new, a.learnt.filter((x) => x.here).map((x) => x.id), a.later, a.lanjut]]));

describe("the lesson map file (content/map) and the per-surah switch", () => {
  it("content/map/al-fatihah.json carries the curriculum's lists, each step named and placed as the curriculum has it", () => {
    expect(asTable(FILE)).toEqual(TABLE);
    expect(FILE.ayat.map((a) => a.learnt.length)).toEqual(LEARNT_BEFORE);
    expect(lessonMapProblems(FILE, CURRICULUM)).toEqual([]);
    for (const a of FILE.ayat) {
      const lesson = CURRICULUM.lessons.find((l) => l.id === `1:${a.ayah}`)!;
      expect({ new: a.new, learnt: a.learnt, later: a.later, lanjut: a.lanjut }, `ayah ${a.ayah}`).toEqual(lesson.map);
    }
    // 19 steps learnt by the end of the surah (two of them in the lesson with no ayah), and two
    // more that Al-Fatihah shows and An-Nas teaches; nine next-level records, named and not taught.
    expect(Object.keys(FILE.steps)).toHaveLength(21);
    expect(Object.entries(FILE.steps).filter(([, s]) => !/^(?:0|1:\d)$/.test(s.lesson)).map(([sid, s]) => [sid, s.lesson])).toEqual([
      ["fiil-amr", "114:1"],
      ["badal", "114:2"],
    ]);
    expect(Object.keys(FILE.lanjut)).toEqual(["syibhul-jumlah", "wazan-dan-tashrif", "isim-fail", "taqdim-maful", "bab-istifal", "ilal", "bab-ifal", "isim-maful", "naib-fail"]);
    // New and already-learnt are always apart (decision 9), and "learnt" is cumulative.
    let before: string[] = [];
    for (const a of FILE.ayat) {
      const learnt = a.learnt.map((x) => x.id);
      const every = [...a.new, ...learnt, ...a.later];
      expect(new Set(every).size, `ayah ${a.ayah}`).toBe(every.length);
      if (a.ayah > 1) expect(learnt, `ayah ${a.ayah}`).toEqual(before);
      before = [...learnt, ...a.new];
    }
  });

  it("marfu' is a step of the curriculum now (it was an authored “later” item of ayah 1)", () => {
    // Operator 2026-10-13: "in ayat-1, it mentions 'bentuk tertentu' but no explanation about
    // marfu' itself, better to inform it will be learnt later".
    expect(FILE.steps.marfu).toEqual({ name: "Marfu’ (مَرْفُوع)", latin: "Marfu'", lesson: "1:2" });
    const lines = narrationFor("al-fatihah")!.lines;
    expect(lines["al-fatihah:2:concept:marfu"].display).toMatch(/^Konsep baru: Marfu’ \(مَرْفُوع\), dan tandanya: dhammah \(ضَمَّة\)\./);
    // Ayah 1 has no marfu' word, so its map no longer lists it; no line of ayah 1 names the term,
    // and the sentence that points ahead there stays (the curriculum teaches marfu' in ayah 2).
    expect(FILE.ayat[0].later).not.toContain("marfu");
    for (const [lid, l] of Object.entries(lines)) if (lid.startsWith("al-fatihah:1:")) expect(l.display!.toLowerCase(), lid).not.toContain("marfu");
    expect(lines["al-fatihah:1:w1:compose:3"].display).toMatch(/Mengapa dhammah \(ضَمَّة\), kita pelajari di ayat kedua\.$/);
    // From ayah 3 on it is learnt, and marked wherever a word is marfu' (the two verbs of ayah 5).
    expect(lessonMapInput("al-fatihah", 3)!.learnt.find((x) => x.id === "marfu")).toMatchObject({ here: false });
    expect(lessonMapInput("al-fatihah", 5)!.learnt.find((x) => x.id === "marfu")).toMatchObject({ here: true });
  });

  it("only a surah the pipeline switched on has a map: the files, the loader and the authored switches agree", () => {
    const files = readdirSync(join(BELAJAR, "content", "map")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    const switched = readdirSync(join(BELAJAR, "pipeline", "authored")).flatMap((f) => (f.endsWith(".map.json") ? [f.slice(0, -".map.json".length)] : []));
    expect([...MAPPED_SLUGS].sort()).toEqual(files.sort());
    expect(files.sort()).toEqual(switched.sort());
    expect([...MAPPED_SLUGS]).toEqual(["al-fatihah"]);
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const map = lessonMapInput(s.slug, a.ayah);
        if (s.slug === "al-fatihah") expect(map).not.toBeNull();
        else expect(map, `${s.slug} ${a.ayah}`).toBeNull();
      }
    }
  });

  it("the check script's raw file gives the page's map", () => {
    const { input } = loadCheckInput((rel) => {
      const path = join(BELAJAR, "content", rel);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    });
    for (const s of SURAHS) {
      const raw = (input.maps?.[s.slug] ?? null) as LessonMapFile | null;
      for (const a of s.ayat) expect(lessonMapInputOf(raw, a.ayah)).toEqual(lessonMapInput(s.slug, a.ayah));
    }
  });

  it("an ayah's map as the lesson takes it: names, what comes up again, where a postponed step is taught", () => {
    const m = lessonMapInput("al-fatihah", 6)!;
    expect(m.new.map((x) => x.name)).toEqual(["Jumlah fi’liyyah (جُمْلَة فِعْلِيَّة)", "Maf’ul bih (مَفْعُول بِه)", "Manshub (مَنْصُوب)"]);
    expect(mapHere(m).map((x) => x.id)).toEqual(TABLE[6][1]);
    expect(mapTotal(m)).toBe(16);
    // Fi'il amr is taught in An-Nas 1: another surah.
    expect(m.later).toEqual([{ id: "fiil-amr", name: FILE.steps["fiil-amr"].name, surah: 114, ayah: 1 }]);
    expect(lessonMapInput("al-fatihah", 1)!.later.map((x) => [x.id, x.surah, x.ayah])).toEqual([
      ["alif-lam", 1, 3],
      ["naat", 1, 3],
      ["idhafah", 1, 4],
    ]);
    expect(m.lanjut.map((x) => x.name)).toEqual(["Isim fa’il (اِسْم فَاعِل)", "Bab istif‘āl (اِسْتِفْعَال)", "I’lal (إِعْلَال)"]);
    // Which opening groups an ayah has: what is new always; learnt once something was; later when
    // a step is postponed or a next-level topic is there.
    const made = (o: Partial<LessonMapInput>): LessonMapInput => ({ surah: 1, new: [], learnt: [], later: [], lanjut: [], ...o });
    expect(mapOpening(made({}))).toEqual(["new"]);
    expect(mapOpening(made({ learnt: [{ id: "a", name: "A", here: false }] }))).toEqual(["new", "learnt"]);
    expect(mapOpening(made({ lanjut: [{ id: "x", name: "X" }] }))).toEqual(["new", "later"]);
    expect(mapOpening(m)).toEqual(["new", "learnt", "later"]);
    for (const a of FATIHAH.ayat) expect(mapOpening(lessonMapInput("al-fatihah", a.ayah)!), a.loc).toEqual(["new", "learnt", "later"]);
    expect(mapLatinName("Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)")).toBe("Mu’rab dan mabni");
    expect(mapLatinName("Tiga jenis kata")).toBe("Tiga jenis kata");
  });

  it("a file that lies about the curriculum is refused (planted faults)", () => {
    const fault = (fn: (f: LessonMapFile) => void) => {
      const f = structuredClone(FILE) as LessonMapFile;
      fn(f);
      return lessonMapProblems(f, CURRICULUM).join("\n");
    };
    const entry = (f: LessonMapFile, n: number) => f.ayat.find((a) => a.ayah === n)!;
    // new is the lesson's steps, in their order.
    expect(fault((f) => entry(f, 1).new.reverse())).toContain("ayah 1: new");
    expect(fault((f) => entry(f, 2).new.pop())).toContain("ayah 2: new");
    // learnt is the whole list so far, `here` exactly where the step occurs.
    expect(fault((f) => entry(f, 5).learnt.shift())).toContain("ayah 5: learnt");
    expect(fault((f) => (entry(f, 1).learnt[0].here = true))).toContain("ayah 1: learnt");
    // later really later, learnt really earlier; a step in two groups.
    expect(fault((f) => entry(f, 1).later.push("badal"))).toContain("ayah 1: later");
    expect(fault((f) => entry(f, 1).learnt.push({ id: entry(f, 1).later.shift()!, here: true }))).toContain("learnt lists alif-lam, which is not taught earlier");
    expect(fault((f) => entry(f, 3).later.push(entry(f, 3).learnt.pop()!.id))).toContain("later lists jamak-mudzakkar-salim, which is not taught later");
    expect(fault((f) => entry(f, 3).later.push("naat"))).toContain("a step is listed twice");
    expect(fault((f) => entry(f, 1).lanjut.push("hal"))).toContain("ayah 1: lanjut");
    // the names tables
    expect(fault((f) => (f.steps.naat.lesson = "1:1"))).toContain("step naat is not named and placed as the curriculum has it");
    expect(fault((f) => (f.steps.naat.name = "Sifat"))).toContain("step naat is not named and placed as the curriculum has it");
    expect(fault((f) => delete f.steps.badal)).toContain("badal is listed and has no record in steps");
    expect(fault((f) => (f.steps.kana = { name: "Kana", latin: "Kana", lesson: "112:4" }))).toContain("kana has a record and no ayah lists it");
    expect(fault((f) => delete f.lanjut.ilal)).toContain("next-level record ilal is listed and has no name");
    expect(fault((f) => f.ayat.push({ ayah: 8, new: [], learnt: [], later: [], lanjut: [] }))).toContain("1:8 is no lesson of the curriculum");
    expect(fault((f) => (f.version = 1))).toContain("version 1 is not 2");
  });
});

describe("a step's name is the one its Konsep baru caption uses", () => {
  it("every step taught in Al-Fatihah is named as src/lib/emphasis.ts emphasises the name in its own caption", () => {
    const lead = "Konsep baru: ";
    const lines = narrationFor("al-fatihah")!.lines;
    let checked = 0;
    for (const a of FATIHAH.ayat) {
      for (const t of taughtAt(a)) {
        const s = FILE.steps[t.step];
        const line = lines[`al-fatihah:${a.ayah}:concept:${t.id}`] ?? lines[`al-fatihah:${a.ayah}:concept:${t.id}:a`];
        const display = line.display!;
        expect(display.startsWith(lead), t.id).toBe(true);
        const span = captionSpans(display).find((e) => e.kind === "term" && e.from === lead.length);
        expect(span, `${t.id}: “${display.slice(0, 60)}”`).toBeDefined();
        expect(display.slice(span!.from, span!.to), t.id).toBe(s.name);
        // The prose form is the same name without its Arabic.
        expect(hasArabicScript(s.latin), t.id).toBe(false);
        expect(s.latin.split(/\s+/).length, t.id).toBeLessThanOrEqual(4);
        checked++;
      }
    }
    // The 17 steps of the surah; the two of the lesson with no ayah have no caption yet.
    expect(checked).toBe(17);
  });
});

describe("the lesson map in the autoplay sequence", () => {
  it("Al-Fatihah: one step per group right after the imam's recitation, learned right before the recap — one line each, no word marked", () => {
    for (const a of FATIHAH.ayat) {
      for (const locale of ["id", "en"] as const) {
        const seq = stageSequence(FATIHAH, a, locale);
        const ids = seq.steps.map((s) => s.id);
        const where = `al-fatihah ${a.ayah} (${locale})`;
        expect(ids.slice(0, 5), where).toEqual(["intro", "recite", ...OPENING]);
        // The harakat primer (ayah 1) comes after the map; else the first word does.
        expect(ids[5], where).toBe(a.ayah === 1 ? "primer" : "w1:recite");
        expect(ids.slice(-3), where).toEqual(["learned", "recap", a.ayah === 7 ? "done" : "next"]);
        expect(ids.indexOf("learned"), where).toBeGreaterThan(Math.max(...seq.steps.flatMap((s, i) => (s.kind === "exercise" || s.kind === "structure" ? [i] : []))));
        const map = lessonMapInput("al-fatihah", a.ayah)!;
        for (const sid of [...OPENING, "learned"]) {
          const step = seq.steps.find((s) => s.id === sid)!;
          expect(step.kind, where).toBe(sid === "learned" ? "learned" : "map");
          expect(step.lines, where).toEqual([`al-fatihah:${a.ayah}:${sid}`]);
          expect(LINE_ID_RE.test(step.lines[0])).toBe(true);
          expect(parseLineId(step.lines[0])).toMatchObject({ kind: "ayah", slug: "al-fatihah", ayah: a.ayah, part: sid, split: null });
          const [cue] = step.cues;
          expect([cue.highlight, cue.focus, cue.frame], where).toEqual([[], null, null]);
          expect(step.recite, where).toBeUndefined();
          expect(step.examples, where).toBeUndefined();
          if (locale === "id") {
            // The caption is the narration's display: what is spoken.
            expect(cue.display, where).toBe(narrationFor("al-fatihah")!.lines[step.lines[0]].display);
          } else {
            // An English page has no narration: the engine's own caption gives the counts, and
            // the card names the steps — no Arabic script in a caption without a manifest.
            expect(cue.display, where).toBeNull();
            expect(hasArabicScript(cue.caption), where).toBe(false);
          }
        }
        if (locale === "en") {
          const said = (sid: string) => seq.steps.find((s) => s.id === sid)!.cues[0].caption;
          expect(said("map:new"), where).toContain(String(map.new.length));
          expect(said("map:learnt"), where).toContain(String(map.learnt.length));
          expect(said("map:learnt"), where).toContain(String(mapHere(map).length));
          expect(said("map:later"), where).toContain(String(map.lanjut.length));
          expect(said("learned"), where).toContain(String(mapTotal(map)));
        }
        const ctx = { ayah: a, last: a.ayah === 7, exercises: availableExercises(quizAyah("al-fatihah", a.ayah)), introduced: taughtAt(a), compose: composeInput("al-fatihah", a) };
        expect(sequenceProblems(seq, { ...ctx, map }), where).toEqual([]);
        // The engine's own check refuses a lesson whose steps and map disagree.
        expect(sequenceProblems(seq, ctx).join("\n"), where).toContain("a map step in a lesson without a lesson map");
        // … and a group played in another order, or left out.
        const swapped = structuredClone(seq);
        [swapped.steps[2], swapped.steps[3]] = [swapped.steps[3], swapped.steps[2]];
        expect(sequenceProblems(swapped, { ...ctx, map }).join("\n"), where).toContain("are not the steps right after the imam's ayah, one per group");
        const dropped = structuredClone(seq);
        dropped.steps.splice(3, 1);
        expect(sequenceProblems(dropped, { ...ctx, map }).join("\n"), where).toContain("are not the steps right after the imam's ayah, one per group");
      }
    }
  });

  it("the engine's captions say how many, in every locale's set", () => {
    for (const [locale, texts] of Object.entries(AUTOPLAY_TEXT_SETS)) {
      const said = [
        texts.lessonMap.new({ new: 3 }),
        texts.lessonMap.new({ new: 0 }),
        texts.lessonMap.learnt({ learnt: 16, here: 10 }),
        texts.lessonMap.learnt({ learnt: 2, here: 0 }),
        texts.lessonMap.later({ later: 3, lanjut: 1 }),
        texts.lessonMap.later({ later: 0, lanjut: 2 }),
        texts.lessonMap.later({ later: 1, lanjut: 0 }),
        texts.learned({ new: 3, total: 19, here: 10 }),
        texts.learned({ new: 0, total: 21, here: 6 }),
        texts.learned({ new: 0, total: 21, here: 0 }),
      ];
      for (const s of said) {
        expect(s.trim(), locale).not.toBe("");
        expect(hasArabicScript(s), locale).toBe(false);
        expect(s, locale).not.toMatch(/\b[A-Z]{2,}\b/);
      }
      expect(said[0], locale).toContain("3");
      expect(said[1], locale).not.toMatch(/\d/);
      expect(said[2], locale).toMatch(/16[\s\S]*10/);
      expect(said[3], locale).toContain("2");
      expect(said[4], locale).toMatch(/3[\s\S]*1/);
      expect(said[5], locale).toContain("2");
      expect(said[7], locale).toMatch(/3[\s\S]*19/);
      expect(said[8], locale).toContain("6");
      expect(said[9], locale).not.toMatch(/\d/);
    }
  });

  it("a lesson without a map has none of the steps; with one, only those steps are added", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        const mapSteps = seq.steps.filter((x) => x.kind === "map" || x.kind === "learned").map((x) => x.id);
        expect(mapSteps, `${s.slug} ${a.ayah}`).toEqual(s.slug === "al-fatihah" ? [...OPENING, "learned"] : []);
      }
    }
    // The same lesson with and without its map: the other steps are untouched, in the same order.
    const a = FATIHAH.ayat[1];
    const base = {
      slug: "al-fatihah",
      surahName: FATIHAH.name_id,
      ayahCount: FATIHAH.ayat.length,
      ayah: a,
      introduced: taughtAt(a),
      exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
      texts: AUTOPLAY_TEXT_SETS.id,
      narration: narrationFor("al-fatihah"),
    };
    const without = buildAutoplaySequence(base);
    const withMap = buildAutoplaySequence({ ...base, map: lessonMapInput("al-fatihah", a.ayah) });
    expect(without.steps.some((s) => s.kind === "map" || s.kind === "learned")).toBe(false);
    expect(JSON.stringify(withMap.steps.filter((s) => s.kind !== "map" && s.kind !== "learned"))).toBe(JSON.stringify(without.steps));
    // An empty map (the very first lesson with nothing in it) still says what is new, and what it
    // taught: the switch is the map. A group with nothing to say has no step.
    const empty: LessonMapInput = { surah: 1, new: [], learnt: [], later: [], lanjut: [] };
    expect(buildAutoplaySequence({ ...base, map: empty }).steps.filter((s) => s.kind === "map" || s.kind === "learned").map((s) => s.id)).toEqual(["map:new", "learned"]);
    const noLater: LessonMapInput = { ...lessonMapInput("al-fatihah", a.ayah)!, later: [], lanjut: [] };
    expect(buildAutoplaySequence({ ...base, map: noLater }).steps.filter((s) => s.kind === "map").map((s) => s.id)).toEqual(["map:new", "map:learnt"]);
  });

  it("the lesson plays its map lines one after another and moves on to the next step by itself", () => {
    const seq = stageSequence(FATIHAH, FATIHAH.ayat[1], "id");
    const send = (s: ReturnType<typeof createAutoplayState>, e: AutoplayEvent) => reduceAutoplay(seq, s, e);
    let s = send(createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== "map:new") s = send(s, { type: "next" });
    // Rendered: narrated; not rendered yet: the caption is read at reading pace. Either way one
    // activity per line, each step ends by itself, and after the last the first word's step starts.
    const seen: string[] = [];
    for (let guard = 0; guard < 60 && seq.steps[s.idx].kind === "map"; guard++) {
      const a = s.activity;
      expect(a).not.toBeNull();
      if (!a) break;
      if (seen.at(-1) !== seq.steps[s.idx].id) seen.push(seq.steps[s.idx].id);
      s = send(s, a.kind === "narrate" ? { type: "narration_end", token: a.token } : { type: "timer", token: a.token });
    }
    expect(seen).toEqual(OPENING);
    expect(seq.steps[s.idx].id).toBe("w1:recite");
    expect(s.phase).not.toBe("paused");
    // "Tunggu saya": each group waits for Lanjut, so the learner reads one card at a time.
    let w = reduceAutoplay(seq, createAutoplayState(seq, { pace: "tunggu" }), { type: "start", pace: "tunggu", reason: "fresh" });
    while (seq.steps[w.idx].id !== "map:new") w = reduceAutoplay(seq, w, { type: "next" });
    for (let guard = 0; guard < 20 && w.phase !== "ready"; guard++) {
      const a = w.activity;
      if (!a) break;
      w = reduceAutoplay(seq, w, a.kind === "narrate" ? { type: "narration_end", token: a.token } : { type: "timer", token: a.token });
    }
    expect([seq.steps[w.idx].id, w.phase]).toEqual(["map:new", "ready"]);
  });

  it("Al-Fatihah's manifest has the four lines for every ayah, and no other surah's has any", () => {
    const parts = [...OPENING, "learned"];
    for (const s of SURAHS) {
      const lines = Object.keys(narrationFor(s.slug)!.lines).filter((l) => /:(?:map:[a-z]+|learned)(?::[a-z])?$/.test(l));
      expect(lines, s.slug).toEqual(s.slug === "al-fatihah" ? s.ayat.flatMap((a) => parts.map((p) => `al-fatihah:${a.ayah}:${p}`)) : []);
    }
    // The one line of before the curriculum is no line id any more.
    expect(LINE_ID_RE.test("al-fatihah:1:map")).toBe(false);
    expect(LINE_ID_RE.test("al-fatihah:1:map:review")).toBe(false);
  });
});

describe("a lesson-map line's karaoke caption goes part by part (the card needs the room)", () => {
  // Ayah 1's line about what comes later: three postponed steps, each with its ayah, then the
  // count of the next-level topics — longer than one caption part.
  const a = FATIHAH.ayat[0];
  const LINE = "al-fatihah:1:map:later";
  const real = narrationFor("al-fatihah")!;
  const display = real.lines[LINE].display!;
  /** The line as it is after its render: one file, one token per spoken word — a dictionary term
   *  with its Arabic is ONE word of several ("jumlah ismiyyah (جُمْلَة اِسْمِيَّة),"), as the
   *  pipeline's tokens have it. Half a second a word. */
  const tokens = (() => {
    const out: string[] = [];
    for (const w of display.split(" ")) {
      // The Arabic in a term's bracket, and the words of the term before it, belong to one token.
      const inTerm = out.length > 0 && /[(؀-ۿ]/.test(out[out.length - 1]) && !out[out.length - 1].includes(")");
      const opens = w.startsWith("(");
      if (inTerm || opens) out[out.length - 1] += ` ${w}`;
      else out.push(w);
    }
    return out.map((t, i) => ({ t, s: i * 0.5, e: i * 0.5 + 0.4 }));
  })();
  const rendered: NarrationManifest = {
    ...real,
    lines: {
      ...real.lines,
      [LINE]: { ...real.lines[LINE], audio: { url: "/belajar/media/narration/kang-nandar/al-fatihah/0123456789abcdef.mp3", ms: tokens.length * 500, sha256: "c".repeat(64) }, tokens },
    },
  };
  const seq = buildAutoplaySequence({
    slug: "al-fatihah",
    surahName: FATIHAH.name_id,
    ayahCount: FATIHAH.ayat.length,
    ayah: a,
    introduced: taughtAt(a),
    exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
    texts: AUTOPLAY_TEXT_SETS.id,
    narration: rendered,
    map: lessonMapInput("al-fatihah", a.ayah),
  });
  const step = seq.steps.find((s) => s.id === "map:later")!;
  const [cue] = step.cues;
  const words = cue.audio[0].words!;
  /** The lesson on that step, its line playing. */
  const playing = () => {
    let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== "map:later") s = reduceAutoplay(seq, s, { type: "next" });
    expect(s.activity).toMatchObject({ kind: "narrate", line: LINE });
    return s;
  };

  it("the line's words fall into its caption parts: two sentences, two parts, every word once", () => {
    // What is taught later, then the count of the next-level topics: one part each.
    expect(cue.parts).toHaveLength(2);
    expect(cue.parts.every((p) => p.length <= 180)).toBe(true);
    expect(words.some(([t]) => t.split(" ").length > 1)).toBe(true); // a term of several words is one karaoke word
    const cut = karaokeParts(cue.parts, words)!;
    expect(cut).not.toBeNull();
    expect(cut.map(([from, to]) => words.slice(from, to).map(([t]) => t).join(" "))).toEqual(cue.parts);
    expect(cut[0][0]).toBe(0);
    expect(cut[1][1]).toBe(words.length);
    // One part, or words that do not line up with the parts: the whole line, as before.
    expect(karaokeParts([cue.caption], words)).toBeNull();
    expect(karaokeParts(cue.parts, words.slice(1))).toBeNull();
    expect(karaokeParts(["satu dua", "tiga"], [["satu", 0, 1], ["dua tiga", 1, 2]])).toBeNull();
  });

  it("shows the part with the word being said, the karaoke position counted inside it", () => {
    const s = playing();
    const a2 = s.activity!;
    if (a2.kind !== "narrate") throw new Error("not narrating");
    const cut = karaokeParts(cue.parts, words)!;
    const at = (now: number, said: number) => stageCaption(seq, s, null, { token: a2.token, line: LINE, file: a2.file, now, said });
    // Before any word: the first part, nothing said.
    const first = at(-1, 0);
    expect(first).toMatchObject({ kind: "karaoke", now: -1, said: 0, voiced: true });
    expect(captionText(first)).toBe(cue.parts[0]);
    // The second word of the second part: that part, its first word said, its second being said.
    const [from2] = cut[1];
    const second = at(from2 + 1, from2 + 2);
    expect(captionText(second)).toBe(cue.parts[1]);
    expect(second).toMatchObject({ kind: "karaoke", now: 1, said: 2 });
    // The last word of the first part ended and the next has not started: still the first part.
    const [, to1] = cut[0];
    const between = at(-1, to1);
    expect(captionText(between)).toBe(cue.parts[0]);
    expect(between).toMatchObject({ now: -1, said: to1 });
    // The file is through (the runner sets "all said"): the last part, every word said.
    const done = at(-1, Number.MAX_SAFE_INTEGER);
    expect(captionText(done)).toBe(cue.parts[1]);
    expect(done).toMatchObject({ now: -1, said: cut[1][1] - cut[1][0] });
    // Each part carries its own words' emphasis slots, one per word.
    for (const c of [first, second, done]) if (c.kind === "karaoke") expect(c.emph).toHaveLength(c.words.length);
  });

  it("every other line keeps its whole karaoke caption", () => {
    // A concept line of the same ayah: rendered in one file, and longer than one caption part.
    const other = seq.steps.find((x) => x.kind === "concept" && x.cues[0].parts.length > 1 && x.cues[0].audio.length === 1 && x.cues[0].audio[0].words);
    expect(other).toBeDefined();
    const line = other!.cues[0];
    let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== other!.id) s = reduceAutoplay(seq, s, { type: "next" });
    const act = s.activity!;
    if (act.kind !== "narrate") throw new Error("not narrating");
    expect(act.line).toBe(line.line);
    const c = stageCaption(seq, s, null, { token: act.token, line: line.line, file: act.file, now: 3, said: 4 });
    expect(c).toMatchObject({ kind: "karaoke", now: 3, said: 4 });
    if (c.kind === "karaoke") expect(c.words).toHaveLength(line.audio[0].words!.length);
  });
});

describe("the lesson map's card: one group at a time", () => {
  const MSG = { id, en } as const;
  type Locale = keyof typeof MSG;
  const card = (locale: Locale, map: LessonMapInput, group: LessonMapCardGroup) => {
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale,
      messages: MSG[locale],
      timeZone: "Asia/Jakarta",
      children: createElement(LessonMapCard, { map, group }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  /** The groups of a card's markup, in order: its heading, the count beside it, its items. */
  const groups = (html: string) =>
    html
      .split(/(?=<div data-map-group=")/)
      .slice(1)
      .map((part) => ({
        group: /^<div data-map-group="([a-z]+)"/.exec(part)![1],
        heading: text(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(part)![1]),
        count: /<span data-map-count="true"[^>]*>([^<]*)<\/span>/.exec(part)?.[1].trim() ?? null,
        items: [...part.matchAll(/<li data-map-item="([a-z0-9-]+)"(?: data-map-here="(true|false)")?[^>]*>([\s\S]*?)<\/li>/g)].map((li) => ({
          id: li[1],
          here: li[2] === undefined ? null : li[2] === "true",
          text: text(li[3]),
          where: /<span data-map-where[^>]*>([^<]*)<\/span>/.exec(li[3])?.[1] ?? null,
          marked: /<svg/.test(li[3]),
        })),
        subs: [...part.matchAll(/<p data-map-sub="([a-z]+)"[^>]*>([^<]*)<\/p>/g)].map((m) => [m[1], m[2]]),
        note: /<p data-map-note="true"[^>]*>([^<]*)<\/p>/.exec(part)?.[1] ?? null,
        total: /<p data-map-total="true"[^>]*>([^<]*)<\/p>/.exec(part)?.[1] ?? null,
      }));
  const fill = (m: string, v: Record<string, string | number>) => Object.entries(v).reduce((t, [k, x]) => t.replace(`{${k}}`, String(x)), m);

  it("“Baru di ayat ini”: the steps the lesson teaches, by their names — and nothing else on the card", () => {
    for (const a of FATIHAH.ayat) {
      const html = card("id", lessonMapInput("al-fatihah", a.ayah)!, "new");
      expect(html).toContain('data-autoplay="lesson-map"');
      expect(html).toContain('data-map="new"');
      const got = groups(html);
      expect(got.map((g) => g.group), `ayah ${a.ayah}`).toEqual(["new"]);
      expect(got[0].heading).toBe(id.Guided.map_new);
      expect(got[0].count).toBeNull();
      expect(got[0].items.map((i) => i.id)).toEqual(TABLE[a.ayah][0]);
      for (const it of got[0].items) expect([it.text, it.where, it.here], it.id).toEqual([FILE.steps[it.id].name, null, null]);
      // Every Arabic run is isolated, right to left (MixedText): nothing is typed here.
      for (const m of html.matchAll(/<bdi[^>]*>/g)) expect(m[0]).toMatch(/lang="ar" dir="rtl"/);
      expect(html.match(/<bdi/g)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("“Sudah kita pelajari”: the whole list so far with its count — what comes up again here first and marked, the rest muted (on a phone: one line with their count)", () => {
    for (const a of FATIHAH.ayat) {
      const map = lessonMapInput("al-fatihah", a.ayah)!;
      const html = card("id", map, "learnt");
      expect(html).toContain('data-map="learnt"');
      const [g, ...more] = groups(html);
      expect(more, `ayah ${a.ayah}`).toEqual([]);
      expect([g.group, g.heading, g.count]).toEqual(["learnt", id.Guided.map_learnt, `(${fill(id.Guided.map_count, { n: map.learnt.length })})`]);
      const here = TABLE[a.ayah][1];
      const rest = map.learnt.filter((x) => !x.here).map((x) => x.id);
      // Cumulative: every step learnt before this ayah is in the card, each once …
      expect(g.items.map((i) => i.id).sort(), `ayah ${a.ayah}`).toEqual(map.learnt.map((x) => x.id).sort());
      expect(g.items).toHaveLength(LEARNT_BEFORE[a.ayah - 1]);
      // … the ones that come up again first, under their own line, then the others under theirs.
      expect(g.items.map((i) => [i.id, i.here]), `ayah ${a.ayah}`).toEqual([...here.map((x) => [x, true]), ...rest.map((x) => [x, false])]);
      expect(g.subs, `ayah ${a.ayah}`).toEqual([
        ["here", fill(id.Guided.map_here, { n: here.length })],
        ...(rest.length ? [["rest", fill(id.Guided.map_rest, { n: rest.length })]] : []),
      ]);
      const full = here.length <= MAP_HERE_FULL;
      for (const it of g.items) {
        const name = FILE.steps[it.id].name;
        // Up to three that come up again: one per row, with their Arabic and a mark (never colour
        // alone). More, and the ones that are not in this ayah: their Latin names in a flowing line.
        if (it.here && full) expect([it.text, it.marked], it.id).toEqual([name, true]);
        else expect(it.text.replace(/,$/, ""), it.id).toBe(mapLatinName(name));
      }
      // The names that are NOT in this ayah take no box on a phone (display none below sm), where
      // the line with their count stands for them; the ones that are, are drawn on every screen.
      const flows = [...html.matchAll(/<ul data-map-flow="true" class="([^"]*)">([\s\S]*?)<\/ul>/g)].map((m) => ({ cls: m[1].split(" "), here: m[2].includes('data-map-here="true"') }));
      expect(flows.filter((f) => !f.here).map((f) => f.cls.includes("max-sm:hidden")), `ayah ${a.ayah}`).toEqual(rest.length ? [true] : []);
      expect(flows.filter((f) => f.here).map((f) => f.cls.includes("max-sm:hidden")), `ayah ${a.ayah}`).toEqual(full ? [] : [false]);
    }
    // Ayat 4, 6 and 7 repeat more than three steps (ayah 7: ten): a flowing line of their names.
    expect(FATIHAH.ayat.filter((a) => mapHere(lessonMapInput("al-fatihah", a.ayah)!).length > MAP_HERE_FULL).map((a) => a.ayah)).toEqual([4, 6, 7]);
    expect(MAP_HERE_FULL).toBe(3);
    // No learnt step comes up again: said plainly.
    const none: LessonMapInput = { surah: 1, new: [], learnt: [{ id: "naat", name: "Na’t (نَعْت)", here: false }], later: [], lanjut: [] };
    expect(card("id", none, "learnt")).toContain(id.Guided.map_here_none);
  });

  it("“Nanti” (each with its ayah) and “Tingkat lanjut” (counted, with the line that says they are not taught here; named from sm up)", () => {
    for (const a of FATIHAH.ayat) {
      const map = lessonMapInput("al-fatihah", a.ayah)!;
      const html = card("id", map, "later");
      expect(html).toContain('data-map="later"');
      const [, , later, lanjut] = TABLE[a.ayah];
      const got = groups(html);
      // A group with nothing in it is not drawn.
      expect(got.map((g) => g.group), `ayah ${a.ayah}`).toEqual([...(later.length ? ["later"] : []), "lanjut"]);
      const by = Object.fromEntries(got.map((g) => [g.group, g]));
      if (later.length) {
        expect([by.later.heading, by.later.count]).toEqual([id.Guided.map_later, null]);
        expect(by.later.items.map((i) => i.id)).toEqual(later);
        for (const it of by.later.items) {
          const at = /^(\d+):(\d+)$/.exec(FILE.steps[it.id].lesson)!;
          const where = at[1] === "1" ? `di ayat ${at[2]}` : `di QS ${at[1]}:${at[2]}`;
          // Up to two: one per row, the name with its Arabic and where it is taught. More: one
          // flowing line, each name (Latin) with its ayah.
          if (later.length <= MAP_LATER_FULL) expect([it.where, it.text], it.id).toEqual([where, `${FILE.steps[it.id].name} ${where}`]);
          else expect(it.text.replace(/,$/, ""), it.id).toBe(`${mapLatinName(FILE.steps[it.id].name)} ${where}`);
        }
      }
      // The next level: its count beside the heading (what the narrator says of it, too), the line
      // that says it is not taught here, and the names — muted, and not drawn on a phone.
      expect([by.lanjut.heading, by.lanjut.count, by.lanjut.note]).toEqual([id.Guided.map_lanjut, `(${fill(id.Guided.map_count, { n: lanjut.length })})`, id.Guided.map_lanjut_note]);
      expect(by.lanjut.items.map((i) => [i.id, i.text])).toEqual(lanjut.map((cid) => [cid, FILE.lanjut[cid].name]));
      expect(html).toMatch(/<ul data-map-names="true" class="[^"]*max-sm:hidden[^"]*">/);
      expect(html).toMatch(/<div data-map-group="lanjut"[^>]*>[\s\S]*?<h3 class="[^"]*text-ink-muted/);
    }
    // Fi'il amr, seen in ayah 6 and taught in An-Nas; ayah 1's three postponed steps in one line.
    expect(groups(card("id", lessonMapInput("al-fatihah", 6)!, "later"))[0].items[0].where).toBe("di QS 114:1");
    expect(groups(card("id", lessonMapInput("al-fatihah", 1)!, "later"))[0].items.map((i) => i.text)).toEqual(["Alif lam di ayat 3,", "Na’t di ayat 3,", "Idhafah di ayat 4"]);
    expect(MAP_LATER_FULL).toBe(2);
  });

  it("the closing: the new steps, each with a tick, and the running total", () => {
    FATIHAH.ayat.forEach((a, i) => {
      const html = card("id", lessonMapInput("al-fatihah", a.ayah)!, "learned");
      expect(html).toContain('data-map="learned"');
      const got = groups(html);
      expect(got.map((g) => g.group)).toEqual(["learned"]);
      expect(got[0].heading).toBe(id.Guided.map_learned);
      expect(got[0].items.map((x) => x.id)).toEqual(TABLE[a.ayah][0]);
      for (const it of got[0].items) expect([it.marked, it.where, it.text], it.id).toEqual([true, null, FILE.steps[it.id].name]);
      expect(got[0].total).toBe(fill(id.Guided.map_total, { n: LEARNT_BEFORE[i] + TABLE[a.ayah][0].length }));
    });
  });

  it("built for a phone's small room: at most three rows of names, nothing visually hidden, no separator that could start a line", () => {
    // Measured in CI at 390×844 (base branch, 2026-10-13): about 270px above the caption panel at
    // the normal text size; one heading with three names is about 265px.
    for (const a of FATIHAH.ayat) {
      const map = lessonMapInput("al-fatihah", a.ayah)!;
      for (const g of [...MAP_GROUPS, "learned"] as const) {
        const html = card("id", map, g);
        const where = `ayah ${a.ayah} ${g}`;
        // Rows (a name on a row of its own, with its Arabic) a phone draws: never more than three.
        const phone = html.replace(/<ul[^>]*class="[^"]*max-sm:hidden[^"]*"[^>]*>[\s\S]*?<\/ul>/g, "");
        const rowLists = [...phone.matchAll(/<ul class="[^"]*\bgrid\b[^"]*">([\s\S]*?)<\/ul>/g)];
        const rows = rowLists.reduce((n, m) => n + (m[1].match(/<li /g)?.length ?? 0), 0);
        expect(rows, where).toBeLessThanOrEqual(3);
        // What a phone does not show is display none there — never a 1px box whose text the
        // line-break check would still measure.
        expect(html, where).not.toContain("sr-only");
        // No separator: a count stands in brackets, one piece that does not wrap; a name in a
        // flowing line carries its own comma.
        expect(text(html), where).not.toMatch(/[·•—–]/);
        for (const m of html.matchAll(/<span data-map-count="true" class="([^"]*)">([^<]*)<\/span>/g)) {
          expect(m[1].split(" "), where).toContain("whitespace-nowrap");
          expect(m[2].trim(), where).toMatch(/^\(\d+ hal\)$/);
        }
        expect(html, where).not.toMatch(/class="[^"]*flex-wrap[^"]*"[^>]*>\s*<h3/);
        for (const li of html.matchAll(/<li data-map-item="[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) expect(text(li[1]), where).not.toMatch(/^[,.;:!?)\]»”]/);
      }
    }
  });

  it("the CI browser check exists, walks one step per group, and its constants are the app's", () => {
    const ci = readFileSync(join(BELAJAR, "scripts/ci/screenshots.mjs"), "utf8");
    expect(ci).toContain("async function lessonMapChecks(");
    expect(ci).toContain("await lessonMapChecks(page, vp, narration)");
    // What the card may list in full, and how a flowing line names a step: the app's own.
    expect(ci).toContain(`const MAP_HERE_FULL = ${MAP_HERE_FULL};`);
    expect(ci).toContain(`const MAP_LATER_FULL = ${MAP_LATER_FULL};`);
    expect(ci).toContain(`const MAP_ARABIC_GLOSS = ${String(MAP_ARABIC_GLOSS)};`);
    // It reaches each card by its step's name ("map:new" …, "learned"), as LessonStage names it
    // (data-step = the step's id), and reads what a card must show from the built files.
    for (const g of MAP_GROUPS) expect(stageSequence(FATIHAH, FATIHAH.ayat[0], "id").steps.map((x) => x.id)).toContain(`map:${g}`);
    expect(ci).toContain("`map:${g}`");
    expect(ci).toContain('read("content/map/al-fatihah.json")');
    expect(ci).toContain('read("messages/id.json")');
    // The step two ahead of a lesson's first (the look-ahead check) is the map's first group.
    expect(ci).toContain(`const MAP_1 = "al-fatihah:1:map:${MAP_GROUPS[0]}";`);
    // No expectation typed: no step or record id of the curriculum stands in the check.
    const body = ci.slice(ci.indexOf("async function lessonMapChecks("), ci.indexOf("async function assertNotFoundShown("));
    for (const sid of [...Object.keys(FILE.steps), ...Object.keys(FILE.lanjut)]) expect(body, sid).not.toMatch(new RegExp(`["'\`]${sid}["'\`]`));
    // The CSP refuses eval: no waitForFunction call.
    expect(body).not.toMatch(/\.waitForFunction\(/);
  });

  it("new and already-learnt are never on one card; the labels follow the locale; an ayah with nothing new says so", () => {
    const map = lessonMapInput("al-fatihah", 2)!;
    for (const g of [...MAP_GROUPS, "learned"] as const) {
      const html = card("id", map, g);
      const names = (ids: string[]) => ids.filter((sid) => html.includes(`data-map-item="${sid}"`));
      const learnt = map.learnt.map((x) => x.id);
      // The new steps are on the "new" card and the closing; the learnt ones on "learnt" alone.
      expect(names(map.new.map((x) => x.id)).length > 0, g).toBe(g === "new" || g === "learned");
      expect(names(learnt).length > 0, g).toBe(g === "learnt");
    }
    const english = [card("en", map, "new"), card("en", map, "learnt"), card("en", map, "later"), card("en", map, "learned")].join("\n");
    for (const label of [en.Guided.map_new, en.Guided.map_learnt, en.Guided.map_later, en.Guided.map_lanjut, en.Guided.map_lanjut_note, en.Guided.map_learned, "in ayah 3", "in QS 114:2"]) {
      expect(english).toContain(label);
    }
    const nothing: LessonMapInput = { ...map, new: [] };
    expect(card("id", nothing, "new")).toContain(id.Guided.map_none);
    expect(card("id", nothing, "learned")).toContain(id.Guided.map_none);
    // Both message files carry every label the card uses, and none of the card of before.
    for (const k of Object.keys(id.Guided).filter((x) => x.startsWith("map_"))) expect(en.Guided, k).toHaveProperty(k);
    for (const k of Object.keys(en.Guided).filter((x) => x.startsWith("map_"))) expect(id.Guided, k).toHaveProperty(k);
    expect(id.Guided).not.toHaveProperty("map_review");
  });
});

describe("the word card marks a concept an earlier lesson taught (text only)", () => {
  const wordCard = (taught: string | null) => {
    const w = FATIHAH.ayat[3].words[0]; // 1:4:1, a na't: taught in ayah 3
    const labels = { ...id.Word, sharaf: { heading: id.Word.sharaf_heading, forms_note: id.Word.sharaf_forms_note, ilal: id.Word.ilal, ilal_from: id.Word.ilal_from, ilal_to: id.Word.ilal_to } };
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale: "id",
      messages: id,
      timeZone: "Asia/Jakarta",
      children: createElement(WordCard, { word: w, labels, concepts: [{ id: "naat", title: "Na't (sifat yang mengikuti)", head: null, taught }] }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };

  it("under its chip: “sudah dipelajari di ayat 3”; nothing for a concept that is new or taught later", () => {
    const marked = wordCard(id.Word.concept_taught.replace("{n}", "3"));
    expect(marked).toMatch(/<\/a><p data-concept-taught="naat"[^>]*>sudah dipelajari di ayat 3<\/p>/);
    expect(wordCard(null)).not.toContain("data-concept-taught");
    expect(en.Word.concept_taught).toContain("{n}");
    // Which chips get the mark is the curriculum's (curriculum.test.ts taughtBefore): every learnt
    // step of an ayah that comes up again and is a whole record has a tagged word to sit under.
    for (const a of FATIHAH.ayat) {
      const tagged = new Set(a.words.flatMap((w) => w.concepts));
      for (const it of mapHere(lessonMapInput("al-fatihah", a.ayah)!)) {
        const step = CURRICULUM.steps.find((s) => s.id === it.id)!;
        if (step.concept && step.part === undefined && !step.occurs) expect(tagged.has(step.concept) || (a.structure?.groups ?? []).some((g) => g.concept === step.concept), `${a.loc} ${it.id}`).toBe(true);
      }
    }
  });
});
