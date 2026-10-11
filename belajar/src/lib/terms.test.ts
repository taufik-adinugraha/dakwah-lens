import { describe, expect, it } from "vitest";

import { WORD_AR, WORD_INFO } from "./content";
import { LIBRARY, TERMS } from "./library";
import {
  annotate,
  letterOf,
  letters,
  libraryProblems,
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
    expect(title.head).toEqual([{ ar: TERMS.terms.get("kasrah")!.ar }]);
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

  it("gives a harakah term in a title its sound on the headword", () => {
    const sounds = soundsOf(LIBRARY.basics[0].signs);
    const { head } = titleParts("[[I'rab|irab]] dan tandanya ([[dhammah|dhammah]])", new Scope(), TERMS, sounds);
    expect(head).toEqual([{ ar: TERMS.terms.get("irab")!.ar }, { ar: TERMS.terms.get("dhammah")!.ar, sound: "u" }]);
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
