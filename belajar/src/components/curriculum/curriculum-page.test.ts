import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CurriculumPage, { generateMetadata } from "@/app/[locale]/quran/kurikulum/page";
import QuranTrackPage from "@/app/[locale]/quran/page";
import { mapLatinName } from "@/lib/autoplay/lessonMap";
import { SURAHS } from "@/lib/content";
import { CURRICULUM } from "@/lib/curriculum";
import { DEFAULT_SURAHS } from "@/lib/features";
import { LIBRARY, TERMS } from "@/lib/library";
import { curriculumHref, SURAH_SLUGS } from "@/lib/routes";
import { Scope, termDisplay, titleParts } from "@/lib/terms";
import { ARABIC_RUN, hasArabic } from "@/lib/textUnits";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

// THE CURRICULUM PAGE, /quran/kurikulum (operator 2026-10-13: "we should also explain this
// curriculum in the page"; docs/belajar-plan.md L27), rendered whole — the page's own server
// component, in both locales, as production runs it (Al-Fatihah only) and with every surah
// listed — and held to content/curriculum.json: every lesson once, in order; its new steps and
// its running total; no link to a lesson visitors cannot reach; the Arabic isolated as MixedText
// isolates it. And the block on the track page that introduces it. That a browser DRAWS it
// without a bad line break is CI's (scripts/ci/linebreaks.mjs, screenshots.mjs).

type Locale = "id" | "en";
const MSG = { id, en } as const;
/** The request's locale, for the mocks below (the page reads it from the request). */
const request = vi.hoisted(() => ({ locale: "id" as "id" | "en" }));

// connection() needs a live Next request (lib/features.ts visibleSurahs()).
vi.mock("next/server", () => ({ connection: async () => undefined }));
// The page's translators, from the real message files.
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
// The app's Link, drawn as the server draws it: the basePath and the locale in front of the path
// (so the checks below read the addresses CI's smoke script reads).
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
/** The switch as a container has it: unset (production) or a list of slugs. */
function setSurahs(published: readonly string[] | undefined) {
  if (published === undefined) delete process.env.BELAJAR_SURAHS;
  else process.env.BELAJAR_SURAHS = published.join(",");
}

type PageFn = (props: { params: Promise<{ locale: string }> }) => Promise<ReactNode>;
async function render(page: PageFn, locale: Locale, published?: readonly string[]): Promise<string> {
  request.locale = locale;
  setSurahs(published);
  const tree = await page({ params: Promise.resolve({ locale }) });
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MSG[locale], timeZone: "Asia/Jakarta", children: tree };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}
const curriculum = (locale: Locale, published?: readonly string[]) => render(CurriculumPage as unknown as PageFn, locale, published);
const track = (locale: Locale, published?: readonly string[]) => render(QuranTrackPage as unknown as PageFn, locale, published);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? all),
  );
/** The text of a fragment as a reader gets it (tags dropped; the DOM text of MixedText is its input). */
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ""));
/** The same with a space where a tag was, for looking a sentence up in a whole page. */
const visible = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
/** Every <a …> of a fragment, with its attributes and its text. */
const anchors = (html: string) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ ...attrs(m[1]), text: text(m[2]) }) as Record<string, string>);

