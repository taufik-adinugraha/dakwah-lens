import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../../../content/wordvoice.json";
import {
  createAutoplayState,
  reduceAutoplay,
  viewAutoplay,
  type Activity,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type ExampleClip,
} from "@/lib/autoplay";
import { loadCheckInput, runAutoplayChecks, transitionProblem, wordVoiceProblems } from "@/lib/autoplay/checks";
import { SURAHS } from "@/lib/content";
import { PACES, type Pace } from "@/lib/lessonSteps";
import { plainLetters, voiceFrom, wordVoice, type WordVoiceManifest } from "@/lib/wordvoice";

import { stageSequence } from "./build";

// Operator 2026-10-14: "for all quran word by word should be replaced by this, not using truncated
// voice from imam … because in some parts the truncation are not clean". Every Qur'anic WORD the
// lesson plays on its own — a word's opening step and "Pelan"'s second hearing, the ayah's last
// word once more, an example beat on this ayah's word, Dengar dan klik's word — is its own recording
// (content/wordvoice.json): since 2026-10-15 Quran.com's word-by-word recording of a word at its place
// (our unaltered copy), the narrator Kang Nandar's AI voice for a form no place has; the imam (Mishary
// Alafasy) recites WHOLE ayat only. Pinned here over the lessons the page ships: what the sequence carries, what the
// machine plays, and that a word without a recording fails the checks instead of falling back.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const M = manifest as WordVoiceManifest;
const VOICE_FILE = /^\/belajar\/media\/narration\/kang-nandar\/words\/[0-9a-f]{16}-[0-9a-f]{10}\.mp3$/;
/** Our unaltered copy of Quran.com's file of a word at its place (operator 2026-10-15). */
const QC_FILE = /^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/;
/** A word recording as content/wordvoice.json gives it: Quran.com's word inside its file, or the narrator's whole file. */
const isWordRecording = (c: ExampleClip | null | undefined) =>
  !!c && (c.source === "quran.com" ? QC_FILE.test(c.url) && c.start >= 0 && c.end > c.start : VOICE_FILE.test(c.url) && c.start === 0);
const LESSON_SURAHS = ["al-fatihah", "al-ikhlas", "al-falaq", "an-nas"];

const lessons = SURAHS.flatMap((s) => s.ayat.map((a) => ({ s, a, seq: stageSequence(s, a, "id") })));

/** What the stage answers when the lesson is left to run; an exercise asks for its first question's
 *  word (Dengar dan klik), then is skipped. */
function answer(seq: AutoplaySequence, s: AutoplayState, asked: Set<number>): AutoplayEvent | null {
  if (s.phase === "finished" || s.phase === "paused" || s.phase === "idle") return null;
  const a = s.activity;
  if (a?.kind === "narrate") return { type: "narration_end", token: a.token };
  if (a?.kind === "read" || a?.kind === "wait") return { type: "timer", token: a.token };
  if (a?.kind === "recite") return { type: "recite_end", token: a.token };
  if (s.phase === "waiting") {
    const step = seq.steps[s.idx];
    if (step.exercise?.key === "tap-word" && !asked.has(s.idx)) {
      asked.add(s.idx);
      return { type: "exercise_guide", target: "exercise:tap-word:play", word: seq.wordVoices.length };
    }
    return { type: "skip" };
  }
  if (s.phase === "ready") return { type: "next" };
  return null;
}

function walk(seq: AutoplaySequence, pace: Pace): { s: AutoplayState; e: AutoplayEvent | null }[] {
  const out: { s: AutoplayState; e: AutoplayEvent | null }[] = [];
  const asked = new Set<number>();
  let s = reduceAutoplay(seq, createAutoplayState(seq, { pace }), { type: "start", pace, reason: "fresh" });
  for (let i = 0; i < 8000; i++) {
    const e = answer(seq, s, asked);
    out.push({ s, e });
    if (!e) break;
    s = reduceAutoplay(seq, s, e);
  }
  return out;
}

const recite = (a: Activity | null) => (a?.kind === "recite" ? a : null);

