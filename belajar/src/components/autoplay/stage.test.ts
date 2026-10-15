import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCheckInput, runAutoplayChecks } from "@/lib/autoplay/checks";
import {
  availableExercises,
  buildAutoplaySequence,
  createAutoplayState,
  firstNarration,
  hasArabicScript,
  idlePreloadUrl,
  questionNumbers,
  recitationToWarm,
  reduceAutoplay,
  viewAutoplay,
} from "@/lib/autoplay";
import { composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { taughtAt } from "@/lib/curriculum";
import { lessonMapInput } from "@/lib/map-content";
import { quizAyah } from "@/lib/quiz-content";
import { SURAH_SLUGS } from "@/lib/routes";
import { wordVoice } from "@/lib/wordvoice";

import { lessonExamplesFor, stageSequence } from "./build";
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
            introduced: taughtAt(a),
            exercises: availableExercises(quizAyah(s.slug, a.ayah)),
            questions: questionNumbers(quizAyah(s.slug, a.ayah)),
            texts: autoplayTexts(locale),
            // The narration is Indonesian: an English page stays caption-only.
            narration: locale === "id" ? narrationFor(s.slug) : null,
            shared: locale === "id" ? SHARED_NARRATION : null,
            // Word compositions + the harakat primer go to every locale (rule 14).
            compose: composeInput(s.slug, a),
            // The example beats too (plan L20): the imam and a caption, no narration.
            examples: lessonExamplesFor(s, a).examples,
            // The lesson map's steps, in a surah that has one (plan L23, L26).
            map: lessonMapInput(s.slug, a.ayah),
            // Every word heard on its own is the narrator's recording of it (operator 2026-10-14).
            voice: wordVoice,
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
          // Serialisable for the client component, and not huge. Measured 2026-10-11, with every
          // Al-Fatihah line voiced (karaoke word timings), the word compositions and the quiz
          // explanations: the longest, Al-Fatihah 7 (nine words), is 141 KB raw / 28 KB gzipped;
          // the next, ayah 5, 92 KB. The budget keeps ~13% headroom over the longest.
          expect(JSON.stringify(seq).length).toBeLessThan(160_000);
        }
      }
    }
  });

  it("warms the first line Mulai plays — same-origin narration, never the imam's recording (operator 2026-10-11)", () => {
    const fatihah = SURAHS.find((s) => s.slug === "al-fatihah");
    const a1 = fatihah?.ayat.find((a) => a.ayah === 1);
    if (!fatihah || !a1) throw new Error("no Al-Fatihah 1");
    const start = SHARED_NARRATION.lines["shared:start"]?.audio;
    const resume = SHARED_NARRATION.lines["shared:resume"]?.audio;
    const id = stageSequence(fatihah, a1, "id");
    if (start) expect(firstNarration(id, null)).toEqual({ url: start.url, ms: start.ms });
    if (resume) expect(firstNarration(id, 2)).toEqual({ url: resume.url, ms: resume.ms });
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const first = firstNarration(stageSequence(s, a, "id"), null);
        const url = idlePreloadUrl(first);
        if (url) expect(url.startsWith("/belajar/media/narration/")).toBe(true);
        for (const r of a.recitation) expect(url).not.toBe(r.url);
        // An English page is caption-only: nothing to warm.
        expect(firstNarration(stageSequence(s, a, "en"), null)).toBeNull();
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

describe("autoplay stage: the imam's recitation fetched early (operator 2026-10-11)", () => {
  /** What the ayah page hands the stage (page.tsx): the ayah's one recording, the one imam's
   *  (operator 2026-10-13, plan L21; until then two, the second chosen in "Pengaturan"). */
  const pageSource = (a: (typeof SURAHS)[number]["ayat"][number]) => a.recitation[0].url;

  // What this walk can and cannot show (review 2026-10-11): the rule returns the recording it is
  // handed, so the walk proves WHEN the lesson asks (never on a page view, from the first line to
  // the last step) and that no lesson opens with the imam. That the stage is handed this ayah's
  // recording and no other's is the wiring test's below, and the browser check's in CI.
  it(
    "every lesson: nothing asked for on a page view; once started it stays asked for on every step, and no lesson opens with the imam",
    () => {
      let lessons = 0;
      for (const s of SURAHS) {
        for (const a of s.ayat) {
          for (const locale of ["id", "en"]) {
            const seq = stageSequence(s, a, locale);
            const source = pageSource(a);
            const want = (st: ReturnType<typeof createAutoplayState>) => recitationToWarm({ started: st.started, currentUrl: source });
            const where = `${s.slug} ${a.ayah} [${locale}]`;
            // One recording, so nothing else the lesson could ask for: no second reciter's.
            expect(a.recitation, where).toHaveLength(1);
            expect(source, where).toMatch(/^https:\/\/everyayah\.com\/data\/Alafasy_128kbps\/\d{6}\.mp3$/);
            const idle = createAutoplayState(seq);
            expect(want(idle), where).toBeNull();

            // "Mulai", "Lanjutkan dari langkah 2" (the imam's own step) and the hand-off from the
            // previous ayah: each starts with a line — the narrator's, or its caption — never
            // with the imam, so his recording has that line's time to arrive.
            for (const start of [
              { type: "start", reason: "fresh" },
              { type: "start", reason: "restore", from: 1 },
              { type: "start", reason: "continue" },
            ] as const) {
              const st = reduceAutoplay(seq, idle, start);
              expect(st.started, where).toBe(true);
              expect(st.activity?.kind, `${where} ${start.reason}`).not.toBe("recite");
              expect(want(st), where).toBe(source);
            }

            // The whole lesson, step by step ("Berikutnya ›", "Lewati latihan" at an exercise):
            // the lesson stays started, so the recording stays asked for on every step, the recap
            // and the last line included.
            let st = reduceAutoplay(seq, idle, { type: "start", reason: "fresh" });
            for (let i = 0; i < 300 && st.phase !== "finished"; i++) {
              const v = viewAutoplay(seq, st);
              expect(want(st), `${where} step ${v.step.id}`).toBe(source);
              st = reduceAutoplay(seq, st, { type: v.showSkip ? "skip" : "next" });
            }
            expect(st.phase, where).toBe("finished");
            lessons++;
          }
        }
      }
      expect(lessons).toBeGreaterThan(40);
    },
    FULL_RUN_TIMEOUT_MS,
  );

  // The content's side of "a recording is fetched by the page that plays it": an address names
  // one ayah's recording. Were two ayat to share one, a page would fetch another ayah's by name.
  it("no two ayat of a surah share a recording's address", () => {
    for (const s of SURAHS) {
      const owner = new Map<string, number>();
      for (const a of s.ayat) {
        const url = pageSource(a);
        expect(owner.get(url) ?? a.ayah, `${s.slug}: ${url}`).toBe(a.ayah);
        owner.set(url, a.ayah);
      }
    }
  });

  it("every recording is on a host the page's CSP lets media reach (next.config.ts), over https", () => {
    // A recording on any other host would neither be fetched ahead nor play: media-src refuses it.
    const config = read("next.config.ts");
    const list = /const RECITATION_HOSTS = \[([^\]]+)\]/.exec(config)?.[1] ?? "";
    const hosts = [...list.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(0);
    expect(config).toContain("`media-src 'self' blob: ${RECITATION_HOSTS.join(\" \")}`");
    let n = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        for (const r of a.recitation) {
          expect(hosts, `${s.slug} ${a.ayah} ${r.reciter}`).toContain(new URL(r.url).origin);
          n++;
        }
      }
    }
    // One recording per lesson ayah (until 2026-10-13 two: this counted past 40).
    expect(n).toBe(SURAHS.reduce((sum, s) => sum + s.ayat.length, 0));
    expect(n).toBeGreaterThan(20);
  });

  it("is wired from the runner to the stage's one player, and a page view alone leaves the recording alone", () => {
    const runner = read("src/components/autoplay/useAutoplay.ts");
    expect(runner).toContain("recitationToWarm({ started: lessonStarted, currentUrl: reciteUrl })");
    expect(runner).toContain("const lessonStarted = state.started;");
    expect(runner).toContain("if (url) warmPlayer(url);");
    // One Audio element fetches a recitation ahead, the stage's own: the element waits for a play
    // (or the lesson's start) — "none" on every page's mount, "auto" in one place only, warm().
    const player = read("src/hooks/useSegmentPlayer.ts");
    expect(player.match(/\.preload = "none";/g)).toHaveLength(1);
    expect(player.match(/\.preload = "auto";/g)).toHaveLength(1);
    expect(player.indexOf('a.preload = "auto";')).toBeGreaterThan(player.indexOf("const warm = useCallback("));
    // No second element fetches for another page (review 2026-10-11: the spare element is gone),
    // and the page hands the stage no recording but this ayah's.
    expect(player.match(/new Audio\(\)/g)).toHaveLength(2); // stageAudio(), and a standalone player's own
    const page = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    expect(page).not.toContain("next.recitation");
    // The page hands the stage ONE recording, the ayah's (one imam, plan L21), and the runner
    // asks for that very one: its address is the source's, not a reciter state's.
    expect(page).toContain("const [recitation] = a.recitation;");
    expect(page).toContain("source={source}");
    const stage = read("src/components/lesson/LessonStage.tsx");
    expect(stage).toContain("useAutoplay(seq, source, title)");
    expect(runner).toContain("const reciteUrl = source.url;");
    // The CI check finds the recording in the content (the ayah's one recitation: the stage has
    // no reciter to name any more, so no data-reciter), and tells that the imam is really
    // sounding by the place of the word lit (a later word needs the recording to advance).
    expect(read("src/components/lesson/AyahPlayer.tsx")).toContain("data-word={w.index}");
    const ci = read("scripts/ci/screenshots.mjs");
    expect(ci).toContain("const [only, ...more] = content.ayat.find((a) => a.ayah === ayah)?.recitation ?? [];");
    expect(ci).toContain('getAttribute("data-word")');
    for (const src of [stage, ci, player, runner]) expect(src).not.toContain("data-reciter");
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

  it("one start button and no hint under it (operator, 2026-10-10; the hint removed 2026-10-12)", () => {
    expect(id.Guided.start).toBe("Mulai pelajaran");
    // "remove this line, to make the space more clean" (operator 2026-10-12)
    for (const msgs of [id, en]) expect(msgs.Guided.start_hint).toBeUndefined();
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

  it("the image smoke test greps the start label the page renders", () => {
    // The workflow checks the server-rendered copy with literal greps; keep
    // them and these messages in step (checked where the repo is complete).
    const wf = join(BELAJAR, "..", ".github", "workflows", "deploy-belajar.yml");
    if (!existsSync(wf)) return;
    const yaml = readFileSync(wf, "utf8");
    const label = /grep -q '<span>([^<']+)<\/span>'/.exec(yaml)?.[1];
    if (label !== undefined) expect(label, "deploy-belajar.yml: start label grep").toBe(id.Guided.start);
    // The removed one-click hint (2026-10-12) is no longer required: only checked to stay gone.
    expect(yaml, "deploy-belajar.yml must not require the removed one-click hint").not.toMatch(/grep -q 'Klik sekali[^']*' <<<"\$html" \|\|/);
    expect(yaml).toMatch(/the removed one-click hint is back/);
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

  it("says what is loading, plainly, and what to do when it is slow (operator 2026-10-11, rule 19)", () => {
    expect(id.Guided.preparing).toBe("Menyiapkan pelajaran…");
    expect(id.Guided.loading_narration).toBe("Memuat suara narator…");
    expect(id.Guided.loading_recitation).toBe("Memuat bacaan imam…");
    // "↺ Ulangi" names the replay control as a phone shows it, its mark kept with it (no-break
    // space: never "↺" at a line's end and "Ulangi." on the next — line breaks, rule 15).
    expect(id.Guided.loading_slow).toBe("Masih memuat. Koneksi mungkin sedang lambat; tunggu sebentar, atau klik ↺\u00a0Ulangi.");
    expect(id.Guided.loading_slow).toContain(`↺\u00a0${id.Guided.replay_short}`);
    expect(en.Guided.loading_slow).toContain(`↺\u00a0${en.Guided.replay_short}`);
    for (const k of ["preparing", "loading_narration", "loading_recitation", "loading_slow"]) {
      expect(en.Guided[k], `en Guided.${k}`).toBeTruthy();
    }
  });

  it("labels the replay control and the word card in both locales", () => {
    expect(id.Guided.replay).toBe("Ulangi langkah ini");
    expect(id.Guided.card_meaning).toBe("yang artinya “{gloss}”");
    expect(en.Guided.replay).toBeTruthy();
  });

  it("marks the controls the CI screenshots and smoke test drive", () => {
    const stage = read("src/components/lesson/LessonStage.tsx");
    for (const marker of ['data-autoplay="stage"', 'data-autoplay="start"', 'data-autoplay="middle"', 'data-autoplay="replay"', 'data-autoplay="next"', 'data-autoplay="exercise"', 'data-autoplay="caption"', 'data-autoplay="word-card"', 'data-autoplay="settings-toggle"', 'data-autoplay="settings"', 'data-autoplay="loading"', "aria-busy"]) {
      expect(stage).toContain(marker);
    }
    expect(read("src/components/autoplay/Spotlight.tsx")).toContain("data-spotlight-ring");
    // The composition animation in the card's slot, and the frame CI waits for.
    const comp = read("src/components/lesson/WordComposition.tsx");
    for (const marker of ['data-autoplay="composition"', 'data-guide="word-card"', "data-compose-frame", "data-compose-stage"]) expect(comp).toContain(marker);
    expect(read("scripts/ci/screenshots.mjs")).toContain('[data-autoplay="composition"]');
    // What the browser checks of plan L24 (operator 2026-10-13) find — they cannot be run on a
    // laptop, so their selectors are pinned here. The joined word's frame is found by its word and
    // frame number and read from the tiles of the frame on screen (screenshots.mjs composeShots).
    // Word 1's composition ends there, with no "recited" mark; only the ayah's last word (word 4)
    // is recited once more, and that is where the check waits for the mark.
    for (const marker of ["data-compose-word", "data-compose-layer", "data-compose-tile", "data-recited"]) expect(comp).toContain(marker);
    for (const marker of ["data-mode=", "data-step=", "data-line="]) expect(stage).toContain(marker);
    const composeCheck = read("scripts/ci/screenshots.mjs");
    expect(composeCheck).toContain('await advanceTo(`[data-compose-word="1"][data-compose-frame="${lastFrame}"]`);');
    expect(composeCheck).not.toMatch(/advanceTo\(['"`]\[data-recited/);
    expect(composeCheck).toContain('await advanceTo(`[data-compose-word="${lastWord}"][data-recited="true"]`);');
    // The line-break walk measures a word's opening step and a concept's example step PAUSED
    // (they last about 1.5 s and 3 s now): it finds the opening step by its id and the lesson's
    // Jeda / Lanjutkan control by its mode.
    const walk = read("scripts/ci/linebreaks.mjs");
    expect(walk).toContain(`const MIDDLE = '[data-autoplay="middle"]';`);
    expect(walk).toContain('getAttribute("data-mode")');
    const opening = /const WORD_RECITE_STEP = \/(.+)\/;/.exec(walk)?.[1];
    expect(opening).toBeTruthy();
    const isOpening = new RegExp(opening ?? "$^");
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        for (const st of stageSequence(s, a, "id").steps) expect([st.id, isOpening.test(st.id)]).toEqual([st.id, st.kind === "recite_word"]);
      }
    }
    const header = read("src/components/HeaderControls.tsx");
    for (const marker of ["data-header-menu-toggle", "data-header-menu=", "data-text-size-toggle"]) expect(header).toContain(marker);
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ['[data-autoplay="start"]', "[data-spotlight-ring]", '[data-autoplay="settings-toggle"]', '[data-autoplay="settings"]', "[data-header-menu-toggle]", "[data-header-menu]", '[data-autoplay="loading"]']) {
      expect(shots).toContain(sel);
    }
  });
});
