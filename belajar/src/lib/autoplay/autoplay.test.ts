import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { captionMs } from "../lessonSteps";
import { loadCheckInput, quizAyahOf, runAutoplayChecks } from "./checks";
import { availableExercises, questionNumbers } from "./exercises";
import { LINE_ID_RE, manifestParts, parseLineId } from "./ids";
import {
  createAutoplayState,
  EXERCISE_DONE_HOLD_MS,
  reduceAutoplay,
  viewAutoplay,
  wantsIdleTicks,
  type Activity,
  type AutoplayEvent,
  type AutoplayState,
} from "./machine";
import {
  captionArabicProblems,
  lineDisplay,
  lineSegments,
  parseNarrationManifest,
  parsePronunciation,
  quranTokenSet,
  spokenTextProblems,
  withoutArabic,
  wordRefs,
} from "./narration";
import {
  autoplayStorageKey,
  markContinue,
  positionToSave,
  readSavedIndex,
  savePosition,
  takeContinue,
  type StorageLike,
} from "./persist";
import { buildAutoplaySequence, introducedConcepts, sequenceLineIds } from "./sequence";
import { ID_TEXTS } from "./texts";
import { advanceHoldMs, partAt, readMs, settleAfterNarrationMs, settleAfterReciteMs, WORD_REPEAT_GAP_MS } from "./timing";
import { SHARED_KEYS, type AutoplaySequence, type NarrationManifest, type Pace } from "./types";

const CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));
const { input, errors: loadErrors } = loadCheckInput((rel) => {
  const path = join(CONTENT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
});
const quizOf = (slug: string, n: number) => quizAyahOf(input.quiz?.[slug], n);

/** One ayah's sequence, caption-only unless manifests are given. */
function seqFor(
  slug: string,
  n: number,
  m: { narration?: NarrationManifest | null; shared?: NarrationManifest | null } = {},
): AutoplaySequence {
  const surah = input.surahs.find((s) => s.slug === slug);
  const ayah = surah?.ayat.find((a) => a.ayah === n);
  if (!surah || !ayah) throw new Error(`no ${slug} ${n}`);
  return buildAutoplaySequence({
    slug,
    surahName: surah.name_id,
    ayahCount: surah.ayat.length,
    ayah,
    introduced: introducedConcepts(input.concepts, ayah.loc),
    exercises: availableExercises(quizOf(slug, n)),
    questions: questionNumbers(quizOf(slug, n)),
    texts: ID_TEXTS,
    narration: m.narration ?? null,
    shared: m.shared ?? null,
  });
}

/** Manifests giving every line of `seq` audio (ms grows with the caption). */
function withAudio(seq: AutoplaySequence): { narration: NarrationManifest; shared: NarrationManifest } {
  const voice = { id: "v", name: "Uji", model: "eleven_v3" };
  const narration: NarrationManifest = { version: 1, voice, lines: {} };
  const shared: NarrationManifest = { version: 1, voice, lines: {} };
  let i = 0;
  // The explanation lines are in a manifest only (a caption-only sequence has no cue for them).
  const explain = Object.entries(questionNumbers(quizOf(seq.slug, seq.ayah))).flatMap(([key, ns]) =>
    (ns ?? []).map((q) => `${seq.slug}:${seq.ayah}:ex:${key}:${q}:why`),
  );
  for (const id of [...sequenceLineIds(seq), ...explain]) {
    const audio = { url: `/belajar/media/narration/uji/${i++}.mp3`, ms: 2000, sha256: "a".repeat(64) };
    (id.startsWith("shared:") ? shared : narration).lines[id] = { text: "teks", audio };
  }
  return { narration, shared };
}

const end = (a: Activity): AutoplayEvent =>
  a.kind === "narrate"
    ? { type: "narration_end", token: a.token }
    : a.kind === "recite"
      ? { type: "recite_end", token: a.token }
      : { type: "timer", token: a.token };

/** A tiny runner: dispatch, and complete activities until `until` holds. */
function runner(seq: AutoplaySequence, pace: Pace = "biasa") {
  let s = createAutoplayState(seq, { pace });
  const log: Activity[] = [];
  const send = (e: AutoplayEvent) => {
    const before = s.activity;
    s = reduceAutoplay(seq, s, e);
    if (s.activity && s.activity !== before) log.push(s.activity);
    return s;
  };
  const until = (done: (s: AutoplayState) => boolean, max = 2000) => {
    for (let i = 0; i < max && !done(s); i++) {
      if (s.activity) send(end(s.activity));
      else if (s.phase === "ready") send({ type: "next" });
      else break;
    }
    return s;
  };
  return { send, until, log, get s() { return s; } };
}

const firstIdx = (seq: AutoplaySequence, kind: string) => seq.steps.findIndex((x) => x.kind === kind);

describe("autoplay sequence", () => {
  it("loads every surah from content/", () => {
    expect(loadErrors).toEqual([]);
    expect(input.surahs.map((s) => s.slug)).toEqual(["al-fatihah", "al-ikhlas", "al-falaq", "an-nas"]);
  });

  it("plays intro, the ayah, each word (recite + explain), new concepts, structure, exercises, recap, next", () => {
    const seq = seqFor("al-fatihah", 2);
    const kinds = seq.steps.map((s) => s.kind);
    expect(kinds.slice(0, 10)).toEqual([
      "intro",
      "recite_ayah",
      "recite_word",
      "explain",
      "recite_word",
      "explain",
      "recite_word",
      "explain",
      "recite_word",
      "explain",
    ]);
    // The lesson page's order: the new concepts, then the structure that uses them.
    expect(kinds.slice(10, 14)).toEqual(["concept", "concept", "concept", "structure"]);
    expect(seq.steps.filter((s) => s.kind === "concept").map((s) => s.id)).toEqual([
      "concept:jumlah-ismiyyah",
      "concept:syibhul-jumlah",
      "concept:jamak-mudzakkar-salim",
    ]);
    // The ayah's quiz (content/quiz, taught before tested since 2026-10-11): marfu' is taught at
    // its first word, so the case sort comes in; wazan only from ayah 5.
    expect(seq.steps.filter((s) => s.kind === "exercise").map((s) => s.exercise?.key)).toEqual([
      "tap-word",
      "sort-case",
      "label-role",
    ]);
    expect(kinds.slice(-2)).toEqual(["recap", "next"]);
    expect(seq.nav).toEqual({ kind: "ayah", slug: "al-fatihah", ayah: 3 });
    expect(seq.steps.find((s) => s.id === "w3")?.lines).toEqual(["al-fatihah:2:w3"]);
    expect(seq.steps.find((s) => s.id === "w3:recite")?.recite).toEqual({ target: "word", word: 3 });
  });

  it("ends every surah's last ayah with done (and the surah end); every other ayah with next", () => {
    for (const surah of input.surahs) {
      for (const a of surah.ayat) {
        const seq = seqFor(surah.slug, a.ayah);
        const last = seq.steps[seq.steps.length - 1];
        if (a.ayah === surah.ayat.length) {
          expect(last.kind).toBe("done");
          expect(last.lines).toEqual([`${surah.slug}:${a.ayah}:done`, "shared:surah_done"]);
          expect(seq.nav).toEqual({ kind: "surah_end", slug: surah.slug });
        } else {
          expect(last.kind).toBe("next");
        }
      }
    }
  });

  it("waits only at the exercises the page renders (Al-Ikhlas 3 has no graded case endings)", () => {
    const keys = seqFor("al-ikhlas", 3).steps.filter((s) => s.kind === "exercise").map((s) => s.exercise?.key);
    expect(keys).toEqual(["tap-word", "label-role", "wazn-factory"]);
  });

  it("never puts Arabic script in a caption, and every line id is on the contract", () => {
    for (const surah of input.surahs) {
      for (const a of surah.ayat) {
        const seq = seqFor(surah.slug, a.ayah);
        for (const s of seq.steps) {
          expect(s.caption).not.toMatch(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/);
          for (const c of s.cues) {
            expect(c.line).toMatch(LINE_ID_RE);
            for (const p of c.parts) {
              expect(p.trim().length).toBeGreaterThan(0);
              expect(p).not.toMatch(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/);
            }
          }
        }
      }
    }
  });

  it("attaches audio only from same-origin narration paths, and plays a split line part by part", () => {
    const plain = seqFor("al-fatihah", 2);
    const { narration, shared } = withAudio(plain);
    const st = narration.lines["al-fatihah:2:structure"];
    delete narration.lines["al-fatihah:2:structure"];
    narration.lines["al-fatihah:2:structure:a"] = { text: "a", audio: { ...st.audio!, url: "/belajar/media/narration/uji/a.mp3", ms: 1000 } };
    narration.lines["al-fatihah:2:structure:b"] = { text: "b", audio: { ...st.audio!, url: "/belajar/media/narration/uji/b.mp3", ms: 3000 } };
    narration.lines["al-fatihah:2:recap"].audio = { url: "https://cdn.example.com/x.mp3", ms: 900, sha256: "a".repeat(64) };
    const seq = seqFor("al-fatihah", 2, { narration, shared });
    expect(seq.steps.find((s) => s.id === "recap")?.cues[0].audio).toEqual([]);
    const structure = seq.steps.find((s) => s.id === "structure")?.cues[0];
    expect(structure?.audio.map((a) => a.id)).toEqual(["al-fatihah:2:structure:a", "al-fatihah:2:structure:b"]);
    expect(structure?.spoken).toBe("a b");
    expect(plain.steps[0].cues[0].spoken).toBeNull();

    const r = runner(seq);
    r.send({ type: "start", reason: "continue", from: firstIdx(seq, "structure") });
    expect(r.s.activity).toMatchObject({ kind: "narrate", file: "al-fatihah:2:structure:a", offsetMs: 0, totalMs: 4000 });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "narrate", file: "al-fatihah:2:structure:b", offsetMs: 1000, totalMs: 4000 });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: settleAfterNarrationMs("biasa") });
  });

  it("uses an ayah's own exercise prompt when its manifest has one, else the shared prompt", () => {
    const playLine = (seq: AutoplaySequence) => {
      const tap = seq.steps.find((s) => s.id === "ex:tap-word");
      const cue = tap?.exercise?.promptCue.play;
      return tap && cue !== undefined ? tap.cues[cue].line : null;
    };
    expect(playLine(seqFor("al-fatihah", 2))).toBe("shared:ex:tap-word:play");
    const narration: NarrationManifest = { version: 1, voice: null, lines: { "al-fatihah:2:ex:tap-word:play": { text: "x" } } };
    expect(playLine(seqFor("al-fatihah", 2, { narration }))).toBe("al-fatihah:2:ex:tap-word:play");
  });
});