/** The lesson blocks of the page, in the order it draws them. */
function lessonBlocks(html: string) {
  const at = [...html.matchAll(/<li data-lesson="([^"]+)" data-available="(true|false)"/g)];
  const end = html.indexOf('<section class="mt-12" aria-labelledby="lanjut"');
  return at.map((m, k) => ({ id: m[1], available: m[2] === "true", html: html.slice(m.index, at[k + 1]?.index ?? (end < 0 ? html.length : end)) }));
}
/** One group of a lesson block (a <div data-group> holds no other div), or null. */
const group = (block: string, name: "new" | "review" | "learnt"): string | null => new RegExp(`<div data-group="${name}"[^>]*>([\\s\\S]*?)</div>`).exec(block)?.[1] ?? null;
const stepItems = (html: string) => [...html.matchAll(/<li data-step="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], html: m[2], text: text(m[2]) }));

const t = (locale: Locale) => createTranslator({ locale, messages: MSG[locale], namespace: "Curriculum" });
const lesson = (lid: string) => CURRICULUM.lessons.find((l) => l.id === lid)!;
const step = (sid: string) => CURRICULUM.steps.find((s) => s.id === sid)!;
const unit = (uid: string) => CURRICULUM.units.find((u) => u.id === uid)!;
const HIDDEN: readonly string[] = SURAH_SLUGS.filter((s) => !DEFAULT_SURAHS.includes(s));
/** A link into a surah's lesson pages, rendered or in the RSC payload: scripts/ci/surahs-smoke.mjs linkInto. */
const linkInto = (slug: string) => new RegExp(`(?:/belajar|\\\\?")/(?:(?:id|en)/)?quran/${slug}(?![A-Za-z0-9-])`);
/** The lessons that may be links with these surahs published: written ayah lessons of a published surah. */
const reachable = (published: readonly string[]) =>
  CURRICULUM.lessons.filter((l) => l.map && l.ayah !== undefined && l.segment === undefined && published.includes(unit(l.unit).slug ?? "")).map((l) => l.id);

describe("the curriculum page lists the file: every lesson once, in order, with what is new and the running total", () => {
  for (const locale of ["id", "en"] as const) {
    it(`${locale}: every lesson of content/curriculum.json appears once, in teaching order, under its unit`, async () => {
      const html = await curriculum(locale);
      expect(lessonBlocks(html).map((b) => b.id)).toEqual(CURRICULUM.lessons.map((l) => l.id));
      const units = [...html.matchAll(/<section data-unit="([^"]+)"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => [m[1], text(m[2])]);
      expect(units.map((u) => u[0])).toEqual(CURRICULUM.units.map((u) => u.id));
      // A surah unit keeps the file's name in both locales; the unit of the lesson with no ayah has
      // a message, which in Indonesian is the file's own word.
      expect(units.map((u) => u[1])).toEqual(CURRICULUM.units.map((u) => (u.surah === undefined ? MSG[locale].Curriculum.intro_unit : u.name)));
      for (const u of CURRICULUM.units.filter((x) => x.surah === undefined)) expect(MSG.id.Curriculum.intro_unit).toBe(u.name);
      // Real headings, in order: h1, then h2 sections, h3 units, h4 lessons.
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1])).toBe(MSG[locale].Curriculum.title);
      expect([...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]))).toEqual([MSG[locale].Curriculum.list_heading, MSG[locale].Curriculum.next_heading]);
      expect(html.match(/<h4\b/g)).toHaveLength(CURRICULUM.lessons.length);
    });

    it(`${locale}: a lesson's new steps and its running total are the file's, new and already-learnt apart`, async () => {
      const html = await curriculum(locale);
      const tr = t(locale);
      const tl = createTranslator({ locale, messages: MSG[locale], namespace: "Lesson" });
      for (const b of lessonBlocks(html)) {
        const l = lesson(b.id);
        // Its name: the introduction, the ayah, or the segment of a long ayah.
        const name = text(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(b.html)![1]);
        expect(name, b.id).toBe(l.surah === undefined ? tr("lesson_intro") : l.segment !== undefined ? tr("lesson_segment", { n: l.segment }) : tl("ayah", { n: l.ayah! }));
        const fresh = group(b.html, "new");
        const review = group(b.html, "review");
        const learnt = group(b.html, "learnt");
        // NEW: the file's steps, in its order, each by its caption name, byte for byte.
        expect(stepItems(fresh ?? "").map((s) => s.id), b.id).toEqual(l.steps);
        expect(stepItems(fresh ?? "").map((s) => s.text), b.id).toEqual(l.steps.map((sid) => step(sid).name));
        if (l.steps.length > 0) {
          expect(visible(fresh!), b.id).toContain(tr("new_heading"));
          expect(review, b.id).toBeNull();
        } else {
          // Nothing new: the lesson says that it reviews; the steps that come up again only where
          // the built file has them (a written lesson), by their Latin names.
          expect(fresh, b.id).toBeNull();
          expect(visible(review!), b.id).toContain(tr("review_heading"));
          expect(visible(review!), b.id).toContain(tr("review_body"));
          const again = l.map ? l.map.learnt.filter((x) => x.here).map((x) => x.id) : [];
          expect(stepItems(review!).map((s) => s.id), b.id).toEqual(again);
          expect(stepItems(review!).map((s) => s.text.replace(/,$/, "")), b.id).toEqual(again.map((sid) => mapLatinName(step(sid).name)));
          if (again.length) expect(visible(review!), b.id).toContain(tr("again", { n: again.length }));
          else expect(review!, b.id).not.toContain("data-again");
        }
        // LEARNT SO FAR: the file's running count after this lesson, in a group of its own.
        expect(visible(learnt!).trim(), b.id).toBe(tr("learnt", { n: l.after }));
        expect(stepItems(learnt!), b.id).toEqual([]);
      }
      // The met-again list is shown somewhere, and left out somewhere (not vacuous).
      expect(html.match(/<ul data-again=""/g)?.length).toBe(CURRICULUM.lessons.filter((l) => l.steps.length === 0 && l.map?.learnt.some((x) => x.here)).length);
      expect(CURRICULUM.lessons.some((l) => l.steps.length === 0 && !l.map)).toBe(true);
    });
  }

  it("each unit says how many lessons and new steps it has, counted from the file", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await curriculum(locale);
      for (const u of CURRICULUM.units) {
        const lessons = CURRICULUM.lessons.filter((l) => l.unit === u.id);
        const head = new RegExp(`<section data-unit="${u.id}"[^>]*>\\s*<h3[^>]*>[\\s\\S]*?</h3>\\s*<p[^>]*>([\\s\\S]*?)</p>`).exec(html)!;
        expect(text(head[1]), `${locale} ${u.id}`).toBe(t(locale)("unit_meta", { lessons: lessons.length, steps: lessons.reduce((n, l) => n + l.steps.length, 0) }));
      }
    }
  });

  it("the introduction's figures are counted from the file, never typed", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = visible(await curriculum(locale));
      const readings = CURRICULUM.units.filter((u) => u.surah !== undefined).map((u) => u.name);
      const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(readings);
      expect(html).toContain(t(locale)("intro_scope", { count: readings.length, list }));
      const max = Math.max(...CURRICULUM.lessons.map((l) => l.steps.length));
      expect(html).toContain(t(locale)("intro_pace", { max, lessons: CURRICULUM.lessons.length, steps: CURRICULUM.steps.length }));
      expect(html).toContain(MSG[locale].Curriculum.intro_later);
      expect(html).toContain(MSG[locale].Curriculum.list_help);
      for (const name of readings) expect(list).toContain(name);
    }
    // The sentences hold no digit of their own: every number is a placeholder.
    for (const locale of ["id", "en"] as const) {
      for (const [key, value] of Object.entries(MSG[locale].Curriculum)) expect(value.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ""), `${locale} Curriculum.${key}`).not.toMatch(/\d/);
    }
  });
});

