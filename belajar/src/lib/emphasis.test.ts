import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { alignEmphasis, captionSpans, emphasisSpans, glossSlot, leadMeaning, PAGE_SPANS, partEmphasis, termEmphasis, type Emphasis, type EmphasisKind } from "./emphasis";
import { splitCaption } from "./lessonSteps";
import { getBasic, LIBRARY, partsFor, TERMS } from "./library";
import { WORD_INFO } from "./content";
import { annotate, prepareParts, Scope, soundsOf, termDisplay, titleParts, type Token } from "./terms";
import { hasArabic } from "./textUnits";

// Emphasis (operator, 2026-10-11: "we can also use bold text or different color to highlight the
// meanings or important things"; narration rule 18): which stretches a text emphasises, over the
// strings the module really shows — every Al-Fatihah caption, every quiz explanation, every Konsep
// text — and how the karaoke words take them.

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
  titleParts(mk.title, page, TERMS, SOUNDS);
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

/** What a meaning, a term and a sound must come right after (no false positive). */
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
    expect(shown("sehingga maknanya menjadi 'hanya kepada-Mu' (Darwisy)")).toEqual([]);
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
    const name = (id: string) => shown(concept(id)).find(([k]) => k === "term")?.[1];
    expect(name("dhamir-syan")).toBe("Dhamir (ضَمِير) sya'n");
    expect(name("khabar-jumlah")).toBe("Khabar (خَبَر) jumlah");
    expect(name("athaf-bayan")).toBe("‘Athaf (عَطْف) bayan");
    expect(name("murab-mabni")).toBe("Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)");
    expect(name("wazan-dan-tashrif")).toBe("Wazan (وَزْن) dan tashrif (تَصْرِيف)");
    expect(name("bab-ifal")).toBe("Bab if‘āl (إِفْعَال)");
    expect(name("fiil-majhul")).toBe("Fi'il majhul");
    expect(name("kana-wa-akhawatuha")).toBe("Kana dan saudaranya");
    expect(name("hal")).toBe("Hal");
    expect(name("maqul-al-qaul")).toBe("Maqul al-qaul");
    expect(name("rubai-mujarrad")).toBe("Ruba'i mujarrad");
    expect(name("sighat-mubalaghah")).toBe("Shighat mubalaghah");
    // A title that opens with a description, not the name: nothing ("Huruf yang menafikan …").
    expect(name("jazm-lam")).toBeUndefined();
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
    expect(shown("rafa' (رَفْع, katanya disebut marfu', مَرْفُوع), nashab")).toEqual([]);
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
      // Not after a trigger, or unquoted.
      "ini bergantung pada khabar (خَبَر) yang tidak disebut (misalnya “tetap”).",
      "Pelakunya tersirat, yaitu “engkau”.",
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

  it("never emphasises anything but what follows its trigger (every Al-Fatihah caption, quiz explanation, Konsep text)", () => {
    const KONSEP_DRAWN = KONSEP_TOKENS.map(([where, t]) => [where, termDisplay(t).text, termEmphasis(t)] as const);
    const sets = {
      FATIHAH: FATIHAH.map(([where, s]) => [where, s, captionSpans(s)] as const),
      QUIZ: QUIZ.map(([where, s]) => [where, s, emphasisSpans(s)] as const),
      KONSEP: KONSEP_DRAWN,
    };
    for (const [name, set] of Object.entries(sets)) {
      expect(set.length, name).toBeGreaterThan(30);
      let n = 0;
      const bad = set.flatMap(([where, s, spans]) =>
        spans.flatMap((e) => {
          n++;
          // A "Perannya:" answer runs on past its first word; a chained gloss follows another.
          const before = s.slice(Math.max(0, e.from - 60), e.from);
          return AFTER[e.kind].test(before) ? [] : [`${where}: ${e.kind} "${s.slice(e.from, e.to)}" after "…${before.slice(-30)}"`];
        }),
      );
      expect(bad, name).toEqual([]);
      expect(n, name).toBeGreaterThan(30);
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
      // A quiz explanation's glosses are its answer's reasons (the next test): not emphasised.
      const answered = /Perannya: |Jadi, kata ini /u.test(s);
      for (const m of answered ? [] : s.matchAll(/artinya:? (?=“)/gu)) {
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
    expect(meanings).toBeGreaterThan(300);
    expect(terms).toBeGreaterThan(60);
    expect(roles).toBeGreaterThan(60);
  });

  it("a quiz answer alone: its reasons' glosses and terms are not emphasised beside it", () => {
    // Review 2026-10-11: "Perannya: …" answers the question; three forest glosses after it made it
    // one bold thing among four.
    expect(
      shown("Perannya: huruf jar (حَرْف جَرّ) + majrur (مَجْرُور). Huruf lam (لِ) yang artinya “bagi”, adalah huruf jar (حَرْف جَرّ) dan akhiran, yang artinya “Dia”"),
    ).toEqual([["term", "huruf jar (حَرْف جَرّ) + majrur (مَجْرُور)"]]);
    let answered = 0;
    for (const [where, s] of QUIZ) {
      const spans = emphasisSpans(s);
      if (!/Perannya: |Jadi, kata ini /u.test(s) || !spans.length) continue;
      answered++;
      for (const e of spans) {
        expect(e.kind, where).toBe("term");
        expect(s.slice(0, e.from), where).toMatch(/(?:Perannya:|Jadi, kata ini) $/u);
      }
    }
    expect(answered).toBeGreaterThan(100);
  });
});