describe("autoplay machine", () => {
  it("caption-only: reads each caption for captionMs, and shows the caption while the imam recites", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq, "biasa");
    r.send({ type: "start" });
    expect(r.s.phase).toBe("running");
    expect(r.s.activity).toMatchObject({ kind: "read", ms: captionMs(ID_TEXTS.shared.start, "biasa") });
    r.send(end(r.s.activity!));
    expect(r.s.idx).toBe(0);
    expect(r.s.activity).toMatchObject({ kind: "read", ms: readMs(seq.steps[0].cues[0].parts[0], "biasa") });
    r.send(end(r.s.activity!));
    expect(r.s.idx).toBe(1);
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", minMs: readMs(seq.steps[1].cues[0].caption, "biasa") });
    expect(viewAutoplay(seq, r.s).caption.parts).toEqual(seq.steps[1].cues[0].parts);
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: settleAfterReciteMs("biasa") });
    r.send(end(r.s.activity!));
    expect(r.s.idx).toBe(2);
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "word", word: 1 });
    expect(viewAutoplay(seq, r.s).focusWord).toBe(1);
    expect(viewAutoplay(seq, r.s).guides.map((g) => g.target)).toEqual(["mushaf-word:1"]);
  });

  it("with audio: narration, a settle pause, then the imam — never at the same time", () => {
    const plain = seqFor("al-fatihah", 2);
    const seq = seqFor("al-fatihah", 2, withAudio(plain));
    const r = runner(seq, "biasa");
    r.send({ type: "start" });
    r.until((s) => s.idx === 2);
    expect(r.log.map((a) => a.kind)).toEqual([
      "narrate", // shared:start
      "wait",
      "narrate", // intro
      "wait",
      "narrate", // "Dengarkan imam…"
      "wait",
      "recite", // the whole ayah, after the line has ended
      "wait",
      "recite", // word 1
    ]);
    expect(r.log[6]).toMatchObject({ kind: "recite", target: "ayah", minMs: 0 });
    // One activity at a time, by construction; a late end of a cancelled clip changes nothing.
    const before = r.s;
    expect(reduceAutoplay(seq, before, { type: "narration_end", token: before.activity!.token })).toBe(before);
    expect(reduceAutoplay(seq, before, { type: "recite_end", token: before.activity!.token - 1 })).toBe(before);
  });

  it("Pelan: the imam says each word twice, with a gap", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq, "pelan");
    r.send({ type: "start", from: 2, reason: "continue" });
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "word", word: 1 });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: WORD_REPEAT_GAP_MS });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "word", word: 1, minMs: 0 });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: settleAfterReciteMs("pelan") });
  });

  it("Tunggu saya: holds every caption until Lanjut, and points at the Lanjut button", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq, "tunggu");
    r.send({ type: "start", reason: "continue" });
    expect(r.s.phase).toBe("ready");
    expect(r.s.activity).toBeNull();
    expect(viewAutoplay(seq, r.s).showLanjut).toBe(true);
    expect(r.s.guides.map((g) => g.target)).toContain("lanjut");
    r.send({ type: "next" });
    expect(r.s.idx).toBe(1);
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", minMs: 0 });
    r.send(end(r.s.activity!));
    r.send(end(r.s.activity!)); // settle
    expect(r.s.phase).toBe("ready");
    expect(r.s.idx).toBe(1);
    r.send({ type: "next" });
    expect(r.s.idx).toBe(2);
  });

  it("waits at an exercise forever: three gentle reminders, the last offering Lewati latihan", () => {
    const seq = seqFor("al-fatihah", 2);
    const ex = firstIdx(seq, "exercise");
    const r = runner(seq);
    r.send({ type: "start", from: ex, reason: "continue" });
    r.until((s) => s.phase === "waiting");
    expect(r.s.idx).toBe(ex);
    const v = viewAutoplay(seq, r.s);
    expect(v.showSkip).toBe(true);
    expect(v.canNext).toBe(false);
    expect(v.guides.map((g) => g.target)).toEqual(["exercise:tap-word:play"]);
    expect(r.send({ type: "next" }).idx).toBe(ex); // forward is "Lewati latihan", not next
    // Ten minutes of silence, one tick a second (the reminders' own lines
    // play in between and do not count as silence).
    const at: number[] = [];
    for (let tick = 1; tick <= 600; tick++) {
      r.until((s) => s.activity === null);
      expect(wantsIdleTicks(r.s) || r.s.exercise?.reminders === 3).toBe(true);
      const before = r.s.exercise?.reminders ?? 0;
      r.send({ type: "idle_tick", ms: 1000 });
      if ((r.s.exercise?.reminders ?? 0) > before) {
        at.push(tick);
        expect(r.s.caption).toEqual({ s: "reminder" });
      }
    }
    r.until((s) => s.activity === null);
    expect(at).toEqual([20, 40, 60]);
    expect(r.s.idx).toBe(ex);
    expect(r.s.phase).toBe("waiting");
    expect(r.s.guides.map((g) => g.target)).toEqual(["exercise:tap-word:play", "skip"]);
    expect(wantsIdleTicks(r.s)).toBe(false);
    r.send({ type: "skip" });
    expect(r.s.idx).toBe(ex + 1);
    expect(seq.steps[r.s.idx].exercise?.key).toBe("sort-case");
  });

  it("guides the learner: a prompt the first time a control comes up, feedback on answers, on after done", () => {
    const seq = seqFor("al-fatihah", 2);
    const ex = firstIdx(seq, "exercise");
    const spec = seq.steps[ex].exercise!;
    const r = runner(seq);
    r.send({ type: "start", from: ex, reason: "continue" });
    r.until((s) => s.phase === "waiting");
    // The exercise reports the control it starts on: already prompted.
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play" });
    expect(r.s.activity).toBeNull();
    r.send({ type: "exercise_guide", target: "exercise:tap-word:options" });
    expect(r.s.caption).toEqual({ c: spec.promptCue.options });
    expect(r.s.guides.map((g) => g.target)).toEqual(["exercise:tap-word:options"]);
    r.until((s) => s.phase === "waiting");
    // A wrong pick is not voiced (operator 2026-10-10): nothing plays, the caption stays.
    const caption = r.s.caption;
    r.send({ type: "answered", key: "tap-word", correct: false, question: 1 });
    expect(r.s.activity).toBeNull();
    expect(r.s.phase).toBe("waiting");
    expect(r.s.caption).toEqual(caption);
    // Another exercise's answer is not this one's.
    const same = r.s;
    expect(r.send({ type: "answered", key: "sort-case", correct: true })).toBe(same);
    r.send({ type: "answered", key: "tap-word", correct: true });
    expect(r.s.caption).toEqual({ s: "correct" });
    // Back at a control already prompted: the spotlight moves, nothing is said.
    r.until((s) => s.phase === "waiting");
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play" });
    expect(r.s.activity).toBeNull();
    expect(r.s.guides.map((g) => g.target)).toEqual(["exercise:tap-word:play"]);
    r.send({ type: "exercise_done", key: "tap-word" });
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: EXERCISE_DONE_HOLD_MS });
    expect(r.s.idx).toBe(ex);
    r.send(end(r.s.activity!));
    expect(r.s.idx).toBe(ex + 1);
  });

  it("passes an exercise the learner already finished before the lesson reached it", () => {
    const seq = seqFor("al-ikhlas", 3);
    const r = runner(seq);
    r.send({ type: "start" });
    for (const key of ["tap-word", "label-role", "wazn-factory"] as const) r.send({ type: "exercise_done", key });
    r.until((s) => s.phase === "waiting" || s.phase === "finished" || s.idx === seq.steps.length - 1);
    expect(r.s.phase).not.toBe("waiting");
    expect(seq.steps[r.s.idx].kind).toBe("next");
  });

  it("pause/resume: says shared:resume, the imam continues where he stopped", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq);
    r.send({ type: "start", from: 1, reason: "continue" });
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", resume: false });
    r.send({ type: "pause" });
    expect(r.s.phase).toBe("paused");
    expect(r.s.activity).toBeNull();
    r.send({ type: "resume" });
    expect(r.s.caption).toEqual({ s: "resume" });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", resume: true });
  });

  it("pause/resume keeps the caption part of a long caption-only line", () => {
    const seq = seqFor("al-fatihah", 1);
    const at = firstIdx(seq, "structure");
    expect(seq.steps[at].cues[0].parts.length).toBeGreaterThan(1);
    const r = runner(seq);
    r.send({ type: "start", from: at, reason: "continue" });
    r.send(end(r.s.activity!));
    expect(r.s.part).toBe(1);
    r.send({ type: "pause" });
    r.send({ type: "resume" });
    r.send(end(r.s.activity!)); // "Kita lanjutkan."
    expect(r.s.caption).toEqual({ c: 0 });
    expect(r.s.part).toBe(1);
  });

  it("falls back to captions when narration audio fails, and pauses when the imam's recording fails", () => {
    const plain = seqFor("al-fatihah", 2);
    const seq = seqFor("al-fatihah", 2, withAudio(plain));
    const r = runner(seq);
    r.send({ type: "start" });
    r.send({ type: "narration_error", token: r.s.activity!.token });
    expect(r.s.activity?.kind).toBe("read");
    expect(r.s.noAudio).toEqual(["shared:start"]);
    r.until((s) => s.activity?.kind === "recite");
    r.send({ type: "recite_error", token: r.s.activity!.token });
    expect(r.s.phase).toBe("paused");
    expect(viewAutoplay(seq, r.s).error).toBe("recite");
    r.send({ type: "resume" });
    r.until((s) => s.activity?.kind === "recite");
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah" });
    expect(r.s.error).toBeNull();
  });

  it("ends with a navigation intent: the next ayah, or the end of the surah", () => {
    for (const [slug, n, intent] of [
      ["al-fatihah", 2, { kind: "ayah", slug: "al-fatihah", ayah: 3 }],
      ["an-nas", 6, { kind: "surah_end", slug: "an-nas" }],
    ] as const) {
      const seq = seqFor(slug, n);
      const r = runner(seq);
      r.send({ type: "start" });
      for (let i = 0; i < 5000 && r.s.phase !== "finished"; i++) {
        if (r.s.phase === "waiting") r.send({ type: "exercise_done", key: r.s.exercise!.key });
        else r.until((s) => s.phase !== "running");
      }
      expect(r.s.phase).toBe("finished");
      expect(r.s.intent).toEqual(intent);
      r.send({ type: "prev" });
      expect(r.s.idx).toBe(seq.steps.length - 1);
      expect(r.s.intent).toBeNull();
    }
  });
});

