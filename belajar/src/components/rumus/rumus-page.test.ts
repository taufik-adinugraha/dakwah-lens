import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import RumusPage, { generateMetadata } from "@/app/[locale]/quran/rumus/page";
import CurriculumPage from "@/app/[locale]/quran/kurikulum/page";
import QuranTrackPage from "@/app/[locale]/quran/page";
import { WORD_INFO } from "@/lib/content";
import { CURRICULUM } from "@/lib/curriculum";
import { DEFAULT_SURAHS } from "@/lib/features";
import { RUMUS } from "@/lib/rumus";
import { curriculumHref, rumusHref, SURAH_SLUGS } from "@/lib/routes";
import { hasArabic } from "@/lib/textUnits";
import { stripMarked } from "@/lib/terms";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

// THE CHEAT SHEET PAGE, /quran/rumus (operator 2026-10-13/14: "we can make some 'cheat sheet' to
// explain the rules, for example: harf jar + ism = kasrah (give examples) … of course we need to
// refer to valid kitab"; docs/belajar-plan.md L32), rendered whole — the page's own server
// component, in both locales, as production runs it (Al-Fatihah only) and with every surah listed —
// and held to content/rumus.json and content/curriculum.json. That a browser DRAWS it without a bad
// line break at the three text sizes is CI's (scripts/ci/linebreaks.mjs, screenshots.mjs).

type Locale = "id" | "en";
const MSG = { id, en } as const;
const request = vi.hoisted(() => ({ locale: "id" as "id" | "en" }));

// connection() needs a live Next request (lib/features.ts visibleSurahs()).
vi.mock("next/server", () => ({ connection: async () => undefined }));
// The track page names surahs through src/lib/ayat.ts, which is server-only (src/lib/ayah.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async () => {
  const intl = await import("next-intl");
  const messages = { id: (await import("../../../messages/id.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    setRequestLocale: () => undefined,
    getTranslations: async (arg?: string | { locale?: string; namespace?: string }) => {
      const locale = ((typeof arg === "object" ? arg?.locale : undefined) ?? request.locale) as "id" | "en";
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return intl.createTranslator({ locale, messages: messages[locale], namespace } as Parameters<typeof intl.createTranslator>[0]);
    },
  };
});
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  Link: ({ href, children, ...rest }: { href: unknown; children?: ReactNode }) =>
    createElement("a", { ...rest, href: `/belajar/${request.locale}${href === "/" ? "" : String(href)}` }, children),
}));

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

const savedSurahs = process.env.BELAJAR_SURAHS;
afterEach(() => {
  if (savedSurahs === undefined) delete process.env.BELAJAR_SURAHS;
  else process.env.BELAJAR_SURAHS = savedSurahs;
});

type PageFn = (props: { params: Promise<{ locale: string }> }) => Promise<ReactNode>;
async function render(page: PageFn, locale: Locale, published?: readonly string[]): Promise<string> {
  request.locale = locale;
  if (published === undefined) delete process.env.BELAJAR_SURAHS;
  else process.env.BELAJAR_SURAHS = published.join(",");
  const tree = await page({ params: Promise.resolve({ locale }) });
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MSG[locale], timeZone: "Asia/Jakarta", children: tree };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}
const rumus = (locale: Locale, published?: readonly string[]) => render(RumusPage as unknown as PageFn, locale, published);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#x27": "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => (e[0] === "#" && /^#x27$/i.test(e) ? "'" : e[0] === "#" ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? all)));
const text = (html: string) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const visible = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** The step blocks of the page, in order: id, state, and its html. */
function blocks(html: string) {
  const at = [...html.matchAll(/<li data-rumus-step="([^"]+)" data-rumus-state="([^"]+)"/g)];
  const end = html.length;
  return at.map((m, k) => ({ id: m[1], state: m[2], html: html.slice(m.index, at[k + 1]?.index ?? end) }));
}
const step = (sid: string) => CURRICULUM.steps.find((s) => s.id === sid)!;
const entry = (sid: string) => RUMUS.steps.find((e) => e.step === sid);
const lessonSlug = (lid: string) => {
  const l = CURRICULUM.lessons.find((x) => x.id === lid)!;
  return CURRICULUM.units.find((u) => u.id === l.unit)?.slug;
};
const HIDDEN = SURAH_SLUGS.filter((s) => !DEFAULT_SURAHS.includes(s));

