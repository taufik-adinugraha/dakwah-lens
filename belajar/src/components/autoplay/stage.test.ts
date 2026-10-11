import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCheckInput, runAutoplayChecks } from "@/lib/autoplay/checks";
import { availableExercises, buildAutoplaySequence, hasArabicScript, questionNumbers } from "@/lib/autoplay";
import { composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { conceptsIntroducedIn } from "@/lib/library";
import { quizAyah } from "@/lib/quiz-content";
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

// Two full engine runs over every surah: ~1.5 s alone since every Al-Fatihah word has a
// composition (2026-10-10), 12 s beside the waris suite's workers, past vitest's 5 s.
const FULL_RUN_TIMEOUT_MS = 60_000;

describe("autoplay stage: what the lesson page ships", () => {
  it(
    "passes the engine's checks with every caption set the page uses (id, en)",
    () => {
      expect(loadErrors).toEqual([]);
      for (const [locale, texts] of Object.entries(AUTOPLAY_TEXT_SETS)) {
        const report = runAutoplayChecks({ ...input, texts, property: { streams: 1, length: 120 } });
        expect({ locale, errors: report.errors }).toEqual({ locale, errors: [] });
      }
    },
    FULL_RUN_TIMEOUT_MS,
  );

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
            exercises: availableExercises(quizAyah(s.slug, a.ayah)),
            questions: questionNumbers(quizAyah(s.slug, a.ayah)),
            texts: autoplayTexts(locale),
            // The narration is Indonesian: an English page stays caption-only.
            narration: locale === "id" ? narrationFor(s.slug) : null,
            shared: locale === "id" ? SHARED_NARRATION : null,
            // Word compositions + the harakat primer go to every locale (rule 14).
            compose: composeInput(s.slug, a),
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
          // Serialisable for the client component, and not huge (word
          // timings for the karaoke caption add ~40 KB to the longest ayah).
          expect(JSON.stringify(seq).length).toBeLessThan(120_000);
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

  it("has the same Guided / Lesson / Player / Compose keys in both locales", () => {
    for (const ns of ["Guided", "Lesson", "Player", "Compose"]) {
      expect(Object.keys(en[ns]).sort()).toEqual(Object.keys(id[ns]).sort());
    }
  });

  it("explains the one click under the one start button, and nothing else (operator, 2026-10-10)", () => {
    expect(id.Guided.start).toBe("Mulai pelajaran");
    expect(id.Guided.start_hint).toBe("Klik sekali; pelajaran berjalan sendiri.");
    // The stage's long notes, mode line and duplicate imam buttons are gone,
    // and so are their messages (they would still ship in the page payload).
    for (const msgs of [id, en]) {
      for (const k of ["note_captions", "note_voice", "note_imam", "text_size", "paused", "mode_auto", "mode_wait", "mode_exercise"]) {
        expect(msgs.Guided[k], `Guided.${k}`).toBeUndefined();
      }
      for (const k of ["play_ayah", "restart", "hint_tap", "pause"]) expect(msgs.Player[k], `Player.${k}`).toBeUndefined();
      expect(msgs.Guided.settings_button).toBeTruthy();
      expect(msgs.Lesson.materials).toBeTruthy();
      expect(msgs.App.menu).toBeTruthy();
    }
    expect(id.Guided.settings_button).toBe("Pengaturan");
    expect(id.Lesson.materials).toBe("Materi lengkap ayat ini");
  });

  it("the image smoke test greps the start label and the hint the page renders", () => {
    // The workflow checks the server-rendered copy with literal greps; keep
    // them and these messages in step (checked where the repo is complete).
    const wf = join(BELAJAR, "..", ".github", "workflows", "deploy-belajar.yml");
    if (!existsSync(wf)) return;
    const yaml = readFileSync(wf, "utf8");
    const label = /grep -q '<span>([^<']+)<\/span>'/.exec(yaml)?.[1];
    const hint = /grep -q '([^']+)'[^\n]*one-click hint/.exec(yaml)?.[1];
    if (label !== undefined) expect(label, "deploy-belajar.yml: start label grep").toBe(id.Guided.start);
    if (hint !== undefined) expect(id.Guided.start_hint, "deploy-belajar.yml: one-click hint grep").toContain(hint);
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

  it("says klik, never ketuk, in every Indonesian string of the module (operator, 2026-10-10)", () => {
    const strings = (v: unknown): string[] =>
      typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
    const waris = JSON.parse(read("messages/waris/id.json")) as unknown;
    for (const v of [...strings(id), ...strings(waris)]) expect(v).not.toMatch(/ketuk/i);
    for (const v of strings(AUTOPLAY_TEXT_SETS.id.exercise)) expect(v).not.toMatch(/ketuk/i);
    for (const v of [...Object.values(AUTOPLAY_TEXT_SETS.id.shared), ...Object.values(AUTOPLAY_TEXT_SETS.id.guide.part)]) {
      expect(v).not.toMatch(/ketuk/i);
    }
    // And the narration the Indonesian page plays and shows.
    for (const m of [SHARED_NARRATION, ...NARRATED_SLUGS.map((slug) => narrationFor(slug))]) {
      for (const [lid, l] of Object.entries(m?.lines ?? {})) expect(`${l.text} ${l.display ?? ""}`, lid).not.toMatch(/ketuk/i);
    }
  });

  it("ships no per-card AI chip or trial banner text, and the spoken start says no 'bukan fatwa' (the footer does)", () => {
    for (const msgs of [id, en]) {
      expect(msgs.Word.draft).toBeUndefined();
      expect(msgs.Surah.draft_chip).toBeUndefined();
      expect(msgs.Surah.draft_banner).toBeUndefined();
      expect(msgs.Lesson.draft_short).toBeUndefined();
    }
    expect(id.Footer.disclaimer).toMatch(/Dibantu AI, bukan fatwa otoritatif/);
    expect(SHARED_NARRATION.lines["shared:start"]?.text ?? "").not.toMatch(/bukan fatwa/i);
  });

  it("labels the replay control and the word card in both locales", () => {
    expect(id.Guided.replay).toBe("Ulangi langkah ini");
    expect(id.Guided.card_meaning).toBe("yang artinya “{gloss}”");
    expect(en.Guided.replay).toBeTruthy();
  });

  it("marks the controls the CI screenshots and smoke test drive", () => {
    const stage = read("src/components/lesson/LessonStage.tsx");
    for (const marker of ['data-autoplay="stage"', 'data-autoplay="start"', 'data-autoplay="middle"', 'data-autoplay="replay"', 'data-autoplay="next"', 'data-autoplay="exercise"', 'data-autoplay="caption"', 'data-autoplay="word-card"', 'data-autoplay="settings-toggle"', 'data-autoplay="settings"']) {
      expect(stage).toContain(marker);
    }
    expect(read("src/components/autoplay/Spotlight.tsx")).toContain("data-spotlight-ring");
    // The composition animation in the card's slot, and the frame CI waits for.
    const comp = read("src/components/lesson/WordComposition.tsx");
    for (const marker of ['data-autoplay="composition"', 'data-guide="word-card"', "data-compose-frame", "data-compose-stage"]) expect(comp).toContain(marker);
    expect(read("scripts/ci/screenshots.mjs")).toContain('[data-autoplay="composition"]');
    const header = read("src/components/HeaderControls.tsx");
    for (const marker of ["data-header-menu-toggle", "data-header-menu=", "data-text-size-toggle"]) expect(header).toContain(marker);
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ['[data-autoplay="start"]', "[data-spotlight-ring]", '[data-autoplay="settings-toggle"]', '[data-autoplay="settings"]', "[data-header-menu-toggle]", "[data-header-menu]"]) {
      expect(shots).toContain(sel);
    }
  });
});
