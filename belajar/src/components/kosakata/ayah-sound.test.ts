import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KosakataAyatFile, KosakataIndex, KosakataPath, KosakataWordsFile } from "@/content/kosakata-schema";
import { ayatFileName, wordsFileName } from "@/lib/kosakata-core";
import type { AyahLine } from "@/lib/kosakata-path-core";
import { levelOf, type PathSource, testData } from "@/lib/kosakata-path-data";

import { recordingIsMarkedWord, soundedAyahKeys } from "./ayah-sound";

// Operator 2026-11-04, on Level 1's second test: "the screen highlight 'wa man' but the sound only 'man',
// its confusing. i believe many similar cases like this." An ayah question marks a token of a verse; the
// speaker plays the word's pinned recording, chosen by another rule. They agree for 36% of the words
// that get an ayah question. This pins the rule that the speaker is there only when they agree.

const line = (tokens: string[], hi: number[]): AyahLine => ({ loc: "1:1", surah: "x", ayah: 1, tokens, hi, text: "", footnotes: [] });

describe("recordingIsMarkedWord: the speaker says what is marked", () => {
  it("is not the case when the verse marks wa-man and the recording is man (the report)", () => {
    expect(recordingIsMarkedWord(line(["قَالَ", "وَمَن", "فِى"], [1]), { form: "مَن" })).toBe(false);
  });

  it("is the case when the marked token is spelt as the recording is", () => {
    expect(recordingIsMarkedWord(line(["قَالَ", "وَمَن", "فِى"], [1]), { form: "وَمَن" })).toBe(true);
    expect(recordingIsMarkedWord(line(["قَالَ", "مَن", "فِى"], [1]), { form: "مَن" })).toBe(true);
  });

  it("is not the case for an extra ending, an extra al-, or other vowel marks (the rest of Level 1, batch 2)", () => {
    expect(recordingIsMarkedWord(line(["قَالُوا۟", "ءَامَنَّا"], [1]), { form: "ءَامَنَ" })).toBe(false);
    expect(recordingIsMarkedWord(line(["سَأَلَنِى", "عَنِّى"], [1]), { form: "عَن" })).toBe(false);
    expect(recordingIsMarkedWord(line(["فِى", "ٱلْأَرْضِ"], [1]), { form: "أَرْضِ" })).toBe(false);
    expect(recordingIsMarkedWord(line(["فِى", "ٱلْأَرْضُ"], [1]), { form: "ٱلْأَرْضِ" })).toBe(false);
  });

  it("holds for every marked token, not for one of them", () => {
    expect(recordingIsMarkedWord(line(["مَن", "وَمَن"], [0, 1]), { form: "مَن" })).toBe(false);
    expect(recordingIsMarkedWord(line(["مَن", "x", "مَن"], [0, 2]), { form: "مَن" })).toBe(true);
  });

  it("takes a stop-form recording (an ayah's last word) only for a marked word that ends its ayah as well", () => {
    const stop = { form: "أَحَدٌ", final: true } as const;
    expect(recordingIsMarkedWord(line(["كُفُوًا", "أَحَدٌ"], [1]), stop)).toBe(true);
    expect(recordingIsMarkedWord(line(["أَحَدٌ", "كُفُوًا"], [0]), stop)).toBe(false);
    expect(recordingIsMarkedWord(line(["أَحَدٌ", "كُفُوًا"], [0]), { form: "أَحَدٌ" })).toBe(true);
  });
});

