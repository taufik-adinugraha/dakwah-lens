import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Ayah } from "@/content/schema";
import {
  buildAutoplaySequence,
  captionArabicProblems,
  createAutoplayState,
  ID_TEXTS,
  parsePronunciation,
  quranTokenSet,
  reduceAutoplay,
  spokenTextProblems,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type NarrationManifest,
} from "@/lib/autoplay";
import { splitCaption } from "@/lib/lessonSteps";

import { CaptionView } from "./CaptionView";
import {
  captionText,
  karaokeAt,
  lineVoiced,
  playingWords,
  srAnnouncement,
  stageCaption,
  stageMarks,
  type VoicePos,
} from "./caption";

const CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(`${CONTENT}${rel}`, "utf8")) as unknown;

const surah = json("al-ikhlas.json") as { slug: string; name_id: string; ayat: Ayah[] };
const fatihah = json("al-fatihah.json") as { slug: string; name_id: string; ayat: Ayah[] };
const manifest = json("narration/al-ikhlas.json") as NarrationManifest;
const shared = json("narration/shared.json") as NarrationManifest;
const DICT_PATH = `${CONTENT}../pipeline/authored/pronunciation.json`;
const dict = existsSync(DICT_PATH) ? parsePronunciation(JSON.parse(readFileSync(DICT_PATH, "utf8"))).dict : null;