describe("a step with a Konsep page links to it; its Arabic is isolated as MixedText isolates it", () => {
  it("links the new steps that have a page, and only those", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await curriculum(locale);
      for (const b of lessonBlocks(html)) {
        for (const s of stepItems(group(b.html, "new") ?? "")) {
          const page = step(s.id).concept ?? step(s.id).basics;
          const links = anchors(s.html);
          if (page) {
            expect(links.map((a) => a.href), s.id).toEqual([`/belajar/${locale}/konsep/${page}`]);
            // The link is the whole name; its Latin words carry the underline (the link cue), its
            // Arabic never does.
            expect(links[0].text, s.id).toBe(step(s.id).name);
            expect(s.html, s.id).toContain('class="link-text"');
            expect(s.html, s.id).not.toMatch(/<span class="link-text">[^<]*[؀-ۿ]/);
          } else {
            expect(links, s.id).toEqual([]);
            expect(s.html, s.id).not.toContain("link-text");
          }
        }
      }
      // Every Konsep page a step is linked to exists (konsep/[id] generateStaticParams).
      const pages = new Set([...LIBRARY.basics.map((x) => x.id), ...LIBRARY.concepts.map((x) => x.id)]);
      for (const a of anchors(html)) {
        const m = /^\/belajar\/(?:id|en)\/konsep\/(.+)$/.exec(a.href ?? "");
        if (m) expect(pages.has(m[1]), a.href).toBe(true);
      }
    }
  });

  it("every Arabic run is in a bdi; in the lessons, <bdi lang=\"ar\" dir=\"rtl\"> at the 24px floor, one per run of the names", async () => {
    const html = await curriculum("id");
    // Nothing Arabic outside a bdi, anywhere on the page.
    expect(hasArabic(html.replace(/<bdi\b[^>]*>[\s\S]*?<\/bdi>/g, ""))).toBe(false);
    const outline = html.slice(html.indexOf('<ol data-curriculum="units"'), html.indexOf('<section class="mt-12" aria-labelledby="lanjut"'));
    const bdis = [...outline.matchAll(/<bdi\b([^>]*)>([\s\S]*?)<\/bdi>/g)];
    for (const m of bdis) {
      expect(attrs(m[1]), m[2]).toMatchObject({ lang: "ar", dir: "rtl" });
      expect(attrs(m[1]).class.split(" "), m[2]).toEqual(expect.arrayContaining(["arabic-inline", "text-ar-sm"]));
    }
    const runs = CURRICULUM.steps.flatMap((s) => step(s.id).name.match(ARABIC_RUN) ?? []);
    expect(runs.length).toBeGreaterThan(10);
    expect(bdis.map((m) => text(m[2]))).toEqual(runs);
    // The next level's headwords: a bdi inside the right-to-left Arabic box (TermText Headword).
    const next = html.slice(html.indexOf('<section class="mt-12" aria-labelledby="lanjut"'));
    expect(next.match(/<span lang="ar" dir="rtl" class="arabic-inline[^"]*"/g)?.length).toBeGreaterThan(0);
    // What a phone does not show must not be rendered at all: no visually hidden text here (the
    // line-break check measures a 1px box as a line).
    expect(html).not.toContain("sr-only");
    // And nothing scrolls sideways by design: lists, never a table.
    expect(html).not.toMatch(/<table\b|overflow-x-auto|overflow-x-scroll/);
  });
});