describe("autoplay exercises: the learner only answers", () => {
  const tapAt = (seq: AutoplaySequence) => firstIdx(seq, "exercise");
  const waitingAt = (seq: AutoplaySequence, pace: Pace = "biasa") => {
    const r = runner(seq, pace);
    r.send({ type: "start", from: tapAt(seq), reason: "continue" });
    r.until((s) => s.phase === "waiting");
    return r;
  };

  it("Dengar dan klik: the lesson's imam recites the question's word, then reports it heard", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    expect(seq.steps[r.s.idx].exercise?.key).toBe("tap-word");
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 3 });
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "word", word: 3, inExercise: true });
    expect(r.s.guides.map((g) => g.target)).toEqual(["exercise:tap-word:play"]);
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: settleAfterReciteMs("biasa") });
    r.send(end(r.s.activity!));
    expect(r.s.phase).toBe("waiting");
    expect(r.s.exercise?.heard).toBe(3);
    // The same word again (a re-render) recites nothing more.
    const same = r.s;
    expect(r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 3 })).toBe(same);
  });

  it("a wrong pick before the imam finished: no voice, his word goes on", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 2 });
    expect(r.s.activity?.kind).toBe("recite");
    const reciting = r.s.activity;
    r.send({ type: "answered", key: "tap-word", correct: false, question: 2 });
    expect(r.s.activity).toBe(reciting);
  });

  it("a right pick before the imam finished: Benar., then the word again", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 2 });
    r.send({ type: "answered", key: "tap-word", correct: true, question: 2 });
    expect(r.s.caption).toEqual({ s: "correct" });
    r.until((s) => s.activity?.kind === "recite");
    expect(r.s.activity).toMatchObject({ kind: "recite", word: 2 });
  });

  it("a question answered right moves on by itself after Benar. and a hold (Biasa)", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "exercise_guide", target: "exercise:tap-word:options" });
    r.until((s) => s.phase === "waiting");
    r.send({ type: "answered", key: "tap-word", correct: true });
    r.send({ type: "exercise_guide", target: "exercise:tap-word:next" });
    expect(r.s.caption).toEqual({ s: "correct" });
    // Nothing is marked: no tap is asked for.
    expect(r.s.guides).toEqual([]);
    r.send(end(r.s.activity!)); // "Benar." (caption-only read)
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: advanceHoldMs("biasa", true) });
    expect(r.s.exercise?.advance).toBe(0);
    r.send(end(r.s.activity!));
    expect(r.s.exercise?.advance).toBe(1);
    expect(r.s.phase).toBe("waiting");
    expect(r.s.idx).toBe(tapAt(seq));
  });

  it("an answer shown after two misses says so, and stays longer", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "exercise_guide", target: "exercise:tap-word:options" });
    r.until((s) => s.phase === "waiting");
    r.send({ type: "revealed", key: "tap-word", question: 1 });
    r.send({ type: "exercise_guide", target: "exercise:tap-word:next" });
    expect(r.s.caption).toEqual({ s: "revealed" });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: advanceHoldMs("biasa", false) });
  });

  it("a right answer and a shown one are explained by voice: Benar. / Ini jawabannya., then that question's line", () => {
    const plain = seqFor("al-fatihah", 2);
    const seq = seqFor("al-fatihah", 2, withAudio(plain));
    const at = seq.steps.findIndex((x) => x.exercise?.key === "label-role");
    const spec = seq.steps[at].exercise!;
    const explain2 = spec.explain[2]!;
    expect(seq.steps[at].cues[explain2].line).toBe("al-fatihah:2:ex:label-role:2:why");
    const r = runner(seq);
    r.send({ type: "start", from: at, reason: "continue" });
    r.until((s) => s.phase === "waiting");
    // A wrong pick: silence.
    r.send({ type: "answered", key: "label-role", correct: false, question: 1 });
    expect(r.s.activity).toBeNull();
    // The right one: "Benar.", its settle, then question 1's explanation.
    r.send({ type: "answered", key: "label-role", correct: true, question: 1 });
    expect(r.s.activity).toMatchObject({ kind: "narrate", line: "shared:correct" });
    r.send({ type: "exercise_guide", target: "exercise:label-role:next" });
    r.send(end(r.s.activity!));
    r.send(end(r.s.activity!)); // settle
    expect(r.s.activity).toMatchObject({ kind: "narrate", line: "al-fatihah:2:ex:label-role:1:why" });
    r.send(end(r.s.activity!));
    r.send(end(r.s.activity!)); // settle
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: advanceHoldMs("biasa", true) });
    r.send(end(r.s.activity!));
    expect(r.s.exercise?.advance).toBe(1);
    // "Tunjukkan jawaban" on question 2: "Ini jawabannya.", then question 2's explanation.
    r.send({ type: "exercise_guide", target: "exercise:label-role:options" });
    r.until((s) => s.phase === "waiting");
    r.send({ type: "revealed", key: "label-role", question: 2 });
    expect(r.s.activity).toMatchObject({ kind: "narrate", line: "shared:revealed" });
    r.until((s) => s.activity?.kind === "narrate" && s.activity.line !== "shared:revealed");
    expect(r.s.activity).toMatchObject({ kind: "narrate", line: "al-fatihah:2:ex:label-role:2:why" });
  });

  it("the last answer of a sort ends the exercise as it is said: the explanation still plays", () => {
    const plain = seqFor("al-fatihah", 2);
    const seq = seqFor("al-fatihah", 2, withAudio(plain));
    const at = seq.steps.findIndex((x) => x.exercise?.key === "sort-case");
    const r = runner(seq);
    r.send({ type: "start", from: at, reason: "continue" });
    r.until((s) => s.phase === "waiting");
    r.send({ type: "answered", key: "sort-case", correct: true, question: 4 });
    r.send({ type: "exercise_done", key: "sort-case" });
    const said: string[] = [];
    r.until((s) => {
      if (s.idx === at && s.activity?.kind === "narrate" && said.at(-1) !== s.activity.line) said.push(s.activity.line);
      return s.idx !== at;
    });
    expect(said).toEqual(["shared:correct", "al-fatihah:2:ex:sort-case:4:why"]);
  });

  it("Lanjut tapped early: the hold is dropped, the next question's word is recited", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "answered", key: "tap-word", correct: true });
    r.send({ type: "exercise_guide", target: "exercise:tap-word:next" });
    r.send(end(r.s.activity!)); // "Benar."
    expect(r.s.activity?.kind).toBe("wait");
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 4 });
    expect(r.s.activity).toMatchObject({ kind: "recite", word: 4 });
    r.until((s) => s.phase === "waiting");
    expect(r.s.exercise?.advance).toBe(0);
    // Back at a control met before: its prompt is shown again, silently.
    expect(r.s.caption).toEqual({ c: seq.steps[r.s.idx].exercise!.promptCue.play });
  });

  it("Tunggu saya: a settled question waits for the exercise's Lanjut (prompt + spotlight)", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq, "tunggu");
    r.send({ type: "answered", key: "tap-word", correct: true });
    r.send({ type: "exercise_guide", target: "exercise:tap-word:next" });
    r.until((s) => s.phase === "waiting");
    expect(r.s.caption).toEqual({ c: seq.steps[r.s.idx].exercise!.promptCue.next });
    expect(r.s.guides.map((g) => g.target)).toEqual(["exercise:tap-word:next"]);
    expect(r.s.exercise?.advance).toBe(0);
    // Switching to Biasa there moves it on by itself.
    r.send({ type: "set_pace", pace: "biasa" });
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: advanceHoldMs("biasa", true) });
    r.send(end(r.s.activity!));
    expect(r.s.exercise?.advance).toBe(1);
  });
});

