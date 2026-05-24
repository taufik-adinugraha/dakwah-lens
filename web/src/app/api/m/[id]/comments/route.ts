import "server-only";
import { createHash, randomBytes } from "crypto";

import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { moderateComment, MODERATION_LIMITS } from "@/lib/comment-moderation";
import { verifyCommentToken } from "@/lib/comment-token";
import { getBriefingBySlug } from "@/lib/insights-data";
import {
  hashVisitorToken,
  mintVisitorToken,
  readVisitorToken,
  setVisitorCookie,
} from "@/lib/visitor-cookie";

/**
 * Public comments endpoint for the Mahasiswa article page (/m/{slug}).
 *
 *   GET  /api/m/{slug}/comments?page=N
 *       → { items: [...], page, hasMore } — approved rows only, 10 per page.
 *
 *   POST /api/m/{slug}/comments
 *       body: { display_name, body, token, website (honeypot) }
 *       → { ok: true,  status: "approved" }     — comment is live
 *         { ok: true,  status: "pending"  }     — soft-blocked (moderator OR
 *                                                  honeypot OR token-invalid
 *                                                  OR duplicate); the writer
 *                                                  sees "sedang ditinjau"
 *         { ok: false, error: "rate_limited" }  — 429 (per-IP throttle, burst)
 *         { ok: false, error: "invalid"      }  — 400 (length / display-name shape)
 *         { ok: false, error: "not_found"    }  — 404 (slug doesn't exist)
 *         { ok: false, error: "forbidden"    }  — 403 (cross-origin, empty UA, bot UA)
 *         { ok: false, error: "stale"        }  — 410 (token expired — refresh page)
 *
 * No auth required. Layered defenses (cheap → expensive):
 *   1. Same-origin gate (origin/referer host match)
 *   2. UA non-empty + not in obvious-bot list (curl, python-requests, …)
 *   3. Briefing slug must resolve
 *   4. In-memory rate-limit: 5/hr/IP + burst cap 2/min/IP
 *   5. JSON parse + honeypot field empty
 *   6. HMAC submission-token (slug-bound, ≥3s old, ≤90min)
 *   7. Display-name shape (no URLs, no @, no long digit runs)
 *   8. DB-backed throttle: 5/hr/IP (survives restarts)
 *   9. Duplicate-body block (same body+IP in 24h)
 *  10. Content moderation (regex blocklists + Flash-Lite fallback)
 *
 * IP + UA are SHA-256 hashed with NEXTAUTH_SECRET — raw values are
 * never persisted (matches the public privacy stance).
 */
export const runtime = "nodejs";

const PAGE_SIZE = 10;
const RATE_LIMIT_PER_HOUR = 5;
const PER_IP_DB_WINDOW_HOURS = 1;
const PER_IP_DB_WINDOW_LIMIT = 5;

function hashWithSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const secret = process.env.NEXTAUTH_SECRET || "dakwah-lens-fallback-secret";
  return createHash("sha256").update(`${value}|${secret}`).digest("hex");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Top-level rows only (parent_id IS NULL); replies are fetched
  // lazily via the /replies sub-endpoint when the user expands a
  // thread. Pinned rows first, then newest-first.
  //
  // `replyCount` is computed via a correlated count subquery so the
  // listing returns everything the client needs in a single round-
  // trip — keeps the room scrollable without an N+1 fetch storm.
  const replyCountSql = sql<number>`(
    SELECT COUNT(*)::int FROM ${schema.mahasiswaComments} AS r
    WHERE r.parent_id = ${schema.mahasiswaComments.id}
      AND r.status = 'approved'
  )`;
  const rows = await db
    .select({
      id: schema.mahasiswaComments.id,
      displayName: schema.mahasiswaComments.displayName,
      body: schema.mahasiswaComments.body,
      createdAt: schema.mahasiswaComments.createdAt,
      pinned: schema.mahasiswaComments.pinned,
      editedAt: schema.mahasiswaComments.editedAt,
      replyCount: replyCountSql,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.briefingSlug, id),
        eq(schema.mahasiswaComments.status, "approved"),
        isNull(schema.mahasiswaComments.parentId),
      ),
    )
    .orderBy(
      desc(schema.mahasiswaComments.pinned),
      desc(schema.mahasiswaComments.createdAt),
    )
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  return NextResponse.json({
    items: rows.slice(0, PAGE_SIZE),
    page,
    hasMore,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  // 1. Same-origin gate (cheap CSRF-style block). Browsers always set
  //    `origin` on POST; missing/foreign origin is almost always a
  //    scripted client. We compare host components so port + scheme
  //    drift doesn't false-positive.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 2. Empty / suspicious UA — real browsers always send one.
  const ua = request.headers.get("user-agent") || "";
  if (ua.length < 8 || isObviousBotUa(ua)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 3. Slug must resolve to a real briefing — defends against random POSTs.
  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // 3a. Read the anonymous visitor cookie (if any). Used downstream
  //     to stamp `visitor_token_hash` on inserted rows so admins see
  //     "returning poster" continuity across IP/UA changes. We do
  //     NOT mint a new cookie for blocked submissions — only at the
  //     approved-path insert at the bottom.
  const existingVisitorToken = await readVisitorToken();
  const existingVisitorHash = existingVisitorToken
    ? hashVisitorToken(existingVisitorToken)
    : null;

  // 3b. Room mute check — if an admin has muted this room, reject
  //     new submissions. Existing comments remain visible (read-only
  //     room semantics).
  const [roomRow] = await db
    .select({ mutedAt: schema.mahasiswaRoomSettings.mutedAt })
    .from(schema.mahasiswaRoomSettings)
    .where(eq(schema.mahasiswaRoomSettings.briefingSlug, id))
    .limit(1);
  if (roomRow?.mutedAt) {
    return NextResponse.json({ ok: false, error: "muted" }, { status: 423 });
  }

  // 4. Per-source in-memory rate limit. Key prefers IP (most stable
  //    identifier behind nginx); falls back to the visitor cookie
  //    hash when IP isn't resolvable (local dev / weird proxy
  //    configs) so we still throttle by browser-identity in those
  //    cases. Only fully unthrottled when BOTH are unavailable.
  const ip = await getClientIp();
  const rateLimitKey = ip
    ? `ip:${ip}`
    : existingVisitorHash
      ? `v:${existingVisitorHash}`
      : null;
  if (rateLimitKey) {
    const rl = checkRateLimit(
      `comment:${rateLimitKey}`,
      RATE_LIMIT_PER_HOUR,
      60 * 60_000,
    );
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429 },
      );
    }
    // Burst check — 3 submissions inside a 60s window from one
    // source is almost always a script, not a person re-thinking.
    // Leaves room for one "oops, fix typo, resubmit" sequence.
    const burst = checkRateLimit(
      `comment-burst:${rateLimitKey}`,
      3,
      60_000,
    );
    if (!burst.ok) {
      return NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429 },
      );
    }
  }

  // 5. Parse + validate body shape.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const obj = payload as Record<string, unknown>;
  const displayName =
    typeof obj.display_name === "string" ? obj.display_name.trim() : "";
  const body = typeof obj.body === "string" ? obj.body : "";
  const submitToken = typeof obj.token === "string" ? obj.token : null;
  // Honeypot field — named `dl_url_check` (NOT `website` /
  // `homepage` etc) so password managers and LinkedIn-style
  // autofills don't populate it for real users.
  const honeypot = typeof obj.dl_url_check === "string" ? obj.dl_url_check : "";
  // Optional reply target. NULL/missing = top-level comment.
  // Validated below: parent must exist in the same room, be
  // status='approved', and itself be a top-level comment (single-
  // level threading — no reply-to-reply chains).
  const rawParentId =
    typeof obj.parent_id === "string" ? obj.parent_id.trim() : "";
  const parentId = rawParentId || null;

  // Email opt-in fields (both optional). Only honored when:
  //   - `notify_me` is truthy
  //   - `email` is a syntactically-valid mailbox
  //   - the comment is approved (we don't subscribe blocked authors)
  const wantsNotify =
    obj.notify_me === true || obj.notify_me === "1" || obj.notify_me === "on";
  const rawEmail = typeof obj.email === "string" ? obj.email.trim() : "";
  const emailValid =
    rawEmail.length > 0 &&
    rawEmail.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
  const subscriberEmail = wantsNotify && emailValid ? rawEmail : null;

  // 6. Honeypot — silent block. Don't tell the bot it tripped; return
  //    a generic "accepted, pending review" so it doesn't auto-adapt.
  if (honeypot.trim().length > 0) {
    void recordBlocked(id, displayName, body, ip, ua, existingVisitorHash, "honeypot");
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // 7. HMAC submission-token check. Enforces:
  //      a) the submitter actually rendered the page (signature valid)
  //      b) the token belongs to THIS article (slug-bound HMAC)
  //      c) at least 3 seconds elapsed between page-load and submit
  //         (catches GET-then-POST scripts)
  const tokenVerdict = verifyCommentToken(id, submitToken);
  if (!tokenVerdict.ok) {
    // `too_old` is the only one with a useful retry path — tell the
    // user to refresh. The rest are bot signals; same silent-block
    // pattern as the honeypot.
    if (tokenVerdict.reason === "too_old") {
      return NextResponse.json(
        { ok: false, error: "stale" },
        { status: 410 },
      );
    }
    void recordBlocked(
      id,
      displayName,
      body,
      ip,
      ua,
      existingVisitorHash,
      `token_${tokenVerdict.reason}`,
    );
    return NextResponse.json({ ok: true, status: "pending" });
  }

  if (
    displayName.length < 2 ||
    displayName.length > MODERATION_LIMITS.nameMaxLen ||
    body.trim().length < MODERATION_LIMITS.minLen ||
    body.trim().length > MODERATION_LIMITS.maxLen
  ) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // 8. Reject names that look like contact lures (numbers, links, @).
  //    Also reserve the "Dakwah-Lens" prefix so a public commenter
  //    can't impersonate the admin-reply persona.
  if (
    /(https?:|www\.|\.com|@|\d{4,})/i.test(displayName) ||
    /^\s*dakwah[\s.\-_·]*lens/i.test(displayName)
  ) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // 9. Database-backed per-source throttle — survives process
  //    restarts. Counts rows from either the same ip_hash OR the
  //    same visitor_token_hash, so a returning poster on a fresh
  //    IP (wifi→cellular) is still throttled.
  const ipHash = hashWithSecret(ip);
  const uaHash = hashWithSecret(ua);
  if (ipHash || existingVisitorHash) {
    const sinceCutoff = new Date(
      Date.now() - PER_IP_DB_WINDOW_HOURS * 60 * 60_000,
    );
    const sourceMatchers: ReturnType<typeof eq>[] = [];
    if (ipHash) {
      sourceMatchers.push(eq(schema.mahasiswaComments.ipHash, ipHash));
    }
    if (existingVisitorHash) {
      sourceMatchers.push(
        eq(schema.mahasiswaComments.visitorTokenHash, existingVisitorHash),
      );
    }
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.mahasiswaComments)
      .where(
        and(
          // sourceMatchers always has 1+ here.
          sourceMatchers.length === 1
            ? sourceMatchers[0]
            : or(...sourceMatchers),
          gte(schema.mahasiswaComments.createdAt, sinceCutoff),
        ),
      );
    if ((count?.n ?? 0) >= PER_IP_DB_WINDOW_LIMIT) {
      return NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429 },
      );
    }
  }

  // 10. Duplicate-body block. Same trimmed body from the same IP
  //     within 24h is almost always a re-post / scripted retry.
  //     Silent block (no row inserted) so the bot doesn't learn the
  //     signal — but record_blocked logs it for audit.
  const trimmedBody = body.trim();
  if (ipHash) {
    const dupCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const dup = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.mahasiswaComments)
      .where(
        and(
          eq(schema.mahasiswaComments.ipHash, ipHash),
          eq(schema.mahasiswaComments.body, trimmedBody),
          gte(schema.mahasiswaComments.createdAt, dupCutoff),
        ),
      );
    if ((dup[0]?.n ?? 0) > 0) {
      void recordBlocked(
        id,
        displayName,
        trimmedBody,
        ip,
        ua,
        existingVisitorHash,
        "duplicate",
      );
      return NextResponse.json({ ok: true, status: "pending" });
    }
  }

  // 10b. Reply target validation. Parent must exist, live in the
  //      SAME room, be `status='approved'`, and itself be a
  //      top-level comment. Anything else → 400 'invalid' so we
  //      don't silently accept a malformed reply.
  let resolvedParentId: string | null = null;
  if (parentId) {
    const [parentRow] = await db
      .select({
        id: schema.mahasiswaComments.id,
        briefingSlug: schema.mahasiswaComments.briefingSlug,
        status: schema.mahasiswaComments.status,
        parentId: schema.mahasiswaComments.parentId,
      })
      .from(schema.mahasiswaComments)
      .where(eq(schema.mahasiswaComments.id, parentId))
      .limit(1);
    if (
      !parentRow ||
      parentRow.briefingSlug !== id ||
      parentRow.status !== "approved" ||
      parentRow.parentId !== null
    ) {
      return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    }
    resolvedParentId = parentRow.id;
  }

  // 11. Moderate. Display name also goes through the same blocklist
  //     so a clean body + spammy name still gets flagged.
  const nameVerdict = await moderateComment(displayName, { useLlm: false });
  const bodyVerdict = await moderateComment(body, { useLlm: true });

  let status: "approved" | "blocked" = "approved";
  let blockReason: string | null = null;
  if (!nameVerdict.ok) {
    status = "blocked";
    blockReason = nameVerdict.reason;
  } else if (!bodyVerdict.ok) {
    status = "blocked";
    blockReason = bodyVerdict.reason;
  }

  // 12. Visitor token — first-time comment mints + sets the cookie;
  //     returning comments re-use the existingVisitorToken read at
  //     the top of this handler. We persist its SHA-256 only.
  const mintedThisRequest = !existingVisitorToken;
  const visitorToken = existingVisitorToken ?? mintVisitorToken();
  const visitorTokenHash =
    existingVisitorHash ?? hashVisitorToken(visitorToken);

  const [insertedComment] = await db
    .insert(schema.mahasiswaComments)
    .values({
      briefingSlug: id,
      displayName,
      body: body.trim(),
      ipHash,
      uaHash,
      visitorTokenHash,
      status,
      blockReason,
      parentId: resolvedParentId,
    })
    .returning({ id: schema.mahasiswaComments.id });

  // 13. Email opt-in — store ONE row per (slug, email_normalized).
  //     Re-subscribe gracefully via ON CONFLICT DO UPDATE so a user
  //     who once unsubscribed can re-opt-in just by posting again.
  if (status === "approved" && subscriberEmail) {
    const normalized = subscriberEmail.toLowerCase();
    const unsubToken = randomBytes(24).toString("base64url");
    try {
      await db
        .insert(schema.mahasiswaSubscribers)
        .values({
          briefingSlug: id,
          commentId: insertedComment?.id ?? null,
          email: subscriberEmail,
          emailNormalized: normalized,
          unsubscribeToken: unsubToken,
        })
        .onConflictDoUpdate({
          target: [
            schema.mahasiswaSubscribers.briefingSlug,
            schema.mahasiswaSubscribers.emailNormalized,
          ],
          set: {
            // Re-opt-in revives a previously-unsubscribed row.
            // Also refresh comment_id so the audit trail points at
            // the LATEST comment from this email rather than the
            // first one they ever opted-in with.
            unsubscribedAt: null,
            email: subscriberEmail,
            commentId: insertedComment?.id ?? null,
          },
        });
    } catch (err) {
      // Subscriber persistence is best-effort — the comment is more
      // important than the opt-in. Log and continue.
      console.warn("[comments] subscriber upsert failed:", err);
    }
  }

  // Content-moderation block: notify admin too (throttled). Use a
  // separate fire-and-forget so the writer's response isn't delayed
  // by email latency.
  if (status === "blocked" && blockReason) {
    void notifyAdminSuspiciousActivity(id, blockReason).catch((err) => {
      console.warn("[comments] admin notify failed:", err);
    });
  }

  // Soft-block: from the writer's POV, we silently accept and tell
  // them it's pending review. This is intentional — telling them
  // "you tripped the gambling filter" teaches the bypass.
  //
  // `id` is included on approved inserts so the client can stash it
  // as "I own this row" and offer in-place edit while the visitor
  // cookie is still good. Blocked inserts return no id (the row is
  // invisible to the poster).
  const res = NextResponse.json({
    ok: true,
    status: status === "approved" ? "approved" : "pending",
    id: status === "approved" ? insertedComment?.id ?? null : null,
    parentId: resolvedParentId,
    subscribed: subscriberEmail !== null && status === "approved",
  });
  if (mintedThisRequest) {
    setVisitorCookie(res, visitorToken);
  }
  return res;
}

