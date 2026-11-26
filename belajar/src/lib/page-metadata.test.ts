import type { Metadata } from "next";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { generateMetadata as hub } from "@/app/[locale]/page";
import { generateMetadata as konsepIndex } from "@/app/[locale]/konsep/page";
import { generateMetadata as konsep } from "@/app/[locale]/konsep/[id]/page";
import { generateMetadata as lexeme } from "@/app/[locale]/kosakata/[id]/page";
import { generateMetadata as batch } from "@/app/[locale]/kosakata/bertahap/[level]/[batch]/page";
import { generateMetadata as batchTest } from "@/app/[locale]/kosakata/bertahap/[level]/[batch]/tes/page";
import { generateMetadata as levelTest } from "@/app/[locale]/kosakata/bertahap/[level]/tes/page";
import { generateMetadata as path } from "@/app/[locale]/kosakata/bertahap/page";
import { generateMetadata as word } from "@/app/[locale]/kosakata/kata/[rank]/page";
import { generateMetadata as list } from "@/app/[locale]/kosakata/page";
import { generateMetadata as credits } from "@/app/[locale]/kredit/page";
import { generateMetadata as intro } from "@/app/[locale]/quran/pengantar/page";
import { generateMetadata as track } from "@/app/[locale]/quran/page";
import { generateMetadata as rumus } from "@/app/[locale]/quran/rumus/page";
import { generateMetadata as curriculum } from "@/app/[locale]/quran/kurikulum/page";
import { generateMetadata as surah } from "@/app/[locale]/quran/[surah]/page";
import { generateMetadata as ayah } from "@/app/[locale]/quran/[surah]/[ayah]/page";

import { SURAHS } from "./content";
import { LEXEMES } from "./lexemes";
import { LIBRARY } from "./library";
import { NOINDEX } from "./seo";

import en from "../../messages/en.json";
import id from "../../messages/id.json";

// THE PAGES' OWN SEARCH-ENGINE METADATA (docs/belajar-plan.md L42): each indexable page type has its own
// title and description, an absolute canonical address that is its own, no hreflang while only Indonesian
// is indexed, and no robots tag of its own unless it is to stay out of the index. Called as Next calls
// them, without a build; scripts/ci/seo-smoke.mjs reads the same things off the real pages.

const MSG = { id, en } as const;
const request = vi.hoisted(() => ({ locale: "id" as "id" | "en" }));

vi.mock("next/server", () => ({ connection: async () => undefined }));
// src/lib/kosakata.ts and src/lib/ayat.ts are server-only (src/lib/ayah.test.ts does the same).
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async () => {
  const intl = await import("next-intl");
  const messages = { id: (await import("../../messages/id.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    setRequestLocale: () => undefined,
    getMessages: async () => messages[request.locale],
    getTranslations: async (arg?: string | { locale?: string; namespace?: string }) => {
      const locale = ((typeof arg === "object" ? arg?.locale : undefined) ?? request.locale) as "id" | "en";
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return intl.createTranslator({ locale, messages: messages[locale], namespace } as Parameters<typeof intl.createTranslator>[0]);
    },
  };
});
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push() {} }),
  usePathname: () => "/",
  redirect: () => undefined,
  getPathname: () => "/",
  Link: ({ href, children, ...rest }: { href: unknown; children?: ReactNode }) => createElement("a", { ...rest, href: String(href) }, children),
}));

type Locale = "id" | "en";
type Props = { locale: Locale } & Record<string, string>;
type MetaFn = (props: never) => Promise<Metadata>;

