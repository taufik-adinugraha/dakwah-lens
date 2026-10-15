import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { clipKey } from "./clips";
import { SURAHS, WORD_AR } from "./content";
import { hasWaqfNote, signNotHeard, waqfDrop } from "./heard";
import { LIBRARY } from "./library";
import { QREF } from "./terms";
import { plainLetters, wordVoice } from "./wordvoice";

// What the learner HEARS (review 2026-10-12 of the example voices): the Harakat card for tanwin
// showed دٌ = d + un "dari أَحَدٌ (aḥadun)" and played "aḥad"; 47 of 200 concept example rows are an
// ayah's last word, several with a note about the very ending the imam does not pronounce there.
// An example is chosen and labelled by tajwid, not only by its bytes.
//
// Since 2026-10-14 the Konsep pages' word voices are the narrator's recordings of each word on its
// own (src/lib/wordvoice.ts), not cuts of the imam's recitation: a word is said whole whether or not
// it ends its ayah, and a base form is said as it is written. So the words here are about (a) the rule
// that still decides what the lesson says of an ayah's last word, which the imam recites on the
// stage's own player (waqfDrop, hasWaqfNote, examples.ts), (b) the Harakat card's choice of an example
// where its sign is heard (signNotHeard), and (c) that no Konsep button carries a note any more.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(BELAJAR, "pipeline/fixtures/clips_outside_lessons.json"), "utf8")) as {
  ayat: Record<string, { tanzil: string; segments: number[][] }>;
};
/** An ayah's words: a lesson's own, or the committed Tanzil line of an ayah outside the lessons. */
function tokensOf(s: number, a: number): string[] | null {
  const ayah = SURAHS.find((x) => x.surah === s)?.ayat.find((x) => x.ayah === a);
  if (ayah) return ayah.words.map((w) => w.ar);
  return FIXTURE.ayat[`${s}:${a}`]?.tanzil.split(" ") ?? null;
}
const isLast = (loc: string) => {
  const [s, a, w] = loc.split(":").map(Number);
  return tokensOf(s, a)?.length === w;
};

describe("what a pause drops (waqfDrop; pipeline/clips.py pause_drop is the same rule)", () => {
  it("a final short vowel or tanwin is not pronounced; a sukun or a long vowel loses nothing", () => {
    // the same words as pipeline/test_validate_clips.py test_what_a_pause_drops
    const cases: [string, ReturnType<typeof waqfDrop>][] = [
      ["1:5:4", "harakat"], // nasta‘īnu: heard "nasta‘īn"
      ["113:2:4", "harakat"], // khalaqa: heard "khalaq"
      ["112:1:4", "harakat"], // aḥadun: heard "aḥad"
      ["112:4:5", "harakat"], // aḥadun with the mushaf's small mim after the tanwin
      ["1:7:9", "harakat"], // aḍ-ḍāllīna
      ["112:3:4", "none"], // yūlad: a sukun, nothing to drop
      ["1:6:1", "none"], // ihdinā: a long vowel
      ["112:4:4", "other"], // kufuwan: fathatain, read ā at a pause
      ["112:4:3", "other"], // lahū: the pronoun's long vowel
    ];
    for (const [loc, want] of cases) expect(waqfDrop(WORD_AR[loc]), loc).toBe(want);
    expect(waqfDrop("")).toBe("none");
  });

  it("every lesson ayah ends in a word the note can describe: 21 lose their harakah, yūlad loses nothing", () => {
    const ends = SURAHS.flatMap((s) => s.ayat.map((a) => a.words[a.words.length - 1]));
    expect(ends).toHaveLength(22);
    expect(ends.filter((w) => waqfDrop(w.ar) !== "harakat").map((w) => w.loc)).toEqual(["112:3:4"]);
    expect(waqfDrop(WORD_AR["112:3:4"])).toBe("none");
  });
});