/** Same-origin check. Browsers always set `origin` on cross-origin
 *  POSTs, and on same-origin POSTs either set it to the page origin
 *  or omit it entirely (older browsers). We accept "origin missing
 *  + referer same-host" as same-origin too. Outright reject when
 *  origin is set and points elsewhere. */
function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  // No origin header (some embedded webviews omit it). Fall back to
  // referer-host match — same intent, slightly weaker.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  // No origin AND no referer is suspicious for a XHR POST.
  return false;
}

/** Match obvious automated UAs. Conservative — we don't try to fight
 *  spoofed Chrome strings here, that's the token's job. This just
 *  catches the lazy "python-requests/2.31.0", "curl/8.4.0", etc. */
function isObviousBotUa(ua: string): boolean {
  return /\b(curl|wget|python-requests|httpx|aiohttp|axios\/|got\/|libwww-perl|java-http-client|okhttp|go-http-client|scrapy|phantomjs|headlesschrome)\b/i.test(
    ua,
  );
}

/** Persist a bot-shaped submission as a `status='blocked'` row so the
 *  admin /discussion view has a single source of truth, and fire a
 *  throttled email to ADMIN_EMAIL on first event in a quiet window.
 *
 *  Public listing already filters to `status='approved'`, so blocked
 *  rows are invisible to readers but auditable to admins.
 *
 *  Best-effort: any failure here must not break the request — we
 *  already decided what to return to the writer upstream. */
