import type { Metadata } from "next";

import { INDEXED_LOCALES, routing } from "@/i18n/routing";

import { SURAH_SLUGS } from "./routes";

/**
 * Sharing a Belajar page (operator, 2026-10-10: the module should bring people to
 * dakwah-lens.id): its canonical address, the share card (Open Graph / Twitter image) and the
 * UTM-tagged address the "Share" button hands out. The canonical address is also what a search engine
 * is told (the module is public since 2026-11-26, plan L42; what may be indexed is lib/indexing.ts):
 * one address per page, so og:url, the canonical link and the sitemap cannot disagree.
 */

/** The module's public address: the main site's origin plus the basePath (next.config.ts). */
export const BELAJAR_URL = "https://dakwah-lens.id/belajar";

/**
 * Canonical absolute address of an in-module page (a lib/routes.ts path) in a locale:
 * pageUrl("id", "/") → https://dakwah-lens.id/belajar/id. og:url and the canonical link of a page
 * are both built from this, so they cannot drift apart.
 */
export function pageUrl(locale: string, path: string): string {
  return `${BELAJAR_URL}/${locale}${path === "/" ? "" : path}`;
}

/**
 * The page's share card, drawn by the `og/route.ts` handler in the page's own folder: the page
 * address + "/og". Inside the page's folder on purpose: a lesson's card sits under
 * /{locale}/quran/{slug}/…, so whatever keeps a lesson from visitors (the proxy's 404) keeps its
 * card from them too.
 */
export function ogImageUrl(locale: string, path: string): string {
  return `${pageUrl(locale, path)}/og`;
}

/** Share-card size: the Open Graph standard, used for the Twitter large card too. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * THE check before a lesson gets a share button or a share card (and its og: tags): one place
 * for "may this lesson be shared?". Today every lesson in content/ is published, so this is the
 * list of lessons.
 *
 * When BELAJAR_SURAHS (feat/belajar-fatihah-first: only Al-Fatihah published) lands, the proxy
 * already answers an unpublished surah's lesson pages AND their /og cards with the module's 404
 * at request time, because both live under /{locale}/quran/{slug}/…. If a share button or card
 * must not even be built for an unpublished lesson, return surahPublished(slug) here too; that
 * value is read at build time, where the lesson pages and cards are prerendered.
 */
export function lessonShareable(slug: string): boolean {
  return (SURAH_SLUGS as readonly string[]).includes(slug);
}

/** How a link left the page: the native share sheet or "Copy link" (share), or WhatsApp. */
export type ShareMedium = "share" | "whatsapp";

/** A shared address: the page address + utm_source=share&utm_medium=<medium>. */
export function shareUrl(url: string, medium: ShareMedium): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "share");
  u.searchParams.set("utm_medium", medium);
  return u.toString();
}

/** "Kirim lewat WhatsApp": wa.me with the message text, a line break and the tagged address. */
export function whatsappHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${shareUrl(url, "whatsapp")}`)}`;
}

/**
 * og:* and twitter:* for a page, with its card. og:url is the canonical address. The image is
 * listed for Twitter as well, so its large card does not depend on Next copying it over.
 */
export function shareMetadata(p: {
  locale: string;
  /** lib/routes.ts path of the page. */
  path: string;
  title: string;
  description: string;
  imageAlt: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const image = {
    url: ogImageUrl(p.locale, p.path),
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    alt: p.imageAlt,
    type: "image/png",
  };
  return {
    openGraph: {
      type: "website",
      siteName: "Dakwah-Lens",
      locale: p.locale === "en" ? "en_US" : "id_ID",
      url: pageUrl(p.locale, p.path),
      title: p.title,
      description: p.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: p.title,
      description: p.description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}

/**
 * The canonical address of a page, and its hreflang alternates only while EVERY locale is indexed
 * (INDEXED_LOCALES, src/i18n/routing.ts). Today only Indonesian is, because English is a translated
 * shell around Indonesian lessons: an alternate pointing at a `noindex` page is an error Search Console
 * reports, and an English page is not an equivalent of the Indonesian one. An /en page's own canonical
 * is itself (it is `noindex`, so it is never a rival of the /id page).
 */
export function alternatesFor(locale: string, path: string): NonNullable<Metadata["alternates"]> {
  const canonical = pageUrl(locale, path);
  if (INDEXED_LOCALES.length !== routing.locales.length) return { canonical };
  return {
    canonical,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, pageUrl(l, path)])),
      "x-default": pageUrl(routing.defaultLocale, path),
    },
  };
}
