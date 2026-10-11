import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stageFrame, stageMarks } from "@/components/autoplay/caption";
import type { ComposeFile } from "@/content/compose-schema";
import type { Ayah } from "@/content/schema";

import {
  buildAutoplaySequence,
  createAutoplayState,
  ID_TEXTS,
  parseLineId,
  reduceAutoplay,
  type Activity,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type NarrationManifest,
} from "./autoplay";
import { composeFor, composeInput, COMPOSED_SLUGS } from "./compose-content";
import { applyOp, composeFileProblems, composeInputFor, diffPieces, pieces } from "./composition";
import { SURAHS } from "./content";

// Word composition and the harakat primer (operator 2026-10-10, narration
// rule 14): every Arabic string the animation shows is replayed from the
// lesson words' bytes and the declared edits (CI cannot read the Tanzil
// cache; validate_compose.py checks the attested forms against it locally).

const CONTENT = fileURLToPath(new URL("../../content/", import.meta.url));
const raw = JSON.parse(readFileSync(`${CONTENT}compose/al-fatihah.json`, "utf8")) as ComposeFile;
const manifest = JSON.parse(readFileSync(`${CONTENT}narration/al-fatihah.json`, "utf8")) as NarrationManifest;
const WORDS = new Map(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w.ar] as const))));
const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;
const ayah1 = fatihah.ayat[0];
const copy = () => JSON.parse(JSON.stringify(raw)) as ComposeFile;

describe("composition pieces and edits (the pipeline's cut, never the browser's)", () => {
  it("cuts a word into whole clusters: a letter and the marks after it", () => {
    // Written as code points, never retyped Arabic (the order of a shaddah and its vowel matters).
    expect(pieces(ayah1.words[2].ar)).toEqual(["\u0671", "\u0644", "\u0631\u0651\u064E", "\u062D\u0652", "\u0645\u064E\u0670", "\u0646\u0650"]);
    expect(pieces(ayah1.words[0].ar).join("")).toBe(ayah1.words[0].ar);
  });

  it("replays bi + ismu → bismi byte for byte", () => {
    const bi = pieces(WORDS.get("1:1:1")!)[0];
    const ismu = raw.words["1:1:1"].forms.ismu.ar; // Tanzil 55:78:2 (checked locally)
    const ismi = applyOp(ismu, { mark: -1, to: "kasrah" });
    expect(diffPieces(ismu, ismi)).toEqual([{ from: "\u0645\u064F", to: "\u0645\u0650", marks: ["dhammah", "kasrah"] }]);
    expect(applyOp(bi + ismi, { drop: 1 })).toBe(WORDS.get("1:1:1"));
  });

  it("refuses an edit that does not fit (two vowels, a missing mark, an empty word)", () => {
    const bi = pieces(WORDS.get("1:1:1")!)[0];
    expect(() => applyOp(bi, { remove: "shaddah", piece: 0 })).toThrow();
    expect(() => applyOp(bi, { mark: 0, to: "kasrah" })).toThrow();
    expect(() => applyOp(bi, { drop: 0 })).toThrow();
  });
});

