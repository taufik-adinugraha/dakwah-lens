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
  viewAutoplay,
  type Activity,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type NarrationManifest,
} from "./autoplay";
import { composeFor, composeInput, COMPOSED_SLUGS } from "./compose-content";
import { applyOp, composeFileProblems, composeInputFor, diffPieces, pieces, STOP_NOTE } from "./composition";
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
    // The stop note makes the lesson recite the word once more (plan L24): only where the imam stops.
    ["the stop note on a word that does not end its ayah", (f) => (f.words["1:1:1"].frames[4].note = STOP_NOTE), /1:1:1: frame 5 carries the stop note/],
    ["the stop note on a frame that is not the last", (f) => (f.words["1:1:4"].frames[0].note = STOP_NOTE), /1:1:4: frame 1 carries the stop note/],
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
    // No recitation of its own (operator 2026-10-13, plan L24: "when transation from word X to
    // X+1, i think we dont need to recite the X, just directly to X+1"; until then the step ended
    // with the imam reciting word 1 again): the word is recited by its opening step alone, and
    // the step's own caption is its first line's, no longer "Kata ke-1: bismi. Dengarkan imam …".
    // Only the ayah's LAST word is recited once more, by its composition (its last frame is the
    // stop frame, "imam berhenti di sini": no next word follows it).
    expect(c.recite).toBeUndefined();
    expect(seq.steps.filter((s) => s.recite?.target === "word").map((s) => s.id)).toEqual(["w1:recite", "w2:recite", "w3:recite", "w4:recite", "w4:compose"]);
    expect(seq.steps.find((s) => s.id === "w4:compose")?.recite).toEqual({ target: "word", word: 4 });
    expect(Object.entries(composeInput("al-fatihah", ayah1)?.words ?? {}).map(([loc, u]) => [loc, u.stop ?? false])).toEqual([["1:1:1", false], ["1:1:2", false], ["1:1:3", false], ["1:1:4", true]]);
    expect(raw.words["1:1:4"].frames.at(-1)?.note).toBe(STOP_NOTE);
    expect(c.caption).toBe(c.cues[0].caption);
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

  // Until 2026-10-13 the step went on, after its lines, to the imam reciting the joined word over
  // the last frame (a "recited" look: the tile filled). Plan L24 took that recitation away: the
  // last line is said over the last frame, the joined word, and the next thing heard is the imam
  // saying the NEXT word.
  it("the stage shows each line's frame; the last line is said over the joined word, and the imam does not recite it again", () => {
    for (const pace of ["biasa", "pelan", "tunggu"] as const) {
      const seq = seq1(manifest);
      const idx = seq.steps.findIndex((s) => s.id === "w1:compose");
      const step = seq.steps[idx];
      let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx, pace }), { type: "start", pace, from: idx, reason: "continue" });
      const seen: number[] = [];
      const played: string[] = [];
      let lastLineFrame: number | null = null;
      for (let i = 0; i < 400 && s.idx === idx; i++) {
        const f = stageFrame(seq, s);
        const m = stageMarks(seq, s);
        if (f) seen.push(f.frame);
        if (f) expect(m, pace).toEqual({ marked: [1], focus: 1 });
        const a = s.activity;
        if (a) played.push(a.kind);
        if (a?.kind === "narrate" && a.line === step.lines[step.lines.length - 1]) lastLineFrame = f?.frame ?? null;
        if (a) s = reduceAutoplay(seq, s, end(a));
        else if (s.phase === "ready") {
          // "Tunggu saya", the step's lines through: the joined word stays until Lanjut — not
          // marked "recited": the imam does not say word 1 here.
          expect([f?.frame, f?.recited, pace], "the end of the step").toEqual([5, false, "tunggu"]);
          s = reduceAutoplay(seq, s, { type: "next" });
        } else break;
      }
      expect([...new Set(seen)], pace).toEqual([1, 2, 3, 4, 5]);
      expect(lastLineFrame, pace).toBe(5);
      // Nothing but the narrator and his pauses: no recitation inside the step (this sequence
      // has no example beats; with them, the bentuk dasar's clip is the only one — examples.test.ts).
      expect([...new Set(played)].sort(), pace).toEqual(["narrate", "wait"]);
      // … and straight on to word 2, said by the imam.
      expect([seq.steps[s.idx].id, s.activity?.kind === "recite" && s.activity.target === "word" ? s.activity.word : null], pace).toEqual(["w2:recite", 2]);
    }
  });

  // The exception: ar-raḥīmi ends the ayah. The last line of its composition says the imam stops
  // on it, so its kasrah is not heard — and he then recites it, once more, to be heard doing so.
  it("the ayah's last word: after the line that says the imam stops on it, he recites it — the joined word 'recited', that line still the caption, no reading time", () => {
    for (const narrated of [true, false]) {
      for (const pace of ["biasa", "pelan", "tunggu"] as const) {
        const where = `${narrated ? "narrated" : "caption-only"} ${pace}`;
        const seq = seq1(narrated ? manifest : null);
        const idx = seq.steps.findIndex((s) => s.id === "w4:compose");
        const step = seq.steps[idx];
        const lastLine = step.lines[step.lines.length - 1];
        let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx, pace }), { type: "start", pace, from: idx, reason: "continue" });
        const frames: string[] = [];
        const imam: AutoplayState[] = [];
        let lanjut = 0;
        for (let i = 0; i < 400 && s.idx === idx; i++) {
          const f = stageFrame(seq, s);
          if (f) frames.push(`${f.frame}${f.recited ? "r" : ""}`);
          const a = s.activity;
          if (a?.kind === "recite") imam.push(s);
          if (a) s = reduceAutoplay(seq, s, end(a));
          else if (s.phase === "ready") {
            lanjut++;
            s = reduceAutoplay(seq, s, { type: "next" });
          } else break;
        }
        expect([...new Set(frames)], where).toEqual(["1", "2", "3", "3r"]);
        // His word as long as it lasts — twice in Pelan — in every kind of lesson: no hold.
        for (const x of imam) expect(x.activity, where).toMatchObject({ kind: "recite", target: "word", word: 4, minMs: 0 });
        expect(imam.length, where).toBe(pace === "pelan" ? 2 : 1);
        for (const x of imam) {
          expect(viewAutoplay(seq, x).caption.line, where).toBe(lastLine);
          expect(stageMarks(seq, x), where).toEqual({ marked: [4], focus: 4 });
        }
        // "Tunggu saya": Lanjut at the end of the step (and, caption-only, after each line), as ever.
        expect(lanjut, where).toBe(pace !== "tunggu" ? 0 : narrated ? 1 : step.cues.reduce((n, c) => n + c.parts.length, 0) + 1);
        // Then the lesson goes on: no word follows the ayah's last.
        expect(seq.steps[s.idx].id, where).toBe(seq.steps[idx + 1].id);
        expect(s.activity?.kind === "recite", where).toBe(false);
      }
    }
    // The rule is not the word's position alone: without the stop note on its last frame (a last
    // word whose last line is about something else), the composition ends with its line.
    const unmarked = copy();
    delete unmarked.words["1:1:4"].frames[unmarked.words["1:1:4"].frames.length - 1].note;
    const input = composeInputFor(unmarked, ayah1);
    expect(input?.words["1:1:4"].stop).toBeUndefined();
    const plainEnd = buildAutoplaySequence({ slug: "al-fatihah", surahName: "Al-Fatihah", ayahCount: 7, ayah: ayah1 as Ayah, introduced: [], exercises: [], texts: ID_TEXTS, narration: manifest, compose: input });
    expect(plainEnd.steps.filter((x) => x.recite?.target === "word").map((x) => x.id)).toEqual(["w1:recite", "w2:recite", "w3:recite", "w4:recite"]);
    // … nor the note alone: a last frame the last line is not said over is no stop.
    const unsaid = copy();
    unsaid.words["1:1:4"].lines = unsaid.words["1:1:4"].lines.map((x) => ({ ...x, frame: Math.min(x.frame, unsaid.words["1:1:4"].frames.length - 1) }));
    expect(composeInputFor(unsaid, ayah1)?.words["1:1:4"].stop).toBeUndefined();
    // … nor on a word that does not end its ayah (the build refuses the note there; the lesson
    // would not act on it either).
    const misplaced = copy();
    misplaced.words["1:1:1"].frames[misplaced.words["1:1:1"].frames.length - 1].note = STOP_NOTE;
    expect(Object.entries(composeInputFor(misplaced, ayah1)?.words ?? {}).filter(([, u]) => u.stop).map(([loc]) => loc)).toEqual(["1:1:4"]);
    // Paused while he recites and resumed: "Kita lanjutkan." over the joined word, then he again.
    const seq = seq1(manifest);
    const idx = seq.steps.findIndex((x) => x.id === "w4:compose");
    let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx }), { type: "start", from: idx, reason: "continue" });
    for (let i = 0; i < 100 && s.activity?.kind !== "recite"; i++) s = reduceAutoplay(seq, s, end(s.activity!));
    const resumed = reduceAutoplay(seq, reduceAutoplay(seq, s, { type: "pause" }), { type: "resume" });
    expect([resumed.caption, stageFrame(seq, resumed)]).toEqual([{ s: "resume" }, { step: "compose", word: 4, frame: 3, recited: false }]);
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