describe("word places", () => {
  it("reads the places a spoken line names in its own ayah", () => {
    expect(wordRefs("Kata pertama artinya “x”. Lalu kata ketiga dan keempat; kata kedua sampai keempat.")).toEqual([1, 3, 4, 2]);
    expect(wordRefs("Kata kedua di ayat dua, kata ini, sifat keempat.")).toEqual([]);
  });

  it("rings the words the structure line names, from the real manifest", () => {
    const narration = input.manifests["al-fatihah"] as NarrationManifest;
    const seq = seqFor("al-fatihah", 4, { narration });
    const at = firstIdx(seq, "structure");
    expect(seq.steps[at].cues[0].refs).toEqual([1, 2, 3]);
    const r = runner(seq);
    r.send({ type: "start", from: at, reason: "continue" });
    expect(viewAutoplay(seq, r.s).refWords).toEqual([1, 2, 3]);
    for (const s of seq.steps) for (const c of s.cues) for (const w of c.refs) expect(w).toBeLessThanOrEqual(4);
  });
});

describe("autoplay persistence", () => {
  function memory(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }
  const seq = seqFor("al-fatihah", 2);

  it("remembers the step by id and restores it after a reload", () => {
    const store = memory();
    let s = createAutoplayState(seq);
    expect(positionToSave(seq, s)).toBeUndefined();
    s = reduceAutoplay(seq, s, { type: "start", from: 5, reason: "continue" });
    savePosition(store, seq, s);
    expect(store.data.get(autoplayStorageKey("al-fatihah/2"))).toBe(JSON.stringify({ v: 1, step: seq.steps[5].id }));
    expect(readSavedIndex(store, seq)).toBe(5);
    const restored = reduceAutoplay(seq, createAutoplayState(seq, { idx: readSavedIndex(store, seq) }), { type: "start" });
    expect(restored.idx).toBe(5);
    expect(restored.caption).toEqual({ s: "resume" });
  });

  it("forgets the position when the lesson is finished, and survives blocked or corrupt storage", () => {
    const store = memory();
    store.setItem(autoplayStorageKey("al-fatihah/2"), "{not json");
    expect(readSavedIndex(store, seq)).toBeNull();
    store.setItem(autoplayStorageKey("al-fatihah/2"), JSON.stringify({ v: 1, step: "gone" }));
    expect(readSavedIndex(store, seq)).toBeNull();
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSavedIndex(blocked, seq)).toBeNull();
    const finished = { ...createAutoplayState(seq), started: true, phase: "finished" as const, idx: 9 };
    expect(() => savePosition(blocked, seq, finished)).not.toThrow();
    savePosition(store, seq, finished);
    expect(store.data.has(autoplayStorageKey("al-fatihah/2"))).toBe(false);
  });

  it("keeps a remembered place while a new run is still on its first step", () => {
    const s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start" });
    expect(s.idx).toBe(0);
    expect(positionToSave(seq, s)).toBeUndefined();
  });

  it("hands off to the next ayah without sessionStorage too (in memory, once)", () => {
    markContinue(null, { kind: "ayah", slug: "al-fatihah", ayah: 3 }, 1000);
    expect(takeContinue(null, "al-fatihah/3", 2000)).toBe(true);
    expect(takeContinue(null, "al-fatihah/3", 2000)).toBe(false);
  });

  it("hands off to the next ayah once, only when fresh", () => {
    const store = memory();
    markContinue(store, { kind: "ayah", slug: "al-fatihah", ayah: 3 }, 1000);
    expect(takeContinue(store, "al-fatihah/4", 2000)).toBe(false); // wrong ayah: consumed anyway
    markContinue(store, { kind: "ayah", slug: "al-fatihah", ayah: 3 }, 1000);
    expect(takeContinue(store, "al-fatihah/3", 2000)).toBe(true);
    expect(takeContinue(store, "al-fatihah/3", 2000)).toBe(false);
    markContinue(store, { kind: "ayah", slug: "al-fatihah", ayah: 3 }, 1000);
    expect(takeContinue(store, "al-fatihah/3", 1000 + 10 * 60_000)).toBe(false);
    markContinue(store, { kind: "surah_end", slug: "al-fatihah" }, 1000);
    expect(store.data.size).toBe(0);
  });
});