// The real path, read as the pages read it.
const DIR = fileURLToPath(new URL("../../../content/kosakata/", import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const index = KosakataIndex.parse(read("index.json"));
const path = KosakataPath.parse(read("path.json"));
const wordFiles = new Map<string, ReturnType<typeof KosakataWordsFile.parse>>();
const ayatFiles = new Map<string, ReturnType<typeof KosakataAyatFile.parse>>();
const src: PathSource = {
  index,
  path,
  word: (rank) => {
    const name = wordsFileName(rank);
    if (!wordFiles.has(name)) wordFiles.set(name, KosakataWordsFile.parse(read(name)));
    return wordFiles.get(name)!.words.find((w) => w.rank === rank) ?? null;
  },
  ayah: (loc) => {
    const [s, a] = loc.split(":").map(Number);
    const name = ayatFileName(s);
    if (!ayatFiles.has(name)) ayatFiles.set(name, KosakataAyatFile.parse(read(name)));
    const e = ayatFiles.get(name)!.ayat.find((x) => x.loc === loc);
    return e ? { ar: e.ar, text: e.translation.text, footnotes: e.translation.footnotes, surah: index.names[String(s)], ayah: a } : null;
  },
};

describe("the real path", () => {
  it("lets a speaker through only where the recording is spelt as every marked token", () => {
    let withAyah = 0;
    let sounded = 0;
    for (const level of path.levels.slice(1)) {
      level.batches.forEach((_, i) => {
        const data = testData(src, level, i + 1);
        const keys = soundedAyahKeys(src, data);
        expect(new Set(keys).size, data.id).toBe(keys.length);
        for (const item of data.fresh) {
          if (!item.ayah) {
            expect(keys, `${data.id}: ${item.translit} has no ayah question`).not.toContain(item.key);
            continue;
          }
          withAyah++;
          const voice = src.word(Number(item.key.slice(1)))!.voice;
          const { tokens, hi } = item.ayah;
          const marked = hi.map((h) => tokens[h]);
          const midAyah = hi.some((h) => h !== tokens.length - 1);
          if (keys.includes(item.key)) {
            sounded++;
            expect(marked, `${data.id}: ${item.translit} has a speaker`).toEqual(marked.map(() => voice.form));
            expect(voice.final && midAyah, `${data.id}: ${item.translit} plays a stop form on a word inside its ayah`).toBeFalsy();
          } else {
            const spelt = marked.some((m) => m !== voice.form);
            const stopForm = voice.final === true && midAyah;
            expect(spelt || stopForm, `${data.id}: ${item.translit} has no speaker, though it marks ${marked.join(" ")} and the recording is ${voice.form}`).toBe(true);
          }
        }
      });
    }
    // A rule that let nothing through would pass every check above.
    expect(sounded / withAyah).toBeGreaterThan(0.2);
    expect(sounded).toBeLessThan(withAyah);
  }, 120_000);

  it("answers the report: Level 1, batch 2, marks wa-man for man, and its ayah question has no speaker", () => {
    const data = testData(src, levelOf(src, "1")!, 2);
    const keys = soundedAyahKeys(src, data);
    const man = data.fresh.find((i) => i.key === "w12")!;
    expect(man.translit).toBe("man");
    const marked = man.ayah!.hi.map((h) => man.ayah!.tokens[h]);
    const heard = src.word(12)!.voice.form;
    // The verse marks the word with wa- in front of it; the recording is the word alone.
    expect(marked).toHaveLength(1);
    expect(marked[0]).not.toBe(heard);
    expect(marked[0].endsWith(heard)).toBe(true);
    expect(keys).not.toContain("w12");
    // la, where the verse marks la and the recording says la, keeps its speaker.
    expect(keys).toContain("w4");
  });

  it("leaves a level test with no ayah question, so it has nothing to hand the page", () => {
    for (const level of path.levels.slice(1)) {
      expect(testData(src, level, null).fresh.filter((i) => i.ayah).map((i) => i.key), `level ${level.n}`).toEqual([]);
    }
  });
});

describe("the pages obey it", () => {
  const code = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const test = code("./PathTest.tsx");

  it("shows the speaker and plays on a right answer only where the question may", () => {
    expect(test).toMatch(/const plays = q\.kind !== "ayah" \|\| ayahSounds\.includes\(item\.key\);/);
    expect(test).toMatch(/\{plays \? \(\s*<div className="flex justify-center">\s*<ClipButton loc=\{item\.loc\}/);
    expect(test).toMatch(/if \(ok && plays\) player\?\.play\(keyOf\(run\), item\.clip\);/);
    // The other two places a recording sounds are not an ayah question's.
    expect(test.match(/player\?\.play\(/g)).toHaveLength(3);
    expect(test.match(/<ClipButton /g)).toHaveLength(2);
  });

  it("is handed the keys by the batch test's page", () => {
    const page = code("../../app/[locale]/kosakata/bertahap/[level]/[batch]/tes/page.tsx");
    expect(page).toContain('import { soundedAyahKeys } from "@/components/kosakata/ayah-sound";');
    expect(page).toMatch(/ayahSounds=\{soundedAyahKeys\(src, data\)\}/);
  });
});
