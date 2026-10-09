import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

const nextConfig: NextConfig = {
  // Served at dakwah-lens.id/belajar by the host Caddy; inlined into client
  // bundles at build time, so it cannot change without a rebuild.
  basePath: "/belajar",
  // Standalone server (`node server.js`) keeps the image small: the module
  // runs on a 1.9 GB VM next to the main app (plan §7.2).
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
