import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  alignEmphasis,
  captionSpans,
  emphasisSpans,
  glossSlot,
  leadMeaning,
  leadSpans,
  meaningSpans,
  PAGE_SPANS,
  partEmphasis,
  SHORT_WORDS,
  termEmphasis,
  type Emphasis,
  type EmphasisKind,
} from "./emphasis";
import { AUTOPLAY_TEXT_SETS } from "@/components/autoplay/texts";
import { splitCaption } from "./lessonSteps";
import { getBasic, LIBRARY, partsFor, TERMS } from "./library";
import { WORD_INFO } from "./content";
import { annotate, markedTokens, prepareParts, Scope, soundsOf, termDisplay, titleParts, type Token } from "./terms";
import { hasArabic } from "./textUnits";

// Emphasis (operator, 2026-10-11: "we can also use bold text or different color to highlight the
// meanings or important things"; narration rule 18): which stretches a text emphasises, over the
// strings the module really shows — every Al-Fatihah caption, every quiz explanation, every Konsep
// text — and how the karaoke words take them.
//
// Meanings (operator 2026-10-13, plan L22: "sometimes found this: yang artinya “dengan” (which is
// correct), some sentence dont use “ and without color. should we just use color without ", or
// what?" — both, always): a meaning inside a sentence is in “…” AND emphasised, wherever it is
// shown. So this file also holds the content to it: no gloss in straight quotes after a cue word,
// and every short quotation the rule leaves plain is listed here with its reason (PLAIN).

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(BELAJAR, rel), "utf8"));

/** A caption template's slot: "{gloss}" for `gloss`, "{x}" for the argument itself. */
const SLOT: unknown = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => "{x}" : typeof key === "symbol" ? undefined : `{${key}}`) },
);
/** The lesson map's templates take LISTS of step names (2026-10-15: every counted step named), a
 *  postponed one with its ayah: each argument is one named slot that is a list of itself, its
 *  item a slot with a name and no ayah ("{later}" … "tetapi baru akan diajarkan lebih lengkap nanti"). */
const LIST_SLOT: unknown = new Proxy(
  {},
  {
    get: (_t, key) => {
      if (typeof key === "symbol") return undefined;
      const name = `{${key}}`;
      return Object.assign([{ name, ayah: null, toString: () => name }], { [Symbol.toPrimitive]: () => name });
    },
  },
);
/** The templates that take LIST_SLOT. */
const LIST_TEMPLATE = /\.(?:lessonMap\.[a-z]+|learned|total|totalGroup)$/;
/** Every caption a text set can give (src/components/autoplay/texts.ts: the captions of lines
 *  without a narration display text): its strings, and its templates with their slots named. */
function captionTexts(value: unknown, where: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([where, value]);
  else if (typeof value === "function") {
    const slot = LIST_TEMPLATE.test(where) ? LIST_SLOT : SLOT;
    out.push([where, String((value as (...slots: unknown[]) => unknown)(slot, slot))]);
  } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) captionTexts(v, `${where}.${k}`, out);
  return out;
}

