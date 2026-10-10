import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { stageSequence } from "@/components/autoplay/build";
import { MixedText } from "@/components/library/MixedText";

import { measure } from "../../scripts/ci/linebreaks-measure.mjs";

import { SURAHS } from "./content";
import { ARABIC_RUN, arabicRuns, hasArabic, joinUnits, rtlRuns, textUnits, type Seg } from "./textUnits";

// Line breaks (operator, 2026-10-10: "make sure the line break is clean and easy to read,
// sometime i see wrong line break especially for arabic words"). The browser side is measured
// by scripts/ci/linebreaks.mjs; this is the pure side, over every string the module can show.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(BELAJAR, rel), "utf8"));

/** Every string in a JSON value, with where it came from. */
function strings(value: unknown, where: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([where, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) strings(v, `${where}.${k}`, out);
  return out;
}

type Manifest = { lines: Record<string, { text?: string; display?: string; tokens?: { t: string }[] }> };
const MANIFESTS = readdirSync(join(BELAJAR, "content/narration"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f, readJson(`content/narration/${f}`) as Manifest] as const);
const TOKENS = MANIFESTS.flatMap(([f, m]) =>
  Object.entries(m.lines).flatMap(([id, l]) => (l.tokens ?? []).map((k) => [`${f} ${id}`, k.t.trim()] as const)),
);
const GLOSSARY = (readJson("pipeline/authored/pronunciation.json") as { terms: { display: string }[] }).terms
  .map((t) => t.display)
  .filter(hasArabic);

/** Every string a page can render: lesson + library content, manifests, both message files. */
const CORPUS: [string, string][] = [
  ...["al-fatihah", "al-ikhlas", "al-falaq", "an-nas", "library"].flatMap((f) =>
    strings(readJson(`content/${f}.json`), f),
  ),
  ...MANIFESTS.flatMap(([f, m]) => strings(m, `narration/${f}`)),
  ...["id", "en"].flatMap((l) => strings(readJson(`messages/${l}.json`), `messages/${l}`)),
];

/** A separator or a hyphen-split word that a text piece (free to wrap) must never hold. */
const LOOSE_SEPARATOR = /(?:^|\s)(?:[·•—–-]+|…|\.{3}|\[\d+\])[)\]}”’»,.;:!?]*(?=\s|$)/u;
const SPLITTABLE_WORD = /[\p{L}\p{N}][-–—/][\p{L}\p{N}]/u;

/** Everything wrong with one string's pieces (empty: fine). */
function problems(s: string): string[] {
  const segs = textUnits(s);
  const out: string[] = [];
  if (joinUnits(segs) !== s) out.push("the pieces do not join back to the text");
  // The Arabic runs (each one bdi) are exactly those of the whole string.
  const runs = segs.flatMap((g) =>
    g.kind === "unit" ? g.parts.flatMap((p) => (p.arabic ? arabicRuns(p.text).filter((r) => r.arabic) : [])) : [],
  );
  const want = [...s.matchAll(ARABIC_RUN)].map((m) => m[0]);
  if (JSON.stringify(runs.map((r) => r.text)) !== JSON.stringify(want)) out.push("Arabic runs differ from ARABIC_RUN");
  segs.forEach((g, i) => {
    if (g.kind === "text") {
      if (hasArabic(g.text)) out.push(`Arabic outside a unit: "${g.text.slice(0, 40)}"`);
      // (a string that is one separator alone, a case sign "—", has no word to keep it with)
      if (LOOSE_SEPARATOR.test(g.text) && /\s/.test(s.trim()))
        out.push(`a separator free to start a line: "${g.text.slice(0, 40)}"`);
      const word = g.text.split(/\s+/).find((w) => SPLITTABLE_WORD.test(w));
      if (word) out.push(`a word free to break at its hyphen: "${word}"`);
      return;
    }
    // A unit or glued word starts and ends at whitespace (or the string's ends): a break is
    // allowed right next to an inline box, so punctuation must be inside it.
    const prev = segs[i - 1];
    const next = segs[i + 1];
    if (prev && !(prev.kind === "text" && /\s$/.test(prev.text))) out.push(`a box not after whitespace (#${i})`);
    if (next && !(next.kind === "text" && /^\s/.test(next.text))) out.push(`a box not before whitespace (#${i})`);
    if (g.kind === "unit" && !g.parts.some((p) => p.arabic)) out.push("a unit without Arabic");
    // Its seam holds its Arabic; the words outside the seam (the rest of a term or a gloss) are
    // Latin, drawn as running text.
    if (g.kind === "unit") {
      const [a, b] = g.seam;
      if (!(a <= b && g.parts.slice(a, b + 1).some((p) => p.arabic))) out.push("a seam without the Arabic");
      if (g.parts.some((p, k) => (k < a || k > b) && hasArabic(p.text))) out.push("Arabic outside a seam");
    }
    if (g.kind === "glue" && hasArabic(g.text)) out.push("Arabic in a glued word");
  });
  return out;
}

