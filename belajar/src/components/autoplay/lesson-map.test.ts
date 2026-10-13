import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LessonMapCard, type LessonMapCardKind } from "@/components/lesson/LessonMapCard";
import { WordCard } from "@/components/lesson/WordCard";
import {
  availableExercises,
  buildAutoplaySequence,
  createAutoplayState,
  deriveLessonMap,
  hasArabicScript,
  lessonMapInputOf,
  lessonMapProblems,
  LINE_ID_RE,
  parseLineId,
  presentConcepts,
  reduceAutoplay,
  type AutoplayEvent,
  type LessonMapAyah,
  type LessonMapFile,
  type LessonMapInput,
  type NarrationManifest,
} from "@/lib/autoplay";
import { loadCheckInput, sequenceProblems } from "@/lib/autoplay/checks";
import { composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { captionSpans } from "@/lib/emphasis";
import { conceptsIntroducedIn, LIBRARY } from "@/lib/library";
import { lessonMapFor, lessonMapInput, MAPPED_SLUGS } from "@/lib/map-content";
import { quizAyah } from "@/lib/quiz-content";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence } from "./build";
import { captionText, karaokeParts, stageCaption } from "./caption";
import { narrationFor } from "./manifests";
import { AUTOPLAY_TEXT_SETS } from "./texts";

// THE LESSON MAP (operator 2026-10-13, docs/belajar-plan.md L23): "at the beginning of the ayat,
// better to inform what concept we will learn in this ayat, also explain maybe we skip some concept
// and will visit later in next ayat instead of explaining all concepts in 1 ayat. for example marfu'
// also exist in ayat-1, but we skipt the lesson to be done in ayat2. so at the beginning we inform
// what will be learnt, in the end recap what we've learnt" — "if some concept already done in
// previous ayat, we say we repeat what we've learnt before".
//
// What is new, repeated and taught later is DERIVED (src/lib/autoplay/lessonMap.ts; the pipeline's
// twin is pipeline/lessonmap.py, whose file content/map/<slug>.json the page reads). Here: the
// derivation pinned on Al-Fatihah, the file held to it, the names (the ones the "Konsep baru: …"
// captions use), the two steps of the autoplay sequence, the per-surah switch, and the card.
// That a browser DRAWS the cards is checked in CI (scripts/ci/screenshots.mjs lessonMapChecks).

// The word card links its concepts through the app's Link; no router is mounted in a unit test.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: (p: { href: unknown; className?: string; children?: ReactNode }) => createElement("a", { href: String(p.href), className: p.className }, p.children),
}));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const FILE = lessonMapFor("al-fatihah")!;

/** Al-Fatihah, measured on 2026-10-13: ayah → [new, review, later]. The sets and the counts are
 *  the operator's measurement; review and later are in the order they are taught. */
const TABLE: Record<number, [string[], string[], string[]]> = {
  1: [["kalimah-isim-fiil-huruf", "tanda-irab", "huruf-jar", "idhafah", "naat"], [], ["syibhul-jumlah"]],
  2: [["jumlah-ismiyyah", "syibhul-jumlah", "jamak-mudzakkar-salim"], ["tanda-irab", "huruf-jar", "idhafah", "naat"], ["wazan-dan-tashrif", "badal"]],
  3: [["wazan-dan-tashrif"], ["naat"], []],
  4: [["isim-fail"], ["idhafah", "naat", "wazan-dan-tashrif"], []],
  5: [["murab-mabni", "dhamir", "taqdim-maful", "fiil-mudhari", "jumlah-filiyyah", "athaf", "bab-istifal", "ilal"], ["kalimah-isim-fiil-huruf"], ["maful-bih"]],
  6: [["fiil-amr", "maful-bih"], ["tanda-irab", "naat", "isim-fail", "dhamir", "bab-istifal", "ilal"], []],
  7: [
    ["badal", "isim-maushul", "fiil-madhi", "bab-ifal", "isim-maful", "naib-fail"],
    ["kalimah-isim-fiil-huruf", "huruf-jar", "idhafah", "jamak-mudzakkar-salim", "isim-fail", "murab-mabni", "dhamir", "jumlah-filiyyah", "athaf"],
    [],
  ],
};
/** Where each postponed concept is taught. */
const LATER_AT: Record<string, number> = { "syibhul-jumlah": 2, "wazan-dan-tashrif": 3, badal: 7, "maful-bih": 6, marfu: 2 };
/** The authored later items the file adds to the derivation (operator 2026-10-13: "in ayat-1, it
 *  mentions 'bentuk tertentu' but no explanation about marfu' itself, better to inform it will be
 *  learnt later"): ayah → topic ids, after the concepts taught in the same ayah. */
