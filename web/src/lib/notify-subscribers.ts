import "server-only";

import { and, eq, inArray, isNull, or, lt } from "drizzle-orm";

import { db, schema } from "@/db";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";

/**
 * Notify everyone who opted-in on a /m/{slug} discussion room.
 *
 * Triggered when admin posts a reply or an "let's meet offline"
 * invite. Per-recipient throttle: max 1 email per 24h per (slug,
 * subscriber) — prevents a chatty admin from emailing the same
 * participant five times in an afternoon.
 *
 * Concurrency-safe: claim + send is atomic per recipient via a
 * single UPDATE ... RETURNING. Two admin actions firing in parallel
 * cannot both pick up the same subscriber. Failed sends roll back
 * `last_notified_at` so the next action retries that recipient.
 *
 * Best-effort: never throws into the admin action.
 */
const PER_RECIPIENT_COOLDOWN_MS = 24 * 60 * 60_000;
/** Concurrent Resend HTTP calls. Free tier accepts ~10/sec; 5 in
 *  flight at once keeps headroom and avoids a long sequential burn. */
const SEND_BATCH_SIZE = 5;

export type NotifyKind = "admin_reply" | "offline_invite";

export async function notifySubscribers(opts: {
  briefingSlug: string;
  kind: NotifyKind;
  bodyExcerpt: string;
  posterQuestion?: string | null;
}): Promise<{ sent: number; skipped: number }> {
  const cooldownCutoff = new Date(Date.now() - PER_RECIPIENT_COOLDOWN_MS);

  // Atomic claim — single UPDATE ... RETURNING flips `last_notified_at`
  // on every eligible row and returns the rows we just locked in.
  // A second concurrent caller's UPDATE sees zero eligible rows
  // because we've already bumped `last_notified_at` to now().
  const claimed = await db
    .update(schema.mahasiswaSubscribers)
    .set({ lastNotifiedAt: new Date() })
    .where(
      and(
        eq(schema.mahasiswaSubscribers.briefingSlug, opts.briefingSlug),
        isNull(schema.mahasiswaSubscribers.unsubscribedAt),
        or(
          isNull(schema.mahasiswaSubscribers.lastNotifiedAt),
          lt(schema.mahasiswaSubscribers.lastNotifiedAt, cooldownCutoff),
        ),
      ),
    )
    .returning({
      id: schema.mahasiswaSubscribers.id,
      email: schema.mahasiswaSubscribers.email,
      unsubscribeToken: schema.mahasiswaSubscribers.unsubscribeToken,
    });

  if (claimed.length === 0) return { sent: 0, skipped: 0 };

  const subject =
    opts.kind === "offline_invite"
      ? "[Dakwah-Lens] Ajakan diskusi offline"
      : "[Dakwah-Lens] Admin membalas di diskusi kamu";
  const roomUrl = appUrl(`/m/${opts.briefingSlug}`);

  const failedIds: string[] = [];
  let sent = 0;

  // Send in bounded-concurrency batches. Resend is fine with ~10/s
  // on free tier; 5 in flight at once keeps us safely under.
  for (let i = 0; i < claimed.length; i += SEND_BATCH_SIZE) {
    const batch = claimed.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (s) => {
        const unsubUrl = appUrl(
          `/m/${opts.briefingSlug}/unsubscribe?token=${encodeURIComponent(s.unsubscribeToken)}`,
        );
        const result = await sendEmail({
          to: s.email,
          subject,
          text: makeText(opts, roomUrl, unsubUrl),
          html: renderEmail({
            heading:
              opts.kind === "offline_invite"
                ? "Ajakan diskusi offline"
                : "Admin membalas di diskusi kamu",
            paragraphs: [
              opts.posterQuestion
                ? `Diskusi: <em>${escapeHtml(opts.posterQuestion)}</em>`
                : `Diskusi yang kamu ikuti baru saja diperbarui.`,
              `<div style="margin-top:8px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#0f172a;">${escapeHtml(opts.bodyExcerpt)}</div>`,
            ],
            cta: { label: "Buka diskusi", url: roomUrl },
            footnote: `Tidak ingin email seperti ini lagi? <a href="${unsubUrl}" style="color:#475569;">Berhenti berlangganan</a>.`,
            footerTagline: "Dakwah-Lens · diskusi mahasiswa",
          }),
        });
        return { id: s.id, ok: result.ok };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        sent++;
      } else {
        const id =
          r.status === "fulfilled" ? r.value.id : null;
        if (id) failedIds.push(id);
      }
    }
  }

  // Roll back last_notified_at for failed sends so the next admin
  // action retries them. We set to NULL (vs the previous value)
  // because we don't track the previous value — acceptable since
  // the next eligible-check is `IS NULL OR < cutoff`, and either
  // branch lets the retry through.
  if (failedIds.length > 0) {
    await db
      .update(schema.mahasiswaSubscribers)
      .set({ lastNotifiedAt: null })
      .where(inArray(schema.mahasiswaSubscribers.id, failedIds));
  }

  return { sent, skipped: failedIds.length };
}