describe("narration ids and the spoken-text guard", () => {
  it("parses the contract, split parts included", () => {
    expect(parseLineId("al-fatihah:2:w3")).toMatchObject({ kind: "ayah", slug: "al-fatihah", ayah: 2, part: "w3", split: null });
    expect(parseLineId("al-fatihah:1:structure:b")).toMatchObject({ base: "al-fatihah:1:structure", split: "b" });
    expect(parseLineId("al-fatihah:1:concept:huruf-jar")).toMatchObject({ part: "concept:huruf-jar", split: null });
    expect(parseLineId("shared:ex:sort-case:bins")).toMatchObject({ kind: "shared", key: "ex:sort-case:bins" });
    for (const k of SHARED_KEYS) expect(parseLineId(`shared:${k}`)).not.toBeNull();
    for (const bad of ["al-fatihah:0:intro", "Al-Fatihah:1:intro", "al-fatihah:1:w", "shared:nope", "al-fatihah:1:ex:tap:intro"]) {
      expect(parseLineId(bad)).toBeNull();
    }
  });

  it("finds a line stored whole or split, never both", () => {
    const m: NarrationManifest = {
      version: 1,
      voice: null,
      lines: { "s:1:intro": { text: "a" }, "s:1:structure:a": { text: "b" }, "s:1:structure:b": { text: "c" } },
    };
    expect(manifestParts(m, "s:1:intro")).toEqual(["s:1:intro"]);
    expect(manifestParts(m, "s:1:structure")).toEqual(["s:1:structure:a", "s:1:structure:b"]);
    m.lines["s:1:structure"] = { text: "d" };
    expect(manifestParts(m, "s:1:structure")).toBeNull();
    expect(lineSegments(m, "s:1:intro")).toEqual([]); // no audio: caption-only
  });

  it("flags Arabic script and transliterated Qur'anic words in spoken text, not plain Indonesian", () => {
    const tokens = quranTokenSet(
      input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => w.translit))),
      input.surahs.flatMap((s) => s.ayat.map((a) => a.words.map((w) => w.translit))),
    );
    expect(spokenTextProblems("Kata pertama artinya “segala puji”, dan segala puji hanya bagi Allah.", tokens)).toEqual([]);
    expect(spokenTextProblems("Penjelasan ini dibacakan dengan suara AI.", tokens)).toEqual([]);
    expect(spokenTextProblems("Kata ini dibaca al-ḥamdu.", tokens)[0]).toMatch(/transliterated/);
    expect(spokenTextProblems("Lalu rabbi.", tokens)[0]).toMatch(/rabbi/);
    expect(spokenTextProblems("Kata الحمد ini.", tokens)).toContain("Arabic script");
    expect(spokenTextProblems("Ada 4 kata.", tokens)).toContain("digits (spell numbers out)");
    expect(spokenTextProblems("Allah SWT berfirman.", tokens).join(" ")).toMatch(/ALL CAPS: SWT/);
    expect(spokenTextProblems("Coba kamu klik.", tokens).join(" ")).toMatch(/kamu/);
    // Other spellings and endings of the lesson words, and words run together.
    for (const t of [
      "Qul huwallahu ahad.",
      "Ar-Rahman.",
      "Kata ini, al-falaq.",
      "Rabbil alamin.",
      "Shirathal mustaqim.",
      "Waladh dhollin.",
      "Alhamdulillah.",
      "Bismillah.",
      "Kata ini a'udzu.",
      "Ash-shamad.",
      "Rabbu.",
      "Khalaq.",
      "Al-jinnah.",
      "Kata 'Ala.",
    ]) {
      expect(spokenTextProblems(t, tokens).join(" "), t).toMatch(/transliterated/);
    }
    // Indonesian that only looks like it: the letter name, a surah name, the honorifics.
    for (const t of [
      "Huruf lam “bagi”.",
      "Pelajaran ayat terakhir Surah An-Nas selesai.",
      "Nabi Muhammad shallallahu 'alaihi wa sallam.",
      "Huruf 'illah dibuang.",
    ]) {
      expect(spokenTextProblems(t, tokens), t).toEqual([]);
    }
  });
});

