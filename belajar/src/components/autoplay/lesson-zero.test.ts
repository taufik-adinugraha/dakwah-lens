import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { IntroCard } from "@/components/lesson/IntroCard";
import {
  createAutoplayState,
  hostsZero,
  ID_TEXTS,
  LESSON_ZERO,
  LINE_ID_RE,
  MAX_EXAMPLES_ZERO,
  primerAyah,
  reduceAutoplay,
  sequenceLineIds,
  ZERO_AYAH,
  zeroAyah,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
} from "@/lib/autoplay";
import { exampleProblems, sequenceProblems } from "@/lib/autoplay/checks";
import { composeFor, composeInput } from "@/lib/compose-content";
import { SURAHS, WORD_AR } from "@/lib/content";
import { CURRICULUM, taughtAt, taughtInZero, ZERO_HOST } from "@/lib/curriculum";
import { LIBRARY } from "@/lib/library";
import { lessonMapInput } from "@/lib/map-content";
import { ayahHref, INTRO_SEGMENT, introHref, SURAH_SLUGS } from "@/lib/routes";
import { wordVoice } from "@/lib/wordvoice";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence, zeroExamplesFor, zeroSequence } from "./build";
import { captionCue, stageExample, stageFrame, stageMarks } from "./caption";
import { narrationFor } from "./manifests";
import { autoplayTexts } from "./texts";

// LESSON ZERO — "Pengantar: harakat dan tiga jenis kata" (the basic curriculum,
// docs/belajar-research/kurikulum-dasar.md decision 1, operator-approved 2026-10-13: "A 'lesson
// zero' with no ayah opens the course. It teaches harakat and the three kinds of word (kalimah:
// isim, fi'il, huruf), so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into
// lesson zero."). Until then Al-Fatihah 1 opened with the nine lines of the primer, its lesson
// map said "two things already learnt" of things no lesson had taught, and the kalimah record's
// "Konsep baru" line was said nowhere.
//
// Here: who hosts it, its sequence as its page builds it (no ayah: no recitation, no recap, no
// exercise), its lines in the manifest, its examples (the narrator's recordings), the run to its end and
// the hand-over to ayah 1, what left Al-Fatihah 1, where it is linked, and the CI scripts' paths.
// The pipeline's half (the lines, the curriculum's lists) is pipeline/test_validate_narration.py
// and test_validate_curriculum.py; that a browser plays it is scripts/ci/screenshots.mjs introChecks.

// The card links through the app's Link; no router is mounted in a unit test.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: (p: Record<string, unknown> & { href: unknown; children?: ReactNode }) => createElement("a", { ...p, href: String(p.href) }, p.children),
}));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;
const LINES = narrationFor("al-fatihah")?.lines ?? {};
const KALIMAH = "kalimah-isim-fiil-huruf";
const seq = zeroSequence(FATIHAH, "id");
const zero = zeroAyah(FATIHAH.surah);

const end = (s: AutoplayState): AutoplayEvent | null => {
  const a = s.activity;
  if (!a) return s.phase === "ready" ? { type: "next" } : null;
  return a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };
};
/** Every state of the lesson left to run from its start. */
function run(sq: AutoplaySequence, pace: "biasa" | "pelan" = "biasa"): AutoplayState[] {
  let s = reduceAutoplay(sq, createAutoplayState(sq, { pace }), { type: "start", pace, reason: "fresh" });
  const out = [s];
  for (let i = 0; i < 2000 && s.phase !== "finished"; i++) {
    const e = end(s);
    if (!e) break;
    s = reduceAutoplay(sq, s, e);
    out.push(s);
  }
  return out;
}