async function recordBlocked(
  slug: string,
  displayName: string,
  body: string,
  ip: string | null,
  ua: string,
  visitorTokenHash: string | null,
  reason: string,
): Promise<void> {
  const safeBody = body.slice(0, 500);
  const safeName = displayName.slice(0, 40) || "(empty)";
  const ipHash = hashWithSecret(ip);
  const uaHash = hashWithSecret(ua);

  try {
    await db.insert(schema.mahasiswaComments).values({
      briefingSlug: slug,
      displayName: safeName,
      body: safeBody,
      ipHash,
      uaHash,
      visitorTokenHash,
      status: "blocked",
      blockReason: reason.slice(0, 64),
    });
  } catch (err) {
    console.warn("[comments] failed to record blocked row:", err);
  }

  // Always log too — short server-side line is useful in journalctl
  // when the DB is paging slowly.
  console.warn(
    `[comments] blocked slug=${slug} reason=${reason} ip=${ip ?? "?"} ua="${ua.slice(0, 80)}" name="${safeName}"`,
  );

  // Throttled admin notification.
  void notifyAdminSuspiciousActivity(slug, reason).catch((err) => {
    console.warn("[comments] admin notify failed:", err);
  });
}

/**
 * Throttled "suspicious activity detected" email to ADMIN_EMAIL.
 *
 * Throttle key is global (one email per cooldown across the whole
 * site) — under a sustained attack we'd rather get one email an hour
 * than 500. Admin opens /admin/system/discussion for the full list.
 */
