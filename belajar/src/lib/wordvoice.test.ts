import { describe, expect, it } from "vitest";

import alFalaq from "../../content/al-falaq.json";
import alFatihah from "../../content/al-fatihah.json";
import alIkhlas from "../../content/al-ikhlas.json";
import anNas from "../../content/an-nas.json";
import manifest from "../../content/wordvoice.json";
import library from "../../content/library.json";

import { plainLetters, voiceFrom, type WordVoiceManifest } from "./wordvoice";

const M = manifest as WordVoiceManifest;
const lessonWords = [alFatihah, alIkhlas, alFalaq, anNas].flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => ({ loc: w.loc, ar: w.ar }))));

describe("the plain-letter rule (pipeline/wordvoice.py plain)", () => {
  it("turns the marks the voice model does not know into plain letters", () => {
    expect(plainLetters("ٱل")).toBe("ال");
    expect(plainLetters("مٰ")).toBe("ما");
    expect(plainLetters("لۡ")).toBe("لْ");
    expect(plainLetters("لۖم")).toBe("لم");
  });

  it("is the Python rule: every text the builder keyed is already plain, and every content word lands on a key", () => {
    for (const t of Object.keys(M.words)) expect(plainLetters(t), t).toBe(t);
    for (const w of lessonWords) expect(M.words[plainLetters(w.ar)], w.loc).toBeDefined();
    for (const [loc, ar] of Object.entries(library.quran as Record<string, string>)) expect(M.words[plainLetters(ar)], loc).toBeDefined();
  });
});

describe("a word's recording as a Clip", () => {
  const sample: WordVoiceManifest = { words: { "ال": { audio: { url: "/belajar/media/narration/kang-nandar/words/x.mp3", ms: 950, sha256: "ab".repeat(32) } }, "ب": {} } };

  it("is the whole file, from 0 to its length, found through the plain letters", () => {
    expect(voiceFrom(sample, "ٱل")).toEqual({ url: "/belajar/media/narration/kang-nandar/words/x.mp3", start: 0, end: 950 });
  });

  it("is null for a text with no recording yet, and for one the manifest does not have", () => {
    expect(voiceFrom(sample, "ب")).toBeNull();
    expect(voiceFrom(sample, "س")).toBeNull();
  });
});