/** The real manifest with a (synthetic, same-origin) audio file on every line. */
function voicedCopy(m: NarrationManifest, ms = 4000): NarrationManifest {
  const lines: NarrationManifest["lines"] = {};
  for (const [id, l] of Object.entries(m.lines)) {
    lines[id] = {
      ...l,
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

const AUDIO = { url: "/belajar/media/narration/test/x.mp3", ms: 3000, sha256: "b".repeat(64) };

/** Al-Fatihah 1 with hand-made lines in the manifest contract (display,
 *  highlight, focus, tokens), everything else caption-only. */
function contractSequence(lines: NarrationManifest["lines"], sharedLines: NarrationManifest["lines"] = {}): AutoplaySequence {
  const a = fatihah.ayat[0];
  return buildAutoplaySequence({
    slug: fatihah.slug,
    surahName: fatihah.name_id,
    ayahCount: fatihah.ayat.length,
    ayah: a,
    introduced: [],
    exercises: [],
    texts: ID_TEXTS,
    narration: { version: 1, voice: { id: "v", name: "Kang Nandar", model: "eleven_v3" }, lines },
    shared: { version: 1, voice: { id: "v", name: "Kang Nandar", model: "eleven_v3" }, lines: sharedLines },
  });
}

const run = (seq: AutoplaySequence, s: AutoplayState, ...events: AutoplayEvent[]) =>
  events.reduce((acc, e) => reduceAutoplay(seq, acc, e), s);

const endOf = (s: AutoplayState): AutoplayEvent => {
  const a = s.activity;
  if (!a) return { type: "next" };
  return a.kind === "narrate"
    ? { type: "narration_end", token: a.token }
    : a.kind === "recite"
      ? { type: "recite_end", token: a.token }
      : { type: "timer", token: a.token };
};

describe("stage caption", () => {
  it("caption-only: shows the engine's caption part (reading-time paced)", () => {
    const seq = sequence(false);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    expect(s.activity?.kind).toBe("read");
    const c = stageCaption(seq, s, null);
    expect(c).toEqual({ kind: "text", text: splitCaption(ID_TEXTS.shared.start)[0], emphasis: [], voiced: false });
  });

  it("with narration audio and no word timings: the caption text, its part following the audio clock", () => {
    const long = "Kalimat pertama yang cukup panjang untuk dipotong. ".repeat(8).trim();
    const seq = contractSequence({}, { "shared:start": { text: long, display: long, audio: { ...AUDIO, ms: 8000 } } });
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    const a = s.activity;
    expect(a?.kind).toBe("narrate");
    if (a?.kind !== "narrate") return;
    const parts = splitCaption(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(stageCaption(seq, s, null)).toEqual({ kind: "text", text: parts[0], emphasis: [], voiced: true });
    const late = { token: a.token, line: a.line, ms: a.totalMs - 1, totalMs: a.totalMs };
    expect(captionText(stageCaption(seq, s, late))).toBe(parts[parts.length - 1]);
    // A clock left over from another activity is ignored.
    expect(captionText(stageCaption(seq, s, { ...late, token: a.token - 1 }))).toBe(parts[0]);
    // After the line (the settle pause), the last part stays.
    const after = run(seq, s, { type: "narration_end", token: a.token });
    expect(after.activity?.kind).toBe("wait");
    expect(captionText(stageCaption(seq, after, { ...late, ms: a.totalMs }))).toBe(parts[parts.length - 1]);
  });

  it("karaoke: the word the narrator says is lit, the ones said normal, the rest to come", () => {
    const tokens = [
      { t: "Akhirnya", s: 0, e: 0.5 },
      { t: "dibaca", s: 0.6, e: 1 },
      { t: "kasrah (كَسْرَة).", s: 1.1, e: 1.8 },
    ];
    const seq = contractSequence({
      "al-fatihah:1:intro": { text: "Akhirnya dibaca كَسْرَة.", display: "Akhirnya dibaca kasrah (كَسْرَة).", audio: AUDIO, tokens },
    });
    const s = run(seq, createAutoplayState(seq), { type: "start", reason: "continue" });
    const a = s.activity;
    expect(a?.kind).toBe("narrate");
    if (a?.kind !== "narrate") return;
    expect(playingWords(seq, s)).toEqual([
      ["Akhirnya", 0, 500],
      ["dibaca", 600, 1000],
      ["kasrah (كَسْرَة).", 1100, 1800],
    ]);
    // Before the first position report: nothing said yet.
    expect(stageCaption(seq, s, null)).toMatchObject({ kind: "karaoke", now: -1, said: 0, voiced: true });
    const at = (ms: number): VoicePos => ({ token: a.token, line: a.line, file: a.file, ...karaokeAt(playingWords(seq, s) ?? [], ms) });
    expect(stageCaption(seq, s, null, at(700))).toMatchObject({ kind: "karaoke", now: 1, said: 2 });
    // Between two words the last one stays lit (no flicker).
    expect(stageCaption(seq, s, null, at(1050))).toMatchObject({ now: 1, said: 2 });
    // A position from another activity is ignored.
    expect(stageCaption(seq, s, null, { ...at(1500), token: a.token - 1 })).toMatchObject({ now: -1, said: 0 });
    // The file ended: every word said, none lit — kept through the settle pause.
    const after = run(seq, s, { type: "narration_end", token: a.token });
    const done: VoicePos = { token: a.token, line: a.line, file: a.file, now: -1, said: Number.MAX_SAFE_INTEGER };
    expect(stageCaption(seq, after, null, done)).toMatchObject({ kind: "karaoke", now: -1, said: Number.MAX_SAFE_INTEGER });
    // Paused mid-line: the place stays where the narrator stopped.
    const paused = run(seq, s, { type: "pause" });
    expect(stageCaption(seq, paused, null, at(1200))).toMatchObject({ kind: "karaoke", now: 2, said: 3 });
  });

  it("karaoke: each word carries the emphasis of the display it says, across a split line's files", () => {
    // Operator 2026-10-11 ("use bold text or different color to highlight the meanings"): the
    // tokens have no quotes, the display does; a split line ("<id>:a", ":b") is aligned whole.
    const words = (text: string, from = 0) => text.split(" ").map((t, i) => ({ t, s: from + i * 0.5, e: from + i * 0.5 + 0.4 }));
    const seq = contractSequence({
      "al-fatihah:1:w1": {
        text: "Kata pertama artinya: dengan nama.",
        display: "Kata pertama artinya: “dengan nama”.",
        audio: AUDIO,
        tokens: words("Kata pertama artinya: dengan nama."),
      },
      "al-fatihah:1:intro:a": {
        text: "Kata ini disebut مَجْرُور dan bunyinya",
        display: "Kata ini disebut majrur (مَجْرُور) dan bunyinya",
        audio: AUDIO,
        tokens: words("Kata ini disebut majrur (مَجْرُور) dan bunyinya").filter((w) => w.t !== "(مَجْرُور)").map((w) => (w.t === "majrur" ? { ...w, t: "majrur (مَجْرُور)" } : w)),
      },
      "al-fatihah:1:intro:b": { text: "i.", display: "i.", audio: AUDIO, tokens: words("i.") },
    });
    const intro = seq.steps[0].cues[0];
    expect(intro.display).toBe("Kata ini disebut majrur (مَجْرُور) dan bunyinya i.");
    let s = run(seq, createAutoplayState(seq), { type: "start", reason: "continue" });
    let c = stageCaption(seq, s, null);
    expect(c).toMatchObject({ kind: "karaoke", emph: [null, null, null, "term", null, null] });
    // The second file of the line: its sound came from the first file's "bunyinya".
    s = run(seq, s, endOf(s));
    expect(s.activity?.kind).toBe("narrate");
    c = stageCaption(seq, s, null);
    expect(c).toMatchObject({ kind: "karaoke", words: [["i.", 0, 400]], emph: ["sound"] });
    const w1 = seq.steps.find((x) => x.id === "w1")!;
    const at = run(seq, createAutoplayState(seq), { type: "start", from: seq.steps.indexOf(w1), reason: "continue" });
    expect(stageCaption(seq, at, null)).toMatchObject({ kind: "karaoke", emph: [null, null, null, "meaning", "meaning"] });
  });

  it("text caption: its part's slice of the whole line's emphasis — every meaning of the line, each in its part", () => {
    // A caption emphasises every meaning (operator 2026-10-13, plan L22; its first one only until
    // then, so the last part here showed its sound and left “bagi” plain).
    const long = `Kata pertama artinya: “dengan nama”. ${"Kalimat penjelas yang cukup panjang untuk dipotong. ".repeat(4)}Huruf lam (لِ) yang artinya “bagi”, bunyinya i.`;
    const seq = contractSequence({}, { "shared:start": { text: long, display: long, audio: { ...AUDIO, ms: 8000 } } });
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    const a = s.activity;
    if (a?.kind !== "narrate") throw new Error("no narration");
    const parts = splitCaption(long);
    const first = stageCaption(seq, s, null);
    const last = stageCaption(seq, s, { token: a.token, line: a.line, ms: a.totalMs - 1, totalMs: a.totalMs });
    if (first.kind !== "text" || last.kind !== "text") throw new Error("not text");
    expect(first.emphasis.map((e) => first.text.slice(e.from, e.to))).toEqual(["“dengan nama”"]);
    expect(last.text).toBe(parts[parts.length - 1]);
    expect(last.emphasis.map((e) => [e.kind, last.text.slice(e.from, e.to)])).toEqual([
      ["meaning", "“bagi”"],
      ["sound", "i"],
    ]);
    // CaptionView draws exactly those.
    const html = renderToStaticMarkup(createElement(CaptionView, { caption: last }));
    expect([...html.matchAll(/data-emph="(\w+)"/g)].map((m) => m[1])).toEqual(["meaning", "sound"]);
  });

  it("CaptionView: an emphasised word keeps its weight in every state; the word being said has no forest inside", () => {
    const words = [["Bunyinya", 0, 1], ["kasrah (كَسْرَة)", 1, 2], ["“dengan", 2, 3], ["u.", 3, 4]] as const;
    const emph = [null, "term", "meaning", "sound"] as const;
    const html = (now: number, said: number) =>
      renderToStaticMarkup(createElement(CaptionView, { caption: { kind: "karaoke", words, emph, now, said, voiced: true } }));
    /** The class list of word i, and the markup inside it. */
    const word = (markup: string, i: number) => {
      const spans = [...markup.matchAll(/<span data-karaoke="(now|said|later)"(?: data-emph="([a-z]+)")? class="([^"]*)">/g)];
      const start = spans[i].index! + spans[i][0].length;
      const end = i + 1 < spans.length ? spans[i + 1].index! : markup.length;
      return { state: spans[i][1], emph: spans[i][2] ?? null, cls: spans[i][3].replace(/&amp;/g, "&").split(" "), inner: markup.slice(start, end) };
    };
    for (let i = 0; i < words.length; i++) {
      const states = [html(-1, words.length), html(i, i + 1), html(-1, 0)].map((m) => word(m, i));
      expect(states.map((x) => x.state)).toEqual(["said", "now", "later"]);
      expect(states.map((x) => x.emph)).toEqual([emph[i], emph[i], emph[i]]);
      for (const x of states) expect(x.cls.includes("font-semibold"), `${words[i][0]} ${x.state}`).toBe(emph[i] !== null);
      const [said, now, later] = states;
      // Paper on forest whatever it is; nothing forest inside the fill (its Arabic would vanish).
      expect(now.cls).toEqual(expect.arrayContaining(["bg-forest", "text-paper"]));
      expect(now.inner).not.toContain("text-forest");
      // Before and after: a meaning in forest, a term's Arabic in forest, the rest ink / ink-soft.
      if (emph[i] === "meaning") for (const x of [said, later]) expect(x.cls).toContain("text-forest");
      else {
        expect(said.cls).toContain("text-ink");
        expect(later.cls).toContain("text-ink-soft");
      }
      if (emph[i] === "term") for (const x of [said, later]) expect(x.inner).toContain('class="arabic-inline text-ar-sm text-forest"');
      // Arabic is never bold.
      if (emph[i] !== null) expect(said.cls).toContain("[&_bdi]:font-normal");
    }
  });

  it("karaokeAt: the latest word started, lit until the next starts; the last goes out after it ends", () => {
    const w = [
      ["a", 100, 300],
      ["b", 400, 600],
    ] as const;
    expect(karaokeAt(w, 0)).toEqual({ now: -1, said: 0 });
    expect(karaokeAt(w, 150)).toEqual({ now: 0, said: 1 });
    expect(karaokeAt(w, 350)).toEqual({ now: 0, said: 1 });
    expect(karaokeAt(w, 450)).toEqual({ now: 1, said: 2 });
    expect(karaokeAt(w, 900)).toEqual({ now: 1, said: 2 });
    expect(karaokeAt(w, 2000)).toEqual({ now: -1, said: 2 });
  });

  it("caption-only with a display text: shows the display (dictionary forms), paced by reading time", () => {
    const display = "Akhirnya dibaca kasrah (كَسْرَة), karena didahului huruf jar (حَرْف جَرّ).";
    const seq = contractSequence({ "al-fatihah:1:intro": { text: "Akhirnya dibaca كَسْرَة, karena didahului حَرْف جَرّ.", display } });
    expect(seq.steps[0].cues[0].caption).toBe(display);
    expect(seq.steps[0].cues[0].display).toBe(display);
    const s = run(seq, createAutoplayState(seq), { type: "start", reason: "continue" });
    expect(s.activity?.kind).toBe("read");
    expect(stageCaption(seq, s, null)).toEqual({ kind: "text", text: display, emphasis: [], voiced: false });
    // The screen reader hears it without the Arabic.
    expect(srAnnouncement(seq, s, false)).toBe("Akhirnya dibaca kasrah, karena didahului huruf jar.");
  });

  it("falls back to the caption when a line's audio fails", () => {
    const seq = sequence(true);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    const token = s.activity?.token ?? -1;
    const failed = run(seq, s, { type: "narration_error", token });
    const c = stageCaption(seq, failed, null);
    expect(c.voiced).toBe(false);
    expect(c.kind).toBe("text");
    expect(lineVoiced(seq, failed)).toBe(false);
  });

  it("shows Arabic only as a dictionary display form or the lesson's own words, voiced or not", () => {
    const allowed = [
      ...(dict?.terms.map((t) => t.display) ?? []),
      ...surah.ayat.flatMap((a) => a.words.map((w) => w.ar)),
    ].join(" | ");
    for (const voiced of [false, true]) {
      const seq = sequence(voiced);
      let s = run(seq, createAutoplayState(seq), { type: "start" });
      for (let i = 0; i < 400 && s.phase !== "finished"; i++) {
        const text = captionText(stageCaption(seq, s, null));
        expect(captionArabicProblems(text, dict, allowed), text).toEqual([]);
        s = run(seq, s, endOf(s));
      }
      expect(s.phase).toBe("finished");
    }
  });
});

describe("what the mushaf line marks, and the word card", () => {
  const seq = sequence(false);
  const words = surah.ayat[0].words.length;
  const all = Array.from({ length: words }, (_, i) => i + 1);
  const at = (id: string) => {
    const idx = seq.steps.findIndex((x) => x.id === id);
    return run(seq, createAutoplayState(seq), { type: "start", from: idx, reason: "continue" });
  };

  it("marks nothing before the start", () => {
    expect(stageMarks(seq, createAutoplayState(seq))).toEqual({ marked: [], focus: null });
  });

  it("the whole ayah for the intro, the word for its explanation and recitation, the imam's word only while he recites", () => {
    expect(stageMarks(seq, at("intro"))).toEqual({ marked: all, focus: null });
    expect(stageMarks(seq, at("w2"))).toEqual({ marked: [2], focus: 2 });
    const word = at("w2:recite");
    expect(word.activity?.kind).toBe("recite");
    expect(stageMarks(seq, word)).toEqual({ marked: [2], focus: 2 });
    // The recitation step: its lead line is read while the imam recites
    // (caption-only), so only his current word is lit.
    const ayah = at("recite");
    expect(ayah.activity?.kind).toBe("recite");
    expect(stageMarks(seq, ayah)).toEqual({ marked: [], focus: null });
  });

  it("follows the manifest: [0] is the whole ayah, focus is a word loc of this ayah", () => {
    const a = fatihah.ayat[0];
    const contract = contractSequence({
      "al-fatihah:1:intro": { text: "x", display: "x", highlight: [0], focus: null },
      "al-fatihah:1:w2": { text: "y", display: "y", highlight: [1, 2], focus: a.words[2].loc },
      "al-fatihah:1:w3": { text: "z", display: "z", highlight: [], focus: "2:1:1" },
    });
    const cues = Object.fromEntries(contract.steps.flatMap((x) => x.cues.map((c) => [c.line, c])));
    expect(cues["al-fatihah:1:intro"].highlight).toEqual(a.words.map((_, i) => i + 1));
    expect(cues["al-fatihah:1:intro"].focus).toBeNull();
    expect(cues["al-fatihah:1:w2"].highlight).toEqual([1, 2]);
    expect(cues["al-fatihah:1:w2"].focus).toBe(3);
    // Another ayah's word is not on screen: no card.
    expect(cues["al-fatihah:1:w3"].focus).toBeNull();
    expect(cues["al-fatihah:1:w3"].highlight).toEqual([]);
    // No manifest field: by the line's kind.
    expect(cues["al-fatihah:1:w4"].highlight).toEqual([4]);
    expect(cues["al-fatihah:1:w4"].focus).toBe(4);
  });

  it("a step shown paused (browsing with ‹ / ›) is about what its first line is about", () => {
    const st = at("intro");
    const paused = run(seq, st, { type: "pause" }, { type: "next" }, { type: "next" }, { type: "next" });
    expect(paused.phase).toBe("paused");
    expect(seq.steps[paused.idx].id).toBe("w1");
    expect(paused.caption).toBe("step");
    expect(stageMarks(seq, paused)).toEqual({ marked: [1], focus: 1 });
  });

  it("marks nothing during an exercise or a shared line, and keeps the explained word's card", () => {
    const st = at("w1");
    const paused = run(seq, st, { type: "pause" });
    const resumed = run(seq, paused, { type: "resume" });
    expect(resumed.caption).toEqual({ s: "resume" });
    expect(stageMarks(seq, resumed)).toEqual({ marked: [], focus: 1 });
  });
});

describe("screen-reader announcement", () => {
  it("announces the line without Arabic or a lesson word, and nothing over the imam", () => {
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
      expect(spokenTextProblems(said || "x", guard, dict).join(" "), said).not.toMatch(/transliterated/);
      if (seq.steps[s.idx].cues.some((c) => c.display !== null)) expect(said).not.toMatch(/[؀-ۿ]/);
      s = run(seq, s, endOf(s));
    }
    expect(sawRecite).toBe(true);
  });

  it("stays silent while narration audio speaks", () => {
    const seq = sequence(true);
    const s = run(seq, createAutoplayState(seq), { type: "start" });
    expect(srAnnouncement(seq, s, true)).toBe("");
  });
});