describe("the waqf note is decided from the data: `last` and the word's ending", () => {
  it("no Konsep clip is marked `last`: the narrator says a word whole, whether or not the ayah ends there", () => {
    let n = 0;
    for (const [key, c] of Object.entries(LIBRARY.clips)) {
      expect(c, key).not.toHaveProperty("last");
      expect(hasWaqfNote(c, LIBRARY.quran[key]), key).toBe(false);
      // count the words and runs that END their ayah (a letter or a part is no word's end), among the
      // ayat the content or the fixture holds: the imam would have stopped on each of them
      if (key.includes("#") || key.includes("/")) continue;
      const [s, a, w, w2] = key.split(/[:-]/).map(Number);
      if (tokensOf(s, a)?.length === (w2 ?? w)) n++;
    }
    expect(n).toBe(49);
  });

  it("planted: no `last`, no note; `last` on a word that loses nothing, no note; a run is judged by its last word", () => {
    const nastain = WORD_AR["1:5:4"];
    expect(hasWaqfNote({ last: true }, nastain)).toBe(true);
    expect(hasWaqfNote({}, nastain)).toBe(false); // the flag is the data: without it nothing is said
    expect(hasWaqfNote({ last: false }, nastain)).toBe(false);
    expect(hasWaqfNote(null, nastain)).toBe(false);
    expect(hasWaqfNote({ last: true }, undefined)).toBe(false);
    expect(hasWaqfNote({ last: true }, WORD_AR["112:3:4"])).toBe(false); // yūlad: heard as written
    expect(hasWaqfNote({ last: true }, `${WORD_AR["112:1:3"]} ${WORD_AR["112:1:4"]}`)).toBe(true); // … aḥadun
    expect(hasWaqfNote({ last: true }, `${WORD_AR["112:3:3"]} ${WORD_AR["112:3:4"]}`)).toBe(false); // … yūlad
  });

  it("47 of the 202 concept example rows are an ayah's last word, on 21 concept pages; 43 would have lost their harakah to the imam's stop, and none carries a note now", () => {
    const rows = LIBRARY.concepts.flatMap((c) => c.examples.map((e) => ({ id: c.id, loc: e.loc })));
    const last = rows.filter((r) => isLast(r.loc));
    expect(rows).toHaveLength(202); // 200 until ihdinā (1:6:1) joined jumlah fi'liyyah, 2026-10-13; ṣirāṭa (1:7:1) joined Kalimah 2026-10-14
    expect(last).toHaveLength(47);
    expect(new Set(last.map((r) => r.id)).size).toBe(21);
    // what the stop does to them: 43 lose a harakah or tanwin, yūlad (112:3:4) loses nothing
    expect(last.filter((r) => waqfDrop(WORD_AR[r.loc]) === "harakat")).toHaveLength(43);
    expect([...new Set(last.filter((r) => waqfDrop(WORD_AR[r.loc]) !== "harakat").map((r) => r.loc))]).toEqual(["112:3:4"]);
    // … but a row's button plays the narrator's whole word, which has no `last`: no note on any row
    for (const r of rows) {
      const clip = wordVoice(WORD_AR[r.loc]);
      expect(clip, `${r.id} ${r.loc}`).not.toBeNull();
      expect(hasWaqfNote(clip, WORD_AR[r.loc]), `${r.id} ${r.loc}`).toBe(false);
    }
  });
});