describe("availability comes from the data: BELAJAR_SURAHS, the switch the track page reads", () => {
  it("as production runs: only Al-Fatihah's lessons are links; the rest is plain text marked “Belum tersedia”", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await curriculum(locale);
      const want = reachable(DEFAULT_SURAHS);
      expect(want).toEqual(SURAHS.find((s) => s.slug === "al-fatihah")!.ayat.map((a) => `1:${a.ayah}`));
      const mark = MSG[locale].Curriculum.unavailable;
      for (const b of lessonBlocks(html)) {
        const l = lesson(b.id);
        const links = anchors(b.html).filter((a) => "data-lesson-link" in a);
        const into = anchors(b.html).filter((a) => /\/quran\//.test(a.href ?? ""));
        if (want.includes(b.id)) {
          expect(b.available, b.id).toBe(true);
          expect(links.map((a) => a.href), b.id).toEqual([`/belajar/${locale}/quran/${unit(l.unit).slug}/${l.ayah}`]);
          expect(into, b.id).toHaveLength(1);
          // The link says where it goes: the surah and the ayah.
          expect(links[0].text, b.id).toBe(t(locale)("open_ayah", { unit: unit(l.unit).name, n: l.ayah! }));
          expect(visible(b.html), b.id).not.toContain(mark);
        } else {
          expect(b.available, b.id).toBe(false);
          expect(links, b.id).toEqual([]);
          expect(into, b.id).toEqual([]);
          // Said in words, in a plain element with nothing to click or focus.
          const pill = /<span data-lesson-status=""[^>]*>([\s\S]*?)<\/span>\s*<\/span>/.exec(b.html);
          expect(text(pill?.[1] ?? ""), b.id).toBe(mark);
          expect(pill![1], b.id).not.toMatch(/<(a|button|input|summary)\b|tabindex/);
        }
      }
      // What CI's smoke script counts and looks for (scripts/ci/surahs-smoke.mjs).
      expect(visible(html).split(mark).length - 1).toBe(CURRICULUM.lessons.length - want.length);
      for (const slug of HIDDEN) {
        expect(html, slug).not.toMatch(linkInto(slug));
        expect(html, slug).not.toContain(`quran/${slug}`);
      }
      // The hidden surahs and Ayat Kursi are named, as plain text.
      for (const u of CURRICULUM.units.filter((x) => x.surah !== undefined)) expect(visible(html), u.id).toContain(u.name);
    }
  });

  it("lesson “0” (the introduction) has no link, whatever is published: it has no route yet", async () => {
    for (const published of [undefined, SURAH_SLUGS] as const) {
      const html = await curriculum("id", published);
      const b = lessonBlocks(html)[0];
      expect(b.id).toBe("0");
      expect(b.available).toBe(false);
      expect(anchors(b.html).filter((a) => /\/quran\//.test(a.href ?? ""))).toEqual([]);
      expect(visible(b.html)).toContain(MSG.id.Curriculum.unavailable);
      // Its new steps still link to their Konsep pages.
      expect(anchors(b.html).map((a) => a.href)).toEqual(lesson("0").steps.flatMap((sid) => (step(sid).concept ?? step(sid).basics ? [`/belajar/id/konsep/${step(sid).concept ?? step(sid).basics}`] : [])));
    }
  });

  it("with every surah listed: every written ayah lesson is a link; Ayat Kursi and the introduction stay plain", async () => {
    const html = await curriculum("id", SURAH_SLUGS);
    const want = reachable(SURAH_SLUGS);
    expect(want).toHaveLength(SURAHS.reduce((n, s) => n + s.ayat.length, 0));
    const linked = lessonBlocks(html).filter((b) => b.available).map((b) => b.id);
    expect(linked).toEqual(want);
    expect(anchors(html).filter((a) => "data-lesson-link" in a).map((a) => a.href)).toEqual(want.map((lid) => `/belajar/id/quran/${unit(lesson(lid).unit).slug}/${lesson(lid).ayah}`));
    expect(visible(html).split(MSG.id.Curriculum.unavailable).length - 1).toBe(CURRICULUM.lessons.length - want.length);
    for (const slug of HIDDEN) expect(html, slug).toMatch(linkInto(slug));
  });

  it("the page reads the switch at request time, through the one helper, and links a lesson through the one route helper", () => {
    const page = read("src/app/[locale]/quran/kurikulum/page.tsx");
    expect(page).toContain("await visibleSurahs()");
    expect(page).not.toMatch(/\b(ayahHref|surahHref|lessonHref)\(/);
    // No second list of surahs anywhere in the page's own code.
    for (const f of ["src/app/[locale]/quran/kurikulum/page.tsx", "src/components/curriculum/CurriculumOutline.tsx", "src/lib/curriculumOutline.ts"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      for (const slug of SURAH_SLUGS) expect(src, `${f} types ${slug}`).not.toContain(slug);
      expect(src, f).not.toMatch(/Al-Fatihah|An-Nas|Al-Falaq|Al-Ikhlas|Ayat Kursi/);
    }
    const outline = read("src/lib/curriculumOutline.ts");
    expect(outline.match(/\blessonHref\(/g)).toHaveLength(1);
    expect(outline).not.toMatch(/\b(ayahHref|surahHref)\(/);
    expect(read("src/components/curriculum/CurriculumOutline.tsx")).not.toMatch(/\b(ayahHref|surahHref|lessonHref)\(/);
  });
});

describe("the closing: what is left for the next level", () => {
  it("lists the file's `lanjut` records once each, grouped by the library's kind, each a link to its Konsep page", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await curriculum(locale);
      const next = html.slice(html.indexOf('<section class="mt-12" aria-labelledby="lanjut"'));
      const items = [...next.matchAll(/<li data-next-level-item="([^"]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], links: anchors(m[2]) }));
      const kind = (cid: string) => LIBRARY.concepts.find((c) => c.id === cid)!.kind;
      expect(items.map((i) => i.id)).toEqual([...CURRICULUM.lanjut.filter((c) => kind(c) === "sharaf"), ...CURRICULUM.lanjut.filter((c) => kind(c) === "nahwu")]);
      for (const i of items) {
        expect(i.links.map((a) => a.href), i.id).toEqual([`/belajar/${locale}/konsep/${i.id}`]);
        // The row's words are the record's own title, drawn as the Konsep index draws it (a
        // Qur'anic word in it with its Arabic), then its Arabic headword.
        const c = LIBRARY.concepts.find((x) => x.id === i.id)!;
        const { tokens, head } = titleParts(c.marked!.title, new Scope(), TERMS);
        expect(i.links[0].text, i.id).toBe(`${termDisplay(tokens).text}${head.map((h) => h.ar).join("·")}`);
        expect(i.links[0].text.startsWith(c.title.split(" (")[0]), i.id).toBe(true);
      }
      expect([...next.matchAll(/<section data-next-level="([^"]+)"/g)].map((m) => m[1])).toEqual(["sharaf", "nahwu"]);
      expect(visible(next)).toContain(t(locale)("next_body", { n: CURRICULUM.lanjut.length }));
      expect(visible(next)).toContain(MSG[locale].Curriculum.next_hint);
    }
  });
});

describe("what the page may not say", () => {
  it("no promise of a date or of a human review, no “ketuk”, no ALL CAPS, no “Segera hadir”", () => {
    for (const locale of ["id", "en"] as const) {
      const mine = [...Object.values(MSG[locale].Curriculum), MSG[locale].Quran.curriculum_heading, MSG[locale].Quran.curriculum_body, MSG[locale].Quran.curriculum_link, MSG[locale].Og.curriculum_title, MSG[locale].Og.curriculum_body];
      for (const v of mine) {
        expect(v, v).not.toMatch(/\b(ketuk|mengetuk|diketuk|tap)\b/i);
        expect(v, v).not.toMatch(/tinjauan|ditinjau|diperiksa ustadz|ustadz|reviewed by|\bsegera\b|coming soon|\bsoon\b|akan hadir|akan tersedia|bulan|pekan|minggu|\bweek|\bmonth/i);
        expect(v, v).not.toMatch(/\b[A-Z]{3,}\b/);
        expect(v, v).not.toMatch(/menguasai|master\b|fasih|fluent/i);
        expect(v, v).not.toContain(MSG[locale].Quran.coming_soon);
      }
    }
    expect(MSG.id.Curriculum.list_help).toMatch(/\bdiklik\b/);
    expect(MSG.id.Curriculum.next_hint).toMatch(/^Klik\b/);
  });

  it("the page carries no AI label of its own (the layout's footer has the one label), and no share card names a surah", async () => {
    const html = visible(await curriculum("id"));
    expect(html).not.toMatch(/Dibantu AI|bukan fatwa|Masa uji coba/);
    for (const locale of ["id", "en"] as const) {
      for (const v of [MSG[locale].Og.curriculum_title, MSG[locale].Og.curriculum_body]) for (const s of SURAHS) expect(v).not.toContain(s.name_id);
    }
  });
});

describe("metadata: as the track page does it", () => {
  it("title, description, canonical, alternates and the page's own share card", async () => {
    for (const locale of ["id", "en"] as const) {
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) } as Parameters<typeof generateMetadata>[0]);
      const url = (l: string) => `https://dakwah-lens.id/belajar/${l}${curriculumHref()}`;
      expect(meta.title).toBe(MSG[locale].Curriculum.title);
      expect(meta.description).toBe(MSG[locale].Curriculum.description);
      expect(meta.alternates).toEqual({ canonical: url(locale), languages: { id: url("id"), en: url("en"), "x-default": url("id") } });
      expect(meta.openGraph).toMatchObject({
        url: url(locale),
        title: MSG[locale].App.title_template.replace("%s", MSG[locale].Curriculum.title),
        description: MSG[locale].Curriculum.description,
        images: [{ url: `${url(locale)}/og`, width: 1200, height: 630 }],
      });
      expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [{ url: `${url(locale)}/og` }] });
      // robots is the locale layout's (noindex until BELAJAR_PUBLIC): the page sets none of its own.
      expect(meta.robots).toBeUndefined();
    }
    expect(read("src/app/[locale]/layout.tsx")).toContain("robots: IS_PUBLIC ? undefined : { index: false, follow: true }");
    // Its card is drawn by a route in the page's own folder, as the track's.
    expect(existsSync(join(BELAJAR, "src/app/[locale]/quran/kurikulum/og/route.ts"))).toBe(true);
    expect(read("src/app/[locale]/quran/kurikulum/og/route.ts")).toContain("cardResponse(curriculumCard(t))");
  });
});

