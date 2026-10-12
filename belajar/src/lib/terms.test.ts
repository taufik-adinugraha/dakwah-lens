import { describe, expect, it } from "vitest";

import { CASE_META, caseLabelMarked } from "./cases";
import { SURAHS, WORD_AR, WORD_INFO } from "./content";
import { LIBRARY, TERMS } from "./library";
import { quizFor } from "./quiz-content";
import {
  annotate,
  CITED,
  headwordOf,
  isGloss,
  lessonLookup,
  lessonProblems,
  letterOf,
  letters,
  libraryProblems,
  markedTokens,
  termDisplay,
  MARK_NAME,
  marksOf,
  noteWithoutWord,
  parseMarked,
  partsProblems,
  prepareParts,
  prepareSigns,
  Scope,
  soundsOf,
  stripMarked,
  titleParts,
  type Token,
} from "./terms";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const shown = (tokens: Token[]) =>
  tokens.flatMap((t) => (t.kind !== "text" && t.arabic ? [t.surface] : []));

/** Arabic stretches of `text` that are two or more term-table spellings joined by spaces, and not
 *  one term's own spelling: the glued form two adjacent grammar terms must never take. */
function gluedTerms(text: string, terms: readonly { ar: string | null }[] = LIBRARY.terms): string[] {
  const ars = new Set(terms.flatMap((t) => (t.ar ? [t.ar] : [])));
  const out: string[] = [];
  for (const m of text.matchAll(/[\u0621-\u0652\u0670\u0671]+(?: [\u0621-\u0652\u0670\u0671]+)*/gu)) {
    if (ars.has(m[0])) continue;
    const w = m[0].split(" ");
    const cut = (i: number, n: number): boolean =>
      i === w.length ? n >= 2 : w.slice(i).some((_, k) => ars.has(w.slice(i, i + k + 1).join(" ")) && cut(i + k + 1, n + 1));
    if (cut(0, 0)) out.push(m[0]);
  }
  return out;
}

describe("the marked Konsep library (operator 2026-10-10: terms and words in Arabic)", () => {
  it("passes every corpus-free check: plain = marked minus markup, refs resolve to content bytes", () => {
    expect(libraryProblems(LIBRARY, WORD_AR)).toEqual([]);
  });

  it("has every concept, the Harakat page and the parts diagrams, all marked", () => {
    expect(LIBRARY.concepts.every((c) => c.marked)).toBe(true);
    expect(LIBRARY.basics.map((b) => b.id)).toEqual(["harakat"]);
    expect(LIBRARY.parts.map((p) => p.loc)).toEqual(["1:1:1", "1:2:2", "1:7:4", "112:4:3", "113:1:3", "1:7:3"]);
  });

  it("shows grammar terms only in their verified spelling; unverified ones in Latin", () => {
    const majrur = TERMS.terms.get("majrur")!;
    // pronunciation.json (operator-approved) and the kitab both spell it so; the build checked it.
    expect(majrur.ar).toBe(LIBRARY.terms.find((t) => t.id === "majrur")!.ar);
    expect(majrur.ar).not.toBeNull();
    const unverified = LIBRARY.terms.filter((t) => t.ar === null).map((t) => t.id);
    expect(unverified).toEqual(expect.arrayContaining(["lam-doa", "wazan-yastafilu"]));
    for (const id of unverified) {
      const tokens = annotate(`[[x|${id}]]`, new Scope(), TERMS);
      expect(shown(tokens)).toEqual([]);
    }
  });
});

describe("planted faults are caught", () => {
  it("an example word whose Arabic does not match its loc", () => {
    const lib = clone(LIBRARY);
    lib.quran["1:1:1"] = lib.quran["1:1:2"]; // bismi now shows Allāhi's bytes
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/q:1:1:1 shows .* but the lesson word 1:1:1 is/);
  });

  it("a part that is not the word's QAC segment", () => {
    const lib = clone(LIBRARY);
    lib.quran["1:1:1/1"] = lib.quran["1:2:2/1"]; // bi- shown as li-
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/q:1:1:1\/1 is not segment 1/);
  });

  it("a letter that is not the ayah's letter", () => {
    const lib = clone(LIBRARY);
    lib.quran["1:1:1#1"] = lib.quran["1:1:1#2"];
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/q:1:1:1#1 is not letter 1/);
  });

  it("plain text that drifted from its marked text, or still carries markup", () => {
    const lib = clone(LIBRARY);
    lib.concepts[0].summary += " Tambahan.";
    lib.concepts[1].title = lib.concepts[1].marked!.title;
    const p = libraryProblems(lib, WORD_AR).join("\n");
    expect(p).toMatch(/kalimah-isim-fiil-huruf.summary: the plain text is not the marked text/);
    expect(p).toMatch(/tanda-irab.title: markup left in the plain text/);
  });

  it('"ketuk" and "yang berarti"', () => {
    const lib = clone(LIBRARY);
    lib.concepts[2].explanation[0] += " Ketuk kata itu.";
    lib.concepts[2].marked!.explanation[0] += " Ketuk kata itu.";
    lib.concepts[3].explanation[1] += " Kata itu yang berarti nama.";
    lib.concepts[3].marked!.explanation[1] += " Kata itu yang berarti nama.";
    const p = libraryProblems(lib, WORD_AR).join("\n");
    expect(p).toMatch(/huruf-jar.explanation\[0\]: says "ketuk"/);
    expect(p).toMatch(/idhafah.explanation\[1\]: says "yang berarti"/);
  });

  it("a term id the table does not have, and a retyped (Uthmani-marked) term spelling", () => {
    const lib = clone(LIBRARY);
    lib.concepts[0].marked!.notes[0] = lib.concepts[0].marked!.notes[0].replace("|huruf-jar]]", "|huruf-jarr]]");
    lib.terms.find((t) => t.id === "kasrah")!.ar = lib.quran["1:1:2"]; // Qur'anic bytes, not a typed term
    const p = libraryProblems(lib, WORD_AR).join("\n");
    expect(p).toMatch(/term huruf-jarr is not in library.json terms/);
    expect(p).toMatch(/term kasrah: .* is not typed Arabic/);
  });

  it("a parts diagram that does not spell its word", () => {
    const lib = clone(LIBRARY);
    lib.parts[0].drops = []; // the alif of ٱسْمُ would now be written inside بِسْمِ
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/parts 1:1:1: the tiles spell/);
  });

  it("a Harakat sign whose letter does not carry the mark it names", () => {
    const lib = clone(LIBRARY);
    lib.basics[0].signs[0].marks = ["kasrah"]; // نَ carries fathah
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/sign fathah: .* does not carry exactly kasrah/);
  });
});