describe("replay (↺ Ulangi langkah ini)", () => {
  it("plays the current step again from its start, also from a pause, and plays on", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq);
    const at = firstIdx(seq, "structure");
    r.send({ type: "start", from: at, reason: "continue" });
    const first = r.s.activity;
    expect(first?.kind).toBe("read");
    // Read on a little (a long structure line has several parts), then replay.
    r.send(end(r.s.activity!));
    r.send({ type: "replay" });
    expect(r.s.idx).toBe(at);
    expect(r.s.phase).toBe("running");
    expect(r.s.part).toBe(0);
    expect(r.s.activity).toMatchObject({ kind: "read", ms: first?.kind === "read" ? first.ms : -1 });
    expect(r.s.activity!.token).toBeGreaterThan(first!.token);
    // From a pause: it plays (no "Kita lanjutkan" first), from the start.
    r.send({ type: "pause" });
    expect(r.s.phase).toBe("paused");
    r.send({ type: "replay" });
    expect(r.s.phase).toBe("running");
    expect(r.s.caption).toEqual({ c: 0 });
    expect(r.s.part).toBe(0);
  });

  it("replays a recitation step with the imam from the start, and does nothing before the start or after the end", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq);
    r.send({ type: "start", from: 1, reason: "continue" });
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", resume: false });
    r.send({ type: "pause" });
    r.send({ type: "replay" });
    expect(r.s.activity).toMatchObject({ kind: "recite", target: "ayah", resume: false });
    const idle = createAutoplayState(seq);
    expect(reduceAutoplay(seq, idle, { type: "replay" })).toBe(idle);
    const finished = { ...createAutoplayState(seq), started: true, phase: "finished" as const, intent: seq.nav };
    expect(reduceAutoplay(seq, finished, { type: "replay" })).toBe(finished);
  });

  it("starts an exercise over at its first control", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = runner(seq);
    const at = firstIdx(seq, "exercise");
    const key = seq.steps[at].exercise!.key;
    const parts = seq.steps[at].exercise!.parts;
    r.send({ type: "start", from: at, reason: "continue" });
    r.send({ type: "exercise_guide", target: `exercise:${key}:${parts[1]}` });
    expect(r.s.exercise?.part).toBe(parts[1]);
    r.send({ type: "replay" });
    expect(r.s.idx).toBe(at);
    expect(r.s.exercise?.part).toBe(parts[0]);
    expect(r.s.exercise?.reminders).toBe(0);
    expect(r.s.lastPart[key]).toBeUndefined();
    // It opens with the exercise's introduction again.
    expect(r.s.caption).toEqual({ c: 0 });
  });
});