const TOPICS: Record<number, string[]> = { 1: ["marfu"] };
/** The file's table: the derivation plus the topics. */
const FILE_TABLE: Record<number, [string[], string[], string[]]> = Object.fromEntries(
  Object.entries(TABLE).map(([n, [fresh, review, later]]) => [n, [fresh, review, [...later, ...(TOPICS[Number(n)] ?? [])]]]),
);

const asTable = (ayat: readonly LessonMapAyah[]) => Object.fromEntries(ayat.map((a) => [a.ayah, [a.new, a.review, a.later]]));

describe("the lesson map: what is new, repeated and taught later (derived)", () => {
  it("Al-Fatihah: the table of 2026-10-13", () => {
    const derived = deriveLessonMap(SURAHS, LIBRARY.concepts, 1);
    expect(asTable(derived)).toEqual(TABLE);
    expect(derived.map((a) => [a.new.length, a.review.length, a.later.length])).toEqual([
      [5, 0, 1],
      [3, 4, 2],
      [1, 1, 0],
      [1, 3, 0],
      [8, 1, 1],
      [2, 6, 0],
      [6, 9, 0],
    ]);
    // 26 concepts are taught in the surah, each in exactly one ayah.
    const all = derived.flatMap((a) => a.new);
    expect(all).toHaveLength(26);
    expect(new Set(all).size).toBe(26);
  });

  it("new(ayah) is the library's rule for the ayah's Konsep baru lines; every concept on a word is new, repeated or postponed", () => {
    const rank = new Map(SURAHS.flatMap((s) => s.ayat).map((a, i) => [a.loc, i]));
    const taught = new Map(LIBRARY.concepts.map((c) => [c.id, c.examples[0].loc.split(":").slice(0, 2).join(":")]));
    for (const s of SURAHS) {
      const derived = deriveLessonMap(SURAHS, LIBRARY.concepts, s.surah);
      expect(derived.map((a) => a.ayah)).toEqual(s.ayat.map((a) => a.ayah));
      s.ayat.forEach((a, i) => {
        const d = derived[i];
        expect(d.new, a.loc).toEqual(conceptsIntroducedIn(a.loc).map((c) => c.id));
        const here = rank.get(a.loc)!;
        for (const c of d.review) expect(rank.get(taught.get(c)!)!, `${a.loc} review ${c}`).toBeLessThan(here);
        for (const c of d.later) expect(rank.get(taught.get(c)!)!, `${a.loc} later ${c}`).toBeGreaterThan(here);
        const present = presentConcepts(a);
        for (const c of [...d.review, ...d.later]) expect(present, `${a.loc} ${c}`).toContain(c);
        // … each in exactly one group.
        const grouped = [...d.new, ...d.review, ...d.later];
        expect(new Set(grouped).size, a.loc).toBe(grouped.length);
        for (const c of present) expect(grouped, `${a.loc} ${c}`).toContain(c);
      });
    }
    // Across surahs: Al-Ikhlas repeats what Al-Fatihah taught.
    expect(deriveLessonMap(SURAHS, LIBRARY.concepts, 112)[0].review).toContain("fiil-amr");
  });

  it("a structure group's concept counts as present (today each one is tagged on a word too)", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const tagged = new Set(a.words.flatMap((w) => w.concepts));
        for (const g of a.structure?.groups ?? []) if (g.concept) expect(tagged.has(g.concept), `${a.loc} ${g.concept}`).toBe(true);
      }
    }
    const a = FATIHAH.ayat[2];
    const extra = { ...a, structure: { ...a.structure!, groups: [...a.structure!.groups, { words: [1], label: "x", concept: "badal" }] } };
    expect(presentConcepts(extra)).toEqual([...presentConcepts(a), "badal"]);
    const moved = SURAHS.map((s) => ({ ayat: s.ayat.map((x) => (x.loc === a.loc ? extra : x)) }));
    expect(deriveLessonMap(moved, LIBRARY.concepts, 1)[2].later).toEqual(["badal"]);
  });
});