describe("who hosts lesson zero", () => {
  it("the surah whose harakat primer is played there: Al-Fatihah, and no other", () => {
    expect(ZERO_HOST?.slug).toBe("al-fatihah");
    const primer = composeFor("al-fatihah")!.primer!;
    expect([primer.ayah, primer.lesson, primerAyah(primer), hostsZero(composeFor("al-fatihah"))]).toEqual([1, LESSON_ZERO, ZERO_AYAH, true]);
    for (const s of SURAHS.filter((x) => x.slug !== "al-fatihah")) expect(hostsZero(composeFor(s.slug)), s.slug).toBe(false);
    // Its place: "ayah 0" of that surah, an ayah with no word.
    expect(zero).toEqual({ surah: 1, ayah: 0, loc: "1:0", words: [] });
    // The curriculum's lesson "0" is written, with its two steps.
    const lesson = CURRICULUM.lessons.find((l) => l.id === LESSON_ZERO)!;
    expect([lesson.steps, lesson.map?.new, lesson.lines?.map((l) => l.line)]).toEqual([["harakat", "kalimah"], ["harakat", "kalimah"], [`concept:${KALIMAH}`]]);
  });
});

describe("its sequence, as its page builds it", () => {
  it("intro → the harakat primer → the three kinds of word and their examples → next: no ayah, so no recitation, recap or exercise", () => {
    expect(seq.steps.map((s) => [s.id, s.kind])).toEqual([
      ["intro", "intro"],
      ["primer", "primer"],
      // the slide before the line (operator 2026-10-15: kalimah is one word, the Indonesian kalimat is kalam)
      [`concept:${KALIMAH}:lead`, "concept"],
      [`concept:${KALIMAH}`, "concept"],
      [`concept:${KALIMAH}:ex`, "example"],
      ["next", "next"],
    ]);
    expect([seq.slug, seq.ayah, seq.lessonKey, seq.nav]).toEqual(["al-fatihah", 0, "al-fatihah/0", { kind: "ayah", slug: "al-fatihah", ayah: 1 }]);
    expect(seq.steps.some((s) => s.recite || s.exercise || s.word !== undefined)).toBe(false);
    // The primer: its fourteen lines over its thirteen frames, as the content plans them.
    const primer = composeFor("al-fatihah")!.primer!;
    const p = seq.steps[1];
    expect([p.frames, p.cues.map((c) => c.frame), p.lines]).toEqual([primer.frames.length, primer.lines.map((l) => l.frame), primer.lines.map((_, k) => `al-fatihah:0:primer:${k + 1}`)]);
    // Nothing is lit and no word card shows: there is no mushaf line on this stage.
    for (const s of seq.steps) for (const c of s.cues) expect([s.id, c.highlight, c.focus]).toEqual([s.id, [], null]);
    for (const s of seq.steps) expect(s.guides, s.id).toEqual([]);
    // The engine's own check agrees — and says so when the lesson is taken for an ayah's.
    const ctx = { ayah: zero, last: false, exercises: [], introduced: taughtInZero(), compose: composeInput("al-fatihah", zero), map: null };
    expect(sequenceProblems(seq, { ...ctx, zero: true })).toEqual([]);
    expect(sequenceProblems(seq, ctx).join("\n")).toContain("the imam does not recite the ayah second");
    expect(seq.hasAudio).toBe(true);
  });

  it("planted faults: an ayah recited in it, the primer left out, lines of another “ayah”", () => {
    const ctx = { ayah: zero, last: false, exercises: [], introduced: taughtInZero(), compose: composeInput("al-fatihah", zero), map: null, zero: true };
    const ayah1 = stageSequence(FATIHAH, FATIHAH.ayat[0], "id");
    const recited = { ...seq, steps: [seq.steps[0], ayah1.steps[1], ...seq.steps.slice(1)] };
    expect(sequenceProblems(recited, ctx).join("\n")).toContain("lesson zero has no ayah: it cannot have the step(s) recite");
    const bare = { ...seq, steps: seq.steps.filter((s) => s.kind !== "primer") };
    expect(sequenceProblems(bare, { ...ctx, compose: null }).join("\n")).toContain("lesson zero does not play the harakat primer");
    expect(sequenceProblems({ ...seq, ayah: 1 }, ctx).join("\n")).toContain("lesson zero's lines are the lines of “ayah 0”");
    const late = { ...seq, steps: [seq.steps[0], seq.steps[2], seq.steps[1], ...seq.steps.slice(3)] };
    expect(sequenceProblems(late, ctx).join("\n")).toContain("the harakat primer is not the step right after lesson zero's opening line");
    // the slide: left out, or after its line
    const noLead = { ...seq, steps: seq.steps.filter((s) => !s.id.endsWith(":lead")) };
    expect(sequenceProblems(noLead, ctx).join("\n")).toContain("are not lesson zero's slides of its steps");
    const leadAfter = { ...seq, steps: [seq.steps[0], seq.steps[1], seq.steps[3], seq.steps[2], ...seq.steps.slice(4)] };
    expect(sequenceProblems(leadAfter, ctx).join("\n")).toContain("a slide is the step right before its concept's line");
    // the example step: a line that is not its beat's, or a beat played before its line
    const ex = seq.steps.findIndex((s) => s.kind === "example");
    const swap = (fn: (s: (typeof seq.steps)[number]) => (typeof seq.steps)[number]) => ({ ...seq, steps: seq.steps.map((s, i) => (i === ex ? fn(s) : s)) });
    const wrongLine = swap((s) => ({ ...s, cues: [s.cues[1], s.cues[0], ...s.cues.slice(2)], lines: [s.lines[1], s.lines[0], ...s.lines.slice(2)] }));
    expect(sequenceProblems(wrongLine, ctx).join("\n")).toContain("an example step is its example beats (in lesson zero, each after its own line)");
    const early = swap((s) => ({ ...s, examples: s.examples!.map((b) => ({ ...b, after: -1 })) }));
    expect(sequenceProblems(early, ctx).join("\n")).toContain("an example step is its example beats (in lesson zero, each after its own line)");
  });

  it("its lines are the manifest's “ayah 0” lines, each once, and its two own sentences are the narration's", () => {
    const mine = Object.keys(LINES).filter((k) => k.startsWith("al-fatihah:0:"));
    expect(mine).toEqual([
      "al-fatihah:0:intro",
      ...Array.from({ length: 14 }, (_, k) => `al-fatihah:0:primer:${k + 1}`),
      `al-fatihah:0:concept:${KALIMAH}:lead`,
      `al-fatihah:0:concept:${KALIMAH}`,
      ...Array.from({ length: 5 }, (_, k) => `al-fatihah:0:concept:${KALIMAH}:ex:${k + 1}`),
      "al-fatihah:0:next",
    ]);
    // The slide's line and each example's: the curriculum's text, as the narration says it (the
    // terms with their Arabic on screen), each one file (≤ 400 characters, never split).
    const kalimah = CURRICULUM.steps.find((s) => s.id === "kalimah")!;
    expect(LINES[`al-fatihah:0:concept:${KALIMAH}:lead`].display).toBe(
      "Sebelum mengenal tiga jenis kata, perhatikan satu istilah. Kalimah (كَلِمَة) dalam bahasa Arab tidak sama dengan kalimat dalam bahasa Indonesia. Dalam tata bahasa Arab, kalimah (كَلِمَة) berarti satu kata. Rangkaian kata yang bermakna utuh, yang dalam bahasa Indonesia disebut kalimat, dalam bahasa Arab disebut kalam (كَلَام).",
    );
    kalimah.examples!.forEach((e, k) => {
      const line = LINES[`al-fatihah:0:concept:${KALIMAH}:ex:${k + 1}`];
      expect((line.display ?? "").replace(/ \([^)]*[؀-ۿ][^)]*\)/gu, "")).toBe(e.say.replace(/fi'il/g, "fi’il"));
      expect(line.text.length, e.loc).toBeLessThanOrEqual(400);
    });
    for (const k of mine) expect(LINE_ID_RE.test(k), k).toBe(true);
    expect(sequenceLineIds(seq).filter((k) => !k.startsWith("shared:")).sort()).toEqual([...mine].sort());
    // They stand first in the manifest, before ayah 1's.
    expect(Object.keys(LINES).slice(0, mine.length)).toEqual(mine);
    // The opening line and the hand-over: the engine's captions say what the narrator says.
    expect(LINES["al-fatihah:0:intro"].text).toBe(ID_TEXTS.zeroIntro({ surah: "Al-Fatihah" }));
    expect(LINES["al-fatihah:0:next"].text).toBe(ID_TEXTS.zeroNext({ surah: "Al-Fatihah" }));
    // … worded like an ayah's hand-over.
    expect(LINES["al-fatihah:1:next"].text).toMatch(/pelajaran berlanjut sendiri\.$/);
    expect(LINES["al-fatihah:0:next"].text).toMatch(/Berikutnya ayat pertama Surah Al-Fatihah; pelajaran berlanjut sendiri\.$/);
    // No other surah's manifest has such lines.
    for (const s of SURAHS.filter((x) => x.slug !== "al-fatihah")) {
      expect(Object.keys(narrationFor(s.slug)?.lines ?? {}).filter((k) => k.includes(":0:")), s.slug).toEqual([]);
    }
    // An English page (no narration yet) is caption-only, in its own words.
    const enSeq = zeroSequence(FATIHAH, "en");
    expect(enSeq.steps.map((s) => s.id)).toEqual(seq.steps.map((s) => s.id));
    expect(enSeq.steps[0].cues[0].caption).toBe(autoplayTexts("en").zeroIntro({ surah: "Al-Fatihah" }));
    expect(enSeq.hasAudio).toBe(false);
  });
});

