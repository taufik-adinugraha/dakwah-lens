import { describe, expect, it } from "vitest";

import type { SourceRef } from "@/content/schema";

import { SURAHS } from "./content";
import { LIBRARY } from "./library";
import { displaySource, readableRef, shortKitab, splitKitab } from "./sources";

/** Every "(" closed, never a ")" before its "(". */
const balanced = (s: string): boolean => {
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
  }
  return depth === 0;
};

describe("splitKitab", () => {
  it("keeps the edition details, in order, for a line of their own", () => {
    expect(splitKitab("Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H)")).toEqual({
      name: "Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh",
      edition: "cet. 4, 1415 H",
    });
    expect(
      splitKitab(
        "Ibnu Faris, Mu'jam Maqayis al-Lughah, tahqiq 'Abdussalam Harun (Mustafa al-Babi al-Halabi, cet. 2, 1389-1392 H)",
      ),
    ).toEqual({
      name: "Ibnu Faris, Mu'jam Maqayis al-Lughah",
      edition: "tahqiq 'Abdussalam Harun, Mustafa al-Babi al-Halabi, cet. 2, 1389-1392 H",
    });
    expect(splitKitab("Quranic Arabic Corpus 0.4 (morfologi)")).toEqual({
      name: "Quranic Arabic Corpus 0.4 (morfologi)",
    });
  });
});

describe("shortKitab", () => {
  it("drops edition details but keeps author + title", () => {
    expect(shortKitab("Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H)")).toBe(
      "Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh",
    );
    expect(
      shortKitab(
        "Ibnu Faris, Mu'jam Maqayis al-Lughah, tahqiq 'Abdussalam Harun (Mustafa al-Babi al-Halabi, cet. 2, 1389-1392 H)",
      ),
    ).toBe("Ibnu Faris, Mu'jam Maqayis al-Lughah");
    expect(shortKitab("WALS Online (ed. Dryer & Haspelmath), fitur 86A 'Order of Genitive and Noun'")).toBe(
      "WALS Online, fitur 86A 'Order of Genitive and Noun'",
    );
  });

  it("keeps a plain-word parenthetical and names without edition info", () => {
    expect(shortKitab("Quranic Arabic Corpus 0.4 (morfologi)")).toBe("Quranic Arabic Corpus 0.4 (morfologi)");
    expect(shortKitab("Ibnu Katsir, Tafsir al-Qur'an al-'Azhim")).toBe("Ibnu Katsir, Tafsir al-Qur'an al-'Azhim");
  });
});

describe("readableRef", () => {
  it("keeps the human part of a QAC row and drops the tags", () => {
    expect(
      readableRef("(1:1:1:*) — akar, lemma, kelas kata: P|PREFIX|bi+ + N|STEM|POS:N|LEM:{som|ROOT:smw|M|GEN"),
    ).toBe("akar, lemma, kelas kata");
  });

  it("returns undefined when only tags or hashes are left", () => {
    expect(readableRef("(1:4:1) N ACT PCPL ROOT:mlk; (1:6:3) ADJ ACT PCPL (X) ROOT:qwm")).toBeUndefined();
    expect(readableRef("(1:1:1) P + N; (1:5:2) V IMPF; (1:7:8) CONJ + NEG")).toBeUndefined();
    expect(readableRef("sha256:a1d12923815341fa; LEM:r~aHoma`n")).toBeUndefined();
  });

  it("leaves page and ayah references as written", () => {
    expect(readableRef("jil. 1, hlm. 9")).toBe("jil. 1, hlm. 9");
    expect(readableRef("QS 1:6 (halaman cetak belum diverifikasi)")).toBe("QS 1:6 (halaman cetak belum diverifikasi)");
    expect(readableRef("sha256:bf4f57b968d03f41; karakter 1:1–1:7")).toBe("karakter 1:1–1:7");
  });

  it("splits only at a top-level semicolon, so a bracketed note stays whole", () => {
    const tashrif =
      "(tashrif) sha256:a1d12923815341fa; fi'il LEM:r~aHima, bentuk kata kerja (VF) I (QAC menandai II–XII; tanpa tanda = I), dipakai 28 kali: madhi 8, mudhari' 15, amr 5; bentuk lain dari baris ini yang dipakai Al-Qur'an: LEM:raHomap 114, LEM:r~a`Himiyn 6";
    const shown = readableRef(tashrif);
    expect(shown).toBe(
      "(tashrif) fi'il, bentuk kata kerja (VF) I (QAC menandai II–XII; tanpa tanda = I), dipakai 28 kali: madhi 8, mudhari' 15, amr 5",
    );
    expect(balanced(shown ?? "")).toBe(true);
    expect(readableRef("jil. 1, hlm. 14 (al-I'rab: al-ḥamdu mubtada'; al-‘ālamīna majrur dengan ya')")).toBe(
      "jil. 1, hlm. 14 (al-I'rab: al-ḥamdu mubtada'; al-‘ālamīna majrur dengan ya')",
    );
  });

  it("drops a label left without its value when other text says more", () => {
    expect(
      readableRef(
        "sha256:a1d12923815341fa; ROOT:smw — 381 segmen STEM dalam 352 ayat, 6 lemma; lemma yang disebut di keterangan: LEM:samaA^' 310, LEM:{som 39",
      ),
    ).toBe("381 segmen STEM dalam 352 ayat, 6 lemma");
    expect(readableRef("sha256:a1d12923815341fa; LEM:>anoEama di 4:69")).toBeUndefined();
  });
});

describe("every citation in the content", () => {
  const all: SourceRef[] = [
    ...SURAHS.flatMap((s) => [
      ...s.facts.flatMap((f) => f.sources),
      ...s.ayat.flatMap((a) => [
        ...a.words.flatMap((w) => w.sources),
        ...(a.structure?.sources ?? []),
        ...(a.tafsir?.sources ?? []),
      ]),
    ]),
    ...LIBRARY.concepts.flatMap((c) => c.sources),
    ...LIBRARY.lexicon.flatMap((l) => l.sources),
    ...LIBRARY.roots.flatMap((r) => r.sources),
  ];

  it("never shows a raw QAC tag or hash to learners, and keeps the full text", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      const d = displaySource(s);
      const shown = `${d.name} ${d.edition ?? ""} ${d.detail ?? ""}`;
      expect(shown).not.toMatch(/\||\b(?:LEM|ROOT|POS):|sha256:/);
      // A shortened ref never leaves a stray bracket behind.
      if (s.ref && balanced(s.ref)) expect(balanced(d.detail ?? "")).toBe(true);
      expect(d.name.length).toBeGreaterThanOrEqual(2);
      expect(d.full).toContain(s.kitab);
      if (s.ref) expect(d.full).toContain(s.ref);
    }
  });
});