describe("content/compose/al-fatihah.json", () => {
  it("loads at build time (zod + replay) and replays without a problem", () => {
    expect(COMPOSED_SLUGS).toEqual(["al-fatihah"]);
    expect(composeFor("al-fatihah")).not.toBeNull();
    expect(composeFileProblems(raw, WORDS)).toEqual([]);
  });

  it("cuts the alif maqsura written as ya' before a pronoun (1:7:4 join), and the fathah → sukun of an‘amta", () => {
    expect(raw.words["1:7:4"].frames[1].chips).toEqual([{ from: "\u0649", to: "\u064A\u0652", marks: [null, "sukun"] }]);
    expect(raw.words["1:7:3"].frames[2].chips).toEqual([{ from: "\u0645\u064E", to: "\u0645\u0652", marks: ["fathah", "sukun"] }]);
    expect(() => diffPieces("\u0649", "\u0648\u0652")).toThrow(/a letter changed/);
  });

  it("explains all four words of ayah 1 and opens it with the harakat primer", () => {
    expect(Object.keys(raw.words).filter((l) => l.startsWith("1:1:"))).toEqual(["1:1:1", "1:1:2", "1:1:3", "1:1:4"]);
    expect(raw.primer?.ayah).toBe(1);
    expect(raw.primer?.frames[0].marks).toEqual(["fathah", "kasrah", "dhammah"]);
    // bismi: parts → bentuk dasar → kasrah → joined → the alif drops (rule 14's storyboard)
    expect(raw.words["1:1:1"].frames.map((f) => f.stage)).toEqual(["parts", "base", "change", "join", "drop"]);
    // every harakah named on screen carries its sound
    expect([raw.marks.fathah.sound, raw.marks.kasrah.sound, raw.marks.dhammah.sound]).toEqual(["a", "i", "u"]);
  });

  const faults: [string, (f: ComposeFile) => void, RegExp][] = [
    ["a form whose bytes are not its source's", (f) => (f.words["1:1:1"].forms.ismi.ar = f.words["1:1:1"].forms.ismu.ar), /its source gives/],
    ["a word slice off the word", (f) => (f.words["1:1:1"].forms.bi.src = { word: "1:1:1", pieces: [1, 2] }), /its source gives/],
    ["the last frame is not the word", (f) => (f.words["1:1:1"].frames[4].tiles = ["bi+ismi"]), /the last frame shows/],
    ["a chip not cut from the forms", (f) => (f.words["1:1:1"].frames[2].chips = [{ from: "\u0645\u064F", to: "\u0645\u064E", marks: ["dhammah", "fathah"] }]), /chips differ/],
    ["a frame no line is said over", (f) => (f.words["1:1:2"].lines = f.words["1:1:2"].lines.filter((l) => l.frame !== 2)), /no line is said while it shows/],
    ["a primer mark without an example carrying it", (f) => (f.primer!.frames[1].tiles = ["ba-i"]), /no example carries the fathah/],
    ["an unknown form", (f) => (f.words["1:1:3"].frames[0].tiles = ["al", "nope"]), /not a form/],
    // A join may write one letter in its other shape (عَلَى + هُمْ → عَلَيْهُمْ: alif maqsura → ya'),
    // never another letter.
    ["a join that changes a letter", (f) => (f.words["1:7:4"].forms.alaihum.ar = f.words["1:7:4"].forms.alaihum.ar.replace("\u064A", "\u0648")), /source gives|a letter changed/],
  ];
  it.each(faults)("catches %s", (_name, mutate, expected) => {
    const f = copy();
    mutate(f);
    expect(composeFileProblems(f, WORDS).join("\n")).toMatch(expected);
  });
});

/** Ayah 1 as the page builds it (caption-only unless a manifest is given). */
function seq1(narration: NarrationManifest | null = null): AutoplaySequence {
  return buildAutoplaySequence({
    slug: "al-fatihah",
    surahName: "Al-Fatihah",
    ayahCount: 7,
    ayah: ayah1 as Ayah,
    introduced: [],
    exercises: [],
    texts: ID_TEXTS,
    narration,
    compose: composeInput("al-fatihah", ayah1),
  });
}

const end = (a: Activity): AutoplayEvent =>
  a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };

