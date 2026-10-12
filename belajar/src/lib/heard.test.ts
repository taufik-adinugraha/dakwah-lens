import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { clipKey } from "./clips";
import { SURAHS, WORD_AR } from "./content";
import { hasWaqfNote, signNotHeard, waqfDrop } from "./heard";
import { LIBRARY } from "./library";
import { QREF } from "./terms";

// What the learner HEARS (review 2026-10-12 of the example voices): the Harakat card for tanwin
// showed دٌ = d + un "dari أَحَدٌ (aḥadun)" and played "aḥad"; 47 of 200 concept example rows are an
// ayah's last word, several with a note about the very ending the imam does not pronounce there.
// An example is chosen and labelled by tajwid, not only by its bytes.

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
  it("library.json marks `last` exactly on the clips whose word ends its ayah", () => {
    let n = 0;
    for (const [key, c] of Object.entries(LIBRARY.clips)) {
      const [s, a, w, w2] = key.split(/[:-]/).map(Number);
      const tokens = tokensOf(s, a);
      expect(tokens, key).not.toBeNull();
      expect(c.last === true, key).toBe(tokens!.length === (w2 ?? w));
      expect(c.last, key).not.toBe(false); // true or absent
      if (c.last) n++;
    }
    expect(n).toBe(22);
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

  it("47 of the 200 concept example rows are an ayah's last word, on 21 concept pages; 43 carry the note", () => {
    const rows = LIBRARY.concepts.flatMap((c) => c.examples.map((e) => ({ id: c.id, loc: e.loc })));
    const last = rows.filter((r) => LIBRARY.clips[r.loc]?.last);
    expect(rows).toHaveLength(200);
    expect(last.map((r) => r.loc).every(isLast)).toBe(true);
    expect(rows.filter((r) => isLast(r.loc))).toHaveLength(last.length);
    expect(last).toHaveLength(47);
    expect(new Set(last.map((r) => r.id)).size).toBe(21);
    const noted = last.filter((r) => hasWaqfNote(LIBRARY.clips[r.loc], WORD_AR[r.loc]));
    expect(noted).toHaveLength(43);
    expect([...new Set(last.filter((r) => !noted.includes(r)).map((r) => r.loc))]).toEqual(["112:3:4"]);
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

describe("hamzat washal: a base-form tile mid-ayah is played with the word before it", () => {
  const tiles = LIBRARY.parts.flatMap((p) => p.tiles.map((t) => ({ loc: p.loc, ...t })));

  it("derived from the bytes: exactly the whole-word tiles that start with ٱ and are not their ayah's first word", () => {
    for (const t of tiles) {
      const key = clipKey(t.q);
      const whole = key !== null && !t.q.includes("/");
      const [, , w] = (key ?? "0:0:0").split(":").map(Number);
      const needs = whole && LIBRARY.quran[key!].startsWith("\u0671") && w > 1;
      expect(t.washal !== undefined, `${t.loc} ${t.q}`).toBe(needs);
    }
    expect(tiles.filter((t) => t.washal).map((t) => [t.translit, t.washal])).toEqual([
      ["ismu", { run: "55:78:1-2", before: "tabāraka", heard: "tabārakasmu" }],
      ["Allāhu", { run: "112:1:2-3", before: "huwa", heard: "huwallāhu" }],
    ]);
  });

  it("the run is the word before + the word, its clip spans both, and the heard form joins their transliterations", () => {
    for (const t of tiles) {
      if (!t.washal) continue;
      const key = clipKey(t.q)!;
      const [s, a, w] = key.split(":").map(Number);
      expect(t.washal.run).toBe(`${s}:${a}:${w - 1}-${w}`);
      const tokens = tokensOf(s, a)!;
      expect(LIBRARY.quran[t.washal.run]).toBe(`${tokens[w - 2]} ${tokens[w - 1]}`);
      expect(LIBRARY.quran[`${s}:${a}:${w - 1}`]).toBe(tokens[w - 2]);
      expect(t.washal.heard).toBe(t.washal.before + t.translit.slice(1));
      expect(LIBRARY.clips[t.washal.run]).toBeTruthy();
      expect(LIBRARY.clips[key] === undefined || LIBRARY.concepts.some((c) => c.examples.some((e) => e.loc === key)), key).toBe(true);
    }
    // a lesson word before it brings the lesson's own transliteration
    expect(SURAHS.find((x) => x.surah === 112)!.ayat[0].words[1].translit).toBe("huwa");
  });

  it("no base-form tile is an ayah's last word (its ending is what the diagram shows)", () => {
    for (const t of tiles) {
      const key = t.washal?.run ?? clipKey(t.q);
      if (key) expect(LIBRARY.clips[key].last, `${t.loc} ${t.q}`).toBeUndefined();
    }
  });
});

describe("the ayat outside the lessons: the committed fixture", () => {
  it("holds exactly the ayat of the clips no lesson covers, and every such clip is its quran-align timing", () => {
    const lessons = new Set(SURAHS.map((s) => s.surah));
    const outside = Object.keys(LIBRARY.clips).filter((k) => !lessons.has(Number(k.split(":")[0])));
    expect([...new Set(outside.map((k) => k.split(":").slice(0, 2).join(":")))].sort()).toEqual(Object.keys(FIXTURE.ayat).sort());
    expect(outside).toEqual(["2:5:2", "5:23:6", "26:24:2", "55:78:1-2", "97:5:1"]);
    for (const key of outside) {
      const [s, a, w, w2] = key.split(/[:-]/).map(Number);
      const segs = FIXTURE.ayat[`${s}:${a}`].segments;
      const seg = (word: number) => segs.find(([from, to]) => from === word - 1 && to === word)!;
      expect([LIBRARY.clips[key].start, LIBRARY.clips[key].end], key).toEqual([seg(w)[2], seg(w2 ?? w)[3]]);
      const tokens = FIXTURE.ayat[`${s}:${a}`].tanzil.split(" ");
      expect(LIBRARY.quran[key], key).toBe(tokens.slice(w - 1, w2 ?? w).join(" "));
    }
  });
});