describe("its examples: the word recordings of the examples the curriculum lists, each explained by the narrator", () => {
  it("three kinds of isim, a fi'il and a huruf, one recording each, each saying which it is and explained by the narrator: no word of an ayah here to recite", () => {
    const kalimah = CURRICULUM.steps.find((s) => s.id === "kalimah")!;
    const derived = zeroExamplesFor(FATIHAH);
    expect(derived.gaps).toEqual([]);
    expect(derived.examples.map((e) => [e.id, e.step, e.key, e.word, e.clip])).toEqual(
      kalimah.examples!.map((e, k) => [`concept:${KALIMAH}:${k + 1}`, `concept:${KALIMAH}:ex`, e.loc, null, LIBRARY.clips[e.loc]]),
    );
    expect(derived.examples.length).toBeLessThanOrEqual(MAX_EXAMPLES_ZERO);
    // Operator 2026-10-15: "better to provide OTHER examples of isim as nama sifat etc." — an isim
    // that names a thing, one that names a quality, a pronoun; then a fi'il and a huruf (wa lā: two
    // huruf in one written word). Until then the record's first three (ṣirāṭa, na‘budu, bismi).
    expect(derived.examples.map((e) => e.key)).toEqual(["1:7:1", "1:6:3", "1:5:1", "1:5:2", "1:7:8"]);
    // Each says what it is an example of (the stage has no ayah to show it): the card's label.
    expect(derived.examples.map((e) => e.about)).toEqual([
      "isim, nama benda.",
      "isim, nama sifat.",
      "isim, kata ganti.",
      "fi'il, kata kerja.",
      "dua huruf, wa yang artinya “dan”, dan lā yang artinya “bukan”.",
    ]);
    // Each is Quran.com's recording of the word's own bytes at its place (operator 2026-10-15): the
    // word inside our unaltered copy of the file; no `last`, no stop, no run. Wa lā (1:7:8) is ONE
    // written word, one word file, not a run of two (its two huruf are written as one word).
    for (const e of derived.examples) {
      expect(e.clip, e.id).toEqual(wordVoice(WORD_AR[e.key]));
      expect(e.clip, e.id).not.toBeNull();
      expect([e.clip?.source, e.clip?.last, e.waqf, e.washal], e.id).toEqual(["quran.com", undefined, false, null]);
      expect(e.clip?.url, e.id).toMatch(/^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/);
    }
    const step = seq.steps.find((s) => s.kind === "example")!;
    const beats = step.examples!;
    expect(beats.map((b) => [b.id, b.key, b.word])).toEqual(derived.examples.map((e) => [e.id, e.key, null]));
    for (const b of beats) expect(b.caption).not.toMatch(/[؀-ۿ]/);
    // The narrator explains each (operator 2026-10-15: "ṣirāṭ, yang artinya jalan, adalah sebuah isim,
    // yaitu nama benda"): line k, then example k's recording — the card is on screen from its line on.
    expect(step.cues.map((c) => c.line)).toEqual(beats.map((_, k) => `al-fatihah:0:concept:${KALIMAH}:ex:${k + 1}`));
    expect(beats.map((b) => b.after)).toEqual(beats.map((_, k) => k));
    // Not "Contoh lain" (there is no first one here), and no place said in the caption: the card
    // cites it beside the word.
    expect(beats.map((b) => b.caption)).toEqual([
      "Contoh — ṣirāṭa: isim, nama benda.",
      "Contoh — al-mustaqīma: isim, nama sifat.",
      "Contoh — iyyāka: isim, kata ganti.",
      "Contoh — na‘budu: fi'il, kata kerja.",
      "Contoh — wa lā: dua huruf, wa yang artinya “dan”, dan lā yang artinya “bukan”.",
    ]);
    expect(
      exampleProblems(seq, { ayah: { words: [], recitation: [] }, introduced: taughtInZero(), compose: composeFor("al-fatihah"), derived, voice: wordVoice, wordAt: () => undefined, texts: ID_TEXTS, zero: true })
        .filter((p) => !/bytes/.test(p)),
    ).toEqual([]);
  });
});