describe("a Harakat sign card's sign is heard where its example is (signNotHeard)", () => {
  const signs = LIBRARY.basics.flatMap((b) => b.signs);
  const place = (example: string) => {
    const m = QREF.exec(example)!;
    return { s: Number(m[1]), a: Number(m[2]), w: Number(m[3]), n: Number(m[6]) };
  };

  it("every sign card obeys the rule", () => {
    expect(signs).toHaveLength(8);
    for (const sg of signs) {
      const { s, a, w, n } = place(sg.example);
      const tokens = tokensOf(s, a);
      expect(tokens, sg.example).not.toBeNull();
      expect(signNotHeard(sg.marks, n, w, tokens!), `${sg.marks} ${sg.example}`).toBeNull();
      // and its word is not an ayah's last at all today, so no card needs the waqf line
      expect(isLast(clipKey(sg.example)!), sg.example).toBe(false);
      expect(LIBRARY.clips[clipKey(sg.example)!].last, sg.example).toBeUndefined();
    }
  });

  it("the three tanwin cards: each before a letter that keeps the n clear (izhar)", () => {
    const next = (example: string) => {
      const { s, a, w } = place(example);
      return tokensOf(s, a)![w];
    };
    const tanwin = signs.filter((sg) => sg.term === "tanwin");
    expect(tanwin.map((sg) => [sg.marks[0], sg.example])).toEqual([
      ["dhammatain", "q:97:5:1#3"], // salāmun hiya (was aḥadun, 112:1:4, the ayah's last word: heard "aḥad")
      ["fathatain", "q:112:4:4#3"], // kufuwan aḥad
      ["kasratain", "q:113:3:3#4"], // gāsiqin iżā
    ]);
    expect(tanwin.map((sg) => [...next(sg.example)][0])).toEqual(["\u0647", "\u0623", "\u0625"]); // ha', hamzah, hamzah
  });

  it("planted faults: each way a sign would not be heard", () => {
    const ikhlas1 = tokensOf(112, 1)!; // qul huwa Allāhu aḥadun
    expect(signNotHeard(["dhammatain"], 3, 4, ikhlas1)).toBe("tanwin-at-ayah-end"); // the card as it first shipped
    const baqarah5 = tokensOf(2, 5)!; // … ‘alā hudan min rabbihim …
    expect(signNotHeard(["fathatain"], 2, 3, baqarah5)).toBe("tanwin-not-izhar"); // hudan before mim: idgham
    const ikhlas2 = tokensOf(112, 2)!; // Allāhu aṣ-ṣamadu
    expect(signNotHeard(["dhammah"], 5, 2, ikhlas2)).toBe("last-letter-at-ayah-end"); // aṣ-ṣamadu: heard "aṣ-ṣamad"
    expect(signNotHeard(["fathah"], 4, 2, ikhlas2)).toBeNull(); // its mim: mid-word, heard
    expect(signNotHeard(["dhammah"], 4, 1, ikhlas2)).toBeNull(); // Allāhu, not the last word: heard
  });
});