/** Before these a browser never breaks, space or not (UAX #14 LB13 and LB19: closing
 *  punctuation, infix separators, "!" "?", quotation marks): " :" in a hadith is no open break. */
const NO_BREAK_BEFORE = /^[,.;:!?)\]}»”’؟،؛/]/u;

/** Every line break MixedText leaves open in s, as the browser check sees a seam: [line before,
 *  line after, at a space, the Arabic run before]. Open: the whitespace of its text pieces, and of
 *  a unit outside its seam (where a unit wider than its line breaks in the flow first). Each side
 *  is the string up to 200 characters back and 300 on (more than the rules read: a line's end, an
 *  Arabic run of four words, a bracket up to its ")"). */
function openBreaks(s: string): [string, string, boolean, string][] {
  const out: [string, string, boolean, string][] = [];
  const open = (at: number, text: string) => {
    for (const m of text.matchAll(/\s+/g)) {
      const cut = at + (m.index ?? 0);
      const prev = s.slice(Math.max(0, cut - 200), cut).trimEnd();
      const next = s.slice(cut + m[0].length, cut + m[0].length + 300).trimStart();
      if (prev && next && !NO_BREAK_BEFORE.test(next)) out.push([prev, next, true, [...prev.matchAll(ARABIC_RUN)].pop()?.[0] ?? ""]);
    }
  };
  let at = 0;
  for (const g of textUnits(s)) {
    const piece = joinUnits([g]);
    if (g.kind === "text") open(at, piece);
    if (g.kind === "unit") {
      let k = at;
      g.parts.forEach((p, i) => {
        if (i > 0) {
          if (i <= g.seam[0] || i > g.seam[1]) open(k, g.gaps[i - 1]);
          k += g.gaps[i - 1].length;
        }
        if (i < g.seam[0] || i > g.seam[1]) open(k, p.text);
        k += p.text.length;
      });
    }
    at += piece.length;
  }
  return out;
}

/** [start, end) of each unit / glued word in the string it came from. */
function boxes(segs: readonly Seg[]): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const g of segs) {
    const len = joinUnits([g]).length;
    if (g.kind !== "text") out.push([at, at + len]);
    at += len;
  }
  return out;
}

/** [start, end) of each unit's seam in the string it came from. */
function seams(segs: readonly Seg[]): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const g of segs) {
    if (g.kind === "unit") {
      let k = at;
      let from = at;
      g.parts.forEach((p, i) => {
        if (i > 0) k += g.gaps[i - 1].length;
        if (i === g.seam[0]) from = k;
        k += p.text.length;
        if (i === g.seam[1]) out.push([from, k]);
      });
    }
    at += joinUnits([g]).length;
  }
  return out;
}