describe("the lesson map file (content/map) and the per-surah switch", () => {
  it("content/map/al-fatihah.json is the derivation (plus its authored later items), with where each is taught", () => {
    expect(asTable(FILE.ayat)).toEqual(FILE_TABLE);
    expect(lessonMapProblems(FILE, SURAHS, LIBRARY.concepts)).toEqual([]);
    for (const [cid, ayah] of Object.entries(LATER_AT)) expect([FILE.concepts[cid].surah, FILE.concepts[cid].ayah]).toEqual([1, ayah]);
    expect(Object.keys(FILE.concepts)).toHaveLength(27);
  });

  it("marfu' is shown in ayah 1 and taught in ayah 2: an authored later item, held to the line that names it", () => {
    const c = FILE.concepts.marfu;
    expect(c).toEqual({ name: "Marfu’ (مَرْفُوع)", latin: "Marfu'", from: "topic", note: "mengapa bentuk dasar berakhir dhammah (ضَمَّة)", surah: 1, ayah: 2, line: "al-fatihah:2:w1:compose:8" });
    expect(LIBRARY.concepts.some((x) => x.id === "marfu")).toBe(false);
    const lines = narrationFor("al-fatihah")!.lines;
    expect(lines[c.line!].display).toContain(`disebut ${c.name.toLowerCase()}`);
    // Ayah 1 never names it — it only points ahead, where the learner wonders.
    for (const [lid, l] of Object.entries(lines)) {
      if (lid.startsWith("al-fatihah:1:") && !lid.endsWith(":map")) expect(l.display!.toLowerCase(), lid).not.toContain("marfu");
    }
    expect(lines["al-fatihah:1:w1:compose:3"].display).toMatch(/tanda bunyi u di atas huruf mim \(مُ\)\. Mengapa dhammah \(ضَمَّة\), kita pelajari di ayat kedua\.$/);
    // In the lesson: one of ayah 1's two postponed things, with its note.
    expect(lessonMapInput("al-fatihah", 1)!.later).toEqual([
      { id: "syibhul-jumlah", name: FILE.concepts["syibhul-jumlah"].name, surah: 1, ayah: 2 },
      { id: "marfu", name: c.name, surah: 1, ayah: 2, note: c.note },
    ]);
    // Refused: a topic listed as new or repeated, one not taught later, one without its line.
    const fault = (fn: (f: LessonMapFile) => void) => {
      const f = structuredClone(FILE) as LessonMapFile;
      fn(f);
      return lessonMapProblems(f, SURAHS, LIBRARY.concepts).join("\n");
    };
    expect(fault((f) => f.ayat[0].review.push(...f.ayat[0].later.splice(1)))).toContain("topic marfu is listed as review");
    expect(fault((f) => f.ayat[1].later.push("marfu"))).toContain("topic marfu is taught in 1:2, which is not a later ayah");
    expect(fault((f) => delete f.concepts.marfu.line)).toContain("topic marfu needs its note and a teaching line of ayah 2");
    expect(fault((f) => (f.concepts.marfu.line = "al-fatihah:3:w1"))).toContain("topic marfu needs its note and a teaching line of ayah 2");
  });

  it("only a surah the pipeline switched on has a map: the files, the loader and the authored switches agree", () => {
    const files = readdirSync(join(BELAJAR, "content", "map")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    const switched = readdirSync(join(BELAJAR, "pipeline", "authored")).flatMap((f) => (f.endsWith(".map.json") ? [f.slice(0, -".map.json".length)] : []));
    expect([...MAPPED_SLUGS].sort()).toEqual(files.sort());
    expect(files.sort()).toEqual(switched.sort());
    expect([...MAPPED_SLUGS]).toEqual(["al-fatihah"]);
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const map = lessonMapInput(s.slug, a.ayah);
        if (s.slug === "al-fatihah") expect(map).not.toBeNull();
        else expect(map, `${s.slug} ${a.ayah}`).toBeNull();
      }
    }
  });

  it("the check script's raw file gives the page's map", () => {
    const { input } = loadCheckInput((rel) => {
      const path = join(BELAJAR, "content", rel);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    });
    for (const s of SURAHS) {
      const raw = (input.maps?.[s.slug] ?? null) as LessonMapFile | null;
      for (const a of s.ayat) expect(lessonMapInputOf(raw, a.ayah)).toEqual(lessonMapInput(s.slug, a.ayah));
    }
  });

  it("a file that lies about the lessons is refused (planted faults)", () => {
    const fault = (fn: (f: LessonMapFile) => void) => {
      const f = structuredClone(FILE) as LessonMapFile;
      fn(f);
      return lessonMapProblems(f, SURAHS, LIBRARY.concepts).join("\n");
    };
    const entry = (f: LessonMapFile, n: number) => f.ayat.find((a) => a.ayah === n)!;
    // later ⊆ the ayah's concepts, and really taught later; review really taught earlier.
    expect(fault((f) => entry(f, 1).later.push("badal"))).toContain("ayah 1: later");
    expect(fault((f) => entry(f, 3).later.push(...entry(f, 3).review.splice(0)))).toMatch(/ayah 3: review[\s\S]*ayah 3: later/);
    expect(fault((f) => entry(f, 1).review.push(...entry(f, 1).later.splice(0)))).toContain("ayah 1: review");
    // new is the ayah's concept lines, in their order.
    expect(fault((f) => entry(f, 1).new.reverse())).toContain("ayah 1: new");
    expect(fault((f) => entry(f, 2).new.pop())).toContain("ayah 2: new");
    // a concept of the ayah left out of every group; a record with the wrong ayah; a missing record.
    expect(fault((f) => entry(f, 2).review.shift())).toContain("ayah 2: review");
    expect(fault((f) => (f.concepts.naat.ayah = 2))).toContain("naat is taught in 1:1, not 1:2");
    expect(fault((f) => delete f.concepts.ilal)).toContain("ilal is listed and has no record");
    expect(fault((f) => f.ayat.pop())).toContain("not the lesson's ayat");
  });
});

