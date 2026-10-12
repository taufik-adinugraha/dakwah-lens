import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConceptCard } from "@/components/library/ConceptCard";
import { HarakatChart } from "@/components/library/HarakatChart";

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
import { hasWaqfNote } from "./heard";
import { LIBRARY, TERMS } from "./library";
import { prepareSigns, QREF, soundAfterSign } from "./terms";

// The imam's voice of every example (operator 2026-10-12: "in explanation, for example when
// explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice +
// show visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel,
// each explanation should be followed by examples (visual + voice)"; "not only for harakah, but
// also for all rules"). What each voice lets the learner HEAR, and how the page says so where it
// differs from what is written (the imam's stop at an ayah's end, a hamzat washal): heard.test.ts.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const MSG = { id: JSON.parse(read("messages/id.json")), en: JSON.parse(read("messages/en.json")) };
const CLIPS = LIBRARY.clips;
const URL_OF = (loc: string) => {
  const [s, a] = loc.split(":").map((n) => n.padStart(3, "0"));
  return `https://everyayah.com/data/Alafasy_128kbps/${s}${a}.mp3`;
};
/** A lesson's own Alafasy timing of word `loc` (validate.py checks it against quran-align), with
 *  `last` when the word ends its ayah (the lesson's word count). */
function lessonTiming(loc: string): Clip | null {
  const [s, a, w] = loc.split(":").map(Number);
  const ayah = SURAHS.find((x) => x.surah === s)?.ayat.find((x) => x.ayah === a);
  const rec = ayah?.recitation.find((r) => r.reciter === "Alafasy_128kbps");
  const seg = rec?.segments.find(([sw]) => sw === w);
  if (!ayah || !rec || !seg) return null;
  return { url: rec.url, start: seg[1], end: seg[2], ...(w === ayah.words.length ? { last: true } : {}) };
}
/** The clip key of a parts tile: its word, or the run with the word before it (hamzat washal). */
const tileKey = (t: { q: string; washal?: { run: string } }) => t.washal?.run ?? clipKey(t.q);