describe("textUnits: a term stays with its Arabic", () => {
  const units = (s: string) => textUnits(s).filter((g) => g.kind !== "text");

  it("keeps a term before a bracket of Arabic with it, its last word in the seam", () => {
    const s = "Akhirnya dibaca kasrah (كَسْرَة), karena didahului huruf jar (حَرْف جَرّ), yaitu huruf ba’ (بِ), dengan.";
    expect(units(s)).toEqual([
      { kind: "unit", parts: [{ text: "kasrah", arabic: false }, { text: "(كَسْرَة),", arabic: true }], gaps: [" "], seam: [0, 1] },
      // As many Latin words as the bracket has Arabic words: the whole term while it fits a line;
      // wider, it breaks first before "jar" (review, 2026-10-10: a box wider than its line).
      {
        kind: "unit",
        parts: [{ text: "huruf", arabic: false }, { text: "jar", arabic: false }, { text: "(حَرْف جَرّ),", arabic: true }],
        gaps: [" ", " "],
        seam: [1, 2],
      },
      { kind: "unit", parts: [{ text: "ba’", arabic: false }, { text: "(بِ),", arabic: true }], gaps: [" "], seam: [0, 1] },
    ]);
    // Root letters count as one word.
    expect(units("lihat entri (و س و س): bab")[0]).toEqual({
      kind: "unit",
      parts: [{ text: "entri", arabic: false }, { text: "(و س و س):", arabic: true }],
      gaps: [" "],
      seam: [0, 1],
    });
    // A bracket that opens on Arabic and closes after Latin words is the same seam (review,
    // 2026-10-10: "bentuk alif ⏎ (ٱ أ إ آ …)" was the split the operator reported).
    expect(units("bentuk alif (ٱ أ إ آ dan alif kecil) disamakan")[0]).toEqual({
      kind: "unit",
      parts: [{ text: "alif", arabic: false }, { text: "(ٱ أ إ آ", arabic: true }],
      gaps: [" "],
      seam: [0, 1],
    });
  });

  it("keeps a Latin gloss after a word or phrase with it, its first word in the seam; a parenthetical that closes on it", () => {
    expect(units("Kata «مَلِكِ» (raja) di sini; «ٱهْدِنَا» (tunjukilah kami) hanya")).toEqual([
      { kind: "unit", parts: [{ text: "«مَلِكِ»", arabic: true }, { text: "(raja)", arabic: false }], gaps: [" "], seam: [0, 1] },
      {
        kind: "unit",
        parts: [{ text: "«ٱهْدِنَا»", arabic: true }, { text: "(tunjukilah", arabic: false }, { text: "kami)", arabic: false }],
        gaps: [" ", " "],
        seam: [0, 1],
      },
    ]);
    // A quoted gloss too.
    expect(units("kata خَفِيّ (“tersembunyi”). Lalu")[0]).toMatchObject({ parts: [{ text: "خَفِيّ" }, { text: "(“tersembunyi”)." }] });
    // After a phrase of up to three words; the gloss's first word when its ")" is further on.
    expect(units("«قُلْ أَعُوذُ بِرَبِّ» (katakanlah: aku berlindung kepada Tuhan)")).toEqual([
      { kind: "unit", parts: [{ text: "«قُلْ أَعُوذُ بِرَبِّ»", arabic: true }, { text: "(katakanlah:", arabic: false }], gaps: [" "], seam: [0, 1] },
    ]);
    // A parenthesis that holds Arabic belongs to that Arabic, not to the word before it.
    expect(units("bab 4: فَعِلَ–يَفْعَلُ (seperti عَلِمَ–يَعْلَمُ)")).toEqual([
      { kind: "unit", parts: [{ text: "فَعِلَ–يَفْعَلُ", arabic: true }], gaps: [], seam: [0, 0] },
      { kind: "unit", parts: [{ text: "(seperti", arabic: false }, { text: "عَلِمَ–يَعْلَمُ)", arabic: true }], gaps: [" "], seam: [0, 1] },
    ]);
  });

  it("joins nothing to a quotation of four words or more", () => {
    expect(units("Kalimat «ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ» (segala puji) itu")).toEqual([
      { kind: "unit", parts: [{ text: "«ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ»", arabic: true }], gaps: [], seam: [0, 0] },
    ]);
    expect(units("dua kata (ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ)")).toEqual([
      { kind: "unit", parts: [{ text: "(ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ)", arabic: true }], gaps: [], seam: [0, 0] },
    ]);
  });

  it("gives an Arabic run the mirrored marks around it, and leaves the punctuation after them", () => {
    const s = "«بِرَبِّ ٱلنَّاسِ», «مَلِكِ ٱلنَّاسِ»,";
    const q = rtlRuns(s);
    expect(q).toEqual([
      { text: "بِرَبِّ ٱلنَّاسِ", arabic: true, open: "«", close: "»" },
      { text: ", ", arabic: false },
      { text: "مَلِكِ ٱلنَّاسِ", arabic: true, open: "«", close: "»" },
      { text: ",", arabic: false },
    ]);
    const joined = (parts: ReturnType<typeof rtlRuns>) => parts.map((p) => (p.open ?? "") + p.text + (p.close ?? "")).join("");
    expect(joined(q)).toBe(s);
    expect(joined(rtlRuns("(ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ)."))).toBe("(ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ).");
    expect(rtlRuns("(حَرْف جَرّ),")).toEqual([
      { text: "حَرْف جَرّ", arabic: true, open: "(", close: ")" },
      { text: ",", arabic: false },
    ]);
    // “ ” are not mirrored characters: inside a right-to-left span they would turn around.
    expect(rtlRuns("“كَلِمَة”")).toEqual([
      { text: "“", arabic: false },
      { text: "كَلِمَة", arabic: true },
      { text: "”", arabic: false },
    ]);
    // Unmatched marks stay where they are.
    expect(rtlRuns("«ٱلْحَمْدُ لِلَّهِ")).toEqual([
      { text: "«", arabic: false },
      { text: "ٱلْحَمْدُ لِلَّهِ", arabic: true },
    ]);
  });

  it("glues hyphenated words, footnote marks and separators; leaves plain words free", () => {
    expect(units("surah Al-Fatihah, frasa jar-majrur, bagi-Nya, -nya, kata ke-1, pembalasan.[1]”")).toEqual(
      ["Al-Fatihah,", "jar-majrur,", "bagi-Nya,", "-nya,", "ke-1,", "pembalasan.[1]”"].map((text) => ({ kind: "glue", text })),
    );
    expect(units("nashab — Darwisy; (Kufah) · Khabar; Indonesia - Kementerian; hamidtuhu ... hamdan")).toEqual(
      ["nashab —", "(Kufah) ·", "Indonesia -", "hamidtuhu ..."].map((text) => ({ kind: "glue", text })),
    );
    // A separator first in the string goes with the word after it.
    expect(units("— label kelompok")).toEqual([{ kind: "glue", text: "— label" }]);
    expect(textUnits("Kata pertama artinya: dengan nama.")).toEqual([
      { kind: "text", text: "Kata pertama artinya: dengan nama." },
    ]);
    // A separator after Arabic stays on its unit.
    expect(units("huruf jar (حَرْف جَرّ) — yaitu")[0]).toMatchObject({ parts: [{ text: "huruf" }, { text: "jar" }, { text: "(حَرْف جَرّ) —" }] });
  });

  it("gives back the text unchanged, whitespace included", () => {
    for (const s of ["", " ", "  a  b  ", "\tkata\n(كَسْرَة) x", "— ·", "ر ح م"]) expect(joinUnits(textUnits(s))).toBe(s);
  });
});