describe("the page lists every step of the curriculum once, in teaching order, under its unit", () => {
  for (const locale of ["id", "en"] as const) {
    it(`${locale}: steps and units are the files'`, async () => {
      const html = await rumus(locale);
      expect(blocks(html).map((b) => b.id)).toEqual(CURRICULUM.steps.map((s) => s.id));
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1])).toBe(MSG[locale].Rumus.title);
      const units = [...html.matchAll(/<section data-rumus-unit="([^"]+)"/g)].map((m) => m[1]);
      expect(units).toEqual(CURRICULUM.units.map((u) => u.id));
      for (const b of blocks(html)) {
        const name = text(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(b.html)![1]);
        expect(name, b.id).toBe(step(b.id).name);
      }
      // The list help counts from the sheet.
      const shown = blocks(html).filter((b) => b.state === "shown").length;
      const t = createTranslator({ locale, messages: MSG[locale], namespace: "Rumus" });
      expect(visible(html)).toContain(t("list_help", { shown, steps: CURRICULUM.steps.length }));
    });
  }
});

describe("availability: the formulas of a surah that is not published are in no HTML", () => {
  it("as production runs: Al-Fatihah's and lesson zero's formulas are drawn; the others' steps are named and marked", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await rumus(locale);
      const mark = MSG[locale].Curriculum.unavailable;
      for (const b of blocks(html)) {
        const slug = lessonSlug(step(b.id).lesson);
        const open = step(b.id).lesson === "0" || (slug !== undefined && DEFAULT_SURAHS.includes(slug));
        const e = entry(b.id);
        if (!open) {
          expect(b.state, b.id).toBe("locked");
          expect(visible(b.html), b.id).toContain(mark);
          // not the formula, not its limit, not one quote, not a link into a hidden surah
          expect(b.html, b.id).not.toContain("data-rumus-formula");
          expect(b.html, b.id).not.toContain("data-rumus-basis");
          expect(b.html, b.id).not.toContain("data-rumus-example");
        } else if (!e) {
          expect(b.state, b.id).toBe("none");
          expect(visible(b.html), b.id).toContain(MSG[locale].Rumus.none);
          expect(b.html, b.id).not.toContain("data-rumus-formula");
        } else {
          expect(b.state, b.id).toBe("shown");
          expect(visible(b.html), b.id).not.toContain(mark);
        }
      }
      // The strongest check: no byte of any hidden step's formula or quote is anywhere on the page.
      for (const e of RUMUS.steps) {
        const slug = lessonSlug(e.lesson);
        if (e.lesson === "0" || (slug !== undefined && DEFAULT_SURAHS.includes(slug))) continue;
        for (const src of e.sumber) for (const q of src.quotes) {
          // A quote that is (part of) one a shown step quotes is no leak: it is that step's.
          const sharedWithShown = RUMUS.steps.some((o) => o.step !== e.step && (o.lesson === "0" || lessonSlug(o.lesson) === "al-fatihah") && o.sumber.some((x) => x.quotes.some((oq) => oq.includes(q))));
          if (!sharedWithShown) expect(html, `${e.step} ${src.page}`).not.toContain(q);
        }
        // (a sentence a shown step's own formula or limit also holds is that step's, not a leak)
        const lead = stripMarked(e.rumus).slice(0, 40);
        const shownText = RUMUS.steps.filter((o) => o.lesson === "0" || lessonSlug(o.lesson) === "al-fatihah").map((o) => stripMarked(`${o.rumus} ${o.awas ?? ""}`));
        if (!shownText.some((t) => t.includes(lead))) expect(visible(html), e.step).not.toContain(lead);
      }
      for (const slug of HIDDEN) expect(html, slug).not.toMatch(new RegExp(`quran/${slug}(?![A-Za-z0-9-])`));
    }
  });

  it("with every surah listed: every step of a written lesson is drawn with its formula; Ayat Kursi stays marked", async () => {
    const html = await rumus("id", SURAH_SLUGS);
    for (const b of blocks(html)) {
      const unit = CURRICULUM.units.find((u) => u.id === CURRICULUM.lessons.find((l) => l.id === step(b.id).lesson)!.unit)!;
      const open = unit.slug !== undefined || step(b.id).lesson === "0";
      expect(b.state, b.id).toBe(!open ? "locked" : entry(b.id) ? "shown" : "none");
    }
    // The hidden units' quotes are on the page now.
    expect(html).toContain(entry("badal")!.sumber[0].quotes[0]);
    expect(html).toContain(entry("kana")!.sumber[0].quotes[0]);
    expect(html).not.toContain(entry("zharaf")!.sumber[0].quotes[0]);
  });

  it("with the host hidden, lesson zero's formula goes too (the introduction's rule)", async () => {
    const html = await rumus("id", ["an-nas"]);
    expect(blocks(html).find((b) => b.id === "kalimah")!.state).toBe("locked");
    expect(html).not.toContain(entry("kalimah")!.sumber[0].quotes[0]);
  });
});