describe("the track page introduces the curriculum and links to it", () => {
  it("one short block with one link, its figures counted from the file; the “Segera hadir” cards untouched", async () => {
    for (const locale of ["id", "en"] as const) {
      const html = await track(locale);
      const links = anchors(html).filter((a) => "data-curriculum-link" in a);
      expect(links.map((a) => [a.href, a.text])).toEqual([[`/belajar/${locale}${curriculumHref()}`, MSG[locale].Quran.curriculum_link]]);
      const tq = createTranslator({ locale, messages: MSG[locale], namespace: "Quran" });
      const max = Math.max(...CURRICULUM.lessons.map((l) => l.steps.length));
      const last = unit(CURRICULUM.lessons.at(-1)!.unit).name;
      expect(visible(html)).toContain(tq("curriculum_body", { max, last }));
      expect([...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]))).toContain(MSG[locale].Quran.curriculum_heading);
      // What CI's smoke and browser checks count on the track page (surahs-smoke.mjs,
      // screenshots.mjs comingSoonCheck): one "Segera hadir" per hidden surah, one card each, and
      // no link into them.
      expect(visible(html).split(MSG[locale].Quran.coming_soon).length - 1).toBe(HIDDEN.length);
      expect([...html.matchAll(/data-coming-soon="([^"]+)"/g)].map((m) => m[1])).toEqual(SURAHS.filter((s) => HIDDEN.includes(s.slug)).map((s) => s.slug));
      for (const slug of HIDDEN) expect(html, slug).not.toMatch(linkInto(slug));
    }
  });
});