describe("every word heard on its own is the narrator's recording of it, never the imam's", () => {
  it("every word of the four surahs has a recording (none missing, none invented), and the sequence carries exactly it", () => {
    const missing: string[] = [];
    for (const slug of LESSON_SURAHS) {
      const s = SURAHS.find((x) => x.slug === slug)!;
      for (const a of s.ayat) for (const w of a.words) if (!M.words[plainLetters(w.ar)]?.audio) missing.push(w.loc);
    }
    expect(missing).toEqual([]);
    for (const { a, seq } of lessons) {
      expect(seq.wordVoices.length, a.loc).toBe(a.words.length);
      a.words.forEach((w, i) => {
        const v = seq.wordVoices[i];
        expect(v, w.loc).toEqual(wordVoice(w.ar));
        // a lesson word stands at its place: Quran.com's recording of it (operator 2026-10-15)
        expect(v?.source, w.loc).toBe("quran.com");
        expect(v?.url, w.loc).toMatch(QC_FILE);
        expect(isWordRecording(v), w.loc).toBe(true);
        // Never a file of the ayah's recitation.
        for (const r of a.recitation) expect(v?.url, w.loc).not.toBe(r.url);
      });
      // The English page plays the same words (the voices are not narration lines).
      expect(stageSequence(SURAHS.find((x) => x.slug === seq.slug)!, a, "en").wordVoices).toEqual(seq.wordVoices);
    }
  });

  it.each(PACES)("%s: the machine plays a word only from its recording, and the imam only for the whole ayah", (pace) => {
    let words = 0;
    let quiz = 0;
    for (const { a, seq } of lessons) {
      for (const { s } of walk(seq, pace)) {
        const r = recite(s.activity);
        if (!r) continue;
        const step = seq.steps[s.idx];
        if (r.target === "ayah") {
          // The imam: the recitation step and the recap, nothing else.
          expect(["recite_ayah", "recap"], `${a.loc} ${step.id}`).toContain(step.kind);
          continue;
        }
        // A word (or an example beat's word / form): a word recording — Quran.com's, or the narrator's whole file.
        expect(r.clip, `${a.loc} ${step.id}`).not.toBeNull();
        expect(isWordRecording(r.clip), `${a.loc} ${step.id} ${r.clip!.url}`).toBe(true);
        expect(r.clip!.url, `${a.loc} ${step.id}`).not.toMatch(/everyayah|alafasy/);
        if (r.target === "word") {
          words++;
          expect(r.clip, `${a.loc} ${step.id} word ${r.word}`).toEqual(seq.wordVoices[r.word - 1]);
          if (r.inExercise) quiz++;
        }
      }
    }
    // Every word's opening step at least (one per word of every ayah), and Dengar dan klik's.
    expect(words).toBeGreaterThanOrEqual(lessons.reduce((n, l) => n + l.a.words.length, 0));
    expect(quiz).toBeGreaterThan(0);
  });

  it("a word step ends with its own recording: no reading time where the narrator explains the word next", () => {
    const { seq } = lessons.find((l) => l.a.loc === "1:2")!;
    const idx = seq.steps.findIndex((x) => x.id === "w1:recite");
    const s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", from: idx, reason: "continue" });
    expect(s.activity).toMatchObject({ kind: "recite", target: "word", word: 1, clip: seq.wordVoices[0], minMs: 0 });
  });

  it("a word's recording that fails pauses the lesson with error \"word\"; the ayah's recitation keeps error \"recite\"", () => {
    const { seq } = lessons.find((l) => l.a.loc === "1:2")!;
    const idx = seq.steps.findIndex((x) => x.id === "w1:recite");
    const playing = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", from: idx, reason: "continue" });
    const e: AutoplayEvent = { type: "recite_error", token: playing.activity!.token };
    const failed = reduceAutoplay(seq, playing, e);
    expect([failed.phase, failed.error, viewAutoplay(seq, failed).error]).toEqual(["paused", "word", "word"]);
    expect(transitionProblem(seq, playing, e, failed)).toBeNull();
    // The guard: the old error, or none, is caught.
    expect(transitionProblem(seq, playing, e, { ...failed, error: "recite" })).toBe("a failed recording of the lesson's own word did not pause it");
    // Resume ("Kita lanjutkan.", then) plays the same word's recording again.
    let r = reduceAutoplay(seq, failed, { type: "resume" });
    for (let i = 0; i < 10 && r.activity?.kind !== "recite"; i++) r = reduceAutoplay(seq, r, { type: r.activity?.kind === "narrate" ? "narration_end" : "timer", token: r.activity!.token });
    expect(r.activity).toMatchObject({ kind: "recite", target: "word", word: 1, clip: seq.wordVoices[0] });
    expect(r.error).toBeNull();
    // The imam's ayah failing still says "recite".
    const ayah = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", from: seq.steps.findIndex((x) => x.id === "recite"), reason: "continue" });
    let at = ayah;
    for (let i = 0; i < 10 && at.activity?.kind !== "recite"; i++) at = reduceAutoplay(seq, at, { type: at.activity?.kind === "narrate" ? "narration_end" : "timer", token: at.activity!.token });
    expect(at.activity).toMatchObject({ kind: "recite", target: "ayah" });
    expect(reduceAutoplay(seq, at, { type: "recite_error", token: at.activity!.token }).error).toBe("recite");
  });

  it("the guard refuses a word played from anything but its recording (the imam's cut included)", () => {
    const { seq } = lessons.find((l) => l.a.loc === "1:2")!;
    const idx = seq.steps.findIndex((x) => x.id === "w1:recite");
    const before = createAutoplayState(seq);
    const e: AutoplayEvent = { type: "start", from: idx, reason: "continue" };
    const good = reduceAutoplay(seq, before, e);
    expect(recite(good.activity)?.target).toBe("word");
    expect(transitionProblem(seq, before, e, good)).toBeNull();
    const cut: ExampleClip = { url: "https://everyayah.com/data/Alafasy_128kbps/001002.mp3", start: 0, end: 610 };
    const bad = { ...good, activity: { ...(good.activity as Extract<Activity, { target: "word" }>), clip: cut } };
    expect(transitionProblem(seq, before, e, bad)).toMatch(/^word 1 is played from .*everyayah.*, not its recording$/);
  });
});

