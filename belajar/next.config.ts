import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Relative, import-free module (no "@/" alias, no app code in the config).
import { SURAH_SLUGS } from "./src/lib/routes";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

/**
 * The module shares the dakwah-lens.id ORIGIN with the main app (it is served
 * under /belajar by the host Caddy — docs/belajar-plan.md §7.1), so its CSP is
 * its own line of defence: an XSS here could make credentialed requests to the
 * main app. Keep it strict and free of user-generated HTML.
 *
 * media-src: recitation is STREAMED from the reciters' CDNs (stream-only until
 * we own a recording — plan §6.2); everything else is same-origin.
 */
const RECITATION_HOSTS = [
  "https://everyayah.com",
  "https://verses.quran.com",
  "https://audio.qurancdn.com",
];

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `media-src 'self' blob: ${RECITATION_HOSTS.join(" ")}`,
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/**
 * Lesson URLs moved when /belajar became a hub of tracks (docs/belajar-plan.md
 * L9): /{locale}/{surah}[/{ayah}] → /{locale}/quran/{surah}[/{ayah}].
 * Permanent (308), so bookmarks and shared links keep working and search
 * engines move to the new address.
 *
 * - Next prefixes basePath (/belajar) onto both source and destination; do
 *   not write it here and do not set `basePath: false`.
 * - Redirects run before the proxy (next-intl middleware), so they see the
 *   raw URL.
 * - The locale-less old form (/belajar/al-fatihah[/N]) gets its own rule
 *   rather than relying on next-intl: the proxy would first add the locale
 *   with a temporary 307 and only then reach the rules above, i.e. two hops,
 *   the first one non-permanent. localeDetection is off, so "id" (the
 *   default locale) is what next-intl would have chosen anyway.
 * - Only known slugs match: an unknown /{locale}/{x} is left alone and ends
 *   in the module's 404 instead of being sent into the track.
 * - The hash (#w-1-2-3 word anchors) never reaches the server; browsers
 *   carry it across the redirect.
 */
const SURAH = `:surah(${SURAH_SLUGS.join("|")})`;
const LEGACY_LOCALE = ":locale(id|en)";

const nextConfig: NextConfig = {
  // Served at dakwah-lens.id/belajar by the host Caddy; inlined into client
  // bundles at build time, so it cannot change without a rebuild.
  basePath: "/belajar",
  // Standalone server (`node server.js`) keeps the image small: the module
  // runs on a 1.9 GB VM next to the main app (plan §7.2).
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: `/${LEGACY_LOCALE}/${SURAH}`,
        destination: "/:locale/quran/:surah",
        permanent: true,
      },
      {
        source: `/${LEGACY_LOCALE}/${SURAH}/:ayah`,
        destination: "/:locale/quran/:surah/:ayah",
        permanent: true,
      },
      {
        source: `/${SURAH}`,
        destination: "/id/quran/:surah",
        permanent: true,
      },
      {
        source: `/${SURAH}/:ayah`,
        destination: "/id/quran/:surah/:ayah",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