describe("clip lookup (src/lib/clips.ts)", () => {
  it("keys an example by the word a page shows: a word, a letter's word, a run; never a part", () => {
    expect(clipKey("1:1:1")).toBe("1:1:1");
    expect(clipKey("q:55:78:2")).toBe("55:78:2");
    expect(clipKey("q:1:1:1#1")).toBe("1:1:1"); // a Harakat sign's letter: its word is recited
    expect(clipKey("q:112:1:2-4")).toBe("112:1:2-4");
    expect(clipKey("q:1:1:1/1")).toBeNull(); // bi-: a part of a word, never recited on its own
    expect(clipKey("bismi")).toBeNull();
    expect(clipKey("q:1:1")).toBeNull();
    expect(CLIP_QREF.source).toBe(QREF.source); // the markup's q-ref grammar, repeated for the browser
  });

  it("finds the clip of a word, of a letter's word, and nothing for a part or an unknown word", () => {
    expect(clipFor(CLIPS, "1:1:1")).toEqual({ url: URL_OF("1:1"), start: 60, end: 610 });
    expect(clipFor(CLIPS, "q:1:1:1#1")).toBe(CLIPS["1:1:1"]);
    // ٱسْمُ, the bentuk dasar of bismi: heard only with the word before it, tabāraka-smu (its run)
    expect(clipFor(CLIPS, "q:55:78:1-2")).toEqual({ url: URL_OF("55:78"), start: 30, end: 1490 });
    expect(clipFor(CLIPS, "q:55:78:2")).toBeNull();
    expect(clipFor(CLIPS, "1:1:4")).toEqual({ url: URL_OF("1:1"), start: 2460, end: 5970, last: true }); // ar-raḥīmi ends the ayah
    expect(clipFor(CLIPS, "q:1:1:1/1")).toBeNull();
    expect(clipFor(CLIPS, "2:255:1")).toBeNull();
  });

  it("every clip is Alafasy's EveryAyah file of its ayah, a plausible word in it", () => {
    expect(Object.keys(CLIPS).length).toBeGreaterThan(80);
    for (const [key, c] of Object.entries(CLIPS)) {
      const [s, a, w, w2] = key.split(/[:-]/);
      const n = Number(w2 ?? w) - Number(w) + 1;
      expect(c.url, key).toBe(URL_OF(`${s}:${a}`));
      expect(Number.isInteger(c.start) && Number.isInteger(c.end), key).toBe(true);
      expect(c.end - c.start, key).toBeGreaterThanOrEqual(150 * n);
      // 4 s a word, 7 s for an ayah's last (the madd held at the pause); a run: the sum, where
      // only its last word can be the ayah's last (pipeline/clips.py max_ms)
      expect(c.end - c.start, key).toBeLessThanOrEqual(4000 * (n - 1) + (c.last ? 7000 : 4000));
      expect(Number(w)).toBeGreaterThan(0);
    }
    expect(Object.keys(CLIPS).filter((k) => k.includes("-"))).toEqual(["55:78:1-2", "112:1:2-3"]);
  });

  it("a lesson word's clip is the lesson's own timing of that word, and the page's word", () => {
    let n = 0;
    for (const [key, c] of Object.entries(CLIPS)) {
      if (!WORD_INFO[key]) continue;
      expect(c, key).toEqual(lessonTiming(key));
      if (LIBRARY.quran[key]) expect(LIBRARY.quran[key], key).toBe(WORD_INFO[key].ar);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(84);
    // a run inside a lesson ayah: its first word's start, its last word's end
    expect(CLIPS["112:1:2-3"]).toEqual({ url: URL_OF("112:1"), start: lessonTiming("112:1:2")!.start, end: lessonTiming("112:1:3")!.end });
  });
});

/** Each explanation followed by examples with Arabic AND the imam's voice. */
describe("every rule has an example with Arabic and a voice", () => {
  it("every concept (all 37): at least one example row with the word's Arabic and a clip; in fact every row", () => {
    const missing: string[] = [];
    for (const c of LIBRARY.concepts) {
      const voiced = c.examples.filter((ex) => WORD_INFO[ex.loc]?.ar && clipFor(CLIPS, ex.loc));
      if (voiced.length === 0) missing.push(c.id);
      for (const ex of c.examples) expect(clipFor(CLIPS, ex.loc), `${c.id} ${ex.loc}`).not.toBeNull();
    }
    expect(missing).toEqual([]);
    expect(LIBRARY.concepts.length).toBe(37);
  });

  it("every Harakat sign: its example word in Arabic with a clip (a letter alone is never recited)", () => {
    const signs = LIBRARY.basics.flatMap((b) => b.signs);
    expect(signs.length).toBe(8);
    for (const s of signs) {
      const key = clipKey(s.example)!;
      // a lesson word, or (where no lesson word lets the sign be heard) another ayah's, with its
      // own transliteration: سَلَٰمٌ of QS 97:5 for the tanwin dhammah
      expect(WORD_INFO[key]?.ar ?? LIBRARY.quran[key], s.term).toBeTruthy();
      expect(WORD_INFO[key]?.translit ?? s.translit, s.term).toBeTruthy();
      expect(!!WORD_INFO[key], s.term).toBe(s.translit === undefined);
      expect(clipFor(CLIPS, s.example), `${s.term} ${s.example}`).not.toBeNull();
    }
    expect(signs.filter((s) => s.translit).map((s) => [s.example, s.translit])).toEqual([["q:97:5:1#3", "salāmun"]]);
  });

  it("every parts diagram: the joined word with a clip; the bentuk dasar tiles that are words too; only parts of words go unvoiced", () => {
    const unvoiced: string[] = [];
    for (const p of LIBRARY.parts) {
      expect(WORD_INFO[p.loc]?.ar, p.loc).toBeTruthy();
      expect(clipFor(CLIPS, p.loc), p.loc).not.toBeNull();
      for (const t of p.tiles) {
        expect(LIBRARY.quran[t.q.slice(2)], t.q).toBeTruthy();
        const key = tileKey(t);
        if (key && CLIPS[key]) continue;
        // Why none: a QAC segment (a prefix or suffix: bi-, li-, -hum, -hū, -ta) is never
        // recited on its own; the joined word's clip voices it inside the word.
        expect(t.q, `${p.loc} ${t.q}`).toMatch(/\/\d+$/);
        unvoiced.push(`${p.loc} ${t.translit}`);
      }
    }
    expect(unvoiced).toEqual(["1:1:1 bi-", "1:2:2 li-", "1:7:4 -hum", "112:4:3 li-", "112:4:3 -hū", "113:1:3 bi-", "1:7:3 -ta"]);
    // the operator's own example: ismu (QS 55:78) voiced, and bismi
    const bismi = LIBRARY.parts.find((p) => p.loc === "1:1:1")!;
    expect(bismi.tiles.map((t) => [t.translit, tileKey(t) && CLIPS[tileKey(t)!] ? tileKey(t) : null])).toEqual([
      ["bi-", null],
      ["ismu", "55:78:1-2"], // with the word before it: mid-recitation its alif is not read
    ]);
    // the five bentuk dasar tiles and what each plays
    expect(LIBRARY.parts.flatMap((p) => p.tiles.filter((t) => tileKey(t)).map((t) => [t.translit, tileKey(t)]))).toEqual([
      ["ismu", "55:78:1-2"],
      ["Allāhu", "112:1:2-3"],
      ["‘alā", "2:5:2"],
      ["rabbu", "26:24:2"],
      ["an‘ama", "5:23:6"], // not 4:69:8, whose alignment is not clean
    ]);
  });

  it("no clip for anything no page shows", () => {
    const shown = new Set([
      ...LIBRARY.concepts.flatMap((c) => c.examples.map((e) => e.loc)),
      ...LIBRARY.basics.flatMap((b) => b.signs.map((s) => clipKey(s.example)!)),
      ...LIBRARY.parts.flatMap((p) => [p.loc, ...p.tiles.flatMap((t) => tileKey(t) ?? [])]),
    ]);
    expect(Object.keys(CLIPS).filter((k) => !shown.has(k))).toEqual([]);
    expect([...shown].filter((k) => !CLIPS[k])).toEqual([]);
  });

  it("the pages draw the voice beside each example (ConceptCard rows, HarakatChart, WordParts), one player per page", () => {
    const card = read("src/components/library/ConceptCard.tsx");
    expect(card).toContain("<ClipButton loc={row.ex.loc}");
    expect(card).toContain("clips={LIBRARY.clips}");
    expect(card).toContain("<ClipPlayerProvider>{card}</ClipPlayerProvider>");
    const chart = read("src/components/library/HarakatChart.tsx");
    expect(chart).toContain("<ClipButton loc={s.loc}");
    expect(chart).toContain("<ClipPlayerProvider>");
    expect(read("src/app/[locale]/konsep/[id]/page.tsx")).toContain("clips={LIBRARY.clips}");
    const parts = read("src/components/library/WordParts.tsx");
    expect(parts).toContain("<ClipButton loc={data.loc}");
    expect(parts).toContain("voice={tileVoice(clips, t, ");
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
        expect(LIBRARY.clips[b.loc], `${c.id} ${b.loc}`).toBeTruthy();
      }
      for (const e of c.examples) expect(html, `${c.id} ${e.loc}`).toContain(`aria-label="${label(WORD_INFO[e.loc].translit)}"`);
      expect(html.split(MSG.id.Clip.credit.slice(0, 12)).length - 1, c.id).toBe(1);
    }
  });

  it("the operator's model: huruf jar's bismi diagram voices ismu (QS 55:78) and bismi, not bi-", () => {
    const html = card("huruf-jar");
    const buttons = buttonsOf(html);
    // ismu is heard with the word before it, tabāraka-smu: the button plays that run, is named by
    // what is heard, and the line under it says why (review 2026-10-12: alone it played "smu")
    const ismu = buttons.find((b) => b.loc === "55:78:1-2")!;
    expect(ismu.label).toBe(label("tabārakasmu"));
    expect(buttons.map((b) => b.loc)).not.toContain("55:78:2");
    const notes = notesOf(html);
    const note = notes.find((n) => n.id === ismu.describedBy)!;
    expect(note.kind).toBe("washal");
    expect(note.text).toBe("Di tengah bacaan, alif di awal kata ini tidak dibaca: bersama kata sebelumnya terdengar “tabārakasmu”.");
    expect(html).toContain(`aria-label="${label("bismi")}"`);
    expect(html).not.toContain(`aria-label="${label("bi-")}"`);
    // Allāhu (after huwa) likewise, on the same page
    const allah = buttons.find((b) => b.loc === "112:1:2-3")!;
    expect(allah.label).toBe(label("huwallāhu"));
    expect(notes.find((n) => n.id === allah.describedBy)!.text).toContain("terdengar “huwallāhu”");
    // every diagram's word and whole-word tile, on its concept pages
    for (const p of LIBRARY.parts) {
      const all = p.concepts.map((id) => buttonsOf(card(id)).map((b) => b.loc)).flat();
      expect(all, p.loc).toContain(p.loc);
      for (const t of p.tiles) if (tileKey(t) && CLIPS[tileKey(t)!]) expect(all, `${p.loc} ${t.q}`).toContain(tileKey(t));
    }
  });

  it("every ayah-final example row says so beside its button; no other row does", () => {
    const waqf = MSG.id.Clip.waqf_note;
    expect(waqf).toBe("Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar.");
    let rows = 0;
    let noted = 0;
    const pages = new Set<string>();
    for (const c of LIBRARY.concepts) {
      const html = card(c.id);
      const buttons = buttonsOf(html);
      const notes = notesOf(html);
      // every note is some button's description, and its id is unique on the page
      expect(new Set(notes.map((n) => n.id)).size, c.id).toBe(notes.length);
      for (const n of notes) expect(buttons.filter((b) => b.describedBy?.split(" ").includes(n.id)), `${c.id} ${n.id}`).toHaveLength(1);
      for (const e of c.examples) {
        const b = buttons.find((x) => x.loc === e.loc && x.label === label(WORD_INFO[e.loc].translit))!;
        const want = hasWaqfNote(CLIPS[e.loc], WORD_INFO[e.loc].ar);
        if (CLIPS[e.loc].last) {
          rows++;
          pages.add(c.id);
        }
        if (!want) {
          expect(b.describedBy, `${c.id} ${e.loc}`).toBeNull();
          continue;
        }
        noted++;
        expect(CLIPS[e.loc].last, `${c.id} ${e.loc}`).toBe(true);
        const note = notes.find((n) => n.id === b.describedBy)!;
        expect(note, `${c.id} ${e.loc}`).toBeTruthy();
        expect([note.kind, note.text], `${c.id} ${e.loc}`).toEqual(["waqf", waqf]);
        // visible text right after the row's first line (the word and its button), before the grammar note
        expect(html).toMatch(new RegExp(`aria-describedby="${note.id}" class="btn-listen">.*?</button>.*?</span></p><p id="${note.id}" data-clip-note="waqf"`));
      }
    }
    expect([rows, noted, pages.size]).toEqual([47, 43, 21]);
    // the review's two examples: nasta‘īnu "marfu' dengan dhammah" and khalaqa "mabni di atas fathah"
    for (const [id, loc] of [["tanda-irab", "1:5:4"], ["fiil-madhi", "113:2:4"]] as const) {
      const c = LIBRARY.concepts.find((x) => x.id === id);
      if (!c?.examples.some((e) => e.loc === loc)) continue;
      const b = buttonsOf(card(id)).find((x) => x.loc === loc)!;
      expect(b.describedBy, `${id} ${loc}`).not.toBeNull();
    }
    // yūlad ends its ayah on a sukun: heard as written, so no note
    const yulad = LIBRARY.concepts.find((c) => c.examples.some((e) => e.loc === "112:3:4"))!;
    expect(buttonsOf(card(yulad.id)).find((b) => b.loc === "112:3:4")!.describedBy).toBeNull();
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
        clips: CLIPS,
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
    // no sign word ends its ayah, so no card carries the waqf line
    expect(notesOf(html)).toEqual([]);
    expect(b.every((x) => x.describedBy === null)).toBe(true);
  });
});