const ADMIN_NOTIFY_COOLDOWN_MS = 30 * 60_000;

async function notifyAdminSuspiciousActivity(
  slug: string,
  reason: string,
): Promise<void> {
  // Cheap in-memory throttle — uses the same rate-limit primitive as
  // the per-IP gate, but with a global key. `max=1, window=30min`
  // means the first call returns ok and arms the cooldown; further
  // calls in the window return !ok.
  const gate = checkRateLimit("comment-admin-notify", 1, ADMIN_NOTIFY_COOLDOWN_MS);
  if (!gate.ok) return;

  const to = (
    process.env.ADMIN_EMAIL ||
    process.env.SUPERADMIN_EMAIL ||
    ""
  ).trim();
  if (!to) return;

  // Roll up: how many blocked rows in the last hour, grouped by reason.
  const sinceCutoff = new Date(Date.now() - 60 * 60_000);
  const recent = await db
    .select({
      reason: schema.mahasiswaComments.blockReason,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.status, "blocked"),
        gte(schema.mahasiswaComments.createdAt, sinceCutoff),
      ),
    )
    .groupBy(schema.mahasiswaComments.blockReason);

  const totalLastHour = recent.reduce((acc, r) => acc + (r.n ?? 0), 0);
  const breakdown = recent
    .filter((r) => r.reason)
    .map((r) => `${r.reason} × ${r.n}`)
    .join(", ");
  const adminLink = appUrl("/admin/system/discussion");

  await sendEmail({
    to,
    subject: `[Dakwah-Lens] Suspicious discussion activity (${totalLastHour} in 1h)`,
    text:
      `Suspicious activity in the public /m/{slug} discussion.\n\n` +
      `Trigger: ${reason} on slug "${slug}"\n` +
      `Last hour: ${totalLastHour} blocked submission(s)\n` +
      (breakdown ? `Breakdown: ${breakdown}\n` : "") +
      `\nOpen the admin view for full detail:\n${adminLink}\n\n` +
      `Cooldown: this notification is throttled to 1 per 30 minutes — ` +
      `further suspicious activity in that window won't re-email but will appear in the admin view.`,
    html: renderEmail({
      heading: "Suspicious discussion activity",
      paragraphs: [
        `<strong>Trigger:</strong> ${escapeHtml(reason)} on slug <code>${escapeHtml(slug)}</code>`,
        `<strong>Last hour:</strong> ${totalLastHour} blocked submission(s)` +
          (breakdown ? `<br><strong>Breakdown:</strong> ${escapeHtml(breakdown)}` : ""),
        `<em style="color:#475569;">Throttled to 1 email per 30 minutes. More events in this window will not re-email but will show up in the admin view.</em>`,
      ],
      cta: { label: "Open discussion moderation", url: adminLink },
      footerTagline: "Auto-alert from the comment moderation pipeline",
    }),
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
