import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stageFrame, stageMarks } from "@/components/autoplay/caption";
import type { ComposeFile } from "@/content/compose-schema";
import type { Ayah } from "@/content/schema";

import {
  buildAutoplaySequence,
  createAutoplayState,
  hostsZero,
  ID_TEXTS,
  parseLineId,
  primerAyah,
  reduceAutoplay,
  viewAutoplay,
  zeroAyah,
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
const shipped = JSON.parse(readFileSync(`${CONTENT}narration/al-fatihah.json`, "utf8")) as NarrationManifest;
/** The shipped manifest with a recording on every line (a stand-in, `ms` by the text's length): the
 *  narrated composition steps as they play once rendered — 2026-10-17's reworded lines of word 1
 *  wait for their render, and a line without one is caption-only by design. */
const manifest: NarrationManifest = {
  ...shipped,
  lines: Object.fromEntries(
    Object.entries(shipped.lines).map(([id, l]) => [id, l.audio ? l : { ...l, audio: { url: `/belajar/media/narration/test/${id.replace(/[^A-Za-z0-9_-]/g, "-")}.mp3`, ms: 60 * l.text.length, sha256: "0".repeat(64) } }]),
  ),
};
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

describe("content/compose/al-ikhlas.json (2026-10-19)", () => {
  const ikhlas = JSON.parse(readFileSync(`${CONTENT}compose/al-ikhlas.json`, "utf8")) as ComposeFile;
  it("loads at build time and replays without a problem: every word of the surah composed, no primer of its own", () => {
    expect(composeFor("al-ikhlas")).not.toBeNull();
    expect(composeFileProblems(ikhlas, WORDS)).toEqual([]);
    const words = SURAHS.find((s) => s.slug === "al-ikhlas")!.ayat.flatMap((a) => a.words.map((w) => w.loc));
    expect(Object.keys(ikhlas.words)).toEqual(words);
    expect(ikhlas.primer).toBeNull();
  });

  it("the jazm: a vowel becomes the sukun (yalid, yūlad, yakun), and the wawu of yakūnu is seen dropped", () => {
    const changes = (loc: string) => ikhlas.words[loc].frames.filter((f) => f.stage === "change").map((f) => f.chips);
    for (const loc of ["112:3:2", "112:3:4"]) expect(changes(loc), loc).toEqual([[{ from: "\u062F\u064F", to: "\u062F\u0652", marks: ["dhammah", "sukun"] }]]);
    expect(changes("112:4:2")).toEqual([[{ from: "\u0646\u064F", to: "\u0646\u0652", marks: ["dhammah", "sukun"] }]]);
    const drop = ikhlas.words["112:4:2"].frames.find((f) => f.stage === "drop")!;
    expect(drop.chips).toEqual([{ from: "\u0648", to: "" }]);
    // a change into a letter's absence is not a change of a vowel: still refused
    const broken = structuredClone(ikhlas);
    broken.words["112:3:2"].frames[1].chips = [{ from: "\u062F\u064F", to: "\u062F", marks: ["dhammah", null] }];
    expect(composeFileProblems(broken, WORDS).join("\n")).toContain("112:3:2");
    // each ayah's last word ends on the stop frame
    for (const loc of ["112:1:4", "112:2:2", "112:3:4", "112:4:5"]) {
      const fr = ikhlas.words[loc].frames;
      expect(fr[fr.length - 1].note, loc).toBe(STOP_NOTE);
    }
  });
});

describe("content/compose/al-falaq.json (2026-10-20)", () => {
  const falaq = JSON.parse(readFileSync(`${CONTENT}compose/al-falaq.json`, "utf8")) as ComposeFile;
  const words = SURAHS.find((s) => s.slug === "al-falaq")!.ayat.flatMap((a) => a.words.map((w) => w.loc));
  it("loads at build time and replays without a problem: every word of the surah composed, no primer of its own", () => {
    expect(composeFor("al-falaq")).not.toBeNull();
    expect(composeFileProblems(falaq, WORDS)).toEqual([]);
    expect(Object.keys(falaq.words)).toEqual(words);
    expect(words).toHaveLength(23);
    expect(falaq.primer).toBeNull();
  });

  it("each ayah's last word ends on the stop frame, and nothing else carries that note", () => {
    const last = ["113:1:4", "113:2:4", "113:3:5", "113:4:5", "113:5:5"];
    for (const loc of last) {
      const fr = falaq.words[loc].frames;
      expect(fr[fr.length - 1].note, loc).toBe(STOP_NOTE);
    }
    const noted = Object.entries(falaq.words).flatMap(([loc, u]) => u.frames.flatMap((f) => (f.note === STOP_NOTE ? [loc] : [])));
    expect(noted).toEqual(last);
  });

  it("a noun with tanwin goes from its bentuk dasar (dhammatain) to kasratain, one mark changed: gāsiqin and ḥāsidin", () => {
    // Written as code points, never retyped Arabic: qaf and dal with their tanwin.
    for (const [loc, letter] of [["113:3:3", "\u0642"], ["113:5:3", "\u062F"]] as const) {
      const frames = falaq.words[loc].frames;
      expect(frames.filter((f) => f.stage === "change").map((f) => f.chips), loc).toEqual([[{ from: `${letter}\u064C`, to: `${letter}\u064D`, marks: ["dhammatain", "kasratain"] }]]);
      expect(frames.some((f) => f.stage === "base"), loc).toBe(true);
    }
  });

  it("a noun with the article is joined (the lam read, or melting into the sun letter nun), then its ending changes: al-falaqi, an-naffāṡāti, al-‘uqadi", () => {
    const stages = (loc: string) => falaq.words[loc].frames.map((f) => f.stage);
    expect(stages("113:1:4")).toEqual(["parts", "join", "change", "whole"]);
    expect(stages("113:4:3")).toEqual(["join", "change", "whole"]);
    expect(stages("113:4:5")).toEqual(["parts", "join", "change", "whole"]);
    // wa + min: two parts, joined, the dependency on an earlier ayah said over the last frame
    for (const loc of ["113:3:1", "113:4:1", "113:5:1"]) {
      expect(stages(loc), loc).toEqual(["parts", "join", "whole"]);
      expect(falaq.words[loc].frames[0].tiles, loc).toHaveLength(2);
    }
    // a heavy-letter part is named in the caption only; a simple one is said (an-naffāṡāt)
    expect(falaq.words["113:1:4"].lines.some((l) => l.say.includes("{{!113:1:4/falaq}}"))).toBe(true);
    expect(falaq.words["113:4:5"].lines.some((l) => l.say.includes("{{!113:4:5/uqad}}"))).toBe(true);
    expect(falaq.words["113:4:3"].lines.some((l) => l.say.includes("{{113:4:3/naffas}}"))).toBe(true);
  });
});

describe("content/compose/an-nas.json (2026-10-20)", () => {
  const nas = JSON.parse(readFileSync(`${CONTENT}compose/an-nas.json`, "utf8")) as ComposeFile;
  const words = SURAHS.find((s) => s.slug === "an-nas")!.ayat.flatMap((a) => a.words.map((w) => w.loc));
  it("loads at build time and replays without a problem: every word of the surah composed, no primer of its own", () => {
    expect(composeFor("an-nas")).not.toBeNull();
    expect(composeFileProblems(nas, WORDS)).toEqual([]);
    expect(Object.keys(nas.words)).toEqual(words);
    expect(words).toHaveLength(20);
    expect(nas.primer).toBeNull();
  });

  it("each ayah's last word ends on the stop frame, and nothing else carries that note", () => {
    const last = ["114:1:4", "114:2:2", "114:3:2", "114:4:4", "114:5:5", "114:6:3"];
    for (const loc of last) {
      const fr = nas.words[loc].frames;
      expect(fr[fr.length - 1].note, loc).toBe(STOP_NOTE);
    }
    const noted = Object.entries(nas.words).flatMap(([loc, u]) => u.frames.flatMap((f) => (f.note === STOP_NOTE ? [loc] : [])));
    expect(noted).toEqual(last);
  });

  it("a noun with the article is joined (the lam melts into a sun letter, or is read), then its ending changes: an-nāsi, al-waswāsi, al-khannāsi, al-jinnati, wa an-nāsi", () => {
    const stages = (loc: string) => nas.words[loc].frames.map((f) => f.stage);
    for (const loc of ["114:1:4", "114:2:2", "114:3:2", "114:5:5"]) expect(stages(loc), loc).toEqual(["join", "change", "whole"]);
    expect(stages("114:4:3")).toEqual(["parts", "join", "change"]);
    expect(stages("114:4:4")).toEqual(["parts", "join", "change", "whole"]);
    expect(stages("114:6:2")).toEqual(["parts", "join", "change"]);
    // wa + alif lam + nās: three parts, the alif of the article silent after the wawu
    expect(stages("114:6:3")).toEqual(["parts", "join", "change", "whole"]);
    expect(nas.words["114:6:3"].frames[0].tiles).toHaveLength(3);
    // a heavy-letter word's part is named in the caption only: its recording is the narrator's, not a line's word
    expect(nas.words["114:4:4"].lines.some((l) => l.say.includes("{{!114:4:4/khannas}}"))).toBe(true);
  });
});

describe("content/compose/al-fatihah.json", () => {
  it("loads at build time (zod + replay) and replays without a problem", () => {
    // Al-Fatihah, Al-Ikhlas since 2026-10-19, Al-Falaq and An-Nas since 2026-10-20 (every surah of the module): a surah
    // without a file keeps its words' one-line explanation.
    expect(COMPOSED_SLUGS).toEqual(["al-fatihah", "al-ikhlas", "al-falaq", "an-nas"]);
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
    // frames[2] is the fathah's mark frame since 2026-10-15: frames[1] shows the bare ba first
    ["a primer mark without an example carrying it", (f) => (f.primer!.frames[2].tiles = ["ba-i"]), /no example carries the fathah/],
    ["a bare primer letter that carries its mark", (f) => (f.primer!.frames[1].tiles = ["ba-a"]), /a bare letter already carries its mark/],
    ["a bare primer frame not followed by its mark", (f) => (f.primer!.frames[1].marks = ["kasrah"]), /followed by the mark frame of the same marks/],
    ["a mark frame after a bare one that shows another letter", (f) => (f.primer!.frames[7].tiles = ["ba"]), /not its bare letters with the mark put on/],
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

/** Lesson zero as its page builds it (the harakat primer is played there since 2026-10-13: the
 *  basic curriculum, decision 1; autoplay/zero.ts). */
function seq0(narration: NarrationManifest | null = null): AutoplaySequence {
  const zero = zeroAyah(fatihah.surah);
  return buildAutoplaySequence({
    slug: "al-fatihah",
    surahName: "Al-Fatihah",
    ayahCount: 7,
    ayah: zero,
    zero: true,
    introduced: [],
    exercises: [],
    texts: ID_TEXTS,
    narration,
    compose: composeInput("al-fatihah", zero),
  });
}

const end = (a: Activity): AutoplayEvent =>
  a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };

describe("the autoplay sequence with compositions", () => {
  it("after the imam's ayah, per word: recite, explain, compose — the primer is lesson zero's", () => {
    const seq = seq1(manifest);
    // The harakat primer stood right after the imam's ayah until 2026-10-13; lesson zero plays
    // it now, right after its own opening line, and no ayah's lesson does.
    expect(seq.steps.some((s) => s.kind === "primer")).toBe(false);
    expect(composeInput("al-fatihah", ayah1)?.primer ?? null).toBeNull();
    expect(raw.primer).toMatchObject({ ayah: 1, lesson: "0" });
    expect([primerAyah(raw.primer!), hostsZero(raw)]).toEqual([0, true]);
    expect(seq0(manifest).steps.map((s) => s.id)).toEqual(["intro", "primer", "next"]);
    expect(seq0(manifest).nav).toEqual({ kind: "ayah", slug: "al-fatihah", ayah: 1 });
    expect(seq0(manifest).lessonKey).toBe("al-fatihah/0");
    // A primer without the marker opens its own ayah's lesson, as it did.
    const own = { ...raw, primer: { ...raw.primer!, lesson: undefined } };
    expect(composeInputFor(own, ayah1)?.primer?.frames).toBe(raw.primer!.frames.length);
    expect(composeInputFor(own, zeroAyah(1))).toBeNull();
    expect(seq.steps.slice(0, 14).map((s) => s.id)).toEqual([
      "intro",
      "recite",
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
    // (since 2026-10-17 with the word itself, rule 26: until then "Kata pertama artinya: …")
    const word1 = ayah1.words[0];
    expect(seq.steps.find((s) => s.id === "w1")!.cues[0].caption).toBe(
      `Kata pertama, yaitu ${word1.ar} (${word1.translit}), artinya: “dengan nama”. Kata ini terdiri dari dua bagian.`,
    );
    // no other cue names a frame
    expect(seq.steps.filter((s) => s.kind !== "compose" && s.kind !== "primer").every((s) => s.cues.every((q) => q.frame === null))).toBe(true);
    // ayah 2 has no composition yet: unchanged
    expect(composeInputFor(raw, fatihah.ayat[1])?.primer ?? null).toBeNull();
  });

  it("caption-only (an English page): the frames follow the content's own line plan", () => {
    const seq = seq0(null);
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

  // The exception: ar-raḥīmi ends the ayah. The last line of its composition says the recitation
  // stops on it, so its kasrah is not heard — and the word is then heard once more (since
  // 2026-10-14 the narrator's recording of it, never the imam's cut).
  it("the ayah's last word: after the line that says the recitation stops on it, it is heard once more — the joined word 'recited', that line still the caption, no reading time", () => {
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
        // "Tunggu saya": Lanjut at the end of the step (and after each part of every caption-only
        // line), as ever. "Narrated" is the shipped manifest, whose lines may wait for a render (the
        // stop line's text changed 2026-10-14: "dan bacaan berhenti padanya"): those are caption-only.
        const unvoiced = step.cues.filter((c) => c.audio.length === 0).reduce((n, c) => n + c.parts.length, 0);
        if (!narrated) expect(unvoiced, where).toBe(step.cues.reduce((n, c) => n + c.parts.length, 0));
        expect(lanjut, where).toBe(pace !== "tunggu" ? 0 : unvoiced + 1);
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

  it("the primer shows its frames in order — in lesson zero, where there is no ayah to light a word of", () => {
    const seq = seq0(manifest);
    const idx = seq.steps.findIndex((s) => s.id === "primer");
    let s: AutoplayState = reduceAutoplay(seq, createAutoplayState(seq, { idx }), { type: "start", from: idx, reason: "continue" });
    const frames: number[] = [];
    for (let i = 0; i < 200 && s.idx === idx && s.activity; i++) {
      const f = stageFrame(seq, s);
      if (f && frames.at(-1) !== f.frame) frames.push(f.frame);
      s = reduceAutoplay(seq, s, end(s.activity));
    }
    // fathah, kasrah, dhammah, sukun, shaddah, the small upright alif (review 2026-10-10), each first on
    // its letter without it, then with it (operator 2026-10-15)
    expect(frames).toEqual(Array.from({ length: 13 }, (_, k) => k + 1));
    expect(raw.primer!.frames.map((f) => f.stage)).toEqual(["overview", ...Array.from({ length: 6 }, () => ["bare", "mark"]).flat()]);
    // The frames still say which words of ayah 1 their letters come from (بِ of word 1, مَٰ of
    // word 3) — what the primer's lines lit on the mushaf line while ayah 1 played it — and the
    // lines of lesson zero light nothing: its stage has no mushaf line.
    expect([raw.primer!.frames[4].words, raw.primer!.frames[12].words]).toEqual([[1], [3]]);
    expect(seq.steps[idx].cues.every((q) => q.highlight.length === 0 && q.focus === null)).toBe(true);
    expect(seq.steps[idx].cues.map((q) => q.line)).toEqual(raw.primer!.lines.map((_, k) => `al-fatihah:0:primer:${k + 1}`));
    expect(raw.primer!.frames[12].marks).toEqual(["small_alif"]);
  });
});
