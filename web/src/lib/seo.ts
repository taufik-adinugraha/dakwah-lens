/**
 * Canonical public origin for absolute URLs in SEO surfaces
 * (metadataBase, sitemap, robots, OG images). Override per-env with
 * NEXT_PUBLIC_SITE_URL; defaults to the production domain. No trailing slash.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://dakwah-lens.id"
).replace(/\/+$/, "");