describe("a word without a recording fails the checks (checks.ts wordVoiceProblems), never falls back to the imam", () => {
  const { input } = loadCheckInput((rel) => {
    try {
      return read(join("content", rel));
    } catch {
      return null;
    }
  });
  const fatihah2 = lessons.find((l) => l.a.loc === "1:2")!;
  const voice = (ar: string) => voiceFrom(M, ar);

  it("the shipped lessons have none", () => {
    for (const { a, seq } of lessons) expect(wordVoiceProblems(seq, { ayah: a, voice }), a.loc).toEqual([]);
  });

  it("planted: a word the manifest has no recording of is named (and the sequence built without it plays nothing for it)", () => {
    const { a } = fatihah2;
    const gone = plainLetters(a.words[2].ar);
    const words = Object.fromEntries(Object.entries(M.words).filter(([k]) => k !== gone));
    const holed = (ar: string) => voiceFrom({ words }, ar);
    const seq = { ...fatihah2.seq, wordVoices: a.words.map((w) => holed(w.ar)) };
    const problems = wordVoiceProblems(seq, { ayah: a, voice: holed });
    expect(problems.some((p) => /^word 3 \(1:2:3, .*\): has no recording in content\/wordvoice\.json/.test(p)), problems.join(" | ")).toBe(true);
    expect(problems.some((p) => /^w3:recite: plays word 3, which has no recording$/.test(p)), problems.join(" | ")).toBe(true);
  });

  it("planted: the imam's recitation cut at the word, where the narrator's recording belongs", () => {
    const { a } = fatihah2;
    const seq = { ...fatihah2.seq, wordVoices: fatihah2.seq.wordVoices.map((v, i) => (i === 0 ? { url: a.recitation[0].url, start: 0, end: 480 } : v)) };
    const problems = wordVoiceProblems(seq, { ayah: a, voice });
    expect(problems).toEqual([expect.stringMatching(/^word 1 \(1:2:1, .*\): the sequence does not carry its recording$/)]);
  });

  it("planted: no manifest at all — every word of every lesson ayah is an error of the whole check", () => {
    const report = runAutoplayChecks({ ...input, voices: undefined, property: { streams: 0, length: 0 } });
    const named = report.errors.filter((e) => /has no recording in content\/wordvoice\.json/.test(e));
    expect(named.length).toBe(SURAHS.reduce((n, s) => n + s.ayat.reduce((m, a) => m + a.words.length, 0), 0));
  });
});

describe("the runner and the exercises play a word from its recording (source)", () => {
  it("useAutoplay: no word on the imam's player; TapWord takes no recitation", () => {
    const runner = read("src/components/autoplay/useAutoplay.ts");
    // (the stage's segment player plays the whole ayah only: no `.playWord(` on it)
    expect(runner).not.toMatch(/\.playWord\(/);
    expect(runner).toContain("const clip = seq.wordVoices[n - 1] ?? null;");
    expect(runner).toContain('activity.target === "ayah"\n          ? player.loading\n          : examplePlayer.loading');
    const tap = read("src/components/exercises/TapWord.tsx");
    expect(tap).not.toMatch(/useSegmentPlayer|RecitationSource/);
    const stage = read("src/components/lesson/LessonStage.tsx");
    expect(stage).not.toMatch(/p\.playWord\(/);
    expect(stage).toContain("canPlay={ap.canPlayWord}");
  });
});
