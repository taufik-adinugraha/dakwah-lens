import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { captionMs } from "../lessonSteps";
import { loadCheckInput, runAutoplayChecks } from "./checks";
import { availableExercises, timedWords } from "./exercises";
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
import { lineSegments, quranTokenSet, spokenTextProblems, wordRefs } from "./narration";
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
const lexicon = new Map(input.lexicon.map((l) => [l.id, l]));

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
    exercises: availableExercises({ words: ayah.words, timed: timedWords(ayah), lexeme: (id) => lexicon.get(id) }),
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
  for (const id of sequenceLineIds(seq)) {
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
    expect(seq.steps.filter((s) => s.kind === "exercise").map((s) => s.exercise?.key)).toEqual([
      "tap-word",
      "why-harakat",
      "sort-case",
      "label-role",
      "wazn-factory",
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
    expect(seq.steps[r.s.idx].exercise?.key).toBe("why-harakat");
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
    r.send({ type: "answered", key: "tap-word", correct: false });
    expect(r.s.caption).toEqual({ s: "try_again" });
    r.until((s) => s.phase === "waiting");
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

  it("Dengar dan ketuk: the lesson's imam recites the question's word, then reports it heard", () => {
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

  it("a pick before the imam finished: the feedback, then the word again", () => {
    const seq = seqFor("al-fatihah", 2);
    const r = waitingAt(seq);
    r.send({ type: "exercise_guide", target: "exercise:tap-word:play", word: 2 });
    expect(r.s.activity?.kind).toBe("recite");
    r.send({ type: "answered", key: "tap-word", correct: false });
    expect(r.s.caption).toEqual({ s: "try_again" });
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
    r.send({ type: "exercise_guide", target: "exercise:tap-word:next" });
    expect(r.s.caption).toEqual({ s: "revealed" });
    r.send(end(r.s.activity!));
    expect(r.s.activity).toMatchObject({ kind: "wait", ms: advanceHoldMs("biasa", false) });
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
    expect(spokenTextProblems("Coba kamu ketuk.", tokens).join(" ")).toMatch(/kamu/);
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

describe("autoplay checks (every ayah of every surah)", () => {
  it("pass: sequences, narration manifests, full runs and property runs", () => {
    const report = runAutoplayChecks(input);
    for (const n of report.notes) console.info(`autoplay-check note: ${n}`);
    expect(report.errors).toEqual([]);
    expect(report.stats.ayat).toBe(22);
    expect(report.stats.simulatedEvents).toBeGreaterThan(10_000);
  });
});