describe("letters and marks, cut from the ayah's bytes", () => {
  it("cuts بِسْمِ into its letters with their marks", () => {
    const w = WORD_AR["1:1:1"];
    expect(letters(w)).toHaveLength(3);
    expect(letters(w).join("")).toBe(w);
    expect([...letterOf(w, 1)].map((c) => MARK_NAME[c]).filter(Boolean)).toEqual(["kasrah"]); // b + i
    expect([...letterOf(w, 2)].map((c) => MARK_NAME[c]).filter(Boolean)).toEqual(["sukun"]);
    expect(letterOf(w, -1)).toBe(letterOf(w, 3));
  });

  it("each Harakat sign shows exactly its named mark, cut from its letter", () => {
    for (const s of prepareSigns(LIBRARY.basics[0].signs, TERMS)) {
      expect(s.mark.length).toBeGreaterThan(0);
      expect(s.letter.includes(s.mark)).toBe(true);
      // cut from a lesson word, or from another ayah's word the library resolves (سَلَٰمٌ, QS 97:5)
      expect((WORD_AR[s.loc] ?? LIBRARY.quran[s.loc])?.includes(s.letter)).toBe(true);
      expect(s.word === null).toBe(s.loc in WORD_AR);
      expect(s.term?.group).toBe("harakah");
    }
    const kasrah = prepareSigns(LIBRARY.basics[0].signs, TERMS).find((s) => s.term?.id === "kasrah")!;
    expect(kasrah.letter).toBe(letterOf(WORD_AR["1:1:1"], 1)); // the operator's بِ = b + i
    expect(marksOf(kasrah.letter, ["kasrah"])).toBe(kasrah.mark);
  });

  it("the sounds of the Harakat page name a, i, u", () => {
    const s = soundsOf(LIBRARY.basics[0].signs);
    expect([s.fathah, s.kasrah, s.dhammah]).toEqual(["a", "i", "u"]);
  });
});

describe("words explained by their parts (rule 14)", () => {
  const sounds = soundsOf(LIBRARY.basics[0].signs);
  const prepared = (loc: string) =>
    prepareParts(LIBRARY.parts.find((x) => x.loc === loc)!, WORD_INFO[loc], new Scope(), TERMS, sounds);

  it("every diagram spells its word from its tiles' bytes", () => {
    for (const p of LIBRARY.parts) {
      const tiles = p.tiles.map((t) => LIBRARY.quran[t.q.slice(2)]);
      expect(partsProblems(tiles, { changes: p.changes, drops: p.drops }, WORD_AR[p.loc])).toEqual([]);
    }
  });

  it("بِ + ٱسْمُ → بِسْمِ: the END of ismu changes from dhammah to kasrah, the alif is not written", () => {
    const d = prepared("1:1:1");
    expect(d.changes).toHaveLength(1);
    const c = d.changes[0];
    expect([c.where, c.part, c.kind]).toEqual(["end", "ismu", "vowel"]);
    expect([c.fromTerm?.id, c.toTerm?.id, c.fromSound, c.toSound]).toEqual(["dhammah", "kasrah", "u", "i"]);
    expect(d.tiles[1].dropped).toEqual([1]);
  });

  it("عَلَىٰ + هُمْ → عَلَيْهِمْ: the alif of ‘alā becomes ya', and the FIRST letter of -hum changes (not the ending)", () => {
    const d = prepared("1:7:4");
    expect(d.changes.map((c) => [c.where, c.part, c.kind])).toEqual([
      ["end", "‘alā", "letter"],
      ["first", "-hum", "vowel"],
    ]);
    const [alif, ha] = d.changes;
    expect([alif.fromName, alif.toName, alif.toTerm?.id]).toEqual(["alif", "ya’", "sukun"]);
    expect([ha.fromTerm?.id, ha.toTerm?.id]).toEqual(["dhammah", "kasrah"]);
    // the base of the attached -him is an ATTACHED pronoun (رَزَقْنَٰهُمْ's هُمْ), not the free هُمْ
    expect(LIBRARY.parts.find((x) => x.loc === "1:7:4")!.tiles[1].q).toMatch(/^q:\d+:\d+:\d+\/\d$/);
  });

  it("لِ + ٱللَّهُ → لِلَّهِ: the alif and the lam of al- are not written; لِ + هُۥ → لَّهُۥ: li- reads la-", () => {
    expect(prepared("1:2:2").tiles[1].dropped).toEqual([1, 2]);
    const la = prepared("112:4:3").changes[0];
    expect([la.where, la.fromTerm?.id, la.toTerm?.id]).toEqual(["only", "kasrah", "fathah"]);
  });

  it("refuses a change that keeps the vowel, another letter, and a dropped letter that is not an alif or al-'s lam", () => {
    const p = LIBRARY.parts.find((x) => x.loc === "1:1:1")!;
    const tiles = p.tiles.map((t) => LIBRARY.quran[t.q.slice(2)]);
    expect(partsProblems(tiles, { changes: [{ tile: 2, letter: -1, to: 3 }], drops: [{ tile: 2, letter: 2 }] }, WORD_AR["1:1:1"]).join("\n")).toMatch(/not an alif/);
    expect(partsProblems([WORD_AR["1:1:1"], ""], { changes: [{ tile: 1, letter: 1, to: 1 }], drops: [] }, WORD_AR["1:1:1"]).join("\n")).toMatch(/does not change the vowel/);
    expect(partsProblems([WORD_AR["1:1:1"]], { changes: [{ tile: 1, letter: 1, to: 2 }], drops: [] }, WORD_AR["1:1:1"]).join("\n")).toMatch(/not the same letter/);
  });
});

