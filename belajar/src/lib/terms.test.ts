import { describe, expect, it } from "vitest";

import { CASE_META, caseLabelMarked } from "./cases";
import { SURAHS, WORD_AR, WORD_INFO } from "./content";
import { LIBRARY, TERMS } from "./library";
import {
  annotate,
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
      expect(WORD_AR[s.loc]?.includes(s.letter)).toBe(true);
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
    // two marked items in one phrase: the first stays Latin
    expect(show("([[mahall|mahall]] [[nashb|nashab]])")).toBe(`(mahall nashb, ${TERMS.terms.get("nashab")!.ar})`);
    // not counted as shown: its next use outside the phrase has the Arabic
    expect(show("([[mahall|mahall]] raf'). [[Mahall|mahall]] adalah kedudukan")).toBe(`(mahall raf'). Mahall (${mahall}) adalah kedudukan`);
    // the end of the bracket, a comma or a list is not a phrase going on: the Arabic stays
    expect(show("(dalam keadaan [[mahall|mahall]])")).toBe(`(dalam keadaan mahall, ${mahall})`);
    expect(show("([[mahall|mahall]] dan [[rafa'|rafa]])")).toBe(`(mahall, ${mahall} dan rafa', ${rafa})`);
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
    const text = (tokens: Token[]) =>
      tokens
        .map((t) => {
          if (t.kind === "text") return t.text;
          if (!t.arabic) return t.surface;
          const ar = t.kind === "term" ? t.term.ar : t.ar;
          if (t.inBracket) return `${t.surface}, ${ar}${t.after}`;
          return `${t.surface} (${ar}${t.merge ? ", " : t.cite ? "; " : `)${t.after}`}`;
        })
        .join("");
    const inside = annotate("(dalam keadaan [[jar|jar]])", new Scope(), TERMS);
    expect(text(inside)).toBe(`(dalam keadaan jar, ${TERMS.terms.get("jar")!.ar})`);
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
