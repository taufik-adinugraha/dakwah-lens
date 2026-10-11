import type { Metadata } from "next";

import { SURAH_SLUGS } from "./routes";

/**
 * Sharing a Belajar page (operator, 2026-10-10: the module should bring people to
 * dakwah-lens.id): its canonical address, the share card (Open Graph / Twitter image) and the
 * UTM-tagged address the "Bagikan" button hands out. The pages stay noindex (lib/flags.ts); a
 * share preview does not need indexing.
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

/** How a link left the page: the native share sheet or "Salin tautan" (share), or WhatsApp. */
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

/** Canonical + language alternates of a page, the shape the hub and the track already use. */
export function alternatesFor(locale: string, path: string): NonNullable<Metadata["alternates"]> {
  return {
    canonical: pageUrl(locale, path),
    languages: { id: pageUrl("id", path), en: pageUrl("en", path), "x-default": pageUrl("id", path) },
  };
}