describe("a concept's name is the one its Konsep baru caption uses", () => {
  it("every name is what src/lib/emphasis.ts emphasises as the concept's name in that caption", () => {
    const lead = "Konsep baru: ";
    for (const [cid, c] of Object.entries(FILE.concepts)) {
      if (c.from === "topic") continue; // an authored later item: named by the line that teaches it
      expect(c.from, cid).toBe("title"); // Al-Fatihah needs no explicit name
      const slug = SURAHS.find((s) => s.surah === c.surah)!.slug;
      const lines = narrationFor(slug)!.lines;
      const line = lines[`${slug}:${c.ayah}:concept:${cid}`] ?? lines[`${slug}:${c.ayah}:concept:${cid}:a`];
      const display = line.display!;
      expect(display.startsWith(lead), cid).toBe(true);
      const span = captionSpans(display).find((e) => e.kind === "term" && e.from === lead.length);
      expect(span, `${cid}: “${display.slice(0, 60)}”`).toBeDefined();
      expect(display.slice(span!.from, span!.to), cid).toBe(c.name);
      // The prose form is the same name without its Arabic.
      expect(hasArabicScript(c.latin), cid).toBe(false);
      expect(c.latin.split(/\s+/).length, cid).toBeLessThanOrEqual(4);
    }
  });
});

