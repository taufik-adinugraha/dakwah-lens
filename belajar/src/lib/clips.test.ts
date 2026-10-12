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
  needsSeek,
  pressAction,
} from "./clips";
import { SURAH_INDEX, SURAHS, WORD_AR, WORD_INFO } from "./content";
import { LIBRARY, TERMS } from "./library";
import { prepareSigns, QREF } from "./terms";

// The imam's voice of every example (operator 2026-10-12: "in explanation, for example when
// explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice +
// show visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel,
// each explanation should be followed by examples (visual + voice)"; "not only for harakah, but
// also for all rules").

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const MSG = { id: JSON.parse(read("messages/id.json")), en: JSON.parse(read("messages/en.json")) };
const CLIPS = LIBRARY.clips;
const URL_OF = (loc: string) => {
  const [s, a] = loc.split(":").map((n) => n.padStart(3, "0"));
  return `https://everyayah.com/data/Alafasy_128kbps/${s}${a}.mp3`;
};
/** A lesson's own Alafasy timing of word `loc` (validate.py checks it against quran-align). */
function lessonTiming(loc: string): { url: string; start: number; end: number } | null {
  const [s, a, w] = loc.split(":").map(Number);
  const ayah = SURAHS.find((x) => x.surah === s)?.ayat.find((x) => x.ayah === a);
  const rec = ayah?.recitation.find((r) => r.reciter === "Alafasy_128kbps");
  const seg = rec?.segments.find(([sw]) => sw === w);
  return rec && seg ? { url: rec.url, start: seg[1], end: seg[2] } : null;
}

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
    expect(clipFor(CLIPS, "q:55:78:2")?.url).toBe(URL_OF("55:78")); // ٱسْمُ, the bentuk dasar of bismi
    expect(clipFor(CLIPS, "q:1:1:1/1")).toBeNull();
    expect(clipFor(CLIPS, "2:255:1")).toBeNull();
  });

  it("every clip is Alafasy's EveryAyah file of its ayah, a plausible word in it", () => {
    expect(Object.keys(CLIPS).length).toBeGreaterThan(80);
    for (const [key, c] of Object.entries(CLIPS)) {
      const [s, a, w] = key.split(/[:-]/);
      expect(c.url, key).toBe(URL_OF(`${s}:${a}`));
      expect(Number.isInteger(c.start) && Number.isInteger(c.end), key).toBe(true);
      expect(c.end - c.start, key).toBeGreaterThanOrEqual(150);
      expect(c.end - c.start, key).toBeLessThanOrEqual(7000);
      expect(Number(w)).toBeGreaterThan(0);
    }
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
      expect(WORD_INFO[key]?.ar, s.term).toBeTruthy();
      expect(clipFor(CLIPS, s.example), `${s.term} ${s.example}`).not.toBeNull();
    }
  });

  it("every parts diagram: the joined word with a clip; the bentuk dasar tiles that are words too; only parts of words go unvoiced", () => {
    const unvoiced: string[] = [];
    for (const p of LIBRARY.parts) {
      expect(WORD_INFO[p.loc]?.ar, p.loc).toBeTruthy();
      expect(clipFor(CLIPS, p.loc), p.loc).not.toBeNull();
      for (const t of p.tiles) {
        expect(LIBRARY.quran[t.q.slice(2)], t.q).toBeTruthy();
        if (clipFor(CLIPS, t.q)) continue;
        // Why none: a QAC segment (a prefix or suffix: bi-, li-, -hum, -hū, -ta) is never
        // recited on its own; the joined word's clip voices it inside the word.
        expect(t.q, `${p.loc} ${t.q}`).toMatch(/\/\d+$/);
        unvoiced.push(`${p.loc} ${t.translit}`);
      }
    }
    expect(unvoiced).toEqual(["1:1:1 bi-", "1:2:2 li-", "1:7:4 -hum", "112:4:3 li-", "112:4:3 -hū", "113:1:3 bi-", "1:7:3 -ta"]);
    // the operator's own example: ismu (QS 55:78) voiced, and bismi
    const bismi = LIBRARY.parts.find((p) => p.loc === "1:1:1")!;
    expect(bismi.tiles.map((t) => [t.translit, !!clipFor(CLIPS, t.q)])).toEqual([
      ["bi-", false],
      ["ismu", true],
    ]);
  });

  it("no clip for anything no page shows", () => {
    const shown = new Set([
      ...LIBRARY.concepts.flatMap((c) => c.examples.map((e) => e.loc)),
      ...LIBRARY.basics.flatMap((b) => b.signs.map((s) => clipKey(s.example)!)),
      ...LIBRARY.parts.flatMap((p) => [p.loc, ...p.tiles.flatMap((t) => clipKey(t.q) ?? [])]),
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
    expect(parts).toContain("voice={voiceOf(clips, t.q, t.translit)}");
  });
});

describe("the pages as rendered (server markup, real messages)", () => {
  const intl = (el: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale: "id", messages: MSG.id, timeZone: "Asia/Jakarta" } as ComponentProps<typeof NextIntlClientProvider>, el),
    );
  const buttonsOf = (html: string) =>
    [...html.matchAll(/<button type="button" data-clip="([^"]+)" data-state="([^"]+)" aria-label="([^"]+)" class="btn-listen">/g)].map(
      (m) => ({ loc: m[1], state: m[2], label: m[3] }),
    );
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
    const locs = buttonsOf(html).map((b) => b.loc);
    expect(locs).toContain("55:78:2");
    expect(html).toContain(`aria-label="${label("ismu")}"`);
    expect(html).toContain(`aria-label="${label("bismi")}"`);
    expect(html).not.toContain(`aria-label="${label("bi-")}"`);
    // every diagram's word and whole-word tile, on its concept pages
    for (const p of LIBRARY.parts) {
      const all = p.concepts.map((id) => buttonsOf(card(id)).map((b) => b.loc)).flat();
      expect(all, p.loc).toContain(p.loc);
      for (const t of p.tiles) if (clipKey(t.q) && CLIPS[clipKey(t.q)!]) expect(all, `${p.loc} ${t.q}`).toContain(clipKey(t.q));
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
        clips: CLIPS,
        labels: { sound: "Bunyi", example: "Contoh", from: "dari", credit: MSG.id.Clip.credit },
      }),
    );
    const b = buttonsOf(html);
    expect(b.map((x) => x.loc)).toEqual(signs.map((s) => s.loc));
    expect(b.map((x) => x.label)).toEqual(signs.map((s) => label(WORD_INFO[s.loc].translit)));
    expect(html.match(/role="status"/g)).toHaveLength(signs.length);
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
    expect(MSG.id.Guided.loading_recitation).toBe("Memuat bacaan imam…");
  });

  it("CI drives the real pages: no request before a press, the pressed ayah's file, a second press stops the first", () => {
    const shots = read("scripts/ci/screenshots.mjs");
    expect(shots).toContain("async function clipChecks(page, vp)");
    expect(shots).toContain("[data-clip]");
    expect(shots).toContain("/belajar/id/konsep/idhafah");
    expect(shots).toContain("/belajar/id/konsep/harakat");
    expect(shots).toContain("await clipChecks(page, vp);");
  });
});
