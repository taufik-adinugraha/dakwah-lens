import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConceptCard } from "@/components/library/ConceptCard";
import { HarakatChart } from "@/components/library/HarakatChart";

import manifest from "../../content/wordvoice.json";

import {
  atClipEnd,
  type Clip,
  CLIP_IDLE,
  CLIP_QREF,
  clipFor,
  clipKey,
  clipReducer,
  type ClipState,
  clipStartSeconds,
  clipView,
  END_TIMER_WINDOW_MS,
  endTimerMs,
  needsSeek,
  pressAction,
} from "./clips";
import { SURAH_INDEX, SURAHS, WORD_AR, WORD_INFO } from "./content";
import { LIBRARY, TERMS } from "./library";
import { prepareSigns, QREF, soundAfterSign } from "./terms";
import { plainLetters, wordVoice, type WordVoiceManifest } from "./wordvoice";

// The voice of every example (operator 2026-10-12: "in explanation, for example when explaining
// dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice + show visual)
// when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each
// explanation should be followed by examples (visual + voice)"; "not only for harakah, but also for
// all rules"). Since 2026-10-14 that voice is the narrator Kang Nandar's recording of the word
// written in plain letters (content/wordvoice.json, src/lib/wordvoice.ts), never a cut of the
// imam's recitation: "in some parts the truncation are not clean" (operator). So a word, a run, a
// part of a word (bi-, -ta) and a base form on its own (ismu) are each said whole: no word's last
// harakah is dropped for a pause, no hamzat washal is lost, so a button carries no note.
// Whole ayat are still recited by the imam (the lessons, the ayah popup): ayah.test.ts.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const MSG = { id: JSON.parse(read("messages/id.json")), en: JSON.parse(read("messages/en.json")) };
const CLIPS = LIBRARY.clips;
const MANIFEST = manifest as WordVoiceManifest;
/** A recording of content/wordvoice.json: the narrator's file of a text, named by its text's hash and its own checksum. */
const VOICE_FILE = /^\/belajar\/media\/narration\/kang-nandar\/words\/([0-9a-f]{16})-([0-9a-f]{10})\.mp3$/;
/** The manifest's recording of a Qur'anic text (any Uthmani string), or undefined. */
const recordingOf = (ar: string) => MANIFEST.words[plainLetters(ar)]?.audio;
/** The Arabic a page shows for a clip key: a lesson word's own bytes, else library.json `quran`. */
const arabicOf = (key: string) => WORD_INFO[key]?.ar ?? LIBRARY.quran[key];
/** The clip key of a parts tile: its own q-ref (a whole word, or a part of one). */
const tileKey = (t: { q: string }) => clipKey(t.q)!;
/** Does the word (of a lesson ayah) end its ayah, where the imam stops? */
const endsAyah = (loc: string) => {
  const [s, a, w] = loc.split(":").map(Number);
  return SURAHS.find((x) => x.surah === s)?.ayat.find((x) => x.ayah === a)?.words.length === w;
};