const saved = {
  path: process.env.BELAJAR_KOSAKATA_BERTAHAP,
  words: process.env.BELAJAR_KOSAKATA_WORDS_INDEXED,
};
beforeEach(() => {
  process.env.BELAJAR_KOSAKATA_BERTAHAP = "on";
  delete process.env.BELAJAR_KOSAKATA_WORDS_INDEXED;
});
afterEach(() => {
  for (const [key, value] of [["BELAJAR_KOSAKATA_BERTAHAP", saved.path], ["BELAJAR_KOSAKATA_WORDS_INDEXED", saved.words]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function meta(fn: MetaFn, props: Props, search: Record<string, string | string[]> = {}): Promise<Metadata> {
  request.locale = props.locale;
  return fn({ params: Promise.resolve(props), searchParams: Promise.resolve(search) } as never);
}
const titleOf = (m: Metadata): string => (typeof m.title === "string" ? m.title : ((m.title as { absolute?: string; default?: string } | null)?.absolute ?? ""));
const BASE = "https://dakwah-lens.id/belajar";
const SOME_CONCEPT = LIBRARY.concepts[0].id;
const SOME_LEXEME = LIBRARY.lexicon[0].id;
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;

describe("each page names its own canonical address, which is absolute, and no hreflang alternates", () => {
  const cases: [string, MetaFn, Record<string, string>, string][] = [
    ["the hub", hub, {}, ""],
    ["the track", track, {}, "/quran"],
    ["a surah", surah, { surah: "al-fatihah" }, "/quran/al-fatihah"],
    ["an ayah", ayah, { surah: "al-fatihah", ayah: "3" }, "/quran/al-fatihah/3"],
    ["lesson zero", intro, {}, "/quran/pengantar"],
    ["the curriculum", curriculum, {}, "/quran/kurikulum"],
    ["the cheat sheet", rumus, {}, "/quran/rumus"],
    ["the Konsep index", konsepIndex, {}, "/konsep"],
    ["a Konsep page", konsep, { id: SOME_CONCEPT }, `/konsep/${SOME_CONCEPT}`],
    ["the Harakat page", konsep, { id: "harakat" }, "/konsep/harakat"],
    ["a lesson word's entry", lexeme, { id: SOME_LEXEME }, `/kosakata/${SOME_LEXEME}`],
    ["the learning path", path, {}, "/kosakata/bertahap"],
    ["a word", word, { rank: "12" }, "/kosakata/kata/12"],
    ["the credits", credits, {}, "/kredit"],
  ];

  it.each(cases)("%s", async (_name, fn, props, canonicalPath) => {
    for (const locale of ["id", "en"] as const) {
      const m = await meta(fn, { locale, ...props });
      expect(m.alternates, `${locale}`).toEqual({ canonical: `${BASE}/${locale}${canonicalPath}` });
      expect(typeof m.description, `${locale} description`).toBe("string");
      expect((m.description as string).length, `${locale} description`).toBeGreaterThan(40);
      expect(titleOf(m).length, `${locale} title`).toBeGreaterThan(1);
    }
  });

  it("the Kosakata list: the first page, whether or not the address names it, is ?hal=1", async () => {
    const searches: Record<string, string | string[]>[] = [{}, { hal: "1" }, { hal: "1", utm_source: "share" }];
    for (const search of searches) {
      const m = await meta(list, { locale: "id" }, search);
      expect(m.alternates, JSON.stringify(search)).toEqual({ canonical: `${BASE}/id/kosakata?hal=1` });
      expect(m.robots).toBeUndefined();
    }
  });
});

describe("the pages' robots tags: none for an indexable page, noindex for the rest", () => {
  it("none for every page that is listed in the sitemap (the locale layout decides: none for Indonesian, noindex for English)", async () => {
    const pages: [MetaFn, Record<string, string>][] = [
      [hub, {}],
      [track, {}],
      [surah, { surah: "al-fatihah" }],
      [ayah, { surah: "al-fatihah", ayah: "1" }],
      [intro, {}],
      [curriculum, {}],
      [rumus, {}],
      [konsepIndex, {}],
      [konsep, { id: SOME_CONCEPT }],
      [lexeme, { id: SOME_LEXEME }],
      [path, {}],
      [credits, {}],
    ];
    for (const [fn, props] of pages) {
      for (const locale of ["id", "en"] as const) expect((await meta(fn, { locale, ...props })).robots, `${locale} ${JSON.stringify(props)}`).toBeUndefined();
    }
  });

  it("the Kosakata list: noindex for a search and for every address that is only the first page again", async () => {
    const searches: Record<string, string | string[]>[] = [
      { q: "tangan" },
      { q: "" },
      { hal: "0" },
      { hal: "50" },
      { hal: "999" },
      { hal: "abc" },
      { hal: ["1", "2"] },
      { hal: "2", q: "x" },
    ];
    for (const search of searches) {
      const m = await meta(list, { locale: "id" }, search);
      expect(m.robots, JSON.stringify(search)).toEqual(NOINDEX);
      expect(m.alternates, JSON.stringify(search)).toBeUndefined();
    }
    // The last page is a page.
    expect((await meta(list, { locale: "id" }, { hal: "49" })).robots).toBeUndefined();
  });

  it("the learning path's cards and tests are noindex; its overview follows the switch that lists the path", async () => {
    for (const [fn, props] of [
      [batch, { level: "1", batch: "1" }],
      [batchTest, { level: "1", batch: "1" }],
      [levelTest, { level: "1" }],
    ] as [MetaFn, Record<string, string>][]) {
      expect((await meta(fn, { locale: "id", ...props })).robots, JSON.stringify(props)).toEqual(NOINDEX);
    }
    expect((await meta(path, { locale: "id" })).robots).toBeUndefined();
    delete process.env.BELAJAR_KOSAKATA_BERTAHAP;
    expect((await meta(path, { locale: "id" })).robots).toEqual(NOINDEX);
  });

  it("a lesson word's entry is noindex while no published surah uses the word, and follows BELAJAR_SURAHS per request", async () => {
    const hiddenOnly = LEXEMES.filter((l) => !l.surahs.includes("al-fatihah"));
    expect(hiddenOnly.length).toBe(29);
    const savedSurahs = process.env.BELAJAR_SURAHS;
    try {
      delete process.env.BELAJAR_SURAHS;
      for (const l of hiddenOnly) expect((await meta(lexeme, { locale: "id", id: l.id })).robots, l.id).toEqual(NOINDEX);
      expect((await meta(lexeme, { locale: "id", id: SOME_LEXEME })).robots).toBeUndefined();
      // Publishing every surah makes every entry indexable at once.
      process.env.BELAJAR_SURAHS = SURAHS.map((s) => s.slug).join(",");
      for (const l of hiddenOnly) expect((await meta(lexeme, { locale: "id", id: l.id })).robots, l.id).toBeUndefined();
    } finally {
      if (savedSurahs === undefined) delete process.env.BELAJAR_SURAHS;
      else process.env.BELAJAR_SURAHS = savedSurahs;
    }
  });

  it("a word page is noindex unless the operator takes the word pages (BELAJAR_KOSAKATA_WORDS_INDEXED)", async () => {
    expect((await meta(word, { locale: "id", rank: "1" })).robots).toEqual(NOINDEX);
    process.env.BELAJAR_KOSAKATA_WORDS_INDEXED = "on";
    expect((await meta(word, { locale: "id", rank: "1" })).robots).toBeUndefined();
  });
});

describe("a title and a description of its own, for every page of the sitemap", () => {
  it("never repeats one across every page the sitemap can list, with every surah published and the word pages taken (a page type, or the pages of a list, that shares one is filed as a duplicate)", async () => {
    // The widest configuration: the lesson word's entry (/kosakata/{id}) and the word page (/kosakata/kata/{rank})
    // are both listed for the same word, and must still differ in title, description and canonical.
    const savedSurahs = process.env.BELAJAR_SURAHS;
    process.env.BELAJAR_SURAHS = SURAHS.map((s) => s.slug).join(",");
    process.env.BELAJAR_KOSAKATA_WORDS_INDEXED = "on";
    onTestFinished(() => {
      if (savedSurahs === undefined) delete process.env.BELAJAR_SURAHS;
      else process.env.BELAJAR_SURAHS = savedSurahs;
    });
    const seen = { titles: new Map<string, string>(), descriptions: new Map<string, string>(), canonicals: new Map<string, string>() };
    const take = (label: string, m: Metadata) => {
      const title = titleOf(m);
      const description = m.description as string;
      const canonical = (m.alternates as { canonical?: string } | undefined)?.canonical;
      expect(canonical, label).toBeTruthy();
      expect(seen.canonicals.get(canonical!), `${label}: canonical ${canonical} is also ${seen.canonicals.get(canonical!)}`).toBeUndefined();
      seen.canonicals.set(canonical!, label);
      const ogUrl = (m.openGraph as { url?: string } | undefined)?.url;
      if (ogUrl) expect(ogUrl, label).toBe(canonical);
      expect(title, label).toBeTruthy();
      expect(description, label).toBeTruthy();
      expect(seen.titles.get(title), `${label}: title "${title}" is also ${seen.titles.get(title)}`).toBeUndefined();
      expect(seen.descriptions.get(description), `${label}: description is also ${seen.descriptions.get(description)}`).toBeUndefined();
      seen.titles.set(title, label);
      seen.descriptions.set(description, label);
    };
    const id$ = (fn: MetaFn, props: Record<string, string> = {}, search: Record<string, string> = {}) => meta(fn, { locale: "id", ...props }, search);

    take("hub", await id$(hub));
    take("track", await id$(track));
    take("surah", await id$(surah, { surah: "al-fatihah" }));
    for (const sr of SURAHS) {
      if (sr.slug !== "al-fatihah") take(`surah ${sr.slug}`, await id$(surah, { surah: sr.slug }));
      for (const a of sr.ayat) take(`ayah ${sr.slug} ${a.ayah}`, await id$(ayah, { surah: sr.slug, ayah: String(a.ayah) }));
    }
    take("lesson zero", await id$(intro));
    take("curriculum", await id$(curriculum));
    take("cheat sheet", await id$(rumus));
    take("konsep index", await id$(konsepIndex));
    for (const c of [...LIBRARY.basics, ...LIBRARY.concepts]) take(`konsep ${c.id}`, await id$(konsep, { id: c.id }));
    take("path", await id$(path));
    for (const l of LIBRARY.lexicon) take(`lexeme ${l.id}`, await id$(lexeme, { id: l.id }));
    for (let page = 1; page <= 49; page++) take(`list ${page}`, await id$(list, {}, { hal: String(page) }));
    take("credits", await id$(credits));
    for (let rank = 1; rank <= 4832; rank++) take(`word ${rank}`, await id$(word, { rank: String(rank) }));
    const lessons = SURAHS.reduce((n, sr) => n + 1 + sr.ayat.length, 0);
    expect(seen.titles.size).toBe(1 + 1 + lessons + 3 + 1 + 38 + 1 + 52 + 49 + 1 + 4832);
  });

  it("a list page says which words it holds; a word page the word and its meaning", async () => {
    const second = await meta(list, { locale: "id" }, { hal: "2" });
    expect(titleOf(second)).toBe("Kosakata Al-Qur'an: kata ke-101 sampai ke-200");
    expect(second.description).toMatch(/kata ke-101 sampai ke-200 dari 4\.832/);
    const last = await meta(list, { locale: "id" }, { hal: "49" });
    expect(titleOf(last)).toBe("Kosakata Al-Qur'an: kata ke-4.801 sampai ke-4.832");
    expect(titleOf(await meta(list, { locale: "id" }, { hal: "1" }))).toBe(MSG.id.Kosakata.title);
    const first = await meta(word, { locale: "id", rank: "1" });
    expect(titleOf(first)).toBe("min (مِن): kata ke-1 dalam Al-Qur'an");
    expect(first.description).toContain("dari; di antara");
    expect(first.description).toMatch(/3\.226 kali/);
  });

  it("an ayah's description is its translation's, which differs from ayah to ayah", async () => {
    const m = await meta(ayah, { locale: "id", surah: "al-fatihah", ayah: "2" });
    expect(m.description).toContain("Pelajari kata demi kata");
    expect(m.description).toContain(FATIHAH.ayat[1].translation.text.slice(0, 20));
  });
});
