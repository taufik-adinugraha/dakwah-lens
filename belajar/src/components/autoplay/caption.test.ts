import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Ayah } from "@/content/schema";
import {
  buildAutoplaySequence,
  createAutoplayState,
  ID_TEXTS,
  quranTokenSet,
  reduceAutoplay,
  spokenTextProblems,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type NarrationManifest,
} from "@/lib/autoplay";
import { splitCaption } from "@/lib/lessonSteps";

import { srAnnouncement, stageCaption } from "./caption";

const CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(`${CONTENT}${rel}`, "utf8")) as unknown;

const surah = json("al-ikhlas.json") as { slug: string; name_id: string; ayat: Ayah[] };
const manifest = json("narration/al-ikhlas.json") as NarrationManifest;
const shared = json("narration/shared.json") as NarrationManifest;

/** The real manifest with a (synthetic, same-origin) audio file on every line. */
function voicedCopy(m: NarrationManifest, ms = 4000): NarrationManifest {
  const lines: NarrationManifest["lines"] = {};
  for (const [id, l] of Object.entries(m.lines)) {
    lines[id] = {
      text: l.text,
      audio: { url: `/belajar/media/narration/test/${id.replaceAll(":", "__")}.mp3`, ms, sha256: "a".repeat(64) },
    };
  }
  return { version: 1, voice: { id: "test", name: "Test", model: "eleven_v3" }, lines };
}

function sequence(voiced: boolean): AutoplaySequence {
  return buildAutoplaySequence({
    slug: surah.slug,
    surahName: surah.name_id,
    ayahCount: surah.ayat.length,
    ayah: surah.ayat[0],
    introduced: [],
    exercises: [],
    texts: ID_TEXTS,
    narration: voiced ? voicedCopy(manifest) : null,
    shared: voiced ? voicedCopy(shared) : null,
  });
}

const run = (seq: AutoplaySequence, s: AutoplayState, ...events: AutoplayEvent[]) =>
  events.reduce((acc, e) => reduceAutoplay(seq, acc, e), s);

describe("stage caption", () => {
  it("caption-only: shows the engine's caption part (reading-time paced)", () => {
    const seq = sequence(false);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    expect(s.activity?.kind).toBe("read");
    const c = stageCaption(seq, s, null);
    expect(c.voiced).toBe(false);
    expect(c.text).toBe(splitCaption(ID_TEXTS.shared.start)[0]);
  });

  it("with narration audio: shows the spoken text, its part following the audio clock", () => {
    const seq = sequence(true);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    const a = s.activity;
    expect(a?.kind).toBe("narrate");
    if (a?.kind !== "narrate") return;
    const parts = splitCaption(shared.lines["shared:start"].text);
    expect(parts.length).toBeGreaterThan(1);
    expect(stageCaption(seq, s, null)).toEqual({ text: parts[0], voiced: true });
    const late = { token: a.token, line: a.line, ms: a.totalMs - 1, totalMs: a.totalMs };
    expect(stageCaption(seq, s, late).text).toBe(parts[parts.length - 1]);
    // A clock left over from another activity is ignored.
    expect(stageCaption(seq, s, { ...late, token: a.token - 1 }).text).toBe(parts[0]);
    // After the line (the settle pause), the last part stays.
    const after = run(seq, s, { type: "narration_end", token: a.token });
    expect(after.activity?.kind).toBe("wait");
    expect(stageCaption(seq, after, { ...late, ms: a.totalMs }).text).toBe(parts[parts.length - 1]);
  });

  it("falls back to the caption when a line's audio fails", () => {
    const seq = sequence(true);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    const token = s.activity?.token ?? -1;
    const failed = run(seq, s, { type: "narration_error", token });
    const c = stageCaption(seq, failed, null);
    expect(c.voiced).toBe(false);
    expect(c.text).toBe(splitCaption(ID_TEXTS.shared.start)[0]);
  });

  it("never shows Arabic script, voiced or not", () => {
    for (const voiced of [false, true]) {
      const seq = sequence(voiced);
      let s = run(seq, createAutoplayState(seq), { type: "start" });
      for (let i = 0; i < 400 && s.phase !== "finished"; i++) {
        expect(stageCaption(seq, s, null).text).not.toMatch(/[؀-ۿ]/);
        const a = s.activity;
        s = a
          ? run(seq, s, a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token })
          : run(seq, s, { type: "next" });
      }
      expect(s.phase).toBe("finished");
    }
  });
});

describe("screen-reader announcement", () => {
  it("announces the sanitised spoken text, never the caption's transliteration, and nothing over the imam", () => {
    const seq = buildAutoplaySequence({
      slug: surah.slug,
      surahName: surah.name_id,
      ayahCount: surah.ayat.length,
      ayah: surah.ayat[0],
      introduced: [],
      exercises: [],
      texts: ID_TEXTS,
      narration: manifest,
      shared,
    });
    const guard = quranTokenSet(surah.ayat.flatMap((a) => a.words.map((w) => w.translit)));
    let s = run(seq, createAutoplayState(seq), { type: "start" });
    let sawRecite = false;
    for (let i = 0; i < 400 && s.phase !== "finished"; i++) {
      const said = srAnnouncement(seq, s, false);
      if (s.activity?.kind === "recite") {
        sawRecite = true;
        expect(said).toBe("");
      }
      // The caption of a word step shows "Kata ke-1: qul"; the announcement never carries a lesson word.
      expect(spokenTextProblems(said || "x", guard).join(" "), said).not.toMatch(/transliterated/);
      const a = s.activity;
      s = a
        ? run(seq, s, a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token })
        : run(seq, s, { type: "next" });
    }
    expect(sawRecite).toBe(true);
  });

  it("stays silent while narration audio speaks", () => {
    const seq = sequence(true);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    expect(srAnnouncement(seq, s, true)).toBe("");
  });
});