describe("hamzat washal: a base-form tile is recorded on its own, so its alif is read and nothing needs saying", () => {
  const tiles = LIBRARY.parts.flatMap((p) => p.tiles.map((t) => ({ loc: p.loc, ...t })));
  /** The whole-word tiles that start with ٱ and are not their ayah's first word: the ones the imam's
   *  recitation reads without that alif (ismu after tabāraka, Allāhu after huwa). */
  const startsWithWasl = (t: (typeof tiles)[number]) => {
    const key = clipKey(t.q);
    const whole = key !== null && !t.q.includes("/");
    const [, , w] = (key ?? "0:0:0").split(":").map(Number);
    return whole && LIBRARY.quran[key!].startsWith("\u0671") && w > 1;
  };

  it("derived from the bytes: exactly the whole-word tiles that start with ٱ and are not their ayah's first word — ismu and Allāhu", () => {
    for (const t of tiles) expect(t.washal !== undefined, `${t.loc} ${t.q}`).toBe(startsWithWasl(t));
    expect(tiles.filter(startsWithWasl).map((t) => t.translit)).toEqual(["ismu", "Allāhu"]);
    // the build still records the run the imam would have played (library.json `washal`); the page
    // does not use it
    expect(tiles.filter((t) => t.washal).map((t) => [t.translit, t.washal])).toEqual([
      ["ismu", { run: "55:78:1-2", before: "tabāraka", heard: "tabārakasmu" }],
      ["Allāhu", { run: "112:1:2-3", before: "huwa", heard: "huwallāhu" }],
    ]);
  });

  it("each plays the recording of the form itself, with its alif written as a letter — not the run with the word before it", () => {
    for (const t of tiles.filter(startsWithWasl)) {
      const key = clipKey(t.q)!;
      const ar = LIBRARY.quran[key];
      // the voice model is sent the alif as a plain letter (src/lib/wordvoice-core.ts): "ismu", not "smu"
      expect(plainLetters(ar).startsWith("\u0627"), t.translit).toBe(true);
      const clip = wordVoice(ar);
      expect(clip, t.translit).not.toBeNull();
      expect(LIBRARY.clips[key], t.translit).toEqual(clip);
      // the run is another recording (a longer one), and the tile does not play it
      const run = LIBRARY.clips[t.washal!.run];
      expect(run, t.translit).toBeTruthy();
      expect(LIBRARY.clips[key], t.translit).not.toEqual(run);
      expect(run.end, t.translit).toBeGreaterThan(clip!.end);
      // the run's text is the word before it and the word, as the ayah writes them
      const [s, a, w] = key.split(":").map(Number);
      const tokens = tokensOf(s, a)!;
      expect(LIBRARY.quran[t.washal!.run], t.translit).toBe(`${tokens[w - 2]} ${tokens[w - 1]}`);
      expect(t.washal!.heard, t.translit).toBe(t.washal!.before + t.translit.slice(1));
    }
    // a lesson word before it brings the lesson's own transliteration
    expect(SURAHS.find((x) => x.surah === 112)!.ayat[0].words[1].translit).toBe("huwa");
  });

  it("no tile — a whole word or a part — is said with a stop or a run: every tile's voice is its own text, whole", () => {
    for (const t of tiles) {
      const key = clipKey(t.q)!;
      expect(key, `${t.loc} ${t.q}`).not.toContain("-");
      const clip = LIBRARY.clips[key];
      expect(clip, `${t.loc} ${t.q}`).toEqual(wordVoice(LIBRARY.quran[key]));
      expect(hasWaqfNote(clip, LIBRARY.quran[key]), `${t.loc} ${t.q}`).toBe(false);
    }
  });
});

describe("the ayat outside the lessons: the committed fixture", () => {
  // pipeline/fixtures/clips_outside_lessons.json is the build's: the Tanzil line and the quran-align
  // segments of the ayat the imam's cuts came from, outside the lessons. The cuts are gone from the
  // pages (the narrator records each word), so what these tests still use of it is the Tanzil line:
  // the words of the Harakat cards' examples that stand in an ayah no lesson has (signNotHeard).
  it("holds the Tanzil line of every ayah outside the lessons that a Harakat card's example stands in, and its word is the library's bytes", () => {
    const lessons = new Set(SURAHS.map((s) => s.surah));
    const outside = LIBRARY.basics.flatMap((b) => b.signs.map((sg) => clipKey(sg.example)!)).filter((k) => !lessons.has(Number(k.split(":")[0])));
    expect(outside).toEqual(["97:5:1"]);
    for (const key of outside) {
      const [s, a, w] = key.split(":").map(Number);
      const line = FIXTURE.ayat[`${s}:${a}`];
      expect(line, key).toBeDefined();
      expect(line.tanzil.split(" ")[w - 1], key).toBe(LIBRARY.quran[key]);
      expect(tokensOf(s, a), key).toEqual(line.tanzil.split(" "));
    }
  });

  it("every word of the library outside the lessons has its recording (the imam's alignment is no longer what makes one)", () => {
    const lessons = new Set(SURAHS.map((s) => s.surah));
    const outside = Object.keys(LIBRARY.clips).filter((k) => !lessons.has(Number(k.split(":")[0])));
    expect(outside.length).toBeGreaterThan(10);
    for (const key of outside) expect(LIBRARY.clips[key], key).toEqual(wordVoice(LIBRARY.quran[key]));
    // …among them the five the imam's cuts used to cover, which had to be aligned to be voiced
    for (const key of ["2:5:2", "5:23:6", "26:24:2", "55:78:2", "97:5:1"]) expect(outside, key).toContain(key);
  });
});
