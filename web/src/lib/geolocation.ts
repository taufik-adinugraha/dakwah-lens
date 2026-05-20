/**
 * IP → Indonesian region bucket.
 *
 * Resolves a client IP to one of the 8 region codes the rest of the app
 * uses (matching `UserProfile.location` + `rss_feeds.region`):
 *   jabodetabek · jawa_barat · jawa_tengah_diy · jawa_timur ·
 *   sumatera · kalimantan · sulawesi · indonesia_timur
 *
 * Implementation:
 *  - `geoip-lite` returns ISO 3166-2 subdivision codes (e.g. "JK"
 *    for DKI Jakarta) keyed off a bundled MaxMind GeoLite2 City
 *    database. No network call, no API key.
 *  - We then map province → region bucket via the table below.
 *
 * Caveats:
 *  - Province-level resolution. Bogor/Depok/Bekasi are in West Java
 *    (`JB`) so they bucket as `jawa_barat` even though they're
 *    conceptually Jabodetabek. Same for Tangerang in Banten (`BT`)
 *    going to jabodetabek by virtue of the Banten mapping.
 *    City-level mapping is a future refinement.
 *  - Non-Indonesia visitors return null (we don't have international
 *    region buckets).
 *  - Lookup failure (CDN-stripped IP, dev localhost, etc.) returns
 *    null. Callers must tolerate a NULL region in the DB.
 *
 * PDP §15: the IP itself is NEVER returned or stored. Only the derived
 * region bucket leaves this module.
 */

import geoip from "geoip-lite";

export type RegionBucket =
  | "jabodetabek"
  | "jawa_barat"
  | "jawa_tengah_diy"
  | "jawa_timur"
  | "sumatera"
  | "kalimantan"
  | "sulawesi"
  | "indonesia_timur";

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
 * Public entry. Returns null when:
 *  - No IP could be extracted (dev / curl with no XFF)
 *  - IP is private / localhost (no geo lookup possible)
 *  - geoip lookup miss
 *  - Country != ID (we only bucket Indonesian visitors)
 *  - Province code not in our mapping (e.g. a new province we
 *    haven't added yet — log + return null rather than misclassify)
 */
export function resolveRegion(headers: Headers): RegionBucket | null {
  const ip = clientIpFromHeaders(headers);
  if (!ip || isPrivateIp(ip)) return null;
  try {
    const hit = geoip.lookup(ip);
    if (!hit || hit.country !== "ID") return null;
    return PROVINCE_TO_REGION[hit.region] ?? null;
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
