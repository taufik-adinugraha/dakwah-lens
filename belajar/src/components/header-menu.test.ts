import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HeaderControls } from "@/components/HeaderControls";
import { conceptIndexHref, creditsHref, hubHref } from "@/lib/routes";

import en from "../../messages/en.json";
import id from "../../messages/id.json";

// THE HEADER'S MENU (operator, 2026-10-17): "Halaman Belajar", the hub, is its first link, and it
// closes on a press outside it. Rendered here as the server draws it (the panel is always in the
// HTML, hidden while closed), in both locales; how it closes is lib/dismiss.ts (dismiss.test.ts),
// wired as pinned below. That a browser closes it on a press outside, keeps it open on a press
// inside, still toggles it with its button, and that the home link navigates is checked in CI
// (scripts/ci/screenshots.mjs menuShots): vitest runs in node, with no DOM to click.

type Locale = "id" | "en";
const MSG = { id, en } as const;
/** The page the header is drawn on, for the mocks below. */
const at = vi.hoisted(() => ({ locale: "id" as "id" | "en", pathname: "/" }));

// The app's Link, drawn as the server draws it: the basePath and the locale in front of the path
// (as src/components/curriculum/curriculum-page.test.ts draws it); the pathname next-intl's
// usePathname gives, without the locale.
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => at.pathname,
  Link: ({ href, children, ...rest }: { href: unknown; children?: ReactNode }) =>
    createElement("a", { ...rest, href: `/belajar/${at.locale}${href === "/" ? "" : String(href)}` }, children),
}));

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

function render(locale: Locale, pathname: string): string {
  at.locale = locale;
  at.pathname = pathname;
  const props: ComponentProps<typeof NextIntlClientProvider> = {
    locale,
    messages: MSG[locale],
    timeZone: "Asia/Jakarta",
    children: createElement(HeaderControls, { locale }),
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#\d+|[a-z]+);/gi, (all, e: string) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? all)));
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
/** The Menu panel: the <nav data-header-menu>. */
function menuOf(html: string): { nav: Record<string, string>; inner: string } {
  const m = /<nav\b([^>]*\bdata-header-menu=""[^>]*)>([\s\S]*?)<\/nav>/.exec(html);
  expect(m, "no <nav data-header-menu> in the header").toBeTruthy();
  return { nav: attrs(m![1]), inner: m![2] };
}
/** Every link of a fragment: its attributes, its text, whether it starts with an aria-hidden icon. */
const links = (html: string): { a: Record<string, string>; text: string; icon: boolean }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    a: attrs(m[1]),
    text: decode(m[2].replace(/<[^>]+>/g, "")).trim(),
    icon: /^<svg\b[^>]*aria-hidden="true"/.test(m[2]),
  }));

describe("the header's Menu", () => {
  it("lists Halaman Belajar first: the hub, in the page's locale, styled and drawn like the other rows", () => {
    const want = { id: ["Halaman Belajar", "Konsep tata bahasa", "Kembali ke Dakwah-Lens", "Sumber & lisensi"], en: ["Learn home page", "Grammar concepts", "Back to Dakwah-Lens", "Sources & licences"] };
    for (const locale of ["id", "en"] as const) {
      const rows = links(menuOf(render(locale, "/konsep")).inner);
      expect(rows.map((r) => r.text)).toEqual(want[locale]);
      const [home, concepts, main, credits] = rows;
      expect(home.a.href).toBe(`/belajar/${locale}`);
      expect(concepts.a.href).toBe(`/belajar/${locale}/konsep`);
      expect(main.a.href).toBe(`/${locale}`);
      expect(credits.a.href).toBe(`/belajar/${locale}/kredit`);
      expect("data-header-menu-home" in home.a).toBe(true);
      // Same row as the others: the 48px menu-row, an icon because they all carry one.
      for (const r of rows) {
        expect(r.a.class).toBe("menu-row");
        expect(r.icon).toBe(true);
      }
    }
  });

  it("marks the page it is on: the home link on the hub, and no other", () => {
    for (const locale of ["id", "en"] as const) {
      const onHub = links(menuOf(render(locale, hubHref())).inner);
      expect(onHub.map((r) => r.a["aria-current"] ?? null)).toEqual(["page", null, null, null]);
      const onConcepts = links(menuOf(render(locale, conceptIndexHref())).inner);
      expect(onConcepts.map((r) => r.a["aria-current"] ?? null)).toEqual([null, "page", null, null]);
      const onCredits = links(menuOf(render(locale, creditsHref())).inner);
      expect(onCredits.map((r) => r.a["aria-current"] ?? null)).toEqual([null, null, null, "page"]);
      // A lesson: none of them.
      expect(links(menuOf(render(locale, "/quran/al-fatihah/1")).inner).some((r) => r.a["aria-current"])).toBe(false);
    }
  });

  it("is closed on arrival: the panel hidden, its button says so and names it", () => {
    const html = render("id", "/");
    const { nav } = menuOf(html);
    expect("hidden" in nav).toBe(true);
    const button = /<button\b([^>]*\bdata-header-menu-toggle=""[^>]*)>/.exec(html);
    expect(button).toBeTruthy();
    const b = attrs(button![1]);
    expect(b["aria-expanded"]).toBe("false");
    expect(b["aria-controls"]).toBe(nav.id);
    expect(nav["aria-label"]).toBe("Menu");
  });

  it("has the label in both message files", () => {
    expect(id.App.nav_home).toBe("Halaman Belajar");
    expect(en.App.nav_home).toBe("Learn home page");
    expect(Object.keys(en.App).sort()).toEqual(Object.keys(id.App).sort());
  });

  it("is wired as lib/dismiss.ts expects: its panel and button, an outside press for the Menu only, links that close it", () => {
    const src = read("src/components/HeaderControls.tsx");
    // The home link goes through the module's routes and the app's Link, never a written path.
    expect(src).toContain("href={hubHref()}");
    expect(src).toMatch(/aria-current=\{current\(hubHref\(\)\)\}/);
    expect(src).not.toMatch(/href=["'`]\/belajar/);
    // The listeners come from the one helper, in the effect that runs while a panel is open,
    // and its cleanup is what the effect returns (closing or unmounting removes them).
    expect(src).toMatch(/return listenForDismiss\(document, \{/);
    expect(src).toContain('outside: open === "menu",');
    expect(src).toContain("ref={menuPanel}");
    expect(src).not.toMatch(/document\.addEventListener/);
    // Choosing an in-app link closes the Menu (the layout, and so the header, stays mounted).
    expect(src.match(/onClick=\{leave\}/g)).toHaveLength(3);
  });

  it("is driven in CI by the markers the component carries (they cannot be run on a laptop)", () => {
    const src = read("src/components/HeaderControls.tsx");
    for (const marker of ["data-header-menu-toggle", "data-header-menu=", "data-header-menu-home"]) expect(src).toContain(marker);
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ["[data-header-menu-toggle]", "[data-header-menu]", "[data-header-menu-home]"]) expect(shots).toContain(sel);
    // The outside press is a real mouse press on the page, then the panel must be hidden.
    expect(shots).toContain("await page.mouse.click(spot.x, spot.y);");
    expect(shots).toContain('fail("a press outside the panel did not close it")');
  });
});