describe("display: Arabic at the first use in a scope", () => {
  // Operator review 2026-10-12: "rafa' (رَفْع, mahall, مَحَلّ raf')" wedged an Arabic gloss into
  // the phrase "mahall raf'". Inside brackets, a term that more of the phrase follows stays Latin.
  it("keeps a term Latin inside a bracketed phrase that goes on after it, and shows it at its next use", () => {
    const show = (t: string) => termDisplay(annotate(t, new Scope(false), TERMS)).text;
    const rafa = TERMS.terms.get("rafa")!.ar;
    const mahall = TERMS.terms.get("mahall")!.ar;
    expect(show("kedudukan [[rafa'|rafa]] ([[mahall|mahall]] raf') di kartu ini")).toBe(`kedudukan rafa' (${rafa}, mahall raf') di kartu ini`);
    // two marked terms in one phrase are NOT a run (grammar terms never form one, review
    // 2026-10-12): the first stays Latin because the phrase goes on after it (continuesPhrase),
    // the second has its own Arabic, right after it — never "(mahall nashb مَحَلّ نَصْب)"
    const nashab = TERMS.terms.get("nashab")!.ar;
    expect(show("([[mahall|mahall]] [[nashb|nashab]])")).toBe(`(mahall nashb ${nashab})`);
    expect(show("([[mahall|mahall]] [[nashb|nashab]])")).not.toContain(`${mahall} ${nashab}`);
    // the first is not counted as shown (its next use has the Arabic); the second is
    expect(show("([[mahall|mahall]] [[nashb|nashab]]). [[Mahall|mahall]] dan [[nashab|nashab]] itu")).toBe(
      `(mahall nashb ${nashab}). Mahall (${mahall}) dan nashab itu`,
    );
    // where the second was already shown, the whole bracket stays Latin: "kedudukan nashab (نَصْب,
    // mahall nashb)", the Al-Fatihah card's form
    expect(show("kedudukan [[nashab|nashab]] ([[mahall|mahall]] [[nashb|nashab]]) di kartu ini")).toBe(
      `kedudukan nashab (${nashab}, mahall nashb) di kartu ini`,
    );
    // not counted as shown: its next use outside the phrase has the Arabic
    expect(show("([[mahall|mahall]] raf'). [[Mahall|mahall]] adalah kedudukan")).toBe(`(mahall raf'). Mahall (${mahall}) adalah kedudukan`);
    // the end of the bracket, a comma or a list is not a phrase going on: the Arabic stays, right
    // after its item (one space, 2026-10-12: the commas of a bracket separate its items)
    expect(show("(dalam keadaan [[mahall|mahall]])")).toBe(`(dalam keadaan mahall ${mahall})`);
    expect(show("([[mahall|mahall]] dan [[rafa'|rafa]])")).toBe(`(mahall ${mahall} dan rafa' ${rafa})`);
    // a run that unmarked words go on after stays Latin too, and none of it counts as shown
    expect(show("([[mahall|mahall]] [[nashb|nashab]] sebagai objek). [[Mahall|mahall]] itu")).toBe(`(mahall nashb sebagai objek). Mahall (${mahall}) itu`);
    // a term next to a Qur'anic word inside a bracket is no run: the phrase goes on, it stays Latin
    expect(show("([[huruf jar|huruf-jar]] [[bi-|q:1:1:1/1]])")).toBe(`(huruf jar bi- ${LIBRARY.quran["1:1:1/1"]})`);
  });

  // Operator 2026-10-12, "tidy them up" (R1): "(dhammah, ضَمَّة, fathah, فَتْحَة, kasrah, كَسْرَة)" read
  // as six items. Inside the prose's own bracket an item's Arabic follows it after ONE SPACE.
  it("inside the prose's brackets, puts an item's Arabic right after it: the commas separate items", () => {
    const show = (t: string, scope = new Scope(false)) => termDisplay(annotate(t, scope, TERMS)).text;
    const ar = (id: string) => TERMS.terms.get(id)!.ar!;
    expect(show("([[dhammah|dhammah]], [[fathah|fathah]], [[kasrah|kasrah]])")).toBe(`(dhammah ${ar("dhammah")}, fathah ${ar("fathah")}, kasrah ${ar("kasrah")})`);
    expect(show("kata keduanya ([[mudhaf ilaih|mudhaf-ilaih]]) selalu")).toBe(`kata keduanya (mudhaf ilaih ${ar("mudhaf-ilaih")}) selalu`);
    // The MERGED head keeps its comma: its Arabic glosses the word BEFORE the bracket.
    expect(show("[[wa|q:1:7:8/1]] ([['athaf|athaf]], penyambungan)")).toBe(
      `wa (${LIBRARY.quran["1:7:8/1"]}, 'athaf ${ar("athaf")}, penyambungan)`,
    );
    expect(show("[[fa'il|fail]] ([[-ta|q:1:7:3/2]])")).toBe(`fa'il (${ar("fail")}, -ta ${LIBRARY.quran["1:7:3/2"]})`);
    // A harakah reminder still follows its comma; the punctuation after the item follows the Arabic.
    expect(show("(berakhir [[kasrah|kasrah]]; lalu [[kasrah|kasrah]])", new Scope())).toBe(
      `(berakhir kasrah ${ar("kasrah")}, ${TERMS.terms.get("kasrah")!.hint}; lalu kasrah)`,
    );
    // A quoted gloss of Qur'anic words inside a bracket: the same form.
    expect(show("(seperti [[“nama Allah”|q:1:1:1-2]])")).toBe(`(seperti “nama Allah” ${LIBRARY.quran["1:1:1-2"]})`);
    // Never the old comma form.
    for (const c of LIBRARY.concepts) {
      const sc = new Scope();
      for (const f of [c.marked!.summary, ...c.marked!.explanation, ...c.marked!.notes])
        expect(show(f, sc), c.id).not.toMatch(/\p{Script=Latin}[’']?, [\u0621-\u064A][^()]*\)/u);
    }
  });

  // R2: "yaum (يَوْمِ) ad-dīn (ٱلدِّينِ)" glossed a phrase word by word. A run — Qur'anic words that
  // follow one another in one ayah (or the last part of a word, then the next word), a single space
  // apart — gets ONE bracket after the whole phrase, the mushaf's own text. Grammar terms never
  // form one (review 2026-10-12).
  describe("a phrase of Qur'anic words (a run) gets one bracket after the whole phrase; terms never form one", () => {
    const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;
    const lookup = lessonLookup(TERMS, fatihah);
    const show = (t: string, scope = new Scope(false), l = lookup) => termDisplay(annotate(t, scope, l)).text;
    const ar = (id: string) => TERMS.terms.get(id)!.ar!;
    const q = (ref: string) => LIBRARY.quran[ref] ?? fatihah.quran[ref];

    // Grammar terms never form a run (review 2026-10-12: a first version glued "isimnya
    // dirafa'kan (اِسْم رَفْع)", "Fi'il amr mabni (فِعْل أَمْر مَبْنِيّ)": two terms side by side are
    // seldom one Arabic phrase). Each keeps its own Arabic; a gloss or a citation after the last
    // joins the last one's bracket, as it joins any item's.
    it("terms: never a run — each term its own Arabic, the prose's gloss or citation joined to the last", () => {
      expect(show("[[dhamir|dhamir]] [[munfashil|munfashil]] boleh")).toBe(`dhamir (${ar("dhamir")}) munfashil (${ar("munfashil")}) boleh`);
      expect(show("[[jumlah|jumlah]] [[ibtida'iyyah|ibtidaiyyah]] (kalimat pembuka)")).toBe(
        `jumlah (${ar("jumlah")}) ibtida'iyyah (${ar("ibtidaiyyah")}, kalimat pembuka)`,
      );
      expect(show("[[huruf|huruf]] [[mabni|mabni]] (Ibnu 'Aqil).")).toBe(`huruf (${ar("huruf")}) mabni (${ar("mabni")}; Ibnu 'Aqil).`);
      expect(show("[[isim fa'il|isim-fail]] [[berwazan|wazan]] [[fā‘ilun|wazan-failun]], dari")).toBe(
        `isim fa'il (${ar("isim-fail")}) berwazan (${ar("wazan")}) fā‘ilun (${ar("wazan-failun")}), dari`,
      );
      // no token of adjacent terms carries a run, and no bracket holds two terms' Arabic
      const tokens = annotate("[[isim fa'il|isim-fail]] [[berwazan|wazan]] [[fā‘ilun|wazan-failun]]", new Scope(false), TERMS);
      expect(tokens.filter((t) => t.kind !== "text").map((t) => [t.kind, t.arabic, t.run])).toEqual([
        ["term", true, undefined],
        ["term", true, undefined],
        ["term", true, undefined],
      ]);
      // a term next to a Qur'anic word that a Qur'anic word follows: only the two words are a run
      expect(show("[[huruf jar|huruf-jar]] [[lam|q:112:3:3/2]] [[yūlad|q:112:3:4]] itu", new Scope(false), TERMS)).toBe(
        `huruf jar (${ar("huruf-jar")}) lam yūlad (${q("112:3:3/2")} ${q("112:3:4")}) itu`,
      );
    });

    // The four phrases the first version glued (review 2026-10-12), rendered from their own
    // marked sources in the library — found by their Latin, not typed here — on their Konsep
    // page (in reading order, so the page's earlier first uses count) and each on its own: none
    // of them is ever drawn with one bracket for two terms.
    it("never glues the four term phrases the review rejected, on their page or alone", () => {
      const rejected = ["isimnya dirafa'kan", "Fi'il amr mabni", "menafikan mudhari'", "ta' ta'nits sukun"];
      for (const phrase of rejected) {
        const hits = LIBRARY.concepts.flatMap((c) =>
          c.explanation.flatMap((p, i) => (p.includes(phrase) ? [{ c, i, marked: c.marked!.explanation[i] }] : [])),
        );
        expect(hits.length, phrase).toBe(1);
        const { c, i, marked } = hits[0];
        // the two marked terms of the phrase, as the source marks them
        const spans = parseMarked(marked).filter((x): x is Extract<typeof x, { kind: "mark" }> => x.kind === "mark");
        const at = spans.findIndex((x, k) => `${x.surface} ${spans[k + 1]?.surface}` === phrase);
        expect(at, phrase).toBeGreaterThanOrEqual(0);
        const [a, b] = [spans[at], spans[at + 1]];
        expect(marked, phrase).toContain(`[[${a.surface}|${a.ref}]] [[${b.surface}|${b.ref}]]`);
        const arA = TERMS.terms.get(a.ref)!.ar!;
        const arB = TERMS.terms.get(b.ref)!.ar!;
        const glued = `${a.surface} ${b.surface} (${arA} ${arB}`;
        // on its page: title, summary, the paragraphs before it, then it
        const page = new Scope(true);
        titleParts(c.marked!.title, page, TERMS);
        annotate(c.marked!.summary, page, TERMS);
        c.marked!.explanation.slice(0, i).forEach((p) => annotate(p, page, TERMS));
        const onPage = termDisplay(annotate(marked, page, TERMS)).text;
        expect(onPage, phrase).toContain(`${a.surface} `);
        expect(onPage, phrase).not.toContain(glued);
        expect(onPage, phrase).not.toContain(`${arA} ${arB}`);
        // on its own, every term due: each its own Arabic, right after it
        for (const scope of [new Scope(true), new Scope(false)]) {
          const alone = termDisplay(annotate(marked, scope, TERMS)).text;
          expect(alone, phrase).not.toContain(glued);
          expect(alone, phrase).toContain(`${a.surface} (${arA}) ${b.surface} (${arB}`);
        }
      }
    });

    // The same over every marked text of the content, each on its own (every term due) with and
    // without reminders, and over every quiz string: no Arabic stretch shown is two or more term spellings joined by
    // a space (the old glued form, "(فِعْل مُضَارِع مَجْزُوم)", "(mahall nashb مَحَلّ نَصْب)"), unless
    // the stretch is itself one term's spelling (حَرْف جَرّ).
    it("draws no bracket that glues two terms' Arabic, anywhere in the content or the quiz", () => {
      const texts: [string, string, typeof TERMS][] = [];
      const walk = (v: unknown, inMarked: boolean, where: string, l: typeof TERMS): void => {
        if (typeof v === "string") {
          if (inMarked) texts.push([where, v, l]);
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, inMarked, `${where}[${i}]`, l));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, inMarked || k === "marked", `${where}.${k}`, l);
      };
      walk([LIBRARY.concepts, LIBRARY.basics, LIBRARY.lexicon, LIBRARY.roots], false, "library", TERMS);
      for (const p of LIBRARY.parts) for (const x of [...p.steps, ...p.tiles.map((t) => t.label)]) texts.push([`parts ${p.loc}`, x, TERMS]);
      for (const su of SURAHS) walk([su.ayat, su.facts], false, su.slug, lessonLookup(TERMS, su));
      expect(texts.length).toBeGreaterThan(900);
      const bad = texts.flatMap(([where, text, l]) =>
        [new Scope(false), new Scope(true)].flatMap((sc) => gluedTerms(termDisplay(annotate(text, sc, l)).text).map((g) => `${where}: ${g}`)),
      );
      expect(bad).toEqual([]);
      // and every string of every lesson's quiz (pipeline/quiz.py, the twin renderer)
      const quiz: string[] = [];
      const collect = (o: unknown): void => {
        if (typeof o === "string") quiz.push(o);
        else if (Array.isArray(o)) o.forEach(collect);
        else if (o && typeof o === "object") Object.values(o).forEach(collect);
      };
      for (const su of SURAHS) collect(quizFor(su.slug));
      expect(quiz.length).toBeGreaterThan(1000);
      expect(quiz.flatMap((x) => gluedTerms(x).map((g) => `${g} :: ${x}`))).toEqual([]);
      // the check sees the glued form
      expect(gluedTerms(`fi'il mudhari' majzum (${ar("fiil-mudhari")} ${ar("majzum")})`)).toEqual([`${ar("fiil-mudhari")} ${ar("majzum")}`]);
      expect(gluedTerms(`huruf jar (${ar("huruf-jar")})`)).toEqual([]);
    });

    it("Qur'anic words that follow one another in the ayah, a part included", () => {
      expect(show("[[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]], yang")).toBe(`yaum ad-dīn (${q("1:4:2")} ${q("1:4:3")}), yang`);
      expect(`${q("1:4:2")} ${q("1:4:3")}`).toBe(`${WORD_AR["1:4:2"]} ${WORD_AR["1:4:3"]}`); // the ayah's own words, in order
      // the last part of a word, then the next word: "lam yūlad" (wa-lam is 112:3:3)
      expect(show("[[lam|q:112:3:3/2]] [[yūlad|q:112:3:4]] dengan", new Scope(false), TERMS)).toBe(`lam yūlad (${q("112:3:3/2")} ${q("112:3:4")}) dengan`);
      expect(LIBRARY.segments["112:3:3"]).toHaveLength(2);
      // the prose's gloss joins it
      expect(show("[[malik|q:114:2:1]] [[an-nās|q:114:2:2]] (“Raja manusia”), dan", new Scope(false), TERMS)).toBe(
        `malik an-nās (${q("114:2:1")} ${q("114:2:2")}, “Raja manusia”), dan`,
      );
      // a run and a longer run of words after it
      expect(show("[[lam|q:112:4:1/2]] [[yakun lahū kufuwan aḥad|q:112:4:2-5]] (112:4), dari", new Scope(false), TERMS)).toBe(
        `lam yakun lahū kufuwan aḥad (${q("112:4:1/2")} ${q("112:4:2-5")}, 112:4), dari`,
      );
    });

    it("never joins Qur'anic words that are not next to each other in the ayah (the Arabic shown is the mushaf's own text)", () => {
      // 33:37 reads an‘ama Allāhu ‘alaihi: words 4 and 6
      expect(show("[[an‘ama|q:33:37:4]] [[‘alaihi|q:33:37:6]], 'memberi nikmat'")).toBe(`an‘ama (${q("33:37:4")}) ‘alaihi (${q("33:37:6")}), 'memberi nikmat'`);
      // another ayah; the FIRST part of a word (bi- of bismi) before the next word; a letter
      expect(show("[[bismi|q:1:1:1]] [[al-ḥamdu|q:1:2:1]]", new Scope(false), TERMS)).toBe(`bismi (${q("1:1:1")}) al-ḥamdu (${q("1:2:1")})`);
      expect(show("[[bi-|q:1:1:1/1]] [[Allāhi|q:1:1:2]]", new Scope(false), TERMS)).toBe(`bi- (${q("1:1:1/1")}) Allāhi (${q("1:1:2")})`);
      expect(show("[[ba'|q:1:1:1#1]] [[sin|q:1:1:1#2]]", new Scope(false), TERMS)).toBe(`ba' (${q("1:1:1#1")}) sin (${q("1:1:1#2")})`);
      // a part whose word has no segments in the lookup cannot be known to be its last: no run
      const bare = { terms: TERMS.terms, quran: TERMS.quran };
      expect(show("[[lam|q:112:3:3/2]] [[yūlad|q:112:3:4]]", new Scope(false), bare)).toBe(`lam (${q("112:3:3/2")}) yūlad (${q("112:3:4")})`);
    });

    it("a run never crosses punctuation, a list word, a double space, a term, an unknown ref, a quoted gloss", () => {
      expect(show("[[yaum|q:1:4:2]], [[ad-dīn|q:1:4:3]]")).toBe(`yaum (${q("1:4:2")}), ad-dīn (${q("1:4:3")})`);
      expect(show("[[yaum|q:1:4:2]] dan [[ad-dīn|q:1:4:3]]")).toBe(`yaum (${q("1:4:2")}) dan ad-dīn (${q("1:4:3")})`);
      expect(show("[[yaum|q:1:4:2]]  [[ad-dīn|q:1:4:3]]")).toBe(`yaum (${q("1:4:2")})  ad-dīn (${q("1:4:3")})`); // two spaces
      // a term next to a Qur'anic item is not a run
      expect(show("[[huruf jar|huruf-jar]] [[bi-|q:1:1:1/1]] (dengan)")).toBe(`huruf jar (${ar("huruf-jar")}) bi- (${q("1:1:1/1")}, dengan)`);
      expect(show("[[yaum|q:1:4:2]] [[mudhaf|mudhaf]]")).toBe(`yaum (${q("1:4:2")}) mudhaf (${ar("mudhaf")})`);
      // a term the table has no Arabic for stays Latin between two that have it
      expect(TERMS.terms.get("wazan-yufalilu")!.ar).toBeNull();
      expect(show("[[berwazan|wazan]] [[yufa‘lilu|wazan-yufalilu]] [[mabni|mabni]].")).toBe(`berwazan (${ar("wazan")}) yufa‘lilu mabni (${ar("mabni")}).`);
      // a quoted gloss is an example, not a word of the phrase
      expect(show("[[bismi|q:1:1:1]] [[“nama Allah”|q:1:1:1-2]]", new Scope(false), TERMS)).toBe(`bismi (${q("1:1:1")}) “nama Allah” (${q("1:1:1-2")})`);
      // an unknown ref is plain text: it ends a run as any word does
      expect(show("[[yaum|q:1:4:2]] [[x|q:1:4:9]] [[ad-dīn|q:1:4:3]]")).toBe(`yaum (${q("1:4:2")}) x ad-dīn (${q("1:4:3")})`);
    });

    it("shows the whole run when any of its words is due, counts every word as shown, and stays Latin when all were", () => {
      const sc = new Scope(false);
      expect(show("[[yaum|q:1:4:2]] itu", sc)).toBe(`yaum (${q("1:4:2")}) itu`);
      // yaum was shown, ad-dīn was not: the phrase's Arabic, whole — never "yaum ad-dīn (ٱلدِّينِ)"
      expect(show("[[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]] itu", sc)).toBe(`yaum ad-dīn (${q("1:4:2")} ${q("1:4:3")}) itu`);
      expect(show("[[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]] lagi, lalu [[ad-dīn|q:1:4:3]]", sc)).toBe("yaum ad-dīn lagi, lalu ad-dīn");
      // three words: the bracket after the last, the mushaf's three words in order
      const tokens = annotate("[[māliki|q:1:4:1]] [[yaumi|q:1:4:2]] [[ad-dīni|q:1:4:3]]", new Scope(false), lookup);
      expect(tokens.map((t) => (t.kind === "text" ? t.text : [t.kind, t.surface, t.arabic, t.run?.end]))).toEqual([
        ["quran", "māliki", false, false],
        " ",
        ["quran", "yaumi", false, false],
        " ",
        ["quran", "ad-dīni", true, true],
      ]);
      const end = tokens[tokens.length - 1];
      expect(end.kind !== "text" && end.run?.ar).toBe(["1:4:1", "1:4:2", "1:4:3"].map((l) => WORD_AR[l]).join(" "));
      // inside the prose's bracket: the run's Arabic right after it, one space; a run that more
      // words follow there stays Latin, and none of it counts as shown
      expect(show("(seperti [[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]])")).toBe(`(seperti yaum ad-dīn ${q("1:4:2")} ${q("1:4:3")})`);
      const inner = new Scope(false);
      expect(show("([[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]] adalah hari kiamat)", inner)).toBe("(yaum ad-dīn adalah hari kiamat)");
      expect(inner.shown.size).toBe(0);
      // inside a cross-reference nothing is shown, and nothing counts as shown
      const x = new Scope(false);
      expect(show("(lihat: [[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]])", x)).toBe("(lihat: yaum ad-dīn)");
      expect(x.shown.size).toBe(0);
      // the same for two TERMS: no run, so only the one not yet shown has its Arabic, after itself
      const t = new Scope(false);
      expect(show("[[dhamir|dhamir]] itu", t)).toBe(`dhamir (${ar("dhamir")}) itu`);
      expect(show("[[dhamir|dhamir]] [[munfashil|munfashil]] itu", t)).toBe(`dhamir munfashil (${ar("munfashil")}) itu`);
    });

    it("a harakah term keeps its reminder and link at its first use, and like every term never joins a run", () => {
      const hint = (id: string) => TERMS.terms.get(id)!.hint;
      const sc = new Scope();
      // first use on a page that shows reminders: each word with its own reminder and link
      const first = termDisplay(annotate("[[dhammah|dhammah]] [[bertanwin|tanwin]], tanda rafa'", sc, TERMS));
      expect(first.text).toBe(`dhammah (${ar("dhammah")}, ${hint("dhammah")}) bertanwin (${ar("tanwin")}, ${hint("tanwin")}), tanda rafa'`);
      expect(first.marks.filter((m) => m.kind === "link").map((m) => first.text.slice(m.from, m.to))).toEqual(["dhammah", "bertanwin"]);
      // the reminder is not swallowed by a term before it either: "tanda jazm-nya sukun (…)"
      expect(termDisplay(annotate("tanda [[jazm-nya|jazm]] [[sukun|sukun]].", new Scope(), TERMS)).text).toBe(
        `tanda jazm-nya (${ar("jazm")}) sukun (${ar("sukun")}, ${hint("sukun")}).`,
      );
      // once shown, plain
      expect(termDisplay(annotate("[[dhammah|dhammah]] [[bertanwin|tanwin]] lagi", sc, TERMS)).text).toBe("dhammah bertanwin lagi");
      // after its reminder: the next term keeps its own Arabic, never "fathah mabni (فَتْحَة مَبْنِيّ)"
      const later = new Scope();
      annotate("[[fathah|fathah]]", later, TERMS);
      const pair = termDisplay(annotate("[[fathah|fathah]] [[mabni|mabni]]", later, TERMS));
      expect(pair.text).toBe(`fathah mabni (${ar("mabni")})`);
      expect(pair.marks.map((m) => [m.kind, pair.text.slice(m.from, m.to)])).toEqual([["term", ar("mabni")]]);
      // where no reminders are shown (a word card, the Harakat page, the quiz): each its own Arabic
      const card = termDisplay(annotate("[[dhammah|dhammah]] [[bertanwin|tanwin]], tanda rafa'", new Scope(false), TERMS));
      expect(card.text).toBe(`dhammah (${ar("dhammah")}) bertanwin (${ar("tanwin")}), tanda rafa'`);
      expect(card.marks.map((m) => m.kind)).toEqual(["term", "term"]);
      // inside a bracket: the first word of the phrase stays Latin, the second has its reminder
      expect(termDisplay(annotate("([[dhammah|dhammah]] [[bertanwin|tanwin]])", new Scope(), TERMS)).text).toBe(
        `(dhammah bertanwin ${ar("tanwin")}, ${hint("tanwin")})`,
      );
    });

    it("leaves a title's terms to its headword, one entry each; its Qur'anic words form a run inline", () => {
      const t = titleParts("[[Fi'il|fiil]] [[majhul|majhul]] (kata kerja pasif)", new Scope(), TERMS);
      expect(termDisplay(t.tokens).text).toBe("Fi'il majhul (kata kerja pasif)");
      expect(t.head).toEqual([{ ar: ar("fiil") }, { ar: ar("majhul") }]);
      const r = titleParts("[[Ar-raḥmān|q:1:1:3]] [[ar-raḥīm|q:1:1:4]] berdampingan", new Scope(), TERMS);
      expect(termDisplay(r.tokens).text).toBe(`Ar-raḥmān ar-raḥīm (${q("1:1:3")} ${q("1:1:4")}) berdampingan`);
    });
  });

  // R4 and R5 (operator 2026-10-12): a bracket of surah/ayah numbers and a capitalised Indonesian
  // gloss join the Arabic's bracket; an author's or kitab's name is a citation, as before.
  describe("what the bracket after an item is: a gloss, a place, a citation", () => {
    const show = (t: string) => termDisplay(annotate(t, new Scope(false), TERMS)).text;
    const quran = (ref: string) => LIBRARY.quran[ref];

    it("joins a bracket that opens on a number (R4)", () => {
      expect(show("[[qul a‘ūżu|q:113:1:1-2]] (113 dan 114)")).toBe(`qul a‘ūżu (${quran("113:1:1-2")}, 113 dan 114)`);
      expect(show("[[yakun|q:112:4:2]] (112:4), lalu")).toBe(`yakun (${quran("112:4:2")}, 112:4), lalu`);
    });

    it("takes a capitalised gloss for a gloss, a cited name for a citation (R5)", () => {
      const mabni = TERMS.terms.get("mabni")!.ar;
      expect(show("[[mabni|mabni]] (Yang dimohon pertolongan-Nya)")).toBe(`mabni (${mabni}, Yang dimohon pertolongan-Nya)`);
      expect(show("[[mabni|mabni]] (Tuhan, Pemelihara)")).toBe(`mabni (${mabni}, Tuhan, Pemelihara)`);
      for (const cite of ["Darwisy", "Darwisy; al-Jadwal", "Ibnu 'Aqil", "Ibnu Ajurrum; Darwisy", "Abu Hayyan", "Ahmad Zaini Dahlan", "Mughni", "al-Jadwal", "as-Samin: manshub", "an-Nahhas", "ad-Da'as", "lihat: mu'rab"])
        expect(show(`[[mabni|mabni]] (${cite})`), cite).toBe(`mabni (${mabni}; ${cite})`);
      // a cited name is a whole word: "Ibnul …" or "Abunya" is not on the list
      expect(show("[[mabni|mabni]] (Abunya)")).toBe(`mabni (${mabni}, Abunya)`);
    });

    // Every bracket that opens with a capital right after a marked item, anywhere in the content:
    // each is a citation or a gloss, pinned — a new author's name is added to CITED knowingly.
    it("classifies every capitalised bracket of the content", () => {
      const glosses = new Set<string>();
      const cites = new Set<string>();
      const texts: string[] = [];
      const walk = (v: unknown, inMarked: boolean): void => {
        if (typeof v === "string") {
          if (inMarked) texts.push(v);
        } else if (Array.isArray(v)) v.forEach((x) => walk(x, inMarked));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, inMarked || k === "marked");
      };
      walk([LIBRARY.concepts, LIBRARY.basics, LIBRARY.lexicon, LIBRARY.roots, SURAHS.map((s) => [s.ayat, s.facts])], false);
      for (const p of LIBRARY.parts) texts.push(...p.steps, ...p.tiles.map((t) => t.label));
      expect(texts.length).toBeGreaterThan(900);
      for (const text of texts)
        for (const m of text.matchAll(/\]\] \((\p{Lu}[^()[\]]*)/gu)) {
          const first = m[1].split(/[\s;:,)]/u)[0];
          const merged = termDisplay(annotate(`[[mabni|mabni]] (${m[1]})`, new Scope(false), TERMS)).text;
          (merged.includes("; ") && merged.startsWith(`mabni (${TERMS.terms.get("mabni")!.ar}; `) ? cites : glosses).add(first);
        }
      expect([...cites].sort()).toEqual(["Darwisy", "Ibnu"]);
      expect([...glosses].sort()).toEqual(["Tuhan", "Yang"]);
      expect(CITED).toEqual(expect.arrayContaining([...cites]));
    });
  });

  it("shows a term's Arabic once per scope, and keeps the punctuation with it", () => {
    const sc = new Scope();
    const a = annotate("Ia [[majrur|majrur]], lalu tetap [[majrur|majrur]].", sc, TERMS);
    expect(shown(a)).toEqual(["majrur"]);
    const first = a.find((t) => t.kind === "term")!;
    expect(first.kind === "term" && first.after).toBe(",");
    expect(stripMarked("Ia [[majrur|majrur]],")).toBe("Ia majrur,");
    // a new card, a new scope
    expect(shown(annotate("[[majrur|majrur]]", new Scope(), TERMS))).toEqual(["majrur"]);
  });

  it("gives a harakah term its reminder and link at its first use, even after the headword", () => {
    const sc = new Scope();
    const title = titleParts("Tanda [[kasrah|kasrah]]", sc, TERMS);
    expect(title.head).toEqual([{ ar: TERMS.terms.get("kasrah")!.ar, mark: "\u0650" }]);
    const body = annotate("berakhir [[kasrah|kasrah]], lalu [[kasrah|kasrah]] lagi", sc, TERMS);
    const terms = body.filter((t) => t.kind === "term");
    expect(terms.map((t) => t.kind === "term" && t.hint)).toEqual([true, false]);
    expect(terms.map((t) => t.kind === "term" && t.arabic)).toEqual([true, false]);
    // the Harakat page itself: no reminders
    const own = annotate("[[kasrah|kasrah]]", new Scope(false), TERMS);
    expect(own.find((t) => t.kind === "term")!.kind === "term" && (own.find((t) => t.kind === "term") as { hint: boolean }).hint).toBe(false);
  });

  it("shows a Qur'anic word's bytes from library.json, once", () => {
    const sc = new Scope();
    const t = annotate("[[bismi|q:1:1:1]] dan [[bismi|q:1:1:1]]", sc, TERMS);
    const q = t.filter((x) => x.kind === "quran");
    expect(q.map((x) => x.kind === "quran" && x.ar)).toEqual([WORD_AR["1:1:1"], WORD_AR["1:1:1"]]);
    expect(shown(t)).toEqual(["bismi"]);
  });

  it("never opens a second pair of brackets: inside the prose's brackets, before a citation, after a title's word", () => {
    const text = (tokens: Token[]) => termDisplay(tokens).text;
    const inside = annotate("(dalam keadaan [[jar|jar]])", new Scope(), TERMS);
    // one space, no comma (2026-10-12): "(dalam keadaan jar, جَرّ)" before
    expect(text(inside)).toBe(`(dalam keadaan jar ${TERMS.terms.get("jar")!.ar})`);
    expect(inside.find((t) => t.kind === "term")).toMatchObject({ inBracket: true, arabic: true, after: ")" });
    const cite = annotate("ia [[mabni|mabni]] (Ibnu 'Aqil).", new Scope(), TERMS);
    expect(text(cite)).toBe(`ia mabni (${TERMS.terms.get("mabni")!.ar}; Ibnu 'Aqil).`);
    const xref = annotate("(lihat: [[I'rab|irab]] dan tandanya)", new Scope(), TERMS);
    expect(xref.some((t) => t.kind === "term" && t.arabic)).toBe(false);
    const title = titleParts("[[Zharaf|zharaf]] [[iżā|q:113:3:4]] (keterangan waktu)", new Scope(), TERMS);
    expect(text(title.tokens)).toBe(`Zharaf iżā (${LIBRARY.quran["113:3:4"]}, keterangan waktu)`);
  });

  // Operator 2026-10-12: "better not use 'a', 'i', 'u', but use harakat symbols".
  it("gives a harakah term in a title its sign on the headword, never its sound in Latin", () => {
    const { head } = titleParts("[[I'rab|irab]] dan tandanya ([[dhammah|dhammah]], [[fathah|fathah]], [[kasrah|kasrah]])", new Scope(), TERMS);
    expect(head).toEqual([
      { ar: TERMS.terms.get("irab")!.ar },
      { ar: TERMS.terms.get("dhammah")!.ar, mark: "\u064f" },
      { ar: TERMS.terms.get("fathah")!.ar, mark: "\u064e" },
      { ar: TERMS.terms.get("kasrah")!.ar, mark: "\u0650" },
    ]);
    // tanwin names three signs: it gets none
    expect(titleParts("[[Tanwin|tanwin]]", new Scope(), TERMS).head).toEqual([{ ar: TERMS.terms.get("tanwin")!.ar }]);
  });

  it("drops the example's own word from the start of its note (the row shows it)", () => {
    expect(noteWithoutWord("[[bismi|q:1:1:1]]: [[kasrah|kasrah]], tanda", "bismi")).toBe("[[Kasrah|kasrah]], tanda");
    expect(noteWithoutWord("[[bi-|q:1:1:1/1]] + ismi", "bismi")).toBe("[[bi-|q:1:1:1/1]] + ismi");
  });

  it("every example row has the word in Arabic, its transliteration and meaning from content", () => {
    for (const c of LIBRARY.concepts) for (const e of c.examples) {
      const w = WORD_INFO[e.loc];
      expect(w?.ar).toBe(WORD_AR[e.loc]);
      expect(w?.translit.length).toBeGreaterThan(0);
      expect(w?.gloss.length).toBeGreaterThan(0);
    }
  });
});

