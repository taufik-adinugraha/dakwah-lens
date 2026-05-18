"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { setUsdToIdr } from "@/lib/settings";
import { requireSuperadmin } from "@/lib/superadmin";

/* ────────────────────────────────────────────────────────────
 * RSS feed CRUD
 * ──────────────────────────────────────────────────────────── */

const RSS_SCOPES = ["national", "regional"] as const;
const RSS_REGIONS = [
  "jabodetabek",
  "jawa_barat",
  "jawa_tengah_diy",
  "jawa_timur",
  "sumatera",
  "kalimantan",
  "sulawesi",
  "indonesia_timur",
] as const;

/**
 * Reject URLs that point at internal infrastructure. Defends against an
 * SSRF where a compromised superadmin (or a typo) adds a feed pointing
 * to localhost / RFC1918 / link-local space — trafilatura would otherwise
 * happily fetch http://127.0.0.1:5432 or the AWS metadata endpoint.
 *
 * Syntactic only — does not resolve DNS. The Python fetcher should
 * additionally validate the resolved IP at request time.
 */
function isUnsafeFeedUrl(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return true;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  // URL.hostname keeps the brackets on IPv6 literals; strip for matching.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
      (a === 169 && b === 254) || // link-local + AWS metadata
      (a === 172 && b >= 16 && b <= 31) || // 172.16/12
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    ) {
      return true;
    }
  }
  // IPv6 literals — URL.hostname strips the brackets, so we match on the
  // raw hex prefix. Covers ::1 (loopback), ULA (fc00::/7), link-local
  // (fe80::/10) and unspecified (::).
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  return false;
}

export async function addRssFeed(formData: FormData) {
  await requireSuperadmin();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const rawScope = String(formData.get("scope") ?? "national");
  const rawRegion = String(formData.get("region") ?? "");
  if (!name || !url) return;
  if (isUnsafeFeedUrl(url)) return;
  const scope = (RSS_SCOPES as readonly string[]).includes(rawScope)
    ? rawScope
    : "national";
  // Regional feeds require a region; national feeds force it to null.
  const region =
    scope === "regional" &&
    (RSS_REGIONS as readonly string[]).includes(rawRegion)
      ? rawRegion
      : null;
  if (scope === "regional" && !region) return;
  const fetchBody = formData.get("fetch_body") === "on";
  await db
    .insert(schema.rssFeeds)
    .values({ name, url, enabled: true, scope, region, fetchBody })
    .onConflictDoNothing();
  revalidatePath("/admin/system/rss");
}

/** Flip the per-feed `fetch_body` toggle. */
export async function toggleFetchBody(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const next = formData.get("fetch_body") !== "true";
  if (!id) return;
  await db
    .update(schema.rssFeeds)
    .set({ fetchBody: next, updatedAt: new Date() })
    .where(eq(schema.rssFeeds.id, id));
  revalidatePath("/admin/system/rss");
}

export async function toggleRssFeed(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  await db
    .update(schema.rssFeeds)
    .set({ enabled: !enabled, updatedAt: new Date() })
    .where(eq(schema.rssFeeds.id, id));
  revalidatePath("/admin/system/rss");
}

export async function deleteRssFeed(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(schema.rssFeeds).where(eq(schema.rssFeeds.id, id));
  revalidatePath("/admin/system/rss");
}

/* ────────────────────────────────────────────────────────────
 * Manual cost CRUD (VPS, domain, etc.)
 * ──────────────────────────────────────────────────────────── */

export async function addManualCost(formData: FormData) {
  await requireSuperadmin();
  const kind = String(formData.get("kind") ?? "").trim();
  const vendor = String(formData.get("vendor") ?? "").trim();
  const amount = Number(formData.get("amount_idr") ?? 0);
  const start = String(formData.get("period_start") ?? "");
  const end = String(formData.get("period_end") ?? "");
  const note = (formData.get("note") ?? "").toString().trim() || null;
  if (!kind || !vendor || !amount || !start || !end) return;
  await db.insert(schema.manualCosts).values({
    kind,
    vendor,
    amountIdr: amount,
    periodStart: new Date(start),
    periodEnd: new Date(end),
    note,
  });
  revalidatePath("/admin/system/costs");
}

export async function deleteManualCost(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(schema.manualCosts).where(eq(schema.manualCosts.id, id));
  revalidatePath("/admin/system/costs");
}

/* ────────────────────────────────────────────────────────────
 * Donations — income side of the ledger.
 * ──────────────────────────────────────────────────────────── */