describe("a shown step: formula, example, limit, basis", () => {
  it("draws the formula through the terms (their Arabic isolated), the example from the lesson, and the quotes as the page gave them", async () => {
    const html = await rumus("id");
    for (const b of blocks(html).filter((x) => x.state === "shown")) {
      const e = entry(b.id)!;
      // formula and limit
      expect(b.html, b.id).toContain("data-rumus-formula");
      expect(b.html.includes("data-rumus-awas"), b.id).toBe(e.awas !== undefined);
      // the plain text of the formula is the file's, markup stripped (terms add their Arabic after)
      const words = stripMarked(e.rumus).split(/\s+/).filter((w) => !/^[(“]/.test(w)).slice(0, 3);
      const formula = text(/data-rumus-formula[^>]*>([\s\S]*?)<\/p>/.exec(b.html)![1]);
      for (const w of words) expect(formula, `${b.id}: ${w}`).toContain(w.replace(/[.,;:]+$/, ""));
      // example: the lesson's word, link to its ayah
      const ex = /data-rumus-example="([^"]+)"/.exec(b.html);
      expect(ex?.[1], b.id).toBe(e.example?.loc);
      if (e.example) {
        const w = WORD_INFO[e.example.loc];
        expect(b.html, b.id).toContain(w.ar);
        expect(text(b.html), b.id).toContain(w.translit);
        const [s, a] = e.example.loc.split(":").map(Number);
        const slug = CURRICULUM.units.find((u) => u.surah === s && u.slug)!.slug!;
        expect(b.html, b.id).toContain(`href="/belajar/id/quran/${slug}/${a}#w-${e.example.loc.replaceAll(":", "-")}"`);
      }
      // basis: each source's kitab, page, section, quotes, address — byte for byte
      const srcs = [...b.html.matchAll(/data-rumus-source="([^"]+)"([\s\S]*?)<\/li>/g)];
      expect(srcs.map((m) => m[1]), b.id).toEqual(e.sumber.map((s) => s.page));
      srcs.forEach((m, k) => {
        const s = e.sumber[k];
        const quotes = [...m[2].matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/g)].map((q) => decode(q[1]));
        expect(quotes, `${b.id} ${s.page}`).toEqual(s.quotes);
        expect(m[2], `${b.id} ${s.page}`).toContain(`href="${s.url}"`);
        expect(text(m[2]), `${b.id} ${s.page}`).toContain(`hlm. ${s.hlm}`);
        expect(m[2]).toContain(s.bab);
      });
    }
  });

  it("every Arabic run is isolated: a bdi, or the kitab's quote in a right-to-left block, at the 24px floor", async () => {
    const html = await rumus("id");
    const rest = html.replace(/<bdi\b[^>]*>[\s\S]*?<\/bdi>/g, "").replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/g, "");
    expect(hasArabic(rest.replace(/<[^>]+>/g, " "))).toBe(false);
    for (const m of html.matchAll(/<blockquote\b([^>]*)>/g)) {
      expect(m[1]).toContain('lang="ar"');
      expect(m[1]).toContain('dir="rtl"');
      expect(m[1]).toMatch(/\barabic-inline\b[^"]*\btext-ar-sm\b/);
    }
    expect([...html.matchAll(/<blockquote\b/g)].length).toBeGreaterThan(20);
  });

  it("is printable: one column, the header controls hidden, each step kept whole", async () => {
    const html = await rumus("id");
    expect(html).toContain('data-rumus-sheet=""');
    expect(html).toContain('data-print-hide=""');
    expect(html).toMatch(/<li data-rumus-step="[^"]+"[^>]*class="[^"]*print:break-inside-avoid/);
    const css = read("src/app/globals.css");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toContain("[data-rumus-sheet] [data-rumus-step]");
    expect(print).toContain("break-inside: avoid");
    expect(print).toMatch(/body:has\(\[data-rumus-sheet\]\) > header/);
    // The footer, with its label, is not hidden.
    expect(print).not.toMatch(/> footer/);
    // No script is needed to print: the sheet has no button of its own.
    expect(html).not.toMatch(/window\.print|onclick/i);
  });
});

