"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { logAdminAction } from "@/lib/admin-log";
import {
  deleteAttachment,
  writeAttachment,
  type AttachmentKind,
} from "@/lib/attachments";
import { KNOWN_PROVIDERS } from "@/lib/cost-providers";
import { getUsdToIdr, setUsdToIdr } from "@/lib/settings";
import { requireSuperadmin, requireSystemAccess } from "@/lib/superadmin";

/** Pull an uploaded file from FormData, persist it to disk, return
 *  the metadata to store on the DB row. Returns null when no file
 *  was attached. Throws on validation failure (size / type / IO)
 *  with the same error-code shape the caller can surface. */
async function consumeAttachment(
  formData: FormData,
  kind: AttachmentKind,
): Promise<{
  path: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
} | null> {
  const raw = formData.get("attachment");
  if (!(raw instanceof File) || raw.size === 0) return null;
  const meta = await writeAttachment(kind, raw);
  return meta;
}

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
  const session = await requireSuperadmin();
  // Cap at the column widths defined in the SQLAlchemy model — admin
  // gate keeps the attack surface small, but bounded inputs prevent a
  // typo (or a paste of the wrong thing) from filling the column.
  const name = String(formData.get("name") ?? "").trim().slice(0, 64);
  const url = String(formData.get("url") ?? "").trim().slice(0, 500);
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
  const [inserted] = await db
    .insert(schema.rssFeeds)
    .values({ name, url, enabled: true, scope, region, fetchBody })
    .onConflictDoNothing()
    .returning({ id: schema.rssFeeds.id });
  if (inserted) {
    await logAdminAction({
      actorId: session.user.id,
      action: "rss.add",
      targetType: "rss_feed",
      targetId: inserted.id,
      payload: { name, url, scope, region, fetch_body: fetchBody },
    });
  }
  revalidatePath("/admin/system/rss");
}