describe("the lesson left to run", () => {
  it("plays every line once, shows the primer's frames in order, plays the five recordings each after its line, and ends with the way to ayah 1", () => {
    for (const pace of ["biasa", "pelan"] as const) {
      const states = run(seq, pace);
      const last = states[states.length - 1];
      expect([last.phase, last.intent], pace).toEqual(["finished", { kind: "ayah", slug: "al-fatihah", ayah: 1 }]);
      // Steps in order, none skipped.
      const visited = states.map((s) => s.idx).filter((x, i, all) => i === 0 || all[i - 1] !== x);
      expect(visited, pace).toEqual(seq.steps.map((_, i) => i));
      // Nothing is marked on a mushaf line at any moment.
      for (const s of states) expect(stageMarks(seq, s), pace).toEqual({ marked: [], focus: null });
      // The primer's frames, 1 … 13 (each mark first on its letter without it, then with it).
      const frames = states.filter((s) => s.idx === 1).map((s) => stageFrame(seq, s)?.frame).filter((f, i, all) => f !== undefined && all[i - 1] !== f);
      expect(frames, pace).toEqual(Array.from({ length: 13 }, (_, k) => k + 1));
      // The five examples, each a recording, in order.
      const clips = states.flatMap((s) => (s.activity?.kind === "recite" && s.activity.target === "clip" ? [stageExample(seq, s)?.beat.key] : []));
      expect([...new Set(clips)], pace).toEqual(["1:7:1", "1:6:3", "1:5:1", "1:5:2", "1:7:8"]);
      // While the narrator explains example k, its card is the one on screen (rule 21: "kata ini" is
      // the word shown), and its recording follows the line.
      const said = states.flatMap((s) => {
        const line = captionCue(seq, s)?.line;
        return line && /:ex:\d+$/.test(line) && s.activity?.kind !== "recite" ? [[line.split(":").pop(), stageExample(seq, s)?.beat.key]] : [];
      });
      expect([...new Map(said.map(([k, key]) => [k, key])).entries()], pace).toEqual([
        ["1", "1:7:1"],
        ["2", "1:6:3"],
        ["3", "1:5:1"],
        ["4", "1:5:2"],
        ["5", "1:7:8"],
      ]);
      // No recitation of an ayah or of a lesson word.
      expect(states.some((s) => s.activity?.kind === "recite" && s.activity.target !== "clip"), pace).toBe(false);
    }
  });
});