/**
 * Read-only "does this unsubscribe token resolve to a real
 * subscriber" check. Used by the GET preview on the unsubscribe
 * page so we can render either the confirm form or the
 * "link not recognized" card WITHOUT mutating anything — link
 * prefetchers (Gmail / Outlook safe-link warmers) fetch the GET
 * URL without user intent, so the GET path must be side-effect-free.
 */
export async function peekUnsubscribeToken(
  briefingSlug: string,
  token: string,
): Promise<{ id: string } | null> {
  if (!token || token.length < 8 || token.length > 128) return null;
  const [row] = await db
    .select({ id: schema.mahasiswaSubscribers.id })
    .from(schema.mahasiswaSubscribers)
    .where(
      and(
        eq(schema.mahasiswaSubscribers.briefingSlug, briefingSlug),
        eq(schema.mahasiswaSubscribers.unsubscribeToken, token),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Unsubscribe a single subscriber by their token. Returns true when
 * the token was found AND the row got marked unsubscribed (or was
 * already unsubscribed). The caller renders a generic "you're
 * unsubscribed" page either way.
 */
export async function unsubscribeByToken(
  briefingSlug: string,
  token: string,
): Promise<{ ok: boolean }> {
  if (!token || token.length < 8 || token.length > 128) return { ok: false };
  const [row] = await db
    .select({ id: schema.mahasiswaSubscribers.id })
    .from(schema.mahasiswaSubscribers)
    .where(
      and(
        eq(schema.mahasiswaSubscribers.briefingSlug, briefingSlug),
        eq(schema.mahasiswaSubscribers.unsubscribeToken, token),
      ),
    )
    .limit(1);
  if (!row) return { ok: false };
  await db
    .update(schema.mahasiswaSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(eq(schema.mahasiswaSubscribers.id, row.id));
  return { ok: true };
}

function makeText(
  opts: { kind: NotifyKind; bodyExcerpt: string; posterQuestion?: string | null },
  roomUrl: string,
  unsubUrl: string,
): string {
  const intro =
    opts.kind === "offline_invite"
      ? "Admin Dakwah-Lens mengajak diskusi tatap muka dari ruang yang kamu ikuti."
      : "Admin Dakwah-Lens baru saja membalas di ruang diskusi yang kamu ikuti.";
  const topic = opts.posterQuestion ? `\nDiskusi: "${opts.posterQuestion}"\n` : "";
  return (
    `${intro}\n${topic}\n` +
    `Pesan admin:\n` +
    `${opts.bodyExcerpt}\n\n` +
    `Buka diskusi: ${roomUrl}\n\n` +
    `— —\n` +
    `Tidak ingin email seperti ini lagi? Berhenti berlangganan: ${unsubUrl}\n`
  );
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