describe("textUnits over every string the module shows", () => {
  it("joins back byte for byte, isolates the same Arabic runs, and leaves no loose separator, hyphen or Arabic", () => {
    expect(CORPUS.length).toBeGreaterThan(5000);
    const bad = CORPUS.flatMap(([where, s]) => problems(s).map((p) => `${where}: ${p}`));
    expect(bad).toEqual([]);
  });

  it("keeps every dictionary term whole with its Arabic in one unit, its last word in the seam", () => {
    expect(GLOSSARY.length).toBeGreaterThan(10);
    for (const d of GLOSSARY) {
      const m = /^(?:(.+) )?(\S+) (\(.+\))$/u.exec(d);
      expect(m, d).not.toBeNull();
      const parts = [...(m![1] ? [{ text: m![1], arabic: false }] : []), { text: m![2], arabic: false }, { text: m![3], arabic: true }];
      const seam: [number, number] = m![1] ? [1, 2] : [0, 1];
      expect(textUnits(d), d).toEqual([{ kind: "unit", parts, gaps: parts.slice(1).map(() => " "), seam }]);
      // In running text too, wherever a display string uses it.
      const last = `${m![2]} ${m![3]}`;
      for (const [where, s] of CORPUS.filter(([, s]) => s.includes(d))) {
        const at = s.indexOf(d);
        const segs = textUnits(s);
        expect(boxes(segs).some(([a, b]) => a === at && b >= at + d.length), `${where}: "${d}" is not one unit`).toBe(true);
        const from = at + d.length - last.length;
        expect(seams(segs).some(([a, b]) => a === from && b >= from + last.length), `${where}: "${last}" is not its seam`).toBe(true);
      }
    }
  });

  it("keeps the Arabic of every karaoke word in one unit, at the word's end", () => {
    const arabicTokens = TOKENS.filter(([, t]) => hasArabic(t));
    expect(arabicTokens.length).toBeGreaterThan(10);
    for (const [where, t] of arabicTokens) {
      const segs = textUnits(t);
      expect(segs.map((g) => g.kind).join(" "), `${where}: "${t}"`).toMatch(/^(text )?unit$/);
    }
    // A plain word is never a unit (it is a nowrap span there).
    for (const [where, t] of TOKENS.filter(([, t]) => !hasArabic(t)))
      expect(textUnits(t).some((g) => g.kind === "unit"), where).toBe(false);
  });

  it("leaves open only breaks the browser check accepts (one rule for both: seamKinds)", () => {
    const seen = new Set<string>();
    const all = CORPUS.filter(([, s]) => !seen.has(s) && !!seen.add(s)).flatMap(([where, s]) =>
      openBreaks(s).map((b) => [where, b] as const),
    );
    expect(all.length).toBeGreaterThan(50_000);
    // The rules read the end of the line before and the start of the line after (a bracket up to
    // its ")", a gloss's first words): one seam per distinct pair of those.
    const pairs = new Set<string>();
    const breaks = all.filter(([, [prev, next, sp, ar]]) => {
      const key = `${prev.slice(-60)}\u0000${next.slice(0, 200)}\u0000${sp}\u0000${ar}`;
      return !pairs.has(key) && !!pairs.add(key);
    });
    const kinds = measure({ scope: null, seams: breaks.map(([, b]) => b) }) as string[][];
    const bad = breaks
      .map(([where, [prev, next]], k) => [where, kinds[k], `…${prev.slice(-30)} ⏎ ${next.slice(0, 30)}`] as const)
      .filter(([, k]) => k.length > 0)
      .map(([where, k, seam]) => `${where}: ${k.join(", ")}: ${seam}`);
    expect(bad).toEqual([]);
  });

  it("never has a caption cut into parts inside a unit or a glued word", () => {
    let cues = 0;
    for (const s of SURAHS)
      for (const a of s.ayat)
        for (const locale of ["id", "en"]) {
          const seq = stageSequence(s, a, locale);
          const all = [...seq.steps.flatMap((st) => st.cues), ...Object.values(seq.shared)];
          for (const c of all) {
            if (c.parts.length < 2) continue;
            cues++;
            expect(c.parts.join(" "), c.line).toBe(c.caption);
            const cuts: number[] = [];
            let at = 0;
            for (const p of c.parts.slice(0, -1)) cuts.push((at += p.length + 1) - 1);
            const kept = boxes(textUnits(c.caption));
            const inside = cuts.filter((k) => kept.some(([b, e]) => k > b && k < e));
            expect(inside, `${s.slug}:${a.ayah} ${c.line}`).toEqual([]);
          }
        }
    expect(cues).toBeGreaterThan(20);
  });
});