describe("the manifest contract (display, highlight, focus, tokens)", () => {
  const audio = { url: "/belajar/media/narration/kang-nandar/al-fatihah/al-fatihah__1__w1.mp3", ms: 4000, sha256: "c".repeat(64) };

  it("reads display, highlight, focus and tokens, and refuses malformed ones", () => {
    const ok = parseNarrationManifest({
      version: 1,
      voice: { id: "aK834gEOxQEtviMPgurT", name: "Kang Nandar", model: "eleven_v3" },
      lines: {
        "al-fatihah:1:w1": {
          text: "Akhirnya dibaca كَسْرَة.",
          display: "Akhirnya dibaca kasrah (كَسْرَة).",
          highlight: [1],
          focus: "1:1:1",
          audio,
          tokens: [
            { t: "Akhirnya", s: 0, e: 0.4 },
            { t: "dibaca", s: 0.5, e: 0.9 },
            { t: "kasrah (كَسْرَة).", s: 1, e: 1.6 },
          ],
        },
      },
    });
    expect(ok.problems).toEqual([]);
    expect(ok.manifest?.lines["al-fatihah:1:w1"].focus).toBe("1:1:1");
    expect(lineDisplay(ok.manifest, "al-fatihah:1:w1")).toBe("Akhirnya dibaca kasrah (كَسْرَة).");
    expect(lineSegments(ok.manifest, "al-fatihah:1:w1")[0].words).toEqual([
      ["Akhirnya", 0, 400],
      ["dibaca", 500, 900],
      ["kasrah (كَسْرَة).", 1000, 1600],
    ]);
    const bad = parseNarrationManifest({
      version: 1,
      voice: null,
      lines: {
        "a:1:intro": { text: "x", display: "" },
        "a:1:recite": { text: "x", highlight: [1.5] },
        "a:1:w1": { text: "x", focus: "kata pertama" },
        "a:1:w2": { text: "x", tokens: [{ t: "x", s: 0, e: 1 }] },
        "a:1:w3": { text: "x", audio, tokens: [{ t: "x", s: 1, e: 0.5 }] },
      },
    });
    expect(bad.problems.join("\n")).toMatch(/a:1:intro: display/);
    expect(bad.problems.join("\n")).toMatch(/a:1:recite: highlight/);
    expect(bad.problems.join("\n")).toMatch(/a:1:w1: focus/);
    expect(bad.problems.join("\n")).toMatch(/a:1:w2: tokens without audio/);
    expect(bad.problems.join("\n")).toMatch(/a:1:w3: tokens must be/);
  });

  it("takes the caption from the display, the marks from highlight / focus", () => {
    const narration: NarrationManifest = {
      version: 1,
      voice: null,
      lines: {
        "al-fatihah:2:intro": { text: "Ayat kedua.", display: "Ayat kedua.", highlight: [0] },
        "al-fatihah:2:w1": { text: "Kata pertama.", display: "Kata pertama, idhafah (إِضَافَة).", highlight: [1, 2], focus: "1:2:1" },
      },
    };
    const seq = seqFor("al-fatihah", 2, { narration });
    const intro = seq.steps[0].cues[0];
    expect(intro.highlight).toEqual([1, 2, 3, 4]);
    const w1 = seq.steps.find((x) => x.id === "w1")!.cues[0];
    expect(w1.caption).toBe("Kata pertama, idhafah (إِضَافَة).");
    expect(w1.highlight).toEqual([1, 2]);
    expect(w1.focus).toBe(1);
    // A line the manifest lacks keeps the engine's caption (no Arabic).
    const w2 = seq.steps.find((x) => x.id === "w2")!.cues[0];
    expect(w2.display).toBeNull();
    expect(w2.caption).not.toMatch(/[\u0600-\u06FF]/);
  });
});