describe("clip lookup (src/lib/clips.ts)", () => {
  it("keys an example by the word a page shows: a word, a letter's word, a run, a part of a word", () => {
    expect(clipKey("1:1:1")).toBe("1:1:1");
    expect(clipKey("q:55:78:2")).toBe("55:78:2");
    expect(clipKey("q:1:1:1#1")).toBe("1:1:1"); // a Harakat sign's letter: a letter alone is not voiced, its word is
    expect(clipKey("q:112:1:2-4")).toBe("112:1:2-4");
    // a part of a word has its own recording now (until 2026-10-14 the imam's recitation could not
    // be cut at one, so bi- and -ta had no key)
    expect(clipKey("q:1:1:1/1")).toBe("1:1:1/1");
    expect(clipKey("q:1:7:3/2")).toBe("1:7:3/2");
    expect(clipKey("bismi")).toBeNull();
    expect(clipKey("q:1:1")).toBeNull();
    expect(CLIP_QREF.source).toBe(QREF.source); // the markup's q-ref grammar, repeated for the browser
  });

  it("finds the narrator's recording of a word, of a letter's word, of a run and of a part; nothing for an unknown word", () => {
    const bismi = clipFor(CLIPS, "1:1:1")!;
    expect(bismi).toEqual({ url: expect.stringMatching(VOICE_FILE), start: 0, end: recordingOf(WORD_AR["1:1:1"])!.ms });
    expect(bismi).toEqual(wordVoice(WORD_AR["1:1:1"]));
    expect(clipFor(CLIPS, "q:1:1:1#1")).toBe(CLIPS["1:1:1"]);
    // ٱسْمُ of QS 55:78, the bentuk dasar of bismi: the form on its own (the imam's cut played it
    // "smu", so it was voiced only inside the run tabāraka-smu). The run is its own recording.
    expect(clipFor(CLIPS, "q:55:78:2")).toEqual(wordVoice(LIBRARY.quran["55:78:2"]));
    expect(clipFor(CLIPS, "q:55:78:1-2")).toEqual(wordVoice(LIBRARY.quran["55:78:1-2"]));
    expect(clipFor(CLIPS, "q:55:78:2")).not.toEqual(clipFor(CLIPS, "q:55:78:1-2"));
    // a word that ends its ayah is said whole too: no `last` mark, no stop
    expect(clipFor(CLIPS, "1:1:4")).toEqual(wordVoice(WORD_AR["1:1:4"]));
    expect(clipFor(CLIPS, "1:1:4")).not.toHaveProperty("last");
    // a part of a word: bi- of bismi
    expect(clipFor(CLIPS, "q:1:1:1/1")).toEqual(wordVoice(LIBRARY.quran["1:1:1/1"]));
    expect(clipFor(CLIPS, "q:1:1:1/1")).not.toBeNull();
    expect(clipFor(CLIPS, "2:255:1")).toBeNull();
  });

  it("every clip is a whole recording of content/wordvoice.json, of its text: the narrator's file, from 0 to its length", () => {
    // Every Qur'anic text the library shows has its recording (build_wordvoice.py --require-audio).
    expect(Object.keys(CLIPS).sort()).toEqual(Object.keys(LIBRARY.quran).sort());
    expect(Object.keys(CLIPS).length).toBeGreaterThan(80);
    for (const [key, c] of Object.entries(CLIPS)) {
      const ar = LIBRARY.quran[key];
      const rec = recordingOf(ar);
      expect(rec, key).toBeDefined();
      expect(c, key).toEqual(wordVoice(ar));
      const m = VOICE_FILE.exec(c.url);
      expect(m, `${key} ${c.url}`).not.toBeNull();
      expect(c.url, key).toBe(rec!.url);
      expect(m![2], key).toBe(rec!.sha256.slice(0, 10)); // the address carries the file's checksum
      expect([c.start, c.end], key).toEqual([0, rec!.ms]);
      expect(Number.isInteger(c.end), key).toBe(true);
      // not a cut of the imam's file: never an EveryAyah address, never a `last` mark
      expect(c.url, key).not.toContain("everyayah");
      expect(c, key).not.toHaveProperty("last");
      // plausible: at least 150 ms, at most 4 s a word (the longest recording is a run of five words)
      const n = ar.trim().split(/\s+/u).length;
      expect(c.end, key).toBeGreaterThanOrEqual(150);
      expect(c.end, key).toBeLessThanOrEqual(4000 * n);
    }
  });

  it("a lesson word's clip is the recording of the lesson's own bytes, and the page's word", () => {
    let n = 0;
    for (const [key, c] of Object.entries(CLIPS)) {
      if (!WORD_INFO[key]) continue;
      expect(c, key).toEqual(wordVoice(WORD_INFO[key].ar));
      expect(LIBRARY.quran[key], key).toBe(WORD_INFO[key].ar);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(84);
    // a run is the recording of its words written one after the other (no start of the first, end
    // of the last: it is not a cut of anything)
    expect(LIBRARY.quran["112:1:2-3"]).toBe(`${WORD_AR["112:1:2"]} ${WORD_AR["112:1:3"]}`);
    expect(CLIPS["112:1:2-3"]).toEqual(wordVoice(`${WORD_AR["112:1:2"]} ${WORD_AR["112:1:3"]}`));
    expect(CLIPS["112:1:2-3"].end).toBeGreaterThan(CLIPS["112:1:3"].end);
  });
});

/** Each explanation followed by examples with Arabic AND the narrator's voice. */
describe("every rule has an example with Arabic and a voice", () => {
  it("every concept (all 37): at least one example row with the word's Arabic and a recording; in fact every row", () => {
    const missing: string[] = [];
    for (const c of LIBRARY.concepts) {
      const voiced = c.examples.filter((ex) => WORD_INFO[ex.loc]?.ar && wordVoice(WORD_INFO[ex.loc].ar));
      if (voiced.length === 0) missing.push(c.id);
      for (const ex of c.examples) {
        // what the row's button plays (ConceptCard): the recording of the word's own bytes
        expect(WORD_INFO[ex.loc]?.ar, `${c.id} ${ex.loc}`).toBeTruthy();
        expect(wordVoice(WORD_INFO[ex.loc].ar), `${c.id} ${ex.loc}`).not.toBeNull();
        // … and the library's own clip of that key, where it has one, is the same recording
        if (CLIPS[ex.loc]) expect(CLIPS[ex.loc], `${c.id} ${ex.loc}`).toEqual(wordVoice(WORD_INFO[ex.loc].ar));
      }
    }
    expect(missing).toEqual([]);
    expect(LIBRARY.concepts.length).toBe(37);
  });

  it("every Harakat sign: its example word in Arabic with a recording (a letter alone is not voiced, its word is)", () => {
    const signs = LIBRARY.basics.flatMap((b) => b.signs);
    expect(signs.length).toBe(8);
    for (const s of signs) {
      const key = clipKey(s.example)!;
      // a lesson word, or (where no lesson word lets the sign be heard) another ayah's, with its
      // own transliteration: سَلَٰمٌ of QS 97:5 for the tanwin dhammah
      expect(WORD_INFO[key]?.ar ?? LIBRARY.quran[key], s.term).toBeTruthy();
      expect(WORD_INFO[key]?.translit ?? s.translit, s.term).toBeTruthy();
      expect(!!WORD_INFO[key], s.term).toBe(s.translit === undefined);
      expect(wordVoice(arabicOf(key)), `${s.term} ${s.example}`).not.toBeNull();
      expect(clipFor(CLIPS, s.example), `${s.term} ${s.example}`).toEqual(wordVoice(arabicOf(key)));
    }
    expect(signs.filter((s) => s.translit).map((s) => [s.example, s.translit])).toEqual([["q:97:5:1#3", "salāmun"]]);
  });

  it("every parts diagram: the joined word and every tile, parts of words too, has the recording of exactly its own bytes", () => {
    for (const p of LIBRARY.parts) {
      expect(WORD_INFO[p.loc]?.ar, p.loc).toBeTruthy();
      expect(clipFor(CLIPS, p.loc), p.loc).toEqual(wordVoice(WORD_INFO[p.loc].ar));
      for (const t of p.tiles) {
        const ar = LIBRARY.quran[t.q.slice(2)];
        expect(ar, t.q).toBeTruthy();
        // Until 2026-10-14 a QAC segment (bi-, li-, -hum, -hū, -ta) had no voice, and a tile that
        // starts with hamzat washal played the run with the word before it. Now each tile is said
        // as it is written, on its own.
        expect(tileKey(t), `${p.loc} ${t.q}`).toBe(t.q.slice(2));
        expect(wordVoice(ar), `${p.loc} ${t.q}`).not.toBeNull();
        expect(CLIPS[tileKey(t)], `${p.loc} ${t.q}`).toEqual(wordVoice(ar));
      }
    }
    // the operator's own example: bismi = bi- + ismu, each tile and the joined word voiced
    const bismi = LIBRARY.parts.find((p) => p.loc === "1:1:1")!;
    expect(bismi.tiles.map((t) => [t.translit, tileKey(t)])).toEqual([
      ["bi-", "1:1:1/1"],
      ["ismu", "55:78:2"], // on its own: its alif is read, and no run with tabāraka is played
    ]);
    // all twelve tiles and what each plays: its own text, never a run
    expect(LIBRARY.parts.flatMap((p) => p.tiles.map((t) => [t.translit, tileKey(t)]))).toEqual([
      ["bi-", "1:1:1/1"],
      ["ismu", "55:78:2"],
      ["li-", "1:2:2/1"],
      ["Allāhu", "112:1:3"],
      ["‘alā", "2:5:2"],
      ["-hum", "2:3:7/3"],
      ["li-", "1:2:2/1"],
      ["-hū", "112:4:3/2"],
      ["bi-", "113:1:3/1"],
      ["rabbu", "26:24:2"],
      ["an‘ama", "5:23:6"],
      ["-ta", "1:7:3/2"],
    ]);
    for (const p of LIBRARY.parts) for (const t of p.tiles) expect(tileKey(t), `${p.loc} ${t.q}`).not.toContain("-");
  });

  it("every text a page shows has its recording (the build keeps none outside the content: build_wordvoice.py --check)", () => {
    const shown = new Set([
      ...LIBRARY.concepts.flatMap((c) => c.examples.map((e) => e.loc)),
      ...LIBRARY.basics.flatMap((b) => b.signs.map((s) => clipKey(s.example)!)),
      ...LIBRARY.parts.flatMap((p) => [p.loc, ...p.tiles.map(tileKey)]),
    ]);
    expect(shown.size).toBeGreaterThan(80);
    expect([...shown].filter((k) => !arabicOf(k)), "a shown key with no bytes").toEqual([]);
    expect([...shown].filter((k) => !recordingOf(arabicOf(k))), "a shown key with no recording").toEqual([]);
    // the library's own clips are the quran texts' recordings: a key outside `quran` has none
    expect(Object.keys(CLIPS).filter((k) => !(k in LIBRARY.quran))).toEqual([]);
  });

  it("the pages draw the voice beside each example (ConceptCard rows, HarakatChart, WordParts), one player per page, by the word's own Arabic", () => {
    const card = read("src/components/library/ConceptCard.tsx");
    expect(card).toContain("<ClipButton loc={row.ex.loc}");
    expect(card).toContain("wordVoice(ar)");
    expect(card).toContain("<ClipPlayerProvider>{card}</ClipPlayerProvider>");
    const chart = read("src/components/library/HarakatChart.tsx");
    expect(chart).toContain("<ClipButton loc={s.loc}");
    expect(chart).toContain("wordVoice(w.ar)");
    expect(chart).toContain("<ClipPlayerProvider>");
    const parts = read("src/components/library/WordParts.tsx");
    expect(parts).toContain("<ClipButton loc={data.loc}");
    expect(parts).toContain("wordVoice(data.word.ar)");
    expect(parts).toContain("voice={tileVoice(t)}");
    expect(parts).toContain("wordVoice(t.ar)");
    // none of them reads the imam's cuts of library.json any more, and a tile has no note
    for (const [name, src] of [["ConceptCard", card], ["HarakatChart", chart], ["WordParts", parts]] as const) {
      expect(src, name).not.toContain("clipFor(");
      expect(src, name).not.toContain("LIBRARY.clips");
    }
    expect(parts).not.toContain("<ClipNote");
    expect(parts).not.toContain('from "./ClipNote"');
    expect(read("src/app/[locale]/konsep/[id]/page.tsx")).not.toContain("LIBRARY.clips");
  });
});

describe("the pages as rendered (server markup, real messages)", () => {
  const intl = (el: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale: "id", messages: MSG.id, timeZone: "Asia/Jakarta" } as ComponentProps<typeof NextIntlClientProvider>, el),
    );
  const buttonsOf = (html: string) =>
    [
      ...html.matchAll(
        /<button type="button" data-clip="([^"]+)" data-state="([^"]+)" aria-label="([^"]+)"(?: aria-describedby="([^"]+)")? class="btn-listen">/g,
      ),
    ].map((m) => ({ loc: m[1], state: m[2], label: m[3], describedBy: m[4] ?? null }));
  /** The notes drawn on a page: [id, kind, text]. */
  const notesOf = (html: string) =>
    [...html.matchAll(/<p id="([^"]+)" data-clip-note="(waqf|washal)"[^>]*>(.*?)<\/p>/g)].map((m) => ({
      id: m[1],
      kind: m[2],
      text: m[3].replace(/<[^>]+>/g, ""),
    }));
  const label = (word: string) => MSG.id.Clip.play_label.replace("{word}", word);
  const labels = { nahwu: "n", sharaf: "s", bridge: "b", examples: "e", more: "m", sources: "r" };
  const card = (id: string, compact = false) =>
    intl(createElement(ConceptCard, { concept: LIBRARY.concepts.find((c) => c.id === id)!, labels, surahs: SURAH_INDEX, wordAr: WORD_AR, page: !compact, compact }));

  it("a concept page: one idle voice button per example row, named by its word; one player, the credit once", () => {
    for (const c of LIBRARY.concepts) {
      const html = card(c.id);
      const rows = buttonsOf(html).filter((b) => c.examples.some((e) => e.loc === b.loc));
      expect(rows.map((b) => b.loc), c.id).toEqual(expect.arrayContaining(c.examples.map((e) => e.loc)));
      for (const b of buttonsOf(html)) {
        expect(b.state).toBe("idle");
        // every button plays the recording of the Arabic the page shows for it (a lesson word, or a
        // part / base form of a diagram)
        expect(wordVoice(arabicOf(b.loc)), `${c.id} ${b.loc}`).not.toBeNull();
      }
      for (const e of c.examples) expect(html, `${c.id} ${e.loc}`).toContain(`aria-label="${label(WORD_INFO[e.loc].translit)}"`);
      expect(html.split(MSG.id.Clip.credit.slice(0, 12)).length - 1, c.id).toBe(1);
    }
  });

  it("the operator's model: huruf jar's bismi diagram voices bi-, ismu on its own (QS 55:78) and bismi; no run, no note", () => {
    const html = card("huruf-jar");
    const buttons = buttonsOf(html);
    // ismu is its own recording: its alif is read, so the button plays "ismu" and says nothing more
    // (until 2026-10-14 it played the run tabāraka-smu and a line said why: alone it played "smu")
    const ismu = buttons.find((b) => b.loc === "55:78:2")!;
    expect(ismu.label).toBe(label("ismu"));
    expect(ismu.describedBy).toBeNull();
    expect(buttons.map((b) => b.loc)).not.toContain("55:78:1-2");
    expect(html).not.toContain("tabārakasmu");
    // bi-, a part of a word, is voiced too (it had no button)
    const bi = buttons.find((b) => b.loc === "1:1:1/1")!;
    expect(bi.label).toBe(label("bi-"));
    expect(bi.describedBy).toBeNull();
    expect(html).toContain(`aria-label="${label("bismi")}"`);
    // Allāhu likewise, on the same page: itself, not huwallāhu
    const allah = buttons.find((b) => b.loc === "112:1:3")!;
    expect(allah.label).toBe(label("Allāhu"));
    expect(buttons.map((b) => b.loc)).not.toContain("112:1:2-3");
    expect(html).not.toContain("huwallāhu");
    // no note of any kind is drawn on the page
    expect(notesOf(html)).toEqual([]);
    expect(buttons.every((b) => b.describedBy === null)).toBe(true);
    // every diagram's word and every tile, parts of words too, on its concept pages
    for (const p of LIBRARY.parts) {
      const all = p.concepts.map((id) => buttonsOf(card(id)).map((b) => b.loc)).flat();
      expect(all, p.loc).toContain(p.loc);
      for (const t of p.tiles) expect(all, `${p.loc} ${t.q}`).toContain(tileKey(t));
    }
  });

  it("no example row carries the waqf note: the narrator says every word whole, an ayah's last word too", () => {
    expect(MSG.id.Clip.waqf_note).toBe("Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar.");
    let rows = 0;
    const pages = new Set<string>();
    for (const c of LIBRARY.concepts) {
      const html = card(c.id);
      const buttons = buttonsOf(html);
      // not a note, and so no button described by one
      expect(notesOf(html), c.id).toEqual([]);
      expect(html, c.id).not.toContain(MSG.id.Clip.waqf_note);
      for (const e of c.examples) {
        const b = buttons.find((x) => x.loc === e.loc && x.label === label(WORD_INFO[e.loc].translit))!;
        expect(b, `${c.id} ${e.loc}`).toBeTruthy();
        expect(b.describedBy, `${c.id} ${e.loc}`).toBeNull();
        // the clip has no `last`, which is what the note was decided from (heard.ts hasWaqfNote)
        expect(wordVoice(WORD_INFO[e.loc].ar), `${c.id} ${e.loc}`).not.toHaveProperty("last");
        if (endsAyah(e.loc)) {
          rows++;
          pages.add(c.id);
        }
      }
    }
    // 47 of the 202 rows are an ayah's last word, on 21 concept pages: the rows that used to carry
    // the note (43) or, for yūlad, the sukun's silence — and none does now
    expect([rows, pages.size]).toEqual([47, 21]);
    // the review's two examples: nasta‘īnu "marfu' dengan dhammah" and khalaqa "mabni di atas fathah"
    for (const [id, loc] of [["tanda-irab", "1:5:4"], ["fiil-madhi", "113:2:4"]] as const) {
      const c = LIBRARY.concepts.find((x) => x.id === id);
      if (!c?.examples.some((e) => e.loc === loc)) continue;
      const b = buttonsOf(card(id)).find((x) => x.loc === loc)!;
      expect(b.describedBy, `${id} ${loc}`).toBeNull();
    }
  });

  it("a lesson's compact concept card shows no example, so no voice and no player", () => {
    for (const c of LIBRARY.concepts) expect(buttonsOf(card(c.id, true)), c.id).toEqual([]);
  });

  it("the Harakat page: every sign card ends with its word's voice", () => {
    const signs = prepareSigns(LIBRARY.basics[0].signs, TERMS);
    const html = intl(
      createElement(HarakatChart, {
        signs,
        words: WORD_INFO,
        labels: { sound: "Bunyi", example: "Contoh", from: "dari", credit: MSG.id.Clip.credit, waqf: MSG.id.Clip.waqf_note },
      }),
    );
    const b = buttonsOf(html);
    expect(b.map((x) => x.loc)).toEqual(signs.map((s) => s.loc));
    expect(b.map((x) => x.label)).toEqual(signs.map((s) => label((WORD_INFO[s.loc] ?? s.word)!.translit)));
    expect(html.match(/role="status"/g)).toHaveLength(signs.length);
    // the tanwin dhammah card: مٌ = m + un "dari سَلَٰمٌ (salāmun)", a word outside the lessons with
    // its own transliteration, where the tanwin is heard (it was أَحَدٌ, heard "aḥad")
    const salam = LIBRARY.quran["97:5:1"];
    expect(html).toContain(`>${salam}</bdi> (salāmun)`);
    expect(html).toContain(`aria-label="${label("salāmun")}"`);
    expect(html).not.toContain("aḥadun");
    expect(signs.find((s) => s.loc === "97:5:1")).toMatchObject({ reading: "m + un", word: { ar: salam, translit: "salāmun" } });
    // every card's "dari <word> (<transliteration>)" line
    expect(html.match(/dari <span class="whitespace-nowrap">/g)).toHaveLength(signs.length);
    // no card carries a note: no sign's word ends its ayah (heard.test.ts signNotHeard), and the
    // narrator says a word whole in any case
    expect(notesOf(html)).toEqual([]);
    expect(b.every((x) => x.describedBy === null)).toBe(true);
  });
});