describe("MixedText renders the pieces", () => {
  /** The markup's visible text (tags dropped, the few entities React writes decoded). */
  const textOf = (html: string) =>
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  it("puts every content string on screen byte for byte, each Arabic run in one RTL bdi", () => {
    const seen = new Set<string>();
    const sample = CORPUS.filter(([, s]) => (hasArabic(s) || SPLITTABLE_WORD.test(s)) && !seen.has(s) && !!seen.add(s));
    expect(sample.length).toBeGreaterThan(500);
    // One render for all of them, each in a <p> (MixedText draws no <p>).
    const all = renderToStaticMarkup(
      createElement(Fragment, null, ...sample.map(([, s], i) => createElement("p", { key: i }, createElement(MixedText, { text: s })))),
    );
    const rendered = [...all.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    expect(rendered).toHaveLength(sample.length);
    for (const [k, [where, s]] of sample.entries()) {
      const html = rendered[k];
      expect(textOf(html), where).toBe(s);
      const bdis = [...html.matchAll(/<bdi lang="ar" dir="rtl" class="arabic-inline text-ar-sm">([^<]*)<\/bdi>/g)].map((m) =>
        textOf(m[1]),
      );
      expect(bdis, where).toEqual([...s.matchAll(ARABIC_RUN)].map((m) => m[0]));
    }
    // a few thousand strings: room for a loaded runner
  }, 60_000);

  it("marks the boxes the CSS and the CI check rely on", () => {
    // The term's unit, its seam a unit inside it; the Arabic part right to left with its brackets,
    // the comma after them outside.
    expect(renderToStaticMarkup(createElement(MixedText, { text: "didahului huruf jar (حَرْف جَرّ), yaitu Al-Fatihah." }))).toBe(
      'didahului <span data-lb="unit" class="lb-unit">huruf <span data-lb="unit" class="lb-unit"><span data-lb="part" class="lb-part">jar</span> ' +
        '<span data-lb="part" class="lb-part lb-ar"><span dir="rtl">(<bdi lang="ar" dir="rtl" class="arabic-inline text-ar-sm">حَرْف جَرّ</bdi>)</span>,</span>' +
        '</span></span> yaitu <span data-lb="glue" class="lb-glue">Al-Fatihah.</span>',
    );
    // A quotation: its own unit, nothing glued to it.
    expect(renderToStaticMarkup(createElement(MixedText, { text: "Kalimat «ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ», itu" }))).toBe(
      'Kalimat <span data-lb="unit" class="lb-unit"><span data-lb="part" class="lb-part lb-ar"><span dir="rtl">«' +
        '<bdi lang="ar" dir="rtl" class="arabic-inline text-ar-sm">ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ</bdi>»</span>,</span></span> itu',
    );
    // A gloss's rest outside its seam; a hyphenated word there still glued.
    expect(renderToStaticMarkup(createElement(MixedText, { text: "«ٱهْدِنَا» (tunjukilah kami)" }))).toBe(
      '<span data-lb="unit" class="lb-unit"><span data-lb="unit" class="lb-unit"><span data-lb="part" class="lb-part lb-ar"><span dir="rtl">«' +
        '<bdi lang="ar" dir="rtl" class="arabic-inline text-ar-sm">ٱهْدِنَا</bdi>»</span></span> <span data-lb="part" class="lb-part">(tunjukilah</span></span> kami)</span>',
    );
  });
});
