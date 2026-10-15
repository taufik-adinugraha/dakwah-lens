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

  it("writes the long ī after a kasrah with a dotted ya, and leaves the long ā after a fathah", () => {
    expect(plainLetters("\u0630\u0650\u0649")).toBe("\u0630\u0650\u064a");
    expect(plainLetters("\u0647\u064f\u062f\u064e\u0649")).toBe("\u0647\u064f\u062f\u064e\u0649");
  });

  it("writes a ta marbuta that carries a vowel as the open ta, and leaves a stop", () => {
    expect(plainLetters("\u062c\u0650\u0646\u0651\u064e\u0629\u0650")).toBe("\u062c\u0650\u0646\u0651\u064e\u062a\u0650");
    expect(plainLetters("\u062c\u0646\u0629\u0652")).toBe("\u062c\u0646\u0629\u0652");
    expect(plainLetters("\u062c\u0646\u0629")).toBe("\u062c\u0646\u0629");
  });

  it("drops an alif wasla right after a long vowel, and keeps it after a consonantal waw", () => {
    expect(plainLetters("\u0641\u0650\u0649 \u0671\u0644\u0652\u0639\u064f\u0642\u064e\u062f\u0650")).toBe("\u0641\u0650\u064a \u0644\u0652\u0639\u064f\u0642\u064e\u062f\u0650");
    expect(plainLetters("\u0647\u064f\u0648\u064e \u0671\u0644\u0644\u0651\u064e\u0647\u064f")).toContain(" \u0627\u0644");
  });

  it("is the Python rule: every text the builder keyed is already plain, and every content word lands on a key", () => {
    for (const t of Object.keys(M.words)) expect(plainLetters(t), t).toBe(t);
    for (const w of lessonWords) expect(M.words[plainLetters(w.ar)], w.loc).toBeDefined();
    for (const [loc, ar] of Object.entries(library.quran as Record<string, string>)) expect(M.words[plainLetters(ar)], loc).toBeDefined();
  });
});

describe("a word's recording as a Clip", () => {
  const sample: WordVoiceManifest = { words: { "ال": { audio: { url: "/belajar/media/narration/kang-nandar/words/x.mp3", ms: 950, sha256: "ab".repeat(32) } }, "ب": {} } };

  it("is the whole file, from 0 to its length, found through the plain letters (the narrator's)", () => {
    expect(voiceFrom(sample, "ٱل")).toEqual({ url: "/belajar/media/narration/kang-nandar/words/x.mp3", start: 0, end: 950, source: "elevenlabs" });
  });

  it("is the word inside Quran.com's file, [start, end], for a word at its place (operator 2026-10-15)", () => {
    const qc: WordVoiceManifest = {
      words: { "ال": { source: "quran.com", loc: "1:2:1", audio: { url: "/belajar/media/narration/quran-com/wbw/001_002_001.mp3", ms: 1331, sha256: "ab".repeat(32), start: 328, end: 1316 } } },
    };
    expect(voiceFrom(qc, "ٱل")).toEqual({ url: "/belajar/media/narration/quran-com/wbw/001_002_001.mp3", start: 328, end: 1316, source: "quran.com" });
  });

  it("every lesson word is Quran.com's recording of its place; every Quran.com entry is one word, its loc a place of those bytes", () => {
    for (const w of lessonWords) expect(M.words[plainLetters(w.ar)]?.source, w.loc).toBe("quran.com");
    for (const [t, e] of Object.entries(M.words)) {
      if (e.source !== "quran.com") continue;
      expect(t.split(" "), t).toHaveLength(1);
      expect(e.loc, t).toMatch(/^\d{1,3}:\d{1,3}:\d{1,3}$/);
      expect(e.audio?.url, t).toMatch(/^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/);
    }
  });

  it("is null for a text with no recording yet, and for one the manifest does not have", () => {
    expect(voiceFrom(sample, "ب")).toBeNull();
    expect(voiceFrom(sample, "س")).toBeNull();
  });
});