describe("the lesson map in the autoplay sequence", () => {
  it("Al-Fatihah: map right after the imam's recitation, learned right before the recap — one line each, no word marked", () => {
    for (const a of FATIHAH.ayat) {
      for (const locale of ["id", "en"] as const) {
        const seq = stageSequence(FATIHAH, a, locale);
        const ids = seq.steps.map((s) => s.id);
        const where = `al-fatihah ${a.ayah} (${locale})`;
        expect(ids.slice(0, 3), where).toEqual(["intro", "recite", "map"]);
        // The harakat primer (ayah 1) comes after the map; else the first word does.
        expect(ids[3], where).toBe(a.ayah === 1 ? "primer" : "w1:recite");
        expect(ids.slice(-3), where).toEqual(["learned", "recap", a.ayah === 7 ? "done" : "next"]);
        expect(ids.indexOf("learned"), where).toBeGreaterThan(Math.max(...seq.steps.flatMap((s, i) => (s.kind === "exercise" || s.kind === "structure" ? [i] : []))));
        for (const kind of ["map", "learned"] as const) {
          const step = seq.steps.find((s) => s.id === kind)!;
          expect(step.kind, where).toBe(kind);
          expect(step.lines, where).toEqual([`al-fatihah:${a.ayah}:${kind}`]);
          expect(LINE_ID_RE.test(step.lines[0])).toBe(true);
          expect(parseLineId(step.lines[0])).toMatchObject({ kind: "ayah", slug: "al-fatihah", ayah: a.ayah, part: kind });
          const [cue] = step.cues;
          expect([cue.highlight, cue.focus, cue.frame], where).toEqual([[], null, null]);
          expect(step.recite, where).toBeUndefined();
          expect(step.examples, where).toBeUndefined();
          if (locale === "id") {
            // The caption is the narration's display: what is spoken.
            expect(cue.display, where).toBe(narrationFor("al-fatihah")!.lines[step.lines[0]].display);
          } else {
            // An English page has no narration: the engine's own caption gives the counts, and
            // the card names the concepts — no Arabic script in a caption without a manifest.
            expect(cue.display, where).toBeNull();
            expect(hasArabicScript(cue.caption), where).toBe(false);
            expect(cue.caption, where).toContain(String(TABLE[a.ayah][0].length));
          }
        }
        const map = lessonMapInput("al-fatihah", a.ayah);
        const ctx = { ayah: a, last: a.ayah === 7, exercises: availableExercises(quizAyah("al-fatihah", a.ayah)), introduced: conceptsIntroducedIn(a.loc), compose: composeInput("al-fatihah", a) };
        expect(sequenceProblems(seq, { ...ctx, map }), where).toEqual([]);
        // The engine's own check refuses a lesson whose steps and map disagree.
        expect(sequenceProblems(seq, ctx).join("\n"), where).toContain("a map step in a lesson without a lesson map");
      }
    }
  });

  it("the engine's captions say how many, in every locale's set", () => {
    for (const [locale, texts] of Object.entries(AUTOPLAY_TEXT_SETS)) {
      for (const counts of [{ new: 5, review: 0, later: 1 }, { new: 1, review: 3, later: 0 }, { new: 0, review: 2, later: 0 }]) {
        const said = texts.lessonMap(counts);
        expect(hasArabicScript(said), locale).toBe(false);
        expect(said, locale).not.toMatch(/\b[A-Z]{2,}\b/);
        for (const n of [counts.new, counts.review, counts.later]) if (n) expect(said, locale).toContain(String(n));
        if (!counts.review) expect(said, locale).not.toMatch(/ulang|repeat/i);
      }
      expect(texts.learned({ new: 3 })).toContain("3");
      expect(texts.learned({ new: 0 })).not.toMatch(/\d/);
    }
  });

  it("a lesson without a map has neither step; with one, only those two steps are added", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        const kinds = seq.steps.map((x) => x.kind);
        const mapped = s.slug === "al-fatihah";
        expect(kinds.filter((k) => k === "map" || k === "learned"), `${s.slug} ${a.ayah}`).toEqual(mapped ? ["map", "learned"] : []);
      }
    }
    // The same lesson with and without its map: the other steps are untouched, in the same order.
    const a = FATIHAH.ayat[1];
    const base = {
      slug: "al-fatihah",
      surahName: FATIHAH.name_id,
      ayahCount: FATIHAH.ayat.length,
      ayah: a,
      introduced: conceptsIntroducedIn(a.loc),
      exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
      texts: AUTOPLAY_TEXT_SETS.id,
      narration: narrationFor("al-fatihah"),
    };
    const without = buildAutoplaySequence(base);
    const withMap = buildAutoplaySequence({ ...base, map: lessonMapInput("al-fatihah", a.ayah) });
    expect(without.steps.some((s) => s.kind === "map" || s.kind === "learned")).toBe(false);
    expect(JSON.stringify(withMap.steps.filter((s) => s.kind !== "map" && s.kind !== "learned"))).toBe(JSON.stringify(without.steps));
    // An empty map (nothing new, nothing repeated) still has its two steps: the switch is the map.
    const empty: LessonMapInput = { surah: 1, new: [], review: [], later: [] };
    expect(buildAutoplaySequence({ ...base, map: empty }).steps.filter((s) => s.kind === "map" || s.kind === "learned")).toHaveLength(2);
  });

  it("the lesson plays its map line and moves on to the next step by itself", () => {
    const seq = stageSequence(FATIHAH, FATIHAH.ayat[1], "id");
    const send = (s: ReturnType<typeof createAutoplayState>, e: AutoplayEvent) => reduceAutoplay(seq, s, e);
    let s = send(createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== "map") s = send(s, { type: "next" });
    // Not rendered yet: the caption is read at reading pace; rendered: narrated. Either way one
    // activity for the line, then the step ends and the first word's step starts.
    for (let guard = 0; guard < 20 && seq.steps[s.idx].id === "map"; guard++) {
      const a = s.activity;
      expect(a).not.toBeNull();
      if (!a) break;
      s = send(s, a.kind === "narrate" ? { type: "narration_end", token: a.token } : { type: "timer", token: a.token });
    }
    expect(seq.steps[s.idx].id).toBe("w1:recite");
    expect(s.phase).not.toBe("paused");
  });

  it("Al-Fatihah's manifest has the two lines for every ayah, and no other surah's has any", () => {
    for (const s of SURAHS) {
      const lines = Object.keys(narrationFor(s.slug)!.lines).filter((l) => /:(?:map|learned)(?::[a-z])?$/.test(l));
      expect(lines, s.slug).toEqual(s.slug === "al-fatihah" ? s.ayat.flatMap((a) => [`al-fatihah:${a.ayah}:map`, `al-fatihah:${a.ayah}:learned`]) : []);
    }
  });
});