describe("CI visits the page", () => {
  it("the smoke step, the surah-switch smoke, the brand smoke, the line-break check and the screenshots all name it", () => {
    const path = `/belajar/id${curriculumHref()}`;
    const ci = (f: string) => read(`scripts/ci/${f}`);
    // The line-break check measures it as a page of its own (never as a surah, whose address it
    // resembles), and shoots it at each text size.
    expect(ci("linebreaks.mjs")).toContain(`const CURRICULUM = "${path}";`);
    expect(ci("linebreaks.mjs")).toContain('["kurikulum", CURRICULUM],');
    expect(ci("linebreaks.mjs")).toContain("if (p === CURRICULUM) curriculumLinked = true;");
    expect(ci("linebreaks.mjs")).toContain('kurikulum: "kurikulum"');
    // The screenshots: phone and desktop, as production shows it and with every surah listed,
    // with the browser check in both runs.
    expect(ci("screenshots.mjs")).toContain(`const CURRICULUM = "${path}";`);
    expect(ci("screenshots.mjs")).toContain('["kurikulum", CURRICULUM],');
    expect(ci("screenshots.mjs")).toContain('["kurikulum-semua-surah", CURRICULUM],');
    expect(ci("screenshots.mjs")).toContain("await curriculumCheck(page, vp, false);");
    expect(ci("screenshots.mjs")).toContain("await curriculumCheck(page, vp, true);");
    // The surah-switch smoke: hidden (production) and with every surah listed.
    expect(ci("surahs-smoke.mjs")).toContain("const path = `/belajar/${locale}/quran/kurikulum`;");
    expect(ci("surahs-smoke.mjs")).toContain("await curriculumPage(DEFAULT, hidden);");
    expect(ci("surahs-smoke.mjs")).toContain("await curriculumPage(SLUGS, []);");
    expect(ci("brand-smoke.mjs")).toContain("const curriculumPath = `/belajar/${locale}/quran/kurikulum`;");
    // The smoke script reads a link into a hidden surah with the pattern this test uses.
    const pattern = /const linkInto = \(slug\) => new RegExp\(`([^`]+)`\);/.exec(ci("surahs-smoke.mjs"))?.[1];
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!.replace("${slug}", "an-nas").replace(/\\\\/g, "\\")).source).toBe(linkInto("an-nas").source);
    // What the scripts read from the page's markup is what the page writes.
    const outline = read("src/components/curriculum/CurriculumOutline.tsx");
    expect(outline).toContain("<li data-lesson={lesson.id} data-available={String(lesson.href !== null)}");
    expect(ci("surahs-smoke.mjs")).toContain('data-lesson="([^"]+)" data-available="(true|false)"');
    const wf = join(BELAJAR, "..", ".github", "workflows", "deploy-belajar.yml");
    if (!existsSync(wf)) return;
    const yaml = readFileSync(wf, "utf8");
    expect(yaml).toContain(`${path} /belajar/en${curriculumHref()}`);
    expect(yaml).toContain(`grep -q 'href="${path}"' <<<"$track"`);
  });
});