/** Flip the per-feed `fetch_body` toggle. */
export async function toggleFetchBody(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const next = formData.get("fetch_body") !== "true";
  if (!id) return;
  const [row] = await db
    .select({ name: schema.rssFeeds.name })
    .from(schema.rssFeeds)
    .where(eq(schema.rssFeeds.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(schema.rssFeeds)
    .set({ fetchBody: next, updatedAt: new Date() })
    .where(eq(schema.rssFeeds.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "rss.toggle_fetch_body",
    targetType: "rss_feed",
    targetId: id,
    payload: { name: row.name, fetch_body: next },
  });
  revalidatePath("/admin/system/rss");
}

export async function toggleRssFeed(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  const [row] = await db
    .select({ name: schema.rssFeeds.name })
    .from(schema.rssFeeds)
    .where(eq(schema.rssFeeds.id, id))
    .limit(1);
  if (!row) return;
  const newEnabled = !enabled;
  await db
    .update(schema.rssFeeds)
    .set({ enabled: newEnabled, updatedAt: new Date() })
    .where(eq(schema.rssFeeds.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "rss.toggle_enabled",
    targetType: "rss_feed",
    targetId: id,
    payload: { name: row.name, enabled: newEnabled },
  });
  revalidatePath("/admin/system/rss");
}

export async function deleteRssFeed(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({ name: schema.rssFeeds.name, url: schema.rssFeeds.url })
    .from(schema.rssFeeds)
    .where(eq(schema.rssFeeds.id, id))
    .limit(1);
  if (!row) return;
  await db.delete(schema.rssFeeds).where(eq(schema.rssFeeds.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "rss.delete",
    targetType: "rss_feed",
    targetId: id,
    payload: { name: row.name, url: row.url },
  });
  revalidatePath("/admin/system/rss");
}

/* ────────────────────────────────────────────────────────────
 * YouTube channel whitelist CRUD
 *
 * Replaces keyword search.list for YT (100× cheaper on quota via
 * playlistItems.list). One row per curated channel; `category` is one
 * of the 8 buckets curated on 2026-05-20.
 * ──────────────────────────────────────────────────────────── */

const YT_CATEGORIES = [
  "religious",
  "family",
  "youth",
  "muamalah",
  "social_justice",
  "health",
  "education",
  "cultural",
] as const;

/** YT channel IDs are always 24 chars starting with `UC`. We use this
 *  to derive the uploads playlist (`UU…`) without paying for an extra
 *  channels.list call. Anything else is either a typo or a legacy
 *  account we can't auto-scrape — reject at write time. */
function isValidYtChannelId(value: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(value);
}

export async function addYoutubeChannel(formData: FormData) {
  const session = await requireSuperadmin();
  const channelId = String(formData.get("channel_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 255);
  const handle = String(formData.get("handle") ?? "").trim().slice(0, 128) || null;
  const rawCategory = String(formData.get("category") ?? "");
  if (!channelId || !name) return;
  if (!isValidYtChannelId(channelId)) return;
  const category = (YT_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : null;
  if (!category) return;
  const [inserted] = await db
    .insert(schema.youtubeChannels)
    .values({ channelId, name, handle, category, enabled: true })
    .onConflictDoNothing()
    .returning({ id: schema.youtubeChannels.id });
  if (inserted) {
    await logAdminAction({
      actorId: session.user.id,
      action: "youtube_channel.add",
      targetType: "youtube_channel",
      targetId: inserted.id,
      payload: { channel_id: channelId, name, category },
    });
  }
  revalidatePath("/admin/system/youtube-channels");
}

export async function toggleYoutubeChannel(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  const [row] = await db
    .select({ name: schema.youtubeChannels.name })
    .from(schema.youtubeChannels)
    .where(eq(schema.youtubeChannels.id, id))
    .limit(1);
  if (!row) return;
  const newEnabled = !enabled;
  await db
    .update(schema.youtubeChannels)
    .set({ enabled: newEnabled, updatedAt: new Date() })
    .where(eq(schema.youtubeChannels.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "youtube_channel.toggle",
    targetType: "youtube_channel",
    targetId: id,
    payload: { name: row.name, enabled: newEnabled },
  });
  revalidatePath("/admin/system/youtube-channels");
}

export async function updateYoutubeChannelCategory(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const rawCategory = String(formData.get("category") ?? "");
  if (!id) return;
  if (!(YT_CATEGORIES as readonly string[]).includes(rawCategory)) return;
  const [row] = await db
    .select({ name: schema.youtubeChannels.name })
    .from(schema.youtubeChannels)
    .where(eq(schema.youtubeChannels.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(schema.youtubeChannels)
    .set({ category: rawCategory, updatedAt: new Date() })
    .where(eq(schema.youtubeChannels.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "youtube_channel.recategorize",
    targetType: "youtube_channel",
    targetId: id,
    payload: { name: row.name, category: rawCategory },
  });
  revalidatePath("/admin/system/youtube-channels");
}

export async function deleteYoutubeChannel(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({
      name: schema.youtubeChannels.name,
      channelId: schema.youtubeChannels.channelId,
    })
    .from(schema.youtubeChannels)
    .where(eq(schema.youtubeChannels.id, id))
    .limit(1);
  if (!row) return;
  await db
    .delete(schema.youtubeChannels)
    .where(eq(schema.youtubeChannels.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "youtube_channel.delete",
    targetType: "youtube_channel",
    targetId: id,
    payload: { name: row.name, channel_id: row.channelId },
  });
  revalidatePath("/admin/system/youtube-channels");
}

/* ────────────────────────────────────────────────────────────
 * Manual cost CRUD (VPS, domain, etc.)
 * ──────────────────────────────────────────────────────────── */

export async function addManualCost(formData: FormData) {
  const session = await requireSuperadmin();
  const kind = String(formData.get("kind") ?? "").trim().slice(0, 32);
  const vendor = String(formData.get("vendor") ?? "").trim().slice(0, 64);
  const amount = Number(formData.get("amount_idr") ?? 0);
  const start = String(formData.get("period_start") ?? "");
  const end = String(formData.get("period_end") ?? "");
  const rawNote = (formData.get("note") ?? "").toString().trim();
  const note = rawNote ? rawNote.slice(0, 2000) : null;
  if (!kind || !vendor || !amount || !start || !end) return;

  // Validate covers_provider against the KNOWN_PROVIDERS allow-list.
  // Empty string / "none" → null (pure infra cost, no usage offset).
  const rawCoversProvider = (
    formData.get("covers_provider") ?? ""
  ).toString();
  const coversProvider = (KNOWN_PROVIDERS as readonly string[]).includes(
    rawCoversProvider,
  )
    ? rawCoversProvider
    : null;

  // Optional invoice attachment. Persist to disk first so the DB row
  // doesn't reference a missing file if the upload fails mid-way.
  const attachment = await consumeAttachment(formData, "manual-cost");

  const [inserted] = await db
    .insert(schema.manualCosts)
    .values({
      kind,
      vendor,
      amountIdr: amount,
      periodStart: new Date(start),
      periodEnd: new Date(end),
      note,
      coversProvider,
      attachmentPath: attachment?.path,
      attachmentFilename: attachment?.filename,
      attachmentSizeBytes: attachment?.sizeBytes,
      attachmentMimeType: attachment?.mimeType,
    })
    .returning({ id: schema.manualCosts.id });
  if (inserted) {
    await logAdminAction({
      actorId: session.user.id,
      action: "cost.add",
      targetType: "manual_cost",
      targetId: inserted.id,
      payload: {
        kind,
        vendor,
        amount_idr: amount,
        covers_provider: coversProvider,
        has_attachment: Boolean(attachment),
      },
    });
  }
  revalidatePath("/admin/system/costs");
  revalidatePath("/admin/system");
}

export async function deleteManualCost(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Read the row first so we know which file (if any) to unlink and
  // can include identifying fields in the audit payload — once the
  // row is gone there's no way to recover them.
  const [row] = await db
    .select({
      attachmentPath: schema.manualCosts.attachmentPath,
      kind: schema.manualCosts.kind,
      vendor: schema.manualCosts.vendor,
      amountIdr: schema.manualCosts.amountIdr,
      coversProvider: schema.manualCosts.coversProvider,
    })
    .from(schema.manualCosts)
    .where(eq(schema.manualCosts.id, id))
    .limit(1);
  if (!row) return;
  await db.delete(schema.manualCosts).where(eq(schema.manualCosts.id, id));
  if (row.attachmentPath) {
    await deleteAttachment(row.attachmentPath);
  }
  await logAdminAction({
    actorId: session.user.id,
    action: "cost.delete",
    targetType: "manual_cost",
    targetId: id,
    payload: {
      kind: row.kind,
      vendor: row.vendor,
      amount_idr: row.amountIdr,
      covers_provider: row.coversProvider,
    },
  });
  revalidatePath("/admin/system/costs");
}

/* ────────────────────────────────────────────────────────────
 * Donations — income side of the ledger.
 * ──────────────────────────────────────────────────────────── */

export async function addDonation(formData: FormData) {
  // Donations are admin-accessible (read-only system area exception #1).
  const session = await requireSystemAccess();
  const amount = Number(formData.get("amount_idr") ?? 0);
  const receivedAt = String(formData.get("received_at") ?? "");
  if (!amount || amount <= 0 || !receivedAt) return;

  const isAnonymous = formData.get("is_anonymous") === "on";
  // If the donor wants to be anonymous, never persist their actual name —
  // not even in `donor`. The public page filters on `is_anonymous`, but
  // a dropped column is safer than a depended-on check.
  const rawDonor = (formData.get("donor") ?? "").toString().trim();
  const donor = isAnonymous ? null : rawDonor ? rawDonor.slice(0, 120) : null;

  const rawChannel = (formData.get("channel") ?? "").toString().trim();
  const channel = rawChannel ? rawChannel.slice(0, 32) : null;

  const rawNote = (formData.get("note") ?? "").toString().trim();
  const note = rawNote ? rawNote.slice(0, 2000) : null;

  // Optional transfer-proof / receipt file. Admin-only access via
  // /api/admin/attachments/donation/[id] — never exposed publicly
  // (the /transparency page reads from `donations` but never the
  // attachment fields).
  const attachment = await consumeAttachment(formData, "donation");

  const [inserted] = await db
    .insert(schema.donations)
    .values({
      receivedAt: new Date(receivedAt),
      amountIdr: amount,
      donor,
      isAnonymous,
      channel,
      note,
      attachmentPath: attachment?.path,
      attachmentFilename: attachment?.filename,
      attachmentSizeBytes: attachment?.sizeBytes,
      attachmentMimeType: attachment?.mimeType,
    })
    .returning({ id: schema.donations.id });
  if (inserted) {
    await logAdminAction({
      actorId: session.user.id,
      action: "donation.add",
      targetType: "donation",
      targetId: inserted.id,
      payload: {
        amount_idr: amount,
        donor: isAnonymous ? "(anonymous)" : donor,
        channel,
        has_attachment: Boolean(attachment),
      },
    });
  }
  revalidatePath("/admin/system/donations");
  revalidatePath("/admin/system/costs");
  revalidatePath("/transparency");
}

export async function deleteDonation(formData: FormData) {
  // Donations are admin-accessible (read-only system area exception #1).
  const session = await requireSystemAccess();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({
      attachmentPath: schema.donations.attachmentPath,
      amountIdr: schema.donations.amountIdr,
      donor: schema.donations.donor,
      isAnonymous: schema.donations.isAnonymous,
      channel: schema.donations.channel,
    })
    .from(schema.donations)
    .where(eq(schema.donations.id, id))
    .limit(1);
  if (!row) return;
  await db.delete(schema.donations).where(eq(schema.donations.id, id));
  if (row.attachmentPath) {
    await deleteAttachment(row.attachmentPath);
  }
  await logAdminAction({
    actorId: session.user.id,
    action: "donation.delete",
    targetType: "donation",
    targetId: id,
    payload: {
      amount_idr: row.amountIdr,
      donor: row.isAnonymous ? "(anonymous)" : row.donor,
      channel: row.channel,
    },
  });
  revalidatePath("/admin/system/donations");
  revalidatePath("/admin/system/costs");
  revalidatePath("/transparency");
}

/* ────────────────────────────────────────────────────────────
 * Contact-form inbox
 * ──────────────────────────────────────────────────────────── */

export async function setContactStatus(formData: FormData) {
  // Inbox triage is admin-accessible (read-only system area exception #2).
  const session = await requireSystemAccess();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["new", "read", "archived"].includes(status)) return;
  const [row] = await db
    .select({ email: schema.contactMessages.email })
    .from(schema.contactMessages)
    .where(eq(schema.contactMessages.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(schema.contactMessages)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.contactMessages.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "contact.status_change",
    targetType: "contact_message",
    targetId: id,
    payload: { email: row.email, new_status: status },
  });
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
  const session = await requireSuperadmin();
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
  const insertedPlatforms: string[] = [];
  for (const platform of platforms) {
    const [inserted] = await db
      .insert(schema.ingestQueries)
      .values({
        platform,
        query,
        category,
        enabled: true,
      })
      .onConflictDoNothing()
      .returning({ id: schema.ingestQueries.id });
    if (inserted) insertedPlatforms.push(platform);
  }
  if (insertedPlatforms.length > 0) {
    await logAdminAction({
      actorId: session.user.id,
      action: "ingest_query.add",
      targetType: "ingest_query",
      // Multi-row insert — use the query string itself as the target
      // identifier for the audit row (platforms are in the payload).
      targetId: query,
      payload: { query, category, platforms: insertedPlatforms },
    });
  }
  revalidatePath("/admin/system/queries");
}

export async function toggleIngestQuery(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  const [row] = await db
    .select({
      platform: schema.ingestQueries.platform,
      query: schema.ingestQueries.query,
    })
    .from(schema.ingestQueries)
    .where(eq(schema.ingestQueries.id, id))
    .limit(1);
  if (!row) return;
  const newEnabled = !enabled;
  await db
    .update(schema.ingestQueries)
    .set({ enabled: newEnabled, updatedAt: new Date() })
    .where(eq(schema.ingestQueries.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "ingest_query.toggle",
    targetType: "ingest_query",
    targetId: id,
    payload: {
      platform: row.platform,
      query: row.query,
      enabled: newEnabled,
    },
  });
  revalidatePath("/admin/system/queries");
}

export async function deleteIngestQuery(formData: FormData) {
  const session = await requireSuperadmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({
      platform: schema.ingestQueries.platform,
      query: schema.ingestQueries.query,
      category: schema.ingestQueries.category,
    })
    .from(schema.ingestQueries)
    .where(eq(schema.ingestQueries.id, id))
    .limit(1);
  if (!row) return;
  await db
    .delete(schema.ingestQueries)
    .where(eq(schema.ingestQueries.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "ingest_query.delete",
    targetType: "ingest_query",
    targetId: id,
    payload: {
      platform: row.platform,
      query: row.query,
      category: row.category,
    },
  });
  revalidatePath("/admin/system/queries");
}

export async function deleteContactMessage(formData: FormData) {
  // Inbox triage is admin-accessible (read-only system area exception #2).
  const session = await requireSystemAccess();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db
    .select({
      email: schema.contactMessages.email,
      subject: schema.contactMessages.subject,
    })
    .from(schema.contactMessages)
    .where(eq(schema.contactMessages.id, id))
    .limit(1);
  if (!row) return;
  await db
    .delete(schema.contactMessages)
    .where(eq(schema.contactMessages.id, id));
  await logAdminAction({
    actorId: session.user.id,
    action: "contact.delete",
    targetType: "contact_message",
    targetId: id,
    payload: { email: row.email, subject: row.subject },
  });
  revalidatePath("/admin/system/inbox");
  revalidatePath("/admin/system");
}

/* ────────────────────────────────────────────────────────────
 * App settings — currently just the USD→IDR display rate.
 * ──────────────────────────────────────────────────────────── */

export async function updateFxRate(formData: FormData) {
  const session = await requireSuperadmin();
  const raw = formData.get("usd_to_idr");
  const rate = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isFinite(rate) || rate <= 0) return;
  // Sanity ceiling — anything above 100k IDR/USD is a typo, not an FX move.
  if (rate > 100_000) return;
  const previous = await getUsdToIdr();
  await setUsdToIdr(rate);
  await logAdminAction({
    actorId: session.user.id,
    action: "fx_rate.update",
    targetType: "setting",
    targetId: "usd_to_idr",
    payload: { from: previous, to: rate },
  });
  revalidatePath("/admin/system");
  revalidatePath("/admin/system/costs");
  revalidatePath("/admin/system/api-costs");
}