export async function addDonation(formData: FormData) {
  await requireSuperadmin();
  const amount = Number(formData.get("amount_idr") ?? 0);
  const receivedAt = String(formData.get("received_at") ?? "");
  if (!amount || amount <= 0 || !receivedAt) return;

  const isAnonymous = formData.get("is_anonymous") === "on";
  // If the donor wants to be anonymous, never persist their actual name —
  // not even in `donor`. The public page filters on `is_anonymous`, but
  // a dropped column is safer than a depended-on check.
  const rawDonor = (formData.get("donor") ?? "").toString().trim();
  const donor = isAnonymous ? null : rawDonor || null;

  const rawChannel = (formData.get("channel") ?? "").toString().trim();
  const channel = rawChannel ? rawChannel.slice(0, 32) : null;

  const note = (formData.get("note") ?? "").toString().trim() || null;

  await db.insert(schema.donations).values({
    receivedAt: new Date(receivedAt),
    amountIdr: amount,
    donor,
    isAnonymous,
    channel,
    note,
  });
  revalidatePath("/admin/system/donations");
  revalidatePath("/admin/system/costs");
  revalidatePath("/transparency");
}

export async function deleteDonation(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(schema.donations).where(eq(schema.donations.id, id));
  revalidatePath("/admin/system/donations");
  revalidatePath("/admin/system/costs");
  revalidatePath("/transparency");
}

/* ────────────────────────────────────────────────────────────
 * Contact-form inbox
 * ──────────────────────────────────────────────────────────── */

export async function setContactStatus(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["new", "read", "archived"].includes(status)) return;
  await db
    .update(schema.contactMessages)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.contactMessages.id, id));
  revalidatePath("/admin/system/inbox");
  revalidatePath("/admin/system");
}

/* ────────────────────────────────────────────────────────────
 * Ingest-query CRUD (keyword rotation, /admin/system/queries)
 * ──────────────────────────────────────────────────────────── */

const PLATFORM_CHOICES = ["x", "instagram", "tiktok", "youtube"] as const;
const QUERY_CATEGORIES = [
  "religious",
  "family",
  "youth",
  "muamalah",
  "social_justice",
  "education",
  "health",
  "cultural",
  "current_events",
] as const;

export async function addIngestQuery(formData: FormData) {
  await requireSuperadmin();
  const query = String(formData.get("query") ?? "").trim().slice(0, 160);
  const category = String(formData.get("category") ?? "").trim() || null;
  // Multi-select platforms via repeated form fields.
  const platforms = formData
    .getAll("platforms")
    .map((p) => String(p))
    .filter((p) =>
      (PLATFORM_CHOICES as readonly string[]).includes(p),
    );
  if (!query || platforms.length === 0) return;
  if (
    category &&
    !(QUERY_CATEGORIES as readonly string[]).includes(category)
  ) {
    return;
  }
  // One row per (platform, query). Conflict = silently skip.
  for (const platform of platforms) {
    await db
      .insert(schema.ingestQueries)
      .values({
        platform,
        query,
        category,
        enabled: true,
      })
      .onConflictDoNothing();
  }
  revalidatePath("/admin/system/queries");
}

export async function toggleIngestQuery(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  await db
    .update(schema.ingestQueries)
    .set({ enabled: !enabled, updatedAt: new Date() })
    .where(eq(schema.ingestQueries.id, id));
  revalidatePath("/admin/system/queries");
}

export async function deleteIngestQuery(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db
    .delete(schema.ingestQueries)
    .where(eq(schema.ingestQueries.id, id));
  revalidatePath("/admin/system/queries");
}

export async function deleteContactMessage(formData: FormData) {
  await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db
    .delete(schema.contactMessages)
    .where(eq(schema.contactMessages.id, id));
  revalidatePath("/admin/system/inbox");
  revalidatePath("/admin/system");
}

/* ────────────────────────────────────────────────────────────
 * App settings — currently just the USD→IDR display rate.
 * ──────────────────────────────────────────────────────────── */

export async function updateFxRate(formData: FormData) {
  await requireSuperadmin();
  const raw = formData.get("usd_to_idr");
  const rate = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isFinite(rate) || rate <= 0) return;
  // Sanity ceiling — anything above 100k IDR/USD is a typo, not an FX move.
  if (rate > 100_000) return;
  await setUsdToIdr(rate);
  revalidatePath("/admin/system");
  revalidatePath("/admin/system/costs");
  revalidatePath("/admin/system/api-costs");
}