describe("what left Al-Fatihah 1", () => {
  it("no primer step and no primer line; the lesson map's “two things learnt” are lesson zero's two steps", () => {
    const one = stageSequence(FATIHAH, FATIHAH.ayat[0], "id");
    expect(one.steps.some((s) => s.kind === "primer")).toBe(false);
    expect(composeInput("al-fatihah", FATIHAH.ayat[0])?.primer ?? null).toBeNull();
    expect(Object.keys(LINES).some((k) => k.startsWith("al-fatihah:1:primer:"))).toBe(false);
    expect(Object.keys(LINES)).not.toContain(`al-fatihah:1:concept:${KALIMAH}`);
    expect(taughtAt(FATIHAH.ayat[0]).map((x) => x.id)).toEqual(["majrur", "huruf-jar"]);
    const map = lessonMapInput("al-fatihah", 1)!;
    expect(map.learnt.map((x) => x.id)).toEqual(CURRICULUM.lessons.find((l) => l.id === LESSON_ZERO)!.steps);
    expect(LINES["al-fatihah:1:map:learnt"].text).toMatch(/^Sebelum ayat ini, kita sudah mempelajari dua hal\./);
  });
});

describe("where it is linked", () => {
  const MSG = { id, en } as const;
  const card = (locale: keyof typeof MSG) => {
    const t = MSG[locale].Intro;
    const intl: ComponentProps<typeof NextIntlClientProvider> = {
      locale,
      messages: MSG[locale],
      timeZone: "Asia/Jakarta",
      children: createElement(IntroCard, { eyebrow: t.eyebrow, title: t.title, hint: t.card_hint, cta: t.card_cta }),
    };
    return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
  };

  it("its own path under the track, which is no surah's", () => {
    expect(introHref()).toBe(`/quran/${INTRO_SEGMENT}`);
    expect(introHref()).toBe("/quran/pengantar");
    expect(SURAH_SLUGS as readonly string[]).not.toContain(INTRO_SEGMENT);
    expect(read("src/app/[locale]/quran/pengantar/page.tsx")).toContain("zeroSequence(host, locale)");
    // The proxy's surah gate lets it through: it gates the surah slugs only.
    expect(read("src/proxy.ts")).toContain("new Set(SURAH_SLUGS)");
  });

  it("the card: one link to it, its title, no Arabic, nothing else to click", () => {
    const html = card("id");
    expect(html).toMatch(/^<a [^>]*href="\/quran\/pengantar"[^>]*data-intro-card="true"|^<a [^>]*data-intro-card="true"[^>]*href="\/quran\/pengantar"/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toMatch(/<button|[؀-ۿ]|sr-only/);
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Pengantar: harakat dan tiga jenis kata");
    expect(card("en").replace(/<[^>]+>/g, " ")).toContain("Introduction: vowel marks and the three kinds of word");
    expect(Object.keys(id.Intro)).toEqual(Object.keys(en.Intro));
  });

  it("listed FIRST on the track page and on the Al-Fatihah page; one quiet line on the first ayah", () => {
    const track = read("src/app/[locale]/quran/page.tsx");
    expect(track.indexOf("<IntroCard")).toBeGreaterThan(-1);
    expect(track.indexOf("<IntroCard")).toBeLessThan(track.indexOf("{SURAHS.map((s) => {"));
    // … only while the surah that hosts it is published: the ONE rule (lib/curriculum.ts
    // introOpen), which the curriculum page asks for its row too (curriculumOutline.test.ts).
    expect(track).toContain("{introOpen(published) && (");
    expect(read("src/lib/curriculum.ts")).toContain("return ZERO_HOST !== null && published.has(ZERO_HOST.slug);");
    expect(read("src/app/[locale]/quran/kurikulum/page.tsx")).toContain("intro: introOpen(published)");
    const surah = read("src/app/[locale]/quran/[surah]/page.tsx");
    expect(surah.indexOf("<IntroCard")).toBeGreaterThan(-1);
    expect(surah.indexOf("<IntroCard")).toBeLessThan(surah.indexOf("{s.ayat.map((a) => ("));
    expect(surah).toContain("ZERO_HOST?.slug === s.slug");
    const ayah = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    expect(ayah).toContain("data-intro-hint");
    expect(ayah).toContain("ZERO_HOST?.slug === s.slug && a.ayah === s.ayat[0].ayah");
    expect([id.Intro.ayah1_question, id.Intro.ayah1_link]).toEqual(["Belum mengenal harakat?", "Mulai dari Pengantar."]);
    // The ayah page no longer hands the primer to its stage by the primer's own ayah.
    expect(ayah).toContain("primerAyah(composeFile.primer) === a.ayah");
    expect(ayahHref("al-fatihah", 1)).toBe("/quran/al-fatihah/1");
  });

  it("the stage draws no mushaf line for a lesson without words", () => {
    expect(read("src/components/lesson/LessonStage.tsx")).toContain("{showMushaf && words.length > 0 && (");
  });
});

describe("the CI scripts know its page", () => {
  it("screenshots.mjs: its path, its “ayah 0”, the primer's check on its page, and its own check", () => {
    const ci = read("scripts/ci/screenshots.mjs");
    expect(ci).toContain(`const INTRO = "/belajar/id${introHref()}";`);
    expect(ci).toContain(`const ZERO_AYAH = ${ZERO_AYAH};`);
    expect(ci).toContain('["pengantar", INTRO],');
    expect(ci).toContain("async function introChecks(");
    expect(ci).toContain("await introChecks(page, vp, narration)");
    // The primer is reached on lesson zero's page, and swept there at every text size.
    expect(ci).toMatch(/page\.goto\(BASE \+ INTRO[^\n]*\n(?:[^\n]*\n){3,6}[^\n]*toStep\(page, vp, "primer"\)/);
    expect(ci).toContain('composeFitSweep(page, vp, "sangat-besar", [ZERO_AYAH, 1, 2, 3, 4, 5, 6, 7], units)');
    expect(ci).toContain('c.primer?.lesson === "0" ? ZERO_AYAH : c.primer?.ayah');
    expect(ci).not.toMatch(/\.waitForFunction\(/);
  });

  it("linebreaks.mjs: measured as a page and as a lesson, and no “surah”", () => {
    const ci = read("scripts/ci/linebreaks.mjs");
    expect(ci).toContain(`const INTRO_PATH = "/belajar/id${introHref()}";`);
    expect(ci).toContain("[INTRO_PATH, false],");
    expect(ci).toContain('pages.push(["pengantar", INTRO_PATH]);');
    // The harvest of the track's links: lesson zero's address has a surah's shape, so it is taken
    // out BEFORE the surah test, in the same if-chain (other pages of the track that are no surah
    // — the curriculum page — may stand between the two; nothing else may), and never joins the
    // surahs.
    const chain = /if \(p === INTRO_PATH\) intro = true;\n((?:\s*else if \([^\n]*\) [^\n]*;\n)*?)\s*else if \(SURAH_PATH\.test\(p\)\) surahs\.push\(p\);/.exec(ci);
    expect(chain, "the lesson-zero branch does not stand before the surah branch of one if-chain").not.toBeNull();
    expect(chain![1]).not.toMatch(/surahs\.push|INTRO_PATH/);
    expect(ci.match(/surahs\.push\(/g)).toHaveLength(1);
    expect(ci).toContain("the track does not link lesson zero");
  });
});