describe("the autoplay sequence with compositions", () => {
  it("plays the primer after the imam's ayah, then per word: recite, explain, compose", () => {
    const seq = seq1(manifest);
    expect(seq.steps.slice(0, 15).map((s) => s.id)).toEqual([
      "intro",
      "recite",
      "primer",
      "w1:recite",
      "w1",
      "w1:compose",
      "w2:recite",
      "w2",
      "w2:compose",
      "w3:recite",
      "w3",
      "w3:compose",
      "w4:recite",
      "w4",
      "w4:compose",
    ]);
    const c = seq.steps.find((s) => s.id === "w1:compose")!;
    expect(c.kind).toBe("compose");
    expect(c.recite).toEqual({ target: "word", word: 1 });
    expect(c.frames).toBe(5);
    expect(c.cues.map((q) => q.frame)).toEqual(raw.words["1:1:1"].lines.map((l) => l.frame));
    expect(c.cues.every((q) => q.highlight.join() === "1" && q.focus === 1)).toBe(true);
    // the word line: the gloss and the lead (the frames say the why)
    expect(seq.steps.find((s) => s.id === "w1")!.cues[0].caption).toBe("Kata pertama artinya: “dengan nama”. Kata ini terdiri dari dua bagian.");
    // no other cue names a frame
    expect(seq.steps.filter((s) => s.kind !== "compose" && s.kind !== "primer").every((s) => s.cues.every((q) => q.frame === null))).toBe(true);
    // ayah 2 has no composition yet: unchanged
    expect(composeInputFor(raw, fatihah.ayat[1])?.primer ?? null).toBeNull();
  });

  it("caption-only (an English page): the frames follow the content's own line plan", () => {
    const seq = seq1(null);
    const p = seq.steps.find((s) => s.id === "primer")!;
    expect(p.cues.map((q) => q.frame)).toEqual(raw.primer!.lines.map((l) => l.frame));
    expect(p.cues.map((q) => parseLineId(q.line)?.kind)).toEqual(p.cues.map(() => "ayah"));
  });

  it("the stage shows each line's frame, then the last frame while the imam recites the joined word", () => {
    const seq = seq1(manifest);
    const idx = seq.steps.findIndex((s) => s.id === "w1:compose");
    let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx }), { type: "start", from: idx, reason: "continue" });
    const seen: string[] = [];
    for (let i = 0; i < 400 && s.idx === idx; i++) {
      const f = stageFrame(seq, s);
      const m = stageMarks(seq, s);
      if (f) seen.push(`${f.frame}${f.recited ? "r" : ""}`);
      if (f) expect(m).toEqual({ marked: [1], focus: 1 });
      if (!s.activity) break;
      s = reduceAutoplay(seq, s, end(s.activity));
    }
    const order = [...new Set(seen)];
    expect(order).toEqual(["1", "2", "3", "4", "5", "5r"]);
  });

  it("no frame outside a primer / compose step, nor before the start", () => {
    const seq = seq1(manifest);
    expect(stageFrame(seq, createAutoplayState(seq))).toBeNull();
    const w1 = seq.steps.findIndex((s) => s.id === "w1");
    const s = reduceAutoplay(seq, createAutoplayState(seq, { idx: w1 }), { type: "start", from: w1, reason: "continue" });
    expect(stageFrame(seq, s)).toBeNull();
    // A compose step entered while paused (browsing with ‹ / ›) shows its first frame.
    const c = seq.steps.findIndex((x) => x.id === "w3:compose");
    let p = reduceAutoplay(seq, createAutoplayState(seq, { idx: c - 1 }), { type: "start", from: c - 1, reason: "continue" });
    p = reduceAutoplay(seq, p, { type: "pause" });
    p = reduceAutoplay(seq, p, { type: "next" });
    expect(p.idx).toBe(c);
    expect(stageFrame(seq, p)).toEqual({ step: "compose", word: 3, frame: 1, recited: false });
  });

  it("the primer shows its frames in order and highlights the words its letters come from", () => {
    const seq = seq1(manifest);
    const idx = seq.steps.findIndex((s) => s.id === "primer");
    let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx }), { type: "start", from: idx, reason: "continue" });
    const frames: number[] = [];
    for (let i = 0; i < 200 && s.idx === idx && s.activity; i++) {
      const f = stageFrame(seq, s);
      if (f && frames.at(-1) !== f.frame) frames.push(f.frame);
      s = reduceAutoplay(seq, s, end(s.activity));
    }
    // fathah, kasrah, dhammah, sukun + shaddah, then the small upright alif (review 2026-10-10)
    expect(frames).toEqual([1, 2, 3, 4, 5, 6]);
    const kasrah = seq.steps[idx].cues.find((q) => q.frame === 3)!;
    expect(kasrah.highlight).toEqual([1]); // بِ of word 1, as the ayah writes it
    const smallAlif = seq.steps[idx].cues.find((q) => q.frame === 6)!;
    expect(smallAlif.highlight).toEqual([3]); // مَٰ of word 3
    expect(raw.primer!.frames[5].marks).toEqual(["small_alif"]);
  });
});