describe("the marked lessons and the Kosakata (operator 2026-10-12: Arabic, not only the transliteration)", () => {
  const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;
  const lookup = lessonLookup(TERMS, fatihah);
  const show = (marked: string, scope = new Scope(false)) => termDisplay(annotate(marked, scope, lookup)).text;

  it("passes every corpus-free check: plain = marked minus markup, refs resolve to the lesson's bytes", () => {
    for (const s of SURAHS) expect(lessonProblems(s, LIBRARY, WORD_AR), s.slug).toEqual([]);
    expect(libraryProblems(LIBRARY, WORD_AR)).toEqual([]);
  });

  it("marks every word card, ayah structure and fact of Al-Fatihah, and every Kosakata entry", () => {
    expect(fatihah.ayat.every((a) => a.words.every((w) => w.marked) && a.structure?.marked)).toBe(true);
    expect(fatihah.facts.every((f) => f.marked)).toBe(true);
    expect(LIBRARY.lexicon.every((l) => l.marked) && LIBRARY.roots.every((r) => r.marked)).toBe(true);
    // the hidden Mu'awwidzat lessons are not marked yet (pipeline/terms.py MARKED_SURAHS)
    expect(SURAHS.filter((s) => s.ayat.some((a) => a.words.some((w) => w.marked))).map((s) => s.slug)).toEqual(["al-fatihah"]);
  });

  it("shows ‘alaihim's card in Arabic: ‘alā, -him, every term", () => {
    const w = fatihah.ayat[6].words[6]; // 1:7:7
    const text = show(w.marked!.why);
    expect(stripMarked(w.marked!.why)).toBe(w.why);
    for (const want of [
      `‘Alā (${LIBRARY.quran["2:5:2"]})`,
      `huruf jar (${TERMS.terms.get("huruf-jar")!.ar})`,
      `-him (${fatihah.quran["1:7:7/2"]})`,
      // the phrase "mahall raf'" stays whole: no Arabic wedged inside it (review 2026-10-12)
      `rafa' (${TERMS.terms.get("rafa")!.ar}, mahall raf')`,
      `jar-majrur (${TERMS.terms.get("jar-majrur")!.ar})`,
      `na'ib fa'il (${TERMS.terms.get("naib-fail")!.ar}, pengganti pelaku)`,
      `al-magḍūbi (${fatihah.quran["1:7:6"]})`,
      `isim maf'ul (${TERMS.terms.get("isim-maful")!.ar})`,
    ])
      expect(text).toContain(want);
    // the card's own word is shown above it: its name is not repeated
    const card = new Scope(false);
    card.shown.add(`q:${w.loc}`);
    expect(show(w.marked!.why, card)).toContain(" ‘alaihim secara utuh");
  });

  it("gives the case chip the term table's Arabic and a letter sign the ayah's letter", () => {
    for (const st of Object.keys(CASE_META) as (keyof typeof CASE_META)[]) expect(stripMarked(caseLabelMarked(st))).toBe(CASE_META[st].label);
    expect(show(caseLabelMarked("majrur"))).toBe(`majrūr (${TERMS.terms.get("majrur")!.ar})`);
    const alamina = fatihah.ayat[1].words[3]; // 1:2:4, majrur with ya'
    expect(show(alamina.marked!.sign!)).toBe(`ya' (${letterOf(alamina.ar, 6)})`);
  });

  it("shows an example given only as a translation with the Arabic of its ayah words (the gloss variant)", () => {
    const idhafah = LIBRARY.concepts.find((c) => c.id === "idhafah")!;
    const text = termDisplay(annotate(idhafah.marked!.summary, new Scope(), TERMS)).text;
    expect(text).toContain(`seperti “nama Allah” (${LIBRARY.quran["1:1:1-2"]}),`);
    expect(LIBRARY.quran["1:1:1-2"]).toBe(`${WORD_AR["1:1:1"]} ${WORD_AR["1:1:2"]}`);
    expect(idhafah.summary).toContain("seperti “nama Allah”, dan"); // the plain text as it was
    expect(isGloss("“nama Allah”")).toBe(true);
    expect(isGloss("“nama Allah")).toBe(false);
    expect(isGloss("nama Allah")).toBe(false);
  });

  it("gives a concept chip its Arabic headword", () => {
    expect(headwordOf(LIBRARY.concepts.find((c) => c.id === "huruf-jar")!.marked!.title, TERMS)).toBe(TERMS.terms.get("huruf-jar")!.ar);
  });

  it("returns null without a marked twin (an unmarked lesson draws its plain text as before)", () => {
    expect(markedTokens(undefined, new Scope(), lookup)).toBeNull();
  });
});