describe("the clip player's logic (one Audio element per page)", () => {
  // The player plays [start, end) of any file; the narrator's recordings are whole files (start 0).
  const A: Clip = { url: "/belajar/media/narration/kang-nandar/words/0123456789abcdef-0123456789.mp3", start: 620, end: 1310 };
  const playing = (key: string): ClipState => ({ key, status: "playing" });

  it("a press plays; a press on the playing clip stops it; another clip replaces it", () => {
    expect(pressAction(CLIP_IDLE, "1:1:2")).toBe("play");
    expect(pressAction(playing("1:1:2"), "1:1:2")).toBe("stop");
    expect(pressAction(playing("1:1:2"), "1:2:1")).toBe("play");
    expect(pressAction({ key: "1:1:2", status: "failed" }, "1:1:2")).toBe("play"); // a retry
    expect(clipReducer(playing("1:1:2"), { type: "start", key: "1:2:1" })).toEqual(playing("1:2:1"));
  });

  it("it ends at the clip's end, stops when another player starts, fails only while asked", () => {
    expect(clipReducer(playing("1:1:2"), { type: "end" })).toEqual(CLIP_IDLE);
    expect(clipReducer(playing("1:1:2"), { type: "interrupt" })).toEqual(CLIP_IDLE);
    expect(clipReducer(playing("1:1:2"), { type: "stop" })).toEqual(CLIP_IDLE);
    expect(clipReducer(playing("1:1:2"), { type: "error" })).toEqual({ key: "1:1:2", status: "failed" });
    expect(clipReducer(CLIP_IDLE, { type: "error" })).toBe(CLIP_IDLE);
    expect(clipReducer(CLIP_IDLE, { type: "end" })).toBe(CLIP_IDLE);
  });

  it("plays [start, end) of the file: seeks to start, stops at end", () => {
    expect(clipStartSeconds(A)).toBe(0.62);
    expect(atClipEnd(A, 1309)).toBe(false);
    expect(atClipEnd(A, 1310)).toBe(true);
    expect(needsSeek(A, 0)).toBe(true); // a fresh file
    expect(needsSeek(A, 1310)).toBe(true); // the clip just ended: from its start again
    expect(needsSeek(A, 630)).toBe(false);
    expect(needsSeek({ ...A, start: 30 }, 0)).toBe(false); // the file's start is the word's
  });

  it("a narrator's recording is the whole file: no seek at its start, played to its length, again from the start", () => {
    const w = wordVoice(WORD_AR["1:1:1"])!;
    expect([w.start, w.end > 0]).toEqual([0, true]);
    expect(clipStartSeconds(w)).toBe(0);
    expect(needsSeek(w, 0)).toBe(false); // a fresh file is already at the word's start
    expect(atClipEnd(w, w.end - 1)).toBe(false);
    expect(atClipEnd(w, w.end)).toBe(true);
    expect(needsSeek(w, w.end)).toBe(true); // just ended: from its start again
    expect(endTimerMs(w, w.end - 10)).toBe(10);
  });

  it("near the end a timer is set for the end itself, not the next frame (a frame is 16.7 ms; the next word starts 10 ms on)", () => {
    expect(END_TIMER_WINDOW_MS).toBeGreaterThanOrEqual(34); // at least two frames at 60 Hz
    expect(endTimerMs(A, 1000)).toBeNull(); // 310 ms to go: keep checking by frame
    expect(endTimerMs(A, 1310 - END_TIMER_WINDOW_MS - 1)).toBeNull();
    expect(endTimerMs(A, 1310 - END_TIMER_WINDOW_MS)).toBe(END_TIMER_WINDOW_MS);
    expect(endTimerMs(A, 1298)).toBe(12); // stop in 12 ms, where a frame could come 16.7 ms later
    expect(endTimerMs(A, 1298, 2)).toBe(6); // at double speed the end comes in half the time
    expect(endTimerMs(A, 1298, 0)).toBe(12); // a rate of 0 is not a wait for ever
    expect(endTimerMs(A, 1310)).toBeNull(); // already there: atClipEnd stops it
    expect(endTimerMs(A, 1400)).toBeNull();
    // the timer never stops EARLY: it only waits; the stop is still atClipEnd on the element's clock
    expect(atClipEnd(A, 1298 + 11)).toBe(false);
    expect(atClipEnd(A, 1298 + 12)).toBe(true);
  });

  it("each button shows its own state: play, stop while it plays (the loading line once it lasts), retry after a failure", () => {
    expect(clipView(CLIP_IDLE, "1:1:2", null)).toEqual({ mode: "play", line: null });
    expect(clipView(playing("1:2:1"), "1:1:2", "loading")).toEqual({ mode: "play", line: null });
    expect(clipView(playing("1:1:2"), "1:1:2", null)).toEqual({ mode: "stop", line: null });
    expect(clipView(playing("1:1:2"), "1:1:2", "loading")).toEqual({ mode: "stop", line: "loading" });
    expect(clipView(playing("1:1:2"), "1:1:2", "slow")).toEqual({ mode: "stop", line: "slow" });
    expect(clipView({ key: "1:1:2", status: "failed" }, "1:1:2", null)).toEqual({ mode: "retry", line: "failed" });
  });

  it("the hook: nothing fetched before a press, one element, the module's audio-start event both ways", () => {
    const hook = read("src/hooks/useClipPlayer.ts");
    expect(hook).toContain('a.preload = "none"');
    expect(hook.match(/new Audio\(\)/g)).toHaveLength(1);
    expect(hook).toContain("window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT");
    expect(hook).toContain("window.addEventListener(AUDIO_START_EVENT, onOtherStart)");
    expect(hook).toContain("requestAnimationFrame(loop)");
    // the stop: a timer for the predicted end, timeupdate where no frame runs, and a hidden tab stops
    expect(hook).toContain("endTimerMs(c, a.currentTime * 1000, a.playbackRate)");
    expect(hook).toMatch(/timer = setTimeout\(\(\) => \{\s*timer = null;\s*if \(!stopAtEnd\(\)\) armEnd\(\);/);
    expect(hook).toContain('["timeupdate", onTimeUpdate]');
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(hook).toContain('document.removeEventListener("visibilitychange", onVisibility)');
    expect(hook).toMatch(/const onVisibility = \(\) => \{\s*if \(!document\.hidden \|\| a\.paused\) return;[\s\S]*?a\.pause\(\);/);
    // every stop is at or after the end, on the element's own clock (CI measures it on the real page)
    expect(hook.match(/atClipEnd\(/g)).toHaveLength(1);
    // src only inside play(), which only a press calls
    expect(hook.match(/a\.src = /g)).toHaveLength(1);
    expect(hook).toMatch(/const play = useCallback\(\(key: string, clip: Clip\) => \{[\s\S]*?a\.src = clip\.url/);
  });

  it("the button: a real button, its aria-label naming the word and starting with its visible word, 48px", () => {
    const button = read("src/components/library/ClipButton.tsx");
    expect(button).toContain('type="button"');
    expect(button).toContain("aria-label={label}");
    expect(button).toContain('role="status"');
    expect(button).toContain('tg("loading_narration")');
    expect(read("src/app/globals.css")).toMatch(/@utility btn-listen \{[^}]*min-height: 3rem;/);
    for (const loc of ["id", "en"] as const) {
      const c = MSG[loc].Clip;
      expect(Object.keys(c)).toEqual(Object.keys(MSG.id.Clip));
      expect(c.play_label.startsWith(c.play), `${loc} play`).toBe(true);
      expect(c.stop_label.startsWith(c.stop), `${loc} stop`).toBe(true);
      expect(c.retry_label.startsWith(MSG[loc].Ayah.retry), `${loc} retry`).toBe(true);
      for (const k of ["play_label", "stop_label", "retry_label"]) expect(c[k]).toContain("{word}");
      for (const v of Object.values(c) as string[]) {
        expect(v).not.toMatch(/\b(ketuk|mengetuk|diketuk|tap)\b/i);
        expect(v).not.toMatch(/\b[A-Z]{4,}\b/); // no ALL CAPS emphasis
      }
    }
    // The voice is the AI narrator's, and the button says so (operator 2026-10-14): never "the imam's recitation".
    expect(MSG.id.Clip.play_label.replace("{word}", "bismi")).toBe("Dengarkan suara AI: bismi");
    expect(MSG.en.Clip.play_label.replace("{word}", "bismi")).toBe("Listen to the AI voice: bismi");
    expect(MSG.id.Clip.stop_label.replace("{word}", "bismi")).toBe("Hentikan suara AI: bismi");
    expect(MSG.id.Clip.retry_label.replace("{word}", "bismi")).toBe("Coba lagi, suara AI: bismi");
    for (const loc of ["id", "en"] as const) {
      for (const k of ["play_label", "stop_label", "retry_label"]) expect(MSG[loc].Clip[k], `${loc} ${k}`).not.toMatch(/imam/i);
      // the credit names the narrator and says it is AI; no reciter, no recitation host, no aligner
      expect(MSG[loc].Clip.credit, loc).toContain("AI");
      expect(MSG[loc].Clip.credit, loc).toContain("Kang Nandar");
      expect(MSG[loc].Clip.credit, loc).not.toMatch(/Alafasy|EveryAyah|quran-align|Collin Fair/);
    }
    expect(MSG.id.Clip.credit).toBe("Suara contoh: dibuat dengan AI (narator Kang Nandar, ElevenLabs), bukan rekaman imam; ayat lengkap dibacakan imam di halaman pelajaran.");
    // The one line that says what is heard (ClipNote) is the waqf's, in both languages; the washal
    // line is gone with the run it described: a tile is recorded on its own.
    expect(MSG.id.Clip.waqf_note).toBe("Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar.");
    expect(MSG.en.Clip.waqf_note).toBe("At the end of an ayah the imam stops (waqf), so the final vowel sign is not heard.");
    expect(MSG.id.Clip).not.toHaveProperty("washal_note");
    expect(MSG.en.Clip).not.toHaveProperty("washal_note");
    // The Credits page says who the voice is, in both languages (src/app/[locale]/kredit/page.tsx).
    for (const loc of ["id", "en"] as const) {
      expect(MSG[loc].Credits.voice_heading, loc).toBeTruthy();
      expect(MSG[loc].Credits.voice_body, loc).toContain("Kang Nandar");
      expect(MSG[loc].Credits.voice_body, loc).toContain("AI");
    }
    expect(read("src/app/[locale]/kredit/page.tsx")).toContain('t("voice_body")');
    expect(button).toContain('aria-describedby={[noteId, line ? statusId : null].filter(Boolean).join(" ") || undefined}');
    const note = read("src/components/library/ClipNote.tsx");
    expect(note).toContain("data-clip-note={kind}");
    expect(note).not.toMatch(/text-xs|title=/); // visible text at a reading size, never a tooltip
    expect(MSG.id.Guided.loading_recitation).toBe("Memuat bacaan imam…");
  });

  it("CI drives the real pages: no request before a press, the narrator's file, a second press stops the first, no note anywhere, the end by itself", () => {
    const shots = read("scripts/ci/screenshots.mjs");
    expect(shots).toContain("async function clipChecks(page, vp, index)");
    expect(shots).toContain("[data-clip]");
    expect(shots).toContain("/belajar/id/konsep/idhafah");
    expect(shots).toContain("/belajar/id/konsep/harakat");
    expect(shots).toContain("/belajar/id/konsep/huruf-jar");
    expect(shots).toContain("await clipChecks(page, vp, narration);");
    // step 4 can fail: where the player paused the element, its clock is within the recording's length
    expect(shots).toContain("HTMLMediaElement.prototype.pause");
    expect(shots).toContain("STOP_LATE_S = 0.15");
    expect(shots).not.toMatch(/page\.waitForFunction\(/); // the CSP refuses its eval
    // The check's own body: the narrator's recordings (answered in the browser, observed by path),
    // no imam's cut — no `clips` of library.json, no `last`, no waqf / washal note, no EveryAyah file asked for.
    const body = shots.slice(shots.indexOf("async function clipChecks(page, vp, index)"), shots.indexOf("async function assertKaraokeLayout("));
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toContain("wordVoiceIndex()");
    expect(body).toContain("watchWordVoices(page)");
    expect(body).toContain("narrationRoute(index, served)");
    expect(body).toContain('page.locator("main [data-clip-note]").count()');
    expect(body).not.toMatch(/lib\.clips|\.last\b|waqf_note|washal_note|\.washal\.run|everyayah\.com\/data/);
    // the CI helper that knows where the narrator's files live is the app's: same prefix, the manifest's urls
    const route = read("scripts/ci/narration-route.mjs");
    expect(route).toContain('export const WORD_VOICE_PREFIX = `${NARRATION_PREFIX}kang-nandar/words/`;');
    expect(route).toContain("wordvoice.json");
    // …and every url of the manifest is under that prefix (so the route's stand-ins cover them all)
    for (const [text, entry] of Object.entries(MANIFEST.words)) expect(entry.audio?.url, text).toMatch(/^\/belajar\/media\/narration\/kang-nandar\/words\//);
  });
});

describe("a parts diagram's changed mark: what is written after its name (WordParts ChangeMark)", () => {
  const term = (id: string) => TERMS.terms.get(id)!;

  it("nothing after a vowel sign or a tanwin (the sign on the circle says it); sukun and tasydid keep their words", () => {
    expect(soundAfterSign(term("fathah"), "a")).toBe("");
    expect(soundAfterSign(term("kasrah"), "i")).toBe("");
    expect(soundAfterSign(term("dhammah"), "u")).toBe("");
    expect(soundAfterSign(term("tanwin"), "-un")).toBe("");
    expect(soundAfterSign(term("sukun"), "mati, tanpa vokal")).toBe("mati, tanpa vokal");
    expect(soundAfterSign(term("tasydid"), "huruf dibaca dobel")).toBe("huruf dibaca dobel");
    expect(soundAfterSign(null, "a")).toBe(""); // a letter change names no sign on that side
  });

  it("decided by the term, not by the sound's length (the first rule was `said.length > 3`)", () => {
    expect(soundAfterSign(term("sukun"), "mati")).toBe("mati"); // short, and still said
    expect(soundAfterSign(term("fathah"), "a pendek")).toBe(""); // long, and still not written after the sign
    expect(soundAfterSign(term("tanwin"), "-uun")).toBe("");
    expect(read("src/components/library/WordParts.tsx")).not.toContain("said.length");
  });

  it("on the pages: ‘alaihim's ya' and an‘amta's mim show sukun with its words, bismi's change shows the signs alone", () => {
    const sounds = Object.fromEntries(LIBRARY.basics[0].signs.filter((s) => !s.marks.some((m) => m.endsWith("tain"))).map((s) => [s.term, s.sound]));
    expect(soundAfterSign(term("sukun"), sounds.sukun)).toBe("mati, tanpa vokal");
    for (const id of ["dhammah", "kasrah", "fathah"]) expect(soundAfterSign(term(id), sounds[id])).toBe("");
  });
});