describe("captionSpans: a stage caption emphasises its first meaning", () => {
  it("keeps the first gloss (and the ones chained to it), every term and sound", () => {
    const s = "Kata ketiga artinya: “bagi-Nya”. Huruf lam (لَّ) yang artinya “bagi”, adalah huruf jar (حَرْف جَرّ) dan akhiran, yang artinya “Dia”; sehingga bermakna “setara bagi-Nya”.";
    expect(emphasisSpans(s)).toHaveLength(4);
    expect(captionSpans(s).map((e) => s.slice(e.from, e.to))).toEqual(["“bagi-Nya”"]);
    const chain = "Shighat mubalaghah ialah bentuk yang bermakna “sangat” atau “sering melakukan”, seperti naffas yang artinya “yang banyak meniup”;";
    expect(captionSpans(chain).map((e) => chain.slice(e.from, e.to))).toEqual(["“sangat”", "“sering melakukan”"]);
    const concept = CAPTIONS.find(([where]) => where.endsWith(":concept:isim-maushul"))![1];
    expect(captionSpans(concept).map((e) => [e.kind, concept.slice(e.from, e.to)])).toEqual([
      ["term", "Isim maushul (اِسْم مَوْصُول)"],
      ["meaning", "“yang”"],
      ["term", "shilah (صِلَة)"],
    ]);
  });

  it("over every caption: a subset of the text's emphasis, at most one meaning group, a quiz answer alone", () => {
    let fewer = 0;
    for (const [where, s] of CAPTIONS) {
      const all = emphasisSpans(s);
      const cap = captionSpans(s);
      for (const e of cap) expect(all, where).toContainEqual(e);
      const meanings = cap.filter((e) => e.kind === "meaning");
      const first = all.find((e) => e.kind === "meaning");
      if (meanings.length) expect(meanings[0], where).toEqual(first);
      // Glosses after the first only as its chain: “…” atau “…”.
      for (let i = 1; i < meanings.length; i++) expect(s.slice(meanings[i - 1].to, meanings[i].from), where).toMatch(/^(?:, | atau | dan )$/u);
      expect(cap.length, where).toBeLessThanOrEqual(4);
      if (cap.length < all.length) fewer++;
    }
    expect(fewer).toBeGreaterThan(30);
  });

  it("a caption part shows its slice of the whole line's emphasis", () => {
    const long = `Kata pertama artinya: “dengan nama”. ${"Kalimat penjelas yang cukup panjang untuk dipotong menjadi beberapa bagian. ".repeat(3)}Huruf lam (لِ) yang artinya “bagi”, dan bunyinya i.`;
    const parts = splitCaption(long);
    expect(parts.length).toBeGreaterThan(1);
    const per = parts.map((p, k) => partEmphasis(parts, k).map((e) => [e.kind, p.slice(e.from, e.to)]));
    expect(per[0]).toEqual([["meaning", "“dengan nama”"]]);
    // The last part's gloss is not its caption's first: shown alone it would be.
    expect(emphasisSpans(parts[parts.length - 1]).some((e) => e.kind === "meaning")).toBe(true);
    expect(per[per.length - 1]).toEqual([["sound", "i"]]);
    expect(partEmphasis(parts, parts.length)).toEqual([]);
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
    const most = Math.max(...KONSEP_TOKENS.map(([, t]) => termEmphasis(t).length));
    expect(most).toBeLessThanOrEqual(PAGE_SPANS);
    expect(most).toBeGreaterThan(4);
    // Materi lengkap and the quiz feedback: word cards' why, summaries, facts, composition notes.
    const read = CONTENT.filter(([where]) => /\.(?:why|summary|body|note)$/u.test(where));
    expect(read.length).toBeGreaterThan(300);
    for (const [where, s] of read) expect(emphasisSpans(s).length, where).toBeLessThanOrEqual(PAGE_SPANS);
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

  it("every lexeme has one, and it is the page's only emphasis", () => {
    expect(LIBRARY.lexicon.length).toBeGreaterThan(40);
    for (const l of LIBRARY.lexicon) {
      const spans = leadMeaning(l.meaning);
      expect(spans, l.id).toHaveLength(1);
      expect(spans[0].from, l.id).toBe(0);
      expect(l.meaning.slice(spans[0].to), l.id).toMatch(/^(?:$|[:.]| \()/u);
    }
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
    // A word said that the display does not have is never emphasised.
    expect(alignEmphasis("yang tidak disebut (misalnya “tetap”).", ["yang", "tidak", "disebut,", "misalnya", "tetap."])).toEqual([null, null, null, null, null]);
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
    expect(lines).toBeGreaterThan(300);
    expect(spans).toBeGreaterThan(200);
  });
});
