import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCheckInput, runAutoplayChecks } from "@/lib/autoplay/checks";
import { availableExercises, buildAutoplaySequence, hasArabicScript, timedWords } from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";
import { conceptsIntroducedIn, getLexeme } from "@/lib/library";
import { SURAH_SLUGS } from "@/lib/routes";

import { stageSequence } from "./build";
import { NARRATED_SLUGS, narrationFor, SHARED_NARRATION } from "./manifests";
import { AUTOPLAY_TEXT_SETS, autoplayTexts } from "./texts";

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const { input, errors: loadErrors } = loadCheckInput((rel) => {
  const path = join(BELAJAR, "content", rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
});

describe("autoplay stage: what the lesson page ships", () => {
  it("passes the engine's checks with every caption set the page uses (id, en)", () => {
    expect(loadErrors).toEqual([]);
    for (const [locale, texts] of Object.entries(AUTOPLAY_TEXT_SETS)) {
      const report = runAutoplayChecks({ ...input, texts, property: { streams: 1, length: 120 } });
      expect({ locale, errors: report.errors }).toEqual({ locale, errors: [] });
    }
  });

  it("spotlight labels are plain words: no Arabic script, no ALL CAPS", () => {
    for (const texts of Object.values(AUTOPLAY_TEXT_SETS)) {
      const g = texts.guide;
      const labels = [g.mushafLine, g.wordCard, g.skip, g.lanjut, g.mushafWord(2), ...Object.values(g.part)];
      for (const l of labels) {
        expect(hasArabicScript(l)).toBe(false);
        expect(l).not.toMatch(/\b[A-Z]{2,}\b/);
        expect(l.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("loads a narration manifest for every surah, and attaches it to the Indonesian page's sequence only", () => {
    expect([...NARRATED_SLUGS].sort()).toEqual([...SURAH_SLUGS].sort());
    expect(Object.keys(SHARED_NARRATION.lines).length).toBeGreaterThan(0);
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        for (const locale of ["id", "en"]) {
          const seq = stageSequence(s, a, locale);
          const direct = buildAutoplaySequence({
            slug: s.slug,
            surahName: s.name_id,
            ayahCount: s.ayat.length,
            ayah: a,
            introduced: conceptsIntroducedIn(a.loc),
            exercises: availableExercises({ words: a.words, timed: timedWords(a), lexeme: getLexeme }),
            texts: autoplayTexts(locale),
            // The narration is Indonesian: an English page stays caption-only.
            narration: locale === "id" ? narrationFor(s.slug) : null,
            shared: locale === "id" ? SHARED_NARRATION : null,
          });
          expect(JSON.stringify(seq)).toBe(JSON.stringify(direct));
          // Every line the Indonesian stage can speak has its manifest text
          // (the subtitles shown once audio exists); English has none.
          for (const st of seq.steps) {
            for (const c of st.cues) {
              if (locale === "id") expect(c.spoken, c.line).not.toBeNull();
              else expect(c.spoken, c.line).toBeNull();
            }
          }
          // Serialisable for the client component, and not huge.
          expect(JSON.stringify(seq).length).toBeLessThan(80_000);
        }
      }
    }
  });

  it("plays narration audio only from same-origin manifest files", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        for (const st of seq.steps) {
          for (const c of st.cues) for (const f of c.audio) expect(f.url.startsWith("/belajar/media/narration/")).toBe(true);
        }
      }
    }
  });
});

describe("autoplay stage: messages and markers", () => {
  const id = JSON.parse(read("messages/id.json")) as Record<string, Record<string, string>>;
  const en = JSON.parse(read("messages/en.json")) as Record<string, Record<string, string>>;

  it("has the same Guided / Lesson / Player keys in both locales", () => {
    for (const ns of ["Guided", "Lesson", "Player"]) {
      expect(Object.keys(en[ns]).sort()).toEqual(Object.keys(id[ns]).sort());
    }
  });

  it("explains the one tap on the start button, and the caption-only stage honestly", () => {
    expect(id.Guided.start).toBe("Mulai");
    expect(id.Guided.start_hint).toBe("Ketuk sekali untuk mulai — selanjutnya pelajaran berjalan sendiri.");
    expect(id.Guided.note_captions).toBe(
      "Suara penjelasan sedang disiapkan; untuk sementara penjelasan tampil sebagai tulisan.",
    );
  });

  it("never promises a human review, never shouts", () => {
    for (const msgs of [id, en]) {
      for (const ns of ["Guided", "Lesson", "Player"]) {
        for (const v of Object.values(msgs[ns])) {
          expect(v).not.toMatch(/tinjauan ustadz|ditinjau|diperiksa ustadz|reviewed by|review by an ustadz/i);
          expect(v).not.toMatch(/\b(?!AI\b)[A-Z]{3,}\b/);
        }
      }
    }
  });

  it("marks the controls the CI screenshots and smoke test drive", () => {
    const stage = read("src/components/lesson/LessonStage.tsx");
    for (const marker of ['data-autoplay="stage"', 'data-autoplay="start"', 'data-autoplay="middle"', 'data-autoplay="next"', 'data-autoplay="exercise"', 'data-autoplay="caption"']) {
      expect(stage).toContain(marker);
    }
    expect(read("src/components/autoplay/Spotlight.tsx")).toContain("data-spotlight-ring");
    const shots = read("scripts/ci/screenshots.mjs");
    expect(shots).toContain('[data-autoplay="start"]');
    expect(shots).toContain("[data-spotlight-ring]");
  });
});
