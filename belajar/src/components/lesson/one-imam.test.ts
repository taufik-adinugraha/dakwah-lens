import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { stageSequence } from "@/components/autoplay/build";
import { SURAHS } from "@/lib/content";
import { quizAyah } from "@/lib/quiz-content";
import { SOURCES } from "@/lib/sources";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { LessonStage } from "./LessonStage";

// ONE imam everywhere, and no reciter setting (operator 2026-10-13, docs/belajar-plan.md L21:
// "better to use alafasy for all? no need to give option to user to change"). The stage as the
// server renders it for every ayah, in both locales: its "⚙ Pengaturan" panel (always in the
// page, hidden until opened) offers no reciter choice and keeps every other setting. That a
// browser DRAWS the open panel so is checked in CI (scripts/ci/screenshots.mjs
// assertNoReciterChoice); that the content has one recitation per ayah, by Alafasy, and that a
// second reciter is refused, in src/lib/content.test.ts and pipeline/test_validate.py.

// The stage's runner takes the app router from Next (the hand-off to the next ayah); none is
// mounted in a unit test, and nothing here navigates.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: (p: { href: unknown; children?: ReactNode }) => createElement("a", { href: String(p.href) }, p.children),
}));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(BELAJAR + rel, "utf8");
const MSG = { id, en } as const;
type Locale = keyof typeof MSG;

/** The stage of one ayah as the server renders it (before "Mulai"), as the page mounts it. */
function stageHtml(locale: Locale, s: (typeof SURAHS)[number], a: (typeof SURAHS)[number]["ayat"][number]): string {
  const [recitation] = a.recitation;
  const stage = createElement(LessonStage, {
    seq: stageSequence(s, a, locale),
    title: `${s.name_id} ${a.ayah}`,
    ayah: a.ayah,
    surahName: s.name_id,
    following: [],
    words: a.words.map((w, i) => ({ index: i + 1, ar: w.ar, translit: w.translit, gloss: w.gloss })),
    source: { url: recitation.url, segments: recitation.segments },
    translation: null,
    exercise: { words: a.words, lexemes: [], quiz: quizAyah(s.slug, a.ayah) },
  });
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MSG[locale], timeZone: "Asia/Jakarta", children: stage };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
}