describe("the page's own words", () => {
  it("says what it is, that each formula restates a kitab sentence, the AI label, and that it complements the lesson", async () => {
    for (const locale of ["id", "en"] as const) {
      const v = visible(await rumus(locale));
      for (const k of ["intro_what", "intro_sources", "intro_label", "intro_with_lesson", "list_heading"] as const) expect(v, k).toContain(MSG[locale].Rumus[k]);
    }
    // The label is the footer's own claim (messages Footer.disclaimer), nothing more: no promise of
    // a human review, a date or a ruling.
    for (const locale of ["id", "en"] as const) {
      for (const [k, value] of Object.entries(MSG[locale].Rumus)) {
        expect(value, `${locale} ${k}`).not.toMatch(/\b(ketuk|mengetuk|diketuk|tap)\b/i);
        expect(value, `${locale} ${k}`).not.toMatch(/ustadz|reviewed|ditinjau|tinjauan|verified by|diverifikasi|\bsegera\b|coming soon|akan tersedia|bulan depan/i);
        expect(value, `${locale} ${k}`).not.toMatch(/\b[A-Z]{3,}\b/);
        expect(value.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ""), `${locale} ${k}`).not.toMatch(/\d/);
      }
    }
    expect(MSG.id.Rumus.intro_label).toMatch(/^Dibantu AI, bukan fatwa otoritatif\./);
    expect(MSG.en.Rumus.intro_label).toMatch(/^AI-assisted, not an authoritative fatwa\./);
  });

  it("is linked from the track page and from the curriculum page, each once, through the route helper", async () => {
    for (const locale of ["id", "en"] as const) {
      const track = await render(QuranTrackPage as unknown as PageFn, locale);
      expect(track.match(/data-rumus-link=""/g)).toHaveLength(1);
      expect(track).toContain(`href="/belajar/${locale}${rumusHref()}"`);
      expect(visible(track)).toContain(MSG[locale].Quran.rumus_link);
      const curriculum = await render(CurriculumPage as unknown as PageFn, locale);
      expect(curriculum.match(/data-rumus-link=""/g)).toHaveLength(1);
      expect(curriculum).toContain(`href="/belajar/${locale}${rumusHref()}"`);
      // … and the sheet links back to the curriculum.
      expect(await rumus(locale)).toContain(`href="/belajar/${locale}${curriculumHref()}"`);
    }
    for (const f of ["src/app/[locale]/quran/page.tsx", "src/app/[locale]/quran/kurikulum/page.tsx", "src/app/[locale]/quran/rumus/page.tsx"]) {
      expect(read(f), f).toMatch(/rumusHref\(\)|curriculumHref\(\)/);
    }
  });

  it("reads the switch at request time through the one helper, and builds no lesson link itself", () => {
    const page = read("src/app/[locale]/quran/rumus/page.tsx");
    expect(page).toContain("await visibleSurahs()");
    expect(page).toContain("introOpen(published)");
    expect(page).not.toMatch(/\b(ayahHref|surahHref|lessonHref)\(/);
    expect(read("src/components/rumus/RumusSheet.tsx")).not.toMatch(/\b(ayahHref|surahHref|lessonHref)\(/);
    // The one rule: the sheet asks the curriculum page's own function.
    expect(read("src/lib/rumusSheet.ts")).toContain("lessonLink(l, unit, { published, intro })");
    // No second list of surahs in the page's own code.
    for (const f of ["src/app/[locale]/quran/rumus/page.tsx", "src/components/rumus/RumusSheet.tsx", "src/lib/rumusSheet.ts"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      for (const slug of SURAH_SLUGS) expect(src, `${f} types ${slug}`).not.toContain(slug);
      expect(src, f).not.toMatch(/Al-Fatihah|An-Nas|Al-Falaq|Al-Ikhlas|Ayat Kursi/);
    }
  });

  it("has its own share card in its own folder, canonical and og:url from the route helper", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: "id" }) } as never);
    expect(meta.alternates?.canonical).toBe("https://dakwah-lens.id/belajar/id/quran/rumus");
    expect((meta.openGraph as { images: { url: string }[] }).images[0].url).toBe("https://dakwah-lens.id/belajar/id/quran/rumus/og");
    expect(existsSync(join(BELAJAR, "src/app/[locale]", `${rumusHref().slice(1)}/og/route.ts`))).toBe(true);
    for (const locale of ["id", "en"] as const) for (const v of [MSG[locale].Og.rumus_title, MSG[locale].Og.rumus_body]) {
      expect(hasArabic(v)).toBe(false);
    }
  });
});
