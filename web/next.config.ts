import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

/**
 * CSP. Pragmatic baseline — strict enough to stop the common XSS / mixed-
 * content / clickjacking classes, loose enough that Next.js's inline
 * runtime scripts and Tailwind's inline styles still work without nonces.
 *
 * If we ever introduce third-party iframes (Stripe, YouTube embed), add
 * the required origin to the matching directive. Avatars from Google
 * OAuth are served from googleusercontent.com.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS only in prod — locally we want plain http://localhost:3000 to
  // keep working without certificate jumping.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Standalone output bundles the Next runtime + only the node_modules it
  // actually uses into `.next/standalone/`. Production Docker images copy
  // just that directory, which keeps the final image ~150 MB instead of
  // ~700 MB if we'd shipped the full node_modules. Server runs via
  // `node server.js` — no `npm run start` needed.
  output: "standalone",
  // geoip-lite ships its lookup data in .dat files that the Next.js
  // file tracer doesn't pick up automatically (it only follows JS
  // imports). Without this we get ENOENT at runtime when
  // `resolveRegion()` tries to read the country DB. Force-include
  // every .dat under the package.
  outputFileTracingIncludes: {
    "*": ["./node_modules/geoip-lite/data/*.dat"],
  },
  // Belt-and-suspenders: keep geoip-lite + puppeteer as true Node
  // requires at runtime instead of webpack-bundling them.
  //   * geoip-lite resolves its data path via `__dirname`; the
  //     standalone bundler was rewriting that to a placeholder
  //     `/ROOT/...` path that didn't exist on the running container.
  //   * puppeteer dynamically resolves its Chromium executable path
  //     (we override via PUPPETEER_EXECUTABLE_PATH but its internal
  //     resolver still walks node_modules at launch).
  // Listing them here keeps the runtime lookup against the actual
  // node_modules path inside the standalone output.
  serverExternalPackages: ["geoip-lite", "puppeteer", "puppeteer-core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