/** The settings panel's markup: from its opening tag to the lesson area that follows it. */
function panelOf(html: string): string {
  const from = html.indexOf('data-autoplay="settings"');
  const to = html.indexOf("<section", from);
  expect(from, "the stage has no settings panel").toBeGreaterThan(-1);
  expect(to, "no lesson area after the settings panel").toBeGreaterThan(from);
  return html.slice(html.lastIndexOf("<div", from), to);
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
/** Anything that names a reciter or the act of choosing one. */
const RECITER_WORDS = /qari|reciter|husary|mu.?allim|alafasy|mishary/i;

describe("the lesson stage's settings panel offers no reciter choice (one imam, plan L21)", () => {
  it.each(["id", "en"] as const)("%s: every ayah's panel has no dropdown and names no reciter; pace, the imam's speed and the text size stay", (locale) => {
    const m = MSG[locale];
    let n = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const where = `${s.slug} ${a.ayah} [${locale}]`;
        const html = stageHtml(locale, s, a);
        const panel = panelOf(html);
        // No dropdown anywhere on the stage (the reciter choice was its only one), no reciter attribute.
        expect(html, where).not.toMatch(/<select\b|<option\b|<datalist\b|role="(?:combobox|listbox)"/);
        expect(html, where).not.toContain("data-reciter");
        // The panel names no reciter and nothing about choosing one.
        const text = textOf(panel);
        expect(RECITER_WORDS.exec(text)?.[0], `${where}: “${text}”`).toBeUndefined();
        // What stays, and only that: 3 paces + 3 text sizes (radios), the imam's speed, "Tutup pengaturan".
        expect(count(panel, /<input\b[^>]*type="radio"/g), where).toBe(6);
        expect(count(panel, /<button\b/g), where).toBe(2);
        for (const label of [
          m.Guided.settings,
          m.Guided.pace_heading,
          m.Guided.pace_biasa,
          m.Guided.pace_pelan,
          m.Guided.pace_tunggu,
          m.Player.heading,
          m.Player.speed.replace("{speed}", m.Player.speed_normal),
          m.Settings.group_label,
          m.Guided.settings_close,
        ]) {
          expect(text, `${where}: “${label}”`).toContain(label.replace(/&/g, "&amp;"));
        }
        // Nothing where the choice was: the "Bacaan imam" group is its heading and the speed button.
        const group = /<div role="group"[^>]*>([\s\S]*?)<\/div>/.exec(panel)?.[1] ?? "";
        expect(group.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/\s[\w-]+="[^"]*"/g, ""), where).toMatch(/^<p>[^<]+<\/p><button>[^<]+<\/button>$/);
        n++;
      }
    }
    expect(n).toBe(SURAHS.reduce((sum, s) => sum + s.ayat.length, 0));
    expect(n).toBeGreaterThanOrEqual(22);
  });

  it("the planted fault is caught: the removed choice, put back into a panel, fails the same reading", () => {
    // What the panel carried until 2026-10-13, as the server rendered it.
    const old =
      '<div class="mt-4"><label for="r">Suara imam (qari)</label><select id="r"><option value="0" selected="">Mishary Alafasy</option>' +
      "<option value=\"1\">Al-Husary (Mu'allim)</option></select><p>Al-Husary (Mu'allim) memberi jeda untuk menirukan.</p></div>";
    const s = SURAHS[0];
    const html = stageHtml("id", s, s.ayat[0]);
    const group = /<div role="group"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0];
    expect(group).toBeTruthy();
    const faulty = panelOf(html.replace(group!, group + old));
    expect(faulty).toMatch(/<select\b/);
    expect(RECITER_WORDS.exec(textOf(faulty))?.[0]).toBe("qari");
    // … and the clean panel does not trip either reading.
    expect(panelOf(html)).not.toMatch(/<select\b/);
    expect(RECITER_WORDS.test(textOf(panelOf(html)))).toBe(false);
  });

  it("no message offers or describes a reciter choice, in either locale", () => {
    const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
    for (const [locale, m] of Object.entries(MSG)) {
      const player = m.Player as Record<string, string>;
      expect(player.reciter, `${locale} Player.reciter`).toBeUndefined();
      expect(player.husary_note, `${locale} Player.husary_note`).toBeUndefined();
      // No message names the reciter the lessons carried beside the imam, anywhere in the module…
      for (const v of strings(m)) expect(v, locale).not.toMatch(/husary|mu.?allim/i);
      // … and the stage's own namespaces (its panel, its player, its settings) name no reciter at all.
      for (const ns of ["Guided", "Player", "Settings"] as const) for (const v of strings(m[ns])) expect(v, `${locale} ${ns}`).not.toMatch(RECITER_WORDS);
    }
  });

  it("the Kredit page credits one imam: its list, and the credit lines it derives from the content", () => {
    // The static list (lib/sources.ts): one recitation entry, his.
    expect(SOURCES.filter((s) => /^Recitation:/.test(s.credit)).map((s) => s.credit)).toEqual(["Recitation: Mishary Rashid Alafasy via EveryAyah.com"]);
    for (const s of SOURCES) expect(`${s.name} ${s.role} ${s.credit}`).not.toMatch(/husary|mu.?allim/i);
    // What kredit/page.tsx lists under "Bacaan imam di halaman pelajaran": every recording's credit
    // line, once each — as that page computes it.
    const page = read("src/app/[locale]/kredit/page.tsx");
    expect(page).toContain("...new Set(surahs.flatMap((s) => s.ayat.flatMap((a) => a.recitation.map((r) => r.credit)))),");
    const credits = [...new Set(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.recitation.map((r) => r.credit))))];
    expect(credits).toEqual(["Recitation: Mishary Rashid Alafasy via EveryAyah.com · Word timings: Collin Fair, quran-align (CC BY 4.0)"]);
  });

  it("the stage and its players keep no reciter state: one source in, nothing to choose", () => {
    const stage = read("src/components/lesson/LessonStage.tsx");
    const player = read("src/hooks/useSegmentPlayer.ts");
    const runner = read("src/components/autoplay/useAutoplay.ts");
    for (const src of [stage, player, runner, read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx"), read("src/lib/autoplay/exercises.ts")]) {
      expect(src).not.toMatch(/chooseSource|sourceIdx|orderRecitations|RECITER_ORDER|RECITER_LABEL|StageSource|<select\b/);
    }
    expect(player).toContain("export function useSegmentPlayer(\n  source: RecitationSource,");
    expect(runner).toContain("export function useAutoplay(seq: AutoplaySequence, source: RecitationSource, title: string)");
    // Dengar dan klik takes no recitation at all since 2026-10-14: the word it asks about is the
    // narrator's recording of it (src/lib/wordvoice.ts), never the imam's recitation cut at the word —
    // so it has no reciter to choose either (it used to take the stage's one source).
    const tap = read("src/components/exercises/TapWord.tsx");
    expect(tap).not.toMatch(/useSegmentPlayer|RecitationSource|props\.source/);
    expect(tap).toContain("const p = useClipPlayer({ onEnd });");
  });
});