describe("a lesson-map line's karaoke caption goes part by part (the card needs the room)", () => {
  const a = FATIHAH.ayat[1];
  const LINE = "al-fatihah:2:map";
  const real = narrationFor("al-fatihah")!;
  const display = real.lines[LINE].display!;
  /** The line as it is after its render: one file, one token per spoken word — a dictionary term
   *  with its Arabic is ONE word of several ("jumlah ismiyyah (جُمْلَة اِسْمِيَّة),"), as the
   *  pipeline's tokens have it. Half a second a word. */
  const tokens = (() => {
    const out: string[] = [];
    for (const w of display.split(" ")) {
      // The Arabic in a term's bracket, and the words of the term before it, belong to one token.
      const inTerm = out.length > 0 && /[(\u0600-\u06FF]/.test(out[out.length - 1]) && !out[out.length - 1].includes(")");
      const opens = w.startsWith("(");
      if (inTerm || opens) out[out.length - 1] += ` ${w}`;
      else out.push(w);
    }
    return out.map((t, i) => ({ t, s: i * 0.5, e: i * 0.5 + 0.4 }));
  })();
  const rendered: NarrationManifest = {
    ...real,
    lines: {
      ...real.lines,
      [LINE]: { ...real.lines[LINE], audio: { url: "/belajar/media/narration/kang-nandar/al-fatihah/0123456789abcdef.mp3", ms: tokens.length * 500, sha256: "c".repeat(64) }, tokens },
    },
  };
  const seq = buildAutoplaySequence({
    slug: "al-fatihah",
    surahName: FATIHAH.name_id,
    ayahCount: FATIHAH.ayat.length,
    ayah: a,
    introduced: conceptsIntroducedIn(a.loc),
    exercises: availableExercises(quizAyah("al-fatihah", a.ayah)),
    texts: AUTOPLAY_TEXT_SETS.id,
    narration: rendered,
    map: lessonMapInput("al-fatihah", a.ayah),
  });
  const step = seq.steps.find((s) => s.id === "map")!;
  const [cue] = step.cues;
  const words = cue.audio[0].words!;
  /** The lesson on the map step, its line playing. */
  const playing = () => {
    let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== "map") s = reduceAutoplay(seq, s, { type: "next" });
    expect(s.activity).toMatchObject({ kind: "narrate", line: LINE });
    return s;
  };

  it("the line's words fall into its caption parts: three sentences, three parts, every word once", () => {
    expect(cue.parts).toHaveLength(3);
    expect(cue.parts.every((p) => p.length <= 180)).toBe(true);
    expect(words.some(([t]) => t.split(" ").length > 1)).toBe(true); // a term of several words is one karaoke word
    const cut = karaokeParts(cue.parts, words)!;
    expect(cut).not.toBeNull();
    expect(cut.map(([from, to]) => words.slice(from, to).map(([t]) => t).join(" "))).toEqual(cue.parts);
    expect(cut[0][0]).toBe(0);
    expect(cut[2][1]).toBe(words.length);
    // One part, or words that do not line up with the parts: the whole line, as before.
    expect(karaokeParts([cue.caption], words)).toBeNull();
    expect(karaokeParts(cue.parts, words.slice(1))).toBeNull();
    expect(karaokeParts(["satu dua", "tiga"], [["satu", 0, 1], ["dua tiga", 1, 2]])).toBeNull();
  });

  it("shows the part with the word being said, the karaoke position counted inside it", () => {
    const s = playing();
    const a2 = s.activity!;
    if (a2.kind !== "narrate") throw new Error("not narrating");
    const cut = karaokeParts(cue.parts, words)!;
    const at = (now: number, said: number) => stageCaption(seq, s, null, { token: a2.token, line: LINE, file: a2.file, now, said });
    // Before any word: the first part, nothing said.
    const first = at(-1, 0);
    expect(first).toMatchObject({ kind: "karaoke", now: -1, said: 0, voiced: true });
    expect(captionText(first)).toBe(cue.parts[0]);
    // The second word of the second part: that part, its first word said, its second being said.
    const [from2] = cut[1];
    const second = at(from2 + 1, from2 + 2);
    expect(captionText(second)).toBe(cue.parts[1]);
    expect(second).toMatchObject({ kind: "karaoke", now: 1, said: 2 });
    // The last word of the first part ended and the next has not started: still the first part.
    const [, to1] = cut[0];
    const between = at(-1, to1);
    expect(captionText(between)).toBe(cue.parts[0]);
    expect(between).toMatchObject({ now: -1, said: to1 });
    // The file is through (the runner sets "all said"): the last part, every word said.
    const done = at(-1, Number.MAX_SAFE_INTEGER);
    expect(captionText(done)).toBe(cue.parts[2]);
    expect(done).toMatchObject({ now: -1, said: cut[2][1] - cut[2][0] });
    // Each part carries its own words' emphasis slots, one per word.
    for (const c of [first, second, done]) if (c.kind === "karaoke") expect(c.emph).toHaveLength(c.words.length);
  });

  it("every other line keeps its whole karaoke caption", () => {
    // A concept line of the same ayah: rendered in one file, and longer than one caption part.
    const other = seq.steps.find((x) => x.kind === "concept" && x.cues[0].parts.length > 1 && x.cues[0].audio.length === 1 && x.cues[0].audio[0].words);
    expect(other).toBeDefined();
    const line = other!.cues[0];
    let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
    while (seq.steps[s.idx].id !== other!.id) s = reduceAutoplay(seq, s, { type: "next" });
    const act = s.activity!;
    if (act.kind !== "narrate") throw new Error("not narrating");
    expect(act.line).toBe(line.line);
    const c = stageCaption(seq, s, null, { token: act.token, line: line.line, file: act.file, now: 3, said: 4 });
    expect(c).toMatchObject({ kind: "karaoke", now: 3, said: 4 });
    if (c.kind === "karaoke") expect(c.words).toHaveLength(line.audio[0].words!.length);
  });
});