describe("the pronunciation dictionary", () => {
  const dictFile = join(CONTENT, "../pipeline/authored/pronunciation.json");
  const real = existsSync(dictFile) ? parsePronunciation(JSON.parse(readFileSync(dictFile, "utf8"))) : null;
  const term = (t: string, speak: string, display: string) => ({ term: t, speak, display });
  const dict = {
    terms: [
      term("كَسْرَة", "كَسْرَة", "kasrah (كَسْرَة)"),
      term("حَرْف جَرّ", "حَرْف جَرّ", "huruf jar (حَرْف جَرّ)"),
      term("حَرْف", "حَرْف", "huruf (حَرْف)"),
      term("بَاء", "بَاء", "ba’ (بِ)"),
      term("إِضَافَة", "idhofah", "idhafah (إِضَافَة)"),
      term("Allah", "Alloh", "Allah"),
    ],
  };
  const guard = quranTokenSet(input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => w.translit))));

  it("the operator's dictionary reads without problems, and has no term that is a word of the lessons", () => {
    expect(real?.problems ?? []).toEqual([]);
    expect(real?.dict?.terms.some((t) => t.speak === "عَلَى")).not.toBe(true);
  });

  it("refuses a heavy letter before fathah/alif spoken from Arabic script", () => {
    const r = parsePronunciation({ terms: [term("ضَمَّة", "ضَمَّة", "dhammah (ضَمَّة)"), term("ضَمِير", "dhomir", "dhamir (ضَمِير)")] });
    expect(r.problems.join(" ")).toMatch(/ضَمَّة.*respelling/);
    expect(r.problems.join(" ")).not.toMatch(/ضَمِير/);
  });

  it("allows Arabic in spoken text only as a dictionary term", () => {
    expect(spokenTextProblems("Akhirnya dibaca كَسْرَة, karena didahului حَرْف جَرّ, yaitu huruf بَاء.", guard, dict)).toEqual([]);
    expect(spokenTextProblems("Sandaran ini disebut idhofah, seperti nama Alloh.", guard, dict)).toEqual([]);
    expect(spokenTextProblems("Kata الحمد ini.", guard, dict)).toContain("Arabic script outside the pronunciation dictionary");
    // A term glued into a longer Arabic word is not the term.
    expect(spokenTextProblems("Ini حَرْفِيّ.", guard, dict)).toContain("Arabic script outside the pronunciation dictionary");
    // Without the dictionary any Arabic is refused.
    expect(spokenTextProblems("Akhirnya dibaca كَسْرَة.", guard)).toContain("Arabic script");
  });

  it("captions show a dictionary display form or the lesson's own Arabic, never a spoken-only form", () => {
    const allowed = [...dict.terms.map((t) => t.display), "بِسْمِ", "ٱللَّهِ"].join(" | ");
    expect(captionArabicProblems("Akhirnya kasrah (كَسْرَة), huruf jar (حَرْف جَرّ) ba’ (بِ).", dict, allowed)).toEqual([]);
    expect(captionArabicProblems("Kata pertama: بِسْمِ.", dict, allowed)).toEqual([]);
    expect(captionArabicProblems("huruf بَاء", dict, allowed).join(" ")).toMatch(/spoken-only/);
    expect(captionArabicProblems("kata الرحمن", dict, allowed).join(" ")).toMatch(/neither the dictionary nor the lesson/);
    expect(captionArabicProblems("tanpa huruf Arab", null, allowed)).toEqual([]);
  });

  it("drops the Arabic for a screen reader", () => {
    expect(withoutArabic("Akhirnya kasrah (كَسْرَة), karena didahului huruf jar (حَرْف جَرّ) ba’ (بِ).")).toBe(
      "Akhirnya kasrah, karena didahului huruf jar ba’.",
    );
    expect(withoutArabic("Tanpa Arab.")).toBe("Tanpa Arab.");
  });
});

describe("autoplay timing", () => {
  it("shows a long line's caption parts in proportion to the audio", () => {
    const parts = ["a".repeat(100), "b".repeat(300)];
    expect(partAt(parts, 0, 4000)).toBe(0);
    expect(partAt(parts, 999, 4000)).toBe(0);
    expect(partAt(parts, 1001, 4000)).toBe(1);
    expect(partAt(parts, 9999, 4000)).toBe(1);
    expect(partAt(["x"], 500, 1000)).toBe(0);
  });

  it("reads at the lesson pace (Tunggu saya reads unheld lines at Biasa)", () => {
    expect(readMs("x".repeat(180), "biasa")).toBe(captionMs("x".repeat(180), "biasa"));
    expect(readMs("x".repeat(180), "pelan")).toBe(captionMs("x".repeat(180), "pelan"));
    expect(readMs("x".repeat(180), "tunggu")).toBe(captionMs("x".repeat(180), "biasa"));
  });
});

// Every Al-Fatihah word has a composition since 2026-10-10 (29 words, 162 compose/primer lines):
// the full runs take ~1.1 s alone but 8–13 s beside the waris suite's workers, past vitest's 5 s.
const FULL_RUN_TIMEOUT_MS = 60_000;

describe("autoplay checks (every ayah of every surah)", () => {
  it(
    "pass: sequences, narration manifests, full runs and property runs",
    () => {
      const report = runAutoplayChecks(input);
      for (const n of report.notes) console.info(`autoplay-check note: ${n}`);
      expect(report.errors).toEqual([]);
      expect(report.stats.ayat).toBe(22);
      expect(report.stats.simulatedEvents).toBeGreaterThan(10_000);
    },
    FULL_RUN_TIMEOUT_MS,
  );
});