/** Every string in a JSON value, with where it came from. */
function strings(value: unknown, where: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([where, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${where}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) strings(v, `${where}.${k}`, out);
  return out;
}

type Line = { text: string; display?: string; tokens?: { t: string }[] };
type Manifest = { lines: Record<string, Line> };
const MANIFESTS = readdirSync(join(BELAJAR, "content/narration"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f.replace(/\.json$/, ""), readJson(`content/narration/${f}`) as Manifest] as const);
/** Every caption the stage can show: a manifest line's display text. */
const CAPTIONS = MANIFESTS.flatMap(([slug, m]) =>
  Object.entries(m.lines).flatMap(([id, l]) => (l.display ? [[`${slug} ${id}`, l.display] as const] : [])),
);
const FATIHAH = CAPTIONS.filter(([where]) => where.startsWith("al-fatihah "));
/** The quiz explanations: the content's `why` (shown in the feedback) and the narrated ones. */
const QUIZ = [
  ...readdirSync(join(BELAJAR, "content/quiz")).flatMap((f) =>
    strings(readJson(`content/quiz/${f}`), f).filter(([where]) => where.endsWith(".why")),
  ),
  ...CAPTIONS.filter(([where]) => /:ex:[^:]+:\d+:why/.test(where)),
];
/** The Konsep library's prose as a concept page reads it (ConceptCard's path: one scope, the
 *  title first, then summary, explanation, the parts diagrams' steps, bridge and the examples'
 *  notes; the Harakat page without reminders) — the tokens TermText draws. */
const SOUNDS = soundsOf(getBasic("harakat")?.signs ?? []);
const KONSEP_TOKENS: [string, Token[]][] = [...LIBRARY.concepts, ...LIBRARY.basics].flatMap((rec) => {
  const mk = rec.marked;
  if (!mk) return [];
  const page = new Scope(rec.id !== "harakat");
  titleParts(mk.title, page, TERMS);
  const at = (f: string) => annotate(f, page, TERMS);
  const steps = partsFor(rec.id).flatMap((p) => (WORD_INFO[p.loc] ? prepareParts(p, WORD_INFO[p.loc], page, TERMS, SOUNDS).steps : []));
  return [at(mk.summary), ...mk.explanation.map(at), ...steps, ...(mk.bridge ? [at(mk.bridge)] : []), ...mk.notes.map(at)].map(
    (t, i) => [`konsep ${rec.id}[${i}]`, t] as [string, Token[]],
  );
});
const KONSEP: [string, string][] = KONSEP_TOKENS.map(([where, t]) => [where, termDisplay(t).text]);
/** Every other string of the content and messages. */
const CONTENT: [string, string][] = [
  ...["al-fatihah", "al-ikhlas", "al-falaq", "an-nas", "library"].flatMap((f) => strings(readJson(`content/${f}.json`), f)),
  ...readdirSync(join(BELAJAR, "content/compose")).flatMap((f) => strings(readJson(`content/compose/${f}`), `compose/${f}`)),
  ...["id", "en"].flatMap((l) => strings(readJson(`messages/${l}.json`), `messages/${l}`)),
];
const ALL = (() => {
  const seen = new Set<string>();
  return [...CAPTIONS, ...QUIZ, ...KONSEP, ...CONTENT].filter(([, s]) => !seen.has(s) && !!seen.add(s));
})();

/** The spans as [kind, text] pairs. */
const shown = (s: string) => emphasisSpans(s).map((e) => [e.kind, s.slice(e.from, e.to)]);

/** The “…” quotations of s as [open, close] (the ” included). */
const quotes = (s: string) => [...s.matchAll(/“[^”]*”/gu)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);

const LETTER = /\p{L}/u;
/** Everything wrong with one string's spans (empty: fine). */
function problems(s: string): string[] {
  const out: string[] = [];
  const spans = emphasisSpans(s);
  spans.forEach((e, i) => {
    if (!(e.from >= 0 && e.to <= s.length && e.from < e.to)) out.push(`span ${i} out of bounds`);
    if (i > 0 && spans[i - 1].to > e.from) out.push(`spans ${i - 1} and ${i} overlap or are out of order`);
    // Never a word cut in two.
    if (LETTER.test(s[e.from - 1] ?? "") && LETTER.test(s[e.from])) out.push(`"${s.slice(e.from, e.to)}" starts inside a word`);
    if (LETTER.test(s[e.to - 1]) && LETTER.test(s[e.to] ?? "")) out.push(`"${s.slice(e.from, e.to)}" ends inside a word`);
    if (e.kind === "meaning" && hasArabic(s.slice(e.from, e.to))) out.push(`a meaning with Arabic: "${s.slice(e.from, e.to)}"`);
    // Inside a quotation only when it is that quotation (a gloss): a kitab's words, an ayah's
    // translation stay as quoted.
    for (const [o, c] of quotes(s))
      if (e.from > o && e.to <= c) out.push(`"${s.slice(e.from, e.to)}" inside the quotation "${s.slice(o, c).slice(0, 40)}"`);
  });
  return out;
}

/** A meaning with no cue before it: one whole “…” quotation of at most SHORT_WORDS words, none of
 *  them Arabic, that does not end its own sentence (a translation, a question). */
const shortGloss = (g: string) =>
  /^“[^“”]+”$/u.test(g) && !hasArabic(g) && g.slice(1, -1).trim().split(/\s+/u).length <= SHORT_WORDS && !/(?<!\.\.)[.?!]”$/u.test(g);

/** What a meaning (after a cue word), a term and a sound must come right after (no false positive). */
const AFTER: Record<EmphasisKind, RegExp> = {
  meaning: /(?:artinya|maknanya|bermakna|berarti|makna)\s*:?\s+$|[”'’](?:, | atau | dan )$/u,
  term: /(?:disebut|dinamakan|ulama menyebutnya|Jadi, kata ini|Perannya:)\s+[“‘'(·]*$|Konsep baru(?::| —)\s+$/u,
  sound: /(?:[Bb]unyi(?:nya)?(?:\s+(?:pendek|panjang))?\s+(?:[aiuāīū](?:\s+panjang)?(?:, dan |, atau |, | dan ))*|dibaca\s+)$/u,
};

describe("emphasisSpans: what a text emphasises", () => {
  it("the meaning after “artinya”, quotes included; a chain of glosses; a straight-quoted one", () => {
    expect(shown("Kata pertama artinya: “dengan nama”. Kata ini terdiri dari dua bagian.")).toEqual([["meaning", "“dengan nama”"]]);
    expect(shown("Huruf jar (حَرْف جَرّ) adalah kata depan seperti huruf ba’ (بِ) yang artinya “dengan”, dan huruf lam (لِ) yang artinya “bagi”;")).toEqual([
      ["meaning", "“dengan”"],
      ["meaning", "“bagi”"],
    ]);
    expect(shown("isim fa'il (اِسْم فَاعِل) yang bermakna “sangat” atau “sering melakukan”, seperti naffas")).toEqual([
      ["meaning", "“sangat”"],
      ["meaning", "“sering melakukan”"],
    ]);
    expect(shown("bukan ayat Al-Qur'an; artinya 'kabulkanlah'. Darwisy menyebutnya sunnah")).toEqual([["meaning", "'kabulkanlah'"]]);
    // Straight quotes are only read right after the cue word (the content has none any more: the
    // guard below); in “…”, the same gloss is a meaning wherever it stands (L22).
    expect(shown("sehingga maknanya menjadi 'hanya kepada-Mu' (Darwisy)")).toEqual([]);
    expect(shown("sehingga maknanya menjadi “hanya kepada-Mu” (Darwisy)")).toEqual([["meaning", "“hanya kepada-Mu”"]]);
    expect(shown("nasta‘īnu, sehingga maknanya “hanya kepada-Mu”. Pelaku (fa'il) kedua kata kerja")).toEqual([["meaning", "“hanya kepada-Mu”"]]);
    // A gloss with a bracket inside it; the apostrophe of fi'il never closes a straight-quoted one.
    expect(shown("artinya: “(makhluk) yang”")).toEqual([["meaning", "“(makhluk) yang”"]]);
    expect(shown("bermakna 'kata fi'il itu' di sini")).toEqual([["meaning", "'kata fi'il itu'"]]);
  });

  it("the term named or given as the answer, with its Arabic; never its punctuation", () => {
    expect(shown("Kata benda yang berubah seperti ini disebut majrur (مَجْرُور).")).toEqual([["term", "majrur (مَجْرُور)"]]);
    expect(shown("Akhirnya dibaca kasrah (كَسْرَة), karena menjadi mudhaf ilaih (مُضَاف إِلَيْه) dari kata pertama. Jadi, kata ini majrur (مَجْرُور).")).toEqual([
      ["term", "majrur (مَجْرُور)"],
    ]);
    expect(shown("ulama menyebutnya syibhul jumlah (شِبْه الجُمْلَة), yang artinya “yang menyerupai kalimat”.")).toEqual([
      ["term", "syibhul jumlah (شِبْه الجُمْلَة)"],
      ["meaning", "“yang menyerupai kalimat”"],
    ]);
    // A concept caption's name, up to its title's comma, colon or full stop or its gloss's bracket
    // — the whole name, its Arabic and the words after it (review 2026-10-11: "Dhamir (ضَمِير)"
    // alone was the concept taught before, sya'n the new one), Arabic or not.
    expect(shown("Konsep baru: I’rab (إِعْرَاب) dan tandanya, yaitu dhammah (ضَمَّة)")).toEqual([["term", "I’rab (إِعْرَاب) dan tandanya"]]);
    expect(shown("Konsep baru: Tiga jenis kalimah (كَلِمَة), atau kata: isim (اِسْم)")).toEqual([["term", "Tiga jenis kalimah (كَلِمَة)"]]);
    // A transliteration's ‘ain is the term's.
    expect(shown("Konsep baru: ‘Athaf (عَطْف), yaitu kata sambung")).toEqual([["term", "‘Athaf (عَطْف)"]]);
    const concept = (id: string) => CAPTIONS.find(([where]) => where.endsWith(`:concept:${id}`))![1];
    const nameIn = (caption: string) => shown(caption).find(([k]) => k === "term")?.[1];
    const name = (id: string) => nameIn(concept(id));
    expect(name("murab-mabni")).toBe("Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)");
    expect(name("kana-wa-akhawatuha")).toBe("Kana (كَانَ) dan saudaranya");
    // A step with its own text (the curriculum, 2026-10-13): named the same way.
    expect(name("majrur")).toBe("Majrur (مَجْرُور)");
    expect(name("alif-lam")).toBe("Alif lam (ال)");
    // The same rule on the captions of the records that are next-level since 2026-10-13 (no lesson
    // says their "Konsep baru" line any more; a lesson map's card still names them this way): each
    // as its line stood.
    expect(nameIn("Konsep baru: Dhamir (ضَمِير) sya'n (kata ganti yang artinya “perkara”). Dhamir (ضَمِير) sya'n ialah kata ganti.")).toBe("Dhamir (ضَمِير) sya'n");
    expect(nameIn("Konsep baru: Khabar (خَبَر) jumlah, yaitu khabar (خَبَر) berupa kalimat.")).toBe("Khabar (خَبَر) jumlah");
    expect(nameIn("Konsep baru: ‘Athaf (عَطْف) bayan (penjelas yang mengikuti).")).toBe("‘Athaf (عَطْف) bayan");
    expect(nameIn("Konsep baru: Wazan (وَزْن) dan tashrif (تَصْرِيف), yaitu cetakan kata.")).toBe("Wazan (وَزْن) dan tashrif (تَصْرِيف)");
    expect(nameIn("Konsep baru: Bab if‘āl (إِفْعَال), yaitu wazan (وَزْن) af‘ala (أَفْعَلَ).")).toBe("Bab if‘āl (إِفْعَال)");
    expect(nameIn("Konsep baru: Fi'il majhul, yaitu kata kerja pasif.")).toBe("Fi'il majhul");
    expect(nameIn("Konsep baru: Hal (keterangan keadaan).")).toBe("Hal");
    expect(nameIn("Konsep baru: Maqul al-qaul (isi perkataan sesudah kata pertama).")).toBe("Maqul al-qaul");
    expect(nameIn("Konsep baru: Ruba'i mujarrad (kata kerja empat huruf asli).")).toBe("Ruba'i mujarrad");
    expect(nameIn("Konsep baru: Shighat mubalaghah (bentuk yang artinya “sangat, sering”).")).toBe("Shighat mubalaghah");
    // The particle's title ("Lam: …") is said with its step's name since 2026-10-19, when Al-Ikhlas's
    // lesson map was switched on (until then "Huruf yang menafikan …", a description: no name).
    expect(name("jazm-lam")).toBe("Huruf nafi yang menjazmkan");
    expect(shown("Konsep baru — Kalimah: isim, fi'il, huruf (tiga jenis kata): …")).toEqual([["term", "Kalimah"]]);
    // The quiz explanation's answer, up to its full stop outside brackets, Arabic and all.
    expect(shown("Perannya: huruf jar (حَرْف جَرّ) + majrur (مَجْرُور). Akhirnya dibaca kasrah (كَسْرَة)")).toEqual([
      ["term", "huruf jar (حَرْف جَرّ) + majrur (مَجْرُور)"],
    ]);
    expect(shown("Perannya: zharaf zaman. Kata ini mabni (مَبْنِيّ)")).toEqual([["term", "zharaf zaman"]]);
    // With a reminder after it, the term's words alone.
    expect(shown("disebut kasrah (كَسْرَة, tanda bunyi i di bawah huruf)")).toEqual([
      ["term", "kasrah"],
      ["sound", "i"],
    ]);
    // Named inside the prose's own bracket — an aside — or by one author: not the term taught.
    // (the item's Arabic right after it, one space: TermText's form since 2026-10-12)
    expect(shown("rafa' (رَفْع, katanya disebut marfu' مَرْفُوع), nashab")).toEqual([]);
    expect(shown("kata keduanya (disebut mudhaf ilaih مُضَاف إِلَيْه) selalu majrur")).toEqual([]);
    expect(shown("Darwisy dan al-Jadwal menyebutnya zaidah (زَائِدَة), yang artinya “tambahan”")).toEqual([["meaning", "“tambahan”"]]);
  });

  it("the letter of a harakah's sound, each in a list", () => {
    expect(shown("Tiga harakat utama adalah fathah (فَتْحَة), kasrah (كَسْرَة), dan dhammah (ضَمَّة). Bunyinya a, i, dan u.")).toEqual([
      ["sound", "a"],
      ["sound", "i"],
      ["sound", "u"],
    ]);
    expect(shown("karena itu bunyi a pada huruf mim (مَٰ) itu dibaca panjang.")).toEqual([["sound", "a"]]);
    expect(shown("huruf wawu (و), bunyi u panjang, di tempat huruf ya’ (ي) itu.")).toEqual([["sound", "u"]]);
    expect(shown("tanda bunyi a, i, u")).toEqual([
      ["sound", "a"],
      ["sound", "i"],
      ["sound", "u"],
    ]);
    // "dibaca a." (the Harakat page, review 2026-10-11): one vowel ending its clause.
    const harakat = KONSEP.find(([where]) => where === "konsep harakat[1]")![1];
    expect(harakat).toContain("di atas huruf, dibaca a. Kasrah");
    expect(shown(harakat).filter(([k]) => k === "sound")).toEqual([
      ["sound", "a"],
      ["sound", "i"],
      ["sound", "u"],
    ]);
    for (const s of ["memakai kasrah: dibaca bi.", "hurufnya dibaca dobel, seperti b", "dibaca i karena mudhari'-nya", "dibaca -an"]) expect(shown(s), s).toEqual([]);
  });

  it("nothing in a translation, a kitab's quoted words, an unquoted sense or a mention", () => {
    for (const s of [
      // An ayah's translation, and a kitab quoted: never a gloss of the lesson's.
      "Ayat pertama Surah Al-Fatihah. Terjemahannya: “Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.” Ayat ini terdiri dari empat kata.",
      "al-Jadwal menyebutnya “mabni di atas kasrah, dalam kedudukan jar”. Bunyi",
      "«قُلْ أَعُوذُ بِرَبِّ» (katakanlah: aku berlindung kepada Tuhan)",
      // A word being defined, not given as a meaning; an unquoted sense.
      "“Tanpa tambahan” dalam istilah nahwu berarti tidak diperlukan untuk susunan kalimat",
      "keduanya baru bermakna utuh bersama kata sesudahnya.",
      "aṣ-ṣamad berwazan fa‘al bermakna maf‘ūl, yaitu yang dituju",
      "'Athaf artinya menyambungkan.",
      "Dengarkan bacaan imam, lalu pahami setiap kata: artinya, akar katanya, dan alasan harakat di akhirnya.",
      // A term mentioned, not named as the answer; no Arabic, no term.
      "tetapi murka disebut tanpa menyebut siapa yang murka.",
      "(Darwisy menyebutnya sifat keempat)",
      "disebut juga sifat",
      "Inilah yang disebut maqul al-qaul; ia",
      // Sounds that are no harakah's.
      "bunyi huruf lam (ل) melebur ke huruf sesudahnya",
      "Bunyi akhir banyak kata Arab berubah",
      "dua cara ini menjelaskan bunyi yang sama.",
      "tambahan bunyi n: tanwin",
      "menurut as-Samin, asal bunyi kata ganti ini u (-hum)",
      "jadi selalu berbunyi iyyāka.",
      "artinya “جَرّ”",
      "artinya “satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga”",
      "artinya “”",
    ])
      expect(shown(s), s).toEqual([]);
  });

  it("nothing inside a kitab's quoted words, though a lesson's term or sound is in them", () => {
    // TermText's own text: "al-Jadwal: “mabni di atas fathah, فَتْحَة, tanda bunyi a …”",
    // "Ibnu Ajurrum menyebutnya “majzum (مَجْزُوم)”" — the kitab's words, as it wrote them.
    const cited = KONSEP_TOKENS.filter(([, t]) => /(?:al-Jadwal: |Ajurrum menyebutnya )“/u.test(termDisplay(t).text));
    expect(cited.some(([, t]) => /“[^”]*bunyi [aiu]\b[^”]*”/u.test(termDisplay(t).text))).toBe(true);
    expect(cited.some(([, t]) => /menyebutnya “\S+ \([^)]*[؀-ۿ]/u.test(termDisplay(t).text))).toBe(true);
    for (const [where, t] of cited) {
      const s = termDisplay(t).text;
      for (const [o, c] of quotes(s))
        for (const spans of [emphasisSpans(s), termEmphasis(t)]) expect(spans.filter((e) => e.from > o && e.to <= c), where).toEqual([]);
    }
  });

  it("a caption part holding half a quotation emphasises nothing in it", () => {
    // The stage cuts a long caption into parts (≤ 180 characters); a quotation cut in two is
    // still a quotation on both sides.
    expect(shown("Terjemahannya: “Dengan nama Allah yang artinya “Esa”")).toEqual([]);
    expect(shown("kata yang artinya dari bunyi a.” Lalu bunyi i.")).toEqual([["sound", "i"]]);
  });

  it("holds its invariants over every string the module shows", () => {
    expect(ALL.length).toBeGreaterThan(8000);
    const bad = ALL.flatMap(([where, s]) => problems(s).map((p) => `${where}: ${p}`));
    expect(bad).toEqual([]);
  });

  it("never emphasises anything but what follows its trigger, or a short quotation (every Al-Fatihah caption, quiz explanation, Konsep text)", () => {
    const KONSEP_DRAWN = KONSEP_TOKENS.map(([where, t]) => [where, termDisplay(t).text, termEmphasis(t)] as const);
    const sets = {
      FATIHAH: FATIHAH.map(([where, s]) => [where, s, captionSpans(s)] as const),
      QUIZ: QUIZ.map(([where, s]) => [where, s, emphasisSpans(s)] as const),
      KONSEP: KONSEP_DRAWN,
    };
    for (const [name, set] of Object.entries(sets)) {
      expect(set.length, name).toBeGreaterThan(30);
      let n = 0;
      let uncued = 0;
      const bad = set.flatMap(([where, s, spans]) =>
        spans.flatMap((e) => {
          n++;
          // A "Perannya:" answer runs on past its first word (and past a gloss inside it, which
          // cuts it in two); a chained gloss follows another.
          const before = s.slice(Math.max(0, e.from - 60), e.from);
          const text = s.slice(e.from, e.to);
          if (AFTER[e.kind].test(before)) return [];
          if (e.kind === "term" && /Perannya: [^.]*”\s*$/u.test(s.slice(0, e.from))) return [];
          // With no cue before it (L22): a whole short quotation, and nothing else.
          if (e.kind === "meaning" && shortGloss(text) && ++uncued) return [];
          return [`${where}: ${e.kind} "${text}" after "…${before.slice(-30)}"`];
        }),
      );
      expect(bad, name).toEqual([]);
      expect(n, name).toBeGreaterThan(30);
      // Every set has them: “kami”, “Engkau” (pelakunya tersirat), “nama Allah” (idhafah).
      expect(uncued, name).toBeGreaterThan(10);
    }
    // Sounds are one letter each.
    for (const [where, s] of ALL)
      for (const e of emphasisSpans(s)) if (e.kind === "sound") expect(s.slice(e.from, e.to), where).toMatch(/^[aiuāīū]$/u);
  });

  it("finds every quoted meaning after “artinya”, every “Jadi, kata ini …” and every “Perannya:” answer", () => {
    const has = (s: string, kind: EmphasisKind, at: number) => emphasisSpans(s).some((e) => e.kind === kind && e.from === at);
    let meanings = 0;
    let terms = 0;
    let roles = 0;
    for (const [where, s] of CAPTIONS) {
      // In a quiz explanation too (L22: until 2026-10-13 its glosses were left plain beside the
      // answer, 37 of the 361 quoted glosses after "artinya" in the captions).
      for (const m of s.matchAll(/artinya:? (?=“)/gu)) {
        meanings++;
        expect(has(s, "meaning", (m.index ?? 0) + m[0].length), `${where}: ${s.slice(m.index ?? 0, (m.index ?? 0) + 40)}`).toBe(true);
      }
      for (const m of s.matchAll(/Jadi, kata ini (?=\S+ \()/gu)) {
        terms++;
        expect(has(s, "term", (m.index ?? 0) + m[0].length), `${where}: ${s.slice(m.index ?? 0, (m.index ?? 0) + 40)}`).toBe(true);
      }
      for (const m of s.matchAll(/Perannya: /gu)) {
        roles++;
        expect(has(s, "term", (m.index ?? 0) + m[0].length), `${where}: ${s.slice(m.index ?? 0, (m.index ?? 0) + 60)}`).toBe(true);
      }
    }
    // 350 since the basic curriculum (2026-10-13): the wazan exercise's lines and the "Konsep
    // baru" lines of the next-level records left the lessons.
    expect(meanings).toBeGreaterThan(330);
    expect(terms).toBeGreaterThan(60);
    expect(roles).toBeGreaterThan(60);
  });

  it("a quiz explanation: its answer AND its meanings, never the terms and sounds of its reasons", () => {
    // Review 2026-10-11 kept the answer alone ("three forest glosses after it made it one bold
    // thing among four"); operator 2026-10-13 (L22): a meaning is always emphasised — the answer
    // is bold in ink, the glosses bold in forest, and they read apart.
    expect(
      shown("Perannya: huruf jar (حَرْف جَرّ) + majrur (مَجْرُور). Huruf lam (لِ) yang artinya “bagi”, adalah huruf jar (حَرْف جَرّ) dan akhiran, yang artinya “Dia”"),
    ).toEqual([
      ["term", "huruf jar (حَرْف جَرّ) + majrur (مَجْرُور)"],
      ["meaning", "“bagi”"],
      ["meaning", "“Dia”"],
    ]);
    // A real one: a gloss after "yang artinya" and the answer. (The operator's example was ayah
    // 1's first why-harakat question, “dengan”; ayah 1 asks no reason since 2026-10-13 — no wrong
    // option is taught by then — so this is the same kind of line in ayah 2.)
    const why = CAPTIONS.find(([where]) => where === "al-fatihah al-fatihah:2:ex:sort-case:2:why")![1];
    expect(why).toMatch(/yang artinya “bagi”.*Jadi, kata ini majrur \(مَجْرُور\)\.$/u);
    expect(shown(why).filter(([kind]) => kind === "term")).toEqual([["term", "majrur (مَجْرُور)"]]);
    expect(shown(why).filter(([kind]) => kind === "meaning").slice(0, 2)).toEqual([
      ["meaning", "“bagi”"],
      ["meaning", "“tetap”"],
    ]);
    // No term named in a reason ("disebut …") and no sound ("bunyi i") beside an answer.
    expect(shown("Jadi, kata ini majrur (مَجْرُور). Kata seperti ini disebut isim (اِسْم), bunyi i, yang artinya “nama”.")).toEqual([
      ["term", "majrur (مَجْرُور)"],
      ["meaning", "“nama”"],
    ]);
    // A gloss inside the answer itself cuts it in two: both stay, the gloss as a meaning.
    expect(shown("Perannya: fi'il amr (fa'il tersimpan: “engkau”). Kata ini mabni.")).toEqual([
      ["term", "fi'il amr (fa'il tersimpan:"],
      ["meaning", "“engkau”"],
    ]);
    expect(shown("Perannya: fi'il amr; fa'il tersimpan: “engkau” (Nabi Muhammad). Kata ini mabni.")).toEqual([
      ["term", "fi'il amr; fa'il tersimpan:"],
      ["meaning", "“engkau”"],
      ["term", "(Nabi Muhammad)"],
    ]);
    let answered = 0;
    let glossed = 0;
    for (const [where, s] of QUIZ) {
      const spans = emphasisSpans(s);
      if (!/Perannya: |Jadi, kata ini /u.test(s) || !spans.length) continue;
      answered++;
      const terms = spans.filter((e) => e.kind === "term");
      expect(terms.length, where).toBeGreaterThan(0);
      for (const e of spans) {
        expect(e.kind, where).not.toBe("sound");
        if (e.kind === "meaning") glossed++;
        // Every term is the answer (or the rest of one a gloss cut).
        else expect(s.slice(0, e.from), where).toMatch(/(?:Perannya:|Jadi, kata ini) $|Perannya: [^.]*”\s*$/u);
      }
      // …and every meaning the text has is there.
      expect(spans.filter((e) => e.kind === "meaning"), where).toEqual(meaningSpans(s));
    }
    expect(answered).toBeGreaterThan(100);
    // 61 glosses in 52 of the 133 narrated explanations that give an answer: plain until L22.
    expect(glossed).toBeGreaterThan(50);
  });
});

describe("meanings (plan L22): always in “…”, always emphasised", () => {
  const meanings = (s: string) => meaningSpans(s).map((e) => s.slice(e.from, e.to));

  it("a short quotation with no cue word is a meaning", () => {
    expect(meanings("Kata kerja ini mabni; pelakunya tersirat, yaitu “aku”.")).toEqual(["“aku”"]);
    expect(meanings("ismi → Allāhi: idhafah (“nama Allah”)")).toEqual(["“nama Allah”"]);
    expect(meanings("fi'il mudhari' (fa'il tersimpan: “kami”)")).toEqual(["“kami”"]);
    expect(meanings("dari gaḍiba “marah”; maknanya lengkap bersama ‘alaihim (“atas mereka”).")).toEqual(["“marah”", "“atas mereka”"]);
    expect(meanings("Dhamir adalah kata ganti seperti “kami”, “Engkau”, dan “mereka”;")).toEqual(["“kami”", "“Engkau”", "“mereka”"]);
    // Five words, the most; an elision is no sentence end; an English caption's gloss too.
    expect(meanings("allażīna + shilah an‘amta ‘alaihim (“yang telah Engkau beri nikmat”)")).toEqual(["“yang telah Engkau beri nikmat”"]);
    expect(meanings("bentuk mubalaghah (“yang banyak …”) dari isim fa'il")).toEqual(["“yang banyak …”"]);
    expect(meanings("Isim fa'il (kata pelaku: “yang ...”)")).toEqual(["“yang ...”"]);
    expect(meanings("Word 2 means “Allah”.")).toEqual(["“Allah”"]);
    // On a Konsep page the word before it shows its Arabic: the same gloss.
    expect(meanings("seperti qul (قُلْ) “katakanlah”; bila diucapkan hamba")).toEqual(["“katakanlah”"]);
  });

  it("…unless it is a translation, a kitab's wording, a named term or control, a word mentioned, Arabic, or long", () => {
    for (const s of [
      // An ayah's translation, whatever its length (and any quotation that ends its own sentence).
      "Ayat kedua Surah An-Nas. Terjemahannya: “Raja manusia.” Ayat ini terdiri dari dua kata.",
      "Terjemahannya: “Raja manusia” — ayat ini terdiri dari dua kata.",
      "pertanyaannya bukan “mengapa akhirnya berubah?”, melainkan “apa kedudukannya?”.",
      // A kitab's wording cited: by "menyebut(nya)", with up to three words between; by its reason;
      // by the author's or the kitab's name right before it.
      "Fi'il amr mabni. Ibnu Ajurrum menyebutnya “majzum”, dan Ahmad Zaini Dahlan",
      "sama dengan ayat 3, dan Darwisy menyebut i'rab-nya “jelas”: frasa ini",
      "Darwisy menyebut iyyāka (إِيَّاكَ) “objek yang didahulukan untuk pengkhususan”, dan",
      "ad-Da'as menyebut na'ib fa'il-nya tersimpan: “Dia tidak diperanakkan”.",
      "Darwisy memberi alasannya: “karena ia isim maf'ul” (juga al-Jadwal)",
      "ikut majrur dengan kasrah (al-Jadwal: “mengikutinya dalam jar”). Di ayat 6",
      "yang lepas dari makna syarat, dan al-Mujtaba “zharaf murni”.",
      // A term named.
      "berupa satu kata. Karena itu disebut “menyerupai kalimat”.",
      "lam itu dinamai lam doa “karena adab”. As-Samin menukil",
      // A word mentioned as a word: the Name, a word being defined.
      "adalah dua sifat lagi bagi lafaz “Allah” di ayat dua, maka keduanya",
      "yang sudah ada pada gairi. “Tambahan” dalam istilah nahwu berarti tidak diperlukan",
      // A control named, and what is heard, in both caption languages.
      "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      "Ingin membaca lebih banyak? Buka “Materi lengkap ayat ini” di bawah pelajaran",
      "Bersama kata sebelumnya terdengar “bismillāhi”, karena alif di awalnya tidak dibaca.",
      "Try again, or click the marked “Show the answer”.",
      "To continue without this practice, click “Skip practice”.",
      "With the word before it you hear “bismillāhi”, because its first alif is not read.",
      // Arabic inside; six words (SHORT_WORDS is five); empty.
      "Ibnu Ajurrum pun berkata “majzum (مَجْزُوم)” di babnya",
      "allażī + shilah yuwaswisu fī ṣudūri an-nāsi (“yang membisikkan ke dalam dada manusia”)",
      "kira-kira “”",
    ])
      expect(meanings(s), s).toEqual([]);
    expect(SHORT_WORDS).toBe(5);
    // What the exclusions do NOT reach: a gloss a comma away from "menyebut", the word a thing is
    // named with, a gloss after an example's "misalnya".
    expect(meanings("al-Jadwal menyebut gāsiq isim fa'il dari gasaqa, “menjadi gelap”")).toEqual(["“menjadi gelap”"]);
    expect(meanings("yang dimaksud setan, dinamai dengan kata “bisikan” seakan ia bisikan itu sendiri")).toEqual(["“bisikan”"]);
    expect(meanings("bergantung pada khabar (خَبَر) yang tidak disebut (misalnya “tetap”).")).toEqual(["“tetap”"]);
    // After a cue word the limit is the old one (GLOSS_WORDS, twelve): a longer gloss is one still.
    expect(meanings("sehingga maknanya “tidak ada seorang pun yang setara bagi-Nya” (Abu Hayyan)")).toEqual(["“tidak ada seorang pun yang setara bagi-Nya”"]);
    expect(meanings("sehingga maksudnya “tidak ada seorang pun yang setara bagi-Nya” (Abu Hayyan)")).toEqual([]);
  });

  /**
   * Every “…” quotation of the module that has a meaning's shape (shortGloss) and is NOT emphasised,
   * by what it is — read one by one on 2026-10-13. A new one must be put here with its reason, or
   * the rule (src/lib/emphasis.ts NOT_GLOSS_AFTER) changed so that it is a meaning.
   */
  const PLAIN: Record<string, string[]> = {
    "a kitab's wording": [
      "“jelas”",
      "“mengikutinya dalam jar”",
      "“majzum”",
      "“fi'il amr yang bermakna doa”",
      "“bermakna doa”",
      "“maf'ul yang tidak disebut pelakunya”",
      "“objek yang didahulukan untuk pengkhususan”",
      "“karena ia isim maf'ul”",
      "“Dia tidak diperanakkan”",
      "“karena kasih dan kelembutan”",
      "“untuk sekadar keterangan waktu”",
      "“zharaf murni”",
    ],
    "a term named": ["“menyerupai kalimat”", "“karena adab”"],
    // (“Allah” — the Name in "bagi lafaz “Allah”" — left the captions on 2026-10-18: those lines now
    // name the word itself, "bagi ٱللَّهِ (Allāhi) di ayat kedua", wording rule 8.)
    "a word mentioned": ["“Tambahan”"],
    "a control or what is heard (messages and fallback captions, id and en)": [
      "“Mulai pelajaran”",
      "“Materi lengkap ayat ini”",
      "“Coba lagi”",
      "“Lanjutkan”",
      "“Tunjukkan jawaban”",
      "“Lewati latihan”",
      "“{heard}”",
      "“Start the lesson”",
      "“Full material for this ayah”",
      "“Try again”",
      "“Resume”",
      "“Show the answer”",
      "“Skip practice”",
    ],
  };

  /**
   * …and every other quotation left plain that is not an ayah's translation after "Terjemahannya:"
   * (22 captions): too long for a meaning with no cue word, a sentence, or with Arabic in it.
   */
  const PLAIN_LONGER: Record<string, string[]> = {
    // Real glosses, plain only because they have more than SHORT_WORDS words and no cue word
    // before them ("maksudnya", a bracket, a colon). Known and left so on 2026-10-13: longer
    // quotations are mostly sentences quoted, and a rule cannot tell these from them.
    "a gloss of six or seven words": [
      "“tidak ada seorang pun yang setara bagi-Nya”",
      "“aku berlindung kepada Tuhan yang menguasai subuh”",
      "“aku berlindung … pada waktu itu”",
      "“aku berlindung kepada Allah dari ini pada waktu itu”",
      "“yang membisikkan ke dalam dada manusia”",
      "“orang-orang yang telah Engkau beri nikmat”",
      "“jalan orang-orang yang telah Engkau beri nikmat”",
    ],
    "a kitab's wording (as the lesson has it, and as a Konsep page draws it with its terms' Arabic)": [
      "“mabni di atas kasrah, dalam kedudukan jar”",
      "“mabni di atas kasrah, dalam kedudukan jar (جَرّ)”",
      "“mabni di atas fathah, dalam kedudukan jar”",
      "“mabni di atas fathah فَتْحَة, tanda bunyi a di atas huruf, dalam kedudukan jar”",
      "“mengikutinya dalam jar جَرّ”",
      "“majzum (مَجْزُوم)”",
      "“maf'ul (مَفْعُول) yang tidak disebut pelakunya”",
    ],
    "a title, a question, a card's name": [
      "“Terjemahan Berbahasa Indonesia - Kementerian Agama”",
      "“mengapa akhirnya berubah?”",
      "“apa kedudukannya?”",
      "“Tahukah Anda?”",
      "“Did you know?”",
    ],
  };

  it("over every string of the module: a short quotation is a meaning, or one of the listed ones", () => {
    // A marked twin ("[[majzum|majzum]]") as the page draws it, with the Arabic of its terms and
    // words; the raw markup is never shown.
    const drawn = (marked: string) => termDisplay(annotate(marked, new Scope(), TERMS)).text;
    const texts: (readonly [string, string])[] = [
      ...ALL.map(([where, t]) => [where, /\.marked\./u.test(where) ? drawn(t) : t] as const),
      ...captionTexts(AUTOPLAY_TEXT_SETS.id, "texts/id"),
      ...captionTexts(AUTOPLAY_TEXT_SETS.en, "texts/en"),
    ];
    expect(texts.filter(([where]) => /\.marked\./u.test(where)).length).toBeGreaterThan(600);
    // The templates are there with their slots: the English caption's gloss is a meaning too.
    expect(texts.map(([, t]) => t)).toEqual(expect.arrayContaining(["Kata ke-{n} artinya “{gloss}”.", "Word {n} means “{gloss}”."]));
    expect(meaningSpans("Word {n} means “{gloss}”.")).toHaveLength(1);
    const plain = new Map<string, string>();
    const longer = new Map<string, string>();
    let coloured = 0;
    let translations = 0;
    for (const [where, s] of texts) {
      const spans = meaningSpans(s);
      for (const m of s.matchAll(/“[^“”]*”/gu)) {
        const from = m.index ?? 0;
        if (spans.some((e) => e.from <= from && from + m[0].length <= e.to)) coloured++;
        else if (/Terjemahannya:\s+$/u.test(s.slice(0, from))) translations++;
        else if (shortGloss(m[0])) plain.set(m[0], plain.get(m[0]) ?? where);
        else longer.set(m[0], longer.get(m[0]) ?? where);
      }
    }
    for (const [found, pinned] of [
      [plain, PLAIN],
      [longer, PLAIN_LONGER],
    ] as const) {
      const listed = Object.values(pinned).flat();
      expect(new Set(listed).size).toBe(listed.length);
      expect([...found].filter(([q]) => !listed.includes(q)).map(([q, where]) => `${q} in ${where}`)).toEqual([]);
      expect(listed.filter((q) => !found.has(q))).toEqual([]);
    }
    // One per lesson ayah: the intro caption's translation.
    expect(translations).toBe(22);
    // Against those — 16 short quotations of the lessons and the library, 14 controls of the
    // messages, 19 longer ones, 22 translations — the emphasised ones, over every string, its twin
    // and the captions (1,555 on 2026-10-13).
    expect(coloured).toBeGreaterThan(1200);
  });

  it("the content has no meaning in straight single quotes after a cue word (it is “…”)", () => {
    // 'kabulkanlah', 'hanya kepada-Mu', 'marah' … were made “…” on 2026-10-13 (pipeline/authored,
    // facts.py). What a learner reads: captions, quiz, Konsep, every content string — the
    // references too.
    const STRAIGHT = /(?<!\p{L})(?:yang\s+)?(?:artinya|maknanya|bermakna|berarti|makna)\s*:?\s+['‘](?=\S)[^'‘’]*/gu;
    /** Not an Indonesian gloss: al-Mishbah's Arabic particle, in Latin letters, in a reference. */
    const NOT_A_GLOSS = ["bermakna 'illa"];
    const found = [...CAPTIONS, ...QUIZ, ...KONSEP, ...CONTENT].flatMap(([where, s]) =>
      [...s.matchAll(STRAIGHT)].filter((m) => !NOT_A_GLOSS.includes(m[0])).map((m) => `${where}: ${m[0]}`),
    );
    expect(found).toEqual([]);
    // The check sees one when there is one.
    expect("bukan ayat Al-Qur'an; artinya 'kabulkanlah'.".match(STRAIGHT)).toEqual(["artinya 'kabulkanlah"]);
    expect("sehingga bermakna ‘hanya kepada-Mu’.".match(STRAIGHT)).toEqual(["bermakna ‘hanya kepada-Mu"]);
    // …and the transliteration's own apostrophes are none: "makna 'illah" does not occur, and a
    // cue word is followed by a letter or “ everywhere else.
    expect("fi'il amr yang bermakna doa, artinya “tunjukilah”".match(STRAIGHT)).toBeNull();
  });
});

describe("captionSpans: a stage caption emphasises every meaning", () => {
  it("two meanings in one caption: both (L22; the first alone until 2026-10-13)", () => {
    const concept = CAPTIONS.find(([where]) => where === "al-fatihah al-fatihah:1:concept:huruf-jar")![1];
    expect(concept).toContain("بِ (bi) yang artinya “dengan”, dan لِ (li) yang artinya “bagi”");
    expect(captionSpans(concept).filter((e) => e.kind === "meaning").map((e) => concept.slice(e.from, e.to))).toEqual(["“dengan”", "“bagi”"]);
    const s = "Kata ketiga artinya: “bagi-Nya”. Huruf lam (لَّ) yang artinya “bagi”, adalah huruf jar (حَرْف جَرّ) dan akhiran, yang artinya “Dia”; sehingga bermakna “setara bagi-Nya”.";
    expect(captionSpans(s).map((e) => s.slice(e.from, e.to))).toEqual(["“bagi-Nya”", "“bagi”", "“Dia”", "“setara bagi-Nya”"]);
    const chain = "Shighat mubalaghah ialah bentuk yang bermakna “sangat” atau “sering melakukan”, seperti naffas yang artinya “yang banyak meniup”;";
    expect(captionSpans(chain).map((e) => chain.slice(e.from, e.to))).toEqual(["“sangat”", "“sering melakukan”", "“yang banyak meniup”"]);
    // The caption with the most: four words glossed and two terms named, each its own.
    const maushul = CAPTIONS.find(([where]) => where.endsWith(":concept:isim-maushul"))![1];
    expect(captionSpans(maushul).map((e) => [e.kind, maushul.slice(e.from, e.to)])).toEqual([
      ["term", "Isim maushul (اِسْم مَوْصُول)"],
      ["meaning", "“yang”"],
      ["meaning", "“orang-orang yang”"],
      ["meaning", "“yang”"],
      ["meaning", "“apa yang”"],
      ["term", "shilah (صِلَة)"],
    ]);
  });

  it("over every caption: what a page emphasises; every gloss after “artinya”; at most six", () => {
    let several = 0;
    let most = 0;
    for (const [where, s] of CAPTIONS) {
      const cap = captionSpans(s);
      expect(cap, where).toEqual(emphasisSpans(s));
      const meanings = cap.filter((e) => e.kind === "meaning");
      if (meanings.length > 1) several++;
      most = Math.max(most, cap.length);
    }
    // 79 captions gloss more than one word; until L22 each showed its first gloss alone (with a
    // second only when chained to it, “…” atau “…”), and 181 of the captions' 450 glosses were plain.
    // 74 before An-Nas had compositions, 65 since: a composed word's own line keeps one gloss and
    // its explanation is said in the composition's frames (9 of An-Nas's 22 such captions went),
    // so the floor follows the data, not the rule — the checks below are the rule. Al-Falaq's words were
    // composed the same day (2026-10-20) and its word captions went the same way (29 such captions became
    // 15): 51 in all (Al-Fatihah 19, Al-Falaq 15, An-Nas 13, Al-Ikhlas 4), the floor a margin under that.
    expect(several).toBeGreaterThan(45);
    // Isim maushul's caption above (was 4: one meaning group and three terms). What is on screen at
    // once is less: a text caption shows a part (≤ 180 characters), and no part carries more than
    // four.
    expect(most).toBe(6);
    const perPart = CAPTIONS.flatMap(([, s]) => {
      const parts = splitCaption(s);
      return parts.map((_, k) => partEmphasis(parts, k).length);
    });
    expect(Math.max(...perPart)).toBeLessThanOrEqual(4);
  });

  it("a caption part shows its slice of the whole line's emphasis", () => {
    const long = `Kata pertama artinya: “dengan nama”. ${"Kalimat penjelas yang cukup panjang untuk dipotong menjadi beberapa bagian. ".repeat(3)}Huruf lam (لِ) yang artinya “bagi”, dan bunyinya i.`;
    const parts = splitCaption(long);
    expect(parts.length).toBeGreaterThan(1);
    const per = parts.map((p, k) => partEmphasis(parts, k).map((e) => [e.kind, p.slice(e.from, e.to)]));
    expect(per[0]).toEqual([["meaning", "“dengan nama”"]]);
    expect(per[per.length - 1]).toEqual([
      ["meaning", "“bagi”"],
      ["sound", "i"],
    ]);
    expect(partEmphasis(parts, parts.length)).toEqual([]);
    // Of the WHOLE line, not of the part alone: a translation cut in two parts is one quotation
    // still, and what it comes after is in the part before.
    const cut = ["Ayat kedua. Terjemahannya:", "“Raja manusia”, lalu kata pertama yang artinya “raja”."];
    expect(emphasisSpans(cut[1]).map((e) => cut[1].slice(e.from, e.to))).toEqual(["“Raja manusia”", "“raja”"]);
    expect(partEmphasis(cut, 1).map((e) => cut[1].slice(e.from, e.to))).toEqual(["“raja”"]);
  });
});

describe("termEmphasis: TermText's terms from its tokens", () => {
  const drawn = (t: Token[]) => {
    const { text } = termDisplay(t);
    return termEmphasis(t).map((e) => [e.kind, text.slice(e.from, e.to)]);
  };
  const field = (where: string) => KONSEP_TOKENS.find(([w]) => w === where)![1];

  it("the term a page names, though its Arabic was shown in the title; never an alias", () => {
    // Review 2026-10-11: "perubahan itu disebut i'rab" on the I'rab page has no Arabic (its title
    // showed it), so the text alone never named it; side terms with Arabic were bold instead.
    expect(termDisplay(field("konsep tanda-irab[0]")).text).toContain("perubahan itu disebut i'rab, dan");
    expect(drawn(field("konsep tanda-irab[0]"))).toEqual([["term", "i'rab"]]);
    // In its own bracket with its Arabic; with a citation's bracket, the words alone.
    expect(drawn(field("konsep idhafah[1]"))).toContainEqual(["term", "mudhaf (مُضَاف)"]);
    expect(drawn(field("konsep tanda-irab[1]"))).toContainEqual(["term", "'amil"]);
    // An author's name for a term, and a term named in the prose's bracket: not the taught one.
    const forms = termDisplay(field("konsep tanda-irab[2]")).text;
    expect(forms).toMatch(/katanya disebut marfu'.*Ibnu Ajurrum menyebutnya khafdh/u);
    expect(drawn(field("konsep tanda-irab[2]")).filter(([k]) => k === "term")).toEqual([]);
    const tokens = annotate("Darwisy dan al-Jadwal menyebutnya [[zaidah|zaidah]], dan ulama menyebutnya [[syibhul jumlah|syibhul-jumlah]].", new Scope(), TERMS);
    expect(drawn(tokens)).toEqual([["term", "syibhul jumlah (شِبْه الجُمْلَة)"]]);
  });

  // Grammar terms never form a run (src/lib/terms.ts runFrom, review 2026-10-12): two terms named
  // side by side are two tokens, and the one named — right after the trigger — is emphasised with
  // its own bracket, as before the tidy-up.
  it("two terms named side by side: the first, with its own bracket; its word alone once shown, or with the prose's gloss", () => {
    const ar = (id: string) => TERMS.terms.get(id)!.ar!;
    const named = "Kata ganti yang berdiri sendiri disebut [[dhamir|dhamir]] [[munfashil|munfashil]], dan";
    const fresh = annotate(named, new Scope(), TERMS);
    expect(termDisplay(fresh).text).toBe(`Kata ganti yang berdiri sendiri disebut dhamir (${ar("dhamir")}) munfashil (${ar("munfashil")}), dan`);
    expect(drawn(fresh)).toEqual([["term", `dhamir (${ar("dhamir")})`]]);
    // never the glued phrase, emphasised or drawn
    expect(termDisplay(fresh).text).not.toContain(`${ar("dhamir")} ${ar("munfashil")}`);
    const sc = new Scope();
    annotate("[[dhamir|dhamir]] [[munfashil|munfashil]]", sc, TERMS);
    expect(drawn(annotate(named, sc, TERMS))).toEqual([["term", "dhamir"]]);
    expect(drawn(annotate("disebut [[jumlah|jumlah]] [[ibtida'iyyah|ibtidaiyyah]] (kalimat pembuka).", new Scope(), TERMS))).toEqual([["term", `jumlah (${ar("jumlah")})`]]);
    // a term named inside the prose's bracket is an aside, in the new form too
    const aside = annotate("[[rafa'|rafa]] (katanya disebut [[marfu'|marfu]]).", new Scope(), TERMS);
    expect(termDisplay(aside).text).toBe(`rafa' (${ar("rafa")}, katanya disebut marfu' ${ar("marfu")}).`);
    expect(drawn(aside)).toEqual([]);
  });

  it("the same sentence the same on every page (a parts diagram's step)", () => {
    const steps = KONSEP_TOKENS.flatMap(([where, t]) => {
      const text = termDisplay(t).text;
      return /seperti ini disebut majrur/u.test(text) ? [[where, drawn(t).filter(([k]) => k === "term")] as const] : [];
    });
    expect(new Set(steps.map(([where]) => where.split("[")[0])).size).toBeGreaterThan(2);
    for (const [where, terms] of steps) expect(terms, where).toEqual([["term", "majrur"]]);
  });

  it("a reading page's paragraph carries at most PAGE_SPANS (every gloss of its examples)", () => {
    // Operator 2026-10-11 asked for the meanings highlighted; on a page a learner reads, each
    // gloss is an example word's meaning, so all stay (review 2026-10-11: restraint, pinned here).
    const per = KONSEP_TOKENS.map(([where, t]) => [where, termEmphasis(t)] as const);
    const most = Math.max(...per.map(([, e]) => e.length));
    // Eight, and exactly PAGE_SPANS: fi'il mudhari's second paragraph, the pronoun each prefix
    // stands for (“aku”, “kami”, “dia”, “engkau”, “dia”) and the lesson verbs' own (“kami”, “aku”,
    // “ia”) — one-word glosses with no cue word, so plain until L22. Read as the list it is; a
    // ninth would be one more than any paragraph has needed, so PAGE_SPANS stays where it was.
    expect(most).toBe(PAGE_SPANS);
    const fullest = per.filter(([, e]) => e.length === most).map(([where]) => where);
    expect(fullest).toEqual(["konsep fiil-mudhari[2]"]);
    expect(per.find(([where]) => where === fullest[0])![1].every((e) => e.kind === "meaning")).toBe(true);
    // Materi lengkap and the quiz feedback: word cards' why, summaries, facts, composition notes.
    const read = CONTENT.filter(([where]) => /\.(?:why|summary|body|note)$/u.test(where));
    expect(read.length).toBeGreaterThan(300);
    for (const [where, s] of read) expect(emphasisSpans(s).length, where).toBeLessThanOrEqual(PAGE_SPANS);
    // …and the labels and the Kosakata prose that show their meanings since L22 (meaningSpans: a
    // word's role, a structure group, a scholars' reading, a quiz option, an i'lal rule, a root's
    // meaning; leadSpans: a Kosakata meaning).
    const labels = [
      ...CONTENT.filter(([where]) => /\.(?:role|label|point|rule)$|\.options\[\d+\](?:\.text)?$|^library\.roots\[\d+\]\.meaning$/u.test(where)),
      ...readdirSync(join(BELAJAR, "content/quiz")).flatMap((f) => strings(readJson(`content/quiz/${f}`), f).filter(([where]) => where.endsWith(".text"))),
    ];
    expect(labels.length).toBeGreaterThan(500);
    let glossed = 0;
    for (const [where, s] of labels) {
      const n = meaningSpans(s).length;
      expect(n, where).toBeLessThanOrEqual(PAGE_SPANS);
      if (n) glossed++;
    }
    // "fa'il tersimpan: “kami”", "idhafah (“nama Allah”)", "abtadi’u (“aku memulai”)" …
    expect(glossed).toBeGreaterThan(150);
  });
});

describe("leadMeaning: a Kosakata page's core meaning", () => {
  const lead = (s: string) => leadMeaning(s).map((e) => s.slice(e.from, e.to));

  it("the meaning it opens with, up to its first colon or full stop outside brackets and quotes", () => {
    expect(lead("di dalam; pada. Ibnu Hisyam: fī adalah huruf jar … berarti “pada buhul-buhul”.")).toEqual(["di dalam; pada"]);
    expect(lead("nama: kata yang dipakai untuk mengenali sesuatu.")).toEqual(["nama"]);
    expect(lead("ada, terjadi; dan sebagai kata kerja penghubung, “adalah”. Ibnu Faris: …")).toEqual(["ada, terjadi; dan sebagai kata kerja penghubung, “adalah”"]);
    expect(lead("membisikkan (keburukan). Ar-Raghib: …")).toEqual(["membisikkan (keburukan)"]);
    // A citation's or a verse's bracket ends it before.
    expect(lead("menunjukkan jalan dan membimbing dengan lembut (ar-Raghib: hidāyah adalah petunjuk). Kata")).toEqual(["menunjukkan jalan dan membimbing dengan lembut"]);
    expect(lead("simpul, buhul; juga ikatan (2:235). Ibnu Faris")).toEqual(["simpul, buhul; juga ikatan"]);
    expect(lead("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga belas.")).toEqual([]);
  });

  it("every lexeme has one; the page emphasises it and the glosses quoted after it (leadSpans)", () => {
    expect(LIBRARY.lexicon.length).toBeGreaterThan(40);
    let after = 0;
    for (const l of LIBRARY.lexicon) {
      const spans = leadMeaning(l.meaning);
      expect(spans, l.id).toHaveLength(1);
      expect(spans[0].from, l.id).toBe(0);
      expect(l.meaning.slice(spans[0].to), l.id).toMatch(/^(?:$|[:.]| \()/u);
      // The text the page draws (its marked twin, with the Arabic of its terms and words): the
      // lead first, then every meaning of the text, none of them inside the lead.
      const marked = markedTokens(l.marked?.meaning, new Scope(), TERMS);
      const drawn = marked ? termDisplay(marked).text : l.meaning;
      const page = leadSpans(drawn);
      expect(page[0], l.id).toMatchObject({ from: 0, kind: "meaning" });
      expect(page.length, l.id).toBeLessThanOrEqual(PAGE_SPANS);
      const rest = page.slice(1);
      expect(rest, l.id).toEqual(meaningSpans(drawn).filter((e) => e.from >= page[0].to));
      for (const e of rest) expect(drawn.slice(e.from, e.to), l.id).toMatch(/^“[^“”]+”$/u);
      after += rest.length;
    }
    // Until L22 the lead alone was forest and these stood quoted and plain (review 2026-10-11:
    // "the page's one meaning"); a meaning is always emphasised now: "fī ṣudūri (114:5) “ke dalam
    // dada”", "gaḍiba “marah”".
    expect(after).toBeGreaterThan(45);
    const fi = LIBRARY.lexicon.find((l) => l.id === "fi")!;
    expect(leadSpans(fi.meaning).map((e) => fi.meaning.slice(e.from, e.to))).toEqual(expect.arrayContaining(["di dalam; pada", "“pada buhul-buhul”", "“ke dalam dada”"]));
  });
});

describe("glossSlot: a known slot of a message", () => {
  const span = (r: { text: string; emphasis: Emphasis[] }) => r.emphasis.map((e) => r.text.slice(e.from, e.to));

  it("finds the value with its quotes in any locale, wherever the message puts it", () => {
    expect(span(glossSlot((g) => `yang artinya “${g}”`, "dengan nama"))).toEqual(["“dengan nama”"]);
    expect(span(glossSlot((g) => `meaning “${g}”`, "in the name"))).toEqual(["“in the name”"]);
    // A gloss that is also a word of the message ("yang"): the slot, not the first match.
    expect(span(glossSlot((g) => `yang artinya “${g}”`, "yang"))).toEqual(["“yang”"]);
    // No quotes around it: the value alone (TapWord's "(translit — gloss)", a question card).
    expect(span(glossSlot((g) => `${g})`, "Tuhan"))).toEqual(["Tuhan"]);
    expect(span(glossSlot((g) => `ar-raḥmāni · ${g}`, "Yang Maha Pengasih"))).toEqual(["Yang Maha Pengasih"]);
    expect(glossSlot((g) => `yang artinya “${g}”`, "").emphasis).toEqual([]);
    // The value last in the message, an opening quote before it and none after: the value alone,
    // never past the end.
    expect(span(glossSlot((g) => `‘${g}`, "x"))).toEqual(["x"]);
    expect(glossSlot((g) => `'${g}`, "abc").emphasis).toEqual([{ from: 1, to: 4, kind: "meaning" }]);
  });
});

describe("alignEmphasis: the karaoke words take the display's emphasis", () => {
  const words = (s: string) => s.split(" ");

  it("matches words without their quotes, fills a reworded “+”, follows a reworded gloss", () => {
    expect(alignEmphasis("Kata pertama artinya: “dengan nama”. Kata ini terdiri dari dua bagian.", words("Kata pertama artinya: dengan nama. Kata ini terdiri dari dua bagian."))).toEqual([
      null, null, null, "meaning", "meaning", null, null, null, null, null, null,
    ]);
    expect(
      alignEmphasis("Perannya: huruf jar (حَرْف جَرّ) + majrur (مَجْرُور). Akhirnya", ["Perannya:", "huruf jar (حَرْف جَرّ)", "dan", "majrur (مَجْرُور).", "Akhirnya"]),
    ).toEqual([null, "term", "term", "term", null]);
    expect(
      alignEmphasis("seperti abtadi’u (أَبْتَدِئُ) yang artinya “aku memulai” (pendapat ulama Kufah), sehingga", [
        "seperti", "abtadi’u (أَبْتَدِئُ)", "yang", "artinya", "aku", "memulai,", "pendapat", "ulama", "Kufah,", "sehingga",
      ]),
    ).toEqual([null, null, null, null, "meaning", "meaning", null, null, null, null]);
    // A gloss with no cue word reaches its word as well (L22: plain until 2026-10-13).
    expect(alignEmphasis("yang tidak disebut (misalnya “tetap”).", ["yang", "tidak", "disebut,", "misalnya", "tetap."])).toEqual([null, null, null, null, "meaning"]);
    // Two meanings in one line: each reaches its own word, and nothing between them.
    expect(
      alignEmphasis("huruf ba’ (بِ) yang artinya “dengan”, dan huruf lam (لِ) yang artinya “bagi”;", [
        "huruf", "ba’ (بِ)", "yang", "artinya", "dengan,", "dan", "huruf", "lam (لِ)", "yang", "artinya", "bagi;",
      ]),
    ).toEqual([null, null, null, null, "meaning", null, null, null, null, null, "meaning"]);
    // An answer and its gloss: the term bold, the meaning forest.
    expect(
      alignEmphasis("yang artinya “dengan”. Jadi, kata ini majrur (مَجْرُور).", ["yang", "artinya", "dengan.", "Jadi,", "kata", "ini", "majrur (مَجْرُور)."]),
    ).toEqual([null, null, "meaning", null, null, null, "term"]);
    expect(alignEmphasis("Bunyinya a, i, dan u.", ["Bunyinya", "a,", "i,", "dan", "u."])).toEqual([null, "sound", "sound", null, "sound"]);
    expect(alignEmphasis("Tidak ada apa-apa di sini.", ["Tidak", "ada"])).toEqual([null, null]);
  });

  it("over every narrated line: each emphasis reaches its words, and no other word is emphasised", () => {
    let lines = 0;
    let spans = 0;
    for (const [slug, m] of MANIFESTS)
      for (const [id, l] of Object.entries(m.lines)) {
        if (!l.tokens?.length || !l.display) continue;
        lines++;
        const toks = l.tokens.map((k) => k.t.trim());
        const kinds = alignEmphasis(l.display, toks);
        expect(kinds, id).toHaveLength(toks.length);
        const display = captionSpans(l.display);
        spans += display.length;
        // The letters of every span's text, in order: an emphasised word's letters are all there.
        const keys = (s: string) => s.split(/\s+/u).map((w) => w.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
        for (const e of display) {
          const want = keys(l.display.slice(e.from, e.to));
          const got = toks.filter((_, i) => kinds[i] === e.kind).flatMap(keys);
          expect(want.some((k) => got.includes(k)), `${slug} ${id}: "${l.display.slice(e.from, e.to)}" reaches no word`).toBe(true);
        }
        toks.forEach((t, i) => {
          if (!kinds[i]) return;
          const inSpans = display.filter((e) => e.kind === kinds[i]).flatMap((e) => keys(l.display!.slice(e.from, e.to)));
          // Every letter of it in one of the spans of its kind — or the "dan" a "+" is said as.
          const ok = keys(t).every((k) => inSpans.includes(k)) || (t === "dan" && display.some((e) => l.display!.slice(e.from, e.to).includes(" + ")));
          expect(ok, `${slug} ${id}: "${t}" emphasised as ${kinds[i]}`).toBe(true);
        });
      }
    // Not vacuous; the numbers follow what is rendered (344 lines when every Al-Fatihah line had
    // its voice, 294 on 2026-10-13 with the reworded lessons waiting for their render; on
    // 2026-10-17, with the review's rewordings and every word line naming its word waiting, 135
    // spans).
    expect(lines).toBeGreaterThan(200);
    expect(spans).toBeGreaterThan(120);
  });
});