describe("planted faults in the marked lessons and the Kosakata are caught", () => {
  const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;
  const problems = (s: typeof fatihah) => lessonProblems(s, LIBRARY, WORD_AR).join("\n");

  it("a plain field that drifted from its marked twin", () => {
    const s = clone(fatihah);
    s.ayat[6].words[3].why += " Lagi.";
    expect(problems(s)).toMatch(/word 1:7:4.why: the plain text is not the marked text/);
  });

  it("a q-ref with no bytes in the lesson, and a part that is not the word's segment", () => {
    const s = clone(fatihah);
    delete s.quran["2:5:2"];
    s.quran["1:7:4/2"] = s.quran["1:1:1/1"];
    const p = problems(s);
    expect(p).toMatch(/q:2:5:2 has no bytes in content\/al-fatihah.json quran/);
    expect(p).toMatch(/q:1:7:4\/2 is not segment 2/);
  });

  it("a gloss whose ref does not resolve, a gloss on a half-quoted surface, a gloss naming a term", () => {
    const lib = clone(LIBRARY);
    const c = lib.concepts.find((x) => x.id === "idhafah")!;
    const mk = c.marked!;
    mk.summary = mk.summary.replace("|q:1:1:1-2]]", "|q:1:1:1-9]]");
    mk.bridge = mk.bridge!.replace("[[“nama Allah”|", "[[“nama Allah|").replace("|q:1:1:1-2]] atau", "|q:1:1:1-2]]” atau");
    mk.explanation[0] = mk.explanation[0] + " [[“nama”|idhafah]]";
    c.explanation[0] = c.explanation[0] + " “nama”";
    const p = libraryProblems(lib, WORD_AR).join("\n");
    expect(p).toMatch(/q:1:1:1-9 has no bytes in library.json quran/);
    expect(p).toMatch(/idhafah.bridge: \[\[“nama Allah\|q:1:1:1-2\]\]: a gloss variant's surface must be one quotation/);
    expect(p).toMatch(/a gloss names the Qur'anic words it translates, not a term/);
  });

  it("Arabic typed by hand into a marked field (a lesson's, a concept's)", () => {
    const s = clone(fatihah);
    const ala = s.quran["2:5:2"];
    s.ayat[6].words[3].marked!.why = s.ayat[6].words[3].marked!.why.replace("[[‘Alā|q:2:5:2]]", `‘Alā (${ala})`);
    s.ayat[6].words[3].why = s.ayat[6].words[3].why.replace("‘Alā", `‘Alā (${ala})`);
    expect(problems(s)).toMatch(/word 1:7:4.why: typed Arabic/);
    const lib = clone(LIBRARY);
    const c = lib.concepts.find((x) => x.id === "idhafah")!;
    c.marked!.summary = c.marked!.summary.replace("[[“nama Allah”|q:1:1:1-2]]", `“nama Allah” (${lib.quran["1:1:1-2"]})`);
    c.summary = c.summary.replace("“nama Allah”", `“nama Allah” (${lib.quran["1:1:1-2"]})`);
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/concept idhafah.summary: typed Arabic/);
  });

  it("a Kosakata field that drifted from its marked twin, and a word card without its twin", () => {
    const lib = clone(LIBRARY);
    lib.lexicon[0].meaning += " Lagi.";
    expect(libraryProblems(lib, WORD_AR).join("\n")).toMatch(/lexeme ism.meaning: the plain text is not the marked text/);
    const s = clone(fatihah);
    delete s.ayat[0].words[0].marked;
    expect(problems(s)).toMatch(/word 1:1:1: no marked prose/);
  });
});