describe("the clip player's logic (one Audio element per page)", () => {
  const A: Clip = { url: URL_OF("1:1"), start: 620, end: 1310 };
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
    expect(button).toContain('tg("loading_recitation")');
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
    expect(MSG.id.Clip.play_label.replace("{word}", "bismi")).toBe("Dengarkan bacaan imam: bismi");
    // the two lines that say what is heard (ClipNote), in both languages
    expect(MSG.id.Clip.waqf_note).toBe("Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar.");
    expect(MSG.en.Clip.waqf_note).toBe("At the end of an ayah the imam stops (waqf), so the final vowel sign is not heard.");
    expect(MSG.id.Clip.washal_note).toBe("Di tengah bacaan, alif di awal kata ini tidak dibaca: bersama kata sebelumnya terdengar “{heard}”.");
    expect(MSG.en.Clip.washal_note).toBe("In mid-recitation the alif at the start of this word is not read: with the word before it you hear “{heard}”.");
    expect(button).toContain('aria-describedby={[noteId, line ? statusId : null].filter(Boolean).join(" ") || undefined}');
    const note = read("src/components/library/ClipNote.tsx");
    expect(note).toContain("data-clip-note={kind}");
    expect(note).not.toMatch(/text-xs|title=/); // visible text at a reading size, never a tooltip
    expect(MSG.id.Guided.loading_recitation).toBe("Memuat bacaan imam…");
  });

  it("CI drives the real pages: no request before a press, the pressed ayah's file, a second press stops the first, the stop is at the word's end", () => {
    const shots = read("scripts/ci/screenshots.mjs");
    expect(shots).toContain("async function clipChecks(page, vp)");
    expect(shots).toContain("[data-clip]");
    expect(shots).toContain("/belajar/id/konsep/idhafah");
    expect(shots).toContain("/belajar/id/konsep/harakat");
    expect(shots).toContain("/belajar/id/konsep/huruf-jar");
    expect(shots).toContain("await clipChecks(page, vp);");
    // step 4 can fail: the element's own clock where it was paused, on a clip that does not end its ayah
    expect(shots).toContain("HTMLMediaElement.prototype.pause");
    expect(shots).toContain("STOP_LATE_S = 0.15");
    expect(shots).not.toMatch(/page\.waitForFunction\(/); // the CSP refuses its eval
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