describe("the lesson map's card", () => {
  const MSG = { id, en } as const;
  type Locale = keyof typeof MSG;
  const card = (locale: Locale, map: LessonMapInput, kind: LessonMapCardKind) => {
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale,
      messages: MSG[locale],
      timeZone: "Asia/Jakarta",
      children: createElement(LessonMapCard, { map, kind }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };
  /** The groups of a card's markup, in order: [group, its heading, [item id, its text]…]. */
  const groups = (html: string) =>
    [...html.matchAll(/<div data-map-group="([a-z]+)"[^>]*>([\s\S]*?)<\/ul><\/div>/g)].map((m) => ({
      group: m[1],
      heading: /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(m[2])![1].replace(/<[^>]+>/g, "").trim(),
      items: [...m[2].matchAll(/<li data-map-item="([a-z0-9-]+)" data-map-ayah="([0-9:]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((li) => ({
        id: li[1],
        ayah: li[2],
        text: li[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
        where: /<span data-map-where[^>]*>([^<]*)<\/span>/.exec(li[3])?.[1] ?? null,
        note: /<span data-map-note[^>]*>([\s\S]*?)<\/span><\/span><\/li>$/.exec(li[0])?.[1].replace(/<[^>]+>/g, "").trim() ?? null,
        ticked: /<svg/.test(li[3]),
      })),
    }));

  it("the opening: Baru di ayat ini, Mengulang (each with its ayah), Nanti (each with its ayah) — every concept, by its name", () => {
    for (const a of FATIHAH.ayat) {
      const map = lessonMapInput("al-fatihah", a.ayah)!;
      const html = card("id", map, "map");
      expect(html).toContain('data-autoplay="lesson-map"');
      expect(html).toContain('data-map="map"');
      const [fresh, review, later] = FILE_TABLE[a.ayah];
      const got = groups(html);
      // A group with nothing in it is not drawn.
      expect(got.map((g) => g.group), `ayah ${a.ayah}`).toEqual(["new", ...(review.length ? ["review"] : []), ...(later.length ? ["later"] : [])]);
      const by = Object.fromEntries(got.map((g) => [g.group, g]));
      expect(by.new.heading).toBe(id.Guided.map_new);
      expect(by.new.items.map((i) => i.id)).toEqual(fresh);
      for (const it of by.new.items) {
        expect(it.text, it.id).toBe(FILE.concepts[it.id].name);
        expect(it.where, it.id).toBeNull();
      }
      if (review.length) {
        expect(by.review.heading).toBe(id.Guided.map_review);
        expect(by.review.items.map((i) => i.id)).toEqual(review);
        for (const it of by.review.items) {
          const taught = FILE.concepts[it.id].ayah;
          expect(taught, it.id).toBeLessThan(a.ayah);
          expect(it.where, it.id).toBe(`dari ayat ${taught}`);
          expect(it.text, it.id).toBe(`${FILE.concepts[it.id].name} dari ayat ${taught}`);
        }
      }
      if (later.length) {
        expect(by.later.heading).toBe(id.Guided.map_later);
        expect(by.later.items.map((i) => i.id)).toEqual(later);
        for (const it of by.later.items) {
          expect(it.where, it.id).toBe(`di ayat ${LATER_AT[it.id]}`);
          expect(LATER_AT[it.id], it.id).toBeGreaterThan(a.ayah);
          // An authored later item says what is left open, on a row of its own; a concept has no note.
          const note = FILE.concepts[it.id].note ?? null;
          expect(it.note, it.id).toBe(note);
          expect(it.text, it.id).toBe(`${FILE.concepts[it.id].name} di ayat ${LATER_AT[it.id]}${note ? ` ${note}` : ""}`);
        }
      }
      // Every Arabic run is isolated, right to left (MixedText): nothing is typed here.
      for (const m of html.matchAll(/<bdi[^>]*>/g)) expect(m[0]).toMatch(/lang="ar" dir="rtl"/);
      expect(html.match(/<bdi/g)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("the closing: the new concepts, each with a tick, under Sudah dipelajari — nothing else", () => {
    for (const a of FATIHAH.ayat) {
      const html = card("id", lessonMapInput("al-fatihah", a.ayah)!, "learned");
      expect(html).toContain('data-map="learned"');
      const got = groups(html);
      expect(got.map((g) => g.group)).toEqual(["learned"]);
      expect(got[0].heading).toBe(id.Guided.map_learned);
      expect(got[0].items.map((i) => i.id)).toEqual(TABLE[a.ayah][0]);
      for (const it of got[0].items) {
        expect(it.ticked, it.id).toBe(true);
        expect(it.where, it.id).toBeNull();
        expect(it.text, it.id).toBe(FILE.concepts[it.id].name);
      }
    }
  });

  it("the labels follow the locale; a concept of another surah is shown with its surah; an ayah with nothing new says so", () => {
    const html = card("en", lessonMapInput("al-fatihah", 2)!, "map");
    for (const label of [en.Guided.map_new, en.Guided.map_review, en.Guided.map_later, "from ayah 1", "in ayah 7"]) expect(html).toContain(label);
    // Al-Ikhlas 2 as it would be with a map: nothing new, concepts repeated from Al-Fatihah.
    const entry = deriveLessonMap(SURAHS, LIBRARY.concepts, 112)[1];
    const item = (cid: string) => {
      const [surah, ayah] = LIBRARY.concepts.find((c) => c.id === cid)!.examples[0].loc.split(":").map(Number);
      return { id: cid, name: cid, surah, ayah };
    };
    const map: LessonMapInput = { surah: 112, new: entry.new.map(item), review: entry.review.map(item), later: entry.later.map(item) };
    expect(map.new).toEqual([]);
    const other = card("id", map, "map");
    expect(other).toContain(id.Guided.map_none);
    expect(groups(other).find((g) => g.group === "review")!.items.find((i) => i.id === "naat")!.where).toBe("dari QS 1:1");
    expect(card("id", map, "learned")).toContain(id.Guided.map_none);
    // Both message files carry every label the card uses.
    for (const k of Object.keys(id.Guided).filter((x) => x.startsWith("map_"))) expect(en.Guided, k).toHaveProperty(k);
  });
});

describe("the word card marks a concept an earlier ayah taught (text only)", () => {
  const wordCard = (taught: string | null) => {
    const w = FATIHAH.ayat[1].words[2]; // 1:2:3, a na't: taught in ayah 1
    const labels = { ...id.Word, sharaf: { heading: id.Word.sharaf_heading, forms_note: id.Word.sharaf_forms_note, ilal: id.Word.ilal, ilal_from: id.Word.ilal_from, ilal_to: id.Word.ilal_to } };
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale: "id",
      messages: id,
      timeZone: "Asia/Jakarta",
      children: createElement(WordCard, { word: w, labels, concepts: [{ id: "naat", title: "Na't (sifat yang mengikuti)", head: null, taught }] }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };

  it("under its chip: “sudah dipelajari di ayat 1”; nothing for a concept that is new or taught later", () => {
    const marked = wordCard(id.Word.concept_taught.replace("{n}", "1"));
    expect(marked).toMatch(/<\/a><p data-concept-taught="naat"[^>]*>sudah dipelajari di ayat 1<\/p>/);
    expect(wordCard(null)).not.toContain("data-concept-taught");
    // What the page marks: exactly the ayah's repeated concepts, each with the ayah that taught it.
    for (const a of FATIHAH.ayat) {
      const review = lessonMapInput("al-fatihah", a.ayah)!.review;
      expect(review.map((it) => it.id)).toEqual(TABLE[a.ayah][1]);
      for (const it of review) expect(it.ayah).toBeLessThan(a.ayah);
      // … and every one of them is on a word of the ayah (so its mark has a chip to sit under).
      const tagged = new Set(a.words.flatMap((w) => w.concepts));
      for (const it of review) expect(tagged.has(it.id), `${a.loc} ${it.id}`).toBe(true);
    }
    expect(en.Word.concept_taught).toContain("{n}");
  });
});
