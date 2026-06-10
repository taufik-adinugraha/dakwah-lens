/**
 * IP → geo bucket (Indonesia region OR international group).
 *
 * Resolves a client IP to one of two bucket sets:
 *
 *  · 8 Indonesia region buckets (matches UserProfile.location +
 *    rss_feeds.region):
 *      jabodetabek · jawa_barat · jawa_tengah_diy · jawa_timur ·
 *      sumatera · kalimantan · sulawesi · indonesia_timur
 *
 *  · 5 international buckets (added 2026-06-11, since the audience
 *    includes Indonesian diaspora + global visitors):
 *      eu · us · sg_my · mena · other_intl
 *
 * Implementation:
 *  - `geoip-lite` returns ISO 3166-1 alpha-2 country + 3166-2 region
 *    suffix (e.g. country="ID", region="JK" for DKI Jakarta) from a
 *    bundled MaxMind GeoLite2 City database. No network call, no
 *    API key.
 *  - Country = ID → province → Indonesia region bucket (PROVINCE_TO_REGION).
 *  - Country != ID → country → international bucket (COUNTRY_TO_REGION);
 *    fallback `other_intl` for any unmapped country so non-ID visitors
 *    still appear in dashboards.
 *
 * Caveats:
 *  - Province-level resolution. Bogor/Depok/Bekasi are in West Java
 *    (`JB`) so they bucket as `jawa_barat` even though they're
 *    conceptually Jabodetabek. Same for Tangerang in Banten (`BT`)
 *    going to jabodetabek by virtue of the Banten mapping. City-level
 *    mapping is a future refinement.
 *  - UK + Switzerland are grouped under `eu` for dashboard purposes
 *    (post-Brexit politically separate but Indonesian-diaspora-wise
 *    similar audience). Adjust the COUNTRY_TO_REGION map if you want
 *    them split.
 *  - Lookup failure (CDN-stripped IP, dev localhost, etc.) returns
 *    NULL. Callers must tolerate NULL region in the DB.
 *
 * PDP §15: the IP itself is NEVER returned or stored. Only the derived
 * bucket label leaves this module.
 */

/**
 * Defensive load. We had a bundler-pathing bug on 2026-05-21 where
 * `geoip-lite`'s data files weren't reachable in the standalone
 * runtime, and the eager `require` at module-import time crashed
 * every server-action / page-render that touched analytics.
 *
 * Now: lazy require inside a try/catch so a future packaging
 * regression downgrades to "no region data" instead of breaking the
 * entire page. Combined with `serverExternalPackages: ["geoip-lite"]`
 * in next.config.ts, this should be belt-and-suspenders.
 */
type GeoipLookup = {
  lookup: (ip: string) => { country?: string; region?: string } | null;
};

let geoip: GeoipLookup | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  geoip = require("geoip-lite") as GeoipLookup;
} catch (err) {
  console.warn(
    "[geolocation] geoip-lite failed to load — region resolution disabled:",
    err instanceof Error ? err.message : err,
  );
}

export type RegionBucket =
  // ── Indonesia (8 region buckets, matches UserProfile.location) ──
  | "jabodetabek"
  | "jawa_barat"
  | "jawa_tengah_diy"
  | "jawa_timur"
  | "sumatera"
  | "kalimantan"
  | "sulawesi"
  | "indonesia_timur"
  // ── Non-Indonesia geo buckets (added 2026-06-11) ──
  // For Indonesian-diaspora + international audience. We bucket by
  // region group rather than country to keep dashboards readable.
  // PDP §15 still applies — IP never stored, only the bucket label.
  | "eu" // EU member states + EEA + UK + Switzerland
  | "us" // United States + Canada
  | "sg_my" // Singapore + Malaysia (close-neighbour diaspora)
  | "mena" // Saudi Arabia + UAE + Egypt + other Middle East/North Africa (haji/umrah/work corridor)
  | "other_intl"; // everything else (Australia, India, Japan, etc.)

// ISO 3166-2:ID subdivision suffix → our region bucket. geoip-lite's
// `region` field is just the suffix (e.g. "JK"), not the full code
// ("ID-JK"). Codes verified against the official ISO list and
// MaxMind's GeoLite2-City representation.
const PROVINCE_TO_REGION: Record<string, RegionBucket> = {
  // Jakarta + Banten — treated as Jabodetabek-region. Banten includes
  // Tangerang area which is part of Jabodetabek; Pandeglang/Lebak are
  // more outer-Banten but the city-level mapping is too granular here.
  JK: "jabodetabek",
  BT: "jabodetabek",

  // Java
  JB: "jawa_barat",
  JT: "jawa_tengah_diy",
  YO: "jawa_tengah_diy",
  JI: "jawa_timur",

  // Sumatra
  AC: "sumatera", // Aceh
  SU: "sumatera", // Sumatera Utara
  SB: "sumatera", // Sumatera Barat
  RI: "sumatera", // Riau
  JA: "sumatera", // Jambi
  BE: "sumatera", // Bengkulu
  SS: "sumatera", // Sumatera Selatan
  LA: "sumatera", // Lampung
  KR: "sumatera", // Kepulauan Riau
  BB: "sumatera", // Bangka Belitung

  // Kalimantan
  KB: "kalimantan", // Kalimantan Barat
  KS: "kalimantan", // Kalimantan Selatan
  KT: "kalimantan", // Kalimantan Tengah
  KI: "kalimantan", // Kalimantan Timur
  KU: "kalimantan", // Kalimantan Utara

  // Sulawesi
  SA: "sulawesi", // Sulawesi Utara
  SN: "sulawesi", // Sulawesi Selatan
  ST: "sulawesi", // Sulawesi Tengah
  SG: "sulawesi", // Sulawesi Tenggara
  SR: "sulawesi", // Sulawesi Barat
  GO: "sulawesi", // Gorontalo

  // Eastern Indonesia (Bali, NT, Maluku, Papua)
  BA: "indonesia_timur", // Bali
  NB: "indonesia_timur", // Nusa Tenggara Barat
  NT: "indonesia_timur", // Nusa Tenggara Timur
  MA: "indonesia_timur", // Maluku
  MU: "indonesia_timur", // Maluku Utara
  PA: "indonesia_timur", // Papua
  PB: "indonesia_timur", // Papua Barat
  PD: "indonesia_timur", // Papua Tengah (newer province)
  PS: "indonesia_timur", // Papua Selatan
  PT: "indonesia_timur", // Papua Pegunungan
  PE: "indonesia_timur", // Papua Barat Daya
};

// ISO 3166-1 alpha-2 country code → non-Indonesia geo bucket. Used
// when geoip-lite resolves the IP to a non-ID country. Anything not
// listed falls back to `other_intl` so we still get SOME signal vs.
// dropping non-ID visitors entirely (the pre-2026-06-11 behaviour).
//
// PDP §15 still applies: the country code is computed in-process from
// the IP; only the BUCKET LABEL is persisted to page_views.region.
const COUNTRY_TO_REGION: Record<string, RegionBucket> = {
  // ── EU / EEA / UK / Switzerland ──
  AT: "eu", BE: "eu", BG: "eu", HR: "eu", CY: "eu", CZ: "eu", DK: "eu",
  EE: "eu", FI: "eu", FR: "eu", DE: "eu", GR: "eu", HU: "eu", IE: "eu",
  IT: "eu", LV: "eu", LT: "eu", LU: "eu", MT: "eu", NL: "eu", PL: "eu",
  PT: "eu", RO: "eu", SK: "eu", SI: "eu", ES: "eu", SE: "eu",
  IS: "eu", LI: "eu", NO: "eu",      // EEA non-EU
  GB: "eu", CH: "eu",                // UK + Switzerland (grouped with EU for dashboard purposes)

  // ── North America ──
  US: "us", CA: "us",

  // ── Close-neighbour diaspora (SG / MY) ──
  SG: "sg_my", MY: "sg_my",

  // ── MENA: haji + umrah + work corridor for Indonesian Muslims ──
  SA: "mena", AE: "mena", EG: "mena", QA: "mena", KW: "mena",
  BH: "mena", OM: "mena", JO: "mena", LB: "mena", IQ: "mena",
  YE: "mena", PS: "mena", IL: "mena", SY: "mena",
  MA: "mena", DZ: "mena", TN: "mena", LY: "mena", SD: "mena",
  TR: "mena",                        // Turkey included on the MENA bucket
};

/**
 * Extract the first usable IP from the request chain. Behind Caddy
 * the production VM sees `X-Forwarded-For` populated by the reverse
 * proxy. Fall back to the direct connection if no XFF is present
 * (local dev, direct curl).
 */
function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // XFF is "client, proxy1, proxy2, …" — the client IP is the
    // leftmost entry. Caddy prepends, so this is the original
    // visitor.
    const first = xff.split(",")[0]?.trim();
    if (first) return stripIpv6Prefix(first);
  }
  const real = headers.get("x-real-ip");
  if (real) return stripIpv6Prefix(real.trim());
  return null;
}

function stripIpv6Prefix(ip: string): string {
  // IPv4-mapped IPv6 addresses ("::ffff:1.2.3.4") confuse some geoip
  // libraries. Strip back to the v4 form.
  return ip.replace(/^::ffff:/, "");
}

/**
 * Public entry. Returns:
 *  - One of 8 Indonesia region buckets when the IP geolocates to a
 *    mapped Indonesian province.
 *  - One of 5 international buckets (eu / us / sg_my / mena /
 *    other_intl) when the IP geolocates outside Indonesia. Added
 *    2026-06-11 — pre-then, all non-ID visitors resolved to NULL and
 *    fell off every regional dashboard.
 *  - NULL when:
 *      · No IP could be extracted (dev / curl with no XFF)
 *      · IP is private / localhost
 *      · geoip lookup misses entirely (no country resolution)
 *      · Country = ID but the province code isn't in our mapping
 *        (newer province we haven't added yet — log + null rather
 *         than misclassify)
 */
export function resolveRegion(headers: Headers): RegionBucket | null {
  if (!geoip) return null;
  const ip = clientIpFromHeaders(headers);
  if (!ip || isPrivateIp(ip)) return null;
  try {
    const hit = geoip.lookup(ip);
    if (!hit) return null;
    if (hit.country === "ID") {
      // Province-level mapping for Indonesia. Unknown province → NULL
      // (we'd rather lose the bucket than misclassify; province IDs
      // are stable enough that a NULL signals a real coverage gap).
      return PROVINCE_TO_REGION[hit.region ?? ""] ?? null;
    }
    // Non-Indonesia: bucket by country group. Default `other_intl` so
    // every non-ID visitor still gets ONE bucket in dashboards even
    // if their country isn't in our COUNTRY_TO_REGION list.
    return COUNTRY_TO_REGION[hit.country ?? ""] ?? "other_intl";
  } catch {
    return null;
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("localhost")) return true;
  // RFC1918 + link-local
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return false;
}
